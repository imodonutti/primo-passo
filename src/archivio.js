// Archivio su file JSON: una sessione per file. Sufficiente per il prototipo; su Coolify si passa a Postgres.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DATI = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const SESSIONI = path.join(DATI, 'sessioni');
const FILE = path.join(DATI, 'file');
fs.mkdirSync(SESSIONI, { recursive: true });
fs.mkdirSync(FILE, { recursive: true });

const valido = (id) => /^[A-Za-z0-9_-]{20,64}$/.test(id);
const percorso = (id) => path.join(SESSIONI, `${id}.json`);
const code = new Map(); // un'operazione alla volta per sessione

function nuova({ etichetta }) {
  const id = crypto.randomBytes(18).toString('base64url');
  const s = {
    id,
    etichetta: String(etichetta || '').slice(0, 120),
    creata: new Date().toISOString(),
    aggiornata: new Date().toISOString(),
    stato: 'in_corso', // in_corso | da_confermare | confermato
    brief: {},
    contenuti: [],
    trascrizione: [],
    file: [],
    letture: [],
    uiInAttesa: null,
    riepilogo: '',
  };
  salva(s);
  return s;
}

function leggi(id) {
  if (!valido(id)) return null;
  try {
    return JSON.parse(fs.readFileSync(percorso(id), 'utf8'));
  } catch {
    return null;
  }
}

function salva(s) {
  s.aggiornata = new Date().toISOString();
  const tmp = `${percorso(s.id)}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
  fs.renameSync(tmp, percorso(s.id));
}

function elenco() {
  return fs.readdirSync(SESSIONI)
    .filter((f) => f.endsWith('.json'))
    .map((f) => leggi(f.slice(0, -5)))
    .filter(Boolean)
    .sort((a, b) => b.aggiornata.localeCompare(a.aggiornata));
}

// Esegue fn(sessione) in coda: evita che due messaggi ravvicinati si sovrascrivano.
function conSessione(id, fn) {
  const prec = code.get(id) || Promise.resolve();
  const prossima = prec.catch(() => {}).then(async () => {
    const s = leggi(id);
    if (!s) return { trovata: false };
    const risultato = await fn(s);
    salva(s);
    return { trovata: true, risultato, sessione: s };
  });
  code.set(id, prossima);
  prossima.finally(() => { if (code.get(id) === prossima) code.delete(id); });
  return prossima;
}

const cartellaFile = (id) => {
  const d = path.join(FILE, id);
  fs.mkdirSync(d, { recursive: true });
  return d;
};

module.exports = { nuova, leggi, salva, elenco, conSessione, cartellaFile, valido };
