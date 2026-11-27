#!/usr/bin/env bash
# run-sm-ent-2.sh <SKILL.md> <папка-раунда> [N] — проба «сущности — сверка сверху» под разведчика
# (фикстура SM-ENT-2, service-map-2.0). Якоря — те же, что у run-sm-ent.sh: маркерный гейт со сверкой сверху
# (от «**Второе — маркерный гейт» до «**Три правила обхода») и «Сущности у ручек» (один буллет).
# Прогон без инструментов получает их и один случай; последняя строка — `СУЩНОСТИ: ПРОЙДЕН` либо
# `СУЩНОСТИ: ДОБОР`. Грейдит `grade-sm-ent-2.mjs <раунд>/sm-ent-2`.
# SM_ENT_ONLY="navigator-18-dto-0-markers" — гонять только названные случаи; SM_FIX, SM_OUT, SM_MODEL — как у run-sm-ent.sh.
set -u
SKILL="${1:?путь к SKILL.md}"; ROUND="${2:?папка раунда}"; N="${3:-3}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; FIX="${SM_FIX:-$HERE/fixtures/SM-ENT-2}"; OUT="$ROUND/${SM_OUT:-sm-ent-2}"
MODEL="${SM_MODEL:-sonnet}"
[ -f "$SKILL" ] || { echo "нет файла $SKILL" >&2; exit 1; }
ln() { grep -n -m1 -- "$1" "$SKILL" | cut -d: -f1; }
A1=$(ln '^\*\*Второе — маркерный гейт'); A2=$(ln '^\*\*Три правила обхода')
B1=$(ln '^- \*\*Сущности у ручек:\*\*'); B2=$(ln '^- \*\*Порядок элементов:\*\*')
for x in "$A1" "$A2" "$B1" "$B2"; do [ -n "$x" ] || { echo "не нашёл якорь в $SKILL (нужны: **Второе — маркерный гейт, **Три правила обхода, - **Сущности у ручек:**, - **Порядок элементов:**)" >&2; exit 1; }; done
mkdir -p "$OUT"; cp "$SKILL" "$OUT/_skill-snapshot.md"
printf 'модель: %s\nпрогонов на случай: %s\nякоря: гейт %s–%s, сущности у ручек %s–%s\n' "$MODEL" "$N" "$A1" "$A2" "$B1" "$B2" > "$OUT/_settings.txt"
for c in "$FIX"/case-*.md; do
  v="$(basename "$c" .md)"; v="${v#case-}"
  if [ -n "${SM_ENT_ONLY:-}" ]; then case " $SM_ENT_ONLY " in *" $v "*) ;; *) continue ;; esac; fi
  mkdir -p "$OUT/$v"
  {
    echo 'Ты — ведущий агент скилла `service-map` на Шаге 4. Опись сверена сама с собой. Ниже — два правила из твоего скилла дословно: маркерный гейт со сверкой сущностей сверху и проверка «Сущности у ручек», затем строка разведчика по классу «сущности» со счётом твоего грепа по ней и данные грепов по описи и черновику одного сервиса. Кода у тебя нет, черновик ты не открываешь — только эти числа и строки.'
    echo; echo '### Из Шага 4'; echo; sed -n "${A1},$((A2-1))p" "$SKILL"; echo; sed -n "${B1},$((B2-1))p" "$SKILL"
    echo; echo '---'; echo; cat "$c"; echo
    echo 'Реши по этим двум правилам: нужен ли добор по сущностям (сверка сверху или «Сущности у ручек»). Если нужен — напиши текст добора для субагента, как велит правило. Последней строкой ответа — ровно одно из двух: `СУЩНОСТИ: ПРОЙДЕН` либо `СУЩНОСТИ: ДОБОР`.'
  } > "$OUT/$v/prompt.md"
  for i in $(seq 1 "$N"); do
    ( cd "$OUT/$v" && claude -p --model "$MODEL" --output-format json < prompt.md > "out-$i.json" 2> "err-$i.log"
      node -e 'const fs=require("fs");let j={};try{j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"))}catch(e){};fs.writeFileSync(process.argv[2],j.result||"");fs.writeFileSync(process.argv[3],String(j.total_cost_usd||0))' "out-$i.json" "answer-$i.md" "cost-$i.txt"; rm -f "out-$i.json" ) &
  done
  wait
  echo "  $v — готов"
done
echo "ГОТОВО: $OUT"
