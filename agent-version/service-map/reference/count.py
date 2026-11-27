# count.py — маркерный счёт по строкам разведчика (Шаг 3.1): файл счёта для plan.py без модели.
#
#   python3 count.py <scout.txt> <корень>[,<корень>…] <counts.txt>
#
# scout.txt — ответ разведчика дословно, по строке на строку (строку `префикс :: …` скрипт пропускает):
#   <класс> :: <регэксп> :: <glob> :: [<файл спеки> :: | в файлах с <регэксп> ::] ключ|ориентир
#   контроль :: <класс> :: <файл> :: <число>;  клиентская спека :: <файл>;  конфиг топиков :: <файл>
# Пишет <counts.txt> — на каждую строку маркеров заголовок `## <строка>`, под ним `<путь>:<число>` по файлам, где
# число — строк с совпадением (как Grep в режиме счёта); у строки спеки — одна строка `<спека>:<число>`, поиск только
# в ней. Строки контроля, клиентской спеки и конфига топиков — заголовком как есть, без строк под ним. Поле
# `в файлах с <регэксп>` — не поиск: строка считается как обычная, условие применяет plan.py.
# Строка дала ноль — повтор без glob, к заголовку ` (без маски)`; снова ноль — повтор без обратных слешей перед
# `(`, `)` и `|`, к заголовку ` (переэкранирован)`. Регэксп не разобран — ` (отказ)` и пусто. На месте регэкспа
# существующий файл по абсолютному пути (поля переставлены) — строка не ищется, к заголовку ` (не по форме)`.
# По каждой такой строке — строка в stdout, а у класса строки `ключ` в итоге — «(нижняя граница неполна)».
# Рядом с <counts.txt> — findings.tsv: `класс⇥вид⇥файл⇥строка⇥текст` по каждой строке с совпадением.
# stdout: `счёт: <counts.txt>; итог: <класс> N, …` — сумма строк `ключ` по классу; строкой ниже — «многострочная
# аннотация не поймана: <класс> N (первая: <файл>:<строка>)», если регэксп ждёт продолжения за концом строки, и
# «не прочитано N: <путь>», если файл или корень не открылся.
#
# Поиск — как у Grep (ripgrep): регэксп в синтаксисе ripgrep (`\w`, `\d`, `\s`, `\b` — Unicode), построчно, `\r`
# остаётся в строке; glob без `/` — имя файла на любой глубине, `**`, `{a,b}`, `!` — исключение. Скрытые файлы и
# папки ниже корня, бинарные файлы (с байтом NUL), папки `node_modules` и `__pycache__`, а в корне — `target`,
# `build`, `dist` не смотрятся. `.gitignore` не читается.
import sys

sys.dont_write_bytecode = True
import os
import re
import warnings

try:
    import keys as K
except ImportError:
    print("скилл установлен не целиком: нет %s/keys.py" % os.path.dirname(os.path.abspath(__file__)).replace("\\", "/"))
    sys.exit(2)

SKIP_ANY = ("node_modules", "__pycache__")
SKIP_TOP = ("target", "build", "dist")
TEXT_MAX = 500
UNREAD: list = []

# Классы POSIX в скобках (синтаксис ripgrep) — диапазонами ASCII.
POSIX = {
    "alnum": "0-9A-Za-z", "alpha": "A-Za-z", "ascii": "\\x00-\\x7F", "blank": "\\t ", "cntrl": "\\x00-\\x1F\\x7F",
    "digit": "0-9", "graph": "!-~", "lower": "a-z", "print": " -~", "punct": "!-/:-@\\[-`{-~",
    "space": "\\t\\n\\v\\f\\r ", "upper": "A-Z", "word": "0-9A-Za-z_", "xdigit": "0-9A-Fa-f",
}


def unread(p: str) -> None:
    if p not in UNREAD:
        UNREAD.append(p)


