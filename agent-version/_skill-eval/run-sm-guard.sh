#!/usr/bin/env bash
# run-sm-guard.sh <SKILL.md> <папка-раунда> [N] — изолированная проба гарда-маршрутизатора (фикстура SM-GUARD).
# Текст гарда вырезается из УКАЗАННОГО SKILL.md по якорям; прогон без инструментов получает его и один
# случай (перечни ключей по классам) и обязан ответить последней строкой `ГАРД: ПОВЕРХ` либо `ГАРД: В _pending`.
# SM_GUARD_ONLY="cut-33-of-48 task-1-of-2" — гонять только названные случаи.
set -u
SKILL="${1:?путь к SKILL.md}"; ROUND="${2:?папка раунда}"; N="${3:-3}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; FIX="${SM_FIX:-$HERE/fixtures/SM-GUARD}"; OUT="$ROUND/${SM_OUT:-sm-guard}"
. "$HERE/model-id.sh"
MODEL="$(model_id "${SM_MODEL:-}" claude-sonnet-5)" || exit 2
ln() { grep -n -m1 -- "$1" "$SKILL" | cut -d: -f1; }
G1=$(ln '^\*\*Гард на утоньшение — маршрутизатор'); G2=$(ln '^\*\*Продвижение — копия черновика')
for x in "$G1" "$G2"; do [ -n "$x" ] || { echo "не нашёл якорь гарда в $SKILL" >&2; exit 1; }; done
mkdir -p "$OUT"; cp "$SKILL" "$OUT/_skill-snapshot.md"
printf 'модель: %s\nпрогонов на случай: %s\nякоря: гард %s–%s\n' "$MODEL" "$N" "$G1" "$G2" > "$OUT/_settings.txt"
for c in "$FIX"/case-*.md; do
  v="$(basename "$c" .md)"; v="${v#case-}"
  if [ -n "${SM_GUARD_ONLY:-}" ]; then case " $SM_GUARD_ONLY " in *" $v "*) ;; *) continue ;; esac; fi
  mkdir -p "$OUT/$v"
  {
    echo 'Ты — ведущий агент скилла `service-map` на Шаге 4. Черновик карточки прошёл проверки, и перед продвижением ты считаешь гард на утоньшение. Ниже — правило гарда из твоего скилла, дословно, и перечни ключей, которые дали грепы.'
    echo; echo '### Гард (Шаг 4)'; echo; sed -n "${G1},$((G2-1))p" "$SKILL"
    echo; echo '---'; echo; cat "$c"; echo
    echo 'Посчитай гард по правилу выше: по каждому классу назови было / исчезло / появилось и сработал ли порог. Последней строкой ответа — ровно одно из двух: `ГАРД: ПОВЕРХ` либо `ГАРД: В _pending`.'
  } > "$OUT/$v/prompt.md"
  for i in $(seq 1 "$N"); do
    ( cd "$OUT/$v" && claude -p --model "$MODEL" --output-format json < prompt.md > "out-$i.json" 2> "err-$i.log"
      node -e 'const fs=require("fs");let j={};try{j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"))}catch(e){};fs.writeFileSync(process.argv[2],j.result||"");fs.writeFileSync(process.argv[3],String(j.total_cost_usd||0))' "out-$i.json" "answer-$i.md" "cost-$i.txt"; rm -f "out-$i.json" ) &
  done
  wait
  echo "  $v — готов"
done
echo "ГОТОВО: $OUT"
