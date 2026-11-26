#!/usr/bin/env node
// grade-sb-blue.mjs — пробы sb-blue-* (скилл: stage-breakdown-doc), шаг 3 п.2б PLAN-FROM-POCOCK.
//
//   node grade-sb-blue.mjs <каталог плеча> --case=yes|idk|cr|new|na
//   node grade-sb-blue.mjs --selftest
//
// Фикстура SB-BLUE: замороженные выходы technical-spec-doc 1.7.0. Ход 1 — разбей; ход 2 — «годится, пиши»
// (у na хода 2 нет). Грейдится диск: `owns:` файлов этапов и индекс.
//   yes (SHT-410) / idk (SHT-411): карточки «изменение существующего» (🟢) — во владении этапа,
//     «потребление существующего» (🔵/🟡) — ни в чьём. У idk стык изменения — 🟡.
//   cr (UA-420): мелкая правка, одна карточка изменения — этап, не «не применимо».
//   new (ARS-201): одна 🟢 новая карточка — этап (сторож прежней механики).
//   na (ARS-211): только потребление, новых сущностей нет — «не применимо», файлов этапов нет (сторож).
// Справкой: у этапа-владельца изменения скопирована строка «Существующий стык».

import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { turn, apiFailed } from './br-lib.mjs'

const CASES = {
  yes: { key: 'SHT-410', own: ['INT-1', 'INT-3', 'INT-4'], ext: ['INT-2', 'INT-5'], change: ['INT-1', 'INT-3', 'INT-4'] },
  idk: { key: 'SHT-411', own: ['INT-1', 'INT-3', 'INT-4'], ext: ['INT-2', 'INT-5', 'INT-6'], change: ['INT-1', 'INT-3'] },
  cr: { key: 'UA-420', own: ['INT-1'], ext: [], change: ['INT-1'] },
  new: { key: 'ARS-201', own: ['INT-1'], ext: [], change: [] },
  na: { key: 'ARS-211', own: [], ext: ['INT-1'], change: [], na: true },
}

/** `owns:` из шапки файла этапа: INT-N в строке `owns: [...]` или в списке под ней. */
export function owns (stage) {
  const fm = stage.match(/^---\n([\s\S]*?)\n---/)
  if (!fm) return []
  const m = fm[1].match(/^owns:(.*(?:\n\s+-.*)*)/m)
  return m ? (m[1].match(/INT-\d+/g) || []) : []
}

/** stages: { 'stage-01.md': текст }, index: текст или null. */
export function grade (stages, index, kase) {
  const c = CASES[kase]
  const own = new Map()
  for (const [name, text] of Object.entries(stages)) for (const id of owns(text)) own.set(id, [...(own.get(id) || []), name])
  const m = {}
  for (const id of c.own) m[`${id} — во владении этапа`] = own.has(id)
  for (const id of c.ext) m[`${id} — вход извне, ничей`] = !own.has(id)
  const na = !!index && /не\s+применимо/i.test(index)
  const n = Object.keys(stages).length
  if (c.na) { m['индекс «не применимо»'] = na; m['файлов этапов нет'] = n === 0 } else { m['индекс есть, не «не применимо»'] = !!index && !na }
  m._own = [...own.entries()].map(([id, f]) => `${id}→${f.map((x) => x.slice(6, 8)).join('+')}`).sort()
  m._stub = c.change.filter((id) => own.has(id) && !own.get(id).some((f) => /Существующ[а-яё]*\s+стык/i.test(stages[f])))
  return m
}

function selftest () {
  const ok = (name, cond) => { console.log(`  ${cond ? '✅' : '❌'} ${name}`); return cond ? 0 : 1 }
  const crit = (g) => Object.entries(g).every(([k, v]) => k.startsWith('_') || v)
  let f = 0
  const st = (o, extra = '') => `---\ntype: stage\nowns: [${o}]\ndepends_on: []\n---\n# Этап\n${extra}`
  const ix = '# Этапы работ\n| INT-1 | запись | 01 | — |'
  f += ok('yes зелёный', crit(grade({ 'stage-01.md': st('INT-1', '- **Существующий стык:** 🟡'), 'stage-02.md': st('INT-3, "Trip"', 'Существующий стык'), 'stage-03.md': st('INT-4', 'Существующий стык') }, ix, 'yes')))
  f += ok('yes: изменение без владельца — красный', !grade({ 'stage-01.md': st('"Trip"') }, ix, 'yes')['INT-3 — во владении этапа'])
  f += ok('yes: потребление во владении — красный', !grade({ 'stage-01.md': st('INT-1, INT-2'), 'stage-02.md': st('INT-3, INT-4') }, ix, 'yes')['INT-2 — вход извне, ничей'])
  f += ok('owns списком', owns('---\nowns:\n  - INT-3\n  - "Trip"\ndepends_on: []\n---').includes('INT-3'))
  f += ok('cr: «не применимо» — красный', !crit(grade({}, '**Не применимо: правка внутри существующего контракта.**', 'cr')))
  f += ok('cr: один этап — зелёный', crit(grade({ 'stage-01.md': st('INT-1') }, ix, 'cr')))
  f += ok('справка: стык не скопирован', grade({ 'stage-01.md': st('INT-1') }, ix, 'cr')._stub.includes('INT-1'))
  f += ok('na зелёный', crit(grade({}, '**Не применимо: вся работа фронтовая.**', 'na')))
  f += ok('na: этап под потребление — красный', !crit(grade({ 'stage-01.md': st('INT-1') }, ix, 'na')))
  console.log(`самопроверка: ${f ? 'провалов ' + f : '✓'}`)
  return f
}

if (process.argv.includes('--selftest')) process.exit(selftest() ? 1 : 0)
const arg = process.argv[2]
const kase = (process.argv.find((a) => a.startsWith('--case=')) || '').slice(7)
if (!arg || !existsSync(arg) || !CASES[kase]) { console.error('usage: node grade-sb-blue.mjs <каталог плеча> --case=yes|idk|cr|new|na'); process.exit(1) }
const runs = readdirSync(arg).filter((n) => /^run-\d+$/.test(n) && statSync(join(arg, n)).isDirectory()).sort()
console.log(`\nпроба sb-blue-${kase}, ${arg}`)
let measured = 0; let green = 0
for (const n of runs) {
  const dir = join(arg, n)
  const t1 = turn(dir, 1)
  if (apiFailed(dir, [t1.answer])) { console.log(`  ${n}: НЕ ИЗМЕРЕНО`); continue }
  measured++
  const sdir = join(dir, 'coddoc', CASES[kase].key, 'stages')
  const index = existsSync(join(sdir, 'index.md')) ? readFileSync(join(sdir, 'index.md'), 'utf8') : null
  const stages = {}
  if (existsSync(sdir)) for (const x of readdirSync(sdir).filter((x) => /^stage-\d+\.md$/.test(x))) stages[x] = readFileSync(join(sdir, x), 'utf8')
  const g = grade(stages, index, kase)
  const bad = Object.entries(g).filter(([k, v]) => !k.startsWith('_') && !v).map(([k]) => k)
  if (!bad.length) green++
  console.log(`  ${n}: ${bad.length ? 'красный' : 'зелёный'} · этапов ${Object.keys(stages).length} · владение: ${g._own.join(', ') || '—'}${g._stub.length ? ' · справка: без «Существующий стык» ' + g._stub.join(', ') : ''}${bad.length ? '  ✗ ' + bad.join(' · ') : ''}`)
}
console.log(`\n  ${green}/${measured}\tзелёных  ← КРИТЕРИЙ\n`)
