#!/usr/bin/env bash
# run-sm-k.sh <SKILL.md> <папка-раунда> <кусок> [N] — замер K-1/K-2 (PLAN-AUTOSPLIT §5): пик контекста
# ОДНОГО читающего субагента `service-map` против числа ключей куска. Ведущего нет: `claude -p` получает
# бриф Шага 3.3, вырезанный из снимка SKILL.md раунда, с подстановкой по правилам 3.2 — и больше ничего.
#
#   SM_K_DRY=1 ./run-sm-k.sh ../service-map/SKILL.md runs/<раунд> api-32    — без модели: песочница,
#                                                       промпт, проверки; печатает промпт и пути
#   ./run-sm-k.sh ../service-map/SKILL.md runs/<раунд> api-32 2              — два прогона куска
#
# Куски — fixtures/SM-K/pieces.json (api-32, api-58, api-117, nrs-exchange). Подстановка:
#   <пути>     пути куска, абсолютные, Windows-формы, через запятую;
#   <корень>   корень репы; у куска «весь репозиторий» строка про корень убрана целиком (как в 3.2);
#   <type>     backend;  <имена> — из pieces.json;  <шаблон> — card.template.md копии снимка вне репы;
#   <дата>     сегодня;  <опись>/<черновик> — AI-SDD/services/.work/<repo>.opis.md и .md песочницы;
#   абзацы «Прежняя карточка» и «Заметки команды» и строка «По коду в этом сервисе <маркеры>…» убраны.
# Плейсхолдеры, оставшиеся в промпте, ищутся по списку из «Что подставляешь в бриф» снимка — нашлись → отказ.
#
# Окружение: SM_MODEL (sonnet), SM_K_CONC (2 — прогонов куска одновременно), SM_K_DRY, SM_K_DRY_KEEP=1
# (не сносить песочницу dry), SM_K_SNAP (/tmp/sm-k-skills — где лежит копия снимка на время прогона),
# SM_K_ALLOW_AGENT=1 (не запрещать читающему инструмент Agent — по умолчанию запрещён: субагент в
# Claude Code своих субагентов не запускает, а делёж работы на дочерние окна сломал бы замер пика).
#
# Пишет в <раунд>/sandbox/<кусок>-<i>/: prompt.md, _piece.json (пути, правда, пересчёт по засеву, файлов),
# _stream.jsonl, answer.md, cost.txt, _trace.jsonl, _time.txt; отказ API — _api-failure.txt («не измерено»).
# Идемпотентность: песочница с непустым answer.md пропускается; без него — сносится и гонится заново.
set -u
command -v timeout > /dev/null || timeout() { local s="$1"; shift; perl -e 'alarm shift; exec @ARGV' "$s" "$@"; }

SKILL_IN="${1:?путь к SKILL.md}"; ROUND_IN="${2:?папка раунда}"; PIECE="${3:?кусок из fixtures/SM-K/pieces.json}"
N="${4:-1}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIECES="$HERE/fixtures/SM-K/pieces.json"
MODEL="${SM_MODEL:-sonnet}"; CONC="${SM_K_CONC:-2}"; DRY="${SM_K_DRY:-}"
[ -f "$SKILL_IN" ] || { echo "нет SKILL.md: $SKILL_IN"; exit 1; }
[ -d "$(dirname "$SKILL_IN")/reference" ] || { echo "рядом с $SKILL_IN нет reference/"; exit 1; }
mkdir -p "$ROUND_IN"; ROUND="$(cd "$ROUND_IN" && pwd)"

# ─── Кусок из pieces.json: строки «ключ=значение»; правило счёта — поля через \x1f ──────────────
PJ="$(node -e '
const [f, id] = process.argv.slice(1)
const j = JSON.parse(require("fs").readFileSync(f, "utf8"))
const p = j.pieces[id]
if (!p) { console.error(`нет куска «${id}»; есть: ${Object.keys(j.pieces).join(", ")}`); process.exit(1) }
const fx = j.fixtures[p.fixture]
const out = [`fixture=${p.fixture}`, `kind=${p.kind}`, `seed=${fx.seed}`, `repo=${fx.repo}`, `type=${fx.type}`, `names=${fx.names}`]
for (const x of p.paths) out.push(`path=${x}`)
for (const r of [...fx.count, ...(p.extra || [])]) out.push(`rule=${[r.class, r.regex, r.include || "", r.file || ""].join("\x1f")}`)
console.log(out.join("\n"))
' "$PIECES" "$PIECE")" || exit 1
FIXTURE=""; KIND=""; SEED=""; REPO=""; TYPE=""; NAMES=""; PATHS=(); RULES=()
while IFS= read -r l; do
  k="${l%%=*}"; v="${l#*=}"
  case "$k" in
    fixture) FIXTURE="$v" ;; kind) KIND="$v" ;; seed) SEED="$v" ;; repo) REPO="$v" ;;
    type) TYPE="$v" ;; names) NAMES="$v" ;; path) PATHS+=("$v") ;; rule) RULES+=("$v") ;;
  esac
