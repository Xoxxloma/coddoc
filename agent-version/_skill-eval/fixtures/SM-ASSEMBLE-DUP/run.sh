#!/usr/bin/env bash
# Склейка частей в assemble.py (предметная область — условная обсерватория). Части пишут один ключ
# по-разному (строка запроса, аргументы, хвост « — описание», слово и пометка в скобках вокруг топика в
# бэктиках) и одни и те же блоки дважды; plan.tsv отдаёт папки частям.
# Ждём: ключ по шаблону; дубль — блок владельца по плану (ручка части 01, сущности части 02), поля с новыми
# именами из других блоков дописаны (`domeId, note` у ShiftLogEntry), строки `— `
# других блоков дописаны, `- ` отброшены; владельца нет — объединение с причиной (файл у двух частей,
# файл вне частей плана; без plan.tsv — «плана нет»); топик без бэктиков с лишним словом — блок как есть
# и «ключ не опознан»; блок без дубля как есть. «Бизнес-правила» пишет голова: блок части отброшен; в описи
# строки правил частей (точный повтор — одной строкой, подстроки под ней), строк правил головы нет.
# Запуск из любого места: bash run.sh [папка reference скилла] — печатает ОК или что разошлось. Концы строк не сравниваются:
# git на Windows отдаёт эталон с CRLF.
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/../sm-run.sh"   # скрипты скилла — через python (sm-run.sh)
ASM="${1:-$HERE/../../../service-map-2.0/reference}/assemble.py"
OUT="$(mktemp -d)"; trap 'rm -rf "$OUT"' EXIT
sm_run "$ASM" "$HERE/parts" 2 2026-10-19 "$OUT/card.md" "$OUT/opis.md" > "$OUT/log" || { cat "$OUT/log"; exit 1; }
tr -d '\r' < "$OUT/log" > "$OUT/log.lf"
bad=0
want() { grep -q -F -- "$1" "$OUT/log.lf" || { echo "нет строки в выводе: $1"; bad=1; }; }
want 'отброшено: секция «Бизнес-правила» у частей 01 — её пишет голова'
want 'Публичный контракт: GET /api/nights/free-count — блок части 01 (владелец по плану); у 02 строк «- » отброшено 1'
want 'Владеет данными: Reservation — блок части 02 (владелец по плану); у 01 строк «- » отброшено 5'
want 'Владеет данными: ShiftLogEntry — блок части 02 (владелец по плану); новых полей от 01 — строк 1; у 01 строк «- » отброшено 0'
want 'Владеет данными: Telescope — блоки частей 01, 02 объединены, владельца нет: файл-источник вне частей плана'
want 'События: потребляет sky.cloud-alert — блоки частей 01, 02 объединены, владельца нет: файл-источник у нескольких частей'
want 'События: публикует на telescope.reservation.events (часть 02)'
diff <(tr -d '\r' < "$HERE/expect.md") "$OUT/card.md" || bad=1
diff <(tr -d '\r' < "$HERE/expect.opis.md") "$OUT/opis.md" || bad=1
# Спецификацию план не разметил (строк о ней нет): она справочник, операция — части с обработчиком (02).
mkdir "$OUT/nospec"; cp "$HERE/parts/"*.md "$OUT/nospec/"; tr -d '\r' < "$HERE/parts/plan.tsv" | grep -v 'openapi\.yaml' > "$OUT/nospec/plan.tsv"
sm_run "$ASM" "$OUT/nospec" 2 2026-10-19 "$OUT/card3.md" "$OUT/opis3.md" > "$OUT/log3" || { cat "$OUT/log3"; exit 1; }
grep -q -F 'Публичный контракт: GET /api/nights/free-count — блок части 02 (владелец по плану)' "$OUT/log3" \
  || { echo "спецификация не размечена: владелец операции не часть с обработчиком (02)"; grep 'free-count' "$OUT/log3"; bad=1; }
