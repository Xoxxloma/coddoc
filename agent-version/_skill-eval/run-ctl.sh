#!/usr/bin/env bash
# run-ctl.sh — КОНТРОЛЬНОЕ плечо: та же фикстура, та же модель, тот же пул, но БЕЗ скилла.
#
#   ./run-ctl.sh <фикстура> <промпт.txt> <папка-раунда> <плечо> <N> [параллельность]
#
# Зачем. Возражение «эти дыры и обычный агент найдёт» проверяется замером, а не спором. Без
# контрольного числа отчёт скилла нечем сравнить: «нашёл шесть дыр» звучит одинаково и для скилла,
# который научил модель их искать, и для модели, которая нашла бы их и так. Контроль ставит под
# число знаменатель.
#
# Обёртка здесь — копия `run-pool-ctx.sh` с ВЫРЕЗАННЫМ абзацем про скилл и ничем больше. Это не
# аккуратность, а условие сопоставимости: `RUNNER.md` и `INDEX.md` (правило 0) фиксируют, что
# обёртка — часть измеряемого, и одна лишняя строка в ней однажды отменила запись файла у половины
# прогонов. Контроль, отличающийся от плеча скилла двумя вещами, не измеряет ни одной.
#
# Поэтому же контроль НЕ живёт веткой в `run-ctx.sh`: тот вызывает общий `run-pool-ctx.sh`, на
# котором стоят числа всех проб петли, и делать в нём скилл необязательным — правка общей обёртки
# ради одного разового замера.

set -u

FIXTURE="${1:-}"
PROMPT_FILE="${2:-}"
ROUND="${3:-}"
ARM="${4:-}"
N="${5:-3}"
CONC="${6:-3}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/model-id.sh"
SM_MODEL="$(model_id "${SM_MODEL:-}" claude-sonnet-5)" || exit 2

[ -n "$FIXTURE" ] && [ -n "$PROMPT_FILE" ] && [ -n "$ROUND" ] && [ -n "$ARM" ] || {
  echo "usage: ./run-ctl.sh <фикстура> <промпт.txt> <папка-раунда> <плечо> <N> [параллельность]"
  echo "пример: ./run-ctl.sh SR-GAP ctl-prompt.txt runs/2026-08-17-sr-r0 sr-gap-ctl 3"
  exit 1
}

FIXTURE_DIR="$HERE/fixtures/$FIXTURE"
PROMPT="$FIXTURE_DIR/$PROMPT_FILE"
[ -d "$FIXTURE_DIR" ] || { echo "нет фикстуры: $FIXTURE_DIR"; exit 1; }
[ -f "$PROMPT" ]      || { echo "нет промпта: $PROMPT"; exit 1; }
PROMPT="$(cd "$(dirname "$PROMPT")" && pwd)/$(basename "$PROMPT")"

mkdir -p "$ROUND"
if [ ! -f "$ROUND/_commit.txt" ]; then
  { git -C "$HERE" rev-parse HEAD 2>/dev/null || echo "нет git"; } > "$ROUND/_commit.txt"
  if [ -n "$(git -C "$HERE" status --porcelain 2>/dev/null)" ]; then
    echo "рабочее дерево грязное — источник истины это фикстура и этот файл" >> "$ROUND/_commit.txt"
  fi
fi

# ─── Караул фикстуры ДО прогона ────────────────────────────────────────────────────────────
# Тот же, что в `run-ctx.sh`, и той же командой: манифест обязан получаться одинаково у обоих
# раннеров, иначе они будут по очереди объявлять фикстуру испорченной.
MANIFEST="$FIXTURE_DIR/_manifest.txt"
CURRENT="$(cd "$FIXTURE_DIR" && find . -type f -not -name '_manifest.txt' | sed 's|^\./||' | sort)"
if [ -f "$MANIFEST" ]; then
  if ! printf '%s\n' "$CURRENT" | diff -q - "$MANIFEST" >/dev/null 2>&1; then
    echo "!!! СОСТАВ ФИКСТУРЫ $FIXTURE НЕ СОВПАДАЕТ С МАНИФЕСТОМ — прогон не запускался."
    printf '%s\n' "$CURRENT" | diff - "$MANIFEST" | head -20
    exit 1
  fi
else
  printf '%s\n' "$CURRENT" > "$MANIFEST"
  echo "манифест фикстуры заведён: $MANIFEST"
fi

