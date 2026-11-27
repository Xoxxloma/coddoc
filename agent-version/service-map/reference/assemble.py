# assemble.py — склейка карточки из файлов частей, без модели.
#
#   python3 assemble.py <папка частей> <S> <дата> <черновик-выход> <опись-выход>
#
# В папке: head.md (каркас карточки по шаблону: шапка, секции головы, в ключевых секциях — строка
# `<!-- части -->`), part-01.md … part-<S>.md и part-NN.opis.md, при желании head.opis.md и plan.tsv
# (план plan.py). Первая строка каждого файла — `<!-- service-map: <голова|часть NN> <дата> -->`; номер
# части сверяется числом (`часть 1` и `часть 01` — одна часть); файла нет, номер или дата чужие — отказ,
# ничего не пишется. В каждой секции с `<!-- части -->` блоки `###` и строки таблиц всех частей сливаются;
# сортировка по ключу (контракт — по пути, затем по глаголу; «События» — потребляет, затем публикует;
# «Бизнес-правила» — объекты, сообщения, ограничения); заглушки частей (`—`, `не определено…`) остаются,
# только если блоков нет ни у одной части. Опись — списки частей подряд, итоги `⟹` суммируются.
# Ключ — по шаблону (keys.py, общий с check.py): заголовок блока в контракте, «Событиях», задачах и
# данных пишется ключом — без строки запроса, аргументов операции, слов вокруг топика в бэктиках; два
# написания одного ключа дают один блок. Заголовок, который к ключу не сводится, — как есть, строкой
# «ключ не опознан». Ключ контракта, записанный вызовом (`Dome.Close(Req)`), — тот же ключ, что без
# скобок, если у другой части он стоит без скобок: один блок. Ключи сравниваются через k_key: параметр пути в
# любой записи — один параметр. Блоки разных частей сливаются, только если совпал и k_keyn (`:id` = `{id}`, но
# `{ids}` и `{userId}` — два блока); у одной части разные записи одного пути — два блока; не слитые — строкой вывода.
# Заголовок слитого блока — как его написал автор блока, который остаётся.
# Дубль ключа — блок части-владельца по источнику ключа в описях частей (куски через « + »): первый кусок,
# который план разметил (строка «файл»), иначе первый, который план отдал части, — у операции ненарезанной
# спецификации это обработчик. Из других блоков дописываются строки `— ` и поля «Владеет данными» с именами, которых у
# владельца нет; прочие строки `- ` отбрасываются. Владельца нет — плана нет, у ключа нет источника, файл у
# нескольких частей, у владельца нет блока — блоки объединяются: заголовок, назначение и `сущности:`
# первого, строки `- ` и `— ` всех без повторов; строка в выводе называет причину.
# У частей есть блоки в секции, которой в каркасе головы нет или в ней нет метки, — отказ с именем
# виновного: молча блоки не выбрасываются. Блоки до первого заголовка секции (часть его не написала) идут
# в секцию контракта или «Событий» по форме ключа, иначе отбрасываются строкой вывода. Секцию, которую пишет голова («Зависит от», «Роли и доступ»,
# «Бизнес-правила»), у части отбрасывает со строкой в выводе.
# Строки-метки «Событий» (`- тело:`, `- ключ:`, `- когда:` …) у дубля: метки, которой у владельца нет, —
# дописываются; «не определено» владельца заменяется значением другой части. Строки привязки (`доступ:`,
# `меняет:`, `шлёт:`) — в блоке, хвост « — файл» снимается, `меняет: нет` и `шлёт: нет` в карточку не идут.
#
# Порт assemble.sh 1:1: те же stdout, файлы и код выхода. Шаги и их номера — как в assemble.sh; промежуточные
# файлы bash (rec, src, merged …) — списки строк в памяти, в том же виде.
import sys

sys.dont_write_bytecode = True
import itertools
import math
import os
import platform
import re

try:
    import keys as K
except ImportError:
    try:
        sys.stdout.reconfigure(encoding="utf-8", newline="\n")
    except (AttributeError, ValueError, OSError):
        pass
    print("ОТКАЗ: нет %s/keys.py — скилл установлен не целиком" % (os.path.dirname(sys.argv[0]).replace("\\", "/") or "."))
    sys.exit(3)

SS = "\x1c"                      # SUBSEP awk
MARK = "<!-- части -->"
HTTPRE = r"^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\Z"
TAILRE = (r" — `?[A-Za-z0-9_./-]+\.(java|kts?|tsx?|jsx?|mjs|py|go|rb|php|cs|ya?ml|json|xml|sql|properties|graphqls?|proto)`?"
          r"( \+ `?[A-Za-z0-9_./-]+`?)*[ \t]*\Z")
SLOTRE = "^- (тело|ключ|когда|гарантия|не шлётся|читает|группа|подтверждение|повтор|ошибка):"
NDEF = r"^- [^:]+:[ \t]*не определено"
# `uname -s` у bash: под Git Bash — MINGW…; Python на Windows — та же ветка (пути `/c/…` → `C:/…`).
UNAME = "MINGW" if os.name == "nt" else platform.system()


def fail(msg: str) -> None:
    print("ОТКАЗ: " + msg)
    sys.exit(3)


def oserr(e: OSError) -> str:
    """Текст ошибки, как у bash и awk: папка на месте файла — «Is a directory» (Windows даёт «Permission denied»)."""
    if isinstance(e.filename, str) and os.path.isdir(e.filename):
        return "Is a directory"
    return e.strerror or str(e)


def fld(f: list, i: int) -> str:
    """$(i+1) awk: поле за NF — пустое."""
    return f[i] if i < len(f) else ""


# ---------------------------------------------------------------------------------------------------------------
# Числа и сравнения awk.

_NUM = re.compile(r"[ \t\n\r\f\v]*([-+]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][-+]?[0-9]+)?)")
_STRNUM = re.compile(r"[ \t\n\r\f\v]*[-+]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][-+]?[0-9]+)?[ \t\n\r\f\v]*\Z")


def anum(s: str) -> float:
    """Строка → число, как `s + 0` в awk: числовой префикс, иначе 0."""
    m = _NUM.match(s)
    return float(m.group(1)) if m else 0.0


def astr(x: float) -> str:
    """Число → строка, как у gawk: целое в пределах long — без точки, иначе %.6g."""
    if x == x and -9.223372036854776e18 < x < 9.223372036854776e18 and x == int(x):
        return str(int(x))
    return "%.6g" % x


def d02(x: float) -> str:
    """sprintf("%02d", x)."""
    return "%02d" % int(x) if x == x and abs(x) != float("inf") else ("%.6g" % x)