# Хвост « — <файл>» у строки факта (и « + <файл>») снимается, факт остаётся: карточка та же, что без хвостов.
mkdir "$OUT/tails"; cp "$HERE/parts/"*.md "$HERE/parts/plan.tsv" "$OUT/tails/"
sed -i -e 's/^- `mount`: `string`/& — src\/telescope\/Telescope.java/' -e 's/^- `operatorId`: `uuid`/& — `src\/log\/ShiftLogEntry.kt`/' \
  -e 's/^— запись с пометкой оператора не удаляется/& — src\/log\/ShiftLog.java + ShiftLogService.java/' "$OUT/tails/part-02.md"
sm_run "$ASM" "$OUT/tails" 2 2026-10-19 "$OUT/card4.md" "$OUT/opis4.md" > "$OUT/log4" || { cat "$OUT/log4"; exit 1; }
grep -q -F 'хвост « — файл» снят у строк фактов: 3' "$OUT/log4" || { echo "хвосты: нет строки о трёх снятых"; grep 'хвост' "$OUT/log4"; bad=1; }
diff <(tr -d '\r' < "$HERE/expect.md") "$OUT/card4.md" || { echo "хвосты: карточка отличается от карточки без хвостов"; bad=1; }
# Часть не написала заголовок секции: блоки до первого `## ` с ключом контракта по форме — в «Публичный
# контракт» (карточка та же), блок с ключом, по которому секцию не определить, — отброшен строкой вывода.
mkdir "$OUT/nosec"; cp "$HERE/parts/"*.md "$HERE/parts/plan.tsv" "$OUT/nosec/"
sed -i '2{/^## Публичный контракт/d}' "$OUT/nosec/part-02.md"
sm_run "$ASM" "$OUT/nosec" 2 2026-10-19 "$OUT/card5.md" "$OUT/opis5.md" > "$OUT/log5" || { cat "$OUT/log5"; exit 1; }
grep -q -F 'без заголовка секции у части 02: блоки до первого заголовка — в «Публичный контракт» по форме ключа' "$OUT/log5" \
  || { echo "без заголовка секции: нет строки о контракте"; bad=1; }
diff <(tr -d '\r' < "$HERE/expect.md") "$OUT/card5.md" || { echo "без заголовка секции: карточка отличается"; bad=1; }
sed -i '1a ### `Orphan`\nблок без секции' "$OUT/nosec/part-01.md"
sm_run "$ASM" "$OUT/nosec" 2 2026-10-19 "$OUT/card6.md" "$OUT/opis6.md" > "$OUT/log6" || { cat "$OUT/log6"; exit 1; }
grep -q -F 'отброшено: блоков 1 у части 01 — до заголовка секции, секция по ключу не определяется' "$OUT/log6" \
  || { echo "без заголовка секции: нет строки об отброшенном блоке"; bad=1; }
diff <(tr -d '\r' < "$HERE/expect.md") "$OUT/card6.md" || { echo "без заголовка секции: карточка с отброшенным блоком отличается"; bad=1; }
# Без заголовков двух секций подряд: секция — по ключу каждого блока, а не по первому: блок контракта — в
# «Публичный контракт», `потребляет` — в «События»; заголовок без ключа (`публикует на …`) — отброшен строкой.
mkdir "$OUT/nosec2"; cp "$HERE/parts/"*.md "$HERE/parts/plan.tsv" "$OUT/nosec2/"
sed -i '/^## Публичный контракт/d; /^## События/d' "$OUT/nosec2/part-02.md"
sm_run "$ASM" "$OUT/nosec2" 2 2026-10-19 "$OUT/card7.md" "$OUT/opis7.md" > "$OUT/log7" || { cat "$OUT/log7"; exit 1; }
grep -q -F 'без заголовка секции у части 02: блоки до первого заголовка — в «События» по форме ключа' "$OUT/log7" \
  || { echo "две секции без заголовка: нет строки о «Событиях»"; bad=1; }
grep -q -F 'отброшено: блоков 1 у части 02 — до заголовка секции, секция по ключу не определяется' "$OUT/log7" \
  || { echo "две секции без заголовка: нет строки об отброшенном блоке"; bad=1; }
awk '/^## /{ s = $0 } /^### потребляет `sky.cloud-alert`/{ print s }' "$OUT/card7.md" | grep -q -F '## События' \
  || { echo "две секции без заголовка: блок «потребляет» не в «Событиях»"; bad=1; }
