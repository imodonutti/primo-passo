const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');

const archivio = require('./archivio');
const { rispondi, modalitaDemo, config } = require('./agente');
const { SALUTO } = require('./prompt');
const { stato, SEZIONI, campiAttivi } = require('./schema');
const { briefMarkdown, briefJson } = require('./riepilogo');

const PORTA = Number(process.env.PORT || 3000);
const PUBBLICO = path.join(__dirname, '..', 'public');
let ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
if (!ADMIN_TOKEN) {
  ADMIN_TOKEN = crypto.randomBytes(16).toString('hex');
  console.warn(`[avviso] ADMIN_TOKEN non impostato: per questa esecuzione è ${ADMIN_TOKEN}`);
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '32kb' }));
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
  });
  next();
});
app.use('/static', express.static(PUBBLICO, { index: false, maxAge: '1h' }));

// ---------- Pagine ----------
app.get('/', (req, res) => res.redirect('/admin'));
app.get('/admin', (req, res) => res.sendFile(path.join(PUBBLICO, 'admin.html')));
app.get('/s/:id', (req, res) => {
  if (!archivio.leggi(req.params.id)) return res.status(404).sendFile(path.join(PUBBLICO, 'non-trovato.html'));
  res.set('X-Robots-Tag', 'noindex').sendFile(path.join(PUBBLICO, 'cliente.html'));
});
app.get('/salute', (req, res) => res.json({ ok: true, demo: modalitaDemo() }));

// ---------- API cliente ----------
function avanzamento(s) {
  const st = stato(s.brief);
  const attivi = campiAttivi(s.brief);
  const sezioni = SEZIONI.filter((z) => attivi.some((c) => c.sezione === z.id)).map((z) => {
    const obb = attivi.filter((c) => c.sezione === z.id && c.obbligatorio);
    const fatti = obb.filter((c) => s.brief[c.chiave]?.valore).length;
    return { titolo: z.titolo, completa: obb.length ? fatti === obb.length : attivi.some((c) => c.sezione === z.id && s.brief[c.chiave]?.valore) };
  });
  return { percentuale: st.percentuale, sezioni, stato: s.stato };
}

function vistaCliente(s) {
  const messaggi = [{ chi: 'assistente', testo: SALUTO }, ...s.trascrizione.map(({ chi, testo }) => ({ chi, testo }))];
  return {
    etichetta: s.etichetta,
    messaggi,
    uiInAttesa: s.stato === 'confermato' ? null : s.uiInAttesa,
    demo: modalitaDemo(),
    ...avanzamento(s),
  };
}

app.get('/api/s/:id', (req, res) => {
  const s = archivio.leggi(req.params.id);
  if (!s) return res.status(404).json({ errore: 'Link non valido' });
  res.json(vistaCliente(s));
});

const ultimoInvio = new Map();
const MAX_MESSAGGI = 300;

app.post('/api/s/:id/messaggio', async (req, res) => {
  const testo = String(req.body?.testo || '').trim().slice(0, 4000);
  if (!testo) return res.status(400).json({ errore: 'Messaggio vuoto' });
  const ora = Date.now();
  if (ora - (ultimoInvio.get(req.params.id) || 0) < 1500) return res.status(429).json({ errore: 'Un attimo, sto ancora rispondendo.' });
  ultimoInvio.set(req.params.id, ora);

  const esito = await archivio.conSessione(req.params.id, async (s) => {
    if (s.stato === 'confermato') return { bloccato: 'Il brief è già stato confermato e inviato all\'agenzia.' };
    if (s.trascrizione.length >= MAX_MESSAGGI) return { bloccato: 'Abbiamo raggiunto il limite di messaggi: l\'agenzia ti ricontatterà per completare.' };
    if (s.stato === 'da_confermare') s.stato = 'in_corso'; // il cliente vuole modificare qualcosa
    return { eventi: await rispondi(s, testo) };
  });
  if (!esito.trovata) return res.status(404).json({ errore: 'Link non valido' });
  if (esito.risultato.bloccato) return res.status(409).json({ errore: esito.risultato.bloccato });
  res.json({ eventi: esito.risultato.eventi, ...avanzamento(esito.sessione) });
});

const TIPI_AMMESSI = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/svg+xml': '.svg', 'application/pdf': '.pdf' };
const caricamento = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, archivio.cartellaFile(req.params.id)),
    filename: (req, file, cb) => cb(null, crypto.randomBytes(8).toString('hex') + TIPI_AMMESSI[file.mimetype]),
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, Boolean(TIPI_AMMESSI[file.mimetype])),
});

