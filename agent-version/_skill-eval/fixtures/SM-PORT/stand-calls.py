# Вызовы скриптов скилла в журналах прогонов стенда (срез П): каждый ли из пяти позван и как.
#   python stand-calls.py <раунд> [<раунд> …]
# Ищет команды Bash/PowerShell в _stream.jsonl и _sub/**/*.jsonl каждой песочницы. Нарушения формы вызова:
# `bash …sh`, `run.ps1`, `ИМЯ=… python` (переменная впереди), `>` в файл вместо `--out`, `.sh`/`keys.awk` вообще.
# Исход гейта (срез 3, F15): по каждому сервису — последний вердикт `ИСХОД:` вывода check.py в журнале; «гейт не
# пройден» → в песочнице есть `services/_pending/<имя>.md` и `.check.txt`, карточка на месте не изменилась: по строке
# `_seeded.txt`, если раннер её снял, иначе — по отсутствию записи поверх (promote.py в `services/<имя>.md`, Write/Edit).
# Ответы субагентов (срез 3): у читающих, частей, остатка и головы — не 3 непустые строки — счётчик, справочно.
import glob, json, os, re, sys

for _st in (sys.stdout, sys.stderr):
    _st.reconfigure(encoding="utf-8", errors="replace")
SCRIPTS = ("count", "plan", "check", "assemble", "promote", "edges", "clean")
BAD = [
    ("bash …sh", re.compile(r"\bbash\b[^\n|;&]*\.sh\b")),
    ("run.ps1", re.compile(r"run\.ps1")),
    (".sh/keys.awk скилла", re.compile(r"reference[/\\][a-z]+\.(sh|awk)\b")),
    # префикс окружения у самой команды python, в той же строке: `CHECK_PLAN=… python …` (присваивание `WD=…` строкой
    # выше — не префикс)
    ("переменная впереди", re.compile(r"(?m)(^|[;&|]\s*)[A-Z][A-Z0-9_]*=[^\s\n]*(\s+[A-Z][A-Z0-9_]*=[^\s\n]*)*[ \t]+python3?\b")),
    # `>` в той же команде после `python … X.py` (не `2>`, не `->` в тексте дописи журнала)
    ("> вместо --out", re.compile(r"\bpython3?[ \t][^\n|;&]*\b(count|plan|check|assemble|promote|edges|clean)\.py\b[^\n|;&]*[^2\-]>\s*\S")),
]
SCRIPT_RX = {s: re.compile(r"\b%s\.py\b" % s) for s in SCRIPTS}   # и через переменную: "$SKILL/reference/plan.py"


def commands(path):
    out = []
    try:
        f = open(path, encoding="utf-8", errors="replace")
    except OSError:
        return out
    for ln in f:
        if '"tool_use"' not in ln:
            continue
        try:
            j = json.loads(ln)
        except ValueError:
            continue
        msg = j.get("message") or {}
        for c in msg.get("content") or []:
            if isinstance(c, dict) and c.get("type") == "tool_use" and c.get("name") in ("Bash", "PowerShell"):
                cmd = (c.get("input") or {}).get("command", "")
                if cmd:
                    out.append(cmd)
    return out


def results(path):
    """(вход tool_use, текст результата) по порядку журнала: вход — строкой JSON, текст — склейкой частей."""
    uses, out = {}, []
    try:
        f = open(path, encoding="utf-8", errors="replace")
    except OSError:
        return out
    for ln in f:
        if '"tool_use"' not in ln and '"tool_result"' not in ln:
            continue
        try:
            j = json.loads(ln)
        except ValueError:
            continue
        for c in (j.get("message") or {}).get("content") or []:
            if not isinstance(c, dict):
                continue
            if c.get("type") == "tool_use":
                uses[c.get("id")] = (c.get("name"), json.dumps(c.get("input") or {}, ensure_ascii=False))
            elif c.get("type") == "tool_result":
                body = c.get("content")
                if isinstance(body, list):
                    body = "\n".join(x.get("text", "") for x in body if isinstance(x, dict))
                out.append((uses.get(c.get("tool_use_id"), ("", ""))[1], body if isinstance(body, str) else ""))
    return out


