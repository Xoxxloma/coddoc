#!/usr/bin/env bash
# round-harden.sh — круг проб петли дискавери (PLAN-LOOP-HARDEN): пробы пачками, у каждой своя папка раунда.
#   ./round-harden.sh <префикс раунда> <N> <пачка> <проба> [<проба> ...]
# Раунд пробы — runs/<префикс>-<проба>/, лог — runs/<префикс>-<проба>.log. Цепочки (`loop-*`) — через run-chain.sh,
# остальные — через run-ctx-v2.sh. В пачке — <пачка> проб одновременно, у пробы параллельность N.
# Оценка — ./grade-loop.sh <префикс раунда> (раскладка та же: runs/<префикс>-<проба>/<проба>/).
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PFX="$1"; N="$2"; B="$3"; shift 3
cd "$HERE"
run_probe() {
  case "$1" in
    loop-*) bash ./run-chain.sh "$1" "runs/$PFX-$1" "$N" "$N" > "runs/$PFX-$1.log" 2>&1 ;;
    *)      bash ./run-ctx-v2.sh "$1" "runs/$PFX-$1" "$N" "$N" > "runs/$PFX-$1.log" 2>&1 ;;
  esac
  echo "готово: $1"
}
batch=()
for p in "$@"; do
  batch+=("$p")
  if [ "${#batch[@]}" -ge "$B" ]; then
    for q in "${batch[@]}"; do run_probe "$q" & done; wait; batch=()
  fi
done
for q in "${batch[@]}"; do run_probe "$q" & done; wait
echo "КРУГ $PFX: готово"
