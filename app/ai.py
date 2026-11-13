"""The ONLY file that talks to the AI.

Two modes:
  * LIVE: ANTHROPIC_API_KEY is set in .env -> real Claude replies.
  * DEMO: no key -> scripted replies, so you can try the whole app for free.
"""
import json
import os

from dotenv import load_dotenv

load_dotenv()

MODEL = os.getenv("KTALKIE_MODEL", "claude-sonnet-5-5")
START_MESSAGE = "(대화를 시작해 주세요. 짧게 인사하고 질문을 하나 해 주세요.)"


def is_live() -> bool:
    return bool(os.getenv("ANTHROPIC_API_KEY"))


def get_reply(system: str, history: list[dict], tutor: str, mode: str, custom_role: str | None) -> dict:
    """history = [{'role': 'user'|'tutor', 'korean', 'burmese', 'tip'}, ...] oldest first.
    Returns {'korean', 'burmese', 'tip'}."""
    if not is_live():
        reply = _demo_reply(history, tutor, mode, custom_role)
        if history and history[-1]["role"] == "user":
            from .grammar import demo_check
            reply["check"] = demo_check(history[-1]["korean"], mode)
        return reply
    return _live_reply(system, history)


# ---------------------------------------------------------------- live
def _live_reply(system: str, history: list[dict]) -> dict:
    import anthropic

    # Claude wants the chat to start with a 'user' message, so we add a hidden one.
    messages = [{"role": "user", "content": START_MESSAGE}]
    for m in history[-20:]:  # only the last 20 messages: cheaper and faster
        if m["role"] == "user":
            messages.append({"role": "user", "content": m["korean"]})
        else:
            messages.append({"role": "assistant", "content": json.dumps(
                {"korean": m["korean"], "burmese": m["burmese"], "tip": m["tip"]}, ensure_ascii=False)})

    client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY from the environment
    resp = client.messages.create(model=MODEL, max_tokens=900, system=system, messages=messages)
    return _parse(resp.content[0].text)


def _parse(text: str) -> dict:
    """The AI should return JSON. If it adds extra words, cut out the {...} part."""
    try:
        data = json.loads(text[text.index("{"): text.rindex("}") + 1])
        reply = {"korean": str(data.get("korean", "")).strip(),
                 "burmese": str(data.get("burmese", "")).strip(),
                 "tip": str(data.get("tip", "")).strip()}
        c = data.get("check")
        if isinstance(c, dict):
            try:
                score = max(0, min(100, int(c.get("score"))))
            except (TypeError, ValueError):
                score = None
            if score is not None:
                reply["check"] = {"score": score, "corrected": str(c.get("corrected") or "").strip(),
                                  "note": str(c.get("note") or "").strip(),
                                  "burmese": str(c.get("burmese") or "").strip()}
        return reply
    except (ValueError, AttributeError):
        return {"korean": text.strip(), "burmese": "", "tip": ""}


