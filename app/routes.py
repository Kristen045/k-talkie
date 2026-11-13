"""The URLs of the app. Pages (HTML) and the API (JSON the browser asks for)."""
import json
import re

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field

from . import ai, tts
from .db import get_db
from .tutor import MODES, TUTORS, build_system_prompt

from pathlib import Path

templates = Jinja2Templates(directory=Path(__file__).resolve().parent.parent / "templates")
router = APIRouter()

CHAR_DIR = Path(__file__).resolve().parent.parent / "static" / "characters"


def _custom_rigs() -> dict:
    """A 'puppet' = artwork cut into pieces (body, arms, head) that move separately.
    Lives in static/characters/<tutor>/rig.json (see static/characters/README.txt)."""
    rigs = {}
    for key in TUTORS:
        f = CHAR_DIR / key / "rig.json"
        if not f.exists():
            continue
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
            w, h = d["size"]
            rigs[key] = {
                "ratio": f"{w} / {h}",
                "stand": bool(d.get("stand", True)),   # False = waist-up artwork: cut off by the bottom of the box
                "thumb": f"/static/characters/{key}/{d.get('thumb', 'full.png')}",
                "layers": [{"name": l["name"], "src": f"/static/characters/{key}/{l['src']}",
                            "origin": (f"{l['pivot'][0] / w * 100:.2f}% {l['pivot'][1] / h * 100:.2f}%"
                                       if "pivot" in l else "50% 100%")} for l in d["layers"]],
            }
        except (ValueError, KeyError, OSError):
            continue
    return rigs


def _custom_imgs() -> dict:
    """If you drop yuri.png / joohyuk.png into static/characters/, those images replace the drawn faces."""
    found = {k: r["thumb"] for k, r in _custom_rigs().items()}
    for key in TUTORS:
        if key in found:
            continue
        for ext in ("png", "webp", "jpg", "jpeg", "svg"):
            if (CHAR_DIR / f"{key}.{ext}").exists():
                found[key] = f"/static/characters/{key}.{ext}"
                break
    return found


# Typing "now you're a cafe waiter" switches to a custom role.
ROLE_PATTERN = re.compile(r"^\s*now\s+you(?:'re|\s+are)\s+(.{2,80}?)[.!]?\s*$", re.IGNORECASE)


# ----------------------------------------------------------------- pages
@router.get("/", response_class=HTMLResponse)
def home(request: Request):
    return templates.TemplateResponse(request, "index.html", {
        "tutors": TUTORS, "modes": MODES, "live": ai.is_live(), "imgs": _custom_imgs()})


@router.get("/chat/{conv_id}", response_class=HTMLResponse)
def chat_page(request: Request, conv_id: int):
    conv = _get_conversation(conv_id)
    return templates.TemplateResponse(request, "chat.html", {
        "conv": conv, "tutor": TUTORS[conv["tutor"]], "modes": MODES, "live": ai.is_live(),
        "img": _custom_imgs().get(conv["tutor"]), "rig": _custom_rigs().get(conv["tutor"])})


@router.get("/history", response_class=HTMLResponse)
def history_page(request: Request):
    with get_db() as db:
        rows = db.execute("""
            SELECT c.*, COUNT(m.id) AS count,
                   (SELECT korean FROM messages WHERE conversation_id = c.id
                    ORDER BY id DESC LIMIT 1) AS last_text
            FROM conversations c LEFT JOIN messages m ON m.conversation_id = c.id
            GROUP BY c.id ORDER BY c.id DESC""").fetchall()
    return templates.TemplateResponse(request, "history.html", {
        "items": rows, "tutors": TUTORS, "modes": MODES, "live": ai.is_live()})


# ------------------------------------------------------------------- API
class NewConversation(BaseModel):
    tutor: str
    mode: str = "teacher"
    custom_role: str | None = Field(default=None, max_length=80)


class NewMessage(BaseModel):
    text: str = Field(min_length=1, max_length=1000)


class ModeChange(BaseModel):
    mode: str
    custom_role: str | None = Field(default=None, max_length=80)


def _get_conversation(conv_id: int):
    with get_db() as db:
        conv = db.execute("SELECT * FROM conversations WHERE id = ?", (conv_id,)).fetchone()
    if conv is None:
        raise HTTPException(404, "Conversation not found")
    return conv


def _messages(conv_id: int) -> list[dict]:
    with get_db() as db:
        rows = db.execute("SELECT * FROM messages WHERE conversation_id = ? ORDER BY id", (conv_id,)).fetchall()
    return [dict(r) for r in rows]


