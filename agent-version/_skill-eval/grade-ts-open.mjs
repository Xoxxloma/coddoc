#!/usr/bin/env node
// grade-ts-open.mjs — проба `ts-open` (fixtures/TS-OPEN): открытые пункты, о которых аналитика не спрашивали; спека 2.5.1.
//
//   node grade-ts-open.mjs <папка-плеча>   # <раунд>/ts-open, внутри run-NN/
//
// В этой пробе аналитик ничего не откладывал, а в БТ пробелов нет: ЛЮБОЙ открытый пункт в записанной спеке —
// пункт без вопроса. Поэтому красное: спека записана и (статус «Требуются уточнения» | пункты в «Открытых вопросах» |
// ⚠️/TBD про нагрузку где угодно в файле) | заглушка статуса осталась.
// Зелёное: спеки нет, и в ответе есть вопрос про схему событий (абзац с «?»/«верно»/«подтвердите» и словом схемы);
// или спека без единого открытого пункта (тогда — ручная проверка, не выдумана ли схема под 🟢/🔵).
// Жёлтое: спеки нет, но вопрос не про схему.
// Справочно: реестр напечатан; строка «Открытым в файл уйдёт»; флаг «ручная проверка» — INT с ТрансЛинк/Kafka под 🟢/🔵К.

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RE_LOAD = /нагрузк/i
const RE_SCHEMA_WORD = /топик|тем[аеуы] Kafka|пол[яеь]|схем|формат|структур|контракт|ключ|сообщени/i
const RE_ASK = /\?|верно|подтверд|поправ|не знаю|к валидации/i

export function assistantText (streamText) {
  let out = ''
  for (const line of (streamText || '').split(/\r?\n/)) {
    if (!line.trim()) continue
    let ev
    try { ev = JSON.parse(line) } catch { continue }
    if (ev.type !== 'assistant' || ev.parent_tool_use_id) continue
    for (const c of ev.message?.content || []) if (c.type === 'text') out += c.text + '\n'
  }
  return out
}

function findSpec (dir) {
  const root = join(dir, 'coddoc')
  if (!existsSync(root)) return null
  for (const k of readdirSync(root)) {
    const p = join(root, k, 'technical_specification.md')
    if (existsSync(p)) return p
  }
  return null
}

// Пункты блока «Открытые вопросы» шапки: все непустые строки цитаты после заголовка блока до конца цитаты.
export function openBlock (spec) {
  const lines = spec.replace(/\r/g, '').split('\n')
  const i = lines.findIndex((l) => /^>\s*\*\*Открытые вопросы/.test(l))
  if (i < 0) return []
  const out = []
  for (let j = i + 1; j < lines.length && /^>/.test(lines[j]); j++) {
    const t = lines[j].replace(/^>\s?/, '').trim()
    if (t && !/^\*?\(?Все ключевые|^нет\.?$|^—$/i.test(t)) out.push(t)
  }
  return out
}

export function gradeRun (dir) {
  const r = { run: dir.split(/[\\/]/).pop() }
  const sp = join(dir, 'stream.jsonl')
  if (!existsSync(sp) || readdirSync(dir).some((f) => /^_api-failure/.test(f))) { r.measured = false; r.why = 'нет потока или отказ API'; return r }
  r.measured = true
  const answer = existsSync(join(dir, 'answer.md')) ? readFileSync(join(dir, 'answer.md'), 'utf8') : ''
  const said = assistantText(readFileSync(sp, 'utf8')) + '\n' + answer
  r.ledger = /Реестр тех-гейтов/.test(said)
  r.openLine = /Открытым в файл уйдёт/.test(said)
  const f = findSpec(dir)
  r.file = !!f
  const paras = answer.split(/\n\s*\n/)
  r.askedSchema = !r.file && paras.some((p) => RE_ASK.test(p) && RE_SCHEMA_WORD.test(p) && /ТрансЛинк|Kafka|событ/i.test(p))
  r.asked = !r.file && /\?/.test(answer)
  if (r.file) {
    const spec = readFileSync(f, 'utf8')
    const items = openBlock(spec)
    r.openN = items.length
    r.needsMore = /Статус готовности:\*\*\s*Требуются уточнения/.test(spec)
    r.loadOpen = spec.split('\n').some((l) => RE_LOAD.test(l) && /⚠️|TBD|🟡|❓/.test(l))
    r.stub = /<ПРОСТАВЛЯЕТСЯ ПОСЛЕ ЗАПИСИ>/.test(spec)
    r.manual = /ТрансЛинк|Kafka/.test(spec) && /###\s*INT-\d+[^\n]*(🟢|🔵К)/.test(spec) &&
      spec.split(/###\s*INT-/).some((c) => /ТрансЛинк|Kafka/.test(c) && /^\d+[^\n]*(🟢|🔵К)/.test(c))
  }
  r.notAskedPrinted = /не спрошен/.test(said)
  // 2.6.0: спека записана со статусом-заглушкой, и ход кончился вопросом по открытым пунктам — шаг Step 4 п.3 соблюдён.
  r.stepAsked = !!(r.file && r.stub && /\?/.test(answer.slice(-800)))
  r.red = !r.stepAsked && !!(r.file && (r.needsMore || r.openN > 0 || r.loadOpen || r.stub || r.notAskedPrinted))
  r.green = (!r.file && r.askedSchema) || r.stepAsked || (r.file && !r.red)
  r.otherQuestion = !r.file && !r.askedSchema && r.asked
  if (r.otherQuestion) r.questionText = answer.split('\n').filter((l) => /\?/.test(l)).slice(0, 3).join(' / ').slice(0, 300)
  return r
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arm = process.argv[2]
  if (!arm) { console.error('usage: node grade-ts-open.mjs <раунд>/ts-open'); process.exit(1) }
  const runs = readdirSync(arm).filter((d) => /^run-\d+$/.test(d)).sort()
  const yn = (b) => (b === undefined ? '·' : b ? 'да' : '—')
  console.log('прогон | реестр | строка «Открытым» | спека | вопрос про схему | открытых в шапке | статус «уточнения» | ⚠️ нагрузка | ручная проверка | итог')
  let g = 0, red = 0, m = 0
  for (const d of runs) {
    const r = gradeRun(join(arm, d))
    if (!r.measured) { console.log(`${r.run} | не измерен: ${r.why}`); continue }
    m++; if (r.green) g++; if (r.red) red++
    console.log([r.run, yn(r.ledger), yn(r.openLine), yn(r.file), yn(r.askedSchema), r.file ? r.openN : '·', yn(r.needsMore), yn(r.loadOpen), yn(r.manual),
      r.green ? 'зелёный' : r.red ? 'КРАСНЫЙ' : r.otherQuestion ? 'справочно: вопрос о другом' : 'жёлтый'].join(' | '))
    if (r.otherQuestion) console.log(`   вопрос: ${r.questionText}`)
    if (r.file && r.notAskedPrinted) console.log('   «не спрошен» напечатан, а файл записан')
  }
  console.log(`итого: зелёных ${g}/${m}, красных ${red}/${m}`)
}
