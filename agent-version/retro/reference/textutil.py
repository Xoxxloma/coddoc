"""textutil — строки журнала для ретро: одна строка, обрезка и маска секретов (копия правил session-quality: скиллы
ставятся порознь и друг друга не импортируют)."""

from __future__ import annotations

import re

KEYED_SECRET_RE = re.compile(
    r"\b(пароль|password|passwd|pwd|token|токен|secret|секрет|api[_-]?key)(\s+от\s+\S+)?(\s*[:=]\s*|\s+)(?=\S*\d)(\S+)",
    re.IGNORECASE)
KEYED_WORDS_RE = re.compile(  # «токен для гита: …» — между словом и значением пара слов и двоеточие
    r"\b(пароль|password|passwd|pwd|token|токен|secret|секрет|api[_-]?key)([^\n:=]{1,30}?)(\s*[:=]\s*)(?=\S*\d)(\S+)",
    re.IGNORECASE)
TOKEN_RE = re.compile(  # токены узнаются по форме, без ключевого слова рядом
    r"\b(?:ghp|gho|ghu|ghs|glpat|xox[abpr])[-_][A-Za-z0-9_-]{16,}|\bAKIA[0-9A-Z]{16}\b"
    r"|\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}")
BEARER_RE = re.compile(r"\b(bearer)\s+[A-Za-z0-9._~+/=-]{10,}", re.IGNORECASE)
PRIVATE_KEY_RE = re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")
CARD_RE = re.compile(r"(?<!\d)(?:\d ?){12,18}\d(?!\d)")
PHONE_RE = re.compile(r"(?<!\d)(?:\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}(?!\d)")
EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
SNILS_RE = re.compile(r"(?<!\d)\d{3}-\d{3}-\d{3}[ -]\d{2}(?!\d)")
LONG_DIGITS_RE = re.compile(r"(?<![\d.])\d{7,}(?![\d.])")


def one_line(text):
    return re.sub(r"\s+", " ", text).strip()


def clip(text, limit):
    text = one_line(text)
    return text if len(text) <= limit else text[:limit].rstrip() + "…"


def clip_middle(text, head, tail):
    """Длинный текст — начало и конец: вопрос агента обычно в конце сообщения."""
    text = one_line(text)
    if len(text) <= head + tail:
        return text
    return f"{text[:head].rstrip()} … {text[-tail:].lstrip()}"


def luhn(digits):
    total = 0
    for index, char in enumerate(reversed(digits)):
        number = int(char)
        if index % 2:
            number = number * 2 - 9 if number > 4 else number * 2
        total += number
    return total % 10 == 0


def is_card(match):
    digits = re.sub(r"\D", "", match.group(0))
    return 13 <= len(digits) <= 19 and luhn(digits)


def mask(text):
    text = TOKEN_RE.sub("****", text)
    text = KEYED_SECRET_RE.sub(lambda m: m.group(1) + (m.group(2) or "") + m.group(3) + "****", text)
    text = KEYED_WORDS_RE.sub(lambda m: m.group(1) + m.group(2) + m.group(3) + "****", text)
    text = BEARER_RE.sub(r"\1 ****", text)
    text = PRIVATE_KEY_RE.sub("-----BEGIN **** KEY-----", text)
    text = CARD_RE.sub(lambda m: "****" if is_card(m) else m.group(0), text)
    text = PHONE_RE.sub("****", text)
    text = EMAIL_RE.sub("***@***", text)
    text = SNILS_RE.sub("****", text)
    return LONG_DIGITS_RE.sub("****", text)
