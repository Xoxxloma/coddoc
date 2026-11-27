#!/usr/bin/env bash
# run-sm-regress-2.sh <папка-раунда> [--grade-only] — постоянный регресс `service-map-2.0`: дешёвый, без инструментов.
#
#   ./run-sm-regress-2.sh runs/<дата>-regress-2              # прогоны + грейд + итог по порогам
#   ./run-sm-regress-2.sh runs/<дата>-regress-2 --grade-only # только грейд и итог по уже лежащим ответам
#
# Плечи — как у run-sm-regress.sh, SM-ENT заменён на SM-ENT-2 (случаи под разведчика), добавлен SM-MARK:
#   sm-gate         SM-GATE, 21 двойник × 3, sonnet        — гейт «Бизнес-правила»
#   sm-guard        SM-GUARD, 10 случаев × 3, sonnet        — формула гарда-маршрутизатора
#   sm-guard-haiku  SM-GUARD, 10 случаев × 3, haiku         — та же формула на прокси прод-модели
#   sm-lead         SM-FIELD/LEAD, 3 случая × 3, sonnet     — обрыв субагента, второй обрыв, текст добора
#   sm-ent-2        SM-ENT-2, 4 случая × 3, sonnet и haiku  — сущности: сверка сверху по строке разведчика
#   sm-mark         SM-MARK, 6 случаев × 3, sonnet и haiku  — маркерный гейт по разведчику, детектор узкого маркера
# Скилл — SKILL_SRC, по умолчанию agent-version/service-map/SKILL.md.
# Пороги (зелёный) — из строки «Зелёный: …» run-sm-regress.sh (круг 2.2.x): гейт ≥ 60/63, t и u 3/3; гард sonnet
# 30/30; гард haiku ≥ 28/30; lead 9/9; ent sonnet 12/12, haiku ≥ 10/12 — те же для SM-ENT-2; SM-MARK — 3/3 на
# каждый случай на обеих моделях (критерий А-2 PLAN-AUTOSPLIT). Плечо с пустыми или недостающими ответами —
# НЕ ИЗМЕРЕНО, не зелёное и не красное. Полные выводы грейдеров — <раунд>/_grade-<плечо>.txt.
set -u
ROUND="${1:?папка раунда}"; MODE="${2:-}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL="${SKILL_SRC:-$HERE/../service-map/SKILL.md}"
if [ "$MODE" != "--grade-only" ]; then
  [ -f "$SKILL" ] || { echo "нет $SKILL" >&2; exit 1; }
  mkdir -p "$ROUND"
  echo "скилл: $SKILL" > "$ROUND/_regress-2.txt"
  echo "=== sm-gate (sonnet) ==="; SM_MODEL=sonnet bash "$HERE/run-sm-gate.sh" "$SKILL" "$ROUND" 3 | tail -1
  echo "=== sm-guard (sonnet) ==="; SM_MODEL=sonnet bash "$HERE/run-sm-guard.sh" "$SKILL" "$ROUND" 3 | tail -1
  echo "=== sm-guard (haiku) ==="; SM_MODEL=haiku SM_OUT=sm-guard-haiku bash "$HERE/run-sm-guard.sh" "$SKILL" "$ROUND" 3 | tail -1
  echo "=== sm-lead (sonnet) ==="; SM_MODEL=sonnet bash "$HERE/run-sm-lead.sh" "$SKILL" "$ROUND" 3 | tail -1
  echo "=== sm-ent-2 (sonnet) ==="; SM_MODEL=sonnet bash "$HERE/run-sm-ent-2.sh" "$SKILL" "$ROUND" 3 | tail -1
  echo "=== sm-ent-2 (haiku) ==="; SM_MODEL=haiku SM_OUT=sm-ent-2-haiku bash "$HERE/run-sm-ent-2.sh" "$SKILL" "$ROUND" 3 | tail -1
  echo "=== sm-mark (sonnet) ==="; SM_MODEL=sonnet bash "$HERE/run-sm-mark.sh" "$SKILL" "$ROUND" 3 | tail -1
  echo "=== sm-mark (haiku) ==="; SM_MODEL=haiku SM_OUT=sm-mark-haiku bash "$HERE/run-sm-mark.sh" "$SKILL" "$ROUND" 3 | tail -1
fi
[ -d "$ROUND" ] || { echo "нет папки $ROUND" >&2; exit 1; }
echo; echo "##### ГРЕЙД И ИТОГ ПО ПОРОГАМ"
node - "$ROUND" "$HERE" <<'JS'
const { execFileSync } = require('child_process'); const fs = require('fs'); const path = require('path')
const [round, here] = process.argv.slice(2); const N = 3
const ls = (d, re) => (fs.existsSync(d) ? fs.readdirSync(d).filter((f) => re.test(f)) : [])
const exp = {
  gate: ls(path.join(here, 'fixtures/SM-GATE'), /^answer-.+\.md$/).length * N,
  guard: ls(path.join(here, 'fixtures/SM-GUARD'), /^case-.+\.md$/).length * N,
  lead: Object.keys(JSON.parse(fs.readFileSync(path.join(here, 'fixtures/SM-FIELD/LEAD/expect.json'), 'utf8'))).length * N,
  ent2: ls(path.join(here, 'fixtures/SM-ENT-2'), /^case-.+\.md$/).length * N,
  mark: ls(path.join(here, 'fixtures/SM-MARK'), /^case-.+\.md$/).length * N,
}
// ответы на диске: всего и пустых (пустой = НЕ ИЗМЕРЕНО — отказ API, лимит, брошенный прогон)
const answers = (dir) => {
  let total = 0, empty = 0
  for (const s of ls(dir, /./)) { const d = path.join(dir, s); if (!fs.statSync(d).isDirectory()) continue
    for (const f of ls(d, /^answer-\d+\.md$/)) { total++; if (!fs.readFileSync(path.join(d, f), 'utf8').trim()) empty++ } }
  return { total, empty }
}
const run = (args, key) => { let out = ''; try { out = execFileSync('node', args, { encoding: 'utf8' }) } catch (e) { out = (e.stdout || '') + (e.stderr || '') }
  fs.writeFileSync(path.join(round, `_grade-${key}.txt`), out); return out }
