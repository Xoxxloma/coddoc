# check.py — счёты Шага 4 и гарда по файлам, без чтения их моделью.
#
#   python3 check.py [ИМЯ=значение …] <опись> <черновик> [<прежняя карточка>]
#   CHECK_LISTS=<файл> — туда пишется перечень добора целиком, без обрезки на 40 именах.
#   CHECK_PLAN=<plan.tsv> — файл плана от plan.py (пятый аргумент): вердикт маркерного гейта и сверка
#     «пометки файла ↔ ключи описи».
#   CHECK_PARTS=<папка частей> — нарезанный сервис: гейт ещё и по каждой части, перечень добора по авторам.
#   CHECK_PREFIX=<префикс> — общий префикс пути от разведчика: ключи REST без него — в перечень добора.
#   Переменные — аргументами `ИМЯ=значение` перед позиционными (иначе — из окружения); `--out <файл>` — вывод в файл.
#
# Печатает: состав черновика по секциям и ключи карточки по классам (для маркерного гейта); ключи
# описи и строки без файла-источника; сверку «опись → черновик» поключево — справку и перечень
# добора, запись карточки она не останавливает; при третьем аргументе — гард по классам и маршрут.
# Списки в выводе обрезаются на 40 именах.
# Только чтение; пишет лишь в stdout (и файлы перечня по CHECK_LISTS). Формат карточки — reference/card.template.md.
#
# Порт check.sh 1:1: те же строки, те же «файлы» промежуточных шагов (списки строк в памяти), та же
# семантика awk под LC_ALL=C — поля по табу, strnum, сортировка по байтам, обрезка и общее начало — по байтам.
import sys

sys.dont_write_bytecode = True
import fnmatch
import os
import re

try:
    import keys as K
except ImportError:
    print("НЕТ ФАЙЛА: %s/keys.py — скилл установлен не целиком" % os.path.dirname(os.path.abspath(__file__)).replace("\\", "/"))
    sys.exit(2)

R, sub1, gsub, has = K.R, K.sub1, K.gsub, K.has
ERR = K.ERR

# Виды пунктов добора — одна таблица «вид<TAB>имя в строке ДОБОР<TAB>заголовок раздела перечня»: перечень,
# раздача по авторам и файлы перечня идут по ней; новый вид — одна строка здесь.
KINDS_TXT = """\
ADD	нет блока	ключ описи с источником — блока в карточке нет
NOSRC	нет источника	блок в карточке есть, у ключа описи нет файла-источника — назвать файл либо убрать ключ из обоих файлов
EMPTY	пустой блок	факт в описи — блок пуст
DUP	дубль	один ключ двумя блоками
nometh	без метода	ключ контракта без метода
NOKEY	не ключ	заголовок не сводится к ключу шаблона — запиши ключом: в «Событиях» направление и топик в бэктиках, у задачи и сущности имя как в коде; не ключ — убери блок из черновика и описи
NOPFX	без префикса	ключ REST без общего префикса — поправь путь; вне префикса — только с источником, где ручка зарегистрирована
MARKFILE	ключей меньше пометок	в файле пометок больше, чем ключей описи с этим источником — найди недостающие ключи в файле; операцию спецификации без обработчика пиши ключом со строкой `недоступно: объявлено без реализации`
MISSED	пропущено частью	пропущено частью — проверь ключ по источнику и допиши карточку и опись
DECL	недоступно без пометки	у ключа в описи строка `недоступно:`, а в карточке пометки нет — допиши первой из строк `- ` блока `- недоступно: <почему>` (у строки таблицы — словом «недоступно» в последней колонке); ключ работает — убери строку `недоступно:` из описи
PARTEMPTY	блоки части без фактов	у части больше половины блоков контракта без фактов — допиши факты из кода в эти блоки; факта в коде нет — блок оставь, не выдумывай
RULES	правила частей	строки «Бизнес-правил» описей частей, которых нет в секции — допиши по описям частей (`<описи частей>`) и коду: сущность — блоком, значение — строкой с токеном в бэктиках, имя сообщения — в бэктиках в строке его блока
REST	пункт остатка не пройден	пункт списка остатка без строки «> пройдено:» в описи — пройди пункт по брифу остатка и допиши строку описи `> пройдено: <пункт> — ключей N`
SPEC	операция спецификации	операция спецификации без блока в карточке — найди её обработчик по `operationId` — код, который принимает этот запрос (маппинг, реализация интерфейса API; вызов клиента к соседу — не обработчик), — и допиши блок и строку описи, метод и путь — из спецификации, с её базовым путём впереди (`servers: - url:`, у Swagger 2 — `basePath`); обработчика нет — блок и ключ описи со строкой `недоступно: объявлено без реализации`
TOPICS	топики	топики без блоков «Событий» — найди их слушатели и отправители и допиши блоки и строки описи; имя топика — из конфига, как в строке ниже
SLOT	нет метки	блок «Событий» или задачи без строки-метки — допиши строку по коду; факта в коде нет — `не определено: <где>`
GLUED	склеенная возможность	строка «Что умеет» с двумя действиями — разбей на строки, по действию в строке; кому доступно — в каждой
INFRA	инфраструктура	«Зависит от» — инфраструктура из «Стека», а не сосед — убери строку из черновика и строку `зависит:` из описи
ENTRY	нет строки вход	в описи нет строки `вход:` — допиши, как запрос получает пользователя и права (фильтр, интерсептор, откуда берётся токен, что в режиме по умолчанию (вход не настроен)), с файлом, и строку `вход` в «Роли и доступ»; в коде этого нет — `вход: не определено: в коде нет`
DEP	сосед без строки	сосед из строки `зависит:` описи без строки «Зависит от» — допиши строку соседа (один сосед — одна строка), зачем — из строки описи
STATE	перечисление без блока	перечисление своей сущности меняют строки `меняет:`, а блока сущности в «Бизнес-правилах» нет и строки `состояние:` с этим полем в описи нет — открой поле в коде: значение меняется по ходу жизни записи или это вид записи (у значения — условие, при котором запись появляется, и следствие) — допиши блок сущности по форме шаблона, читающий — и строку `состояние:` в опись вместо строки `справочник:` этого поля; справочник, от значений которого не зависит ни одно правило, и роль пользователя (её описывают «Роли и доступ») — блок не пиши
BRHDR	заголовок правил	заголовок блока «Бизнес-правил» не по форме: блок начинается с имени сущности в бэктиках или с `сообщение «<вид>»`; «письмо», «событие», «ограничение», подпись впереди ключа, `Сущность.поле` — перепиши заголовок ключом, блок объекта — один на сущность
BRCODE	код в правилах	строка «Бизнес-правил» с кодом вне бэктиков — путь, HTTP-глагол, идентификатор в camelCase, имя через точки: перепиши словами предметной области; в бэктиках — только значение перечисления, имя вида или топика, имя сервиса из манифеста и дата; в заголовке сообщения бэктиков нет
USERCODE	код для пользователя	строка «Назначения» или колонки «Возможность» в «Что умеет» с кодом — путь, HTTP-глагол, имя файла или компонента, идентификатор в camelCase, в «Назначении» и текст в бэктиках: перепиши словами пользователя; колонку «Для кого» не трогай
TAILFILE	хвост-файл	строка кончается путём к файлу — это строка описи не в той части: убери хвост, факт оставь
CELLS	слипшаяся ячейка	в ячейке ключа строки таблицы — перечисление через запятую: разбей на строки, по ключу в строке, остальные ячейки — в каждой
NOENT	без сущностей	блок «Публичного контракта» без строки `сущности:` — допиши вход и выход именами из «Владеет данными» этой карточки; не сущность — `→ не сущность, ответ <сервис>` или `→ не сущность, агрегат по …`
ORDER	порядок блоков	блоки секции не по возрастанию ключа (пути — лексикографически, имена — по алфавиту, в «Событиях» сначала все `потребляет`, потом `публикует`): переставь блоки, текст не меняй
SECS	секции не по шаблону	секции `##` не по таблице порядка шаблона для типа карточки: переставь, недостающую допиши по форме шаблона, лишнюю убери, заголовок — дословно как в шаблоне
"""
# Виды формы черновика (BRHDR … SECS) — их счёт ведущий раньше делал грепом по черновику. Правила (Шаг 4 SKILL.md):
#  BRHDR — заголовок `###` «Бизнес-правил» не с `` `Имя` `` и не с `сообщение «`;
#  BRCODE — строка «Бизнес-правил» с кодом вне бэктиков: ` /[a-z]`, HTTP-глагол словом, camelCase, `a.b.c`;
#  USERCODE — тот же код в «Назначении» (и любой бэктик там) и в колонке «Возможность» «Что умеет»;
#  TAILFILE — строка кончается путём к файлу `имя/имя.расш` (в бэктиках, скобках, после тире, голый);
#  CELLS — в первой ячейке строки «Экранов», «Ролей и доступа», «Зависит от», «Потребляемых API» есть «, »;
#  NOENT — блок «Публичного контракта» (кроме health, metrics, ready, live, version, docs, swagger, openapi) без
#    строки `сущности:` без отступа;
#  ORDER — в секции блок с ключом меньше предыдущего (HTTP — путь, потом глагол; «Бизнес-правила» не сверяются),
#    первое нарушение в секции;
#  SECS — заголовки `##` против колонки типа (`type:` шапки черновика) в таблице порядка `card.template.md` рядом со
#    скриптом: нет секции, лишняя, дважды, не по порядку; «Заметки команды» без notes — не расхождение.
# Автор у нарезанного: секции частей (k_partsec) — автор блока или строки по ключу, остальное — голова.
KINDS = []
NM = {}
TITLE = {}
for _l in K.lines_of(KINDS_TXT):
    _f = _l.split("\t")
    KINDS.append(_f[0])
    NM[_f[0]] = _f[1]
    TITLE[_f[0]] = _f[2]

HTTPRE = r"^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)"
SEPROW = r"^\|[ \t:|-]*\Z"     # строка-разделитель таблицы |---|
P_DECL = "> объявлено без реализации: "
P_MISS = "> пропущено частью: "
P_DONE = "> пройдено: "
TBL = ("экраны", "роли", "зависит", "потребляет", "состояние")

# ---------------------------------------------------------------------------------------------------------------
# Семантика awk/sh, которая нужна здесь.

_NUM = re.compile(r"[ \t\n\r\f\v]*[-+]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][-+]?[0-9]+)?[ \t\n\r\f\v]*\Z")
_NUMPFX = re.compile(r"[ \t\n\r\f\v]*([-+]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][-+]?[0-9]+)?)")


def bb(s: str) -> bytes:
    return s.encode("utf-8", ERR)


def ub(x: bytes) -> str:
    return x.decode("utf-8", ERR)


def isnum(s: str) -> bool:
    """Поле похоже на число (strnum awk)."""
    return _NUM.match(s) is not None


def anum(s: str) -> float:
    """Строка → число, как awk: числовое начало, иначе 0."""
    m = _NUMPFX.match(s)
    return float(m.group(1)) if m else 0.0


def acmp(x: str, y: str) -> int:
    """Сравнение двух полей awk: оба похожи на число — как числа, иначе — строки по байтам."""
    if isnum(x) and isnum(y):
        p, q = anum(x), anum(y)
        return (p > q) - (p < q)
    p2, q2 = bb(x), bb(y)
    return (p2 > q2) - (p2 < q2)


def acmpn(x: str, n) -> int:
    """Поле против числа: поле похоже на число — как числа, иначе — со строкой числа."""
    if isnum(x):
        p = anum(x)
        return (p > n) - (p < n)
    p2, q2 = bb(x), bb(K.num(n))
    return (p2 > q2) - (p2 < q2)


def aeq(x: str, y: str) -> bool:
    return acmp(x, y) == 0


def T(line: str) -> list:
    """Поля -F'\\t'."""
    return line.split("\t")


def at(fs: list, i: int) -> str:
    """$i (с 1); за NF — ""."""
    return fs[i - 1] if 0 < i <= len(fs) else ""


def asplit(s: str, sep: str) -> list:
    """split() awk с разделителем-строкой: у пустой строки — 0 элементов."""
    return [] if s == "" else s.split(sep)


def fields(s: str) -> list:
    """FS по умолчанию: серии пробелов, табов и переводов строки, края срезаны."""
    return [x for x in re.split(r"[ \t\n]+", s) if x != ""]


def strip1cr(s: str) -> str:
    """sub(/\\r$/, "") и sed 's/\\r$//'."""
    return s[:-1] if s.endswith("\r") else s


def sedcr(t: str) -> str:
    """sed 's/\\r$//' над текстом целиком (последняя строка без перевода — тоже)."""
    return "\n".join(strip1cr(x) for x in t.split("\n"))


def basename(p: str, suf: str = "") -> str:
    if p == "":
        return ""
    q = p.rstrip("/")
    if q == "":
        return "/"
    q = q[q.rfind("/") + 1:]
    if suf and q != suf and q.endswith(suf):
        q = q[:-len(suf)]
    return q


def dirname(p: str) -> str:
    q = p.rstrip("/")
    if q == "":
        return "/" if p.startswith("/") else "."
    i = q.rfind("/")
    if i < 0:
        return "."
    q = q[:i].rstrip("/")
    return q if q != "" else "/"


def glob1(d: str, pat: str) -> list:
    """`"$d"/<шаблон>` у bash под LC_ALL=C: совпавшие имена по байтам, иначе — сам шаблон."""
    try:
        names = os.listdir(K.fpath(d))
    except OSError:
        names = []
    hits = K.csort(n for n in names if fnmatch.fnmatchcase(n, pat))
    if not hits:
        return [d + "/" + pat]
    return [d + "/" + n for n in hits]


def nonempty(p: str) -> bool:
    """[ -s p ]."""
    try:
        return os.stat(K.fpath(p)).st_size > 0
    except OSError:
        return False


_CACHE: dict = {}
UNREAD: list = []


