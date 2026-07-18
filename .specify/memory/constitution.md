# raspi-chat Constitution

<!--
  Constitution ratificata a partire dal template. Governa le decisioni di
  progetto: quando una scelta implementativa entra in conflitto con questi
  principi, prevalgono i principi (o il principio va emendato esplicitamente).
-->

## Core Principles

### I. Semplicità prima di tutto (YAGNI)

raspi-chat è una chat self-hosted single-node per uso personale, familiare o di
piccola community. Ogni feature deve giustificare la propria complessità: non si
aggiungono dipendenze, servizi o astrazioni "in previsione" di scenari che non
esistono ancora. Preferire la soluzione più piccola che risolve il problema
reale. Scaling multi-nodo, alta concorrenza e federazione sono esplicitamente
**fuori scope**: chi ha quei requisiti usa Matrix/XMPP.

### II. Storage locale, SQLite-first

Lo stato dell'applicazione vive in file SQLite locali (`app.db`, `chat.db`) sotto
`data/`, sotto il pieno controllo dell'operatore. SQLite è il default e resta la
scelta raccomandata per l'hardware target. Motori alternativi (es. Postgres) o
funzioni aggiuntive (es. cifratura at-rest) sono ammessi **solo** se additivi,
opzionali e dietro un'unica astrazione dati condivisa — mai come fork del codice
di dominio.

### III. Test-First d'ora in avanti (NON negoziabile dalla v1.1)

La baseline v1.0.0 è stata rilasciata senza test automatici: è debito tecnico
riconosciuto. Da questo punto in poi ogni nuova feature o correzione MUST arrivare
con test che falliscono prima dell'implementazione e passano dopo. `npm run check`
e la suite di test sono la porta di qualità minima prima di ogni commit su `main`.

### IV. Compatibilità Raspberry / hardware modesto

Il progetto MUST restare eseguibile su hardware domestico modesto (target di
riferimento: Raspberry Pi, incluso hardware datato). Le scelte tecniche non devono
alzare il footprint di RAM/CPU oltre ciò che un piccolo home server regge. Una
feature che richiede risorse significative MUST essere opzionale e disattivata di
default.

### V. Un default pulito batte una matrice di opzioni

A parità di valore, una singola scelta ben fatta è preferibile a molte opzioni
configurabili testate a metà. Le opzioni (cifratura, backend DB alternativo,
Docker) sono **additive** rispetto a un percorso predefinito che resta semplice e
sempre funzionante. Ogni opzione introdotta MUST essere documentata e coperta da
verifica.

### VI. Deploy semplice e osservabile

Il deploy di riferimento è: app Node in ascolto su `127.0.0.1:3000`, `systemd` per
il processo, reverse proxy davanti, aggiornamento via `git pull`. Metodi
alternativi (es. Docker) sono benvenuti ma non sostituiscono quello di
riferimento. L'app MUST esporre endpoint di salute/versione (`/health`,
`/version`) e log leggibili via `journalctl`.

## Vincoli tecnici e sicurezza

- **Segreti fuori dal repo**: `.env`, `config/chat-users.json`, chiavi VAPID e
  keystore di firma NON vanno mai committati. La fonte canonica delle coordinate
  di produzione è `SERVERraspi4.md` (non versionato).
- **Cifratura at-rest**: quando introdotta, è opzionale, attivabile da `.env`, e
  non deve rompere il percorso in chiaro esistente né richiedere un secondo motore.
- **Stack**: Node.js 20+, Fastify, better-sqlite3, WebSocket nativo. Introdurre un
  framework frontend o un ORM richiede una giustificazione esplicita contro il
  Principio I.
- **Compatibilità dati**: modifiche allo schema DB MUST preservare i dati esistenti
  (migrazioni idempotenti); un `git pull` non deve mai distruggere `data/`.

## Workflow di sviluppo

- Il flusso è spec-driven (spec-kit): `constitution` → `spec` → `plan` → `tasks` →
  `implement`. Le feature vivono in `specs/NNN-nome-feature/`.
- Prima di ogni commit su `main`: `npm run check` verde e (dalla v1.1) suite di
  test verde.
- Versionamento semantico **MAJOR.MINOR.PATCH**. La baseline attuale è `v1.0.0`.
- Ogni feature che aggiunge un'opzione aggiorna la documentazione (README + spec).

## Governance

Questa constitution prevale sulle prassi implementative. Gli emendamenti richiedono:
(1) una modifica esplicita di questo file, (2) l'aggiornamento della versione qui
sotto, (3) una nota nel commit che spiega il perché. La complessità aggiunta MUST
essere giustificata rispetto ai principi; in assenza di giustificazione, va rimossa.

**Version**: 1.0.0 | **Ratified**: 2026-07-18 | **Last Amended**: 2026-07-18
