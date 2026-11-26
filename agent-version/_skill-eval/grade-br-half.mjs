#!/usr/bin/env node
// grade-br-half.mjs — проба br-half (скилл: business-requirements-doc), PLAN-BR-COMB §1.
//
//   node grade-br-half.mjs <каталог плеча>
//   node grade-br-half.mjs --selftest
//
// ЧТО МЕРЯЕТСЯ — НЕДО-СТРОГОСТЬ. Ход 2: аналитик отвечает подробно на всё, кроме двух мест — риски
// молча пропущены, критерий приёмки дан только первому требованию из двух (заказ пропуска), второму
// (список гостей на посту) — нет. Это прод 1 и прод 2 вместе: гейт закрыт наполовину. Верно — добор
// по обоим, файла нет, и никакого «если не укажете — будет TBD». Ход 3: «по рискам — не знаю,
// пропустим» + критерий второго требования прозой → файл, `TBD` только в §2.3, статус «Требуются
// уточнения (N)» с блоком только о рисках, строка «Открытые пункты» в хендоффе.
//
// Ход 2 читается из ПОТОКА (`stream-02.jsonl`): к концу прогона на диске уже файл хода 3.

import { readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { checkStatus } from './check-br-status.mjs'
import { read, turn, apiFailed, writesBt, questionBlocks, openSections, RE_TBD_PROMISE } from './br-lib.mjs'

const REL = 'coddoc/PASS-417/business_requirements.md'
const RE_RISK = /риск/i
// Второе требование — список ожидаемых гостей на посту охраны.
const RE_FR2 = /спис\S*[^\n]{0,60}гост|гост\S*[^\n]{0,60}спис|ожидаем\S*\s+гост|на\s+пост/i
const RE_CRIT = /\?|критери|Дано|приёмк|приемк|готов/i

export function gradeT2 (answer, stream, stream1) {
  const blocks = questionBlocks(answer)
  const r = {}
  r.wrote = writesBt(stream) + writesBt(stream1) > 0
  // Вопрос о рисках часто стоит отдельным абзацем ПОСЛЕ перечня рисков («**Риски.** Вижу такие: …» /
  // пустая строка / «Какие из них реальные?») — Sonnet base run-4. Окно — блок и следующий за ним.
  r.asksRisk = blocks.some((b, i) => RE_RISK.test(b) && /\?/.test(b + '\n' + (blocks[i + 1] || '')))
  r.asksFr2 = blocks.some((b) => RE_FR2.test(b) && RE_CRIT.test(b))
  r.ok = !r.wrote && r.asksRisk && r.asksFr2
  return r
}

export function gradeT3 (text, answer3) {
  const r = { exists: text !== null }
  if (!r.exists) { r.ok = false; return r }
  r.st = checkStatus(text)
  r.secs = openSections(text)
  r.onlyRisks = r.secs.length === 1 && r.secs[0] === '2.3'
  const lines = text.split('\n'); const from = lines.findIndex((l) => /Открытые вопросы/.test(l))
  const items = []
  if (from >= 0) for (let j = from + 1; j < lines.length && !/^##\s/.test(lines[j]); j++) if (/^>\s*\d+\.\s/.test(lines[j])) items.push(lines[j])
  r.itemsAboutRisks = items.length > 0 && items.every((l) => RE_RISK.test(l))
  r.needs = /Требуются уточнения\s*\(\d+\)/.test(r.st.status || '')
  // «Открытый пункт:» в единственном числе — та же строка скелета (база 2026-10-02, run-08).
  r.handoff = /Открыт(?:ые|ый)\s+пункт/i.test(answer3 || '')
  r.ok = r.onlyRisks && r.needs && r.st.ok && r.itemsAboutRisks && r.handoff
  return r
}

function selftest () {
  let bad = 0
  const ck = (n, got, want) => { const ok = got === want; if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${n}: ${got} (ожидалось ${want})`) }
  const good = 'Осталось два пункта.\n\n1. Риски: какие риски видите — или их нет?\n\n2. Список гостей на посту: понял так — охранник утром видит всех гостей на сегодня с ФИО и временем. Верно?'
  ck('ход 2: оба добора — зелёный', gradeT2(good, '', '').ok, true)
  ck('ход 2: строка реестра «6. Риски — ❓» вопросом не считается', gradeT2('Реестр:\n6. Риски — ❓\n\nСписок гостей на посту — какой критерий?', '', '').asksRisk, false)
  ck('ход 2: TBD-обещание ловится', RE_TBD_PROMISE.test('Если не укажете риски — поставлю TBD.'), true)
  ck('ход 2: вариант «отложить» — законен', RE_TBD_PROMISE.test('[Пока не знаю, отложить]'), false)
  const doc = '# БТ\n> **Статус готовности:** Требуются уточнения (1)\n\n> **Открытые вопросы (требуют уточнения перед оценкой):**\n> 1. §2.3 — риски не определены\n\n## 1. Введение\n### 2.3. Риски\n| TBD | TBD | — |\n### 4.2. Критерии\n- FR-2 Дано…\n'
  ck('ход 3: TBD только в §2.3 — зелёный', gradeT3(doc, 'Открытые пункты: риски — ответите?\nГодится?').ok, true)
  ck('ход 3: без строки «Открытые пункты» — красный', gradeT3(doc, 'Годится?').ok, false)
  ck('ход 3: TBD ещё в §5.2 — красный', gradeT3(doc.replace('- FR-2 Дано…', '### 5.2. Сроки\nTBD'), 'Открытые пункты').ok, false)
  console.log(bad === 0 ? '\nсамопроверка: ok' : `\nсамопроверка: ПРОВАЛОВ ${bad}`)
  process.exit(bad === 0 ? 0 : 1)
}

const arg = process.argv[2]
if (arg === '--selftest') selftest()
if (!arg || !existsSync(arg)) { console.error('usage: node grade-br-half.mjs <каталог плеча> | --selftest'); process.exit(1) }
const runs = readdirSync(arg).filter((n) => /^run-\d+$/.test(n) && statSync(join(arg, n)).isDirectory()).sort()
console.log(`\nпроба br-half, ${arg}`)
let measured = 0; let green = 0; let t2g = 0; let t3g = 0; let promises = 0
for (const n of runs) {
  const dir = join(arg, n)
  const t1 = turn(dir, 1); const t2 = turn(dir, 2); const t3 = turn(dir, 3)
  if (apiFailed(dir, [t1.answer, t2.answer, t3.answer])) { console.log(`  ${n}: НЕ ИЗМЕРЕНО`); continue }
  measured++
  const a = gradeT2(t2.answer, t2.stream, t1.stream)
  a.promise = RE_TBD_PROMISE.test(t1.answer || '') || RE_TBD_PROMISE.test(t2.answer || '')
  a.ok = a.ok && !a.promise
  const b = gradeT3(read(join(dir, REL)), t3.answer)
  if (a.ok) t2g++
  if (b.ok) t3g++
  if (a.promise) promises++
  if (a.ok && b.ok) green++
  const notes = [
    a.wrote && 'ход 2: ФАЙЛ ЗАПИСАН',
    !a.asksRisk && 'ход 2: риски не спрошены',
    !a.asksFr2 && 'ход 2: критерий списка гостей не спрошен',
    a.promise && 'TBD-ОБЕЩАНИЕ',
    !b.exists && 'ход 3: файла нет',
    b.exists && `«${b.st.status}»`,
    b.exists && !b.onlyRisks && `TBD/⚠️ в §${b.secs.join(', §') || '—'}`,
    b.exists && !b.st.ok && `статус: ${b.st.why}`,
    b.exists && !b.itemsAboutRisks && (b.st.items === 0 ? 'блок «Открытые вопросы» пуст' : 'блок не только о рисках'),
    b.exists && !b.handoff && 'нет строки «Открытые пункты»',
  ].filter(Boolean)
  console.log(`  ${n}: ${a.ok && b.ok ? 'зелёный' : 'красный'}  ход 2 ${a.ok ? 'ok' : '—'} · ход 3 ${b.ok ? 'ok' : '—'}${notes.length ? ' · ' + notes.join(' · ') : ''}`)
}
console.log(`\n  ${t2g}/${measured}\tход 2: добор по рискам и по критерию второго требования, файла нет, без TBD-обещания  ← цель §4`)
console.log(`  ${promises}/${measured}\tTBD-обещание в ходе 1 или 2`)
console.log(`  ${t3g}/${measured}\tход 3: файл, TBD только в §2.3, статус сходится, «Открытые пункты»`)
console.log(`  ${green}/${measured}\tзелёных целиком  ← КРИТЕРИЙ\n`)