def rg_compile(p: str):
    """Регэксп ripgrep → `re` (Unicode). То, чего ripgrep не разбирает (look-around, обратные ссылки), — None."""
    out = []
    i = 0
    n = len(p)
    incls = False
    while i < n:
        ch = p[i]
        if ch == "\\":
            nx = p[i + 1:i + 2]
            if not incls and nx != "" and nx in "123456789":
                return None
            out.append("\\Z" if (not incls and nx == "z") else p[i:i + 2])
            i += 2
            continue
        if incls:
            if p.startswith("[:", i):
                j = p.find(":]", i + 2)
                if j > 0 and p[i + 2:j] in POSIX:
                    out.append(POSIX[p[i + 2:j]])
                    i = j + 2
                    continue
            if ch == "[":
                out.append("\\[")
                i += 1
                continue
            if ch == "]":
                incls = False
            out.append(ch)
            i += 1
            continue
        if ch == "[":
            incls = True
            out.append("[")
            i += 1
            if p[i:i + 1] == "^":
                out.append("^")
                i += 1
            if p[i:i + 1] == "]":
                out.append("\\]")
                i += 1
            continue
        if ch == "(" and p.startswith(("(?=", "(?!", "(?<=", "(?<!", "(?>", "(?P="), i):
            return None
        if ch == "(" and p.startswith("(?<", i):
            out.append("(?P<")
            i += 3
            continue
        out.append(ch)
        i += 1
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            return re.compile("".join(out))
    except (re.error, OverflowError, RecursionError, ValueError):
        return None


def glob_rx(g: str):
    """Один glob ripgrep → (регэксп, по пути от корня или по имени)."""
    anchored = g.startswith("/")
    g = g.lstrip("/")
    if g.endswith("/"):
        g = g.rstrip("/") + "/**"
    return re.compile("(?s:" + glob_body(g) + ")\\Z"), anchored or "/" in g


def glob_body(g: str) -> str:
    out = ""
    i = 0
    while i < len(g):
        ch = g[i]
        if g.startswith("**/", i):
            out += "(?:.*/)?"
            i += 3
            continue
        if g.startswith("**", i):
            out += ".*"
            i += 2
            continue
        if ch == "*":
            out += "[^/]*"
        elif ch == "?":
            out += "[^/]"
        elif ch == "\\" and i + 1 < len(g):
            out += re.escape(g[i + 1])
            i += 2
            continue
        elif ch == "{":
            j = g.find("}", i)
            if j < 0:
                out += re.escape(ch)
            else:
                out += "(?:" + "|".join(glob_body(a) for a in g[i + 1:j].split(",")) + ")"
                i = j + 1
                continue
        elif ch == "[":
            j = g.find("]", i + 2)
            if j < 0:
                out += re.escape(ch)
            else:
                body = g[i + 1:j]
                if body[:1] == "!":
                    body = "^" + body[1:]
                out += "[" + body.replace("\\", "\\\\") + "]"
                i = j + 1
                continue
        else:
            out += re.escape(ch)
        i += 1
    return out


def split_globs(s: str) -> list:
    """Поле glob: несколько масок через пробел или запятую (запятая внутри `{…}` — часть маски)."""
    out, cur, depth = [], "", 0
    for ch in s:
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth = max(0, depth - 1)
        if depth == 0 and (ch in " \t,"):
            if cur:
                out.append(cur)
            cur = ""
            continue
        cur += ch
    if cur:
        out.append(cur)
    return out


class Mask:
    def __init__(self, field: str):
        self.inc: list = []
        self.exc: list = []
        for g in split_globs(field.strip().strip("`")):
            if g.startswith("!"):
                self.exc.append(glob_rx(g[1:]))
            else:
                self.inc.append(glob_rx(g))

    def ok(self, rel: str) -> bool:
        name = rel.rsplit("/", 1)[-1]

        def hit(gs: list) -> bool:
            return any(rx.match(rel if bypath else name) for rx, bypath in gs)
        return (not self.inc or hit(self.inc)) and not hit(self.exc)


NOMASK = Mask("")


def walk(root: str) -> list:
    """Файлы корня: (путь, как его пишет счёт; путь от корня) — по имени в байтах, вглубь по порядку."""
    out: list = []
    base = root if root.endswith("/") else root + "/"

    def rec(rel: str) -> None:
        try:
            with os.scandir(K.fpath(base + rel)) as it:
                ents = list(it)
        except OSError:
            unread(base + rel)
            return
        ents.sort(key=lambda e: K.bkey(e.name))
        for e in ents:
            name = e.name
            if name.startswith("."):
                continue
            try:
                isdir = e.is_dir(follow_symlinks=False)
                isreg = (not isdir) and e.is_file(follow_symlinks=False)
            except OSError:
                continue
            if isdir:
                if name in SKIP_ANY or (rel == "" and name in SKIP_TOP):
                    continue
                rec(rel + name + "/")
            elif isreg:
                out.append((base + rel + name, rel + name))

    rec("")
    return out


