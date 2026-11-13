"""Natural tutor voices (text -> MP3).

We use Microsoft's neural Korean voices through the free `edge-tts` package (no API key):
  * Yuri    -> ko-KR-SunHiNeural            (female)
  * Joohyuk -> ko-KR-HyunsuMultilingualNeural (male)
Every sentence is saved in data/tts_cache/, so a repeated sentence is instant and free.
Change a voice without touching code:  KTALKIE_VOICE_YURI=...  KTALKIE_VOICE_JOOHYUK=...
(other male choice: ko-KR-InJoonNeural)
"""
import asyncio
import hashlib
import os
from pathlib import Path

import edge_tts

VOICES = {
    "yuri": os.getenv("KTALKIE_VOICE_YURI", "ko-KR-SunHiNeural"),
    "joohyuk": os.getenv("KTALKIE_VOICE_JOOHYUK", "ko-KR-HyunsuMultilingualNeural"),
}
RATE = {"yuri": "-6%", "joohyuk": "-6%"}   # a little slower, easier for learners
CACHE_DIR = Path(__file__).resolve().parent.parent / "data" / "tts_cache"


async def synthesize(text: str, tutor: str) -> Path:
    voice, rate = VOICES[tutor], RATE[tutor]
    key = hashlib.sha1(f"{voice}|{rate}|{text}".encode("utf-8")).hexdigest()
    path = CACHE_DIR / f"{key}.mp3"
    if path.exists():
        return path
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    proxy = os.getenv("HTTPS_PROXY") or os.getenv("https_proxy")   # only set on networks that need one
    await asyncio.wait_for(edge_tts.Communicate(text, voice, rate=rate, proxy=proxy).save(str(tmp)), timeout=20)
    tmp.replace(path)
    return path
