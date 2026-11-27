#!/usr/bin/env bash
# edges.sh — Шаг 5 без модели: обратные рёбра слепка.
#
#   bash edges.sh <папка services> <manifest.yaml>
#
# Источники — карточки `services/<name>.md`, у которых есть строка в манифесте (`_pending/` не
# смотрится вовсе): строки их «Потребляемые API» (| сервис | вызов | зачем |) и «Зависит от»
# (| сервис | зачем |). Зеркало — копия строки с заменой первой колонки на имя источника:
#   потребляемый вызов → | `<источник>` | <вызов> | <зачем> |
#   зависимость        → | `<источник>` | — | <зачем> |
# Цель — сервис из первой колонки, если у него есть карточка слепка; иначе строка пропускается
# (внешняя система, сосед вне манифеста). Секция «Кто меня потребляет» каждой карточки слепка
# пересобирается целиком: заголовок таблицы, разделитель, зеркала по возрастанию (источник, вызов);
# зеркал нет — пустая форма `| — | | |`. `\|` внутри ячейки — часть ячейки. Остальные строки файла —
# байт в байт. Пишет только эти секции; печатает итог по карточкам.
#
#   bash edges.sh <папка services> <manifest.yaml> --only <имя>[,<имя>…]
#
# С `--only` — только карточки, затронутые сервисами прогона: их собственные секции пересобираются
# целиком, у целей — нынешних (зеркала от них) и прежних (в секции есть строка от них) — заменяются
# только строки от сервисов прогона, строки остальных источников остаются байт в байт. Прочие карточки
# слепка не открываются на запись вовсе, даже если их секция устарела.
set -u
SVC="${1:?папка services}"; MAN="${2:?manifest.yaml}"; ONLY=""
[ "${3:-}" = "--only" ] && ONLY="${4:?после --only — имена сервисов через запятую}"
[ -d "$SVC" ] && [ -f "$MAN" ] || { echo "НЕТ ПАПКИ ИЛИ МАНИФЕСТА"; exit 2; }
export LC_ALL=C
TMP="$(mktemp -d 2>/dev/null || echo "/tmp/edges.$$")"; mkdir -p "$TMP"; trap 'rm -rf "$TMP"' EXIT

# Имена слепка: строки манифеста `name:`, у которых есть карточка.
sed 's/\r$//' "$MAN" | awk '/^[ \t-]*name:[ \t]*/ { s = $0; sub(/^[ \t-]*name:[ \t]*/, "", s); gsub(/["'\'' \t]/, "", s); if (s != "") print s }' \
  | while read -r n; do [ -f "$SVC/$n.md" ] && echo "$n"; done | sort -u > "$TMP/names"
[ -s "$TMP/names" ] || { echo "карточек слепка нет — Шага 5 нет"; exit 0; }

# Зеркала: цель<TAB>ключ-сортировки<TAB>строка.
while read -r src; do
  awk -v src="$src" -v names="$TMP/names" '
    BEGIN { while ((getline n < names) > 0) have[n] = 1 }
    function cell(s) { gsub(/\002/, "\\|", s); gsub(/^[ \t]+|[ \t]+$/, "", s); return s }
    function bare(s) { s = cell(s); gsub(/`/, "", s); return s }
    { line = $0; sub(/\r$/, "", line) }
    line ~ /^## / { sec = line; hdr = 0; next }
    sec !~ /^## (Потребляемые API|Зависит от)/ { next }
    line ~ /^\|/ {
      if (line ~ /^\|[ \t:|-]*$/) { hdr = 1; next }    # разделитель: всё выше было заголовком
      if (!hdr) next
      gsub(/\\\|/, "\002", line)                       # экранированная черта — внутри ячейки
      n = split(line, c, "|")
      t = bare(c[2]); if (t == "" || t == "—") next
      if (!(t in have) || t == src) { skipped++; next }
      if (sec ~ /Потребляемые API/) { call = cell(c[3]); why = cell(c[4]) } else { call = "—"; why = cell(c[3]) }
      if (call == "") call = "—"
      printf "%s\t%s\t| `%s` | %s | %s |\n", t, src "\001" bare(call), src, call, why
    }
    END { if (skipped) printf "%s\t\t#SKIP %d\n", src, skipped }
  ' "$SVC/$src.md"
done < "$TMP/names" > "$TMP/mirrors"

grep -v '#SKIP' "$TMP/mirrors" | sort -t"$(printf '\t')" -k1,1 -k2,2 > "$TMP/m.sorted"

# Строки секции «Кто меня потребляет» карточки: ключ-сортировки<TAB>строка как есть (без CR).
sec_rows() {
  awk '
    function cell(s) { gsub(/\002/, "\\|", s); gsub(/^[ \t]+|[ \t]+$/, "", s); return s }
    function bare(s) { s = cell(s); gsub(/`/, "", s); return s }
    { line = $0; sub(/\r$/, "", line) }
    line ~ /^## / { insec = (line ~ /^## Кто меня потребляет/); hdr = 0; next }
    !insec || line !~ /^\|/ { next }
    {
      if (line ~ /^\|[ \t:|-]*$/) { hdr = 1; next }
      if (!hdr) next
      t = line; gsub(/\\\|/, "\002", t); split(t, c, "|")
      s = bare(c[2]); if (s == "" || s == "—") next
      call = bare(c[3]); if (call == "") call = "—"
      print s "\001" call "\t" line
    }' "$1"
}
# --only: сервисы прогона из слепка; затронутые — они сами, цели их зеркал и карточки, где уже есть
# строки от них (ребро могло исчезнуть).
if [ -n "$ONLY" ]; then
  printf '%s\n' "$ONLY" | tr ',' '\n' | sed 's/`//g; s/^[[:space:]]*//; s/[[:space:]]*$//' | grep -v '^$' | sort -u > "$TMP/only.raw"
  grep -Fxf "$TMP/names" "$TMP/only.raw" > "$TMP/only" || :
  { cat "$TMP/only"
    awk -F'\t' -v of="$TMP/only" 'BEGIN { while ((getline n < of) > 0) S[n] = 1 } { split($2, k, "\001"); if (k[1] in S) print $1 }' "$TMP/m.sorted"
    while read -r t; do
      sec_rows "$SVC/$t.md" | awk -F'\t' -v of="$TMP/only" -v t="$t" 'BEGIN { while ((getline n < of) > 0) S[n] = 1 } { split($1, a, "\001"); if (a[1] in S) { print t; exit } }'
    done < "$TMP/names"
  } | sort -u > "$TMP/touched"
