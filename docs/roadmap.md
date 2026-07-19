# Roadmap

Recommended next steps, in no particular order:

- When a user is added to a room: send them a notification and show a centered system message in chat like "*User joined the chat*".
- Show a centered date separator whenever the day changes within a chat (once per day), including when an admin joins.
- *(To evaluate/prototype)* Real-time voice transcription on the Raspberry Pi: compare **Vosk** (very smooth in real time) and **whisper.cpp** with `tiny`/`base` models (works, but with a few seconds of latency).
