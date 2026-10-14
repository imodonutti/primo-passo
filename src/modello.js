// Chiamate al modello: Gemini via REST, oppure un modello finto ("demo") per provare l'app senza chiave.
const { CAMPI, campiAttivi, stato } = require('./schema');

const API = process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta/models';

class ErroreModello extends Error {
  constructor(messaggio, perUtente) {
    super(messaggio);
    this.perUtente = perUtente;
  }
}

async function chiamaGemini({ chiave, modello, sistema, contenuti, strumenti }) {
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
    throw new ErroreModello(`Rete: ${e.message}`, 'Non riesco a contattare il servizio in questo momento. Riprova tra poco.');
  } finally {
    clearTimeout(timer);
  }
  const dati = await risp.json().catch(() => ({}));
  if (risp.status === 429) {
    throw new ErroreModello('Limite di richieste raggiunto (429)', 'Sono un po\' sovraccarico in questo momento: riprova tra un minuto, la conversazione resta salvata.');
  }
  if (!risp.ok) {
    throw new ErroreModello(`Gemini ${risp.status}: ${dati.error?.message || 'errore'}`, 'Si è verificato un problema tecnico. Riprova tra poco.');
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
