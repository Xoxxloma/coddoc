# (ж) SM-PLAN-TYPES: таблица формы keys.py (k_typesecs) — как таблица порядка секций шаблона (секции классов пометок).
#   python form-table.py <папка reference>   — печатает расхождения, код 1 при расхождении
import sys

sys.dont_write_bytecode = True
for _st in (sys.stdout, sys.stderr):
    _st.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, sys.argv[1])
import keys as K  # noqa: E402

CLS = ("контракт", "сущности", "задачи", "топики", "экраны", "потребляет", "состояние")
ty, tpl, on = {}, {}, False
for l in K.read_lines(sys.argv[1] + "/card.template.md"):
    if l.startswith("| `backend` | `frontend` |"):
        h = l.split("|")
        ty = {i: h[i].replace("`", "").strip() for i in range(1, len(h) - 1)}
        on = True
        continue
    if on and K.has(r"^\|[ \t:|-]*\Z", l):
        continue
    if on and l.startswith("|"):
        c = l.split("|")
        for i in range(1, len(c) - 1):
            s = c[i].replace("`", "").strip()
            if s != "—" and K.k_cls(s) in CLS:
                tpl.setdefault(ty.get(i, ""), set()).add(s)
        continue
    on = False
bad = 0
for t in ("backend", "frontend", "fullstack", "lib"):
    a = sorted(tpl.get(t, ()))
    b = sorted(x for x in K.k_typesecs(t).split("|") if x)
    if a != b:
        print("ж: тип %s — шаблон %s, keys.py %s" % (t, "|".join(a), "|".join(b)))
        bad = 1
sys.exit(bad)
