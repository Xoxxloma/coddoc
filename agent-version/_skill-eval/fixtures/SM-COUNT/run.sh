#!/usr/bin/env bash
# SM-COUNT — count.py (счёт по строкам разведчика вместо субагента-счётчика). Моделей не запускает.
#   bash run.sh [папка reference скилла] — печатает строки случаев и ИТОГ; код 1, если что-то разошлось.
# 1) Регресс: cases/<случай>/scout.txt — строки разведчика из прогонов runs/ (корень дерева — {ROOT}), case.txt —
#    дерево, итог счётчика тех прогонов по классам, прогоны; «известно:» — счётчик ошибся или строка не по форме
#    (расхождение печатается, но не красное). Деревья — как у run-sm-mono.sh: SM-GAPS из фикстуры, Apollo, listmonk,
#    vikunja — клоны (SM_APOLLO_SRC, SM_LISTMONK_SRC, SM_VIKUNJA_SRC); нет дерева — «не измерено».
#    Случаи собирает make-cases.py из песочниц прогонов (их в git нет).
# 2) Корень под скрытой папкой (`.claude/…`): тот же счёт, что у дерева на месте.
# 3) Ветки на синтетике: повтор без маски и переэкранирование, отказ, строка не по форме (файл на месте регэкспа) и
#    «нижняя граница неполна» в итоге, строка спеки, пропуски (скрытое, node_modules,
#    build в корне, бинарный файл), многострочная аннотация, «не прочитано», findings.tsv, plan.py принимает счёт.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
F="$(cd "$HERE/.." && pwd)"
REF="${1:-$HERE/../../../service-map-2.0/reference}"; REF="$(cd "$REF" && pwd)"
winp() { cygpath -m "$1" 2>/dev/null || printf '%s' "$1"; }
PY="${SM_PY:-python}"; command -v "$PY" > /dev/null 2>&1 || PY=python3
COUNT="$(winp "$REF/count.py")"; PLAN="$(winp "$REF/plan.py")"
OUT="$(mktemp -d "${TMPDIR:-/tmp}/sm-count.XXXXXX")"; [ -n "${KEEP:-}" ] && echo "временная папка: $OUT" || trap 'rm -rf "$OUT"' EXIT
pyrun() { MSYS2_ARG_CONV_EXCL='*' MSYS_NO_PATHCONV=1 PYTHONIOENCODING=utf-8 "$PY" "$@"; }
ok=0; known=0; bad=0; skip=0

tree() {  # имя дерева из case.txt → путь
  case "$1" in
    SM-GAPS/*) printf '%s' "$F/$1" ;;
    apollo/*) printf '%s' "${SM_APOLLO_SRC:-/c/Users/Konstantin/projects/apollo}/${1#apollo/}" ;;
    listmonk) printf '%s' "${SM_LISTMONK_SRC:-/c/Users/Konstantin/projects/listmonk}" ;;
    vikunja-frontend) printf '%s' "${SM_VIKUNJA_SRC:-/c/Users/Konstantin/projects/vikunja-frontend}" ;;
  esac
}
norm() { tr ',' '\n' | sed 's/^ *//; s/ *$//' | grep -v '^$' | LC_ALL=C sort | tr '\n' ',' ; }
field() { sed -n "s/^$1: //p" "$2" | head -1; }
# check <имя> <scout с {ROOT}> <корень> <ожидаемый итог> [<известно>]
check() {
  local name="$1" scout="$2" root="$3" want="$4" why="${5:-}" w d got
  w="$(winp "$root")"; d="$OUT/$name"; mkdir -p "$d"
  while IFS= read -r l || [ -n "$l" ]; do printf '%s\n' "${l//\{ROOT\}/$w}"; done < "$scout" > "$d/scout.txt"
  pyrun "$COUNT" "$(winp "$d/scout.txt")" "$w" "$(winp "$d/counts.txt")" > "$d/out" 2>&1
  got="$(sed -n '1s/.*; итог: //p' "$d/out" | tr -d '\r')"
  if [ "$(printf '%s' "$got" | norm)" = "$(printf '%s' "$want" | norm)" ]; then ok=$((ok+1)); echo "ОК $name: $got"
  elif [ -n "$why" ]; then known=$((known+1)); echo "известно $name: count.py «$got», счётчик «$want» — $why"
  else bad=$((bad+1)); echo "РАЗОШЛОСЬ $name: count.py «$got», ждали «$want»"; sed -n '2,$p' "$d/out" | sed 's/^/    /'; fi
}

# ─── 1) регресс по прогонам ───
for c in "$HERE"/cases/*/; do
  name="$(basename "$c")"; t="$(field дерево "$c/case.txt")"; root="$(tree "$t")"
  if [ -z "$root" ] || [ ! -d "$root" ]; then skip=$((skip+1)); echo "не измерено $name: нет дерева $t"; continue; fi
  check "$name" "$c/scout.txt" "$root" "$(field итог "$c/case.txt")" "$(field известно "$c/case.txt")"
  w="$(winp "$root")"
  while IFS= read -r l; do  # строки, которые count.py обязан напечатать
    l="${l//\{ROOT\}/$w}"
    grep -q -x -F -- "$l" "$OUT/$name/out" || { bad=$((bad+1)); echo "РАЗОШЛОСЬ $name: нет строки «$l»"; }
  done < <(sed -n 's/^строка: //p' "$c/case.txt")
done

# ─── 2) корень под скрытой папкой ───
c="$(grep -l '^дерево: SM-GAPS/node/parcel-hub' "$HERE"/cases/*/case.txt | head -1)"; c="$(dirname "$c")"
H="$OUT/.claude/w"; mkdir -p "$H"; cp -r "$F/SM-GAPS/node/parcel-hub" "$H/"
check "скрытый-корень" "$c/scout.txt" "$H/parcel-hub" "$(field итог "$c/case.txt")"

