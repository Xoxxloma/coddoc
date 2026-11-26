#!/usr/bin/env bash
# run.sh — стенд раунда «service-map на реальном коде».
#
#   ./run.sh <плечо> <N> [параллельность]
#
# Плечи (числа складывать нельзя — законные исходы разные):
#   scan   манифест засеян тремя строками, аргумент `repairy-api repairy-web`.
#          Мерит Шаги 2–6: опись против кода, гейт на запись, плотность, гард, обратные рёбра.
#   first  манифеста нет. Мерит Шаг 1: два глоба, тип по маркерам, черновик манифеста, остановка.
#   rescan как scan, но в services/ уже лежат прежние карточки (SM_RESCAN_CARDS, по умолчанию BR-REAL).
#          Мерит перечитывание: гард на утоньшение, правило прежней формулировки, дифф против _prev/.
#   keyed  как rescan, плюс подсказка «Задето» (SM_KEYED_HINT — файл, SM_KEYED_ARGS — имена сервисов;
#          SM_REAL_PATCH — патч кода поверх засева). Мерит быстрое обновление по задетому.
#   front  свой манифест (fixtures/SM-REAL/manifest-front.yaml), пять целей скана: два фронта, fullstack, бэкенд с
#          клиентской спекой соседа, мелкий бэкенд. Мерит типы, которых другие плечи не дают (KEY-FRONT.md).
#
# Чем этот раунд отличается от всех прошлых: дерево не синтетическое. Самая большая фикстура
# стенда — 33 файла на всю пробу и до 48 ключей; здесь `repairy-api` один даёт 125 файлов и
# ~120 ключей. Граница «сколько берёт один субагент» до сих пор не проведена (CHANGELOG 5.0,
# таблица чисел), и этот раунд её и мерит.
#
# Идемпотентность: песочница с непустым answer.md пропускается — скрипт можно перезапускать.
set -u

# На macOS нет `timeout` (coreutils не входят в систему). Без подмены вызов падает с rc=127, а
# пустой answer.md уходит в «ОТКАЗ» — то есть весь раунд выглядит не измеренным. perl есть везде.
command -v timeout > /dev/null || timeout() { local s="$1"; shift; perl -e 'alarm shift; exec @ARGV' "$s" "$@"; }

HERE="$(cd "$(dirname "$0")" && pwd)"
EVAL="$(cd "$HERE/../.." && pwd)"            # …/agent-version/_skill-eval
SKILLROOT="$(cd "$EVAL/.." && pwd)"          # …/agent-version
FIX="$EVAL/fixtures/SM-REAL"

# Папка раунда отделена от папки скрипта: снимок скилла снимается ОДИН раз на раунд, и плечо
# «после правки» обязано лежать своим раундом, иначе оно прочитает снимок «до» и разница выйдет
# нулевой по построению.
ROUND="${ROUND_DIR:-$HERE}"
# Текст скилла берётся из SKILL_SRC, а не всегда из рабочего дерева: плечи пула отличаются одним
# правилом, и подменять ради каждого рабочее дерево — верный способ смешать редакции.
SKILL_SRC="${SKILL_SRC:-$SKILLROOT/service-map}"
mkdir -p "$ROUND"

ARM="${1:?плечо: scan | first | rescan | keyed | front}"
N="${2:-1}"
CONC="${3:-1}"
# Модель ведущего и субагентов. По умолчанию haiku — так сняты все раунды до 2026-09-14; прод
# аналитиков перешёл на flash-модели с рассуждением, ближайшая замена — sonnet (SM_MODEL=sonnet).
MODEL="${SM_MODEL:-haiku}"

case "$ARM" in
  scan)  PROMPT="${SM_REAL_PROMPT:-$HERE/stand/prompt-scan.md}" ;;
  rescan) PROMPT="$HERE/stand/prompt-scan.md" ;;   # тот же скан поверх прежних карточек (seed.sh)
  front)  PROMPT="$HERE/stand/prompt-front.md" ;;  # пять целей: фронты, fullstack, клиентская спека (seed.sh, KEY-FRONT.md)
  # SM_PROMPT — другая обёртка поверх того же засева; подсказка нужна, только если в ней есть HINTBLOCK.
  keyed)  PROMPT="${SM_PROMPT:-$HERE/stand/prompt-keyed.md}"
          if grep -q HINTBLOCK "$PROMPT" 2>/dev/null; then
            [ -f "${SM_KEYED_HINT:-}" ] || { echo "плечо keyed: нужен SM_KEYED_HINT — файл подсказки"; exit 1; }
          fi ;;
  first) PROMPT="$HERE/stand/prompt-first.md" ;;
  *) echo "неизвестное плечо: $ARM"; exit 1 ;;
esac
[ -f "$PROMPT" ] || { echo "нет промпта: $PROMPT"; exit 1; }
[ -x "$FIX/seed.sh" ] || { echo "нет засева: $FIX/seed.sh"; exit 1; }

