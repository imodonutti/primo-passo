// Lettura di una pagina web pubblica, con protezioni contro richieste verso la rete interna.
const dns = require('node:dns').promises;
const net = require('node:net');

const MAX_BYTE = 1_500_000;
const MAX_TESTO = 8000;
const TIMEOUT_MS = 10_000;

function ipPrivato(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || a >= 224
    );
  }
  const x = ip.toLowerCase();
  if (x.startsWith('::ffff:')) return ipPrivato(x.slice(7));
  return x === '::' || x === '::1' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe8') ||
    x.startsWith('fe9') || x.startsWith('fea') || x.startsWith('feb');
}

async function controllaUrl(grezzo) {
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(grezzo) ? grezzo : `https://${grezzo}`);
  } catch {
    throw new Error('Indirizzo non valido');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Sono ammessi solo indirizzi http e https');
  if (url.port && !['80', '443'].includes(url.port)) throw new Error('Porta non ammessa');
  const indirizzi = await dns.lookup(url.hostname, { all: true }).catch(() => {
    throw new Error('Dominio non trovato');
  });
  if (indirizzi.some((r) => ipPrivato(r.address))) throw new Error('Indirizzo non raggiungibile');
  return url;
}

async function scarica(url, salti = 0) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const risp = await fetch(url, {
      redirect: 'manual',
      signal: ctrl.signal,
      headers: { 'User-Agent': 'PrimoPasso/0.1 (+https://dinamoai.it)', Accept: 'text/html' },
    });
    if (risp.status >= 300 && risp.status < 400 && risp.headers.get('location')) {
      if (salti >= 3) throw new Error('Troppi reindirizzamenti');
      const prossimo = await controllaUrl(new URL(risp.headers.get('location'), url).href);
      return scarica(prossimo, salti + 1);
    }
    if (!risp.ok) throw new Error(`La pagina ha risposto ${risp.status}`);
    const tipo = risp.headers.get('content-type') || '';
    if (!tipo.includes('html')) throw new Error('La pagina non è HTML');
    const lettore = risp.body.getReader();
    const pezzi = [];
    let totale = 0;
    for (;;) {
      const { done, value } = await lettore.read();
      if (done) break;
      totale += value.length;
      pezzi.push(value);
      if (totale > MAX_BYTE) { lettore.cancel(); break; }
    }
    return { html: Buffer.concat(pezzi).toString('utf8'), urlFinale: url.href };
  } finally {
    clearTimeout(timer);
  }
}

function decodifica(s) {
  return s
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function estrai(html, urlFinale) {
  const meta = (nome) => {
    const re = new RegExp(`<meta[^>]+(?:name|property)=["']${nome}["'][^>]*content=["']([^"']*)["']`, 'i');
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${nome}["']`, 'i');
    return decodifica((html.match(re) || html.match(re2) || [])[1] || '').trim();
  };
  const titolo = decodifica((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').trim();
  const link = [...html.matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1]);
  const social = [...new Set(link.filter((h) =>
    /(facebook|instagram|linkedin|youtube|tiktok|x)\.com\//i.test(h) && !/sharer|share\?|intent\//i.test(h)
  ))].slice(0, 10);
  const testo = decodifica(
    html
      .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<\/(p|div|h\d|li|section|article|br|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
    .slice(0, MAX_TESTO);
  const email = [...new Set(html.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || [])]
    .filter((e) => !/\.(png|jpe?g|webp|svg|gif)$/i.test(e)).slice(0, 5);
  return {
    url: urlFinale,
    titolo,
    descrizione: meta('description') || meta('og:description'),
    nome_sito: meta('og:site_name'),
    colore_tema: meta('theme-color'),
    social,
    email,
    testo,
  };
}

async function leggiSito(grezzo) {
  const url = await controllaUrl(String(grezzo || '').trim());
  const { html, urlFinale } = await scarica(url);
  return estrai(html, urlFinale);
}

module.exports = { leggiSito, ipPrivato };