def aeq(a: str, b: str) -> bool:
    """== двух полей (strnum): оба похожи на число — сравниваются числа."""
    if _STRNUM.match(a) and _STRNUM.match(b):
        return anum(a) == anum(b)
    return a == b


def awk_words(s: str) -> list:
    """Поля по умолчанию у awk (split(s, a, " ")) и слова IFS у bash: серии пробелов, табов, переводов строк."""
    return [w for w in re.split(r"[ \t\n]+", s) if w != ""]


_AESC = {"a": b"\a", "b": b"\b", "f": b"\f", "n": b"\n", "r": b"\r", "t": b"\t", "v": b"\v", "\\": b"\\", '"': b'"'}


def awk_v(s: str, warned: set) -> str:
    """Значение `-v имя=…`: gawk разбирает в нём escape-последовательности."""
    if "\\" not in s:
        return s
    o = bytearray()
    i, n = 0, len(s)
    while i < n:
        ch = s[i]
        i += 1
        if ch != "\\":
            o += ch.encode("utf-8", K.ERR)
            continue
        if i >= n:
            o += b"\\"
            break
        d = s[i]
        i += 1
        if d in _AESC:
            o += _AESC[d]
        elif d == "\n":
            pass
        elif d in "01234567":
            v = int(d)
            j = i
            while j < n and j - i < 2 and s[j] in "01234567":
                v = v * 8 + int(s[j])
                j += 1
            i = j
            o.append(v & 0xFF)
        elif d == "x":
            j = i
            while j < n and j - i < 2 and s[j] in "0123456789abcdefABCDEF":
                j += 1
            if j == i:
                sys.stderr.write("awk: warning: no hex digits in `\\x' escape sequence\n")
                o += b"x"
            else:
                o.append(int(s[i:j], 16))
                i = j
        else:
            if d not in warned:
                warned.add(d)
                sys.stderr.write("awk: warning: escape sequence `\\%s' treated as plain `%s'\n" % (d, d))
            o += d.encode("utf-8", K.ERR)
    return o.decode("utf-8", K.ERR)


# ---------------------------------------------------------------------------------------------------------------
# Чтение операндов awk: файл не открылся — fatal, как у gawk.

class AwkFatal(Exception):
    pass


_STDIN = [False]


def awk_files(words: list, bom: bool = True):
    """Операнды awk по порядку → (FILENAME, записи). Операндов нет — stdin («-»); папка — предупреждение и
    пропуск; файл не открылся — fatal: дальше ни файлов, ни END (AwkFatal)."""
    if not words:
        t = ""
        if not _STDIN[0]:
            _STDIN[0] = True
            try:
                t = sys.stdin.buffer.read().decode("utf-8", K.ERR)
            except (AttributeError, OSError, ValueError):
                t = ""
        yield "-", K.lines_of(t)
        return
    for w in words:
        if K.is_dir(w):
            sys.stderr.write("awk: warning: command line argument `%s' is a directory: skipped\n" % w)
            continue
        try:
            ls = K.read_lines(w, bom)
        except OSError as e:
            sys.stderr.write("awk: fatal: cannot open file `%s' for reading (%s)\n" % (w, oserr(e)))
            raise AwkFatal()
        yield w, ls


# ---------------------------------------------------------------------------------------------------------------
# grep (BRE GNU, LC_ALL=C) → re над байтами: для проверки первой строки.

_PCLS = {"alpha": "A-Za-z", "digit": "0-9", "alnum": "0-9A-Za-z", "upper": "A-Z", "lower": "a-z",
         "space": " \\t\\n\\r\\f\\v", "blank": " \\t", "xdigit": "0-9A-Fa-f", "cntrl": "\\x00-\\x1f\\x7f",
         "print": "\\x20-\\x7e", "graph": "\\x21-\\x7e", "punct": "!-/:-@\\[-`{-~"}


def _bracket(p: str, i: int):
    j = i + 1
    o = "["
    if j < len(p) and p[j] == "^":
        o += "^"
        j += 1
    first = True
    while True:
        if j >= len(p):
            raise re.error("Unmatched [, [^, [:, [., or [=")
        ch = p[j]
        if ch == "]" and not first:
            return o + "]", j + 1
        first = False
        if ch == "[" and j + 1 < len(p) and p[j + 1] in ":.=":
            t = p[j + 1]
            e = p.find(t + "]", j + 2)
            if e < 0:
                raise re.error("Unmatched [, [^, [:, [., or [=")
            name = p[j + 2:e]
            if t == ":":
                if name not in _PCLS:
                    raise re.error("Invalid character class name")
                o += _PCLS[name]
            else:
                o += re.escape(name)
            j = e + 2
            continue
        o += ("\\" + ch) if ch in "\\[]^&~|" else ch
        j += 1


def bre(p: str) -> str:
    o = []
    i, n = 0, len(p)
    start = True        # начало RE, после `\(` или `\|`: `*` — литерал, `^` — якорь
    quant = False       # прошлый элемент — `*`: `**` у BRE — то же, что `*`
    while i < n:
        c = p[i]
        if c == "\\":
            if i + 1 >= n:
                raise re.error("Trailing backslash")
            d = p[i + 1]
            i += 2
            quant = False
            if d in "(|":
                o.append(d)
                start = True
                continue
            if d in "){}+?":
                o.append(d)
            elif d in "123456789":
                o.append("\\" + d)
            elif d == "<":
                o.append(r"\b(?=\w)")
            elif d == ">":
                o.append(r"\b(?<=\w)")
            elif d in "bBwWsS":
                o.append("\\" + d)
            elif d == "`":
                o.append(r"\A")
            elif d == "'":
                o.append(r"\Z")
            else:
                o.append(re.escape(d))
            start = False
            continue
        if c == "[":
            r, i = _bracket(p, i)
            o.append(r)
            start = quant = False
            continue
        i += 1
        if c == "*":
            if start:
                o.append(r"\*")
                start = False
            elif not quant:
                o.append("*")
                quant = True
            continue
        quant = False
        if c == "^" and start:
            o.append("^")
            continue
        if c == "$" and (i == n or p.startswith("\\)", i) or p.startswith("\\|", i)):
            o.append(r"\Z")
        elif c == ".":
            o.append(".")
        else:
            o.append(re.escape(c))
        start = False
    return "".join(o)


def grep_q(pattern: str, line: str) -> bool:
    """`grep -q <BRE>` по одной строке; перевод строки в шаблоне — несколько шаблонов. Шаблон с ошибкой — как
    код 2 у grep (сообщение в stderr), то есть «не совпало»."""
    b = line.encode("utf-8", K.ERR)
    try:
        rx = [re.compile(bre(x).encode("utf-8", K.ERR), re.S) for x in pattern.split("\n")]
    except re.error as e:
        sys.stderr.write("grep: %s\n" % e)
        return False
    return any(r.search(b) for r in rx)


