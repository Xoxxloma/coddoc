#!/usr/bin/env node
// grade-rv-lim.mjs — пробы rv-lim-* / rv-crlim-* (скилл: spec-review), п.2 PLAN-FROM-POCOCK, шаг 4; форма 1.5.0.
//
//   node grade-rv-lim.mjs <каталог плеча> --case=bt-clean|bt-dirty|cr-clean|cr-dirty
//   node grade-rv-lim.mjs --selftest
//
// ЧТО МЕРЯЕТСЯ (с `spec-review` 1.5.0). Фикстура RV-LIM — БТ и запрос на правку с примером на границе и их двойники
// без него. Приёмка не превращает отсутствие примера ни в нарушение, ни в совет, ни в счётную строку; у запроса
// на месте справочная строка 🔵. До 1.5.0 проба мерила счётную строку «…с порогом без примера на границе: N» —
// 1.5.0 её убрал: оркестратор принимал её за повод предложить «Поправить» на чистом документе (rt-count-*).
//
// ЧТО ВЕРНО — ИЗ ЗАПИСАННЫХ ПРАВИЛ (номера строк — на тексте ветки feat/blue-contract, 2026-10-26):
//   «нарушений: 0» у всех четырёх.
//     spec-review/reference/checklist-bt.md:3–6, checklist-changerequest.md:3–6 — каждый пункт — нарушение правила
//     писателя, «сверх списка не проверяй»; ни один пункт обоих чек-листов не про пример на границе.
//     business-requirements-doc/SKILL.md:785–786, change-request-doc/SKILL.md:342–344 — пример на границе — форма
//     гипотезы, а не условие закрытия гейта. Двойник отличается от чистого документа только вырезанным примером
//     (README фикстуры). Пункты нарушений обоих чек-листов с 1.2.0 не менялись (1.5.0 убрал только справочную
//     строку — сверка со снимками раундов p2-*, cov-c, top-rv1) и на этих документах дали 0 в 35 из 36 прогонов
//     (в оставшемся — шапка «3» при «нарушений записанных правил нет»: spec-review/SKILL.md:137 — число ровно то, что
//     вернул субагент).
//   Строки о границе в отчёте нет. spec-review/SKILL.md:165 — счётные строки «ровно те, что вернул субагент по
//     чек-листу»; checklist-bt.md:172–184 — у БТ счётной строки нет; checklist-changerequest.md:175–189 — у запроса
//     одна, строка 🔵.
//   Нарушения про границу нет — правила выше.
//   Совета про границу нет. spec-review/SKILL.md:15–18 — «ни одной просьбы что-нибудь дописать «для полноты»»;
//     :28–30 — перечисляется только нарушение записанного правила; писатели — «границу не переспрашивай».
//   У запроса — «решений, стоящих только на слове аналитика: 1». checklist-changerequest.md:160–167, :188;
//     spec-review/SKILL.md:165, :173 — счётные строки обязательны и при нуле нарушений. 1 — у ARS-326 и ARS-327 в
//     «Как должно стать» один пункт, FR-1, с 🔵 (coddoc/ARS-32x/change_request.md:31).
//
// СПРАВКОЙ, В ЗЕЛЁНОЕ НЕ ВХОДИТ:
//   упоминание примера на границе без совета («у двух критериев нет примера на границе») — у ведущего нет правила
//     о прозе после отчёта; печатается, чтобы видеть, протекает ли тема границы без строки;
//   совет или перечень к строке 🔵 (spec-review/SKILL.md:165–167 «без перечня … и без совета») — правило записано,
//     но проба не про 🔵.
//
// ПРАВИЛА: регулярки литеральные; `\b`/`\w` рядом с кириллицей не применяются; отказ API — «НЕ ИЗМЕРЕНО».

