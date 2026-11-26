#!/usr/bin/env bash
# seed-sb-ctx2.sh <плечо-ts-ctx> — кладёт в фикстуру SB-CTX2 спеку НОВОГО образца.
#
# Проба `sb-ctx2` меряет стык двух скиллов: пишущий завёл поле «Наша сторона», читает ли его
# разрез. Вход обязан быть тем, что первый скилл РЕАЛЬНО отдаёт второму, поэтому спека берётся
# из прогона, а не пишется руками.
#
# Берётся первый прогон плеча, у которого в спеке есть строка «Наша сторона»: если её нет ни в
# одном, проба бессмысленна — сначала чинится пишущий скилл.

set -u
ARM="${1:-}"
[ -d "$ARM" ] || { echo "usage: ./seed-sb-ctx2.sh <папка-плеча-ts-ctx>"; exit 1; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DST="$HERE/fixtures/SB-CTX2/coddoc/SMSEC-420"

PICK=""
for f in "$ARM"/run-*/coddoc/SMSEC-420/technical_specification.md; do
  [ -f "$f" ] || continue
  if grep -q "Наша сторона" "$f"; then PICK="$f"; break; fi
done

if [ -z "$PICK" ]; then
  echo "НИ В ОДНОЙ спеке плеча нет строки «Наша сторона» — фикстуру не обновляю."
  echo "Это сам по себе результат: правка шаблона не доехала до артефакта."
  exit 2
fi

cp "$PICK" "$DST/technical_specification.md"
echo "взята спека: $PICK"
grep -n "Наша сторона" "$DST/technical_specification.md" | head -5
# Манифест фикстуры пересобираем: состав изменился осознанно.
( cd "$HERE/fixtures/SB-CTX2" && find . -type f -not -name '_manifest.txt' | sed 's|^\./||' | sort ) \
  > "$HERE/fixtures/SB-CTX2/_manifest.txt"
echo "манифест SB-CTX2 обновлён"