def read_code(p: str):
    """Строки файла, как их видит ripgrep: BOM UTF-8 снят, UTF-16 по BOM перекодирован, `\\r` остаётся; файл с байтом
    NUL — бинарный, None. Не открылся — None и строка «не прочитано»."""
    try:
        b = K.read_bytes(p)
    except OSError:
        unread(p)
        return None
    if b.startswith(b"\xff\xfe") or b.startswith(b"\xfe\xff"):
        return K.lines_of(b.decode("utf-16", "replace"))
    if b"\x00" in b:
        return None
    if b.startswith(b"\xef\xbb\xbf"):
        b = b[3:]
    return K.lines_of(b.decode("utf-8", K.ERR))


class Line:
    """Строка маркеров разведчика и её счёт."""

    def __init__(self, raw: str, f: list):
        self.raw = raw
        self.cls = f[0].strip()
        self.kind = f[-1].strip()
        self.re = f[1].strip()
        if len(self.re) > 1 and self.re.startswith("`") and self.re.endswith("`"):
            self.re = self.re[1:-1]
        self.mask = Mask(f[2])
        self.spec = ""
        if len(f) >= 5 and not re.match(r"[ \t]*в файлах с[ \t]", f[-2]):
            self.spec = f[-2].strip().strip("`\"'")
        self.suffix = ""
        self.hits: list = []       # (путь, число, [(номер строки, текст)])
        self.multi: list = []      # (путь, номер строки) — регэксп ждёт продолжения за концом строки


def search(lines: list, files: list, use_mask: bool, rxs: dict) -> dict:
    """Один проход по файлам для всех строк: строка → (попадания, многострочные)."""
    res = {ln: ([], []) for ln in lines}
    for full, rel in files:
        todo = [ln for ln in lines if (ln.mask if use_mask else NOMASK).ok(rel)]
        if not todo:
            continue
        text = read_code(full)
        if not text:
            continue
        for ln in todo:
            rx = rxs[ln]
            got = []
            multi = []
            for no, s in enumerate(text, 1):
                if rx.search(s):
                    got.append((no, s))
                elif not s.endswith("\r") and rx.search(s + "\r"):
                    multi.append(no)
            if got:
                res[ln][0].append((full, len(got), got))
            for no in multi:
                res[ln][1].append((full, no))
    return res


def search_spec(ln: Line, rx) -> tuple:
    text = read_code(ln.spec)
    got, multi = [], []
    for no, s in enumerate(text or [], 1):
        if rx.search(s):
            got.append((no, s))
        elif not s.endswith("\r") and rx.search(s + "\r"):
            multi.append((ln.spec, no))
    return ([(ln.spec, len(got), got)] if got else []), multi


def run_attempt(lines: list, files: list, use_mask: bool, rxs: dict) -> None:
    """Попытка счёта для строк с нулём: дала больше нуля — её результат строке."""
    plain = [ln for ln in lines if not ln.spec]
    res = search(plain, files, use_mask, rxs) if plain else {}
    for ln in lines:
        hits, multi = search_spec(ln, rxs[ln]) if ln.spec else res[ln]
        if not ln.multi and not ln.hits:
            ln.multi = multi
        if hits:
            ln.hits = hits
            ln.multi = multi


def tsv_text(s: str) -> str:
    s = s.rstrip("\r").replace("\t", " ").strip()
    return s if len(s) <= TEXT_MAX else s[:TEXT_MAX] + "…"