const g = (f) => path.join(here, f)
const textArm = (key, label, grader, expTotal, min, extra) => ({ key, label, expTotal, min, grade (dir) {
  const out = run([...grader, dir], key); const m = out.match(/(\d+)\/(\d+)\s*\t?\s*зелёных/)
  const res = { green: m ? +m[1] : 0, measuredByGrader: m ? +m[2] : 0, problems: [] }
  if (extra) extra(out, res); return res } })
const jsonArm = (key, label, grader, expTotal, min, perCase) => ({ key, label, expTotal, min, grade (dir) {
  const out = run([...grader, dir, '--json'], key); let j = { rows: [], green: 0, total: 0 }; try { j = JSON.parse(out) } catch {}
  const res = { green: j.green, measuredByGrader: j.total, problems: [] }
  for (const r of j.rows) {
    if (perCase && r.ok < N) res.problems.push(`${r.v} ${r.ok}/${r.measured}`)
    else if (!perCase && r.ok < r.measured) res.problems.push(`${r.v} ${r.ok}/${r.measured}`)
  }
  return res } })
const tu = (out, res) => { for (const v of ['t', 'u']) { const m = out.match(new RegExp(`^\\s+${v}\\s+ожидание\\s+\\S+\\s+(\\d+)\\/(\\d+)`, 'm'))
  if (!m || +m[1] < N) res.problems.push(`${v} ${m ? m[1] + '/' + m[2] : 'нет'} — нужно ${N}/${N}`) } }
const arms = [
  textArm('sm-gate', 'SM-GATE sonnet', [g('grade-sm-gate.mjs')], exp.gate, 60, tu),
  textArm('sm-guard', 'SM-GUARD sonnet', [g('grade-sm-guard-iso.mjs')], exp.guard, exp.guard),
  textArm('sm-guard-haiku', 'SM-GUARD haiku', [g('grade-sm-guard-iso.mjs')], exp.guard, exp.guard - 2),
  textArm('sm-lead', 'LEAD sonnet', [g('fixtures/SM-FIELD/grade-sm-field.mjs'), 'lead'], exp.lead, exp.lead),
  jsonArm('sm-ent-2', 'SM-ENT-2 sonnet', [g('grade-sm-ent-2.mjs')], exp.ent2, exp.ent2, false),
  jsonArm('sm-ent-2-haiku', 'SM-ENT-2 haiku', [g('grade-sm-ent-2.mjs')], exp.ent2, exp.ent2 - 2, false),
  jsonArm('sm-mark', 'SM-MARK sonnet', [g('grade-sm-mark.mjs')], exp.mark, exp.mark, true),
  jsonArm('sm-mark-haiku', 'SM-MARK haiku', [g('grade-sm-mark.mjs')], exp.mark, exp.mark, true),
]
let red = 0, unmeasured = 0
for (const a of arms) {
  const dir = path.join(round, a.key); const need = `≥ ${a.min}/${a.expTotal}`
  if (!fs.existsSync(dir)) { unmeasured++; console.log(`  ${a.label.padEnd(16)} НЕТ ПРОГОНОВ   (порог ${need})`); continue }
  const ans = answers(dir); const r = a.grade(dir)
  const perCaseMark = a.key.startsWith('sm-mark')
  let verdict
  if (ans.total < a.expTotal || ans.empty > 0) { verdict = `НЕ ИЗМЕРЕНО (ответов ${ans.total} из ${a.expTotal}, пустых ${ans.empty})`; unmeasured++ }
  else if (r.green >= a.min && (perCaseMark ? r.problems.length === 0 : !(a.key === 'sm-gate' && r.problems.length))) verdict = 'ЗЕЛЁНЫЙ'
  else { verdict = 'КРАСНЫЙ'; red++ }
  const extra = r.problems.length ? `  · ${perCaseMark || a.key === 'sm-gate' ? '' : '(для справки) '}${r.problems.join(', ')}` : ''
  console.log(`  ${a.label.padEnd(16)} ${String(r.green).padStart(2)}/${a.expTotal}  порог ${need.padEnd(9)}${perCaseMark ? ' и 3/3 на случай' : a.key === 'sm-gate' ? ' и t, u 3/3' : ''}  → ${verdict}${extra}`)
}
console.log(`\n  ИТОГ: ${red ? 'КРАСНЫЙ' : unmeasured ? 'НЕ ИЗМЕРЕНО' : 'ЗЕЛЁНЫЙ'}  (красных плеч ${red}, неизмеренных ${unmeasured})`)
console.log('  Пороги: run-sm-regress.sh, строка «Зелёный: …» (круг 2.2.x); SM-ENT-2 — как SM-ENT; SM-MARK — 3/3 на случай, А-2 PLAN-AUTOSPLIT.')
JS