# Без плана владельца нет ни у кого: все дубли — объединение «плана нет».
mkdir "$OUT/noplan"; cp "$HERE/parts/"*.md "$OUT/noplan/"
sm_run "$ASM" "$OUT/noplan" 2 2026-10-19 "$OUT/card2.md" "$OUT/opis2.md" > "$OUT/log2" || { cat "$OUT/log2"; exit 1; }
n=$(grep -c 'объединены, владельца нет: плана нет' "$OUT/log2")
[ "$n" -eq 5 ] || { echo "без плана: объединений «плана нет» $n, ждали 5"; bad=1; }
# Ключ сравнения (keys/): параметр пути в любой записи — один параметр (k_key); блоки разных частей сливаются при
# том же имени параметра (k_keyn). (а) `:id` части 01 и `{id}` части 02 — один блок; (б) `{ids}` и `{observerId}`
# разных частей — два блока и строка; (в) `{id}` и `:id` одной части — два блока и строка; (г) путь из конфига
# `{upload.s3.public_url}` и `{name}` — два блока без строки.
sm_run "$ASM" "$HERE/keys" 2 2026-10-19 "$OUT/card8.md" "$OUT/opis8.md" > "$OUT/log8" || { cat "$OUT/log8"; exit 1; }
tr -d '\r' < "$OUT/log8" > "$OUT/log8.lf"
want8() { grep -q -x -F -- "  $1" "$OUT/log8.lf" || { echo "ключи: нет строки в выводе: $1"; bad=1; }; }
blocks8() { local n; n=$(grep -c -F -- "### \`$1" "$OUT/card8.md"); [ "$n" -eq "$2" ] || { echo "ключи: блоков «$1» $n, ждали $2"; bad=1; }; }
blocks8 'GET /api/nights/' 1
grep -q -x -F '### `GET /api/nights/:id`' "$OUT/card8.md" || { echo "(а) заголовок — не ключ блока владельца (часть 01)"; bad=1; }
want8 'Публичный контракт: GET /api/nights/:id — блок части 01 (владелец по плану); у 02 строк «- » отброшено 1'
want8 'Публичный контракт: GET /api/nights/:id ~ GET /api/nights/{id}'
blocks8 'GET /api/observers/' 2
want8 'Публичный контракт: GET /api/observers/{ids} (часть 01), GET /api/observers/{observerId} (часть 02) — имена параметров разные'
blocks8 'DELETE /api/domes/' 2
want8 'Публичный контракт: DELETE /api/domes/:id (часть 01), DELETE /api/domes/{id} (часть 01) — у части 01 один путь записан разными ключами'
blocks8 'GET /files/' 2
grep -q -F '/files/' "$OUT/log8.lf" && { echo "(г) путь из конфига и параметр — строка в выводе склейки, а не должно быть"; bad=1; }

# (д) свежесть — по всем файлам сразу: у части 02 нет первой строки ни в черновике, ни в описи, у части 01 нет описи →
# один ОТКАЗ называет все три файла, код 3 (раньше — только первый, и вторая попытка чинила половину)
mkdir -p "$OUT/stale" && cp "$HERE/parts/"* "$OUT/stale/"
sed -i '1d' "$OUT/stale/part-02.md" "$OUT/stale/part-02.opis.md"; rm -f "$OUT/stale/part-01.opis.md"
sm_run "$ASM" "$OUT/stale" 2 2026-10-19 "$OUT/card9.md" "$OUT/opis9.md" > "$OUT/log9" 2>&1; rc9=$?
[ "$rc9" -eq 3 ] || { echo "(д) код $rc9, ждали 3"; bad=1; }
[ "$(grep -c '^ОТКАЗ:' "$OUT/log9")" -eq 1 ] || { echo "(д) строк ОТКАЗ не одна: $(cat "$OUT/log9")"; bad=1; }
for want in "нет файла $OUT/stale/part-01.opis.md" "$OUT/stale/part-02.md — первая строка не" "$OUT/stale/part-02.opis.md — первая строка не"; do
  grep -q -F -- "$want" "$OUT/log9" || { echo "(д) в ОТКАЗ нет: $want"; bad=1; }
done
[ "$bad" -eq 0 ] && echo "ОК"
exit "$bad"
