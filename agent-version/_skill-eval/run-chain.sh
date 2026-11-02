#!/usr/bin/env bash
# run-chain.sh — цепочка скиллов петли дискавери в одной песочнице: выход стадии k ложится засевом стадии k+1.
#
#   ./run-chain.sh <проба> <папка-раунда> <N> [параллельность]
#
# Зачем: стык «выход одного скилла — вход другого» пробы петли мерили на списках, написанных руками. Здесь
# следующий скилл получает ровно тот файл, что записал предыдущий, без правки.
#
# Фикстура `fixtures/<FIXTURE>/` держит `chain.conf` (bash):
#   STAGES=<число стадий>
#   S<k>_SKILL=<скилл>; S<k>_PROMPT=<файл промпта>; S<k>_TURN2=<файл реплики> | S<k>_TWIN=<карточка двойника>
#   S<k>_TWIN_PROMPT=<twin-analyst.md | twin-objector.md>; S<k>_CAP=<потолок ходов>; S<k>_IDLE=<пустых ходов подряд>
#   S<k>_DONE_RE=<регэксп пути файла> | S<k>_DONE_GREP=<регэксп содержимого coddoc/ и notes/>
#   S<k>_DONE_VAR=<ИМЯ> — конец стадии: путь, подставленный вместо {{ИМЯ}}, появился в coddoc/ или notes/ (строка исходника)
#   S<k>_ADD=<папка фикстуры> — её содержимое ложится в засев стадии поверх выхода прошлой (материал, пришедший позже)
#   VAR_<ИМЯ>='<глоб от корня песочницы>' — {{ИМЯ}} в промпте стадии заменяется найденным путём; найдено не ровно
#   один файл — цепочка рвётся на этой стадии (`_chain-broken.txt`), это поломка пути, а не отказ стенда.
#
# Раскладка: <раунд>/<проба>/run-<i>/stage-<k>/run-1/ — песочница стадии; промпт стадии с подстановкой —
# <раунд>/<проба>/run-<i>/stage-<k>-prompt.txt. Повторный запуск пропускает стадии, у которых есть answer.md.
set -u

PROBE="${1:-}"
ROUND="${2:-}"
N="${3:-3}"
CONC="${4:-3}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
POOL="$HERE/run-pool-ctx-v2.sh"

case "$PROBE" in
  loop-chain) FIXTURE=LOOP-CHAIN ;;
  loop-twice) FIXTURE=LOOP-TWICE ;;
  nb-chain-3) FIXTURE=NB-CHAIN-3 ;;
  nb-chain-spor) FIXTURE=NB-CHAIN-SPOR ;;
  real-apollo) FIXTURE=REAL-APOLLO ;;
  real-apollo-ts) FIXTURE=REAL-APOLLO-TS ;;
  *) echo "неизвестная цепочка: '$PROBE'"; echo "есть: loop-chain loop-twice nb-chain-3 nb-chain-spor real-apollo real-apollo-ts"; exit 1 ;;
esac
[ -n "$ROUND" ] || { echo "usage: ./run-chain.sh <проба> <папка-раунда> <N> [параллельность]"; exit 1; }

FIX="$HERE/fixtures/$FIXTURE"
[ -f "$FIX/chain.conf" ] || { echo "нет $FIX/chain.conf"; exit 1; }
# shellcheck disable=SC1091
. "$FIX/chain.conf"

export RUN_TIMEOUT="${RUN_TIMEOUT:-3600}" SM_MODEL="${SM_MODEL:-claude-sonnet-5}" CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0
. "$HERE/model-id.sh"
. "$HERE/copy-once.sh"
SM_MODEL="$(model_id "$SM_MODEL" claude-sonnet-5)" || exit 2
RT_TWIN_MODEL="$(model_id "${RT_TWIN_MODEL:-}" claude-sonnet-5-5)" || exit 2
export RT_TWIN_MODEL
mkdir -p "$ROUND/_skills" "$ROUND/$PROBE"
ROUND="$(cd "$ROUND" && pwd)"

# Караул фикстуры до прогона — как в run-ctx-v2.sh: состав сверяется с манифестом.
MANIFEST="$FIX/_manifest.txt"
CURRENT="$(cd "$FIX" && find . -type f -not -name '_manifest.txt' | sed 's|^\./||' | sort)"
if [ -f "$MANIFEST" ]; then
  if ! printf '%s\n' "$CURRENT" | diff -q - <(tr -d '\r' < "$MANIFEST") >/dev/null 2>&1; then
    echo "!!! СОСТАВ ФИКСТУРЫ $FIXTURE НЕ СОВПАДАЕТ С МАНИФЕСТОМ — прогон не запускался."
    printf '%s\n' "$CURRENT" | diff - <(tr -d '\r' < "$MANIFEST") | head -20
    exit 1
  fi