NAME_IN = re.compile(r"services[/\\]+(?:\.work|_pending)[/\\]+([^/\\\s\"'`]+?)(?:[/\\]|\.opis\.md|\.check\.txt|\.md)")


def gate_outcome(d, files):
    """Строки отчёта и число нарушений исхода гейта по одной песочнице."""
    last = {}
    for f in files:
        for inp, txt in results(f):
            v = re.findall(r"ИСХОД: ([^\r\n]*)", txt)
            if not v:
                continue
            m = re.search(r"== ЧЕРНОВИК (\S+?)\.md", txt) or NAME_IN.search(inp)
            if m:
                last[m.group(1)] = v[-1].strip()
    lines, nbad = [], 0
    man = sorted(glob.glob(os.path.join(d, "w", "*", "services", "manifest.yaml")))
    svc = os.path.dirname(man[0]) if man else ""
    seeded = {}
    try:
        for ln in open(os.path.join(d, "_seeded.txt"), encoding="utf-8", errors="replace"):
            r = ln.rstrip("\r\n").split("\t")
            if len(r) >= 3:
                seeded[r[0].replace("\\", "/")] = (r[1], r[2])
    except OSError:
        pass
    cmds, writes = [], []
    for f in files:
        cmds += commands(f)
        writes += [inp for inp, _ in results(f)]
    for name in sorted(last):
        v = last[name]
        if not v.startswith("гейт не пройден"):
            lines.append("   исход гейта %s: %s" % (name, v))
            continue
        miss = []
        for x in (name + ".md", name + ".check.txt"):
            if not svc or not os.path.isfile(os.path.join(svc, "_pending", x)):
                miss.append("нет services/_pending/" + x)
        card = os.path.join(svc, name + ".md") if svc else ""
        rel = os.path.relpath(card, os.path.join(d, "w")).replace("\\", "/") if card else ""
        if rel in seeded:
            st = os.stat(card) if os.path.isfile(card) else None
            sz, mt = seeded[rel]
            sec, _, frac = mt.partition(".")
            ns = int(sec) * 10 ** 9 + int((frac + "000000000")[:9])
            if st is None or str(st.st_size) != sz or abs(st.st_mtime_ns - ns) > 10 ** 6:
                miss.append("карточка изменилась против _seeded.txt")
            how = "по _seeded.txt"
        else:
            over = re.compile(r"services[/\\]+%s\.md\b" % re.escape(name))
            if any("promote.py" in c and over.search(c) for c in cmds):
                miss.append("promote.py поверх services/%s.md" % name)
            if any('"file_path"' in w and over.search(w) and ('"content"' in w or '"new_string"' in w) for w in writes):
                miss.append("Write/Edit поверх services/%s.md" % name)
            how = "по журналу: записи поверх нет"
        nbad += len(miss)
        lines.append("   исход гейта %s: гейт не пройден → %s" % (name, ("НАРУШЕНИЕ " + "; ".join(miss)) if miss
                     else "_pending/%s.md и .check.txt есть, карточка не тронута (%s)" % (name, how)))
    if not last:
        lines.append("   исход гейта: вердиктов check.py в журнале нет")
    return lines, nbad


READER = re.compile(r"Вызов (читающего субагента|головы) скилла")


def unwrap(body):
    """Отчёт субагента из результата Agent/Task: рамка «[Subagent hand-back] … The report follows:» снимается —
    отчёт идёт строками с отступом в два пробела до первой строки без отступа (agentId, usage)."""
    if "[Subagent hand-back]" not in body or "The report follows:" not in body:
        return body
    out = []
    for x in body.split("The report follows:", 1)[1].split("\n")[1:]:
        if x.strip() != "" and not x.startswith("  "):
            break
        out.append(x[2:])
    return "\n".join(out)


