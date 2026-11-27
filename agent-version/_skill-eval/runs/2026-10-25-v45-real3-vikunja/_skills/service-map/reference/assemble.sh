#!/usr/bin/env bash
# assemble.sh — склейка карточки из файлов частей, без модели.
#
#   bash assemble.sh <папка частей> <S> <дата> <черновик-выход> <опись-выход>
#
# В папке: head.md (каркас карточки по шаблону: шапка, секции головы, в ключевых секциях — строка
# `<!-- части -->`), part-01.md … part-<S>.md и part-NN.opis.md, при желании head.opis.md и plan.tsv
# (план plan.sh). Первая строка каждого файла — `<!-- service-map: <голова|часть NN> <дата> -->`; номер
# части сверяется числом (`часть 1` и `часть 01` — одна часть); файла нет, номер или дата чужие — отказ,
# ничего не пишется. В каждой секции с `<!-- части -->` блоки `###` и строки таблиц всех частей сливаются;
# сортировка по ключу (контракт — по пути, затем по глаголу; «События» — потребляет, затем публикует;
# «Бизнес-правила» — объекты, сообщения, ограничения); заглушки частей (`—`, `не определено…`) остаются,
# только если блоков нет ни у одной части. Опись — списки частей подряд, итоги `⟹` суммируются.
# Ключ — по шаблону (keys.awk, общий с check.sh): заголовок блока в контракте, «Событиях», задачах и
# данных пишется ключом — без строки запроса, аргументов операции, слов вокруг топика в бэктиках; два
# написания одного ключа дают один блок. Заголовок, который к ключу не сводится, — как есть, строкой
# «ключ не опознан». Ключ контракта, записанный вызовом (`Dome.Close(Req)`), — тот же ключ, что без
# скобок, если у другой части он стоит без скобок: один блок.
# Дубль ключа — блок части-владельца по источнику ключа в описях частей (куски через « + »): первый кусок,
# который план разметил (строка «файл»), иначе первый, который план отдал части, — у операции ненарезанной
# спецификации это обработчик. Из других блоков дописываются строки `— ` и поля «Владеет данными» с именами, которых у
# владельца нет; прочие строки `- ` отбрасываются. Владельца нет — плана нет, у ключа нет источника, файл у
# нескольких частей, у владельца нет блока — блоки объединяются: заголовок, назначение и `сущности:`
# первого, строки `- ` и `— ` всех без повторов; строка в выводе называет причину.
# У частей есть блоки в секции, которой в каркасе головы нет или в ней нет метки, — отказ с именем
# виновного: молча блоки не выбрасываются. Блоки до первого заголовка секции (часть его не написала) идут
# в секцию контракта или «Событий» по форме ключа, иначе отбрасываются строкой вывода. Секцию, которую пишет голова («Зависит от», «Роли и доступ»,
# «Бизнес-правила»), у части отбрасывает со строкой в выводе.
# Строки-метки «Событий» (`- тело:`, `- ключ:`, `- когда:` …) у дубля: метки, которой у владельца нет, —
# дописываются; «не определено» владельца заменяется значением другой части. Строки привязки (`доступ:`,
# `меняет:`, `шлёт:`) — в блоке, хвост « — файл» снимается, `меняет: нет` и `шлёт: нет` в карточку не идут.
set -u
DIR="${1:?папка частей}"; S="${2:?число частей}"; DATE="${3:?дата}"; OUT="${4:?черновик}"; OPIS="${5:?опись}"
export LC_ALL=C
fail() { echo "ОТКАЗ: $*"; exit 3; }
K_AWK="$(cat "$(dirname "$0")/keys.awk" 2>/dev/null)"
[ -n "$K_AWK" ] || fail "нет $(dirname "$0")/keys.awk — скилл установлен не целиком"
fresh() {  # fresh <файл> <кто> [<кто — регэксп>]
  [ -f "$1" ] || fail "нет файла $1"
  head -n1 "$1" | tr -d '\r' | grep -q "^<!-- service-map: ${3:-$2} $DATE -->" || fail "$1 — первая строка не «<!-- service-map: $2 $DATE -->» (чужой прогон?)"
}
fresh "$DIR/head.md" "голова"
PARTS=""; POPIS=""
for i in $(seq 1 "$S"); do
  n=$(printf '%02d' "$i")
  fresh "$DIR/part-$n.md" "часть $n" "часть 0*$i"; fresh "$DIR/part-$n.opis.md" "часть $n" "часть 0*$i"
  PARTS="$PARTS $DIR/part-$n.md"; POPIS="$POPIS $DIR/part-$n.opis.md"
