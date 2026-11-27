#!/usr/bin/env bash
# run-sm-mono.sh <папка скилла> <папка-раунда> <фикстура> [N] — полный прогон service-map на синтетическом
# монолите (критерии Б-5, Б-6 плана PLAN-AUTOSPLIT.md §5; грейдер grade-sm-mono.mjs).
#
#   фикстура NRS-TAIL     → сервис cargonet (2100 java, контракт 139, сущности 88, задачи 9, топики 18 в yaml)
#   фикстура SM-MONO-DGS  → сервис casedesk (1052 java, DGS 104 + REST 16, сущности 60, задачи 10, топики 12)
#   фикстура SM-MONO-SPEC → тот же casedesk плюс 28 REST-операций из openapi.yaml без аннотаций (ещё 2 объявлены
#                           без реализации) и тестовый конфиг с 4 топиками; контракт 148
#   фикстура SM-GAPS-BACK  → сервис harvest-ledger (Java, ручки из спецификации, контракт 50) — классы потерь 2.0,
#   фикстура SM-GAPS-FRONT → сервис yard-map-ui (React, Module Federation); ключ и грейдер — fixtures/SM-GAPS/KEY.md,
#                           grade-sm-gaps.mjs; дерево и манифест лежат в фикстуре готовыми
#   фикстура SM-GAPS-KT    → сервис seed-vault (Kotlin, ручки — реализации интерфейсов, сгенерированных при сборке
#                           из спецификации вне дерева: 29 методов, 2 ручки с аннотацией); дерево — fixtures/SM-GAPS/kt
#   фикстура SM-GAPS-NODE  → сервис parcel-hub (Node/TypeScript, имена топиков только в config/default.yaml, код
#                           берёт их из конфига; рядом config/test.yaml); дерево — fixtures/SM-GAPS/node
#   фикстура SM-APOLLO     → сервис apollo-portal (настоящий код Apollo, ≈ 290 ручек) — дерево копируется из
#                           ${SM_APOLLO_SRC:-projects/apollo} без .git; ключ — fixtures/SM-APOLLO/KEY.md, grade-sm-apollo.mjs
#   фикстура SM-LISTMONK   → сервис listmonk (Go, echo, Postgres без ORM, 185 ручек) — из ${SM_LISTMONK_SRC:-projects/listmonk}
#                           без .git; ключ — fixtures/SM-LISTMONK/KEY.md, grade-sm-listmonk.mjs
#   фикстура SM-VIKUNJA    → сервис vikunja-frontend (Vue 3 + TS) — из ${SM_VIKUNJA_SRC:-projects/vikunja-frontend} без .git;
#                           ключ — fixtures/SM-VIKUNJA/KEY.md, grade-sm-vikunja.mjs
#
# Песочница: <раунд>/sandbox/mono-NN/w/{AI-SDD/services/manifest.yaml, <сервис>/} (у NRS-TAIL ещё weather-api,
# как в её seed.sh). Рабочая директория прогона — w/AI-SDD, аргумент запуска — имя сервиса. Деревья фикстур
# собираются их make.sh, если out/ ещё нет; правда (expected.md) в песочницу не едет.
#
# Снимок скилла — ВСЯ папка (SKILL.md и reference/ целиком, со скриптами), ОДИН раз на раунд в
# <раунд>/_skills/service-map/; прогон читает копию снимка вне репозитория (${SM_MONO_SNAP:-/tmp/sm-mono-skills}/
# <раунд>/service-map), пути в промпт — Windows-формы (`pwd -W`), как в runs/2026-08-24-sm-real/run.sh.
#
# Переменные:
#   SM_MONO_K=<целое>   подменить в снимке подстроку `K = <целое>` раздела «#### 3.5 Большой сервис»
#                       (до следующего заголовка ###/####); подстрок не ровно одна — отказ раннера;
#   SM_MONO_W=<число>   то же для `w = <число>`;
#   SM_MONO_SCOUT_NOSPEC=1  в снимке разведчику запрещено размечать спецификации — ветка «спека не нарезана»;
#   SM_MODEL (sonnet), SM_MONO_CONC (1) — параллельных прогонов, SM_MONO_TIMEOUT (7200 c), SM_MONO_SNAP;
#   SM_MONO_DRY=1       собрать песочницы, снимок, подмену и промпты; claude не звать.
# Снимок раунда снят с другой подменой — отказ (числа раунда иначе смешают два текста).
#
# Выход прогона: sandbox/mono-NN/{prompt.md, _stream.jsonl, answer.md, _cost.txt, _trace.jsonl, _sub/, _rc.txt,
# _stderr.log, _seeded.txt, _after.txt}. Отказ API и обрыв без ответа — _api-failure.txt; «жду уведомления» —
# _bg-abandoned.txt и один повтор с чистой песочницы; оба — «не измерено». Караул: отпечаток (путь, размер,
# время) всех папок w/ кроме AI-SDD до и после; разошлось — _dirt.txt и крик. Песочница с непустым answer.md
# пропускается — раннер можно перезапускать.
set -u
command -v timeout > /dev/null || timeout() { local s="$1"; shift; perl -e 'alarm shift; exec @ARGV' "$s" "$@"; }

