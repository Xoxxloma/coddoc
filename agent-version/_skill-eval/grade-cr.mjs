#!/usr/bin/env node
// grade-cr.mjs — пробы скилла `change-request-doc` (запрос на мелкую правку, фикстура CR-SMALL).
//
//   node grade-cr.mjs <каталог с песочницами> --probe=btn-w|api-w|btn-q|notsmall-q|idea-q|bug-q
//   node grade-cr.mjs --selftest
//
// ЧТО ГРЕЙДИТСЯ. На плечах `-w` — файл `coddoc/<КЛЮЧ>/change_request.md` на диске, а не формулировка
// отчёта. На плечах `-q` файла быть не должно, и мерится `answer.md`: сторож — разбор по пяти
// строкам, вердикт, форма стопа.
//
// ПОЧЕМУ СЧЁТЧИКИ РАЗНЕСЕНЫ. У сторожа на `notsmall-q` два провала противоположны: жёсткий отказ
// (решил за аналитика) и молчаливый файл (проехал порог). Сложенные в один процент, они гасят друг
// друга. То же на `-w`: `🟢` на устном решении и `🔵` без имени — два разных дефекта одной пометки.
//
// ПРАВИЛА, ИЗ-ЗА КОТОРЫХ ОН НАПИСАН ИМЕННО ТАК (унаследованы от grade-bg.mjs):
//   - регулярки ЛИТЕРАЛЬНЫЕ и из строк не собираются;
//   - `\b` и `\w` рядом с кириллицей не применять — граница слова по кириллице не срабатывает;
//     диапазон писать явно `[а-яё]`;
//   - шапка разбирается ПОСТРОЧНО: слово `source` в теле шапкой не является;
//   - отказ API и побег из песочницы — «НЕ ИЗМЕРЕНО», а не «провалено»;
//   - счётчик на каждый дефект, общего процента нет.

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

const PROBES = ['btn-w', 'api-w', 'btn-q', 'notsmall-q', 'idea-q', 'bug-q']

/** Ключ, который прогон обязан взять из сообщения аналитика. */
const KEY_OF = {
  'btn-w': 'ARS-320',
  'api-w': 'ARS-321',
  'btn-q': 'ARS-320',
  'notsmall-q': 'ARS-322',
  'idea-q': 'ARS-323',
  'bug-q': 'ARS-324',
}

/** Файлы стенда: их создаёт раннер, они не результат работы скилла. */
const HARNESS = new Set(['answer.md', 'stream.jsonl', '_seeded.txt', '_stderr.log', '_api-failure.txt', '_escaped.txt', '_STOP'])

const RE_API_FAILURE = /API Error|Request not allowed|Please run \/login|Credit balance|rate limit|session limit|usage limit/i

/** Настоящий отказ CLI — короткий вывод с маркером в начале, а не слово внутри документа. */
export function isApiFailure (text) {
  if (!text) return true
  if (text.length > 600) return false
  return RE_API_FAILURE.test(text.slice(0, 300))
}

// ─── Разбор документа ───────────────────────────────────────────────────────────────────────

/** Шапка построчно. Возвращает {} если файл не начинается с `---`. */
export function parseFrontmatter (text) {
  const lines = text.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return {}
  const out = {}
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') break
    const m = /^([a-zA-Z_]+):\s*(.*)$/.exec(lines[i])
    if (m) out[m[1]] = m[2].trim()
  }
  return out
}

/** Тело раздела `## N. …` до следующего `## `. */
export function section (text, num) {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((l) => l.startsWith(`## ${num}.`))
  if (start === -1) return ''
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((l) => l.startsWith('## '))
  return (end === -1 ? rest : rest.slice(0, end)).join('\n')
}

