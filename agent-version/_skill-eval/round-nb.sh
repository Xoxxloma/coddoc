#!/usr/bin/env bash
# round-nb.sh — круг проб ноута: пробы пачками, у каждой своя папка раунда (снимок скилла — на раунд).
#   ./round-nb.sh <префикс раунда> <N> <пачка> <проба> [<проба> ...]
# Раунд пробы — runs/<префикс>-<проба>/, лог — runs/<префикс>-<проба>.log. В пачке — <пачка> проб
# одновременно, у пробы параллельность N.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PFX="$1"; N="$2"; B="$3"; shift 3
cd "$HERE"
run_probe() { bash ./run-ctx-v2.sh "$1" "runs/$PFX-$1" "$N" "$N" > "runs/$PFX-$1.log" 2>&1; echo "готово: $1"; }
batch=()
for p in "$@"; do
  batch+=("$p")
  if [ "${#batch[@]}" -ge "$B" ]; then
    for q in "${batch[@]}"; do run_probe "$q" & done; wait; batch=()
  fi
done
for q in "${batch[@]}"; do run_probe "$q" & done; wait
echo "КРУГ $PFX: готово"