# ---------------------------------------------------------------------------------------------------------------
# seq 1 S.

_SEQ = re.compile(r"[ \t\n\r\f\v]*[-+]?(?:(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][-+]?[0-9]+)?"
                  r"|0[xX](?:[0-9a-fA-F]+\.?[0-9a-fA-F]*|\.[0-9a-fA-F]+)(?:[pP][-+]?[0-9]+)?"
                  r"|[iI][nN][fF](?:[iI][nN][iI][tT][yY])?|[nN][aA][nN])\Z")


def seq_to(s: str):
    if not _SEQ.match(s):
        sys.stderr.write("seq: invalid floating point argument: '%s'\nTry 'seq --help' for more information.\n" % s)
        return []
    t = s.lstrip(" \t\n\r\f\v")
    sign = -1.0 if t.startswith("-") else 1.0
    u = t.lstrip("+-")
    v = sign * float.fromhex(u) if u[:2] in ("0x", "0X") else float(t)
    if v != v:
        sys.stderr.write("seq: invalid 'not-a-number' argument: '%s'\nTry 'seq --help' for more information.\n" % s)
        return []
    if v == float("inf"):
        return itertools.count(1)
    return range(1, int(math.floor(v)) + 1) if v >= 1 else []


# ---------------------------------------------------------------------------------------------------------------
# Шаг 1: записи частей.

def norm(s: str) -> str:
    s = s.replace("`", "")
    s = K.gsub("«|»", "", s)
    s = K.sub1(r"^[ \t]+", "", s)
    s = K.sub1(r"[ \t]+\Z", "", s)
    s = K.gsub(r"[ \t]+", " ", s)
    v = K.sub1(r" .*", "", s)
    if K.has(HTTPRE, K.k_up(v)):
        s = K.k_up(v) + s[len(v):]
    return s


def skey(sec: str, k: str) -> str:
    if K.has(r"^Публичный (контракт|API)", sec):
        v = K.sub1(r" .*", "", k)
        if K.has(HTTPRE, v):
            return k[len(v) + 1:] + "\x02" + v
        return k
    if K.has(r"^Бизнес-правила", sec):
        if K.has(r"^сообщение", k):
            return "2" + k
        if K.has(r"^ограничение", k):
            return "3" + k
        return "1" + k
    return k


def kcls(sec: str) -> str:
    """Класс блочной секции частей."""
    c = K.k_cls(sec)
    return c if (K.k_partsec(sec) and c != "потребляет") else ""


def header(sec: str, k: str) -> str:
    if K.has(r"^События", sec) and K.has(r"^(публикует|потребляет|транспорт) ", k):
        d = K.sub1(r" .*", "", k)
        return "### " + d + " `" + k[len(d) + 1:] + "`"
    return "### `" + k + "`"


def phase1(words: list, CSEC: str, ESEC: str):
    """Записи: тип<TAB>секция<TAB>ключ-сортировки<TAB>ключ<TAB>текст (\\001 вместо перевода строки)<TAB>часть."""
    raw, nokey, tails, orphl = [], [], [], []
    key = txt = tail = pend = psec = sec = pn = ""
    orph = 0

    def rowout() -> None:                                   # отложенная строка таблицы — данные
        nonlocal pend
        if pend == "":
            return
        c = K.awk_split(pend, "|")
        k = norm(fld(c, 1))
        if K.has(r"^Потребляемые API", psec):
            k = k + " :: " + norm(fld(c, 2))
        if k != "" and k != "—" and k != "— :: ":
            raw.append("R\t" + psec + "\t" + k + "\t" + k + "\t" + pend + "\t" + pn)
        pend = ""

    def flush() -> None:
        nonlocal key, txt, tail
        if key != "" and tail != "":
            txt = txt + "\x01" + tail
        if key != "":
            txt = K.sub1(r"\x01+\Z", "", txt)
            raw.append("B\t" + sec + "\t" + skey(sec, key) + "\t" + key + "\t" + txt + "\t" + pn)
        key = txt = tail = ""
        rowout()

    try:
        for fname, lines in awk_files(words):
            for fnr, line in enumerate(lines, 1):
                line = line.replace("\t", " ")
                if fnr == 1:                                # строка свежести
                    flush()
                    sec = ""
                    orph = 0
                    pn = K.sub1(r"\.md\Z", "", K.sub1(r".*part-", "", fname))
                    continue
                if line.endswith("\r"):
                    line = line[:-1]
                if line.startswith("## "):
                    flush()
                    sec = K.sub1(r"[ \t]+\Z", "", line[3:])
                    orph = 0
                    continue
                if (sec == "" or orph) and line.startswith("### "):
                    flush()
                    orph = 1
                    h = line[4:]
                    p = h.find(" — ")
                    if p >= 0:
                        h = h[:p]
                    sec = ""
                    if CSEC != "" and K.k_canon("контракт", h) != "":
                        sec = CSEC
                    elif ESEC != "" and K.k_canon("топики", h) != "":
                        sec = ESEC
                    orphl.append(pn + "\t" + ("-" if sec == "" else sec))
                if sec == "":
                    continue
                # Заголовок блока в контракте, «Событиях», задачах и данных пишется ключом; хвост « — …» после него
                # становится строкой назначения, если её нет. Не сводится к ключу — заголовок как есть. У
                # «Бизнес-правил» фраза после « — » — часть формы.
                if line.startswith("### "):
                    flush()
                    h = line[4:]
                    p = h.find(" — ")
                    tl = ""
                    if p >= 0:
                        tl = h[p + 3:]
                        h = h[:p]
                    c = kcls(sec)
                    if c == "":
                        key = norm(h)
                        txt = line
                        continue
                    key = K.k_canon(c, h)
                    if key != "":
                        txt = header(sec, key)
                        tail = tl
                    else:
                        key = norm(h)
                        txt = line
                        nokey.append(sec + ": " + key + " (часть " + pn + ")")
                    continue
                if key != "":
                    if tail != "" and not K.has(r"^[ \t]*\Z", line):
                        if K.has(r"^(- |— |сущности:)", line):
                            txt = txt + "\x01" + tail
                        tail = ""
                    l = line
                    if K.has(r"^Публичный контракт", sec):
                        l = K.sub1(r"^- сущности:", "сущности:", l)
                    # Хвост « — <файл>[ + <файл>]» у строки факта — источник из описи, в карточке ему не место.
                    tl_ = 0
                    if kcls(sec) != "" and K.has(r"^(- |— |доступ:|меняет:|шлёт:)", l):
                        m = K.R(TAILRE).search(l)
                        if m:
                            l = l[:m.start()]
                            tl_ = 1
                    if K.has(r"^(меняет|шлёт):[ \t]*нет[ \t.]*\Z", l):   # «нет» живёт в описи
                        continue
                    if tl_:
                        tails.append(sec + ": " + key + " (часть " + pn + ")")
                    txt = txt + "\x01" + l
                    continue
                if line.startswith("|"):
                    if K.has(r"^\|[ \t:|-]*\Z", line):     # разделитель: отложенная строка была заголовком
                        pend = ""
                        continue
                    rowout()
                    pend = line
                    psec = sec
                    continue
                rowout()
                if K.has(r"^(—|не определено)", line):
                    raw.append("P\t" + sec + "\t\t\t" + line)
                    continue
    except AwkFatal:
        return raw, nokey, tails, orphl                     # fatal: END не идёт
    flush()
    return raw, nokey, tails, orphl


