#!/usr/bin/env bash
# Склейка блоков «Событий» строками-метками; «Зависит от» пишет голова; проверки формы «Событий» и
# «Зависит от» в check.py. Предметная область — условная обсерватория.
# Ждём: у дубля «публикует» владелец (часть 02 по плану) получает метки части 01, которых у него нет, его
# «тело: не определено» заменяется телом части 01, «гарантия» владельца остаётся; строки «Зависит от» частей
# отброшены (секцию пишет голова); хвост-файл у `доступ:` снят, `меняет: нет` в карточку не идёт.
# check.py: блок без меток «когда», «не шлётся» и задача без строки «наложение» — пункты «нет метки» автору
# блока; строка «Зависит от», чьё имя стоит в «Стеке», и нет строки `вход:` в описях — пункты «инфраструктура» и
# «нет строки вход», у нарезанного — голове. Режим `KEEP=1` — не удалять временную папку.
# Запуск из любого места: bash run.sh [папка reference скилла] — печатает ОК или что разошлось.
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/../sm-run.sh"   # скрипты скилла — через python (sm-run.sh)
REF="${1:-$HERE/../../../service-map/reference}"
OUT="$(mktemp -d)"; if [ -n "${KEEP:-}" ]; then echo "временная папка: $OUT"; else trap 'rm -rf "$OUT"' EXIT; fi
bad=0
in_file() { grep -q -F -- "$1" "$2" || { echo "нет строки ($(basename "$2")): $1"; bad=1; }; }

mkdir "$OUT/asm" && cp "$HERE/asm/"* "$OUT/asm/"
sm_run "$REF/assemble.py" "$OUT/asm" 2 2026-10-21 "$OUT/card.md" "$OUT/opis.md" > "$OUT/asm.log" 2>&1 || { cat "$OUT/asm.log"; exit 1; }
tr -d '\r' < "$OUT/asm.log" > "$OUT/asm.lf"
grep -q 'awk:' "$OUT/asm.lf" && { echo "ошибка awk в склейке:"; grep 'awk:' "$OUT/asm.lf"; bad=1; }
in_file 'События: публикует telescope.reservation.cancelled — блок части 02 (владелец по плану); новых строк-меток от 01 — строк 2; у 01 строк «- » отброшено 1' "$OUT/asm.lf"
in_file 'отброшено: секция «Зависит от» у частей 01, 02 — её пишет голова' "$OUT/asm.lf"
for l in '- тело: `ReservationCancelled`' '- ключ: `observerId`' '- гарантия: после коммита, через outbox' 'доступ: `NIGHT_OPERATOR`' '| `dome-control` | состояние купола |'; do
  grep -q -x -F -- "$l" "$OUT/card.md" || { echo "склейка: нет строки карточки: $l"; bad=1; }
done
grep -q -E '^(меняет|шлёт): нет|не определено: класс тела|отдельным вызовом|проверка купола в задаче' "$OUT/card.md" && { echo "склейка: лишняя строка в карточке"; bad=1; }

# check.py: «Стек» с хранилищем и та же база строкой «Зависит от».
awk '/^## Публичный контракт/ { print "## Стек\n| Слой | Чем |\n|---|---|\n| Хранилище | PostgreSQL |\n" } { print } /^\| `dome-control`/ { print "| `postgresql` | хранение броней |" }' "$OUT/card.md" > "$OUT/card.full.md"
sm_run "$REF/check.py" CHECK_LISTS="$OUT/dobor.md" "$OUT/opis.md" "$OUT/card.full.md" 2>&1 | tr -d '\r' > "$OUT/check1.lf"
grep -q 'awk:' "$OUT/check1.lf" && { echo "ошибка awk в check.py:"; grep 'awk:' "$OUT/check1.lf"; bad=1; }
in_file 'блоков «Событий» и задач без строк-меток: 2 — публикует telescope.reservation.cancelled — нет строк когда:, не шлётся:; OutboxJob — нет строк наложение:' "$OUT/check1.lf"
in_file '«Зависит от» — инфраструктура из «Стека»: 1 — postgresql — имя стоит в «Стеке»' "$OUT/check1.lf"
in_file 'ДОБОР читающий: 8 (нет метки 2, инфраструктура 1, нет строки вход 1, секции не по шаблону 4)' "$OUT/check1.lf"   # каркас без четырёх секций шаблона
in_file 'блок «Событий» или задачи без строки-метки' "$OUT/dobor.md"
# Нарезанный: метка — автору блока (блок «публикует» писали обе части), инфраструктура — голове.
sm_run "$REF/check.py" CHECK_PARTS="$OUT/asm" CHECK_PLAN="$OUT/asm/plan.tsv" CHECK_LISTS="$OUT/asm/dobor.md" "$OUT/opis.md" "$OUT/card.full.md" 2>&1 | tr -d '\r' > "$OUT/check2.lf"
in_file 'ДОБОР часть 01: 1 (нет метки 1)' "$OUT/check2.lf"
in_file 'ДОБОР часть 02: 2 (нет метки 2)' "$OUT/check2.lf"
in_file 'ДОБОР голова: 6 (инфраструктура 1, нет строки вход 1, секции не по шаблону 4)' "$OUT/check2.lf"
[ "$bad" -eq 0 ] && echo "ОК"
exit "$bad"
