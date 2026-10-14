// Brief in Markdown (per le persone) e JSON strutturato (per la produzione).
const { SEZIONI, campiAttivi, stato } = require('./schema');

const ETICHETTA_FONTE = { cliente: '', dedotto: ' _(dedotto dall\'AI)_', default: ' _(proposta standard accettata)_' };

function briefMarkdown(s) {
  const st = stato(s.brief);
  const attivi = campiAttivi(s.brief);
  const righe = [
    `# Brief: ${s.brief.nome_azienda?.valore || s.etichetta || 'nuovo progetto'}`,
    '',
    `Stato: **${s.stato.replace('_', ' ')}** · Completamento ${st.percentuale}% · Aggiornato ${new Date(s.aggiornata).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}`,
    '',
  ];
  if (s.riepilogo) righe.push('> ' + s.riepilogo.replace(/\n/g, '\n> '), '');
  for (const sez of SEZIONI) {
    const campi = attivi.filter((c) => c.sezione === sez.id);
    if (!campi.length) continue;
    const voci = [];
    for (const c of campi) {
      const v = s.brief[c.chiave];
      if (v?.valore) {
        const nota = (ETICHETTA_FONTE[v.fonte] || '') + (v.confermato ? '' : ' ⚠️ da confermare');
        voci.push(`- **${c.etichetta}:** ${v.valore.replace(/\n/g, ' ')}${nota}`);
      } else if (c.obbligatorio) {
        voci.push(`- **${c.etichetta}:** _mancante_`);
      }
    }
    if (voci.length) righe.push(`## ${sez.titolo}`, '', ...voci, '');
  }
  if (s.file.length) {
    righe.push('## File caricati', '');
    for (const f of s.file) righe.push(`- ${f.tipo}: ${f.nome} (${Math.round(f.byte / 1024)} KB)`);
    righe.push('');
  }
  if (s.letture.length) {
    righe.push('## Pagine lette dall\'AI', '');
    for (const l of s.letture) righe.push(`- ${l.url}`);
    righe.push('');
  }
  return righe.join('\n');
}

function briefJson(s) {
  return {
    id: s.id,
    etichetta: s.etichetta,
    stato: s.stato,
    creata: s.creata,
    aggiornata: s.aggiornata,
    completamento: stato(s.brief).percentuale,
    riepilogo: s.riepilogo,
    campi: s.brief,
    file: s.file.map(({ tipo, nome, byte, salvato }) => ({ tipo, nome, byte, salvato })),
    pagine_lette: s.letture,
  };
}

module.exports = { briefMarkdown, briefJson };
