#!/usr/bin/env node
// grade-ts-lim.mjs — проба ts-vac-lim (скилл: technical-spec-doc), п.2 PLAN-FROM-POCOCK, шаг 3.
//
//   node grade-ts-lim.mjs <каталог плеча>
//
// ЧТО МЕРЯЕТСЯ — переносит ли тест-кейс §7 значения границы из критерия БТ (фикстура TS-VAC-LIM: у FR-10
// отпуск с 14 августа; 13-го отмена проходит, 14-го — нет). Зелёное — строки §7 с FR-10 несут обе даты.

import { readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { read, turn, apiFailed } from './br-lib.mjs'

const REL = 'coddoc/EMP-1207/technical_specification.md'
const D13 = /(^|[^\d])13([^\d]|$)[^\n]{0,12}(август|\.0?8)|13\.0?8/i
const D14 = /(^|[^\d])14([^\d]|$)[^\n]{0,12}(август|\.0?8)|14\.0?8/i

function section7 (text) {
  const from = text.search(/^#{2,3}\s*~*7\.\s/m)
  if (from < 0) return ''
  const rest = text.slice(from)
  const nl = rest.indexOf('\n')
  const next = rest.slice(nl + 1).search(/^#{1,2}\s/m)
  return next < 0 ? rest : rest.slice(0, nl + 1 + next)
}

const arg = process.argv[2]
if (!arg || !existsSync(arg)) { console.error('usage: node grade-ts-lim.mjs <каталог плеча>'); process.exit(1) }
const runs = readdirSync(arg).filter((n) => /^run-\d+$/.test(n) && statSync(join(arg, n)).isDirectory()).sort()
console.log(`\nпроба ts-vac-lim, ${arg}`)
let measured = 0; let green = 0
for (const n of runs) {
  const dir = join(arg, n)
  const t1 = turn(dir, 1)
  if (apiFailed(dir, [t1.answer])) { console.log(`  ${n}: НЕ ИЗМЕРЕНО`); continue }
  measured++
  const spec = read(join(dir, REL))
  if (!spec) { console.log(`  ${n}: красный  спеки нет`); continue }
  const s7 = section7(spec)
  const rows = s7.split('\n').filter((l) => /FR-10/.test(l)).join('\n')
  const a = D13.test(rows); const b = D14.test(rows)
  const pass = a && b
  if (pass) green++
  console.log(`  ${n}: ${pass ? 'зелёный' : 'красный'}  · §7 ${s7 ? 'найден' : 'НЕ НАЙДЕН'} · FR-10: 13 августа ${a ? '✅' : '❌'} · 14 августа ${b ? '✅' : '❌'}`)
  for (const l of rows.split('\n').filter(Boolean).slice(0, 3)) console.log(`        ${l.replace(/[*|#>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)}`)
}
console.log(`\n  ${green}/${measured}\tзелёных  ← КРИТЕРИЙ\n`)
