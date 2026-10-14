// Chiamate al modello: Gemini via REST, oppure un modello finto ("demo") per provare l'app senza chiave.
const { CAMPI, campiAttivi, stato } = require('./schema');

const API = process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta/models';

class ErroreModello extends Error {
  constructor(messaggio, perUtente) {
    super(messaggio);
    this.perUtente = perUtente;
  }
}

const TEMPORANEO = new Set([429, 500, 503, 504]);
const attesa = (ms) => new Promise((r) => setTimeout(r, ms));
let sovraccaricoFino = 0;

// Prova il modello principale con due nuovi tentativi sugli errori temporanei (sovraccarico),
// poi il modello di riserva (GEMINI_FALLBACK_MODEL, predefinito gemini-2.5-flash; "none" per disattivarlo).
async function chiamaGemini(opzioni) {
  const riserva = process.env.GEMINI_FALLBACK_MODEL ?? 'gemini-2.5-flash';
  const conRiserva = riserva && riserva !== 'none' && riserva !== opzioni.modello;
  // Se il principale è appena risultato sovraccarico, per 2 minuti si passa subito alla riserva.
  const saltaPrincipale = conRiserva && Date.now() < sovraccaricoFino;
  const modelli = saltaPrincipale ? [riserva] : conRiserva ? [opzioni.modello, riserva] : [opzioni.modello];
  let ultimo;
  for (const [i, modello] of modelli.entries()) {
    const tentativi = i === 0 && !saltaPrincipale ? 3 : 2;
    for (let t = 0; t < tentativi; t++) {
      try {
        return await chiamaUnaVolta({ ...opzioni, modello });
      } catch (e) {
        ultimo = e;
        if (!e.temporaneo) throw e;
        if (modello === opzioni.modello && t === tentativi - 1) sovraccaricoFino = Date.now() + 120_000;
        console.warn(`[modello] ${modello} tentativo ${t + 1}: ${e.message}`);
        if (t < tentativi - 1) await attesa(1500 * 2 ** t);
      }
    }
  }
  throw ultimo;
}

async function chiamaUnaVolta({ chiave, modello, sistema, contenuti, strumenti }) {
  const corpo = {
    systemInstruction: { parts: [{ text: sistema }] },
    contents: contenuti,
    tools: [{ functionDeclarations: strumenti }],
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60_000);
  let risp;
  try {
    risp = await fetch(`${API}/${encodeURIComponent(modello)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': chiave },
      body: JSON.stringify(corpo),
      signal: ctrl.signal,
    });
  } catch (e) {
    const err = new ErroreModello(`Rete: ${e.message}`, 'Non riesco a contattare il servizio in questo momento. Riprova tra poco.');
    err.temporaneo = true;
    throw err;
  } finally {
    clearTimeout(timer);
  }
  const dati = await risp.json().catch(() => ({}));
  if (!risp.ok) {
    const e = new ErroreModello(
      `Gemini ${modello} ${risp.status}: ${dati.error?.message || 'errore'}`,
      TEMPORANEO.has(risp.status)
        ? 'Il servizio è molto richiesto in questo momento: riprova tra un minuto, la conversazione resta salvata.'
        : 'Si è verificato un problema tecnico. Riprova tra poco.'
    );
    e.temporaneo = TEMPORANEO.has(risp.status);
    throw e;
  }
  const contenuto = dati.candidates?.[0]?.content;
  if (!contenuto?.parts?.length) {
    const motivo = dati.candidates?.[0]?.finishReason || dati.promptFeedback?.blockReason || 'vuota';
    throw new ErroreModello(`Risposta vuota (${motivo})`, 'Non sono riuscito a formulare una risposta. Puoi riformulare?');
  }
  return { role: 'model', parts: contenuto.parts };
}

// ---- Modello demo: segue lo schema campo per campo, senza AI. Serve solo a collaudare il flusso. ----
function domandaPer(campo) {
  let d = `${campo.etichetta}?`;
  if (campo.opzioni) d += ` (${campo.opzioni.join(' / ')})`;
  if (campo.default) d += ` Ti propongo: "${campo.default}". Va bene?`;
  return `[demo] ${d}`;
}

function chiamaDemo(sessione, contenuti) {
  sessione.demo ||= {};
  const ultimo = contenuti[contenuti.length - 1];
  const parte = ultimo.parts[0];

  if (parte.text !== undefined && ultimo.role === 'user') {
    const chiave = sessione.demo.campo || 'nome_azienda';
    const campo = CAMPI.find((c) => c.chiave === chiave);
    let valore = parte.text.trim();
    if (campo.default && /^(si|sì|ok|va bene)(?![a-z])/i.test(valore)) valore = campo.default;
    const scelta = valore.match(/direzione "([^"]+)"/);
    if (scelta) valore = scelta[1];
    return {
      role: 'model',
      parts: [{ functionCall: { name: 'aggiorna_brief', args: { campi: [{ chiave, valore, fonte: campo.default && valore === campo.default ? 'default' : 'cliente', confermato: true }] } } }],
    };
  }

  const nomeRisposta = parte.functionResponse?.name;
  if (nomeRisposta === 'mostra_stili') {
    return { role: 'model', parts: [{ text: '[demo] Quale di queste tre direzioni senti più vicina alla tua attività?' }] };
  }
  if (nomeRisposta === 'concludi_intervista') {
    return { role: 'model', parts: [{ text: '[demo] Ecco il riepilogo: se è tutto corretto confermalo, altrimenti dimmi cosa cambiare.' }] };
  }

  const s = stato(sessione.brief);
  if (!s.mancanti.length) {
    return { role: 'model', parts: [{ functionCall: { name: 'concludi_intervista', args: { riepilogo: `Nuovo sito ${sessione.brief.tipologia?.valore || ''} per ${sessione.brief.nome_azienda?.valore || 'la tua attività'}.` } } }] };
  }
  const prossimo = campiAttivi(sessione.brief).find((c) => c.chiave === s.mancanti[0]);
  sessione.demo.campo = prossimo.chiave;
  if (prossimo.chiave === 'direzione_stile' && !sessione.demo.stiliMostrati) {
    sessione.demo.stiliMostrati = true;
    return { role: 'model', parts: [{ functionCall: { name: 'mostra_stili', args: {} } }] };
  }
  return { role: 'model', parts: [{ text: domandaPer(prossimo) }] };
}

module.exports = { chiamaGemini, chiamaDemo, ErroreModello };