else
  printf '%s\n' "$CURRENT" > "$MANIFEST"
  echo "манифест фикстуры заведён: $MANIFEST"
fi

# Снимки скиллов — журнальная копия один раз на раунд, как в run-ctx-v2.sh; прогон читает копию вне
# репозитория — свою на цепочку (проба и PID в имени), и в конце она сносится.
SEED_TMP="/tmp"
command -v cygpath >/dev/null 2>&1 && SEED_TMP="$(cygpath -m /tmp)"
SNAP_ROOT="${SKILL_EVAL_SEED_ROOT:-$SEED_TMP/skill-eval-seed}/$(basename "$ROUND")-$PROBE-$$-skills"
snap() {
  local s="$1"
  copy_once "$HERE/../$s/SKILL.md" "$ROUND/_skills/$s.SKILL.md"
  [ -d "$HERE/../$s/reference" ] && copy_once "$HERE/../$s/reference" "$ROUND/_skills/$s.reference"
  mkdir -p "$SNAP_ROOT/$s"
  cp "$ROUND/_skills/$s.SKILL.md" "$SNAP_ROOT/$s/SKILL.md"
  rm -rf "$SNAP_ROOT/$s/reference"
  [ -d "$ROUND/_skills/$s.reference" ] && cp -r "$ROUND/_skills/$s.reference" "$SNAP_ROOT/$s/reference"
  return 0
}
for k in $(seq 1 "$STAGES"); do eval "snap \"\$S${k}_SKILL\""; done
if [ ! -f "$ROUND/_commit.txt" ]; then
  { git -C "$HERE" rev-parse HEAD 2>/dev/null || echo "нет git"; } > "$ROUND/_commit.txt"
  [ -n "$(git -C "$HERE" status --porcelain 2>/dev/null)" ] && echo "рабочее дерево грязное — источник истины это _skills/" >> "$ROUND/_commit.txt"
fi

# Засев стадии 1 — фикстура без материала стенда (вне репозитория, как в run-ctx-v2.sh).
SEED_ROOT="${SKILL_EVAL_SEED_ROOT:-/tmp/skill-eval-seedsrc}"
SEED0="$SEED_ROOT/$(basename "$ROUND")-$PROBE-s0"
rm -rf "$SEED0"; mkdir -p "$SEED0"
( cd "$FIX/seed" && tar cf - . ) | ( cd "$SEED0" && tar xf - )

{
  echo "цепочка: $PROBE   фикстура: $FIXTURE   стадий: $STAGES"
  echo "модель: $SM_MODEL"
  for k in $(seq 1 "$STAGES"); do
    eval "echo \"стадия $k: \$S${k}_SKILL — \$S${k}_PROMPT; реплика \${S${k}_TURN2:-—}; двойник \${S${k}_TWIN:-—} (\${S${k}_TWIN_PROMPT:-—}); потолок \${S${k}_CAP:-8}\""
  done
  echo "прогонов: $N, параллельность: $CONC"
} > "$ROUND/$PROBE/_settings.txt"
cat "$ROUND/$PROBE/_settings.txt"

esc_re() { printf '%s' "$1" | sed 's/[][\.*^$(){}?+|/]/\\&/g'; }
esc_sed() { printf '%s' "$1" | sed 's/[&|\\]/\\&/g'; }