# ---------------------------------------------------------------- demo
DEMO = {
    ("yuri", "teacher"): [
        ("안녕하세요! 저는 유리예요. 만나서 반갑습니다. 이름이 뭐예요?",
         "မင်္ဂလာပါ! ကျွန်မက ယူရီပါ။ တွေ့ရတာ ဝမ်းသာပါတယ်။ နာမည် ဘယ်လိုခေါ်ပါသလဲ။", ""),
        ("좋아요! 한국어를 얼마나 공부했어요?",
         "ကောင်းပါတယ်! ကိုရီးယားစာ ဘယ်လောက်ကြာ သင်ခဲ့ပြီလဲ။",
         "💡 '-아요/어요' ကို ယဉ်ကျေးစွာ ပြောတဲ့အခါ သုံးပါတယ်။ ဥပမာ - 공부해요 (လေ့လာတယ်)၊ 가요 (သွားတယ်)။"),
        ("와, 대단해요! 한국어에서 뭐가 제일 어려워요?",
         "ဝိုး၊ တော်လိုက်တာ! ကိုရီးယားစာမှာ ဘာက အခက်ဆုံးလဲ။", ""),
        ("그렇군요. 천천히 같이 연습해요. 오늘은 무엇을 하고 싶어요?",
         "ဟုတ်ကဲ့။ ဖြည်းဖြည်းချင်း အတူတူ လေ့ကျင့်ကြရအောင်။ ဒီနေ့ ဘာလုပ်ချင်လဲ။", ""),
    ],
    ("joohyuk", "teacher"): [
        ("안녕하세요! 저는 주혁이에요. 오늘 기분이 어때요?",
         "မင်္ဂလာပါ! ကျွန်တော်က ဂျူးဟျောက်ပါ။ ဒီနေ့ စိတ်ခံစားမှု ဘယ်လိုလဲ။", ""),
        ("좋네요! 오늘 뭐 했어요?",
         "ကောင်းလိုက်တာ! ဒီနေ့ ဘာလုပ်ခဲ့လဲ။",
         "💡 '뭐' က '무엇' ရဲ့ အတိုကောက်ပါ၊ ပြောတဲ့အခါ အများကြီး သုံးပါတယ်။"),
        ("재미있겠어요! 한국 음식 좋아해요?",
         "စိတ်ဝင်စားစရာကောင်းမယ်! ကိုရီးယားအစားအစာ ကြိုက်လား။", ""),
        ("저도 김치찌개를 좋아해요. 같이 연습해 봐요!",
         "ကျွန်တော်လည်း ကင်ချီကျီဂဲ ကြိုက်ပါတယ်။ အတူတူ လေ့ကျင့်ကြည့်ရအောင်!", ""),
    ],
    ("yuri", "friend"): [
        ("안녕! 나 유리야. 너 이름이 뭐야?",
         "ဟိုင်း! ငါ ယူရီ။ နင့်နာမည် ဘာလဲ။", ""),
        ("오, 좋다! 한국어 공부한 지 얼마나 됐어?",
         "အို၊ ကောင်းတယ်! ကိုရီးယားစာ လေ့လာတာ ဘယ်လောက်ကြာပြီလဲ။",
         "💡 သူငယ်ချင်းချင်း ပြောရင် '-야/-어' (반말) ကို သုံးတယ်။ ဥပမာ - 뭐 해? (ဘာလုပ်နေလဲ)။"),
        ("대박! 잘하네. 뭐가 제일 어려워?",
         "တယ်ကောင်းတာပဲ! ဘာက အခက်ဆုံးလဲ။", ""),
        ("나도 그랬어. 같이 천천히 해 보자! 오늘 뭐 하고 싶어?",
         "ငါလည်း အဲလိုပဲ။ အတူတူ ဖြည်းဖြည်း လုပ်ကြည့်ကြရအောင်! ဒီနေ့ ဘာလုပ်ချင်လဲ။", ""),
    ],
    ("joohyuk", "friend"): [
        ("야, 안녕! 나는 주혁이야. 오늘 뭐 했어?",
         "ဟေ့၊ ဟိုင်း! ငါက ဂျူးဟျောက်။ ဒီနေ့ ဘာလုပ်ခဲ့လဲ။", ""),
        ("오, 재밌겠다! 밥은 먹었어?",
         "အို၊ ပျော်စရာကောင်းမယ်! ထမင်းစားပြီးပြီလား။",
         "💡 '밥 먹었어?' ဆိုတာ ကိုရီးယားမှာ 'နေကောင်းလား' ဆိုတဲ့ အဓိပ္ပာယ်နဲ့လည်း ပြောတတ်ကြတယ်။"),
        ("맛있겠다! 나는 치킨 좋아해. 너는?",
         "စားလို့ကောင်းမယ်! ငါက ကြက်ကြော်ကြိုက်တယ်။ နင်ကရော။", ""),
        ("ㅋㅋ 좋아! 다음에 같이 먹자.",
         "ဟားဟား ကောင်းတယ်! နောက်ကျရင် အတူတူ စားကြမယ်။", ""),
    ],
}


def _demo_reply(history, tutor, mode, custom_role) -> dict:
    n = sum(1 for m in history if m["role"] == "tutor")  # how many tutor messages so far
    if mode == "custom":
        role = custom_role or "…"
        ko = ("좋아요! 이제 역할극을 시작해요. 준비됐어요?" if n == 0
              else "네, 알겠어요. 계속 이야기해 볼까요?")
        my = ("ကောင်းပါပြီ! အခု အခန်းကဏ္ဍသရုပ်ဆောင်ကြည့်ရအောင်။ အဆင်သင့်ဖြစ်ပြီလား။" if n == 0
              else "ဟုတ်ပြီ၊ ဆက်ပြောကြည့်ရအောင်။")
        tip = f"💡 Demo mode: AI အစစ်က \"{role}\" အဖြစ် သရုပ်ဆောင်ပါလိမ့်မယ်။" if n == 0 else ""
        return {"korean": ko, "burmese": my, "tip": tip}
    script = DEMO[(tutor, mode)]
    ko, my, tip = script[n % len(script)]
    return {"korean": ko, "burmese": my, "tip": tip}
