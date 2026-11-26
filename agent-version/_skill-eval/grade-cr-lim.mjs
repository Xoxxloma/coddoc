#!/usr/bin/env node
// grade-cr-lim.mjs — пробы cr-lim-q / cr-lim-w (скилл: change-request-doc), п.2 PLAN-FROM-POCOCK.
//
//   node grade-cr-lim.mjs <каталог плеча> --case=q|w
//
// ЧТО МЕРЯЕТСЯ — пример на границе у «как должно стать» с числом (фикстура CR-SMALL, ARS-326: лимит
// фотографий паспорта 10 → 25).
//   q: голое описание → в ответе гипотеза с границей (25 и 26-я, или «25 включительно?»); файла нет.
//   w: гипотеза с границей подтверждена → файл; строки `FR-*` несут 25 и 26.

import { readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { read, turn, apiFailed } from './br-lib.mjs'

const REL = 'coddoc/ARS-326/change_request.md'
const V = /(^|[^\d])25(-?(я|ю|ая|ую|й|ой))?([^\d]|$)/
// Строго: ближайшее значение за границей (26), как требует правило. Одно «включительно» — справка: на BR-LIM
// прежний скилл на Sonnet зеленел с ним без правки (2026-10-26).
const B = /(^|[^\d])26(-?(я|ю|ая|ую|й|ой))?([^\d]|$)/
const LOOSE = /включительн|ровно\s+25/i

const arg = process.argv[2]
const kase = (process.argv.find((a) => a.startsWith('--case=')) || '').slice(7)
if (!arg || !existsSync(arg) || !['q', 'w'].includes(kase)) { console.error('usage: node grade-cr-lim.mjs <каталог плеча> --case=q|w'); process.exit(1) }

const runs = readdirSync(arg).filter((n) => /^run-\d+$/.test(n) && statSync(join(arg, n)).isDirectory()).sort()
console.log(`\nпроба cr-lim-${kase}, ${arg}`)
let measured = 0; let green = 0
for (const n of runs) {
  const dir = join(arg, n)
  const t1 = turn(dir, 1)
  if (apiFailed(dir, [t1.answer])) { console.log(`  ${n}: НЕ ИЗМЕРЕНО`); continue }
  measured++
  const file = read(join(dir, REL))
  if (kase === 'q') {
    const line = (t1.answer || '').split('\n').find((l) => V.test(l) && B.test(l))
    const verdict = /правк/i.test(t1.answer || '')
    const loose = (t1.answer || '').split('\n').some((l) => V.test(l) && LOOSE.test(l))
    const pass = !!line && !file
    if (pass) green++
    console.log(`  ${n}: ${pass ? 'зелёный' : 'красный'}  · граница ${line ? '✅' : '❌'} · файл ${file ? '⚠ записан' : 'нет'} · слово «правка» ${verdict ? 'есть' : 'нет'} · справка: «включительно» ${loose ? 'есть' : 'нет'}`)
    if (line) console.log(`        ${line.replace(/[*|#>]/g, '').trim().slice(0, 140)}`)
  } else {
    if (!file) { console.log(`  ${n}: красный  файла нет`); for (const q of (t1.answer || '').split('\n').filter((l) => /\?/.test(l)).slice(0, 3)) console.log(`        ? ${q.replace(/[*|#>]/g, '').trim().slice(0, 120)}`); continue }
    const fr = file.split('\n').filter((l) => /FR-\d/.test(l)).join('\n')
    const pass = V.test(fr) && /(^|[^\d])26([^\d]|$)|26-?(я|ю|ая|ую|й)/.test(fr)
    if (pass) green++
    console.log(`  ${n}: ${pass ? 'зелёный' : 'красный'}  · FR-строки: 25 ${V.test(fr) ? '✅' : '❌'} · 26 ${/26/.test(fr) ? '✅' : '❌'}`)
    if (!pass) for (const l of fr.split('\n').slice(0, 3)) console.log(`        ${l.replace(/[*|#>]/g, '').trim().slice(0, 140)}`)
  }
}
console.log(`\n  ${green}/${measured}\tзелёных  ← КРИТЕРИЙ\n`)
