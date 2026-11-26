#!/usr/bin/env bash
# Сверка порта скриптов service-map-2.0 bash ↔ Python (срез П). Моделей не запускает.
#   bash run.sh [both|bash|py] [папка записи]
# Скриптовые самотесты (SM-CHECK, SM-SPLIT-SCRIPTS, SM-EDGES-SCRIPT, SM-ASSEMBLE-DUP, SM-ASSEMBLE-SLOTS,
# SM-PLAN-TYPES) и корпус (corpus.sh) — на bash и на Python, каждый вызов записан (SM_REC, sm-run.sh);
# затем compare.py: stdout, stderr, код выхода и файлы — байт в байт, после замены случайных имён mktemp.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
F="$(cd "$HERE/.." && pwd)"
REF="$(cd "$F/../../service-map-2.0/reference" && pwd)"
MODE="${1:-both}"
REC="${2:-$F/../selftest/port/rec2}"; mkdir -p "$REC"; REC="$(cd "$REC" && pwd)"
# TMPDIR в форме /c/…: путь /tmp/… Python на Windows не откроет, а /c/… — и bash, и keys.fpath. Не под ворктри:
# скрытая папка `.claude/` в пути — ловушка plan (корень под скрытой папкой даёт 0), самотест SM-PLAN-TYPES падает.
if [ -z "${SM_PORT_TMP:-}" ]; then w="$(cygpath -m /tmp 2>/dev/null || echo /tmp)"
  case "$w" in [A-Za-z]:/*) w="/$(printf '%s' "${w%%:*}" | tr 'A-Z' 'a-z')${w#?:}" ;; esac; SM_PORT_TMP="$w/sm-port"; fi
mkdir -p "$SM_PORT_TMP"; export TMPDIR="$SM_PORT_TMP"
suite() {
  local m="$1"; export SM_REC="$REC/$m"; rm -rf "$SM_REC"; mkdir -p "$SM_REC"
  if [ "$m" = py ]; then export SM_RUNNER=py; else unset SM_RUNNER; fi
  {
    echo "== режим: $m"
    bash "$F/SM-CHECK/test-check.sh" 2>&1 | grep -E '^  фаза|^  всего|ИТОГ|ОШИБКА|расхожд' | head -20
    bash "$F/SM-SPLIT-SCRIPTS/test-split-scripts.sh" "$REF" 2>&1 | grep -E '^ИТОГ|ОШИБКА' | head -20
    echo "SM-EDGES-SCRIPT:"; bash "$F/SM-EDGES-SCRIPT/test-edges.sh" 2>&1 | tail -4
    echo "SM-ASSEMBLE-DUP: $(bash "$F/SM-ASSEMBLE-DUP/run.sh" 2>&1 | tail -5)"
    echo "SM-ASSEMBLE-SLOTS: $(bash "$F/SM-ASSEMBLE-SLOTS/run.sh" 2>&1 | tail -5)"
    echo "SM-PLAN-TYPES: $(bash "$F/SM-PLAN-TYPES/run.sh" 2>&1 | tail -5)"
    [ -f "$HERE/corpus.sh" ] && { echo "корпус:"; bash "$HERE/corpus.sh" "$REF" 2>&1 | tail -3; }
  } | tee "$REC/$m.summary"
}
case "$MODE" in
  both) suite bash; suite py ;;
  bash|py) suite "$MODE" ;;
  *) echo "режим: both|bash|py" >&2; exit 2 ;;
esac
[ -d "$REC/bash" ] && [ -d "$REC/py" ] && python "$HERE/compare.py" "$REC/bash" "$REC/py" --allow "$HERE/allow-plan.tsv" --allow-call "$HERE/allow-calls.tsv"