/** Тело раздела по заголовку без номера (`## Что рядом остаётся прежним`, `## Открытые вопросы`). */
export function namedSection (text, re) {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((l) => /^## /.test(l) && re.test(l))
  if (start === -1) return null
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((l) => l.startsWith('## '))
  return (end === -1 ? rest : rest.slice(0, end)).join('\n')
}

/** Пункты блока открытых вопросов: строки-буллеты. «Не осталось.» пунктом не является. */
export function countOpenItems (block) {
  if (block === null) return null
  return block.split(/\r?\n/).filter((l) => /^\s*[-*]\s+\S/.test(l)).length
}

const TOUCH_ROWS = ['Контракт', 'Данные', 'Интерфейс', 'Зависимость', 'Конфигурация']

/**
 * Таблица «Что тронуто»: для каждой из пяти строк — `true` (да), `false` (нет), `null` (строки нет
 * или отметки не разобрать). Ищется строка таблицы, чья первая ячейка начинается с имени строки;
 * отметка — вторая ячейка. «да»/«нет» в любом регистре; ✅/❌ тоже принимаются — это раскладка, а
 * не содержание.
 */
export function touchedRows (s2) {
  const out = {}
  const lines = s2.split(/\r?\n/)
  for (const name of TOUCH_ROWS) {
    const re = new RegExp('^\\s*\\|\\s*\\**' + name + '\\**\\s*\\|\\s*([^|]*)\\|', 'i')
    const line = lines.find((l) => re.test(l))
    if (!line) { out[name] = null; continue }
    const cell = re.exec(line)[1].trim().toLowerCase()
    if (/^(да|yes|✅|тронут[ао]?)/.test(cell)) out[name] = true
    else if (/^(нет|no|❌|не тронут[ао]?|—|-)/.test(cell)) out[name] = false
    else out[name] = null
  }
  return out
}

const RE_STATUS_OK = /Статус готовности:\*{0,2}\s*(Готово к оценке|Требуются уточнения \(\d+\))/
const RE_STATUS_SPEC_VOCAB = /Статус готовности:\*{0,2}\s*Готово к разработке/
const RE_FR = /FR-\d+/
const RE_GREEN = /🟢/
const RE_BLUE = /🔵/
const RE_ARS102 = /ARS-102/
const RE_SOURCE_ANALYST = /решение аналитика|со слов аналитика|документа нет|документ отсутствует/i
/** `🔵` с именем или ролью решившего: после «решение аналитика» идёт двоеточие и непустой текст. */
const RE_BLUE_WITH_WHO = /🔵[^\n]*решени[ея] аналитика\s*[:—-]\s*[А-ЯЁа-яё]/
const RE_VERDICT_SMALL = /Вердикт:[^\n]*(мелкая правка|одна поставка|один деливербл)/i
const RE_VERDICT_OVER = /выше порога/i
/** Проектирование и достройка объёма в файле запроса. */
// `\b` рядом с кириллицей не работает (см. шапку) — границы слова написаны явно.
const RE_DESIGN = /\b(GET|POST|PUT|PATCH|DELETE)\s+\/|```json|миграци[яи]|план отката|(^|[^а-яё])заодно([^а-яё]|$)|логично добавить/i
const RE_NOTHING = /^\s*(ничего|нет|не применимо|—|-)\.?\s*$/i

/**
 * НАСТОЯЩАЯ просьба назвать ключ, а не строка реестра гейтов. Анкер обязан различать вопрос и
 * запись «Ключ задачи (ARS-320) — ✅».
 */
const RE_ASKS_KEY = /(укажите|назовите|пришлите|сообщите|дайте|нужен|требуется|не передан|не указан)[^.\n]{0,40}ключ|ключ[^.\n]{0,40}(не передан|не указан|❓)/i

// ─── Анкеры сторожа (плечи -q) ─────────────────────────────────────────────────────────────

const RE_ROW_NAMES = /контракт|данны[ех]|интерфейс|зависимост|конфигураци/gi
/** Разбор по строкам: названо не меньше четырёх из пяти имён строк. */
function namesRows (answer) {
  const found = new Set((answer.match(RE_ROW_NAMES) || []).map((w) => w.toLowerCase().slice(0, 5)))
  return found.size >= 4
}
const RE_VERDICT_PRAVKA = /(это|—|:)\s*(мелкая\s+)?правка|мелкая правка|одна поставка|один деливербл/i
const RE_OVER_THRESHOLD = /выше порога|три строки|3 строки|уже (похоже на )?доработк|не мелкая|перестала быть мелкой|четыре строки/i
const RE_ASKS_ROUTE = /(правк[аой][^.?\n]{0,60}(бизнес-требован|БТ)|(бизнес-требован|БТ)[^.?\n]{0,60}правк[аой])[^?\n]{0,60}\?/i
const RE_HARD_REFUSAL = /(не пишу|не буду писать|не могу записать|файл(а)? не пишу|это не правка)[^?\n]{0,120}(бизнес-требован|БТ)/i
const RE_ASKS_SMALL = /(это|правда|точно)[^?\n]{0,20}мелкая[^?\n]{0,30}\?/i
const RE_ASKS_CRIT = /критичн|срочн|хотфикс/i
const RE_ASKS_VERIFY = /как провер|чем провер|как прим(ут|ете)|приёмк/i
const RE_ASKS_PROCESS = /бизнес-процесс|какой процесс|на каком экране|экран|роут/i
const RE_ASKS_STAYS = /остаётся прежним|остаться прежним|должно остаться|не должно измениться|рядом/i
const RE_ASKS_UNTOUCHED = /миграци|версия библиотек|поднять версию|лимит|таймаут/i
const RE_SAYS_IDEA = /(нет|не названо|отсутствует|не принято)[^.\n]{0,40}(решени|«как должно стать»|как должно стать)|(это|описан[ао]?)[^.\n]{0,20}(идея|пожелание)|решени[ея] ещё (нет|искать)/i
const RE_NAMES_BT = /бизнес-требован|business-requirements-doc|(^|[^А-ЯЁа-яё])БТ([^А-ЯЁа-яё]|$)/
const RE_SAYS_BUG = /дефект|сломан|не работает как задуман|баг(?!-репорт)/i
const RE_NAMES_BUGREPORT = /баг-репорт|bug-report-doc|bug_report/i
const RE_INVENTED_AFTER = /как должно стать[^\n]{0,20}:[^\n]{10,}/i

// ─── Разбор одного прогона ──────────────────────────────────────────────────────────────────

function listFiles (dir, base = '') {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue
    const rel = base ? `${base}/${e.name}` : e.name
    if (e.isDirectory()) out.push(...listFiles(join(dir, e.name), rel))
    else out.push(rel)
  }
  return out
}

export function gradeRun (dir, probe) {
  const r = { dir, probe, measured: true, why: '' }
  const answerPath = join(dir, 'answer.md')
  const answer = existsSync(answerPath) ? readFileSync(answerPath, 'utf8') : ''

  if (existsSync(join(dir, '_escaped.txt'))) { r.measured = false; r.why = 'побег из песочницы'; return r }
  if (isApiFailure(answer)) { r.measured = false; r.why = 'отказ API'; return r }

  const files = listFiles(dir).filter((f) => !HARNESS.has(f))
  r.requests = files.filter((f) => /(^|\/)change_request\.md$/.test(f))
  // Фикстура кладёт свои документы в coddoc/ARS-102/ — они не результат работы прогона.
  r.extraDocs = files.filter((f) => /(business_requirements|technical_specification|decomposition|bug_report)\.md$/.test(f) && !f.includes('ARS-102'))
  r.stages = files.filter((f) => /(^|\/)stages\//.test(f))
  r.wrote = r.requests.length > 0

  const key = KEY_OF[probe]
  r.expectedKey = key
  r.pathOk = r.requests.some((f) => f === `coddoc/${key}/change_request.md`)
  // Фантом — ЗАЯВЛЕНИЕ о записи, а не упоминание имени: на жёстком стопе агент законно говорит
  // «это не документ change_request.md» (пилот 2026-09-14, bug-q — первая редакция краснела 2/2).
  r.phantom = !r.wrote && /(записал|записан|создал|создан|сохранил|сохранён|положил)[^\n]{0,80}change_request\.md|change_request\.md[^\n]{0,40}(записан|создан|сохранён|готов)/i.test(answer)
  r.answer = answer

  if (r.wrote) {
    const text = readFileSync(join(dir, r.requests[0]), 'utf8')
    r.text = text
    const fm = parseFrontmatter(text)
    r.fmType = fm.type === 'change-request'
    r.fmTask = fm.task === key
    r.source = fm.source ?? ''
    r.sourceIsAnalyst = RE_SOURCE_ANALYST.test(r.source)

    r.statusOk = RE_STATUS_OK.test(text)
    r.statusSpecVocab = RE_STATUS_SPEC_VOCAB.test(text)
    const declared = /Требуются уточнения \((\d+)\)/.exec(text)
    const items = countOpenItems(namedSection(text, /Открытые вопросы/))
    r.openItems = items
    r.statusCounts = declared ? items === Number(declared[1]) : items === 0

    const s = [1, 2, 3, 4, 5, 6].map((n) => section(text, n))
    r.sectionsPresent = s.every((x) => x.trim().length > 0)
    const s2 = s[1], s4 = s[3]
    r.rows = touchedRows(s2)
    r.rowsComplete = TOUCH_ROWS.every((n) => r.rows[n] !== null)
    r.rowsYes = TOUCH_ROWS.filter((n) => r.rows[n] === true)
    r.verdictSmall = RE_VERDICT_SMALL.test(s2)
    r.verdictOver = RE_VERDICT_OVER.test(s2)
    r.hasFR = RE_FR.test(s4)
    r.green = RE_GREEN.test(s4)
    r.blue = RE_BLUE.test(s4)
    r.blueWithWho = RE_BLUE_WITH_WHO.test(s4)
    r.marked = r.green || r.blue
    r.mentionsARS102 = RE_ARS102.test(s4) || RE_ARS102.test(r.source)
    const stays = namedSection(text, /рядом остаётся прежним|рядом остается прежним/)
    r.staysPresent = stays !== null && stays.trim().length > 0 && !RE_NOTHING.test(stays.trim())
    r.design = RE_DESIGN.test(text)
    r.mentionsManual = /инструкци/i.test(text)
  } else {
    r.reasksKey = RE_ASKS_KEY.test(answer)
    r.namesRows = namesRows(answer)
    r.verdictPravka = RE_VERDICT_PRAVKA.test(answer)
    r.overThreshold = RE_OVER_THRESHOLD.test(answer)
    r.asksRoute = RE_ASKS_ROUTE.test(answer)
    r.hardRefusal = RE_HARD_REFUSAL.test(answer)
    r.asksSmall = RE_ASKS_SMALL.test(answer)
    r.asksCrit = RE_ASKS_CRIT.test(answer)
    r.asksVerify = RE_ASKS_VERIFY.test(answer)
    r.asksProcess = RE_ASKS_PROCESS.test(answer)
    r.asksStays = RE_ASKS_STAYS.test(answer)
    // Только ВОПРОСЫ: перечень нетронутых строк («Конфигурация (флаг, лимит)») сам содержит эти
    // слова, и первая редакция анкера краснела на верном разборе (пилот 2026-09-14, btn-q run-1).
    r.asksUntouched = answer.split(/\r?\n/).some((l) => /\?/.test(l) && RE_ASKS_UNTOUCHED.test(l))
    r.saysIdea = RE_SAYS_IDEA.test(answer)
    r.namesBT = RE_NAMES_BT.test(answer)
    r.saysBug = RE_SAYS_BUG.test(answer)
    r.namesBugReport = RE_NAMES_BUGREPORT.test(answer)
    r.inventedAfter = RE_INVENTED_AFTER.test(answer)
  }
  return r
}

// ─── Плечи ──────────────────────────────────────────────────────────────────────────────────

/** Зелёный исход плеча. Один предикат — одно определение «верно», без частичных баллов. */
export function isPass (r) {
  if (!r.measured) return false
  const fileBase = () => r.wrote && r.pathOk && r.fmType && r.fmTask && r.statusOk && !r.statusSpecVocab &&
    r.statusCounts && r.sectionsPresent && r.rowsComplete && r.verdictSmall && !r.verdictOver &&
    r.hasFR && r.blue && r.blueWithWho && !r.green && r.sourceIsAnalyst && !r.mentionsARS102 &&
    r.staysPresent && !r.design && r.extraDocs.length === 0
  switch (r.probe) {
    case 'btn-w':
      return fileBase() && r.rowsYes.length === 1 && r.rows['Интерфейс'] === true
    case 'api-w':
      return fileBase() && r.rows['Контракт'] === true && r.rows['Интерфейс'] === true &&
        r.rows['Данные'] === false && r.rowsYes.length === 2
    case 'btn-q':
      return !r.wrote && !r.phantom && !r.reasksKey && r.namesRows && r.verdictPravka &&
        !r.overThreshold && !r.asksSmall && r.asksVerify && r.asksCrit
    case 'notsmall-q':
      return !r.wrote && !r.phantom && r.namesRows && r.overThreshold && r.asksRoute && !r.hardRefusal
    case 'idea-q':
      return !r.wrote && !r.phantom && r.saysIdea && r.namesBT && !r.asksCrit && !r.inventedAfter
    case 'bug-q':
      return !r.wrote && !r.phantom && r.saysBug && r.namesBugReport && !r.asksCrit
    default:
      return false
  }
}

// ─── Самопроверка ───────────────────────────────────────────────────────────────────────────
// Валидируется до прогонов: грейдер, который никто не проверил на известном результате, мерит
// сам себя. Эталон ниже — не образец документа, а вход, чей вердикт известен заранее.

const REF_BTN_OK = `---
type: change-request
task: ARS-320
source: документа нет — решение аналитика
---

# Запрос на правку: переименование кнопки на форме паспорта

> **Статус готовности:** Готово к оценке
> **Задача:** ARS-320

## 1. Затронутый бизнес-процесс
Инспектор заполняет паспорт объекта и отправляет на согласование. Экран /passports/:id, кнопка внизу формы.

## 2. Что тронуто
| Строка | Тронута | Как сейчас → как должно стать |
|---|---|---|
| Контракт | нет | — |
| Данные | нет | — |
| Интерфейс | да | кнопка «Сохранить» → «Отправить на согласование» |
| Зависимость | нет | — |
| Конфигурация | нет | — |

Вердикт: мелкая правка, одна поставка.

## 3. Как сейчас
Кнопка называется «Сохранить», по нажатию паспорт уходит на согласование.

## 4. Как должно стать
- **FR-1:** кнопка внизу формы паспорта называется «Отправить на согласование», поведение по нажатию прежнее — 🔵 решение аналитика: аналитик и руководитель инспекции

## 5. Как проверят, что сделано
Открыть /passports/:id: внизу формы кнопка «Отправить на согласование», по нажатию паспорт уходит на согласование.

## 6. Критичность и срочность
Низкая. Общий релиз.

## Что рядом остаётся прежним
Текст письма-уведомления о согласовании не меняется. Черновик по-прежнему сохраняется автоматически.

## Открытые вопросы
Не осталось.
`

const REF_BTN_BAD = REF_BTN_OK
  .replace('source: документа нет — решение аналитика', 'source: coddoc/ARS-102/technical_specification.md')
  .replace('🔵 решение аналитика: аналитик и руководитель инспекции', '🟢 coddoc/ARS-102/technical_specification.md §4.1')
  .replace('Готово к оценке', 'Готово к разработке')
  .replace('| Данные | нет | — |', '')
  .replace('Текст письма-уведомления о согласовании не меняется. Черновик по-прежнему сохраняется автоматически.', 'Ничего.')

const REF_Q_SOFT = `Понял так: тронуты три строки — данные (у инцидента появляется признак «повторный»), контракт (признак отдаётся в ответе списка и карточки) и интерфейс (фильтр на /incidents). Зависимости и конфигурацию не трогаем.

Это выше порога: три строки из пяти плюс проставление старым инцидентам. Такое дешевле вести через бизнес-требования — там появятся потребители признака и приёмка по процессу.

Идём как правка или разворачиваемся в БТ?`

const REF_Q_HARD = `Тронуты данные, контракт и интерфейс — это не правка, а доработка. Файл не пишу: идите через бизнес-требования.`

const REF_Q_PRAVKA = `Понял так: трогаем интерфейс (текст кнопки «Сохранить» → «Отправить на согласование»). Контракт, данные, зависимости и конфигурацию не трогаем. Это мелкая правка, один деливербл.

Реестр гейтов:
0. Ключ задачи (ARS-320) — ✅
С. Сторож: тронута 1 строка, вердикт — ✅ правка
1. Затронутый бизнес-процесс — ❓
…
❓ осталось: 5

Вопросы:
- Процесс: инспектор отправляет паспорт на согласование, экран /passports/:id — верно?
- Как проверят, что сделано: открыть форму и увидеть новую надпись?
- Критичность и срочность: общий релиз?
- Что рядом должно остаться прежним: письмо-уведомление, автосохранение?`

function selftest () {
  let bad = 0
  const check = (name, got, want) => {
    const ok = got === want
    if (!ok) bad++
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}: ${got} (ожидалось ${want})`)
  }

  const fm = parseFrontmatter(REF_BTN_OK)
  check('шапка: type', fm.type, 'change-request')
  check('шапка: task', fm.task, 'ARS-320')
  check('шапка: слово source из тела не подхвачено', Object.keys(fm).length, 3)

  const s2 = section(REF_BTN_OK, 2)
  const rows = touchedRows(s2)
  check('таблица: пять строк разобраны', TOUCH_ROWS.every((n) => rows[n] !== null), true)
  check('таблица: интерфейс — да', rows['Интерфейс'], true)
  check('таблица: контракт — нет', rows['Контракт'], false)
  check('таблица: ровно одно «да»', TOUCH_ROWS.filter((n) => rows[n] === true).length, 1)
  check('вердикт «мелкая правка» найден', RE_VERDICT_SMALL.test(s2), true)
  check('дырявый: строка «Данные» потеряна', touchedRows(section(REF_BTN_BAD, 2))['Данные'], null)

  const s4ok = section(REF_BTN_OK, 4)
  const s4bad = section(REF_BTN_BAD, 4)
  check('FR-* найден', RE_FR.test(s4ok), true)
  check('верный: 🔵 стоит', RE_BLUE.test(s4ok), true)
  check('верный: 🔵 с именем решившего', RE_BLUE_WITH_WHO.test(s4ok), true)
  check('верный: 🟢 не стоит', RE_GREEN.test(s4ok), false)
  check('верный: чужой документ не назван', RE_ARS102.test(s4ok), false)
  check('дырявый: 🟢 на устном решении пойман', RE_GREEN.test(s4bad), true)
  check('дырявый: чужой документ пойман', RE_ARS102.test(s4bad), true)
  check('🔵 без имени не считается', RE_BLUE_WITH_WHO.test('- **FR-1:** … — 🔵 решение аналитика'), false)

  const staysOk = namedSection(REF_BTN_OK, /рядом остаётся прежним/)
  check('границы: раздел найден и непуст', staysOk !== null && !RE_NOTHING.test(staysOk.trim()), true)
  const staysBad = namedSection(REF_BTN_BAD, /рядом остаётся прежним/)
  check('границы: «Ничего.» поймано', RE_NOTHING.test(staysBad.trim()), true)

  check('пунктов в открытых вопросах', countOpenItems(namedSection(REF_BTN_OK, /Открытые вопросы/)), 0)
  check('статус в словаре бизнес-документа', RE_STATUS_OK.test(REF_BTN_OK), true)
  check('словарь спеки пойман на дырявом', RE_STATUS_SPEC_VOCAB.test(REF_BTN_BAD), true)
  check('проектирования в верном нет', RE_DESIGN.test(REF_BTN_OK), false)
  check('проектирование поймано', RE_DESIGN.test('Контракт: GET /incidents отдаёт closedAt'), true)
  check('«заодно» поймано', RE_DESIGN.test('заодно проставить старым'), true)

  check('сторож: имена строк названы (мягкий)', namesRows(REF_Q_SOFT), true)
  check('сторож: выше порога (мягкий)', RE_OVER_THRESHOLD.test(REF_Q_SOFT), true)
  check('сторож: вопрос «правка или БТ» (мягкий)', RE_ASKS_ROUTE.test(REF_Q_SOFT), true)
  check('сторож: жёсткого отказа в мягком нет', RE_HARD_REFUSAL.test(REF_Q_SOFT), false)
  check('сторож: жёсткий отказ пойман', RE_HARD_REFUSAL.test(REF_Q_HARD), true)
  check('сторож: в жёстком отказе вопроса нет', RE_ASKS_ROUTE.test(REF_Q_HARD), false)
  check('сторож: вердикт «правка» на btn-q', RE_VERDICT_PRAVKA.test(REF_Q_PRAVKA), true)
  check('сторож: на btn-q порог не назван', RE_OVER_THRESHOLD.test(REF_Q_PRAVKA), false)
  check('сторож: строка реестра не считается переспросом ключа', RE_ASKS_KEY.test(REF_Q_PRAVKA), false)
  check('сторож: вопрос «а это мелкая?» пойман', RE_ASKS_SMALL.test('Это точно мелкая правка?'), true)
  check('сторож: «как проверят» найден', RE_ASKS_VERIFY.test(REF_Q_PRAVKA), true)
  check('идея: распознана', RE_SAYS_IDEA.test('Здесь нет решения — «как должно стать» не названо, это пожелание. Штатный путь — бизнес-требования.'), true)
  check('дефект: распознан', RE_SAYS_BUG.test('Это дефект: кнопка должна сохранять, а не сохраняет.') && RE_NAMES_BUGREPORT.test('путь — баг-репорт'), true)

  check('отказ API: короткий маркер', isApiFailure('API Error: Request not allowed'), true)
  check('отказ API: слово внутри документа не отказ', isApiFailure('x'.repeat(700) + ' rate limit'), false)

  console.log(bad === 0 ? '\nсамопроверка: ok' : `\nсамопроверка: ПРОВАЛОВ ${bad}`)
  return bad === 0
}

