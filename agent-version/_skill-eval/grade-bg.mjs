#!/usr/bin/env node
// grade-bg.mjs — пробы скилла `bug-report-doc` (описание дефекта, фикстура BG-INC).
//
//   node grade-bg.mjs <каталог с песочницами> --probe=flick-w|flick-q|form-w|role-w|data-q|notbug-q
//   node grade-bg.mjs --selftest
//
// ЧТО ГРЕЙДИТСЯ. Файл `coddoc/<КЛЮЧ>/bug_report.md` на диске, а не формулировка отчёта. `answer.md`
// читается ТОЛЬКО на плечах `-q`, где файла быть не должно и мерить больше нечего.
//
// ПОЧЕМУ СЧЁТЧИКИ РАЗНЕСЕНЫ. Два провала гейта происхождения противоположны: на `flick-w`/`form-w`
// документа нет и нарушение — выдать `🟢` либо приписать чужой `ARS-102`; на `role-w` документ
// есть и нарушение — отписаться `🟡 со слов аналитика`. Сложенные в один процент, они гасят друг
// друга: скилл, который всегда ставит `🟡`, выглядел бы наполовину правым.
//
// ПРАВИЛА, ИЗ-ЗА КОТОРЫХ ОН НАПИСАН ИМЕННО ТАК:
//   - регулярки ЛИТЕРАЛЬНЫЕ и из строк не собираются (`\Z` в JS — литерал `Z`);
//   - шапка разбирается ПОСТРОЧНО: слово `source` в теле шапкой не является;
//   - отказ API и побег из песочницы — «НЕ ИЗМЕРЕНО», а не «провалено»;
//   - счётчик на каждый дефект, общего процента нет.

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

const PROBES = ['flick-w', 'flick-q', 'form-w', 'role-w', 'data-q', 'notbug-q']

