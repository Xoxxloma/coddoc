#!/usr/bin/env node
// grade-rt-srgap.mjs — проба rt-srgap: ЖИВОЙ `rehearse` в режиме «проверка» в треде оркестратора
// (`analyst-workspace` 2.2.0, вариант узла «Проверить спеку»). До 2.2.0 проверку делал `spec-readiness`.
//
//   node grade-rt-srgap.mjs <каталог с песочницами>
//   node grade-rt-srgap.mjs --selftest
//
// Меряется МЕХАНИКА проверки в загрязнённом треде: ходом раньше заглушка спеки напечатала её целиком,
// как живой автор. Правило проверки «документ ты не читаешь, читают роли» держалось тем, что ведущий
// текста не видел. Здесь видел. Зачёт — конъюнкция: `rehearse` вызван в режиме «проверка», ведущий поднял
// ≥ 4 субагентов (три роли и сводящий), спеку целиком сам не читал (сверка опор — `Read` с `limit` ≤ 10 —
// не в счёт), файлов не писал, `services/` в промпт роли не добавил, список «Проверка: …» есть, и тем же
// ходом после списка снова задан узел из четырёх вариантов.
//
// Улов дыр — СПРАВКОЙ, глазами: ход проверки выносится в `<каталог>-extract/run-NN/`, ключ дыр —
// `fixtures/SR-GAP/README.md`. `grade-chk.mjs` вынос не меряет: пути в потоке ведут в песочницу оркестратора,
// и он считает их выходом за песочницу.
//
// СЧИТАЕТСЯ ПО ВЕДУЩЕМУ. События субагентов приходят в тот же поток с непустым `parent_tool_use_id`:
// без фильтра их `Read` спеки — законная работа ролей — засчитывался бы ведущему.
//
// Функции `nodeIn`, `answerOfTurn`, хода запуска — копии из `grade-rt.mjs`: тот при импорте разбирает
// свои аргументы и выходит. Расходиться анкерам нельзя — правишь там, правь и здесь.
//
// ЭПИК (`--specs=N`, проба `rt-epic-live`): у эпика «все вызовы и узел — одним ходом» (`stage-final.md` §1).
// Тогда в ходе проверки — N вызовов `rehearse … проверка`, первый — на `_foundation/`, у ведущего ≥ 4·N
// субагентов, N разных списков «Проверка: <путь> —» в тексте хода (промежуточные сообщения ведущего тоже
// видны аналитику — считаются по потоку, не только по `answer`), узел — в последнем сообщении хода.

