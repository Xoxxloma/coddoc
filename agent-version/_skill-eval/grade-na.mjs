// Проверяем записанную спеку: сохранность формы, оформление и открытые пункты.
// Инференса и эвристики «красный прогон = сбой» здесь нет.
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { normalizeSpecHeadings } from './spec-markdown.mjs'

const NA = /не\s*применимо/i
const OPEN = /TBD|🟡|❓|⚠️/
const wholeStrike = (s) => /^~~\S[\s\S]*~~$/.test(s.trim()) && (s.match(/~~/g) ?? []).length === 2
const textOf = (s) => s.replace(/^\s*>\s?/, '').replace(/^\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+)/, '').trim()

export function sections (text) {
  const raw = text.split(/\r?\n/)
  const normalized = normalizeSpecHeadings(text).split('\n')
  const result = []
  let fence = null
  for (let i = 0; i < raw.length; i++) {
    const mark = /^\s{0,3}(`{3,}|~{3,})/.exec(raw[i])
    if (mark) {
      if (!fence) fence = mark[1]
      else if (mark[1][0] === fence[0] && mark[1].length >= fence.length) fence = null
      continue
    }
    if (fence) continue
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(normalized[i])
    if (!match) continue
    result.push({ line: i + 1, start: i, level: match[1].length, title: match[2],
      id: match[2].match(/^(\d+(?:\.\d+)*)\./)?.[1] ?? null,
      struck: wholeStrike(raw[i].replace(/^#{1,6}\s+/, '')) })
  }
  return result.map((s, i) => ({ ...s, own: raw.slice(s.start + 1, result[i + 1]?.start ?? raw.length) }))
}

// Ячейки с escaped | и | внутри inline code не режем посередине.
function cells (line) {
  const result = []; let part = '', code = false, escaped = false
  for (const c of line.trim()) {
    if (escaped) { part += c; escaped = false; continue }
    if (c === '\\') { part += c; escaped = true; continue }
    if (c === '`') code = !code
    if (c === '|' && !code) { result.push(part.trim()); part = '' } else part += c
  }
  result.push(part.trim())
  return result.slice(1, -1)
}

function content (lines) {
  const parts = []
  let fence = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const mark = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
    if (mark) {
      if (!fence) fence = mark[1]
      else if (mark[1][0] === fence[0] && mark[1].length >= fence.length) fence = null
      continue
    }
    if (fence) { parts.push({ text: line, reasoned: false }); continue }
    if (!line.trim() || /^\s*(?:---+|\*\*\*+)\s*$/.test(line)) continue
    if (/^\s*\|/.test(line)) {
      const row = cells(line)
      if (row.every((c) => /^:?-+:?$/.test(c))) continue
      if (/^\s*\|/.test(lines[i + 1] ?? '') && cells(lines[i + 1]).every((c) => /^:?-+:?$/.test(c))) continue
      const reasoned = row.some((c) => /не\s*применимо\s*[:,—-]\s*\S/i.test(c.replace(/~~/g, '')))
      parts.push(...row.filter((c) => c && !/^—$/.test(c)).map((text) => ({ text, reasoned })))
    } else parts.push({ text: textOf(line), reasoned: false })
  }
  return parts.filter((p) => p.text)
}

