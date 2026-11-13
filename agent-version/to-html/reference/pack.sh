#!/usr/bin/env bash
# pack.sh — собрать markdown в страницу и открыть её в браузере. macOS, Linux (и Git Bash на Windows).
#
#   bash <папка скилла>/reference/pack.sh [--no-open] [путь ...]
#
# Пути — файлы или папки. Папка — целиком; файл — его папка до двух уровней вглубь, а если она больше
# предела — сам файл и то, на что он ссылается; несколько путей — только они. Без путей — пустая
# страница, в которую перетаскивают файлы.
#
# Пишет <корень репозитория>/.coddoc-tmp/to-html/<набор>/ (вне репозитория — от текущей папки): копию viewer/,
# data.js (тексты в base64), assets.js (картинки в base64 — для экспорта) — и открывает index.html системной
# командой. Повторный вызов с тем же входом пишет туда же: F5 в открытой вкладке показывает новое. --no-open —
# только пересобрать. В .coddoc-tmp/to-html/ остаются MAX_SETS последних наборов, старые удаляются.
# TO_HTML_NO_OPEN=1 в окружении — не открывать браузер, вывод как обычно (проверки без экрана).
#
# Последняя строка вывода — только ASCII, её читает агент (русские строки выше бывают в чужой кодировке):
#   to-html: ok files=N text=N img=N other=N page=file:///…       (с --no-open — updated)
#   to-html: error not-found | no-text | too-many | no-write
#
# Для Windows рядом pack.ps1 — та же логика и тот же формат data.js; правятся оба файла вместе.
# Пишется под bash 3.2 (macOS) и без GNU-расширений: без mapfile, ${x,,}, find -printf, stat, realpath.
set -uo pipefail
shopt -s nocasematch

MAX_FILES=2000
MAX_TEXT=$((5 * 1024 * 1024))
MAX_IMG=$((15 * 1024 * 1024))
MAX_SETS=10

here="$(cd "$(dirname "$0")" && pwd -P)"
viewer="$here/viewer"
cwd="$(pwd -P)"

fail() { printf '%s\n' "$2"; printf 'to-html: error %s\n' "$1"; exit 1; }

# Помощники пишут результат в переменную, а не в вывод: $(…) на каждый файл — это процесс, а в Git Bash
# на Windows процесс стоит миллисекунды, на двух тысячах файлов — минуту.
kind_of() {
  case "$1" in
    *.md|*.markdown|*.txt|*.puml|*.plantuml|*.mmd|*.yaml|*.yml|*.json) KIND=text ;;
    *.png|*.jpg|*.jpeg|*.gif|*.webp|*.svg) KIND=img ;;
    *) KIND=other ;;
  esac
}

mime_of() {
  case "$1" in
    *.png) MIME=image/png ;; *.jpg|*.jpeg) MIME=image/jpeg ;; *.gif) MIME=image/gif ;;
    *.webp) MIME=image/webp ;; *.svg) MIME=image/svg+xml ;; *) MIME=application/octet-stream ;;
  esac
}

# Строка JSON: в путях из того, что надо экранировать, бывают только \ " и табуляция.
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

abs_path() {
  if [ -d "$1" ]; then (cd "$1" && pwd -P)
  else (cd "$(dirname "$1")" && printf '%s/%s\n' "$(pwd -P)" "$(basename "$1")")
  fi
}

# Нормализует a/./b/../c → a/c; путь выше корня набора — пусто.
norm_rel() {
  local IFS=/ part out=()
  for part in $1; do
    case "$part" in
      ''|.) ;;
      ..) [ ${#out[@]} -gt 0 ] || { printf ''; return; }; unset "out[$((${#out[@]} - 1))]"; out=(${out[@]+"${out[@]}"}) ;;
      *) out+=("$part") ;;
    esac
  done
  printf '%s' "${out[*]-}"
}

