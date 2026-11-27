# plan.py — план нарезки большого сервиса на части по счёту пометок ключей.
#
#   python3 plan.py <counts.txt> <K> <w> <корень>[,<корень>…] [<plan.tsv>] [<тип>]
#
# <тип> — `type` сервиса из манифеста. Форма по типу — keys.py («Форма по типу»): класс, секции которого
# у типа нет, отбрасывается при разборе счёта (строка «класс … у типа … секции нет»); тип, у которого не все
# секции классов пишут части, не режется. Типа нет — классы все, нарезка по весу.
#
# counts.txt — вывод грепов по строкам разведчика, дословно, под заголовками:
#   ## <класс> :: <ключ|ориентир>
#   <путь>:<число>
# и заголовки контроля разведчика, без строк под ними:
#   ## контроль :: <класс> :: <файл> :: <сколько ключей класса разведчик видел в этом файле>
# Класс — первое слово поля: «контракт HTTP» и «контракт GraphQL» — оба контракт. Путь — как угодно
# записанный: бэктики и кавычки снимаются; точного пути нет ни в счёте, ни в дереве корней — берётся
# единственный файл с тем же хвостом пути (вплоть до имени файла). Не нашёлся или таких несколько —
# «контроль … не сверен», без тревоги.
# По каждому контролю печатается строка: маркер класса дал в этом файле меньше половины —
# «УЗКИЙ МАРКЕР: …», иначе «контроль …: сходится». На план контроль не влияет.
# Путь без корня (`./src/…`, `src/…`) при одном корне считается от него. ОТКАЗ, код 3 — файл счёта
# негоден, плана нет: нет заголовков или вид не `ключ|ориентир`; под заголовком путь к файлу без счёта
# (совпадение текстом, список файлов); весь счёт вне корней; корень есть на диске, а файла из счёта там нет.
# Тесты в план и в числа «к сверке» не идут: папки `test`/`tests` в корне сервиса, `src/test` и
# `__tests__` на любой глубине, файлы `*.test.*`/`*.spec.*` (js, ts) и `*_test.go|py`.
# Вес файла = сумма совпадений строк `ключ` + w × сумма строк `ориентир`. Вес папки — сумма по её
# поддереву. Часть образуют только папки и файлы с пометками `ключ`: они пакуются подряд по пути в
# части весом ≤ K; папка тяжелее K режется по своим подпапкам, а её собственные файлы — подряд по
# файлам; файл тяжелее K — отдельной частью. Всё остальное — «остаток»: список папок и «файлов прямо в
# папке» печатается по дереву корней на диске (без скрытых папок, `node_modules`, `__pycache__` и без
# `target`, `build`, `dist` в корне сервиса); дерева нет или пунктов больше 60 — остаток назван
# отрицанием. Читает и печатает план в stdout. С пятым аргументом ещё пишет тот же план для check.py,
# строками через табуляцию (тесты и пути вне корней туда не идут, как и в «к сверке»):
#   итог  <класс> <пометок ключ>                         — по сервису;
#   часть <NN> <класс> <пометок ключ>                    — ожидание части;
#   файл  <путь> <класс> <пометок ключ> <NN части | ->   — каждый файл с пометками `ключ`.
#   путь  <путь части> <папки|файлы> <NN части>         — владение, включая файлы без пометок;
#   остаток <NN остатка> <папка|файлы> <путь>           — пункт списка остатка, если список напечатан;
#   операция <МЕТОД> <путь> <operationId> <спека> <NN | -> — операция спецификации на диске и её часть;
#   топик <имя> <конфиг>                                — топик конфига, который назвал разведчик.
# Класс `клиенты` считается как любой класс `ключ` (итог, части, файлы, контроль разведчика), но в вес не
# входит: части он не образует, его файл вне частей — остатку.
# Спецификации (OpenAPI/Swagger в YAML) скрипт находит сам, мимо разведчика; конфиг с именами топиков называет
# разведчик (`## конфиг топиков :: <файл>`: YAML, JSON или `ключ=значение`); с карточкой их сверяет check.py. Разведчик не назвал ни одной спецификации, а на диске она есть — строка
# «СПЕКА НЕ РАЗМЕЧЕНА: <файл> — операций N». Спека, которую разведчик назвал клиентской
# (`## клиентская спека :: <файл>` — по ней генерируется клиент к соседу), не сверяется и не весит.
# Строка разведчика с полем `в файлах с <регэксп>` перед `ключ|ориентир` — пометка ключа узнаётся только в
# файлах, где есть второй регэксп. Счётчик считает строку как обычную; скрипт оставляет файлы, где второй
# регэксп нашёлся (построчно, синтаксис регэкспа — `re` с `re.ASCII`), остальное — строкой «вне условия файла:
# <класс> N в файлах M». Регэксп `re` не разобрал — строка считается вся, строкой «условие файла не разобрано».
# Нарезку решает вес ключей: ориентир части только раскладывает.
# При отказе файл плана остаётся пустым.
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

SPACE = " \t\n\r\f\v"   # пробельные символы локали C
UNREAD: list = []        # файлы дерева, которые не открылись (bash пропускал молча)

# Число из строки, как его берёт awk: префикс-число (strtod); «похоже на число» (strnum) — вся строка.
_NUM = re.compile(r"[ \t\n\r\f\v]*[-+]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][-+]?[0-9]+)?")


def strtod(s: str) -> float:
    m = _NUM.match(s)
    return float(m.group(0)) if m else 0.0


def strnum(s: str) -> bool:
    m = _NUM.match(s)
    return m is not None and s[m.end():].strip(SPACE) == ""


def tostr(x) -> str:
    """Число в строку, как при склейке в awk (CONVFMT %.6g, целое — без точки)."""
    return K.num(float(x)) if isinstance(x, float) else str(x)


def G(x) -> str:
    return "%g" % x


def bhead(s: str, n: int) -> str:
    """substr(s, 1, n) под LC_ALL=C — первые n байт."""
    return s.encode("utf-8", K.ERR)[:n].decode("utf-8", K.ERR)


def ifs_split(s: str) -> list:
    """`IFS=',' read -r -a`: первая строка, по запятой; одна запятая в конце — конец поля, не пустое поле."""
    s = s.split("\n", 1)[0]
    if s == "":
        return []
    a = s.split(",")
    if a[-1] == "":
        a.pop()
    return a


def sh_dirname(p: str) -> str:
    if p == "":
        return "."
    q = p.rstrip("/")
    if q == "":
        return "/"
    i = q.rfind("/")
    if i < 0:
        return "."
    q = q[:i].rstrip("/")
    return q if q != "" else "/"


def sh_type(v: str) -> str:
    """Тип — как в манифесте, до пробела, `#` или кавычки; латиница — в нижний регистр (sed построчно, tr)."""
    out = []
    for ln in v.split("\n"):
        ln = K.sub1(r"^[ \t\n\r\f\v\"']*", "", ln)
        ln = K.sub1(r"[ \t\n\r\f\v#\"'].*\Z", "", ln)
        out.append(ln)
    return K.k_low("\n".join(out).rstrip("\n"))


