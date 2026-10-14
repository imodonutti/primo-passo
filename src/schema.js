// Schema del brief di Primo Passo.
// Ogni campo nel brief salvato ha la forma:
//   { valore: string, fonte: "cliente" | "dedotto" | "default", confermato: boolean, aggiornato: ISO date }
// "dedotto" = ricavato dall'AI (es. dal sito del cliente): va sempre confermato prima della chiusura.
// "default" = proposta standard dell'agenzia accettata dal cliente.

const SEZIONI = [
  { id: 'azienda', titolo: 'Azienda e contatti' },
  { id: 'offerta', titolo: 'Prodotti e servizi' },
  { id: 'mercato', titolo: 'Mercato e clienti' },
  { id: 'obiettivi', titolo: 'Obiettivi del sito' },
  { id: 'stile', titolo: 'Stile e identità' },
  { id: 'progetto', titolo: 'Struttura del progetto' },
  { id: 'ecommerce', titolo: 'Negozio online', soloSe: { campo: 'tipologia', valore: 'e-commerce' } },
  { id: 'tecnico', titolo: 'Dominio e email' },
  { id: 'materiali', titolo: 'Materiali' },
];

// obbligatorio: il brief non si chiude senza questo campo.
// default: proposta standard che l'AI offre al cliente invece di fare una domanda aperta.
const CAMPI = [
  // Azienda
  { chiave: 'nome_azienda', sezione: 'azienda', etichetta: 'Nome azienda', obbligatorio: true },
  { chiave: 'referente', sezione: 'azienda', etichetta: 'Referente (nome e cognome)', obbligatorio: true },
  { chiave: 'email', sezione: 'azienda', etichetta: 'Email del referente', obbligatorio: true },
  { chiave: 'telefono', sezione: 'azienda', etichetta: 'Telefono' },
  { chiave: 'settore', sezione: 'azienda', etichetta: 'Settore di attività', obbligatorio: true },
  { chiave: 'sito_attuale', sezione: 'azienda', etichetta: 'Sito attuale', aiuto: 'URL oppure "nessuno"' },
  { chiave: 'social', sezione: 'azienda', etichetta: 'Profili social da collegare' },
  { chiave: 'storia', sezione: 'azienda', etichetta: 'Storia e missione', obbligatorio: true, aiuto: 'Poche frasi: da quanto esiste, cosa la distingue' },

  // Offerta
  { chiave: 'prodotti_servizi', sezione: 'offerta', etichetta: 'Prodotti o servizi principali', obbligatorio: true },
  { chiave: 'punti_forza', sezione: 'offerta', etichetta: 'Punti di forza', obbligatorio: true },
  { chiave: 'punti_debolezza', sezione: 'offerta', etichetta: 'Punti deboli o limiti' },
  { chiave: 'concorrenti', sezione: 'offerta', etichetta: 'Concorrenti o alternative' },

  // Mercato
  { chiave: 'tipo_mercato', sezione: 'mercato', etichetta: 'Mercato', obbligatorio: true, opzioni: ['B2B', 'B2C', 'entrambi'] },
  { chiave: 'cliente_ideale', sezione: 'mercato', etichetta: 'Cliente ideale', obbligatorio: true, aiuto: 'Chi è, cosa cerca, perché sceglie voi' },
  { chiave: 'area_geografica', sezione: 'mercato', etichetta: 'Area geografica servita', obbligatorio: true },
  { chiave: 'posizionamento_prezzo', sezione: 'mercato', etichetta: 'Posizionamento di prezzo', opzioni: ['economico', 'in linea col mercato', 'alto di gamma'] },
  { chiave: 'promozione_passata', sezione: 'mercato', etichetta: 'Promozione già fatta' },

  // Obiettivi
  { chiave: 'obiettivo_principale', sezione: 'obiettivi', etichetta: 'Obiettivo principale del sito', obbligatorio: true },
  { chiave: 'azione_desiderata', sezione: 'obiettivi', etichetta: 'Cosa deve fare il visitatore', obbligatorio: true, aiuto: 'Chiamare, chiedere un preventivo, prenotare, acquistare…' },
  { chiave: 'misura_successo', sezione: 'obiettivi', etichetta: 'Come capiremo che funziona' },

  // Stile
  { chiave: 'siti_riferimento', sezione: 'stile', etichetta: 'Siti che piacciono' },
  { chiave: 'identita_esistente', sezione: 'stile', etichetta: 'Identità visiva esistente', obbligatorio: true, opzioni: ['completa (logo, colori, font)', 'solo logo', 'da creare'] },
  { chiave: 'colori', sezione: 'stile', etichetta: 'Colori aziendali' },
  { chiave: 'direzione_stile', sezione: 'stile', etichetta: 'Direzione visiva scelta', obbligatorio: true, opzioni: ['Essenziale', 'Calda', 'Decisa'] },
  { chiave: 'tono_voce', sezione: 'stile', etichetta: 'Tono dei testi', obbligatorio: true, opzioni: ['formale', 'cordiale', 'diretto e informale'] },

  // Progetto
  { chiave: 'tipologia', sezione: 'progetto', etichetta: 'Tipo di sito', obbligatorio: true, opzioni: ['vetrina', 'e-commerce', 'landing page'] },
  { chiave: 'pagine', sezione: 'progetto', etichetta: 'Pagine previste', obbligatorio: true, default: 'Home, Chi siamo, Servizi, Contatti' },
  { chiave: 'lingue', sezione: 'progetto', etichetta: 'Lingue', obbligatorio: true, default: 'solo italiano' },
  { chiave: 'scadenza', sezione: 'progetto', etichetta: 'Data di pubblicazione desiderata' },

  // E-commerce (solo se tipologia = e-commerce)
  { chiave: 'numero_prodotti', sezione: 'ecommerce', etichetta: 'Numero di prodotti (circa)', obbligatorio: true },
  { chiave: 'organizzazione_catalogo', sezione: 'ecommerce', etichetta: 'Categorie e varianti', obbligatorio: true },
  { chiave: 'gestionale', sezione: 'ecommerce', etichetta: 'Gestionale da collegare', default: 'nessuno, catalogo gestito dal sito' },
  { chiave: 'spedizioni', sezione: 'ecommerce', etichetta: 'Spedizioni', obbligatorio: true, default: 'solo Italia, tariffa fissa, gratis sopra una soglia' },
  { chiave: 'pagamenti', sezione: 'ecommerce', etichetta: 'Metodi di pagamento', obbligatorio: true, default: 'carta di credito e PayPal' },

  // Tecnico
  { chiave: 'dominio', sezione: 'tecnico', etichetta: 'Dominio', obbligatorio: true, aiuto: 'Esistente (quale e chi lo gestisce) o da registrare' },
  { chiave: 'caselle_email', sezione: 'tecnico', etichetta: 'Caselle email da creare', default: 'nessuna, restano quelle attuali' },

  // Materiali
  { chiave: 'logo', sezione: 'materiali', etichetta: 'Logo', aiuto: 'Caricato o da realizzare' },
  { chiave: 'foto', sezione: 'materiali', etichetta: 'Foto disponibili', aiuto: 'Proprie, da fare, o immagini di repertorio' },
  { chiave: 'testi_esistenti', sezione: 'materiali', etichetta: 'Testi esistenti', aiuto: 'Se no, li scriviamo noi a partire da questo brief' },
];

