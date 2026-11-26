#!/usr/bin/env bash
# Самотест исхода непройденного гейта (срез 3, F15): один исход для сервиса без нарезки и нарезанного —
# кандидат в `services/_pending/<имя>.md`, рядом `<имя>.check.txt`, прежняя карточка не тронута.
# Моделей не запускает. Скрипты — командами SKILL.md, из корня репозитория со спеками (пути `services/…`):
#   (one) без нарезки (3.4): читающий записал `.work/<имя>.opis.md` и `.work/<имя>.md`; check.py без CHECK_PARTS
#     (CHECK_PLAN, прежняя карточка, --out в .work) → promote.py в _pending → check.py с --out в _pending;
#   (split) нарезанный (3.5): assemble.py → check.py с CHECK_PARTS → promote.py в _pending → check.py с --out в _pending.
# Входы: (one) черновик и опись одиночного (one/), план без частей, пометок контракта 10 при двух ключах; (split) части
# 01, 02 и голова (SM-ASSEMBLE-SLOTS/asm), недобор по сервису и по части 01. У обоих есть прежняя карточка.
# Ждём у обоих: коды выхода check/promote/check 0/0/0 (у нарезанного и склейки — 0), ИСХОД «гейт не пройден — маркеры:
# …», «КОПИЯ ВЕРНА», кандидат = черновик байт в байт, вывод сверки рядом с тем же ИСХОД, прежняя карточка байт в байт та
# же; набор файлов слепка в services/ — один и тот же по форме.
#   bash run.sh [папка reference скилла] — печатает ОК или что разошлось. KEEP=1 — не удалять временную папку.
HERE="$(cd "$(dirname "$0")" && pwd)"
REF="$(cd "${1:-$HERE/../../../service-map-2.0/reference}" && pwd)"
PY="${SM_PY:-python}"
OUT="$(mktemp -d)"; if [ -n "${KEEP:-}" ]; then echo "временная папка: $OUT"; else trap 'rm -rf "$OUT"' EXIT; fi
bad=0
say() { echo "$*"; bad=1; }

# box <вариант> <имя> — песочница: манифест и прежняя карточка
box() {
  local b="$OUT/$1" name="$2"
  mkdir -p "$b/services/.work/$name"
  printf 'services:\n  - name: %s\n    path: ../%s\n    type: backend\n' "$name" "$name" > "$b/services/manifest.yaml"
  printf -- '---\nservice: %s\ntype: backend\nscanned: 2026-10-01\n---\n# %s — backend\n\n## Публичный контракт\n\n### `GET /api/old`\n- прежний факт\n' "$name" "$name" > "$b/services/$name.md"
  md5sum < "$b/services/$name.md" > "$b/prev.md5"
}

