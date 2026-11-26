#!/usr/bin/env bash
# Независимые тесты check.py скилла service-map-2.0. Моделей не запускает, пишет только во временную папку.
#   bash test-check.py [путь к check.py]
# По умолчанию — agent-version/service-map-2.0/reference/check.py. Нужны bash и node.
# Фазы: 1) оракул (oracle.mjs) против expect.json на синтетике cases/*; 2) скрипт против expect.json;
# 3) скрипт против оракула на настоящих файлах из real-cases.txt. Плюс время на самом крупном входе.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EVAL="$(cd "$HERE/../.." && pwd)"
. "$HERE/../sm-run.sh"   # скрипты скилла — через python (sm-run.sh)
CHECK="${1:-$EVAL/../service-map-2.0/reference/check.py}"
[ -f "$CHECK" ] || { echo "нет check.py: $CHECK" >&2; exit 2; }
command -v node >/dev/null 2>&1 || { echo "нужен node" >&2; exit 2; }

OUT="$(mktemp -d "${TMPDIR:-/tmp}/sm-check.XXXXXX")"
trap 'rm -rf "$OUT"' EXIT

now_ms() {
  local t
  t=$(date +%s%N 2>/dev/null)
  case "$t" in *N|'') echo $(( $(date +%s) * 1000 )) ;; *) echo $(( t / 1000000 )) ;; esac
}

# run <имя> <опись> <черновик> [<прежняя>]; переменные окружения случая — в RUN_ENV
RUN_ENV=()
run() {
  local name="$1"; shift
  local t0 t1
  t0=$(now_ms)
  sm_run "$CHECK" ${RUN_ENV[@]+"${RUN_ENV[@]}"} "$@" >"$OUT/$name.out" 2>"$OUT/$name.err"
  echo $? >"$OUT/$name.rc"
  t1=$(now_ms)
  echo $(( t1 - t0 )) >"$OUT/$name.ms"
}

echo "check.py: $CHECK"

for d in "$HERE"/cases/*/; do
  d="${d%/}"
  name="$(basename "$d")"
  [ -f "$d/expect.json" ] || continue
  # черновик — draft.md случая или .work/draft.md (манифест ищется в ../ и ./ от папки черновика)
  draft="$d/draft.md"; [ -f "$d/.work/draft.md" ] && draft="$d/.work/draft.md"
  # env случая — строки ИМЯ=значение; CHECK_PLAN и CHECK_PARTS — пути от папки случая
  RUN_ENV=()
  if [ -f "$d/env" ]; then
    while IFS='=' read -r k v || [ -n "$k" ]; do
      k="${k%$'\r'}"; v="${v%$'\r'}"; [ -n "$k" ] || continue
      case "$k" in CHECK_PLAN|CHECK_PARTS) v="$d/$v" ;; esac
      RUN_ENV+=("$k=$v")
    done < "$d/env"
  fi
  RUN_ENV+=("CHECK_LISTS=$OUT/$name.list.md")
  if [ -f "$d/prev.md" ]; then run "$name" "$d/opis.md" "$draft" "$d/prev.md"
  else run "$name" "$d/opis.md" "$draft"; fi
done
RUN_ENV=()

big_name=''; big_bytes=0; big_args=()
while IFS='|' read -r name opis draft prev; do
  name="${name%$'\r'}"; prev="${prev%$'\r'}"
  case "$name" in ''|'#'*) continue ;; esac
  args=("$EVAL/$opis" "$EVAL/$draft")
  [ -n "$prev" ] && args+=("$EVAL/$prev")
  run "$name" "${args[@]}"
  bytes=0
  for f in "${args[@]}"; do bytes=$(( bytes + $(wc -c <"$f") )); done
  if [ "$bytes" -gt "$big_bytes" ]; then big_bytes=$bytes; big_name=$name; big_args=("${args[@]}"); fi
done <"$HERE/real-cases.txt"

# время на самом крупном входе: три отдельных прогона
if [ -n "$big_name" ]; then
  times=()
  for _ in 1 2 3; do
    t0=$(now_ms); sm_run "$CHECK" "${big_args[@]}" >/dev/null 2>&1; t1=$(now_ms)
    times+=("$(( t1 - t0 ))")
  done
  (IFS='|'; echo "$big_name|$big_bytes|${times[*]}") >"$OUT/_big.txt"
fi

node "$HERE/compare.mjs" "$HERE" "$OUT" "$EVAL"
