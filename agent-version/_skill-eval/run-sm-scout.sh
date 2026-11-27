#!/usr/bin/env bash
# run-sm-scout.sh <SKILL.md> <папка-раунда> [N] — проба разведчика Шага 3.0 (критерий А-1, PLAN-AUTOSPLIT.md §5).
#
# Бриф разведчика: рядом с УКАЗАННЫМ SKILL.md лежит `reference/brief-scout.md` — он целиком (3.3.0+);
# иначе из SKILL.md вырезается первый блок, огороженный четырьмя обратными кавычками, после заголовка
# `#### 3.0 Разведчик` (до следующего заголовка раздела; не нашёлся — отказ).
# В нём подставляются `<пути>` — абсолютный Windows-путь дерева сервиса (`pwd -W`, как в
# runs/2026-08-24-sm-real/run.sh) — и `<type>` = backend. Промпт прогона — бриф целиком, как его отдал бы
# ведущий субагенту. Прогон: `claude -p` с моделью ${SM_MODEL:-haiku}, ТОЛЬКО Read/Grep/Glob
# (`--tools` ограничивает встроенный набор, `--strict-mcp-config` и ENABLE_CLAUDEAI_MCP_SERVERS=false
# убирают MCP и коннекторы claude.ai, `--disallowedTools` — страховка), stream-json.
#
# Фикстуры: NRS-TAIL, SM-MONO-DGS, SM-MONO-DGS-MIX, repairy-api, resonance-api (fixtures/SM-SCOUT/truth.json).
# Песочница — ОДНА на раунд, <раунд>/sandbox-scout/ (fixtures/SM-SCOUT/sandbox.sh): писать разведчику
# нечем, а грейдер обязан грепать то же дерево, что видел прогон. Отпечаток песочницы снимается до и
# после пула; до пула эталонные маркеры сверяются с правдой (`grade-sm-scout.mjs --truth-check`).
# Рабочая папка прогона — <раунд>/sandbox-scout/<фикстура>/ (в ней только дерево сервиса).
#
# Выход: <раунд>/sm-scout/<фикстура>/run-NN/{answer.md, _stream.jsonl, cost.txt, _trace.jsonl, _rc.txt,
# _stderr.log}; отказ API или обрыв без ответа — _api-failure.txt («не измерено»). Песочница с непустым
# answer.md пропускается — раннер можно перезапускать.
#
# Переменные: SM_MODEL (haiku), SM_SCOUT_ONLY="NRS-TAIL repairy-api" — только названные фикстуры,
# SM_SCOUT_DRY=1 — собрать песочницу и промпты, claude не вызывать; SM_TIMEOUT (1800 c), SM_OUT (sm-scout).
# Параллельность — как у соседних раннеров: N прогонов одной фикстуры разом, фикстуры по очереди.
# Грейдер: node grade-sm-scout.mjs <папка-раунда>
set -u
command -v timeout > /dev/null || timeout() { local s="$1"; shift; perl -e 'alarm shift; exec @ARGV' "$s" "$@"; }

SKILL="${1:?путь к SKILL.md}"; ROUND="${2:?папка раунда}"; N="${3:-5}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; FIX="$HERE/fixtures/SM-SCOUT"
[ -f "$SKILL" ] || { echo "нет $SKILL" >&2; exit 1; }
mkdir -p "$ROUND"; ROUND="$(cd "$ROUND" && pwd)"
OUT="$ROUND/${SM_OUT:-sm-scout}"; SB="$ROUND/sandbox-scout"
MODEL="${SM_MODEL:-haiku}"
FIXTURES="NRS-TAIL SM-MONO-DGS SM-MONO-DGS-MIX repairy-api resonance-api"

# ─── бриф ────────────────────────────────────────────────────────────────────────────────
BRIEF_FILE="$(dirname "$SKILL")/reference/brief-scout.md"
if [ -f "$BRIEF_FILE" ]; then BRIEF="$(cat "$BRIEF_FILE")"; else
BRIEF="$(awk '
  st == 0 && /^#### 3\.0 Разведчик/ { st = 1; next }
  st == 1 && /^````/                 { st = 2; next }
  st == 1 && /^#{1,4} /              { exit }
  st == 2 && /^````[ \t]*$/          { st = 3; exit }
  st == 2                            { print }
  END { if (st != 3) exit 1 }' "$SKILL")" \
  || { echo "не нашёл бриф разведчика: блок в четырёх обратных кавычках после «#### 3.0 Разведчик» в $SKILL" >&2; exit 1; }
fi
[ -n "$BRIEF" ] || { echo "бриф разведчика пуст в $SKILL" >&2; exit 1; }
case "$BRIEF" in *'<пути>'*) ;; *) echo "в брифе нет плейсхолдера <пути> — разведчику некуда смотреть" >&2; exit 1 ;; esac
mkdir -p "$OUT"
cp "$SKILL" "$OUT/_skill-snapshot.md"
[ -f "$BRIEF_FILE" ] && cp "$BRIEF_FILE" "$OUT/_brief-scout-snapshot.md"
printf '%s\n' "$BRIEF" > "$OUT/_brief-template.md"
LEFT="$(printf '%s\n' "$BRIEF" | grep -o '<[^<> `|]\{1,24\}>' | grep -v -x -e '<пути>' -e '<type>' -e '<класс>' -e '<регэксп>' -e '<glob>' | sort -u | tr '\n' ' ')"
[ -n "$LEFT" ] && echo "ВНИМАНИЕ: в брифе есть плейсхолдеры, которых раннер не подставляет: $LEFT"