const STILI = [
  {
    id: 'Essenziale',
    descrizione: 'Molto bianco, tipografia pulita, un solo colore di accento. Ordinato e professionale.',
    sfondo: '#FFFFFF', testo: '#1D1D1F', accento: '#2F5BEA', titoli: 'sans',
  },
  {
    id: 'Calda',
    descrizione: 'Toni crema e terracotta, titoli con grazie. Accogliente, artigianale, di fiducia.',
    sfondo: '#F6EFE6', testo: '#3A2A20', accento: '#B4532A', titoli: 'serif',
  },
  {
    id: 'Decisa',
    descrizione: 'Sfondo scuro, contrasti forti, accento vivace. Moderna e d\'impatto.',
    sfondo: '#14161A', testo: '#F2F2F2', accento: '#D7F75B', titoli: 'sans',
  },
];

function campiAttivi(brief) {
  const tip = (brief.tipologia?.valore || '').toLowerCase();
  return CAMPI.filter((c) => {
    const sez = SEZIONI.find((s) => s.id === c.sezione);
    if (!sez.soloSe) return true;
    return tip.includes('commerce');
  });
}

function stato(brief) {
  const attivi = campiAttivi(brief);
  const obbligatori = attivi.filter((c) => c.obbligatorio);
  const mancanti = obbligatori.filter((c) => !brief[c.chiave]?.valore).map((c) => c.chiave);
  const daConfermare = attivi
    .filter((c) => brief[c.chiave]?.valore && !brief[c.chiave].confermato)
    .map((c) => c.chiave);
  const compilati = obbligatori.length - mancanti.length;
  return {
    mancanti,
    daConfermare,
    percentuale: Math.round((compilati / obbligatori.length) * 100),
    completo: mancanti.length === 0 && daConfermare.length === 0,
  };
}

module.exports = { SEZIONI, CAMPI, STILI, campiAttivi, stato };
