#!/usr/bin/env node
// grade-br-lim.mjs — пробы br-lim-q / br-lim-w (скилл: business-requirements-doc), п.2 PLAN-FROM-POCOCK.
//
//   node grade-br-lim.mjs <каталог плеча> --case=q|w
//
// ЧТО МЕРЯЕТСЯ — пример на границе в критерии с числом (фикстура BR-LIM, задача EXP-310).
//   q: аналитик просит предложить критерии → у каждого из трёх правил с числом (сумма 7 500 ₽, срок до
//      25-го, лимит 3 заявки) гипотеза несёт значение и ближайшее за ним или вопрос «включительно?»;
//      файла нет (гейт 11 ещё открыт).
//   w: гипотезы с границей подтверждены, по сроку уточнение, по лимиту аналитик дал свой критерий без
//      границы → файл этим ходом, «Готово к оценке», без TBD/⚠️; в §4.2 у порога и срока — значения
//      границы, у лимита — критерий аналитика, отвергнутая «четвёртая — отказ» не вписана (Р9: своя
//      формулировка аналитика закрывает гейт без переспроса).

import { readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { checkStatus } from './check-br-status.mjs'
import { read, turn, apiFailed } from './br-lib.mjs'

const REL = 'coddoc/EXP-310/business_requirements.md'
const SP = '[\\s\\u00a0\\u202f]?'
const V_SUM = new RegExp(`7${SP}500`)
const B_SUM = new RegExp(`7${SP}500[,.]0?1|7${SP}501\\b`)
const V_DAY = /(^|[^\d])25(-?(е|го|ое|ого))?([^\d]|$)/
const B_DAY = /(^|[^\d])26(-?(е|го|ое|ого))?([^\d]|$)|23:59|00:00|до\s+конца\s+(дня|суток)/i
const V_CNT = /(^|[^\d(])3\s*(-?(я|ю|ья|ью)\s+)?заяв|тр[её]х\s+заяв|трет[ьеи][а-яё]*|три\s+заявк/i  // «третью — принимается, четвёртую — нет»: слово «заявку» не обязано стоять рядом
const B_CNT = /(^|[^\d(])4\s*(-?(я|ю|ая|ую)\s+)?заяв|четв[её]рт/i
const INCL = /включительн|ровно|строго|не\s+включ|граница|на\s+границе/i

const arg = process.argv[2]
const kase = (process.argv.find((a) => a.startsWith('--case=')) || '').slice(7)
if (!arg || !existsSync(arg) || !['q', 'w'].includes(kase)) { console.error('usage: node grade-br-lim.mjs <каталог плеча> --case=q|w'); process.exit(1) }

/** Правило выполнено, если в одной строке есть значение и ближайшее за ним — как требует правило скилла.
 *  `loose` — засчитать и одно слово «включительно/ровно» без второго значения: так прежний скилл на Sonnet
 *  зеленел без правки (база 2026-10-26), поэтому в критерий не идёт, печатается справкой. Строка: значение и маркер границы (соседние строки не склеиваются: номер пункта «(3)» соседа давал ложное «да»). */
function hit (lines, v, b, loose = false) {
  for (let i = 0; i < lines.length; i++) {
    const w = lines[i]
    if (v.test(w) && (b.test(w) || (loose && INCL.test(w)))) return lines[i].replace(/[*|#>]/g, '').trim().slice(0, 140)
  }
  return null
}

function section42 (text) {
  const from = text.search(/^#{2,4}\s*4\.2\.?/m)
  if (from < 0) return ''
  const rest = text.slice(from)
  const nl = rest.indexOf('\n')
  const next = rest.slice(nl + 1).search(/^#{1,4}\s/m)
  return next < 0 ? rest : rest.slice(0, nl + 1 + next)
}

const runs = readdirSync(arg).filter((n) => /^run-\d+$/.test(n) && statSync(join(arg, n)).isDirectory()).sort()
console.log(`\nпроба br-lim-${kase}, ${arg}`)
let measured = 0; let green = 0
for (const n of runs) {
  const dir = join(arg, n)
  const t1 = turn(dir, 1)
  if (apiFailed(dir, [t1.answer])) { console.log(`  ${n}: НЕ ИЗМЕРЕНО`); continue }
  measured++
  const file = read(join(dir, REL))
  if (kase === 'q') {
    const lines = (t1.answer || '').split('\n')
    const r = [['сумма', hit(lines, V_SUM, B_SUM)], ['срок', hit(lines, V_DAY, B_DAY)], ['количество', hit(lines, V_CNT, B_CNT)]]
    const loose = [hit(lines, V_SUM, B_SUM, true), hit(lines, V_DAY, B_DAY, true), hit(lines, V_CNT, B_CNT, true)].filter(Boolean).length
    const pass = r.every(([, h]) => h) && !file
    if (pass) green++
    console.log(`  ${n}: ${pass ? 'зелёный' : 'красный'}  · ${r.map(([k, h]) => `${k} ${h ? '✅' : '❌'}`).join(' · ')} · файл ${file ? '⚠ записан' : 'нет'} · справка: с одним «включительно» ${loose}/3`)
    for (const [k, h] of r) if (h) console.log(`        ${k}: ${h}`)
  } else {
    if (!file) { console.log(`  ${n}: красный  файла нет — переспросил`); for (const q of (t1.answer || '').split('\n').filter((l) => /\?/.test(l)).slice(0, 3)) console.log(`        ? ${q.replace(/[*|#>]/g, '').trim().slice(0, 120)}`); continue }
    const st = checkStatus(file)
    const ready = /^Готово к оценке/.test(st.status || '')
    const open = st.tbd + st.warn
    const s = section42(file)
    const w1 = V_SUM.test(s) && (B_SUM.test(s) || /ровно\s+7/.test(s))
    const w2 = V_DAY.test(s) && /23:59|(^|[^\d])26([^\d]|$)|00:00/.test(s)
    const w3 = /остал|сколько\s+заяв/i.test(s)
    const w3x = /четв[её]рт|(^|[^\d])4-?(я|ю|ая)\s+заявк/i.test(s)
    const pass = ready && open === 0 && w1 && w2 && w3 && !w3x
    if (pass) green++
    console.log(`  ${n}: ${pass ? 'зелёный' : 'красный'}  · «${st.status}»${open ? ` · TBD/⚠️: ${open}` : ''} · §4.2 порог ${w1 ? '✅' : '❌'} · срок ${w2 ? '✅' : '❌'} · лимит словами аналитика ${w3 ? '✅' : '❌'}${w3x ? ' · ⚠ вписана отвергнутая граница' : ''}${s ? '' : ' · §4.2 не найден'}`)
  }
}
console.log(`\n  ${green}/${measured}\tзелёных  ← КРИТЕРИЙ\n`)
