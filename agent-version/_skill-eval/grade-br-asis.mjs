#!/usr/bin/env node
// grade-br-asis.mjs — пробы гейта 16 «Как сейчас» (скилл: business-requirements-doc 1.2.0),
// PLAN-BR-SECTIONS §1.1, батч B.
//
//   node grade-br-asis.mjs <каталог плеча> --case=card|new
//   node grade-br-asis.mjs --selftest
//
// ЧТО МЕРЯЕТСЯ.
//   card — доработка, карточки BR-REAL. Бриф (REP-304: «убрать ошибочную работу из отправленного акта») не называет
//          текущего правила; оно есть только в «Бизнес-правилах» карточки: акт можно отозвать, пока
//          заказчик его не рассмотрел, после рассмотрения он неизменен. Ход 1: вопросы, файла нет,
//          гипотеза «как сейчас» несёт это правило. Ход 2 («как сейчас — как в карточке»): §1.4 есть,
//          несёт правило, и не повторяет §4.1 (§4.1 — как пойдёт после изменения).
//   new  — новый функционал без окружения (OFC-55, бюро находок). Ход 1: ни одной ссылки на карточки
//          или код, которых нет. Ход 2 («сейчас никак — вещи оставляют на ресепшене»): §1.4 есть,
//          говорит, что учёта нет, и не повторяет §4.1.
//
// Критерии названы до прогонов (PLAN-BR-SECTIONS §1.0: N = 3, провал новой пробы → разбор).

import { readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { read, turn, apiFailed, writesBt, section, sectionByTitle, askedBlocks, dropNegated } from './br-lib.mjs'

const CASES = {
  card: { rel: 'coddoc/REP-304/business_requirements.md' },
  new: { rel: 'coddoc/OFC-55/business_requirements.md' },
}
// Правило из «Бизнес-правил» карточки (`WorkAcceptance`): отзыв до рассмотрения, после — неизменен.
export const RE_ANCHOR = /((отозв|отзыв)\p{L}*[^\n]{0,120}(пока|до\s+того|не\s+рассмотр|до\s+(его\s+)?рассмотр|до\s+решени|не\s+вын[её]с)|(рассмотр|решени)\p{L}*[^\n]{0,100}(неизмен|нельзя\s+(изменить|отозвать|поправить|исправить)|не\s+меня))/iu
export const RE_FAKE_SRC = /(services\/|карточк\p{L}*\s+(сервис|сервера)|в\s+карточке|по\s+коду|из\s+кода)/iu
const RE_NONE = /(никак|уч[её]т\p{L}*\s+(нет|не\s+вед)|не\s+уч[иі]тыва|не\s+ведётся|не\s+ведется|оставляют\s+на\s+ресепшен|не\s+делает)/iu

const clean = (s) => (s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N} .;\n]/gu, ' ')
const words = (s) => s.split(/\s+/).filter((w) => w.length >= 4)
const sentences = (s) => clean(s).split(/[.;\n]+/).map((x) => words(x)).filter((x) => x.length >= 4)
/** Доля предложений §1.4 (≥ 4 значимых слов), у которых ≥ 80 % слов стоят и в §4.1, — пересказ, а не только дословный повтор. */
export function overlap (s14, s41) {
  const a = sentences(s14); const b = new Set(words(clean(s41).replace(/[.;\n]/g, ' ')))
  if (!a.length) return 0
  return a.filter((ws) => ws.filter((w) => b.has(w)).length / ws.length >= 0.8).length / a.length
}

export function gradeT1 (cs, answer, stream) {
  const r = { wrote: writesBt(stream) > 0 }
  if (cs === 'card') r.anchor = RE_ANCHOR.test(answer || '')
  if (cs === 'new') r.fake = RE_FAKE_SRC.test(dropNegated(askedBlocks(answer)))
  r.ok = !r.wrote && (cs === 'card' ? r.anchor : !r.fake)
  return r
}

export function gradeDoc (cs, text) {
  const r = { exists: text !== null }
  if (!r.exists) { r.ok = false; return r }
  const sec = sectionByTitle(text, /как\s+сейчас/i); const s14 = sec ? sec.body : null; r.num = sec ? sec.num : null
  const s41 = section(text, '4.1') || (sectionByTitle(text, /описание\s+функционал/i) || {}).body || ''
  r.has14 = !!s14
  if (!r.has14) { r.ok = false; return r }
  r.content = cs === 'card' ? /(отозв|отзыв|рассмотр)/i.test(s14) : RE_NONE.test(s14)
  r.overlap = overlap(s14, s41)
  r.dup = r.overlap > 0.5
  r.ok = r.content && !r.dup
  return r
}

