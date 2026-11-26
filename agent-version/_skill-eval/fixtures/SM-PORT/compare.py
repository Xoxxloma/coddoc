# Сверка записей вызовов bash ↔ Python (run.sh): по ключу вызова (скрипт + аргументы) — код выхода, stdout,
# stderr, копии файлов-аргументов. Случайные имена mktemp сводятся (как sm_norm в sm-run.sh).
#   python compare.py <запись bash> <запись py> [--allow <файл>] [--allow-call <файл>] [--show N]
# --allow: строки «<скрипт>\t<регэксп>» — расхождение, у которого обе строки пары совпадают с регэкспом, — допустимое;
# --allow-call: строки «<регэксп по команде вызова>\t<причина>» — расхождение такого вызова допустимое. Оба списка
# составляются до сверки; остальные расхождения — красные.
import os, re, sys
for _st in (sys.stdout, sys.stderr):
    _st.reconfigure(encoding="utf-8", errors="replace")

NORM = re.compile(rb"((?:sm-[a-z0-9-]+|tmp)\.)[A-Za-z0-9]{6,10}")


def norm(b):
    return NORM.sub(rb"\1R", b)


def files(d):
    out = {}
    for root, _, fs in os.walk(d):
        for f in fs:
            p = os.path.join(root, f)
            r = os.path.relpath(p, d).replace("\\", "/")
            if r == "cmd":
                continue
            with open(p, "rb") as h:
                out[r] = norm(h.read())
    return out


def tsv(path):
    out = []
    for ln in open(path, encoding="utf-8"):
        ln = ln.rstrip("\n")
        if ln and not ln.startswith("#") and "\t" in ln:
            out.append(ln.split("\t", 1))
    return out


def main():
    a, b = sys.argv[1], sys.argv[2]
    show = 6
    allow = []
    calls = []
    args = sys.argv[3:]
    while args:
        x = args.pop(0)
        if x == "--show":
            show = int(args.pop(0))
        elif x == "--allow":
            allow += [(s, re.compile(rx.encode("utf-8"))) for s, rx in tsv(args.pop(0))]
        elif x == "--allow-call":
            calls += [(re.compile(rx), why) for rx, why in tsv(args.pop(0))]
    ka = {k for k in os.listdir(a) if not k.startswith(".")}
    kb = {k for k in os.listdir(b) if not k.startswith(".")}
    stats = {}
    red = 0
    okdiff = 0
    ok_calls = {}
    for k in sorted(ka - kb):
        print("ТОЛЬКО bash:", k)
        red += 1
    for k in sorted(kb - ka):
        print("ТОЛЬКО py:", k)
        red += 1
    for k in sorted(ka & kb):
        scr = k.rsplit("-", 1)[0]
        st = stats.setdefault(scr, [0, 0])
        st[0] += 1
        fa, fb = files(os.path.join(a, k)), files(os.path.join(b, k))
        bad = []
        for name in sorted(set(fa) | set(fb)):
            x, y = fa.get(name), fb.get(name)
            if x == y:
                continue
            if x is None or y is None:
                bad.append((name, "нет у " + ("bash" if x is None else "py"), []))
                continue
            lx, ly = x.split(b"\n"), y.split(b"\n")
            pairs = []
            for i in range(max(len(lx), len(ly))):
                u = lx[i] if i < len(lx) else b"<EOF>"
                v = ly[i] if i < len(ly) else b"<EOF>"
                if u != v:
                    pairs.append((i + 1, u, v))
            real = [p for p in pairs if not any(s in (scr, "*") and r.search(p[1]) and r.search(p[2]) for s, r in allow)]
            if real:
                bad.append((name, "строк расходится: %d" % len(real), real))
            else:
                okdiff += 1
        if not bad:
            continue
        cmd = open(os.path.join(a, k, "cmd"), encoding="utf-8", errors="replace").read().split("\n")
        why = next((w for rx, w in calls if rx.search(" ".join(cmd))), None)
        if why:
            okdiff += 1
            ok_calls.setdefault(why, []).append(k)
            continue
        st[1] += 1
        red += 1
        print("== РАСХОЖДЕНИЕ", k, "|", " ".join(cmd[1:4])[:200])
        for name, w, real in bad:
            print("   ", name, "—", w)
            for i, u, v in real[:show]:
                print("      %d bash: %s" % (i, u.decode("utf-8", "replace")[:220]))
                print("      %d py:   %s" % (i, v.decode("utf-8", "replace")[:220]))
    for why, ks in sorted(ok_calls.items()):
        print("допустимо (%d): %s" % (len(ks), why))
    print("ИТОГ сверки:", ", ".join("%s %d вызовов, расходится %d" % (s, v[0], v[1]) for s, v in sorted(stats.items())),
          "| красных вызовов: %d, допустимых расхождений: %d" % (red, okdiff))
    sys.exit(1 if red else 0)


main()