def rtext(p: str) -> str:
    if p not in _CACHE:
        try:
            _CACHE[p] = K.read_text(p)
        except OSError:
            UNREAD.append(p)
            _CACHE[p] = ""
    return _CACHE[p]


def rlines(p: str) -> list:
    return K.lines_of(rtext(p))


def lst(ls: list) -> str:
    """list(): до 40 имён через «; »."""
    s = "; ".join(ls[:40])
    if len(ls) > 40:
        s += "; …и ещё %d" % (len(ls) - 40)
    return s + "\n"


# ---------------------------------------------------------------------------------------------------------------
# Разбор карточки в строки «класс<TAB>ключ<TAB>строк-тела<TAB>?<TAB>недоступно». Классы — как в гарде SKILL.md:
# контракт, сущности, задачи, топики (блоки ###), экраны, роли, зависит, потребляет (таблицы),
# бизнес (блоки «Бизнес-правил» — в гард не идут, в сверку идут). Ключ блока контракта, «Событий»,
# задач и данных — по шаблону (keys.py); заголовок, который к ключу не сводится, — как есть, с «?».

def norm(s: str) -> str:
    s = s.replace("`", "")
    s = s.replace("\r", "")
    s = sub1(r"^[ \t]+", "", s)
    s = sub1(r"[ \t]+\Z", "", s)
    s = gsub(r"[ \t]+", " ", s)
    v = sub1(r" .*", "", s)
    if has(HTTPRE + r"\Z", K.k_up(v)):
        s = K.k_up(v) + s[len(v):]
    if has(r"^(сообщение|ограничение) ", s):
        s = gsub("«|»", "", s)
        s = gsub(r"[ \t]+", " ", s)
        s = sub1(r"[ \t]+\Z", "", s)
    return s


def parse_card(path: str, orphan: bool = False) -> list:
    """orphan — файл части: блоки до первого `## ` (часть не написала заголовок секции) — в секцию по форме
    ключа каждого блока, как их кладёт assemble.py: ключ контракта — «Публичный контракт», топика — «События»,
    иначе блок не считается."""
    out = []
    c = ""
    sec = ""
    key = ""
    body = 0
    bad = ""
    un = 0
    pend = ""
    pc = ""
    orph = 0

    # Пятое поле — пометка «недоступно»: у блока строка `- недоступно…`, у строки таблицы — слово в строке.
    def flush():
        nonlocal key, body, un
        if key != "":
            out.append(c + "\t" + key + "\t" + str(body) + "\t" + bad + "\t" + str(un))
        key = ""
        body = 0
        un = 0

    # Строка таблицы откладывается: за ней разделитель — это заголовок, иначе данные (части пишут строки
    # «Зависит от» и «Потребляемых API» без заголовка таблицы).
    def rowout():
        nonlocal pend
        if pend == "":
            return
        cell = asplit(pend, "|")
        u = 1 if "недоступно" in pend else 0
        pend = ""
        k = norm(at(cell, 2))
        if pc == "потребляет":
            k = k + " :: " + K.k_opis(at(cell, 3))
        if pc == "роли":   # область в скобках — часть ключа (гард сводит её, k_role)
            p = k.find(" — ")
            if p >= 0:
                k = k[:p]
        if k == "" or k == "—" or k == "— :: ":
            return
        out.append(pc + "\t" + k + "\t0\t\t" + str(u))

    for line in rlines(path):
        line = strip1cr(line)
        if not line.startswith("|"):
            rowout()
        if line.startswith("## "):   # класс секции — keys.py, «Форма по типу»
            flush()
            sec = line
            c = K.k_cls(sec)
            orph = 0
            continue
        if line.startswith("### "):
            flush()
            if orphan and (sec == "" or orph):
                orph = 1
                h = line[4:]
                p = h.find(" — ")
                if p >= 0:
                    h = h[:p]
                sec, c = "", ""
                if K.k_canon("контракт", h) != "":
                    sec, c = "## Публичный контракт", "контракт"
                elif K.k_canon("топики", h) != "":
                    sec, c = "## События", "топики"
            if c == "" or c in ("экраны", "роли", "зависит", "потребляет", "состояние"):
                continue
            h = line[4:]
            p = h.find(" — ")
            if p >= 0:
                h = h[:p]
            bad = ""
            body = 0
            un = 0
            if has(r"^## (Публичный контракт|Владеет данными|Фоновые задачи|События)", sec):
                key = K.k_canon(c, h)
                if key == "":
                    key = norm(h)
                    bad = "?"
            else:
                key = norm(h)
            continue
        if line.startswith("- "):
            if key != "":
                body += 1
                if line.startswith("- недоступно"):
                    un = 1
            continue
        if line.startswith("|"):
            if c not in TBL:
                continue
            if has(SEPROW, line):   # строка-разделитель |---|: отложенная — заголовок
                pend = ""
                continue
            rowout()
            pend = line
            pc = c
            continue
    rowout()
    flush()
    return out


# Ключи описи: «ключ<TAB>фактов<TAB>есть-файл<TAB>служебный». Ключ — строка без отступа с « — » (до него),
# по шаблону, как у блока карточки (keys.py); строки «состояние:/справочник:/сообщение:/ограничение:»
# дают ключи «Бизнес-правил». Строка `зависит:` — улика для «Зависит от», а не ключ: строку секции по
# соседу пишет голова или читающий, а клиентов к соседу бывает несколько. Файл — и путём, и именем с
# номером строки (`name.ext:42`).
def parse_opis(path: str) -> list:
    out = []
    key = ""
    facts = 0
    src = 0
    svc = 0

    def flush():
        nonlocal key
        if key != "":
            out.append(key + "\t" + str(facts) + "\t" + str(src) + "\t" + str(svc))
        key = ""

    for line in rlines(path):
        line = strip1cr(line)
        if has(r"^[ \t]+", line):   # второй уровень
            if key == "":
                continue
            t = sub1(r"^[ \t]+", "", line)
            if t.startswith("·"):
                facts += 1
            if t.startswith("(фактов нет"):
                svc = 1
            continue
        # Прежняя форма объявленной без реализации операции — тот же ключ, что со строкой `недоступно:`.
        if line.startswith(P_DECL):
            flush()
            line = line[len(P_DECL):]
        if has(r"^(#|⟹|\(|>|-|```|<!--)", line) or line == "":
            flush()
            continue
        if line.startswith("зависит:"):
            flush()
            continue
        flush()
        ln = sub1(r"[ \t]+\Z", "", line)
        p = ln.find(" — ")
        if p < 0:   # строка без « — »: ключ без файла-источника,
            if ln.endswith(":"):   # кроме подписи раздела вида «Эндпоинты:»
                continue
            head = ln
            rest = ""
            src = 0
        else:
            head = ln[:p]
            rest = ln[p + 3:]
            src = 1 if (has(r"[^ ]\.[A-Za-z0-9]+([ ,)(+:#]|\Z)", rest) or "/" in rest) else 0
        svc = 1 if "(фактов нет" in ln else 0
        if head.startswith("вход:"):   # пара — строка `вход` в «Роли и доступ»; «не определено» — тоже ответ
            key = "вход"
            if "не определено" in ln:
                src = 1
        elif head.startswith("состояние:"):
            h = sub1(r"^состояние:[ ]*", "", head)
            h = sub1(r"[. ].*", "", h)
            key = "объект " + norm(h)
        elif head.startswith("справочник:"):
            continue
        elif head.startswith("сообщение:"):
            h = sub1(r"^сообщение:[ ]*", "", head)
            key = norm("сообщение " + h)
        elif head.startswith("ограничение:"):
            h = sub1(r"^ограничение:[ ]*", "", head)
            key = norm("ограничение " + h)
        else:
            h = sub1(r"^(роль|Роль):[ ]*", "", head)   # «роль: OPERATOR» ↔ строка таблицы «OPERATOR»
            key = K.k_opis(h)
        facts = 0
    flush()
    return out


# Ключ сравнения — одна функция на все сравнения ключей check.py (опись ↔ черновик, черновик ↔ спецификация и план,
# прежняя карточка ↔ черновик, части ↔ сводная): путь HTTP — keys.py k_key, имя параметра не учитывается; names —
# k_keyn, с именем: дубль ключа одного автора и повтор строки описи (`GET /a/:id` и `GET /a/{id}` — один ключ,
# `{ids}` и `{userId}` — два). У вызова соседа «<сервис> :: <вызов>» так же сводится вызов. Показывают ключ как его
# написал автор: k_key/k_keyn — только для сравнения. Вызов без скобок (`Dome.Close(Req)` ↔ `Dome.Close`) — K.k_bare поверх,
# вторым проходом: точное совпадение старше.
def bop(k: str) -> str:
    k = K.k_bare(k)
    return sub1(r"^(query|mutation|subscription) ", "", k)


def bizk(rows: list) -> list:
    """Ключ блока «Бизнес-правил» приводится к ключу описи: `Имя` → «объект Имя», «сообщение «вид»» и
    «ограничение «условие»» — как есть. `$2 = k` пересобирает строку через OFS."""
    out = []
    for line in rows:
        fs = T(line)
        if at(fs, 1) == "бизнес":
            k = at(fs, 2)
            if not has(r"^(сообщение|ограничение) ", k):
                k = "объект " + k
            while len(fs) < 2:
                fs.append("")
            fs[1] = k
            line = "\t".join(fs)
        out.append(line)
    return out


# Ключи карточки по классам — число для маркерного гейта, мимо описи. Повтор ключа не считается;
# ключ контракта вызовом («query night(id)») при том же ключе без скобок — тот же ключ, а перегрузки
# с разными аргументами без голого ключа — разные. Повтор — по k_keyn (`:id` = `{id}`).
def count_keys(rows: list) -> list:
    cl = []
    have = set()
    for line in rows:
        fs = T(line)
        c1, c2 = at(fs, 1), at(fs, 2)
        if c1 == "топики" and c2.startswith("транспорт "):   # общая обвязка брокера — не топик: маркерам не пара
            continue
        if has(r"^(контракт|сущности|задачи|топики|экраны)\Z", c1):
            g = K.k_keyn(c2)
            cl.append((c1, g))
            have.add((c1, g))
    seen = set()
    n: dict = {}
    for c1, k in cl:
        if c1 == "контракт" and K.k_bare(k) != k and (c1, K.k_bare(k)) in have:
            continue
        if (c1, k) in seen:
            continue
        seen.add((c1, k))
        n[c1] = n.get(c1, 0) + 1
    return [x + "\t" + str(n.get(x, 0)) for x in ("контракт", "сущности", "задачи", "топики", "экраны")]


# Пары ключей прежней карточки и черновика по классу — в два прохода. Первый — ключ сравнения (k_key: параметр
# пути в любой записи, имя не учитывается). Второй — только
# среди оставшихся без пары, ключ сведён (keys.py): роль — без области в скобках, сосед — без обвязки
# клиента, путь контракта черновика — без общего префикса разведчика (прежняя карточка могла писаться без
# него; обратное — другая ручка вне префикса, не то же). Так одно и то же, записанное в двух сканах
# по-разному, потерей не считается, а разные ключи, сводимые к одному, не слипаются. Пары второго прохода
# называются строкой «сведены». Повтор ключа (тот же k_key: `{id}` и `{list_id}` одной карточки) — один ключ, тело —
# наибольшее, показан первый.
def isort(a: list) -> list:
    """Сортировка вставками со сравнением awk; без пары похожих на число — то же, что устойчивая по байтам."""
    if sum(1 for x in a if isnum(x)) < 2:
        return sorted(a, key=bb)
    a = list(a)
    for i in range(1, len(a)):
        t = a[i]
        j = i - 1
        while j >= 0 and acmp(a[j], t) > 0:
            a[j + 1] = a[j]
            j -= 1
        a[j + 1] = t
    return a


def lcp(a: str, b: str) -> int:
    """Общее начало — в байтах (LC_ALL=C)."""
    x, y = bb(a), bb(b)
    i = 0
    while i < len(x) and i < len(y) and x[i] == y[i]:
        i += 1
    return i


def gmatch(c: str, pre: str, prev: list, draft: list):
    def gk(k: str, side: str) -> str:
        if c == "роли":
            return K.k_role(k)
        if c == "зависит":
            v = K.k_dep(k)
            return k if v == "" else v
        if c == "контракт" and pre != "":
            return K.k_key(K.k_nopre(k, pre)) if side == "d" else K.k_key(k)
        return ""

    def gtb(x: str, cur) -> bool:   # $3 > pb[$2]: сначала число 0, потом поле
        return acmpn(x, 0) > 0 if cur is None else acmp(x, cur) > 0

    def keys_of(rows: list):
        ks: list = []
        body: dict = {}
        first: dict = {}
        for line in rows:
            fs = T(line)
            if at(fs, 1) != c:
                continue
            g = K.k_key(at(fs, 2))   # повтор — по ключу сравнения: `{id}` и `{list_id}` одной карточки — один ключ
            if g not in first:
                first[g] = at(fs, 2)
                ks.append(at(fs, 2))
                body[at(fs, 2)] = None
            k = first[g]
            if gtb(at(fs, 3), body[k]):
                body[k] = at(fs, 3)
        return isort(ks), body

    pk, pb = keys_of(prev)
    dk, db = keys_of(draft)

    # Справка, не вердикт: у одного пути (k_key) в прежней карточке несколько записей (k_keyn: `{id}` и `{list_id}`,
    # `{ids}` и `{userId}`), а в черновике их меньше — одна ручка или две, решает человек.
    def writings(rows: list):
        wr: dict = {}
        first: dict = {}
        for line in rows:
            fs = T(line)
            if at(fs, 1) != c:
                continue
            kk = K.k_key(at(fs, 2))
            wr.setdefault(kk, set()).add(K.k_keyn(at(fs, 2)))
            first.setdefault(kk, at(fs, 2))
        return wr, first

    pw, pfirst = writings(prev)
    dw, _ = writings(draft)
    paths = [(pfirst[kk], len(pw[kk]), len(dw.get(kk, ()))) for kk in pw if len(pw[kk]) >= 2 and len(dw.get(kk, ())) < len(pw[kk])]
    paths.sort(key=lambda x: bb(x[0]))
    mate: dict = {}
    taken: set = set()
    dn = {}
    for k in dk:
        dn[K.k_key(k)] = k
    for k in pk:
        g = K.k_key(k)
        if g in dn:
            mate[k] = dn[g]
            taken.add(dn[g])
    # второй проход — по группам сведённого ключа; в группе пара — с наибольшим общим началом ключа
    gp: dict = {}
    gd: dict = {}
    for k in pk:
        if k not in mate:
            x = gk(k, "p")
            if x != "":
                gp.setdefault(x, []).append(k)
    for k in dk:
        if k not in taken:
            x = gk(k, "d")
            if x != "":
                gd.setdefault(x, []).append(k)
    paired = []
    for x in gp:
        if x not in gd:
            continue
        while True:
            best = -1
            bi = bj = ""
            for a in gp[x]:
                if a in mate:
                    continue
                for b in gd[x]:
                    if b in taken:
                        continue
                    ln = lcp(a, b)
                    if ln > best:
                        best = ln
                        bi = a
                        bj = b
            if best < 0:
                break
            mate[bi] = bj
            taken.add(bj)
            paired.append(bi + " → " + bj)
    gone = []
    emptied = []
    for k in pk:
        if k not in mate:
            gone.append(k)
        else:
            pv, dv = pb[k], db[mate[k]]
            if (pv is not None and acmpn(pv, 0) > 0) and (dv is None or acmpn(dv, 0) == 0):
                emptied.append(k)
    new = [k for k in dk if k not in taken]
    return gone, new, emptied, paired, len(pk), paths