# outcome <вариант> <имя> — check1 → promote в _pending → check с выводом в _pending; проверки исхода
outcome() {
  local v="$1" name="$2" b="$OUT/$1" rcs="" r; shift 2   # дальше — переменные check.py (ИМЯ=значение)
  (
    cd "$b" || exit 9
    "$PY" "$REF/check.py" "$@" "services/.work/$name.opis.md" "services/.work/$name.md" "services/$name.md" \
      --out "services/.work/$name/check1.txt" > chk1.log 2>&1; echo $? > rc2
    "$PY" "$REF/promote.py" "services/.work/$name.md" "services/_pending/$name.md" > promote.log 2>&1; echo $? > rc3
    "$PY" "$REF/check.py" "$@" "services/.work/$name.opis.md" "services/.work/$name.md" "services/$name.md" \
      --out "services/_pending/$name.check.txt" > chk2.log 2>&1; echo $? > rc4
  )
  for r in 2 3 4; do rcs="$rcs$(cat "$b/rc$r")"; done
  echo "$rcs" > "$b/rcs"
  [ "$rcs" = 000 ] || { say "$v: коды выхода check/promote/check $rcs, ждали 000"; cat "$b/chk1.log" "$b/promote.log" "$b/chk2.log"; }
  grep '^ИСХОД: ' "$b/services/.work/$name/check1.txt" 2>/dev/null | tr -d '\r' > "$b/outcome"
  grep -q '^ИСХОД: гейт не пройден — маркеры: ' "$b/outcome" || say "$v: ИСХОД — «$(cat "$b/outcome")», ждали «гейт не пройден — маркеры: …»"
  grep -q 'КОПИЯ ВЕРНА' "$b/promote.log" || say "$v: продвижение — $(tr -d '\r' < "$b/promote.log" | tail -1)"
  [ -f "$b/services/_pending/$name.md" ] || say "$v: нет services/_pending/$name.md"
  [ -f "$b/services/_pending/$name.check.txt" ] || say "$v: нет services/_pending/$name.check.txt"
  cmp -s "$b/services/.work/$name.md" "$b/services/_pending/$name.md" || say "$v: кандидат не равен черновику"
  diff <(cat "$b/outcome") <(grep '^ИСХОД: ' "$b/services/_pending/$name.check.txt" | tr -d '\r') >/dev/null \
    || say "$v: ИСХОД в .check.txt не тот, что на Шаге 4"
  md5sum < "$b/services/$name.md" | cmp -s - "$b/prev.md5" || say "$v: прежняя карточка изменилась"
  ( cd "$b/services" && find . -path ./.work -prune -o -type f -print | sed "s/$name/<имя>/g" | sort ) > "$b/files"
}

# (one) без нарезки: файлы читающего — прямо в .work, план без частей.
n=dome-control; w="$OUT/one/services/.work"
box one "$n"
cp "$HERE/one/draft.md" "$w/$n.md"; cp "$HERE/one/opis.md" "$w/$n.opis.md"
{ tr -d '\r' < "$HERE/one/plan.tsv"; printf 'итог\tконтракт\t8\n'; } > "$w/$n/plan.tsv"
outcome one "$n" CHECK_PLAN="services/.work/$n/plan.tsv" CHECK_LISTS="services/.work/$n/dobor.md"
grep -q -F 'ДОБОР часть' "$w/$n/check1.txt" && say "one: перечень добора по частям у сервиса без нарезки"

# (split) нарезанный: части и голова, склейка, check.py с папкой частей.
n=telescope-api; w="$OUT/split/services/.work"
box split "$n"
cp "$HERE/../SM-ASSEMBLE-SLOTS/asm/"*.md "$w/$n/"
{ tr -d '\r' < "$HERE/../SM-ASSEMBLE-SLOTS/asm/plan.tsv"; printf 'итог\tконтракт\t10\nчасть\t01\tконтракт\t5\n'; } > "$w/$n/plan.tsv"
( cd "$OUT/split" && "$PY" "$REF/assemble.py" "services/.work/$n" 2 2026-10-21 "services/.work/$n.md" "services/.work/$n.opis.md" > asm.log 2>&1 ) \
  || { say "split: склейка — код $?"; cat "$OUT/split/asm.log"; }
outcome split "$n" CHECK_PLAN="services/.work/$n/plan.tsv" CHECK_PARTS="services/.work/$n" CHECK_LISTS="services/.work/$n/dobor.md"
grep -q 'часть 01, контракт 1 из 5' "$OUT/split/outcome" || say "split: в ИСХОД нет недобора части 01: $(cat "$OUT/split/outcome")"

# Как у нарезанного: те же коды, та же форма строки ИСХОД, тот же набор файлов слепка.
cmp -s "$OUT/one/rcs" "$OUT/split/rcs" || say "коды выхода: без нарезки $(cat "$OUT/one/rcs"), нарезанный $(cat "$OUT/split/rcs")"
diff "$OUT/one/files" "$OUT/split/files" > /dev/null || { say "файлы слепка расходятся:"; diff "$OUT/one/files" "$OUT/split/files"; }

[ "$bad" -eq 0 ] && echo "ОК"
exit "$bad"
