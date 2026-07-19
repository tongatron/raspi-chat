# Deploy

## Assetto tipico

Su Raspberry Pi:

- app Node in ascolto su `127.0.0.1:3000`
- `systemd` per il processo
- `nginx` davanti
- opzionale tunnel Cloudflare o DNS pubblico

Percorso consigliato: `/srv/apps/raspi-chat`

## Cloudflare Tunnel

Se vuoi esporre la chat su Internet senza aprire porte sulla Raspberry, il modo più pratico è **Cloudflare Tunnel** con `cloudflared`.

Scenario tipico: app Node su `127.0.0.1:3000`, `cloudflared` sulla Raspberry, hostname pubblico tipo `chat.example.com`, nessun port forwarding diretto verso casa.

### Prerequisiti

- un account Cloudflare
- un dominio gestito da Cloudflare
- il progetto già funzionante in locale su `http://127.0.0.1:3000/chat`

### Flusso

1. aggiungi il dominio a Cloudflare se non c'è già
2. installa `cloudflared` sulla Raspberry (guida ufficiale)
3. autentica `cloudflared` con il tuo account
4. crea un tunnel dedicato, es. `raspi-chat`
5. collega un hostname pubblico al tunnel, es. `chat.example.com`
6. configura l'ingress del tunnel verso `http://127.0.0.1:3000`
7. installa `cloudflared` come servizio systemd

```bash
cloudflared tunnel login
cloudflared tunnel create raspi-chat
cloudflared tunnel route dns raspi-chat chat.example.com
```

Config di esempio in `/etc/cloudflared/config.yml`:

```yaml
tunnel: <TUNNEL_ID>
credentials-file: /home/giovanni/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: chat.example.com
    service: http://127.0.0.1:3000
  - service: http_status:404
```

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
sudo systemctl status cloudflared
```

Se usi il wizard di setup, trovi già una base pronta in `data/setup-generated/cloudflared.config.yml`.

### Cloudflare e nginx

Due opzioni sensate: tunnel diretto verso `http://127.0.0.1:3000`, oppure tunnel verso `nginx` se lo usi anche per altre regole locali. Se usi solo la chat, il tunnel diretto verso Fastify è spesso la scelta più semplice.

### WebSocket

La chat usa WebSocket su `/chat/ws`. Con Cloudflare Tunnel non serve configurazione speciale: il tunnel inoltra HTTP/WebSocket verso il servizio locale.

### Verifica

```bash
curl http://127.0.0.1:3000/health
curl -I https://chat.example.com/chat
```

```bash
sudo systemctl status raspi-chat
sudo systemctl status cloudflared
journalctl -u cloudflared -f
journalctl -u raspi-chat -f
```

### Note pratiche

- se usi PWA e notifiche, un dominio pubblico stabile è importante
- per protezione extra puoi aggiungere una policy Cloudflare Access davanti al dominio, ma per una chat privata di solito non serve
