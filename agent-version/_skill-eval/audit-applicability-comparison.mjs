// Diagnostics only. Manual paired attribution is recorded separately in RESULT.json.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { gradeText } from './grade-na.mjs'

const round = resolve(process.argv[2] ?? join(import.meta.dirname, 'runs/2026-10-06-applicability-comparison'))
const manifest = JSON.parse(readFileSync(join(round, 'MANIFEST.json'), 'utf8'))
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex')
const templateHeads = arm => readFileSync(join(round, '_skills', arm, 'technical-spec-doc/SKILL.md'), 'utf8')
  .replaceAll('\r\n', '\n').split('````markdown\n')[1].split('\n````')[0].split('\n')
  .filter(line => /^#{2,3} \d+\./.test(line) || line.startsWith('### Каталог ошибок'))
const expected = templateHeads('A')
const snapshotChanged = JSON.parse(readFileSync(join(round, 'SNAPSHOT.json'), 'utf8'))
  .filter(f => hash(join(round, '_skills', f.path)) !== f.sha256).map(f => f.path)
const rows = manifest.map(r => {
  const inputs = JSON.parse(readFileSync(join(r.work, 'INPUT-HASHES.json'), 'utf8'))
  const changedInputs = inputs.filter(f => hash(join(r.work, f.path)) !== f.sha256).map(f => f.path)
  const artifact = r.target && existsSync(join(r.work, r.target)) ? readFileSync(join(r.work, r.target), 'utf8') : null
  const result = existsSync(join(r.work, 'RESULT.json')) ? JSON.parse(readFileSync(join(r.work, 'RESULT.json'), 'utf8')) : null
  const diagnostic = artifact && r.kind === 'write' ? gradeText(artifact, { expectedHeadings: expected }) : null
  if (diagnostic) delete diagnostic.pass
  const stage2 = existsSync(join(r.work, 'TURN2-HASHES.json')) ? JSON.parse(readFileSync(join(r.work, 'TURN2-HASHES.json'), 'utf8')) : []
  const changedStage2 = stage2.filter(f => hash(join(r.work, f.path)) !== f.sha256).map(f => f.path)
  return { id: r.id, arm: r.arm, repeat: r.repeat ?? 1, kind: r.kind, terminal: result?.terminal ?? false,
    changedInputs, changedStage2, wrote: !!artifact && r.kind === 'write', answerSaved: existsSync(join(r.work, 'answer.md')), result, diagnostic }
})
const pairs = manifest.filter(r => r.arm === 'A').map(a => {
  const b = manifest.find(r => r.id === a.id && (r.repeat ?? 1) === (a.repeat ?? 1) && r.arm === 'B')
  const stage2A = existsSync(join(a.work, 'TURN2-HASHES.json')) ? readFileSync(join(a.work, 'TURN2-HASHES.json'), 'utf8') : null
  const stage2B = existsSync(join(b.work, 'TURN2-HASHES.json')) ? readFileSync(join(b.work, 'TURN2-HASHES.json'), 'utf8') : null
  return { id: a.id, repeat: a.repeat ?? 1, sameInputs: readFileSync(join(a.work, 'INPUT-HASHES.json'), 'utf8') === readFileSync(join(b.work, 'INPUT-HASHES.json'), 'utf8'), sameStage2: stage2A === stage2B }
})
const controlPairs = manifest.filter(r => r.arm === 'C').map(c => {
  const b = manifest.find(r => r.arm === 'B' && r.id === c.id && (r.repeat ?? 1) === (c.repeat ?? 1))
  return { id: c.id, repeat: c.repeat ?? 1, sameInputs: readFileSync(join(c.work, 'INPUT-HASHES.json'), 'utf8') === readFileSync(join(b.work, 'INPUT-HASHES.json'), 'utf8') }
})
const unchangedHeadingsC = existsSync(join(round, '_skills/C')) ? JSON.stringify(expected) === JSON.stringify(templateHeads('C')) : null
const report = { snapshotChanged, unchangedHeadings: JSON.stringify(expected) === JSON.stringify(templateHeads('B')), unchangedHeadingsC, pairs, controlPairs, rows }
writeFileSync(join(round, 'AUDIT.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ snapshotChanged, unchangedHeadings: report.unchangedHeadings, unchangedHeadingsC, pairs, controlPairs,
  rows: rows.map(r => ({ id: r.id, arm: r.arm, repeat: r.repeat, terminal: r.terminal, changedInputs: r.changedInputs, changedStage2: r.changedStage2, wrote: r.wrote,
    answerSaved: r.answerSaved, missing: r.diagnostic?.missing, defectTypes: r.diagnostic?.defects.reduce((a, d) => ({ ...a, [d.type]: (a[d.type] ?? 0) + 1 }), {}) })) }, null, 2))