done
[ -f "$DIR/head.opis.md" ] && fresh "$DIR/head.opis.md" "голова"
TMP="$(mktemp -d 2>/dev/null || echo "/tmp/assemble.$$")"; mkdir -p "$TMP"; trap 'rm -rf "$TMP"' EXIT
PLAN="$DIR/plan.tsv"; [ -s "$PLAN" ] || PLAN=""

# 1. Записи частей: тип<TAB>секция<TAB>ключ-сортировки<TAB>ключ<TAB>текст (\001 вместо перевода строки)<TAB>часть.
# shellcheck disable=SC2086
# Блоки до первого заголовка секции в файле части (часть забыла `## <секция>`): секция — по форме ключа каждого
# блока (ключ контракта или топика — эта секция каркаса), пока не встретится `## `; секцию не угадать — блок
# отброшен строкой вывода.
HSEC() { tr -d '\r' < "$DIR/head.md" | grep -m1 -E "^## $1" | sed 's/^## //; s/[ \t]*$//'; }
CSEC="$(HSEC 'Публичный (контракт|API)')"; ESEC="$(HSEC 'События')"
awk -v nokeyf="$TMP/nokey" -v tailf="$TMP/tails" -v orphf="$TMP/orph" -v CSEC="$CSEC" -v ESEC="$ESEC" "$K_AWK"'
  function norm(s,   v) {
    gsub(/`/, "", s); gsub(/«|»/, "", s); sub(/^[ \t]+/, "", s); sub(/[ \t]+$/, "", s); gsub(/[ \t]+/, " ", s)
    v = s; sub(/ .*/, "", v)
    if (toupper(v) ~ /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/) s = toupper(v) substr(s, length(v) + 1)
    return s
  }
  function skey(sec, k,   v, rest) {
    if (sec ~ /^Публичный (контракт|API)/) {
      v = k; sub(/ .*/, "", v)
      if (v ~ /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/) { rest = substr(k, length(v) + 2); return rest "\002" v }
      return k
    }
    if (sec ~ /^Бизнес-правила/) {
      if (k ~ /^сообщение/) return "2" k
      if (k ~ /^ограничение/) return "3" k
      return "1" k
    }
    return k
  }
  function kcls(sec,   c) { c = k_cls(sec); return (k_partsec(sec) && c != "потребляет") ? c : "" }   # класс блочной секции частей
  function header(sec, k,   d) {
    if (sec ~ /^События/ && k ~ /^(публикует|потребляет|транспорт) /) { d = k; sub(/ .*/, "", d); return "### " d " `" substr(k, length(d) + 2) "`" }
    return "### `" k "`"
  }
  function flush() {
    if (key != "" && tail != "") txt = txt "\001" tail
    if (key != "") { sub(/(\001)+$/, "", txt); print "B\t" sec "\t" skey(sec, key) "\t" key "\t" txt "\t" pn }
    key = ""; txt = ""; tail = ""; rowout()
  }
  function rowout(   n, c, k) {                            # отложенная строка таблицы — данные
    if (pend == "") return
    n = split(pend, c, "|"); k = norm(c[2])
    if (psec ~ /^Потребляемые API/) k = k " :: " norm(c[3])
    if (k != "" && k != "—" && k != "— :: ") print "R\t" psec "\t" k "\t" k "\t" pend "\t" pn
    pend = ""
  }
  { gsub(/\t/, " ") }
  FNR == 1 { flush(); sec = ""; orph = 0; pn = FILENAME; sub(/.*part-/, "", pn); sub(/\.md$/, "", pn); next }   # строка свежести
  { sub(/\r$/, "") }
  /^## / { flush(); sec = substr($0, 4); sub(/[ \t]+$/, "", sec); orph = 0; next }
  (sec == "" || orph) && /^### / { flush(); orph = 1; h = substr($0, 5); p = index(h, " — "); if (p > 0) h = substr(h, 1, p - 1)
    sec = ""
    if (CSEC != "" && k_canon("контракт", h) != "") sec = CSEC
    else if (ESEC != "" && k_canon("топики", h) != "") sec = ESEC
    print pn "\t" (sec == "" ? "-" : sec) > orphf }
  sec == "" { next }
  # Заголовок блока в контракте, «Событиях», задачах и данных пишется ключом; хвост « — …» после него
  # становится строкой назначения, если её нет. Не сводится к ключу — заголовок как есть. У «Бизнес-правил»
  # фраза после « — » — часть формы.
  /^### / {
    flush(); h = substr($0, 5); p = index(h, " — "); tl = ""; if (p > 0) { tl = substr(h, p + 5); h = substr(h, 1, p - 1) }
    c = kcls(sec)
    if (c == "") { key = norm(h); txt = $0; next }
    key = k_canon(c, h)
    if (key != "") { txt = header(sec, key); tail = tl }
    else { key = norm(h); txt = $0; print sec ": " key " (часть " pn ")" > nokeyf }
    next
  }
  key != "" {
    if (tail != "" && $0 !~ /^[ \t]*$/) { if ($0 ~ /^(- |— |сущности:)/) txt = txt "\001" tail; tail = "" }
    l = $0; if (sec ~ /^Публичный контракт/) sub(/^- сущности:/, "сущности:", l)
    # Хвост « — <файл>[ + <файл>]» у строки факта — источник из описи, в карточке ему не место: факт остаётся.
    tl_ = 0
    if (kcls(sec) != "" && l ~ /^(- |— |доступ:|меняет:|шлёт:)/ && match(l, / — `?[A-Za-z0-9_.\/-]+\.(java|kts?|tsx?|jsx?|mjs|py|go|rb|php|cs|ya?ml|json|xml|sql|properties|graphqls?|proto)`?( \+ `?[A-Za-z0-9_.\/-]+`?)*[ \t]*$/)) {
      l = substr(l, 1, RSTART - 1); tl_ = 1
    }
    if (l ~ /^(меняет|шлёт):[ \t]*нет[ \t.]*$/) next   # «нет» живёт в описи, в карточке строки нет
    if (tl_) print sec ": " key " (часть " pn ")" > tailf
    txt = txt "\001" l; next
  }
  /^\|/ {
    if ($0 ~ /^\|[ \t:|-]*$/) { pend = ""; next }          # разделитель: отложенная строка была заголовком
    rowout(); pend = $0; psec = sec; next
  }
  { rowout() }
  /^(—|не определено)/ { print "P\t" sec "\t\t\t" $0; next }
  END { flush() }
' $PARTS > "$TMP/rec.raw"
: >> "$TMP/nokey"; : >> "$TMP/tails"; : >> "$TMP/orph"

# 1а. Ключ контракта вызовом и он же без скобок — один ключ (точное совпадение старше: две перегрузки
# с разными аргументами остаются двумя ключами).
awk -F'\t' -v OFS='\t' -v NEAR="$TMP/near" "$K_AWK"'
  FNR == NR { if ($1 == "B") have[$2 SUBSEP $4] = 1; next }
  $1 == "B" && $2 ~ /^Публичный (контракт|API)/ { b = k_bare($4); if (b != $4 && (($2 SUBSEP b) in have)) { print $2 ": " b " ~ " $4 >> NEAR; $4 = b; $3 = b } }
  { print }
' "$TMP/rec.raw" "$TMP/rec.raw" > "$TMP/rec"
: >> "$TMP/near"

# 1б. Каждой секции с блоками или строками частей нужна метка в каркасе головы.
awk '{ sub(/\r$/, "") } /^## / { sec = substr($0, 4); sub(/[ \t]+$/, "", sec); print "H\t" sec; next }
     { l = $0; gsub(/^[ \t]+|[ \t]+$/, "", l); if (l == "<!-- части -->") print "M\t" sec }' "$DIR/head.md" > "$TMP/frame"
awk -F'\t' "$K_AWK"'
  FILENAME == ARGV[1] { if ($1 == "M") mark[$2] = 1; else hs[$2] = 1; next }
  ($1 == "B" || $1 == "R") && !($2 in mark) { if (!(($2 SUBSEP $6) in seen)) { seen[$2 SUBSEP $6] = 1; who[$2] = who[$2] (who[$2] == "" ? "" : ", ") $6 } }
  END {
    for (s in who) {
      if (k_partsec(s)) print "HEAD\t" s "\t" who[s]
      else if (s in hs) print "DROP\t" s "\t" who[s]
      else print "PART\t" s "\t" who[s]
    }
  }' "$TMP/frame" "$TMP/rec" | sort > "$TMP/unplaced"
u="$(grep '^HEAD	' "$TMP/unplaced" | head -n1)"
[ -n "$u" ] && fail "голова — в каркасе нет строки «<!-- части -->» в секции «$(printf '%s' "$u" | cut -f2)»: блоки частей $(printf '%s' "$u" | cut -f3) вставить некуда"
u="$(grep '^PART	' "$TMP/unplaced" | head -n1)"
[ -n "$u" ] && fail "часть $(printf '%s' "$u" | cut -f3) — секция «$(printf '%s' "$u" | cut -f2)» не из шаблона: её блоки вставить некуда"

sort -t"$(printf '\t')" -k1,1 -k2,2 -k3,3 -s "$TMP/rec" > "$TMP/rec.s"

# 1в. Источники ключей по описям частей: часть<TAB>ключ<TAB>хвост строки после « — ».
# shellcheck disable=SC2086
awk "$K_AWK"'
  FNR == 1 { pn = FILENAME; sub(/.*part-/, "", pn); sub(/\.opis\.md$/, "", pn); next }
  { sub(/\r$/, "") }
  /^[ \t]/ || /^(#|⟹|\(|>|-|```|<!--)/ || /^$/ { next }
  { p = index($0, " — "); if (p == 0) next; h = substr($0, 1, p - 1)
    if (k_fact(h)) next
    print pn "\t" k_opis(h) "\t" substr($0, p + 5) }
' $POPIS > "$TMP/src"

# 2. Слияние дублей. Блок без дубля выходит как есть. Дубль ключа — блок владельца по плану; владельца
# нет — объединение (см. шапку). Строка с отступом едет со своей строкой.
CHECK_OWNER_PLAN="$PLAN" awk -F'\t' -v srcf="$TMP/src" -v S="$S" -v os="$(uname -s 2>/dev/null)" -v rep="$TMP/dups" "$K_AWK"'
  function units(txt, U,   n, L, i, m) {
    n = split(txt, L, "\001"); m = 0
    for (i = 2; i <= n; i++) if (m > 0 && L[i] ~ /^[ \t]/) U[m] = U[m] "\001" L[i]; else U[++m] = L[i]
    return m
  }
  # Путь — как в check.sh: без бэктиков, «.../», номера строки; Windows-диск — заглавной.
  function np(p) {
    gsub(/`/, "", p); gsub(/\\/, "/", p); gsub(/\/\/+/, "/", p)
    sub(/^[ \t]+/, "", p); sub(/[ \t]+$/, "", p); sub(/^\.\//, "", p); sub(/\/$/, "", p)
    sub(/^(\.\.\.|…)\/*/, "", p); sub(/:[0-9]+(-[0-9]+)?$/, "", p); sub(/#L[0-9].*$/, "", p)
    if (os ~ /^(MINGW|MSYS|CYGWIN)/ && p ~ /^\/[A-Za-z]\//) p = toupper(substr(p, 2, 1)) ":" substr(p, 3)
    if (p ~ /^[A-Za-z]:/) p = toupper(substr(p, 1, 1)) substr(p, 2)
    return p
  }
  function abs(p) { return p ~ /^(\/|[A-Za-z]:)/ }
  function same(p, q) { return p == q || (!abs(p) && length(q) > length(p) && substr(q, length(q) - length(p)) == "/" p) }
  # Части плана, которым отдан файл f: точный файл старше папки, папка — ближайшая; список через запятую.
  function own1(f,   p, q, depth, best, res) {
    best = 0; res = ""
    for (p in files) if (same(f, p)) { if (length(f) + 1 > best) { best = length(f) + 1; res = files[p] } else if (length(f) + 1 == best) res = res "," files[p] }
    for (p in paths) {
      q = f; depth = length(f) + 1
      if (kinds[p] == "папки") { sub(/\/[^\/]+$/, "", q); depth = length(q) }
      while (q != f || kinds[p] == "файлы") {
        if (same(q, p)) { if (depth > best) { best = depth; res = paths[p] } else if (depth == best) res = res "," paths[p]; break }
        if (kinds[p] != "папки" || q !~ /\//) break
        sub(/\/[^\/]+$/, "", q); depth = length(q)
      }
    }
    return res
  }
  # Части, которым план отдал размеченный файл f (строка «файл»: в нём пометки ключа), через запятую.
  function ownmark(f,   p, res) { res = ""; for (p in files) if (same(f, p)) res = res (res == "" ? "" : ",") files[p]; return res }
  # Файлы одного куска источника — в OW[часть] = 1; размеченные (marked) или отданные части по путям.
  function addown(seg, marked,   n, w, i, t, o, m, x, j, hit) {
    gsub(/[,;()]/, " ", seg); n = split(seg, w, " "); hit = 0
    for (i = 1; i <= n; i++) {
      t = w[i]; if (t !~ /\// && t !~ /\.[A-Za-z0-9]+(:[0-9]+)?$/) continue
      o = marked ? ownmark(np(t)) : own1(np(t)); if (o == "") continue
      m = split(o, x, ","); for (j = 1; j <= m; j++) if (x[j] != "-" && x[j] != "") { OW[x[j] + 0] = 1; hit = 1 }
    }
    return hit
  }
  # Владелец по источнику строки описи (куски через « + »: объявление, затем обработчик) — как у брифов
  # частей: решает первый кусок, который план разметил; размеченного нет (ненарезанная спецификация,
  # пометка, которой разведчик не назвал) — первый, который план отдал части.
  function owners(src,   segs, ns, s) {
    ns = split(src, segs, / \+ /)
    for (s = 1; s <= ns; s++) if (addown(segs[s], 1)) return
    for (s = 1; s <= ns; s++) if (addown(segs[s], 0)) return
  }
  # Строка поля «Владеет данными»: имена до «:» или « — » (в бэктиках, с `?` и пометкой в скобках, либо
  # голые через запятую) — в FN[], исходные куски — в IT[], остаток строки с продолжениями — в RST; не
  # перечень полей — 0.
  function fnames(u,   t, p, q, n, i, x) {
    t = u; i = index(t, "\001"); RST = (i > 0) ? substr(t, i) : ""; if (i > 0) t = substr(t, 1, i - 1); sub(/^- /, "", t)
    p = index(t, ":"); q = index(t, " — "); if (q > 0 && (p == 0 || q < p)) p = q
    if (p > 0) { RST = substr(t, p) RST; t = substr(t, 1, p - 1) }
    n = split(t, IT, /[,\/]/)
    for (i = 1; i <= n; i++) {
      gsub(/^[ \t]+|[ \t]+$/, "", IT[i]); x = IT[i]
      sub(/[ \t]*\([^)]*\)$/, "", x); gsub(/`/, "", x); sub(/\?$/, "", x)
      if (x !~ /^[A-Za-z_][A-Za-z0-9_]*$/) return 0
      FN[i] = x
    }
    return n
  }
  function srcof(a, k) { if ((a SUBSEP k) in src) return src[a, k]; if ((a SUBSEP k_bare(k)) in src) return src[a, k_bare(k)]; return "" }
  function addu(u) { if (!(u in have)) { have[u] = 1; if (u ~ /^- /) dash[++ndash] = u; else if (u ~ /^— /) sem[++nsem] = u; else pre[++npre] = u } }
  function out(   s, i, j, m, U, ob, ns, ni, who, why, nd, o, nown) {
    if (pk == "") return
    if (nb > 1) {
      who = ""; for (i = 1; i <= nb; i++) who = who (i > 1 ? ", " : "") bpn[i]
      delete OW; ns = 0
      for (i = 1; i <= nb; i++) { s = srcof(bpn[i], pk); if (s != "") { ns++; owners(s) } }
      ob = 0; ni = 0; nown = 0
      for (o in OW) { nown++; for (i = 1; i <= nb; i++) if (bpn[i] + 0 == o + 0) { ni++; ob = i } }
      why = ""
      if (planok == 0) why = "плана нет"
      else if (ns == 0) why = "у ключа нет источника в описях"
      else if (ni > 1) why = "файл-источник у нескольких частей"
      else if (ni == 0 && nown == 0 && rest != "") { for (i = 1; i <= nb; i++) if (bpn[i] + 0 == rest + 0) ob = i; if (!ob) why = "файл вне частей, у остатка блока нет" }
      else if (ni == 0 && nown == 0) why = "файл-источник вне частей плана"
      else if (ni == 0) { why = "владелец по плану —"; for (o in OW) why = why " " sprintf("%02d", o); why = why ", блока у него нет" }
      delete have; npre = ndash = nsem = 0
      if (why == "") {
        delete known; delete OU; delete XD; delete XS; delete oslot; nx = nxs = 0
        om = units(blk[ob], U)
        for (j = 1; j <= om; j++) { have[U[j]] = 1; OU[j] = U[j]; if (U[j] ~ /^- / && psec ~ /^Владеет данными/) { c = fnames(U[j]); for (q = 1; q <= c; q++) known[FN[q]] = 1 }
          if (psec ~ /^События/ && U[j] ~ slotre) { lb = U[j]; sub(/^- /, "", lb); sub(/:.*/, "", lb); oslot[lb] = j } }
        nd = 0; na = 0; who = ""
        for (i = 1; i <= nb; i++) if (i != ob) {
          who = who (who == "" ? "" : ", ") bpn[i]; m = units(blk[i], U)
          for (j = 1; j <= m; j++) {
            u = U[j]; if (u in have) continue
            if (u ~ /^— /) { have[u] = 1; XS[++nxs] = u; continue }
            # Строка-метка «Событий» другой части: у владельца метки нет — дописывается; у владельца
            # «не определено» — заменяется. Иначе отбрасывается, как любая строка «- ».
            if (psec ~ /^События/ && u ~ slotre) {
              lb = u; sub(/^- /, "", lb); sub(/:.*/, "", lb); have[u] = 1
              if (!(lb in oslot)) { XD[++nx] = u; oslot[lb] = 0; na++ }
              else if (oslot[lb] > 0 && OU[oslot[lb]] ~ /^- [^:]+:[ \t]*не определено/ && u !~ /^- [^:]+:[ \t]*не определено/) { OU[oslot[lb]] = u; na++ }
              else nd++
              continue
            }
            if (u !~ /^- /) continue
            c = (psec ~ /^Владеет данными/) ? fnames(u) : 0; keep = ""; nk = 0
            for (q = 1; q <= c; q++) if (!(FN[q] in known)) { keep = keep (nk++ ? ", " : "") IT[q]; known[FN[q]] = 1 }
            if (nk == 0) { nd++; continue }
            if (nk < c) u = "- " keep RST
            have[u] = 1; XD[++nx] = u; na++
          }
        }
        # порядок шаблона: строки владельца без «— », новые поля, «— » владельца, «— » остальных
        s = blk[ob]; sub(/\001.*/, "", s)
        for (j = 1; j <= om; j++) if (OU[j] !~ /^— /) s = s "\001" OU[j]
        for (j = 1; j <= nx; j++) s = s "\001" XD[j]
        for (j = 1; j <= om; j++) if (OU[j] ~ /^— /) s = s "\001" OU[j]
        for (j = 1; j <= nxs; j++) s = s "\001" XS[j]
        print psec ": " pk " — блок части " bpn[ob] " (владелец по плану)" (na ? "; новых " (psec ~ /^События/ ? "строк-меток" : "полей") " от " who " — строк " na : "") "; у " who " строк «- » отброшено " nd > rep
        btxt = s
      } else {
        s = blk[1]; sub(/\001.*/, "", s); ent = 0
        for (i = 1; i <= nb; i++) { m = units(blk[i], U); for (j = 1; j <= m; j++) { if (U[j] ~ /^(- )?сущности:/) { if (!ent) { ent = 1; pre[++npre] = U[j] }; continue } if (U[j] ~ /^(- |— )/ || i == 1) addu(U[j]) } }
        for (i = 1; i <= npre; i++) s = s "\001" pre[i]
        for (i = 1; i <= ndash; i++) s = s "\001" dash[i]
        for (i = 1; i <= nsem; i++) s = s "\001" sem[i]
        print psec ": " pk " — блоки частей " who " объединены, владельца нет: " why > rep
        btxt = s
      }
    }
    print psec "\t" btxt "\001"
    pk = ""
  }
  BEGIN {
    slotre = "^- (тело|ключ|когда|гарантия|не шлётся|читает|группа|подтверждение|повтор|ошибка):"
    while ((getline l < srcf) > 0) { split(l, x, "\t"); if (!((x[1] SUBSEP x[2]) in src)) src[x[1], x[2]] = x[3] }
    plan = ENVIRON["CHECK_OWNER_PLAN"]; planok = 0; maxp = 0
    if (plan != "") while ((getline l < plan) > 0) {
      sub(/\r$/, "", l); split(l, r, "\t")
      if (r[1] == "файл" && r[5] != "-" && r[5] != "") { p = np(r[2]); files[p] = (p in files) ? files[p] "," r[5] : r[5]; planok = 1 }
      if (r[1] == "путь") { p = np(r[2]); paths[p] = (p in paths) ? paths[p] "," r[4] : r[4]; kinds[p] = r[3]; planok = 1; if (r[4] + 0 > maxp) maxp = r[4] + 0 }
    }
    rest = (planok && S + 0 > maxp) ? sprintf("%02d", S) : ""
  }
  {
    t = $1; sec = $2; k = $4; txt = $5
    if (t == "P") { ph[sec] = ph[sec] (ph[sec] == "" ? "" : "\001") txt; next }
    if (t == pt && sec == psec && k == pk) {
      if (t == "B") { blk[++nb] = txt; bpn[nb] = $6 }
      # строка «Зависит от» того же имени у другой части — первая остаётся, остальные — в вывод
      else if (t == "R" && sec ~ /^Зависит от/ && txt != btxt) print sec ": " k " — строка части " $6 " отброшена, оставлена строка части " bpn[1] > rep
      next
    }
    out(); pt = t; psec = sec; pk = k; btxt = txt; nb = 1; blk[1] = txt; bpn[1] = $6
    has[sec] = 1
  }
  END {
    out()
    for (s in ph) if (!(s in has)) print s "\t" ph[s]
  }