common_dir() {
  local c="$1" d
  shift
  for d in "$@"; do
    while :; do
      case "$d/" in "$c"/*) break ;; esac
      [ "$c" = / ] && break
      c="$(dirname "$c")"
    done
  done
  printf '%s\n' "$c"
}

# Файлы под $root/$1 (пусто — весь корень), пути от корня; $2 — глубина find или пусто. Скрытые и
# node_modules не заходим; останавливаемся на MAX_FILES + 1, чтобы не обходить огромные деревья.
list_under() {
  local start="./${1:-}" depth="${2:-}"
  (cd "$root" && find "$start" -mindepth 1 ${depth:+-maxdepth "$depth"} \( -name '.*' -o -name node_modules \) -prune -o -type f -print) \
    | sed 's|^\./||' | head -n $((MAX_FILES + 1))
}

# Режим «файл и его ссылки»: файл + то, на что он ссылается (](…), [[…]], ![[…]]), два шага по ссылкам.
links_of() {
  local rel="$1" dir t name
  dir="$(dirname "$rel")"; [ "$dir" = . ] && dir=""
  grep -oE '\]\(<[^>]+>|\]\([^) ]+' "$root/$rel" 2>/dev/null | sed -E 's/^\]\(<?//' | while IFS= read -r t; do
    case "$t" in http:*|https:*|mailto:*|\#*|/*) continue ;; esac
    t="${t%>}"; t="${t%%#*}"; t="${t%%\?*}"
    t="$(printf '%b' "${t//%/\\x}")"
    t="$(norm_rel "${dir:+$dir/}$t")"
    [ -n "$t" ] && [ -f "$root/$t" ] && printf '%s\n' "$t"
  done
  grep -oE '\[\[[^]|#]+' "$root/$rel" 2>/dev/null | sed 's/^\[\[//' | while IFS= read -r name; do
    for t in "${dir:+$dir/}$name" "${dir:+$dir/}$name.md"; do
      [ -f "$root/$t" ] && { printf '%s\n' "$t"; continue 2; }
    done
    t="$(cd "$root" && find . -mindepth 1 -maxdepth 3 \( -name '.*' -o -name node_modules \) -prune -o -type f \( -name "$name" -o -name "$name.md" \) -print | head -n 1)"
    [ -n "$t" ] && printf '%s\n' "${t#./}"
  done
}

# ---------------------------------------------------------------- вход
no_open=0
paths=()
while [ $# -gt 0 ]; do
  case "$1" in
    --no-open) no_open=1 ;;
    --) shift; paths+=("$@"); break ;;
    *) paths+=("$1") ;;
  esac
  shift
done

for p in ${paths[@]+"${paths[@]}"}; do
  [ -e "$p" ] || fail not-found "нет такого пути: $p"
done

# Временные файлы скиллов — в одной папке .coddoc-tmp/ в корне репозитория, у каждого скилла своя подпапка;
# запуск из подпапки репозитория пишет туда же.
top="$(git rev-parse --show-toplevel 2>/dev/null)" && top="$(cd "$top" && pwd -P)" || top="$cwd"
work="$top/.coddoc-tmp/to-html"
mkdir -p "$work" 2>/dev/null && [ -w "$work" ] || fail no-write "не могу писать в $work"
[ -f "$top/.coddoc-tmp/.gitignore" ] || printf '*\n' > "$top/.coddoc-tmp/.gitignore"

mode=blank root="" open="" list="$(mktemp "$work/list.XXXXXX")"
trap 'rm -f "$list" "$list".*' EXIT

if [ ${#paths[@]} -eq 1 ] && [ -d "${paths[0]}" ]; then
  mode=dir; root="$(abs_path "${paths[0]}")"
  list_under "" "" > "$list"
elif [ ${#paths[@]} -eq 1 ]; then
  mode=file; a="$(abs_path "${paths[0]}")"; root="$(dirname "$a")"; open="$(basename "$a")"
  list_under "" 3 > "$list"
  if [ "$(wc -l < "$list")" -gt "$MAX_FILES" ]; then
    mode=links
    printf '%s\n' "$open" > "$list"
    frontier="$open"
    for step in 1 2; do
      next=""
      while IFS= read -r f; do
        kind_of "$f"; [ "$KIND" = text ] || continue
        next="$next$(links_of "$f")"$'\n'
      done <<< "$frontier"
      frontier="$(printf '%s' "$next" | grep -v '^$' | LC_ALL=C sort -u | grep -vxF -f "$list" || true)"
      [ -n "$frontier" ] && printf '%s\n' "$frontier" >> "$list"
    done
  fi
elif [ ${#paths[@]} -gt 1 ]; then
  mode=list
  dirs=()
  for p in "${paths[@]}"; do
    a="$(abs_path "$p")"
    if [ -d "$a" ]; then dirs+=("$a"); else dirs+=("$(dirname "$a")"); fi
  done
  root="$(common_dir "${dirs[@]}")"
  for p in "${paths[@]}"; do
    a="$(abs_path "$p")"; rel="${a#"$root"}"; rel="${rel#/}"
    if [ -d "$a" ]; then list_under "$rel" "" >> "$list"
    else printf '%s\n' "$rel" >> "$list"; [ -n "$open" ] || open="$rel"
    fi
  done
fi

LC_ALL=C sort -u -o "$list" "$list"
total=$(grep -c . "$list" || true)
[ "$total" -le "$MAX_FILES" ] || fail too-many "в $root больше $MAX_FILES файлов — назови папку поуже"

n_text=0 n_img=0 n_other=0
while IFS= read -r f; do
  kind_of "$f"
  case "$KIND" in text) n_text=$((n_text + 1)) ;; img) n_img=$((n_img + 1)) ;; *) n_other=$((n_other + 1)) ;; esac
done < "$list"
if [ "$mode" = dir ] || [ "$mode" = list ]; then
  [ "$n_text" -gt 0 ] || fail no-text "в $root нет ни одного текстового файла (.md, .txt, .puml …)"
fi
if [ "$mode" = dir ] && [ -z "$open" ]; then
  for c in README.md index.md; do open="$(grep -ixF "$c" "$list" | head -n 1)"; [ -n "$open" ] && break; done
  if [ -z "$open" ]; then
    best=-1
    while IFS= read -r f; do
      case "$f" in */*) continue ;; *.md|*.markdown) ;; *) continue ;; esac
      s=$(($(wc -c < "$root/$f"))); [ "$s" -gt "$best" ] && { best=$s; open="$f"; }
    done < "$list"
  fi
