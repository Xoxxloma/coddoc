#!/usr/bin/env bash
# run-sm-slice-lead.sh <SKILL.md> <папка-раунда> [N] — изолированные случаи решений ведущего при нарезке
# (фикстура SM-SLICE-LEAD, service-map-2.0, задача Б плана PLAN-AUTOSPLIT: критерии Б-1 и §4.5).
# Из УКАЗАННОГО SKILL.md по якорям вырезается от «#### 3.0 Разведчик» до первого «### Шаг 5» после него
# (Шаг 3 целиком и Шаг 4); проверяется, что внутри есть «#### 3.1 Маркерный счёт», «#### 3.2 Запуск»,
# «#### 3.4 После возврата», «#### 3.5 Большой сервис», «### Шаг 4». В разделе 3.5 вырезки подстроки
# «K = <целое>» и «w = <число>» (ровно по одной) подменяются на K = 80 и w = 0.5: числа случаев посчитаны
# под них. Прогон без инструментов (--tools "", MCP выключены) получает вырезку и один случай; формат
# ответа задан в конце промпта, последняя строка — «РЕШЕНИЕ: …». Грейдит grade-sm-slice-lead.mjs.
# Переменные: SM_MODEL (sonnet), SM_SLICE_ONLY="a-under-k f-dobor-part" — только названные случаи,
# SM_SLICE_DRY=1 — собрать промпты, claude не звать; SM_FIX, SM_OUT (sm-slice-lead).
set -u
SKILL="${1:?путь к SKILL.md}"; ROUND="${2:?папка раунда}"; N="${3:-3}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; FIX="${SM_FIX:-$HERE/fixtures/SM-SLICE-LEAD}"
MODEL="${SM_MODEL:-sonnet}"
[ -f "$SKILL" ] || { echo "нет файла $SKILL" >&2; exit 1; }
mkdir -p "$ROUND"; ROUND="$(cd "$ROUND" && pwd)"; OUT="$ROUND/${SM_OUT:-sm-slice-lead}"
K_CASE=80; W_CASE=0.5

ln() { grep -n -m1 -- "$1" "$SKILL" | cut -d: -f1; }
after() { grep -n -- "$2" "$SKILL" | awk -F: -v s="$1" '$1>s{print $1; exit}'; }
need() { [ -n "$2" ] || { echo "не нашёл якорь «$1» в $SKILL" >&2; exit 1; }; }
R30=$(ln '^#### 3\.0 Разведчик'); need '#### 3.0 Разведчик' "$R30"
S5=$(after "$R30" '^### Шаг 5'); need '### Шаг 5 (после 3.0)' "$S5"
for a in '^#### 3\.1 Маркерный счёт' '^#### 3\.2 Запуск' '^#### 3\.4 После возврата' '^#### 3\.5 Большой сервис' '^### Шаг 4'; do
  L=$(after "$R30" "$a"); need "$a" "$L"
  [ "$L" -lt "$S5" ] || { echo "якорь «$a» ($L) не внутри 3.0…Шаг 5 ($R30…$S5)" >&2; exit 1; }
done

mkdir -p "$OUT"; cp "$SKILL" "$OUT/_skill-snapshot.md"
# вырезка + подмена K и w только в разделе 3.5 (до следующего заголовка ##/###/####)
sed -n "${R30},$((S5-1))p" "$SKILL" > "$OUT/_excerpt-raw.md"
awk -v K="$K_CASE" -v W="$W_CASE" '
  /^#### 3\.5 Большой сервис/ { in35 = 1; print; next }
  in35 && /^#{2,4} / { in35 = 0 }
  in35 { nk += gsub(/K = [0-9]+/, "K = " K); nw += gsub(/w = [0-9]+([.,][0-9]+)?/, "w = " W) }
  { print }
  END { if (nk != 1 || nw != 1) { printf "в разделе 3.5 подстрок «K = <целое>»: %d, «w = <число>»: %d — нужно ровно по одной\n", nk, nw > "/dev/stderr"; exit 3 } }
