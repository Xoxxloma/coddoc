import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const runs = join(import.meta.dirname, 'runs')
const rounds = readdirSync(runs).filter(n => /^2026-10-06-applicability-r\d+$/.test(n)).sort((a,b) => Number(a.split('-r').at(-1)) - Number(b.split('-r').at(-1)))
const rows = []
for (const name of rounds) {
  const round = join(runs, name)
  const manifest = JSON.parse(readFileSync(join(round, 'MANIFEST.json'), 'utf8'))
  for (const r of manifest) {
    const p = join(r.work, 'RESULT.json')
    if (existsSync(p)) rows.push({ round: name, id: r.id, ...JSON.parse(readFileSync(p, 'utf8')) })
  }
  writeFileSync(join(round, 'STATE.md'), '# ' + name + '\n\nМодель gpt-6-luna, reasoning max; снимок неизменяемый.\n\n' + manifest.map(r => {
    const result = rows.find(row => row.round === name && row.id === r.id)
    return '- ' + r.id + ': ' + (result ? result.verdict + ' — ' + result.evidence : 'pending')
  }).join('\n') + '\n')
}
const ids = [...new Set(rows.map(r => r.id))]
const counts = ids.map(id => ({ id,
  observedRed: rows.filter(r => r.id === id && r.terminal && (r.observedVerdict ?? r.verdict) === 'skill-red').length,
  skillRed: rows.filter(r => r.id === id && r.terminal && r.verdict === 'skill-red' && r.confirmedChangeDefect === true && r.comparableBaseline && r.countForChangeStop === true).length,
  green: rows.filter(r => r.id === id && r.terminal && r.verdict === 'green').length,
  excluded: rows.filter(r => r.id === id && r.terminal && !['green','skill-red'].includes(r.verdict)).length }))
const latest = rounds.at(-1)
const manifest = JSON.parse(readFileSync(join(runs, latest, 'MANIFEST.json'), 'utf8'))
const latestRows = rows.filter(r => r.round === latest && r.terminal)
const exitRed = counts.filter(c => c.skillRed >= 3)
const fullGreen = latestRows.length === manifest.length && latestRows.every(r => r.verdict === 'green')
const report = { latest, totalProbes: manifest.length, terminalOnLatest: latestRows.length, fullGreen, exitRed,
  comparisonStatus: latestRows.length > 0 && latestRows.every(r => r.comparableBaseline) ? 'baseline-recorded' : 'baseline-missing', counts, rows }
writeFileSync(join(runs, latest, 'PROGRESS.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ latest, totalProbes: manifest.length, terminalOnLatest: latestRows.length, fullGreen, exitRed, counts }, null, 2))
