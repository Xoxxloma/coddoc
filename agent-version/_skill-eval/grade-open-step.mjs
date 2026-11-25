#!/usr/bin/env node
// grade-open-step.mjs — шаг «вопрос по открытым пунктам до статуса» (technical-spec-doc 2.6.0, Step 4 п.3).
//
//   node grade-open-step.mjs <папка-плеча | папка-стадии-цепочки> [--sub=stage-2/run-1]
//
// По ходам, без самоотчёта агента:
// - ход, где спека впервые получила проставленный статус (Edit/Write с «Статус готовности:** Готово|Требуются»);
// - открытые пункты в итоговом файле; вопрос в ответе хода перед статусом.
// КРАСНОЕ: статус проставлен в том же ходу, где спека впервые записана, и блок «Открытые вопросы» не пуст
//   (шаг пропущен); или в итоге осталась заглушка статуса при законченном диалоге.
// Справочно: ход, где задан вопрос; пунктов в итоге; N в статусе = число пунктов.

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RE_STATUS = /Статус готовности:\*\*\s*(Готово|Требуются)/
const RE_STUB = /<ПРОСТАВЛЯЕТСЯ ПОСЛЕ ЗАПИСИ>/

function calls (streamText) {
  const out = []
  for (const line of (streamText || '').split(/\r?\n/)) {
    if (!line.trim()) continue
    let ev
    try { ev = JSON.parse(line) } catch { continue }
    if (ev.type !== 'assistant' || ev.parent_tool_use_id) continue
    for (const c of ev.message?.content || []) if (c.type === 'tool_use') out.push(c)
  }
  return out
}

const specTouch = (c, re) => /technical_specification\.md$/.test(String(c.input?.file_path || '').replace(/\\/g, '/')) &&
  re.test(String(c.input?.content || '') + String(c.input?.new_string || '') + JSON.stringify(c.input?.edits || ''))

export function openItems (spec) {
  const lines = spec.replace(/\r/g, '').split('\n')
  const i = lines.findIndex((l) => /^>\s*\*\*Открытые вопросы/.test(l))
  if (i < 0) return []
  const out = []
  for (let j = i + 1; j < lines.length && /^>/.test(lines[j]); j++) {
    const t = lines[j].replace(/^>\s?/, '').trim()
    if (/^\d+[.)]\s/.test(t)) out.push(t)
  }
  return out
}

function findSpec (dir) {
  const root = join(dir, 'coddoc')
  if (!existsSync(root)) return null
  for (const k of readdirSync(root)) { const p = join(root, k, 'technical_specification.md'); if (existsSync(p)) return p }
  return null
}

export function gradeRun (dir) {
  const r = { run: dir }
  const streams = readdirSync(dir).filter((f) => /^stream(-\d+)?\.jsonl$/.test(f)).sort((a, b) => (a === 'stream.jsonl' ? -1 : b === 'stream.jsonl' ? 1 : a.localeCompare(b)))
  if (!streams.length || readdirSync(dir).some((f) => /^_api-failure/.test(f))) { r.measured = false; return r }
  r.measured = true
  let firstWrite = -1, statusTurn = -1
  streams.forEach((f, t) => {
    for (const c of calls(readFileSync(join(dir, f), 'utf8'))) {
      if (firstWrite < 0 && (c.name === 'Write') && /technical_specification\.md$/.test(String(c.input?.file_path || '').replace(/\\/g, '/'))) firstWrite = t + 1
      if (statusTurn < 0 && ['Write', 'Edit', 'MultiEdit'].includes(c.name) && specTouch(c, RE_STATUS)) statusTurn = t + 1
    }
  })
  r.turns = streams.length; r.firstWrite = firstWrite; r.statusTurn = statusTurn
  const f = findSpec(dir)
  const spec = f ? readFileSync(f, 'utf8') : ''
  r.items = f ? openItems(spec) : []
  r.stub = f ? RE_STUB.test(spec) : false
  const m = spec.match(/Требуются уточнения \((\d+)\)/)
  r.nStatus = m ? +m[1] : (/Готово к разработке/.test(spec) ? 0 : null)
  const ans = (n) => { const p = join(dir, n === 1 ? 'answer-01.md' : `answer-${String(n).padStart(2, '0')}.md`); return existsSync(p) ? readFileSync(p, 'utf8') : (n === 1 && existsSync(join(dir, 'answer.md')) ? readFileSync(join(dir, 'answer.md'), 'utf8') : '') }
  r.askedAt = []
  for (let n = 1; n <= streams.length; n++) if (/\?/.test(ans(n).slice(-800))) r.askedAt.push(n)
  // Пункты, пришедшие из документа сверху, вопроса не требуют: блок только из них — не «непустой».
  r.own = r.items.filter((t) => !/унаследован|из БТ|документ\S* сверху|бизнес-пробел/i.test(t))
  r.skipped = firstWrite > 0 && statusTurn === firstWrite && r.own.length > 0
  r.stubLeft = r.stub && r.askedAt.length === 0
  r.red = r.skipped || r.stubLeft
  return r
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arm = process.argv[2]
  const sub = (process.argv.find((a) => a.startsWith('--sub=')) || '').slice(6)
  if (!arm) { console.error('usage: node grade-open-step.mjs <папка-плеча> [--sub=stage-2/run-1]'); process.exit(1) }
  const runs = readdirSync(arm).filter((d) => /^run-\d+$/.test(d)).sort()
  console.log('прогон | ходов | спека записана в ходе | статус проставлен в ходе | вопрос в ходах | пунктов в итоге | N в статусе | заглушка | итог')
  for (const d of runs) {
    const r = gradeRun(join(arm, d, sub))
    if (!r.measured) { console.log(`${d} | не измерен`); continue }
    console.log([d, r.turns, r.firstWrite, r.statusTurn, r.askedAt.join(',') || '—', r.items.length, r.nStatus ?? '·', r.stub ? 'да' : '—',
      r.red ? (r.skipped ? 'КРАСНЫЙ (шаг пропущен)' : 'КРАСНЫЙ (заглушка без вопроса)') : r.firstWrite < 0 ? 'спеки нет' : 'шаг соблюдён'].join(' | '))
  }
}