function selftest () {
  let bad = 0
  const ck = (n, got, want) => { const ok = got === want; if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${n}: ${got} (ожидалось ${want})`) }
  ck('T1 card: гипотеза из карточки — зелёный', gradeT1('card', 'Как сейчас — понял так по карточке: прораб может отозвать акт, пока заказчик его не рассмотрел; после рассмотрения акт неизменен. Верно?', '').ok, true)
  ck('T1 card: «отзыв возможен до решения заказчика» — зелёный', gradeT1('card', 'Как сейчас: отзыв акта возможен до решения заказчика, после решения акт не меняется. Верно?', '').ok, true)
  ck('T1 card: без правила карточки — красный', gradeT1('card', 'Как сейчас устроено исправление акта?', '').ok, false)
  ck('T1 new: ссылка «в карточке» без окружения — красный', gradeT1('new', 'В карточке вижу, что вещи сейчас учитываются в журнале — верно?', '').ok, false)
  ck('T1 new: «окружение (services/, context/) не найдено» — зелёный', gradeT1('new', 'Окружение (services/, context/) не найдено — работаю от брифа.\n\nКак сейчас — понял так: учёта нет. Верно?', '').ok, true)
  ck('T1 new: без ссылок — зелёный', gradeT1('new', 'Как сейчас — понял так: учёта нет, вещи оставляют на ресепшене. Верно?', '').ok, true)
  const doc = (s14, s41) => `# БТ\n\n### 1.3. Заказчик\nX\n\n### 1.4. Как сейчас\n${s14}\n\n## 2. Цели\n\n### 4.1. Описание функционала\n${s41}\n\n### 4.2. Критерии\n…\n`
  const after = '- **FR-1.** Прораб убирает ошибочную работу из отправленного акта до решения заказчика.'
  ck('T2 card: §1.4 с правилом — зелёный', gradeDoc('card', doc('Прораб может отозвать акт, пока заказчик его не рассмотрел; после рассмотрения акт неизменен.', after)).ok, true)
  ck('T2 card: §1.4 нет — красный', gradeDoc('card', '# БТ\n### 4.1. Описание\n' + after).ok, false)
  ck('T2 card: §1.4 повторяет §4.1 — красный', gradeDoc('card', doc('Прораб убирает ошибочную работу из отправленного акта до решения заказчика и отзывает его.', after)).ok, false)
  ck('T2 new: «сейчас никак, учёта нет» — зелёный', gradeDoc('new', doc('Сейчас никак: найденные вещи оставляют на ресепшене, учёта нет.', '- **FR-1.** Сотрудник регистрирует найденную вещь.')).ok, true)
  ck('T2 new: «учёта нет» без «никак» — зелёный', gradeDoc('new', doc('Найденные вещи сейчас оставляют у охраны, учёта нет.', '- **FR-1.** Сотрудник регистрирует найденную вещь.')).ok, true)
  ck('T1 new: «по карточке сервиса» — красный', gradeT1('new', 'По карточке сервиса вижу журнал находок — верно?', '').ok, false)
  ck('T2 new: выдуманный процесс без «никак» — красный', gradeDoc('new', doc('Сотрудник заполняет бумажный журнал находок у охраны.', '- **FR-1.** Сотрудник регистрирует найденную вещь.')).ok, false)
  console.log(bad === 0 ? '\nсамопроверка: ok' : `\nсамопроверка: ПРОВАЛОВ ${bad}`)
  process.exit(bad === 0 ? 0 : 1)
}

const arg = process.argv[2]
if (arg === '--selftest') selftest()
const cs = (process.argv.find((a) => a.startsWith('--case=')) || '').slice(7)
if (!arg || !existsSync(arg) || !CASES[cs]) { console.error('usage: node grade-br-asis.mjs <каталог плеча> --case=card|new | --selftest'); process.exit(1) }
const runs = readdirSync(arg).filter((n) => /^run-\d+$/.test(n) && statSync(join(arg, n)).isDirectory()).sort()
console.log(`\nпроба br-asis-${cs}, ${arg}`)
let measured = 0; let green = 0
for (const n of runs) {
  const dir = join(arg, n)
  const t1 = turn(dir, 1); const t2 = turn(dir, 2)
  if (apiFailed(dir, [t1.answer, t2.answer])) { console.log(`  ${n}: НЕ ИЗМЕРЕНО`); continue }
  measured++
  const a = gradeT1(cs, t1.answer, t1.stream)
  const b = gradeDoc(cs, read(join(dir, CASES[cs].rel)))
  const ok = a.ok && b.ok
  if (ok) green++
  const notes = [
    a.wrote && 'ход 1: ФАЙЛ ЗАПИСАН', a.anchor === false && 'ход 1: нет правила карточки в гипотезе', a.fake && 'ход 1: ссылка на несуществующий источник',
    !b.exists && 'файла нет', b.exists && !b.has14 && 'раздела «Как сейчас» нет', b.num && b.num !== '1.4' && `«Как сейчас» под номером ${b.num}`, b.content === false && '§1.4: не то содержание',
    b.dup && `§1.4 повторяет §4.1 (${Math.round(b.overlap * 100)} %)`,
  ].filter(Boolean)
  console.log(`  ${n}: ${ok ? 'зелёный' : 'красный'}${notes.length ? ' · ' + notes.join(' · ') : ''}`)
}
console.log(`\n  ${green}/${measured}\tзелёных  ← КРИТЕРИЙ (N = 3: провал → разбор)\n`)
