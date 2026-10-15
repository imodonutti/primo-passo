// Catena di motori AI. MOTORI elenca i motori in ordine di preferenza, es.:
//   MOTORI=openrouter:openai/gpt-oss-120b:free,groq:openai/gpt-oss-120b,gemini:gemini-3.8-flash
// Ogni messaggio va al primo motore disponibile. Se un motore risponde "quota finita" o "sovraccarico",
// resta in pausa per il tempo indicato dal fornitore e si passa subito al successivo.
// La conversazione è conservata nel formato Gemini (contents/parts) e convertita al volo
// per i fornitori compatibili OpenAI, così si può cambiare motore anche a metà intervista.
const { ErroreModello } = require('./modello');

const env = (k, d = '') => process.env[k] ?? d;

const FORNITORI = {
  gemini: {
    tipo: 'gemini',
    base: () => env('GEMINI_API_BASE', 'https://generativelanguage.googleapis.com/v1beta/models'),
    chiave: () => env('GEMINI_API_KEY'),
  },
  openrouter: {
    tipo: 'openai',
    base: () => env('OPENROUTER_API_BASE', 'https://openrouter.ai/api/v1'),
    chiave: () => env('OPENROUTER_API_KEY'),
  },
  groq: {
    tipo: 'openai',
    base: () => env('GROQ_API_BASE', 'https://api.groq.com/openai/v1'),
    chiave: () => env('GROQ_API_KEY'),
  },
};

const TIMEOUT_MS = 45_000;
const MSG_OCCUPATO = 'Il servizio è molto richiesto in questo momento: riprova tra un minuto, la conversazione resta salvata.';
const MSG_TECNICO = 'Si è verificato un problema tecnico. Riprova tra poco.';

const pause = new Map(); // id motore -> { fino, motivo }
const statistiche = new Map(); // id motore -> { risposte, errori, ultimoUso, ultimoErrore }
const attesa = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Configurazione ----------
function catenaConfigurata() {
  let voci = env('MOTORI').split(',').map((s) => s.trim()).filter(Boolean);
  if (!voci.length) {
    // Compatibilità con la configurazione precedente (solo Gemini).
    voci = [`gemini:${env('GEMINI_MODEL', 'gemini-3.8-flash')}`];
    const riserva = env('GEMINI_FALLBACK_MODEL', 'gemini-2.5-flash');
    if (riserva && riserva !== 'none') voci.push(`gemini:${riserva}`);
  }
  return voci.map((v) => {
    const i = v.indexOf(':'); // il nome del modello può contenere ":" (es. ":free")
    const fornitore = v.slice(0, i).toLowerCase();
    const modello = v.slice(i + 1);
    return { id: v, fornitore, modello, conosciuto: i > 0 && Boolean(FORNITORI[fornitore]) && Boolean(modello) };
  });
}

function elencoMotori() {
  return catenaConfigurata().filter((m) => m.conosciuto && FORNITORI[m.fornitore].chiave());
}

// ---------- Pause ----------
function durataDaTesto(t) {
  const s = String(t || '');
  const m = s.match(/retry in ((?:\d+h)?(?:\d+m(?!s))?(?:[\d.]+s)?)/i) || s.match(/retryDelay"?:\s*"?([\d.]+s)/i);
  if (!m || !m[1]) return 0;
  const h = +(m[1].match(/(\d+)h/) || [0, 0])[1];
  const mi = +(m[1].match(/(\d+)m(?!s)/) || [0, 0])[1];
  const se = +(m[1].match(/([\d.]+)s/) || [0, 0])[1];
  return ((h * 60 + mi) * 60 + se) * 1000;
}

function durataDaIntestazioni(h) {
  const ra = h.get('retry-after');
  if (ra && /^\d+(\.\d+)?$/.test(ra)) return +ra * 1000;
  const reset = h.get('x-ratelimit-reset'); // OpenRouter: millisecondi epoch
  if (reset && /^\d{12,}$/.test(reset)) return Math.max(0, +reset - Date.now());
  const rr = h.get('x-ratelimit-reset-requests') || h.get('x-ratelimit-reset-tokens'); // Groq: "2m59.5s"
  if (rr) return durataDaTesto(`retry in ${rr}`);
  return 0;
}

const limita = (ms) => Math.min(Math.max(ms, 10_000), 24 * 3600_000);

function pausaPer(status, testo, intestazioni) {
  if (status === 429) {
    const indicata = durataDaTesto(testo) || (intestazioni ? durataDaIntestazioni(intestazioni) : 0);
    if (indicata) return limita(indicata + 2000);
    return /per.?day|daily|free_tier_requests|RPD/i.test(testo) ? 3600_000 : 60_000;
  }
  if (status === 401 || status === 403) return 3600_000; // chiave non valida o non autorizzata
  if (status === 402) return 3600_000; // credito esaurito
  if (status === 400 || status === 404 || status === 422) return 30 * 60_000; // modello o richiesta non supportati
  return 2 * 60_000; // 5xx, timeout, rete
}