# Засев вне репозитория — см. длинное обоснование в `run-ctx.sh`.
SEED_ROOT="${SKILL_EVAL_SEED_ROOT:-/tmp/skill-eval-seed}"
SEED="$SEED_ROOT/$(basename "$ROUND")-$ARM"
rm -rf "$SEED"; mkdir -p "$SEED"
# `expected.md` исключён 2026-08-18: контроль сеял фикстуру целиком, и ключ ответов приехал в
# песочницу всех 12 прогонов `bg-flick-ctl` — плечо выброшено и переснято. Тот же список живёт в
# `run-ctx.sh`, причём ДВАЖДЫ (исключения tar и фильтр караула). Добавляешь имя — правь три места.
( cd "$FIXTURE_DIR" && tar cf - --exclude=README.md --exclude='*-prompt.txt' --exclude=_manifest.txt --exclude=expected.md . ) \
  | ( cd "$SEED" && tar xf - )
SEED="$(cd "$SEED" && pwd)"

OUT="$ROUND/$ARM"
mkdir -p "$OUT"

is_api_failure() {
  local f="$1"
  local size; size=$(wc -c < "$f")
  if [ "$size" -lt 600 ]; then
    grep -qiE "API Error|Request not allowed|Please run /login|Credit balance|rate limit|session limit|usage limit" "$f"
  else
    head -c 200 "$f" | grep -qiE "API Error|Request not allowed|Please run /login|Credit balance|rate limit|session limit|usage limit"
  fi
}

SEED_FILES="$(cd "$SEED" && find . -type f | sed 's|^\./||' | sort | tr '\n' ' ')"

run_one() {
  local i="$1"
  local sb="$OUT/run-$i"
  if [ -e "$OUT/_STOP" ]; then echo "  run-$i — СТОП, плечо остановлено"; return 0; fi
  mkdir -p "$sb"
  if [ -s "$sb/answer.md" ]; then echo "  run-$i — уже есть, пропуск"; return 0; fi
  local abs_sb; abs_sb="$(cd "$sb" && pwd)"

  local now; now="$(cd "$SEED" && find . -type f | sed 's|^\./||' | sort | tr '\n' ' ')"
  if [ "$now" != "$SEED_FILES" ]; then
    echo "  run-$i — ЗАСЕВ ИСПОРЧЕН, плечо остановлено"
    echo "    было: $SEED_FILES"
    echo "    стало: $now"
    touch "$OUT/_STOP"
    return 1
  fi
  cp -r "$SEED"/. "$abs_sb"/ 2>/dev/null
  ( cd "$abs_sb" && find . -type f -not -name '_seeded.txt' | sed 's|^\./||' | sort ) > "$abs_sb/_seeded.txt"

  # ОБЁРТКА КОНТРОЛЯ. Отличие от `run-pool-ctx.sh` ровно одно: вырезан абзац «Прочитай целиком
  # файл <скилл> … действуй строго по нему». Остальные три абзаца слово в слово те же.
  local task="Твоя рабочая директория — ${abs_sb}. Считай её корнем рабочего репозитория. Ничего за её пределами не создавай и не изменяй: путь, ведущий наружу, — ошибка сборки пути, а не повод писать туда.

Интерактивного инструмента вопросов (AskUserQuestion) в этом окружении нет. Если нужно задать вопросы — задавай их обычным текстом.

Сообщение пользователя лежит в файле ${PROMPT}. Прочитай его и отработай."

  ( cd "$sb" && timeout 900 claude -p "$task" --model "$SM_MODEL" --permission-mode bypassPermissions ) \
      > "$sb/answer.md" 2> "$sb/_stderr.log"
  local rc=$?

  if [ -s "$sb/answer.md" ] && is_api_failure "$sb/answer.md"; then
    mv "$sb/answer.md" "$sb/_api-failure.txt"
    echo "  run-$i — ОТКАЗ API, песочница помечена и в счёт не идёт"
    return 0
  fi
  if [ $rc -ne 0 ]; then
    echo "  run-$i — ОТКАЗ (rc=$rc), см. $sb/_stderr.log"
  else
    echo "  run-$i — готов"
  fi
}

echo "КОНТРОЛЬ БЕЗ СКИЛЛА"
echo "плечо: $OUT"
echo "фикстура: $FIXTURE"
echo "промпт: $PROMPT"
echo "прогонов: $N, параллельно: $CONC"

running=0
for i in $(seq -w 1 "$N"); do
  run_one "$i" &
  running=$((running + 1))
  if [ "$running" -ge "$CONC" ]; then wait -n 2>/dev/null || wait; running=$((running - 1)); fi
done
wait

echo "ГОТОВО: $OUT — песочниц с ответом: $(find "$OUT" -name answer.md -size +0 | wc -l) из $N"
