// summary-harden.mjs — сводка круга петли по выводу grade-loop.sh: зелёных по пробам, общий процент, пробы 0/N.
// После правок строка «по правке» у прогона — красный (ожидание черновика правок не выполнено), кроме снятых из батча
// правок и строк «проверить нечего». Отказ стенда («не измерено») в знаменатель не идёт.
//   bash grade-loop.sh <префикс> > runs/<префикс>-GRADE.txt; node summary-harden.mjs runs/<префикс>-GRADE.txt [--base]
// --base — версия до правок: строки «по правке» справочно, исход не меняют.
import { readFileSync } from 'node:fs'

const [file, flag] = [process.argv[2], process.argv[3]]
const base = flag === '--base'
const DROPPED = /\bE5\b|баг 5\b|проверить нечего|не измерен|как по правке/i
const lines = readFileSync(file, 'utf8').replace(/\r/g, '').split('\n')
const probes = []
let cur = null, run = null
for (const l of lines) {
  const h = l.match(/^=+ (\S+) \(node/)
  if (h) { cur = { name: h[1], runs: [] }; probes.push(cur); run = null; continue }
  if (!cur) continue
  const r = l.match(/^\s+run-(\d+):\s*(.*)$/)
  if (r) {
    const s = r[2]
    const status = /НЕ ИЗМЕРЕНО|не измерено/i.test(s.slice(0, 40)) ? 'skip' : /^(ЗЕЛЁНЫЙ|зелёный)/.test(s) ? 'green' : 'red'
    run = { n: r[1], status, why: status === 'red' ? s.slice(0, 220) : '', edit: [] }
    cur.runs.push(run)
    continue
  }
  if (run && /по правке/i.test(l) && !/^\s*\d+\/\d+/.test(l) && !/^ИТОГ|^по правке без замечаний/.test(l.trim())) {
    if (!DROPPED.test(l)) run.edit.push(l.trim().slice(0, 220))
  }
}
let g = 0, t = 0
const zero = []
for (const p of probes) {
  let pg = 0, pt = 0
  for (const r of p.runs) {
    if (r.status === 'skip') continue
    pt++
    const green = r.status === 'green' && (base || r.edit.length === 0)
    if (green) pg++
  }
  g += pg; t += pt
  if (pt && pg === 0) zero.push(p.name)
  const mark = pt ? `${pg}/${pt}` : 'не измерено'
  console.log(`${p.name.padEnd(18)} ${mark}`)
  for (const r of p.runs) {
    if (r.status === 'red') console.log(`   run-${r.n} красный: ${r.why}`)
    if (!base) for (const e of r.edit) console.log(`   run-${r.n} по правке → красный: ${e}`)
  }
}
console.log(`\nИТОГО: ${g}/${t} = ${t ? (100 * g / t).toFixed(1) : 0}%  (порог 85%)`)
console.log(`пробы 0/N: ${zero.length ? zero.join(', ') : 'нет'}`)