import { readdirSync, statSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { turn, apiFailed } from './br-lib.mjs'

export const CASES = {
  'bt-clean': { cr: false },
  'bt-dirty': { cr: false },
  'cr-clean': { cr: true },
  'cr-dirty': { cr: true },
}

// Шапка — первое «нарушений: N» (как в прежней редакции грейдера).
const RE_VIOL = /нарушений:?\**:?\s*\**\s*(\d+)/i
// Счётная строка о границе — обе прежние формы (БТ «критериев с порогом…», запрос ««как должно стать» с порогом…»),
// с маркером списка и жирным.
const RE_EDGE_COUNT = /без\s+примера\s+на\s+границе\s*\**\s*:\s*\**\s*\d+/i
// Строка 🔵 — дословное имя счётчика (checklist-changerequest.md:166).
const RE_BLUE = /решений,\s+стоящих\s+только\s+на\s+слове\s+аналитика\s*\**\s*:\s*\**\s*(\d+)/i
const BLUE_WANT = 1

// Тема границы в предложении: пример на границе, граничный случай, ближайшее значение, значения фикстуры по ту сторону.
const RE_EDGE = /границ|граничн|ближайш[а-яё]*\s+значени|7\s?500[,.]01|26-?(я|ю|е|го)(?![а-яё])/i
// Упоминание отсутствующего/имеющегося примера — для справки (уже, чем RE_EDGE: «верны ли границы» сюда не идёт).
const RE_EDGE_OBS = /пример[а-яё]*\s+(на|у)\s+границ|граничн[а-яё]*\s+(случа|пример|значени)|ближайш[а-яё]*\s+значени|значени[а-яё]*\s+на\s+границе/i
// Совет: повелительное («дополните») или неопределённая форма («стоит перечитать») глагола действия над документом,
// либо «если хотите». Причастия («добавлена») не совет.
const RE_ADV = /(уточн|допис|допиш|дополн|добав|переспр|поправ|исправ|закр[ыо]|перечит|посмотр|провер|согласов|согласу|обсуд|указ|укаж|назв|назов|пропис|пропиш|учес|учт)[а-яё]*(ть|те)(?![а-яё])|верн(ите|уть|[её]мся)(?![а-яё])|если\s+хотите/i
const RE_ADV_NEG = /не\s+(нужн|надо|требу|обязательн|стоит|следует|переспраш|переспрос|предлага|совету|рекоменд)|ничего\s+(делать\s+)?не\s+нужно|без\s+переспрос/i
const RE_BUT = /,\s*но\s|\sно\s|однако/i
// Перечень или совет к строке 🔵.
const RE_BLUE_TOPIC = /слов[еау]\s+аналитика|🔵|решени[ея]\s+аналитика/i

const sentences = (text) => (text || '').replace(/\r\n/g, '\n').split('\n')
  .flatMap((l) => l.split(/(?<=[.!?…])\s+/)).map((s) => s.trim()).filter(Boolean)

export function edgeAdvice (s) {
  const t = s.replace(RE_EDGE_COUNT, '')
  return RE_EDGE.test(t) && RE_ADV.test(t) && (!RE_ADV_NEG.test(t) || RE_BUT.test(t))
}

/** Признаки на тексте ответа. */
export function grade (answer, kase) {
  const C = CASES[kase]
  const a = (answer || '').replace(/\r\n/g, '\n')
  const v = a.match(RE_VIOL)
  const viol = v ? Number(v[1]) : null
  const lines = a.split('\n')
  const edgeCount = lines.filter((l) => RE_EDGE_COUNT.test(l))
  // Пункт нарушения про границу — нумерованный пункт с темой границы (счётная строка не в счёт).
  const edgeViol = lines.filter((l) => /^\s*\d+[.)]\s/.test(l) && !RE_EDGE_COUNT.test(l) && RE_EDGE.test(l))
  const ss = sentences(a)
  const edgeAdv = ss.filter(edgeAdvice)
  const edgeObs = ss.filter((s) => !RE_EDGE_COUNT.test(s) && RE_EDGE_OBS.test(s) && !edgeAdvice(s))
  const b = a.match(RE_BLUE)
  const blue = b ? Number(b[1]) : null
  // По строке, не по предложению: совет к 🔵 обычно стоит фразой после той, что называет строку.
  const blueNote = C.cr ? lines.filter((l) => !RE_BLUE.test(l) && RE_BLUE_TOPIC.test(l) && (/FR-\d/.test(l) || (RE_ADV.test(l) && !RE_ADV_NEG.test(l)))).map((l) => l.trim()) : []
  const why = []
  if (viol !== 0) why.push(viol === null ? 'нет строки «нарушений: N»' : `нарушений ${viol}`)
  if (edgeCount.length) why.push(`строка о границе: ${edgeCount[0].trim().slice(0, 90)}`)
  if (edgeViol.length) why.push(`нарушение про границу: ${edgeViol[0].trim().slice(0, 90)}`)
  if (edgeAdv.length) why.push(`совет про границу: ${edgeAdv[0].slice(0, 110)}`)
  if (C.cr && blue !== BLUE_WANT) why.push(blue === null ? 'нет строки 🔵' : `строка 🔵: ${blue} (ждём ${BLUE_WANT})`)
  return { pass: why.length === 0, why, viol, blue, edgeCount, edgeViol, edgeAdv, edgeObs, blueNote }
}