' "$OUT/_excerpt-raw.md" > "$OUT/_excerpt.md" || { echo "подмена K и w не удалась — пул не запускаю" >&2; exit 1; }
{
  echo "модель: $MODEL"
  echo "прогонов на случай: $N"
  echo "вырезка: строки ${R30}–$((S5-1)) ($(wc -l < "$OUT/_excerpt.md") строк); в 3.5 подменено K = $K_CASE, w = $W_CASE"
  echo "инструменты прогона: нет (--tools \"\"), MCP выключены"
} > "$OUT/_settings.txt"
cat "$OUT/_settings.txt"

for c in "$FIX"/case-*.md; do
  v="$(basename "$c" .md)"; v="${v#case-}"
  if [ -n "${SM_SLICE_ONLY:-}" ]; then case " $SM_SLICE_ONLY " in *" $v "*) ;; *) continue ;; esac; fi
  mkdir -p "$OUT/$v"
  {
    echo 'Ты — ведущий агент скилла `service-map`. Ниже из твоего скилла дословно: Шаг 3 от раздела 3.0 до конца и Шаг 4. Затем — состояние прогона по одному сервису. Инструментов у тебя в этом разборе нет: ни кода, ни рабочих файлов ты не открываешь — только эти строки и числа. Реши, что ты делаешь дальше.'
    echo; echo '### Шаг 3 (от 3.0) и Шаг 4 (из SKILL.md)'; echo; cat "$OUT/_excerpt.md"
    echo; echo '---'; echo; cat "$c"; echo
    echo 'Реши по правилам выше, что ты делаешь дальше. Ответ — в таком виде:'
    echo '1. Разбор: что видишь и какое правило из текста выше применяешь — коротко.'
    echo '2. Действия по порядку, каждое отдельной строкой, начиная с `ДЕЙСТВИЕ:` (кого запускаешь и с чем, какой скрипт, что пишешь). Действий нет — ни одной такой строки.'
    echo '3. Строки в отчёт человеку — каждая отдельно, начиная с `ОТЧЁТ:`. Не велят правила — ни одной.'
    if [ -f "$FIX/verdicts.txt" ]; then cat "$FIX/verdicts.txt"   # у фикстуры свой список вердиктов (SM-SLICE-LEAD-2)
    else echo '4. Последней строкой — ровно одно из: `РЕШЕНИЕ: ОДИН ЧИТАЮЩИЙ`, `РЕШЕНИЕ: НАРЕЗКА`, `РЕШЕНИЕ: ДОБОР — <кому: часть NN | остаток | голова | читающий>`, `РЕШЕНИЕ: СКЛЕЙКА ЗАНОВО`, `РЕШЕНИЕ: ПРОДВИЖЕНИЕ`, `РЕШЕНИЕ: КАРТОЧКУ НЕ ПИСАТЬ`.'; fi
  } > "$OUT/$v/prompt.md"
  if [ -n "${SM_SLICE_DRY:-}" ]; then echo "  $v — промпт собран ($(wc -l < "$OUT/$v/prompt.md") строк), сухой режим"; continue; fi
  for i in $(seq 1 "$N"); do
    [ -s "$OUT/$v/answer-$i.md" ] && { echo "  $v/$i — уже есть, пропуск"; continue; }
    ( cd "$OUT/$v" && ENABLE_CLAUDEAI_MCP_SERVERS=false claude -p --model "$MODEL" --tools "" --strict-mcp-config --output-format json < prompt.md > "out-$i.json" 2> "err-$i.log"
      node -e 'const fs=require("fs");let j={};try{j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"))}catch(e){};fs.writeFileSync(process.argv[2],j.result||"");fs.writeFileSync(process.argv[3],String(j.total_cost_usd||0))' "out-$i.json" "answer-$i.md" "cost-$i.txt"; rm -f "out-$i.json"
      if grep -qiE "API Error|Request not allowed|Please run /login|Credit balance|rate limit|session limit|usage limit|Overloaded" "answer-$i.md" 2>/dev/null; then mv "answer-$i.md" "_api-failure-$i.txt"; fi ) &
  done
  wait
  echo "  $v — готов"
done
echo "ГОТОВО: $OUT"
echo "грейдер: node $HERE/grade-sm-slice-lead.mjs $OUT"
