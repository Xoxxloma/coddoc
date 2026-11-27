# clean.py — уборка рабочих файлов прогона без модели.
#
#   python3 clean.py <папка services> <имя>[,<имя>…]
#
# По каждому имени удаляет ровно `.work/<имя>.opis.md`, `.work/<имя>.md` и папку `.work/<имя>/` со всем, что в ней
# (файлы частей, головы, счёта, плана, перечня). Чужие файлы в `.work/` не трогает: параллельный прогон другого
# сервиса держит там свои. По ссылкам и точкам соединения не ходит — удаляет саму ссылку. Имя с `/`, `\`, `..` или
# с точки — отказ по этому имени. Печатает, что не удалилось; последняя строка — `clean: removed N, left M` (код 0;
# 1, если что-то осталось; 2 — нет папки services или негодное имя).
import sys

sys.dont_write_bytecode = True
import os
import stat

try:
    import keys as K
except ImportError:
    print("скилл установлен не целиком: нет %s/keys.py" % os.path.dirname(os.path.abspath(__file__)).replace("\\", "/"))
    sys.exit(2)


def is_link(p: str) -> bool:
    """Символьная ссылка или точка соединения Windows — удаляется сама, внутрь не заходим."""
    try:
        st = os.lstat(p)
    except OSError:
        return False
    if stat.S_ISLNK(st.st_mode):
        return True
    return bool(getattr(st, "st_file_attributes", 0) & 0x400)   # FILE_ATTRIBUTE_REPARSE_POINT


def drop(p: str, shown: str, gone: list, left: list) -> None:
    try:
        if is_link(p):
            try:
                os.unlink(p)
            except OSError:
                os.rmdir(p)   # точка соединения на Windows снимается как папка, без захода внутрь
        elif os.path.isdir(p):
            for e in sorted(os.listdir(p)):
                drop(os.path.join(p, e), shown + "/" + e, gone, left)
            os.rmdir(p)
        else:
            os.remove(p)
        gone.append(shown)
    except OSError:
        left.append(shown)


def main() -> int:
    c = K.start()
    if len(c.args) < 2 or c.args[0] == "":
        sys.stderr.write("clean.py: нужны <папка services> и имена через запятую\n")
        return 2
    svc = c.args[0].rstrip("/")
    if not K.is_dir(svc):
        print("НЕТ ПАПКИ: " + svc)
        print("clean: removed 0, left 0")
        return 2
    names = [n.strip().strip("`") for n in ",".join(c.args[1:]).split(",")]
    names = [n for n in names if n != ""]
    bad = [n for n in names if "/" in n or "\\" in n or ".." in n or n.startswith(".")]
    for n in bad:
        print("ОТКАЗ: имя «%s» — не имя сервиса, его файлы не трогаю" % n)
    work = svc + "/.work"
    gone: list = []
    left: list = []
    for n in names:
        if n in bad:
            continue
        for shown in (work + "/" + n + ".opis.md", work + "/" + n + ".md", work + "/" + n):
            p = K.fpath(shown)
            if os.path.lexists(p):
                drop(p, shown, gone, left)
    if left:
        print("рабочие файлы остались, удалите руками: " + ", ".join(left))
    print("clean: removed %d, left %d" % (len(gone), len(left)))
    return 2 if bad else (1 if left else 0)


if __name__ == "__main__":
    sys.exit(main())
