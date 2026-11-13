"""A tiny rule-based Korean grammar checker used in DEMO mode.

With an API key the AI tutor checks your grammar itself (much smarter).
These rules exist so the grammar feature can be seen without a key, and they
also teach real Korean rules:
  1. Particles 은/는, 이/가, 을/를 depend on whether the word ends in a consonant (받침).
  2. 저가 -> 제가 ("I" as the subject).
  3. With a teacher you should use polite endings (-요).
  4. Common spelling slips.
"""
import re

HANGUL = re.compile(r"[가-힣]")
NOUNS = ["한국어", "한국", "학생", "친구", "선생님", "커피", "김치", "음식", "물", "밥", "학교", "집",
         "사람", "영화", "책", "이름", "미얀마", "음악", "사과", "카페", "저", "나", "너"]
TYPOS = {"안녕하세여": "안녕하세요", "괜찬아요": "괜찮아요", "감사함니다": "감사합니다",
         "고맙슴니다": "고맙습니다", "잘지내요": "잘 지내요"}
PRESENT_CASUAL = {"먹어", "좋아", "있어", "없어", "알아", "몰라", "싫어", "괜찮아", "재밌어", "맛있어", "바빠", "예뻐"}


# present -> past for common verbs (used when the sentence has a past-time word like 어제)
PAST = {"만나": "만났", "가": "갔", "와": "왔", "먹어": "먹었", "마셔": "마셨", "봐": "봤", "해": "했", "사": "샀",
        "자": "잤", "놀아": "놀았", "읽어": "읽었", "써": "썼", "있어": "있었", "배워": "배웠", "보내": "보냈",
        "만들어": "만들었", "들어": "들었", "일해": "일했", "공부해": "공부했", "운동해": "운동했", "요리해": "요리했"}
PAST_WORDS = ("어제", "지난주", "지난달", "작년", "아까")


def _to_past(word: str):
    """'만나요' -> '만났어요', '가' -> '갔어'. Returns None if we don't know the verb."""
    polite = word.endswith("요")
    stem = word[:-1] if polite else word
    past = PAST.get(stem)
    if past is None and stem.endswith("해"):
        past = stem[:-1] + "했"
    return None if past is None else past + ("어요" if polite else "어")


PHRASEBOOK = {  # demo mode only: with an API key the AI translates anything you say
    "안녕하세요": "မင်္ဂလာပါ။",
    "감사합니다": "ကျေးဇူးတင်ပါတယ်။",
    "저는 학생이에요": "ကျွန်တော်/ကျွန်မ ကျောင်းသား/ကျောင်းသူ ပါ။",
    "저는 민이에요": "ကျွန်တော်/ကျွန်မ နာမည် မင်း ပါ။",
    "어제 친구를 만났어요": "မနေ့က သူငယ်ချင်းနဲ့ တွေ့ခဲ့တယ်။",
    "어제 영화를 봤어요": "မနေ့က ရုပ်ရှင်ကြည့်ခဲ့တယ်။",
    "나는 커피를 좋아해요": "ငါ ကော်ဖီကြိုက်တယ်။",
    "저는 커피를 좋아해요": "ကျွန်တော်/ကျွန်မ ကော်ဖီ ကြိုက်ပါတယ်။",
    "저는 한국어를 공부해요": "ကျွန်တော်/ကျွန်မ ကိုရီးယားစာ လေ့လာနေပါတယ်။",
    "저는 미얀마 사람이에요": "ကျွန်တော်/ကျွန်မ မြန်မာလူမျိုး ပါ။",
    "한국 음식을 좋아해요": "ကိုရီးယားအစားအစာ ကြိုက်ပါတယ်။",
    "김치를 좋아해요": "ကင်ချီ ကြိုက်ပါတယ်။",
    "잘 지내요": "နေကောင်းပါတယ်။",
}


def _translate(sentence: str) -> str:
    return PHRASEBOOK.get(re.sub(r"[.!?]+$", "", sentence.strip()), "")


def has_batchim(ch: str) -> bool:
    """True if the Korean syllable ends with a consonant (받침)."""
    code = ord(ch) - 0xAC00
    return 0 <= code <= 11171 and code % 28 != 0


