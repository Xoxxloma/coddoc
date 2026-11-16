#!/usr/bin/env bash
# pack.sh — собрать карту сервисов из слепка services/ и открыть её в браузере. macOS, Linux (и Git Bash на Windows).
#
#   bash <папка скилла>/reference/pack.sh [--no-open] [папка слепка] [сервис]
#
# Папка слепка — по умолчанию services/ в корне репозитория. Сервис — с него страница откроется (выбран, в центре).
# Аргумент — папка слепка, если это папка с карточками *.md или manifest.yaml; остальное — имя сервиса
# (сервис может зваться как папка в корне — context, notes).
#
# Берёт из папки слепка карточки *.md верхнего уровня, manifest.yaml и _history/*.md (_pending/ и прочее — нет).
# Сами файлы не разбирает: разбор карточек — на странице (viewer/parse.js), один на все ОС.
# Пишет <корень репозитория>/.coddoc-tmp/landscape/: копию viewer/ и data.js (тексты в base64) — и открывает
# index.html системной командой. Повторный вызов пишет туда же: F5 в открытой вкладке показывает новое.
# --no-open — только пересобрать. LANDSCAPE_NO_OPEN=1 в окружении — не открывать браузер (проверки без экрана).
#
# Последняя строка вывода — только ASCII, её читает агент (русские строки выше бывают в чужой кодировке):
#   landscape: ok cards=N manifest=yes|no history=N page=file:///…       (с --no-open — updated)
#   landscape: error not-found | no-cards | no-write
#
# Для Windows рядом pack.ps1 — та же логика и тот же формат data.js; правятся оба файла вместе.
# Пишется под bash 3.2 (macOS) и без GNU-расширений: без mapfile, ${x,,}, find -printf, stat, realpath.
set -uo pipefail

MAX_TEXT=$((5 * 1024 * 1024))

here="$(cd "$(dirname "$0")" && pwd -P)"
viewer="$here/viewer"
cwd="$(pwd -P)"

fail() { printf '%s\n' "$2"; printf 'landscape: error %s\n' "$1"; exit 1; }

# Строка JSON: в путях и именах из того, что надо экранировать, бывают только \ " и табуляция.
json() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\t'/\\t}"
  JSON="\"$s\""
}

# Адрес для строки агенту: всё, кроме безопасных ASCII, — %XX по байтам UTF-8.
urlenc() {
  local LC_ALL=C s="$1" out="" c hex i
  for ((i = 0; i < ${#s}; i++)); do
    c="${s:i:1}"
    case "$c" in
      [a-zA-Z0-9/._~:-]) out+="$c" ;;
      *) printf -v hex '%%%02X' "'$c"; out+="$hex" ;;
    esac
  done
  printf '%s' "$out"
}

is_snapshot() {
  [ -f "$1/manifest.yaml" ] || [ -f "$1/manifest.yml" ] || [ -n "$(cd "$1" && find . -mindepth 1 -maxdepth 1 -type f -name '*.md' -print | head -n 1)" ]
}

# ---------------------------------------------------------------- вход
no_open=0 dir="" focus=""
while [ $# -gt 0 ]; do
  case "$1" in
    --no-open) no_open=1 ;;
    *) if [ -z "$dir" ] && [ -d "$1" ] && is_snapshot "$1"; then dir="$1"
       elif [ -z "$focus" ]; then focus="$1"
       fi ;;
  esac
  shift
done

# Временные файлы скиллов — в одной папке .coddoc-tmp/ в корне репозитория, у каждого скилла своя подпапка.
top="$(git rev-parse --show-toplevel 2>/dev/null)" && top="$(cd "$top" && pwd -P)" || top="$cwd"