// ─── Точка входа ────────────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
if (argv.includes('--selftest')) process.exit(selftest() ? 0 : 1)

const root = argv.find((a) => !a.startsWith('--'))
const probeArg = argv.find((a) => a.startsWith('--probe='))
const PROBE = probeArg ? probeArg.slice('--probe='.length) : ''

if (!root || !PROBES.includes(PROBE)) {
  console.error(`usage: node grade-cr.mjs <каталог> --probe=${PROBES.join('|')}`)
  console.error('       node grade-cr.mjs --selftest')
  process.exit(1)
}
if (!existsSync(root)) { console.error(`нет каталога: ${root}`); process.exit(1) }

const runs = readdirSync(root, { withFileTypes: true })
  .filter((e) => e.isDirectory() && /^run-\d+$/.test(e.name))
  .map((e) => join(root, e.name))
  .filter((d) => statSync(d).isDirectory())
  .sort()

if (runs.length === 0) { console.error(`в ${root} нет папок run-NN`); process.exit(1) }

const all = runs.map((d) => gradeRun(d, PROBE))
const measured = all.filter((r) => r.measured)
const N = measured.length

const c = (f) => measured.filter(f).length
const pct = (n) => `${String(n).padStart(2)}/${N}`

console.log(`\nпроба ${PROBE}, ${root}`)
console.log(`прогонов: ${all.length}, измерено: ${N}, не измерено: ${all.length - N}`)
for (const r of all.filter((x) => !x.measured)) console.log(`  НЕ ИЗМЕРЕНО ${r.dir}: ${r.why}`)
console.log('')

