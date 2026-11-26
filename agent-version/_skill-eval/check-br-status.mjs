#!/usr/bin/env node
// check-br-status.mjs — сторож статуса БТ (PLAN-BR-COMB §1): шапка сходится с телом.
//
//   node check-br-status.mjs <каталог>     ← обходит все run-*/coddoc/*/business_requirements.md
//   node check-br-status.mjs --selftest
//
// Правило скилла (Step 4, правка 3.2): блок «Открытые вопросы» собирается из `TBD` и `⚠️` тела,
// статус — «Готово к оценке» при пустом блоке и «Требуются уточнения (N)», где N = числу пунктов
// блока. Сторож проверяет ровно это и ничего больше: единицу счёта (пункт на вхождение или на гейт)
// он не судит — раунд её не меняет (D10 снят).
//
// Модуль: `checkStatus(text)` импортируют `grade-br-var.mjs` и `grade-br-half.mjs`.

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

export function checkStatus (raw) {
  const t = raw.replace(/\r\n/g, '\n')
  const lines = t.split('\n')
  const m = t.match(/\*\*Статус готовности:\*\*\s*([^\n]*)/)
  const status = m ? m[1].trim() : null
  const r = { status, n: null, items: 0, tbd: 0, warn: 0, ok: false, why: '' }
  if (!status) { r.why = 'нет строки статуса'; return r }
  if (/ПРОСТАВЛЯЕТСЯ/.test(status)) { r.why = 'заглушка статуса'; return r }
  const nm = status.match(/Требуются уточнения\s*\((\d+)\)/)
  r.n = nm ? Number(nm[1]) : null
  const ready = /^Готово к оценке/.test(status)
  // Пункты блока — нумерованные строки цитаты между заголовком блока и первым `## `.
  const from = lines.findIndex((l) => /Открытые вопросы/.test(l))
  if (from >= 0) {
    for (let j = from + 1; j < lines.length; j++) {
      if (/^##\s/.test(lines[j])) break
      if (/^>\s*\d+\.\s/.test(lines[j])) r.items++
    }
  }
  const bodyFrom = lines.findIndex((l) => /^##\s+1\./.test(l))
  const body = (bodyFrom >= 0 ? lines.slice(bodyFrom) : lines).join('\n')
  r.tbd = (body.match(/TBD/g) || []).length
  r.warn = (body.match(/⚠/g) || []).length
  const open = r.tbd + r.warn
  if (open > 0) {
    if (r.n === null) r.why = `в теле TBD/⚠️ ${open}, а статус «${status}»`
    else if (r.items === 0) r.why = 'статус «Требуются уточнения», а блок пуст'
    else if (r.n !== r.items) r.why = `N=${r.n}, а пунктов в блоке ${r.items}`
    else r.ok = true
  } else {
    if (ready && r.items === 0) r.ok = true
    else if (r.items > 0) r.why = `в теле TBD/⚠️ нет, а в блоке пунктов ${r.items}`
    else r.why = `в теле TBD/⚠️ нет, а статус «${status}»`
  }
  return r
}

function findDocs (dir) {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === '_skills') continue
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...findDocs(p))
    else if (e.name === 'business_requirements.md' && /[\\/]coddoc[\\/]/.test(p)) out.push(p)
  }
  return out
}

function selftest () {
  let bad = 0
  const ck = (n, got, want) => { const ok = got === want; if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${n}: ${got} (ожидалось ${want})`) }
  const head = (s, q) => `# БТ\n\n> **Статус готовности:** ${s}\n\n> **Открытые вопросы (требуют уточнения перед оценкой):**\n${q}\n\n## 1. Введение\n`
  ck('чисто и «Готово»', checkStatus(head('Готово к оценке', '> *(Все ключевые данные подтверждены.)*') + 'текст').ok, true)
  ck('TBD при «Готово» — красный', checkStatus(head('Готово к оценке', '') + '§5.2 TBD').ok, false)
  ck('TBD, (1), один пункт', checkStatus(head('Требуются уточнения (1)', '> 1. §2.3 — риски') + '| TBD | TBD |').ok, true)
  ck('N не равно пунктам — красный', checkStatus(head('Требуются уточнения (2)', '> 1. §2.3 — риски') + 'TBD').ok, false)
  ck('заглушка — красный', checkStatus(head('<ПРОСТАВЛЯЕТСЯ ПОСЛЕ ЗАПИСИ>', '') + 'x').ok, false)
  ck('CRLF не мешает', checkStatus(head('Требуются уточнения (1)', '> 1. §5.2 — срок').replace(/\n/g, '\r\n') + '⚠️ размыто').ok, true)
  console.log(bad === 0 ? '\nсамопроверка: ok' : `\nсамопроверка: ПРОВАЛОВ ${bad}`)
  process.exit(bad === 0 ? 0 : 1)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = process.argv[2]
  if (arg === '--selftest') selftest()
  if (!arg || !existsSync(arg) || !statSync(arg).isDirectory()) { console.error('usage: node check-br-status.mjs <каталог> | --selftest'); process.exit(1) }
  const docs = findDocs(arg).sort()
  let good = 0
  for (const p of docs) {
    const r = checkStatus(readFileSync(p, 'utf8'))
    if (r.ok) good++
    console.log(`  ${r.ok ? 'ok      ' : 'РАСХОЖДЕНИЕ'}  ${relative(arg, p)}  · «${r.status}» · пунктов ${r.items} · TBD ${r.tbd} · ⚠️ ${r.warn}${r.why ? ' · ' + r.why : ''}`)
  }
  console.log(`\n  ${good}/${docs.length}\tфайлов: статус сходится с телом  ← СТОРОЖ\n`)
}