function metti(m, ms, motivo) {
  pause.set(m.id, { fino: Date.now() + ms, motivo: motivo.slice(0, 200) });
}

function errore(messaggio, { status = 0, intestazioni = null, perUtente = MSG_OCCUPATO, malformato = false } = {}) {
  const e = new ErroreModello(messaggio, perUtente);
  e.status = status;
  e.malformato = malformato;
  e.pausaMs = malformato ? 0 : pausaPer(status, messaggio, intestazioni);
  return e;
}

async function richiesta(url, opzioni, etichetta) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const risp = await fetch(url, { ...opzioni, signal: ctrl.signal });
    const dati = await risp.json().catch(() => ({}));
    return { risp, dati };
  } catch (e) {
    throw errore(`${etichetta} rete: ${e.name === 'AbortError' ? `nessuna risposta in ${TIMEOUT_MS / 1000}s` : e.message}`, { status: 503 });
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Gemini ----------
async function chiamaGemini(m, { sistema, contenuti, strumenti }) {
  const f = FORNITORI.gemini;
  // Le chiamate a strumenti prodotte da altri motori non hanno la firma di ragionamento richiesta da Gemini 3:
  // il valore convenzionale indicato da Google evita il rifiuto della richiesta.
  const contents = contenuti.map((c) => c.role !== 'model' ? c : {
    ...c,
    parts: c.parts.map((p) => (p.functionCall && !p.thoughtSignature ? { ...p, thoughtSignature: 'skip_thought_signature_validator' } : p)),
  });
  const { risp, dati } = await richiesta(`${f.base()}/${encodeURIComponent(m.modello)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': f.chiave() },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: sistema }] }, contents, tools: [{ functionDeclarations: strumenti }] }),
  }, m.id);
  if (!risp.ok) {
    throw errore(`${m.id} ${risp.status}: ${dati.error?.message || 'errore'}`, { status: risp.status, intestazioni: risp.headers });
  }
  const parts = dati.candidates?.[0]?.content?.parts;
  if (!parts?.length) {
    const motivo = dati.candidates?.[0]?.finishReason || dati.promptFeedback?.blockReason || 'vuota';
    throw errore(`${m.id}: risposta vuota (${motivo})`, { malformato: true, perUtente: 'Non sono riuscito a formulare una risposta. Puoi riformulare?' });
  }
  const u = dati.usageMetadata || {};
  return { risposta: { role: 'model', parts }, uso: { in: u.promptTokenCount || 0, out: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0) } };
}

// ---------- Compatibili OpenAI (OpenRouter, Groq) ----------
function schemaJson(s) {
  if (Array.isArray(s)) return s.map(schemaJson);
  if (!s || typeof s !== 'object') return s;
  const o = {};
  for (const [k, v] of Object.entries(s)) o[k] = k === 'type' && typeof v === 'string' ? v.toLowerCase() : schemaJson(v);
  return o;
}

const idChiamata = (k, j) => `call_${k}_${j}`;

function versoOpenAI(sistema, contenuti) {
  const msg = [{ role: 'system', content: sistema }];
  contenuti.forEach((c, k) => {
    if (c.role === 'user') {
      c.parts.filter((p) => p.functionResponse).forEach((p, j) => {
        msg.push({ role: 'tool', tool_call_id: p.functionResponse.id || idChiamata(k - 1, j), content: JSON.stringify(p.functionResponse.response ?? {}) });
      });
      const testo = c.parts.filter((p) => typeof p.text === 'string').map((p) => p.text).join('\n');
      if (testo) msg.push({ role: 'user', content: testo });
    } else {
      const testo = c.parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('\n');
      const chiamate = c.parts.filter((p) => p.functionCall);
      if (!testo && !chiamate.length) return;
      const m = { role: 'assistant', content: testo || null };
      if (chiamate.length) {
        m.tool_calls = chiamate.map((p, j) => ({
          id: p.functionCall.id || idChiamata(k, j),
          type: 'function',
          function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args || {}) },
        }));
      }
      msg.push(m);
    }
  });
  return msg;
}

async function chiamaOpenAI(m, { sistema, contenuti, strumenti }) {
  const f = FORNITORI[m.fornitore];
  const corpo = {
    model: m.modello,
    messages: versoOpenAI(sistema, contenuti),
    tools: strumenti.map((s) => ({ type: 'function', function: { name: s.name, description: s.description, parameters: schemaJson(s.parameters) } })),
    tool_choice: 'auto',
  };
  const intestazioni = { 'Content-Type': 'application/json', Authorization: `Bearer ${f.chiave()}` };
  if (m.fornitore === 'openrouter') {
    intestazioni['HTTP-Referer'] = 'https://primopasso.dinamoai.it';
    intestazioni['X-Title'] = 'Primo Passo';
    // "deny" esclude i fornitori che conservano o usano i prompt per addestrare (molti modelli :free lo fanno).
    corpo.provider = { data_collection: env('OPENROUTER_DATA_COLLECTION', 'deny') === 'allow' ? 'allow' : 'deny' };
  }
  const { risp, dati } = await richiesta(`${f.base()}/chat/completions`, { method: 'POST', headers: intestazioni, body: JSON.stringify(corpo) }, m.id);
  // OpenRouter a volte risponde 200 con un errore nel corpo.
  const err = dati.error;
  if (!risp.ok || err) {
    const status = !risp.ok ? risp.status : Number(err?.code) || 502;
    const dettaglio = err?.metadata?.raw ? ` (${String(err.metadata.raw).slice(0, 200)})` : '';
    throw errore(`${m.id} ${status}: ${err?.message || 'errore'}${dettaglio}`, { status, intestazioni: risp.headers });
  }
  const msg = dati.choices?.[0]?.message;
  const parts = [];
  if (typeof msg?.content === 'string' && msg.content.trim()) parts.push({ text: msg.content });
  for (const tc of msg?.tool_calls || []) {
    let args;
    try {
      args = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {};
    } catch {
      throw errore(`${m.id}: argomenti non validi per ${tc.function?.name}`, { malformato: true, perUtente: MSG_TECNICO });
    }
    parts.push({ functionCall: { id: tc.id, name: tc.function?.name, args } });
  }
  if (!parts.length) throw errore(`${m.id}: risposta vuota (${dati.choices?.[0]?.finish_reason || '?'})`, { malformato: true, perUtente: 'Non sono riuscito a formulare una risposta. Puoi riformulare?' });
  const u = dati.usage || {};
  return { risposta: { role: 'model', parts }, uso: { in: u.prompt_tokens || 0, out: u.completion_tokens || 0 } };
}

// ---------- Catena ----------
function stat(id) {
  if (!statistiche.has(id)) statistiche.set(id, { risposte: 0, errori: 0, ultimoUso: null, ultimoErrore: '' });
  return statistiche.get(id);
}

async function chiama(opzioni) {
  const ora = Date.now();
  const motori = elencoMotori();
  const disponibili = motori.filter((m) => !(pause.get(m.id)?.fino > ora));
  if (!disponibili.length) {
    const primo = Math.min(...motori.map((m) => pause.get(m.id).fino));
    throw new ErroreModello(`tutti i motori in pausa fino a ${new Date(primo).toISOString()}`,
      primo - ora > 10 * 60_000
        ? 'Il servizio non è disponibile in questo momento. La conversazione resta salvata: riprova più tardi.'
        : MSG_OCCUPATO);
  }
  let ultimo;
  for (const [i, m] of disponibili.entries()) {
    const ultimoMotore = i === disponibili.length - 1;
    for (let tentativo = 0; tentativo < 2; tentativo++) {
      try {
        const esito = FORNITORI[m.fornitore].tipo === 'gemini' ? await chiamaGemini(m, opzioni) : await chiamaOpenAI(m, opzioni);
        const st = stat(m.id);
        st.risposte++;
        st.ultimoUso = new Date().toISOString();
        if (pause.get(m.id)) pause.delete(m.id);
        return { ...esito, motore: m.id };
      } catch (e) {
        ultimo = e;
        const st = stat(m.id);
        st.errori++;
        st.ultimoErrore = e.message.slice(0, 200);
        console.warn(`[motori] ${e.message.slice(0, 300)}`);
        if (!(e instanceof ErroreModello) || e.status === undefined) throw e;
        // Risposta mal formata: un secondo tentativo sullo stesso motore spesso basta.
        if (e.malformato && tentativo === 0) continue;
        // Unico motore rimasto e problema passeggero: un secondo tentativo dopo una breve attesa.
        if (ultimoMotore && tentativo === 0 && e.status >= 500) { await attesa(2000); continue; }
        if (e.pausaMs) metti(m, e.pausaMs, e.message);
        break;
      }
    }
  }
  throw ultimo;
}

function statoMotori() {
  const ora = Date.now();
  return catenaConfigurata().map((m) => {
    const p = pause.get(m.id);
    const st = statistiche.get(m.id) || { risposte: 0, errori: 0, ultimoUso: null, ultimoErrore: '' };
    let stato = 'pronto';
    if (!m.conosciuto) stato = 'fornitore sconosciuto';
    else if (!FORNITORI[m.fornitore].chiave()) stato = 'chiave mancante';
    else if (p?.fino > ora) stato = 'in pausa';
    return { id: m.id, stato, pausaFino: p?.fino > ora ? new Date(p.fino).toISOString() : null, motivo: p?.fino > ora ? p.motivo : '', ...st };
  });
}

module.exports = { chiama, elencoMotori, statoMotori, versoOpenAI, durataDaTesto, _pause: pause };
