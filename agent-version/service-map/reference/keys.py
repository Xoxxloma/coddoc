# keys.py — общий модуль скриптов скилла: ключ по шаблону (card.template.md, «Ключи строк») и ввод-вывод.
# Только функции: скрипты импортируют модуль. Python 3.8+, только стандартная библиотека.
#
# Ключ блока по классу: «контракт» — метод и путь (одно слово: пометка после пробела в ключ не входит) без
# строки запроса (хвост после «?», в котором нет «/») либо тип операции и имя без аргументов; «топики» — направление
# и топик: топик — текст в бэктиках, без них — единственное слово после направления; общая обвязка брокера —
# «транспорт» и имя тем же правилом; «сущности», «задачи» — имя одним словом. Заголовок, который к ключу не
# сводится, — "" (вызывающий берёт его как есть и называет «ключ не опознан»).
from __future__ import annotations

import atexit
import os
import re
import sys

# ---------------------------------------------------------------------------------------------------------------
# Регэкспы. R(p) — DOTALL (точка — любой символ, как в awk) и ASCII (`\w`, `\d`, `\s`, `\b` — как в локали C).
# Конец строки — `\Z`, а не `$`: `$` в Python совпадает и перед хвостовым "\n".

_RX: dict = {}


def R(p: str):
    r = _RX.get(p)
    if r is None:
        r = _RX[p] = re.compile(p, re.S | re.A)
    return r


def sub1(p: str, repl: str, s: str) -> str:
    """sub() awk: первое совпадение."""
    return R(p).sub(repl, s, count=1)


def gsub(p: str, repl: str, s: str) -> str:
    """gsub() awk: все совпадения."""
    return R(p).sub(repl, s)


def has(p: str, s: str) -> bool:
    """s ~ /p/ в awk."""
    return R(p).search(s) is not None


def awk_split(s: str, sep: str) -> list:
    """split(s, a, sep) awk с одним символом-разделителем: у пустой строки — 0 элементов."""
    return [] if s == "" else s.split(sep)


# ---------------------------------------------------------------------------------------------------------------
# Ввод-вывод. Байты — как у awk в локали C: файл читается без перевода строк ("\r" остаётся в записи),
# не-UTF-8 байты проходят насквозь (surrogateescape), вывод — UTF-8 с "\n".

ERR = "surrogateescape"
_VAR = re.compile(r"[A-Z][A-Z0-9_]*=", re.S)


def setup_io() -> None:
    """stdout/stderr — UTF-8 и "\n": при перенаправлении Windows иначе даёт cp1251/cp866 и "\r\n"."""
    for st in (sys.stdout, sys.stderr):
        try:
            st.reconfigure(encoding="utf-8", errors=ERR, newline="\n")
        except (AttributeError, ValueError, OSError):
            pass


def fpath(p: str) -> str:
    """Путь для открытия: на Windows `/c/…` (форма Git Bash) → `c:/…`; путь от 240 символов — с префиксом `\\\\?\\`
    (без него Python такой файл не откроет, если в системе выключен LongPathsEnabled, а bash в MSYS открывал)."""
    if os.name == "nt":
        m = re.match(r"/([A-Za-z])(?:/|\Z)", p)
        if m:
            p = m.group(1) + ":/" + p[3:]
        if not p.startswith("\\\\?\\"):
            a = os.path.abspath(p)
            if len(a) >= 240:
                return "\\\\?\\UNC\\" + a[2:] if a.startswith("\\\\") else "\\\\?\\" + a
    return p


def _msys_root() -> str:
    """Папка Git for Windows с `/` на конце, если скрипт позвали из Git Bash: аргумент `/x` Git Bash переписывает в
    `<папка Git>/x` (`/api` → `C:/Program Files/Git/api`) — такому значению возвращается `/x`."""
    if os.name != "nt" or not os.environ.get("MSYSTEM"):
        return ""
    for d in os.environ.get("PATH", "").split(os.pathsep):
        d = d.replace("\\", "/").rstrip("/")
        if d.lower().endswith("/usr/bin") and os.path.isfile(d + "/bash.exe"):
            return d[:-len("/usr/bin")] + "/"
    return ""


