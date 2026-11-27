#!/usr/bin/env bash
# plan.sh — план нарезки большого сервиса на части по счёту пометок ключей.
#
#   bash plan.sh <counts.txt> <K> <w> <корень>[,<корень>…] [<plan.tsv>] [<тип>]
#
# <тип> — `type` сервиса из манифеста. Форма по типу — keys.awk («Форма по типу»): класс, секции которого
# у типа нет, отбрасывается при разборе счёта (строка «класс … у типа … секции нет»); тип, у которого не все
# секции классов пишут части, не режется. Типа нет — классы все, нарезка по весу.
#
# counts.txt — вывод грепов по строкам разведчика, дословно, под заголовками:
#   ## <класс> :: <ключ|ориентир>
#   <путь>:<число>
# и заголовки контроля разведчика, без строк под ними:
#   ## контроль :: <класс> :: <файл> :: <сколько ключей класса разведчик видел в этом файле>
# Класс — первое слово поля: «контракт HTTP» и «контракт GraphQL» — оба контракт. Путь — как угодно
# записанный: бэктики и кавычки снимаются; точного пути нет ни в счёте, ни в дереве корней — берётся
# единственный файл с тем же хвостом пути (вплоть до имени файла). Не нашёлся или таких несколько —
# «контроль … не сверен», без тревоги.
# По каждому контролю печатается строка: маркер класса дал в этом файле меньше половины —
# «УЗКИЙ МАРКЕР: …», иначе «контроль …: сходится». На план контроль не влияет.
# Путь без корня (`./src/…`, `src/…`) при одном корне считается от него. ОТКАЗ, код 3 — файл счёта
# негоден, плана нет: нет заголовков или вид не `ключ|ориентир`; под заголовком путь к файлу без счёта
# (совпадение текстом, список файлов); весь счёт вне корней; корень есть на диске, а файла из счёта там нет.
# Тесты в план и в числа «к сверке» не идут: папки `test`/`tests` в корне сервиса, `src/test` и
# `__tests__` на любой глубине, файлы `*.test.*`/`*.spec.*` (js, ts) и `*_test.go|py`.
# Вес файла = сумма совпадений строк `ключ` + w × сумма строк `ориентир`. Вес папки — сумма по её
# поддереву. Часть образуют только папки и файлы с пометками `ключ`: они пакуются подряд по пути в
# части весом ≤ K; папка тяжелее K режется по своим подпапкам, а её собственные файлы — подряд по
# файлам; файл тяжелее K — отдельной частью. Всё остальное — «остаток»: список папок и «файлов прямо в
# папке» печатается по дереву корней на диске (без скрытых папок, `node_modules`, `__pycache__` и без
# `target`, `build`, `dist` в корне сервиса); дерева нет или пунктов больше 60 — остаток назван
# отрицанием. Читает и печатает план в stdout. С пятым аргументом ещё пишет тот же план для check.sh,
# строками через табуляцию (тесты и пути вне корней туда не идут, как и в «к сверке»):
#   итог  <класс> <пометок ключ>                         — по сервису;
#   часть <NN> <класс> <пометок ключ>                    — ожидание части;
#   файл  <путь> <класс> <пометок ключ> <NN части | ->   — каждый файл с пометками `ключ`.
#   путь  <путь части> <папки|файлы> <NN части>         — владение, включая файлы без пометок;
#   остаток <NN остатка> <папка|файлы> <путь>           — пункт списка остатка, если список напечатан;
#   операция <МЕТОД> <путь> <operationId> <спека> <NN | -> — операция спецификации на диске и её часть;
#   топик <имя> <конфиг>                                — топик основного конфига.
# Класс `клиенты` считается как любой класс `ключ` (итог, части, файлы, контроль разведчика), но в вес не
# входит: части он не образует, его файл вне частей — остатку.
# Спецификации (OpenAPI/Swagger в YAML) и основной конфиг скрипт находит сам, мимо разведчика; с карточкой
# их сверяет check.sh. Разведчик не назвал ни одной спецификации, а на диске она есть — строка
# «СПЕКА НЕ РАЗМЕЧЕНА: <файл> — операций N». Спека, которую разведчик назвал клиентской
# (`## клиентская спека :: <файл>` — по ней генерируется клиент к соседу), не сверяется и не весит.
# Строка разведчика с полем `в файлах с <регэксп>` перед `ключ|ориентир` — пометка ключа узнаётся только в
# файлах, где есть второй регэксп. Счётчик считает строку как обычную; скрипт оставляет файлы, где второй
# регэксп нашёлся (`grep -E`), остальное — строкой «вне условия файла: <класс> N в файлах M». Регэксп
# `grep` не разобрал — строка считается вся, строкой «условие файла не разобрано».
# Нарезку решает вес ключей: ориентир части только раскладывает.
# При отказе файл плана остаётся пустым.
set -u
COUNTS="${1:?counts.txt}"; K="${2:?K}"; W="${3:?w}"; ROOTS="${4:?корни через запятую}"; TSV="${5:-}"
# Тип — как в манифесте, до пробела, `#` или кавычки; латиница — в нижний регистр.
TYPE="$(printf '%s' "${6:-}" | sed "s/^[[:space:]\"']*//; s/[[:space:]#\"'].*\$//" | tr 'A-Z' 'a-z')"
[ -f "$COUNTS" ] || { echo "НЕТ ФАЙЛА: $COUNTS"; exit 2; }
[ -n "$TSV" ] && { : > "$TSV" 2>/dev/null || { echo "файл плана не пишется: $TSV" >&2; TSV=""; }; }
# Без keys.awk плана нет: это не файл счётчика, а скилл, установленный не целиком (SKILL.md — сказать человеку).
K_AWK="$(cat "$(dirname "$0")/keys.awk" 2>/dev/null)"
[ -n "$K_AWK" ] || { echo "скилл установлен не целиком: нет $(dirname "$0")/keys.awk"; exit 2; }
export LC_ALL=C

