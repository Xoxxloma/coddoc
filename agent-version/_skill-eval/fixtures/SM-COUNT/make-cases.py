# make-cases.py — собирает случаи регресса SM-COUNT из прогонов runs/*/sandbox/* (один раз; песочницы в git не лежат).
#   python make-cases.py <папка runs> <папка fixtures> <папка cases>
# По каждому вызову счётчика в _stream.jsonl: строки разведчика из вызова, итог из ответа счётчика, корень. Корень
# прогона заменяется на {ROOT}; дерево — тот источник, из которого его копирует run-sm-mono.sh; случай берётся, только
# если дерево песочницы совпадает с источником (пути и размеры файлов, без .git). Одинаковые строки на одном дереве —
# один случай, прогоны перечислены в case.txt.
import json, os, re, sys, glob, hashlib

RUNS, FIX, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
HOME_PROJECTS = os.environ.get("SM_PROJECTS", "C:/Users/Konstantin/projects")
# дерево песочницы (путь под w/) → (имя источника, путь источника)
SOURCES = {
    "harvest-ledger": ("SM-GAPS/back/harvest-ledger", FIX + "/SM-GAPS/back/harvest-ledger"),
    "yard-map-ui": ("SM-GAPS/front/yard-map-ui", FIX + "/SM-GAPS/front/yard-map-ui"),
    "seed-vault": ("SM-GAPS/kt/seed-vault", FIX + "/SM-GAPS/kt/seed-vault"),
    "parcel-hub": ("SM-GAPS/node/parcel-hub", FIX + "/SM-GAPS/node/parcel-hub"),
    "apollo/apollo-portal": ("apollo/apollo-portal", HOME_PROJECTS + "/apollo/apollo-portal"),
    "listmonk": ("listmonk", HOME_PROJECTS + "/listmonk"),
    "vikunja-frontend": ("vikunja-frontend", HOME_PROJECTS + "/vikunja-frontend"),
}
# Счётчик ошибся (не по брифу) или строка разведчика не по форме — известная причина расхождения с его итогом.
KNOWN = {
    "2026-10-24-apollo-v2-ds/mono-01#0": ("контракт 139", "счётчик сложил в итог строку `ориентир` (контракт 14)"),
    "2026-10-24-gaps50-haiku-k100/mono-01#1": ("топики -", "счётчик сложил в итог строку `ориентир` (топики 1)"),
    "2026-10-25-v45-c2-apollo/mono-01#0": ("задачи -", "счётчик сложил в итог строку `ориентир` (задачи 2)"),
    "2026-10-25-v45-fix2-listmonk/mono-02#1": ("контракт 182 (нижняя граница неполна)",
                                               "строка разведчика не по форме: путь спеки на месте регэкспа — счётчик "
                                               "понял её как строку спеки (254), count.py её не ищет и называет"),
}
# Строки, которые count.py обязан напечатать на случае ({ROOT} — корень дерева).
LINES = {
    "2026-10-25-v45-fix2-listmonk/mono-02#1": [
        "строка разведчика не по форме, на месте регэкспа файл: контракт :: {ROOT}/docs/swagger/collections.yaml :: "
        "^\\s+operationId: :: *.yaml :: ключ"],
}


def lp(p):
    a = os.path.abspath(p)
    return "\\\\?\\" + a if os.name == "nt" else a


def tree_sig(root):
    out = []
    for dp, dns, fns in os.walk(lp(root)):
        dns[:] = [d for d in dns if d != ".git"]
        for f in fns:
            p = os.path.join(dp, f)
            out.append((os.path.relpath(p, lp(root)).replace("\\", "/"), os.path.getsize(p)))
    return sorted(out)


def itog(s):
    m = re.search(r"итог:\s*([^\n]*)", s or "")
    if not m:
        return None
    t = re.sub(r"\([^)]*\)", "", m.group(1))
    out = {}
    for part in t.split(","):
        mm = re.match(r"\s*(\S+)\s+(\d+)", part)
        if mm:
            out[mm.group(1)] = out.get(mm.group(1), 0) + int(mm.group(2))
    return out