def _tutor_reply(conv, history: list[dict]) -> dict:
    """Ask the AI for the next tutor message, save it, return it."""
    system = build_system_prompt(conv["tutor"], conv["mode"], conv["custom_role"])
    try:
        reply = ai.get_reply(system, history, conv["tutor"], conv["mode"], conv["custom_role"])
    except Exception as e:  # network down, bad key, etc.
        raise HTTPException(502, f"The AI tutor could not answer right now ({type(e).__name__}). "
                                 "Check your API key and internet, then try again.")
    with get_db() as db:
        cur = db.execute(
            "INSERT INTO messages (conversation_id, role, korean, burmese, tip) VALUES (?, 'tutor', ?, ?, ?)",
            (conv["id"], reply["korean"], reply["burmese"], reply["tip"]))
        row = db.execute("SELECT * FROM messages WHERE id = ?", (cur.lastrowid,)).fetchone()
        check = reply.get("check")                       # grammar check of the learner's last message
        if check and history and history[-1]["role"] == "user":
            db.execute("UPDATE messages SET check_score = ?, check_corrected = ?, check_note = ?, burmese = ? WHERE id = ?",
                       (check["score"], check["corrected"], check["note"], check.get("burmese", ""), history[-1]["id"]))
    return dict(row)


def _validate_mode(mode: str, custom_role: str | None) -> str | None:
    if mode not in MODES:
        raise HTTPException(400, "Unknown mode")
    role = (custom_role or "").strip() or None
    if mode == "custom" and not role:
        raise HTTPException(400, "Please type a role, e.g. cafe waiter")
    return role if mode == "custom" else None


@router.get("/api/tts")
async def speak(tutor: str, text: str):
    """Turn a sentence into natural Korean speech (MP3)."""
    text = text.strip()[:600]
    if tutor not in TUTORS or not text:
        raise HTTPException(400, "Bad request")
    try:
        path = await tts.synthesize(text, tutor)
    except Exception as e:
        raise HTTPException(503, f"Voice service unavailable ({type(e).__name__})")
    return FileResponse(path, media_type="audio/mpeg", headers={"Cache-Control": "public, max-age=86400"})


@router.get("/api/status")
def status():
    return {"live": ai.is_live()}


@router.post("/api/conversations")
def create_conversation(body: NewConversation):
    if body.tutor not in TUTORS:
        raise HTTPException(400, "Unknown tutor")
    role = _validate_mode(body.mode, body.custom_role)
    with get_db() as db:
        cur = db.execute("INSERT INTO conversations (tutor, mode, custom_role) VALUES (?, ?, ?)",
                         (body.tutor, body.mode, role))
        conv_id = cur.lastrowid
    _tutor_reply(_get_conversation(conv_id), [])  # the tutor says hello first
    return {"id": conv_id}


@router.get("/api/conversations/{conv_id}/messages")
def list_messages(conv_id: int):
    _get_conversation(conv_id)
    return _messages(conv_id)


@router.post("/api/conversations/{conv_id}/messages")
def send_message(conv_id: int, body: NewMessage):
    conv = _get_conversation(conv_id)
    text = body.text.strip()
    if not text:
        raise HTTPException(400, "Empty message")

    mode_changed = False
    match = ROLE_PATTERN.match(text)
    if match:  # "now you're a cafe waiter" -> switch to custom role
        with get_db() as db:
            db.execute("UPDATE conversations SET mode = 'custom', custom_role = ? WHERE id = ?",
                       (match.group(1), conv_id))
        conv = _get_conversation(conv_id)
        mode_changed = True

    with get_db() as db:
        cur = db.execute("INSERT INTO messages (conversation_id, role, korean) VALUES (?, 'user', ?)",
                         (conv_id, text))
        user_row = db.execute("SELECT * FROM messages WHERE id = ?", (cur.lastrowid,)).fetchone()
    reply = _tutor_reply(conv, _messages(conv_id))
    with get_db() as db:  # re-read the user's message: it now has its grammar check
        user_row = db.execute("SELECT * FROM messages WHERE id = ?", (user_row["id"],)).fetchone()
    return {"user": dict(user_row), "tutor": reply,
            "mode": conv["mode"], "custom_role": conv["custom_role"], "mode_changed": mode_changed}


@router.post("/api/conversations/{conv_id}/mode")
def change_mode(conv_id: int, body: ModeChange):
    _get_conversation(conv_id)
    role = _validate_mode(body.mode, body.custom_role)
    with get_db() as db:
        db.execute("UPDATE conversations SET mode = ?, custom_role = ? WHERE id = ?",
                   (body.mode, role, conv_id))
    return {"mode": body.mode, "custom_role": role}


@router.delete("/api/conversations/{conv_id}")
def delete_conversation(conv_id: int):
    _get_conversation(conv_id)
    with get_db() as db:
        db.execute("DELETE FROM conversations WHERE id = ?", (conv_id,))  # messages go too (CASCADE)
    return {"ok": True}
