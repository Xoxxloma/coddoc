# sm-run.sh — запуск скрипта скилла service-map-2.0 в самотестах; подключается точкой (до mktemp).
#   sm_run <путь к скрипту.py|.sh> [ИМЯ=значение …] [аргументы …] — `python <скрипт>.py ИМЯ=значение … аргументы`,
# как у агента: переменные — словами после имени скрипта. Имя `.sh` (старые записи и самотесты) сводится к `.py`.
# Автоконвертация MSYS выключена: пути `/c/…` скрипт разбирает сам (keys.fpath), префикс `/api` путём не станет.
# Пути `/tmp/…` Python на Windows не откроет — TMPDIR ставится здесь в форму `/c/…` (не под скрытой папкой: она
# ловушка plan). SM_PY — интерпретатор (по умолчанию python).
# SM_REC=<папка> — запись каждого вызова для сверки (SM-PORT/compare.py): stdout, stderr, код выхода и копии
# файлов-аргументов (и папок-аргументов — их файлы верхнего уровня) после вызова.
if command -v cygpath >/dev/null 2>&1; then
  case "${TMPDIR:-/tmp}" in
    /[A-Za-z]/*) ;;
    *) _w="$(cygpath -m "${TMPDIR:-/tmp}" 2>/dev/null)"
       case "$_w" in [A-Za-z]:/*) export TMPDIR="/$(printf '%s' "${_w%%:*}" | tr 'A-Z' 'a-z')${_w#?:}/sm-port"; mkdir -p "$TMPDIR" ;; esac
       unset _w ;;
  esac
fi
sm_norm() { sed -E 's#((sm-[a-z0-9-]+|tmp)\.)[A-Za-z0-9]{6,10}#\1R#g'; }
sm_name() { local b; b="$(basename "$1")"; b="${b%.py}"; printf '%s' "${b%.sh}"; }
sm_run() {
  if [ -n "${SM_REC:-}" ] && [ -z "${SM_REC_IN:-}" ]; then
    local o rc key i=0 d a j=0 f
    mkdir -p "$SM_REC"; o="$(mktemp -d "$SM_REC/.c.XXXXXX")"
    SM_REC_IN=1 sm_run "$@" >"$o/out" 2>"$o/err"; rc=$?
    cat "$o/out"; cat "$o/err" >&2
    key="$(sm_name "$1")-$(printf '%s\n' "${@:2}" | sm_norm | md5sum | cut -c1-12)"
    while [ -e "$SM_REC/$key.$i" ]; do i=$((i+1)); done
    d="$SM_REC/$key.$i"; mv "$o" "$d"; echo "$rc" > "$d/rc"
    printf '%s\n' "$(sm_name "$1")" "${@:2}" | sm_norm > "$d/cmd"
    for a in "${@:2}"; do
      j=$((j+1)); [[ "$a" =~ ^[A-Z][A-Z0-9_]*=(.*)$ ]] && a="${BASH_REMATCH[1]}"
      if [ -f "$a" ]; then cp "$a" "$d/f$j"
      elif [ -d "$a" ]; then mkdir -p "$d/d$j"; for f in "$a"/*; do [ -f "$f" ] && cp "$f" "$d/d$j/"; done
      fi
    done
    return "$rc"
  fi
  local s="$1"; shift
  s="$(dirname "$s")/$(sm_name "$s").py"
  MSYS2_ARG_CONV_EXCL='*' MSYS_NO_PATHCONV=1 "${SM_PY:-python}" "$(cygpath -m "$s" 2>/dev/null || echo "$s")" "$@"
}
