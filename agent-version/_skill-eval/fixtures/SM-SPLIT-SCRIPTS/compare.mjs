// Сводка test-split-scripts.sh: читает выводы скриптов из <out> и печатает таблицу.
//   node compare.mjs <папка SM-SPLIT-SCRIPTS> <out>
// Фазы: 0) оракул plan.py против expect.json (проверка самого стенда); 1) plan.py — синтетика;
// 2) plan.py — настоящие деревья против оракула; 3) assemble.py — синтетика; 4) круговой случай на
// настоящей карточке; 5) promote.py. Код выхода 1 — есть ОШИБКА (или неисправен сам оракул).
import fs from 'node:fs'
import path from 'node:path'
import { checkPlanCase, checkPlanReal, checkOracle, checkPlanTsv } from './check-plan.mjs'
import { checkAsmCase, checkRoundtrip, checkPromote } from './check-assemble.mjs'

const [, , HERE, OUT] = process.argv
const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '')
const dirs = (p) => (fs.existsSync(p) ? fs.readdirSync(p).filter((x) => fs.statSync(path.join(p, x)).isDirectory()).sort() : [])
const rows = []
const push = (phase, name, list) => { for (const r of list) rows.push({ phase, name, ...r }) }
const loadRun = (d) => {
  const a = read(path.join(d, 'args.txt')).split(/\r?\n/)
  return { rc: Number(read(path.join(d, 'rc')).trim()), stdout: read(path.join(d, 'stdout')), stderr: read(path.join(d, 'stderr')), counts: read(path.join(d, 'counts.txt')), args: [Number(a[0]), Number(a[1]), a[2]], ms: read(path.join(d, 'ms')).trim(), tsv: fs.existsSync(path.join(d, 'plan.tsv')) ? read(path.join(d, 'plan.tsv')) : null }
}

// 0–1. plan синтетика
let oracleBad = 0
for (const name of dirs(path.join(HERE, 'cases', 'plan'))) {
  const ex = JSON.parse(read(path.join(HERE, 'cases', 'plan', name, 'expect.json')))
  const d = path.join(OUT, 'plan', name)
  const run = loadRun(d)
  const ob = checkOracle(ex, run.counts, run.args)
  if (ob.length) { oracleBad++; push('0 оракул', name, [{ check: 'оракул = expect.json', status: 'СТЕНД', detail: ob.join('; ') }]) }
  if (!fs.existsSync(path.join(d, 'rc'))) { push('1 plan', name, [{ check: 'прогон', status: 'не измерено', detail: 'нет вывода (скрипта нет?)' }]); continue }
  push('1 plan', name, checkPlanCase(ex, run))
  push('1 plan', name, checkPlanTsv(run))
}
// 2. plan на настоящих деревьях
for (const name of dirs(path.join(OUT, 'real'))) {
  const d = path.join(OUT, 'real', name)
  if (!fs.existsSync(path.join(d, 'rc'))) continue
  const run = loadRun(d)
  push('2 plan-real', `${name} (${run.ms} мс)`, checkPlanReal(run))
  push('2 plan-real', name, checkPlanTsv(run))
}
// 3. assemble синтетика
for (const name of dirs(path.join(HERE, 'cases', 'assemble')).filter((n) => !n.startsWith('_'))) {
  const ex = JSON.parse(read(path.join(HERE, 'cases', 'assemble', name, 'expect.json')))
  const d = path.join(OUT, 'asm', name)
  if (!fs.existsSync(path.join(d, 'rc'))) { push('3 assemble', name, [{ check: 'прогон', status: 'не измерено', detail: 'нет вывода' }]); continue }
  push('3 assemble', name, checkAsmCase(ex, d))
}
// 4. круговой
const rt = path.join(OUT, 'roundtrip')
if (fs.existsSync(path.join(rt, 'rc'))) push('4 круговой', `repairy-api (${read(path.join(rt, 'ms')).trim()} мс)`, checkRoundtrip(JSON.parse(read(path.join(rt, 'expect.json'))), rt))
// 5. promote
for (const name of dirs(path.join(OUT, 'promote'))) {
  const d = path.join(OUT, 'promote', name)
  if (fs.existsSync(path.join(d, 'meta.json'))) push('5 promote', name, checkPromote(d))
}

// ─── печать ───
const STAT = ['ОШИБКА', 'устойчивость', 'неоднозначность', 'СТЕНД', 'не измерено', 'справочно']
const byCase = new Map()
for (const r of rows) { const k = `${r.phase} · ${r.name}`; if (!byCase.has(k)) byCase.set(k, []); byCase.get(k).push(r) }
console.log('\n═══ Случаи ═══')
for (const [k, list] of byCase) {
  const ok = list.filter((r) => r.status === 'ok').length
  const worst = STAT.find((s) => list.some((r) => r.status === s && s !== 'справочно')) || 'ok'
  console.log(`${worst === 'ok' ? 'ok  ' : worst.padEnd(4)}  ${k}  — проверок ok ${ok}/${list.filter((r) => r.status !== 'справочно').length}`)
}
console.log('\n═══ Расхождения и справки ═══')
console.log('статус | фаза · случай | проверка | что видно')
for (const r of rows.filter((x) => x.status !== 'ok')) console.log(`${r.status} | ${r.phase} · ${r.name} | ${r.check} | ${r.detail}`)
const cnt = (s) => rows.filter((r) => r.status === s).length
console.log(`\nИТОГ: проверок ${rows.length}; ok ${cnt('ok')}; ОШИБКА ${cnt('ОШИБКА')}; устойчивость ${cnt('устойчивость')}; неоднозначность ${cnt('неоднозначность')}; не измерено ${cnt('не измерено')}; справочно ${cnt('справочно')}${oracleBad ? `; СТЕНД (оракул ≠ ожидание) ${oracleBad}` : '; оракул = ожидание во всех случаях plan'}`)
process.exit(cnt('ОШИБКА') || oracleBad ? 1 : 0)