app.post('/api/s/:id/file', (req, res, next) => {
  if (!archivio.leggi(req.params.id)) return res.status(404).json({ errore: 'Link non valido' });
  next();
}, caricamento.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ errore: 'Formato non supportato: carica PNG, JPG, WEBP, SVG o PDF fino a 10 MB.' });
  const tipo = ['logo', 'foto', 'documento'].includes(req.body.tipo) ? req.body.tipo : 'documento';
  const nome = path.basename(String(req.file.originalname)).replace(/[^\w.\- ()àèéìòù]/gi, '_').slice(0, 100);
  const esito = await archivio.conSessione(req.params.id, async (s) => {
    if (s.file.length >= 40) return { errore: 'Hai già caricato molti file: per gli altri ti contatterà l\'agenzia.' };
    s.file.push({ tipo, nome, byte: req.file.size, salvato: req.file.filename, quando: new Date().toISOString() });
    if (s.uiInAttesa?.tipo === 'upload') s.uiInAttesa = null;
    return { ok: true };
  });
  if (esito.risultato?.errore) {
    fs.rmSync(req.file.path, { force: true });
    return res.status(409).json({ errore: esito.risultato.errore });
  }
  res.json({ ok: true, nome, tipo });
});

app.post('/api/s/:id/conferma', async (req, res) => {
  const esito = await archivio.conSessione(req.params.id, async (s) => {
    if (s.stato !== 'da_confermare') return { errore: 'Il brief non è pronto per la conferma.' };
    s.stato = 'confermato';
    s.confermato = new Date().toISOString();
    s.uiInAttesa = null;
    s.trascrizione.push({ chi: 'assistente', testo: 'Grazie! Il brief è stato inviato a DinamoAI: ti contatteremo a breve con la proposta.', quando: s.confermato });
    return { ok: true };
  });
  if (!esito.trovata) return res.status(404).json({ errore: 'Link non valido' });
  if (esito.risultato.errore) return res.status(409).json({ errore: esito.risultato.errore });
  notificaN8n(esito.sessione).catch((e) => console.error('[n8n]', e.message));
  res.json(vistaCliente(esito.sessione));
});

async function notificaN8n(s) {
  const url = process.env.N8N_WEBHOOK_URL;
  if (!url) return;
  const risp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Primo-Passo-Token': process.env.N8N_WEBHOOK_TOKEN || '' },
    body: JSON.stringify({ evento: 'brief_confermato', brief: briefJson(s), markdown: briefMarkdown(s) }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!risp.ok) throw new Error(`webhook ${risp.status}`);
}

// ---------- API agenzia ----------
function soloAgenzia(req, res, next) {
  const dato = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(dato);
  const b = Buffer.from(ADMIN_TOKEN);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ errore: 'Non autorizzato' });
  next();
}

app.get('/api/admin/sessioni', soloAgenzia, (req, res) => {
  res.json({
    demo: modalitaDemo(),
    modello: config().modello,
    sessioni: archivio.elenco().map((s) => ({
      id: s.id,
      etichetta: s.etichetta,
      azienda: s.brief.nome_azienda?.valore || '',
      stato: s.stato,
      percentuale: stato(s.brief).percentuale,
      messaggi: s.trascrizione.length,
      aggiornata: s.aggiornata,
    })),
  });
});

app.post('/api/admin/sessioni', soloAgenzia, (req, res) => {
  const s = archivio.nuova({ etichetta: req.body?.etichetta });
  res.json({ id: s.id, link: `/s/${s.id}` });
});

app.get('/api/admin/sessioni/:id', soloAgenzia, (req, res) => {
  const s = archivio.leggi(req.params.id);
  if (!s) return res.status(404).json({ errore: 'Sessione non trovata' });
  res.json({ brief: briefJson(s), markdown: briefMarkdown(s), trascrizione: s.trascrizione });
});

app.get('/api/admin/sessioni/:id/file/:salvato', soloAgenzia, (req, res) => {
  const s = archivio.leggi(req.params.id);
  const f = s?.file.find((x) => x.salvato === req.params.salvato);
  if (!f) return res.status(404).json({ errore: 'File non trovato' });
  res.download(path.join(archivio.cartellaFile(s.id), f.salvato), f.nome);
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ errore: err.code === 'LIMIT_FILE_SIZE' ? 'Il file supera i 10 MB.' : 'Caricamento non riuscito.' });
  }
  console.error(err);
  res.status(500).json({ errore: 'Errore interno' });
});

app.listen(PORTA, () => {
  console.log(`Primo Passo in ascolto su :${PORTA} (${modalitaDemo() ? 'modalità DEMO, nessuna chiave Gemini' : `modello ${config().modello}`})`);
});