SRC="${1:?папка скилла (SKILL.md и reference/)}"; ROUND="${2:?папка раунда}"; FX="${3:?фикстура: NRS-TAIL | SM-MONO-DGS}"; N="${4:-1}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; FIXROOT="$HERE/fixtures"; PROMPT="${SM_MONO_PROMPT:-$FIXROOT/SM-MONO-RUN/prompt-scan.md}"
MODEL="${SM_MODEL:-sonnet}"; CONC="${SM_MONO_CONC:-1}"; TMO="${SM_MONO_TIMEOUT:-7200}"
FXDIR="$FX"; FXSUB=out; FXARG=""
case "$FX" in
  NRS-TAIL) SVC=cargonet ;;
  SM-MONO-DGS|SM-MONO-SPEC) SVC=casedesk ;;
  SM-MONO-SPEC-OWN) SVC=casedesk; FXDIR=SM-MONO-SPEC; FXSUB=out/owners; FXARG=--owners ;;   # make.sh --owners
  SM-MONO-SPEC-CROSS) SVC=casedesk; FXDIR=SM-MONO-SPEC; FXSUB=out/crosscut; FXARG=--crosscut ;;   # make.sh --crosscut
  SM-GAPS-BACK) SVC=harvest-ledger; FXDIR=SM-GAPS; FXSUB=back ;;
  SM-GAPS-FRONT) SVC=yard-map-ui; FXDIR=SM-GAPS; FXSUB=front ;;
  SM-GAPS-KT) SVC=seed-vault; FXDIR=SM-GAPS; FXSUB=kt ;;
  SM-GAPS-NODE) SVC=parcel-hub; FXDIR=SM-GAPS; FXSUB=node ;;
  SM-APOLLO) SVC=apollo-portal; FXDIR=SM-APOLLO; FXSUB=.; APOLLO="${SM_APOLLO_SRC:-/c/Users/Konstantin/projects/apollo}" ;;
  SM-LISTMONK) SVC=listmonk; FXDIR=SM-LISTMONK; FXSUB=.; REPO="${SM_LISTMONK_SRC:-/c/Users/Konstantin/projects/listmonk}" ;;
  SM-VIKUNJA) SVC=vikunja-frontend; FXDIR=SM-VIKUNJA; FXSUB=.; REPO="${SM_VIKUNJA_SRC:-/c/Users/Konstantin/projects/vikunja-frontend}" ;;
  *) echo "неизвестная фикстура: $FX (NRS-TAIL | SM-MONO-DGS | SM-MONO-SPEC | SM-MONO-SPEC-OWN | SM-MONO-SPEC-CROSS | SM-GAPS-BACK | SM-GAPS-FRONT | SM-GAPS-KT | SM-GAPS-NODE | SM-APOLLO | SM-LISTMONK | SM-VIKUNJA)" >&2; exit 1 ;;