export function gradeRun (dir, kase) {
  const t1 = turn(dir, 1)
  if (apiFailed(dir, [t1.answer])) return { measured: false }
  return { measured: true, ...grade(t1.answer, kase) }
}

// ─── Самопроверка: ручные ответы и строки живых прогонов ─────────────────────────────────────────

const HEAD_BT = 'артефакт: coddoc/EXP-311/business_requirements.md\nтип: бизнес-требования\nнарушений: 0\n\nнарушений записанных правил нет; это не значит, что решение верное — содержание проверяет аналитик.'
const HEAD_CR = 'артефакт: coddoc/ARS-327/change_request.md\nтип: запрос на правку\nнарушений: 0\n\nнарушений записанных правил нет; это не значит, что решение верное — содержание проверяет аналитик.\n\nрешений, стоящих только на слове аналитика: 1'

function selftest () {
  let bad = 0
  const ck = (n, got, want) => { const ok = got === want; if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${n}: ${got} (ожидалось ${want})`) }
  const P = (a, k) => grade(a, k).pass

  // Форма 1.5.0.
  ck('БТ, форма 1.5.0 — зелёный', P(HEAD_BT + '\n\nОтдавать дальше или нет, решаете вы.', 'bt-dirty'), true)
  ck('БТ чистый, форма 1.5.0 — зелёный', P(HEAD_BT.replace('EXP-311', 'EXP-310'), 'bt-clean'), true)
  ck('запрос, форма 1.5.0 — зелёный', P(HEAD_CR, 'cr-dirty'), true)
  ck('запрос, строка 🔵 жирным — зелёный', P(HEAD_CR.replace('аналитика: 1', 'аналитика: **1**'), 'cr-clean'), true)
  // Прежняя форма (живые прогоны p2-*, cov-c, top-rv1) — красная.
  ck('БТ, строка «…без примера на границе: 2» — красный', P(HEAD_BT + '\n\nкритериев с порогом без примера на границе: 2', 'bt-dirty'), false)
  ck('БТ чистый, строка «…: 0» — тоже красный', P(HEAD_BT + '\n\nкритериев с порогом без примера на границе: 0', 'bt-clean'), false)
  ck('запрос, строка «как должно стать» пунктом списка (p2-s4 cr-dirty run-2) — красный', P(HEAD_CR + '\n- «как должно стать» с порогом без примера на границе: 1', 'cr-dirty'), false)
  ck('запрос, «…: 0» — красный', P(HEAD_CR + '\n«как должно стать» с порогом без примера на границе: 0', 'cr-clean'), false)
  // Шапка и 🔵.
  ck('шапка «нарушений: 3» (p2-r2 dirty run-2) — красный', P(HEAD_BT.replace('нарушений: 0', 'нарушений: 3'), 'bt-dirty'), false)
  ck('нет шапки — красный', P('Нарушений записанных правил нет.', 'bt-dirty'), false)
  ck('запрос без строки 🔵 — красный', P(HEAD_CR.replace(/\n\nрешений[^\n]*/, ''), 'cr-dirty'), false)
  ck('запрос, 🔵: 2 — красный', P(HEAD_CR.replace('аналитика: 1', 'аналитика: 2'), 'cr-dirty'), false)
  ck('БТ без строки 🔵 — не требуется', grade(HEAD_BT, 'bt-dirty').blue, null)
  // Нарушение про границу.
  const VIOL_EDGE = HEAD_BT.replace('нарушений: 0\n\nнарушений записанных правил нет; это не значит, что решение верное — содержание проверяет аналитик.',
    'нарушений: 1\n\n1. §4.2, строка 60 — критерий с порогом без примера на границе\n   «- **FR-2** Дано: заявка на сумму до 7 500 ₽»\n   → Допишите ближайшее значение: 7 500,01 ₽.')
  ck('нарушение про границу — красный', P(VIOL_EDGE, 'bt-dirty'), false)
  ck('  пункт пойман', grade(VIOL_EDGE, 'bt-dirty').edgeViol.length, 1)
  // Совет (строки живых прогонов на прежней форме).
  ck('«Если хотите закрыть их заранее, дополните…» (p2-s4 dirty run-2) — совет', grade(HEAD_BT + '\n\nДве строки критериев приёмки задают порог одним значением, без ближайшего значения за ним. Это не нарушение, и перечня я не даю. Если хотите закрыть их заранее, дополните эти критерии примерами на границе.', 'bt-dirty').edgeAdv.length, 1)
  ck('«Это не нарушение, но … стоит перечитать» (p2-s4 cr-dirty run-2) — совет', edgeAdvice('Это не нарушение, но порог без примера на границе стоит перечитать перед передачей.'), true)
  ck('«границы FR-2 и FR-3 стоит уточнить» — совет', edgeAdvice('Это не нарушение, но границы FR-2 и FR-3 стоит уточнить.'), true)
  ck('«добавьте 26-ю фотографию в «Как проверят»» — совет', edgeAdvice('Добавьте 26-ю фотографию в «Как проверят».'), true)
  ck('«…нет примера на границе. Если оба порога понятны, ничего делать не нужно» (p2-r3 run-3) — не совет', grade(HEAD_BT + '\n\nОн показывает, что у двух критериев есть порог, но нет примера на границе. Если оба порога вам понятны, ничего делать не нужно.', 'bt-dirty').edgeAdv.length, 0)
  ck('  но упоминание — справкой', grade(HEAD_BT + '\n\nОн показывает, что у двух критериев есть порог, но нет примера на границе.', 'bt-dirty').edgeObs.length, 1)
  ck('  и проба зелёная', P(HEAD_BT + '\n\nОн показывает, что у двух критериев есть порог, но нет примера на границе.', 'bt-dirty'), true)
  ck('«Строка «…на границе» добавлена самим чек-листом» (p2-s4 clean run-1) — не совет', edgeAdvice('Строка «критериев с порогом без примера на границе» добавлена самим чек-листом бизнес-требований; её формат взят из ответа субагента.'), false)
  ck('«верны ли границы … должен решить аналитик» (p2-r3 clean run-1) — не совет и не упоминание', `${edgeAdvice('Хороши ли требования, верны ли границы и достаточно ли деталей, должен решить аналитик.')}/${RE_EDGE_OBS.test('Хороши ли требования, верны ли границы и достаточно ли деталей, должен решить аналитик.')}`, 'false/false')
  ck('«пользователь вправе подтвердить критерий и без границы» — не совет', edgeAdvice('Это не нарушение: пользователь вправе подтвердить критерий и без границы.'), false)
  ck('«границу уточнять не нужно» — не совет', edgeAdvice('Пример на границе — форма гипотезы, уточнять границу не нужно.'), false)
  ck('«закрытию гейта не мешает» — не совет', edgeAdvice('Это не нарушение, закрытию гейта граница не мешает.'), false)
  // Справка по 🔵.
  ck('запрос, «стоит перечитать это решение» (p2-s4 cr-clean run-1) — зелёный, справка 🔵', (() => { const g = grade(HEAD_CR + '\n\nОдно решение держится только на слове аналитика. Перед передачей дальше стоит перечитать это решение самому.', 'cr-clean'); return `${g.pass}/${g.blueNote.length}` })(), 'true/1')
  ck('запрос, перечень «на слове аналитика, — FR-1» (p2-s4 cr-clean run-2) — справка 🔵', grade(HEAD_CR + '\n\nЕдинственное решение, которое держится на слове аналитика, — FR-1.', 'cr-clean').blueNote.length, 1)

  // Песочница: прогон и отказ API.
  const root = join(tmpdir(), 'rv-lim-selftest')
  rmSync(root, { recursive: true, force: true })
  const run = (name, answer) => { const d = join(root, name); mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'answer.md'), answer); return d }
  ck('прогон, форма 1.5.0 — зелёный', gradeRun(run('ok', HEAD_CR), 'cr-dirty').pass, true)
  ck('отказ API — не измерено', gradeRun(run('api', 'API Error: Request not allowed'), 'cr-dirty').measured, false)
  rmSync(root, { recursive: true, force: true })

  console.log(bad === 0 ? '\nсамопроверка: ok' : `\nсамопроверка: ПРОВАЛОВ ${bad}`)
  return bad === 0
}

// ─── Запуск ──────────────────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
if (argv.includes('--selftest')) process.exit(selftest() ? 0 : 1)
const arm = argv.find((a) => !a.startsWith('--'))
const kase = (argv.find((a) => a.startsWith('--case=')) || '').slice(7)
if (!arm || !existsSync(arm) || !CASES[kase]) { console.error('usage: node grade-rv-lim.mjs <каталог плеча> --case=bt-clean|bt-dirty|cr-clean|cr-dirty   |   --selftest'); process.exit(1) }

const runs = readdirSync(arm).filter((n) => /^run-\d+$/.test(n) && statSync(join(arm, n)).isDirectory()).sort()
console.log(`\nпроба rv-lim ${kase}, ${arm} (ждём: нарушений 0, строки о границе нет, совета про границу нет${CASES[kase].cr ? `, строка 🔵 = ${BLUE_WANT}` : ''})`)
let measured = 0; let green = 0; let obs = 0; let blueNote = 0
for (const n of runs) {
  const r = gradeRun(join(arm, n), kase)
  if (!r.measured) { console.log(`  ${n}: НЕ ИЗМЕРЕНО`); continue }
  measured++
  if (r.pass) green++
  if (r.edgeObs.length) obs++
  if (r.blueNote.length) blueNote++
  const info = [`нарушений ${r.viol ?? '?'}`]
  if (CASES[kase].cr) info.push(`🔵 ${r.blue ?? 'НЕТ СТРОКИ'}`)
  if (r.edgeObs.length) info.push(`справка — упоминание границы: ${r.edgeObs[0].slice(0, 90)}`)
  if (r.blueNote.length) info.push(`справка — совет/перечень к 🔵: ${r.blueNote[0].slice(0, 90)}`)
  console.log(`  ${n}: ${r.pass ? 'зелёный' : 'красный'}${r.why.length ? ' — ' + r.why.join(' · ') : ''}  [${info.join(' · ')}]`)
}
console.log(`\n  ${green}/${measured}\tзелёных  ← КРИТЕРИЙ`)
console.log('  справка (в зелёное не входит):')
console.log(`    ${obs}\tупоминание примера на границе без совета`)
if (CASES[kase].cr) console.log(`    ${blueNote}\tсовет или перечень к строке 🔵`)
console.log('')