# Кандидаты: обрезка по байтам (LC_ALL=C) не рвёт букву: недописанная многобайтная буква с конца снимается.
def cutb(s: str, n: int) -> str:
    x = bb(s)
    if len(x) <= n:
        return s
    x = x[:n]
    m = re.search(rb"[\xc0-\xf7][\x80-\xbf]*\Z", x)
    if m:
        c = x[m.start()]
        need = 4 if c >= 0xF0 else (3 if c >= 0xE0 else 2)
        if m.end() - m.start() < need:
            x = x[:m.start()]
    return ub(x) + "…"


_TAILCH = frozenset("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_./-")


def tailfile(line: str) -> bool:
    """line ~ /[A-Za-z0-9_.-]+\\/[A-Za-z0-9_.\\/-]*\\.[a-z]+[`)]*[ \\t]*$/ — без перебора с возвратами."""
    i = len(line)
    while i > 0 and line[i - 1] in " \t":
        i -= 1
    while i > 0 and line[i - 1] in "`)":
        i -= 1
    j = i
    while j > 0 and "a" <= line[j - 1] <= "z":
        j -= 1
    if j == i or j == 0 or line[j - 1] != ".":
        return False
    k = j - 1
    s = k
    while s > 0 and line[s - 1] in _TAILCH:
        s -= 1
    for p in range(s + 1, k):
        if line[p] == "/" and line[p - 1] != "/":
            return True
    return False


# Остаток: путь пункта.
def np_rest(p: str) -> str:
    p = p.replace("`", "")
    p = p.replace("\\", "/")
    p = gsub(r"//+", "/", p)
    p = sub1(r"^[ \t]+", "", p)
    p = sub1(r"[ \t]+\Z", "", p)
    p = sub1(r"^\./", "", p)
    p = sub1(r"/\Z", "", p)
    return p


def tail_rest(p: str, q: str) -> bool:
    return len(q) > len(p) and q.endswith("/" + p)


# Хозяин пропуска: путь файла.
IS_WIN = os.name == "nt" or sys.platform.startswith(("cygwin", "msys"))   # uname -s: MINGW|MSYS|CYGWIN


def np_own(p: str) -> str:
    p = p.replace("`", "")
    p = p.replace("\\", "/")
    p = gsub(r"//+", "/", p)
    p = sub1(r"^[ \t]+", "", p)
    p = sub1(r"[ \t]+\Z", "", p)
    p = sub1(r"^\./", "", p)
    p = sub1(r"/\Z", "", p)
    p = sub1(r"^(\.\.\.|…)/*", "", p)
    p = sub1(r":[0-9]+(-[0-9]+)?\Z", "", p)
    p = sub1(r"#L[0-9].*\Z", "", p)
    if IS_WIN and has(r"^/[A-Za-z]/", p):
        p = K.k_up(p[1]) + ":" + p[2:]
    if has(r"^[A-Za-z]:", p):
        p = K.k_up(p[0]) + p[1:]
    while True:
        p, n = R(r"/\.(/|\Z)").subn("/", p, count=1)
        if n == 0:
            break
    while True:
        m = R(r"/[^/]+/\.\.(/|\Z)").search(p)
        if not m or p[m.start() + 1:m.start() + 4] == "../":
            break
        p = p[:m.start() + 1] + p[m.end():]
    return p


def abs_own(p: str) -> bool:
    return has(r"^(/|[A-Za-z]:)", p)


def same_own(p: str, q: str) -> bool:
    return p == q or (not abs_own(p) and len(q) > len(p) and q.endswith("/" + p))


def stack_product(line: str) -> bool:
    """Строка «Стека» — брокер, только если в ней продукт: у строки таблицы вторая ячейка не «нет», не прочерк и не
    пуста (`| Шина | нет |`, `| Шина | — |` — брокера нет). Строка не таблицей — как раньше."""
    if not line.startswith("|"):
        return True
    v = at(asplit(line, "|"), 3).replace("`", "").strip(" \t")
    return not (v in ("", "—", "–", "-") or has(r"^(нет|Нет|НЕТ)([^А-Яа-яЁё]|\Z)", v))


def row_key(cls: str, line: str) -> str:
    """Ключ строки таблицы — как у parse_card: первая ячейка; у «Потребляемых API» — с вызовом, у роли — до « — »."""
    cell = asplit(line, "|")
    k = norm(at(cell, 2))
    if cls == "потребляет":
        k = k + " :: " + K.k_opis(at(cell, 3))
    if cls == "роли":
        p = k.find(" — ")
        if p >= 0:
            k = k[:p]
    return k


def template_order(typ: str):
    """Колонка типа в таблице порядка секций `card.template.md` рядом со скриптом: (секции, причина, если нет)."""
    tpl = os.path.join(os.path.dirname(os.path.abspath(__file__)), "card.template.md")
    try:
        tl = K.read_lines(tpl)
    except OSError:
        return None, "нет card.template.md рядом со скриптом"
    col = -1
    rows: list = []
    inside = False
    for x in tl:
        x = strip1cr(x)
        if not inside:
            if x.startswith("| `backend` |"):
                hdrs = [c.strip().replace("`", "") for c in x.strip().strip("|").split("|")]
                col = hdrs.index(typ) if typ in hdrs else -1
                inside = True
            continue
        if not x.startswith("|"):
            break
        if has(SEPROW, x):
            continue
        cells = [c.strip() for c in x.strip().strip("|").split("|")]
        if col >= 0 and col < len(cells) and cells[col] not in ("", "—"):
            rows.append(cells[col])
    if not inside:
        return None, "в card.template.md нет таблицы порядка секций"
    if col < 0:
        return None, "типа «%s» в таблице порядка секций нет" % typ
    return rows, ""


def section_items(typ: str, heads: list):
    """Пункты SECS: заголовки `##` черновика против колонки типа. Возвращает (пункты, причина, если сверки нет)."""
    if typ == "":
        return [], "в шапке черновика нет `type:`"
    want, why = template_order(typ)
    if want is None:
        return [], why
    items = []
    seen: list = []
    for h in heads:
        if h in seen:
            items.append("секция «%s» дважды" % h)
        else:
            seen.append(h)
    for h in seen:
        if h not in want:
            items.append("лишняя секция «%s»" % h)
    for h in want:
        if h not in seen and h != "Заметки команды":   # без notes секции нет — не расхождение
            items.append("нет секции «%s»" % h)
    got = [h for h in seen if h in want]
    exp = [h for h in want if h in got]
    if got != exp:
        items.append("порядок секций: %s — по шаблону %s: %s"
                     % (", ".join("«%s»" % x for x in got), typ, ", ".join("«%s»" % x for x in exp)))
    return items, ""


# «Владеет данными»: несколько полей в одной строке `- ` — `- `a`, `b`: тип` или `- `a`: тип, `b`: тип`.
MULTIFIELD = (r"^- `?[A-Za-z_][A-Za-z0-9_]*`?([ \t]*[,/][ \t]*`?[A-Za-z_][A-Za-z0-9_]*`?)+[ \t]*:",
              r"^- `?[A-Za-z_][A-Za-z0-9_]*`?[ \t]*:.*[,;][ \t]*`?[A-Za-z_][A-Za-z0-9_]*`?[ \t]*:")


def same_decl(k: str) -> str:
    return K.k_bare(K.k_key(k))


def tok_rules(s: str) -> str:
    """tok() частей: gsub(/[`"«»]/) под LC_ALL=C снимает байты ` " \\xC2 \\xAB \\xBB — по байтам."""
    x = bb(s)
    x = re.sub(rb'[`"\xc2\xab\xbb]', b"", x)
    x = re.sub(rb"^[ \t]+", b"", x, count=1)
    x = re.sub(rb"[ \t.,;:]+\Z", b"", x, count=1)
    return ub(x)


def _rb(p: str):
    return re.compile(p.encode("utf-8"), re.S)


GL_DASH = _rb(r"[ \t]+(—|–)[ \t].*\Z")
GL_QUOTED = re.compile(rb"\xc2\xab[^\xc2\xbb]*\xc2\xbb", re.S)   # «[^»]*» — скобка по байтам
GL_TICK = re.compile(rb"`[^`]*`", re.S)
GL_Q = _rb(r"«|»")
GL_D = _rb(r"—|–")
GL_PUNCT = re.compile(rb"[,;:/()]")
GL_SPLIT = re.compile(rb"[ \t.!?\"'+=-]+")
GL_PV = _rb(r"^(#|и|или|либо|также)\Z")
GL_VERB = _rb(r"(ть|ться|ести|зти|йти)\Z")
GL_NOUN = _rb(r"(ость|есть|асть)\Z")


def glued(t: str) -> bool:
    """Два разных однородных глагола в колонке «Возможность» — всё по байтам (LC_ALL=C, без классов)."""
    x = bb(t)
    x = GL_DASH.sub(b"", x, count=1)
    x = GL_QUOTED.sub(b" ", x)
    x = GL_TICK.sub(b" ", x)
    x = GL_Q.sub(b" ", x)
    x = GL_D.sub(b" ", x)
    x = GL_PUNCT.sub(b" # ", x)
    ws = GL_SPLIT.split(x) if x != b"" else []
    v = set()
    m = 0
    pv = b"#"
    for wd in ws:
        if wd == b"":
            continue
        if GL_PV.search(pv) and GL_VERB.search(wd) and not GL_NOUN.search(wd) and wd not in v:
            v.add(wd)
            m += 1
        pv = wd
    return m >= 2


# ---------------------------------------------------------------------------------------------------------------