# ─── песочница и эталон ──────────────────────────────────────────────────────────────────
bash "$FIX/sandbox.sh" "$SB" > "$OUT/_sandbox-build.log" 2>&1 || { cat "$OUT/_sandbox-build.log"; echo "песочница не собралась" >&2; exit 1; }
if ! node "$HERE/grade-sm-scout.mjs" --truth-check --sandbox "$SB" > "$OUT/_truth-check.txt" 2>&1; then
  cat "$OUT/_truth-check.txt"; echo "эталон ≠ правда в песочнице раунда — пул не запускаю" >&2; exit 1
fi
fingerprint() { ( cd "$SB" && find . -type f -printf '%P\t%s\t%T@\n' | sort ); }
fingerprint > "$OUT/_sandbox-before.txt"

{
  echo "модель: $MODEL"
  echo "прогонов на фикстуру: $N"
  echo "текст скилла: $SKILL ($(wc -l < "$SKILL") строк); бриф: $(printf '%s\n' "$BRIEF" | wc -l) строк"
  echo "инструменты прогона: Read, Grep, Glob (--tools), MCP выключены"
  echo "фикстуры: ${SM_SCOUT_ONLY:-$FIXTURES}"
  cat "$SB/_built.txt"
  head -1 "$OUT/_truth-check.txt"
} > "$OUT/_settings.txt"
cat "$OUT/_settings.txt"

field() { node -e 'const t=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(t.fixtures[process.argv[2]][process.argv[3]]))' "$FIX/truth.json" "$1" "$2"; }

run_one() {  # run_one <фикстура> <папка прогона>
  local f="$1" d="$2" rc
  ( cd "$SB/$f" && ENABLE_CLAUDEAI_MCP_SERVERS=false timeout "${SM_TIMEOUT:-1800}" claude -p --model "$MODEL" \
      --tools "Read,Grep,Glob" --allowedTools "Read,Grep,Glob" \
      --disallowedTools "Bash,PowerShell,Write,Edit,NotebookEdit,Agent,WebFetch,WebSearch" \
      --strict-mcp-config --permission-mode bypassPermissions \
      --output-format stream-json --verbose < "$OUT/$f/prompt.md" ) > "$d/_stream.jsonl" 2> "$d/_stderr.log"
  rc=$?; echo "$rc" > "$d/_rc.txt"
  node "$HERE/stream-extract.mjs" "$d/_stream.jsonl" "$d" 2>> "$d/_stderr.log"
  [ -f "$d/_cost.txt" ] && mv "$d/_cost.txt" "$d/cost.txt"
  # Отказ раннера — «не измерено», а не «провалено».
  if grep -qiE "API Error|Request not allowed|Please run /login|Credit balance|rate limit|session limit|usage limit|Overloaded" "$d/answer.md" 2>/dev/null; then
    mv "$d/answer.md" "$d/_api-failure.txt"; echo "  $f/$(basename "$d") — ОТКАЗ API, в счёт не идёт"; return 0
  fi
  if [ "$rc" -ne 0 ] && [ ! -s "$d/answer.md" ]; then
    echo "rc=$rc, ответа нет — см. _stderr.log" > "$d/_api-failure.txt"; rm -f "$d/answer.md"
    echo "  $f/$(basename "$d") — ОБРЫВ (rc=$rc), в счёт не идёт"; return 0
  fi
  echo "  $f/$(basename "$d") — готов, $(grep -cE '^\s*(контракт|сущности|задачи|топики)\s*::' "$d/answer.md") строк маркеров, \$$(cat "$d/cost.txt" 2>/dev/null)"
}

for f in $FIXTURES; do
  if [ -n "${SM_SCOUT_ONLY:-}" ]; then case " $SM_SCOUT_ONLY " in *" $f "*) ;; *) continue ;; esac; fi
  tree="$(field "$f" tree)"; type="$(field "$f" type)"
  P="$(cd "$SB/$f/$tree" && { pwd -W 2>/dev/null || pwd; })"
  prompt="${BRIEF//<пути>/$P}"; prompt="${prompt//<type>/$type}"
  mkdir -p "$OUT/$f"; printf '%s\n' "$prompt" > "$OUT/$f/prompt.md"
  if [ -n "${SM_SCOUT_DRY:-}" ]; then echo "  $f — промпт собран ($(wc -l < "$OUT/$f/prompt.md") строк, путь $P), сухой режим"; continue; fi
  for i in $(seq 1 "$N"); do
    d="$OUT/$f/run-$(printf '%02d' "$i")"
    if [ -s "$d/answer.md" ]; then echo "  $f/$(basename "$d") — уже есть, пропуск"; continue; fi
    rm -rf "$d"; mkdir -p "$d"
    run_one "$f" "$d" &
  done
  wait
done

fingerprint > "$OUT/_sandbox-after.txt"
if ! diff -q "$OUT/_sandbox-before.txt" "$OUT/_sandbox-after.txt" > /dev/null; then
  echo "!!! ПЕСОЧНИЦА ИЗМЕНИЛАСЬ за пул — прогоны без права записи что-то записали; разница:"
  diff "$OUT/_sandbox-before.txt" "$OUT/_sandbox-after.txt" | head -20 | sed 's/^/    /'
fi
echo "ГОТОВО: $OUT"
echo "грейдер: node $HERE/grade-sm-scout.mjs $ROUND"
