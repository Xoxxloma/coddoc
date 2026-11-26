#!/usr/bin/env bash
# topup-nb.sh — добор прогонов на снимке готового раунда: снимок скилла (`_skills/`) копируется в новую папку раунда,
# и `run-ctx-v2.sh` читает его, а не живой текст («снимок скилла уже есть — прогон читает ЕГО»). Прогоны прежнего раунда
# не перезаписываются: у добора своя папка.
#   ./topup-nb.sh <префикс исходного раунда> <префикс добора> <N> <пачка> <проба> [<проба> ...]
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$1"; DST="$2"; N="$3"; B="$4"; shift 4
cd "$HERE"
for p in "$@"; do
  [ -d "runs/$SRC-$p/_skills" ] || { echo "нет снимка: runs/$SRC-$p/_skills"; exit 1; }
  [ -e "runs/$DST-$p" ] && { echo "папка добора уже есть: runs/$DST-$p"; exit 1; }
  mkdir -p "runs/$DST-$p"
  cp -r "runs/$SRC-$p/_skills" "runs/$DST-$p/_skills"
  [ -f "runs/$SRC-$p/_commit.txt" ] && cp "runs/$SRC-$p/_commit.txt" "runs/$DST-$p/_commit.txt"
done
run_probe() { bash ./run-ctx-v2.sh "$1" "runs/$DST-$1" "$N" "$N" > "runs/$DST-$1.log" 2>&1; echo "готово: $1"; }
batch=()
for p in "$@"; do
  batch+=("$p")
  if [ "${#batch[@]}" -ge "$B" ]; then for q in "${batch[@]}"; do run_probe "$q" & done; wait; batch=(); fi
done
[ "${#batch[@]}" -gt 0 ] && { for q in "${batch[@]}"; do run_probe "$q" & done; wait; }
echo "ДОБОР $DST: готово"