done <<< "$PJ"

# ─── Снимок скилла: ОДИН раз на раунд ─────────────────────────────────────────────────────────
mkdir -p "$ROUND/_skills"
if [ ! -f "$ROUND/_skills/service-map.SKILL.md" ]; then
  # Копия «содержимое в папку», а не «папка в папку»: два куска, стартовавшие разом в новом раунде,
  # иначе дали бы вложенную reference/reference/. Оба пишут одно и то же — гонка безвредна.
  mkdir -p "$ROUND/_skills/service-map.reference"
  cp -r "$(dirname "$SKILL_IN")/reference/." "$ROUND/_skills/service-map.reference/"
  cp "$SKILL_IN" "$ROUND/_skills/service-map.SKILL.md"
  echo "снимок скилла снят: $ROUND/_skills/"
elif ! cmp -s "$SKILL_IN" "$ROUND/_skills/service-map.SKILL.md"; then
  echo "ВНИМАНИЕ: $SKILL_IN отличается от снимка раунда — прогон читает СНИМОК $ROUND/_skills/"
fi
SNAP_MD="$ROUND/_skills/service-map.SKILL.md"
if [ ! -f "$ROUND/_commit.txt" ]; then
  { git -C "$ROUND" rev-parse HEAD 2>/dev/null || echo "нет git"; } > "$ROUND/_commit.txt"
  [ -n "$(git -C "$ROUND" status --porcelain 2>/dev/null)" ] \
    && echo "рабочее дерево грязное — источник истины это _skills/" >> "$ROUND/_commit.txt"
fi

# Копия снимка ВНЕ репозитория, своя на каждый вызов: кусков в одном раунде гонится несколько, и
# вызов, снёсший общую копию по концу, оставил бы соседа без шаблона посреди прогона.
SNAP_ROOT="${SM_K_SNAP:-/tmp/sm-k-skills}/$(basename "$ROUND")-$PIECE-$$"
rm -rf "$SNAP_ROOT"; mkdir -p "$SNAP_ROOT/service-map"
cp "$SNAP_MD" "$SNAP_ROOT/service-map/SKILL.md"
cp -r "$ROUND/_skills/service-map.reference" "$SNAP_ROOT/service-map/reference"
# Пути — Windows-формы: `claude` здесь windows-процесс, msys-путь (`/tmp/…`, `/c/…`) его Read не берёт.
winp() { ( cd "$1" && { pwd -W 2>/dev/null || pwd; } ); }
TMPL_WIN="$(winp "$SNAP_ROOT/service-map/reference")/card.template.md"

# NRS-TAIL собирается генератором; при параллельных прогонах seed.sh собрал бы out/ наперегонки.
if [ "$SEED" = NRS-TAIL ] && [ ! -d "$HERE/fixtures/NRS-TAIL/out/cargonet" ]; then
  echo "собираю NRS-TAIL/out (make.sh)…"; bash "$HERE/fixtures/NRS-TAIL/make.sh" "$HERE/fixtures/NRS-TAIL/out" > /dev/null || exit 1
fi

seed() {  # seed <куда>
  case "$SEED" in
    SM-REAL)  bash "$HERE/fixtures/SM-REAL/seed.sh" "$1" scan ;;
    NRS-TAIL) bash "$HERE/fixtures/NRS-TAIL/seed.sh" "$1" ;;
    *) echo "неизвестный засев: $SEED"; return 1 ;;
  esac
}