# ---------------------------------------------------------------------------------------------------------------
# Шаг 2: слияние дублей.

def units(txt: str) -> list:
    L = K.awk_split(txt, "\x01")
    U = []
    for x in L[1:]:
        if U and K.has(r"^[ \t]", x):
            U[-1] = U[-1] + "\x01" + x
        else:
            U.append(x)
    return U


def np_(p: str) -> str:
    """Путь — как в check: без бэктиков, «.../», номера строки; Windows-диск — заглавной."""
    p = p.replace("`", "").replace("\\", "/")
    p = K.gsub(r"//+", "/", p)
    p = K.sub1(r"^[ \t]+", "", p)
    p = K.sub1(r"[ \t]+\Z", "", p)
    p = K.sub1(r"^\./", "", p)
    p = K.sub1(r"/\Z", "", p)
    p = K.sub1(r"^(\.\.\.|…)/*", "", p)
    p = K.sub1(r":[0-9]+(-[0-9]+)?\Z", "", p)
    p = K.sub1(r"#L[0-9].*\Z", "", p)
    if K.has(r"^(MINGW|MSYS|CYGWIN)", UNAME) and K.has(r"^/[A-Za-z]/", p):
        p = K.k_up(p[1]) + ":" + p[2:]
    if K.has(r"^[A-Za-z]:", p):
        p = K.k_up(p[0]) + p[1:]
    return p


def abs_(p: str) -> bool:
    return K.has(r"^(/|[A-Za-z]:)", p)


def same(p: str, q: str) -> bool:
    # length/substr у bash — байты; хвост «/p» у q по байтам и по символам совпадает одинаково.
    return p == q or (not abs_(p) and q.endswith("/" + p))


def fnames(u: str):
    """Строка поля «Владеет данными»: (n, FN, IT, RST); не перечень полей — n = 0."""
    t = u
    i = t.find("\x01")
    RST = t[i:] if i >= 0 else ""
    if i >= 0:
        t = t[:i]
    t = K.sub1(r"^- ", "", t)
    p = t.find(":")
    q = t.find(" — ")
    if q >= 0 and (p < 0 or q < p):
        p = q
    if p >= 0:
        RST = t[p:] + RST
        t = t[:p]
    IT = [] if t == "" else re.split(r"[,/]", t)
    FN = []
    for i, it in enumerate(IT):
        it = K.gsub(r"^[ \t]+|[ \t]+\Z", "", it)
        IT[i] = it
        x = K.sub1(r"[ \t]*\([^)]*\)\Z", "", it)
        x = x.replace("`", "")
        x = K.sub1(r"\?\Z", "", x)
        if not K.has(r"^[A-Za-z_][A-Za-z0-9_]*\Z", x):
            return 0, FN, IT, RST
        FN.append(x)
    return len(IT), FN, IT, RST