class Cli:
    """Аргументы как у run.ps1: ИМЯ=значение подряд сразу после имени скрипта — переменные (поверх окружения);
    `--out <файл>` — вывод в файл байт в байт; на Windows во всех значениях `\\` → `/`, а значению из Git Bash,
    которое начинается с папки Git, возвращается `/x` (_msys_root)."""

    def __init__(self, argv=None):
        a = list(sys.argv[1:] if argv is None else argv)
        root = _msys_root()

        def fix(s: str) -> str:
            if os.name != "nt":
                return s
            s = s.replace("\\", "/")
            return "/" + s[len(root):] if root and s.startswith(root) else s
        self.vars: dict = {}
        self.args: list = []
        self.out = None
        lead = True
        i = 0
        while i < len(a):
            x = a[i]
            if x == "--out":
                if i + 1 >= len(a):
                    print("service-map: error usage")
                    sys.exit(2)
                self.out = fix(a[i + 1])
                i += 2
                continue
            if lead and _VAR.match(x):
                n, _, v = x.partition("=")
                self.vars[n] = fix(v)
                i += 1
                continue
            lead = False
            self.args.append(fix(x))
            i += 1
        self._fix = fix

    def env(self, name: str, default: str = "") -> str:
        v = self.vars.get(name)
        if v is None:
            # переменная окружения (`export CHECK_PREFIX=/api` в Git Bash): её значение Git Bash тоже переписывает
            # в `<папка Git>/api` — возврат тот же, что у аргументов
            v = os.environ.get(name)
            v = default if v is None else self._fix(v)
        return v

    def arg(self, i: int, default: str = "") -> str:
        return self.args[i] if i < len(self.args) else default


def start(argv=None) -> Cli:
    """Начало каждого скрипта: кодировка вывода, разбор аргументов, `--out`."""
    setup_io()
    c = Cli(argv)
    if c.out is not None:
        d = os.path.dirname(fpath(c.out))
        if d:
            os.makedirs(d, exist_ok=True)
        f = open(fpath(c.out), "w", encoding="utf-8", errors=ERR, newline="\n")
        sys.stdout = f
        atexit.register(f.close)
    return c


def read_bytes(p: str) -> bytes:
    with open(fpath(p), "rb") as f:
        return f.read()


def read_text(p: str, bom: bool = True) -> str:
    """Свой файл (карточка, опись, план, счёт): BOM снимается. Чужой код — bom=False, как grep."""
    b = read_bytes(p)
    if bom and b.startswith(b"\xef\xbb\xbf"):
        b = b[3:]
    return b.decode("utf-8", ERR)


def lines_of(t: str) -> list:
    """Записи awk: по "\n", "\r" остаётся, за последним "\n" записи нет. Не splitlines(): та режет и по "\r"."""
    if t == "":
        return []
    ls = t.split("\n")
    if ls[-1] == "":
        ls.pop()
    return ls


def read_lines(p: str, bom: bool = True) -> list:
    return lines_of(read_text(p, bom))


def write_text(p: str, s: str) -> None:
    with open(fpath(p), "wb") as f:
        f.write(s.encode("utf-8", ERR))


def append_text(p: str, s: str) -> None:
    with open(fpath(p), "ab") as f:
        f.write(s.encode("utf-8", ERR))


def is_file(p: str) -> bool:
    return os.path.isfile(fpath(p))


def is_dir(p: str) -> bool:
    return os.path.isdir(fpath(p))


def exists(p: str) -> bool:
    return os.path.exists(fpath(p))


def bkey(s: str) -> bytes:
    """Ключ сортировки `sort` под LC_ALL=C — по байтам."""
    return s.encode("utf-8", ERR)


def csort(xs) -> list:
    return sorted(xs, key=bkey)


def blen(s: str) -> int:
    """length() awk под LC_ALL=C — в байтах."""
    return len(s.encode("utf-8", ERR))


def num(x) -> str:
    """Число, как его печатает print awk: целое — без точки, иначе %.6g."""
    if isinstance(x, float):
        if x == int(x) and abs(x) < 1e16:
            return str(int(x))
        return "%.6g" % x
    return str(x)


# ---------------------------------------------------------------------------------------------------------------
# Ключи (порт keys.awk; имена функций — те же).

HTTP = "GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS"


def k_up(s: str) -> str:
    """Регистр — только у латиницы."""
    return "".join(chr(ord(c) - 32) if "a" <= c <= "z" else c for c in s)


def k_low(s: str) -> str:
    return "".join(chr(ord(c) + 32) if "A" <= c <= "Z" else c for c in s)


def k_norm(s: str) -> str:
    s = s.replace("`", "")
    s = gsub("«|»", "", s)
    s = s.replace("\r", "")
    s = sub1(r"^[ \t]+", "", s)
    s = sub1(r"[ \t]+\Z", "", s)
    s = gsub(r"[ \t]+", " ", s)
    v = sub1(r" .*", "", s)
    if has(r"^(" + HTTP + r")\Z", k_up(v)):
        s = k_up(v) + s[len(v):]
    return s