# prepare <песочница> — засев, пересчёт правды, prompt.md и _piece.json. Возврат ≠ 0 — промпт негоден.
prepare() {
  local sb="$1"
  seed "$sb/w" > "$sb/_seed.log" 2>&1 || { echo "  засев не собрался, см. $sb/_seed.log"; return 1; }
  local repo="$sb/w/$REPO" wd="$sb/w/AI-SDD"
  [ -d "$repo" ] && [ -d "$wd/services" ] || { echo "  нет $repo или $wd/services"; return 1; }
  local root_win; root_win="$(winp "$repo")"
  local abs=() wins=() p
  for p in "${PATHS[@]}"; do
    [ -e "$repo/$p" ] || { echo "  нет пути куска: $repo/$p"; return 1; }
    abs+=("$repo/$p"); wins+=("$(winp "$repo/$p")")
  done
  local joined; joined="$(printf '%s, ' "${wins[@]}")"; joined="${joined%, }"
  # Путь совпал с корнем — строки про корень в брифе нет (3.2: «у сервиса, чей путь совпадает с корнем»).
  local root_sub="$root_win"
  [ "${#wins[@]}" -eq 1 ] && [ "${wins[0]}" = "$root_win" ] && root_sub=""

  # Пересчёт ключей по засеву: что видит читающий, а не что записано в pieces.json.
  local recount="" r cls re inc file n
  for r in "${RULES[@]}"; do
    IFS=$'\x1f' read -r cls re inc file <<< "$r"
    if [ -n "$file" ]; then n=$(grep -hoE -- "$re" "$repo/$file" 2>/dev/null | wc -l)
    else n=$(grep -rhoE --include="$inc" -- "$re" "${abs[@]}" 2>/dev/null | wc -l); fi
    recount+="$cls=$((n))"$'\n'
  done
  local files; files=$(find "${abs[@]}" -type f -not -path '*/.git/*' -not -name .git | wc -l)

  local wd_win; wd_win="$(winp "$wd")"
  SMK_SKILL="$SNAP_MD" SMK_OUT="$sb/prompt.md" SMK_PIECEJSON="$sb/_piece.json" SMK_PIECES="$PIECES" \
  SMK_PIECE="$PIECE" SMK_PATHS="$joined" SMK_ROOT="$root_sub" SMK_ROOTWIN="$root_win" SMK_TYPE="$TYPE" \
  SMK_NAMES="$NAMES" SMK_TMPL="$TMPL_WIN" SMK_DATE="$(date +%F)" SMK_MODEL="$MODEL" \
  SMK_OPIS="$wd_win/services/.work/$REPO.opis.md" SMK_DRAFT="$wd_win/services/.work/$REPO.md" \
  SMK_WINS="$(printf '%s\n' "${wins[@]}")" SMK_RECOUNT="$recount" SMK_FILES="$files" \
  node - <<'JS'
const fs = require('fs')
const E = process.env
const die = m => { console.error('  ' + m); process.exit(1) }
const L = fs.readFileSync(E.SMK_SKILL, 'utf8').replace(/\r\n/g, '\n').split('\n')
const b1 = L.findIndex(l => l.startsWith('Ты — читающий субагент скилла'))
const b2 = L.findIndex((l, i) => i > b1 && l.startsWith('Ни чисел, ни пересказа'))
if (b1 < 0 || b2 < 0) die('не нашёл границы брифа (Ты — читающий… / Ни чисел, ни пересказа)')
const br = L.slice(b1, b2 + 1)
const at = (pred, from = 0) => { for (let i = from; i < br.length; i++) if (pred(br[i])) return i; return -1 }
// «По коду в этом сервисе <маркеры> …» — маркерного счёта у раннера нет, строка убирается целиком.
let i = at(l => l.startsWith('По коду в этом сервисе'))
if (i < 0) die('нет строки «По коду в этом сервисе…»'); br.splice(i, 1)
// Корень: кусок = весь репозиторий → строка про корень (с продолжением) убирается.
if (!E.SMK_ROOT) {
  i = at(l => l.startsWith('Корень репозитория:'))
  const j = at(l => l.includes('ключи оттуда не берёшь'), i)
  if (i < 0 || j < 0) die('нет строки «Корень репозитория: …ключи оттуда не берёшь»'); br.splice(i, j - i + 1)
}
// Прежней карточки нет → абзац «Прежняя карточка» до «## Карточка → файл».
i = at(l => l.startsWith('## Прежняя карточка'))
let j = at(l => l.startsWith('## Карточка → файл'), i)
if (i < 0 || j < 0) die('нет абзаца «## Прежняя карточка» или «## Карточка → файл»'); br.splice(i, j - i)
// notes нет → «Секция «Заметки команды» … дословно этот текст:» и строка <notes>.
i = at(l => l.startsWith('Секция «Заметки команды»'))
if (i < 0 || br[i + 1].trim() !== '<notes>') die('нет абзаца «Секция «Заметки команды»» + <notes>'); br.splice(i, 2)
let text = br.join('\n')
const sub = { '<пути>': E.SMK_PATHS, '<корень>': E.SMK_ROOT, '<type>': E.SMK_TYPE, '<имена>': E.SMK_NAMES,
  '<шаблон>': E.SMK_TMPL, '<дата>': E.SMK_DATE, '<опись>': E.SMK_OPIS, '<черновик>': E.SMK_DRAFT }
for (const [k, v] of Object.entries(sub)) if (v) text = text.split(k).join(v)
// Список плейсхолдеров — из «Что подставляешь в бриф» снимка, а не из головы раннера.
const a = L.findIndex(l => l.startsWith('**Что подставляешь в бриф**'))
const z = L.findIndex((l, k) => k > a && l.startsWith('#### 3.3'))
if (a < 0 || z < 0) die('нет раздела «Что подставляешь в бриф»')
const ph = new Set()
for (const l of L.slice(a, z)) for (const m of l.matchAll(/`(<[^`<>]+>)`/g)) if (m[1] !== '<…>') ph.add(m[1])
const left = [...ph].filter(p => text.includes(p))
const literal = [...new Set(text.match(/<[^<>\n]{1,40}>/g) || [])].filter(x => !ph.has(x))
fs.writeFileSync(E.SMK_OUT, text + '\n')
const truth = JSON.parse(fs.readFileSync(E.SMK_PIECES, 'utf8')).pieces[E.SMK_PIECE]
const recount = Object.fromEntries(E.SMK_RECOUNT.split('\n').filter(Boolean).map(s => { const [c, n] = s.split('='); return [c, Number(n)] }))
const sum = o => Object.values(o).reduce((s, n) => s + n, 0)
fs.writeFileSync(E.SMK_PIECEJSON, JSON.stringify({
  piece: E.SMK_PIECE, kind: truth.kind, fixture: truth.fixture, model: E.SMK_MODEL, date: E.SMK_DATE,
  root: E.SMK_ROOTWIN, rootLineKept: !!E.SMK_ROOT, paths: E.SMK_WINS.split('\n').filter(Boolean),
  opis: E.SMK_OPIS, draft: E.SMK_DRAFT, template: E.SMK_TMPL,
  truth: truth.truth, keys: truth.keys, recount, recountKeys: sum(recount), files: Number(E.SMK_FILES),
  placeholders: [...ph], left, literal,
}, null, 2) + '\n')
console.log(`  плейсхолдеры по 3.2: ${[...ph].join(' ')}`)
console.log(`  не расставлено: ${left.length ? left.join(' ') : 'нет'};  прочие <…> брифа (литералы формы): ${literal.join(' ') || 'нет'}`)
console.log(`  ключей: правда ${truth.keys} (${Object.entries(truth.truth).map(([c, n]) => c + ' ' + n).join(', ')}); пересчёт по засеву ${sum(recount)} (${Object.entries(recount).map(([c, n]) => c + ' ' + n).join(', ')})${sum(recount) !== truth.keys ? '  !!! РАЗОШЛОСЬ — правда в pieces.json устарела' : ''}`)
console.log(`  файлов в путях куска: ${E.SMK_FILES} (в pieces.json ${truth.files})`)
if (left.length) process.exit(2)
JS
}

# Проверки промпта для dry: Windows-форма путей, шаблон на месте, msys-путей нет.
dry_check() {
  local sb="$1" bad=0 p
  node -e '
const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))
for (const p of [j.root, ...j.paths, j.template, j.opis, j.draft]) console.log(p)
' "$sb/_piece.json" > "$sb/_paths.txt"
  while IFS= read -r p; do
    case "$p" in [A-Za-z]:/*) ;; *) echo "  !!! путь не Windows-формы: $p"; bad=1 ;; esac
  done < "$sb/_paths.txt"
  if [ -f "$(cygpath -u "$TMPL_WIN" 2>/dev/null || echo "$SNAP_ROOT/service-map/reference/card.template.md")" ]; then
    echo "  шаблон на месте: $TMPL_WIN ($(wc -l < "$SNAP_ROOT/service-map/reference/card.template.md") строк)"
  else echo "  !!! шаблона нет: $TMPL_WIN"; bad=1; fi
  if grep -nE '(^|[ `(])/(c|tmp|Users)/' "$sb/prompt.md"; then echo "  !!! в промпте msys-путь"; bad=1; fi
  return $bad
}

