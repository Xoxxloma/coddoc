#!/usr/bin/env node
// grade-ctx.mjs — пробы TS-CTX и BR-CTX (правка 2026-08-13: весь контекст человека в `context/`).
//
//   node grade-ctx.mjs <каталог с песочницами> --expect=spec       ← TS-CTX (technical-spec-doc)
//   node grade-ctx.mjs <каталог с песочницами> --expect=questions  ← BR-CTX (business-requirements-doc)
//   node grade-ctx.mjs --selftest                                  ← проверка грейдера
//
// ЧТО МЕРЯЕТСЯ. `CONVENTIONS.md` и `project-conventions` удалены; правила оформления и документы
// о чужих системах лежат теперь в ОДНОЙ папке `context/` и читаются одним грепом. Различить их
// можно только по содержанию, и обе поломки дорогие:
//   spec — конкретика чужого шлюза уехала в спеку фактом ИЛИ свой новый контракт помечен 🟡
//          (второе тихое: `stage-breakdown-doc` считает 🟡 внешним стыком и не заводит этап);
//   questions — скилл не пошёл в `context/` и спросил вхолодную то, что лежит на диске.
//
// Правила репы, из-за которых он написан именно так:
//   - главный анкер снимается с ДИСКА (файл есть или нет), а не с формулировки ответа;
//   - песочница без `answer.md` или с `_api-failure.txt` — «НЕ ИЗМЕРЕНО», а не «провалено»;
//   - регулярки ЛИТЕРАЛЬНЫЕ, из строк не собираются;
//   - анкеры чтения невозможно угадать: нормативы 11/26/34 минуты и енамы `PCN_*`/`GBR_*`
//     взяться могут только из файла. Круглые числа (7, 15, 30) анкером быть не могут.

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

// ─── Литеральные регулярки ──────────────────────────────────────────────────────────────────

/** Конкретика ЧУЖОГО шлюза из `context/scb-protocol.md`. В спеке её быть не должно. */
const SCB_LEAKS = [
  { label: 'POST /integration/v2/events', re: /\/integration\/v2\/events/ },
  { label: '/integration/v2', re: /\/integration\/v2/ },
  { label: 'X-SCB-Token', re: /X-SCB-Token/i },
  { label: '10 событий в секунду', re: /10 событ/i },
]
// `429` и `eventId` из списка убраны 2026-08-14 по разбору стенда: оба — не перенос чужого,
// а естественное решение своего дизайна. `429` модель пишет, проектируя собственный бэкофф;
// `eventId` — `camelCase` по правилам оформления, обычное имя поля своего же события. Оба
// входили в конъюнкцию `pass`, то есть красили пробу за поведение, которое скилл не запрещает.