fi

# ---------------------------------------------------------------- куда писать
if [ "$mode" = blank ]; then
  slug=_blank label="" base=""
elif [ "$root" = "$top" ]; then
  slug="$(basename "$top")" label=. base=../../../
elif [ "${root#"$top"/}" != "$root" ]; then
  label="${root#"$top"/}"; slug="${label//\//--}"; base="../../../$label/"
else
  label="$root"; slug="$(basename "$root")-$(printf '%s' "$root" | cksum | cut -d' ' -f1)"
  case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) label="$(cygpath -m "$root")"; base="file:///$label/" ;; *) base="file://$root/" ;; esac
fi
slug="$(printf '%s' "$slug" | tr ':*?"<>|\\' '________')"
out="$work/$slug"
mkdir -p "$out" 2>/dev/null && [ -w "$out" ] || fail no-write "не могу писать в $work"

# Каждый набор — копия страницы (~3 МБ) и тексты с картинками в base64: держим MAX_SETS последних,
# текущий — самый свежий. Не удалилось — не беда, сборка идёт дальше.
touch "$out"
n=0
ls -1t "$work" | while IFS= read -r d; do
  [ -n "$d" ] && [ -d "$work/$d" ] || continue
  n=$((n + 1))
  [ "$n" -gt "$MAX_SETS" ] && rm -rf "$work/$d"
done

made="$(date '+%Y-%m-%d %H:%M')"
stamp="$(date '+%Y%m%d%H%M%S')"