export function gradeText (text, { expectedHeadings = [], scenario = null } = {}) {
  const ss = sections(text)
  const defects = []
  let markupFence = null
  text.split(/\r?\n/).forEach((line, i) => {
    const mark = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
    if (mark) {
      if (!markupFence) markupFence = mark[1]
      else if (mark[1][0] === markupFence[0] && mark[1].length >= markupFence.length) markupFence = null
      return
    }
    if (markupFence) return
    if (/^(?:\s*[-*+]\s+~~\[[ xX]\]\s|\s*~~[-*+]\s+(?:\[[ xX]\]\s)?)/.test(line)) defects.push({ type: 'markup-struck', line: i + 1, text: line })
  })
  const plainHeads = ss.map((s) => '#'.repeat(s.level) + ' ' + s.title)
  const missing = expectedHeadings.filter((h) => !plainHeads.includes(h))
  const positions = expectedHeadings.filter((h) => plainHeads.includes(h)).map((h) => plainHeads.indexOf(h))
  const order = positions.every((p, i) => i === 0 || p > positions[i - 1])
  const ownParts = ss.map((s) => content(s.own))
  const hasNA = ownParts.map((parts) => parts.some((p) => NA.test(p.text)))
  // Целиком оформленный отрицательный ответ («новых взаимодействий нет») тоже законен.
  // Предметную применимость проверяет независимая приёмка; обязательные живые секции — ниже.
  const allNA = ownParts.map((parts, i) => parts.length > 0 &&
    ((hasNA[i] && parts.every((p) => NA.test(p.text) || wholeStrike(p.text))) ||
      parts.every((p) => wholeStrike(p.text) && !OPEN.test(p.text))))
  // Родительские номера учитываем даже у §4.3.1: в исходном шаблоне это тоже ###.
  const childrenOf = (s, i) => ss.map((child, j) => ({ child, j })).filter(({ child, j }) => j > i &&
    ((s.id && child.id?.startsWith(s.id + '.')) ||
      (child.level > s.level && j < (ss.findIndex((h, k) => k > i && h.level <= s.level) < 0 ? ss.length : ss.findIndex((h, k) => k > i && h.level <= s.level)))))
  const fullNA = ss.map((s, i) => {
    const children = childrenOf(s, i)
    const relevant = [i, ...children.map(({ j }) => j)].filter((j) => ownParts[j].length)
    return relevant.length > 0 && relevant.every((j) => allNA[j])
  })
  for (let i = 0; i < ss.length; i++) {
    const s = ss[i]
    if (fullNA[i] && !s.struck) defects.push({ type: 'heading', line: s.line, title: s.title })
    if (s.struck && !fullNA[i]) defects.push({ type: 'applied-heading-struck', line: s.line, title: s.title })
    for (const { text: part, reasoned } of ownParts[i]) {
      if (NA.test(part)) {
        if (!wholeStrike(part)) defects.push({ type: 'body', line: s.line, text: part })
        if (!reasoned && !/не\s*применимо\s*[:,—-]\s*\S/i.test(part.replace(/~~/g, ''))) defects.push({ type: 'reason', line: s.line, text: part })
      }
      if ([...part.matchAll(/~~(.*?)~~/g)].some((m) => OPEN.test(m[1]))) defects.push({ type: 'open-struck', line: s.line, text: part })
    }
  }
  const protectedIds = ['1.1', '6.2', '7', ...(scenario === 'bug' ? ['3.2'] : []), ...(scenario === 'refine' ? ['6.3'] : []), ...(scenario === 'feature' ? ['4.1', '4.3'] : [])]
  for (const id of protectedIds) {
    const i = ss.findIndex((s) => s.id === id)
    if (i >= 0 && (ss[i].struck || allNA[i])) defects.push({ type: 'required-content-hidden', section: id })
  }
  const trace = ss.find((s) => s.id === '7')?.own.join('\n') ?? ''
  const fr = /FR-1/.test(trace) && (scenario !== 'feature' || /FR-2/.test(trace))
  const restoredFlag = scenario !== 'refine' || ss.some((s) => s.id === '6.3' && !s.struck && /approvalButtonLabel/.test(s.own.join('\n')))
  return { structure: missing.length === 0 && order, missing, order, naSections: fullNA.filter(Boolean).length,
    format: defects.length === 0 && fullNA.some(Boolean), defects, fr, restoredFlag,
    pass: missing.length === 0 && order && defects.length === 0 && fullNA.some(Boolean) && fr && restoredFlag }
}

