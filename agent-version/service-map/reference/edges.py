# edges.py — Шаг 5 без модели: обратные рёбра слепка.
#
#   python3 edges.py <папка services> <manifest.yaml>
#
# Источники — карточки `services/<name>.md`, у которых есть строка в манифесте (`_pending/` не
# смотрится вовсе): строки их «Потребляемые API» (| сервис | вызов | зачем |) и «Зависит от»
# (| сервис | зачем |). Зеркало — копия строки с заменой первой колонки на имя источника:
#   потребляемый вызов → | `<источник>` | <вызов> | <зачем> |
#   зависимость        → | `<источник>` | — | <зачем> |
# Цель — сервис из первой колонки, если у него есть карточка слепка; иначе строка пропускается
# (внешняя система, сосед вне манифеста). Секция «Кто меня потребляет» каждой карточки слепка
# пересобирается целиком: заголовок таблицы, разделитель, зеркала по возрастанию (источник, вызов);
# зеркал нет — пустая форма `| — | | |`. `\|` внутри ячейки — часть ячейки. Остальные строки файла —
# байт в байт. Пишет только эти секции; печатает итог по карточкам.
#
#   python3 edges.py <папка services> <manifest.yaml> --only <имя>[,<имя>…]
#
# С `--only` — только карточки, затронутые сервисами прогона: их собственные секции пересобираются
# целиком, у целей — нынешних (зеркала от них) и прежних (в секции есть строка от них) — заменяются
# только строки от сервисов прогона, строки остальных источников остаются байт в байт. Прочие карточки
# слепка не открываются на запись вовсе, даже если их секция устарела.
import sys

sys.dont_write_bytecode = True
import os
import re

try:
    import keys as K
except ImportError:
    print("скилл установлен не целиком: нет %s/keys.py" % os.path.dirname(os.path.abspath(__file__)).replace("\\", "/"))
    sys.exit(2)

HEAD = "## Кто меня потребляет"
WS = "[ \t\n\r\f\v]"   # класс space sed под LC_ALL=C
# Строка, похожая на число (strnum awk): два таких операнда `==` awk сравнивает числом.
_NUM = re.compile(r"[ \t\n\r\f\v]*[-+]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][-+]?[0-9]+)?[ \t\n\r\f\v]*\Z")
unread: list = []


def eq(a: str, b: str) -> bool:
    """`a == b` awk у двух strnum (поле, элемент split, -v)."""
    if _NUM.match(a) and _NUM.match(b):
        return float(a) == float(b)
    return a == b


def tf(s: str, i: int) -> str:
    """$(i+1) при -F'\\t'; за NF — ""."""
    a = s.split("\t")
    return a[i] if i < len(a) else ""


def el(a: list, i: int) -> str:
    return a[i] if i < len(a) else ""


def k1(s: str) -> str:
    """Первый элемент split(s, k, "\\001")."""
    return el(K.awk_split(s, "\x01"), 0)


def cell(s: str) -> str:
    s = s.replace("\x02", "\\|")
    return K.gsub(r"^[ \t]+|[ \t]+\Z", "", s)


def bare(s: str) -> str:
    return cell(s).replace("`", "")


def nocr(s: str) -> str:
    return s[:-1] if s.endswith("\r") else s


def card(p: str):
    """Строки карточки как записи awk; BOM не снимается — файл переписывается байт в байт вне секции."""
    try:
        return K.lines_of(K.read_text(p, bom=False))
    except OSError:
        if p not in unread:
            unread.append(p)
        return None


def mirrors_of(src: str, ls: list, have: set) -> list:
    """Зеркала источника: цель<TAB>ключ-сортировки<TAB>строка; в конце — `<src>\\t\\t#SKIP N`."""
    out = []
    sec = ""
    hdr = 0
    skipped = 0
    for rec in ls:
        line = nocr(rec)
        if line.startswith("## "):
            sec = line
            hdr = 0
            continue
        if not K.has(r"^## (Потребляемые API|Зависит от)", sec):
            continue
        if not line.startswith("|"):
            continue
        if K.has(r"^\|[ \t:|-]*\Z", line):   # разделитель: всё выше было заголовком
            hdr = 1
            continue
        if not hdr:
            continue
        line = line.replace("\\|", "\x02")   # экранированная черта — внутри ячейки
        c = K.awk_split(line, "|")
        c2 = el(c, 1)
        t = bare(c2)
        if t == "" or t == "—":
            continue
        # t — strnum, пока ни один gsub в cell/bare его не изменил
        if t not in have or (eq(t, src) if t == c2 else t == src):
            skipped += 1
            continue
        if "Потребляемые API" in sec:
            call = cell(el(c, 2))
            why = cell(el(c, 3))
        else:
            call = "—"
            why = cell(el(c, 2))
        if call == "":
            call = "—"
        out.append("%s\t%s\x01%s\t| `%s` | %s | %s |" % (t, src, bare(call), src, call, why))
    if skipped:
        out.append("%s\t\t#SKIP %d" % (src, skipped))
    return out


def sec_rows(ls) -> list:
    """Строки секции «Кто меня потребляет» карточки: ключ-сортировки<TAB>строка как есть (без CR)."""
    out = []
    insec = False
    hdr = 0
    for rec in ls or []:
        line = nocr(rec)
        if line.startswith("## "):
            insec = line.startswith(HEAD)
            hdr = 0
            continue
        if not insec or not line.startswith("|"):
            continue
        if K.has(r"^\|[ \t:|-]*\Z", line):
            hdr = 1
            continue
        if not hdr:
            continue
        c = K.awk_split(line.replace("\\|", "\x02"), "|")
        s = bare(el(c, 1))
        if s == "" or s == "—":
            continue
        call = bare(el(c, 2))
        if call == "":
            call = "—"
        out.append(s + "\x01" + call + "\t" + line)
    return out


