#!/usr/bin/env node
// grade-rt-oq.mjs — пробы `rt-oq*` (fixtures/RT-OPENQ, RT-OPENQ0): вопрос ведущего по открытым пунктам записанной спеки
// до приёмки (analyst-workspace 2.3.0).
//
//   node grade-rt-oq.mjs <папка-плеча> --mode=q|val|one|empty
//
// По вызовам ведущего (без parent_tool_use_id) и ответам ходов. Заглушка спеки работает в треде ведущего и копирует
// файл командой cp, поэтому Edit/Write в спеку — это ведущий.
// q     (1 ход): спека записана → вопрос с пунктами дословно, приёмка в этом ходе НЕ запущена.
// val   (2 хода): ход 1 как q; ход 2 «всё к валидации» → приёмка, повторного вызова спеки нет.
// one   (2 хода): ход 1 как q; ход 2 закрыл таймаут → спека проходом доработки, в аргументах «10 секунд», затем приёмка,
//       вопрос по пунктам не повторён.
// empty (1 ход): блок пуст → вопроса по пунктам нет, приёмка запущена.

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ITEMS = [
  ['Способ авторизации портала в системе учёта расходов бухгалтерии'],
  ['спроектирован 5 секунд, с владельцем сервиса не согласован', 'фото остаётся в черновике заявки'],
  ['кончилась квота на объём фото'],
]
const norm = (s) => s.replace(/[*_`>]/g, '').replace(/\s+/g, ' ').toLowerCase().replace(/ё/g, 'е')
const ITEMS_N = ITEMS.map((parts) => parts.map(norm))
const RE_ASK = /что можете закрыть|к валидации|валидац/i
const stubCopy = (c, dir) => {
  // Заглушка копирует r1/r2 сама; Write ровно этим содержимым — её работа, а не правка ведущего.
  const src = ['spec-r1.md', 'spec-r2.md'].map((f) => join(dir, '.claude', 'skills', 'technical-spec-doc', f)).filter(existsSync)
  const body = String(c.input.content || '').replace(/\r/g, '').trim()
  return c.name === 'Write' && src.some((p) => readFileSync(p, 'utf8').replace(/\r/g, '').trim() === body)
}

function turnCalls (file) {
  const out = []
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue
    let ev
    try { ev = JSON.parse(line) } catch { continue }
    if (ev.type !== 'assistant' || ev.parent_tool_use_id) continue
    for (const c of ev.message?.content || []) if (c.type === 'tool_use') out.push({ name: c.name, input: c.input || {} })
  }
  return out
}

const isSkill = (c, s) => c.name === 'Skill' && c.input.skill === s
const writesSpec = (c) => ['Edit', 'Write', 'MultiEdit'].includes(c.name) && /technical_specification\.md$/.test(String(c.input.file_path || '').replace(/\\/g, '/'))

export function gradeRun (dir, mode) {
  const r = { run: dir.split(/[\\/]/).pop() }
  if (!existsSync(join(dir, 'stream.jsonl')) || readdirSync(dir).some((f) => /^_api-failure/.test(f))) { r.measured = false; return r }
  r.measured = true
  const t1 = turnCalls(join(dir, 'stream.jsonl'))
  const t2 = existsSync(join(dir, 'stream-02.jsonl')) ? turnCalls(join(dir, 'stream-02.jsonl')) : null
  if (['val', 'one', 'tick'].includes(mode) && !t2) { r.measured = false; return r }
  const a1 = norm(existsSync(join(dir, 'answer-01.md')) ? readFileSync(join(dir, 'answer-01.md'), 'utf8') : readFileSync(join(dir, 'answer.md'), 'utf8'))
  const a2 = existsSync(join(dir, 'answer-02.md')) ? norm(readFileSync(join(dir, 'answer-02.md'), 'utf8')) : ''
  const spec1 = t1.findIndex((c) => isSkill(c, 'technical-spec-doc'))
  r.specCalled = spec1 >= 0
  r.reviewT1 = t1.some((c, i) => i > spec1 && spec1 >= 0 && isSkill(c, 'spec-review'))
  r.itemsVerbatim = ITEMS_N.filter((parts) => parts.every((p) => a1.includes(p))).length
  // Вопрос по пунктам — не любой «?»: заглушка сама печатает блок дословно, нужен вопрос «что закрыть / к валидации».
  r.asked = RE_ASK.test(a1) && (a1.includes('?') || /жду|ответьте|выберите|можно закрыть/i.test(a1))
  r.leadEdit = [...t1, ...(t2 || [])].some((c) => writesSpec(c) && !stubCopy(c, dir))
  if (mode === 'val') {
    r.reviewT2 = !!t2 && t2.some((c) => isSkill(c, 'spec-review'))
    r.specT2 = !!t2 && t2.some((c) => isSkill(c, 'technical-spec-doc'))
  }
  if (mode === 'one') {
    const s2 = t2 ? t2.findIndex((c) => isSkill(c, 'technical-spec-doc')) : -1
    r.specT2 = s2 >= 0
    r.answerPassed = s2 >= 0 && /10 секунд/.test(String(t2[s2].input.args || ''))
    r.reviewAfter = s2 >= 0 && t2.some((c, i) => i > s2 && isSkill(c, 'spec-review'))
    r.reAsked = /что можете закрыть/i.test(a2)
  }
  if (mode === 'tick') {
    const s2 = t2 ? t2.findIndex((c) => isSkill(c, 'technical-spec-doc')) : -1
    r.specT2 = s2 >= 0
    r.answerPassed = s2 >= 0 && /таймаут/i.test(String(t2[s2].input.args || ''))
    r.reviewAfter = s2 >= 0 && t2.some((c, i) => i > s2 && isSkill(c, 'spec-review'))
    r.leadAskedT2 = s2 < 0 && a2.slice(-600).includes('?')
  }
  // Справка для отчёта: строки вопроса с пунктами (подпись/пояснение в прозе — как есть), длинный пункт целиком.
  const raw1 = existsSync(join(dir, 'answer-01.md')) ? readFileSync(join(dir, 'answer-01.md'), 'utf8') : readFileSync(join(dir, 'answer.md'), 'utf8')
  r.optionLines = raw1.split(String.fromCharCode(10)).filter((l) => /^\s*(\d+[.)]|[-*]|\[)/.test(l) && /(авторизац|таймаут|квот|валидац)/i.test(l)).map((l) => l.trim().slice(0, 90))
  r.longVerbatim = ITEMS_N[1].every((p) => a1.includes(p))
  if (mode === 'empty') {
    r.red = !r.specCalled || r.asked || !r.reviewT1 || r.leadEdit
  } else {
    const base = !r.specCalled || !r.asked || r.reviewT1 || r.itemsVerbatim < ITEMS.length || r.leadEdit
    if (mode === 'q') r.red = base
    if (mode === 'val') r.red = base || !r.reviewT2 || r.specT2
    if (mode === 'one') r.red = base || !r.specT2 || !r.answerPassed || !r.reviewAfter || r.reAsked
    if (mode === 'tick') r.red = base || !r.specT2 || !r.answerPassed || r.leadAskedT2
  }
  return r
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arm = process.argv[2]
  const mode = (process.argv.find((a) => a.startsWith('--mode=')) || '--mode=q').slice(7)
  if (!arm) { console.error('usage: node grade-rt-oq.mjs <папка-плеча> --mode=q|val|one|tick|empty'); process.exit(1) }
  const yn = (b) => (b === undefined ? '·' : b ? 'да' : '—')
  console.log(`режим ${mode}`)
  console.log('прогон | спека вызвана | вопрос | пунктов дословно (из 3) | приёмка в ходе 1 | ведущий правил спеку | ход 2: приёмка | ход 2: спека | слова в вызове | приёмка после | повтор вопроса | итог')
  for (const d of readdirSync(arm).filter((x) => /^run-\d+$/.test(x)).sort()) {
    const r = gradeRun(join(arm, d), mode)
    if (!r.measured) { console.log(`${d} | не измерен`); continue }
    console.log([d, yn(r.specCalled), yn(r.asked), r.itemsVerbatim, yn(r.reviewT1), yn(r.leadEdit), yn(r.reviewT2), yn(r.specT2), yn(r.answerPassed), yn(r.reviewAfter), yn(r.reAsked),
      r.red ? 'КРАСНЫЙ' : 'зелёный'].join(' | '))
    console.log(`   длинный пункт дословно: ${r.longVerbatim ? 'да' : 'нет'}; строк-вариантов с пунктами: ${r.optionLines.length}`)
    for (const l of r.optionLines) console.log(`     · ${l}`)
  }
}