# ─── Снимок скилла: ОДИН раз на раунд ──────────────────────────────────────────────────────
# Прежняя раскладка писала в конфиг путь к ЖИВОМУ SKILL.md; файл правится между раундами, и текст,
# которым получены числа, переставал существовать в момент следующей правки. `reference/` — часть
# измеряемого текста: без него снимок лжёт, форма карточки живёт там.
mkdir -p "$ROUND/_skills"
if [ ! -f "$ROUND/_skills/service-map.SKILL.md" ]; then
  cp "$SKILL_SRC/SKILL.md" "$ROUND/_skills/service-map.SKILL.md"
  cp -r "$SKILL_SRC/reference" "$ROUND/_skills/service-map.reference"
  echo "снимок скилла снят: $ROUND/_skills/"
else
  echo "снимок скилла уже есть — прогон читает ЕГО"
fi
if [ ! -f "$ROUND/_commit.txt" ]; then
  { git -C "$ROUND" rev-parse HEAD 2>/dev/null || echo "нет git"; } > "$ROUND/_commit.txt"
  [ -n "$(git -C "$ROUND" status --porcelain 2>/dev/null)" ] \
    && echo "рабочее дерево грязное — источник истины это _skills/" >> "$ROUND/_commit.txt"
fi

# ПРОГОН ЧИТАЕТ КОПИЮ СНИМКА ВНЕ РЕПОЗИТОРИЯ. Единственный путь, который прогон получает внутрь
# репы, — путь к скиллу; получив его, часть прогонов уходит бродить по соседним папкам и пишет
# результат в фикстуру. Каталог сносится ПОСЛЕ плеча: копившиеся снимки прошлых раундов один раз
# уже привели к тому, что прогон прочитал чужой SKILL.md и попал в знаменатель.
SNAP_ROOT="${SM_REAL_SNAP:-/tmp/sm-real-skills}/$(basename "$ROUND")"
rm -rf "$SNAP_ROOT"; mkdir -p "$SNAP_ROOT/service-map"
cp "$ROUND/_skills/service-map.SKILL.md" "$SNAP_ROOT/service-map/SKILL.md"
cp -r "$ROUND/_skills/service-map.reference" "$SNAP_ROOT/service-map/reference"
# ПУТИ В ПРОМПТ ИДУТ В WINDOWS-ФОРМЕ. `claude` здесь — windows-процесс, и msys-путь
# (`/tmp/…`, `/c/Users/…`) его инструменты не разрешают: прогон получил бы «файл не найден» на
# самом скилле и завершился отказом, неотличимым от честного «читать нечего».
SNAP_WIN="$(cd "$SNAP_ROOT" && pwd -W 2>/dev/null || echo "$SNAP_ROOT")"

OUT="$ROUND/sandbox"
mkdir -p "$OUT"

