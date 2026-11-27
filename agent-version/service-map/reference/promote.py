# promote.py — продвижение черновика без модели: копия байт-в-байт и три счёта сверки.
#
#   python3 promote.py <черновик> <куда>
#
# Пишет только <куда> (папку создаёт). Копия идёт во временный файл рядом и переносится на место
# только после сверки — прежняя карточка при любом сбое остаётся как была. Печатает счёты `^### `,
# `^| ` и всех строк по обоим файлам и итог «КОПИЯ ВЕРНА → <куда>» либо «КОПИЯ РАСХОДИТСЯ — не
# записано» (код 4).
import sys

sys.dont_write_bytecode = True
import os
import shutil

try:
    import keys as K
except ImportError:
    print("скилл установлен не целиком: нет %s/keys.py" % os.path.dirname(os.path.abspath(__file__)).replace("\\", "/"))
    sys.exit(2)


def main() -> int:
    c = K.start()
    if len(c.args) < 1 or c.args[0] == "":
        sys.stderr.write("promote.py: 1: черновик\n")
        return 1
    if len(c.args) < 2 or c.args[1] == "":
        sys.stderr.write("promote.py: 2: куда\n")
        return 1
    src, dst = c.args[0], c.args[1]
    tmp = None

    def fail(why: str) -> int:
        print("КОПИЯ РАСХОДИТСЯ — не записано: " + why)
        if tmp is not None:
            try:
                os.remove(K.fpath(tmp))
            except OSError:
                pass
        return 4

    if not K.is_file(src):
        print("НЕТ ФАЙЛА: " + src)
        return 2
    if K.is_dir(dst):
        return fail("«%s» — папка, а не путь карточки" % dst)
    d = os.path.dirname(dst) or "."
    try:
        os.makedirs(K.fpath(d), exist_ok=True)
    except OSError:
        return fail("не создаётся папка " + d)
    tmp = "%s.promote.%d" % (dst, os.getpid())
    try:
        shutil.copyfile(K.fpath(src), K.fpath(tmp))
    except OSError:
        return fail("копия не сделана")

    def cnt(p: str) -> str:
        b = K.read_bytes(p)
        ls = b.split(b"\n")
        if ls and ls[-1] == b"":
            ls.pop()
        h = sum(1 for x in ls if x.startswith(b"### "))
        t = sum(1 for x in ls if x.startswith(b"| "))
        return "%d %d %d" % (h, t, b.count(b"\n"))

    a, b = cnt(src), cnt(tmp)
    print("черновик: ### | строк — " + a)
    print("копия:    ### | строк — " + b)
    if not (a == b and K.read_bytes(src) == K.read_bytes(tmp)):
        return fail("счёты или байты разошлись")
    try:
        os.replace(K.fpath(tmp), K.fpath(dst))
    except OSError:
        return fail("перенос на место не удался")
    print("КОПИЯ ВЕРНА → " + dst)
    return 0


if __name__ == "__main__":
    sys.exit(main())
