#!/usr/bin/env bash
# grade-loop.sh — оценка круга Среза 1 петли дискавери: каждая проба своим оценщиком.
#   ./grade-loop.sh <префикс раунда> [<проба> ...]     (без проб — все, у которых есть папка раунда)
# Раунд пробы — runs/<префикс>-<проба>/<проба>/ (раскладка round-nb.sh).
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PFX="$1"; shift
cd "$HERE"
probes=("$@")
if [ "${#probes[@]}" -eq 0 ]; then
  for d in runs/"$PFX"-*/; do p="${d%/}"; p="${p#runs/$PFX-}"; probes+=("$p"); done
fi
for p in "${probes[@]}"; do
  dir="runs/$PFX-$p/$p"
  [ -d "$dir" ] || { echo "== $p: нет $dir"; continue; }
  case "$p" in
    meet-*)  fx="$(echo "${p#meet-}" | tr a-z A-Z)"; cmd=(node grade-meet.mjs "$dir" --points --fx "$fx") ;;
    ni-*)    fx="$(echo "${p#ni-}" | tr a-z A-Z)"; cmd=(node grade-ni.mjs "$dir" --fx "$fx") ;;
    rec-*)   fx="$(echo "${p#rec-}" | tr a-z A-Z)"; cmd=(node grade-recall.mjs "$dir" --fx "$fx") ;;
    nb-*)    fx="$(echo "${p#nb-}" | tr a-z A-Z)"; cmd=(node grade-nb.mjs "$dir" --fx "$fx") ;;
    # Цепочки (`run-chain.sh`): раскладка `runs/<префикс>-<проба>/<проба>/run-<i>/stage-<k>/`.
    loop-*)  fx="$(echo "${p#loop-}" | tr a-z A-Z)"; cmd=(node grade-chain.mjs "$dir" --fx "$fx") ;;
    *) echo "== $p: нет оценщика"; continue ;;
  esac
  echo "================ $p (${cmd[*]})"
  "${cmd[@]}" 2>&1
done
