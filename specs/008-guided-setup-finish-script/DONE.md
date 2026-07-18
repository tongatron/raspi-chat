# Spec 008 — Script unico di finalizzazione del setup guidato · Fatto

**Data:** 2026-07-19 · **Autore:** Giovanni Bindi

## Obiettivo
Automatizzare l'ultimo miglio del wizard `/setup`: invece di copiare a mano più comandi
(`cp`, `systemctl daemon-reload`, `systemctl enable --now`, eventuali comandi nginx),
l'utente esegue un solo `sudo bash data/setup-generated/finish-setup.sh`.

## Cosa è cambiato
| File | Modifica |
|------|----------|
| `src/routes/setup.js` | Nuova costante `FINISH_SCRIPT_FILE`, nuova funzione `renderFinishScript()`, `POST /setup/apply` scrive lo script (`chmod 755`) e lo espone in `generated.finishScript` / `paths.finishScript`; `nextCommands` ridotto a un solo comando. |
| `ops/install-rpi.sh` | "Next steps" aggiornati: il passo 4 è ora eseguire `finish-setup.sh`. |
| `README.md` / `README.it.md` | Sezioni "Installazione rapida (Raspberry)" e "Setup guidato via web" aggiornate; nota su Cloudflare (resta manuale). |
| `tests/setup-finish-script.test.js` | 2 test: script generato/eseguibile con comandi systemd (modalità `lan`), comandi nginx aggiunti in modalità `nginx`. |

## Verifica
- `npm run check` — ok
- `npm test` — 40/40 test verdi (inclusi i 2 nuovi)

## Non fatto (fuori scope)
- Modalità `cloudflare`: richiede comunque compilare a mano il tunnel ID in
  `cloudflared.config.yml` e avviare `cloudflared`; non automatizzabile senza credenziali
  esterne all'app.
- "Public room" esplicita e altri punti dei "Prossimi passi consigliati" restano da fare.