def read_code(p: str):
    """Чужой файл, как getline: строки по "\\n", BOM не снимается. Не открылся — None (есть на диске — в UNREAD)."""
    try:
        return K.read_lines(p, bom=False)
    except OSError:
        if K.exists(p) and p not in UNREAD:
            UNREAD.append(p)
        return None


def can_open(p: str) -> bool:
    """(getline < p) >= 0: файл открывается (пустой — тоже)."""
    try:
        with open(K.fpath(p), "rb"):
            return True
    except OSError:
        return False


def head_is_spec(f: str) -> bool:
    """Первые 40 строк: `openapi:` или `swagger:` в начале строки."""
    try:
        with open(K.fpath(f), "rb") as h:
            k = 0
            for raw in h:
                if k >= 40:
                    break
                k += 1
                if re.match(rb"(?:openapi|swagger):", raw):
                    return True
    except OSError:
        if K.exists(f) and f not in UNREAD:
            UNREAD.append(f)
    return False


def compile_scout(r: str):
    """Регэксп разведчика (синтаксис ripgrep) — `re` с re.ASCII; не разобран — None."""
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            return re.compile(r, re.ASCII)
    except (re.error, OverflowError, RecursionError, ValueError):
        return None


def walk(r: str) -> list:
    """find "$r/" -mindepth 1 -type d \\( -name '.?*' -o -name node_modules -o -name __pycache__ \\) -prune
    -o -type f -print — по имени в байтах, вглубь по порядку."""
    out: list = []

    def rec(shown: str) -> None:
        try:
            with os.scandir(K.fpath(shown)) as it:
                ents = list(it)
        except OSError:
            p = shown.rstrip("/") if shown.rstrip("/") != "" else shown
            if p not in UNREAD:
                UNREAD.append(p)
            return
        ents.sort(key=lambda e: K.bkey(e.name))
        for e in ents:
            name = e.name
            sp = shown + name if shown.endswith("/") else shown + "/" + name
            try:
                isdir = e.is_dir(follow_symlinks=False)
                isreg = (not isdir) and e.is_file(follow_symlinks=False)
            except OSError:
                continue
            if isdir:
                if (name.startswith(".") and len(name) >= 2) or name in ("node_modules", "__pycache__"):
                    continue
                rec(sp)
            elif isreg:
                out.append(sp)

    rec(r + "/")
    return out


class St:
    """Скаляры состояния awk (глобальные переменные)."""
    np_ = 0
    nos = 0
    hdone = 0
    restmark = ""


def main() -> int:
    c = K.start()
    rc = run(c)
    if UNREAD:
        print("не прочитано %d: %s" % (len(UNREAD), UNREAD[0]))
    return rc


