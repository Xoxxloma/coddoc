#!/usr/bin/env node
// grade-rt-e2e.mjs — проба rt-e2e: СКВОЗНОЙ стык «проверка → доработка», оба под-скилла живые
// (`analyst-workspace` 2.0.0, узел «Что дальше?»: «Проверить спеку», затем «Доработать спеку» по пунктам 1–3).
// С 2.2.0 проверку делает `rehearse` в режиме «проверка», до того — `spec-readiness`.
//
//   node grade-rt-e2e.mjs <каталог с песочницами>
//   node grade-rt-e2e.mjs --selftest
//
// Механика — счётчиками, по потоку ведущего и файлам ходов. Содержание — глазами: отчёт живой, пункты 1–3
// от прогона к прогону разные, поэтому грейдер кладёт в `<песочница>/_e2e-review.md` пункты 1–3 из отчёта,
// вопросы доработки, реплики аналитика и дифф спеки против засева. Ключ чтения — `fixtures/RT-E2E/expected.md`.
//
// Функции `nodeIn`, `answerOfTurn`, `leadCalls` — копии из `grade-rt-srgap.mjs` (а те — из `grade-rt.mjs`).
// Расходиться анкерам нельзя — правишь там, правь и здесь.

import { readdirSync, readFileSync, existsSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SEED_SPEC = join(HERE, 'fixtures', 'RT-E2E', 'coddoc', 'PSS-2210', 'technical_specification.md')
const SPEC_REL = join('coddoc', 'PSS-2210', 'technical_specification.md')

const NODE_LABELS = [/Проверить спек/i, /Доработать спек/i, /Разбить (спек[уи] (эпика )?)?на этапы/i, /Начать другую задачу/i]
export function nodeIn (text) {
  const shown = NODE_LABELS.every((re) => re.test(text))
  let pos = 0
  let ordered = shown
  for (const re of NODE_LABELS) {
    if (!ordered) break
    const m = re.exec(text.slice(pos))
    if (!m) ordered = false; else pos += m.index + m[0].length
  }
  return { shown, ordered }
}

const pad = (k) => String(k).padStart(2, '0')
const streamOf = (dir, k) => join(dir, k === 1 ? 'stream.jsonl' : `stream-${pad(k)}.jsonl`)
export function answerOfTurn (dir, k) {
  const p = join(dir, `answer-${pad(k)}.md`)
  if (existsSync(p)) return readFileSync(p, 'utf8')
  if (k === 1 && existsSync(join(dir, 'answer.md'))) return readFileSync(join(dir, 'answer.md'), 'utf8')
  return ''
}

/** Вызовы инструментов ВЕДУЩЕГО в потоке хода: `parent_tool_use_id` пуст. */
export function leadCalls (streamText) {
  const out = []
  for (const line of streamText.split(/\r?\n/)) {
    if (!line.includes('tool_use')) continue
    let j; try { j = JSON.parse(line) } catch { continue }
    if (j.parent_tool_use_id) continue
    const c = j.message?.content
    if (!Array.isArray(c)) continue
    for (const b of c) if (b.type === 'tool_use') out.push({ name: b.name, input: b.input ?? {} })
  }
  return out
}

const callsOf = (dir, k) => (existsSync(streamOf(dir, k)) ? leadCalls(readFileSync(streamOf(dir, k), 'utf8')) : [])
const launches = (calls, skill) => calls.some((x) => (x.name === 'Skill' && (x.input.skill ?? '').includes(skill)) ||
  (x.name === 'Read' && new RegExp(`${skill}[\\\\/]SKILL\\.md`).test(x.input.file_path ?? '')))
const RE_SPEC = /technical_specification\.md/
// Запись в спеку: `Write`/`Edit` по пути спеки или Bash с перенаправлением В спеку. `2>/dev/null` — не запись
// (урок `grade-fix.mjs`): `>` считается, только если не после цифры и не после `&`.
export const writesSpec = (calls) => calls.filter((x) =>
  ((x.name === 'Write' || x.name === 'Edit') && RE_SPEC.test(x.input.file_path ?? '')) ||
  (x.name === 'Bash' && /(?<![0-9&])>{1,2}\s*["']?[^\s"']*technical_specification\.md/.test(x.input.command ?? ''))).length

function turnsOf (dir) {
  let n = 0
  for (let k = 1; k <= 20; k++) if (existsSync(streamOf(dir, k))) n = k
  return n
}

/** Пункты отчёта проверки: нумерованные строки, кроме подписей узла. Первое вхождение номера. */
export function reportItems (text) {
  const items = new Map()
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(\d+)\.\s+(.+)$/.exec(line)
    if (!m) continue
    if (NODE_LABELS.some((re) => re.test(m[2]))) continue
    const n = Number(m[1])
    if (!items.has(n)) items.set(n, m[2].trim())
  }
  return items
}

export function gradeRun (dir) {
  const r = { dir, measured: true, why: '' }
  if (existsSync(join(dir, '_escaped.txt'))) { r.measured = false; r.why = 'побег из песочницы'; return r }
  if (existsSync(join(dir, '_api-failure-turn.txt')) || existsSync(join(dir, '_api-failure.txt'))) { r.measured = false; r.why = 'отказ API'; return r }
  const T = turnsOf(dir)
  r.turns = T
  r.firstNode = nodeIn(answerOfTurn(dir, 1)).shown

  // 1. Проверка.
  r.rTurn = 0
  for (let k = 1; k <= T; k++) if (launches(callsOf(dir, k), 'rehearse')) { r.rTurn = k; break }
  const rAns = r.rTurn ? answerOfTurn(dir, r.rTurn) : ''
  r.report = /Проверка:[^\n]*Критичных вопросов: \d+|Критичных вопросов нет|не прошли сверку опор/i.test(rAns)
  r.nodeAfterReport = r.rTurn > 0 && nodeIn(rAns).shown
  r.items = reportItems(rAns)
  r.rAgents = r.rTurn ? callsOf(dir, r.rTurn).filter((x) => x.name === 'Agent' || x.name === 'Task').length : 0

  // 2. Доработка: первый запуск автора после хода проверки.
  r.fTurn = 0
  for (let k = (r.rTurn || 1) + 1; k <= T; k++) if (launches(callsOf(dir, k), 'technical-spec-doc')) { r.fTurn = k; break }
  r.fixLaunched = r.fTurn > 0
  const fCalls = r.fTurn ? callsOf(dir, r.fTurn) : []
  r.fixArgs = String(fCalls.find((x) => x.name === 'Skill' && (x.input.skill ?? '').includes('technical-spec-doc'))?.input.args ?? '')
  r.askedFirst = r.fixLaunched && writesSpec(fCalls) === 0
  r.qAnswer = r.fTurn ? answerOfTurn(dir, r.fTurn) : ''
  r.nodeOverQuestions = r.askedFirst && nodeIn(r.qAnswer).shown

  // 3. Запись, приёмка, узел.
  r.wTurn = 0
  for (let k = r.fTurn || T + 1; k <= T; k++) if (writesSpec(callsOf(dir, k)) > 0) { r.wTurn = k; break }
  const finalSpec = join(dir, SPEC_REL)
  r.specChanged = existsSync(finalSpec) && existsSync(SEED_SPEC) &&
    readFileSync(finalSpec, 'utf8').replace(/\r\n/g, '\n') !== readFileSync(SEED_SPEC, 'utf8').replace(/\r\n/g, '\n')
  r.reviewTurn = 0
  r.readinessAfterFix = false
  for (let k = r.wTurn || T + 1; k <= T; k++) {
    const c = callsOf(dir, k)
    if (!r.reviewTurn && launches(c, 'spec-review')) r.reviewTurn = k
    if (launches(c, 'rehearse')) r.readinessAfterFix = true
  }
  r.nodeSameTurn = r.reviewTurn > 0 && nodeIn(answerOfTurn(dir, r.reviewTurn)).shown
  r.nodeAfterReview = r.nodeSameTurn || (r.reviewTurn > 0 && nodeIn(answerOfTurn(dir, r.reviewTurn + 1)).shown)
  r.replies = existsSync(join(dir, '_node-replies.txt')) ? readFileSync(join(dir, '_node-replies.txt'), 'utf8').trim() : ''

  r.pass = r.report && r.nodeAfterReport && r.fixLaunched && r.askedFirst && !r.nodeOverQuestions &&
    r.specChanged && r.reviewTurn > 0 && !r.readinessAfterFix && r.nodeAfterReview
  return r
}

function specDiff (dir) {
  try {
    execFileSync('git', ['diff', '--no-index', '--no-color', '-U2', '--', SEED_SPEC, join(dir, SPEC_REL)], { encoding: 'utf8' })
    return '(без изменений)'
  } catch (e) { return String(e.stdout ?? e.message) }
}

function reviewFile (r) {
  const items = [1, 2, 3].map((n) => `${n}. ${r.items.get(n) ?? '— не найден'}`).join('\n')
  const turns = []
  for (let k = r.fTurn || 1; k <= r.turns && r.fTurn; k++) turns.push(`### Ход ${k}\n\n${answerOfTurn(r.dir, k).trim()}\n`)
  return `# ${r.dir.split(/[\\/]/).pop()} — разбор глазами (ключ: fixtures/RT-E2E/expected.md)

Реплики на узел: ${r.replies || '—'}
Ходы: проверка ${r.rTurn || '—'}, доработка ${r.fTurn || '—'}, запись ${r.wTurn || '—'}, приёмка ${r.reviewTurn || '—'}; всего ${r.turns}

## Пункты 1–3 отчёта (всего пунктов: ${r.items.size})

${items}

## Аргумент вызова доработки

${r.fixArgs || '— (без аргумента)'}

## Ходы с доработки

${turns.join('\n') || '—'}

## Дифф спеки против засева

\`\`\`diff
${specDiff(r.dir)}
\`\`\`
`
}

function selftest () {
  let bad = 0
  const ck = (n, got, want) => { const ok = got === want; if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${n}: ${got} (ожидалось ${want})`) }
  const ev = (name, input, parent = null) => JSON.stringify({ type: 'assistant', parent_tool_use_id: parent, message: { content: [{ type: 'tool_use', name, input }] } })
  const node = '\nЧто дальше?\n1. Проверить спеку\n2. Доработать спеку\n3. Разбить на этапы\n4. Начать другую задачу'
  ck('2>/dev/null — не запись', writesSpec(leadCalls(ev('Bash', { command: 'cat coddoc/PSS-2210/technical_specification.md 2>/dev/null' }))), 0)
  ck('> в спеку — запись', writesSpec(leadCalls(ev('Bash', { command: 'echo x > coddoc/PSS-2210/technical_specification.md' }))), 1)
  ck('Edit роли — не запись ведущего', writesSpec(leadCalls(ev('Edit', { file_path: 'C:/sb/coddoc/PSS-2210/technical_specification.md' }, 'toolu_x'))), 0)
  const items = reportItems('вопросов задано: 5\n§2 INT-1\n  1. повторная доставка\n  2. проверки сервера\n3. справочник' + node)
  ck('пункты отчёта без подписей узла', [...items.values()].join('|'), 'повторная доставка|проверки сервера|справочник')

  const sb = join(tmpdir(), 'rt-e2e-selftest')
  rmSync(sb, { recursive: true, force: true })
  mkdirSync(join(sb, 'coddoc', 'PSS-2210'), { recursive: true })
  writeFileSync(join(sb, 'stream.jsonl'), ev('Glob', { pattern: 'coddoc/PSS-2210/*' }))
  writeFileSync(join(sb, 'answer-01.md'), 'Спека PSS-2210 готова.' + node)
  writeFileSync(join(sb, 'stream-02.jsonl'), [ev('Skill', { skill: 'rehearse', args: 'C:/sb/coddoc/PSS-2210/technical_specification.md проверка' }),
    ev('Agent', { prompt: 'role-executor.md' }), ev('Read', { file_path: 'C:/sb/coddoc/PSS-2210/technical_specification.md' }, 'toolu_r')].join('\n'))
  writeFileSync(join(sb, 'answer-02.md'), 'Проверка: coddoc/PSS-2210/technical_specification.md — исполнитель, архитектор, безопасник. Критичных вопросов: 4.\n\n1. повторная доставка\n   Чем грозит: дубль\n2. проверки сервера\n3. справочник\n4. потолок' + node)
  writeFileSync(join(sb, 'stream-03.jsonl'), [ev('Skill', { skill: 'technical-spec-doc', args: 'доработка, пункты 1–3' }), ev('Read', { file_path: 'C:/sb/coddoc/PSS-2210/technical_specification.md' })].join('\n'))
  writeFileSync(join(sb, 'answer-03.md'), 'Гипотезы по пунктам 1–3:\n1. …\n2. …\n3. …\nВерно?')
  writeFileSync(join(sb, 'stream-04.jsonl'), [ev('Edit', { file_path: 'C:/sb/coddoc/PSS-2210/technical_specification.md' }), ev('Skill', { skill: 'spec-review', args: 'coddoc/PSS-2210/technical_specification.md' })].join('\n'))
  writeFileSync(join(sb, 'answer-04.md'), 'артефакт: coddoc/PSS-2210/technical_specification.md\nнарушений: 0' + node)
  writeFileSync(join(sb, SPEC_REL), 'изменено')
  const g = gradeRun(sb)
  ck('ход проверки', g.rTurn, 2)
  ck('узел после отчёта', g.nodeAfterReport, true)
  ck('ход доработки', g.fTurn, 3)
  ck('сначала спросил', g.askedFirst, true)
  ck('узел поверх вопросов', g.nodeOverQuestions, false)
  ck('ход записи', g.wTurn, 4)
  ck('ход приёмки', g.reviewTurn, 4)
  ck('узел тем же ходом', g.nodeSameTurn, true)
  ck('зачёт', g.pass, true)
  writeFileSync(join(sb, 'stream-03.jsonl'), [ev('Skill', { skill: 'technical-spec-doc' }), ev('Write', { file_path: 'C:/sb/coddoc/PSS-2210/technical_specification.md' })].join('\n'))
  writeFileSync(join(sb, 'stream-04.jsonl'), ev('Skill', { skill: 'rehearse', args: 'coddoc/PSS-2210/technical_specification.md проверка' }))
  const b = gradeRun(sb)
  ck('записал сразу — не спросил', b.askedFirst, false)
  ck('проверка вместо приёмки видна', b.readinessAfterFix, true)
  ck('зачёт снят', b.pass, false)
  console.log(bad === 0 ? '\nсамопроверка: ok' : `\nсамопроверка: ПРОВАЛОВ ${bad}`)
  return bad === 0
}

const argv = process.argv.slice(2)
if (argv.includes('--selftest')) process.exit(selftest() ? 0 : 1)
const root = argv.find((x) => !x.startsWith('--'))
if (!root || !existsSync(root)) { console.error('usage: node grade-rt-e2e.mjs <каталог с песочницами> | --selftest'); process.exit(1) }

const all = readdirSync(root, { withFileTypes: true })
  .filter((e) => e.isDirectory() && /^run-\d+$/.test(e.name))
  .map((e) => gradeRun(join(root, e.name)))
  .sort((a, b) => a.dir.localeCompare(b.dir))
const ok = all.filter((r) => r.measured)
for (const r of ok) writeFileSync(join(r.dir, '_e2e-review.md'), reviewFile(r))
const N = ok.length
const c = (f) => ok.filter(f).length
const pct = (n) => `${String(n).padStart(2)}/${N}`

console.log(`\nпроба rt-e2e, ${root}`)
console.log(`прогонов: ${all.length}, измерено: ${N}, не измерено: ${all.length - N}`)
for (const r of all.filter((x) => !x.measured)) console.log(`  НЕ ИЗМЕРЕНО ${r.dir}: ${r.why}`)
console.log('')
console.log(`  ${pct(c((r) => !r.firstNode))}\tузла нет первым ходом (справка)`)
console.log(`  ${pct(c((r) => !r.rTurn))}\tПРОВЕРКА НЕ ЗАПУЩЕНА  ← КРИТЕРИЙ`)
console.log(`  ${pct(c((r) => r.rTurn && !r.report))}\tнет списка «Проверка: … Критичных вопросов»  ← КРИТЕРИЙ`)
console.log(`  ${pct(c((r) => r.rTurn && !r.nodeAfterReport))}\tПОСЛЕ ОТЧЁТА НЕТ УЗЛА тем же ходом  ← КРИТЕРИЙ`)
console.log(`  субагентов у ведущего в ходе проверки: ${ok.map((r) => (r.rTurn ? r.rAgents : '—')).join(' ')}  (норма — 4)`)
console.log(`  ${pct(c((r) => !r.fixLaunched))}\tДОРАБОТКА НЕ ЗАПУЩЕНА  ← КРИТЕРИЙ`)
console.log(`  ${pct(c((r) => r.fixLaunched && !r.askedFirst))}\tЗАПИСАЛ В СПЕКУ, НЕ СПРОСИВ  ← КРИТЕРИЙ`)
console.log(`  ${pct(c((r) => r.nodeOverQuestions))}\tУЗЕЛ ПОВЕРХ ВОПРОСОВ ДОРАБОТКИ  ← КРИТЕРИЙ`)
console.log(`  ${pct(c((r) => r.fixLaunched && !r.specChanged))}\tСПЕКА НЕ ИЗМЕНЕНА к концу  ← КРИТЕРИЙ`)
console.log(`  ${pct(c((r) => r.wTurn && !r.reviewTurn))}\tНЕТ ПРИЁМКИ после записи  ← КРИТЕРИЙ`)
console.log(`  ${pct(c((r) => r.readinessAfterFix))}\tПРОВЕРКА ГОТОВНОСТИ ВМЕСТО/ПОСЛЕ ПРИЁМКИ без выбора  ← КРИТЕРИЙ`)
console.log(`  ${pct(c((r) => r.reviewTurn && !r.nodeAfterReview))}\tНЕТ УЗЛА после приёмки  ← КРИТЕРИЙ`)
console.log(`  ${pct(c((r) => r.reviewTurn && r.nodeAfterReview && !r.nodeSameTurn))}\t— узел пришёл только следующим ходом (справка)`)
console.log(`  ходы (проверка/доработка/запись/приёмка): ${ok.map((r) => `${r.rTurn || '—'}/${r.fTurn || '—'}/${r.wTurn || '—'}/${r.reviewTurn || '—'}`).join('  ')}`)
console.log(`  ${pct(c((r) => r.pass))}\tзелёных по механике`)
console.log(`\n  содержание — глазами: <песочница>/_e2e-review.md (пункты 1–3, вопросы, дифф)`)
console.log('')
