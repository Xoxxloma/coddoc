#!/usr/bin/env bash
# Независимые тесты edges.py (Шаг 5 service-map-2.0). Моделей не запускает.
# edges.py ПРАВИТ карточки на месте — поэтому каждый случай гоняется на копии во временной папке,
# фикстуры и настоящий слепок не трогаются.
#   bash test-edges.py [путь к edges.py]
# По умолчанию — agent-version/service-map/reference/edges.py. Нужны bash и node.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EVAL="$(cd "$HERE/../.." && pwd)"
. "$HERE/../sm-run.sh"   # скрипты скилла — через python (sm-run.sh)
EDGES="${1:-$EVAL/../service-map/reference/edges.py}"
[ -f "$EDGES" ] || { echo "нет edges.py: $EDGES" >&2; exit 2; }
command -v node >/dev/null 2>&1 || { echo "нужен node" >&2; exit 2; }

OUT="$(mktemp -d "${TMPDIR:-/tmp}/sm-edges.XXXXXX")"
trap 'rm -rf "$OUT"' EXIT

now_ms() {
  local t
  t=$(date +%s%N 2>/dev/null)
  case "$t" in *N|'') echo $(( $(date +%s) * 1000 )) ;; *) echo $(( t / 1000000 )) ;; esac
}

# run_case <папка случая> <имя>: копия → edges.py <копия>/services <манифест копии>
run_case() {
  local src="$1" name="$2" man t0 t1
  mkdir -p "$OUT/$name"
  cp -R "$src/." "$OUT/$name/"
  man="$OUT/$name/services/manifest.yaml"
  [ -f "$OUT/$name/manifest.yaml" ] && man="$OUT/$name/manifest.yaml"
  local extra=()
  [ -f "$src/args.txt" ] && read -r -a extra < "$src/args.txt"   # например «--only web»
  t0=$(now_ms)
  sm_run "$EDGES" "$OUT/$name/services" "$man" ${extra[@]+"${extra[@]}"} >"$OUT/$name.out" 2>"$OUT/$name.err"
  echo $? >"$OUT/$name.rc"
  t1=$(now_ms)
  echo $(( t1 - t0 )) >"$OUT/$name.ms"
}

echo "edges.py: $EDGES"
for d in "$HERE"/cases/*/; do
  d="${d%/}"
  [ -f "$d/expect.json" ] && run_case "$d" "$(basename "$d")"
done
for d in "$HERE"/real/*/; do
  d="${d%/}"
  [ -d "$d/services" ] && run_case "$d" "real-$(basename "$d")"
done

node "$HERE/compare.mjs" "$HERE" "$OUT"