# Файлы корней — для списка остатка и проверки путей счёта. Корня на диске нет — ни того, ни другого.
# Хвостовой слеш и -mindepth: сам корень обходится, даже если он ссылка или назван как сборочная папка.
LIST="$(mktemp 2>/dev/null || echo "${TMPDIR:-/tmp}/plan.$$")"; : > "$LIST"
SCOPE="$(mktemp 2>/dev/null || echo "${TMPDIR:-/tmp}/plan-scope.$$")"; trap 'rm -f "$LIST" "$SCOPE" "$SCOPE.re"' EXIT
ONDISK=""
IFS=',' read -r -a RR <<< "$ROOTS"
for r in "${RR[@]}"; do
  r="${r#"${r%%[![:space:]]*}"}"; r="${r%"${r##*[![:space:]]}"}"
  [ -d "$r" ] || { ONDISK="$ONDISK,0"; continue; }
  ONDISK="$ONDISK,1"
  find "$r/" -mindepth 1 -type d \( -name '.?*' -o -name node_modules -o -name __pycache__ \) -prune \
    -o -type f -print 2>/dev/null >> "$LIST"
done
# `/c/…` — это диск `C:` только там, где такие пути бывают: в Windows-оболочке либо когда рядом есть
# путь в форме диска. На Linux `/u/work` остаётся папкой.
WIN=0
case "$(uname -s 2>/dev/null)" in MINGW*|MSYS*|CYGWIN*) WIN=1 ;; esac
case ",$ROOTS" in *,[A-Za-z]:[\\/]*|*,\ [A-Za-z]:[\\/]*) WIN=1 ;; esac
grep -q '^[A-Za-z]:[\\/]' "$COUNTS" 2>/dev/null && WIN=1

