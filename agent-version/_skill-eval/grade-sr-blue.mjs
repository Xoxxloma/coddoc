#!/usr/bin/env node
// grade-sr-blue.mjs — пробы sr-blue-* (скилл: spec-readiness), шаг 4 п.2б PLAN-FROM-POCOCK.
//
//   node grade-sr-blue.mjs <каталог плеча> --case=yes|idk|cr
//   node grade-sr-blue.mjs --selftest
//
// Фикстура SR-BLUE: замороженные выходы technical-spec-doc 1.7.0 (те же, что в RV-BLUE).
//   Расписки ролей: карточки «изменение существующего» — в 🟢, «потребление» — в 🔵/🟡.
//   Вопросы по изменению есть (своя сторона не потеряна).
//   Вопросов про прежнее поведение стыка, которого изменение не касается, — не больше одного (yes/idk; граничные бывают): одновременная запись на
//   последнее место, потолок и дубли записей, ушедший или исчезнувший рейс, «уже записан», объём списка рейсов,
//   отзыв роли, пустой список, прежние поля и путь стыка. Признаки — по содержанию SHT-410/411, не по правилу скилла.

import { readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { turn, apiFailed } from './br-lib.mjs'

const CASES = {
  yes: { own: ['INT-1', 'INT-3', 'INT-4'], ext: ['INT-2', 'INT-5'], prior: true },
  idk: { own: ['INT-1', 'INT-3', 'INT-4'], ext: ['INT-2', 'INT-5', 'INT-6'], prior: true },
  cr: { own: ['INT-1'], ext: [], prior: false },
}

/** Расписки ролей из потока: строки «перепись начата, роль: X; 🟢: …; 🔵/🟡: …», кроме образцов из текста скилла. */
export function receipts (stream) {
  const out = {}
  const re = /перепись начата, роль: (бэкенд|фронтенд|стык); 🟢: ([^;]*); 🔵\/🟡: ([^;]*); триггеров найдено: (\d+)/g
  for (const m of (stream || '').matchAll(re)) {
    if (m[2] === 'INT-1, INT-2, INT-3' && m[3] === 'INT-6' && m[4] === '9') continue // образец из пробы
    out[m[1]] = { green: m[2].match(/INT-\d+/g) || [], ext: m[3].match(/INT-\d+/g) || [] }
  }
  return out
}

/** Пункты отчёта: строки «  N. …». */
export const items = (answer) => (answer || '').split('\n').filter((l) => /^\s+\d+\.\s/.test(l))

const CHANGE = /пропуск|BADGE|badge|bikeRack|велосипед|велокрепл|officeCode|офис|сортир|approverName|согласующ/i
const PRIOR = [
  /последн\w*\s+мест|одновременно\s+записыва|двое\s+(?:одновременно\s+)?записыва/i,
  /потолок|предел\w*\s+числа|по\s+чему\s+две\s+записи|вторая\s+запись|повторн\w+\s+запис\w+\s+того\s+же/i,
  /уже\s+ушёл|ушедш|departureAt/i,
  /рейс\s+исчез|стал\s+недоступен/i,
  /сколько\s+рейсов|постранич|порци/i,
  /уже\s+записан/i,
  /отозвал|потер\w+\s+рол|уже\s+выданн\w*\s+сесси/i,
  /рейсов\s+нет|пуст\w*\s+списк|нет\s+вовсе/i,
  /прежн\w*\s+(?:путь|ответ|пол[ея]|формат)|какое\s+взаимодействие\s+§2\s+отдаёт\s+это\s+поле/i,
]
/** Пункт про прежнее: признак прежнего поведения и ни слова об изменении. */
export const prior = (it) => PRIOR.some((r) => r.test(it)) && !CHANGE.test(it)

export function grade (answer, stream, kase) {
  const c = CASES[kase]
  const rc = receipts(stream)
  const its = items(answer)
  const m = {}
  const roles = Object.keys(rc)
  m['расписки трёх ролей'] = roles.length === 3
  m['изменение — в 🟢 у всех ролей'] = roles.length > 0 && roles.every((r) => c.own.every((id) => rc[r].green.includes(id)))
  m['потребление — в 🔵/🟡 у всех ролей'] = roles.length > 0 && roles.every((r) => c.ext.every((id) => rc[r].ext.includes(id)))
  m['вопросы по изменению есть'] = its.some((it) => CHANGE.test(it))
  const pr = c.prior ? its.filter(prior) : []
  if (c.prior) m['про прежнее — не больше одного'] = pr.length <= 1
  m._prior = pr
  m._n = its.length
  return m
}

function selftest () {
  const ok = (name, cond) => { console.log(`  ${cond ? '✅' : '❌'} ${name}`); return cond ? 0 : 1 }
  let f = 0
  const st = ['бэкенд', 'фронтенд', 'стык'].map((r) => `перепись начата, роль: ${r}; 🟢: INT-1, INT-3, INT-4; 🔵/🟡: INT-2, INT-5; триггеров найдено: 8`).join('\n') + '\nперепись начата, роль: бэкенд; 🟢: INT-1, INT-2, INT-3; 🔵/🟡: INT-6; триггеров найдено: 9'
  const green = '§2 INT-1\n  1. проверка пропуска — что при сбое службы пропусков\n'
  const g = grade(green, st, 'yes'); f += ok('yes зелёный', Object.entries(g).every(([k, v]) => k.startsWith('_') || v))
  f += ok('образец из пробы не затирает расписку', receipts(st)['бэкенд'].green.includes('INT-4'))
  f += ok('прежнее поймано', !grade(green + '  2. резервирование места — кто выигрывает, когда двое записываются на последнее место\n  3. запись — есть ли потолок числа записей\n', st, 'yes')['про прежнее — не больше одного'])
  f += ok('изменение рядом с прежним — не прежнее', grade(green + '  2. отказ по пропуску и отказ «мест нет» — что первым\n', st, 'yes')['про прежнее — не больше одного'])
  f += ok('изменение в 🔵/🟡 — красный', !grade(green, st.replace(/🟢: INT-1, INT-3, INT-4; 🔵\/🟡: INT-2, INT-5/, '🟢: INT-4; 🔵/🟡: INT-1, INT-2, INT-3, INT-5'), 'yes')['изменение — в 🟢 у всех ролей'])
  f += ok('нет вопросов по изменению — красный', !grade('§4.1\n  1. список — что при пустом\n', st, 'yes')['вопросы по изменению есть'])
  console.log(`самопроверка: ${f ? 'провалов ' + f : '✓'}`)
  return f
}

if (process.argv.includes('--selftest')) process.exit(selftest() ? 1 : 0)
const arg = process.argv[2]
const kase = (process.argv.find((a) => a.startsWith('--case=')) || '').slice(7)
if (!arg || !existsSync(arg) || !CASES[kase]) { console.error('usage: node grade-sr-blue.mjs <каталог плеча> --case=yes|idk|cr'); process.exit(1) }
const runs = readdirSync(arg).filter((n) => /^run-\d+$/.test(n) && statSync(join(arg, n)).isDirectory()).sort()
console.log(`\nпроба sr-blue-${kase}, ${arg}`)
let measured = 0; let green = 0
for (const n of runs) {
  const dir = join(arg, n)
  const t1 = turn(dir, 1)
  if (apiFailed(dir, [t1.answer])) { console.log(`  ${n}: НЕ ИЗМЕРЕНО`); continue }
  measured++
  const g = grade(t1.answer, t1.stream, kase)
  const bad = Object.entries(g).filter(([k, v]) => !k.startsWith('_') && !v).map(([k]) => k)
  if (!bad.length) green++
  console.log(`  ${n}: ${bad.length ? 'красный' : 'зелёный'} · пунктов ${g._n} · про прежнее ${g._prior.length}${bad.length ? '  ✗ ' + bad.join(' · ') : ''}`)
  for (const p of g._prior) console.log(`        прежнее: ${p.trim().slice(0, 130)}`)
}
console.log(`\n  ${green}/${measured}\tзелёных  ← КРИТЕРИЙ\n`)
