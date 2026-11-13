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
        return {"score": 0, "corrected": "",
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
        return {"score": 100, "corrected": "", "note": ""}
    return {"score": max(55, 100 - 15 * len(notes)), "corrected": corrected, "note": " ".join(notes)}
