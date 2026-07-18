# Spec 008 — Script unico di finalizzazione del setup guidato

## Obiettivo

Ridurre a **un solo comando** i passi manuali che l'utente doveva eseguire dopo aver
completato il wizard web `/setup`, così da avvicinarsi a un setup "un click" anche sulla
parte che richiede privilegi di root (installazione del service `systemd` e, se scelta,
del vhost `nginx`).

## Contesto

Il README (`## Prossimi passi consigliati`) elencava fra gli sviluppi desiderati "un
setup guidato ancora più automatico". Il wizard `/setup` generava già `.env`,
`config/chat-users.json` e i template (`raspi-chat.service`, `nginx.chat.conf`,
`cloudflared.config.yml`), ma l'attivazione vera e propria richiedeva che l'utente
copiasse a mano 3-6 comandi (`cp`, `systemctl daemon-reload`, `systemctl enable --now`,
eventualmente i comandi nginx) da un elenco testuale nella risposta dell'API.

## Cosa cambia

- `POST /setup/apply` genera ora anche `data/setup-generated/finish-setup.sh`, uno
  script bash eseguibile (`chmod 755`) che:
  - rifiuta di girare senza `sudo`/root con un messaggio chiaro;
  - copia il service file generato in `/etc/systemd/system/raspi-chat.service`;
  - esegue `systemctl daemon-reload` e `systemctl enable --now raspi-chat`;
  - se `networkMode === 'nginx'`, copia anche il vhost, crea il symlink in
    `sites-enabled` e ricarica `nginx` (`nginx -t && systemctl reload nginx`).
- La risposta JSON di `/setup/apply` (e lo stato `/setup/state`) espone il path dello
  script in `generated.finishScript` / `paths.finishScript`; `nextCommands` si riduce a
  `["sudo bash <path-allo-script>"]`.
- La modalità `cloudflare` resta volutamente manuale (serve compilare il tunnel ID e
  avviare `cloudflared` a parte): non automatizzabile senza credenziali esterne.
- `ops/install-rpi.sh` e i README (IT/EN) sono aggiornati per riflettere il nuovo unico
  comando finale.

## Non-goal

- Non tocca il flusso di raccolta dati del wizard (nomi, utenti, VAPID) né la modalità
  `cloudflare`.
- Non introduce nuove dipendenze npm: lo script generato è puro bash.

## Test

`tests/setup-finish-script.test.js`:
- verifica che `finish-setup.sh` venga creato, sia eseguibile e contenga i comandi
  `systemd` attesi in modalità `lan` (senza comandi nginx);
- verifica che in modalità `nginx` lo script includa anche copia/enable/reload del vhost.
