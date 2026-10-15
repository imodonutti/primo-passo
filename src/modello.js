// Errore dei motori AI e modello finto ("demo") per provare l'app senza chiavi. I motori veri sono in motori.js.
const { CAMPI, campiAttivi, stato } = require('./schema');

class ErroreModello extends Error {
  constructor(messaggio, perUtente) {
    super(messaggio);
    this.perUtente = perUtente;
  }
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

module.exports = { chiamaDemo, ErroreModello };
