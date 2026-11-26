#!/usr/bin/env node
// grade-rv-stage-blue.mjs — пробы rv-stage-blue-* (скилл: spec-review, checklist-stage.md), ревью покрытия п.2б.
//
//   node grade-rv-stage-blue.mjs <каталог плеча>
//   node grade-rv-stage-blue.mjs --selftest
//
// Фикстура RV-STAGE-BLUE: файл этапа с карточкой «изменение существующего» без пути. Вопросы 1–4 чек-листа
// («куда отдаю», вход, выход, пример) не должны уходить в «без ответа»: ответ — строка «Существующий стык»,
// «без изменений», добавленные поля, фрагмент. Прочие пункты «без ответа» — справкой.

import { readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { turn, apiFailed } from './br-lib.mjs'

/** Вопросы 1–4 по содержанию строки: ведущий нумерует пункты «без ответа» по порядку, а не номерами чек-листа. */
const Q14 = /куда\s+отда|метод|\bпут[ьи]\b|что\s+приходит|пол[яе]\s+(?:успешного\s+)?(?:запроса|ответа)|что\s+я\s+возвраща|ответ\s+целиком|json|пример\s+ответа/i

/** Строки после «без ответа», кроме цитат из файла: те, что называют вопросы 1–4. */
export function unanswered (answer) {
  const a = answer || ''
  const i = a.search(/без ответа/i)
  if (i < 0) return []
  const sec = a.slice(i)
  if (/^без ответа:?\s*\**\s*нет/i.test(sec)) return []
  return sec.split('\n').filter((l) => !/^\s*«/.test(l) && Q14.test(l)).map((l) => l.trim().slice(0, 90))
}

export function grade (answer) {
  const u = unanswered(answer)
  const k = (answer || '').match(/ответов из файла:\s*\**\s*(\d+)/i)
  return { 'вопросы 1–4 не в «без ответа»': u.length === 0, _u: u, _k: k ? Number(k[1]) : null }
}

function selftest () {
  const ok = (name, cond) => { console.log(`  ${cond ? '✅' : '❌'} ${name}`); return cond ? 0 : 1 }
  let f = 0
  f += ok('нет без ответа — зелёный', grade('ответов из файла: 10 из 10\n\nбез ответа: нет\nсекций не хватает: нет')['вопросы 1–4 не в «без ответа»'])
  f += ok('1 в без ответа — красный', !grade('ответов из файла: 8 из 10\n\nбез ответа:\n  1. куда отдаю — в файле нет\n  8. кто вправе — в файле нет\n\nсекций не хватает: нет')['вопросы 1–4 не в «без ответа»'])
  f += ok('только 8 — зелёный', grade('без ответа:\n  8. кто вправе — в файле нет\n')['вопросы 1–4 не в «без ответа»'])
  console.log(`самопроверка: ${f ? 'провалов ' + f : '✓'}`)
  return f
}

if (process.argv.includes('--selftest')) process.exit(selftest() ? 1 : 0)
const arg = process.argv[2]
if (!arg || !existsSync(arg)) { console.error('usage: node grade-rv-stage-blue.mjs <каталог плеча>'); process.exit(1) }
const runs = readdirSync(arg).filter((n) => /^run-\d+$/.test(n) && statSync(join(arg, n)).isDirectory()).sort()
console.log(`\n${arg}`)
let measured = 0; let green = 0
for (const n of runs) {
  const dir = join(arg, n)
  const t1 = turn(dir, 1)
  if (apiFailed(dir, [t1.answer])) { console.log(`  ${n}: НЕ ИЗМЕРЕНО`); continue }
  measured++
  const g = grade(t1.answer)
  if (g['вопросы 1–4 не в «без ответа»']) green++
  console.log(`  ${n}: ${g['вопросы 1–4 не в «без ответа»'] ? 'зелёный' : 'красный'} · ответов ${g._k ?? '?'} из 10 · 1–4 без ответа: ${g._u.length ? g._u.join(' | ') : 'нет'}`)
}
console.log(`\n  ${green}/${measured}\tзелёных  ← КРИТЕРИЙ\n`)