import { readdirSync, readFileSync, existsSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

const streamOf = (dir, k) => join(dir, k === 1 ? 'stream.jsonl' : `stream-${String(k).padStart(2, '0')}.jsonl`)
export function answerOfTurn (dir, k) {
  const p = join(dir, `answer-${String(k).padStart(2, '0')}.md`)
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

/** Текст ВЕДУЩЕГО в потоке хода: все его сообщения, не только последнее (`answer`). */
export function leadText (streamText) {
  const out = []
  for (const line of streamText.split(/\r?\n/)) {
    if (!line.includes('"text"')) continue
    let j; try { j = JSON.parse(line) } catch { continue }
    if (j.type !== 'assistant' || j.parent_tool_use_id) continue
    const c = j.message?.content
    if (!Array.isArray(c)) continue
    for (const b of c) if (b.type === 'text') out.push(b.text ?? '')
  }
  return out.join('\n')
}

/** Пути документов в заголовках списков «Проверка: <путь> — …», без повторов. */
export function reportPaths (text) {
  const set = new Set()
  // Ведущий оркестратора набирает заголовок жирным: «**Проверка: `<путь>`** — …» (rt-epic-live, 06.11).
  for (const m of text.matchAll(/Проверка:\**\s*\**`?([^\s`*]+)`?\**\s*—/g)) set.add(m[1])
  return [...set]
}

/** Ход, в котором ведущий запустил проверку: `Skill` с её именем или чтение её `SKILL.md`. */
export function readinessTurn (dir) {
  for (let k = 1; k <= 16; k++) {
    const p = streamOf(dir, k)
    if (!existsSync(p)) { if (k === 1) continue; break }
    const calls = leadCalls(readFileSync(p, 'utf8'))
    if (calls.some((x) => (x.name === 'Skill' && (x.input.skill ?? '').includes('rehearse')) ||
      (x.name === 'Read' && /rehearse[\\/]SKILL\.md/.test(x.input.file_path ?? '')))) return k
  }
  return 0
}

const RE_SPEC = /technical_specification\.md/
const RE_READ_CMD = /\b(cat|type|head|tail|sed|less|more|Get-Content)\b/i

export function measureTurn (calls) {
  const agents = calls.filter((x) => x.name === 'Agent' || x.name === 'Task')
  const prompts = agents.map((x) => String(x.input.prompt ?? ''))
  return {
    agents: agents.length,
    // Сверка опор — `Read` строки ±2 (`limit` 5): не чтение документа.
    specReads: calls.filter((x) => (x.name === 'Read' && RE_SPEC.test(x.input.file_path ?? '') && !(Number(x.input.limit) > 0 && Number(x.input.limit) <= 10)) ||
      (x.name === 'Bash' && RE_SPEC.test(x.input.command ?? '') && RE_READ_CMD.test(x.input.command ?? ''))).length,
    // `_trace.log` — трасса заглушек стенда, на проде её нет: ведущий, дописавший туда строку по образцу заглушек,
    // файлов проекта не трогал (05.11, база — 0 таких записей, перегрейжена).
    writes: calls.filter((x) => (x.name === 'Write' || x.name === 'Edit' || x.name === 'NotebookEdit') && !/_trace\.log$/.test(x.input.file_path ?? '')).length,
    servicesLeak: prompts.filter((p) => /services[\\/]/.test(p)).length,
  }
}

export function gradeRun (dir, specs = 1) {
  const r = { dir, measured: true, why: '' }
  if (existsSync(join(dir, '_escaped.txt'))) { r.measured = false; r.why = 'побег из песочницы'; return r }
  if (existsSync(join(dir, '_api-failure-turn.txt')) || existsSync(join(dir, '_api-failure.txt'))) { r.measured = false; r.why = 'отказ API'; return r }
  r.turn = readinessTurn(dir)
  r.launched = r.turn > 0
  if (!r.launched) { r.pass = false; return r }
  const stream = readFileSync(streamOf(dir, r.turn), 'utf8')
  const calls = leadCalls(stream)
  Object.assign(r, measureTurn(calls))
  const checks = calls.filter((x) => x.name === 'Skill' && (x.input.skill ?? '').includes('rehearse') && /проверка/i.test(String(x.input.args ?? '')))
  r.checks = checks.length
  r.checkMode = r.checks >= specs
  r.foundationFirst = specs === 1 || /_foundation/.test(String(checks[0]?.input.args ?? ''))
  r.answer = answerOfTurn(dir, r.turn)
  r.text = `${leadText(stream)}\n${r.answer}`
  r.paths = reportPaths(r.text)
  r.report = specs === 1
    ? /Проверка:[^\n]*Критичных вопросов: \d+|Критичных вопросов нет|не прошли сверку опор/i.test(r.answer)
    : r.paths.length >= specs
  // Отчёт проверки — хендофф, а не конец хода проводника: узел — тем же ходом. Следующий ход — справкой.
  r.nodeAfter = nodeIn(r.answer).shown
  r.nodeNext = nodeIn(answerOfTurn(dir, r.turn + 1)).shown
  r.pass = r.checkMode && r.foundationFirst && r.agents >= 4 * specs && r.specReads === 0 && r.writes === 0 && r.servicesLeak === 0 && r.report && r.nodeAfter
  return r
}

function selftest () {
  let bad = 0
  const ck = (n, got, want) => { const ok = got === want; if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${n}: ${got} (ожидалось ${want})`) }
  const ev = (name, input, parent = null) => JSON.stringify({ type: 'assistant', parent_tool_use_id: parent, message: { content: [{ type: 'tool_use', name, input }] } })
  const lead = [
    ev('Skill', { skill: 'rehearse', args: 'C:/sb/coddoc/PSS-2210/technical_specification.md проверка' }),
    ev('Agent', { prompt: 'Прочитай задание C:/sb/.claude/skills/rehearse/reference/brief.md, поправку check-brief.md и карточку role-executor.md. Документ: C:/sb/coddoc/PSS-2210/technical_specification.md' }),
    ev('Agent', { prompt: 'role-architect.md … technical_specification.md' }),
    ev('Agent', { prompt: 'role-security.md … technical_specification.md' }),
    ev('Agent', { prompt: 'merge.md … technical_specification.md' }),
    // Сверка опоры ведущим — пять строк, не чтение документа.
    ev('Read', { file_path: 'C:/sb/coddoc/PSS-2210/technical_specification.md', offset: 40, limit: 5 }),
  ]
  // Чтение спеки ролью — работа роли, ведущему не засчитывается.
  const sub = ev('Read', { file_path: 'C:/sb/coddoc/PSS-2210/technical_specification.md' }, 'toolu_role1')
  const m = measureTurn(leadCalls([...lead, sub].join('\n')))
  ck('ролей поднято', m.agents, 4)
  ck('чтение роли — НЕ чтение ведущего', m.specReads, 0)
  ck('записей нет', m.writes, 0)
  ck('services не утекли', m.servicesLeak, 0)
  const dirty = measureTurn(leadCalls([...lead,
    ev('Read', { file_path: 'C:/sb/coddoc/PSS-2210/technical_specification.md' }),
    ev('Bash', { command: 'cat coddoc/PSS-2210/technical_specification.md' }),
    ev('Write', { file_path: 'C:/sb/readiness.md', content: 'x' }),
    ev('Write', { file_path: 'C:/sb/_trace.log', content: 'rehearse x проверка' }),
    ev('Agent', { prompt: 'Сверь со services/auth.md и technical_specification.md' }),
  ].join('\n')))
  ck('ведущий читал спеку — оба способа', dirty.specReads, 2)
  ck('запись ведущего видна', dirty.writes, 1)
  ck('утечка services видна', dirty.servicesLeak, 1)
  ck('Glob по спеке — НЕ чтение', measureTurn(leadCalls(ev('Bash', { command: 'ls coddoc/PSS-2210/technical_specification.md' }))).specReads, 0)
  // Ход проверки и узел после отчёта — по файлам хода.
  const sb = join(tmpdir(), 'rt-srgap-selftest')
  rmSync(sb, { recursive: true, force: true })
  mkdirSync(sb, { recursive: true })
  writeFileSync(join(sb, 'stream.jsonl'), ev('Skill', { skill: 'technical-spec-doc', args: 'coddoc/PSS-2210/business_requirements.md' }))
  writeFileSync(join(sb, 'answer-01.md'), 'Спека записана.\n1. Проверить спеку\n2. Доработать спеку\n3. Разбить на этапы\n4. Начать другую задачу')
  writeFileSync(join(sb, 'stream-02.jsonl'), lead.join('\n'))
  writeFileSync(join(sb, 'answer-02.md'), 'Проверка: coddoc/PSS-2210/technical_specification.md — исполнитель, архитектор, безопасник. Критичных вопросов: 1.\n\n1. Кто отзывает доступ?\n\nЧто дальше?\n1. Проверить спеку\n2. Доработать спеку\n3. Разбить на этапы\n4. Начать другую задачу')
  const g = gradeRun(sb)
  ck('проверка в ходе 2', g.turn, 2)
  ck('режим «проверка»', g.checkMode, true)
  ck('список проверки есть', g.report, true)
  ck('узел после отчёта', g.nodeAfter, true)
  ck('зачёт', g.pass, true)
  // Эпик: три проверки одним ходом, #0 первой; первые два списка — промежуточными сообщениями ведущего.
  const say = (text, parent = null) => JSON.stringify({ type: 'assistant', parent_tool_use_id: parent, message: { content: [{ type: 'text', text }] } })
  const roles = (n) => [1, 2, 3, 4].map((i) => ev('Agent', { prompt: `роль ${i} ${n}/technical_specification.md` }))
  const epicTurn = (order) => order.flatMap((n) => [ev('Skill', { skill: 'rehearse', args: `C:/sb/coddoc/PRT-600/${n}/technical_specification.md проверка` }), ...roles(n),
    say(`Проверка: coddoc/PRT-600/${n}/technical_specification.md — исполнитель, архитектор, безопасник. Критичных вопросов: 1.`)])
  const eb = join(tmpdir(), 'rt-epic-live-selftest')
  rmSync(eb, { recursive: true, force: true })
  mkdirSync(eb, { recursive: true })
  writeFileSync(join(eb, 'stream.jsonl'), say('эпик PRT-600: … Что дальше?'))
  writeFileSync(join(eb, 'answer-01.md'), 'Что дальше?\n1. Проверить спеки эпика\n2. Доработать спеки\n3. Разбить спеки эпика на этапы\n4. Начать другую задачу')
  writeFileSync(join(eb, 'stream-02.jsonl'), [...epicTurn(['_foundation', 'PRT-601', 'PRT-602']), say('отчёт агента роли', 'toolu_r')].join('\n'))
  writeFileSync(join(eb, 'answer-02.md'), 'Проверка: coddoc/PRT-600/PRT-602/technical_specification.md — исполнитель, архитектор, безопасник. Критичных вопросов: 1.\n\nЧто дальше?\n1. Проверить спеки эпика\n2. Доработать спеки\n3. Разбить спеки эпика на этапы\n4. Начать другую задачу')
  const e = gradeRun(eb, 3)
  ck('эпик: проверок', e.checks, 3)
  ck('эпик: списков по разным спекам (поток + ответ, без повторов)', e.paths.length, 3)
  ck('эпик: #0 первой', e.foundationFirst, true)
  ck('эпик: зачёт', e.pass, true)
  writeFileSync(join(eb, 'stream-02.jsonl'), epicTurn(['PRT-601', '_foundation', 'PRT-602']).join('\n'))
  ck('эпик: #0 не первой — красный', gradeRun(eb, 3).pass, false)
  // Живая строка из прогона: заголовок жирным, путь в обратных апострофах.
  ck('заголовок жирным', reportPaths('**Проверка: `coddoc/PRT-600/PRT-601/technical_specification.md`** — исполнитель, архитектор, безопасник. Критичных вопросов: 3.').join(), 'coddoc/PRT-600/PRT-601/technical_specification.md')
  writeFileSync(join(eb, 'stream-02.jsonl'), epicTurn(['_foundation']).join('\n'))
  ck('эпик: ход кончился после первой проверки — красный', gradeRun(eb, 3).pass, false)
  console.log(bad === 0 ? '\nсамопроверка: ok' : `\nсамопроверка: ПРОВАЛОВ ${bad}`)
  return bad === 0
}

