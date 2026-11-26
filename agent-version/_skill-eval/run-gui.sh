#!/usr/bin/env bash
# run-gui.sh <фикстура> <папка-раунда> <N> [параллельность] — стенд оркестратора `analyst-workspace`.
#
#   SKILL_SRC=../analyst-workspace ./run-gui.sh GS-START runs/2026-08-28-gui-after 5 5
#
# Отличия от `run-nrs.sh` — два, и оба намеренные:
#
# 1. **Песочница живёт вне репы** (`/tmp/gui-sb/...`), а в раунд копируется после прогона.
#    Причина: прогон с рабочей директорией внутри `product-skills` подхватывает память проекта
#    `~/.claude/projects/C--Users-Konstantin-projects-product-skills/memory/`, где записано, что
#    меряют пробы. Это наблюдалось в `runs/2026-08-20-nr-bare10` и `runs/2026-08-21-sr-r27-final`.
# 2. **Снимок скилла берёт папку целиком** — `SKILL.md` и `reference/`. Плечо «до» и плечо «после»
#    различаются именно набором файлов; читая живую папку, оба плеча читали бы одно и то же.
set -u
FIX_NAME="${1:?фикстура, напр. GS-START}"
ROUND_ARG="${2:?папка раунда}"
N="${3:-5}"
CONC="${4:-5}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/model-id.sh"
SM_MODEL="$(model_id "${SM_MODEL:-}" claude-sonnet-5)" || exit 2
SKILLROOT="$(cd "$HERE/.." && pwd)"
FIX="$HERE/fixtures/$FIX_NAME"
[ -d "$FIX" ] || { echo "нет фикстуры: $FIX"; exit 1; }
mkdir -p "$ROUND_ARG"
ROUND="$(cd "$ROUND_ARG" && pwd)"
SKILL_SRC="${SKILL_SRC:-$SKILLROOT/analyst-workspace}"
[ -f "$SKILL_SRC/SKILL.md" ] || { echo "нет скилла: $SKILL_SRC/SKILL.md"; exit 1; }
mkdir -p "$ROUND/_skills"

if [ ! -f "$ROUND/_skills/analyst-workspace.SKILL.md" ]; then
  cp "$SKILL_SRC/SKILL.md" "$ROUND/_skills/analyst-workspace.SKILL.md"
  [ -d "$SKILL_SRC/reference" ] && cp -r "$SKILL_SRC/reference" "$ROUND/_skills/analyst-workspace.reference"
  echo "снимок скилла: $(wc -l < "$ROUND/_skills/analyst-workspace.SKILL.md") строк, рефов: $(ls "$ROUND/_skills/analyst-workspace.reference" 2>/dev/null | wc -l)"
else
  echo "снимок уже есть — прогон читает ЕГО ($(wc -l < "$ROUND/_skills/analyst-workspace.SKILL.md") строк)"
fi

# Имя фикстуры в пути обязательно: две фикстуры одного раунда, запущенные параллельно, иначе делят
# снимок, и та, что кончила первой, сносит его из-под второй (`rm -rf "$SNAP"` в конце). 2026-10-06.
SNAP="/tmp/gui-skills/$(basename "$ROUND")-$FIX_NAME"
rm -rf "$SNAP"; mkdir -p "$SNAP/analyst-workspace"
cp "$ROUND/_skills/analyst-workspace.SKILL.md" "$SNAP/analyst-workspace/SKILL.md"
[ -d "$ROUND/_skills/analyst-workspace.reference" ] && cp -r "$ROUND/_skills/analyst-workspace.reference" "$SNAP/analyst-workspace/reference"
SNAP_WIN="$(cd "$SNAP" && { pwd -W 2>/dev/null || pwd; })"

TPL="$HERE/stand-gui/prompt.md"
[ -f "$FIX/prompt.md" ] && TPL="$FIX/prompt.md"
[ -f "$TPL" ] || { echo "нет промпта: $TPL"; exit 1; }
[ -f "$FIX/task.txt" ] || { echo "нет task.txt в фикстуре"; exit 1; }

OUT="$ROUND/$FIX_NAME"; mkdir -p "$OUT"
SBROOT="/tmp/gui-sb/$(basename "$ROUND")/$FIX_NAME"
mkdir -p "$SBROOT"
STAMP="$SBROOT/.stamp"; : > "$STAMP"

run_one() {
  local i="$1" dst="$OUT/run-$i" sb="$SBROOT/run-$i"
  if [ -s "$dst/answer.md" ]; then echo "  run-$i — уже есть, пропуск"; return 0; fi
  rm -rf "$sb"; mkdir -p "$sb"
  bash "$FIX/seed.sh" "$sb/w" > "$sb/_seed.log" 2>&1 || { echo "  run-$i — засев не собрался"; return 0; }
  local abs; abs="$(cd "$sb/w" && { pwd -W 2>/dev/null || pwd; })"
  if [ -d "$FIX/stubs" ]; then mkdir -p "$sb/w/.claude/skills"; cp -r "$FIX/stubs"/* "$sb/w/.claude/skills/"; fi
  local task
  task="$(awk 'FNR==NR{t=t $0 ORS; next} /^TASKTEXT$/{printf "%s", t; next} {print}' "$FIX/task.txt" "$TPL" \
        | sed -e "s|WORKDIR|$abs|g" -e "s|SKILLDIR|$SNAP_WIN|g")"
  ( cd "$sb/w" && timeout 1800 claude -p "$task" --model "$SM_MODEL" --permission-mode bypassPermissions ) \
      > "$sb/answer.md" 2> "$sb/_stderr.log"
  local rc=$?
  if grep -qiE "API Error|Please run /login|Credit balance|rate limit|session limit|usage limit" "$sb/answer.md" 2>/dev/null; then
    mkdir -p "$dst"; mv "$sb/answer.md" "$dst/_api-failure.txt"; echo "  run-$i — ОТКАЗ API, в счёт не идёт"; return 0
  fi
  if [ -n "$(find "$FIX/coddoc" -newer "$STAMP" -type f 2>/dev/null | head -1)" ]; then
    echo "  run-$i — ⚠ ФИКСТУРА ТРОНУТА"
  fi
  mkdir -p "$dst"
  cp "$sb/answer.md" "$dst/answer.md" 2>/dev/null || true
  cp "$sb/_stderr.log" "$dst/_stderr.log" 2>/dev/null || true
  cp "$sb/w/_trace.log" "$dst/_trace.log" 2>/dev/null || true
  ( cd "$sb" && find w -type f | sort ) > "$dst/_files.txt" 2>/dev/null || true
  if [ $rc -ne 0 ] || [ ! -s "$dst/answer.md" ]; then echo "  run-$i — ОТКАЗ (rc=$rc)"; else echo "  run-$i — готов"; fi
}

# Модель — как у run-ctx-v2.sh: `SM_MODEL=claude-haiku-5-5 ./run-gui.sh …`; пусто → claude-sonnet-5 (модель стенда, INDEX.md); псевдоним — отказ (model-id.sh).
echo "модель: $SM_MODEL" > "$OUT/_settings.txt"
echo "фикстура: $FIX_NAME   прогонов: $N   скилл: $SKILL_SRC   модель: $SM_MODEL"
r=0; for i in $(seq -w 1 "$N"); do run_one "$i" & r=$((r+1)); [ "$r" -ge "$CONC" ] && { wait -n 2>/dev/null || wait; r=$((r-1)); }; done; wait
echo "ГОТОВО: $(find "$OUT" -maxdepth 2 -name answer.md -size +0 | wc -l) из $N"
rm -rf "$SNAP"