def k_canon(cls: str, h: str) -> str:
    k = k_norm(h)
    if cls == "контракт":
        if has(r"^(" + HTTP + r") ", k):   # путь — одно слово: пометка после пробела не ключ
            d = sub1(r" .*", "", k)
            rest = sub1(r" .*", "", k[len(d) + 1:])
            k = d + " " + rest
            m = R(r"\?[^/]*\Z").search(k)
            if m:
                k = k[:m.start()]
            return k
        if has(r"^(query|mutation|subscription|rpc) ", k):
            return sub1(r"[ ]*\(.*\)\Z", "", k)
        if has(r"^[A-Za-z_][A-Za-z0-9_.]*[./][A-Za-z_][A-Za-z0-9_]*(\(.*\))?\Z", k):
            return k
        return ""
    if cls == "топики":
        d = sub1(r" .*", "", k)
        if not has(r"^(публикует|потребляет|транспорт)\Z", d):
            return ""
        m = R(r"`[^`]+`").search(h)
        if m:
            return d + " " + h[m.start() + 1:m.end() - 1]
        rest = k[len(d) + 1:]
        return d + " " + rest if (rest != "" and " " not in rest) else ""
    if cls == "сущности" or cls == "задачи":
        return k if (k != "" and " " not in k) else ""
    return k


def k_opis(h: str) -> str:
    """Ключ строки описи: класс — по виду строки (у описи секций нет); не сводится — как есть. Вызов соседа
    («Потребляемые API»: `<сервис> <вызов>` или `<сервис> :: <вызов>`) — тот же ключ, что у строки карточки:
    `<сервис> :: <вызов>`."""
    k = k_norm(h)
    if has(r"^(" + HTTP + r"|query|mutation|subscription|rpc) ", k):
        c = k_canon("контракт", h)
        return k if c == "" else c
    if has(r"^(публикует|потребляет|транспорт) ", k):
        c = k_canon("топики", h)
        return k if c == "" else c
    if has(r"^[^ :]+( ::)? (" + HTTP + r"|query|mutation|subscription|rpc) ", k):
        s = sub1(r"[ :].*\Z", "", k)
        c = sub1(r"^( ::)? ", "", k[len(s):])
        return s + " :: " + k_opis(c)
    return k


def k_fact(h: str) -> int:
    """Строка описи без отступа, которая не ключ, а факт: соседи, строки «Бизнес-правил», роли."""
    return 1 if has(r"^(зависит|состояние|справочник|сообщение|ограничение|роль|Роль):", h) else 0


def k_bare(k: str) -> str:
    """Ключ контракта вызовом («query night(id)», «Dome.Close(Req)») без скобок; у HTTP — как есть."""
    if has(r"^(" + HTTP + r") ", k):
        return k
    if has(r"[^ (]\(.*\)\Z", k):
        k = sub1(r"\(.*\)\Z", "", k)
    return k


# Форма по типу — как таблица порядка секций шаблона (card.template.md; сверяет проба SM-PLAN-TYPES).
# Секция → класс пометок разведчика; у типа — его секции классов; секции частей — те, что пишут части
# нарезки (brief-part.md) и склеивает assemble.py. Тип режется, только если все его секции классов —
# секции частей. Тип неизвестен — всё как у любого: классы все, нарезка по весу.
def k_cls(sec: str) -> str:
    sec = sub1(r"^## +", "", sec)
    if has(r"^Публичный (контракт|API)", sec):
        return "контракт"
    if has(r"^Владеет данными", sec):
        return "сущности"
    if has(r"^Фоновые задачи", sec):
        return "задачи"
    if has(r"^События", sec):
        return "топики"
    if has(r"^Экраны", sec):
        return "экраны"
    if has(r"^Бизнес-правила", sec):
        return "бизнес"
    if has(r"^Роли и доступ", sec):
        return "роли"
    if has(r"^Зависит от", sec):
        return "зависит"
    if has(r"^Потребляемые API", sec):
        return "потребляет"
    if has(r"^Состояние и данные", sec):
        return "состояние"
    return ""


def k_partsec(sec: str) -> int:
    sec = sub1(r"^## +", "", sec)
    return 1 if has(r"^(Публичный контракт|Владеет данными|События|Фоновые задачи|Потребляемые API)", sec) else 0


def k_typesecs(t: str) -> str:
    if t == "backend":
        return "Публичный контракт|События|Фоновые задачи|Владеет данными"
    if t == "frontend":
        return "Экраны|Потребляемые API|Состояние и данные"
    if t == "fullstack":
        return "Публичный контракт|События|Фоновые задачи|Владеет данными|Экраны|Потребляемые API|Состояние и данные"
    if t == "lib":
        return "Публичный API"
    return ""


def k_typehas(t: str, c: str) -> int:
    if c == "клиенты" or k_typesecs(t) == "":
        return 1
    for s in awk_split(k_typesecs(t), "|"):
        if k_cls(s) == c:
            return 1
    return 0