run_one() {
  local i="$1"          # номер песочницы; $2 — номер попытки (пусто = первая), см. «брошено в фоне»
  local sb="$OUT/$ARM-$i"
  if [ -s "$sb/answer.md" ]; then echo "  $ARM-$i — уже есть, пропуск"; return 0; fi
  mkdir -p "$sb"

  bash "$FIX/seed.sh" "$sb/w" "$ARM" > "$sb/_seed.log" 2>&1 \
    || { echo "  $ARM-$i — засев не собрался, см. $sb/_seed.log"; return 0; }

  # Отпечаток засева ДО прогона. По нему караул ниже отличает «скилл записал в чужую репу»
  # от «так и было»: запрет в промпте изоляцией не является, а правило 2 скилла («ты только
  # читаешь чужие репозитории») ни одной синтетической фикстурой не проверялось — писать в них
  # было незачем.
  ( cd "$sb/w" && find . -type f -not -path './AI-SDD/*' \
      -not -path '*/.git/*' -not -name .git | sort ) > "$sb/_seeded.txt"

  local wd="$sb/w/AI-SDD"
  local abs_wd; abs_wd="$(cd "$wd" && { pwd -W 2>/dev/null || pwd; })"
  local task
  task="$(sed -e "s|WORKDIR|$abs_wd|g" -e "s|SKILLDIR|$SNAP_WIN|g" -e "s|модель \`haiku\`|модель \`$MODEL\`|g" "$PROMPT")"
  if [ "$ARM" = keyed ]; then
    task="${task/KEYEDARGS/${SM_KEYED_ARGS:-repairy-api repairy-web}}"
    [ -f "${SM_KEYED_HINT:-}" ] && task="${task/HINTBLOCK/$(cat "$SM_KEYED_HINT")}"
  fi

  # stream-json: в `_stream.jsonl` лежит трасса ведущего (каждый tool_use с аргументами) и полные
  # ответы субагентов (tool_result вызовов Agent). answer.md — текст result, как раньше; из него
  # же берётся цена. Без этого стенд слеп к «читал ли ведущий соседнюю карточку» и к перенабору.
  ( cd "$wd" && timeout 7200 claude -p "$task" --model "$MODEL" --permission-mode bypassPermissions --output-format stream-json --verbose ) \
      > "$sb/_stream.jsonl" 2> "$sb/_stderr.log"
  local rc=$?
  node "$EVAL/stream-extract.mjs" "$sb/_stream.jsonl" "$sb" 2>> "$sb/_stderr.log"

  # Отказ раннера обязан выпадать в «не измерено», а не в «провалено».
  if grep -qiE "API Error|Request not allowed|Please run /login|Credit balance|rate limit|session limit|usage limit" "$sb/answer.md" 2>/dev/null; then
    mv "$sb/answer.md" "$sb/_api-failure.txt"
    echo "  $ARM-$i — ОТКАЗ API, в счёт не идёт"
    return 0
  fi

  # Брошено в фоне — тоже «не измерено», не «провалено». На sonnet ведущий запускает субагентов
  # фоном и заканчивает ход «жду уведомления»; в `claude -p` уведомление не приходит, процесс
  # завершается без карточек (2026-09-14-sonnet-base, scan-5 и scan-6 — треть раунда). Опознаётся
  # по последней строке ответа; карточки на диске при этом могут быть частично (scan-5 записал web).
  # Один повтор той же песочницы: засев заново, чтобы частичная карточка не сошла за «уже есть».
  if tail -c 600 "$sb/answer.md" | grep -qiE "жд[уё]м?[^\n]*(уведомлен|субагент|заверш|результат)|ожида[юе][^\n]*(уведомлен|субагент|заверш|результат)|продолжу[^\n]*(как только|когда)[^\n]*(верн|заверш)"; then
    local attempt="${2:-1}"
    mv "$sb/answer.md" "$sb/_bg-abandoned$([ "$attempt" -gt 1 ] && echo "-$attempt").txt"
    if [ "$attempt" -lt 2 ]; then
      echo "  $ARM-$i — брошено в фоне, повтор"
      rm -rf "$sb/w"
      run_one "$i" 2
      return 0
    fi
    echo "  $ARM-$i — брошено в фоне ДВАЖДЫ, в счёт не идёт"
    return 0
  fi

  # ─── Караул чужих реп ──────────────────────────────────────────────────────────────────
  ( cd "$sb/w" && find . -type f -not -path './AI-SDD/*' \
      -not -path '*/.git/*' -not -name .git | sort ) > "$sb/_after.txt"
  if ! diff -q "$sb/_seeded.txt" "$sb/_after.txt" > /dev/null; then
    echo "  !!! $ARM-$i — ПРОГОН ТРОГАЛ ПАПКИ СЕРВИСОВ (правило 2 скилла):"
    diff "$sb/_seeded.txt" "$sb/_after.txt" | head -20 | sed 's/^/      /'
    diff "$sb/_seeded.txt" "$sb/_after.txt" > "$sb/_dirt.txt"
  fi

  if [ $rc -ne 0 ] || [ ! -s "$sb/answer.md" ]; then
    echo "  $ARM-$i — ОТКАЗ (rc=$rc), см. $sb/_stderr.log"
  else
    echo "  $ARM-$i — готов; карточек: $(ls -1 "$wd/services"/*.md 2>/dev/null | grep -v manifest | wc -l)"
  fi
}

{
  echo "плечо: $ARM"
  echo "модель: $MODEL"
  echo "прогонов: $N, параллельность: $CONC"
  echo "текст скилла: $SKILL_SRC"
  echo "источники: ${SM_REAL_SRC:-/c/Users/Konstantin/projects}/{repairy,resonance}"
  [ "$ARM" = keyed ] && echo "подсказка: ${SM_KEYED_HINT:-нет}; аргументы: ${SM_KEYED_ARGS:-repairy-api repairy-web}; патч: ${SM_REAL_PATCH:-нет}"
  [ "$ARM" = keyed ] && echo "обёртка: $(basename "$PROMPT"); сосед-заглушка: ${SM_REAL_HELLO:+hello-api}"
  echo "снимок скилла: _skills/service-map.SKILL.md ($(wc -l < "$ROUND/_skills/service-map.SKILL.md") строк)"
} > "$ROUND/_settings-$ARM.txt"
cat "$ROUND/_settings-$ARM.txt"

# Семафор по числу живых фоновых задач. Прежний `wait -n` в bash 3.2 (macOS) не существует, а откат
# на голый `wait` ждал ВСЕ задачи сразу: после первой волны пул шёл строго по одному прогону
# (2026-09-14: волна из четырёх — 10 мин, дальше каждый прогон в одиночку).
for i in $(seq -w 1 "$N"); do
  while [ "$(jobs -rp | wc -l)" -ge "$CONC" ]; do sleep 5; done
  run_one "$i" &
done
wait

echo "ГОТОВО: песочниц с ответом — $(find "$OUT" -maxdepth 2 -name answer.md -size +0 -path "*$ARM-*" | wc -l) из $N"
rm -rf "$SNAP_ROOT"
echo "снимок из /tmp снесён (журнальная копия осталась в $ROUND/_skills/)"
