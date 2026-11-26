#!/usr/bin/env bash
# run-sm-adv-iso.sh <SKILL.md> <папка-раунда> [N] — изолированные адверсарные пробы SM-ADV (без инструментов).
#
# Группы лежат в fixtures/SM-ADV/iso/<группа>/: case-*.md + prompt.json (что вырезать из SKILL.md или
# reference/keyed-update.md по якорям, вступление, вопрос) + expect.json (ожидания). Текст скилла режется
# из УКАЗАННОГО SKILL.md — меряется именно эта редакция; keyed-update.md берётся рядом с ним.
# SM_ADV_GROUPS="guard mgate" — только названные группы; SM_ADV_ONLY="norm-case deps-3-of-3" — только случаи.
# SM_ADV_DRY=1 — только собрать prompt.md, claude не вызывать (проверка якорей).
# Выход: <раунд>/sm-adv-iso/<группа>/<случай>/{prompt.md,answer-N.md,cost-N.txt}. Грейдер: grade-sm-adv-iso.mjs.
set -u
SKILL="${1:?путь к SKILL.md}"; ROUND="${2:?папка раунда}"; N="${3:-3}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; FIX="$HERE/fixtures/SM-ADV/iso"; OUT="$ROUND/sm-adv-iso"
KEYED="$(dirname "$SKILL")/reference/keyed-update.md"
. "$HERE/model-id.sh"
MODEL="$(model_id "${SM_MODEL:-}" claude-sonnet-5)" || exit 2
[ -f "$SKILL" ] || { echo "нет $SKILL" >&2; exit 1; }
[ -f "$KEYED" ] || { echo "нет $KEYED" >&2; exit 1; }
mkdir -p "$OUT"; cp "$SKILL" "$OUT/_skill-snapshot.md"; cp "$KEYED" "$OUT/_keyed-snapshot.md"
printf 'модель: %s\nпрогонов на случай: %s\n' "$MODEL" "$N" > "$OUT/_settings.txt"

jq_() { node -e 'const p=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const v=process.argv[2].split(".").reduce((a,k)=>a==null?a:a[k],p);process.stdout.write(v==null?"":(typeof v==="string"?v:JSON.stringify(v)))' "$1" "$2"; }
cut_() { # cut_ <файл> <от-якоря> <до-якоря>  — BRE, как в run-sm-gate.sh
  local f="$1" a b; a=$(grep -n -m1 -- "$2" "$f" | cut -d: -f1); b=$(grep -n -m1 -- "$3" "$f" | cut -d: -f1)
  [ -n "$a" ] && [ -n "$b" ] || { echo "не нашёл якорь в $f: «$2» → $a, «$3» → $b" >&2; return 1; }
  sed -n "${a},$((b-1))p" "$f"
}

for gdir in "$FIX"/*/; do
  g="$(basename "$gdir")"
  if [ -n "${SM_ADV_GROUPS:-}" ]; then case " $SM_ADV_GROUPS " in *" $g "*) ;; *) continue ;; esac; fi
  P="$gdir/prompt.json"; [ -f "$P" ] || continue
  intro="$(jq_ "$P" intro)"; question="$(jq_ "$P" question)"
  ncuts=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).cuts.length)' "$P")
  for c in "$gdir"/case-*.md; do
    v="$(basename "$c" .md)"; v="${v#case-}"
    if [ -n "${SM_ADV_ONLY:-}" ]; then case " $SM_ADV_ONLY " in *" $v "*) ;; *) continue ;; esac; fi
    mkdir -p "$OUT/$g/$v"
    {
      echo "$intro"
      i=0
      while [ "$i" -lt "$ncuts" ]; do
        file="$(jq_ "$P" "cuts.$i.file")"; title="$(jq_ "$P" "cuts.$i.title")"; from="$(jq_ "$P" "cuts.$i.from")"; to="$(jq_ "$P" "cuts.$i.to")"
        src="$SKILL"; [ "$file" = keyed ] && src="$KEYED"
        echo; echo "### $title"; echo
        cut_ "$src" "$from" "$to" || { echo "  $g/$v — якорь не найден, случай пропущен"; continue 2; }
        i=$((i+1))
      done
      echo; echo '---'; echo; cat "$c"; echo
      [ -n "$question" ] && echo "$question"
    } > "$OUT/$g/$v/prompt.md"
    if [ -n "${SM_ADV_DRY:-}" ]; then echo "  $g/$v — промпт собран ($(wc -l < "$OUT/$g/$v/prompt.md") строк), сухой режим"; continue; fi
    for i in $(seq 1 "$N"); do
      ( cd "$OUT/$g/$v" && claude -p "$(cat prompt.md)" --model "$MODEL" --output-format json > "out-$i.json" 2> "err-$i.log"
        node -e 'const fs=require("fs");let j={};try{j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"))}catch(e){};fs.writeFileSync(process.argv[2],j.result||"");fs.writeFileSync(process.argv[3],String(j.total_cost_usd||0))' "out-$i.json" "answer-$i.md" "cost-$i.txt"; rm -f "out-$i.json" ) &
    done
    wait
    echo "  $g/$v — готов"
  done
done
echo "ГОТОВО: $OUT"