def k_typesplit(t: str) -> int:
    for s in awk_split(k_typesecs(t), "|"):
        if not k_partsec(s):
            return 0
    return 1


def k_role(k: str) -> str:
    """Сведённый ключ гарда — для второго прохода сверки, только среди ключей без точной пары: то же, записанное
    в двух сканах по-разному, сводится к одному. Роль — имя без области в скобках."""
    return sub1(r"[ \t]*\(.*\Z", "", k)


def k_dep(k: str) -> str:
    """Сосед — без пояснения в скобках и без обвязки клиента, как в правиле имени шаблона («Как в коде»):
    `client.skycam-legacy.host`, `SKYCAM_LEGACY_URL`, `SkycamLegacyClient` → `skycam-legacy`."""
    k = sub1(r"[ \t]*\(.*\Z", "", k)
    r = ""
    p = ""
    for c in k:
        if "A" <= c <= "Z" and (("a" <= p <= "z") or ("0" <= p <= "9")):
            r += "-"
        r += c
        p = c
    r = k_low(r).replace("_", "-")
    r = sub1(r"^clients?\.", "", r)
    r = sub1(r"^web-?client-?", "", r)   # `client-portal` — имя соседа, его не трогаем
    while True:
        r, n = R(r"[.-](host|url|uri|endpoint|base-url)\Z").subn("", r, count=1)
        if n == 0:
            break
    return sub1(r"-client\Z", "", r)


def k_nopre(k: str, pre: str) -> str:
    """Путь контракта — без общего префикса приложения: «GET /api/nights» при префиксе `api` → «GET /nights»."""
    if not has(r"^(" + HTTP + r") /", k):
        return k
    p = gsub(r"/+", "/", pre)
    p = sub1(r"/\Z", "", p)
    if not has(r"^/", p):
        p = "/" + p
    if p == "/":
        return k
    v = sub1(r" .*", "", k)
    k = k[len(v) + 1:]
    if k == p:
        return v + " /"
    if k[:len(p) + 1] == p + "/":
        return v + " " + k[len(p):]
    return v + " " + k


# Ключ сравнения. Ключ показа (заголовок блока) остаётся как его написал автор; сравнивают ключи — опись с
# черновиком, черновик со спекой и с прежней карточкой, блоки частей при склейке — только через k_key/k_keyn.
# HTTP: параметр пути — целый сегмент в любой записи (`{x}`, `{x:.+}`, `:x`, `<x>`, `<int:x>`, `*`); имя с точкой
# (`{upload.s3.public_url}` — путь из конфига) — не параметр, а часть пути. Двойной и хвостовой `/` сведены; у вызова
# соседа «<сервис> :: <вызов>» — то же у вызова.
# k_key — без имён параметров (`{}`): сверка; k_keyn — с именем (`{x}`): склейка блоков разных авторов, у которых
# совпал k_key, — только при том же имени (`:id` = `{id}`, но `{ids}` ≠ `{userId}`). Не HTTP — ключ как есть.
def _k_param(s: str):
    """Имя параметра сегмента пути ("" у `*`) или None, если сегмент — не параметр."""
    m = R(r"^\{([A-Za-z_][A-Za-z0-9_]*)(?::.*)?\}\Z").search(s)
    if m is None:
        m = R(r"^:([A-Za-z_][A-Za-z0-9_]*)\Z").search(s)
    if m is None:
        m = R(r"^<(?:[A-Za-z_][A-Za-z0-9_]*:)?([A-Za-z_][A-Za-z0-9_]*)>\Z").search(s)
    if m is not None:
        return m.group(1)
    return "" if s == "*" else None


def _k_path(k: str, names: bool) -> str:
    i = k.find(" :: ")
    if i >= 0:   # вызов соседа «<сервис> :: <вызов>» (k_opis) — сводится вызов
        return k[:i + 4] + _k_path(k[i + 4:], names)
    if not has(r"^(" + HTTP + r") ", k):
        return k
    v = sub1(r" .*", "", k)
    p = sub1(r" .*", "", k[len(v) + 1:])
    out = []
    for i, s in enumerate(p.split("/")):
        if s == "" and i > 0:
            continue
        n = _k_param(s)
        out.append(s if n is None else ("{" + n + "}" if names else "{}"))
    q = "/".join(out)
    if q == "":
        q = "/"
    elif not q.startswith("/"):
        q = "/" + q
    return v + " " + q


def k_key(k: str) -> str:
    """Ключ сравнения: параметры пути — `{}`, имя не учитывается."""
    return _k_path(k, False)


def k_keyn(k: str) -> str:
    """Ключ склейки разных авторов: параметры пути — `{имя}` в одной записи."""
    return _k_path(k, True)
