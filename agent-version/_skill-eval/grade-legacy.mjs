#!/usr/bin/env node
// grade-legacy.mjs — пробы CD-LEGACY: рядом с `coddoc/` лежит старая `docs/` с чужими задачами (fixtures/CD-LEGACY).
//
//   node grade-legacy.mjs <каталог проб> --probe ni|br
//   node grade-legacy.mjs --selftest
//
// Грейдится диск песочницы и поток инструментов. Красный: в `docs/` что-то создано или изменено; результат не там
// (ni — `coddoc/CBK-208/notebook-2026-10-14-(bt|spec).md`, br — `coddoc/LIB-208/business_requirements.md`); лишние
// файлы; папка `docs`/`coddoc` в другом регистре; у ni цель, при которой БТ задачи не найдены («новый БТ», «правка
// работающего»), или `> Документ:` не на БТ в `coddoc/`. Предупреждение: чтение файлов `docs/` (Read) и поиск по ней
// (Grep, Glob, Bash). «НЕ ИЗМЕРЕНО» — только отказ API.

import { resolve as pathResolve, join, relative, dirname } from 'node:path'
import { readdirSync, readFileSync, existsSync, statSync, mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const HERE = dirname(fileURLToPath(import.meta.url))
const SEED = join(HERE, 'fixtures', 'CD-LEGACY', 'seed')
const PROBES = {
  ni: { want: /^coddoc\/CBK-208\/notebook-2026-10-14-(bt|spec)\.md$/, result: /(^|\/)notebook-2026-10-14[^/]*-(bt|spec)\.md$/ },
  br: { want: /^coddoc\/LIB-208\/business_requirements\.md$/, result: /(^|\/)business_requirements\.md$/ },
}
const GOAL_FOUND = /^(правки БТ|новая спека)$/
const DOC_REL = 'coddoc/CBK-208/business_requirements.md'
const RE_API_FAILURE = /API Error|Request not allowed|Please run \/login|Credit balance|rate limit|session limit|usage limit/i
const RE_DOCS = /(?<![A-Za-z0-9_-])docs(?![A-Za-z0-9_-])/

const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '')
const lf = (s) => s.replace(/\r\n/g, '\n')
const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')

function listFiles (dir, base = dir) {
  const out = []
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...listFiles(p, base))
    else out.push(relative(base, p).split('\\').join('/'))
  }
  return out
}

const isStand = (f) => (!f.includes('/') && /^(answer(-\d+)?\.md|stream(-\d+)?\.jsonl|_[^/]*)$/.test(f)) || f.startsWith('_twin/')