def unread_line() -> None:
    if unread:
        print("не прочитано %d: %s" % (len(unread), unread[0]))


def main() -> int:
    c = K.start()
    svc = c.arg(0)
    if svc == "":
        sys.stderr.write("edges.py: 1: папка services\n")
        return 1
    man = c.arg(1)
    if man == "":
        sys.stderr.write("edges.py: 2: manifest.yaml\n")
        return 1
    only_arg = ""
    if c.arg(2) == "--only":
        only_arg = c.arg(3)
        if only_arg == "":
            sys.stderr.write("edges.py: 4: после --only — имена сервисов через запятую\n")
            return 1
    if not (K.is_dir(svc) and K.is_file(man)):
        print("НЕТ ПАПКИ ИЛИ МАНИФЕСТА")
        return 2

    # Имена слепка: строки манифеста `name:`, у которых есть карточка.
    try:
        mls = K.read_lines(man)
    except OSError:
        unread.append(man)
        mls = []
    cand = set()
    for ln in mls:
        ln = nocr(ln)
        if K.has(r"^[ \t-]*name:[ \t]*", ln):
            s = K.sub1(r"^[ \t-]*name:[ \t]*", "", ln)
            s = K.gsub("[\"' \t]", "", s)
            if s != "" and K.is_file(svc + "/" + s + ".md"):
                cand.add(s)
    names = K.csort(cand)
    if not names:
        unread_line()
        print("карточек слепка нет — Шага 5 нет")
        return 0
    have = set(names)

    # Зеркала: цель<TAB>ключ-сортировки<TAB>строка.
    mirrors = []
    for src in names:
        mirrors.extend(mirrors_of(src, card(svc + "/" + src + ".md") or [], have))
    ms = sorted((m for m in mirrors if "#SKIP" not in m),
                key=lambda m: (K.bkey(tf(m, 0)), K.bkey(tf(m, 1)), K.bkey(m)))

    # --only: сервисы прогона из слепка; затронутые — они сами, цели их зеркал и карточки, где уже есть
    # строки от них (ребро могло исчезнуть).
    only: list = []
    S: set = set()
    touched: list = []
    if only_arg:
        raw = set()
        for x in K.lines_of((only_arg + "\n").replace(",", "\n")):
            x = x.replace("`", "")
            x = K.sub1("^" + WS + "*", "", x)
            x = K.sub1(WS + "*\\Z", "", x)
            if x != "":
                raw.add(x)
        only = [x for x in K.csort(raw) if x in have]
        S = set(only)
        tch = set(only)
        for m in ms:
            if k1(tf(m, 1)) in S:
                tch.add(tf(m, 0))
        for t in names:
            for r in sec_rows(card(svc + "/" + t + ".md")):
                if k1(tf(r, 0)) in S:
                    tch.add(t)
                    break
        touched = K.csort(tch)
    tset = set(touched)

    # Пересборка секции у каждой карточки слепка. Строки вне секции выводятся как есть (с CR, если был);
    # переписанные строки берут окончание файла — CRLF, если им кончается заголовок секции.
    written = 0
    for tgt in names:
        if only_arg and tgt not in tset:
            continue
        f = svc + "/" + tgt + ".md"
        ls = card(f)
        if only_arg and tgt not in S:
            # цель сервисов прогона: их строки — заново, строки остальных источников — как были
            a = [r for r in sec_rows(ls) if k1(tf(r, 0)) not in S]
            a += [tf(m, 1) + "\t" + tf(m, 2) for m in ms if eq(tf(m, 0), tgt) and k1(tf(m, 1)) in S]
            a.sort(key=lambda r: (K.bkey(tf(r, 0)), K.bkey(r)))
            rows = [r.split("\t", 1)[1] if "\t" in r else r for r in a]
        else:
            rows = [tf(m, 2) for m in ms if eq(tf(m, 0), tgt)]
        nrows = len(rows)
        if ls is None or not any(x.startswith(HEAD) for x in ls):
            print("  %s — секции «Кто меня потребляет» нет, не тронута%s"
                  % (tgt, "; зеркал не записано: %d" % nrows if nrows > 0 else ""))
            continue
        o = []
        skip = False
        for rec in ls:
            cr = "\r" if rec.endswith("\r") else ""
            line = nocr(rec)
            if line.startswith(HEAD):
                o.append(rec + "\n")
                o.append("| Сервис | Что вызывает | Зачем |%s\n|---|---|---|%s\n" % (cr, cr))
                if nrows == 0:
                    o.append("| — | | |%s\n" % cr)
                else:
                    o.extend(r + cr + "\n" for r in rows)
                o.append(cr + "\n")
                skip = True
                continue
            if skip and line.startswith("## "):
                skip = False
            if skip:
                continue
            o.append(rec + "\n")
        try:
            K.write_text(f, "".join(o))
        except OSError:
            sys.stderr.write("edges.py: не записано: %s\n" % f)
        written += nrows
        print("  %s — зеркал %d" % (tgt, nrows))
    for m in mirrors:
        if "#SKIP" not in m:
            continue
        if only_arg and tf(m, 0) not in S:
            continue
        print("  %s — строк в сервисы без карточки слепка: %s" % (tf(m, 0), K.sub1("#SKIP ", "", tf(m, 2))))
    unread_line()
    if only_arg:
        print("Шаг 5: карточек слепка %d, зеркал всего %d; только затронутые прогоном (%s): %s, остальные не тронуты"
              % (len(names), written, ",".join(only), ",".join(touched)))
    else:
        print("Шаг 5: карточек слепка %d, зеркал всего %d" % (len(names), written))
    return 0


if __name__ == "__main__":
    sys.exit(main())