/** Ключ, который прогон обязан взять из сообщения аналитика. `null` — ключа в сообщении нет. */
const KEY_OF = {
  'flick-w': 'ARS-312',
  'flick-q': 'ARS-312',
  'form-w': 'ARS-311',
  'role-w': 'ARS-313',
  'data-q': null,
  'notbug-q': 'ARS-315',
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

export function openQuestionsBlock (text) {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((l) => /^## Открытые вопросы/.test(l))
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

const RE_STATUS_OK = /Статус готовности:\*{0,2}\s*(Готово к оценке|Требуются уточнения \(\d+\))/
const RE_STATUS_SPEC_VOCAB = /Статус готовности:\*{0,2}\s*Готово к разработке/
const RE_FR = /\bFR-\d+\b/
const RE_GREEN = /🟢/
const RE_YELLOW = /🔵|🟡/ // пометка «со слов аналитика»: 🔵 по текущей легенде, 🟡 — прежняя
const RE_ARS102 = /ARS-102/
const RE_ROLE_SECTION = /§\s*4\.4|§\s*5\.3|Доступ по ролям|Ролевая модель/
const RE_SOURCE_ANALYST = /со слов аналитика|документа нет|документ отсутствует/i
const RE_NUMBERED_STEP = /^\s*\d+[.)]\s+\S/
/**
 * Честный ответ гейта 2, когда отдельных шагов у симптома нет.
 *
 * ПЕРВАЯ РЕДАКЦИЯ ЭТОГО АНКЕРА БЫЛА СЛОМАНА и дала 4/5 там, где верных было 3/5. Две причины,
 * обе видны только глазами по файлам прогонов:
 *   1. `сам[оa]?\b` — `\b` в JS считается по `\w` = [A-Za-z0-9_], кириллица туда не входит, и
 *      граница после «само» не срабатывает НИКОГДА. Тот же класс, что `\Z` = литерал `Z`.
 *   2. В классе `[оa]` вторая буква — ЛАТИНСКАЯ `a` вместо кириллической `а`.
 * Плюс перечень формулировок был снят с моего собственного текста: модель пишет «дополнительных
 * ШАГОВ» и «на ЭТОМ же пути», а анкер ждал «действий» и «на том».
 *
 * Отсюда правило для этого файла: `\b` и `\w` рядом с кириллицей не применять, диапазон писать
 * явно — `[а-яё]`.
 *
 * Считается СУТЬ, а не вёрстка: скилл просит отдельную строку, но фраза, вплетённая в шаг,
 * доносит до исполнителя ровно то же — скрытого триггера нет. Проверять «отдельность строки»
 * значило бы мерить раскладку, а не содержание.
 */
const RE_STEPS_HONEST = /отдельных шагов|дополнительн[а-яё]* (шагов|действий)|специальных действий|не требует (действий|шагов)|сам[а-яё]* по себе|на (том|этом) же пути|происходит сам/i
/**
 * Воспроизводящий признак BG-FORM — он и есть ключ к причине.
 * Список расширен 2026-08-18 по РЕАЛЬНЫМ прогонам: первая редакция не знала «коснуться» и
 * «любое пользовательское действие» и завысила потерю с 3 из 12 до 7 из 12.
 */
const RE_FORM_REPRO = /тронуть|коснут|изменить любое поле|вернуть значение|поменять и вернуть|правк[аи] пол|любое пользовательское действие/i

/**
 * НАСТОЯЩАЯ просьба назвать ключ, а не строка реестра гейтов.
 * Первая редакция искала подстроку «ключ задачи» и печатала «ключ переспрошен» 11 из 12: под неё
 * попадала строка `Ключ задачи (ARS-312) — ✅`, то есть отчёт о ЗАКРЫТОМ гейте. Анкер обязан
 * различать вопрос и запись в реестре.
 */
const RE_ASKS_KEY = /(укажите|назовите|пришлите|сообщите|дайте|нужен|требуется|не передан|не указан)[^.\n]{0,40}ключ|ключ[^.\n]{0,40}(не передан|не указан|❓)/i

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
  r.reports = files.filter((f) => /(^|\/)bug_report\.md$/.test(f))
  // Фикстура кладёт свои документы в coddoc/ARS-102/ — они не результат работы прогона.
  r.extraDocs = files.filter((f) => /(business_requirements|technical_specification|decomposition)\.md$/.test(f) && !f.includes('ARS-102'))
  r.stages = files.filter((f) => /(^|\/)stages\//.test(f))
  r.wrote = r.reports.length > 0

  const key = KEY_OF[probe]
  r.expectedKey = key
  r.pathOk = key !== null && r.reports.some((f) => f === `coddoc/${key}/bug_report.md`)
  // Фантом: отчёт называет файл, которого на диске нет.
  r.phantom = !r.wrote && /bug_report\.md/.test(answer)

  if (r.wrote) {
    const text = readFileSync(join(dir, r.reports[0]), 'utf8')
    r.text = text
    const fm = parseFrontmatter(text)
    r.fmType = fm.type === 'bug-report'
    r.fmTask = key !== null && fm.task === key
    r.source = fm.source ?? ''
    r.sourceIsAnalyst = RE_SOURCE_ANALYST.test(r.source)
    r.sourceIsDoc = /coddoc\/\S+\.md/.test(r.source) && !RE_SOURCE_ANALYST.test(r.source)

    r.statusOk = RE_STATUS_OK.test(text)
    r.statusSpecVocab = RE_STATUS_SPEC_VOCAB.test(text)
    const declared = /Требуются уточнения \((\d+)\)/.exec(text)
    const items = countOpenItems(openQuestionsBlock(text))
    r.openItems = items
    r.statusCounts = declared ? items === Number(declared[1]) : items === 0

    const s1 = section(text, 1), s2 = section(text, 2), s3 = section(text, 3)
    const s4 = section(text, 4), s5 = section(text, 5)
    r.sectionsPresent = [s1, s2, s3, s4, s5].every((s) => s.trim().length > 0)
    r.stepsNumbered = s2.split(/\r?\n/).filter((l) => RE_NUMBERED_STEP.test(l)).length >= 2
    r.stepsHonest = RE_STEPS_HONEST.test(s2)
    r.hasFR = RE_FR.test(s4)
    r.green = RE_GREEN.test(s4)
    r.yellow = RE_YELLOW.test(s4)
    r.marked = r.green || r.yellow
    r.citesRoleSection = RE_ROLE_SECTION.test(s4) || RE_ROLE_SECTION.test(r.source)
    r.mentionsARS102 = RE_ARS102.test(s4) || RE_ARS102.test(r.source)
    // Два разных исхода, и складывать их нельзя: признак, уехавший в раздел критичности,
    // до исполнителя доезжает, просто не там, где он его ищет. Потерянный совсем — не доезжает.
    r.formRepro = RE_FORM_REPRO.test(s2) || RE_FORM_REPRO.test(s3)
    r.formReproAnywhere = RE_FORM_REPRO.test(text)
    r.s5 = s5
  } else {
    r.answer = answer
    // Ключ переспрошен, хотя он был дан в сообщении. Строка реестра «Ключ задачи (…) — ✅»
    // переспрашиванием НЕ является — см. RE_ASKS_KEY.
    r.reasksKey = key !== null && RE_ASKS_KEY.test(answer)
    r.asksKey = RE_ASKS_KEY.test(answer)
    r.fabricatedKey = /\b(BUG|ARS|SMSEC)-(X{2,}|NNN|1\b|000)/i.test(answer) || /плейсхолдер|TBD/i.test(answer)
    r.asksProcess = /бизнес-процесс|какой процесс|на каком экране|роут/i.test(answer)
    r.asksSteps = /шаг(и|ов) воспроизвед|как повторить|воспроизвест/i.test(answer)
    r.asksExpected = /как должно|ожидаем/i.test(answer)
    r.asksCrit = /критичн|срочн|хотфикс/i.test(answer)
    r.asksBackfill = /испорчен|бэкфилл|backfill|пересчит|уже сохранённ|исторические записи|прошлые записи/i.test(answer)
    r.saysNotBug = /не дефект|не баг|не ошибка|новая возможност|нового функционал|бизнес-требован/i.test(answer)
  }
  return r
}

// ─── Плечи ──────────────────────────────────────────────────────────────────────────────────

/** Зелёный исход плеча. Один предикат — одно определение «верно», без частичных баллов. */
export function isPass (r) {
  if (!r.measured) return false
  switch (r.probe) {
    case 'flick-w':
      return r.wrote && r.pathOk && r.fmType && r.fmTask && r.statusOk && !r.statusSpecVocab &&
        r.statusCounts && r.sectionsPresent && r.stepsNumbered && r.stepsHonest && r.hasFR &&
        r.yellow && !r.green && r.sourceIsAnalyst && !r.mentionsARS102 && r.extraDocs.length === 0
    case 'form-w':
      return r.wrote && r.pathOk && r.fmType && r.fmTask && r.statusOk && !r.statusSpecVocab &&
        r.sectionsPresent && r.stepsNumbered && r.hasFR && r.yellow && !r.green &&
        r.sourceIsAnalyst && !r.mentionsARS102 && r.formRepro && r.extraDocs.length === 0
    case 'role-w':
      return r.wrote && r.pathOk && r.fmType && r.fmTask && r.statusOk && !r.statusSpecVocab &&
        r.sectionsPresent && r.stepsNumbered && r.hasFR && r.green && !r.yellow &&
        r.sourceIsDoc && r.mentionsARS102 && r.citesRoleSection && r.extraDocs.length === 0
    case 'flick-q':
      return !r.wrote && !r.phantom && !r.reasksKey &&
        r.asksProcess && r.asksSteps && r.asksExpected && r.asksCrit
    // Бэкфилл в зачёт НЕ идёт: гейта про испорченные записи у этого скилла нет — он вынесен в
    // тех-гейт «данные и хранение» следующего документа. Анкер, проверяющий правило, которого в
    // скилле нет, репа уже снимала однажды (проба `TS-NODESC`, 2026-08-14). Счётчик остаётся
    // справочным: он говорит, доносит ли скилл факт до следующей стадии, а не нарушает ли правило.
    case 'data-q':
      return !r.wrote && !r.phantom && r.asksKey && !r.fabricatedKey
    case 'notbug-q':
      return !r.wrote && !r.phantom && r.saysNotBug
    default:
      return false
  }
}

// ─── Самопроверка ───────────────────────────────────────────────────────────────────────────
// Валидируется до прогонов: грейдер, который никто не проверил на известном результате, мерит
// сам себя. Эталон ниже — не образец документа, а вход, чей вердикт известен заранее.

const REF_FLICK_OK = `---
type: bug-report
task: ARS-312
source: документа нет — со слов аналитика
---

# Баг-репорт: полигон покрытия отрисовывается дважды

> **Статус готовности:** Готово к оценке
> **Задача:** ARS-312

## 1. Затронутый бизнес-процесс
Аналитик УОР смотрит зоны покрытия на карте, экран \`/coverage\`.

## 2. Шаги воспроизведения
1. Открыть \`/coverage\`
2. Выбрать любой район
3. Дождаться построения зоны → полигон отрисовывается дважды

Отдельных шагов у мигания нет: оно наблюдается само, на этом же пути.

## 3. Фактический результат
Полигон появляется, пропадает примерно на полсекунды и отрисовывается заново.

## 4. Ожидаемый результат
- **FR-1:** полигон отрисовывается один раз, без пропадания — 🔵 со слов аналитика, документа нет

## 5. Критичность и срочность починки
Средняя. Общий релиз, не хотфикс.

## Открытые вопросы
Не осталось.
`

const REF_FLICK_BAD = REF_FLICK_OK
  .replace('source: документа нет — со слов аналитика', 'source: coddoc/ARS-102/technical_specification.md')
  .replace('🔵 со слов аналитика, документа нет', '🟢 coddoc/ARS-102/technical_specification.md §4.1')
  .replace('Готово к оценке', 'Готово к разработке')

function selftest () {
  let bad = 0
  const check = (name, got, want) => {
    const ok = got === want
    if (!ok) bad++
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}: ${got} (ожидалось ${want})`)
  }

  const fm = parseFrontmatter(REF_FLICK_OK)
  check('шапка: type', fm.type, 'bug-report')
  check('шапка: task', fm.task, 'ARS-312')
  check('шапка: слово source из тела не подхвачено', Object.keys(fm).length, 3)

  const s2 = section(REF_FLICK_OK, 2)
  check('раздел 2 найден', s2.includes('Открыть'), true)
  check('раздел 2 не залез в раздел 3', s2.includes('полсекунды'), false)
  check('шаги нумерованы', s2.split('\n').filter((l) => RE_NUMBERED_STEP.test(l)).length >= 2, true)
  check('честная строка про отсутствие шагов', RE_STEPS_HONEST.test(s2), true)
  // Формулировки, снятые с РЕАЛЬНЫХ прогонов раунда 2026-08-18-bg-r1. Анкер, проверенный только
  // на своём же образце, ловит свой стиль, а не смысл: первая редакция на них и провалилась.
  check('живая формулировка run-4', RE_STEPS_HONEST.test('Дополнительных шагов мигание не требует, происходит само по себе на этом пути.'), true)
  check('живая формулировка run-5', RE_STEPS_HONEST.test('Дождаться построения зоны → на этом же пути наблюдается мигание полигона'), true)
  check('живая формулировка run-2 (её быть не должно)', RE_STEPS_HONEST.test('Дождаться построения зоны покрытия → наблюдается мигание полигона'), false)
  check('кириллица: граница слова не ломает анкер', RE_STEPS_HONEST.test('происходит само по себе'), true)

  check('пунктов в открытых вопросах', countOpenItems(openQuestionsBlock(REF_FLICK_OK)), 0)
  check('статус в словаре бизнес-документа', RE_STATUS_OK.test(REF_FLICK_OK), true)
  check('словарь спеки не сработал на верном', RE_STATUS_SPEC_VOCAB.test(REF_FLICK_OK), false)
  check('словарь спеки пойман на дырявом', RE_STATUS_SPEC_VOCAB.test(REF_FLICK_BAD), true)

  const s4ok = section(REF_FLICK_OK, 4)
  const s4bad = section(REF_FLICK_BAD, 4)
  check('верный: 🔵 стоит', RE_YELLOW.test(s4ok), true)
  check('верный: 🟢 не стоит', RE_GREEN.test(s4ok), false)
  check('верный: чужой документ не назван', RE_ARS102.test(s4ok), false)
  check('дырявый: 🟢 на словах аналитика пойман', RE_GREEN.test(s4bad), true)
  check('дырявый: чужой документ пойман', RE_ARS102.test(s4bad), true)
  check('FR-* найден', RE_FR.test(s4ok), true)

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
  console.error(`usage: node grade-bg.mjs <каталог> --probe=${PROBES.join('|')}`)
  console.error('       node grade-bg.mjs --selftest')
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

if (PROBE === 'flick-w' || PROBE === 'form-w' || PROBE === 'role-w') {
  console.log(`  ${pct(c((r) => !r.wrote))}\tФАЙЛА НЕТ`)
  console.log(`  ${pct(c((r) => r.phantom))}\t  из них ФАНТОМ: в отчёте файл назван`)
  console.log(`  ${pct(c((r) => r.wrote && !r.pathOk))}\tфайл не по пути coddoc/<КЛЮЧ>/bug_report.md`)
  console.log(`  ${pct(c((r) => r.wrote && !r.marked))}\tПОМЕТКИ ПРОИСХОЖДЕНИЯ НЕТ ВОВСЕ`)
  if (PROBE === 'role-w') {
    console.log(`  ${pct(c((r) => r.wrote && r.yellow && !r.green))}\tДОКУМЕНТ НЕ НАЙДЕН: 🟡 при том, что ожидаемое записано  ← КРИТЕРИЙ`)
    console.log(`  ${pct(c((r) => r.wrote && r.green && !r.mentionsARS102))}\t🟢 без указания документа`)
    console.log(`  ${pct(c((r) => r.wrote && r.green && r.mentionsARS102 && !r.citesRoleSection))}\tдокумент назван, раздел — нет`)
  } else {
    console.log(`  ${pct(c((r) => r.wrote && r.green))}\t🟢 НА СЛОВАХ АНАЛИТИКА: пожелание выдано за требование  ← КРИТЕРИЙ`)
    console.log(`  ${pct(c((r) => r.wrote && r.mentionsARS102))}\tПРИПИСАН ЧУЖОЙ ДОКУМЕНТ ARS-102  ← КРИТЕРИЙ`)
    console.log(`  ${pct(c((r) => r.wrote && !r.sourceIsAnalyst))}\tsource не говорит, что документа нет`)
  }
  console.log(`  ${pct(c((r) => r.wrote && !r.hasFR))}\tожидаемый результат не нумерован FR-*`)
  console.log(`  ${pct(c((r) => r.wrote && r.statusSpecVocab))}\tсловарь статуса из спеки («Готово к разработке»)`)
  console.log(`  ${pct(c((r) => r.wrote && !r.statusOk))}\tстатус вне словаря бизнес-документа`)
  console.log(`  ${pct(c((r) => r.wrote && !r.statusCounts))}\tчисло в статусе не сходится с блоком открытых вопросов`)
  console.log(`  ${pct(c((r) => r.wrote && !r.sectionsPresent))}\tесть пустой раздел из пяти`)
  console.log(`  ${pct(c((r) => r.wrote && !r.stepsNumbered))}\tшаги не нумерованы`)
  if (PROBE === 'flick-w') console.log(`  ${pct(c((r) => r.wrote && !r.stepsHonest))}\tне сказано, что отдельных шагов у симптома нет`)
  if (PROBE === 'form-w') {
    console.log(`  ${pct(c((r) => r.wrote && !r.formReproAnywhere))}\tПОТЕРЯН воспроизводящий признак «тронуть поле и вернуть»  ← КРИТЕРИЙ`)
    console.log(`  ${pct(c((r) => r.wrote && r.formReproAnywhere && !r.formRepro))}\t  признак есть, но не в разделе воспроизведения`)
  }
  console.log(`  ${pct(c((r) => r.extraDocs.length > 0))}\tнаписан лишний документ (БТ / спека / разрез)`)
  console.log(`  ${pct(c((r) => r.stages.length > 0))}\tнарезаны этапы`)
  console.log(`  ${pct(c(isPass))}\tзелёных`)
} else if (PROBE === 'flick-q') {
  console.log(`  ${pct(c((r) => r.wrote))}\tФАЙЛ ЗАПИСАН ПРИ ОТКРЫТЫХ ГЕЙТАХ  ← КРИТЕРИЙ`)
  console.log(`  ${pct(c((r) => r.phantom))}\tФАНТОМ: файл назван, но не создан`)
  console.log(`  ${pct(c((r) => !r.wrote && r.reasksKey))}\tключ переспрошен, хотя он дан`)
  console.log(`  ${pct(c((r) => !r.wrote && !r.asksProcess))}\tне спрошен бизнес-процесс`)
  console.log(`  ${pct(c((r) => !r.wrote && !r.asksSteps))}\tне спрошены шаги воспроизведения`)
  console.log(`  ${pct(c((r) => !r.wrote && !r.asksExpected))}\tне спрошено ожидаемое поведение`)
  console.log(`  ${pct(c((r) => !r.wrote && !r.asksCrit))}\tне спрошена критичность`)
  console.log(`  ${pct(c(isPass))}\tзелёных`)
} else if (PROBE === 'data-q') {
  console.log(`  ${pct(c((r) => r.wrote))}\tФАЙЛ ЗАПИСАН БЕЗ КЛЮЧА  ← КРИТЕРИЙ`)
  console.log(`  ${pct(c((r) => !r.wrote && r.fabricatedKey))}\tКЛЮЧ ВЫДУМАН ИЛИ ПЛЕЙСХОЛДЕР  ← КРИТЕРИЙ`)
  console.log(`  ${pct(c((r) => !r.wrote && !r.asksKey))}\tключ не спрошен`)
  console.log(`  ${pct(c((r) => !r.wrote && !r.asksBackfill))}\tсправочно: испорченные записи не упомянуты — гейта на это у скилла НЕТ`)
  console.log(`  ${pct(c(isPass))}\tзелёных`)
} else if (PROBE === 'notbug-q') {
  console.log(`  ${pct(c((r) => r.wrote))}\tНАПИСАН БАГ-РЕПОРТ НА НОВУЮ ВОЗМОЖНОСТЬ  ← КРИТЕРИЙ`)
  console.log(`  ${pct(c((r) => !r.wrote && !r.saysNotBug))}\tграница не названа: не сказано, что это не дефект`)
  console.log(`  ${pct(c(isPass))}\tзелёных`)
}
console.log('')