run_one() {
  local i="$1" sb="$ROUND/sandbox/$PIECE-$1"
  if [ -s "$sb/answer.md" ]; then echo "  $PIECE-$i — уже есть, пропуск"; return 0; fi
  # Метки прошлой попытки (`_api-failure.txt`, частичная опись) снимаются вместе с песочницей.
  rm -rf "$sb"; mkdir -p "$sb"
  prepare "$sb" || { echo "  $PIECE-$i — промпт не собран, прогона нет"; return 0; }
  local repo="$sb/w/$REPO" wd="$sb/w/AI-SDD"
  ( cd "$repo" && find . -type f -not -path '*/.git/*' | sort ) > "$sb/_seeded.txt"

  local deny=(--disallowedTools Agent)
  [ -n "${SM_K_ALLOW_AGENT:-}" ] && deny=()
  date +%s > "$sb/_time.txt"
  # Промпт — stdin: на Windows длина командной строки ограничена ~32 КБ.
  ( cd "$wd" && timeout 7200 claude -p --model "$MODEL" --permission-mode bypassPermissions \
      --output-format stream-json --verbose ${deny[@]+"${deny[@]}"} < "$sb/prompt.md" ) \
      > "$sb/_stream.jsonl" 2> "$sb/_stderr.log"
  local rc=$?
  date +%s >> "$sb/_time.txt"
  node "$HERE/stream-extract.mjs" "$sb/_stream.jsonl" "$sb" 2>> "$sb/_stderr.log"
  [ -f "$sb/_cost.txt" ] && mv "$sb/_cost.txt" "$sb/cost.txt"

  # Караул: читающий только читает (правило 2 брифа).
  ( cd "$repo" && find . -type f -not -path '*/.git/*' | sort ) > "$sb/_after.txt"
  if ! diff -q "$sb/_seeded.txt" "$sb/_after.txt" > /dev/null; then
    diff "$sb/_seeded.txt" "$sb/_after.txt" > "$sb/_dirt.txt"
    echo "  !!! $PIECE-$i — прогон трогал папку $REPO, см. _dirt.txt"
  fi
  # Отказ раннера — «не измерено», а не «провалено». Лимит сессии ложится в answer.md как ответ.
  if grep -qiE "API Error|Request not allowed|Please run /login|Credit balance|rate limit|session limit|usage limit|hit your .*limit" "$sb/answer.md" 2>/dev/null; then
    mv "$sb/answer.md" "$sb/_api-failure.txt"; echo "  $PIECE-$i — ОТКАЗ API, не измерено"; return 0
  fi
  if [ $rc -ne 0 ] || [ ! -s "$sb/answer.md" ]; then
    echo "  $PIECE-$i — ОТКАЗ (rc=$rc), см. $sb/_stderr.log"
  else
    local o="$wd/services/.work/$REPO.opis.md" c="$wd/services/.work/$REPO.md"
    echo "  $PIECE-$i — готов: опись $([ -s "$o" ] && echo есть || echo НЕТ), карточка $([ -s "$c" ] && echo есть || echo НЕТ), \$$(cat "$sb/cost.txt" 2>/dev/null)"
  fi
}