// Хеши засева `_seeded.sha256` (обе формы sha256sum); нет — LF-текст файла против LF-текста фикстуры.
function seededHashes (dir) {
  const p = join(dir, '_seeded.sha256')
  if (!existsSync(p)) return null
  const out = new Map()
  for (const l of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\\?([0-9a-f]{64}) [ *](.+)$/)
    if (m) out.set(m[2].replace(/^\.\//, ''), m[1])
  }
  return out
}

function seedTouched (dir) {
  const hashes = seededHashes(dir)
  if (hashes) return [...hashes].filter(([rel, h]) => !existsSync(join(dir, rel)) || sha256(join(dir, rel)) !== h).map(([rel]) => rel)
  return listFiles(SEED).filter((rel) => !existsSync(join(dir, rel)) || lf(read(join(dir, rel))) !== lf(read(join(SEED, rel))))
}

function toolUses (dir) {
  const out = []
  if (!existsSync(dir)) return out
  for (const f of readdirSync(dir).filter((n) => /^stream(-\d+)?\.jsonl$/.test(n)).sort()) {
    for (const line of read(join(dir, f)).split('\n')) {
      let e; try { e = JSON.parse(line) } catch { continue }
      const content = e && e.message && Array.isArray(e.message.content) ? e.message.content : []
      // События субагентов идут в потоке ведущего с `parent_tool_use_id`.
      for (const c of content) if (c && c.type === 'tool_use') out.push({ name: c.name, input: c.input || {}, sub: !!e.parent_tool_use_id })
    }
  }
  return out
}

export function measured (dir) {
  const ans = read(join(dir, 'answer.md'))
  return !(existsSync(join(dir, '_api-failure.txt')) || existsSync(join(dir, '_api-failure-turn.txt')) || RE_API_FAILURE.test(ans.slice(0, 300)))
}

// Первый сегмент пути — `docs` или `coddoc` в другом регистре (на регистрозависимой ФС это вторая папка).
export const caseVariant = (rel) => { const s = rel.split('/')[0]; return /^(docs|coddoc)$/i.test(s) && !/^(docs|coddoc)$/.test(s) }

export function gradeRun (dir, probe) {
  const P = PROBES[probe]
  const red = []
  const warn = []
  const seeded = new Set(listFiles(SEED))
  for (const rel of (seededHashes(dir) || new Map()).keys()) seeded.add(rel)
  const files = listFiles(dir)
  const created = files.filter((f) => !seeded.has(f) && !isStand(f))
  const touched = seedTouched(dir)
  const inDocs = created.filter((f) => f.startsWith('docs/'))
  if (inDocs.length) red.push('записал в docs/: ' + inDocs.join(', '))
  const docsTouched = touched.filter((f) => f.startsWith('docs/'))
  if (docsTouched.length) red.push('тронул docs/: ' + docsTouched.join(', '))
  const otherTouched = touched.filter((f) => !f.startsWith('docs/'))
  if (otherTouched.length) red.push('засев тронут: ' + otherTouched.join(', '))
  const variants = created.filter(caseVariant)
  if (variants.length) red.push('папка в другом регистре: ' + variants.join(', '))
  const results = created.filter((f) => P.result.test(f))
  const pick = results.find((f) => P.want.test(f))
  if (!results.length) red.push('файл не записан')
  else if (!pick) red.push('не там: ' + results.join(', '))
  const extra = created.filter((f) => !results.includes(f) && !inDocs.includes(f) && !variants.includes(f))
  if (extra.length) red.push('лишние файлы: ' + extra.join(', '))
  if (pick && probe === 'ni') {
    const head = lf(read(join(dir, pick))).split('\n').slice(0, 8).join('\n')
    const goal = (head.match(/^> Задача:[^\n]*·\s*цель:\s*([^\n]+?)\s*$/m) || [])[1] || ''
    const doc = ((head.match(/^> Документ:\s*([^\n]+?)\s*$/m) || [])[1] || '').replace(/[`*]/g, '').replace(/^\.\//, '')
    if (!GOAL_FOUND.test(goal)) red.push(`цель «${goal || '—'}» — БТ задачи не найдены`)
    if (doc !== DOC_REL) red.push(`> Документ: «${doc || '—'}», а не ${DOC_REL}`)
  }
  const uses = toolUses(dir)
  const str = (u) => Object.values(u.input).filter((v) => typeof v === 'string').join(' ')
  const reads = uses.filter((u) => u.name === 'Read' && RE_DOCS.test(str(u)))
  if (reads.length) warn.push('читал docs/: ' + reads.map((u) => `${u.sub ? 'субагент' : 'ведущий'} ${str(u).slice(0, 80)}`).join('; '))
  const looks = uses.filter((u) => ['Grep', 'Glob', 'Bash'].includes(u.name) && RE_DOCS.test(str(u)))
  if (looks.length) warn.push('искал в docs/: ' + looks.map((u) => `${u.sub ? 'субагент' : 'ведущий'} ${u.name} ${str(u).slice(0, 80)}`).join('; '))
  return { red, warn, pass: !red.length, result: pick || null }
}

// ---------- самопроверка ----------

function selftest () {
  let fails = 0
  const ck = (name, got, want) => { const ok = got === want; if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` — получено ${got}, ждали ${want}`}`) }
  const ETALON = join(HERE, 'fixtures', 'NI-NB-REPEAT', 'seed', 'coddoc', 'CBK-208', 'notebook-2026-10-14-bt.md')
  const BR = join(SEED, 'coddoc', 'CBK-208', 'business_requirements.md')
  const root = mkdtempSync(join(tmpdir(), 'grade-legacy-'))
  let k = 0
  const sandbox = (put) => {
    const sb = join(root, `sb-${++k}`)
    cpSync(SEED, sb, { recursive: true })
    writeFileSync(join(sb, '_seeded.sha256'), listFiles(SEED).map((rel) => `${sha256(join(SEED, rel))} *${rel}`).join('\n') + '\n')
    writeFileSync(join(sb, 'answer.md'), 'Готово.')
    for (const [rel, text] of Object.entries(put)) { mkdirSync(dirname(join(sb, rel)), { recursive: true }); writeFileSync(join(sb, rel), text) }
    return sb
  }
  const ev = (name, input) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } })
  const good = read(ETALON)
  try {
    let r = gradeRun(sandbox({ 'coddoc/CBK-208/notebook-2026-10-14-bt.md': good }), 'ni')
    ck('ni: эталон входа в coddoc/CBK-208 — зелёный', r.pass, true)
    ck('ni: эталон — без предупреждений', r.warn.length, 0)
    r = gradeRun(sandbox({ 'docs/CBK-208/notebook-2026-10-14-bt.md': good }), 'ni')
    ck('ni: вход в docs/CBK-208 — красный', r.pass, false)
    ck('ni: вход в docs/CBK-208 — «записал в docs/»', r.red.some((s) => s.startsWith('записал в docs/')), true)
    r = gradeRun(sandbox({ 'coddoc/CBK-208/notebook-2026-10-14-bt.md': good.replace('цель: правки БТ', 'цель: новый БТ').replace(/^> Документ:.*$/m, '> Документ: нет') }), 'ni')
    ck('ni: цель «новый БТ», документа нет — красный', r.pass, false)
    r = gradeRun(sandbox({ 'coddoc/CBK-208/notebook-2026-10-14-bt.md': good.replace(/^> Документ:.*$/m, '> Документ: docs/CBK-208/business_requirements.md') }), 'ni')
    ck('ni: > Документ: на docs/ — красный', r.pass, false)
    r = gradeRun(sandbox({ 'coddoc/CBK-208/notebook-2026-10-14-bt.md': good, 'docs/MED-77/business_requirements.md': 'правка' }), 'ni')
    ck('ni: чужая задача в docs/ изменена — красный', r.red.some((s) => s.startsWith('тронул docs/')), true)
    let sb = sandbox({ 'coddoc/CBK-208/notebook-2026-10-14-bt.md': good })
    writeFileSync(join(sb, 'stream.jsonl'), [ev('Glob', { pattern: 'docs/**/CBK-208/*.md' }), ev('Read', { file_path: 'C:\\sb\\docs\\EMP-1207\\business_requirements.md' }), ev('Read', { file_path: 'C:\\sb\\coddoc\\CBK-208\\business_requirements.md' })].join('\n') + '\n')
    r = gradeRun(sb, 'ni')
    ck('ni: читал и искал в docs/ — зелёный', r.pass, true)
    ck('ni: читал и искал в docs/ — два предупреждения', r.warn.length, 2)
    ck('ni: чтение coddoc/ — не предупреждение', r.warn.every((w) => !w.includes('coddoc')), true)
    r = gradeRun(sandbox({}), 'ni')
    ck('ni: файла нет — «файл не записан»', r.red.includes('файл не записан'), true)
    r = gradeRun(sandbox({ 'coddoc/LIB-208/business_requirements.md': read(BR) }), 'br')
    ck('br: БТ в coddoc/LIB-208 — зелёный', r.pass, true)
    r = gradeRun(sandbox({ 'docs/LIB-208/business_requirements.md': read(BR) }), 'br')
    ck('br: БТ в docs/LIB-208 — красный', r.pass, false)
    ck('регистр: CodDoc/ — другая папка', caseVariant('CodDoc/LIB-208/business_requirements.md'), true)
    ck('регистр: coddoc/ — та же', caseVariant('coddoc/LIB-208/business_requirements.md'), false)
    sb = sandbox({})
    writeFileSync(join(sb, 'answer.md'), 'API Error: 529 overloaded')
    ck('отказ API — НЕ ИЗМЕРЕНО', measured(sb), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
  console.log(fails ? `\nСАМОПРОВЕРКА: ${fails} провалов` : '\nСАМОПРОВЕРКА: всё зелёное')
  process.exit(fails ? 1 : 0)
}

const IS_MAIN = !!process.argv[1] && fileURLToPath(import.meta.url) === pathResolve(process.argv[1])
if (IS_MAIN) {
  const arg = process.argv[2]
  if (arg === '--selftest') selftest()
  const probe = process.argv[process.argv.indexOf('--probe') + 1]
  if (!arg || !existsSync(arg) || !PROBES[probe]) { console.error('usage: node grade-legacy.mjs <каталог проб> --probe ni|br  |  --selftest'); process.exit(1) }
  const runs = readdirSync(arg).filter((n) => /^run-\d+$/.test(n) && statSync(join(arg, n)).isDirectory()).sort()
  console.log(`\nпроба cd-legacy-${probe}, ${arg}`)
  let n = 0; let green = 0; let warned = 0
  for (const run of runs) {
    const dir = join(arg, run)
    if (!measured(dir)) { console.log(`  ${run}: НЕ ИЗМЕРЕНО`); continue }
    n++
    const r = gradeRun(dir, probe)
    if (r.pass) green++
    if (r.warn.length) warned++
    console.log(`  ${run}: ${r.pass ? 'ЗЕЛЁНЫЙ' : 'КРАСНЫЙ — ' + r.red.join('; ')}`)
    if (r.warn.length) console.log(`         предупреждения: ${r.warn.join(' · ')}`)
  }
  console.log(`\nИТОГ cd-legacy-${probe}: ${green}/${n}  ← пишет и находит документы в coddoc/, старую docs/ не трогает`)
  console.log(`шёл в docs/ (чтение или поиск): ${warned}/${n}`)
}