sigs = {}
cases = {}
skipped = []
for sb in sorted(glob.glob(os.path.join(RUNS, "*", "sandbox", "*"))):
    st = os.path.join(sb, "_stream.jsonl")
    if not os.path.isfile(st):
        continue
    msgs = []
    for line in open(st, encoding="utf-8", errors="replace"):
        try:
            msgs.append(json.loads(line))
        except ValueError:
            pass
    res = {}
    for o in msgs:
        cont = o.get("message", {}).get("content", []) if o.get("type") == "user" else []
        for c in cont if isinstance(cont, list) else []:
            if c.get("type") == "tool_result":
                t = c.get("content")
                if isinstance(t, list):
                    t = "\n".join(x.get("text", "") for x in t if isinstance(x, dict))
                res[c["tool_use_id"]] = t or ""
    k = -1
    run = os.path.relpath(sb, RUNS).replace("\\", "/").replace("/sandbox/", "/")
    for o in msgs:
        if o.get("type") != "assistant":
            continue
        for c in o["message"].get("content", []) or []:
            if c.get("type") != "tool_use" or "Счётчик скилла" not in str(c.get("input", {}).get("prompt", "")):
                continue
            k += 1
            tag = "%s#%d" % (run, k)
            m = re.search(r"<пути> = (.*?);?\s*<counts> = (.*?counts\.txt)\.?\s*Строки маркеров:\s*\n(.*)\Z",
                          c["input"]["prompt"], re.S)
            want = itog(res.get(c["id"]))
            if not m or want is None:
                skipped.append((tag, "нет строк или итога счётчика"))
                continue
            root = m.group(1).strip().replace("\\", "/").rstrip("/")
            sub = root.split("/w/", 1)[1] if "/w/" in root else ""
            if sub not in SOURCES:
                skipped.append((tag, "дерево %s без источника" % sub))
                continue
            name, src = SOURCES[sub]
            if not os.path.isdir(src):
                skipped.append((tag, "нет источника %s" % src))
                continue
            if sub not in sigs:
                sigs[sub] = {}
            if src not in sigs[sub]:
                sigs[sub][src] = tree_sig(src)
            if tree_sig(root) != sigs[sub][src]:
                skipped.append((tag, "дерево прогона не совпадает с источником %s" % name))
                continue
            lines = []
            for ln in m.group(3).split("\n"):
                s = ln.strip()
                if " :: " in s:
                    lines.append(s.replace(root, "{ROOT}").replace(root.replace("/", "\\"), "{ROOT}"))
            scout = "\n".join(lines) + "\n"
            key = (name, scout)
            exp = dict(want)
            known = ""
            if tag in KNOWN:
                fix, known = KNOWN[tag]
                if fix:
                    cl, v = fix.split(" ", 1)
                    if v == "-":
                        exp.pop(cl, None)
                    else:
                        exp[cl] = v
            ent = cases.setdefault(key, {"runs": [], "expect": exp, "counter": want, "known": known,
                                         "lines": LINES.get(tag, [])})
            ent["runs"].append(tag)
            if known and not ent["known"]:
                ent["known"] = known

os.makedirs(OUT, exist_ok=True)
for (name, scout), ent in sorted(cases.items(), key=lambda kv: (kv[0][0], kv[1]["runs"][0])):
    cid = "%s-%s" % (name.split("/")[-1], hashlib.md5(scout.encode("utf-8")).hexdigest()[:6])
    d = os.path.join(OUT, cid)
    os.makedirs(d, exist_ok=True)
    open(os.path.join(d, "scout.txt"), "w", encoding="utf-8", newline="\n").write(scout)
    with open(os.path.join(d, "case.txt"), "w", encoding="utf-8", newline="\n") as f:
        f.write("дерево: %s\n" % name)
        f.write("итог: %s\n" % ", ".join("%s %s" % kv for kv in ent["expect"].items()))
        if ent["known"]:
            f.write("счётчик: %s\n" % ", ".join("%s %s" % kv for kv in ent["counter"].items()))
            # итог поправлен — расхождение с ним красное; не поправлен — известное расхождение
            f.write("%s: %s\n" % ("поправка" if ent["expect"] != ent["counter"] else "известно", ent["known"]))
        for s in ent["lines"]:
            f.write("строка: %s\n" % s)
        for r in ent["runs"]:
            f.write("прогон: %s\n" % r)
print("случаев: %d (вызовов счётчика: %d); пропущено: %d" % (len(cases), sum(len(e["runs"]) for e in cases.values()), len(skipped)))
for t, why in skipped:
    print("  пропущен %s — %s" % (t, why))
