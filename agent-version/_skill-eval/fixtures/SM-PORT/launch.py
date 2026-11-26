# Самотест запуска скриптов service-map-2.0 (срез П, вместо selftest-sm-run-ps1.mjs). Моделей не запускает.
#   python launch.py [--keep]
# Каждая командная строка `python3 "<…/reference/X.py>" …` из SKILL.md берётся дословно, плейсхолдеры заменяются
# значениями, `python3` → `python` (Windows), и строка запускается дважды в одной и той же песочнице: из Git Bash
# (`bash -c`, абсолютные пути `C:/…`) и из PowerShell 5.1 в ConstrainedLanguage (строка в .ps1, пути `C:\…`).
# Песочница и копия скилла — по путям с пробелом и кириллицей. Сверка: коды выхода и все файлы песочницы — байт
# в байт; stdout — справочно (PowerShell перекодирует вывод программы кодировкой консоли).
import os, re, shutil, subprocess, sys

for _st in (sys.stdout, sys.stderr):
    _st.reconfigure(encoding="utf-8", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))
EV = os.path.normpath(os.path.join(HERE, "..", ".."))
SKILL = os.environ.get("SM_SKILL") or os.path.normpath(os.path.join(EV, "..", "service-map-2.0"))
TOP = os.path.join(EV, "selftest", "port", "launch")            # gitignored
BOX = os.path.join(TOP, "спек репо")                             # cwd команд — корень репозитория со спеками
SK = os.path.join(TOP, "скилл копия", "reference")
NAME = "telescope-api"


def git_bash():
    """bash из Git for Windows: просто `bash` у CreateProcess — это System32 (WSL)."""
    g = shutil.which("git")
    if g:
        for c in ("../bin/bash.exe", "../../bin/bash.exe", "../usr/bin/bash.exe"):
            q = os.path.normpath(os.path.join(os.path.dirname(g), c))
            if os.path.isfile(q):
                return q
    return "bash"


BASH = git_bash()
F = os.path.join(EV, "fixtures")


def cmds_from_skill():
    t = open(os.path.join(SKILL, "SKILL.md"), encoding="utf-8").read()
    out = []
    for ln in t.split("\n"):
        for m in re.finditer(r"`(python3 \"<[^`]+)`", ln):
            out.append(m.group(1))
        if ln.startswith('python3 "<'):
            out.append(ln.strip())
    return out


def build():
    shutil.rmtree(TOP, ignore_errors=True)
    os.makedirs(SK)
    for f in os.listdir(os.path.join(SKILL, "reference")):
        if f.endswith(".py"):
            shutil.copy(os.path.join(SKILL, "reference", f), SK)
    svc = os.path.join(BOX, "services")
    shutil.copytree(os.path.join(F, "SM-EDGES-SCRIPT", "cases", "basic", "services"), svc)
    shutil.copytree(os.path.join(F, "SM-ASSEMBLE-SLOTS", "asm"), os.path.join(svc, ".work", NAME))
    code = os.path.join(BOX, "код сервиса")
    for p, body in (("src/a/A.java", "class A {}\n"), ("src/b/B.java", "class B {}\n"), ("src/a/E.java", "class E {}\n")):
        q = os.path.join(code, p); os.makedirs(os.path.dirname(q), exist_ok=True)
        open(q, "w", encoding="utf-8", newline="\n").write(body)
    po = os.path.join(svc, ".work", "plan-only"); os.makedirs(po)
    r = code.replace("\\", "/")
    open(os.path.join(po, "counts.txt"), "w", encoding="utf-8", newline="\n").write(
        "## контракт :: ключ\n%s/src/a/A.java:3\n%s/src/b/B.java:2\n## сущности :: ключ\n%s/src/a/E.java:4\n" % (r, r, r))
    # строки разведчика для count.py (он перепишет counts.txt до plan.py)
    open(os.path.join(po, "scout.txt"), "w", encoding="utf-8", newline="\n").write(
        "контракт :: ^class [AB]\\b :: *.java :: ключ\nсущности :: ^class E\\b :: *.java :: ключ\n"
        "контроль :: контракт :: %s/src/a/A.java :: 1\n" % r)


def values(win):
    def ab(*p):
        s = os.path.join(*p)
        return s.replace("/", "\\") if win else s.replace("\\", "/")
    v = {
        "<scout.txt>": ab(BOX, "services", ".work", "plan-only", "scout.txt"),
        "<counts>": ab(BOX, "services", ".work", "plan-only", "counts.txt"),
        "<K>": "30", "<w>": "1",
        "<абсолютные пути сервиса через запятую>": ab(BOX, "код сервиса"),
        "<план>": ab(BOX, "services", ".work", "plan-only", "plan.tsv"),
        "<type>": "backend", "<число частей>": "2", "<дата>": "2026-10-21",
        "<префикс>": "api", "<перечень>": "services/.work/%s/dobor.md" % NAME,
        "<опись>": "services/.work/%s.opis.md" % NAME, "<черновик>": "services/.work/%s.md" % NAME,
        "<путь>": "services/_pending/%s.md" % NAME,
        "<абсолютный путь к services>": ab(BOX, "services"),
        "<абсолютный путь к services/manifest.yaml>": ab(BOX, "services", "manifest.yaml"),
        "<имена записанных в этом прогоне карточек через запятую>": "auth,web",
        "<имена сервисов прогона через запятую>": "plan-only,%s" % NAME,
        "<name>": NAME,
        "<вывод>": "services/.work/%s/check1.txt" % NAME,
        "<N>": "1",
    }
    return v, ab


