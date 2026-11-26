#!/usr/bin/env node
// grade-rv-blue.mjs — пробы rv-blue-* (скилл: spec-review, checklist-spec.md), шаг 2 п.2б PLAN-FROM-POCOCK.
//
//   node grade-rv-blue.mjs <каталог плеча> --case=yes|idk|cr|dirty|was
//   node grade-rv-blue.mjs --selftest
//
// Фикстура RV-BLUE: чистые спеки после 2б (SHT-410 — 🔵 по источникам, SHT-411 — 🟡-основа изменения) и двойники с
// посаженными дефектами (SHT-412 — 🔵 без источника, карточка без «Вид», изменение без «Существующего стыка»;
// SHT-413 — «было» у прежнего поля на 🟡-основе).
// UA-420 — мелкая правка, стык 🔵 без пути.
//   yes/idk/cr: ложных пунктов по правилам 2б нет, нет §1 по строке стыка и §7 «🟢 без транспорта» у карточек изменения.
//   dirty/was: посаженное найдено. Прочие нарушения — справкой.

import { readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { turn, apiFailed } from './br-lib.mjs'

/**
 * Блоки пунктов отчёта. Пункт — строка «N. …» и её продолжение С ОТСТУПОМ (форма — `spec-review/SKILL.md`,
 * Шаг 3: цитата и «→» идут под пунктом с отступом). Первая непустая строка без отступа закрывает пункт:
 * свободный абзац ведущего после списка («нарушений записанных правил, кроме этого, нет…», «Источник
 * требований не передавался…») пунктом не является. Первая редакция тянула в последний пункт всё до
 * счётной строки, и слово «источник» из такого абзаца давало ложный красный (top-rv2, rv-blue-yes run-4).
 * Пустые строки внутри пункта допустимы, если за ними снова идёт строка с отступом.
 */
const RE_ITEM = /^\s*\d+\.\s/
const RE_COUNT = /стоящих только на|нарушений:/i
export function items (answer) {
  const lines = answer.split('\n')
  const out = []
  let cur = null
  let gap = ''
  for (const l of lines) {
    if (RE_ITEM.test(l)) { if (cur) out.push(cur); cur = l; gap = ''; continue }
    if (cur === null) continue
    if (!l.trim()) { gap += '\n'; continue }
    if (/^\s/.test(l) && !RE_COUNT.test(l)) { cur += gap + '\n' + l; gap = ''; continue }
    out.push(cur); cur = null; gap = ''
  }
  if (cur) out.push(cur)
  return out
}

const NEW = /источник|«?Вид»?\b|Существующ[а-яё]*\s+стык|«было»|\bбыло\b|🟡-основ/i
const P1 = /к\s+валидации/i
const P7 = /без\s+транспорта|метод\s+и\s+путь|нет\s+(ни\s+)?(метода|пути)/i
const CHANGE_CARD = { yes: /INT-1\b|INT-3\b|INT-4\b/, idk: /INT-1\b|INT-3\b/, cr: /INT-1\b/ }

export function grade (answer, kase) {
  const its = items(answer)
  const v = answer.match(/нарушений:?\**:?\s*\**\s*(\d+)/i)
  const viol = v ? Number(v[1]) : null
  const m = {}
  if (kase === 'yes' || kase === 'idk' || kase === 'cr') {
    const fpNew = its.filter((b) => NEW.test(b))
    const fpP1 = its.filter((b) => P1.test(b) && /стык/i.test(b))
    const fpP7 = its.filter((b) => P7.test(b) && CHANGE_CARD[kase].test(b))
    m['нет ложных по правилам 2б'] = fpNew.length === 0
    m['нет §1 по строке стыка'] = fpP1.length === 0
    m['нет §7 у карточек изменения'] = fpP7.length === 0
    m._other = its.filter((b) => !fpNew.includes(b) && !fpP1.includes(b) && !fpP7.includes(b))
    // Ревью шага 2: счётная строка — метки 🔵 со «со слов» при пути или поле у карточки и в стыке; у SHT-410 их ровно 3.
    if (kase === 'yes') { const c = answer.match(/стоящих только на памяти аналитика:\s*\**\s*(\d+)/i); m['счётная строка = 3'] = !!c && Number(c[1]) === 3 }
  } else if (kase === 'dirty') {
    m['найдено: 🔵 без источника (INT-2)'] = its.some((b) => /источник/i.test(b) && /INT-2\b|пропуск|badge/i.test(b))
    m['найдено: нет «Вид» (INT-5)'] = its.some((b) => /Вид/.test(b) && /INT-5\b|справочник|org/i.test(b))
    m['найдено: изменение без стыка (INT-3)'] = its.some((b) => /Существующ[а-яё]*\s+стык|стык/i.test(b) && /INT-3\b|bikeRack|велосипед|карточк[аи]\s+рейса/i.test(b))
    m._other = its.filter((b) => !/источник|Вид|стык/i.test(b))
  } else {
    m['найдено: «было» на 🟡-основе'] = its.some((b) => /было/i.test(b) && /seatsLeft|🟡/i.test(b))
    m._other = its.filter((b) => !/было/i.test(b))
  }
  m._viol = viol
  return m
}

function selftest () {
  const ok = (name, cond) => { console.log(`  ${cond ? '✅' : '❌'} ${name}`); return cond ? 0 : 1 }
  let f = 0
  const clean = 'нарушений: 0\n\nутверждений, стоящих только на памяти аналитика: 1'
  const g1 = grade(clean, 'idk'); f += ok('yes: счётная строка 1 — красный', !grade(clean, 'yes')['счётная строка = 3']); f += ok('idk чистый — зелёный', g1['нет ложных по правилам 2б'] && g1['нет §1 по строке стыка'] && g1['нет §7 у карточек изменения'])
  const fp7 = 'нарушений: 1\n\n1. §2 INT-3 — карточка 🟢 без транспорта\n   «Существующий стык: 🟡 к валидации»\n   → назовите метод и путь\n'
  f += ok('idk: §7 у изменения пойман', !grade(fp7, 'idk')['нет §7 у карточек изменения'])
  const dirty = 'нарушений: 3\n\n1. §2 INT-2 — конкретика под 🔵 без источника\n   «GET /api/v3/badges»\n2. §2 INT-5 — нет строки «Вид»\n   «### INT-5»\n3. §2 INT-3 — изменение без строки «Существующий стык»\n   «bikeRack»\n'
  const gd = grade(dirty, 'dirty'); f += ok('dirty: три найдены', gd['найдено: 🔵 без источника (INT-2)'] && gd['найдено: нет «Вид» (INT-5)'] && gd['найдено: изменение без стыка (INT-3)'])
  f += ok('dirty: пустой отчёт — красный', !grade('нарушений: 0', 'dirty')['найдено: нет «Вид» (INT-5)'])
  f += ok('was: найдено', grade('нарушений: 1\n\n1. §2 INT-3 — «было» на 🟡-основе\n   «seatsLeft | int»\n', 'was')['найдено: «было» на 🟡-основе'])
  // Граница пункта. Живой отчёт top-rv2 rv-blue-yes run-4: один пункт §6.3, затем свободные абзацы ведущего.
  const tail = 'артефакт: coddoc/SHT-410/technical_specification.md\nтип: тех-спецификация\nнарушений: 1\n\n' +
    '1. §6.3, строки 219–220 — неприменимый раздел оформлен неверно\n   «### 6.3. Фиче-флаги» / «~~Не применимо: задача не использует фиче-флаги.~~»\n' +
    '   → Раздел неприменим целиком, поэтому зачёркнуты должны быть и заголовок, и текст. Сейчас зачёркнут только текст. Исправьте это в `technical-spec-doc`.\n\n' +
    'нарушений записанных правил, кроме этого, нет. Это не значит, что решение верное: содержание проверяет аналитик.\n\n' +
    'Источник требований не передавался: рядом со спекой нет ни БТ, ни баг-репорта, ни запроса на правку. Проверка по `context/` не применялась, потому что в корне репозитория нет такой папки.\n\n' +
    'утверждений, стоящих только на памяти аналитика: 3\n'
  const ti = items(tail)
  f += ok('граница: абзац после списка в пункт не попал', ti.length === 1 && !/Источник требований|кроме этого/.test(ti[0]) && /→ Раздел неприменим/.test(ti[0]))
  f += ok('граница: yes run-4 — нет ложного «по правилам 2б»', grade(tail, 'yes')['нет ложных по правилам 2б'])
  const multi = 'нарушений: 2\n\n1. §2 INT-4, строки 120–124 — конкретика под 🟡 к валидации\n   «Контракт (запрос): `GET /v1/racks`»\n   «Ответ: `rackId`, `bikeRack`»\n\n' +
    '   «Существующий стык: 🟡 к валидации»\n   → Подтвердите у владельца.\n2. §7, строка 240 — FR-3 не покрыт\n   «| FR-3 | — | |»\n\nутверждений, стоящих только на памяти аналитика: 0\n'
  const mi = items(multi)
  f += ok('граница: многострочная цитата с отступом и пустой строкой внутри — пункт целый', mi.length === 2 && /bikeRack/.test(mi[0]) && /Существующий стык/.test(mi[0]) && /→ Подтвердите/.test(mi[0]) && !/FR-3/.test(mi[0]))
  // настоящий красный остаётся: «источник» внутри самого пункта, абзац после списка его не прикрывает и не создаёт
  const realFp = 'нарушений: 1\n\n1. §2 INT-2, строка 88 — 🔵 без источника\n   «🔵 подтверждено аналитиком»\n   → Назовите источник.\n\nнарушений записанных правил, кроме этого, нет.\n\nутверждений, стоящих только на памяти аналитика: 3\n'
  f += ok('граница: «источник» в самом пункте — по-прежнему красный', !grade(realFp, 'yes')['нет ложных по правилам 2б'])
  const deepFind = 'нарушений: 1\n\n1. §2, строка 88 — конкретика без источника\n   «Служба пропусков, GET /api/v3/badges»\n   Карточка INT-2.\n\nИсточник требований не передавался.\n\nутверждений, стоящих только на памяти аналитика: 0\n'
  f += ok('граница: dirty — находка по третьей строке пункта засчитана', grade(deepFind, 'dirty')['найдено: 🔵 без источника (INT-2)'])
  const tailOnly = 'нарушений: 1\n\n1. §2 INT-2, строка 88 — нет строки «Происхождение»\n   «### INT-2»\n\nИсточник требований не передавался.\n\nутверждений, стоящих только на памяти аналитика: 0\n'
  f += ok('граница: dirty — «источник» из абзаца после списка находку не засчитывает', !grade(tailOnly, 'dirty')['найдено: 🔵 без источника (INT-2)'])
  console.log(`самопроверка: ${f ? 'провалов ' + f : '✓'}`)
  return f
}

if (process.argv.includes('--selftest')) process.exit(selftest() ? 1 : 0)
const arg = process.argv[2]
const kase = (process.argv.find((a) => a.startsWith('--case=')) || '').slice(7)
if (!arg || !existsSync(arg) || !['yes', 'idk', 'cr', 'dirty', 'was'].includes(kase)) { console.error('usage: node grade-rv-blue.mjs <каталог плеча> --case=yes|idk|cr|dirty|was'); process.exit(1) }
const runs = readdirSync(arg).filter((n) => /^run-\d+$/.test(n) && statSync(join(arg, n)).isDirectory()).sort()
console.log(`\nпроба rv-blue-${kase}, ${arg}`)
let measured = 0; let green = 0
for (const n of runs) {
  const dir = join(arg, n)
  const t1 = turn(dir, 1)
  if (apiFailed(dir, [t1.answer])) { console.log(`  ${n}: НЕ ИЗМЕРЕНО`); continue }
  measured++
  const g = grade(t1.answer || '', kase)
  const bad = Object.entries(g).filter(([k, v]) => !k.startsWith('_') && !v).map(([k]) => k)
  if (!bad.length) green++
  console.log(`  ${n}: ${bad.length ? 'красный' : 'зелёный'} · нарушений ${g._viol ?? '?'}${bad.length ? '  ✗ ' + bad.join(' · ') : ''}`)
  for (const o of g._other.slice(0, 4)) console.log(`        прочее: ${o.split('\n')[0].trim().slice(0, 120)}`)
}
console.log(`\n  ${green}/${measured}\tзелёных  ← КРИТЕРИЙ\n`)