{
  echo "кусок: $PIECE ($KIND, $FIXTURE: $REPO; пути: ${PATHS[*]})"
  echo "модель: $MODEL; прогонов: $N, одновременно: $CONC; Agent: $([ -n "${SM_K_ALLOW_AGENT:-}" ] && echo разрешён || echo запрещён)"
  echo "снимок скилла: _skills/service-map.SKILL.md ($(wc -l < "$SNAP_MD") строк); источник: $SKILL_IN"
  echo "дата: $(date +%F)"
} > "$ROUND/_settings-$PIECE.txt"
cat "$ROUND/_settings-$PIECE.txt"

if [ -n "$DRY" ]; then
  sb="$ROUND/_dry/$PIECE"
  rm -rf "$sb"; mkdir -p "$sb"
  echo "DRY: песочница $sb — модель не зовётся"
  prepare "$sb"; rc=$?
  if [ $rc -eq 0 ]; then dry_check "$sb"; rc=$?; fi
  echo "─── пути ───"; cat "$sb/_paths.txt" 2>/dev/null
  echo "─── промпт ($(wc -c < "$sb/prompt.md" 2>/dev/null) байт) ───"; cat "$sb/prompt.md" 2>/dev/null
  echo "─── итог dry: $([ $rc -eq 0 ] && echo ГОДЕН || echo "НЕ ГОДЕН (rc=$rc)") ───"
  [ -n "${SM_K_DRY_KEEP:-}" ] || rm -rf "$sb/w"
  rm -rf "$SNAP_ROOT"
  exit $rc
fi

for i in $(seq 1 "$N"); do
  while [ "$(jobs -rp | wc -l)" -ge "$CONC" ]; do sleep 5; done
  run_one "$i" &
done
wait
echo "ГОТОВО: $PIECE — с ответом $(find "$ROUND/sandbox" -maxdepth 2 -name answer.md -size +0 -path "*/$PIECE-*" | wc -l) из $N"
rm -rf "$SNAP_ROOT"