esac
[ -f "$SRC/SKILL.md" ] || { echo "нет $SRC/SKILL.md" >&2; exit 1; }
[ -d "$SRC/reference" ] || { echo "нет $SRC/reference/ — снимок без скриптов лжёт" >&2; exit 1; }
[ -f "$PROMPT" ] || { echo "нет промпта $PROMPT" >&2; exit 1; }
if [ -n "${SM_MONO_K:-}" ] && ! [[ "$SM_MONO_K" =~ ^[0-9]+$ ]]; then echo "SM_MONO_K — целое, а не «$SM_MONO_K»" >&2; exit 1; fi
if [ -n "${SM_MONO_W:-}" ] && ! [[ "$SM_MONO_W" =~ ^[0-9]+([.,][0-9]+)?$ ]]; then echo "SM_MONO_W — число, а не «$SM_MONO_W»" >&2; exit 1; fi
if [ -z "${SM_MONO_DRY:-}" ] && ! command -v claude > /dev/null; then echo "claude не найден в PATH" >&2; exit 1; fi
SRC="$(cd "$SRC" && pwd)"
mkdir -p "$ROUND"; ROUND="$(cd "$ROUND" && pwd)"
OUT="$ROUND/sandbox"; mkdir -p "$OUT"

# ─── дерево фикстуры ─────────────────────────────────────────────────────────────────────
FXOUT="$FIXROOT/$FXDIR/$FXSUB"
if [ "$FX" = SM-APOLLO ]; then
  [ -d "$APOLLO/$SVC/src" ] || { echo "нет клона Apollo: $APOLLO/$SVC/src (SM_APOLLO_SRC)" >&2; exit 1; }
elif [ -n "${REPO:-}" ]; then
  [ -d "$REPO" ] || { echo "нет клона $FX: $REPO" >&2; exit 1; }
elif [ ! -d "$FXOUT/$SVC/src" ]; then
  echo "собираю $FX: make.sh → $FXOUT"
  bash "$FIXROOT/$FXDIR/make.sh" "$FXOUT" $FXARG > "$ROUND/_make-$FX.log" 2>&1 || { echo "make.sh $FX упал, см. $ROUND/_make-$FX.log" >&2; exit 1; }
fi

# ─── снимок скилла: один раз на раунд ────────────────────────────────────────────────────
# subst <файл> <имя> <значение> <ERE значения> — ровно одна подстрока «<имя> = …» в разделе 3.5
subst() {
  local f="$1" var="$2" val="$3" vre="$4" s e n
  s=$(grep -n -m1 '^#### 3\.5 Большой сервис' "$f" | cut -d: -f1)
  [ -n "$s" ] || { echo "ОТКАЗ: в снимке нет «#### 3.5 Большой сервис» — подменять $var негде" >&2; return 1; }
  e=$(awk -v s="$s" 'NR > s && /^#{1,4} / { print NR; exit }' "$f")
  [ -n "$e" ] || e=$(( $(wc -l < "$f") + 1 ))
  n=$(sed -n "$((s + 1)),$((e - 1))p" "$f" | grep -oE "\\b$var = $vre" | wc -l)
  [ "$n" -eq 1 ] || { echo "ОТКАЗ: в разделе 3.5 (строки $s–$e) подстрок «$var = …» $n, нужна ровно одна" >&2; return 1; }
  sed -i -E "$((s + 1)),$((e - 1))s/\\b$var = $vre/$var = $val/" "$f"
  n=$(sed -n "$((s + 1)),$((e - 1))p" "$f" | grep -oE "\\b$var = ${val//./\\.}" | wc -l)
  [ "$n" -eq 1 ] || { echo "ОТКАЗ: после подмены «$var = $val» в разделе 3.5 найдено $n раз" >&2; return 1; }
  echo "подмена в снимке: $var = $val (раздел 3.5, строки $s–$e)"
}
SNAPREC="$ROUND/_skills/service-map"
WANT_SUB="K=${SM_MONO_K:-как в тексте} w=${SM_MONO_W:-как в тексте}${SM_MONO_SCOUT_NOSPEC:+ разведчик без спеки}"
# SM_MONO_SCOUT_NOSPEC=1 — ветка «план не разметил спецификацию» (прод: разведчик не назвал строку спеки):
# в снимке к брифу разведчика дописывается запрет размечать спецификации; остальное — как в тексте.
nospec() {
  local f="$SNAPREC/reference/brief-scout.md"
  [ -f "$f" ] || { echo "ОТКАЗ: в снимке нет reference/brief-scout.md — запрещать разметку спеки негде" >&2; return 1; }
  printf '%s\n' "" "Для этого прогона: спецификации API (openapi, swagger) не размечай — ни строки спеки, ни контроля по ней." >> "$f"
  echo "подмена в снимке: разведчик без строки спеки (reference/brief-scout.md)"
}
if [ ! -f "$SNAPREC/SKILL.md" ]; then
  mkdir -p "$ROUND/_skills"; rm -rf "$SNAPREC"
  cp -r "$SRC" "$SNAPREC"
  { [ -z "${SM_MONO_K:-}" ] || subst "$SNAPREC/SKILL.md" K "$SM_MONO_K" '[0-9]+'; } \
    && { [ -z "${SM_MONO_W:-}" ] || subst "$SNAPREC/SKILL.md" w "$SM_MONO_W" '[0-9]+([.,][0-9]+)?'; } \
    && { [ -z "${SM_MONO_SCOUT_NOSPEC:-}" ] || nospec; } \
    || { rm -rf "$ROUND/_skills"; exit 1; }
  echo "$WANT_SUB" > "$ROUND/_skills/_subst.txt"
  echo "снимок скилла снят: $SNAPREC ($(find "$SNAPREC" -type f | wc -l) файлов)"
