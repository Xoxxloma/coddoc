import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const round = resolve(process.argv[2] ?? join(import.meta.dirname, 'runs/2026-10-06-applicability-comparison'))
const manifest = JSON.parse(readFileSync(join(round, 'MANIFEST.json'), 'utf8'))
const rows = manifest.map(r => ({ id: r.id, arm: r.arm, repeat: r.repeat ?? 1,
  ...(existsSync(join(r.work, 'RESULT.json')) ? JSON.parse(readFileSync(join(r.work, 'RESULT.json'), 'utf8')) : { terminal: false, verdict: 'pending' }) }))
const latestArm = rows.some(r => r.arm === 'C') ? 'C' : 'B'
const final = rows.filter(r => r.arm === latestArm && r.repeat === 1)
const latestRows = rows.filter(r => r.arm === latestArm)
const primaryCompleted = final.filter(r => r.terminal).length
const targetPass = final.filter(r => r.terminal && Object.values(r.targetChecks ?? {}).length > 0 && Object.values(r.targetChecks).every(Boolean)).length
const confirmed = rows.filter(r => r.arm === latestArm && r.terminal && r.confirmedChangeDefect === true && r.comparableBaseline && r.countForChangeStop === true)
const report = { latestArm, primaryPairs: final.length, completedPairs: final.filter(r => r.terminal && rows.some(a => a.id === r.id && a.arm === 'A' && a.repeat === 1 && a.terminal)).length,
  latestRuns: latestRows.length, completedLatestRuns: latestRows.filter(r => r.terminal).length,
  latestTargetPass: latestRows.filter(r => r.terminal && Object.values(r.targetChecks ?? {}).length > 0 && Object.values(r.targetChecks).every(Boolean)).length,
  totalRuns: rows.length, completedRuns: rows.filter(r => r.terminal).length, afterTargetPass: targetPass,
  allPrimaryTargetsPass: primaryCompleted === final.length && targetPass === final.length,
  latestScopeGreen: latestRows.every(r => r.terminal && Object.values(r.targetChecks ?? {}).every(Boolean) && !(r.observations ?? []).length),
  fullRegistryGreen: false,
  confirmedCurrentChangeDefects: confirmed.length, rows }
writeFileSync(join(round, 'PROGRESS.json'), JSON.stringify(report, null, 2) + '\n')
writeFileSync(join(round, 'STATE.md'), '# Сравнение: состояние\n\n' + rows.map(r => '- ' + r.arm + '/' + r.id + '/run-' + String(r.repeat).padStart(2, '0') + ': ' + r.verdict).join('\n') + '\n')
console.log(JSON.stringify({ ...report, rows: undefined }, null, 2))
