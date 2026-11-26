import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '../..')
const output = join(import.meta.dirname, 'runs/2026-10-06-applicability-comparison')
if (existsSync(output)) throw new Error('Comparison already exists; frozen inputs must not be overwritten')
const previous = join(import.meta.dirname, 'runs/2026-10-06-applicability-r7')
const oldManifest = JSON.parse(readFileSync(join(previous, 'MANIFEST.json'), 'utf8'))
const ids = ['bf-spec', 'bfg-scroll', 'bfg-role', 'ts-conv', 'ts-ctx', 'ua-label', 'ua-timeout', 'ua-review-reliability']
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
function files(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory()
    ? files(join(dir, e.name), base)
    : [{ path: relative(base, join(dir, e.name)).replaceAll('\\', '/'), sha256: hash(readFileSync(join(dir, e.name))) }])
}
function write(path, bytes) { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, bytes) }
const baselineCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
for (const skill of ['technical-spec-doc', 'spec-review', 'analyst-workspace']) {
  const prefix = 'agent-version/' + skill + '/'
  const tracked = execFileSync('git', ['ls-tree', '-r', '--name-only', baselineCommit, '--', prefix], { cwd: root, encoding: 'utf8' }).trim().split('\n')
  for (const path of tracked) write(join(output, '_skills/A', path.slice('agent-version/'.length)), execFileSync('git', ['show', baselineCommit + ':' + path], { cwd: root }))
  cpSync(join(root, prefix), join(output, '_skills/B', skill), { recursive: true })
}
const manifest = []
for (const id of ids) {
  const old = oldManifest.find(r => r.id === id)
  const seed = join(output, '_inputs', id)
  for (const f of JSON.parse(readFileSync(join(old.work, 'INPUT-HASHES.json'), 'utf8'))) {
    const bytes = readFileSync(join(old.work, f.path))
    if (hash(bytes) !== f.sha256) throw new Error('Changed source input: ' + id + '/' + f.path)
    write(join(seed, f.path), bytes)
  }
  if (['bf-spec', 'ts-conv'].includes(id)) {
    const prompt = readFileSync(join(seed, 'prompt.txt'), 'utf8')
    const additional = readFileSync(join(old.work, 'turn2-response.txt'), 'utf8')
    write(join(seed, 'prompt.txt'), prompt + '\n\n' + additional + '\n')
  }
  if (id === 'ua-review-reliability') {
    const path = join(seed, old.target)
    const text = readFileSync(path, 'utf8')
    if (!/^## 5\. /m.test(text)) throw new Error('Expected original fixture parent heading')
    write(path, text.replace(/^## (5\. .+)$/m, '## ~~$1~~'))
    const neighbor = 'coddoc/UA-410/business_requirements.md'
    if (!existsSync(join(seed, neighbor))) write(join(seed, neighbor), readFileSync(join(old.work, neighbor)))
  }
  const inputHashes = files(seed)
  for (const arm of ['A', 'B']) {
    const work = join(output, arm, id, 'run-01')
    cpSync(seed, work, { recursive: true })
    write(join(work, 'INPUT-HASHES.json'), JSON.stringify(inputHashes, null, 2) + '\n')
    manifest.push({ id, arm, work, skill: join(output, '_skills', arm, id.startsWith('ua-review-') ? 'spec-review/SKILL.md' : 'technical-spec-doc/SKILL.md'), target: old.target, kind: id.startsWith('ua-review-') ? 'review' : id.startsWith('bfg-') ? 'question' : 'write' })
  }
}
write(join(output, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n')
write(join(output, 'SNAPSHOT.json'), JSON.stringify(files(join(output, '_skills')), null, 2) + '\n')
write(join(output, 'SETTINGS.json'), JSON.stringify({ model: 'gpt-6-luna', reasoning_effort: 'max', fork_turns: 'none', repeats: 1, arms: { A: { source: 'Git HEAD', commit: baselineCommit }, B: { source: 'final working tree' } }, scope: ids, inputChanges: ['same previously confirmed missing owner answers appended to bf-spec and ts-conv', 'review fixture parent 5 struck in both arms; same neighboring legacy BT'], attribution: 'paired observation; a one-sample difference is a candidate, not causal proof', stop: 'only confirmed current-change defects count; fixtures, graders, runners and un-attributed historical failures excluded' }, null, 2) + '\n')
write(join(output, 'DIFF.patch'), execFileSync('git', ['diff', '--', 'agent-version/technical-spec-doc', 'agent-version/spec-review', 'agent-version/analyst-workspace'], { cwd: root }))
console.log(JSON.stringify({ output, pairs: ids.length, baselineCommit }))
