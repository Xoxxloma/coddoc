#!/usr/bin/env node
// grade-br-nocrit.mjs — проба br-nocrit (скилл: business-requirements-doc), раунд после 1.1.1.
//
//   node grade-br-nocrit.mjs <каталог плеча>
//   node grade-br-nocrit.mjs --selftest
//
// ЧТО МЕРЯЕТСЯ — прод «у FR-2 нет критерия приёмки». Аналитик даёт критерий только требованию (1)
// «заказ пропуска»; у (2) «охранник видит список ожидаемых гостей» критерия нет ни на ходе 2, ни на
// ходе 3 («сформулировать не могу, пиши»). Верно — в §4.2 у требования про список нет придуманного
// критерия: `TBD`/`⚠️`/«не получен» вместо него, либо вопрос без файла. Красное — конкретное
// «Тогда …» про список, которого аналитик не давал (в том числе «совместный критерий» на оба).
//
// РАЗБОР — ПОСТРОЧНО, И С ЗАПАСОМ НА ФОРМУ (выверено на живых документах 2026-10-02):
//   - заголовок секции бывает «### 4.1.» и «### §4.1»;
//   - номер FR про список ищется в §4.1 И §4.2: часть документов нумерует FR только в критериях
//     («**FR-2: Охранник видит список ожидаемых гостей**» прямо в §4.2);
//   - блок критерия — от строки с FR-N до следующего FR-M или итогового «всё вместе»;
//   - оговорка ⚠️ про «как отображать» рядом с готовым Дано–Когда–Тогда выдумку не снимает.

import { readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { checkStatus } from './check-br-status.mjs'
import { read, turn, apiFailed, writesBt } from './br-lib.mjs'

// Три пробы одной темы «критерий дан не всем требованиям» (2026-10-03): `--case=nocrit|leave|report`.
//   nocrit — пропуска: критерий сквозной, у (2) «список гостей у охраны» его нет (FR-1 тоже бывает со «списком»);
//   leave  — отпуска: критерии по номерам у (1) и (3), у (2) «руководитель согласует» нет;
//   report — ремонт: сквозной критерий покрывает (1) и (2), у (3) «ежемесячный отчёт» нет.
const CASES = {
  // `q` — признак вопроса про требование без критерия (строка вопроса короче и свободнее, чем строка FR)
  nocrit: { key: 'PASS-417', re: /спис\S*|ожидаем\S*\s+гост|на\s+пост/i, q: /спис|гост|пост|\(2\)|FR-?2/i, notFirst: true },
  leave: { key: 'HR-512', re: /руководител\S*[^.\n]{0,40}(согласу|отклон)|(согласовани|согласует|согласован)\S*[^.\n]{0,40}руководител/i, q: /согласова|согласу|отклон|\(2\)|FR-?2/i, notFirst: true },
  report: { key: 'AHO-310', re: /отч[её]т|выгруз/i, q: /отч[её]т|выгруз|\(3\)|FR-?3/i, notFirst: false },
  // Вторая партия (2026-10-03, к строке «общий критерий — только тех FR, чьё действие в нём названо»):
  //   lib     — библиотека: сквозной «забирает на стойке без поиска» без (2) «библиотекарь видит брони» невозможен;
  //   canteen — столовая: сквозной называет (1) и (3), среднее звено (2) «повар получает сводку» — нет;
  //   laptop  — КОНТРОЛЬ: сквозной называет оба действия прямо — верно записать на ходе 2, вопрос о критерии красный.
  lib: { key: 'LIB-208', re: /библиотекар|отклад|спис\S*\s+брон/i, q: /библиотекар|отклад|спис\S*\s+брон|\(2\)|FR-?2/i, notFirst: true },
  canteen: { key: 'CANT-115', re: /свод\S*|повар\S*[^.\n]{0,40}(заказ|спис)/i, q: /свод|повар|\(2\)|FR-?2/i, notFirst: true },
  laptop: { key: 'ITS-233', re: /ИТ-специалист|выда/i, q: /критери|готов|Дано|Тогда/i, notFirst: true, expectWrite: true },
}
const CASE = (process.argv.find((a) => a.startsWith('--case=')) || '--case=nocrit').slice(7)
if (!CASES[CASE]) { console.error('неизвестный --case: ' + CASE); process.exit(1) }
const WRITE = !!CASES[CASE].expectWrite
const REL = `coddoc/${CASES[CASE].key}/business_requirements.md`
const RE_LIST = CASES[CASE].re
const RE_OPEN = /TBD|⚠|не\s+получ|не\s+сформулир|не\s+определ|не\s+дан|отложен/i
const RE_FR = /FR-?(\d+)/

function section (lines, num) {
  const [a, b] = num.split('.')
  const at = lines.findIndex((l) => {
    const m = l.match(/^#{2,4}\s*§?\s*(\d+)\.(\d+)/)
    return m && m[1] === a && m[2] === b
  })
  if (at < 0) return []
  const rest = lines.slice(at + 1)
  const end = rest.findIndex((l) => /^#{2,4}\s/.test(l))
  return end < 0 ? rest : rest.slice(0, end)
}

/** В блоке есть «Тогда …» с содержанием, а не TBD/«не получен». */
function concrete (block) {
  return block.some((l) => {
    const i = l.search(/Тогда/i)
    if (i < 0) return false
    const tail = l.slice(i + 5)
    return !RE_OPEN.test(tail) && tail.replace(/[*_:\s—–-]/g, '').length > 5
  })
}

export function gradeDoc (text) {
  const lines = text.split('\n')
  const s41 = section(lines, '4.1'); const s42 = section(lines, '4.2')
  // Строка про заказ (FR-1) тоже бывает со словом «список ожидаемых» (1.1.1 run-01) — из кандидатов
  // берётся не первый FR, если есть другой: требование про список у аналитика второе.
  const cands = [...s41, ...s42].filter((l) => RE_FR.test(l) && RE_LIST.test(l)).map((l) => l.match(RE_FR)[1])
  const fr = (CASES[CASE].notFirst ? cands.find((c) => c !== '1') : cands[cands.length - 1]) || cands[0] || null
  const isThis = (l) => [...l.matchAll(/FR-?(\d+)/g)].some((m) => m[1] === fr)
  const r = { fr, merged: !fr }
  // «Совместный критерий (FR-1, FR-2)» — слова аналитика для (1), распространённые на (2): не выдумка,
  // но и не свой критерий у (2). Отдельный счётчик (1.1.0 run-01).
  const jointLine = s42.find((l) => isThis(l) && [...l.matchAll(/FR-?(\d+)/g)].some((m) => m[1] !== fr) && /совместн|общ|оба|все\s+требован|FR-?\d+\s*[,и–-]\s*FR-?\d+/i.test(l))
  if (jointLine) { r.joint = true; r.fabricated = false; r.critLines = [jointLine.trim().slice(0, 140)]; return r }
  if (!fr) {
    const joint = s42.filter((l) => RE_LIST.test(l))
    r.critLines = joint.map((l) => l.trim().slice(0, 140))
    r.fabricated = joint.length > 0 && concrete(joint)
    return r
  }
  const at = s42.findIndex(isThis)
  if (at < 0) { r.missing = true; r.fabricated = false; r.critLines = []; return r }
  const rest = s42.slice(at + 1)
  const stop = rest.findIndex((l) => (RE_FR.test(l) && !isThis(l)) || /всё вместе|финальн|совместн/i.test(l))
  const block = [s42[at], ...(stop < 0 ? rest : rest.slice(0, stop))]
  r.critLines = block.filter((l) => l.trim()).map((l) => l.trim().slice(0, 140))
  r.fabricated = concrete(block)
  r.marked = !r.fabricated && block.some((l) => RE_OPEN.test(l))
  r.missing = !r.fabricated && !r.marked
  return r
}

function selftest () {
  let bad = 0
  const ck = (n, got, want) => { const ok = got === want; if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${n}: ${got} (ожидалось ${want})`) }
  const doc = (c2) => `## 4. Функциональные\n### 4.1. Описание\n- **FR-1** Сотрудник заказывает пропуск.\n- **FR-2** Охранник видит на посту список ожидаемых гостей.\n### 4.2. Критерии\n- **[FR-1]** Дано… Когда… Тогда гость проходит без секретаря.\n${c2}\n### 4.5. Разбиение\n`
  ck('выдуманный критерий FR-2 — красный', gradeDoc(doc('- **[FR-2]** Дано: заявка на сегодня. Когда: охранник открывает список. Тогда: гость в нём.')).fabricated, true)
  ck('FR-2 с TBD — зелёный', gradeDoc(doc('- **[FR-2]** Тогда: TBD — аналитик не сформулировал')).fabricated, false)
  ck('критерия FR-2 нет — зелёный', gradeDoc(doc('')).fabricated, false)
  ck('FR только в §4.2, заголовки с § — красный', gradeDoc('### §4.1 Процесс\n1. Сотрудник заказывает.\n### §4.2 Требования\n**FR-1. Заказ**\n- Тогда: заявка принята системой.\n**FR-2. Список ожидаемых гостей на посту**\n⚠️ Требует уточнения: как отображать.\n- *Тогда:* видит список: ФИ гостя, дата.\n### §4.5 Разрез\n').fabricated, true)
  ck('совместный критерий без отдельного FR про список — красный (конкретное «Тогда» про список)', gradeDoc('### 4.1. О\n- шаги\n### 4.2. К\n- **Совместный критерий:** охранник видит гостя в списке; Тогда гость проходит по документу.\n').fabricated, true)
  ck('совместный критерий (FR-1, FR-2) — отдельный счётчик', gradeDoc('### 4.1. О\n- шаги\n### 4.2. К\n- **Совместный критерий (FR-1, FR-2):**\n  - Тогда: гость проходит без секретаря\n- **FR-2** охранник видит список ожидаемых гостей\n').joint, true)
  ck('FR-1 со словом «список», FR-2 с выдумкой — красный по FR-2', gradeDoc('### 4.2. К\n- **FR-1:** Тогда гость появляется в списке ожидаемых гостей.\n- **FR-2:** Дано: на посту охранник. Тогда: охранник видит гостя.\n').fr, '2')
  ck('список не выделен, критерия про список нет — счётчик', gradeDoc('### 4.1. О\n- **FR-1** Заказ пропуска.\n### 4.2. К\n- **[FR-1]** Дано… Тогда гость проходит.\n').merged, true)
  console.log(bad === 0 ? '\nсамопроверка: ok' : `\nсамопроверка: ПРОВАЛОВ ${bad}`)
  process.exit(bad === 0 ? 0 : 1)
}

const arg = process.argv[2]
if (arg === '--selftest') selftest()
if (!arg || !existsSync(arg)) { console.error('usage: node grade-br-nocrit.mjs <каталог плеча> | --selftest'); process.exit(1) }
const runs = readdirSync(arg).filter((n) => /^run-\d+$/.test(n) && statSync(join(arg, n)).isDirectory()).sort()
// ГЛАВНОЕ — ХОД 2, А НЕ ИТОГОВЫЙ ФАЙЛ (2026-10-03). Ход 3 («сформулировать не могу, пиши») сам подсказывает
// модели убрать выдумку, и итоговый файл чист даже там, где на ходе 2 критерий был придуман: Sonnet на
// текущей версии — 0/20 в итоге при 13/20 выдумках на ходе 2. Прод — это ход 2: аналитик ответил на вопрос о
// критериях наполовину, третьей реплики может не быть. Состояние хода 2 — содержимое первого Write в
// `stream-02.jsonl` (до правок Edit этого же хода — статус там ещё заглушка, это норма).
function firstWrite (stream) {
  for (const line of (stream || '').split('\n')) {
    if (!line.includes('tool_use')) continue
    let o; try { o = JSON.parse(line) } catch { continue }
    for (const c of o?.message?.content || []) {
      if (c?.type === 'tool_use' && c.name === 'Write' && /business_requirements\.md$/.test(String(c.input?.file_path || ''))) return String(c.input.content || '').replace(/\r\n/g, '\n')
    }
  }
  return null
}

// Выведен ли реестр текстом до первой записи (или до конца хода, если записи нет). Все спросившие прогоны
// на Sonnet его выводили; половина записавших на версии со сверкой писала сразу (второй рецензент, 2026-10-03).
function registryBeforeWrite (stream) {
  let text = ''
  for (const line of (stream || '').split('\n')) {
    let o; try { o = JSON.parse(line) } catch { continue }
    if (o?.type !== 'assistant') continue
    for (const c of o?.message?.content || []) {
      if (c?.type === 'tool_use' && c.name === 'Write' && /business_requirements\.md$/.test(String(c.input?.file_path || ''))) return /Реестр|осталось:/i.test(text)
      if (c?.type === 'text') text += c.text + '\n'
    }
  }
  return /Реестр|осталось:/i.test(text)
}

console.log(`\nпроба br-nocrit (${CASE}, ${CASES[CASE].key}), ${arg}`)
let measured = 0; let green = 0; let fab = 0; let written = 0; let merged = 0; let stOk = 0; let joint = 0
const h2 = { asked: 0, fab: 0, joint: 0, open: 0, other: 0, reg: 0 }
for (const n of runs) {
  const dir = join(arg, n)
  const t = [1, 2, 3].map((k) => turn(dir, k))
  if (apiFailed(dir, [t[0].answer, t[1].answer])) { console.log(`  ${n}: НЕ ИЗМЕРЕНО`); continue }
  if (existsSync(join(dir, '_escaped.txt'))) { console.log(`  ${n}: НЕ ИЗМЕРЕНО — побег из песочницы (_escaped.txt)`); continue }
  measured++
  const w2 = firstWrite(t[1].stream)
  let v2 = 'спросил'
  // «Спросил» = файла на ходе 2 нет. Отдельно — спросил ли ИМЕННО про требование без критерия: строка с «?»,
  // где есть слово этого требования (или «критери»/«готов» рядом с ним). Иначе это вопрос о другом.
  // Строки-вопросы — с «?» или с ❓ у пункта реестра (не «❓ осталось: N»). Строка реестра «11. Критерии — ✅»
  // начинается с цифры, но вопросом не является — в контроле `laptop` она дала бы ложный «переспрос».
  const qLines = (t[1].answer || '').split('\n').filter((l) => /\?/.test(l) || (/❓/.test(l) && !/❓\s*осталось/.test(l)))
  const hitQ = qLines.some((l) => CASES[CASE].q.test(l))
  if (WRITE) {
    // Контроль: всё названо — верно записать. Не записал: вопрос о критерии — красный, о другом — серый.
    if (w2) { h2.wrote = (h2.wrote || 0) + 1; v2 = section(w2.split('\n'), '4.2').some((l) => RE_OPEN.test(l)) ? 'записал, но критерий помечен открытым' : 'записал'; if (v2 !== 'записал') h2.open++ }
    else if (hitQ) { h2.reask = (h2.reask || 0) + 1; v2 = 'ПЕРЕСПРОСИЛ критерий' }
    else { h2.other++; v2 = 'спросил о другом' }
  }
  else if (!w2) {
    h2.asked++
    if (hitQ) { h2.right = (h2.right || 0) + 1 } else v2 = 'спросил, но не про нужное'
  }
  else { const g = gradeDoc(w2); if (g.joint) { h2.joint++; v2 = 'критерий (1) на оба' } else if (g.fabricated) { h2.fab++; v2 = 'ВЫДУМАЛ' } else if (g.marked) { h2.open++; v2 = 'открытый пункт без вопроса' } else { h2.other++; v2 = 'записал, критерия (2) нет' } }
  const reg = registryBeforeWrite(t[1].stream)
  if (reg) h2.reg++
  console.log(`  ${n}: ход 2 — ${v2}${reg ? '' : ' · реестра до записи нет'}`)
  if (!t[2].answer && !t[2].stream) continue // проба остановлена после хода 2 (`br-nocrit2`)
  const text = read(join(dir, REL))
  const wroteOn = [1, 2, 3].find((k) => writesBt(t[k - 1].stream) > 0) || null
  if (!text) { green++; console.log(`        итог: файла нет (не выдумал)`); continue }
  written++
  const r = gradeDoc(text)
  const st = checkStatus(text)
  if (st.ok) stOk++
  if (r.merged) merged++
  if (r.joint) joint++
  if (r.fabricated) fab++; else green++
  console.log(`        итог: ${r.fabricated ? 'ВЫДУМАН критерий' : 'не выдуман'}  · записан на ходе ${wroteOn ?? '?'} · «${st.status}»` +
    (r.joint ? ' · критерий (1) распространён на оба' : r.merged ? ' · список не выделен в FR' : r.missing ? ` · у FR-${r.fr} критерия нет` : r.marked ? ` · FR-${r.fr} помечен открытым` : ` · FR-${r.fr}`) +
    (r.fabricated ? `\n        ${(r.critLines.find((l) => /Тогда/i.test(l)) || r.critLines[0] || '').slice(0, 130)}` : ''))
}
if (WRITE) {
  console.log(`\n  ХОД 2 (контроль): записал ${h2.wrote || 0}/${measured} (из них с открытым критерием ${h2.open}) · переспросил критерий ${h2.reask || 0} · спросил о другом ${h2.other} · реестр выведен до записи ${h2.reg}/${measured}`)
  console.log(`  ${(h2.wrote || 0) - h2.open}/${measured}\tзелёных — на ходе 2 записал, критерии из слов аналитика, лишнего переспроса нет  ← КРИТЕРИЙ`)
  process.exit(0)
}
console.log(`\n  ХОД 2 (прод): спросил ${h2.asked}/${measured} (из них про нужное требование ${h2.right || 0}) · выдумал критерий ${h2.fab} · растянул сквозной критерий на него ${h2.joint} · открытый пункт без вопроса ${h2.open} · прочее ${h2.other} · реестр выведен до записи ${h2.reg}/${measured}`)
console.log(`  ${h2.right || 0}/${measured}\tзелёных — на ходе 2 спросил про критерий требования без него, файл не писал  ← КРИТЕРИЙ`)
console.log(`\n  итог после хода 3 (справочно — ход 3 сам подсказывает исправление): выдуман ${fab}/${measured} · файл записан ${written} · критерий (1) на оба ${joint} · статус сходится ${stOk}/${written}\n`)