def fill(tpl, win, prev, pre=None, tail=""):
    v, ab = values(win)
    if pre is not None:
        v["<префикс>"] = pre
    s = re.sub(r"<(?:абсолютный путь к |…/)reference/([a-z]+\.py)>", lambda m: ab(SK, m.group(1)), tpl)
    s = s.replace(' ["<прежняя карточка>"]', ' "%s"' % prev if prev else "")
    if tail.startswith(" --out ") and "<вывод>" in s:   # вывод сверки в _pending — вместо файла Шага 4
        s, tail = s.replace('"<вывод>"', tail[len(" --out "):]), ""
    for k in sorted(v, key=len, reverse=True):
        s = s.replace(k, v[k])
    if "<" in s:
        raise SystemExit("не заменён плейсхолдер: " + s)
    return re.sub(r"^python3 ", "python ", s)


def runs(tpls):
    """Шаги: каждая строка SKILL.md; у check — ещё с прежней карточкой и с --out (Шаг 4, «_pending»)."""
    out = []
    for t in tpls:
        out.append((t, None, ""))
        if "check.py" in t:
            out.append((t, "services/.work/%s.md" % NAME, ""))
            out.append((t, None, ' --out "services/_pending/%s.check.txt"' % NAME))
            # префикс со слэшем: Git Bash переписывает `/api` в `<папка Git>/api` — скрипт возвращает `/api`
            out.append((t, None, "", "/api"))
    order = ["count.py", "plan.py", "assemble.py", "check.py", "promote.py", "edges.py", "clean.py"]
    # check --out — после promote: папку _pending в скилле создаёт продвижение (Шаг 4)
    return sorted(out, key=lambda x: 4.5 if x[2] else next(i for i, s in enumerate(order) if s in x[0]))


def snapshot():
    snap = {}
    for root, dirs, files in os.walk(BOX):
        dirs.sort()
        for f in sorted(files):
            p = os.path.join(root, f)
            snap[os.path.relpath(p, BOX).replace("\\", "/")] = open(p, "rb").read()
    return snap


def run_mode(mode, steps):
    build()
    res = []
    wrapper = os.path.join(TOP, "clm-run.ps1")
    with open(wrapper, "w", encoding="utf-8-sig", newline="\r\n") as f:
        f.write("$ExecutionContext.SessionState.LanguageMode = 'ConstrainedLanguage'\n"
                "Set-Location -LiteralPath $args[0]\n& $args[1]\nexit $LASTEXITCODE\n")
    for i, st in enumerate(steps):
        tpl, prev, tail = st[:3]
        line = fill(tpl, mode == "ps", prev, st[3] if len(st) > 3 else None, tail)
        if mode == "bash":
            p = subprocess.run([BASH, "-c", line], cwd=BOX, capture_output=True)
        else:
            sc = os.path.join(TOP, "cmd%02d.ps1" % i)
            with open(sc, "w", encoding="utf-8-sig", newline="\r\n") as f:
                f.write(line + "\n")
            p = subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", wrapper, BOX, sc],
                               cwd=BOX, capture_output=True)
        res.append((line, p.returncode, p.stdout, p.stderr))
    return res, snapshot()


def main():
    tpls = cmds_from_skill()
    print("строк запуска в SKILL.md: %d (%s)" % (len(tpls), ", ".join(re.search(r"([a-z]+)\.py", t).group(1) for t in tpls)))
    steps = runs(tpls)
    rb, sb = run_mode("bash", steps)
    rp, sp = run_mode("ps", steps)
    bad = 0
    for (lb, cb, ob, eb), (lp, cp, op, ep) in zip(rb, rp):
        scr = re.search(r"([a-z]+)\.py", lb).group(1)
        ok = cb == cp
        same_out = ob.replace(b"\r\n", b"\n") == op.replace(b"\r\n", b"\n")
        print("%s %-9s код bash %d / ps %d; stdout %s" % ("ok " if ok else "ОШИБКА", scr, cb, cp,
              "совпадает" if same_out else "расходится (справочно)"))
        if cb != 0 or cp != 0:
            print("    bash: %s" % (ob + eb).decode("utf-8", "replace").strip().split("\n")[-1][:200])
            print("    ps:   %s" % (op + ep).decode("utf-8", "replace").strip().split("\n")[-1][:200])
        bad += not ok
    for k in sorted(set(sb) | set(sp)):
        if sb.get(k) != sp.get(k):
            bad += 1
            print("ОШИБКА файл %s: %s" % (k, "нет у ps" if k not in sp else "нет у bash" if k not in sb else "байты расходятся"))
    made = [k for k in sb if k.startswith("services/_pending/") or k.endswith((".md", ".tsv")) and "/.work/" in k]
    print("файлов в песочнице: %d, из них записаны скриптами (выборка): %s" % (len(sb), ", ".join(sorted(made))[:300]))
    print("ИТОГ запуска: %s" % ("ОК" if bad == 0 else "ОШИБОК %d" % bad))
    if "--keep" not in sys.argv:
        shutil.rmtree(TOP, ignore_errors=True)
    sys.exit(1 if bad else 0)


main()
