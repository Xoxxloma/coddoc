#!/usr/bin/env bash
# sandbox.sh <куда> — песочница пробы sm-scout: четыре дерева сервисов, общие на весь раунд.
#
#   <куда>/NRS-TAIL/cargonet/          ← make.sh NRS-TAIL (заново, не из out/ — тот мог устареть)
#   <куда>/SM-MONO-DGS/casedesk/       ← make.sh SM-MONO-DGS
#   <куда>/SM-MONO-DGS-MIX/casedesk/   ← DGS_MIX=1 make.sh SM-MONO-DGS (часть аннотаций DGS со скобками)
#   <куда>/repairy-api/repairy-api/    ← SM-REAL/seed.sh из настоящей репы repairy
#   <куда>/resonance-api/resonance-api/← SM-REAL/seed.sh из настоящей репы resonance
#   <куда>/_built.txt                  ← когда, из каких коммитов, сколько файлов
#
# Почему одна песочница на раунд, а не копия на прогон: у разведчика только Read/Grep/Glob —
# писать ему нечем, дерево по построению только читается. Общая копия даёт главное: грейдер
# грепает РОВНО то дерево, которое видел разведчик, и настоящие репы не уезжают между прогонами.
# Раннер снимает отпечаток песочницы до и после пула — если она всё же изменилась, это видно.
#
# Повторный вызов на собранной песочнице ничего не делает (`_built.txt` есть). Пересобрать — удалить папку.
# Правда (truth.json, expected.md) в песочницу не едет.
set -u
DEST="${1:?куда}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIXDIR="$(cd "$HERE/.." && pwd)"

if [ -f "$DEST/_built.txt" ]; then echo "песочница уже собрана: $DEST"; exit 0; fi
rm -rf "$DEST"; mkdir -p "$DEST/NRS-TAIL" "$DEST/SM-MONO-DGS" "$DEST/SM-MONO-DGS-MIX" "$DEST/repairy-api" "$DEST/resonance-api"

bash "$FIXDIR/NRS-TAIL/make.sh" "$DEST/_gen-nrs" > /dev/null || { echo "NRS-TAIL не собралась"; exit 1; }
mv "$DEST/_gen-nrs/cargonet" "$DEST/NRS-TAIL/cargonet"; rm -rf "$DEST/_gen-nrs"

bash "$FIXDIR/SM-MONO-DGS/make.sh" "$DEST/_gen-dgs" > /dev/null || { echo "SM-MONO-DGS не собралась"; exit 1; }
mv "$DEST/_gen-dgs/casedesk" "$DEST/SM-MONO-DGS/casedesk"; rm -rf "$DEST/_gen-dgs"

DGS_MIX=1 bash "$FIXDIR/SM-MONO-DGS/make.sh" "$DEST/_gen-dgsmix" > /dev/null || { echo "SM-MONO-DGS-MIX не собралась"; exit 1; }
mv "$DEST/_gen-dgsmix/casedesk" "$DEST/SM-MONO-DGS-MIX/casedesk"; rm -rf "$DEST/_gen-dgsmix"

bash "$FIXDIR/SM-REAL/seed.sh" "$DEST/_gen-real" scan > /dev/null || { echo "SM-REAL не засеялась"; exit 1; }
mv "$DEST/_gen-real/repairy-api"   "$DEST/repairy-api/repairy-api"
mv "$DEST/_gen-real/resonance-api" "$DEST/resonance-api/resonance-api"
rm -rf "$DEST/_gen-real"

SRC="${SM_REAL_SRC:-/c/Users/Konstantin/projects}"
{
  echo "собрана: $(date '+%Y-%m-%d %H:%M')"
  echo "repairy:   $(git -C "$SRC/repairy" rev-parse HEAD 2>/dev/null || echo 'нет git')"
  echo "resonance: $(git -C "$SRC/resonance" rev-parse HEAD 2>/dev/null || echo 'нет git')"
  for t in NRS-TAIL/cargonet SM-MONO-DGS/casedesk SM-MONO-DGS-MIX/casedesk repairy-api/repairy-api resonance-api/resonance-api; do
    printf '%-30s %5s файлов\n' "$t" "$(find "$DEST/$t" -type f -not -path '*/.git/*' | wc -l | tr -d ' ')"
  done
} > "$DEST/_built.txt"
cat "$DEST/_built.txt"