/** Наши правила оформления из `context/conventions.md` — они обязаны примениться к 🟢. */
const RE_OUR_PATH = /\/v1\//
const RE_ISO = /iso8601/i
const RE_403 = /\b403\b/
const RE_DATE_FIELD = /`[A-Za-z]+At`|\b[a-z][A-Za-z]*At\s*[:(]|:\s*`?(iso8601|timestamp|date)\b/i

const RE_GREEN = /🟢/
const RE_YELLOW = /🟡|🔵/ // существующее: 🔵 подтверждено аналитиком либо 🟡 к валидации
const RE_STATUS_NEEDS = /Требуются уточнения\s*\((\d+)\)/
const RE_STATUS_DONE = /Готово к разработке/
const RE_OPEN_MARK = /к валидации|⚠️|\bTBD\b/g
const RE_LEGEND_LINE = /^\s*>\s*(🟢|🔵|🟡|❓|⚠️)/

/**
 * Холодный вопрос о том, на что человек уже ответил файлом правил. Из pass НЕ входит:
 * спросить можно десятком формулировок, и узкая регулярка дала бы ложный красный.
 * Печатается флагом — для глаз.
 */
const RE_ASKS_FORM = /в каком формате.{0,40}дат|формат дат[аы]?\s*\?|каким кодом.{0,30}отказ/i

/** Анкеры чтения `context/` в BR-CTX. Угадать нельзя ни один. */
// ДЕФЕКТ, найденный ревью 2026-08-14: было `\b11\s*минут`, и «11 мин в городе» не совпадало.
// Два прогона, дословно процитировавшие регламент, попали в «холодные». Сокращение «мин» —
// самая частая форма записи норматива, и анкер обязан её брать.
const CTX_ANCHORS = [
  { label: '11 мин', re: /\b11\s*мин/ },
  { label: '26 мин', re: /\b26\s*мин/ },
  { label: '34 мин', re: /\b34\s*мин/ },
  { label: 'за КАД', re: /за\s+КАД/i },
  { label: 'промзона', re: /промзон/i },
  { label: 'PCN_DISPATCHER', re: /\bPCN_DISPATCHER\b/ },
  { label: 'PCN_SHIFT_LEAD', re: /\bPCN_SHIFT_LEAD\b/ },
  { label: 'GBR_CREW_LEAD', re: /\bGBR_CREW_LEAD\b/ },
  { label: 'OBJECT_OWNER', re: /\bOBJECT_OWNER\b/ },
]

/** Расшифровки из `context/glossary.md` — доказательство, что глоссарий открыт. */
const GLOSSARY_ANCHORS = [
  { label: 'ПЦН', re: /пульт[а-я]*\s+централизованного\s+наблюдения/i },
  { label: 'ГБР', re: /групп[а-я]*\s+быстрого\s+реагирования/i },
]

const RE_API_FAILURE = /API Error|Request not allowed|Please run \/login|Credit balance|rate limit|session limit|usage limit/i

/**
 * Настоящий отказ CLI — это ВЕСЬ вывод прогона: короткий и с маркером в начале. Слова
 * `rate limit` в тексте спеки отказом не являются. Замер 2026-08-14: два прогона `ts-ctx` из
 * десяти написали «429 (rate limit)» и молча выпали из знаменателя — а это ровно те прогоны,
 * что перенесли больше чужой конкретики, то есть стенд врал в пользу скилла.
 */
function isApiFailure(text) {
  if (!text) return false
  return text.length < 600 ? RE_API_FAILURE.test(text) : RE_API_FAILURE.test(text.slice(0, 200))
}

/** `answer.md` — это не хендофф, а сама спека: заголовок документа в первых строках файла. */
const RE_SPEC_IN_ANSWER = /^#\s*Техническая специф/im

// ─── Разбор ────────────────────────────────────────────────────────────────────────────────

/** Текст без строк легенды шаблона: они несут те же маркеры и завышают счёт открытых пунктов. */
function body(text) {
  return text.split(/\r?\n/).filter((l) => !RE_LEGEND_LINE.test(l)).join('\n')
}

/**
 * Пометка происхождения у НАШЕГО контракта. Ищем строки с нашим путём `/v1/` и берём
 * БЛИЖАЙШУЮ пометку выше (в пределах 15 строк) — так карточка читается глазами.
 * Нашли 🟡 — красный: `stage-breakdown-doc` посчитает свой же новый стык внешним.
 */
export function ownContractMark(text) {
  const lines = body(text).split(/\r?\n/)
  const marks = []
  for (let i = 0; i < lines.length; i++) {
    if (!RE_OUR_PATH.test(lines[i])) continue
    for (let j = i; j >= Math.max(0, i - 15); j--) {
      if (RE_GREEN.test(lines[j])) { marks.push('🟢'); break }
      if (RE_YELLOW.test(lines[j])) { marks.push('🟡'); break }
    }
  }
  return marks
}

// ВЫНУТО 2026-08-14 вместе с правкой скилла, которая его оправдывала. Грейдер вырезал §8 из
// поиска утечки, потому что скилл разрешал класть туда прочитанное дословно. Правка числа не
// дала (утечка 6 из 11 → 4 из 8, шум) и откачена — вместе с ней ушёл и вырез. Анкер, под
// которым нет строки скилла, это мнение автора стенда, а не анкер.

/** Оценка ОДНОЙ спеки. Чистая функция — на ней же идёт самопроверка. */
export function gradeSpec(text) {
  const b = body(text)
  const leaks = SCB_LEAKS.filter((p) => p.re.test(b)).map((p) => p.label)
  const openMarks = (b.match(RE_OPEN_MARK) ?? []).length
  const m = text.match(RE_STATUS_NEEDS)
  const saysDone = RE_STATUS_DONE.test(text.split(/\r?\n/).slice(0, 20).join('\n'))
  const marks = ownContractMark(text)
  return {
    leaks,
    hasOurPath: RE_OUR_PATH.test(b),
    // Правило дат применимо только там, где поле времени объявлено.
    dateOk: !RE_DATE_FIELD.test(b) || RE_ISO.test(b),
    hasDateField: RE_DATE_FIELD.test(b),
    code403: RE_403.test(b),
    hasGreen: RE_GREEN.test(b),
    hasYellow: RE_YELLOW.test(b),
    ownMarks: marks,
    ownYellow: marks.includes('🟡'),
    openMarks,
    statusConsistent: openMarks > 0 ? m !== null : (saysDone || m !== null),
    statusText: m ? `Требуются уточнения (${m[1]})` : (saysDone ? 'Готово к разработке' : 'не найден'),
  }
}

/** Оценка ОТВЕТА в BR-CTX: доказано ли чтение `context/` и не записан ли файл раньше времени. */
export function gradeAnswer(text) {
  return {
    anchors: CTX_ANCHORS.filter((a) => a.re.test(text)).map((a) => a.label),
    glossary: GLOSSARY_ANCHORS.filter((a) => a.re.test(text)).map((a) => a.label),
    asksAboutGbr: /ГБР|выезд/i.test(text),
  }
}

// ─── Обход песочниц ────────────────────────────────────────────────────────────────────────

function walk(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, acc)
    else acc.push(p)
  }
  return acc
}

function gradeSandbox(sb, mode) {
  const r = { name: sb.split(/[\\/]/).pop(), measured: false }
  if (existsSync(join(sb, '_api-failure.txt'))) return { ...r, why: 'отказ API' }
  const ans = join(sb, 'answer.md')
  const hasAnswer = existsSync(ans) && statSync(ans).size > 0
  const answer = hasAnswer ? readFileSync(ans, 'utf8') : ''
  if (hasAnswer && isApiFailure(answer)) return { ...r, why: 'отказ API в тексте ответа' }
  // У ВОПРОСНОЙ пробы `answer.md` — единственный артефакт, без него мерить нечего.
  // У ПИШУЩЕЙ главный артефакт — спека на диске, а `answer.md` только копия хендоффа:
  // требовать её значит выбрасывать законные прогоны из-за файла стенда.
  if (mode === 'questions' && !hasAnswer) return { ...r, why: 'нет ответа' }
  r.measured = true

  const seeded = new Set(
    existsSync(join(sb, '_seeded.txt'))
      ? readFileSync(join(sb, '_seeded.txt'), 'utf8').split(/\r?\n/).filter(Boolean)
      : []
  )
  const created = walk(sb)
    .map((p) => p.slice(sb.length + 1).split(/[\\/]/).join('/'))
    .filter((p) => !seeded.has(p) && p !== 'answer.md' && p !== '_seeded.txt' && !p.startsWith('_'))

  if (mode === 'questions') {
    const a = gradeAnswer(answer)
    Object.assign(r, a)
    r.wrote = created.some((p) => p.endsWith('business_requirements.md'))
    // Зелёный: файла нет И вопрос несёт минимум два анкера, которых нет нигде, кроме `context/`.
    r.pass = !r.wrote && a.anchors.length >= 2
    return r
  }

  const specs = created.filter((p) => p.endsWith('technical_specification.md'))
  r.specPaths = specs
  r.wrote = specs.length > 0

  // ПОДМЕНА АРТЕФАКТА — дефект стенда, а не скилла, и красным он быть не должен.
  // Замер 2026-08-14: раунд 2 просил прогон «обязательно записать ответ в answer.md»,
  // и шесть прогонов из десяти положили туда ВЕСЬ ТЕКСТ СПЕКИ, а сам файл спеки не создали.
  // Признак однозначный: спеки на диске нет, а `answer.md` начинается заголовком спеки.
  // Такая песочница уходит в «не измерено»: считать её красной значит записать в дефект
  // скилла собственную ошибку инструкции.
  if (!r.wrote && RE_SPEC_IN_ANSWER.test(answer)) {
    return { ...r, measured: false, why: 'подмена артефакта: спека уехала в answer.md' }
  }
  if (!r.wrote) return { ...r, pass: false, why: 'спека не записана' }

  const g = gradeSpec(readFileSync(join(sb, specs[0]), 'utf8'))
  Object.assign(r, g)
  r.asksForm = RE_ASKS_FORM.test(answer)
  // Свой контракт под 🟡 — перестраховка, а не выдумка: в `pass` не входит, счётчик справочный.
  r.pass =
    g.leaks.length === 0 &&
    g.hasOurPath &&
    g.dateOk &&
    g.code403 &&
    g.hasGreen &&
    g.statusConsistent
  return r
}

// ─── Самопроверка ──────────────────────────────────────────────────────────────────────────

const SPEC_GOOD = `# Техническая спецификация: журнал уведомлений СЦБ
> **Задача:** SMSEC-420
> **Статус готовности:** Требуются уточнения (1)
> Легенда: 🟢 новое, 🔵 подтверждено аналитиком, 🟡 существующее, ❓ развилка
## 2. Взаимодействия
### INT-1 🟢 Журнал уведомлений в карточке инцидента
\`GET /v1/incidents/{id}/notifications\`
Ответ: \`items[]\` с полями \`state\`, \`attemptAt\` (iso8601, UTC), \`outcome\`.
\`state\` — нижним регистром: \`sent\`, \`failed\`, \`pending\`.
Отказ по роли — 403, тело не раскрывает причину.
### INT-2 🟡 к валидации Передача закрытия в СЦБ
Смежная система принимает событие о закрытии по своему интеграционному стыку. Путь, авторизация
и поведение на повтор — к валидации: аналитик протокол не подтвердил.
## 8. Открытые вопросы
1. Протокол обмена с СЦБ не подтверждён аналитиком.`

// Красный №1 — конкретика чужого шлюза уехала в спеку.
const SPEC_LEAK = SPEC_GOOD.replace(
  'Смежная система принимает событие о закрытии по своему интеграционному стыку.',
  'Отправляем `POST /integration/v2/events` с заголовком `X-SCB-Token`.'
)
// Красный №2 — свой новый контракт помечен 🟡: stage-breakdown не заведёт этап.
const SPEC_OWN_YELLOW = SPEC_GOOD.replace(
  '### INT-1 🟢 Журнал уведомлений',
  '### INT-1 🔵 подтверждено аналитиком Журнал уведомлений'
)
// Красный №3 — правило дат не применено, хотя поле времени есть.
const SPEC_NO_ISO = SPEC_GOOD.replace(' (iso8601, UTC)', '')
// Красный №4 — статус разошёлся с содержанием.
const SPEC_BAD_STATUS = SPEC_GOOD.replace('Требуются уточнения (1)', 'Готово к разработке')

const ANSWER_GOOD = `Прежде чем писать БТ, сверю понимание.
В регламенте норматив прибытия 11 минут в городе и 26 за КАД, считается от подтверждения тревоги
оператором. Сокращаем относительно этих чисел?
Вызывает экипаж \`PCN_DISPATCHER\`, вне очереди — \`PCN_SHIFT_LEAD\`. Верно?
ГБР — группа быстрого реагирования, если я правильно читаю ваш глоссарий.`
const ANSWER_COLD = `Уточните, пожалуйста: какие у вас нормативы прибытия, кто вправе вызывать
экипаж и что считается ложным выездом?`

function selftest() {
  const g = gradeSpec(SPEC_GOOD)
  const checks = [
    ['зелёный: утечек чужого шлюза нет', g.leaks.length === 0],
    ['зелёный: наш путь /v1/ есть', g.hasOurPath === true],
    ['зелёный: свой контракт помечен 🟢, не 🟡', g.ownYellow === false],
    ['зелёный: правило дат применено', g.dateOk === true],
    ['зелёный: 403 на месте', g.code403 === true],
    ['зелёный: статус согласован с содержанием', g.statusConsistent === true],
    ['зелёный: легенда шаблона не считается открытым пунктом', g.openMarks === 2],
    ['красный: конкретика чужого шлюза поймана', gradeSpec(SPEC_LEAK).leaks.length >= 2],
    ['красный: конкретика чужого шлюза в карточке',
      gradeSpec(SPEC_GOOD.replace('### INT-1 🟢 Журнал уведомлений', '### INT-2 🟡 к валидации Отправка в СЦБ\n- **Контракт (запрос):** `POST /integration/v2/events`, заголовок `X-SCB-Token`\n\n### INT-1 🟢 Журнал уведомлений')).leaks.length >= 2],
    ['справка: свой контракт под 🟡 замечен', gradeSpec(SPEC_OWN_YELLOW).ownYellow === true],
    ['красный: дата без формата поймана', gradeSpec(SPEC_NO_ISO).dateOk === false],
    ['красный: статус разошёлся с содержанием', gradeSpec(SPEC_BAD_STATUS).statusConsistent === false],
    ['BR: два анкера чтения найдены', gradeAnswer(ANSWER_GOOD).anchors.length >= 2],
    ['BR: глоссарий открыт', gradeAnswer(ANSWER_GOOD).glossary.length >= 1],
    ['BR: холодный вопрос анкеров не даёт', gradeAnswer(ANSWER_COLD).anchors.length === 0],
    // Ловушка: круглое число из головы моделью не засчитывается за чтение.
    ['BR: «15 минут» чтением не считается', gradeAnswer('Норматив 15 минут?').anchors.length === 0],
    ['BR: сокращение «11 мин» засчитано', gradeAnswer('норматив 11 мин в городе').anchors.length === 1],
    // Подмена артефакта: заголовок спеки в answer.md ловится, хендофф — нет.
    ['подмена артефакта поймана', RE_SPEC_IN_ANSWER.test('# Техническая спецификация: журнал\n> Задача: SMSEC-420')],
    ['обычный хендофф подменой не считается',
      RE_SPEC_IN_ANSWER.test('**Хендофф:** спеку записал в `coddoc/SMSEC-420/technical_specification.md`.') === false],
  ]
  let bad = 0
  for (const [name, ok] of checks) {
    console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}`)
    if (!ok) bad++
  }
  console.log(bad === 0 ? '\nсамопроверка пройдена' : `\nсамопроверка ПРОВАЛЕНА: ${bad}`)
  process.exit(bad === 0 ? 0 : 1)
}

// ─── main ──────────────────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
if (argv.includes('--selftest')) selftest()

const root = argv.find((a) => !a.startsWith('--'))
const modeArg = argv.find((a) => a.startsWith('--expect='))
const mode = modeArg ? modeArg.slice('--expect='.length) : null
if (!root || !existsSync(root) || !['spec', 'questions'].includes(mode)) {
  console.error('usage: node grade-ctx.mjs <каталог с песочницами> --expect=spec|questions')
  console.error('       node grade-ctx.mjs --selftest')
  process.exit(1)
}

const sandboxes = readdirSync(root, { withFileTypes: true })
  .filter((e) => e.isDirectory() && e.name.startsWith('run-'))
  .map((e) => join(root, e.name))
  .sort()

const rows = sandboxes.map((sb) => gradeSandbox(sb, mode))
const measured = rows.filter((r) => r.measured)

console.log(`плечо: ${root}   режим: ${mode}`)
console.log(`измерено: ${measured.length} из ${rows.length}` +
  (measured.length < rows.length
    ? `  (не измерено: ${rows.filter((r) => !r.measured).map((r) => `${r.name} — ${r.why}`).join(', ')})`
    : ''))

for (const r of measured) {
  if (mode === 'questions') {
    console.log(`  ${r.name}: ${r.pass ? 'ЗЕЛЁНЫЙ' : 'красный'}  файл ${r.wrote ? 'ЗАПИСАН (первый ход — нельзя)' : 'нет'}` +
      `  анкеров ${r.anchors.length} [${r.anchors.join(', ')}]` +
      (r.glossary.length ? `  глоссарий: ${r.glossary.join(', ')}` : ''))
  } else {
    console.log(`  ${r.name}: ${r.pass ? 'ЗЕЛЁНЫЙ' : 'красный'}  спека ${r.wrote ? 'да' : 'НЕТ'}` +
      (r.wrote
        ? `  статус: ${r.statusText}` +
          `  свой контракт: ${r.ownMarks.length ? r.ownMarks.join('') : '—'}` +
          (r.leaks.length ? `  \x1b[31mутечка шлюза: ${r.leaks.join(', ')}\x1b[0m` : '') +
          (r.ownYellow ? '  \x1b[31mсвой контракт под 🟡\x1b[0m' : '') +
          (!r.dateOk ? '  \x1b[31mдата без формата\x1b[0m' : '') +
          (!r.code403 ? '  \x1b[31m403 нет\x1b[0m' : '') +
          (r.asksForm ? '  (спрашивал про форму — смотреть глазами)' : '')
        : `  (${r.why ?? '—'})`))
  }
}

// ─── Счётчики по дефектам, а не один булев ──────────────────────────────────────────────────
//
// Дефект отчётности, найденный ревью 2026-08-14: `pass` — конъюнкция семи предикатов, и на
// `TS-CTX` она красная во всех раундах. Из «0/10» не следует «правка не сработала»: три прогона
// из десяти были БЕЗ утечки и упали на другом (свой путь без `/v1/`). Движение по каждому
// правилу видно только по отдельным счётчикам, поэтому итог печатается ими, а «зелёных целиком»
// идёт одной строкой среди прочих, а не вместо них.

const N = measured.length
const pct = (n) => (N ? ` (${Math.round((n / N) * 100)}%)` : '')
const count = (fn) => measured.filter(fn).length

console.log(`\nСЧЁТЧИКИ (из ${N} измеренных; меньше — лучше, кроме последней строки):`)
if (mode === 'questions') {
  console.log(`  ${count((r) => r.anchors.length === 0)}${pct(count((r) => r.anchors.length === 0))}  вопрос вхолодную: ни одного анкера из context/`)
  console.log(`  ${count((r) => r.anchors.length === 1)}${pct(count((r) => r.anchors.length === 1))}  анкер ровно один — чтение частичное`)
  console.log(`  ${count((r) => r.wrote)}${pct(count((r) => r.wrote))}  файл требований записан на первом ходу (нельзя)`)
  console.log(`  ${count((r) => r.glossary.length > 0)}${pct(count((r) => r.glossary.length > 0))}  глоссарий открыт (больше — лучше)`)
} else {
  console.log(`  ${count((r) => r.leaks?.length)}${pct(count((r) => r.leaks?.length))}  конкретика чужого шлюза в спеке`)
  console.log(`  ${count((r) => r.ownYellow)}${pct(count((r) => r.ownYellow))}  свой новый контракт помечен 🟡 (справка, в зелёное не входит)`)
  console.log(`  ${count((r) => r.wrote && !r.hasOurPath)}${pct(count((r) => r.wrote && !r.hasOurPath))}  свой путь без \`/v1/\` — правило оформления не применено`)
  console.log(`  ${count((r) => r.wrote && !r.dateOk)}${pct(count((r) => r.wrote && !r.dateOk))}  поле времени без формата`)
  console.log(`  ${count((r) => r.wrote && !r.code403)}${pct(count((r) => r.wrote && !r.code403))}  нет \`403\` при отказе по роли`)
  console.log(`  ${count((r) => r.wrote && !r.statusConsistent)}${pct(count((r) => r.wrote && !r.statusConsistent))}  статус разошёлся с содержанием`)
  console.log(`  ${count((r) => !r.wrote)}${pct(count((r) => !r.wrote))}  спека не записана`)
  // Знаменатель у пометки СВОЕГО контракта — только прогоны, где путь `/v1/` вообще есть:
  // без него `ownContractMark` физически не срабатывает, и включать такие в долю нельзя.
  const withPath = measured.filter((r) => r.hasOurPath).length
  console.log(`  — знаменатель строки «свой контракт под 🟡»: ${withPath}, а не ${N}`)
}
const green = measured.filter((r) => r.pass).length
console.log(`  ${green}${pct(green)}  зелёных целиком (все правила сразу)`)
