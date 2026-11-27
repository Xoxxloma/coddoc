#!/usr/bin/env bash
# Эталон promote.sh для самопроверки стенда: копия во временный файл рядом, сверка, перенос.
src="$1"; dst="$2"; tmp="$dst.promote-tmp.$$"
cnt() { printf '### %s, | %s, строк %s' "$(grep -c '^### ' "$1")" "$(grep -c '^| ' "$1")" "$(wc -l < "$1" | tr -d ' ')"; }
if cp "$src" "$tmp" 2>/dev/null && cmp -s "$src" "$tmp"; then
  echo "черновик: $(cnt "$src")"; echo "копия:    $(cnt "$tmp")"
  mv -f "$tmp" "$dst" && cmp -s "$src" "$dst" && { echo "КОПИЯ ВЕРНА → $dst"; exit 0; }
fi
rm -f "$tmp" 2>/dev/null; echo "КОПИЯ РАСХОДИТСЯ — не записано"; exit 4
