#!/usr/bin/env bash
# Самотест clean.py (срез 2): уборка рабочих файлов прогона без субагента. Моделей не запускает.
# Ждём: у названных имён удалены `.work/<имя>.opis.md`, `.work/<имя>.md` и `.work/<имя>/` целиком; чужие файлы в
# `.work/` целы; ссылка (точка соединения Windows) внутри папки имени снята, а то, на что она указывала, цело;
# имя с `..` — отказ, код 2; повторный вызов — «removed 0», код 0; нет папки services — код 2.
#   bash run.sh [папка reference]   — печатает ОК или что разошлось
HERE="$(cd "$(dirname "$0")" && pwd)"
REF="${1:-$HERE/../../../service-map/reference}"
OUT="$(mktemp -d)"; trap 'rm -rf "$OUT"' EXIT
bad=0
say() { echo "$*"; bad=1; }
S="$OUT/сервисы с пробелом"; W="$S/.work"
mkdir -p "$W/svc-a/sub" "$W/svc-b" "$W/other" "$OUT/снаружи"
for f in "$W/svc-a.md" "$W/svc-a.opis.md" "$W/svc-a/part-01.md" "$W/svc-a/sub/x" "$W/svc-b.md" "$W/other.md" "$W/other/plan.tsv" "$OUT/снаружи/keep.txt"; do printf 'x\n' > "$f"; done
if command -v cygpath >/dev/null 2>&1; then
  MSYS2_ARG_CONV_EXCL='*' cmd /c mklink /J "$(cygpath -w "$W/svc-b/link")" "$(cygpath -w "$OUT/снаружи")" >/dev/null 2>&1
else ln -s "$OUT/снаружи" "$W/svc-b/link"; fi
out="$(python "$REF/clean.py" "$S" 'svc-a, `svc-b`')"; rc=$?
[ $rc -eq 0 ] || say "код $rc, ждали 0: $out"
printf '%s\n' "$out" | tail -1 | grep -q '^clean: removed 9, left 0$' || say "последняя строка: $(printf '%s\n' "$out" | tail -1)"
for p in "$W/svc-a.md" "$W/svc-a.opis.md" "$W/svc-a" "$W/svc-b.md" "$W/svc-b"; do [ -e "$p" ] && say "не удалено: $p"; done
for p in "$W/other.md" "$W/other/plan.tsv" "$OUT/снаружи/keep.txt"; do [ -f "$p" ] || say "удалено чужое: $p"; done
out="$(python "$REF/clean.py" "$S" svc-a)"; rc=$?
[ $rc -eq 0 ] && printf '%s\n' "$out" | grep -q '^clean: removed 0, left 0$' || say "повтор: код $rc, $out"
out="$(python "$REF/clean.py" "$S" '../other')"; rc=$?
[ $rc -eq 2 ] && printf '%s\n' "$out" | grep -q '^ОТКАЗ: имя' || say "имя с ..: код $rc, $out"
[ -f "$W/other.md" ] || say "имя с .. удалило чужое"
python "$REF/clean.py" "$OUT/нет такой" svc-a >/dev/null; [ $? -eq 2 ] || say "нет папки: код не 2"
[ "$bad" -eq 0 ] && echo "ОК"
exit "$bad"