else
  have="$(cat "$ROUND/_skills/_subst.txt" 2>/dev/null)"
  [ "$have" = "$WANT_SUB" ] || { echo "ОТКАЗ: снимок раунда снят с «$have», а сейчас «$WANT_SUB» — новый раунд" >&2; exit 1; }
  echo "снимок скилла уже есть — прогон читает ЕГО ($have)"
fi
if [ ! -f "$ROUND/_commit.txt" ]; then
  { git -C "$SRC" rev-parse HEAD 2>/dev/null || echo "нет git"; } > "$ROUND/_commit.txt"
  [ -n "$(git -C "$SRC" status --porcelain -- . 2>/dev/null)" ] && echo "папка скилла грязная — источник истины _skills/" >> "$ROUND/_commit.txt"
fi

# Прогон читает копию снимка ВНЕ репозитория: путь внутрь репы уводит прогоны бродить по соседним папкам.
SNAP_ROOT="${SM_MONO_SNAP:-/tmp/sm-mono-skills}/$(basename "$ROUND")"
rm -rf "$SNAP_ROOT"; mkdir -p "$SNAP_ROOT"
cp -r "$SNAPREC" "$SNAP_ROOT/service-map"
SNAP_WIN="$(cd "$SNAP_ROOT" && { pwd -W 2>/dev/null || pwd; })"

{
  echo "фикстура: $FX, сервис: $SVC"
  echo "модель: $MODEL; прогонов: $N; параллельность: $CONC; таймаут: $TMO c"
  echo "папка скилла: $SRC"
  echo "снимок: _skills/service-map ($(wc -l < "$SNAPREC/SKILL.md") строк SKILL.md, $(find "$SNAPREC/reference" -type f | wc -l) файлов reference/); подмена: $WANT_SUB"
  echo "копия для прогона: $SNAP_WIN/service-map"
  echo "claude: $(command -v claude || echo 'нет в PATH')${SM_MONO_DRY:+ (сухой режим — не вызывается)}"
} > "$ROUND/_settings-mono.txt"
printf '{"fixture":"%s","service":"%s","model":"%s","K":"%s","w":"%s"}\n' "$FX" "$SVC" "$MODEL" "${SM_MONO_K:-}" "${SM_MONO_W:-}" > "$ROUND/_mono.json"
cat "$ROUND/_settings-mono.txt"