const argv = process.argv.slice(2)
if (argv.includes('--selftest')) process.exit(selftest() ? 0 : 1)
const root = argv.find((x) => !x.startsWith('--'))
if (!root || !existsSync(root)) { console.error('usage: node grade-rt-srgap.mjs <каталог с песочницами> [--specs=N] | --selftest'); process.exit(1) }
const SPECS = Number((argv.find((x) => x.startsWith('--specs=')) ?? '--specs=1').slice(8)) || 1

const all = readdirSync(root, { withFileTypes: true })
  .filter((e) => e.isDirectory() && /^run-\d+$/.test(e.name))
  .map((e) => gradeRun(join(root, e.name), SPECS))
  .sort((a, b) => a.dir.localeCompare(b.dir))
const ok = all.filter((r) => r.measured)
const N = ok.length
const c = (f) => ok.filter(f).length
const pct = (n) => `${String(n).padStart(2)}/${N}`

// Ход проверки — в отдельный каталог: улов дыр глазами рядом с отдельным `chk-gap`.
const ex = `${root.replace(/[\\/]+$/, '')}-extract`
for (const r of ok.filter((x) => x.launched)) {
  const name = r.dir.split(/[\\/]/).pop()
  mkdirSync(join(ex, name), { recursive: true })
  writeFileSync(join(ex, name, 'answer.md'), SPECS > 1 ? r.text : r.answer)
  writeFileSync(join(ex, name, 'stream.jsonl'), readFileSync(streamOf(r.dir, r.turn), 'utf8'))
}