export function selftest () {
  const good = `## 1. Обзор
### 1.1. Что делаем
Переименовать кнопку.
## ~~3. Backend~~
### ~~3.1. По сервисам~~
~~Не применимо: бэкенд прежний.~~
### ~~3.3. Доступ~~
- ~~Не применимо: роли прежние.~~
## 4. Frontend
### 4.3. Состояния
| Имя | Условие | Вид |
|---|---|---|
| value | значение | текст |
| ~~empty~~ | ~~Не применимо: ответ не пустеет~~ | ~~пустого вида нет~~ |
### ~~4.3.1. Loading~~
~~Не применимо: вызовов нет.~~
## 6. Релиз
### 6.2. Совместимость
Отправка остаётся прежней.
## 7. Трассировка
| FR-1 | ~~Не применимо: контракт прежний~~ | Нажать кнопку — отправлено |
`
  assert.equal(gradeText(good).pass, true)
  assert.equal(gradeText(good.replace('## ~~3. Backend~~', '## 3. Backend')).format, false)
  assert.equal(gradeText(good.replace('~~Не применимо: роли прежние.~~', '~~Не применимо~~: роли прежние.')).format, false)
  assert.equal(gradeText(good.replace('### 4.3. Состояния', '### ~~4.3. Состояния~~')).format, false)
  assert.equal(gradeText(good.replace('~~Не применимо: роли прежние.~~', '~~Не применимо: TBD роль~~')).format, false)
  assert.equal(gradeText(good.replace('### 6.2. Совместимость', '### ~~6.2. Совместимость~~')).format, false)
  assert.equal(gradeText(good, { expectedHeadings: ['### 3.2. Данные'] }).structure, false)
  assert.equal(gradeText(good, { expectedHeadings: ['## 7. Трассировка', '## 1. Обзор'] }).structure, false)
  const raw = '### ~~3.2. Данные~~\n~~TBD~~\n```markdown\n### ~~4. UI~~\n```'
  assert.equal(normalizeSpecHeadings(raw), '### 3.2. Данные\n~~TBD~~\n```markdown\n### ~~4. UI~~\n```')
  assert.equal(normalizeSpecHeadings('### ~~3.2. Данные'), '### ~~3.2. Данные')
  assert.equal(sections(raw).length, 1)
  assert.equal(gradeText(good.replace('~~Не применимо: роли прежние.~~', '~~Не применимо~~')).format, false)
  assert.equal(gradeText(good.replace('~~пустого вида нет~~', '~~Не применимо~~')).format, true)
  assert.equal(gradeText(good.replace('Отправка остаётся прежней.', 'Права: ~~❓ TBD~~.')).format, false)
  assert.equal(gradeText(good.replace('~~Не применимо: бэкенд прежний.~~', '~~Бэкенд не меняется.~~')).format, true)
  assert.equal(gradeText(good.replace('Отправка остаётся прежней.', '~~Отправка остаётся прежней.~~')).format, false)
  assert.equal(gradeText(good.replace('~~Не применимо: роли прежние.~~', '~~Роли: не применимо, доступ прежний.~~')).format, true)
  assert.equal(gradeText(good.replace('- ~~Не применимо: роли прежние.~~', '- [ ] ~~Не применимо: роли прежние.~~')).format, true)
  assert.equal(gradeText(good.replace('- ~~Не применимо: роли прежние.~~', '- ~~[ ] Не применимо: роли прежние.~~')).format, false)
  assert.equal(gradeText(good.replace('- ~~Не применимо: роли прежние.~~', '- ~~[x] Не применимо: роли прежние.~~')).format, false)
  assert.equal(gradeText(good.replace('- ~~Не применимо: роли прежние.~~', '~~- [ ] Не применимо: роли прежние.~~')).format, false)
  assert.equal(gradeText(good + '\n```markdown\n- ~~[ ] пример~~\n```\n').format, true)
  console.log('grade-na: 22 самотеста пройдены')
}