# Корни — через окружение: `awk -v` разбирает в значении обратные слеши, и путь `C:\Users\…` портится.
PLAN_ROOTS="$ROOTS" PLAN_LIST="$LIST" PLAN_SCOPE="$SCOPE" PLAN_ONDISK="${ONDISK#,}" PLAN_TSV="$TSV" PLAN_WORK="$(dirname "$COUNTS")" awk -v K="$K" -v W="$W" -v WIN="$WIN" -v TYPE="$TYPE" "$K_AWK"'
  # Путь к одному виду: прямые слеши, без хвостового слеша, диск `C:` в верхнем регистре; `/c/…` → `C:/…`;
  # двойные слеши схлопнуты, `/./` и `<папка>/../` раскрыты (ведущий собирает корень из `../<сервис>`).
  function np(p,   d) {
    gsub(/\\/, "/", p); gsub(/\/\/+/, "/", p); sub(/\/+$/, "", p)
    while (sub(/\/\.(\/|$)/, "/", p)) ;
    while (match(p, /\/[^\/]+\/\.\.(\/|$)/) && substr(p, RSTART + 1, 3) != "../") p = substr(p, 1, RSTART) substr(p, RSTART + RLENGTH)
    sub(/\/+$/, "", p)
    if (WIN && p ~ /^\/[A-Za-z]\//) { d = toupper(substr(p, 2, 1)); p = d ":" substr(p, 3) }
    else if (p ~ /^[A-Za-z]:/) p = toupper(substr(p, 1, 1)) substr(p, 2)
    return p
  }
  # Путь без корня — от единственного корня; корней несколько — остаётся как есть и уйдёт «вне корней».
  function full(p) {
    gsub(/\\/, "/", p)
    if (p ~ /^(\/|[A-Za-z]:)/) return np(p)
    while (sub(/^\.\//, "", p)) ;
    return np(nr == 1 ? root[1] "/" p : p)
  }
  function parent(p,   q) { q = p; sub(/\/[^\/]*$/, "", q); return q }
  function rootof(p,   i, best) {
    best = ""
    for (i = 1; i <= nr; i++) if (index(p, root[i] "/") == 1 && length(root[i]) > length(best)) best = root[i]
    return best
  }
  # Тест — только по устойчивым приметам: пакет `com/acme/test` и `openapi.spec.yaml` тестами не считаются.
  function istest(rel,   s) {
    s = "/" tolower(rel)
    if (s ~ /^\/(test|tests)\// || s ~ /\/src\/test\// || s ~ /\/__tests__\//) return 1
    return (s ~ /\.(test|spec)\.(js|jsx|ts|tsx|mjs|cjs)$/ || s ~ /_test\.(go|py)$/)
  }
  function covered(p, r,   q) {
    if (p in cov) return 1
    for (q = parent(p); ; q = parent(q)) { if (q in cov) return 1; if (q == r || q == "" || q !~ /\//) return 0 }
  }
  # Сортировка вставками: списки детей короткие.
  function sortlist(arr, n,   i, j, t) {
    for (i = 2; i <= n; i++) { t = arr[i]; for (j = i - 1; j >= 1 && arr[j] > t; j--) arr[j + 1] = arr[j]; arr[j + 1] = t }
  }
  function classes(items, n,   i, c, s, out, cl) {
    out = ""
    for (c = 1; c <= ncl; c++) {
      cl = clist[c]; s = 0
      for (i = 1; i <= n; i++) s += ck[items[i], cl]
      if (s > 0) out = out (out == "" ? "" : ", ") cl " " s
    }
    for (c = 1; c <= ncl; c++) {
      cl = clist[c]; s = 0
      for (i = 1; i <= n; i++) s += co[items[i], cl]
      if (s > 0) out = out (out == "" ? "" : ", ") "ориентир " cl " " s
    }
    return out
  }
  function sums(arr, pre,   c, cl, out) {
    out = ""
    for (c = 1; c <= ncl; c++) { cl = clist[c]; if (arr[cl] > 0) out = out (out == "" ? "" : ", ") pre cl " " arr[cl] }
    return out
  }
  # Маркеры части для её задания: класс с пометками `ключ` — «не меньше», с `ориентир` — «около».
  function marks(items, n,   i, c, cl, s, out) {
    out = ""
    for (c = 1; c <= ncl; c++) { cl = clist[c]; s = 0; for (i = 1; i <= n; i++) s += ck[items[i], cl]; if (s > 0) out = out (out == "" ? "" : ", ") cl " не меньше " s }
    for (c = 1; c <= ncl; c++) { cl = clist[c]; s = 0; for (i = 1; i <= n; i++) s += co[items[i], cl]; if (s > 0) out = out (out == "" ? "" : ", ") cl " около " s " (ориентир)" }
    return out
  }
  function emit(kind, items, n, wsum,   i, line, c, cl, s, txt) {
    if (n == 0) return
    np_++
    line = sprintf("часть %02d вес %g", np_, wsum)
    cls = classes(items, n); if (cls != "") line = line " (" cls ")"
    line = line ": " kind " "; txt = kind " "
    for (i = 1; i <= n; i++) { cov[items[i]] = 1; partof[items[i]] = np_; partkind[items[i]] = kind; line = line (i > 1 ? "; " : "") items[i]; txt = txt (i > 1 ? "; " : "") items[i] }
    for (c = 1; c <= ncl; c++) { cl = clist[c]; s = 0; for (i = 1; i <= n; i++) s += ck[items[i], cl]; if (s > 0) partexp[np_, cl] = s }
    ptext[np_] = txt; pmark[np_] = marks(items, n)
    print line
  }
  # Регэксп разведчика (ripgrep) — в ERE для awk: `\s`, `\d`, `\w` есть не во всех awk.
  function awkre(re) { gsub(/\\s/, "[[:space:]]", re); gsub(/\\d/, "[0-9]", re); gsub(/\\w/, "[[:alnum:]_]", re); return re }
  # Что должно быть в карточке — по дереву на диске, мимо разведчика: операции спецификаций (OpenAPI/Swagger
  # в YAML) и имена топиков основного конфига (`application.yml|yaml|properties`, без тестов и профилей).
  # Сверяет check.sh по строкам «операция» и «топик» файла плана.
  function specparse(f,   ln, ind, inp, pind, path, meth, id, n) {
    inp = 0; pind = -1; path = ""; meth = ""; n = 0
    while ((getline ln < f) > 0) {
      sub(/\r$/, "", ln); if (ln ~ /^[ \t]*(#|$)/) continue
      match(ln, /^ */); ind = RLENGTH
      if (ind == 0) { inp = (ln ~ /^paths:[ \t]*$/); path = ""; meth = ""; continue }
      if (!inp) continue
      if (pind < 0 && ln ~ /^ +["\047]?\//) pind = ind
      if (ind == pind) { path = ""; meth = ""; if (ln ~ /^ +["\047]?\//) { path = ln; sub(/^ +["\047]?/, "", path); sub(/["\047]?:.*$/, "", path) }; continue }
      if (path != "" && ind > pind && ln ~ /^ +(get|post|put|patch|delete|head|options):[ \t]*$/) { meth = ln; gsub(/[ \t:]/, "", meth); meth = toupper(meth); continue }
      if (meth != "" && ln ~ /^ +operationId:/) { id = ln; sub(/^ +operationId:[ \t]*/, "", id); gsub(/["\047 \t]/, "", id); n++; OPM[f, n] = meth; OPP[f, n] = path; OPI[f, n] = id }
    }
    close(f); OPN[f] = n
  }
  function topicadd(v, f,   n, i, x, t) {
    sub(/[ \t]+#.*$/, "", v); gsub(/^[\[ \t]+|[\] \t]+$/, "", v)
    n = split(v, x, /[ \t]*,[ \t]*/)
    for (i = 1; i <= n; i++) {
      t = x[i]; gsub(/["\047]/, "", t)
      if (t ~ /^\$\{/) { if (t !~ /:/) continue; sub(/^\$\{[^:]*:/, "", t); sub(/\}$/, "", t) }   # ${ключ:значение} — значение
      if (t ~ /^[A-Za-z0-9._-]+$/ && t ~ /[A-Za-z]/ && !(t in tseen)) { tseen[t] = 1; tname[++ntp] = t; tfile[ntp] = f }
    }
  }
  # Топик — значение ключа `topic`/`topics` (`…-topic`, `….topics`): строкой, списком или картой под ним.
  function topicsyaml(f,   ln, ind, key, v, intop, tind) {
    intop = 0
    while ((getline ln < f) > 0) {
      sub(/\r$/, "", ln); if (ln ~ /^[ \t]*(#|$)/) continue
      if (ln ~ /^---/) { intop = 0; continue }
      match(ln, /^ */); ind = RLENGTH
      if (intop && ind > tind) { v = ln; if (v ~ /^ *- /) sub(/^ *- */, "", v); else if (v ~ /^ *[^:]+:[ \t]*[^ \t]/) sub(/^[^:]*:[ \t]*/, "", v); else continue; topicadd(v, f); continue }
      intop = 0
      if (ln !~ /^ *[A-Za-z0-9_.-]+:/) continue
      key = ln; sub(/^ */, "", key); sub(/:.*/, "", key); v = ln; sub(/^[^:]*:[ \t]*/, "", v)
      if (tolower(key) ~ /(^|[-_.])topics?$/) { if (v == "") { intop = 1; tind = ind } else topicadd(v, f) }
    }
    close(f)
  }
  function topicsprops(f,   ln, key, v) {
    while ((getline ln < f) > 0) {
      sub(/\r$/, "", ln); if (ln ~ /^[ \t]*(#|!|$)/ || ln !~ /=/) continue
      key = ln; sub(/[ \t]*=.*/, "", key); v = ln; sub(/^[^=]*=[ \t]*/, "", v)
      if (tolower(key) ~ /(^|[-_.])topics?$/) topicadd(v, f)
    }
    close(f)
  }
  # Обход дерева: спецификации и конфиги. Разведчик не назвал ни одной спецификации, а в дереве она есть —
  # строка «СПЕКА НЕ РАЗМЕЧЕНА» (ведущий повторяет разведчика, как при «узком маркере»). Назвал — сверяются
  # только названные: остальные спеки, скорее всего, клиентские. Названная клиентской — не сверяется никогда.
  # Операции спеки — ключи контракта, топики конфига — ключи «Событий»: у типа без такой секции (keys.awk,
  # «Форма по типу») их не ищут вовсе.
  function discover(   f, r, rel, ln, k, isspec, named, i, wsp, wtp) {
    named = 0; for (f in specre) named++
    wsp = k_typehas(TYPE, "контракт"); wtp = k_typehas(TYPE, "топики")
    while ((getline f < ENVIRON["PLAN_LIST"]) > 0) {
      sub(/\r$/, "", f); if (f == "") continue
      f = np(f); r = rootof(f); if (r == "") continue
      rel = substr(f, length(r) + 2); if (istest(rel) || rel ~ /^(target|build|dist)\//) continue
      if (wtp && rel ~ /(^|\/)application\.ya?ml$/) topicsyaml(f)
      else if (wtp && rel ~ /(^|\/)application\.properties$/) topicsprops(f)
      if (wsp && rel ~ /\.ya?ml$/) {
        isspec = 0; k = 0
        while (k < 40 && (getline ln < f) > 0) { k++; if (ln ~ /^(openapi|swagger):/) { isspec = 1; break } }
        close(f)
        if (isspec) dspec[++nds] = f
      }
    }
    close(ENVIRON["PLAN_LIST"])
    for (f in specre) { specparse(f); ospec[++nos] = f }
    if (!named) for (i = 1; i <= nds; i++) {
      f = dspec[i]; if (f in clientspec) continue
      specparse(f); if (OPN[f] == 0) continue
      ospec[++nos] = f
      printf "СПЕКА НЕ РАЗМЕЧЕНА: %s — операций %d, строки спецификации у разведчика нет\n", f, OPN[f]
    }
  }
  # Строка счёта — в итог, вес и файлы: `ключ` (класс вне веса — без веса), `ориентир` — с весом w.
  function addcnt(path, cl, kind, cnt) {
    if (kind == "ключ" && (cl in nowt)) { ck[path, cl] += cnt; tot[cl] += cnt; fw[path] += 0; fany[path] = 1 }
    else if (kind == "ключ") { ck[path, cl] += cnt; tot[cl] += cnt; fw[path] += cnt; fk[path] += cnt; fany[path] = 1 }
    else { co[path, cl] += cnt; orn[cl] += cnt; fw[path] += W * cnt }
    isfile[path] = 1
  }
  # Регэксп разведчика (ripgrep) — для `grep -E`: `\b` — граница слова через класс символов.
  function ere(re) { re = awkre(re); gsub(/\\b/, "([^[:alnum:]_]|^|$)", re); return re }
  # Условие файла (`в файлах с <регэксп>`): по каждому регэкспу — один `grep -l` по файлам его строк счёта.
  # Файл без совпадения — вне условия; файл не читается — в счёт как есть (его поймает проверка путей ниже);
  # регэксп `grep` не разобрал (код 2 на пустом вводе) — строки этого условия в счёт целиком.
  function scopes(   i, j, r, lst, ref, q, cmd, f, p) {
    q = sprintf("%c", 39); lst = ENVIRON["PLAN_SCOPE"]; ref = lst ".re"
    for (i = 1; i <= ns; i++) {
      r = SR[i]; if (r in sdone) continue
      sdone[r] = 1
      print ere(r) > ref; close(ref)
      if (system("grep -E -f " q ref q " </dev/null >/dev/null 2>&1") == 2) { sbad[r] = 1; continue }
      printf "" > lst; for (j = i; j <= ns; j++) if (SR[j] == r) print SP[j] > lst
      close(lst)
      cmd = "tr " q "\\n" q " " q "\\000" q " < " q lst q " | xargs -0 grep -l -E -f " q ref q " 2>/dev/null"
      while ((cmd | getline f) > 0) { sub(/\r$/, "", f); shit[r, np(f)] = 1 }
      close(cmd)
    }
    for (i = 1; i <= ns; i++) {
      r = SR[i]; p = SP[i]
      if ((r in sbad) || ((r, p) in shit) || (getline f < p) < 0) { close(p); addcnt(p, SCL[i], SK[i], SC[i]); continue }
      close(p); sout[SCL[i]] += SC[i]; soutf[SCL[i]]++
    }
  }
  # Файл спецификации тяжелее K: его операции режутся на ровные куски не больше K по строкам маркера в
  # самом файле, у каждого куска — своя часть с номерами, строками и именами операций. Число строк
  # маркера не сошлось со счётом или файл не читается — файл отдельной частью, как любой тяжёлый файл.
  function emitspec(c,   re, cl, ln, nl, m, L, N, nm, q1, q, size, s, e, j, names, one1) {
    re = awkre(specre[c]); cl = speccl[c]; m = 0; nl = 0; q1 = sprintf("%c", 39)
    while ((getline ln < c) > 0) {
      nl++; sub(/\r$/, "", ln)
      if (ln ~ re) { m++; L[m] = nl; nm = ln; sub(re, "", nm); gsub(/^[ \t"]+|[ \t",]+$/, "", nm); gsub(q1, "", nm); N[m] = nm }
    }
    close(c)
    if (m != ck[c, cl] || m <= K) { one1[1] = c; emit("файлы", one1, 1, sw[c]); return }
    q = int((m + K - 1) / K); size = int((m + q - 1) / q)
    for (s = 1; s <= m; s = e + 1) {
      e = s + size - 1; if (e > m) e = m
      np_++; names = ""
      for (j = s; j <= e; j++) if (N[j] != "") names = names (names == "" ? "" : ", ") N[j]
      printf "часть %02d вес %d (%s %d): файлы %s — операции %d–%d из %d, строки %d–%d\n", np_, e - s + 1, cl, e - s + 1, c, s, e, m, L[s], L[e]
      partexp[np_, cl] = e - s + 1; sxf[np_] = c; sxs[np_] = s; sxe[np_] = e
      ptext[np_] = sprintf("спецификация %s, операции %d–%d из %d (строки %d–%d)%s", c, s, e, m, L[s], L[e], (names != "" ? "; operationId: " names : ""))
      pmark[np_] = cl " не меньше " (e - s + 1)
      specparts[c] = specparts[c] (specparts[c] == "" ? "" : ",") sprintf("%02d", np_)
    }
    cov[c] = 1; partof[c] = np_; partkind[c] = "файлы"
  }
  # Строки заданий: ведущий передаёт каждой части её строку дословно — номер, S, свои пути, маркеры, файлы.
  function tasks(hasrest,   i, w, p, sn) {
    w = ENVIRON["PLAN_WORK"]; sn = ""
    for (p in specre) { o = (p in specparts) ? specparts[p] : ((p in rt) ? partfor(p, rt[p]) : "-"); if (o != "-") sn = sn " | операции спецификации " p " — только части " o }
    print "задания частей — каждой её строку дословно:"
    for (i = 1; i <= np_; i++) printf "задание %02d из %d: свои пути — %s | маркеры — %s | опись — %s/part-%02d.opis.md | черновик — %s/part-%02d.md%s\n", i, np_, ptext[i], (pmark[i] != "" ? pmark[i] : "нет"), w, i, w, i, sn
    if (hasrest) printf "задание %02d — остаток: список остатка — пункты «остаток» выше | маркеры — %s | опись — %s/part-%02d.opis.md | черновик — %s/part-%02d.md%s\n", np_ + 1, (restmark != "" ? restmark : "нет"), w, np_ + 1, w, np_ + 1, sn
  }
  # Номер части, которой принадлежит файл: сам файл либо ближайшая папка части; частей нет — «-».
  function partfor(p, r,   q) {
    if (p in partof) return sprintf("%02d", partof[p])
    for (q = parent(p); ; q = parent(q)) { if (q in partof) return sprintf("%02d", partof[q]); if (q == r || q == "" || q !~ /\//) return "-" }
  }
  # План для check.sh — строками через табуляцию; без пятого аргумента ничего не пишет.
  # Обработчик операции — файл кода, где её operationId стоит словом (без учёта регистра: генераторы меняют
  # первую букву); у всех таких файлов одна часть — операция её, у разных — «?», ни одного — ключа нет.
  function handlers(   i, j, p, f, r, rel, ln, n, w, k, o) {
    for (i = 1; i <= nos; i++) { p = ospec[i]; for (j = 1; j <= OPN[p]; j++) hid[tolower(OPI[p, j])] = 1 }
    while ((getline f < ENVIRON["PLAN_LIST"]) > 0) {
      sub(/\r$/, "", f); if (f == "") continue
      f = np(f); r = rootof(f); if (r == "") continue
      rel = substr(f, length(r) + 2)
      if (istest(rel) || rel ~ /^(target|build|dist)\// || rel !~ /\.(java|kts?|scala|groovy|tsx?|jsx?|mjs|cjs|py|go|rb|php|cs|rs|exs?)$/) continue
      o = partfor(f, r)
      while ((getline ln < f) > 0) {
        n = split(ln, w, /[^A-Za-z0-9_]+/)
        for (k = 1; k <= n; k++) { w[k] = tolower(w[k]); if ((w[k] in hid) && !((w[k], o) in hseen)) { hseen[w[k], o] = 1; hown[w[k]] = (w[k] in hown) ? "?" : o } }
      }
      close(f)
    }
    close(ENVIRON["PLAN_LIST"])
  }
  function dump(   f, c, cl, i, j, k, n, fl, p, po, v, ow, paths, ns) {
    f = ENVIRON["PLAN_TSV"]; if (f == "") return
    n = 0; for (p in rt) if (p in fany) fl[++n] = p
    sortlist(fl, n)
    for (i = 1; i <= n; i++) for (c = 1; c <= ncl; c++) { cl = clist[c]; v[cl] += ck[fl[i], cl] }
    for (c = 1; c <= ncl; c++) { cl = clist[c]; if (v[cl] > 0) print "итог\t" cl "\t" v[cl] > f }
    for (i = 1; i <= np_; i++) for (c = 1; c <= ncl; c++) { cl = clist[c]; if ((i, cl) in partexp) printf "часть\t%02d\t%s\t%d\n", i, cl, partexp[i, cl] > f }
    ns = 0; for (p in partof) paths[++ns] = p; sortlist(paths, ns)
    for (i = 1; i <= ns; i++) {
      p = paths[i]
      if (p in specparts) { nsp = split(specparts[p], spp, ","); for (j = 1; j <= nsp; j++) printf "путь\t%s\t%s\t%s\n", p, partkind[p], spp[j] > f }
      else printf "путь\t%s\t%s\t%02d\n", p, partkind[p], partof[p] > f
    }
    # Хозяин файла — часть, чьи пути его покрывают; файл вне частей (бывает только у класса вне веса) — остатку.
    for (i = 1; i <= n; i++) { p = fl[i]; for (c = 1; c <= ncl; c++) { cl = clist[c]; if (ck[p, cl] > 0) { o = (p in specparts) ? specparts[p] : partfor(p, rt[p]); if (o == "-" && np_ > 0) o = sprintf("%02d", np_ + 1); print "файл\t" p "\t" cl "\t" ck[p, cl] "\t" o > f } } }
    for (i = 1; i <= nrr; i++) printf "остаток\t%02d\t%s\t%s\n", np_ + 1, rrk[i], rrp[i] > f
    # операция <МЕТОД> <путь> <operationId> <спецификация> <часть | ->; топик <имя> <конфиг>. Часть — как в
    # строках заданий: части спецификации (кусок, иначе часть её файла), а их нет — часть обработчика.
    for (i = 1; i <= nos; i++) { p = ospec[i]; po = ((p in specre) && (p in rt)) ? partfor(p, rt[p]) : "-"
      for (j = 1; j <= OPN[p]; j++) {
        ow = po; for (c = 1; c <= np_; c++) if (sxf[c] == p && j >= sxs[c] && j <= sxe[c]) ow = sprintf("%02d", c)
        if (ow == "-" && np_ > 0) { if (!hdone) { handlers(); hdone = 1 }; k = tolower(OPI[p, j]); if ((k in hown) && hown[k] != "?") ow = hown[k] }
        printf "операция\t%s\t%s\t%s\t%s\t%s\n", OPM[p, j], OPP[p, j], OPI[p, j], p, ow > f } }
    for (i = 1; i <= ntp; i++) printf "топик\t%s\t%s\n", tname[i], tfile[i] > f
    close(f)
  }
  # Делит узел dir: дети-папки с ключами пакуются подряд, тяжёлые — рекурсивно; свои файлы с ключами — подряд.
  function cutdir(dir,   sp, ch, n, i, c, cur, nc, s, fl, nf, curf, ncf, sf) {
    inner[dir] = 1
    n = 0
    for (c in kids) { split(c, sp, SUBSEP); if (sp[1] == dir) ch[++n] = sp[2] }
    sortlist(ch, n)
    nc = 0; s = 0; nf = 0
    for (i = 1; i <= n; i++) {
      c = ch[i]
      if (kw[c] == 0) continue
      if (isfile[c]) { fl[++nf] = c; continue }
      if (sw[c] > K) { if (nc) { emit("папки", cur, nc, s); delete cur; nc = 0; s = 0 }; cutdir(c); continue }
      if (s + sw[c] > K && nc) { emit("папки", cur, nc, s); delete cur; nc = 0; s = 0 }
      cur[++nc] = c; s += sw[c]
    }
    if (nc) emit("папки", cur, nc, s)
    ncf = 0; sf = 0
    for (i = 1; i <= nf; i++) {
      c = fl[i]
      if ((c in specre) && sw[c] > K) { if (ncf) { emit("файлы", curf, ncf, sf); delete curf; ncf = 0; sf = 0 }; emitspec(c); continue }
      if (sf + sw[c] > K && ncf) { emit("файлы", curf, ncf, sf); delete curf; ncf = 0; sf = 0 }
      curf[++ncf] = c; sf += sw[c]
    }
    if (ncf) emit("файлы", curf, ncf, sf)
  }
  BEGIN {
    n = split(ENVIRON["PLAN_ROOTS"], rr, ","); split(ENVIRON["PLAN_ONDISK"], od, ",")
    for (i = 1; i <= n; i++) {
      r = rr[i]; sub(/^[ \t]+/, "", r); sub(/[ \t]+$/, "", r); r = np(r)
      if (r in ondisk) continue                        # один корень дважды — один раз
      root[++nr] = r; ondisk[r] = od[i] + 0
    }
  }
  NR == 1 { sub(/^\357\273\277/, "") }
  { sub(/\r$/, "") }
  # Путь контроля, которого нет как есть: единственный файл счёта или дерева с тем же хвостом пути —
  # от полного хвоста к имени файла; на уровне, где совпадений больше одного, — не найден.
  function ctlfind(raw,   t, n, seg, k, j, tail, f, hit, cnt) {
    t = raw; gsub(/\\/, "/", t); sub(/^(\.\/)+/, "", t); sub(/\/+$/, "", t)
    n = split(t, seg, "/")
    for (k = n; k >= 1; k--) {
      tail = seg[n - k + 1]; for (j = n - k + 2; j <= n; j++) tail = tail "/" seg[j]
      if (tail == "") continue
      cnt = 0; hit = ""
      for (f in fw) if (f == tail || substr(f, length(f) - length(tail)) == "/" tail) { if (f != hit) { cnt++; hit = f } }
      for (f in allf) if (!(f in fw) && (f == tail || substr(f, length(f) - length(tail)) == "/" tail)) { cnt++; hit = f }
      if (cnt == 1) return hit
      if (cnt > 1) return ""
    }
    return ""
  }
  # Контроль разведчика: «## контроль :: <класс> :: <файл> :: <число>» — не класс счёта.
  /^## контроль[ \t]*::/ {
    h = substr($0, 4); n = split(h, hp, " :: "); cl = ""; skipcl = ""
    for (i = 1; i <= n; i++) { gsub(/^[ \t]+|[ \t]+$/, "", hp[i]); gsub(/[`"]/, "", hp[i]) }
    if (n == 4 && hp[2] != "" && hp[4] ~ /^[0-9]+$/) { sub(/[ 	].*$/, "", hp[2]); if (!k_typehas(TYPE, hp[2])) next; ctlc[++nctl] = hp[2]; ctlr[nctl] = hp[3]; ctlf[nctl] = full(hp[3]); ctln[nctl] = hp[4] + 0 }
    else { ctlbad++; if (ctlbad1 == "") ctlbad1 = substr($0, 1, 160) }
    next
  }
  # Клиентская спека разведчика: «## клиентская спека :: <файл>» — не класс счёта; в сверку и вес не идёт.
  /^## клиентская спека[ \t]*::/ {
    h = substr($0, 4); n = split(h, hp, " :: "); cl = ""; skipcl = ""
    sp = hp[n]; gsub(/^[ \t]+|[ \t]+$/, "", sp); gsub(/[`"]/, "", sp); if (sp != "") clientspec[full(sp)] = 1
    next
  }
  /^## / {
    h = substr($0, 4); n = split(h, hp, " :: "); skipcl = ""; scope = ""
    cl = hp[1]; kind = hp[n]; gsub(/^[ \t]+|[ \t]+$/, "", cl); gsub(/^[ \t]+|[ \t]+$/, "", kind)
    sub(/[ \t]*\(.*$/, "", kind)                       # пометка счётчика: «ключ (без маски)» — всё равно ключ
    hdr++
    if (n < 2 || cl == "" || (kind != "ключ" && kind != "ориентир")) { badh++; if (badh1 == "") badh1 = substr($0, 1, 160) }
    # Класс, секции которого у типа нет (keys.awk, «Форма по типу»), — мимо итога, веса и плана, числом в вывод.
    w1 = cl; sub(/[ \t].*$/, "", w1)
    if (cl != "" && !k_typehas(TYPE, w1)) { skipcl = w1; if (!(w1 in dropn)) { dropo[++ndrop] = w1; dropn[w1] = 0 }; cl = ""; next }
    # Класс вне веса (`клиенты`): счёт тот же, что у остальных классов, только в вес нарезки он не идёт.
    w1 = cl; sub(/[ \t].*$/, "", w1); if (w1 == "клиенты") { cl = w1; nowt[cl] = 1 }
    # условие файла: «класс :: регэксп :: маска :: в файлах с <регэксп файла> :: ключ|ориентир»;
    # строка спецификации разведчика: «класс :: регэксп :: маска :: <файл спецификации> :: ключ»
    if (n >= 5 && hp[n - 1] ~ /^[ \t]*в файлах с[ \t]/) { scope = hp[n - 1]; sub(/^[ \t]*в файлах с[ \t]+/, "", scope); gsub(/^[ \t`]+|[ \t`]+$/, "", scope) }
    else if (n >= 5 && kind == "ключ") { sp = hp[n - 1]; gsub(/^[ \t]+|[ \t]+$/, "", sp); rx = hp[2]; gsub(/^[ \t]+|[ \t]+$/, "", rx); sp = full(sp); specre[sp] = rx; speccl[sp] = cl }
    if (!(cl in seencl)) { seencl[cl] = 1; clist[++ncl] = cl }
    next
  }
  skipcl != "" && /:[0-9]+[ \t]*$/ { c = $0; sub(/[ \t]+$/, "", c); sub(/.*:/, "", c); dropn[skipcl] += c; next }
  cl == "" { next }
  /:[0-9]+[ \t]*$/ {
    line = $0; sub(/[ \t]+$/, "", line)
    cnt = line; sub(/.*:/, "", cnt); path = substr(line, 1, length(line) - length(cnt) - 1)
    path = full(path); cnt += 0
    if (cnt == 0) next
    if (scope != "") { ns++; SP[ns] = path; SC[ns] = cnt; SCL[ns] = cl; SK[ns] = kind; SR[ns] = scope; next }
    addcnt(path, cl, kind, cnt)
    next
  }
  # Путь к файлу без счёта в конце — совпадение текстом либо список файлов: греп снят не в режиме счёта.
  /^[^ \t#].*\.[A-Za-z0-9]+:/ || (/[\/\\]/ && /\.[A-Za-z0-9]+[ \t]*$/) { bad++; if (bad1 == "") bad1 = substr($0, 1, 160) }
  END {
    if (hdr == 0) { print "ОТКАЗ: в файле счёта нет заголовков «## <класс> :: … :: ключ|ориентир»"; exit 3 }
    if (badh > 0) { printf "ОТКАЗ: заголовков не по форме «## <класс> :: … :: ключ|ориентир»: %d; первый: %s\n", badh, badh1; exit 3 }
    if (bad > 0) { printf "ОТКАЗ: счёт неполон — строк не по форме <путь>:<число>: %d; первая: %s\n", bad, bad1; exit 3 }
    scopes()
    # Корень на диске, а файла из счёта там нет — путь записан не от корня либо это не путь.
    for (p in fw) {
      best = rootof(p)
      if (best == "" || !ondisk[best]) continue
      if ((getline junk < p) < 0) { ghost++; if (ghost1 == "" || p < ghost1) ghost1 = p }
      close(p)
    }
    if (ghost > 0) { printf "ОТКАЗ: путей счёта, которых нет на диске: %d; первый: %s\n", ghost, ghost1; exit 3 }
    # Корень файла — самый длинный подходящий корень; файлы вне корней и тестовые — в план не идут.
    for (p in fw) {
      best = rootof(p)
      if (best == "") { outside += fw[p]; continue }
      if (istest(substr(p, length(best) + 2))) {
        tw += fw[p]; q = parent(p); if (!(q in tdir)) { tdir[q] = 1; tl[++ntl] = q }
        for (cc = 1; cc <= ncl; cc++) { cl = clist[cc]; tk[cl] += ck[p, cl]; to[cl] += co[p, cl] }
        continue
      }
      rt[p] = best; sw[p] += fw[p]; kw[p] += fk[p]
      for (cc = 1; cc <= ncl; cc++) {
        cl = clist[cc]
        if ((p, cl) in ck) for (q = parent(p); ; q = parent(q)) { ck[q, cl] += ck[p, cl]; if (q == best) break }
        if ((p, cl) in co) for (q = parent(p); ; q = parent(q)) { co[q, cl] += co[p, cl]; if (q == best) break }
      }
      for (q = parent(p); ; q = parent(q)) { sw[q] += fw[p]; kw[q] += fk[p]; if (q == best) break }
      c = p; for (q = parent(c); ; q = parent(q)) { kids[q, c] = 1; if (q == best) break; c = q }
      total += fw[p]; ktotal += fk[p]
    }
    if (outside > 0 && total == 0 && tw == 0) { printf "ОТКАЗ: все пути счёта вне корней сервиса (вес %g) — плана нет\n", outside; exit 3 }
    line = "итог по классам: " sums(tot, ""); o = sums(orn, "")
    if (o != "") line = line " | ориентир: " o
    print line
    # Условие файла — счётчик эти совпадения считал, в итог они не вошли: ведущий прибавляет их при сверке.
    for (cc = 1; cc <= ncl; cc++) { cl = clist[cc]; if (sout[cl] > 0) printf "вне условия файла: %s %d в файлах %d\n", cl, sout[cl], soutf[cl] }
    for (r in sbad) printf "условие файла не разобрано: %s — строка счёта целиком\n", r
    for (i = 1; i <= ndrop; i++) printf "класс %s: у типа %s секции нет — пометок %d, не считаются\n", dropo[i], TYPE, dropn[dropo[i]]
    # Вне веса — справочно: класс `клиенты` в итоге выше, но в вес и части не идёт.
    line = ""; for (cl in nowt) if (tot[cl] > 0) line = line (line == "" ? "" : "; ") cl " — в вес и нарезку не идёт"
    if (line != "") print "вне веса: " line
    if (outside > 0) printf "вне корней сервиса: вес %g — в план не вошло\n", outside
    if (tw > 0) {
      line = sums(tk, ""); o = sums(to, "ориентир ")
      sortlist(tl, ntl); line = "в тестовых папках: " line (line != "" && o != "" ? ", " : "") o " — в план и в сверку не идут: "
      for (i = 1; i <= ntl && i <= 5; i++) line = line (i > 1 ? "; " : "") tl[i]
      if (ntl > 5) line = line sprintf("; …и ещё %d", ntl - 5)
      print line
      for (cc = 1; cc <= ncl; cc++) { cl = clist[cc]; nk[cl] = tot[cl] - tk[cl]; no[cl] = orn[cl] - to[cl] }
      line = "к сверке: " sums(nk, ""); o = sums(no, "")
      if (o != "") line = line " | ориентир: " o
      print line
    }
    # Контроль разведчика: маркер класса в его файле против числа, которое разведчик видел глазами.
    if (nctl) { while ((getline f < ENVIRON["PLAN_LIST"]) > 0) { sub(/\r$/, "", f); if (f != "") allf[np(f)] = 1 }; close(ENVIRON["PLAN_LIST"]) }
    for (i = 1; i <= nctl; i++) {
      p = ctlf[i]
      if (!(p in fw) && !(p in allf)) p = ctlfind(ctlr[i])
      if (p == "") { printf "контроль %s не сверен: файла «%s» нет ни в счёте, ни в дереве сервиса\n", ctlc[i], ctlr[i]; continue }
      m = ((p, ctlc[i]) in ck) ? ck[p, ctlc[i]] : 0
      if (m * 2 < ctln[i]) printf "УЗКИЙ МАРКЕР: %s — маркер дал %d в %s, разведчик видел %d\n", ctlc[i], m, p, ctln[i]
      else printf "контроль %s: маркер дал %d в %s, разведчик видел %d — сходится\n", ctlc[i], m, p, ctln[i]
    }
    if (ctlbad > 0) printf "контроль не по форме «## контроль :: <класс> :: <файл> :: <число>»: %d; первый: %s\n", ctlbad, ctlbad1
    discover()
    if (!k_typesplit(TYPE)) { printf "нарезка не нужна: тип %s не режется (вес %g)\n", TYPE, total; dump(); exit 0 }
    # Решает вес ключей: число ориентира зависит от маркера, который выбрал разведчик, — части он только раскладывает.
    if (ktotal <= K) {
      if (total > ktotal) printf "нарезка не нужна: вес по ключам %g ≤ K=%g (ориентир %g в решение не идёт)\n", ktotal, K, total - ktotal
      else printf "нарезка не нужна: вес %g ≤ K=%g\n", total, K
      dump(); exit 0
    }
    printf "вес сервиса %g при K=%g, w=%g\n", total, K, W
    for (i = 1; i <= nr; i++) {
      r = root[i]
      if (kw[r] == 0) continue
      if (sw[r] <= K) { one[1] = r; emit("папки", one, 1, sw[r]); continue }
      cutdir(r)
    }
    # Ориентир вне частей — остатку, числом и файлом.
    n = 0
    for (p in rt) if (kw[p] == 0 && !covered(p, rt[p]))
      for (cc = 1; cc <= ncl; cc++) { cl = clist[cc]; if (co[p, cl] > 0) { ol[++n] = p " — " cl " " co[p, cl]; rsum[cl] += co[p, cl] } }
    for (cc = 1; cc <= ncl; cc++) { cl = clist[cc]; if (rsum[cl] > 0) restmark = restmark (restmark == "" ? "" : ", ") cl " около " rsum[cl] " (ориентир)" }
    if (n > 0) {
      sortlist(ol, n); line = "остатку по ориентиру: "
      for (i = 1; i <= n && i <= 20; i++) line = line (i > 1 ? "; " : "") ol[i]
      if (n > 20) line = line sprintf("; …и ещё %d", n - 20)
      print line
    }
    # Остаток списком: папки целиком вне частей и «файлы прямо в папке» у разрезанных папок.
    seen = 0
    while ((getline f < ENVIRON["PLAN_LIST"]) > 0) {
      sub(/\r$/, "", f); if (f == "") continue
      seen = 1; f = np(f); r = rootof(f)
      if (r == "") continue
      rel = substr(f, length(r) + 2)
      if (rel ~ /^(target|build|dist)\// || istest(rel) || covered(f, r)) continue
      top = ""
      for (q = parent(f); ; q = parent(q)) { if (!(q in inner)) top = q; if (q == r) break }
      if (top == "") { q = parent(f); if (!(q in loose)) { loose[q] = 1; lo[++nl] = q } }
      else if (!(top in rem)) { rem[top] = 1; rl[++nrem] = top }
    }
    close(ENVIRON["PLAN_LIST"])
    if (!seen) { printf "частей %d; остаток — всё вне папок и файлов частей (дерева корней на диске нет)\n", np_; tasks(1); dump(); exit 0 }
    if (nrem + nl == 0) { printf "частей %d; остаток — пусто: вне частей файлов нет\n", np_; tasks(0); dump(); exit 0 }
    if (nrem + nl > 60) { printf "частей %d; остаток — всё вне папок и файлов частей (пунктов больше 60 — список не печатается)\n", np_; tasks(1); dump(); exit 0 }
    sortlist(rl, nrem); sortlist(lo, nl)
    printf "частей %d; остаток — пунктов %d:\n", np_, nrem + nl
    for (i = 1; i <= nrem; i++) { print "  папка " rl[i]; rrk[++nrr] = "папка"; rrp[nrr] = rl[i] }
    for (i = 1; i <= nl; i++) { print "  файлы прямо в " lo[i]; rrk[++nrr] = "файлы"; rrp[nrr] = lo[i] }
    tasks(1)
    dump()
  }
' "$COUNTS"
