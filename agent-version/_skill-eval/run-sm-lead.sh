#!/usr/bin/env bash
# run-sm-lead.sh <SKILL.md> <папка-раунда> [N] — изолированная проба решений ведущего на Шаге 3.4
# (фикстура SM-FIELD/LEAD: обрыв субагента, второй обрыв, текст добора). Прогон без инструментов
# получает раздел 3.4 из SKILL.md целиком (по якорям) и один случай; последняя строка ответа —
# `ДЕЙСТВИЕ: …` либо `ДОБОР: …`, как велит случай. Грейдит `fixtures/SM-FIELD/grade-sm-field.mjs lead`.
# SM_FIX — папка со случаями (по умолчанию fixtures/SM-FIELD/LEAD); SM_LEAD_ONLY="dobor-brief".
set -u
SKILL="${1:?путь к SKILL.md}"; ROUND="${2:?папка раунда}"; N="${3:-3}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; FIX="${SM_FIX:-$HERE/fixtures/SM-FIELD/LEAD}"; OUT="$ROUND/${SM_OUT:-sm-lead}"
. "$HERE/model-id.sh"
MODEL="$(model_id "${SM_MODEL:-}" claude-sonnet-5)" || exit 2
ln() { grep -n -m1 -- "$1" "$SKILL" | cut -d: -f1; }
L1=$(ln '^#### 3\.4 После возврата'); L2=$(ln '^### Шаг 4')
for x in "$L1" "$L2"; do [ -n "$x" ] || { echo "не нашёл якорь 3.4 в $SKILL" >&2; exit 1; }; done
mkdir -p "$OUT"; cp "$SKILL" "$OUT/_skill-snapshot.md"
printf 'модель: %s\nпрогонов на случай: %s\nякоря: 3.4 %s–%s\n' "$MODEL" "$N" "$L1" "$L2" > "$OUT/_settings.txt"
for c in "$FIX"/case-*.md; do
  v="$(basename "$c" .md)"; v="${v#case-}"
  if [ -n "${SM_LEAD_ONLY:-}" ]; then case " $SM_LEAD_ONLY " in *" $v "*) ;; *) continue ;; esac; fi
  mkdir -p "$OUT/$v"
  {
    echo 'Ты — ведущий агент скилла `service-map`. Ниже — раздел 3.4 твоего скилла дословно, затем ситуация, в которой ты находишься. Действуй строго по разделу.'
    echo; echo '### Шаг 3.4 — После возврата (из SKILL.md)'; echo; sed -n "${L1},$((L2-1))p" "$SKILL"
    echo; echo '---'; echo; cat "$c"; echo
  } > "$OUT/$v/prompt.md"
  for i in $(seq 1 "$N"); do
    ( cd "$OUT/$v" && claude -p --model "$MODEL" --output-format json < prompt.md > "out-$i.json" 2> "err-$i.log"
      node -e 'const fs=require("fs");let j={};try{j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"))}catch(e){};fs.writeFileSync(process.argv[2],j.result||"");fs.writeFileSync(process.argv[3],String(j.total_cost_usd||0))' "out-$i.json" "answer-$i.md" "cost-$i.txt"; rm -f "out-$i.json" ) &
  done
  wait
  echo "  $v — готов"
done
echo "ГОТОВО: $OUT"