NOUNS_ENDING_HAE = {"올해", "새해", "지난해", "작년해"}


def _casual_ending(word: str) -> bool:
    """True for casual (반말) verb endings like 먹어, 봤어, 좋아해 that need -요 with a teacher."""
    if word in PRESENT_CASUAL:
        return True
    if len(word) >= 2 and word.endswith("어") and (ord(word[-2]) - 0xAC00) % 28 == 20:   # past: 았어/었어/봤어/갔어
        return True
    return len(word) >= 3 and word.endswith("해") and word not in NOUNS_ENDING_HAE        # 좋아해, 공부해


PARTICLES = {"은": ("은", "는"), "는": ("은", "는"), "이": ("이", "가"), "가": ("이", "가"),
             "을": ("을", "를"), "를": ("을", "를")}


def demo_check(text: str, mode: str) -> dict:
    if not HANGUL.search(text):
        return {"score": 0, "corrected": "", "burmese": "",
                "note": "ကိုရီးယားလို ပြောကြည့်ပါ! ဗမာလို/အင်္ဂလိပ်လို မဟုတ်ဘဲ ကိုရီးယားစကားနဲ့ ဖြေပါ။"}
    notes, corrected = [], text

    for wrong, right in TYPOS.items():
        if wrong in corrected:
            corrected = corrected.replace(wrong, right)
            notes.append(f"စာလုံးပေါင်း - '{wrong}' မဟုတ်ဘဲ '{right}' လို့ ရေးပါတယ်။")

    if re.search(r"(?<![가-힣])저가(?![가-힣])", corrected):
        corrected = re.sub(r"(?<![가-힣])저가(?![가-힣])", "제가", corrected)
        notes.append("'저' + '가' မသုံးပါ။ 'ကျွန်တော်/ကျွန်မ' ကို subject အဖြစ်ပြောရင် '제가' လို့ သုံးပါတယ်။")

    def fix_particle(m):
        stem, part = m.group(1), m.group(2)
        want = PARTICLES[part][1 if not has_batchim(stem[-1]) else 0]
        if want != part:
            notes.append(f"'{stem}' ရဲ့နောက်မှာ '{want}' သုံးရပါမယ် (받침 {'ရှိ' if has_batchim(stem[-1]) else 'မရှိ'}လို့ပါ)။")
        return stem + want
    pattern = r"(?<![가-힣])(" + "|".join(sorted(NOUNS, key=len, reverse=True)) + r")(은|는|이|가|을|를)(?![가-힣])"
    corrected = re.sub(pattern, fix_particle, corrected)

    if any(w in corrected for w in PAST_WORDS):          # 어제 + present tense is a classic mistake
        words = corrected.rstrip(" .!?").split(" ")
        fixed = _to_past(words[-1]) if words else None
        if fixed:
            tail = corrected[len(corrected.rstrip(" .!?")):]
            corrected = " ".join(words[:-1] + [fixed]) + tail
            notes.append("'어제' (မနေ့က) လိုမျိုး အတိတ်ကို ပြောရင် ကြိယာကို အတိတ် '-았/었어요' ပုံစံ သုံးပါ။ (만나요 → 만났어요)")

    if mode == "teacher":
        words = corrected.rstrip(" .!?").split(" ")
        last = words[-1] if words else ""
        new = None
        if last.endswith("이야"):
            new = last[:-2] + "이에요"
        elif _casual_ending(last):
            new = last + "요"
        if new and new != last:
            tail = corrected[len(corrected.rstrip(" .!?")):]
            corrected = " ".join(words[:-1] + [new]) + tail
            notes.append("ဆရာနဲ့ ပြောရင် ယဉ်ကျေးတဲ့ '-요' ပုံစံ သုံးပါ (반말 မဟုတ်ဘဲ 존댓말)။")

    if not notes:
        return {"score": 100, "corrected": "", "note": "", "burmese": _translate(text)}
    return {"score": max(55, 100 - 15 * len(notes)), "corrected": corrected, "note": " ".join(notes),
            "burmese": _translate(corrected)}