def phase2(recs: list, src_lines: list, plan_lines: list, S: str):
    rep, merged, nearp, split = [], [], [], []
    src = {}                                                # часть + k_keyn ключа описи → источник (первый)
    for l in src_lines:
        x = K.awk_split(l, "\t")
        k = fld(x, 0) + SS + K.k_keyn(fld(x, 1))
        if k not in src:
            src[k] = fld(x, 2)
    files, paths, kinds = {}, {}, {}
    planok = 0
    maxp = 0.0
    for l in plan_lines:
        if l.endswith("\r"):
            l = l[:-1]
        r = K.awk_split(l, "\t")
        if fld(r, 0) == "файл" and fld(r, 4) != "-" and fld(r, 4) != "":
            p = np_(fld(r, 1))
            files[p] = (files[p] + "," + fld(r, 4)) if p in files else fld(r, 4)
            planok = 1
        if fld(r, 0) == "путь":
            p = np_(fld(r, 1))
            paths[p] = (paths[p] + "," + fld(r, 3)) if p in paths else fld(r, 3)
            kinds[p] = fld(r, 2)
            planok = 1
            if anum(fld(r, 3)) > maxp:
                maxp = anum(fld(r, 3))
    rest = d02(anum(S)) if (planok and anum(S) > maxp) else ""
    OW = {}

    # Части плана, которым отдан файл f: точный файл старше папки, папка — ближайшая; список через запятую.
    # Длины у bash — байты; сравниваются только длины префиксов одного f — порядок тот же.
    def own1(f: str) -> str:
        best = 0
        res = ""
        for p in files:
            if same(f, p):
                if len(f) + 1 > best:
                    best = len(f) + 1
                    res = files[p]
                elif len(f) + 1 == best:
                    res = res + "," + files[p]
        for p in paths:
            q = f
            depth = len(f) + 1
            if kinds[p] == "папки":
                q = K.sub1(r"/[^/]+\Z", "", q)
                depth = len(q)
            while q != f or kinds[p] == "файлы":
                if same(q, p):
                    if depth > best:
                        best = depth
                        res = paths[p]
                    elif depth == best:
                        res = res + "," + paths[p]
                    break
                if kinds[p] != "папки" or "/" not in q:
                    break
                q = K.sub1(r"/[^/]+\Z", "", q)
                depth = len(q)
        return res

    # Части, которым план отдал размеченный файл f (строка «файл»), через запятую.
    def ownmark(f: str) -> str:
        res = ""
        for p in files:
            if same(f, p):
                res = res + ("" if res == "" else ",") + files[p]
        return res

    # Файлы одного куска источника — в OW; размеченные (marked) или отданные части по путям.
    def addown(seg: str, marked: int) -> int:
        seg = K.gsub(r"[,;()]", " ", seg)
        hit = 0
        for t in awk_words(seg):
            if "/" not in t and not K.has(r"\.[A-Za-z0-9]+(:[0-9]+)?\Z", t):
                continue
            o = ownmark(np_(t)) if marked else own1(np_(t))
            if o == "":
                continue
            for x in K.awk_split(o, ","):
                if x != "-" and x != "":
                    OW[astr(anum(x))] = 1
                    hit = 1
        return hit

    # Владелец по источнику строки описи (куски через « + »): решает первый кусок, который план разметил;
    # размеченного нет — первый, который план отдал части.
    def owners(sv: str) -> None:
        segs = [] if sv == "" else re.split(r" \+ ", sv)
        for s in segs:
            if addown(s, 1):
                return
        for s in segs:
            if addown(s, 0):
                return

    # Источник ключа k у части a — по k_keyn (`:id` = `{id}`), затем по ключу без скобок вызова.
    def srcof(a: str, k: str) -> str:
        for c in (k, K.k_bare(k)):
            v = src.get(a + SS + K.k_keyn(c))
            if v is not None:
                return v
        return ""

    # Ключи одного k_key: блоки разных частей сливаются при том же k_keyn; у одной части разные записи ключа
    # не сливаются (точный дубль текста — сливается). Не слитые — строка в вывод.
    def split_sets(psec: str, items: list):
        subs = {}
        for it in items:
            subs.setdefault(K.k_keyn(it[0]), []).append(it)
        sets = []
        for sub in subs.values():
            per = {}
            for k, _, p in sub:
                ks = per.setdefault(p, [])
                if k not in ks:
                    ks.append(k)
            if any(len(v) > 1 for v in per.values()):
                bytext = {}
                for it in sub:
                    bytext.setdefault(it[0], []).append(it)
                sets.extend(bytext.values())
            else:
                sets.append(sub)
        if len(sets) < 2:
            return sets
        var, per = {}, {}
        for k, _, p in items:
            ps = var.setdefault(k, [])
            if p not in ps:
                ps.append(p)
            ks = per.setdefault(p, [])
            if k not in ks:
                ks.append(k)
        why = ["имена параметров разные"] if len(subs) > 1 else []
        why += ["у части %s один путь записан разными ключами" % p for p, ks in per.items() if len(ks) > 1]
        split.append(psec + ": " + ", ".join("%s (%s %s)" % (k, "часть" if len(ps) == 1 else "части", ", ".join(ps))
                                              for k, ps in var.items()) + " — " + "; ".join(why))
        return sets

    ph = {}
    has = set()

    def out(psec: str, items: list) -> str:
        """Текст блока группы: один блок — как есть; дубль — блок владельца или объединение."""
        keys = [it[0] for it in items]
        blk = [it[1] for it in items]
        bpn = [it[2] for it in items]
        nb = len(blk)
        btxt = blk[0]
        if nb > 1:
            who = ", ".join(bpn)
            OW.clear()
            ns = 0
            for i in range(nb):
                s = srcof(bpn[i], keys[i])
                if s != "":
                    ns += 1
                    owners(s)
            # `for (o in OW)` у gawk: целые ключи — по возрастанию; здесь — сортировка по числу.
            ows = sorted(OW, key=anum)
            ob = ni = nown = 0
            for o in ows:
                nown += 1
                for i in range(nb):
                    if anum(bpn[i]) == anum(o):
                        ni += 1
                        ob = i + 1
            why = ""
            if planok == 0:
                why = "плана нет"
            elif ns == 0:
                why = "у ключа нет источника в описях"
            elif ni > 1:
                why = "файл-источник у нескольких частей"
            elif ni == 0 and nown == 0 and rest != "":
                for i in range(nb):
                    if anum(bpn[i]) == anum(rest):
                        ob = i + 1
                if not ob:
                    why = "файл вне частей, у остатка блока нет"
            elif ni == 0 and nown == 0:
                why = "файл-источник вне частей плана"
            elif ni == 0:
                why = "владелец по плану —"
                for o in ows:
                    why = why + " " + d02(anum(o))
                why = why + ", блока у него нет"
            have = set()
            pre, dash, sem = [], [], []
            if why == "":
                known = set()
                XD, XS = [], []
                oslot = {}
                OU = units(blk[ob - 1])
                for j, uu in enumerate(OU, 1):
                    have.add(uu)
                    if K.has(r"^- ", uu) and K.has(r"^Владеет данными", psec):
                        c, FN, IT, RST = fnames(uu)
                        for q in range(c):
                            known.add(FN[q])
                    if K.has(r"^События", psec) and K.has(SLOTRE, uu):
                        lb = K.sub1(r":.*", "", K.sub1(r"^- ", "", uu))
                        oslot[lb] = j
                nd = na = 0
                who = ""
                for i in range(nb):
                    if i + 1 == ob:
                        continue
                    who = who + ("" if who == "" else ", ") + bpn[i]
                    for u in units(blk[i]):
                        if u in have:
                            continue
                        if K.has(r"^— ", u):
                            have.add(u)
                            XS.append(u)
                            continue
                        # Строка-метка «Событий» другой части: у владельца метки нет — дописывается; у владельца
                        # «не определено» — заменяется. Иначе отбрасывается, как любая строка «- ».
                        if K.has(r"^События", psec) and K.has(SLOTRE, u):
                            lb = K.sub1(r":.*", "", K.sub1(r"^- ", "", u))
                            have.add(u)
                            if lb not in oslot:
                                XD.append(u)
                                oslot[lb] = 0
                                na += 1
                            elif oslot[lb] > 0 and K.has(NDEF, OU[oslot[lb] - 1]) and not K.has(NDEF, u):
                                OU[oslot[lb] - 1] = u
                                na += 1
                            else:
                                nd += 1
                            continue
                        if not K.has(r"^- ", u):
                            continue
                        if K.has(r"^Владеет данными", psec):
                            c, FN, IT, RST = fnames(u)
                        else:
                            c = 0
                        keep = ""
                        nk = 0
                        for q in range(c):
                            if FN[q] not in known:
                                keep = keep + (", " if nk else "") + IT[q]
                                nk += 1
                                known.add(FN[q])
                        if nk == 0:
                            nd += 1
                            continue
                        if nk < c:
                            u = "- " + keep + RST
                        have.add(u)
                        XD.append(u)
                        na += 1
                # порядок шаблона: строки владельца без «— », новые поля, «— » владельца, «— » остальных
                s = blk[ob - 1].split("\x01", 1)[0]
                for x in OU:
                    if not K.has(r"^— ", x):
                        s = s + "\x01" + x
                for x in XD:
                    s = s + "\x01" + x
                for x in OU:
                    if K.has(r"^— ", x):
                        s = s + "\x01" + x
                for x in XS:
                    s = s + "\x01" + x
                shown = keys[ob - 1]
                rep.append(psec + ": " + shown + " — блок части " + bpn[ob - 1] + " (владелец по плану)"
                           + (("; новых " + ("строк-меток" if K.has(r"^События", psec) else "полей") + " от " + who
                               + " — строк " + str(na)) if na else "")
                           + "; у " + who + " строк «- » отброшено " + str(nd))
                btxt = s
            else:
                s = blk[0].split("\x01", 1)[0]
                ent = 0
                for i in range(nb):
                    for uu in units(blk[i]):
                        if K.has(r"^(- )?сущности:", uu):
                            if not ent:
                                ent = 1
                                pre.append(uu)
                            continue
                        if K.has(r"^(- |— )", uu) or i == 0:
                            if uu not in have:
                                have.add(uu)
                                if K.has(r"^- ", uu):
                                    dash.append(uu)
                                elif K.has(r"^— ", uu):
                                    sem.append(uu)
                                else:
                                    pre.append(uu)
                for x in pre + dash + sem:
                    s = s + "\x01" + x
                shown = keys[0]
                rep.append(psec + ": " + shown + " — блоки частей " + who + " объединены, владельца нет: " + why)
                btxt = s
            other = []
            for k in keys:
                if k != shown and k not in other:
                    other.append(k)
            if other:                                       # слиты разные записи одного ключа
                nearp.append(psec + ": " + " ~ ".join([shown] + other))
        return btxt

    # Группы — по типу, секции и k_key, на месте первой записи в порядке сортировки.
    groups = {}
    for line in recs:
        f = line.split("\t")
        t, sec, k, txt, pnum = fld(f, 0), fld(f, 1), fld(f, 3), fld(f, 4), fld(f, 5)
        if t == "P":
            ph[sec] = ph.get(sec, "") + ("" if ph.get(sec, "") == "" else "\x01") + txt
            continue
        g = groups.setdefault(t + SS + sec + SS + K.k_key(k), (t, sec, []))
        g[2].append((k, txt, pnum))
    for t, sec, items in groups.values():
        has.add(sec)
        if items[0][0] == "":
            continue
        if t == "B":
            for s in split_sets(sec, items):
                merged.append(sec + "\t" + out(sec, s) + "\x01")
            continue
        k0, txt0, p0 = items[0]
        for k, txt, pnum in items[1:]:
            # строка «Зависит от» того же имени у другой части — первая остаётся, остальные — в вывод
            if t == "R" and K.has(r"^Зависит от", sec) and not aeq(txt, txt0):
                rep.append(sec + ": " + k + " — строка части " + pnum + " отброшена, оставлена строка части " + p0)
        merged.append(sec + "\t" + txt0 + "\x01")
    for s in ph:
        if s not in has:
            merged.append(s + "\t" + ph[s])
    return merged, rep, nearp, split