# ─── песочница и караул ──────────────────────────────────────────────────────────────────
seed() {  # seed <w>
  local w="$1"
  rm -rf "$w"; mkdir -p "$w"
  case "$FX" in
    NRS-TAIL) bash "$FIXROOT/NRS-TAIL/seed.sh" "$w" ;;
    SM-MONO-DGS|SM-MONO-SPEC|SM-MONO-SPEC-OWN|SM-MONO-SPEC-CROSS)
      cp -r "$FXOUT/casedesk" "$w/casedesk"
      mkdir -p "$w/AI-SDD/services"
      printf '%s\n' '# Слепок соседних сервисов. Этот файл ведёт человек.' 'services:' '  - name: casedesk' '    path: ../casedesk' '    type: backend' > "$w/AI-SDD/services/manifest.yaml"
      echo "песочница: $w   файлов в репе: $(find "$w/casedesk" -type f -not -path '*/.git/*' | wc -l)" ;;
    SM-GAPS-BACK|SM-GAPS-FRONT|SM-GAPS-KT|SM-GAPS-NODE)
      cp -r "$FXOUT/$SVC" "$w/$SVC"
      mkdir -p "$w/AI-SDD/services"
      cp "$FXOUT/manifest.yaml" "$w/AI-SDD/services/manifest.yaml"
      echo "песочница: $w   файлов в репе: $(find "$w/$SVC" -type f | wc -l)" ;;
    SM-APOLLO)
      mkdir -p "$w/apollo" "$w/AI-SDD/services"
      ( cd "$APOLLO" && tar --exclude=./.git -cf - . ) | ( cd "$w/apollo" && tar -xf - )
      cp "$FXOUT/manifest.yaml" "$w/AI-SDD/services/manifest.yaml"
      echo "песочница: $w   файлов в $SVC: $(find "$w/apollo/$SVC" -type f | wc -l)" ;;
    SM-LISTMONK|SM-VIKUNJA)
      mkdir -p "$w/$SVC" "$w/AI-SDD/services"
      ( cd "$REPO" && tar --exclude=./.git -cf - . ) | ( cd "$w/$SVC" && tar -xf - )
      cp "$FXOUT/manifest.yaml" "$w/AI-SDD/services/manifest.yaml"
      echo "песочница: $w   файлов в репе: $(find "$w/$SVC" -type f | wc -l)" ;;
  esac
  { [ -d "$w/$SVC" ] || [ -d "$w/apollo/$SVC" ]; } && [ -f "$w/AI-SDD/services/manifest.yaml" ]
}
# отпечаток файлов; где у find нет -printf (macOS) — тот же вид через stat
fp() { ( cd "$1" && if find . -maxdepth 0 -printf '' 2>/dev/null; then find . -path ./AI-SDD -prune -o -type f -not -path '*/.git/*' -printf '%P\t%s\t%T@\n'; else find . -path ./AI-SDD -prune -o -type f -not -path '*/.git/*' -exec stat -f $'%N\t%z\t%m' {} + | sed 's|^\./||'; fi | sort ); }

