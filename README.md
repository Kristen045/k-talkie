# K-Talkie 케이토키

A Korean-learning web app for Myanmar (Burmese) learners preparing for TOPIK 1–6.
Talk with an AI tutor who speaks **only Korean and Burmese**.

- **Two tutors:** Yuri (유리) and Joohyuk (주혁)
- **Three styles:** polite teacher (default), friendly friend, custom role
  (type `now you're a cafe waiter` any time)
- **Voice-first:** tap the big mic and just talk. The tutor answers out loud in a natural neural Korean voice (Yuri = female, Joohyuk = male), the face moves its mouth to the real audio, and the text transcript is on the right.
- **Grammar check:** every sentence you say gets a score (0–100), a corrected version and a short Burmese explanation.
- **History:** every conversation is saved and can be reopened

## Run it

```bash
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env               # then paste your ANTHROPIC_API_KEY (optional)
uvicorn main:app --reload
```
Open http://localhost:8000. Without an API key the app runs in **demo mode**
(scripted replies) so you can try everything.

## How the parts connect

```
Browser (templates/ + static/)  ──►  FastAPI (main.py, app/routes.py)
                                         │            │
                                         ▼            ▼
                              app/tutor.py + app/ai.py    app/db.py (SQLite)
                              (rules + Claude API)        (conversations, messages)
```

| File | Job |
|---|---|
| `main.py` | Starts the app and connects the pieces |
| `app/routes.py` | URLs: pages and the JSON API |
| `app/tutor.py` | The tutors and the system prompt (rulebook for the AI) |
| `app/ai.py` | The only file that talks to the AI (live or demo) |
| `app/db.py` | SQLite tables: `conversations`, `messages` |
| `templates/` | HTML pages (home, chat, history) |
| `static/` | CSS and JavaScript (`home.js`, `chat.js`) |

## Voices
`app/tts.py` uses Microsoft's free neural Korean voices via the `edge-tts` package (internet needed, no key).
Change them with env vars in `.env`: `KTALKIE_VOICE_YURI`, `KTALKIE_VOICE_JOOHYUK`
(options: `ko-KR-SunHiNeural` female, `ko-KR-HyunsuMultilingualNeural` / `ko-KR-InJoonNeural` male).
If the voice service can't be reached, the app falls back to the browser's built-in voice.