# ---------------------------------------------------------------------------------------------------------------
# Шаг 4: опись.

def rname(l: str) -> str:
    l = l.replace("`", "")
    l = K.gsub(r"[ \t]+", " ", l)
    return K.sub1(r" \Z", "", l)


def opis(words: list) -> list:
    """Строки склеенной описи; fatal на чтении — пусто (всё печатает END)."""
    RULE = r"^(состояние|справочник|сообщение|ограничение):"
    outv = {}
    first, bend, addl = {}, {}, {}
    hv = set()
    tot = []
    n = cur = dupr = skip = ishead = 0
    try:
        for fname, lines in awk_files(words):
            for fnr, line in enumerate(lines, 1):
                if fnr == 1:
                    if n > 0:
                        n += 1
                        outv[n] = ""
                    ishead = 1 if K.has(r"head\.opis\.md\Z", fname) else 0
                    cur = dupr = skip = 0
                    continue
                if line.endswith("\r"):
                    line = line[:-1]
                if line.startswith("⟹"):
                    if not (ishead and line.startswith("⟹ состояний")):
                        tot.append(line)
                    cur = dupr = 0
                    continue
                if ishead and K.has(RULE, line):
                    skip = 1
                    continue
                if skip and K.has(r"^[ \t]", line):
                    continue
                skip = 0
                if K.has(RULE, line):
                    nm = rname(line)
                    if nm in first:
                        cur = first[nm]
                        dupr = 1
                        continue
                    n += 1
                    outv[n] = line
                    first[nm] = n
                    bend[n] = n
                    cur = n
                    dupr = 0
                    continue
                if K.has(r"^[ \t]", line):
                    if dupr:
                        hk = str(cur) + SS + line
                        if hk not in hv:
                            hv.add(hk)
                            addl[cur] = addl.get(cur, "") + "\n" + line
                        continue
                    n += 1
                    outv[n] = line
                    if cur:
                        bend[cur] = n
                        hv.add(str(cur) + SS + line)
                    continue
                cur = dupr = 0
                n += 1
                outv[n] = line
    except AwkFatal:
        return []
    after = {}
    for r in bend:
        after[bend[r]] = r
    res = []
    for i in range(1, n + 1):
        res.append(outv[i])
        if i in after and addl.get(after[i], "") != "":
            res.append(addl[after[i]][1:])
    res.append("")
    sums = {}
    order = []
    seen = set()
    for t in tot:
        form = K.gsub(r"[0-9]+", "#", t)
        c = 0
        line = t
        while True:
            m = K.R(r"[0-9]+").search(line)
            if not m:
                break
            c += 1
            sums[(form, c)] = sums.get((form, c), 0.0) + anum(m.group(0))
            line = line[m.end():]
        if form not in seen:
            seen.add(form)
            order.append(form)
    for f in order:
        s = ""
        j = 0
        rest = f
        while True:
            p = rest.find("#")
            if p < 0:
                break
            j += 1
            v = sums.get((f, j))
            s = s + rest[:p] + ("" if v is None else astr(v))
            rest = rest[p + 1:]
        res.append(s + rest)
    return res


def bash_read(line: str, ifs: str, nv: int) -> list:
    """`read -r a b …` с IFS из пробельных символов: края срезаны, последнему — остаток строки."""
    s = line.lstrip(ifs)
    vals = []
    for _ in range(nv - 1):
        m = re.match("[^" + re.escape(ifs) + "]*", s)
        w = m.group(0)
        s = s[len(w):].lstrip(ifs)
        vals.append(w)
    vals.append(s.rstrip(ifs))
    return vals


