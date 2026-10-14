# Primo Passo

Intervista guidata dall'AI che raccoglie il brief per un nuovo sito. Erede spirituale di Primi Passi Web.

Il cliente riceve un link personale, chatta con l'assistente (può interrompere e riprendere), sceglie una direzione visiva tra tre proposte, carica logo e foto e alla fine conferma un riepilogo. L'agenzia trova il brief nel pannello `/admin`, in Markdown per leggerlo e in JSON per la produzione.

## Come funziona

- **Schema del brief** (`src/schema.js`): ogni campo ha valore, fonte (`cliente`, `dedotto`, `default`) e stato di conferma. L'intervista si chiude solo quando i campi obbligatori sono pieni e nessun dato dedotto resta da confermare. La sezione negozio online si attiva solo se il tipo di sito è e-commerce.
- **Prompt e strumenti** (`src/prompt.js`): il prompt di sistema viene ricostruito a ogni turno con lo stato aggiornato del brief, quindi il modello non deve "ricordare" nulla. Strumenti: `aggiorna_brief`, `leggi_sito`, `mostra_stili`, `chiedi_file`, `concludi_intervista`.
- **Ciclo** (`src/agente.js`): messaggio del cliente, chiamata al modello, esecuzione degli strumenti, nuova chiamata, fino alla risposta testuale (massimo 8 passi).
- **Lettura siti** (`src/leggi-sito.js`): solo http/https su porte 80/443, blocca indirizzi interni e di rete locale, massimo 1,5 MB e 10 secondi, segue fino a 3 reindirizzamenti ricontrollandoli.
- **Archivio** (`src/archivio.js`): un file JSON per sessione in `data/sessioni`, file caricati in `data/file/<sessione>`. Le operazioni sulla stessa sessione sono messe in coda.

## Avvio in locale

```bash
npm install
cp .env.example .env     # compilalo, oppure passa le variabili a mano
ADMIN_TOKEN=un-token-lungo npm start
```

Poi apri `http://localhost:3000/admin`, inserisci il token e crea un link.

Senza `GEMINI_API_KEY` l'app parte in **modalità DEMO**: un finto assistente pone le domande dello schema una per una. Serve a collaudare interfaccia, archivio e pannello senza consumare chiamate.

## Variabili

| Variabile | Note |
|---|---|
| `GEMINI_API_KEY` | Chiave di Google AI Studio. Vuota = DEMO |
| `GEMINI_MODEL` | Predefinito `gemini-3.8-flash` |
| `ADMIN_TOKEN` | Obbligatorio in produzione. Se manca ne viene generato uno a ogni avvio e stampato nei log |
| `N8N_WEBHOOK_URL`, `N8N_WEBHOOK_TOKEN` | Facoltativi. Alla conferma del brief viene inviato `{evento, brief, markdown}` con l'intestazione `X-Primo-Passo-Token` |
| `DATA_DIR` | Cartella dei dati, nel container `/app/data` |
| `PORT` | Predefinita 3000 |

## Pubblicazione su Coolify

1. Repo Git con questa cartella, nuova applicazione Coolify con build da Dockerfile.
2. Dominio, per esempio `https://primopasso.dinamoai.it`, porta 3000.
3. Volume persistente su `/app/data`.
4. Variabili `GEMINI_API_KEY`, `ADMIN_TOKEN` e, se serve, quelle n8n.
5. Aggiungere `/app/data` al backup notturno su Obelix (nuova variabile in `paths.env` e nel controllo dei percorsi vuoti dello script).

## Prima di usarla con clienti veri

- **Gemini a pagamento.** Le condizioni della Gemini API consentono solo i servizi a pagamento quando l'app è resa disponibile a utenti nello Spazio Economico Europeo. La chiave gratuita va bene per le prove con dati inventati; per i clienti serve un progetto Google Cloud con fatturazione attiva (meglio con un tetto di spesa).
- **Privacy.** Informativa sul trattamento dei dati raccolti (contatti del referente, testi, file) e nomina di Google come responsabile del trattamento tramite il Data Processing Addendum dei servizi a pagamento.
- **Anti-bot.** I link sono segreti e non indovinabili, ma un link inoltrato resta usabile da chiunque lo abbia: valutare una scadenza dei link e Turnstile sul primo messaggio.
- **Lettura siti.** La protezione dagli indirizzi interni controlla il DNS prima della richiesta. Per un uso pubblico più ampio conviene far passare queste richieste da un proxy in uscita dedicato.

## Prossimi passi possibili

- Archivio su Postgres al posto dei file JSON.
- Ricerca concorrenti con un modello dotato di ricerca web, separata dall'intervista.
- Flusso n8n che, dal brief confermato, genera bozze dei testi e crea il sito WordPress di partenza.