def answer_form(path):
    """Ответы читающих, частей, остатка и головы (не разведчика) в журнале ведущего: результат вызова Agent/Task, у
    фонового — сводка уведомления о его возврате. По форме — 3 строки (у каждого один бриф с ответом). Возвращает
    (всего вызовов, [(описание, непустых строк ответа)] не по форме)."""
    calls, order, ans, note = {}, [], {}, {}
    try:
        f = open(path, encoding="utf-8", errors="replace")
    except OSError:
        return 0, []
    for ln in f:
        if '"tool_use"' not in ln and '"tool_result"' not in ln and '"task_notification"' not in ln:
            continue
        try:
            j = json.loads(ln)
        except ValueError:
            continue
        if j.get("type") == "system" and j.get("subtype") == "task_notification":
            if j.get("tool_use_id") in calls:
                note[j.get("tool_use_id")] = j.get("summary") or ""
            continue
        if j.get("parent_tool_use_id"):   # ход самого субагента, не ведущего
            continue
        for c in (j.get("message") or {}).get("content") or []:
            if not isinstance(c, dict):
                continue
            if c.get("type") == "tool_use" and c.get("name") in ("Agent", "Task"):
                inp = c.get("input") or {}
                if READER.search(inp.get("prompt") or ""):
                    calls[c.get("id")] = inp.get("description") or (inp.get("prompt") or "")[:60]
                    order.append(c.get("id"))
            elif c.get("type") == "tool_result" and c.get("tool_use_id") in calls:
                body = c.get("content")
                if isinstance(body, list):
                    body = "\n".join(x.get("text", "") for x in body if isinstance(x, dict))
                body = body if isinstance(body, str) else ""
                if not body.startswith("Async agent launched"):   # фоновый: ответ придёт уведомлением
                    ans[c.get("tool_use_id")] = unwrap(body)
    off = []
    for i in order:
        n = sum(1 for x in note.get(i, ans.get(i, "")).split("\n") if x.strip() != "")   # уведомление — отчёт как есть
        if n != 3:
            off.append((calls[i], n))
    return len(order), off


def main():
    bad_total = 0
    for rnd in sys.argv[1:]:
        sb = os.path.join(rnd, "sandbox")
        for run in sorted(os.listdir(sb)) if os.path.isdir(sb) else []:
            d = os.path.join(sb, run)
            files = [os.path.join(d, "_stream.jsonl")]
            for root, _, fs in os.walk(os.path.join(d, "_sub")):
                files += [os.path.join(root, f) for f in fs if f.endswith(".jsonl")]
            cmds = []
            for f in files:
                cmds += commands(f)
            seen = {s: 0 for s in SCRIPTS}
            bad = []
            for c in cmds:
                for s in SCRIPTS:
                    if SCRIPT_RX[s].search(c):
                        seen[s] += 1
                for name, rx in BAD:
                    if rx.search(c):
                        bad.append((name, c.strip().replace("\n", " ")[:200]))
            bad_total += len(bad)
            print("%s/%s: команд %d; вызовы %s; нарушений %d" % (os.path.basename(rnd.rstrip("/\\")), run, len(cmds),
                  ", ".join("%s %d" % (s, n) for s, n in seen.items()), len(bad)))
            for name, c in bad:
                print("   НАРУШЕНИЕ %s: %s" % (name, c))
            gl, gb = gate_outcome(d, files)
            bad_total += gb
            for ln in gl:
                print(ln)
            na, off = answer_form(os.path.join(d, "_stream.jsonl"))
            print("   ответы читающих, частей, остатка и головы: %d, не по форме (не 3 строки): %d" % (na, len(off)))
            for desc, n in off:
                print("      %s: %s" % (desc, "ответа нет" if n == 0 else "строк %d" % n))
    sys.exit(1 if bad_total else 0)


main()