def main() -> int:
    c = K.start()
    w = sys.stdout.write
    if c.arg(0) == "":
        sys.stderr.write("check.py: 1: опись\n")
        return 1
    if c.arg(1) == "":
        sys.stderr.write("check.py: 2: черновик\n")
        return 1
    OPIS, DRAFT, PREV = c.arg(0), c.arg(1), c.arg(2)
    for f in [OPIS, DRAFT] + ([PREV] if PREV != "" else []):
        if not K.is_file(f):
            w("НЕТ ФАЙЛА: " + f + "\n")
            return 2

    PARTS = c.env("CHECK_PARTS")
    PLAN = c.env("CHECK_PLAN")
    LISTS = c.env("CHECK_LISTS")
    PREFIX = c.env("CHECK_PREFIX")
    parts = "1" if PARTS != "" else ""
    DL = rlines(DRAFT)

    draft = parse_card(DRAFT)
    # Повтор ключа в описи — один ключ (так бывает после склейки частей): и тот же по k_keyn
    # (`:id` = `{id}`), и «вызовом и без скобок». Показан ключ первой строки.
    opis_raw = parse_opis(OPIS)
    first0: dict = {}
    for x in opis_raw:
        first0.setdefault(K.k_keyn(at(T(x), 1)), at(T(x), 1))
    order = []
    fct: dict = {}
    srcd: dict = {}
    svd: dict = {}
    for line in opis_raw:
        fs = T(line)
        g = K.k_keyn(at(fs, 1))
        b = K.k_bare(g)
        if b != g and b in first0:
            g = b
        k = first0[g]
        if k not in fct:
            order.append(k)
            fct[k] = at(fs, 2)
            srcd[k] = at(fs, 3)
        elif acmp(at(fs, 2), fct[k]) > 0:
            fct[k] = at(fs, 2)
        if acmpn(at(fs, 4), 1) == 0:
            svd[k] = 1
    opis = [k + "\t" + fct[k] + "\t" + srcd[k] + "\t" + ("1" if k in svd else "0") for k in order]
    draftk = bizk(draft)
    DK = [T(x) for x in draftk]

    def cnt_list(label: str, ls: list) -> None:
        w("%s: %d" % (label, len(ls)))
        if ls:
            w(" — " + lst(ls))
        else:
            w("\n")

    w("== ЧЕРНОВИК " + basename(DRAFT) + "\n")
    n: dict = {}
    bn: dict = {}
    bm = br = bo = tp = tu = 0
    for fs in DK:
        c1, c2 = at(fs, 1), at(fs, 2)
        n[c1] = n.get(c1, 0) + 1
        if acmpn(at(fs, 3), 0) > 0:
            bn[c1] = bn.get(c1, 0) + 1
        if c1 == "бизнес":
            if c2.startswith("сообщение "):
                bm += 1
            elif c2.startswith("ограничение "):
                br += 1
            else:
                bo += 1
        if c1 == "топики":
            if c2.startswith("потребляет"):
                tp += 1
            elif c2.startswith("публикует"):
                tu += 1
    for x in ("контракт", "сущности", "задачи"):
        w("%s %d (с телом %d, пустых %d)\n" % (x, n.get(x, 0), bn.get(x, 0), n.get(x, 0) - bn.get(x, 0)))
    w("топики %d (потребляет %d, публикует %d)\n" % (n.get("топики", 0), tp, tu))
    w("бизнес-правила: объектов %d, сообщений %d, ограничений %d\n" % (bo, bm, br))
    w("строк таблиц: экраны %d, роли %d, зависит от %d, потребляемые API %d\n"
      % (n.get("экраны", 0), n.get("роли", 0), n.get("зависит", 0), n.get("потребляет", 0)))
    # Плотность блочных секций — для отчёта Шага 6, не гейт: строк `- ` на блок и блоков с одной строкой
    # или пустых; таких больше половины — секция «тонкая».
    dn: dict = {}
    df: dict = {}
    dt: dict = {}
    for fs in DK:
        c1 = at(fs, 1)
        if has(r"^(контракт|топики|задачи|бизнес)\Z", c1):
            dn[c1] = dn.get(c1, 0) + 1
            df[c1] = df.get(c1, 0.0) + anum(at(fs, 3))
            if acmpn(at(fs, 3), 1) <= 0:
                dt[c1] = dt.get(c1, 0) + 1
    out = ""
    for cc, nmx in zip(("контракт", "топики", "задачи", "бизнес"),
                       ("Публичный контракт", "События", "Фоновые задачи", "Бизнес-правила")):
        if dn.get(cc, 0) == 0:
            continue
        t_ = dt.get(cc, 0)
        out = out + ("" if out == "" else "; ") + "%s %.1f на блок (блоков %d, с одной строкой или пустых %d)%s" % (
            nmx, df[cc] / dn[cc], dn[cc], t_, (" — тонкая" if 2 * t_ > dn[cc] else ""))
    w("плотность по секциям: " + ("блочных секций нет" if out == "" else out) + "\n")
    cardn = count_keys(draftk)
    w("".join(("ключи карточки по классам: " if i == 0 else ", ") + "%s %d" % (at(T(x), 1), int(anum(at(T(x), 2))))
              for i, x in enumerate(cardn)) + "\n")

    # Папка частей (нарезанный сервис): ключи карточки каждой части — для её маркерного гейта; кто автор
    # блока и ключа описи — для перечня добора по авторам. Голова — автор своих секций.
    partn: list = []
    own_card: list = []
    own_opis: list = []
    pbody: list = []
    PARTEMPTY: list = []
    if parts:
        if not K.is_dir(PARTS):
            w("НЕТ ПАПКИ ЧАСТЕЙ: " + PARTS + "\n")
            return 2
        for f in glob1(PARTS, "part-*.md") + [PARTS + "/head.md"]:
            if f.endswith(".opis.md"):
                continue
            if not K.is_file(f):
                continue
            a = basename(f, ".md")
            if a.startswith("part-"):
                a = a[5:]
            if a == "head":
                a = "голова"
            pc = bizk(parse_card(f, a != "голова"))
            for x in pc:
                own_card.append(at(T(x), 2) + "\t" + a)
            if a != "голова":
                for x in count_keys(pc):
                    partn.append(a + "\t" + x)
                for x in pc:
                    fs = T(x)
                    if at(fs, 1) == "контракт":
                        pbody.append(a + "\t" + at(fs, 2) + "\t" + at(fs, 3))
            o = f[:-3] + ".opis.md"
            if K.is_file(o):
                for x in parse_opis(o):
                    own_opis.append(at(T(x), 1) + "\t" + a)
        # Пустота по частям: у части больше половины блоков контракта без фактов — её ключи, пустые и в
        # склеенной карточке, идут ей в добор. Порог тела по всей карточке такой концентрации не видит:
        # одна пустая часть тонет в остальных. Запись это не останавливает.
        dbody: dict = {}
        for fs in DK:
            g = K.k_keyn(at(fs, 2))
            if at(fs, 1) == "контракт" and not (g in dbody and acmp(dbody[g], at(fs, 3)) >= 0):
                dbody[g] = at(fs, 3)
        pn_: dict = {}
        pb_: dict = {}
        pk_: dict = {}
        for x in pbody:
            fs = T(x)
            a = at(fs, 1)
            pn_[a] = pn_.get(a, 0) + 1
            if acmpn(at(fs, 3), 0) > 0:
                pb_[a] = pb_.get(a, 0) + 1
            pk_.setdefault(a, []).append((at(fs, 2), at(fs, 3)))
        pesum = []
        pe = set()
        for a in pn_:
            if 2 * pb_.get(a, 0) < pn_[a]:
                pesum.append("%s — тело у %d из %d" % (a, pb_.get(a, 0), pn_[a]))
                for k, bd in pk_[a]:
                    if acmpn(bd, 0) == 0 and K.k_keyn(k) in dbody and acmpn(dbody[K.k_keyn(k)], 0) == 0:
                        pe.add(k)
        PARTEMPTY = K.csort(pe)
        w("пустота по частям (больше половины блоков контракта без фактов): ")
        if pesum:
            w("; ".join(K.csort(pesum)) + "\n")
        else:
            w("нет\n")

    # Границы секций — номера строк: проверка внутри секции делается грепом с -n по всему файлу.
    w("границы секций: ")
    s_ = ""
    a_ = 0
    for nr, line in enumerate(DL, 1):
        line = strip1cr(line)
        if line.startswith("## "):
            if s_ != "":
                w("%s %d–%d; " % (s_, a_, nr - 1))
            s_ = line[3:]
            a_ = nr
    if s_ != "":
        w("%s %d–%d\n" % (s_, a_, len(DL)))
    else:
        w("нет\n")
    # Порядок и состав секций `##` — по таблице порядка шаблона (card.template.md рядом со скриптом) для типа из
    # шапки черновика (`type:`); расхождения — пункты добора SECS.
    typ = ""
    if DL and strip1cr(DL[0]) == "---":
        for x in DL[1:]:
            x = strip1cr(x)
            if x == "---":
                break
            m = R(r"^type:[ \t]*([A-Za-z]+)").search(x)
            if m:
                typ = m.group(1)
    heads: list = []
    fz = False
    for x in DL:
        x = strip1cr(x)
        if x.startswith("```"):
            fz = not fz
        elif not fz and x.startswith("## "):
            heads.append(sub1(r"[ \t]+\Z", "", x[3:]))
    SECS, why = section_items(typ, heads)
    if why != "":
        w("секции по шаблону: %s — сверки нет\n" % why)
    else:
        w("секции по шаблону %s: расхождений %d\n" % (typ, len(SECS)))
    # Ключ контракта — метод и путь; у GraphQL — тип операции и имя; у gRPC — сервис и метод.
    nometh = [at(fs, 2) for fs in DK
              if at(fs, 1) == "контракт" and not has(HTTPRE + " ", at(fs, 2))
              and not has(r"^(query|mutation|subscription) ", at(fs, 2))
              and not has(r"^[A-Za-z_][A-Za-z0-9_.]*[./][A-Za-z_][A-Za-z0-9_]*\Z", at(fs, 2))]
    cnt_list("ключи контракта без метода", nometh)
    # Заголовок «Событий», задачи или данных, который к ключу шаблона не сводится (keys.py), — как есть; у
    # контракта тот же случай — «без метода» выше.
    NOKEY = K.csort(set(at(fs, 1) + ": " + at(fs, 2) for fs in DK if at(fs, 4) == "?" and at(fs, 1) != "контракт"))
    cnt_list("ключ не опознан — заголовок не по ключу шаблона", NOKEY)
    # Общий префикс от разведчика стоит в каждом пути ключа REST; ключ без него — форма записи либо ручка
    # вне префикса, и тогда это видно по коду регистрации. Решает читающий по источнику, а не ты.
    NOPFX: list = []
    PFX = "\n".join(sub1(r"/\Z", "", gsub(r"/+", "/", x)) for x in PREFIX.split("\n")).rstrip("\n")
    if PFX != "":   # «api» из кода — тот же префикс, что «/api»; как k_nopre
        PFX = "/" + (PFX[1:] if PFX.startswith("/") else PFX)
    if PFX != "":
        np2 = set()
        for fs in DK:
            if at(fs, 1) == "контракт" and has(HTTPRE + " ", at(fs, 2)):
                s = sub1(r"^[A-Z]+ ", "", at(fs, 2))
                if s != PFX and not s.startswith(PFX + "/"):
                    np2.add(at(fs, 2))
        NOPFX = K.csort(np2)
        cnt_list("ключи REST без общего префикса %s" % PFX, NOPFX)

    w("== ОПИСЬ " + basename(OPIS) + "\n")
    on = oo = om = orr = 0
    for x in opis:
        fs = T(x)
        on += 1
        k = at(fs, 1)
        if k.startswith("объект "):
            oo += 1
        elif k.startswith("сообщение "):
            om += 1
        elif k.startswith("ограничение "):
            orr += 1
    w("ключей %d (из них строк «Бизнес-правил»: объектов %d, сообщений %d, ограничений %d)\n" % (on, oo, om, orr))
    nosrc = [at(T(x), 1) for x in opis if acmpn(at(T(x), 3), 0) == 0]
    cnt_list("строк без файла-источника", nosrc)
    w("итоги описи:\n")
    for line in rlines(OPIS):
        if line.startswith("⟹"):
            w("  " + strip1cr(line) + "\n")

    # Маркеры по плану: вердикт гейта — ключи карточки против пометок `ключ` по сервису, а с папкой частей и
    # по каждой части; сверка по файлам — сколько разных ключей описи ссылается на файл с пометками (путь
    # описи сравнивается с путём плана по хвосту; строки «Бизнес-правил» и ролей — не ключи пометок, повтор
    # ключа после склейки — один ключ). Ключей в описи меньше пометок файла — добор той части, которой файл
    # отдан; запись это не останавливает. Итог гейта уходит в «ИСХОД».
    MARKFILE: list = []
    markgate = ""
    if PLAN != "":
        w("== МАРКЕРЫ по " + basename(PLAN) + "\n")
        if not nonempty(PLAN):
            w("плана нет или он пуст — вердикта маркеров нет\n")
        else:
            card: dict = {}
            for x in cardn:
                fs = asplit(x, "\t")
                card[at(fs, 1)] = anum(at(fs, 2))
            pcard: dict = {}
            haspart: set = set()
            for x in partn:
                fs = asplit(x, "\t")
                pcard[(at(fs, 1), at(fs, 2))] = anum(at(fs, 3))
                haspart.add(at(fs, 1))
            role: set = set()
            ndep = 0
            for x in draftk:
                fs = asplit(x, "\t")
                if at(fs, 1) == "роли":
                    role.add(K.k_key(at(fs, 2)))
                if at(fs, 1) == "зависит":
                    ndep += 1
            want: dict = {}
            cls: list = []
            pwant: dict = {}
            pl: list = []
            fn: dict = {}
            fo: list = []
            own: dict = {}
            for line in rlines(PLAN):
                fs = T(strip1cr(line))
                f1 = at(fs, 1)
                if f1 == "итог":
                    if at(fs, 2) not in want:
                        cls.append(at(fs, 2))
                    want[at(fs, 2)] = want.get(at(fs, 2), 0.0) + anum(at(fs, 3))
                if f1 == "часть":
                    kk = (at(fs, 2), at(fs, 3))
                    if kk not in pwant:
                        pl.append(kk)
                    pwant[kk] = pwant.get(kk, 0.0) + anum(at(fs, 4))
                if f1 == "файл":
                    if at(fs, 2) not in fn:
                        fo.append(at(fs, 2))
                        own[at(fs, 2)] = at(fs, 5)
                    fn[at(fs, 2)] = fn.get(at(fs, 2), 0.0) + anum(at(fs, 4))
            declared_m: dict = {}
            seen: set = set()
            tok: dict = {}
            for line in rlines(OPIS):
                line = strip1cr(line)
                if line.startswith(P_DECL):
                    if declared_m.get(line, 0):
                        declared_m[line] += 1
                        continue
                    declared_m[line] = 1
                    line = line[len(P_DECL):]
                if has(r"^[ \t]", line) or has(r"^(#|⟹|\(|>|-|```|<!--)", line) or line == "":
                    continue
                p = line.find(" — ")
                if p < 0:
                    continue
                h = line[:p]
                if K.k_fact(h) and not h.startswith("зависит:"):   # `зависит:` — ключ пометок «клиенты»
                    continue
                key = K.k_keyn(K.k_opis(h))   # повтор ключа после склейки (`:id` = `{id}`) — один ключ
                if K.k_key(key) in role:
                    continue
                rest = gsub(r"[+,;]", " ", line[p + 3:])
                for t in fields(rest):
                    t = gsub(r"[`()]", "", t)
                    t = t.replace("\\", "/")
                    t = sub1(r"^\./", "", t)
                    t = sub1(r"^(\.\.\.|…)/*", "", t)   # «…/dir/name.ext», «name.ext:42» — хвост пути
                    t = sub1(r":[0-9]+(-[0-9]+)?\Z", "", t)
                    t = sub1(r"#L[0-9].*\Z", "", t)
                    if "/" not in t and not has(r"\.[A-Za-z0-9]+\Z", t):
                        continue
                    if (key, t) not in seen:
                        seen.add((key, t))
                        tok[t] = tok.get(t, 0) + 1
            bad = ""

            def verdict(who: str, gw: str, cc: str, g: float, e: float) -> None:
                nonlocal bad
                if 2 * g < e:
                    w("маркеры %s%s: в карточке %d, пометок %d — НЕ ПРОЙДЕН: меньше половины\n" % (who, cc, int(g), int(e)))
                    bad = bad + ("" if bad == "" else "; ") + gw + cc + " " + K.num(g) + " из " + K.num(e)
                elif g > 2 * e:
                    w("маркеры %s%s: в карточке %d, пометок %d — пройден; маркер видит %d из %d по карточке — внешней сверки по классу нет\n"
                      % (who, cc, int(g), int(e), int(e), int(g)))
                else:
                    w("маркеры %s%s: в карточке %d, пометок %d — пройден\n" % (who, cc, int(g), int(e)))

            for cc in cls:
                # клиенты к соседям: один сосед — несколько клиентов, поэтому только справка; недобор ловит сверка по файлам
                if cc == "клиенты":
                    w("маркеры клиенты: строк «Зависит от» %d, пометок %d — справочно, не гейт\n" % (ndep, int(want[cc])))
                    continue
                if cc not in card:
                    w("маркеры %s: в карточке такого класса нет — сверки нет\n" % cc)
                    continue
                verdict("", "", cc, card[cc], want[cc])
            if parts:
                for nn, cc in pl:
                    if cc == "клиенты":   # справочный класс — строка по сервису выше, по частям не сверяется
                        continue
                    if nn not in haspart:
                        w("маркеры части %s, %s: файла части нет — сверки нет\n" % (nn, cc))
                        continue
                    if (nn, cc) not in pcard:
                        w("маркеры части %s, %s: в карточке такого класса нет — сверки нет\n" % (nn, cc))
                        continue
                    verdict("части " + nn + ", ", "часть " + nn + ", ", cc, pcard[(nn, cc)], pwant[(nn, cc)])
            if len(cls) == 0 and not (parts and len(pl)):
                gate = "пометок-ключей в плане нет — гейта нет"
            else:
                gate = "пройден" if bad == "" else "НЕ ПРОЙДЕН — " + bad
            w("МАРКЕРНЫЙ ГЕЙТ: " + gate + "\n")
            markgate = gate
            ndl = []
            for f in fo:
                # f == t либо f кончается на "/" t: t — сам путь и каждый хвост после "/"
                m = tok.get(f, 0)
                i = f.find("/")
                while i >= 0:
                    m += tok.get(f[i + 1:], 0)
                    i = f.find("/", i + 1)
                if m < fn[f]:
                    ln = f + " (часть " + own[f] + "): пометок " + K.num(fn[f]) + ", ключей " + str(m)
                    ndl.append(ln)
                    MARKFILE.append(ln)
            w("по файлам: файлов с пометками %d, ключей в описи меньше пометок — %d\n" % (len(fo), len(ndl)))
            for ln in ndl[:15]:
                w("    " + ln + "\n")
            if len(ndl) > 15:
                w("    …и ещё %d\n" % (len(ndl) - 15))

    # Сверка поключево. Ключи обеих сторон — по шаблону (keys.py): строки запроса и аргументов операции в
    # них уже нет. Ключ описи найден, если совпал с ключом черновика целиком или своим хвостом после
    # последней точки (роли: «StaffRole.OPERATOR» ↔ «OPERATOR»). Оставшиеся без пары у ключей контракта без
    # HTTP-глагола сводятся ещё раз без хвоста-вызова («Dome.Close(Req)» ↔ «Dome.Close»; скобка после пробела,
    # как у роли «OPERATOR (на смену)», — не вызов). Точное совпадение всегда старше: «convert(a)» и
    # «convert(a, b)» не сливаются.
    # Сверка запись не останавливает: опись пишет тот же субагент, и её расхождение с карточкой — чаще
    # форма записи, чем пропуск в коде. В перечень добора идёт то, что можно исправить по коду: ключ описи
    # с источником без блока, блок при ключе описи без источника, факт описи при пустом блоке, один ключ
    # двумя блоками, ключ контракта без метода, заголовок не по ключу шаблона. Блок без ключа в описи,
    # строка описи без источника и без блока, ключ без единого факта и в описи, и в блоке — справка: последний
    # идёт человеку (Шаг 6).
    w("== СВЕРКА ОПИСЬ → ЧЕРНОВИК\n")
    join: list = []
    # Ключ черновика — по k_keyn: `GET /a/:id` и `GET /a/{id}` одного черновика — один ключ (дубль),
    # `{ids}` и `{userId}` — два. disp — ключ, как его написал автор (первая запись).
    d: dict = {}
    cl: dict = {}
    disp: dict = {}
    dk: list = []
    rep: dict = {}
    rep1: dict = {}
    alt: dict = {}
    for fs in DK:
        c1, c2 = at(fs, 1), at(fs, 2)
        g = K.k_keyn(c2)
        d[g] = at(fs, 3)
        cl[g] = c1
        disp.setdefault(g, c2)
        dk.append((g, c2))
        rep[(c1, g)] = rep.get((c1, g), 0) + 1
        rep1.setdefault((c1, g), c2)
        if rep[(c1, g)] == 2 and has(r"^(контракт|сущности|задачи|топики)\Z", c1):
            join.append("DUP\t" + rep1[(c1, g)] + " ~ " + c2)
        if c1 == "потребляет":
            alt[K.k_keyn(at(asplit(c2, " :: "), 2))] = g
    ok_: list = []
    fc: list = []
    sc: list = []
    sv: list = []
    for x in opis:
        fs = T(x)
        ok_.append(at(fs, 1))
        fc.append(at(fs, 2))
        sc.append(at(fs, 3))
        sv.append(at(fs, 4))
    oh: list = []
    used: set = set()
    for k in ok_:
        kn = K.k_keyn(k)
        hit = kn if kn in d else ""
        if hit == "" and kn in alt:
            hit = alt[kn]
        if hit == "":
            t = K.k_keyn(sub1(r".*\.", "", k))
            if t in d:
                hit = t
        oh.append(hit)
        if hit != "":
            used.add(hit)
    # ключ сравнения без имени параметра (`{id}` ↔ `{list_id}`) — среди блоков без пары; вызов соседа — и без сервиса
    byk: dict = {}
    for x, _ in dk:
        if x not in used:
            byk.setdefault(K.k_key(x), x)
            if cl[x] == "потребляет":
                byk.setdefault(K.k_key(at(asplit(x, " :: "), 2)), x)
    for i, k in enumerate(ok_):
        if oh[i] == "":
            q = K.k_key(k)
            if q in byk and byk[q] not in used:
                oh[i] = byk[q]
                used.add(byk[q])
    byp: dict = {}
    for x, _ in dk:
        if x not in used and cl[x] == "контракт":
            q = K.k_bare(K.k_key(x))
            if q not in byp:
                byp[q] = x
    for i, k in enumerate(ok_):
        if oh[i] == "":
            q = K.k_bare(K.k_key(k))
            if q in byp and byp[q] not in used:
                oh[i] = byp[q]
                used.add(byp[q])
    # операция GraphQL с типом и без него («mutation saveNight» ↔ «saveNight») — один ключ: иначе добор
    # формы переименовывает заголовки карточки под опись и теряет тип
    byo: dict = {}
    for x, _ in dk:
        if x not in used and cl[x] == "контракт":
            q = bop(K.k_key(x))
            if q not in byo:
                byo[q] = x
    for i, k in enumerate(ok_):
        if oh[i] == "":
            q = bop(K.k_key(k))
            if q in byo and byo[q] not in used:
                oh[i] = byo[q]
                used.add(byo[q])
    # один ключ контракта двумя блоками: с хвостом в скобках и без него
    for x, raw in dk:
        q = K.k_bare(x)
        if cl[x] == "контракт" and q != x and q in d and cl[q] == "контракт":
            join.append("DUP\t" + disp[q] + " ~ " + raw)
    for i, k in enumerate(ok_):
        hit = oh[i]
        if hit == "":
            join.append("MISS\t" + k)
            if acmpn(sc[i], 1) == 0:
                join.append("MISSRC\t" + k)
            join.append("CLS\t" + ("«Бизнес-правила» — по описям частей"
                                   if (parts != "" and has(r"^(объект|сообщение|ограничение) ", k)) else "без пары"))
            continue
        join.append("CLS\t" + cl[hit])
        if acmpn(sc[i], 0) == 0:
            join.append("NOSRCPAIR\t" + k)
        if acmpn(fc[i], 0) > 0 and acmpn(d[hit], 0) == 0 and cl[hit] not in TBL:
            join.append("EMPTY\t" + k)
        if acmpn(fc[i], 0) == 0 and acmpn(d[hit], 0) == 0 and acmpn(sv[i], 1) != 0 and cl[hit] in ("контракт", "задачи", "топики"):
            join.append("NOFACT\t" + cl[hit] + ": " + k)
    for k in d:
        if k not in used and cl[k] not in ("зависит", "потребляет", "состояние"):
            join.append("EXTRA\t" + cl[k] + ": " + disp[k])
    J: dict = {}
    for t in ("MISS", "MISSRC", "NOSRCPAIR", "EXTRA", "EMPTY", "DUP", "NOFACT"):
        J[t] = K.csort(x.split("\t", 1)[1] for x in join if x.startswith(t + "\t"))
    BIZ = r"^(объект|сообщение|ограничение) "
    # У нарезанного «Бизнес-правила» пишет голова: строки частей об одной отправке — один блок, поэтому строка
    # описи без своего блока — не пропуск; их сверка с описями частей ниже («против описей частей»). Блок без
    # строки описи («нет в описи») остаётся: так видно правило, которого нет ни у одной части.
    if parts:
        J["MISS"] = [x for x in J["MISS"] if not has(BIZ, x)]
    cnt_list("нет в черновике", J["MISS"])
    cnt_list("нет в описи", J["EXTRA"])
    cnt_list("факт в описи, пустой блок", J["EMPTY"])
    # «Бизнес-правила» сверяются своими проверками — в перечень ключей добора их строки не идут.
    bmx = sum(1 for x in J["MISS"] if has(BIZ, x))
    bex = sum(1 for x in J["EXTRA"] if x.startswith("бизнес: "))
    if not parts:
        w("вне ключей — «Бизнес-правила»: нет в черновике %d, нет в описи %d\n" % (bmx, bex))
    cnt_list("один ключ дважды — двумя блоками либо с хвостом в скобках и без", J["DUP"])
    cnt_list("ключи без единого факта и в описи, и в карточке", J["NOFACT"])
    # Ключ «недоступно» — строка `недоступно:` под ключом описи (прежняя форма — строка `> объявлено без реализации:`).
    # В карточке у него пометка: у блока строка `- недоступно…`, у строки таблицы — это слово. Ключа без блока
    # ловит сверка выше («нет блока»); здесь — ключ с блоком или строкой, но без пометки. Описи — сводная и описи
    # частей, как у «пропущено частью».
    txt = rtext(OPIS) + "\n"
    if parts:
        for o in glob1(PARTS, "part-*.opis.md") + [PARTS + "/head.opis.md"]:
            if K.is_file(o):
                txt += rtext(o) + "\n"
    allopis = [strip1cr(x) for x in K.lines_of(txt)]
    declared: list = []
    for line in allopis:
        if line.startswith(P_DECL):
            s = line[len(P_DECL):]
            p = s.find(" — ")
            if p >= 0:
                s = s[:p]
            declared.append(s)
    un_: set = set()
    key = ""
    for line in allopis:
        if line.startswith(P_DECL):
            s = line[len(P_DECL):]
            p = s.find(" — ")
            if p >= 0:
                s = s[:p]
            un_.add(K.k_opis(s))
            key = ""
            continue
        if has(r"^[ \t]+недоступно:", line):
            if key != "":
                un_.add(key)
            continue
        if has(r"^[ \t]", line):
            continue
        if has(r"^(#|⟹|\(|>|-|```|<!--)", line) or line == "":
            key = ""
            continue
        p = line.find(" — ")
        h = line[:p] if p >= 0 else line
        key = "" if K.k_fact(h) else K.k_opis(h)
    unav = K.csort(un_)
    uset = set(same_decl(x) for x in unav)
    okd: set = set()
    badd: dict = {}
    for fs in DK:
        s2 = same_decl(at(fs, 2))
        if s2 in uset:
            if acmpn(at(fs, 5), 1) == 0:
                okd.add(s2)
            else:
                badd[at(fs, 2)] = 1
    DECL = K.csort(set(k for k in badd if same_decl(k) not in okd))
    cnt_list("ключи «недоступно» в описи", unav)
    cnt_list("ключи «недоступно» без пометки в карточке", DECL)
    # «Бизнес-правила» нарезанного сервиса пишет голова по описям частей — с ними и сверка, а не с её
    # собственной описью: сущность из строк `состояние:` частей — блок, каждое значение — токен в бэктиках в
    # этом блоке; хоть одно имя отправки из строки `сообщение:` части («<кому>, <имена через запятую>» перед
    # файлом) — в секции.
    # Пропуск — добор головы.

    RULES: list = []
    if parts:
        ptxt = ""
        for o in glob1(PARTS, "part-*.opis.md"):
            if K.is_file(o):
                ptxt += sedcr(rtext(o)) + "\n"
        ent: set = set()
        eo: list = []
        ev: set = set()
        vals: dict = {}
        msg: dict = {}
        mo: list = []
        for line in K.lines_of(ptxt):
            if line.startswith("состояние:"):
                s = sub1(r"^состояние:[ ]*", "", line)
                p = s.find(" — ")
                if p >= 0:
                    s = s[:p]
                e = tok_rules(sub1(r"[. ].*", "", s))
                if e == "":
                    continue
                if e not in ent:
                    ent.add(e)
                    eo.append(e)
                if " " not in s:
                    continue
                v = sub1(r"^[^ ]+ ", "", s)
                for x in asplit(v, "|"):
                    t = tok_rules(x)
                    if has(r"^[A-Za-z0-9_]+\Z", t) and (e, t) not in ev:
                        ev.add((e, t))
                        vals[e] = vals.get(e, "") + ("" if vals.get(e, "") == "" else " ") + t
            elif line.startswith("сообщение:"):
                P = asplit(line, " — ")
                if len(P) < 3:
                    continue
                vid = sub1(r"^сообщение:[ ]*", "", P[0])
                Q = asplit(P[len(P) - 2], ", ")   # «<кому>, <имена отправки через запятую>»
                ns = ""
                for q in Q[1:]:
                    W = fields(q)
                    x = tok_rules(W[-1] if W else "")
                    if has(r"[A-Za-z]", x) and not has(r"[^A-Za-z0-9_.:/-]", x):
                        ns = ns + ("" if ns == "" else " ") + x
                if ns == "" or ns in msg:
                    continue
                msg[ns] = vid
                mo.append(ns)
        inb = False
        bk = ""
        blk: set = set()
        body: dict = {}
        allp: list = []
        for line in DL:
            line = strip1cr(line)
            if line.startswith("## "):
                inb = line.startswith("## Бизнес-правила")
                bk = ""
                continue
            if not inb:
                continue
            if line.startswith("### "):
                h = line[4:]
                p = h.find(" — ")
                if p >= 0:
                    h = h[:p]
                h = h.replace("`", "")
                h = gsub(r"^[ \t]+|[ \t]+\Z", "", h)
                bk = h
                blk.add(bk)
            allp.append(" " + line)
            if bk != "":
                body.setdefault(bk, []).append(" " + line)
        allstr = "".join(allp)
        for e in eo:
            if e not in blk:
                RULES.append("объект " + e + ": блока нет" + (" — значения " + vals[e] if vals.get(e, "") != "" else ""))
                continue
            bstr = "".join(body.get(e, []))
            miss = ""
            for vv in fields(vals.get(e, "")):
                if ("`" + vv + "`") not in bstr:
                    miss = miss + ("" if miss == "" else ", ") + vv
            if miss != "":
                RULES.append("объект " + e + ": нет строк значений " + miss)
        for ns in mo:
            if not any(x in allstr for x in fields(ns)):
                RULES.append("сообщение " + msg[ns] + " (" + ns + "): блока нет")
        cnt_list("«Бизнес-правила» против описей частей — нет у головы", RULES)
    # Своя сущность без блока в «Бизнес-правилах», чьё поле-перечисление (два значения через `|`, null не в счёт,
    # или тип на Type|Status|State|Kind|Stage|Phase|Mode) называют строки `меняет:`, а строки `состояние:` с ним в
    # описях нет, — пропущенный объект правил. Имя сущности — без хвоста Entity. Секции в черновике нет — проверки нет.
    STATE: list = []
    if any(x.startswith("## Бизнес-правила") for x in DL):
        txt = rtext(OPIS) + "\n"
        if parts:
            for o in glob1(PARTS, "part-*.opis.md"):
                if K.is_file(o):
                    txt += rtext(o) + "\n"
        stopis = [strip1cr(x) for x in K.lines_of(txt)]
        ch: set = set()
        named: set = set()
        bp: set = set()
        sfo: list = []
        fe: dict = {}

        def cn(e: str) -> str:
            if has(r".Entity\Z", e):
                e = sub1(r"Entity\Z", "", e)
            return e

        def ck(k: str) -> str:
            e = sub1(r"\..*", "", k)
            f = sub1(r"^[^.]*\.", "", k)
            return cn(e) + "." + f

        def chg(ln: str) -> None:
            ln = " " + ln
            while True:
                m = R(r"[^A-Za-z0-9_][A-Z][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*").search(ln)
                if not m:
                    break
                ch.add(ck(ln[m.start() + 1:m.end()]))
                ln = ln[m.end():]

        def svals(r: str) -> int:
            best = 0
            while True:
                m = R(r"`?[A-Za-z0-9_]+`?([ \t]*\\?\|[ \t]*`?[A-Za-z0-9_]+`?)+").search(r)
                if not m:
                    break
                mm = m.group(0)
                r = r[m.end():]
                mm = gsub(r"[`\\ \t]", "", mm)
                cc = 0
                for x in asplit(mm, "|"):
                    if x != "" and not has(r"^(null|Null|NULL|undefined|none|None|nil)\Z", x):
                        cc += 1
                if cc > best:
                    best = cc
            return best

        for line in stopis:
            line = strip1cr(line)
            if has(r"^[ \t]*меняет:", line):
                chg(line)
                continue
            if line.startswith("состояние:"):
                s = sub1(r"^[^:]*:[ \t]*", "", line)
                s = s.replace("`", "")
                s = sub1(r"[ \t].*", "", s)
                named.add(ck(s))
        sec = ""
        ent_ = ""
        for line in DL:
            line = strip1cr(line)
            if has(r"^[ \t]*меняет:", line):
                chg(line)
                continue
            if line.startswith("## "):
                sec = line
                ent_ = ""
                continue
            if line.startswith("### "):
                ent_ = ""
                m = R(r"^### `[A-Za-z_][A-Za-z0-9_]*`").search(line)
                if m:
                    ent_ = line[5:m.end() - 1]
                if ent_ != "" and sec.startswith("## Бизнес-правила"):
                    bp.add(cn(ent_))
                continue
            if sec.startswith("## Владеет данными") and ent_ != "" and has(r"^- `?[A-Za-z_][A-Za-z0-9_]*`?[ \t]*:", line):
                f = sub1(r"^- `?", "", line)
                f = sub1(r"[^A-Za-z0-9_].*", "", f)
                r = sub1(r"^[^:]*:[ \t]*", "", line)
                t = r.replace("`", "")
                t = sub1(r"[^A-Za-z0-9_].*", "", t)
                k = ent_ + "." + f
                if k not in fe:
                    sfo.append(k)
                    fe[k] = 1 if (svals(r) >= 2 or has(r"(Type|Status|State|Kind|Stage|Phase|Mode)\Z", t)) else 0
        for k in sfo:
            e = sub1(r"\..*", "", k)
            if fe[k] and ck(k) in ch and cn(e) not in bp and ck(k) not in named:
                STATE.append(k)
        cnt_list("перечисления, которые меняют строки «меняет:», без блока «Бизнес-правил»", STATE)
    # Остаток: на каждый пункт его списка в плане (строки `остаток`) — строка `> пройдено: <пункт> — ключей N`
    # в описи остатка; пункт сверяется путём (хвост пути — тот же пункт). Нет строки — добор остатка.
    REST: list = []
    RNN = ""
    if parts and PLAN != "" and nonempty(PLAN):
        for line in rlines(PLAN):
            fs = T(line)
            if at(fs, 1) == "остаток":
                RNN = at(fs, 2).replace("\r", "")
                break
    if RNN != "":
        RO = PARTS + "/part-" + RNN + ".opis.md"
        kd: list = []
        pt: list = []
        for line in rlines(PLAN):
            fs = T(strip1cr(line))
            if at(fs, 1) == "остаток":
                kd.append("файлы прямо в" if at(fs, 3) == "файлы" else "папка")
                pt.append(np_rest(at(fs, 4)))
        dnl: list = []
        for line in (rlines(RO) if K.is_file(RO) else []):
            line = strip1cr(line)
            if line.startswith(P_DONE):
                s = line[len(P_DONE):]
                p = s.find(" — ")
                if p >= 0:
                    s = s[:p]
                s = sub1(r"^(папка|файлы прямо в|файлы)[ ]+", "", s)
                dnl.append(np_rest(s))
        for i in range(len(pt)):
            if not any(x == pt[i] or tail_rest(x, pt[i]) or tail_rest(pt[i], x) for x in dnl):
                REST.append(kd[i] + " " + pt[i] + " (остаток " + RNN + ")")
        nrest = sum(1 for line in rlines(PLAN) if at(T(line), 1) == "остаток")
        cnt_list("остаток — пунктов плана %d, без строки «пройдено» в его описи" % nrest, REST)
    # Список от кода, мимо разведчика — строки плана «операция» (спецификации на диске) и «топик» (конфиг, который
    # назвал разведчик). Операции нет среди ключей карточки (путь — как в спецификации или за общим префиксом; объявленная
    # без реализации не в счёт) — добор части спецификации, а без неё — остатка. Топиков конфига в «Событиях»
    # меньше половины либо брокер в «Стеке» при одном событии или без них — добор остатка.
    SPEC: list = []
    TOPICS: list = []
    NEV = sum(1 for fs in DK if at(fs, 1) == "топики")
    # Брокер в «Стеке» — слово «шина» в ячейке слоя (форма шаблона: строка слоя «Шина») или слово «брокер», какой бы
    # продукт там ни стоял; у строки таблицы — только с продуктом (`| Шина | нет |`, `| Шина | — |` — брокера нет).
    BROKER = 0
    fstk = False
    for line in DL:
        line = strip1cr(line)
        if line.startswith("## "):
            fstk = line.startswith("## Стек")
            continue
        if fstk:
            cc_ = asplit(line, "|")
            if (((line.startswith("|") and has(r"(^|[ \t,(/`])(Шина|шина|ШИНА)", at(cc_, 2))) or has(r"(Брокер|брокер|БРОКЕР)", line))
                    and stack_product(line)):
                BROKER += 1
    WHO_REST = RNN
    if WHO_REST == "":
        WHO_REST = "без хозяина" if parts else "читающий"
    if PLAN != "" and nonempty(PLAN):
        # операция спецификации против ключа карточки — k_key: параметр пути в любой записи, без имени
        haveh: set = set()
        top: set = set()
        decl: set = set()
        for x in draftk:
            a = asplit(x, "\t")
            if at(a, 1) == "контракт" and has(r"^[A-Z]+ /", at(a, 2)):
                haveh.add(K.k_key(at(a, 2)))
            if at(a, 1) == "топики":
                top.add(sub1(r"^[^ ]+ ", "", at(a, 2)))
        for x in declared:
            k = K.k_opis(x)
            if has(r"^[A-Z]+ /", k):
                decl.add(K.k_key(k))
        nopc = nt = nh = 0
        miss = ""
        for line in rlines(PLAN):
            fs = T(strip1cr(line))
            if at(fs, 1) == "операция":
                nopc += 1
                k = K.k_key(at(fs, 2) + " " + at(fs, 3))
                kp = K.k_key(at(fs, 2) + " " + PFX + at(fs, 3))
                if not (k in haveh or kp in haveh or k in decl or kp in decl):
                    SPEC.append(at(fs, 2) + " " + at(fs, 3) + " (" + at(fs, 4) + ")\t" + (at(fs, 6) if at(fs, 6) != "-" else WHO_REST))
            elif at(fs, 1) == "топик":
                nt += 1
                if at(fs, 2) in top:
                    nh += 1
                else:
                    miss = miss + ("" if miss == "" else ", ") + at(fs, 2)
        if nt > 0 and 2 * nh < nt:
            TOPICS.append("топики конфига без блоков «Событий»: есть " + str(nh) + " из " + str(nt) + "; нет — " + miss + "\t" + WHO_REST)
        w("операции спецификаций на диске против карточки: в спецификациях %d, блока нет %d" % (nopc, len(SPEC)))
        if SPEC:
            w(" — " + lst([x.split("\t")[0] for x in SPEC]))
        else:
            w("\n")
        w("топики конфига разведчика против «Событий»: в конфиге %d, в карточке из них %d\n" % (nt, nh))
    if BROKER > 0 and NEV <= 1 and not TOPICS:
        TOPICS = ["брокер в «Стеке», а событий %d — слушатели и отправители не описаны\t%s" % (NEV, WHO_REST)]
    w("события против брокера и конфига — в добор: %d" % len(TOPICS))
    if TOPICS:
        w(" — " + "".join(x.split("\t")[0] + "\n" for x in TOPICS))
    else:
        w("\n")
    # Форма «Событий» и «Зависит от» — пункты добора, запись они не останавливают:
    #  SLOT — у блока «Событий» нет строки-метки (публикует: тело, ключ, когда, гарантия, не шлётся; потребляет:
    #    читает, группа, подтверждение, повтор, ошибка), у блока задачи — строки «наложение» — автору блока;
    #  INFRA — строка «Зависит от», чьё имя стоит словом в «Стеке» (БД, брокер), — автору строки.
    SLOT: list = []
    st_ = {"key": "", "need": ""}
    got: set = set()

    def done_() -> None:
        if st_["key"] != "" and st_["need"] != "":
            miss = ""
            for x in asplit(st_["need"], "|"):
                if x not in got:
                    miss += ", " + x + ":"
            if miss != "":
                SLOT.append(st_["key"] + " — нет строк " + miss[2:])
        st_["key"] = ""
        st_["need"] = ""
        got.clear()

    evs = jbs = False
    for line in DL:
        line = strip1cr(line)
        if line.startswith("## "):
            done_()
            evs = line.startswith("## События")
            jbs = line.startswith("## Фоновые задачи")
            continue
        if not evs and not jbs:
            continue
        if line.startswith("### "):
            done_()
            h = line[4:]
            p = h.find(" — ")
            if p >= 0:
                h = h[:p]
            if jbs:
                st_["key"] = K.k_canon("задачи", h)
                st_["need"] = "наложение" if st_["key"] != "" else ""
                continue
            k = K.k_canon("топики", h)
            st_["key"] = k
            st_["need"] = ("тело|ключ|когда|гарантия|не шлётся" if k.startswith("публикует ")
                           else ("читает|группа|подтверждение|повтор|ошибка" if k.startswith("потребляет ") else ""))
            continue
        if st_["key"] != "" and has(r"^- [^`:]+:", line):
            got.add(sub1(r":.*", "", line[2:]))
    done_()
    stw: set = set()
    deps: list = []
    sec = ""
    for line in DL:
        line = strip1cr(line)
        if line.startswith("## "):
            sec = line
            continue
        if sec.startswith("## Стек") and line.startswith("|"):
            low = K.k_low(line)
            for x in (re.split(r"[^a-z0-9]+", low) if low != "" else []):
                if len(x) > 2:
                    stw.add(x)
        if sec.startswith("## Зависит от") and line.startswith("|") and not has(SEPROW, line):
            dd = at(asplit(line, "|"), 2).replace("`", "")
            dd = gsub(r"^[ \t]+|[ \t]+\Z", "", dd)
            if dd != "" and dd != "—" and "Сервис или система" not in dd:
                deps.append(dd)
    INFRA = [x + " — имя стоит в «Стеке»" for x in deps if K.k_low(x) in stw]
    cnt_list("блоков «Событий» и задач без строк-меток", SLOT)
    # GLUED — строка «Что умеет», где в колонке «Возможность» два разных однородных глагола в неопределённой форме:
    # глагол первым словом или сразу после запятой, точки с запятой, двоеточия, «и», «или», «либо», «также»
    # (окончание -ть, -ться, -ести, -зти, -йти; на -ость, -есть, -асть — существительные). Текст после « — » —
    # пояснение и ограничение, не действие: не считается. Текст в «» и в бэктиках — подписи и токены — тоже.
    GLUED: list = []
    cs = False
    for line in DL:
        line = strip1cr(line)
        if line.startswith("## "):
            cs = line.startswith("## Что умеет")
            continue
        if not cs or not line.startswith("|") or has(SEPROW, line):
            continue
        c2_ = at(asplit(line, "|"), 2)
        if "Возможность" in c2_:
            continue
        if glued(c2_):
            GLUED.append(gsub(r"^[ \t]+|[ \t]+\Z", "", c2_))
    cnt_list("строк «Что умеет» с двумя действиями", GLUED)
    cnt_list("«Зависит от» — инфраструктура из «Стека»", INFRA)
    # Строки уровня сервиса в описи, пункты добора: ENTRY — в черновике есть «Роли и доступ», а строки `вход:` нет ни в
    # одной описи (у нарезанного её пишет голова); DEP — сосед из строки `зависит:` описей без строки «Зависит от»
    # (имена сводятся, как в гарде, — без обвязки клиента: keys.py k_dep).
    ENTRY: list = []
    has_entry = any(x.startswith("вход:") for x in allopis)
    if any(strip1cr(x).startswith("## Роли и доступ") for x in DL) and not has_entry:
        ENTRY = ["в описи нет строки «вход:»"]
    haved: set = set()
    sec = ""
    for line in DL:
        line = strip1cr(line)
        if line.startswith("## "):
            sec = line
            continue
        if sec.startswith("## Зависит от") and line.startswith("|") and not has(SEPROW, line):
            dd = at(asplit(line, "|"), 2).replace("`", "")
            dd = gsub(r"^[ \t]+|[ \t]+\Z", "", dd)
            if dd != "" and dd != "—":
                haved.add(K.k_dep(dd))
    DEP: list = []
    seend: set = set()
    for line in allopis:
        if line.startswith("зависит:"):
            s = sub1(r"^зависит:[ \t]*", "", line)
            p = s.find(" — ")
            if p >= 0:
                s = s[:p]
            s = s.replace("`", "")
            s = gsub(r"^[ \t]+|[ \t]+\Z", "", s)
            if s != "" and K.k_dep(s) not in haved and K.k_dep(s) not in seend:
                seend.add(K.k_dep(s))
                DEP.append(s + " — строки «Зависит от» нет")
    w("строка «вход» в описи: %s\n" % ("есть" if has_entry else "нет"))
    cnt_list("соседи из строк `зависит:` без строки «Зависит от»", DEP)
    # Проверки Шага 4, привязанные к секциям, — один проход по черновику. Механические (правило — регэксп, счёт,
    # порядок; исход — добор с перечнем) — пункты добора видов формы (FORM, автор — FHINT: ключ блока или строки в
    # секции частей, None — голова); где решает ведущий — «Кандидаты»: номер строки черновика и начало строки, до 15
    # на проверку.
    MAN = dirname(dirname(DRAFT)) + "/manifest.yaml"
    if not K.is_file(MAN):
        MAN = dirname(DRAFT) + "/manifest.yaml"
    mnames: list = []
    if K.is_file(MAN):
        for line in rlines(MAN):
            line = strip1cr(line)
            if has(r"^[ \t-]*name:[ \t]*", line):
                s = sub1(r"^[ \t-]*name:[ \t]*", "", line)
                s = gsub(r"[\"' \t]", "", s)
                if s != "":
                    mnames.append(s)
    man = MAN if mnames else "нет"
    havem = set(mnames)
    SECRE = "[A-Za-z0-9+/=_-]{21}"   # 21 знак подряд
    cnt: dict = {}
    Ls: dict = {}
    FORM: dict = {t: [] for t in ("BRHDR", "BRCODE", "USERCODE", "TAILFILE", "CELLS", "NOENT", "ORDER")}
    FHINT: dict = {t: [] for t in FORM}

    def addk(t: str, item: str, hint=None) -> None:
        FORM[t].append(item)
        FHINT[t].append(hint)

    def addn(k: str, nr: int, s: str) -> None:
        cnt[k] = cnt.get(k, 0) + 1
        if cnt[k] <= 15:
            Ls.setdefault(k, []).append("\n    %d: %s" % (nr, cutb(s, 160)))

    def strip_(s: str) -> str:
        return gsub(r"`[^`]*`", "", s)

    def codey(s: str) -> bool:
        t = strip_(s)
        return (has(r" /[a-z]", t) or has(r"(^|[^A-Za-z0-9_])(GET|POST|PUT|PATCH|DELETE)([^A-Za-z0-9_]|\Z)", t)
                or has(r"(^|[^A-Za-z0-9_])[a-z]+[A-Z][A-Za-z]*", t) or has(r"(^|[^A-Za-z0-9_])[a-z]+\.[a-z-]+\.[a-z-]+", t))

    def cell(s: str, i: int) -> str:
        s = at(asplit(s, "|"), i).replace("`", "")
        return gsub(r"^[ \t]+|[ \t]+\Z", "", s)

    def show(label: str, k: str) -> None:
        w("%s: %d%s\n" % (label, cnt.get(k, 0), "".join(Ls.get(k, []))))

    def key_(h: str) -> str:
        h = h[4:].replace("`", "")
        p = h.find(" — ")
        return h[:p] if p >= 0 else h

    def okey(s: str, h: str) -> str:
        if has(r"^Публичный (контракт|API)", s):
            v = sub1(r" .*", "", h)
            if has(HTTPRE + r"\Z", K.k_up(v)):
                return h[len(v) + 1:] + "\x02" + K.k_up(v)
        if s.startswith("Бизнес-правила"):
            return ("2" if h.startswith("сообщение") else ("3" if h.startswith("ограничение") else "1")) + h
        return h

    fence = False
    sec = ""
    hdr = 0
    prevk = ""
    prevh = ""
    inr = 0
    blk_ = ""
    blkn = 0
    blkk = ""
    bkey = ""
    hasent = 0
    evn = 0
    badord: dict = {}
    nr_ = 0
    rh: dict = {}
    rn: dict = {}
    rt: dict = {}
    roles: set = set()
    broker = 0
    sec_n = 0
    secl: list = []
    nmulti = 0
    scls = ""
    psec = 0
    for NR, line in enumerate(DL, 1):
        line = strip1cr(line)
        if line.startswith("```"):
            fence = not fence
            continue
        if fence:
            continue
        if line.startswith("## "):
            if blk_ != "" and not hasent:   # последний блок секции — тоже
                addk("NOENT", blk_, blkk if psec else None)
            sec = sub1(r"[ \t]+\Z", "", line[3:])
            scls = K.k_cls(line)
            psec = K.k_partsec(line)
            hdr = 0
            prevk = ""
            prevh = ""
            inr = 0
            blk_ = ""
            bkey = ""
            continue
        if line.startswith("### "):
            if blk_ != "" and not hasent:
                addk("NOENT", blk_, blkk if psec else None)
            blk_ = ""
            hasent = 0
            h = line[4:]
            p = h.find(" — ")
            if p >= 0:
                h = h[:p]
            bkey = norm(h)
            if has(r"^(Публичный контракт|Владеет данными|Фоновые задачи|События)", sec) and K.k_canon(scls, h) != "":
                bkey = K.k_canon(scls, h)
            if sec.startswith("События"):
                evn += 1
            k = okey(sec, key_(line))
            if not sec.startswith("Бизнес-правила") and prevk != "" and bb(k) < bb(prevk) and sec not in badord:
                badord[sec] = NR
                addk("ORDER", "«%s»: «%s» после «%s»" % (sec, key_(line), prevh), (bkey or None) if psec else None)
            prevk = k
            prevh = key_(line)
            if sec.startswith("Бизнес-правила"):
                if not has(r"^### (`[^`]+`|сообщение «)", line):   # «ограничение» блоком не бывает
                    addk("BRHDR", line)
                inr = 1 if line.startswith("### ограничение") else 0
                if inr:
                    nr_ += 1
                    rh[nr_] = line
                    rn[nr_] = NR
            if has(r"^Публичный (контракт|API)", sec) and not has(r"(health|metrics|ready|live|version|docs|swagger|openapi)", K.k_low(key_(line))):
                blk_ = line
                blkn = NR
                blkk = bkey
            continue
        if has(r"^Публичный (контракт|API)", sec) and line.startswith("сущности:"):
            hasent = 1
        if sec.startswith("Владеет данными") and (has(MULTIFIELD[0], line) or has(MULTIFIELD[1], line)):
            nmulti += 1
        if sec.startswith("Бизнес-правила"):
            if codey(line):
                addk("BRCODE", line)
            if inr:
                rt[nr_] = rt.get(nr_, "") + " " + line
        if sec.startswith("Назначение") and line != "":
            if codey(line) or "`" in line:
                addk("USERCODE", line)
        if sec.startswith("Стек") and has(r"[0-9]", line) and not has(SEPROW, line):
            addn("ver", NR, line)
        if sec.startswith("Роли и доступ") and line.startswith("|") and not has(SEPROW, line):
            r = cell(line, 2)
            p = r.find(" — ")
            if p >= 0:
                r = r[:p]
            if r != "" and r != "—":
                roles.add(r)
        if line.startswith("|"):
            if has(SEPROW, line):
                hdr = 1
                continue
            if not hdr:
                continue
            first = cell(line, 2)
            rc = asplit(line, "|")
            if sec.startswith("Что умеет") and codey(at(rc, 2)):
                addk("USERCODE", line)
            if has(r"^(Экраны|Роли и доступ|Зависит от|Потребляемые API)", sec) and ", " in first:
                addk("CELLS", line, row_key(scls, line) if psec else None)
            if (has(r"^(Зависит от|Потребляемые API)", sec) and first != "" and first != "—" and first not in havem
                    and "вне манифеста" not in line):
                addn("names", NR, line)
        if sec.startswith("Стек") and ((line.startswith("|") and has(r"(^|[ \t,(/])(Шина|шина|ШИНА)", cell(line, 2)))
                                       or has(r"(Брокер|брокер|БРОКЕР)", line)) and stack_product(line):
            broker = 1
        if tailfile(line):
            hint = None
            if psec:
                hint = (row_key(scls, line) if line.startswith("|") else bkey) or None
            addk("TAILFILE", line, hint)
        if has(SECRE, line):
            sl = gsub(r"`[^`]*`", "", line)
            m = R(SECRE + "[A-Za-z0-9+/=_-]*").search(sl)
            if m:
                sec_n += 1
                if sec_n <= 15:
                    secl.append("\n    %d: %s (%d знаков)" % (NR, cutb(m.group(0), 16), m.end() - m.start()))
    if blk_ != "" and not hasent:
        addk("NOENT", blk_, blkk if psec else None)
    for i in range(1, nr_ + 1):
        t = rh[i] + " " + rt.get(i, "")
        okk = any(x in t for x in havem if x != "") or any(x != "" and x in t for x in roles)
        if not okk:
            cnt["sw"] = cnt.get("sw", 0) + 1
            if cnt["sw"] <= 15:
                Ls.setdefault("sw", []).append("\n    %d: %s" % (rn[i], cutb(rh[i], 160)))
    ADD = [x for x in J["MISSRC"] if not has(BIZ, x)]
    NOSRC = [x for x in J["NOSRCPAIR"] if not has(BIZ, x)]
    w("перечень добора: ключ описи с источником без блока %d, ключ с блоком без источника %d, факт в описи — блок пуст %d, один ключ дважды %d\n"
      % (len(ADD), len(NOSRC), len(J["EMPTY"]), len(J["DUP"])))
    FILES = {"ADD": ADD, "NOSRC": NOSRC, "EMPTY": J["EMPTY"], "DUP": J["DUP"], "nometh": nometh, "NOKEY": NOKEY,
             "NOPFX": NOPFX, "MARKFILE": MARKFILE, "MISSED": [], "DECL": DECL, "PARTEMPTY": PARTEMPTY, "RULES": RULES,
             "REST": REST, "SPEC": SPEC, "TOPICS": TOPICS, "SLOT": SLOT, "GLUED": GLUED, "INFRA": INFRA,
             "ENTRY": ENTRY, "DEP": DEP, "STATE": STATE}
    FORM["SECS"] = SECS
    FHINT["SECS"] = [None] * len(SECS)
    FILES.update(FORM)
    if LISTS != "":
        # все виды, кроме видов частей и MISSED (ниже); пустой вид не пишется; пункт вида формы — строка черновика целиком
        s = ""
        for t in KINDS:
            if t in ("MISSED", "PARTEMPTY", "RULES", "REST"):
                continue
            if FILES[t]:
                s += "## " + TITLE[t] + "\n" + "".join((x if t in FORM else x.split("\t")[0]) + "\n" for x in FILES[t]) + "\n"
        try:
            K.write_text(LISTS, s)
            w("перечень добора целиком: " + LISTS + "\n")
        except OSError as ex:
            sys.stderr.write("check.py: %s: %s\n" % (LISTS, ex.strerror))
    w("опись по классам (класс — по паре в черновике): ")
    ccnt: dict = {}
    for x in join:
        if x.startswith("CLS\t"):
            v = at(T(x), 2)
            ccnt[v] = ccnt.get(v, 0) + 1
    w(", ".join(" ".join(fields(v)) + " " + str(ccnt[v]) for v in K.csort(ccnt)) + "\n")

    # Группы для «Полноты возможностей»: HTTP — по первым двум сегментам пути после обвязки: общего префикса
    # приложения (строка разведчика), сегментов версии `v<число>` и ведущих сегментов, общих для всех путей карточки
    # (у самого короткого пути остаётся свой); параметр сегментом не считается. gRPC и `Класс.метод` — по сервису или
    # классу, GraphQL — по операции; каждая фоновая задача и каждый потребляемый топик — своя группа.
    def trim(k: str) -> str:
        if PFX != "" and (k == PFX or k.startswith(PFX + "/")):
            k = k[len(PFX):]
        o = ""
        for x in asplit(k, "/")[1:]:
            if x != "" and not has(r"^v[0-9]+\Z", x):
                o += "/" + x
        return "/" if o == "" else o

    hp: list = []
    gc: dict = {}
    for fs in DK:
        c1, c2 = at(fs, 1), at(fs, 2)
        if c1 == "контракт":
            k = sub1(r"^[A-Z]+ ", "", c2)
            if k.startswith("/"):
                hp.append(trim(k))
                continue
            g = sub1(r"^rpc ", "", c2)
            g = sub1(r"\(.*\Z", "", g)
            if " " not in g and "." in g:
                g = sub1(r"\.[^.]*\Z", "", g)
            else:
                g = c2
            gc[g] = gc.get(g, 0) + 1
            continue
        if c1 == "задачи":
            gc["задача " + c2] = gc.get("задача " + c2, 0) + 1
        if c1 == "топики" and c2.startswith("потребляет"):
            gc[c2] = gc.get(c2, 0) + 1
    nhp = len(hp)
    nsg: list = []
    PS: dict = {}
    mn = 0
    for i in range(1, nhp + 1):
        S = asplit(hp[i - 1], "/")
        nsg.append(len(S))
        for j in range(2, len(S) + 1):
            PS[(i, j)] = S[j - 1]
        if i == 1 or len(S) < mn:
            mn = len(S)
    cseg = 2
    if nhp > 1:
        while cseg < mn:
            i = 2
            while i <= nhp and aeq(PS.get((i, cseg), ""), PS.get((1, cseg), "")):
                i += 1
            if i <= nhp or has(r"^[:{]", PS.get((1, cseg), "")):
                break
            cseg += 1
    for i in range(1, nhp + 1):
        if cseg > nsg[i - 1] or has(r"^[:{]", PS.get((i, cseg), "")):
            g = "/"
        else:
            g = "/" + PS[(i, cseg)]
            if cseg < nsg[i - 1] and not has(r"^[:{]", PS.get((i, cseg + 1), "")):
                g = g + "/" + PS[(i, cseg + 1)]
        gc[g] = gc.get(g, 0) + 1
    groups = K.csort(g + " (" + str(gc[g]) + ")" for g in gc)
    w("группы черновика для «Что умеет» (%d): " % len(groups))
    w(lst(groups))

    w("== КАНДИДАТЫ ПРОВЕРОК (решаешь ты; номер строки черновика)\n")
    show("«Бизнес-правила», ограничений без переключателя из манифеста или ролей", "sw")
    show("«Стек», строк с цифрами (версия?)", "ver")
    w("«Зависит от» / «Потребляемые API», имён не из манифеста (сервис ли — решаешь ты; манифест: %s): %d%s\n"
      % (man, cnt.get("names", 0), "".join(Ls.get("names", []))))
    w("похожих на секрет строк: %d%s\n" % (sec_n, "".join(secl)))
    w("«События»: блоков %d; брокер в «Стеке»: %s\n" % (evn, "да" if broker else "нет"))

    ROUTE = ""
    if PREV != "":
        w("== ГАРД (прежняя " + basename(PREV) + ")\n")
        prev = parse_card(PREV)
        ROUTE = "ПОВЕРХ"
        for cc in ("контракт", "сущности", "задачи", "топики", "экраны", "потребляет", "роли", "зависит"):
            gone, new, emptied, paired, was, paths = gmatch(cc, PREFIX, prev, draft)
            if was == 0 and not new:
                continue
            paired = K.csort(paired)
            g, a, e = len(gone), len(new), len(emptied)
            name = "зависит от" if cc == "зависит" else ("потребляемые API" if cc == "потребляет" else cc)
            w("%s: было %d, исчезло %d, появилось %d, опустело %d\n" % (name, was, g, a, e))
            if g > 0:
                w("  исчезли: " + lst(gone))
            if e > 0:
                w("  опустели: " + lst(emptied))
            if a > 0 and g > 0:
                w("  появились: " + lst(new))
            if paired:
                w("  сведены (то же, записано иначе): " + lst(paired))
            for pth, n0, n1 in paths:
                w("  путь %s: блоков было %d, стало %d\n" % (pth, n0, n1))
            if (g >= 3 and 3 * g > was) or (e >= 3 and 3 * e > was):
                ROUTE = "В _pending"
                w("  ⇒ правило маршрута сработало на классе «%s»\n" % name)
        w("МАРШРУТ: " + ROUTE + "\n")

    # Исход — гейты сводит скрипт, а не ведущий: маркеры (по сервису и частям), доставка тела контракта
    # (тело меньше чем у половины блоков — не доехало), гард. «Гейт не пройден» — добор, пока бюджет
    # есть; без бюджета — по SKILL.md. Перечень добора — по авторам: часть, голова; у одиночного — читающий.
    # Пометки остатка — отдельные пункты добора, а не ключи описи или новый гейт.
    # Читаем и сводную опись, и описи частей: одинаковая пометка после склейки — один пункт.
    MISSED = K.csort(set(x[len(P_MISS):] for x in allopis if x.startswith(P_MISS)))
    FILES["MISSED"] = MISSED
    files_: dict = {}
    paths_: dict = {}
    kinds_: dict = {}
    if PLAN != "":
        for line in rlines(PLAN):
            r = asplit(strip1cr(line), "\t")
            if at(r, 1) == "файл":
                files_[np_own(at(r, 2))] = at(r, 5)
            if at(r, 1) == "путь":
                p = np_own(at(r, 2))
                paths_[p] = at(r, 4)
                kinds_[p] = at(r, 3)
    owners: list = []
    for line in MISSED:
        j = line.find(" — ")
        owner = ""
        best = 0
        conflict = 0
        if j >= 0:
            f = np_own(line[j + 3:])
            # Точный файл старше папки. Совпадение по относительному хвосту должно быть однозначным.
            for p in files_:
                if same_own(f, p) and files_[p] != "-":
                    if owner != "" and not aeq(owner, files_[p]):
                        conflict = 1
                    owner = files_[p]
                    best = len(f) + 1
            for p in paths_:
                q = f
                depth = len(f) + 1
                if kinds_[p] == "папки":
                    q = sub1(r"/[^/]+\Z", "", q)
                    depth = len(q)
                while q != f or kinds_[p] == "файлы":
                    if same_own(q, p):
                        if depth > best:
                            owner = paths_[p]
                            best = depth
                            conflict = 0
                        elif depth == best and not aeq(owner, paths_[p]):
                            conflict = 1
                        break
                    if kinds_[p] != "папки" or "/" not in q:
                        break
                    q = sub1(r"/[^/]+\Z", "", q)
                    depth = len(q)
        if owner == "" or conflict:
            owner = "без хозяина"
        owners.append(line + "\t" + owner)
    w("== ИСХОД\n")
    MG = markgate
    if MG == "":
        MG = "плана нет — сверки маркеров нет"
    w("маркеры: " + MG + "\n")
    NB = BB = 0
    for fs in DK:
        if at(fs, 1) == "контракт":
            NB += 1
            if acmpn(at(fs, 3), 0) > 0:
                BB += 1
    BF = ""
    if NB == 0:
        w("доставка тела: блоков контракта нет — сверки нет\n")
    elif 2 * BB < NB:
        BF = "тело у %d из %d блоков контракта" % (BB, NB)
        w("доставка тела: НЕ ПРОЙДЕН — " + BF + ", меньше половины\n")
    else:
        w("доставка тела: пройден — тело у %d из %d блоков контракта\n" % (BB, NB))
    w("гард: " + (ROUTE if ROUTE != "" else "прежней карточки нет") + "\n")
    FAIL = ""
    if MG.startswith("НЕ ПРОЙДЕН"):
        FAIL = "маркеры: " + (MG[len("НЕ ПРОЙДЕН — "):] if MG.startswith("НЕ ПРОЙДЕН — ") else MG)
    if BF != "":
        FAIL = (FAIL + "; " if FAIL != "" else "") + BF
    if FAIL != "":
        w("ИСХОД: гейт не пройден — " + FAIL + "\n")
    elif ROUTE == "В _pending":
        w("ИСХОД: в _pending — гард\n")
    elif ROUTE != "":
        w("ИСХОД: записать поверх\n")
    else:
        w("ИСХОД: записать\n")
    items = [(t, x, i) for t in KINDS for i, x in enumerate(FILES[t])]
    missed_o: dict = {}
    for x in owners:
        fs = asplit(x, "\t")
        missed_o[at(fs, 1)] = at(fs, 2)
    # Авторы ключа — сперва по k_keyn, потом по k_key; вызов без скобок — вторым.
    def owners_of(rows: list):
        ix: tuple = ({}, {})
        seen_: set = set()
        for x in rows:
            fs = asplit(x, "\t")
            for j, kk in enumerate((K.k_keyn(at(fs, 1)), K.k_key(at(fs, 1)))):
                if (j, kk, at(fs, 2)) not in seen_:
                    seen_.add((j, kk, at(fs, 2)))
                    cur = ix[j].get(kk, "")
                    ix[j][kk] = cur + ("" if cur == "" else ",") + at(fs, 2)
        return ix

    op = owners_of(own_opis)
    cp = owners_of(own_card)

    def look(ix: tuple, k: str) -> str:
        for j, kk in ((0, K.k_keyn(k)), (0, K.k_bare(K.k_keyn(k))), (1, K.k_key(k)), (1, K.k_bare(K.k_key(k)))):
            if kk in ix[j]:
                return ix[j][kk]
        return ""

    routed: list = []
    for t, x, i in items:
        fs = T(t + "\t" + x)
        k = at(fs, 2)
        kk = sub1(r" — .*", "", k)
        if t in FORM:   # вид формы: строка черновика целиком; автор — голова либо автор блока или строки по ключу
            k = x
            a = "читающий" if not parts else ("голова" if FHINT[t][i] is None else look(cp, FHINT[t][i]))
        elif t == "MISSED":
            a = missed_o.get(k, "")
        elif t == "SPEC" or t == "TOPICS":
            a = at(fs, 3)
        elif not parts:
            a = "читающий"
        elif t in ("INFRA", "ENTRY", "DEP", "GLUED"):
            a = "голова"
        elif t == "SLOT":
            a = look(cp, kk)
        elif t in ("RULES", "STATE"):
            a = "голова"
        elif t == "REST":
            a = sub1(r"\).*", "", sub1(r".*\(остаток ", "", k))
        elif t == "MARKFILE":
            a = sub1(r"\).*", "", sub1(r".*\(часть ", "", k))
        elif t == "DUP":
            dd = asplit(k, " ~ ")
            a = look(cp, at(dd, 1))
            b = look(cp, at(dd, 2))
            a = a + ("," if a != "" and b != "" else "") + b
        elif t in ("ADD", "NOSRC", "EMPTY"):
            a = look(op, k)
            if a == "":
                a = look(cp, k)
        elif t == "NOKEY":
            a = look(cp, sub1(r"^[^:]*: ", "", k))
        else:
            a = look(cp, k)
            if a == "":
                a = look(op, k)
        if a == "":
            a = "без хозяина"
        done: set = set()
        for y in asplit(a, ","):
            if y not in done:
                done.add(y)
                routed.append((y, t, k))
    if routed:
        RT = routed
        for a in K.csort(set(at(fs, 1) for fs in RT)):
            mine = [fs for fs in RT if aeq(at(fs, 1), a)]
            # виды пунктов — в той же строке: строка ДОБОР видна в любом журнале, файл перечня — только в .work/
            ko: list = []
            kc: dict = {}
            for fs in mine:
                if at(fs, 2) not in kc:
                    ko.append(at(fs, 2))
                    kc[at(fs, 2)] = 0
                kc[at(fs, 2)] += 1
            kinds = ", ".join("%s %d" % (NM.get(x, ""), kc[x]) for x in ko)
            label = "часть " + a if has(r"^[0-9]", a) else a
            file = ""
            if LISTS != "":
                if not parts:
                    file = LISTS
                else:
                    fid = "head" if a == "голова" else ("none" if a == "без хозяина" else a)
                    file = (LISTS[:-3] if LISTS.endswith(".md") else LISTS) + "-" + fid + ".md"
                    s = ""
                    for t in KINDS:
                        one = [at(fs, 3) for fs in mine if at(fs, 2) == t]
                        if one:
                            s += "## " + TITLE[t] + "\n" + "".join(x + "\n" for x in one) + "\n"
                    try:
                        K.write_text(file, s)
                    except OSError as ex:
                        sys.stderr.write("check.py: %s: %s\n" % (file, ex.strerror))
            w("ДОБОР %s: %d (%s)%s\n" % (label, len(mine), kinds, (" — " + file) if file != "" else ""))
    else:
        w("ДОБОР: пусто\n")
    # «Владеет данными»: несколько полей в одной строке `- ` — не добор: карточка пишется, в отчёт — число.
    if nmulti > 0:
        w("в отчёт: «Владеет данными» — строк `- ` с несколькими полями: %d\n" % nmulti)
    if LISTS != "" and not parts and MISSED:
        try:
            K.append_text(LISTS, "## " + TITLE["MISSED"] + "\n" + "".join(x + "\n" for x in MISSED) + "\n")
        except OSError as ex:
            sys.stderr.write("check.py: %s: %s\n" % (LISTS, ex.strerror))
    if UNREAD:
        w("не прочитано %d: %s\n" % (len(UNREAD), UNREAD[0]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