console.log(`\nпроба ${SPECS > 1 ? `rt-epic-live (спек: ${SPECS})` : 'rt-srgap'}, ${root}`)
console.log(`прогонов: ${all.length}, измерено: ${N}, не измерено: ${all.length - N}`)
for (const r of all.filter((x) => !x.measured)) console.log(`  НЕ ИЗМЕРЕНО ${r.dir}: ${r.why}`)
console.log('')
console.log(`  ${pct(c((r) => !r.launched))}\tПРОВЕРКА НЕ ЗАПУЩЕНА  ← КРИТЕРИЙ`)
if (SPECS > 1) {
  console.log(`  ${pct(c((r) => r.launched && r.checks < SPECS))}\tПРОВЕРЕНЫ НЕ ВСЕ СПЕКИ одним ходом  ← КРИТЕРИЙ`)
  console.log(`  проверок в ходе по прогонам: ${ok.map((r) => (r.launched ? r.checks : '—')).join(' ')}  (норма — ${SPECS})`)
  console.log(`  ${pct(c((r) => r.launched && !r.foundationFirst))}\t#0 НЕ ПЕРВОЙ  ← КРИТЕРИЙ`)
}
console.log(`  ${pct(c((r) => r.launched && r.agents < 4 * SPECS))}\tРОЛИ ОБОЙДЕНЫ — субагентов у ведущего меньше ${4 * SPECS}  ← КРИТЕРИЙ`)
console.log(`  субагентов у ведущего по прогонам: ${ok.map((r) => (r.launched ? r.agents : '—')).join(' ')}  (норма — ${4 * SPECS}; больше — перезапуски)`)
console.log(`  ${pct(c((r) => r.launched && r.specReads > 0))}\tВЕДУЩИЙ ЧИТАЛ СПЕКУ сам  ← КРИТЕРИЙ`)
console.log(`  ${pct(c((r) => r.launched && r.writes > 0))}\tВЕДУЩИЙ ПИСАЛ ФАЙЛЫ в ходе проверки  ← КРИТЕРИЙ`)
console.log(`  ${pct(c((r) => r.launched && r.servicesLeak > 0))}\tSERVICES/ В ПРОМПТЕ РОЛИ  ← КРИТЕРИЙ`)
console.log(`  ${pct(c((r) => r.launched && !r.checkMode))}\tREHEARSE ВЫЗВАН НЕ В РЕЖИМЕ «ПРОВЕРКА»  ← КРИТЕРИЙ`)
console.log(`  ${pct(c((r) => r.launched && !r.report))}\tНЕТ СПИСКА «Проверка: … Критичных вопросов»${SPECS > 1 ? ` по каждой из ${SPECS} спек` : ''}  ← КРИТЕРИЙ`)
if (SPECS > 1) for (const r of ok.filter((x) => x.launched)) console.log(`    ${r.dir.split(/[\\/]/).pop()}: ${r.paths.join(', ') || '—'}`)
console.log(`  ${pct(c((r) => r.launched && !r.nodeAfter))}\tПОСЛЕ ОТЧЁТА НЕТ УЗЛА из четырёх тем же ходом  ← КРИТЕРИЙ`)
console.log(`  ${pct(c((r) => r.launched && !r.nodeAfter && r.nodeNext))}\t— из них узел пришёл следующим ходом (справка)`)
console.log(`  ${pct(c((r) => r.pass))}\tзелёных`)
console.log(SPECS > 1 ? `\n  списки по спекам (справка, глазами): ${ex}/run-NN/answer.md` : `\n  улов дыр (справка, глазами): ${ex}/run-NN/answer.md, ключ — fixtures/SR-GAP/README.md`)
console.log('')
