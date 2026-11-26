#!/usr/bin/env bash
# run-sm-gate.sh <SKILL.md> <папка-раунда> [N] — изолированная проба гейта «Бизнес-правила» (фикстура SM-GATE).
# Текст скилла про секцию вырезается из УКАЗАННОГО SKILL.md по якорям: плечо «до» собирается из
# снимка (`git show <commit>:…`), плечо «после» — из живого файла. Инструментов прогон не получает.
# SM_GATE_ONLY="g clean" — гонять только названные варианты (плечо «до» под один двойник).
set -u
SKILL="${1:?путь к SKILL.md}"; ROUND="${2:?папка раунда}"; N="${3:-3}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; FIX="${SM_FIX:-$HERE/fixtures/SM-GATE}"; OUT="$ROUND/${SM_OUT:-sm-gate}"
. "$HERE/model-id.sh"
MODEL="$(model_id "${SM_MODEL:-}" claude-sonnet-5)" || exit 2
ln() { grep -n -m1 -- "$1" "$SKILL" | cut -d: -f1; }
B1=$(ln '^Ты — читающий субагент скилла'); B2=$(ln '^Ни чисел, ни пересказа')
O1=$(ln '^## Опись → файл'); O2=$(ln '^## Прежняя карточка')
G1=$(ln '^- \*\*Бизнес-правила ('); G2=$(ln '^- \*\*Хвост-файл (')   # метка в скобках менялась: ГЕЙТ до 3.0.6, проверка с 3.0.7
U1=$(ln '^**Бюджет: не больше двух прогонов'); U2=$(ln '^**Вторая попытка не помогла')
for x in "$B1" "$B2" "$O1" "$O2" "$G1" "$G2" "$U1" "$U2"; do [ -n "$x" ] || { echo "не нашёл якорь в $SKILL" >&2; exit 1; }; done
mkdir -p "$OUT"; cp "$SKILL" "$OUT/_skill-snapshot.md"
printf 'модель: %s\nпрогонов на вариант: %s\nякоря: бриф %s–%s, опись %s–%s, гейт %s–%s, бюджет %s–%s\n' "$MODEL" "$N" "$B1" "$B2" "$O1" "$O2" "$G1" "$G2" "$U1" "$U2" > "$OUT/_settings.txt"
for ans in "$FIX"/answer-*.md; do
  v="$(basename "$ans" .md)"; v="${v#answer-}"
  if [ -n "${SM_GATE_ONLY:-}" ]; then case " $SM_GATE_ONLY " in *" $v "*) ;; *) continue ;; esac; fi
  mkdir -p "$OUT/$v"
  {
    echo 'Ты — ведущий агент скилла `service-map` на Шаге 4: субагент вернул ответ по сервису, и перед записью карточки ты прогоняешь гейт «Бизнес-правила». Ниже — всё, что твой скилл говорит про эту секцию, дословно.'
    echo; echo '### Из брифа субагенту (Шаг 3)'; echo; sed -n "${B1},$((B2-1))p" "$SKILL"
    echo; echo '### Правила описи (Шаг 3)'; echo; sed -n "${O1},$((O2-1))p" "$SKILL"
    echo; echo '### Гейт (Шаг 4)'; echo; sed -n "${G1},$((G2-1))p" "$SKILL"
    if [ -n "${SM_GATE_EXTRA_FROM:-}" ] && [ -n "${SM_GATE_EXTRA_TO:-}" ]; then
      X1=$(ln "$SM_GATE_EXTRA_FROM"); X2=$(ln "$SM_GATE_EXTRA_TO")
      [ -n "$X1" ] && [ -n "$X2" ] && { echo; echo '### Проверки рядом с гейтом (Шаг 4)'; echo; sed -n "${X1},$((X2-1))p" "$SKILL"; }
    fi
    echo; echo '### Бюджет доборов'; echo; sed -n "${U1},$((U2-1))p" "$SKILL"
    echo; echo '---'; echo; cat "$ans"; echo
    echo 'Прогони гейт «Бизнес-правила» по этому ответу. По каждому из пяти чисел напиши одной-двумя строками, что с чем сравнил и сошлось ли. Последней строкой ответа — ровно одно из двух: `ГЕЙТ: ПРОЙДЕН` либо `ГЕЙТ: ДОБОР — <что именно потребуешь у субагента>`.'
  } > "$OUT/$v/prompt.md"
  for i in $(seq 1 "$N"); do
    ( cd "$OUT/$v" && claude -p --model "$MODEL" --output-format json < prompt.md > "out-$i.json" 2> "err-$i.log"
      node -e 'const fs=require("fs");let j={};try{j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"))}catch(e){};fs.writeFileSync(process.argv[2],j.result||"");fs.writeFileSync(process.argv[3],String(j.total_cost_usd||0))' "out-$i.json" "answer-$i.md" "cost-$i.txt"; rm -f "out-$i.json" ) &
  done
  wait
  echo "  $v — готов"
done
echo "ГОТОВО: $OUT"
