#!/usr/bin/env node
// grade-br-yes.mjs — проба br-yes (скилл: business-requirements-doc), раунд после 1.1.1.
//
//   node grade-br-yes.mjs <каталог плеча>
//
// ЧТО МЕРЯЕТСЯ — закрывает ли «да» на гипотезу гейт. Одноходовая проба в форме «ПРОДОЛЖЕНИЕ»: в
// сообщении пересказан прошлый ход агента — гипотезы по ценности, цели, рискам, потребителям,
// интеграциям — и ответ аналитика «по пунктам 1–5: да, всё так», плюс остальные гейты прямым текстом.
// Верно — файл этим ходом, «Готово к оценке», ни одного TBD/⚠️. Красное — нет файла (переспросил
// подтверждённое) или открытые пункты.

import { readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { checkStatus } from './check-br-status.mjs'
import { read, turn, apiFailed } from './br-lib.mjs'

const REL = 'coddoc/LIB-208/business_requirements.md'
const GATES = [['ценность', /ценност/i], ['цель', /цел[ьи]|user story|я как/i], ['риски', /риск/i], ['потребители', /потребител|кто\s+польз/i], ['интеграции', /интеграц/i]]

const arg = process.argv[2]
if (!arg || !existsSync(arg)) { console.error('usage: node grade-br-yes.mjs <каталог плеча>'); process.exit(1) }
const runs = readdirSync(arg).filter((n) => /^run-\d+$/.test(n) && statSync(join(arg, n)).isDirectory()).sort()
console.log(`\nпроба br-yes, ${arg}`)
let measured = 0; let green = 0; let written = 0
const reasked = {}
for (const n of runs) {
  const dir = join(arg, n)
  const t1 = turn(dir, 1)
  if (apiFailed(dir, [t1.answer])) { console.log(`  ${n}: НЕ ИЗМЕРЕНО`); continue }
  measured++
  const text = read(join(dir, REL))
  const qs = (t1.answer || '').split('\n').filter((l) => /\?/.test(l) && !/[✅⏭❓]/.test(l))
  const re = GATES.filter(([, rx]) => qs.some((q) => rx.test(q))).map(([g]) => g)
  for (const g of re) reasked[g] = (reasked[g] || 0) + 1
  if (!text) {
    console.log(`  ${n}: красный  файла нет${re.length ? ' · переспрошено: ' + re.join(', ') : ''}`)
    for (const q of qs.slice(0, 3)) console.log(`        ? ${q.replace(/[*|#>]/g, '').trim().slice(0, 110)}`)
    continue
  }
  written++
  const st = checkStatus(text)
  const ready = /^Готово к оценке/.test(st.status || '')
  const open = st.tbd + st.warn
  const pass = ready && open === 0
  if (pass) green++
  console.log(`  ${n}: ${pass ? 'зелёный' : 'красный'}  · «${st.status}»${open ? ` · TBD/⚠️: ${open}` : ''}${re.length ? ' · в ответе ещё вопросы про: ' + re.join(', ') : ''}`)
}
console.log(`\n  переспрошено подтверждённое (прогонов): ${Object.entries(reasked).map(([g, c]) => `${g} ${c}`).join(', ') || 'нет'}`)
console.log(`  ${written}/${measured}\tфайл записан этим ходом`)
console.log(`  ${green}/${measured}\tзелёных — файл, «Готово к оценке», без TBD/⚠️  ← КРИТЕРИЙ\n`)
