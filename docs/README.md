# raspi-chat

Self-hosted web chat built for Raspberry Pi and small home servers.

The project includes:
- Node.js/Fastify backend
- framework-free web/PWA frontend
- realtime messaging via WebSocket
- local SQLite storage
- image and attachment uploads, with link previews
- Web Push notifications
- optional at-rest encryption (chat.db + attachments)
- terminal CLI client
- Android app via TWA (sideload, no Play Store)

Live reference URL: `https://chat.tongatron.org/chat`

## Who it's for

This project makes sense if you want:
- a simple chat you can self-host
- something lighter than Matrix, Rocket.Chat, or similar
- an app that runs well even on older Raspberry Pi boards
- a clear base to adapt into a private, family, or small-community chat

It's not meant as an enterprise alternative to Slack/Discord: it's a pragmatic, small, and easy-to-modify codebase.

If you want a heavily structured, federated chat, bigger options exist like Matrix or Snikket. If instead you want few external dependencies, simple deployment, local storage, and ease of modification, `raspi-chat` is a lighter base better suited to Raspberry/home servers.

## Where to start

- [Installation](installation.md) — how to set up the project locally or on a Raspberry Pi
- [Features](features.md) — what the chat can do: rooms, attachments, encryption, favorites, notifications
- [CLI client](cli.md) — using the chat from a terminal
- [Deploy](deploy.md) — systemd, nginx, Cloudflare Tunnel
- [Development](development.md) — API, tests, checks
- [Roadmap](roadmap.md) — what's planned next

Source code is on [GitHub](https://github.com/tongatron/raspi-chat).