fi

# Пересборка секции у каждой карточки слепка. Строки вне секции выводятся как есть (с CR, если был);
# переписанные строки берут окончание файла — CRLF, если им кончается заголовок секции.
WRITTEN=0
while read -r tgt; do
  [ -z "$ONLY" ] || grep -Fxq "$tgt" "$TMP/touched" || continue
  f="$SVC/$tgt.md"
  if [ -n "$ONLY" ] && ! grep -Fxq "$tgt" "$TMP/only"; then
    # цель сервисов прогона: их строки — заново, строки остальных источников — как были
    { sec_rows "$f" | awk -F'\t' -v of="$TMP/only" 'BEGIN { while ((getline n < of) > 0) S[n] = 1 } { split($1, a, "\001"); if (!(a[1] in S)) print }'
      awk -F'\t' -v t="$tgt" -v of="$TMP/only" 'BEGIN { while ((getline n < of) > 0) S[n] = 1 } $1 == t { split($2, k, "\001"); if (k[1] in S) print $2 "\t" $3 }' "$TMP/m.sorted"
    } | sort -t"$(printf '\t')" -k1,1 | cut -f2- > "$TMP/rows"
  else
    awk -F'\t' -v t="$tgt" '$1 == t { print $3 }' "$TMP/m.sorted" > "$TMP/rows"
  fi
  nrows=$(wc -l < "$TMP/rows" | tr -d ' ')
  if ! grep -q '^## Кто меня потребляет' "$f"; then
    echo "  $tgt — секции «Кто меня потребляет» нет, не тронута$([ "$nrows" -gt 0 ] && echo "; зеркал не записано: $nrows")"
    continue
  fi
  awk -v rows="$TMP/rows" '
    BEGIN { BINMODE = 3 }
    BEGIN { n = 0; while ((getline r < rows) > 0) R[++n] = r }
    { line = $0; cr = (line ~ /\r$/) ? "\r" : ""; sub(/\r$/, "", line) }
    line ~ /^## Кто меня потребляет/ {
      print
      printf "| Сервис | Что вызывает | Зачем |%s\n|---|---|---|%s\n", cr, cr
      if (n == 0) printf "| — | | |%s\n", cr; else for (i = 1; i <= n; i++) printf "%s%s\n", R[i], cr
      printf "%s\n", cr; skip = 1; next
    }
    skip && line ~ /^## / { skip = 0 }
    skip { next }
    { print }
  ' "$f" > "$TMP/card" && mv "$TMP/card" "$f"
  WRITTEN=$((WRITTEN + nrows))
  echo "  $tgt — зеркал $nrows"
done < "$TMP/names"
grep '#SKIP' "$TMP/mirrors" | awk -F'\t' -v of="${ONLY:+$TMP/only}" 'BEGIN { if (of != "") { lim = 1; while ((getline n < of) > 0) S[n] = 1 } }
  !lim || ($1 in S) { sub(/#SKIP /, "", $3); printf "  %s — строк в сервисы без карточки слепка: %s\n", $1, $3 }'
if [ -n "$ONLY" ]; then
  echo "Шаг 5: карточек слепка $(wc -l < "$TMP/names" | tr -d ' '), зеркал всего $WRITTEN; только затронутые прогоном ($(paste -sd, "$TMP/only")): $(paste -sd, "$TMP/touched"), остальные не тронуты"
else
  echo "Шаг 5: карточек слепка $(wc -l < "$TMP/names" | tr -d ' '), зеркал всего $WRITTEN"
fi