' "$TMP/rec.s" > "$TMP/merged"
: >> "$TMP/dups"

# 3. Каркас головы: строка `<!-- части -->` заменяется слитым содержимым своей секции.
awk -F'\t' '
  FNR == NR { c[$1] = c[$1] $2; next }
  FNR == 1 { next }
  { sub(/\r$/, "") }
  /^## / { sec = substr($0, 4); sub(/[ \t]+$/, "", sec) }
  { l = $0; gsub(/^[ \t]+|[ \t]+$/, "", l) }
  l == "<!-- части -->" {
    s = c[sec]; if (s == "") { print "—"; next }
    gsub(/\001/, "\n", s); sub(/\n+$/, "", s); print s; next
  }
  { print }
' "$TMP/merged" "$DIR/head.md" > "$OUT.tmp" || fail "каркас не собрался"

# Между блоками ### — пустая строка, как в шаблоне.
awk 'prev != "" && /^### / { print "" } { print; prev = $0 }' "$OUT.tmp" | cat -s > "$OUT"; rm -f "$OUT.tmp"

# 4. Опись: списки головы и частей подряд, итоги ⟹ суммируются по одинаковой форме строки. Строки
# «Бизнес-правил» (`состояние:`, `справочник:`, `сообщение:`, `ограничение:` с подстроками) — частей:
# по ним check.sh сверяет блоки головы; строки головы и её `⟹ состояний` в склеенную опись не идут.
# Строка правил, которую слово в слово повторила другая часть, — одна; подстроки повтора — под ней без
# повторов. Строки с разными значениями остаются обе: сверка берёт значения всех.
OF=""; [ -f "$DIR/head.opis.md" ] && OF="$DIR/head.opis.md"
# shellcheck disable=SC2086
awk '
  function rname(l) { gsub(/`/, "", l); gsub(/[ \t]+/, " ", l); sub(/ $/, "", l); return l }
  FNR == 1 { if (n > 0) out[++n] = ""; ishead = (FILENAME ~ /head\.opis\.md$/); cur = 0; dupr = 0; skip = 0; next }
  { sub(/\r$/, "") }
  /^⟹/ { if (!(ishead && $0 ~ /^⟹ состояний/)) tot[++nt] = $0; cur = 0; dupr = 0; next }
  ishead && /^(состояние|справочник|сообщение|ограничение):/ { skip = 1; next }
  skip && /^[ \t]/ { next }
  { skip = 0 }
  /^(состояние|справочник|сообщение|ограничение):/ {
    nm = rname($0)
    if (nm in first) { cur = first[nm]; dupr = 1; next }
    out[++n] = $0; first[nm] = n; bend[n] = n; cur = n; dupr = 0; next
  }
  /^[ \t]/ {
    if (dupr) { if (!((cur, $0) in hv)) { hv[cur, $0] = 1; addl[cur] = addl[cur] "\n" $0 }; next }
    out[++n] = $0; if (cur) { bend[cur] = n; hv[cur, $0] = 1 }; next
  }
  { cur = 0; dupr = 0; out[++n] = $0 }
  END {
    for (r in bend) after[bend[r]] = r
    for (i = 1; i <= n; i++) { print out[i]; if ((i in after) && addl[after[i]] != "") print substr(addl[after[i]], 2) }
    print ""
    for (i = 1; i <= nt; i++) {
      form = tot[i]; gsub(/[0-9]+/, "#", form); c = 0; line = tot[i]
      while (match(line, /[0-9]+/)) { c++; sum[form, c] += substr(line, RSTART, RLENGTH); line = substr(line, RSTART + RLENGTH) }
      if (!(form in seen)) { seen[form] = 1; order[++m] = form }
    }
    for (i = 1; i <= m; i++) { f = order[i]; s = ""; j = 0; rest = f
      while ((p = index(rest, "#")) > 0) { j++; s = s substr(rest, 1, p - 1) sum[f, j]; rest = substr(rest, p + 1) }
      print s rest }
  }
' $OF $POPIS > "$OPIS"

echo "собрано: $OUT"
awk '/^## /{s=$0} /^### /{n[s]++} END{for (k in n) printf "  %s — блоков %d\n", k, n[k]}' "$OUT" | sort
[ -s "$TMP/dups" ] && { echo "дубли ключей склеены:"; sed 's/^/  /' "$TMP/dups"; }
[ -s "$TMP/near" ] && { echo "из них один ключ вызовом и без скобок:"; sed 's/^/  /' "$TMP/near"; }
[ -s "$TMP/nokey" ] && { echo "ключ не опознан — заголовок не по ключу шаблона, оставлен как есть:"; sort -u "$TMP/nokey" | sed 's/^/  /'; }
[ -s "$TMP/tails" ] && echo "хвост « — файл» снят у строк фактов: $(wc -l < "$TMP/tails" | tr -d ' ') — источник ключа живёт в описи"
grep '^DROP	' "$TMP/unplaced" | while IFS="$(printf '\t')" read -r _ s w; do echo "отброшено: секция «$s» у частей $w — её пишет голова"; done
sort "$TMP/orph" | uniq -c | while read -r c rest; do p="${rest%%	*}"; s="${rest#*	}"
  if [ "$s" = "-" ]; then echo "отброшено: блоков $c у части $p — до заголовка секции, секция по ключу не определяется"
  else echo "без заголовка секции у части $p: блоки до первого заголовка — в «$s» по форме ключа"; fi
done
echo "опись: $OPIS ($(grep -c ' — ' "$OPIS") строк с источником)"
