// Автоматическая диагностика; verdict выставляется после чтения артефакта и входа.
// Автоматический красный никогда не становится skill-red без проверки причины.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { gradeText, sections } from './grade-na.mjs'

const round = resolve(process.argv[2] ?? '')
const manifest = JSON.parse(readFileSync(join(round, 'MANIFEST.json'), 'utf8'))
const hash = p => createHash('sha256').update(readFileSync(p)).digest('hex')
const templateOf = text => text.replaceAll('\r\n', '\n').split('````markdown\n')[1].split('\n````')[0]
const skill = readFileSync(join(round, '_skills/technical-spec-doc/SKILL.md'), 'utf8')
const expectedHeadings = templateOf(skill).split('\n').filter(l => /^#{2,3} \d+\./.test(l) || l.startsWith('### Каталог ошибок'))
const baseHeads = templateOf(readFileSync(join(round, '../2026-10-06-na-strike-v4/_skills/technical-spec-doc/SKILL.md'), 'utf8'))
  .split('\n').filter(l => /^#{2,3} \d+\./.test(l) || l.startsWith('### Каталог ошибок'))
const unchanged = JSON.stringify(expectedHeadings) === JSON.stringify(baseHeads)
const snapshot = JSON.parse(readFileSync(join(round, 'SNAPSHOT.json'), 'utf8'))
const snapshotChanged = snapshot.filter(f => hash(join(round, '_skills', f.path)) !== f.sha256).map(f => f.path)
const rows = manifest.map(r => {
  const resultPath = join(r.work, 'RESULT.json')
  const result = existsSync(resultPath) ? JSON.parse(readFileSync(resultPath, 'utf8')) : null
  const seeds = JSON.parse(readFileSync(join(r.work, 'INPUT-HASHES.json'), 'utf8'))
  const editableSeed = r.kind === 'refine' ? r.target : ['ts-fix','ts-fix-yes'].includes(r.id) ? 'coddoc/PSS-2210/technical_specification.md' : null
  const changedInputs = seeds.filter(f => f.path !== editableSeed && hash(join(r.work, f.path)) !== f.sha256).map(f => f.path)
  const text = r.target && existsSync(join(r.work, r.target)) ? readFileSync(join(r.work, r.target), 'utf8') : null
  const answer = existsSync(join(r.work, 'answer.md')) ? readFileSync(join(r.work, 'answer.md'), 'utf8') : null
  let diagnostic = null
  if (text && !r.kind.startsWith('review')) {
    diagnostic = gradeText(text, { expectedHeadings })
    // grade-na предполагал старый FR-1/наличие хотя бы одной NA-секции. Здесь это лишь диагностика.
    delete diagnostic.pass
    const ss = sections(text)
    diagnostic.required = ['3.2','6.2','7'].map(id => {
      const s = ss.find(s => s.id === id)
      return { id, present: !!s, struck: s?.struck, own: s?.own.filter(l => l.trim()).join('\n') }
    })
    diagnostic.status = text.match(/Статус готовности:\*\*\s*(.*)/)?.[1] ?? null
    diagnostic.openBlock = text.split(/Открытые вопросы[^\n]*\n/)[1]?.split(/^## /m)[0]?.trim() ?? ''
  }
  return { id: r.id, kind: r.kind, completed: !!result?.terminal, result, changedInputs, wrote: !!text,
    diagnostic, reviewCount: answer ? [...answer.matchAll(/нарушений\s*:\s*\*{0,2}(\d+)/gi)].at(-1)?.[1] : null }
})
const report = { unchangedHeadings: unchanged, snapshotChanged, rows }
writeFileSync(join(round, 'AUDIT.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ unchangedHeadings: unchanged, snapshotChanged,
  rows: rows.filter(r => !process.argv.includes('--summary') || r.completed).map(({ diagnostic, ...r }) => ({ ...r,
    diagnostic: diagnostic && { structure: diagnostic.structure, missing: diagnostic.missing, defects: diagnostic.defects,
      status: diagnostic.status } })) }, null, 2))