run_chain() {
  local i="$1" base="$ROUND/$PROBE/run-$i" prev="$SEED0" k
  mkdir -p "$base"
  for k in $(seq 1 "$STAGES"); do
    local out="$base/stage-$k" sb="$base/stage-$k/run-1"
    local skill prompt turn2 twin twinp cap idle done_re done_grep done_var
    eval "skill=\$S${k}_SKILL prompt=\$S${k}_PROMPT turn2=\${S${k}_TURN2:-} twin=\${S${k}_TWIN:-} twinp=\${S${k}_TWIN_PROMPT:-twin-analyst.md}"
    eval "cap=\${S${k}_CAP:-8} idle=\${S${k}_IDLE:-\$cap} done_re=\${S${k}_DONE_RE:-} done_grep=\${S${k}_DONE_GREP:-} done_var=\${S${k}_DONE_VAR:-}"
    if [ -s "$sb/answer.md" ]; then prev="$sb"; continue; fi

    # Засев стадии — песочница прошлой стадии без файлов стенда (ответы, потоки, `_*`, заглушки).
    local sk="$SEED_ROOT/$(basename "$ROUND")-$PROBE-run$i-s$k"
    rm -rf "$sk"; mkdir -p "$sk"
    cp -r "$prev"/. "$sk"/
    find "$sk" -maxdepth 1 \( -name 'answer*.md' -o -name 'stream*.jsonl' -o -name '_*' -o -name '.claude' \) -exec rm -rf {} +
    # Материал, который приходит к стадии, а не лежит с начала (`S<k>_ADD`): расшифровку встречи прогон по памяти
    # видеть не должен.
    local add; eval "add=\${S${k}_ADD:-}"
    if [ -n "$add" ]; then
      [ -d "$FIX/$add" ] || { echo "стадия $k: нет папки $FIX/$add" > "$base/_chain-stand-failure.txt"; return 0; }
      cp -r "$FIX/$add"/. "$sk"/
    fi

    # Промпт стадии: {{ИМЯ}} → путь, найденный глобом VAR_<ИМЯ> в засеве стадии.
    local pf="$base/stage-$k-prompt.txt" var glob found cnt done_path=""
    cp "$FIX/$prompt" "$pf"
    for var in $(grep -o '{{[A-Z_]*}}' "$pf" | tr -d '{}' | sort -u); do
      eval "glob=\${VAR_$var:-}"
      [ -n "$glob" ] || { echo "стадия $k: нет VAR_$var в chain.conf" > "$base/_chain-broken.txt"; return 0; }
      found="$(cd "$sk" && compgen -G "$glob" || true)"
      cnt="$(printf '%s' "$found" | grep -c . || true)"
      if [ "$cnt" != "1" ]; then
        { echo "стадия $k: {{$var}} — по глобу $glob найдено $cnt"; printf '%s\n' "$found"; } > "$base/_chain-broken.txt"
        echo "  run-$i — ЦЕПОЧКА ОБОРВАНА на стадии $k: {{$var}} ($cnt)"
        return 0
      fi
      # Без `sed -i`: у BSD sed (macOS) первый аргумент `-i` — суффикс копии, подстановка молча не делалась.
      sed "s|{{$var}}|$(esc_sed "$found")|g" "$pf" > "$pf.tmp" && mv "$pf.tmp" "$pf"
      [ "$var" = "$done_var" ] && done_path="$found"
    done

    unset RT_TWIN RT_TWIN_PROMPT RT_DONE_RE RT_DONE_GREP
    export RT_MAX_TURNS="$cap" RT_IDLE_MAX="$idle"
    [ -n "$done_re" ] && export RT_DONE_RE="$done_re"
    [ -n "$done_grep" ] && export RT_DONE_GREP="$done_grep"
    [ -n "$done_path" ] && export RT_DONE_GREP="$(esc_re "$done_path")"
    local t2=""
    if [ -n "$twin" ]; then
      export RT_TWIN="$FIX/$twin" RT_TWIN_PROMPT="$HERE/$twinp"
      t2="$FIX/$twin"   # реплику хода пишет двойник; файл нужен пулу как признак многоходовой пробы
    elif [ -n "$turn2" ]; then
      t2="$FIX/$turn2"
    fi
    echo "  run-$i — стадия $k: $skill"
    bash "$POOL" "$SNAP_ROOT/$skill/SKILL.md" "$pf" "$out" 1 1 "$sk" "" "$t2" > "$out.log" 2>&1
    # Отказ API посреди диалога стадии оставляет `answer.md` непустым, но маркер ставит: дальше по цепочке — только
    # платить за стадии, которые в счёт не пойдут.
    if [ ! -s "$sb/answer.md" ] || [ -e "$sb/_api-failure-turn.txt" ] || [ -e "$sb/_api-failure.txt" ]; then
      echo "стадия $k: нет ответа (отказ API или стенда — см. $out.log)" > "$base/_chain-stand-failure.txt"
      echo "  run-$i — стадия $k без ответа, цепочка остановлена"
      return 0
    fi
    prev="$sb"
  done
  echo "  run-$i — цепочка пройдена"
}

for i in $(seq 1 "$N"); do
  while [ "$(jobs -rp | wc -l | tr -d ' ')" -ge "$CONC" ]; do sleep 5; done
  run_chain "$i" &
done
wait
echo "ГОТОВО: $ROUND/$PROBE — цепочек пройдено: $(find "$ROUND/$PROBE" -maxdepth 2 -name "stage-$STAGES" -type d | wc -l) из $N"

# Снимок нужен только на время цепочки — журнальная копия осталась в `<раунд>/_skills/`.
[ -d "$SNAP_ROOT" ] && rm -rf "$SNAP_ROOT"
# Цена — этой строкой, не суммой руками (при `--resume` цена накопительная).
bash "$HERE/cost-runs.sh" "$ROUND/$PROBE"