# ---------------------------------------------------------------- data.js
{
  printf '// создано pack.sh %s — не править руками\n' "$made"
  printf 'window.MDV_DATA = {"v":1'
  json "$made"; printf ',"made":%s' "$JSON"
  json "$label"; printf ',"root":%s' "$JSON"
  json "$base"; printf ',"base":%s' "$JSON"
  json "$open"; printf ',"open":%s,"files":[' "$JSON"
  sep=$'\n'
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    size=$(($(wc -c < "$root/$f")))
    json "$f"
    printf '%s[%s,%s,' "$sep" "$JSON" "$size"
    kind_of "$f"
    if [ "$KIND" = text ] && [ "$size" -le "$MAX_TEXT" ]; then
      printf '"'; base64 < "$root/$f" | tr -d '\n\r'; printf '"]'
    else
      printf 'null]'
    fi
    sep=$',\n'
  done < "$list"
  printf '\n]};\n'
} > "$out/data.js.tmp" && mv "$out/data.js.tmp" "$out/data.js"

# ---------------------------------------------------------------- assets.js (только если картинки поменялись)
: > "$list.img"
while IFS= read -r f; do
  kind_of "$f"; [ "$KIND" = img ] || continue
  size=$(($(wc -c < "$root/$f")))
  [ "$size" -le "$MAX_IMG" ] && printf '%s\t%s\n' "$f" "$size" >> "$list.img"
done < "$list"
rebuild=0
cmp -s "$list.img" "$out/assets.list" 2>/dev/null || rebuild=1
[ -f "$out/assets.js" ] || rebuild=1
if [ "$rebuild" = 0 ]; then
  while IFS=$'\t' read -r f size; do [ "$root/$f" -nt "$out/assets.js" ] && { rebuild=1; break; }; done < "$list.img"
fi
if [ "$rebuild" = 1 ]; then
  {
    printf 'window.MDV_ASSETS = ['
    sep=$'\n'
    while IFS=$'\t' read -r f size; do
      mime_of "$f"; json "$f"
      printf '%s[%s,"%s","' "$sep" "$JSON" "$MIME"
      base64 < "$root/$f" | tr -d '\n\r'
      printf '"]'
      sep=$',\n'
    done < "$list.img"
    printf '\n];\n'
  } > "$out/assets.js.tmp" && mv "$out/assets.js.tmp" "$out/assets.js"
  cp "$list.img" "$out/assets.list"
fi

# ---------------------------------------------------------------- страница
cp -R "$viewer/." "$out/"
sed "s/__MADE__/$stamp/g" "$viewer/index.html" > "$out/index.html"

page="$out/index.html"
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) url="file:///$(cygpath -m "$page")" ;;
  *) url="file://$page" ;;
esac

case "$mode" in
  blank) printf 'пустая страница — перетащи в неё папку или файлы\n' ;;
  links) printf 'папка %s больше %s файлов — взял %s и то, на что он ссылается\n' "$root" "$MAX_FILES" "$open" ;;
  *) printf 'собрано: %s — файлов %s (текстовых %s, картинок %s, прочих %s)\n' "${label:-.}" "$total" "$n_text" "$n_img" "$n_other" ;;
esac

status=ok
if [ "$no_open" = 1 ]; then
  status=updated
  printf 'обновлено — нажми F5 во вкладке\n'
elif [ -z "${TO_HTML_NO_OPEN:-}" ]; then
  case "$(uname -s)" in
    Darwin) open "$page" ;;
    MINGW*|MSYS*|CYGWIN*) cmd.exe //c start "" "$(cygpath -w "$page")" ;;
    # setsid — своя сессия: агент, закрывая терминал после команды, не убьёт xdg-open, пока тот
    # запускает браузер (иначе вкладка то появляется, то нет). Без & нельзя: xdg-open бывает ждёт
    # закрытия браузера.
    *) if ! command -v xdg-open >/dev/null 2>&1; then printf 'открой в браузере: %s\n' "$page"
       elif command -v setsid >/dev/null 2>&1; then setsid xdg-open "$page" >/dev/null 2>&1 < /dev/null &
       else nohup xdg-open "$page" >/dev/null 2>&1 < /dev/null &
       fi ;;
  esac
fi
printf 'to-html: %s files=%s text=%s img=%s other=%s page=%s\n' "$status" "$total" "$n_text" "$n_img" "$n_other" "$(urlenc "$url")"
