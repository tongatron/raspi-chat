# Deploy

## Typical setup

On Raspberry Pi:

- Node app listening on `127.0.0.1:3000`
- `systemd` for the process
- `nginx` in front
- optional Cloudflare tunnel or public DNS

Recommended path: `/srv/apps/raspi-chat`

## Cloudflare Tunnel

If you want to expose the chat to the Internet without opening ports on the Raspberry, the most practical way is **Cloudflare Tunnel** with `cloudflared`.

Typical scenario: Node app on `127.0.0.1:3000`, `cloudflared` on the Raspberry, a public hostname like `chat.example.com`, no direct port forwarding from home.

### Prerequisites

- a Cloudflare account
- a domain managed by Cloudflare
- the project already working locally at `http://127.0.0.1:3000/chat`

### Flow

1. add the domain to Cloudflare if it isn't there yet
2. install `cloudflared` on the Raspberry (official guide)
3. authenticate `cloudflared` with your account
4. create a dedicated tunnel, e.g. `raspi-chat`
5. link a public hostname to the tunnel, e.g. `chat.example.com`
6. configure the tunnel's ingress to `http://127.0.0.1:3000`
7. install `cloudflared` as a systemd service

```bash
cloudflared tunnel login
cloudflared tunnel create raspi-chat
cloudflared tunnel route dns raspi-chat chat.example.com
```

Example config at `/etc/cloudflared/config.yml`:

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

If you used the setup wizard, you already have a ready-made base at `data/setup-generated/cloudflared.config.yml`.

### Cloudflare and nginx

Two sensible options: tunnel directly to `http://127.0.0.1:3000`, or tunnel to `nginx` if you also use it for other local rules. If you only run the chat, tunneling straight to Fastify is often the simplest choice.

### WebSocket

The chat uses WebSocket at `/chat/ws`. With Cloudflare Tunnel, no special configuration is needed: the tunnel forwards HTTP/WebSocket traffic to the configured local service.

### Verification

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

### Practical notes

- if you use the PWA and notifications, a stable public domain matters
- for extra protection you can add a Cloudflare Access policy in front of the domain, but for a private chat it's usually not needed