if [ -z "$dir" ]; then
  # Имя сервиса похоже на путь (есть слэш) — значит, папку назвали, а её нет.
  case "$focus" in */*) fail not-found "нет такой папки: $focus" ;; esac
  if [ -d "$top/services" ]; then dir="$top/services"
  elif [ -d "$cwd/services" ]; then dir="$cwd/services"
  else fail not-found "нет папки services/ в $top — назови папку слепка"
  fi
fi
root="$(cd "$dir" && pwd -P)"

# Подпись набора: путь от корня репозитория, вне его — как есть.
case "$root" in
  "$top"/*) label="${root#"$top"/}" ;;
  "$top") label="." ;;
  *) label="$root" ;;
esac

# ---------------------------------------------------------------- что берём
list="$(mktemp "${TMPDIR:-/tmp}/landscape.XXXXXX")"
trap 'rm -f "$list"' EXIT
(cd "$root" && find . -mindepth 1 -maxdepth 1 -type f \( -name '*.md' -o -name 'manifest.yaml' -o -name 'manifest.yml' \) -print) \
  | sed 's|^\./||' | LC_ALL=C sort > "$list"
if [ -d "$root/_history" ]; then
  (cd "$root" && find ./_history -mindepth 1 -maxdepth 1 -type f -name '*.md' -print) | sed 's|^\./||' | LC_ALL=C sort >> "$list"
fi

n_cards=$(grep -c -E '^[^/]+\.md$' "$list" || true)
n_hist=$(grep -c '^_history/' "$list" || true)
manifest=no
grep -q -E '^manifest\.ya?ml$' "$list" && manifest=yes
[ "$n_cards" -gt 0 ] || fail no-cards "в $root нет карточек *.md"

work="$top/.coddoc-tmp/landscape"
mkdir -p "$work" 2>/dev/null && [ -w "$work" ] || fail no-write "не могу писать в $work"
[ -f "$top/.coddoc-tmp/.gitignore" ] || printf '*\n' > "$top/.coddoc-tmp/.gitignore"

made="$(date '+%Y-%m-%d %H:%M')"
stamp="$(date '+%Y%m%d%H%M%S')"

# ---------------------------------------------------------------- data.js
{
  printf '// создано pack.sh %s — не править руками\n' "$made"
  printf 'window.LANDSCAPE_DATA = {"v":1'
  json "$made"; printf ',"made":%s' "$JSON"
  json "$label"; printf ',"root":%s' "$JSON"
  json "$focus"; printf ',"focus":%s,"files":[' "$JSON"
  sep=$'\n'
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    size=$(($(wc -c < "$root/$f")))
    json "$f"
    printf '%s[%s,' "$sep" "$JSON"
    if [ "$size" -le "$MAX_TEXT" ]; then
      printf '"'; base64 < "$root/$f" | tr -d '\n\r'; printf '"]'
    else
      printf 'null]'
    fi
    sep=$',\n'
  done < "$list"
  printf '\n]};\n'
} > "$work/data.js.tmp" && mv "$work/data.js.tmp" "$work/data.js" || fail no-write "не могу писать в $work"

# ---------------------------------------------------------------- страница
cp -R "$viewer/." "$work/" || fail no-write "не могу скопировать страницу в $work"
sed "s/__MADE__/$stamp/g" "$viewer/index.html" > "$work/index.html"

page="$work/index.html"
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) url="file:///$(cygpath -m "$page")" ;;
  *) url="file://$page" ;;
esac

printf 'собрано: %s — карточек %s, манифест: %s, история: %s\n' "$label" "$n_cards" \
  "$([ "$manifest" = yes ] && printf 'есть' || printf 'нет')" "$n_hist"

status=ok
if [ "$no_open" = 1 ]; then
  status=updated
  printf 'обновлено — нажми F5 во вкладке\n'
elif [ -z "${LANDSCAPE_NO_OPEN:-}" ]; then
  case "$(uname -s)" in
    Darwin) open "$page" ;;
    MINGW*|MSYS*|CYGWIN*) cmd.exe //c start "" "$(cygpath -w "$page")" ;;
    # setsid — своя сессия: агент, закрывая терминал после команды, не убьёт xdg-open, пока тот запускает браузер.
    *) if ! command -v xdg-open >/dev/null 2>&1; then printf 'открой в браузере: %s\n' "$page"
       elif command -v setsid >/dev/null 2>&1; then setsid xdg-open "$page" >/dev/null 2>&1 < /dev/null &
       else nohup xdg-open "$page" >/dev/null 2>&1 < /dev/null &
       fi ;;
  esac
fi
printf 'landscape: %s cards=%s manifest=%s history=%s page=%s\n' "$status" "$n_cards" "$manifest" "$n_hist" "$(urlenc "$url")"