function report (round) {
  const limitFlag = process.argv.find((arg) => arg.startsWith('--limit='))
  const limit = limitFlag ? Number(limitFlag.split('=')[1]) : Infinity
  if (!(limit > 0)) throw new Error('Предел должен быть положительным')
  const source = readFileSync(join(round, '_src-base/technical-spec-doc/SKILL.md'), 'utf8').replace(/\r\n/g, '\n')
  const template = source.split('````markdown\n')[1].split('\n````')[0]
  const expectedHeadings = template.split('\n').filter((l) => /^#{2,3} \d+\./.test(l))
  const candidate = readFileSync(join(round, '_skills/technical-spec-doc/SKILL.md'), 'utf8').replace(/\r\n/g, '\n')
  const candidateTemplate = candidate.split('````markdown\n')[1].split('\n````')[0]
  const templateUnchanged = template === candidateTemplate
  const reports = []
  for (const arm of ['before', 'after']) {
    const manifestFile = join(round, arm + '-manifest.json')
    if (!existsSync(manifestFile)) continue
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')).slice(0, limit)
    const rows = manifest.map((r) => {
      const initial = join(r.work, 'initial-spec.md')
      const file = process.argv.includes('--initial') && existsSync(initial) ? initial : join(r.work, r.target)
      return { run: r.work.split(/[\\/]/).at(-1), scenario: r.scenario, completed: existsSync(join(r.work, 'answer.md')), wrote: existsSync(file),
        ...(existsSync(file) ? gradeText(readFileSync(file, 'utf8'), { expectedHeadings, scenario: r.scenario }) : { pass: false }) }
    })
    reports.push({ arm, revision: process.argv.includes('--initial') ? 'initial' : 'current', templateUnchanged, total: rows.length, wrote: rows.filter((r) => r.wrote).length,
      structure: rows.filter((r) => r.structure).length, format: rows.filter((r) => r.format).length,
      completed: rows.filter((r) => r.completed).length, pass: rows.filter((r) => r.completed && r.pass).length,
      rows })
  }
  const reviewManifest = join(round, 'review-manifest.json')
  if (existsSync(reviewManifest)) {
    const reviews = JSON.parse(readFileSync(reviewManifest, 'utf8')).map((r) => {
      const file = join(r.work, 'answer.md')
      const answer = existsSync(file) ? readFileSync(file, 'utf8') : ''
      const counts = [...answer.matchAll(/нарушений\s*:\s*\*{0,2}(\d+)/gi)].map((m) => Number(m[1]))
      return { name: r.name, expected: r.expected, completed: !!answer.trim(), reported: counts.at(-1),
        pass: r.expected === 0 ? counts.at(-1) === 0 : counts.at(-1) >= r.expected && /11\.|оформлен|зач[её]рк/i.test(answer) }
    })
    if (process.argv.includes('--write')) writeFileSync(join(round, 'REVIEW-REPORT.json'), JSON.stringify(reviews, null, 2) + '\n')
    console.log(JSON.stringify({ review: reviews }, null, 2))
  }
  if (process.argv.includes('--write')) writeFileSync(join(round, process.argv.includes('--initial') ? 'GRADE-REPORT-initial.json' : 'GRADE-REPORT.json'), JSON.stringify(reports, null, 2) + '\n')
  if (process.argv.includes('--totals')) console.log(JSON.stringify(reports.map(({ rows, ...r }) => ({ ...r,
    scenarios: [...new Set(rows.map((row) => row.scenario))].map((scenario) => {
      const group = rows.filter((row) => row.scenario === scenario)
      return { scenario, total: group.length, completed: group.filter((row) => row.completed).length,
        structure: group.filter((row) => row.completed && row.structure).length,
        format: group.filter((row) => row.completed && row.format).length,
        pass: group.filter((row) => row.completed && row.pass).length }
    }) })), null, 2))
  else console.log(JSON.stringify(reports.map((report) => ({ ...report,
    rows: process.argv.includes('--summary') ? report.rows.map(({ run, scenario, completed, wrote, structure, format, fr, restoredFlag, pass, missing, defects }) => ({ run, scenario, completed, wrote, structure, format, fr, restoredFlag, pass, missing, defects: defects?.reduce((counts, d) => ({ ...counts, [d.type]: (counts[d.type] ?? 0) + 1 }), {}) })) : report.rows })), null, 2))
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2] === '--selftest') selftest()
  else if (process.argv[2]) report(resolve(process.argv[2]))
  else throw new Error('usage: node grade-na.mjs --selftest|<round>')
}