def main() -> int:
    c = K.start()
    for i, what in enumerate(("scout.txt", "корни через запятую", "counts.txt")):
        if c.arg(i) == "":
            sys.stderr.write("count.py: %d: %s\n" % (i + 1, what))
            return 1
    scout, roots_arg, counts = c.arg(0), c.arg(1), c.arg(2)
    if not K.is_file(scout):
        print("НЕТ ФАЙЛА: " + scout)
        return 2
    roots = [r.strip() for r in roots_arg.split(",") if r.strip() != ""]

    items: list = []      # заголовок как есть (str) либо Line
    for raw in K.read_lines(scout):
        s = raw.strip()
        if " :: " not in s or re.match(r"префикс[ \t]*::", s):
            continue
        f = s.split(" :: ")
        if len(f) >= 4 and re.match(r"(ключ|ориентир)\Z", f[-1].strip()):
            items.append(Line(s, f))
        else:
            items.append(s)
    lines = [x for x in items if isinstance(x, Line)]
    # На месте регэкспа — существующий файл по абсолютному пути (поля переставлены): строка не по форме, не ищется.
    for ln in lines:
        p = ln.re.strip("`\"'")
        if re.match(r"(?:/|[A-Za-z]:[\\/])", p) and K.is_file(p):
            ln.suffix = " (не по форме)"
    lines_ok = [ln for ln in lines if not ln.suffix]

    files: list = []
    if any(not ln.spec for ln in lines_ok):
        for r in roots:
            if K.is_dir(r):
                files.extend(walk(r))
            else:
                unread(r)

    rx0 = {}
    for ln in lines_ok:
        rx = rg_compile(ln.re)
        if rx is None:
            ln.suffix = " (отказ)"
        else:
            rx0[ln] = rx
    live = [ln for ln in lines if ln in rx0]
    run_attempt(live, files, True, rx0)
    # Ноль — без маски (у спеки область та же, повтор не нужен).
    zero = [ln for ln in live if not ln.hits and not ln.spec]
    run_attempt(zero, files, False, rx0)
    for ln in zero:
        if ln.hits:
            ln.suffix = " (без маски)"
    # Снова ноль — без обратных слешей перед `(`, `)` и `|`; поиск — как в последней попытке.
    rx1 = {}
    for ln in live:
        if ln.hits:
            continue
        r2 = re.sub(r"\\([()|])", r"\1", ln.re)
        rx = rg_compile(r2) if r2 != ln.re else None
        if rx is not None:
            rx1[ln] = rx
    again = list(rx1)
    run_attempt(again, files, False, rx1)
    for ln in again:
        if ln.hits:
            ln.suffix = " (переэкранирован)"

    out: list = []
    found: list = []
    for x in items:
        if isinstance(x, str):
            out.append("## " + x + "\n")
            continue
        out.append("## " + x.raw + x.suffix + "\n")
        for full, n, got in x.hits:
            out.append("%s:%d\n" % (full, n))
            for no, s in got:
                found.append("%s\t%s\t%s\t%d\t%s\n" % (x.cls, x.kind, full, no, tsv_text(s)))
    try:
        d = os.path.dirname(counts)
        if d:
            os.makedirs(K.fpath(d), exist_ok=True)
        K.write_text(counts, "".join(out))
        K.write_text((d + "/" if d else "") + "findings.tsv", "".join(found))
    except OSError:
        print("счёт не записан: " + counts)
        return 2

    # Строка ключа не по форме, без маски, переэкранирована или с отказом грепа — счёт класса мог быть занижен.
    tot: dict = {}
    part: dict = {}
    for ln in lines:
        if ln.kind == "ключ":
            tot[ln.cls] = tot.get(ln.cls, 0) + sum(h[1] for h in ln.hits)
            if ln.suffix:
                part[ln.cls] = 1
    print("счёт: %s; итог: %s" % (counts, ", ".join("%s %d%s" % (k, v, " (нижняя граница неполна)" if k in part else "")
                                                   for k, v in tot.items()) if tot else "нет"))
    mt: dict = {}
    for ln in lines:
        if ln.multi:
            m = mt.setdefault(ln.cls, [0, ln.multi[0]])
            m[0] += len(ln.multi)
    for k, (n, first) in mt.items():
        print("многострочная аннотация не поймана: %s %d (первая: %s:%d)" % (k, n, first[0], first[1]))
    # Строки в отчёт (3.1): ведущий файл счёта не читает — повторы и отказ грепа видит только здесь.
    say = {" (без маски)": "маска разведчика не сработала", " (переэкранирован)": "регэксп разведчика переэкранирован",
           " (отказ)": "греп отказал", " (не по форме)": "строка разведчика не по форме, на месте регэкспа файл"}
    for ln in lines:
        if ln.suffix in say:
            print("%s: %s" % (say[ln.suffix], ln.raw.strip()))
    if UNREAD:
        print("не прочитано %d: %s" % (len(UNREAD), UNREAD[0]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