if (PROBE === 'btn-w' || PROBE === 'api-w') {
  console.log(`  ${pct(c((r) => !r.wrote))}\tФАЙЛА НЕТ`)
  console.log(`  ${pct(c((r) => r.phantom))}\t  из них ФАНТОМ: в отчёте файл назван`)
  console.log(`  ${pct(c((r) => r.wrote && !r.pathOk))}\tфайл не по пути coddoc/<КЛЮЧ>/change_request.md`)
  console.log(`  ${pct(c((r) => r.wrote && !r.rowsComplete))}\tТАБЛИЦА «ЧТО ТРОНУТО» НЕПОЛНА: нет строки или отметки  ← КРИТЕРИЙ`)
  if (PROBE === 'btn-w') console.log(`  ${pct(c((r) => r.wrote && r.rowsComplete && r.rowsYes.length !== 1))}\tтронуто не одна строка (ожидался только интерфейс)`)
  if (PROBE === 'api-w') {
    console.log(`  ${pct(c((r) => r.wrote && r.rowsComplete && !(r.rows['Контракт'] && r.rows['Интерфейс'])))}\tконтракт или интерфейс не помечены «да»`)
    console.log(`  ${pct(c((r) => r.wrote && r.rowsComplete && r.rows['Данные'] === true))}\tДАННЫЕ ПОМЕЧЕНЫ «ДА», хотя поле уже хранится  ← КРИТЕРИЙ`)
    console.log(`  ${pct(c((r) => r.wrote && r.verdictOver))}\t«ВЫШЕ ПОРОГА» НА ДВУХ СТРОКАХ: сторож перестраховался  ← КРИТЕРИЙ`)
  }
  console.log(`  ${pct(c((r) => r.wrote && !r.verdictSmall))}\tстроки «Вердикт: мелкая правка» нет`)
  console.log(`  ${pct(c((r) => r.wrote && !r.marked))}\tПОМЕТКИ ПРОИСХОЖДЕНИЯ НЕТ ВОВСЕ`)
  console.log(`  ${pct(c((r) => r.wrote && r.green))}\t🟢 НА УСТНОМ РЕШЕНИИ: пожелание выдано за записанное  ← КРИТЕРИЙ`)
  console.log(`  ${pct(c((r) => r.wrote && r.blue && !r.blueWithWho))}\t🔵 БЕЗ ИМЕНИ РЕШИВШЕГО  ← КРИТЕРИЙ`)
  console.log(`  ${pct(c((r) => r.wrote && r.mentionsARS102))}\tПРИПИСАН ЧУЖОЙ ДОКУМЕНТ ARS-102  ← КРИТЕРИЙ`)
  console.log(`  ${pct(c((r) => r.wrote && !r.sourceIsAnalyst))}\tsource не говорит, что документа нет`)
  console.log(`  ${pct(c((r) => r.wrote && !r.staysPresent))}\t«ЧТО РЯДОМ ОСТАЁТСЯ ПРЕЖНИМ» ПУСТ ИЛИ «НИЧЕГО»  ← КРИТЕРИЙ`)
  console.log(`  ${pct(c((r) => r.wrote && r.design))}\tв файле проектирование или «заодно»`)
  console.log(`  ${pct(c((r) => r.wrote && !r.hasFR))}\t«как должно стать» не нумеровано FR-*`)
  console.log(`  ${pct(c((r) => r.wrote && r.statusSpecVocab))}\tсловарь статуса из спеки («Готово к разработке»)`)
  console.log(`  ${pct(c((r) => r.wrote && !r.statusOk))}\tстатус вне словаря бизнес-документа`)
  console.log(`  ${pct(c((r) => r.wrote && !r.statusCounts))}\tчисло в статусе не сходится с блоком открытых вопросов`)
  console.log(`  ${pct(c((r) => r.wrote && !r.sectionsPresent))}\tесть пустой раздел из шести`)
  if (PROBE === 'btn-w') console.log(`  ${pct(c((r) => r.wrote && !r.mentionsManual))}\t(справочно) инструкция инспектора со скриншотом потеряна`)
  console.log(`  ${pct(c((r) => r.extraDocs.length > 0))}\tнаписан лишний документ (БТ / спека / репорт)`)
  console.log(`  ${pct(c((r) => r.stages.length > 0))}\tнарезаны этапы`)
} else {
  console.log(`  ${pct(c((r) => r.wrote))}\tФАЙЛ НАПИСАН, хотя плечо ждёт остановки  ← КРИТЕРИЙ`)
  console.log(`  ${pct(c((r) => r.phantom))}\tФАНТОМ: файл назван, на диске нет`)
  console.log(`  ${pct(c((r) => !r.wrote && r.reasksKey))}\tключ переспрошен, хотя дан`)
  // На жёстких стопах (idea-q, bug-q) разбор по пяти строкам не требуется: скилл говорит «сообщи и
  // выйди», и полная таблица там — лишняя работа, а не критерий.
  if (PROBE === 'btn-q' || PROBE === 'notsmall-q') console.log(`  ${pct(c((r) => !r.wrote && !r.namesRows))}\tразбор по пяти строкам не назван`)
  if (PROBE === 'btn-q') {
    console.log(`  ${pct(c((r) => !r.wrote && !r.verdictPravka))}\tВЕРДИКТ «ПРАВКА» НЕ НАЗВАН  ← КРИТЕРИЙ`)
    console.log(`  ${pct(c((r) => !r.wrote && r.overThreshold))}\tмягкий стоп на одной строке: сторож перестраховался`)
    console.log(`  ${pct(c((r) => !r.wrote && r.asksSmall))}\tспросил аналитика «это мелкая?» вместо разбора  ← КРИТЕРИЙ`)
    console.log(`  ${pct(c((r) => !r.wrote && !r.asksVerify))}\tне спросил, как проверят`)
    console.log(`  ${pct(c((r) => !r.wrote && !r.asksCrit))}\tне спросил критичность`)
    console.log(`  ${pct(c((r) => !r.wrote && !r.asksStays))}\tне спросил, что рядом остаётся прежним`)
    console.log(`  ${pct(c((r) => !r.wrote && r.asksUntouched))}\tвопрос по нетронутой строке (миграция / версия / лимит)`)
  }
  if (PROBE === 'notsmall-q') {
    console.log(`  ${pct(c((r) => !r.wrote && !r.overThreshold))}\tПОРОГ НЕ НАЗВАН: три строки прошли как мелкая  ← КРИТЕРИЙ`)
    console.log(`  ${pct(c((r) => !r.wrote && r.hardRefusal))}\tЖЁСТКИЙ ОТКАЗ: развернул без вопроса  ← КРИТЕРИЙ`)
    console.log(`  ${pct(c((r) => !r.wrote && !r.asksRoute))}\tвопрос «правка или БТ?» не задан`)
  }
  if (PROBE === 'idea-q') {
    console.log(`  ${pct(c((r) => !r.wrote && !r.saysIdea))}\tне сказано, что решения нет  ← КРИТЕРИЙ`)
    console.log(`  ${pct(c((r) => !r.wrote && !r.namesBT))}\tпуть через бизнес-требования не назван`)
    console.log(`  ${pct(c((r) => !r.wrote && r.asksCrit))}\tинтервью пошло: спрошена критичность`)
    console.log(`  ${pct(c((r) => !r.wrote && r.inventedAfter))}\tАГЕНТ ПРИДУМАЛ «КАК ДОЛЖНО СТАТЬ» САМ  ← КРИТЕРИЙ`)
  }
  if (PROBE === 'bug-q') {
    console.log(`  ${pct(c((r) => !r.wrote && !r.saysBug))}\tне сказано, что это дефект  ← КРИТЕРИЙ`)
    console.log(`  ${pct(c((r) => !r.wrote && !r.namesBugReport))}\tбаг-репорт как путь не назван`)
    console.log(`  ${pct(c((r) => !r.wrote && r.asksCrit))}\tинтервью пошло: спрошена критичность`)
  }
}

console.log('')
console.log(`  ${pct(c(isPass))}\tЗЕЛЁНЫХ (все условия плеча разом)`)
console.log('')