# ─── 3) ветки на синтетике ───
S="$OUT/syn/svc"; mkdir -p "$S/src" "$S/sub/build" "$S/build" "$S/.hidden" "$S/node_modules/x" "$S/api"
printf 'class A {\n  @GetMapping("/a")\n  @GetMapping\n  @PostMapping(\n    value = "/b")\n  @Table\n}\n' > "$S/src/A.java"
printf 'class B { @GetMapping fun b() }\n' > "$S/src/B.kt"
printf '@GetMapping\n' > "$S/sub/build/F.java"
for f in "$S/build/E.java" "$S/.hidden/C.java" "$S/node_modules/x/D.java" "$S/src/.H.java"; do printf '@GetMapping\n' > "$f"; done
printf '@GetMapping\n\000\n' > "$S/src/G.java"
printf '\357\273\277  operationId: one\r\n  operationId: two\r\n  operationId: three\r\n' > "$S/api/api.yaml"
cat > "$OUT/syn/scout.txt" <<'EOF'
контракт :: @GetMapping\b :: *.java :: ключ
контракт :: @GetMapping\b :: *.ts :: ключ
сущности :: @\(Entity\|Table\)\b :: *.java :: ключ
задачи :: @Scheduled( :: *.java :: ключ
контракт :: ^\s+operationId: :: *.yaml :: {ROOT}/api/api.yaml :: ключ
контракт :: ^\s+operationId: :: *.yaml :: {ROOT}/api/нет.yaml :: ключ
контракт :: @PostMapping\([^"] :: *.java :: ориентир
контракт :: @PostMapping\b :: *.java :: в файлах с class\s+A\b :: ключ
контракт :: {ROOT}/api/api.yaml :: ^\s+operationId: :: *.yaml :: ключ
контроль :: контракт :: {ROOT}/src/A.java :: 2
клиентская спека :: {ROOT}/api/client.yaml
конфиг топиков :: {ROOT}/application.yml
префикс :: /api :: {ROOT}/src/A.java
EOF
check "синтетика" "$OUT/syn/scout.txt" "$S" \
  "контракт 11 (нижняя граница неполна), сущности 1 (нижняя граница неполна), задачи 0 (нижняя граница неполна)"
d="$OUT/синтетика"; W="$(winp "$S")"
want() { grep -q -x -F -- "$1" "$2" || { bad=$((bad+1)); echo "РАЗОШЛОСЬ синтетика: нет строки «$1» в $(basename "$2")"; }; }
want "## контракт :: @GetMapping\b :: *.java :: ключ" "$d/counts.txt"
want "$W/src/A.java:2" "$d/counts.txt"
want "$W/sub/build/F.java:1" "$d/counts.txt"
want "## контракт :: @GetMapping\b :: *.ts :: ключ (без маски)" "$d/counts.txt"
want "$W/src/B.kt:1" "$d/counts.txt"
want "## сущности :: @\(Entity\|Table\)\b :: *.java :: ключ (переэкранирован)" "$d/counts.txt"
want "## задачи :: @Scheduled( :: *.java :: ключ (отказ)" "$d/counts.txt"
want "$W/api/api.yaml:3" "$d/counts.txt"
want "## контроль :: контракт :: $W/src/A.java :: 2" "$d/counts.txt"
want "## клиентская спека :: $W/api/client.yaml" "$d/counts.txt"
want "## конфиг топиков :: $W/application.yml" "$d/counts.txt"
want "контракт	ключ	$W/src/A.java	2	@GetMapping(\"/a\")" "$d/findings.tsv"
want "контракт	ключ	$W/api/api.yaml	1	operationId: one" "$d/findings.tsv"
want "многострочная аннотация не поймана: контракт 1 (первая: $W/src/A.java:4)" "$d/out"
want "не прочитано 1: $W/api/нет.yaml" "$d/out"
want "## контракт :: $W/api/api.yaml :: ^\s+operationId: :: *.yaml :: ключ (не по форме)" "$d/counts.txt"
want "строка разведчика не по форме, на месте регэкспа файл: контракт :: $W/api/api.yaml :: ^\s+operationId: :: *.yaml :: ключ" "$d/out"
want "маска разведчика не сработала: контракт :: @GetMapping\b :: *.ts :: ключ" "$d/out"
want "регэксп разведчика переэкранирован: сущности :: @\(Entity\|Table\)\b :: *.java :: ключ" "$d/out"
want "греп отказал: задачи :: @Scheduled( :: *.java :: ключ" "$d/out"
for x in E.java C.java D.java .H.java G.java префикс; do
  grep -q -F -- "$x" "$d/counts.txt" && { bad=$((bad+1)); echo "РАЗОШЛОСЬ синтетика: лишнее в счёте — $x"; }
done
pyrun "$PLAN" "$(winp "$d/counts.txt")" 30 1 "$W" "$(winp "$d/plan.tsv")" backend > "$d/plan.out" 2>&1
want "итог по классам: контракт 11, сущности 1" "$d/plan.out"

echo "ИТОГ SM-COUNT: совпало $ok; известно $known; РАЗОШЛОСЬ $bad; не измерено $skip"
[ "$bad" -eq 0 ]
