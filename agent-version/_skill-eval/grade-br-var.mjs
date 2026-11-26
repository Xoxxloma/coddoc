#!/usr/bin/env node
// grade-br-var.mjs — проба br-var (скилл: business-requirements-doc), PLAN-BR-COMB §1.
//
//   node grade-br-var.mjs <каталог плеча>
//   node grade-br-var.mjs --selftest
//
// ЧТО МЕРЯЕТСЯ — ПЕРЕ-СТРОГОСТЬ оценки ответа. Ход 1 — бриф с ключом, ход 2 — аналитик отвечает на
// всё, часть коротко: дата без обоснования, ФИО без контакта, «высокий» без обоснования, ценность
// без цифры, «рисков нет», «доступно всем», «новых интеграций нет». Каждый ответ покрывает `Закрыт:`
// своего гейта (§2.4 плана). Верный исход — файл на ходе 2, «Готово к оценке», ни одного TBD/⚠️.
//
// КАК ЧИТАТЬ ЧИСЛА. Прирост к базе на гейтах 8, 14, 7, 4 — заслуга решений человека D2/D3 (на 1.0.3
// переспрос там верен по букве), на гейте 3 — D4 (L837). Условие закрытия D1 оценивается ТОЛЬКО по
// гейтам 6, 12, 13 — их требование не менялось. Отчёт по гейтам — из реестра хода 2 и по секциям файла.

import { readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { checkStatus } from './check-br-status.mjs'
import { read, turn, apiFailed, writesBt, ledger, openSections } from './br-lib.mjs'

const REL = 'coddoc/PASS-417/business_requirements.md'
const D1_GATES = ['6', '12', '13']

export function gradeRun (dir) {
  const t1 = turn(dir, 1); const t2 = turn(dir, 2)
  if (apiFailed(dir, [t1.answer, t2.answer])) return { measured: false }
  const text = read(join(dir, REL))
  const r = { measured: true, exists: text !== null }
  r.wroteT1 = writesBt(t1.stream) > 0
  r.led = ledger(t2.answer)
  if (r.exists) {
    r.st = checkStatus(text)
    r.ready = /^Готово к оценке/.test(r.st.status || '')
    r.open = r.st.tbd + r.st.warn
    r.secs = openSections(text)
  }
  r.pass = r.exists && !r.wroteT1 && r.ready && r.open === 0
  // D1 судится только там, где есть чем: реестр хода 2 или записанный файл. Ни того ни другого
  // (пилот 2026-10-02: карта с «верно?» вместо реестра) — «нет данных», а не красный по D1.
  const secsBad = (r.secs || []).some((s) => ['2.3', '1.2', '3.3'].includes(s))
  r.d1 = !r.led && !r.exists ? null : (!r.led || D1_GATES.every((g) => r.led[g] === 'ok')) && !secsBad
  // Что спрошено на ходе 2 — для чтения глазами: пере-строгость видна по предмету вопроса.
  r.asked = (t2.answer || '').split('\n').filter((l) => /\?/.test(l) && !/[✅⏭❓]/.test(l)).map((l) => l.replace(/[*|#>]/g, '').trim().slice(0, 110))
  return r
}

function selftest () {
  let bad = 0
  const ck = (n, got, want) => { const ok = got === want; if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${n}: ${got} (ожидалось ${want})`) }
  const led = ledger('Реестр гейтов (перед записью):\n0. Ключ — ✅\n6. Риски — ✅\n8. Сроки (31.10; обоснование — TBD) — ✅\n14. Заказчик — ❓\n❓ осталось: 1')
  ck('реестр: гейт 6', led['6'], 'ok')
  ck('реестр: гейт 14', led['14'], 'open')
  ck('реестр: последняя строка «осталось» не гейт', Object.keys(led).length, 4)
  ck('реестр таблицей', ledger('| 3 | Роли | ⏭️ |')['3'], 'skip')
  ck('секции с TBD', openSections('## 1.\n### 1.3. Заказчик\nTBD\n### 5.2. Сроки\n31.10\n').join(','), '1.3')
  console.log(bad === 0 ? '\nсамопроверка: ok' : `\nсамопроверка: ПРОВАЛОВ ${bad}`)
  process.exit(bad === 0 ? 0 : 1)
}

const arg = process.argv[2]
if (arg === '--selftest') selftest()
if (!arg || !existsSync(arg)) { console.error('usage: node grade-br-var.mjs <каталог плеча> | --selftest'); process.exit(1) }
const runs = readdirSync(arg).filter((n) => /^run-\d+$/.test(n) && statSync(join(arg, n)).isDirectory()).sort()
console.log(`\nпроба br-var, ${arg}`)
let measured = 0; let green = 0; let d1 = 0; let d1n = 0
const byGate = {}; const bySec = {}
for (const n of runs) {
  const r = gradeRun(join(arg, n))
  if (!r.measured) { console.log(`  ${n}: НЕ ИЗМЕРЕНО`); continue }
  measured++
  if (r.pass) green++
  if (r.d1 !== null) { d1n++; if (r.d1) d1++ }
  for (const [g, v] of Object.entries(r.led || {})) { byGate[g] ??= {}; byGate[g][v] = (byGate[g][v] || 0) + 1 }
  for (const s of r.secs || []) bySec[s] = (bySec[s] || 0) + 1
  const notes = [
    !r.exists && 'ФАЙЛА НЕТ',
    r.wroteT1 && 'писал на ходе 1',
    r.exists && `«${r.st.status}»`,
    r.exists && r.open && `TBD/⚠️: ${r.open} в §${r.secs.join(', §')}`,
    r.exists && !r.st.ok && `статус: ${r.st.why}`,
    !r.led && 'реестра на ходе 2 нет',
    r.led && 'реестр: ' + Object.entries(r.led).filter(([, v]) => v !== 'ok').map(([g, v]) => `${g}=${v}`).join(' ') || null,
  ].filter(Boolean)
  console.log(`  ${n}: ${r.pass ? 'зелёный' : 'красный'}  · ${notes.join(' · ')}`)
  if (!r.pass) for (const q of r.asked.slice(0, 3)) console.log(`        ? ${q}`)
}
console.log('\n  по гейтам (реестр хода 2):')
for (const g of Object.keys(byGate).sort((a, b) => a - b)) console.log(`    ${g.padStart(2)}: ${Object.entries(byGate[g]).map(([v, c]) => `${v} ${c}`).join(', ')}`)
console.log('  секции с TBD/⚠️ в файле: ' + (Object.entries(bySec).map(([s, c]) => `§${s} ${c}`).join(', ') || 'нет'))
console.log(`\n  ${d1}/${d1n}\tгейты 6, 12, 13 закрыты ✅ и без TBD — условие закрытия D1 (знаменатель — прогоны с реестром хода 2 или файлом)`)
console.log(`  ${green}/${measured}\tзелёных — файл на ходе 2, «Готово к оценке», ни одного TBD/⚠️  ← КРИТЕРИЙ\n`)