run_one() {  # run_one <NN> [попытка]
  local i="$1" attempt="${2:-1}"
  local sb="$OUT/mono-$i"
  if [ -s "$sb/answer.md" ]; then echo "  mono-$i — уже есть, пропуск"; return 0; fi
  mkdir -p "$sb"
  seed "$sb/w" > "$sb/_seed.log" 2>&1 || { echo "  mono-$i — песочница не собралась, см. $sb/_seed.log"; return 0; }
  fp "$sb/w" > "$sb/_seeded.txt"
  local wd="$sb/w/AI-SDD" abs_wd task rc
  abs_wd="$(cd "$wd" && { pwd -W 2>/dev/null || pwd; })"
  task="$(sed -e "s|WORKDIR|$abs_wd|g" -e "s|SKILLDIR|$SNAP_WIN|g" -e "s|SERVICE|$SVC|g" -e "s|MODELNAME|$MODEL|g" "$PROMPT")"
  printf '%s\n' "$task" > "$sb/prompt.md"
  if [ -n "${SM_MONO_DRY:-}" ]; then echo "  mono-$i — песочница и промпт собраны ($(wc -l < "$sb/_seeded.txt") файлов под караулом), сухой режим"; return 0; fi

  ( cd "$wd" && ENABLE_CLAUDEAI_MCP_SERVERS=false timeout "$TMO" claude -p "$task" --model "$MODEL" \
      --permission-mode bypassPermissions --strict-mcp-config --output-format stream-json --verbose ) \
      > "$sb/_stream.jsonl" 2> "$sb/_stderr.log"
  rc=$?; echo "$rc" > "$sb/_rc.txt"
  node "$HERE/stream-extract.mjs" "$sb/_stream.jsonl" "$sb" 2>> "$sb/_stderr.log"

  # Караул чужой репы — до разбора исхода: отказ или обрыв тоже мог успеть записать.
  fp "$sb/w" > "$sb/_after.txt"
  if ! diff -q "$sb/_seeded.txt" "$sb/_after.txt" > /dev/null; then
    diff "$sb/_seeded.txt" "$sb/_after.txt" > "$sb/_dirt.txt"
    echo "  !!! mono-$i — ПРОГОН ТРОГАЛ ПАПКУ СЕРВИСА:"; head -20 "$sb/_dirt.txt" | sed 's/^/      /'
  fi

  # Отказ раннера — «не измерено», а не «провалено».
  if grep -qiE "API Error|Request not allowed|Please run /login|Credit balance|rate limit|session limit|usage limit|Overloaded" "$sb/answer.md" 2>/dev/null; then
    mv "$sb/answer.md" "$sb/_api-failure.txt"; echo "  mono-$i — ОТКАЗ API, в счёт не идёт"; return 0
  fi
  if [ "$rc" -ne 0 ] && [ ! -s "$sb/answer.md" ]; then
    echo "rc=$rc, ответа нет — см. _stderr.log" > "$sb/_api-failure.txt"; rm -f "$sb/answer.md"
    echo "  mono-$i — ОБРЫВ (rc=$rc), в счёт не идёт"; return 0
  fi
  # Брошено в фоне — тоже «не измерено»; один повтор с чистой песочницы (частичная карточка не сойдёт за «есть»).
  if tail -c 600 "$sb/answer.md" | grep -qiE "жд[уё]м?[^\n]*(уведомлен|субагент|заверш|результат)|ожида[юе][^\n]*(уведомлен|субагент|заверш|результат)|продолжу[^\n]*(как только|когда)[^\n]*(верн|заверш)"; then
    mv "$sb/answer.md" "$sb/_bg-abandoned$([ "$attempt" -gt 1 ] && echo "-$attempt").txt"
    mv "$sb/_stream.jsonl" "$sb/_bg-abandoned$([ "$attempt" -gt 1 ] && echo "-$attempt")-stream.jsonl"
    if [ "$attempt" -lt 2 ]; then echo "  mono-$i — брошено в фоне, повтор"; run_one "$i" 2; return 0; fi
    echo "  mono-$i — брошено в фоне ДВАЖДЫ, в счёт не идёт"; return 0
  fi
  echo "  mono-$i — готов; карточка $SVC.md: $([ -s "$wd/services/$SVC.md" ] && echo есть || echo НЕТ); \$$(cat "$sb/_cost.txt" 2>/dev/null)"
}

for k in $(seq 1 "$N"); do
  while [ "$(jobs -rp | wc -l)" -ge "$CONC" ]; do sleep 5; done
  run_one "$(printf '%02d' "$k")" &
done
wait

if [ -n "${SM_MONO_DRY:-}" ]; then
  echo "СУХОЙ РЕЖИМ: песочницы и промпты в $OUT; копия снимка оставлена в $SNAP_ROOT"
else
  echo "ГОТОВО: песочниц с ответом — $(find "$OUT" -maxdepth 2 -name answer.md -size +0 -path '*mono-*' | wc -l) из $N"
  rm -rf "$SNAP_ROOT"; echo "копия снимка снесена (журнальная — $SNAPREC)"
  case "$FX" in
    SM-GAPS-*) echo "грейдер: node $HERE/grade-sm-gaps.mjs $ROUND" ;;
    SM-APOLLO) echo "грейдер: node $HERE/grade-sm-apollo.mjs $ROUND" ;;
    SM-LISTMONK) echo "грейдер: node $HERE/grade-sm-listmonk.mjs $ROUND" ;;
    SM-VIKUNJA) echo "грейдер: node $HERE/grade-sm-vikunja.mjs $ROUND" ;;
    *) echo "грейдер: node $HERE/grade-sm-mono.mjs $ROUND" ;;
  esac
fi