def main() -> int:
    c = K.start()
    for i, nm in enumerate(("папка частей", "число частей", "дата", "черновик", "опись")):
        if len(c.args) <= i or c.args[i] == "":
            sys.stderr.write("assemble.py: %d: %s\n" % (i + 1, nm))
            return 1
    DIR, S, DATE, OUT, OPIS = c.args[:5]

    # Свежесть — по всем файлам сразу: один ОТКАЗ называет каждый файл без файла или с чужой первой строкой, чтобы
    # вторая попытка автора чинила всё (раньше — только первый файл, и опись части оставалась непочиненной).
    bad: list = []

    def fresh(path: str, who: str, whore: str = "") -> None:   # fresh <файл> <кто> [<кто — регэксп>]
        if not K.is_file(path):
            bad.append("нет файла " + path)
            return
        try:
            t = K.read_text(path, False)                    # BOM — как у bash: первая строка с ним не сходится
        except OSError as e:
            sys.stderr.write("head: cannot open '%s' for reading: %s\n" % (path, oserr(e)))
            t = ""
        ok = False
        if t != "":
            ok = grep_q("^<!-- service-map: %s %s -->" % (whore or who, DATE), t.split("\n", 1)[0].replace("\r", ""))
        if not ok:
            bad.append("%s — первая строка не «<!-- service-map: %s %s -->» (чужой прогон?)" % (path, who, DATE))

    fresh(DIR + "/head.md", "голова")
    PARTS = ""
    POPIS = ""
    for i in seq_to(S):
        n = "%02d" % i
        fresh("%s/part-%s.md" % (DIR, n), "часть " + n, "часть 0*%d" % i)
        fresh("%s/part-%s.opis.md" % (DIR, n), "часть " + n, "часть 0*%d" % i)
        PARTS += " %s/part-%s.md" % (DIR, n)
        POPIS += " %s/part-%s.opis.md" % (DIR, n)
    if K.is_file(DIR + "/head.opis.md"):
        fresh(DIR + "/head.opis.md", "голова")
    if bad:
        fail("; ".join(bad))
    PLAN = DIR + "/plan.tsv"
    try:
        if os.path.getsize(K.fpath(PLAN)) <= 0:
            PLAN = ""
    except OSError:
        PLAN = ""
    HEAD = DIR + "/head.md"

    # 1. Записи частей. Блоки до первого заголовка секции в файле части: секция — по форме ключа каждого блока
    # (ключ контракта или топика — эта секция каркаса), пока не встретится `## `; секцию не угадать — блок
    # отброшен строкой вывода.
    try:
        hl = K.lines_of(K.read_text(HEAD).replace("\r", ""))
    except OSError as e:
        sys.stderr.write("assemble.py: %s: %s\n" % (HEAD, oserr(e)))
        hl = []

    def hsec(rx: str) -> str:
        for l in hl:
            if K.has("^## " + rx, l):
                return K.sub1(r"[ \t]*\Z", "", K.sub1(r"^## ", "", l))
        return ""

    warned = set()
    CSEC = awk_v(hsec("Публичный (контракт|API)"), warned)
    ESEC = awk_v(hsec("События"), warned)
    raw, nokey, tails, orph = phase1(awk_words(PARTS), CSEC, ESEC)

    # 1а. Ключ контракта вызовом и он же без скобок — один ключ (точное совпадение старше: две перегрузки
    # с разными аргументами остаются двумя ключами).
    have = set()
    for line in raw:
        f = line.split("\t")
        if fld(f, 0) == "B":
            have.add(fld(f, 1) + SS + K.k_key(fld(f, 3)))
    near, rec = [], []
    for line in raw:
        f = line.split("\t")
        if fld(f, 0) == "B" and K.has(r"^Публичный (контракт|API)", fld(f, 1)):
            b = K.k_bare(fld(f, 3))
            if b != fld(f, 3) and fld(f, 1) + SS + K.k_key(b) in have:
                near.append(fld(f, 1) + ": " + b + " ~ " + fld(f, 3))
                f += [""] * (4 - len(f))
                f[3] = b
                f[2] = b
                line = "\t".join(f)
        rec.append(line)

    # 1б. Каждой секции с блоками или строками частей нужна метка в каркасе головы.
    frame = []
    try:
        for _, lines in awk_files([HEAD]):
            sec = ""
            for line in lines:
                if line.endswith("\r"):
                    line = line[:-1]
                if line.startswith("## "):
                    sec = K.sub1(r"[ \t]+\Z", "", line[3:])
                    frame.append("H\t" + sec)
                    continue
                if K.gsub(r"^[ \t]+|[ \t]+\Z", "", line) == MARK:
                    frame.append("M\t" + sec)
    except AwkFatal:
        pass
    mark, hs = set(), set()
    for line in frame:
        f = line.split("\t")
        if fld(f, 0) == "M":
            mark.add(fld(f, 1))
        else:
            hs.add(fld(f, 1))
    seen, who = set(), {}
    for line in rec:
        f = line.split("\t")
        s, p = fld(f, 1), fld(f, 5)
        if fld(f, 0) in ("B", "R") and s not in mark and s + SS + p not in seen:
            seen.add(s + SS + p)
            w = who.get(s, "")
            who[s] = w + ("" if w == "" else ", ") + p
    unplaced = []
    for s, w in who.items():
        if K.k_partsec(s):
            unplaced.append("HEAD\t" + s + "\t" + w)
        elif s in hs:
            unplaced.append("DROP\t" + s + "\t" + w)
        else:
            unplaced.append("PART\t" + s + "\t" + w)
    unplaced = K.csort(unplaced)
    for u in unplaced:
        if u.startswith("HEAD\t"):
            f = u.split("\t")
            fail("голова — в каркасе нет строки «<!-- части -->» в секции «%s»: блоки частей %s вставить некуда" % (fld(f, 1), fld(f, 2)))
    for u in unplaced:
        if u.startswith("PART\t"):
            f = u.split("\t")
            fail("часть %s — секция «%s» не из шаблона: её блоки вставить некуда" % (fld(f, 2), fld(f, 1)))

    # sort -t'\t' -k1,1 -k2,2 -k3,3 -s: по трём полям, байтами, при равных — порядок входа.
    def k3(line: str):
        f = line.split("\t")
        return (K.bkey(fld(f, 0)), K.bkey(fld(f, 1)), K.bkey(fld(f, 2)))
    recs = sorted(rec, key=k3)

    # 1в. Источники ключей по описям частей: часть<TAB>ключ<TAB>хвост строки после « — ».
    src = []
    try:
        for fname, lines in awk_files(awk_words(POPIS)):
            pn = ""
            for fnr, line in enumerate(lines, 1):
                if fnr == 1:
                    pn = K.sub1(r"\.opis\.md\Z", "", K.sub1(r".*part-", "", fname))
                    continue
                if line.endswith("\r"):
                    line = line[:-1]
                if K.has(r"^[ \t]", line) or K.has(r"^(#|⟹|\(|>|-|```|<!--)", line) or line == "":
                    continue
                p = line.find(" — ")
                if p < 0:
                    continue
                h = line[:p]
                if K.k_fact(h):
                    continue
                src.append(pn + "\t" + K.k_opis(h) + "\t" + line[p + 3:])
    except AwkFatal:
        pass

    # 2. Слияние дублей. Блок без дубля выходит как есть. Дубль ключа — блок владельца по плану; владельца
    # нет — объединение (см. шапку). Строка с отступом едет со своей строкой.
    plan_lines = []
    if PLAN != "":
        try:
            plan_lines = K.read_lines(PLAN)
        except OSError:
            plan_lines = []
    merged, dups, nearp, split = phase2(recs, src, plan_lines, awk_v(S, set()))

    # 3. Каркас головы: строка `<!-- части -->` заменяется слитым содержимым своей секции.
    try:
        ft = open(K.fpath(OUT + ".tmp"), "wb")
    except OSError as e:
        sys.stderr.write("assemble.py: %s.tmp: %s\n" % (OUT, oserr(e)))
        fail("каркас не собрался")
    outl = []
    with ft:
        try:
            cs = {}
            for line in merged:
                f = line.split("\t")
                cs[fld(f, 0)] = cs.get(fld(f, 0), "") + fld(f, 1)
            for _, lines in awk_files([HEAD]):
                if not merged:                              # FNR == NR и на втором файле: всё — в c[]
                    break
                sec = ""
                for fnr, line in enumerate(lines, 1):
                    if fnr == 1:
                        continue
                    if line.endswith("\r"):
                        line = line[:-1]
                    if line.startswith("## "):
                        sec = K.sub1(r"[ \t]+\Z", "", line[3:])
                    if K.gsub(r"^[ \t]+|[ \t]+\Z", "", line) == MARK:
                        s = cs.get(sec, "")
                        if s == "":
                            outl.append("—")
                            continue
                        outl.append(K.sub1(r"\n+\Z", "", s.replace("\x01", "\n")))
                        continue
                    outl.append(line)
        except AwkFatal:
            fail("каркас не собрался")
        tmp_text = "".join(x + "\n" for x in outl)
        ft.write(tmp_text.encode("utf-8", K.ERR))

    # Между блоками ### — пустая строка, как в шаблоне.
    a = []
    prev = ""
    for l in K.lines_of(tmp_text):
        if prev != "" and l.startswith("### "):
            a.append("")
        a.append(l)
        prev = l
    o = []
    for l in a:                                             # cat -s: подряд идущие пустые строки — одна
        if l == "" and o and o[-1] == "":
            continue
        o.append(l)
    try:
        K.write_text(OUT, "".join(x + "\n" for x in o))
    except OSError as e:
        sys.stderr.write("assemble.py: %s: %s\n" % (OUT, oserr(e)))
    try:
        os.remove(K.fpath(OUT + ".tmp"))
    except OSError:
        pass

    # 4. Опись: списки головы и частей подряд, итоги ⟹ суммируются по одинаковой форме строки. Строки
    # «Бизнес-правил» (`состояние:`, `справочник:`, `сообщение:`, `ограничение:` с подстроками) — частей:
    # по ним check сверяет блоки головы; строки головы и её `⟹ состояний` в склеенную опись не идут.
    # Строка правил, которую слово в слово повторила другая часть, — одна; подстроки повтора — под ней без
    # повторов. Строки с разными значениями остаются обе: сверка берёт значения всех.
    OF = (DIR + "/head.opis.md") if K.is_file(DIR + "/head.opis.md") else ""
    try:
        fo = open(K.fpath(OPIS), "wb")                      # `> "$OPIS"` — файл пуст до чтения входов
    except OSError as e:
        sys.stderr.write("assemble.py: %s: %s\n" % (OPIS, oserr(e)))
        fo = None
    if fo is not None:
        with fo:
            fo.write("".join(x + "\n" for x in opis(awk_words(OF) + awk_words(POPIS))).encode("utf-8", K.ERR))

    print("собрано: " + OUT)
    cnt = {}
    try:
        for _, lines in awk_files([OUT], False):
            s = ""
            for line in lines:
                if line.startswith("## "):
                    s = line
                if line.startswith("### "):
                    cnt[s] = cnt.get(s, 0) + 1
    except AwkFatal:
        cnt = {}
    for x in K.csort("  %s — блоков %d" % (k, v) for k, v in cnt.items()):
        print(x)
    if dups:
        print("дубли ключей склеены:")
        for l in dups:
            print("  " + l)
    if near:
        print("из них один ключ вызовом и без скобок:")
        for l in near:
            print("  " + l)
    if nearp:
        print("из них один ключ разной записью параметра пути:")
        for l in nearp:
            print("  " + l)
    if split:
        print("ключи одного пути не склеены — блоки оставлены порознь:")
        for l in split:
            print("  " + l)
    if nokey:
        print("ключ не опознан — заголовок не по ключу шаблона, оставлен как есть:")
        for l in K.csort(set(nokey)):
            print("  " + l)
    if tails:
        print("хвост « — файл» снят у строк фактов: %d — источник ключа живёт в описи" % len(tails))
    for u in unplaced:
        if u.startswith("DROP\t"):
            _, s, w = bash_read(u, "\t", 3)
            print("отброшено: секция «%s» у частей %s — её пишет голова" % (s, w))
    groups = []
    for l in K.csort(orph):                                 # sort | uniq -c
        if groups and groups[-1][1] == l:
            groups[-1][0] += 1
        else:
            groups.append([1, l])
    for n, l in groups:
        cn, rest = bash_read("%7d %s" % (n, l), " \t\n", 2)
        p = rest.split("\t", 1)[0]
        s = rest.split("\t", 1)[1] if "\t" in rest else rest
        if s == "-":
            print("отброшено: блоков %s у части %s — до заголовка секции, секция по ключу не определяется" % (cn, p))
        else:
            print("без заголовка секции у части %s: блоки до первого заголовка — в «%s» по форме ключа" % (p, s))
    try:
        if K.is_dir(OPIS):
            raise IsADirectoryError(21, "Is a directory")
        nsrc = str(sum(1 for l in K.lines_of(K.read_text(OPIS, False)) if " — " in l))
    except OSError as e:
        sys.stderr.write("grep: %s: %s\n" % (OPIS, oserr(e)))
        nsrc = ""
    print("опись: %s (%s строк с источником)" % (OPIS, nsrc))
    return 0


if __name__ == "__main__":
    sys.exit(main())