def run(c) -> int:
    for i, what in enumerate(("counts.txt", "K", "w", "корни через запятую")):
        if c.arg(i) == "":
            sys.stderr.write("plan.py: %d: %s\n" % (i + 1, what))
            return 1
    COUNTS, KS, WS, ROOTS = c.arg(0), c.arg(1), c.arg(2), c.arg(3)
    TSV = c.arg(4)
    TYPE = sh_type(c.arg(5))
    if not K.is_file(COUNTS):
        print("НЕТ ФАЙЛА: " + COUNTS)
        return 2
    if TSV != "":
        try:
            K.write_text(TSV, "")
        except OSError:
            sys.stderr.write("файл плана не пишется: %s\n" % TSV)
            TSV = ""

    # Файлы корней — для списка остатка и проверки путей счёта. Корня на диске нет — ни того, ни другого.
    # Сам корень обходится, даже если он ссылка или назван как сборочная папка.
    LIST: list = []
    flags: list = []
    for r in ifs_split(ROOTS):
        r = r.strip(SPACE)
        if r == "" or not K.is_dir(r):
            flags.append("0")
            continue
        flags.append("1")
        LIST.extend(walk(r))
    # `/c/…` — это диск `C:` только там, где такие пути бывают: в Windows-оболочке либо когда рядом есть
    # путь в форме диска. На Linux `/u/work` остаётся папкой.
    WIN = 1 if sys.platform in ("win32", "cygwin", "msys") else 0
    if re.search(r",[A-Za-z]:[\\/]|, [A-Za-z]:[\\/]", "," + ROOTS):
        WIN = 1
    try:
        raw_counts = K.read_text(COUNTS, bom=False)
    except OSError:
        sys.stderr.write("plan.py: не открывается %s\n" % COUNTS)
        return 2
    if any(re.match(r"[A-Za-z]:[\\/]", ln) for ln in K.lines_of(raw_counts)):
        WIN = 1

    KV = strtod(KS)
    KNUM = strnum(KS)
    WV = strtod(WS)
    PLAN_WORK = sh_dirname(COUNTS)

    def gtK(x) -> bool:
        return x > KV if KNUM else K.bkey(tostr(x)) > K.bkey(KS)

    def leK(x) -> bool:
        return x <= KV if KNUM else K.bkey(tostr(x)) <= K.bkey(KS)

    st = St()

    # Путь к одному виду: прямые слеши, без хвостового слеша, диск `C:` в верхнем регистре; `/c/…` → `C:/…`;
    # двойные слеши схлопнуты, `/./` и `<папка>/../` раскрыты (ведущий собирает корень из `../<сервис>`).
    def np(p: str) -> str:
        p = p.replace("\\", "/")
        p = K.gsub(r"//+", "/", p)
        p = K.sub1(r"/+\Z", "", p)
        while True:
            q, n = K.R(r"/\.(?:/|\Z)").subn("/", p, count=1)
            if n == 0:
                break
            p = q
        while True:
            m = K.R(r"/[^/]+/\.\.(?:/|\Z)").search(p)
            if not m or p[m.start() + 1:m.start() + 4] == "../":
                break
            p = p[:m.start() + 1] + p[m.end():]
        p = K.sub1(r"/+\Z", "", p)
        if WIN and K.has(r"^/[A-Za-z]/", p):
            p = K.k_up(p[1]) + ":" + p[2:]
        elif K.has(r"^[A-Za-z]:", p):
            p = K.k_up(p[0]) + p[1:]
        return p

    root: list = []
    ondisk: dict = {}
    od = K.awk_split(",".join(flags), ",")
    for i, r in enumerate(K.awk_split(ROOTS, ",")):
        r = K.sub1(r"^[ \t]+", "", r)
        r = K.sub1(r"[ \t]+\Z", "", r)
        r = np(r)
        if r in ondisk:                                 # один корень дважды — один раз
            continue
        root.append(r)
        ondisk[r] = strtod(od[i]) if i < len(od) else 0
    nr = len(root)

    # Путь без корня — от единственного корня; корней несколько — остаётся как есть и уйдёт «вне корней».
    def full(p: str) -> str:
        p = p.replace("\\", "/")
        if K.has(r"^(?:/|[A-Za-z]:)", p):
            return np(p)
        while True:
            q, n = K.R(r"^\./").subn("", p, count=1)
            if n == 0:
                break
            p = q
        return np(root[0] + "/" + p if nr == 1 else p)

    def parent(p: str) -> str:
        return K.sub1(r"/[^/]*\Z", "", p)

    def rootof(p: str) -> str:
        best = ""
        for r in root:
            if p.startswith(r + "/") and len(r) > len(best):
                best = r
        return best

    # Тест — только по устойчивым приметам: пакет `com/acme/test` и `openapi.spec.yaml` тестами не считаются.
    def istest(rel: str) -> int:
        s = "/" + K.k_low(rel)
        if K.has(r"^/(?:test|tests)/", s) or "/src/test/" in s or "/__tests__/" in s:
            return 1
        return 1 if (K.has(r"\.(?:test|spec)\.(?:js|jsx|ts|tsx|mjs|cjs)\Z", s) or K.has(r"_test\.(?:go|py)\Z", s)) else 0

    cov: dict = {}

    def covered(p: str, r: str) -> int:
        if p in cov:
            return 1
        q = parent(p)
        while True:
            if q in cov:
                return 1
            if q == r or q == "" or "/" not in q:
                return 0
            q = parent(q)

    ck: dict = {}
    co: dict = {}
    clist: list = []

    def classes(items: list) -> str:
        out = ""
        for cl in clist:
            s = 0
            for it in items:
                s += ck.get((it, cl), 0)
            if s > 0:
                out = out + ("" if out == "" else ", ") + cl + " " + tostr(s)
        for cl in clist:
            s = 0
            for it in items:
                s += co.get((it, cl), 0)
            if s > 0:
                out = out + ("" if out == "" else ", ") + "ориентир " + cl + " " + tostr(s)
        return out

    def sums(arr: dict, pre: str) -> str:
        out = ""
        for cl in clist:
            if arr.get(cl, 0) > 0:
                out = out + ("" if out == "" else ", ") + pre + cl + " " + tostr(arr[cl])
        return out

    # Маркеры части для её задания: класс с пометками `ключ` — «не меньше», с `ориентир` — «около».
    def marks(items: list) -> str:
        out = ""
        for cl in clist:
            s = 0
            for it in items:
                s += ck.get((it, cl), 0)
            if s > 0:
                out = out + ("" if out == "" else ", ") + cl + " не меньше " + tostr(s)
        for cl in clist:
            s = 0
            for it in items:
                s += co.get((it, cl), 0)
            if s > 0:
                out = out + ("" if out == "" else ", ") + cl + " около " + tostr(s) + " (ориентир)"
        return out

    partof: dict = {}
    partkind: dict = {}
    partexp: dict = {}
    ptext: dict = {}
    pmark: dict = {}

    def emit(kind: str, items: list, wsum) -> None:
        if not items:
            return
        st.np_ += 1
        line = "часть %02d вес %s" % (st.np_, G(wsum))
        cls = classes(items)
        if cls != "":
            line = line + " (" + cls + ")"
        line = line + ": " + kind + " "
        txt = kind + " "
        for i, it in enumerate(items):
            cov[it] = 1
            partof[it] = st.np_
            partkind[it] = kind
            line = line + ("; " if i > 0 else "") + it
            txt = txt + ("; " if i > 0 else "") + it
        for cl in clist:
            s = 0
            for it in items:
                s += ck.get((it, cl), 0)
            if s > 0:
                partexp[(st.np_, cl)] = s
        ptext[st.np_] = txt
        pmark[st.np_] = marks(items)
        print(line)

    # Что должно быть в карточке — по файлам на диске: операции спецификаций (OpenAPI/Swagger в YAML; файл
    # находит скрипт) и имена топиков конфига, который назвал разведчик (`## конфиг топиков :: <файл>`).
    # Сверяет check.py по строкам «операция» и «топик» файла плана. Путь операции — полный, как его принимает сервис:
    # базовый путь спецификации (путь из первого `servers: - url:` у OpenAPI 3, `basePath:` у Swagger 2) плюс путь из `paths`.
    OP: dict = {}   # спека → [(метод, путь, operationId)]

    def specparse(f: str) -> None:
        inp = 0
        ins = 0
        pind = -1
        path = ""
        meth = ""
        base = ""
        ops: list = []
        for ln in read_code(f) or []:
            ln = K.sub1(r"\r\Z", "", ln)
            if K.has(r"^[ \t]*(?:#|\Z)", ln):
                continue
            ind = len(ln) - len(ln.lstrip(" "))
            if ind == 0:
                inp = 1 if K.has(r"^paths:[ \t]*\Z", ln) else 0
                ins = 1 if K.has(r"^servers:[ \t]*\Z", ln) else 0
                path = ""
                meth = ""
                if K.has(r"^basePath:", ln):
                    u = K.sub1(r"^basePath:[ \t]*", "", ln)
                    base = K.gsub(r"[\"' \t]", "", u)
                continue
            if ins and base == "" and K.has(r"^[ \t-]*url:", ln):
                u = K.sub1(r"^[ \t-]*url:[ \t]*", "", ln)
                u = K.gsub(r"[\"' \t]", "", u)
                u = K.sub1(r"^[^/]*://[^/]*", "", u)
                base = u if K.has(r"^/", u) else ""
                continue
            if not inp:
                continue
            if pind < 0 and K.has(r"^ +[\"']?/", ln):
                pind = ind
            if ind == pind:
                path = ""
                meth = ""
                if K.has(r"^ +[\"']?/", ln):
                    path = K.sub1(r"^ +[\"']?", "", ln)
                    path = K.sub1(r"[\"']?:.*\Z", "", path)
                continue
            if path != "" and ind > pind and K.has(r"^ +(?:get|post|put|patch|delete|head|options):[ \t]*\Z", ln):
                meth = K.k_up(K.gsub(r"[ \t:]", "", ln))
                continue
            if meth != "" and K.has(r"^ +operationId:", ln):
                oid = K.sub1(r"^ +operationId:[ \t]*", "", ln)
                oid = K.gsub(r"[\"' \t]", "", oid)
                ops.append([meth, path, oid])
        base = K.sub1(r"/+\Z", "", base)
        if base != "":
            for op in ops:
                op[1] = base + op[1]
        OP[f] = ops

    tseen: dict = {}
    tname: list = []
    tfile: list = []

    def topicadd(v: str, f: str) -> None:
        v = K.sub1(r"[ \t]+#.*\Z", "", v)
        v = K.gsub(r"^[\[ \t]+|[\] \t]+\Z", "", v)
        x = [] if v == "" else K.R(r"[ \t]*,[ \t]*").split(v)
        for t in x:
            t = K.gsub(r"[\"']", "", t)
            if K.has(r"^\$\{", t):                     # ${ключ:значение} — значение
                if ":" not in t:
                    continue
                t = K.sub1(r"^\$\{[^:]*:", "", t)
                t = K.sub1(r"\}\Z", "", t)
            if K.has(r"^[A-Za-z0-9._-]+\Z", t) and K.has(r"[A-Za-z]", t) and t not in tseen:
                tseen[t] = 1
                tname.append(t)
                tfile.append(f)

    # Ключ имени топика: `topic`/`topics` целиком или в конце через `-`, `_`, `.` (`events-topic`, `bus.topics`),
    # в верблюжьей записи — `eventsTopic`.
    def istopickey(k: str) -> bool:
        return K.has(r"(?:^|[-_.])topics?\Z", K.k_low(k)) or K.has(r"[a-z0-9]Topics?\Z", k)

    # Топик — значение такого ключа: строкой, списком или картой под ним.
    def topicsyaml(f: str) -> None:
        intop = 0
        tind = 0
        for ln in read_code(f) or []:
            ln = K.sub1(r"\r\Z", "", ln)
            if K.has(r"^[ \t]*(?:#|\Z)", ln):
                continue
            if ln.startswith("---"):
                intop = 0
                continue
            ind = len(ln) - len(ln.lstrip(" "))
            if intop and ind > tind:
                v = ln
                if K.has(r"^ *- ", v):
                    v = K.sub1(r"^ *- *", "", v)
                elif K.has(r"^ *[^:]+:[ \t]*[^ \t]", v):
                    v = K.sub1(r"^[^:]*:[ \t]*", "", v)
                else:
                    continue
                topicadd(v, f)
                continue
            intop = 0
            if not K.has(r"^ *[A-Za-z0-9_.-]+:", ln):
                continue
            key = K.sub1(r"^ *", "", ln)
            key = K.sub1(r":.*", "", key)
            v = K.sub1(r"^[^:]*:[ \t]*", "", ln)
            if istopickey(key):
                if v == "":
                    intop = 1
                    tind = ind
                else:
                    topicadd(v, f)

    # `ключ=значение` — properties, .env, TOML, ini.
    def topicsprops(f: str) -> None:
        for ln in read_code(f) or []:
            ln = K.sub1(r"\r\Z", "", ln)
            if K.has(r"^[ \t]*(?:#|!|;|\Z)", ln) or "=" not in ln:
                continue
            key = K.sub1(r"[ \t]*=.*", "", ln)
            v = K.sub1(r"^[^=]*=[ \t]*", "", ln)
            if istopickey(key):
                topicadd(v, f)

    def nbr(t: str, chars: str) -> int:
        return sum(1 for ch in t if ch in chars)

    # JSON: `"ключ": значение` — строкой, массивом или объектом; открытые скобки — значения следующих строк до закрывающей.
    def topicsjson(f: str) -> None:
        intop = 0
        d = 0
        for ln in read_code(f) or []:
            ln = K.sub1(r"\r\Z", "", ln)
            if intop:
                d += nbr(ln, "[{")
                d -= nbr(ln, "]}")
                v = K.gsub(r"\"[^\"]*\"[ \t]*:", "", ln)
                v = K.gsub(r"[\]{}\[]", "", v)
                v = K.sub1(r",[ \t]*\Z", "", v)
                if K.has(r"[^ \t]", v):
                    topicadd(v, f)
                if d <= 0:
                    intop = 0
                continue
            m = K.R(r"\"[^\"]+\"[ \t]*:").search(ln)
            if not m:
                continue
            key = ln[m.start() + 1:m.end()]
            key = K.sub1(r"\"[ \t]*:\Z", "", key)
            if not istopickey(key):
                continue
            v = ln[m.end():]
            v = K.sub1(r"^[ \t]+", "", v)
            v = K.sub1(r",[ \t]*\Z", "", v)
            d = nbr(v, "[{") - nbr(v, "]}")
            v = K.gsub(r"\"[^\"]*\"[ \t]*:", "", v)
            v = K.gsub(r"[\]{}\[]", "", v)
            if K.has(r"[^ \t]", v):
                topicadd(v, f)
            if d > 0:
                intop = 1

    # Конфиг топиков называет разведчик: YAML, JSON, остальное — `ключ=значение`.
    def topicsfile(f: str) -> None:
        if K.has(r"\.ya?ml\Z", K.k_low(f)):
            topicsyaml(f)
        elif K.has(r"\.json\Z", K.k_low(f)):
            topicsjson(f)
        else:
            topicsprops(f)

    specre: dict = {}
    speccl: dict = {}
    clientspec: dict = {}
    tcfg: dict = {}
    ospec: list = []

    # Обход дерева: спецификации и конфиги. Разведчик не назвал ни одной спецификации, а в дереве она есть —
    # строка «СПЕКА НЕ РАЗМЕЧЕНА» (ведущий повторяет разведчика, как при «узком маркере»). Назвал — сверяются
    # только названные: остальные спеки, скорее всего, клиентские. Названная клиентской — не сверяется никогда.
    # Операции спеки — ключи контракта, топики конфига — ключи «Событий»: у типа без такой секции (keys.py,
    # «Форма по типу») их не ищут вовсе.
    def discover() -> None:
        named = len(specre)
        wsp = K.k_typehas(TYPE, "контракт")
        wtp = K.k_typehas(TYPE, "топики")
        dspec: list = []
        for f in LIST:
            f = K.sub1(r"\r\Z", "", f)
            if f == "":
                continue
            f = np(f)
            r = rootof(f)
            if r == "":
                continue
            rel = f[len(r) + 1:]
            if istest(rel) or K.has(r"^(?:target|build|dist)/", rel):
                continue
            if wsp and K.has(r"\.ya?ml\Z", rel):
                if head_is_spec(f):
                    dspec.append(f)
        if wtp:
            for f in tcfg:
                topicsfile(f)
        for f in specre:
            specparse(f)
            ospec.append(f)
        if not named:
            for f in dspec:
                if f in clientspec:
                    continue
                specparse(f)
                if len(OP[f]) == 0:
                    continue
                ospec.append(f)
                print("СПЕКА НЕ РАЗМЕЧЕНА: %s — операций %d, строки спецификации у разведчика нет" % (f, len(OP[f])))

    fw: dict = {}
    fk: dict = {}
    fany: dict = {}
    isfile: dict = {}
    tot: dict = {}
    orn: dict = {}
    nowt: dict = {}

    # Строка счёта — в итог, вес и файлы: `ключ` (класс вне веса — без веса), `ориентир` — с весом w.
    def addcnt(path: str, cl: str, kind: str, cnt) -> None:
        if kind == "ключ" and cl in nowt:
            ck[(path, cl)] = ck.get((path, cl), 0) + cnt
            tot[cl] = tot.get(cl, 0) + cnt
            fw[path] = fw.get(path, 0) + 0
            fany[path] = 1
        elif kind == "ключ":
            ck[(path, cl)] = ck.get((path, cl), 0) + cnt
            tot[cl] = tot.get(cl, 0) + cnt
            fw[path] = fw.get(path, 0) + cnt
            fk[path] = fk.get(path, 0) + cnt
            fany[path] = 1
        else:
            co[(path, cl)] = co.get((path, cl), 0) + cnt
            orn[cl] = orn.get(cl, 0) + cnt
            fw[path] = fw.get(path, 0) + WV * cnt
        isfile[path] = 1

    SP: list = []
    SC: list = []
    SCL: list = []
    SK: list = []
    SR: list = []
    sbad: dict = {}
    sout: dict = {}
    soutf: dict = {}

    # Условие файла (`в файлах с <регэксп>`): по каждому регэкспу — один проход по файлам его строк счёта, построчно.
    # Файл без совпадения — вне условия (у строки `ключ` — в строку «вне условия файла»: счётчик их посчитал; у
    # `ориентир` — молча, в итог счётчика ориентир не идёт); файл не читается — в счёт как есть (его поймает
    # проверка путей ниже); регэксп `re` не разобрал — строки этого условия в счёт целиком.
    def scopes() -> None:
        sdone: dict = {}
        shit: dict = {}
        for i in range(len(SR)):
            r = SR[i]
            if r in sdone:
                continue
            sdone[r] = 1
            rx = compile_scout(r)
            if rx is None:
                sbad[r] = 1
                continue
            for j in range(i, len(SR)):
                if SR[j] != r:
                    continue
                try:
                    lines = K.read_lines(SP[j], bom=False)
                except OSError:
                    continue
                if any(rx.search(ln) for ln in lines):
                    shit[(r, np(SP[j]))] = 1
        for i in range(len(SR)):
            r = SR[i]
            p = SP[i]
            if r in sbad or (r, p) in shit or not can_open(p):
                addcnt(p, SCL[i], SK[i], SC[i])
                continue
            if SK[i] == "ключ":
                sout[SCL[i]] = sout.get(SCL[i], 0) + SC[i]
                soutf[SCL[i]] = soutf.get(SCL[i], 0) + 1

    sw: dict = {}
    kw: dict = {}
    rt: dict = {}
    kids: dict = {}
    inner: dict = {}
    specparts: dict = {}
    sxf: dict = {}
    sxs: dict = {}
    sxe: dict = {}

    # Файл спецификации тяжелее K: его операции режутся на ровные куски не больше K по строкам маркера в
    # самом файле, у каждого куска — своя часть с номерами, строками и именами операций. Число строк
    # маркера не сошлось со счётом или файл не читается — файл отдельной частью, как любой тяжёлый файл.
    def emitspec(c_: str) -> None:
        rx = compile_scout(specre[c_])
        cl = speccl[c_]
        m = 0
        L = [0]
        N = [""]
        lines = read_code(c_) if rx is not None else None
        for nl, ln in enumerate(lines or [], 1):
            ln = K.sub1(r"\r\Z", "", ln)
            if rx.search(ln):
                m += 1
                L.append(nl)
                nm = rx.sub("", ln, count=1)
                nm = K.gsub(r"^[ \t\"]+|[ \t\",]+\Z", "", nm)
                N.append(nm.replace("'", ""))
        if m != ck.get((c_, cl), 0) or leK(m):
            emit("файлы", [c_], sw.get(c_, 0))
            return
        q = int((m + KV - 1) / KV)
        size = int((m + q - 1) / q)
        s = 1
        while s <= m:
            e = s + size - 1
            if e > m:
                e = m
            st.np_ += 1
            names = ""
            for j in range(s, e + 1):
                if N[j] != "":
                    names = names + ("" if names == "" else ", ") + N[j]
            print("часть %02d вес %d (%s %d): файлы %s — операции %d–%d из %d, строки %d–%d"
                  % (st.np_, e - s + 1, cl, e - s + 1, c_, s, e, m, L[s], L[e]))
            partexp[(st.np_, cl)] = e - s + 1
            sxf[st.np_] = c_
            sxs[st.np_] = s
            sxe[st.np_] = e
            ptext[st.np_] = "спецификация %s, операции %d–%d из %d (строки %d–%d)%s" % (
                c_, s, e, m, L[s], L[e], ("; operationId: " + names) if names != "" else "")
            pmark[st.np_] = cl + " не меньше " + str(e - s + 1)
            prev = specparts.get(c_, "")
            specparts[c_] = prev + ("" if prev == "" else ",") + "%02d" % st.np_
            s = e + 1
        cov[c_] = 1
        partof[c_] = st.np_
        partkind[c_] = "файлы"

    # Номер части, которой принадлежит файл: сам файл либо ближайшая папка части; частей нет — «-».
    def partfor(p: str, r: str) -> str:
        if p in partof:
            return "%02d" % partof[p]
        q = parent(p)
        while True:
            if q in partof:
                return "%02d" % partof[q]
            if q == r or q == "" or "/" not in q:
                return "-"
            q = parent(q)

    # Строки заданий: ведущий передаёт каждой части её строку дословно — номер, S, свои пути, маркеры, файлы.
    def tasks(hasrest: int) -> None:
        w = PLAN_WORK
        sn = ""
        for p in specre:
            o = specparts[p] if p in specparts else (partfor(p, rt[p]) if p in rt else "-")
            if o != "-":
                sn = sn + " | операции спецификации " + p + " — только части " + o
        print("задания частей — каждой её строку дословно:")
        for i in range(1, st.np_ + 1):
            print("задание %02d из %d: свои пути — %s | маркеры — %s | опись — %s/part-%02d.opis.md | черновик — %s/part-%02d.md%s"
                  % (i, st.np_, ptext[i], pmark[i] if pmark[i] != "" else "нет", w, i, w, i, sn))
        if hasrest:
            print("задание %02d — остаток: список остатка — пункты «остаток» выше | маркеры — %s | опись — %s/part-%02d.opis.md | черновик — %s/part-%02d.md%s"
                  % (st.np_ + 1, st.restmark if st.restmark != "" else "нет", w, st.np_ + 1, w, st.np_ + 1, sn))

    # План для check.py — строками через табуляцию; без пятого аргумента ничего не пишет.
    # Обработчик операции — файл кода, где её operationId стоит словом (без учёта регистра: генераторы меняют
    # первую букву); у всех таких файлов одна часть — операция её, у разных — «?», ни одного — ключа нет.
    hown: dict = {}

    def handlers() -> None:
        hid: dict = {}
        hseen: dict = {}
        for p in ospec:
            for op in OP[p]:
                hid[K.k_low(op[2])] = 1
        wsplit = K.R(r"[^A-Za-z0-9_]+")
        for f in LIST:
            f = K.sub1(r"\r\Z", "", f)
            if f == "":
                continue
            f = np(f)
            r = rootof(f)
            if r == "":
                continue
            rel = f[len(r) + 1:]
            if (istest(rel) or K.has(r"^(?:target|build|dist)/", rel)
                    or not K.has(r"\.(?:java|kts?|scala|groovy|tsx?|jsx?|mjs|cjs|py|go|rb|php|cs|rs|exs?)\Z", rel)):
                continue
            o = partfor(f, r)
            for ln in read_code(f) or []:
                for w in ([] if ln == "" else wsplit.split(ln)):
                    w = K.k_low(w)
                    if w in hid and (w, o) not in hseen:
                        hseen[(w, o)] = 1
                        hown[w] = "?" if w in hown else o

    rrk: list = []
    rrp: list = []

    def dump() -> None:
        if TSV == "":
            return
        out: list = []
        fl = K.csort([p for p in rt if p in fany])
        v: dict = {}
        for p in fl:
            for cl in clist:
                v[cl] = v.get(cl, 0) + ck.get((p, cl), 0)
        for cl in clist:
            if v.get(cl, 0) > 0:
                out.append("итог\t" + cl + "\t" + tostr(v[cl]) + "\n")
        for i in range(1, st.np_ + 1):
            for cl in clist:
                if (i, cl) in partexp:
                    out.append("часть\t%02d\t%s\t%d\n" % (i, cl, partexp[(i, cl)]))
        for p in K.csort(list(partof)):
            if p in specparts:
                for x in K.awk_split(specparts[p], ","):
                    out.append("путь\t%s\t%s\t%s\n" % (p, partkind[p], x))
            else:
                out.append("путь\t%s\t%s\t%02d\n" % (p, partkind[p], partof[p]))
        # Хозяин файла — часть, чьи пути его покрывают; файл вне частей (бывает только у класса вне веса) — остатку.
        for p in fl:
            for cl in clist:
                if ck.get((p, cl), 0) > 0:
                    o = specparts[p] if p in specparts else partfor(p, rt[p])
                    if o == "-" and st.np_ > 0:
                        o = "%02d" % (st.np_ + 1)
                    out.append("файл\t" + p + "\t" + cl + "\t" + tostr(ck[(p, cl)]) + "\t" + o + "\n")
        for i in range(len(rrk)):
            out.append("остаток\t%02d\t%s\t%s\n" % (st.np_ + 1, rrk[i], rrp[i]))
        # операция <МЕТОД> <путь> <operationId> <спецификация> <часть | ->; топик <имя> <конфиг>. Часть — как в
        # строках заданий: части спецификации (кусок, иначе часть её файла), а их нет — часть обработчика.
        for p in ospec:
            po = partfor(p, rt[p]) if (p in specre and p in rt) else "-"
            for j, op in enumerate(OP[p], 1):
                ow = po
                for c_ in range(1, st.np_ + 1):
                    if sxf.get(c_, "") == p and sxs[c_] <= j <= sxe[c_]:
                        ow = "%02d" % c_
                if ow == "-" and st.np_ > 0:
                    if not st.hdone:
                        handlers()
                        st.hdone = 1
                    k = K.k_low(op[2])
                    if k in hown and hown[k] != "?":
                        ow = hown[k]
                out.append("операция\t%s\t%s\t%s\t%s\t%s\n" % (op[0], op[1], op[2], p, ow))
        for i in range(len(tname)):
            out.append("топик\t%s\t%s\n" % (tname[i], tfile[i]))
        K.write_text(TSV, "".join(out))

    # Делит узел dir: дети-папки с ключами пакуются подряд, тяжёлые — рекурсивно; свои файлы с ключами — подряд.
    def cutdir(d: str) -> None:
        inner[d] = 1
        ch = K.csort(list(kids.get(d, {})))
        cur: list = []
        s = 0
        fl: list = []
        for c_ in ch:
            if kw.get(c_, 0) == 0:
                continue
            if isfile.get(c_):
                fl.append(c_)
                continue
            if gtK(sw.get(c_, 0)):
                if cur:
                    emit("папки", cur, s)
                    cur = []
                    s = 0
                cutdir(c_)
                continue
            if gtK(s + sw.get(c_, 0)) and cur:
                emit("папки", cur, s)
                cur = []
                s = 0
            cur.append(c_)
            s += sw.get(c_, 0)
        if cur:
            emit("папки", cur, s)
        curf: list = []
        sf = 0
        for c_ in fl:
            if c_ in specre and gtK(sw.get(c_, 0)):
                if curf:
                    emit("файлы", curf, sf)
                    curf = []
                    sf = 0
                emitspec(c_)
                continue
            if gtK(sf + sw.get(c_, 0)) and curf:
                emit("файлы", curf, sf)
                curf = []
                sf = 0
            curf.append(c_)
            sf += sw.get(c_, 0)
        if curf:
            emit("файлы", curf, sf)

    # ── Разбор файла счёта ──
    try:
        text = K.read_text(COUNTS)                      # BOM снимается — как sub(/^\357\273\277/) на NR == 1
    except OSError:
        sys.stderr.write("plan.py: не открывается %s\n" % COUNTS)
        return 2
    cl = ""
    kind = ""
    skipcl = ""
    scope = ""
    hdr = badh = bad = ctlbad = 0
    badh1 = bad1 = ctlbad1 = ""
    seencl: dict = {}
    dropo: list = []
    dropn: dict = {}
    ctlc: list = []
    ctlr: list = []
    ctlf: list = []
    ctln: list = []

    def hsplit(rec: str) -> list:
        h = rec[3:]
        return [""] + ([] if h == "" else h.split(" :: "))

    def trim(s: str) -> str:
        return K.gsub(r"^[ \t]+|[ \t]+\Z", "", s)

    for rec in K.lines_of(text):
        rec = K.sub1(r"\r\Z", "", rec)
        # Контроль разведчика: «## контроль :: <класс> :: <файл> :: <число>» — не класс счёта.
        if K.has(r"^## контроль[ \t]*::", rec):
            hp = hsplit(rec)
            n = len(hp) - 1
            cl = ""
            skipcl = ""
            for i in range(1, n + 1):
                hp[i] = K.gsub(r"[`\"]", "", trim(hp[i]))
            if n == 4 and hp[2] != "" and K.has(r"^[0-9]+\Z", hp[4]):
                hp[2] = K.sub1(r"[ \t].*\Z", "", hp[2])
                if not K.k_typehas(TYPE, hp[2]):
                    continue
                ctlc.append(hp[2])
                ctlr.append(hp[3])
                ctlf.append(full(hp[3]))
                ctln.append(int(hp[4]))
            else:
                ctlbad += 1
                if ctlbad1 == "":
                    ctlbad1 = bhead(rec, 160)
            continue
        # Конфиг топиков разведчика: «## конфиг топиков :: <файл>» — не класс счёта; имена топиков из него — строки плана «топик».
        if K.has(r"^## конфиг топиков[ \t]*::", rec):
            hp = hsplit(rec)
            cl = ""
            skipcl = ""
            sp = K.gsub(r"[`\"]", "", trim(hp[len(hp) - 1]))
            if sp != "":
                tcfg[full(sp)] = 1
            continue
        # Клиентская спека разведчика: «## клиентская спека :: <файл>» — не класс счёта; в сверку и вес не идёт.
        if K.has(r"^## клиентская спека[ \t]*::", rec):
            hp = hsplit(rec)
            cl = ""
            skipcl = ""
            sp = K.gsub(r"[`\"]", "", trim(hp[len(hp) - 1]))
            if sp != "":
                clientspec[full(sp)] = 1
            continue
        if rec.startswith("## "):
            hp = hsplit(rec)
            n = len(hp) - 1
            skipcl = ""
            scope = ""
            cl = trim(hp[1] if n >= 1 else "")
            kind = trim(hp[n] if n >= 1 else "")
            kind = K.sub1(r"[ \t]*\(.*\Z", "", kind)    # пометка счётчика: «ключ (без маски)» — всё равно ключ
            hdr += 1
            if n < 2 or cl == "" or (kind != "ключ" and kind != "ориентир"):
                badh += 1
                if badh1 == "":
                    badh1 = bhead(rec, 160)
            # Класс, секции которого у типа нет (keys.py, «Форма по типу»), — мимо итога, веса и плана, числом в вывод.
            w1 = K.sub1(r"[ \t].*\Z", "", cl)
            if cl != "" and not K.k_typehas(TYPE, w1):
                skipcl = w1
                if w1 not in dropn:
                    dropo.append(w1)
                    dropn[w1] = 0
                cl = ""
                continue
            # Класс вне веса (`клиенты`): счёт тот же, что у остальных классов, только в вес нарезки он не идёт.
            w1 = K.sub1(r"[ \t].*\Z", "", cl)
            if w1 == "клиенты":
                cl = w1
                nowt[cl] = 1
            # условие файла: «класс :: регэксп :: маска :: в файлах с <регэксп файла> :: ключ|ориентир»;
            # строка спецификации разведчика: «класс :: регэксп :: маска :: <файл спецификации> :: ключ»
            if n >= 5 and K.has(r"^[ \t]*в файлах с[ \t]", hp[n - 1]):
                scope = K.sub1(r"^[ \t]*в файлах с[ \t]+", "", hp[n - 1])
                scope = K.gsub(r"^[ \t`]+|[ \t`]+\Z", "", scope)
            elif n >= 5 and kind == "ключ":
                sp = full(trim(hp[n - 1]))
                specre[sp] = trim(hp[2])
                speccl[sp] = cl
            if cl not in seencl:
                seencl[cl] = 1
                clist.append(cl)
            continue
        if skipcl != "" and K.has(r":[0-9]+[ \t]*\Z", rec):
            cnum = K.sub1(r".*:", "", K.sub1(r"[ \t]+\Z", "", rec))
            dropn[skipcl] += int(cnum)
            continue
        if cl == "":
            continue
        if K.has(r":[0-9]+[ \t]*\Z", rec):
            line = K.sub1(r"[ \t]+\Z", "", rec)
            cnum = K.sub1(r".*:", "", line)
            path = full(line[:len(line) - len(cnum) - 1])
            cnt = int(cnum)
            if cnt == 0:
                continue
            if scope != "":
                SP.append(path)
                SC.append(cnt)
                SCL.append(cl)
                SK.append(kind)
                SR.append(scope)
                continue
            addcnt(path, cl, kind, cnt)
            continue
        # Путь к файлу без счёта в конце — совпадение текстом либо список файлов: греп снят не в режиме счёта.
        if K.has(r"^[^ \t#].*\.[A-Za-z0-9]+:", rec) or (K.has(r"[/\\]", rec) and K.has(r"\.[A-Za-z0-9]+[ \t]*\Z", rec)):
            bad += 1
            if bad1 == "":
                bad1 = bhead(rec, 160)

    # ── Итог (END) ──
    if hdr == 0:
        print("ОТКАЗ: в файле счёта нет заголовков «## <класс> :: … :: ключ|ориентир»")
        return 3
    if badh > 0:
        print("ОТКАЗ: заголовков не по форме «## <класс> :: … :: ключ|ориентир»: %d; первый: %s" % (badh, badh1))
        return 3
    if bad > 0:
        print("ОТКАЗ: счёт неполон — строк не по форме <путь>:<число>: %d; первая: %s" % (bad, bad1))
        return 3
    scopes()
    # Корень на диске, а файла из счёта там нет — путь записан не от корня либо это не путь.
    ghost = 0
    ghost1 = ""
    for p in fw:
        best = rootof(p)
        if best == "" or not ondisk[best]:
            continue
        if not can_open(p):
            ghost += 1
            if ghost1 == "" or K.bkey(p) < K.bkey(ghost1):
                ghost1 = p
    if ghost > 0:
        print("ОТКАЗ: путей счёта, которых нет на диске: %d; первый: %s" % (ghost, ghost1))
        return 3
    # Корень файла — самый длинный подходящий корень; файлы вне корней и тестовые — в план не идут.
    outside = 0
    tw = 0
    total = 0
    ktotal = 0
    tdir: dict = {}
    tl: list = []
    tk: dict = {}
    to: dict = {}
    for p in list(fw):
        best = rootof(p)
        if best == "":
            outside += fw[p]
            continue
        if istest(p[len(best) + 1:]):
            tw += fw[p]
            q = parent(p)
            if q not in tdir:
                tdir[q] = 1
                tl.append(q)
            for cl in clist:
                tk[cl] = tk.get(cl, 0) + ck.get((p, cl), 0)
                to[cl] = to.get(cl, 0) + co.get((p, cl), 0)
            continue
        rt[p] = best
        sw[p] = sw.get(p, 0) + fw[p]
        kw[p] = kw.get(p, 0) + fk.get(p, 0)
        for cl in clist:
            for arr in (ck, co):
                if (p, cl) in arr:
                    q = parent(p)
                    while True:
                        arr[(q, cl)] = arr.get((q, cl), 0) + arr[(p, cl)]
                        if q == best:
                            break
                        q = parent(q)
        q = parent(p)
        while True:
            sw[q] = sw.get(q, 0) + fw[p]
            kw[q] = kw.get(q, 0) + fk.get(p, 0)
            if q == best:
                break
            q = parent(q)
        c_ = p
        q = parent(c_)
        while True:
            kids.setdefault(q, {})[c_] = 1
            if q == best:
                break
            c_ = q
            q = parent(q)
        total += fw[p]
        ktotal += fk.get(p, 0)
    if outside > 0 and total == 0 and tw == 0:
        print("ОТКАЗ: все пути счёта вне корней сервиса (вес %s) — плана нет" % G(outside))
        return 3
    line = "итог по классам: " + sums(tot, "")
    o = sums(orn, "")
    if o != "":
        line = line + " | ориентир: " + o
    print(line)
    # Условие файла — счётчик эти совпадения считал, в итог они не вошли: ведущий прибавляет их при сверке.
    for cl in clist:
        if sout.get(cl, 0) > 0:
            print("вне условия файла: %s %d в файлах %d" % (cl, sout[cl], soutf[cl]))
    for r in sbad:
        print("условие файла не разобрано: %s — строка счёта целиком" % r)
    for d in dropo:
        print("класс %s: у типа %s секции нет — пометок %d, не считаются" % (d, TYPE, dropn[d]))
    # Вне веса — справочно: класс `клиенты` в итоге выше, но в вес и части не идёт.
    line = ""
    for cl in nowt:
        if tot.get(cl, 0) > 0:
            line = line + ("" if line == "" else "; ") + cl + " — в вес и нарезку не идёт"
    if line != "":
        print("вне веса: " + line)
    if outside > 0:
        print("вне корней сервиса: вес %s — в план не вошло" % G(outside))
    if tw > 0:
        line = sums(tk, "")
        o = sums(to, "ориентир ")
        tl = K.csort(tl)
        line = "в тестовых папках: " + line + (", " if line != "" and o != "" else "") + o + " — в план и в сверку не идут: "
        for i in range(min(len(tl), 5)):
            line = line + ("; " if i > 0 else "") + tl[i]
        if len(tl) > 5:
            line = line + "; …и ещё %d" % (len(tl) - 5)
        print(line)
        nk: dict = {}
        no: dict = {}
        for cl in clist:
            nk[cl] = tot.get(cl, 0) - tk.get(cl, 0)
            no[cl] = orn.get(cl, 0) - to.get(cl, 0)
        line = "к сверке: " + sums(nk, "")
        o = sums(no, "")
        if o != "":
            line = line + " | ориентир: " + o
        print(line)
    # Контроль разведчика: маркер класса в его файле против числа, которое разведчик видел глазами.
    allf: dict = {}
    if ctlc:
        for f in LIST:
            f = K.sub1(r"\r\Z", "", f)
            if f != "":
                allf[np(f)] = 1

    # Путь контроля, которого нет как есть: единственный файл счёта или дерева с тем же хвостом пути —
    # от полного хвоста к имени файла; на уровне, где совпадений больше одного, — не найден.
    def ctlfind(raw: str) -> str:
        t = raw.replace("\\", "/")
        t = K.sub1(r"^(?:\./)+", "", t)
        t = K.sub1(r"/+\Z", "", t)
        seg = K.awk_split(t, "/")
        n = len(seg)
        for k in range(n, 0, -1):
            tail = "/".join(seg[n - k:])
            if tail == "":
                continue
            cnt = 0
            hit = ""
            for f in fw:
                if f == tail or f.endswith("/" + tail):
                    if f != hit:
                        cnt += 1
                        hit = f
            for f in allf:
                if f not in fw and (f == tail or f.endswith("/" + tail)):
                    cnt += 1
                    hit = f
            if cnt == 1:
                return hit
            if cnt > 1:
                return ""
        return ""

    for i in range(len(ctlc)):
        p = ctlf[i]
        if p not in fw and p not in allf:
            p = ctlfind(ctlr[i])
        if p == "":
            print("контроль %s не сверен: файла «%s» нет ни в счёте, ни в дереве сервиса" % (ctlc[i], ctlr[i]))
            continue
        m = ck.get((p, ctlc[i]), 0)
        if m * 2 < ctln[i]:
            print("УЗКИЙ МАРКЕР: %s — маркер дал %d в %s, разведчик видел %d" % (ctlc[i], m, p, ctln[i]))
        else:
            print("контроль %s: маркер дал %d в %s, разведчик видел %d — сходится" % (ctlc[i], m, p, ctln[i]))
    if ctlbad > 0:
        print("контроль не по форме «## контроль :: <класс> :: <файл> :: <число>»: %d; первый: %s" % (ctlbad, ctlbad1))
    discover()
    if not K.k_typesplit(TYPE):
        print("нарезка не нужна: тип %s не режется (вес %s)" % (TYPE, G(total)))
        dump()
        return 0
    # Решает вес ключей: число ориентира зависит от маркера, который выбрал разведчик, — части он только раскладывает.
    if leK(ktotal):
        if total > ktotal:
            print("нарезка не нужна: вес по ключам %s ≤ K=%s (ориентир %s в решение не идёт)" % (G(ktotal), G(KV), G(total - ktotal)))
        else:
            print("нарезка не нужна: вес %s ≤ K=%s" % (G(total), G(KV)))
        dump()
        return 0
    print("вес сервиса %s при K=%s, w=%s" % (G(total), G(KV), G(WV)))
    for r in root:
        if kw.get(r, 0) == 0:
            continue
        if leK(sw.get(r, 0)):
            emit("папки", [r], sw.get(r, 0))
            continue
        cutdir(r)
    # Ориентир вне частей — остатку, числом и файлом.
    ol: list = []
    rsum: dict = {}
    for p in rt:
        if kw.get(p, 0) == 0 and not covered(p, rt[p]):
            for cl in clist:
                if co.get((p, cl), 0) > 0:
                    ol.append(p + " — " + cl + " " + tostr(co[(p, cl)]))
                    rsum[cl] = rsum.get(cl, 0) + co[(p, cl)]
    for cl in clist:
        if rsum.get(cl, 0) > 0:
            st.restmark = st.restmark + ("" if st.restmark == "" else ", ") + cl + " около " + tostr(rsum[cl]) + " (ориентир)"
    if ol:
        ol = K.csort(ol)
        line = "остатку по ориентиру: " + "; ".join(ol[:20])
        if len(ol) > 20:
            line = line + "; …и ещё %d" % (len(ol) - 20)
        print(line)
    # Остаток списком: папки целиком вне частей и «файлы прямо в папке» у разрезанных папок.
    seen = 0
    loose: dict = {}
    lo: list = []
    rem: dict = {}
    rl: list = []
    for f in LIST:
        f = K.sub1(r"\r\Z", "", f)
        if f == "":
            continue
        seen = 1
        f = np(f)
        r = rootof(f)
        if r == "":
            continue
        rel = f[len(r) + 1:]
        if K.has(r"^(?:target|build|dist)/", rel) or istest(rel) or covered(f, r):
            continue
        top = ""
        q = parent(f)
        while True:
            if q not in inner:
                top = q
            if q == r:
                break
            q = parent(q)
        if top == "":
            q = parent(f)
            if q not in loose:
                loose[q] = 1
                lo.append(q)
        elif top not in rem:
            rem[top] = 1
            rl.append(top)
    if not seen:
        print("частей %d; остаток — всё вне папок и файлов частей (дерева корней на диске нет)" % st.np_)
        tasks(1)
        dump()
        return 0
    if len(rl) + len(lo) == 0:
        print("частей %d; остаток — пусто: вне частей файлов нет" % st.np_)
        tasks(0)
        dump()
        return 0
    if len(rl) + len(lo) > 60:
        print("частей %d; остаток — всё вне папок и файлов частей (пунктов больше 60 — список не печатается)" % st.np_)
        tasks(1)
        dump()
        return 0
    rl = K.csort(rl)
    lo = K.csort(lo)
    print("частей %d; остаток — пунктов %d:" % (st.np_, len(rl) + len(lo)))
    for x in rl:
        print("  папка " + x)
        rrk.append("папка")
        rrp.append(x)
    for x in lo:
        print("  файлы прямо в " + x)
        rrk.append("файлы")
        rrp.append(x)
    tasks(1)
    dump()
    return 0


if __name__ == "__main__":
    sys.exit(main())
