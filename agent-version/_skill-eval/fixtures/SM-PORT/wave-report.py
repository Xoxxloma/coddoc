# Отчёт волны срезов 0–2 (и стендов дальше) по раундам run-sm-mono.sh: метрики срезов поверх грейдеров.
#   python wave-report.py <раунд> [<раунд> …]
# По каждому прогону: цена; первый и последний ИСХОД check.py; ДОБОР по видам — и сколько пунктов дали виды среза 2,
# была ли волна добора только из-за них; маркерный гейт по частям (ложный «0 из N» при блоках на месте — отдельно);
# итог count.py и пометка «нижняя граница неполна»; строки склейки среза 0; дубли одной записи (k_keyn) и пары одного
# пути с разным именем параметра в итоговой карточке; вызовы с `>` вместо `--out`.
import glob, json, os, re, sys

for _st in (sys.stdout, sys.stderr):
    _st.reconfigure(encoding="utf-8", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.normpath(os.path.join(HERE, "..", "..", "..", "service-map-2.0", "reference")))
sys.dont_write_bytecode = True
import keys as K  # noqa: E402

S2 = ("заголовок правил", "код в правилах", "код для пользователя", "хвост-файл", "слипшаяся ячейка", "без сущностей",
      "порядок блоков", "секции не по шаблону")


def events(path):
    uses, out = {}, []
    for ln in open(path, encoding="utf-8", errors="replace"):
        if '"tool_' not in ln and '"result"' not in ln:
            continue
        try:
            j = json.loads(ln)
        except ValueError:
            continue
        if j.get("type") == "result":
            out.append(("cost", j.get("total_cost_usd") or 0, ""))
        for c in (j.get("message") or {}).get("content") or []:
            if not isinstance(c, dict):
                continue
            if c.get("type") == "tool_use":
                uses[c.get("id")] = (c.get("name"), c.get("input") or {})
                out.append(("use", c.get("name"), json.dumps(c.get("input") or {}, ensure_ascii=False)))
            elif c.get("type") == "tool_result":
                body = c.get("content")
                if isinstance(body, list):
                    body = "\n".join(x.get("text", "") for x in body if isinstance(x, dict))
                u = uses.get(c.get("tool_use_id"), ("", {}))
                out.append(("res", u[0], (json.dumps(u[1], ensure_ascii=False), body if isinstance(body, str) else "")))
    return out


def check_outputs(ev):
    """Выводы check.py: из результата Bash либо из файла --out, который ведущий потом прочитал (Read)."""
    outs = []
    for kind, name, data in ev:
        if kind != "res":
            continue
        inp, body = data
        body = re.sub(r"(?m)^\s*\d+[→	]", "", body)   # номера строк у Read
        if "== ЧЕРНОВИК" in body and "== ИСХОД" in body:
            outs.append(body)
    return outs


def dobor_kinds(text):
    kinds, total = {}, 0
    for m in re.finditer(r"^ДОБОР ([^:\n]+): (\d+) \(([^)\n]*)\)", text, re.M):
        total += int(m.group(2))
        for part in m.group(3).split(","):
            mm = re.match(r"\s*(.+?) (\d+)\s*$", part)
            if mm:
                kinds[mm.group(1)] = kinds.get(mm.group(1), 0) + int(mm.group(2))
    return kinds, total


def card_metrics(card):
    if not card or not os.path.isfile(card):
        return None
    sec, g = "", {}
    for l in open(card, encoding="utf-8", errors="replace").read().split("\n"):
        if l.startswith("## "):
            sec = l
            continue
        if sec.startswith("## Публичный") and l.startswith("### "):
            c = K.k_canon("контракт", l[4:].split(" — ")[0])
            if c:
                g.setdefault(K.k_key(c), []).append(K.k_keyn(c))
    dup = sum(1 for v in g.values() if len(v) != len(set(v)))
    pairs = sum(1 for v in g.values() if len(set(v)) > 1)
    return len(sum(g.values(), [])), dup, pairs


def main():
    for rnd in sys.argv[1:]:
        for run in sorted(glob.glob(os.path.join(rnd, "sandbox", "mono-*"))):
            ev = events(os.path.join(run, "_stream.jsonl"))
            cost = max([d for k, d, _ in ev if k == "cost"] or [0])
            outs = check_outputs(ev)
            name = os.path.basename(rnd.rstrip("/\\"))
            print("=== %s  цена $%.2f  выводов check: %d" % (name, cost, len(outs)))
            if outs:
                for i, o in (("первый", outs[0]), ("последний", outs[-1])):
                    isx = re.findall(r"^ИСХОД: (.*)$", o, re.M)
                    kinds, total = dobor_kinds(o)
                    s2 = {k: v for k, v in kinds.items() if k in S2}
                    print("  %s: ИСХОД %s | ДОБОР %d: %s" % (i, isx[-1] if isx else "?", total,
                          ", ".join("%s %d" % kv for kv in sorted(kinds.items())) or "пусто"))
                    if i == "первый":
                        only2 = total > 0 and sum(s2.values()) == total
                        print("    среза 2: %d пунктов (%s)%s" % (sum(s2.values()), ", ".join("%s %d" % kv for kv in s2.items()) or "—",
                              "; добор ТОЛЬКО из-за видов среза 2" if only2 else ""))
                    for g in re.findall(r"^МАРКЕРНЫЙ ГЕЙТ: (.*)$", o, re.M):
                        print("    гейт: %s" % g)
            # волны добора: вызовы субагентов с brief-dobor
            nd = sum(1 for k, n, d in ev if k == "use" and n in ("Agent", "Task") and "brief-dobor" in d)
            print("  вызовов добора (субагентов): %d" % nd)
            # count.py и plan.py
            for k, n, d in ev:
                if k == "res" and isinstance(d, tuple) and "count.py" in d[0]:
                    m = re.search(r"^счёт: .*?; итог: (.*)$", d[1], re.M)
                    if m:
                        print("  count: итог %s" % m.group(1))
                    for l in d[1].split("\n"):
                        if re.match(r"(строка разведчика не по форме|маска разведчика|регэксп разведчика|греп отказал|не прочитано|многострочная)", l):
                            print("    count: %s" % l[:160])
                if k == "res" and isinstance(d, tuple) and "plan.py" in d[0]:
                    for l in d[1].split("\n"):
                        if l.startswith(("итог по классам", "к сверке", "в тестовых папках")):
                            print("  plan: %s" % l[:160])
                if k == "res" and isinstance(d, tuple) and "assemble.py" in d[0]:
                    for l in d[1].split("\n"):
                        if re.search(r"разной записью|не склеены|дубли ключей склеены|отброшено", l):
                            print("  склейка: %s" % l[:160])
            # > вместо --out
            gt = [d for k, n, d in ev if k == "use" and n in ("Bash", "PowerShell") and re.search(r"reference[/\\\\]+[a-z]+\.py", d)
                  and re.search(r"[^2]>\s*[\"'/A-Za-z]", d.split('"command"')[-1])]
            print("  вызовов скриптов с `>`: %d" % len(gt))
            # карточка
            svc = glob.glob(os.path.join(run, "w", "*", "services", "*.md"))
            pend = glob.glob(os.path.join(run, "w", "*", "services", "_pending", "*.md"))
            for c in svc + pend:
                if os.path.basename(c) in ("manifest.md",):
                    continue
                cm = card_metrics(c)
                if cm:
                    print("  карточка %s: блоков контракта %d, дублей одной записи %d, пар одного пути с разным именем %d"
                          % (os.path.relpath(c, run).replace("\\", "/"), *cm))


main()
