#!/usr/bin/env node
// grade-gaps.mjs — грейдер проб `ts-gaps` (запись спеки) и `ts-gaps-q` (первый ход, только вопросы).
// Фикстура `fixtures/TS-GAPS/` (БТ TRP-418: заказ служебной машины, чужой сервис — система автопарка).
// Что меряется и почему так — `fixtures/TS-GAPS/README.md`.
//
//   node grade-gaps.mjs <плечо>              — ts-gaps: спека на диске, по счётчику на пункт 1–8 и анти-счётчики
//   node grade-gaps.mjs --q <плечо>          — ts-gaps-q: файла нет, число вопросов, вопросы по поводам 1–6
//   node grade-gaps.mjs --selftest [--q]     — самопроверка (рукописные и живые строки пилота)
//
// Правила стенда, на которых стоит этот файл:
//   - грейдится ФАЙЛ на диске, а не отчёт прогона; отчёт читается только для фантомной записи;
//   - регулярки — литералы, не склейки строк; рядом с кириллицей нет `\b`/`\w`, диапазоны `[а-яё]` явно;
//   - текст режется по строкам (`split('\n')`), кодовые блоки ``` из поиска смысла выброшены;
//   - якоря ищут СОДЕРЖАНИЕ в пределах карточки/раздела шаблона, а не новые заголовки правки;
//   - прогон без артефакта по вине стенда — «не измерено», из знаменателя выпадает.
//
// ОПРЕДЕЛЕНИЕ «ВОПРОСА» (общее с grade-2t.mjs, экспортируется): строка ответа, в которой после
// выброса кодовых блоков ```…```, инлайн-кода `…` и URL остался знак «?» (или «？»). Одна строка с двумя
// «?» — один вопрос; вопрос, разбитый на две строки, — столько, сколько строк несут «?».

import { readFileSync, existsSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

// ─── Общие утилиты ────────────────────────────────────────────────────────────────────────────

export const lines = (t) => String(t ?? '').replace(/\r/g, '').split('\n')

/** Флаг «строка внутри кодового блока» (сами строки ``` тоже код). */
export function codeFlags(ls) {
  let inCode = false
  return ls.map((l) => {
    if (/^\s*```/.test(l)) { inCode = !inCode; return true }
    return inCode
  })
}

/** Строка без инлайн-кода и URL — для поиска «?» и смысла вне идентификаторов. */
const bare = (l) => l.replace(/`[^`]*`/g, ' ').replace(/https?:\/\/\S+/g, ' ')

/** Индексы строк-вопросов (определение — в шапке файла). */
export function questionLineIdx(text) {
  const ls = lines(text)
  const code = codeFlags(ls)
  const out = []
  ls.forEach((l, i) => { if (!code[i] && /[?？]/.test(bare(l))) out.push(i) })
  return out
}
export const countQuestions = (text) => questionLineIdx(text).length

/** Легенда шаблона несёт те же маркеры, что живые пометки, — выбрасывается везде (урок grade-ts.mjs). */
export function stripLegend(text) {
  return lines(text).filter((l) => !/^\s*>\s*(🟢|🔵|🟡|❓|⚠️)/.test(l)).join('\n')
}

const RE_API_FAILURE = /API Error|Request not allowed|Please run \/login|Credit balance|rate limit|session limit|usage limit|hit your limit/i
function isApiFailure(text) {
  if (!text) return false
  return text.length < 600 ? RE_API_FAILURE.test(text) : RE_API_FAILURE.test(text.slice(0, 200))
}

const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null)

function walk(dir, base = dir, acc = []) {
  if (!existsSync(dir)) return acc
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, base, acc)
    else acc.push(p.slice(base.length + 1).split('\\').join('/'))
  }
  return acc
}

/** Спека в папке задачи `coddoc/<KEY>/` — ключ не зашит, ищется по дереву. */
export function findSpec(work) {
  const docs = join(work, 'coddoc')
  if (!existsSync(docs)) return null
  for (const key of readdirSync(docs)) {
    const p = join(docs, key, 'technical_specification.md')
    if (existsSync(p)) return { path: `coddoc/${key}/technical_specification.md`, text: readFileSync(p, 'utf8') }
  }
  return null
}
/** Спека мимо папки задачи — отдельный исход, а не «файла нет» (урок grade-ts.mjs 2026-08-14). */
export function findStraySpec(work) {
  for (const rel of walk(work)) {
    if (!rel.endsWith('technical_specification.md') || rel.startsWith('coddoc/')) continue
    return { path: rel, text: readFileSync(join(work, rel), 'utf8') }
  }
  return null
}
function btOf(work) {
  const docs = join(work, 'coddoc')
  if (!existsSync(docs)) return ''
  for (const key of readdirSync(docs)) {
    const p = join(docs, key, 'business_requirements.md')
    if (existsSync(p)) return readFileSync(p, 'utf8')
  }
  return ''
}

// ─── Разметка спеки: заголовки, разделы, INT-карточки ─────────────────────────────────────────

function headings(ls, code) {
  const out = []
  ls.forEach((l, i) => {
    if (code[i]) return
    const m = l.match(/^(#{1,6})\s+(.*)$/)
    if (m) out.push({ i, level: m[1].length, text: m[2] })
  })
  return out
}
/** [начало, конец) раздела с первым заголовком по `re` — до следующего заголовка того же или старшего уровня. */
function sectionRange(ls, code, re) {
  const hs = headings(ls, code)
  const k = hs.findIndex((h) => re.test(h.text))
  if (k < 0) return null
  const end = hs.slice(k + 1).find((h) => h.level <= hs[k].level)
  return [hs[k].i, end ? end.i : ls.length]
}

const MARKS = /🟢|🔵|🟡|❓/
const provOf = (s) => {
  const m = s.match(/🟢|🔵|🟡|❓/)
  return m ? ({ '🟢': 'new', '🔵': 'existing', '🟡': 'existing', '❓': 'open' })[m[0]] : null
}

/** INT-карточки: заголовок с «INT-N» → до следующего заголовка того же или старшего уровня. */
export function intCards(ls, code) {
  const hs = headings(ls, code)
  const cards = []
  hs.forEach((h, k) => {
    if (!/INT[-‑ ]?\s*\d/i.test(h.text)) return
    const end = hs.slice(k + 1).find((x) => x.level <= h.level)
    const from = h.i, to = end ? end.i : ls.length
    const body = ls.slice(from, to)
    // Чужая карточка — если 🔵/🟡 стоит первым ЛИБО в заголовке, ЛИБО в строке «Происхождение». Пилот 2026-10-01
    // (pilot3 run-1): «### INT-7. Заведение поездки в системе автопарка — 🟢» при «Происхождение: 🔵» и
    // `POST <autoParkBaseUrl>/api/trips` с JSON — по одному заголовку карточка считалась своей, путь не ловился.
    const pl = body.find((l) => /Происхождение/i.test(l) && MARKS.test(l))
    const ph = provOf(h.text), po = pl ? provOf(pl) : null
    const prov = (ph === 'existing' || po === 'existing') ? 'existing' : (ph ?? po)
    const head = h.text.replace(/INT[-‑ ]?\s*\d+\.?/i, '')
    const kind =
      (/созда|оформлен|оформит|подач[аи]\s+заявк|нов(ая|ую|ой)\s+заявк|create/i.test(head)
        && !/подтвер|отклон|отмен|список|просмотр|получени|чтени|автопарк|fleet/i.test(head)) ? 'create'
      : /подтвер|отклон|отмен|approve|reject|cancel|confirm|смен[аы]\s+статус|перевод/i.test(head) ? 'transition'
      : 'other'
    cards.push({ from, to, head: h.text, prov, kind })
  })
  return cards
}

// ─── Словари смысла (литералы) ────────────────────────────────────────────────────────────────

const FOREIGN = /автопарк|fleet/i

// Статусы заявки TRP-418. «подтверждено аналитиком» статусом не является — отсекается формой слова.
const STATUS_RES = [
  ['pending', /ожида[а-яё]*\s+(диспетчер|обработк|подтвержд)|awaiting|pending|waiting/i],
  ['confirmed', /подтвержд[её]нн?(а|ая|ую|ой|ые|ых)?(?![а-яё])(?!\s+аналитик)|confirmed|approved/i],
  ['rejected', /отклон[её]нн?(а|ая|ую|ой|ые|ых)?(?![а-яё])|rejected|declined/i],
  ['cancelled', /отмен[её]нн?(а|ая|ую|ой|ые|ых)?(?![а-яё])|cancell?ed|withdrawn|revoked/i],
]
export const statusClasses = (l) => STATUS_RES.filter(([, re]) => re.test(l)).map(([k]) => k)

// п.1 — повтор того же запроса создания. Кнопка «Повторить» в состоянии ошибки UI сюда НЕ входит:
// «повтор» засчитывается только вместе с отправкой/запросом/созданием либо как дубль/идемпотентность.
// `request_id` сюда не входит: это обычно id самой заявки (pilot3 run-1 — ложный зачёт по списку полей).
const RE_RETRY = /идемпотент|idempoten|дубл|повторн[а-яё]*\s+(отправк|отправ|запрос|вызов|нажат|создани|клик|сабмит|submit|POST)|повторн[а-яё]*\s+заявк|двойн[а-яё]*\s+(нажат|клик|отправк|сабмит)|дважды|тот\s+же\s+(запрос|ключ)|тем\s+же\s+ключ|ключ[а-яё]*\s+(повтор|идемпот)|client[_ -]?request[_ -]?id|Idempotency/i
// Контекст создания — в САМОЙ строке и без чужих операций. pilot5 run-1: «Диспетчер может повторить попытку
// (повторное нажатие «Подтвердить»)» засчитывалась по соседней строке «…при создании поездки в автопарке».
const RE_CREATE_CTX = /созда[а-яё]*\s+(нов[а-яё]+\s+)?заявк|заявк[а-яё]*[^.\n]{0,30}(созда|оформл)|при\s+создании|отправ[а-яё]*\s+(заявк|форм)|нов(ая|ую|ой)\s+заявк|подач[аи]\s+заявк|create|POST\s+\S*(request|заявк|trip-?request)/i
const RE_NOT_CREATE = /подтвер|отклон|отмен|автопарк|approve|reject|cancel|confirm/i

// п.2 — одновременная правка: признак одновременности + чем отказывают второму + кто выигрывает/механизм.
const RE_CONCUR = /одновременн|параллельн|конкурентн|гонк|race|в\s+то\s+же\s+время|в\s+тот\s+же\s+момент|двое|два\s+(диспетчер|пользоват|сотрудник)|оба\s+(диспетчер|пользоват|сотрудник)|другой\s+диспетчер|второй\s+диспетчер|оптимистич|optimistic|If-Match|ETag|блокировк|(?<![A-Za-z])lock(?![A-Za-z])|атомарн|compare-and-set|условн[а-яё]*\s+(обновлен|запис|UPDATE)/i
// Голое «ошибк» в ответ второму не входит: пилот 2026-10-01 — в окне открытого вопроса про гонку стояло
// «если автопарк ответит ошибкой при отмене», и п.2 засчитывался по чужой строке.
const RE_REFUSE = /(?<!\d)409(?!\d)|(?<!\d)412(?!\d)|конфликт|conflict|отказ|отклоня[ею]тся|получ[а-яё]*\s+(сообщени|ответ|ошибк|код)|ответ\s+\d{3}|«[^»]*уже/i
const RE_WINNER = /перв(ый|ым|ое|ая|ого)|выигрыва|побежда|успе(л|вш)|раньше|последн|только\s+одн|второ(й|му|го)|остальн|атомарн|условн|блокировк|lock|верси|version|If-Match|ETag|compare/i

// п.3 — частичный сбой: чужой вызов + отказ + что остаётся записанным у нас.
const RE_FAIL = /не\s+ответ|не\s+отвеча|недоступ|ошибк|сбой|таймаут|timeout|(?<!\d)5\d\d(?!\d)|не\s+прош|не\s+удал|упал|отказ|fail|не\s+завед/i
const RE_KEEP = /оста[её]тся|остаются|сохраня|сохран[её]н|не\s+сохраня|откатыва|откат|не\s+меня|возвраща[а-яё]*\s+(в\s+статус|в\s+«|к\s+статус)|не\s+переходит|не\s+фиксир|фиксиру|записыва|компенсац|отменя[а-яё]*\s+(поездк|заявк|подтвержд)/i

// п.5 — старые строки изменённой таблицы офисов. Признак «существующих» обязан стоять при офисах/строках/
// записях: пилот 2026-10-01 — «не затрагивает существующие разделы», «существующие API (…офисы) не меняются»
// рядом с «nullable или с дефолтным значением» давали ложный зачёт.
// «к существующей таблице офисов» + решённое заполнение рядом тоже засчитывается (pilot5 run-1: «not null» и
// «Значения по умолчанию: Europe/Moscow для Москвы, …» — значения для уже заведённых офисов названы).
// Нерешённое «nullable или с дефолтным значением» (pilot2 run-2) отсекается RE_UNDECIDED.
const RE_UNDECIDED = /(null|nullable|пуст)[а-яё]*\s+или\s|или\s+(с\s+)?(дефолт|по\s+умолчанию|default)/i
const RE_EXISTING = /(существующ|имеющ|действующ|уже\s+заведённ|уже\s+заведенн|уже\s+созданн|старых|старые|текущ|ранее\s+заведённ|ранее\s+заведенн)[а-яё]*\s+(офис|строк|запис|данн|значени)|существующ[а-яё]*\s+таблиц[а-яё]*\s+офис|existing\s+(table|rows|records|offices)|уже\s+(заведённ|заведенн|созданн|лежащ|существующ)[а-яё]*\s+(в\s+справочник|офис)|офис[а-яё]*[^.\n]{0,30}(уже\s+(есть|заведен|заведён|существ)|сейчас\s+(есть|заведен|заведён))|три\s+офиса|трёх\s+офис|трех\s+офис|3\s+офис|всех\s+офис|все\s+офисы|backfill|existing\s+(rows|records|offices)/i
const RE_FILL = /пуст|null|по\s+умолчанию|default|дефолт|заполн|досчит|вычисл|проставл|backfill|Europe\/|Asia\/|UTC\s*[+−-]\s*\d|миграци/i
const RE_OFFICE = /офис|office/i
// Строка-вопрос или открытая оговорка не утверждает решения: п.1–3, 5 на ней не засчитываются.
const isQuestion = (l) => /[?？]/.test(bare(l))
const RE_OPEN_HEDGE = /❓|(?<![A-Za-z])TBD(?![A-Za-z])|уточн|к\s+валидации|предварительно/i

// п.6 — виды ограничений полей запроса. Диапазон и местное время дают сами правила БТ (3 часа/14 дней,
// 1–4 пассажира, время офиса), поэтому зачёт — только по длине или формату: их в БТ нет.
const RE_LEN = /\d+\s*(символ|знак|chars?|characters)|max_?length|maxLength|minLength|длин[а-яё]*[^.\n|]{0,25}\d+/i
const RE_FMT = /E\.164|\+7\s*\(?\d|\+7X|формат[а-яё]*[^.\n|]{0,30}(телефон|номер)|телефон[а-яё]*[^.\n|]{0,60}(формат|маск|E\.164|\+7|цифр|regex|шаблон)|regex|regexp|pattern|маск[аеиу]/i
const RE_RANGE = /от\s+\d+\s+до\s+\d+|(?<![\d:.])\d+\s*(–|-|\.\.|…)\s*\d+(?![\d:.])|не\s+(менее|более|раньше|позднее|ранее|позже)|минимум|максимум|minimum|maximum|диапазон|≥|≤|>=|<=/i
const RE_TZ = /UTC|смещени|offset|[+−]\d{2}:\d{2}|IANA|Europe\/|Asia\/|timezone|time\s?zone|часов[а-яё]*\s+пояс/i

// п.7 — технические риски / не-цели.
const RE_TECH = /автопарк|сервис|вызов|интеграц|API|эндпоинт|endpoint|таймаут|timeout|недоступ|сбой|гонк|одновременн|параллельн|дубл|повтор|идемпотент|миграц|часов[а-яё]*\s+пояс|UTC|очеред|нагрузк|производительн|блокировк|рассинхрон|расхожд|консистентн|индекс|кэш|откат|ретра|retry|push|websocket|веб-?сокет|polling|опрос|real-?time|реальн[а-яё]*\s+времен|транзакц|синхрон|webhook|событи/i
const RE_NONGOAL = /не-цел|нецел|non-goals?|сознательно\s+не|намеренно\s+не|не\s+делаем|не\s+реализуем|не\s+поддерживаем|не\s+предусматрива|не\s+планируем|вне\s+объ[её]ма|вне\s+рамок|не\s+входит|out\s+of\s+scope|за\s+рамками/i
const RE_OPEN_MARK = /⚠️|🟡|(?<![A-Za-z])TBD(?![A-Za-z])|❓|к\s+валидации/

// п.8 — дата / версия редакции в шапке.
const RE_DATE = /(?<!\d)(19|20)\d{2}-\d{2}-\d{2}(?!\d)|(?<!\d)\d{1,2}\.\d{1,2}\.(19|20)\d{2}(?!\d)|(?<!\d)\d{1,2}\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+(19|20)\d{2}/i
// Между меткой, двоеточием и номером бывает markdown-жирное: «> **Редакция:** 1» (плечо gaps-a, 8 спек из 8) —
// без `[*_]*` засчитывались только строки с датой. Номер обязателен: голое «Редакция:» — не зачёт.
const RE_VERSION = /верси[яи][^|\n]{0,20}?v?\d+(\.\d+)+|верси[яи]\s*[*_]*\s*[:№]?\s*[*_]*\s*\d|редакци[яи]\s*[*_]*\s*[:№]?\s*[*_]*\s*\d|(?<![A-Za-z])v\d+\.\d+|ревизи[яи]\s*[*_]*\s*[:№]?\s*[*_]*\s*\d/i

// Анти: чужой путь/JSON и утверждения о поведении автопарка (п.1–3, 6) фактом.
// Путь начинается и после плейсхолдера базы: `POST <autoParkBaseUrl>/api/trips`, `${base}/trips` (pilot3 run-1).
const RE_PATH = /(^|[\s`(«"'>}])\/[A-Za-z0-9_{}.:-]+(\/[A-Za-z0-9_{}.:-]*)*|(GET|POST|PUT|PATCH|DELETE)\s+(<[^>\s]*>|\{[^}\s]*\}|\$\{?[A-Za-z_]+\}?)?\/?[A-Za-z{]/
// Та же регулярка с флагом `g` — литералом, а не `new RegExp(source)`; расхождение ловит самопроверка.
const RE_PATH_G = /(^|[\s`(«"'>}])\/[A-Za-z0-9_{}.:-]+(\/[A-Za-z0-9_{}.:-]*)*|(GET|POST|PUT|PATCH|DELETE)\s+(<[^>\s]*>|\{[^}\s]*\}|\$\{?[A-Za-z_]+\}?)?\/?[A-Za-z{]/g
const RE_FOREIGN_PATH_WORD = /fleet|park|avto|auto|vehicle|transport|car(?![a-z])/i
const RE_FOREIGN_BASE = /<[^>\n]*(park|fleet|avto|auto|vehicle|transport)[^>\n]*>|\$\{?[A-Za-z_]*(park|fleet|avto|auto)[A-Za-z_]*\}?/i
// Подлежащее — «автопарк» в именительном (не «из/в/от… автопарка») либо «система автопарка»; глагол — с
// границы слова. Пилот 2026-10-01: «по trip_number из автопарка (если по-ТРЕБУЕТ-ся синхронизация)» + «уникальный
// индекс» давали ложное «утверждение об автопарке».
// Глагол под отрицанием — условие сбоя, а не утверждение: «(автопарк не отвечает при INT-3)» в строке нашего
// каталога 502/503 (pilot5 run-1). Явные «не создаёт/не заводит» — отдельные альтернативы.
const RE_FOREIGN_SUBJ = /(?:(?<![а-яё])(?<!(?:из|в|во|от|у|для|к|с|о|об|на|по|при)\s)автопарк(?![а-яё])|система\s+автопарка|fleet)[^.;\n]{0,50}?(?<![а-яё])(?:не\s+созда[её]т|не\s+создаст|не\s+завед[её]т|не\s+заводит|(?<!не\s)(?:идемпотент|вернёт|вернет|возвраща|отда[её]т|отвечает|ответит|принимает|поддерживает|ограничива|допускает|требует|отклоняет|откатыва|гарантир|хранит|проверяет|игнорирует|дедуплици|работает|ожидает|понимает))/i
// 5xx в тему не входит: «автопарк не отвечает или возвращает 5xx» — условие сбоя, а не семантика чужого API
// (pilot6 run-1, строка нашего каталога 503). Конкретные 4xx — входят.
const RE_FOREIGN_TOPIC = /идемпотент|дубл|повторн|втор(ую|ой|ая)\s+поездк|(?<!\d)4\d\d(?!\d)|конфликт|conflict|символ|длин|не\s+более|максимум|формат|UTC|ISO|часов[а-яё]*\s+пояс|откат|транзакц|гарантир|уникальн|дедуплик/i
// Внутри чужой карточки: конкретный 4xx-код с его смыслом (а не наш перевод «→ вернуть 500») и ограничения
// чужих полей. pilot3 run-1: «4xx (400, 404) — неверные данные (напр. офис не существует в автопарке)».
const RE_FOREIGN_4XX = /(?<!\d)4\d\d(?!\d)/
const RE_OUR_MAPPING = /верн(уть|ём|ем)|возвраща(ем|ть)|отда(ём|ем|ть)|отвечаем|маппи|→\s*(вернуть|500|502|503|504)|в\s+INT-\d|портал\s+(возвращ|отда)/i
const RE_HEDGE = /🟡|к\s+валидации|не\s+подтвержд|неизвестн|не\s+известно|не\s+знаем|не\s+знает|не\s+знаю|уточн|(?<![A-Za-z])TBD(?![A-Za-z])|❓|если\s+(система\s+)?автопарк|предполож|допущен|под\s+вопросом|провер|не\s+гарантир/i
const RE_OURS = /портал|наш|бэк|backend|(?<![A-Za-z])BE(?![A-Za-z])|фронт/i

// ─── Анализ спеки ─────────────────────────────────────────────────────────────────────────────

/** Окно строк вокруг i: ±r, без кода (и без строк-вопросов, если `noQ`). */
function windowText(ls, code, i, r, noQ = false) {
  const out = []
  for (let j = Math.max(0, i - r); j <= Math.min(ls.length - 1, i + r); j += 1) {
    if (code[j] || (noQ && j !== i && isQuestion(ls[j]))) continue
    out.push(ls[j])
  }
  return out.join('\n')
}

/**
 * Переходы статусов в строке: стрелка между статусами (цели после стрелки считаются по одному — «A → B/C/D»
 * это три перехода), строка таблицы «из | в | …» (статус в 1-й И 2-й ячейке), оборот «из «X» в «Y»».
 * Строки каталога ошибок и тест-кейсов §7 с двумя статусами переходами не считаются (пилот 2026-10-01).
 */
export function transitionsIn(l) {
  if (/^\s*\|/.test(l)) {
    const cells = l.split('|').slice(1, -1)
    if (cells.length >= 2 && statusClasses(cells[0]).length && statusClasses(cells[1]).length) return Math.max(1, statusClasses(cells[1]).length)
    return 0
  }
  const m = l.split(/→|->|⇒|➝/)
  if (m.length >= 2 && statusClasses(m[0]).length) {
    let n = 0
    for (let k = 1; k < m.length; k += 1) n += statusClasses(m[k]).length
    return n
  }
  // pilot5 run-2: «Статус заявки переходит из "awaiting_dispatcher" в "confirmed"» — кавычки любые.
  if (/из\s+(статуса\s+)?[«"'`][^»"'`\n]+[»"'`]\s+в\s+(статус\s+)?[«"'`]/i.test(l) && statusClasses(l).length >= 2) return 1
  return 0
}

/** Строки-сущности §3.2: верхнеуровневый пункт/строка таблицы/подзаголовок с пометкой до первого « — »/«:». */
export function entityLines(ls, code) {
  const r = sectionRange(ls, code, /^3\.2(?![\d])|Данные и хранение/i)
  if (!r) return { found: false, items: [] }
  const items = []
  for (let i = r[0] + 1; i < r[1]; i += 1) {
    if (code[i]) continue
    const l = ls[i]
    let head = null
    const bullet = l.match(/^[-*]\s+(.*)$/)
    const sub = l.match(/^#{3,6}\s+(.*)$/)
    const row = /^\|/.test(l) && !/^\|\s*:?-{2,}/.test(l)
    // Абзац с пометкой в начале — тоже строка-сущность (pilot5 run-1: «🟢 **`TransportRequest` (новая таблица)**»).
    const para = !bullet && !sub && !row && /^(\*\*)?\s*(🟢|🔵|🟡|❓)/.test(l)
    if (bullet) head = bullet[1].split(/\s[—–-]\s|:\s/)[0]
    else if (sub) head = sub[1]
    else if (row) head = l.split('|').slice(1, 3).join('|')
    else if (para) head = l
    if (!head || !MARKS.test(head)) continue
    const name = (head.match(/`([^`]+)`/) || head.match(/\*\*([^*]+)\*\*/) || [null, head.replace(/🟢|🔵|🟡|❓|\*|\|/g, '').trim()])[1]
    // Групповая метка — не сущность: «🟢 **Новые сущности:**», «🔵 **Существующие сущности (читаем только):**» (pilot2 run-2).
    if (!/`/.test(head) && /сущност/i.test(name)) continue
    const transition = /→|->|⇒|➝/.test(head) || /переход|transition/i.test(name) || statusClasses(name).length > 0
    items.push({ i, line: l.trim(), name, prov: provOf(head), transition })
  }
  return { found: true, items }
}

/** Пункты списка «Открытые вопросы» в шапке (до первого `## `). */
function headerOpenItems(ls) {
  const end = ls.findIndex((l) => /^##\s/.test(l))
  const head = ls.slice(0, end < 0 ? ls.length : end)
  const k = head.findIndex((l) => /Открытые\s+вопросы/i.test(l))
  if (k < 0) return []
  const out = []
  for (let i = k + 1; i < head.length; i += 1) {
    const l = head[i]
    if (/^>?\s*\d+[.)]\s+\S/.test(l)) out.push(l.trim())
    else if (out.length && !/^>?\s*$/.test(l) && !/^>\s{2,}/.test(l) && !/^>\s*[-*]\s/.test(l)) break
  }
  return out
}

const STATUS_NEEDS = /Требуются\s+уточнения\s*\((\d+)\)/
const STATUS_DONE = /Готово\s+к\s+разработке/

/**
 * Все счётчики по тексту спеки. Возвращает массив { key, text, passed, evidence, info }.
 * `btText` — БТ песочницы: строки, скопированные из него дословно, в п.7 не засчитываются.
 */
export function gradeSpec(spec, btText = '') {
  const body = stripLegend(spec)
  const ls = lines(body)
  const code = codeFlags(ls)
  const nonCode = (i) => !code[i]
  const btSet = new Set(lines(btText).map((l) => l.replace(/[*_`>|#-]/g, '').replace(/\s+/g, ' ').trim()).filter((l) => l.length > 12))
  const fromBt = (l) => btSet.has(l.replace(/[*_`>|#-]/g, '').replace(/\s+/g, ' ').trim())
  const cards = intCards(ls, code)
  const checks = []
  const add = (key, text, passed, evidence, info = false) =>
    checks.push({ key, text, passed, evidence: String(evidence).replace(/\s+/g, ' ').slice(0, 170), info })
  const cardText = (c) => ls.slice(c.from, c.to).filter((_, k) => nonCode(c.from + k)).join('\n')
  const firstLine = (re, pred = () => true) => {
    const i = ls.findIndex((l, k) => nonCode(k) && re.test(l) && pred(l, k))
    return i < 0 ? null : { i, l: ls[i].trim() }
  }

  // п.1 — повтор у 🟢 создания
  const createCards = cards.filter((c) => c.kind === 'create' && c.prov !== 'existing')
  // Чужая для анти-счётчиков — карточка 🔵/🟡 ПРО АВТОПАРК (заголовок или «Граница»). pilot6 run-2: «INT-9.
  // Получение офиса с часовым поясом — 🟢» с «Происхождение: 🔵 (существующий справочник)» — справочник наш,
  // его JSON чужим путём не является.
  const foreignCards = cards.filter((c) => c.prov === 'existing' && (FOREIGN.test(c.head)
    || ls.slice(c.from, c.to).some((l) => /Граница/i.test(l) && FOREIGN.test(l))))
  const inForeign = (k) => foreignCards.some((c) => k >= c.from && k < c.to)
  const decided = (l) => !isQuestion(l) && !RE_OPEN_HEDGE.test(l)
  let p1 = null
  for (const c of createCards) {
    for (let i = c.from; i < c.to && !p1; i += 1) if (nonCode(i) && RE_RETRY.test(ls[i]) && !FOREIGN.test(ls[i]) && decided(ls[i])) p1 = { i, l: ls[i].trim(), where: 'карточка создания' }
  }
  if (!p1) {
    const h = firstLine(RE_RETRY, (l, k) => decided(l) && !RE_NOT_CREATE.test(l) && !inForeign(k) && RE_CREATE_CTX.test(l))
    if (h) p1 = { ...h, where: 'вне карточки' }
  }
  add('p1', 'п.1 повтор: у 🟢 создания сказано, что при повторной отправке', !!p1,
    p1 ? `${p1.where}: «${p1.l}»` : `нет (карточек создания: ${createCards.length})`)

  // п.2 — одновременная правка у 🟢 перехода
  let p2 = null, p2loose = null
  ls.forEach((l, i) => {
    if (p2 || !nonCode(i) || !RE_CONCUR.test(l)) return
    // «БЭ и ФЭ деплоятся одновременно» (pilot5) — не про запись; в справку не идёт.
    if (!/заявк|подтвер|отклон|отмен|статус|диспетчер|правк|запис|409|конфликт/i.test(l)) return
    // Открытый вопрос «возможна ли гонка?» в §8 решения не содержит (пилот 2026-10-01, run-2, §8 🟡).
    if (!decided(l) || /🟡/.test(l)) { if (!p2loose) p2loose = { i, l: `открыто: ${l.trim()}` }; return }
    const w = windowText(ls, code, i, 3, true)
    if (FOREIGN.test(l) && !statusClasses(w).length) return
    if (RE_REFUSE.test(w) && RE_WINNER.test(w)) p2 = { i, l: l.trim() }
    else if (!p2loose) p2loose = { i, l: l.trim() }
  })
  add('p2', 'п.2 одновременная правка: кто выигрывает и чем отказывают второму', !!p2,
    p2 ? `«${p2.l}»` : (p2loose ? `только признак без ответа второму: «${p2loose.l}»` : 'нет'))

  // п.3 — частичный сбой с чужим вызовом
  let p3 = null
  // 🟡 здесь не оговорка: им помечена возможность автопарка, а решение «что остаётся у нас» бывает твёрдым.
  ls.forEach((l, i) => {
    if (p3 || !nonCode(i) || !FOREIGN.test(l) || isQuestion(l) || /❓|(?<![A-Za-z])TBD(?![A-Za-z])|уточн/i.test(l)) return
    const w = windowText(ls, code, i, 2, true)
    if (RE_FAIL.test(w) && RE_KEEP.test(w)) p3 = { i, l: (lines(w).find((x) => RE_KEEP.test(x) && RE_FAIL.test(x)) ?? lines(w).find((x) => RE_KEEP.test(x)) ?? l).trim() }
  })
  add('p3', 'п.3 частичный сбой: что остаётся записанным, если автопарк не ответил', !!p3, p3 ? `«${p3.l}»` : 'нет')

  // п.4 — статусы и переходы (названы ≥2, кто переводит, запрещённые)
  // «Кто» — в САМОЙ строке перехода (ячейка таблицы, скобка после стрелки) либо в следующей строке-метке
  // «Кто/Выполняет/Роль: …»; засчитывается, когда при переходах названы ОБА исполнителя БТ (диспетчер и
  // автор-сотрудник). Пилот 2026-10-01: переходы одной строкой без исполнителя + сценарий «Сотрудник … →
  // «Отменена»» — один исполнитель из двух; «Авторизация: только диспетчер» лежит в другой карточке, а соседняя
  // строка «…или диспетчер отменяет вручную» говорит об автопарке — окно ±1 засчитывало её.
  const trans = []
  ls.forEach((l, i) => { if (nonCode(i)) { const n = transitionsIn(l); if (n) trans.push({ i, l, n }) } })
  const nTrans = trans.reduce((s, t) => s + t.n, 0)
  const roles = new Set()
  for (const t of trans) {
    const next = ls[t.i + 1] ?? ''
    const w = (t.l + (/^\s*[-*]?\s*(\*\*)?(кто|выполняет|исполнитель|роль|инициатор)/i.test(next) ? `\n${next}` : ''))
      .replace(/ожида[а-яё]*\s+диспетчер[а-яё]*|awaiting_dispatcher|AWAITING_DISPATCHER|PENDING_DISPATCH[A-Z_]*/gi, ' ')
    if (/диспетчер|dispatcher/i.test(w)) roles.add('диспетчер')
    if (/автор|сотрудник|employee|author|владел/i.test(w)) roles.add('автор')
  }
  const forbid = firstLine(/нельзя|запрещ|недопуст|не\s+допуска|невозможн|окончательн|финальн|конечн|терминальн|terminal|final|не\s+может\s+быть|только\s+из|других\s+переходов\s+нет|(?<!\d)409(?!\d)|не\s+переход/i,
    (l) => statusClasses(l).length > 0)
  add('p4', 'п.4 статусы: переходы названы, кто переводит (оба исполнителя), что запрещено', nTrans >= 3 && roles.size >= 2 && !!forbid,
    `переходов: ${nTrans} в ${trans.length} строк(е); исполнители рядом: ${[...roles].join(', ') || 'нет'}; запрет: ${forbid ? `«${forbid.l}»` : 'нет'}`)

  // §3.2 — строки-сущности против ожидаемого (🟢: заявка + офис; допуск — третья, напр. история статусов)
  const ents = entityLines(ls, code)
  const green = ents.items.filter((e) => e.prov === 'new')
  const transEnt = ents.items.filter((e) => e.transition)
  // Два счётчика, а не диапазон: «сверх ожидаемых» (лишняя строка = лишний стык разреза) и «меньше ожидаемых»
  // (пропущена заявка или изменение офиса) — разные дефекты, порог раунда стоит только на первом.
  add('e32', '§3.2: 🟢 строк-сущностей не сверх ожидаемых (≤3: заявка + офис [+ история])',
    ents.found && green.length <= 3,
    !ents.found ? 'раздела §3.2 нет' : `🟢 ${green.length}: ${green.map((e) => e.name).join(', ') || '—'}; прочих с пометкой: ${ents.items.length - green.length}`)
  add('e32min', '§3.2: 🟢 строк-сущностей не меньше ожидаемых (≥2: заявка + изменённый офис)',
    ents.found && green.length >= 2, !ents.found ? 'раздела §3.2 нет' : `🟢 ${green.length}`, true)
  add('e32t', '§3.2: статусы/переходы НЕ записаны отдельными строками-сущностями', transEnt.length === 0,
    transEnt.length ? `отдельной сущностью: ${transEnt.map((e) => e.name).join(', ')}` : 'нет')

  // п.5 — старые строки изменённой таблицы офисов
  let p5 = null
  ls.forEach((l, i) => {
    if (p5 || !nonCode(i) || !RE_EXISTING.test(l) || !decided(l)) return
    const w = windowText(ls, code, i, 2, true)
    if (RE_OFFICE.test(w) && RE_FILL.test(w) && !RE_UNDECIDED.test(w)) p5 = { i, l: l.trim() }
  })
  add('p5', 'п.5 старые строки: что в уже заведённых офисах (пусто/умолчание/досчитать)', !!p5, p5 ? `«${p5.l}»` : 'нет')

  // п.6 — ограничения полей запроса 🟢 создания
  const sec2 = sectionRange(ls, code, /^2[.)]?\s|Взаимодействи/i)
  // Ищется во ВСЕХ 🟢-карточках: «новый контракт» — не только создание. Пилот 2026-10-01: длина
  // `reason … 1–500 символов` стояла у отклонения, а карточка создания ограничений не несла.
  const newCards = cards.filter((c) => c.prov !== 'existing')
  const p6text = newCards.length ? newCards.map(cardText).join('\n')
    : (sec2 ? ls.slice(sec2[0], sec2[1]).filter((_, k) => nonCode(sec2[0] + k)).join('\n') : ls.filter((_, k) => nonCode(k)).join('\n'))
  const p6src = newCards.length ? `🟢-карточки (${newCards.length})` : (sec2 ? '§2 целиком (карточек нет)' : 'весь текст')
  const kinds = { длина: RE_LEN.test(p6text), формат: RE_FMT.test(p6text), диапазон: RE_RANGE.test(p6text), пояс: RE_TZ.test(p6text) }
  const where = newCards.filter((c) => RE_LEN.test(cardText(c)) || RE_FMT.test(cardText(c))).map((c) => (c.head.match(/INT[-‑ ]?\s*\d+/i) || ['?'])[0])
  add('p6', 'п.6 ограничения полей запроса (длина или формат — их нет в БТ)', kinds.длина || kinds.формат,
    `${p6src}; ${Object.entries(kinds).map(([k, v]) => `${k}: ${v ? 'да' : 'нет'}`).join(', ')}${where.length ? `; длина/формат в ${where.join(', ')}` : ''}`)

  // п.7 — технические риски и не-цели; риски не в открытых пунктах
  const region = (re) => {
    const out = []
    ls.forEach((l, i) => {
      if (!nonCode(i) || !re.test(l)) return
      out.push(i)
      const isHead = /^#{1,6}\s/.test(l)
      for (let j = i + 1; j < ls.length && j <= i + 15; j += 1) {
        if (/^#{1,6}\s/.test(ls[j])) break
        if (!isHead && /^\s*$/.test(ls[j])) break
        if (nonCode(j)) out.push(j)
      }
    })
    return [...new Set(out)]
  }
  // Раздел рисков начинается МЕТКОЙ (заголовок, жирная метка, шапка таблицы «Риск»), а не словом в обороте:
  // пилот 2026-10-01 — «(минимальный риск, т.к. поле новое)» в плане отката считался «техническим риском».
  const riskIdx = region(/^#{1,6}\s.*риск|^\s*([-*]\s+)?(🟢\s*|⚠️\s*)?\*\*[^*\n]*риск[^*\n]*\*\*|^\s*\|\s*Риск|^\s*([-*]\s+)?Риск[а-яё]*\s*[:—]/i)
  const ngIdx = region(RE_NONGOAL)
  const riskTech = riskIdx.find((i) => RE_TECH.test(ls[i]) && !fromBt(ls[i]) && !/^#{1,6}\s/.test(ls[i]))
  const ngTech = ngIdx.find((i) => RE_TECH.test(ls[i]) && !fromBt(ls[i]))
  const riskLeak = riskIdx.filter((i) => RE_OPEN_MARK.test(ls[i]) && /риск/i.test(windowText(ls, code, i, 1)))
  const hdrItems = headerOpenItems(lines(spec))
  const hdrLeak = hdrItems.filter((l) => /риск/i.test(l))
  add('p7', 'п.7 технические риски и не-цели названы; риски не в открытых пунктах',
    riskTech !== undefined && ngTech !== undefined && riskLeak.length === 0 && hdrLeak.length === 0,
    `риск: ${riskTech !== undefined ? `«${ls[riskTech].trim()}»` : 'нет'}; не-цель: ${ngTech !== undefined ? `«${ls[ngTech].trim()}»` : 'нет'}; утечка в открытые: ${riskLeak.length + hdrLeak.length}`)
  // п.7а — половина п.7 про риски, без не-целей: «Не делаем» убрано из правки после замера плеча A (п.7 — справка).
  add('p7a', 'п.7а технические риски названы, не в открытых',
    riskTech !== undefined && riskLeak.length === 0 && hdrLeak.length === 0,
    `риск: ${riskTech !== undefined ? `«${ls[riskTech].trim()}»` : 'нет'}; утечка в открытые: ${riskLeak.length + hdrLeak.length}`)

  // п.8 — дата/версия редакции в шапке
  const sl = lines(spec)
  const hEnd = sl.findIndex((l) => /^##\s/.test(l))
  const header = sl.slice(0, hEnd < 0 ? Math.min(30, sl.length) : hEnd).join('\n')
  const d = header.match(RE_DATE), v = header.match(RE_VERSION)
  add('p8', 'п.8 дата/версия редакции в шапке', !!(d || v), `дата: ${d ? d[0] : 'нет'}; версия: ${v ? v[0] : 'нет'}`)

  // АНТИ — чужой путь/JSON (под любой пометкой)
  const pathHits = []
  for (const c of foreignCards) {
    let json = false
    for (let i = c.from + 1; i < c.to; i += 1) {
      if (code[i] && !json && /^\s*[{[]/.test(ls[i])) { pathHits.push(`JSON в чужой карточке ${c.head.trim()}`); json = true }
      if (!code[i] && RE_PATH.test(ls[i])) pathHits.push(ls[i].trim())
    }
  }
  ls.forEach((l, i) => {
    if (!nonCode(i) || !(FOREIGN.test(l) || RE_FOREIGN_BASE.test(l))) return
    const m = l.match(RE_PATH_G)
    if ((m && m.some((p) => RE_FOREIGN_PATH_WORD.test(p))) || (m && RE_FOREIGN_BASE.test(l))) pathHits.push(l.trim())
  })
  const uniqPaths = [...new Set(pathHits)]
  add('foreignPath', 'АНТИ: чужой путь/JSON автопарка не выписан', uniqPaths.length === 0,
    uniqPaths.length ? `${uniqPaths.length}: «${uniqPaths[0]}»` : `нет (чужих карточек: ${foreignCards.length})`)

  // АНТИ — утверждения п.1–3, 6 о поведении автопарка фактом
  const claimHits = []
  ls.forEach((l, i) => {
    if (!nonCode(i) || RE_HEDGE.test(l)) return
    if (RE_FOREIGN_SUBJ.test(l) && RE_FOREIGN_TOPIC.test(l)) claimHits.push(l.trim())
  })
  for (const c of foreignCards) {
    for (let i = c.from + 1; i < c.to; i += 1) {
      const l = ls[i]
      if (code[i] || RE_HEDGE.test(l)) continue
      if (!RE_OURS.test(l) && RE_FOREIGN_TOPIC.test(l) && /возвраща|отда[её]т|отвечает|ответит|вернёт|вернет|идемпотент|не\s+созда/i.test(l)) claimHits.push(l.trim())
      else if (RE_FOREIGN_4XX.test(l) && !RE_OUR_MAPPING.test(l)) claimHits.push(l.trim())
      else if (RE_LEN.test(l) && !RE_OUR_MAPPING.test(l)) claimHits.push(l.trim())
    }
  }
  const uniqClaims = [...new Set(claimHits)]
  add('foreignClaim', 'АНТИ: о повторе/конфликте/сбое/ограничениях автопарка ничего не утверждено фактом', uniqClaims.length === 0,
    uniqClaims.length ? `${uniqClaims.length}: «${uniqClaims[0]}»` : 'нет')

  // Статус согласован с открытыми пунктами (арифметика grade-ts.mjs + сверка N с числом пунктов шапки)
  const openMarks = (body.match(/к\s+валидации|⚠️|(?<![A-Za-z])TBD(?![A-Za-z])/g) ?? []).length
  const m = spec.match(STATUS_NEEDS)
  const saysDone = STATUS_DONE.test(sl.slice(0, 25).join('\n'))
  const consistent = openMarks > 0 ? m !== null : (saysDone || m !== null)
  add('status', 'статус согласован с открытыми пунктами', consistent,
    `открытых пометок (без легенды): ${openMarks}; статус: ${m ? `Требуются уточнения (${m[1]})` : (saysDone ? 'Готово к разработке' : 'не найден')}; пунктов в шапке: ${hdrItems.length}${m && hdrItems.length && Number(m[1]) !== hdrItems.length ? ' — N НЕ РАВНО числу пунктов' : ''}`)

  add('placeholder', 'заглушки «<ПРОСТАВЛЯЕТСЯ ПОСЛЕ ЗАПИСИ>» не осталось', !spec.includes('ПРОСТАВЛЯЕТСЯ ПОСЛЕ ЗАПИСИ'),
    spec.includes('ПРОСТАВЛЯЕТСЯ ПОСЛЕ ЗАПИСИ') ? 'осталась' : 'нет', true)
  return checks
}

// ─── Вопросная проба: по поводам 1–6 ─────────────────────────────────────────────────────────

// Якоря вопросов уже, чем якоря спеки: вопрос первого хода говорит обо всём сразу, и широкое окно ловило
// чужое. Пилот 2026-10-01 (`ts-gaps-q`): «одновременно работают старый способ и новый» — не гонка правок;
// стрелки «FE → BE» — не переход статусов; «если синхронно — таймаут?» — не частичный сбой; «есть ли поле
// `timezone`?» — не ограничение поля. Все четыре теперь мимо (см. LIVE_Q).
const Q_TOPICS = [
  ['q1', 'повод 1 — повтор отправки создания', /повторн[а-яё]*\s+(отправк|нажат|запрос|вызов|создани|клик)|дубл|идемпотент|двойн[а-яё]*\s+(нажат|клик|отправк)|дважды|тот\s+же\s+запрос|Idempotency/i],
  ['q2', 'повод 2 — одновременная правка', /(одновременн|параллельн|в\s+тот\s+же\s+момент|конкурентн|гонк)[^.?\n]{0,60}(подтвер|отклон|отмен|правк|измен|обработ|нажм|нажа)|(подтвер|отклон|отмен|правк|измен|обработ)[а-яё]*[^.?\n]{0,60}(одновременн|параллельн|в\s+тот\s+же\s+момент)|два\s+диспетчера|оба\s+диспетчера|другой\s+диспетчер|второй\s+диспетчер|блокировк|оптимистич|верси[яи]\s+запис/i],
  ['q3', 'повод 3 — частичный сбой с автопарком', /оста[её]тся|остаются|откат|транзакц|либо\s+обе|что\s+(делаем|происходит|с\s+заявк)|как\s+быть|в\s+каком\s+статусе|статус\s+заявк/i],
  ['q4', 'повод 4 — переходы статусов', /переход[а-яё]*\s+(статус|между|из)|из\s+(статуса\s+)?«|можно\s+ли\s+(отменить|отклонить|подтвердить)|окончательн|финальн|конечн/i],
  ['q5', 'повод 5 — старые строки офисов', /заполн|по\s+умолчанию|пуст|null|досчит|миграц|проставл|backfill/i],
  ['q6', 'повод 6 — ограничения полей', /длин|символ|формат\s+(телефон|номер|адрес|времен|дат)|маск|regex|E\.164|ограничени[яе]\s+(на\s+)?(пол|ввод|длин)|(врем|дат)[а-яё]*[^?\n]{0,40}(UTC|смещени)|(UTC|смещени)[^?\n]{0,40}(врем|дат|хран|переда)|часов[а-яё]*\s+пояс[а-яё]*[^?\n]{0,40}(запрос|переда|хран|формат)/i],
]

/**
 * Окно вопроса: сама строка с «?», до 3 строк того же абзаца выше (рамка вопроса) и до 2 строк ниже, если это
 * пункты-варианты без своего «?». Код в окно не входит.
 */
function questionWindows(text) {
  const ls = lines(text)
  const code = codeFlags(ls)
  return questionLineIdx(text).map((i) => {
    const out = [ls[i]]
    for (let j = i - 1; j >= Math.max(0, i - 3); j -= 1) {
      if (code[j] || /^\s*$/.test(ls[j]) || /[?？]/.test(bare(ls[j]))) break
      out.unshift(ls[j])
      if (/^#{1,6}\s/.test(ls[j])) break
    }
    for (let j = i + 1; j <= Math.min(ls.length - 1, i + 2); j += 1) {
      if (code[j] || !/^\s*[-*]\s/.test(ls[j]) || /[?？]/.test(bare(ls[j]))) break
      out.push(ls[j])
    }
    return out.join('\n')
  })
}

export function gradeQuestions(answer) {
  const wins = questionWindows(answer)
  const res = {}
  for (const [key, label, re] of Q_TOPICS) {
    let hit
    if (key === 'q3') hit = wins.find((w) => FOREIGN.test(w) && RE_FAIL.test(w) && re.test(w))
    else if (key === 'q4') hit = wins.find((w) => re.test(w) || lines(w).some((l) => /→|->|⇒/.test(l) && statusClasses(l).length >= 2))
    else if (key === 'q5') hit = wins.find((w) => RE_OFFICE.test(w) && (RE_EXISTING.test(w) || /часов[а-яё]*\s+пояс/i.test(w)) && re.test(w))
    else hit = wins.find((w) => re.test(w))
    res[key] = { label, asked: !!hit, evidence: hit ? hit.split('\n').find((l) => /[?？]/.test(bare(l))) ?? '' : '' }
  }
  return { questions: wins.length, topics: res }
}

// ─── Поток вызовов: прочитан ли снимок, не вышел ли прогон из песочницы ────────────────────────

const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/^\/([a-z])\//i, '$1:/').toLowerCase()

export function streamAudit(dir) {
  const files = readdirSync(dir).filter((n) => /^stream(-\d+)?\.jsonl$/.test(n)).sort()
  if (!files.length) return { has: false }
  const sb = norm(resolve(dir))
  let skillRead = false
  const outsideWrites = [], outsideReads = [], harness = []
  for (const f of files) {
    for (const raw of lines(readFileSync(join(dir, f), 'utf8'))) {
      if (!raw.trim()) continue
      let j; try { j = JSON.parse(raw) } catch { continue }
      if (j.type !== 'assistant' || j.parent_tool_use_id) continue
      for (const c of (j.message?.content ?? [])) {
        if (c.type !== 'tool_use') continue
        const inp = c.input || {}
        const p = norm(inp.file_path || inp.path || '')
        if ((c.name === 'Read' && /technical-spec-doc\/skill\.md$/.test(p))
          || (c.name === 'Bash' && /technical-spec-doc\/SKILL\.md/i.test(inp.command || ''))) skillRead = true
        const abs = /^[a-z]:\//.test(p)
        if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(c.name) && abs && !p.startsWith(sb)) outsideWrites.push(p)
        if (['Read', 'Grep', 'Glob'].includes(c.name) && abs && !p.startsWith(sb) && !/skill-eval-seed\//.test(p)) outsideReads.push(p)
        // Материал стенда (README с ожидаемыми исходами, промпты) — прочитанный, он делает пробу вакуумной.
        // pilot4 run-2: `find /c/Users/Konstantin/projects -name "*TRP*"` вывел `fixtures/TS-GAPS/coddoc/TRP-418`.
        const cmd = String(inp.command || '')
        if ((c.name === 'Read' && /\/fixtures\/[^/]+\/(readme|[^/]*-prompt|[^/]*-turn2|expected|key)/i.test(p))
          || (c.name === 'Bash' && /fixtures\/[^\s"']*(README|-prompt|-turn2|expected|KEY)/i.test(cmd) && /(?<![A-Za-z])(cat|head|tail|less|more|type|sed|awk|grep)(?![A-Za-z])/.test(cmd))) harness.push(p || cmd.slice(0, 120))
        const cmdN = cmd.replace(/(^|[\s"'])\/([a-z])\//gi, '$1$2:/').replace(/\\/g, '/').toLowerCase()
        if (c.name === 'Bash' && /(^|[\s"'])(\/[a-z]\/|[A-Za-z]:[\\/])/.test(cmd) && !cmdN.includes(sb) && !/skill-eval-seed/.test(cmd)) outsideReads.push(`bash: ${cmd.slice(0, 100)}`)
      }
    }
  }
  return { has: true, skillRead, outsideWrites, outsideReads: [...new Set(outsideReads)], harness }
}

/** «Не измерено» — отказ стенда, а не скилла. */
function unmeasured(dir, work) {
  if (existsSync(join(dir, '_api-failure.txt')) || existsSync(join(dir, '_api-failure-turn.txt'))) return 'отказ API'
  if (existsSync(join(dir, '_escaped.txt'))) return 'прогон вышел за песочницу (_escaped.txt)'
  const ans = read(join(dir, 'answer.md'))
  if (ans && isApiFailure(ans)) return 'отказ API в тексте ответа'
  const a = streamAudit(dir)
  if (a.has && a.outsideWrites.length) return `запись вне песочницы: ${a.outsideWrites[0]}`
  if (a.has && a.harness.length) return `прочитан материал стенда: ${a.harness[0]}`
  if (a.has && !a.skillRead) return 'снимок скилла не прочитан'
  if ((!ans || !ans.trim()) && !findSpec(work) && !findStraySpec(work)) return 'пустой ответ, на диске тоже пусто'
  return null
}

const RE_CLAIMS_WRITTEN = /(спек[аи]|спецификаци[ияю]|документ)[^.\n]{0,60}(записан|готов|создан|сохранён|сохранен)|(файл|путь)\s*:?\s*`?[^`\n]{0,20}coddoc\//i

// ─── Самопроверка ─────────────────────────────────────────────────────────────────────────────

const GREEN = `# Техническая спецификация: заказ служебной машины

> **Задача:** TRP-418
> **Источник (БТ):** coddoc/TRP-418/business_requirements.md
> **Редакция:** 1.0 от 2026-10-01
>
> **Статус готовности:** Требуются уточнения (1)
>
> **Легенда происхождения:**
> 🟢 НОВОЕ — спроектировано в этом документе.
> 🟡 к валидации — допущение о существующей системе.
>
> **Открытые вопросы (решить до / во время разработки):**
> 1. 🟡 к валидации: умеет ли автопарк отменять заведённую поездку.

## 1. Обзор изменения

## 2. Взаимодействия (ядро)

### INT-1. Создание заявки на поездку — 🟢
- **Контракт (запрос):** \`POST /api/v1/trip-requests\`; \`destination\` — string, 1–300 символов; \`phone\` — string, формат E.164; \`passengers\` — integer 1..4; \`pickupLocal\` — локальное время офиса, часовой пояс берётся из офиса.
- **Повторная отправка:** заголовок \`Idempotency-Key\`; тот же ключ в течение 24 ч — возвращается ранее созданная заявка, дубль не создаётся.
\`\`\`json
{ "officeId": 3, "destination": "ул. Ленина, 1" }
\`\`\`

### INT-3. Подтверждение заявки диспетчером — 🟢
- **Одновременная правка:** переход атомарный — условное обновление по текущему статусу. Если два диспетчера подтверждают одновременно, выигрывает первый, второй получает 409 STATUS_CONFLICT «Заявка уже обработана».
- **Сбой автопарка:** если автопарк не ответил за 5 с или вернул ошибку, заявка остаётся в статусе «Ожидает диспетчера», диспетчер видит ошибку и повторяет подтверждение.

### INT-5. Заведение поездки в автопарке — 🔵 подтверждено аналитиком
- **Граница/направление:** бэк портала → система автопарка.
- **Контракт (запрос):** путь и метод не выписываются — стык описан словами: офис, время подачи, адрес, число пассажиров; в ответ номер поездки и госномер.

### INT-6. Отмена поездки в автопарке — 🟡 к валидации
- **Контракт (запрос):** 🟡 к валидации — умеет ли автопарк отменять поездку, не подтверждено.

## 3. Backend — ответственность
### 3.2. Данные и хранение
- 🟢 \`TripRequest\` — поля: \`id\`, \`status\` (enum: AWAITING_DISPATCHER → CONFIRMED | REJECTED | CANCELLED), \`officeId\`, \`pickupAt\`.
- 🟢 \`Office\` (изменение существующей таблицы) — новое поле \`timezone\` (IANA).
- Миграция: для существующих офисов часовой пояс заполняется по городу: Москва — Europe/Moscow, Екатеринбург — Asia/Yekaterinburg, Новосибирск — Asia/Novosibirsk.

### 3.4. Статусы и переходы
| Из | В | Кто |
|----|---|-----|
| Ожидает диспетчера | Подтверждена | диспетчер |
| Ожидает диспетчера | Отклонена | диспетчер |
| Подтверждена | Отменена | автор заявки |
Из «Отклонена» и «Отменена» переходов нет — статусы окончательные; попытка — 409.

## 8. Допущения и открытые вопросы
- **Технические риски:** рассинхрон портала и автопарка при сбое между записью статуса и вызовом — 🟢 сверка раз в сутки.
- **Сознательно не делаем:** push-обновление статуса (websocket) — сотрудник видит статус при открытии списка.
`

const RED = `# Техническая спецификация: заказ служебной машины

> **Задача:** TRP-418
> **Статус готовности:** Готово к разработке
>
> **Открытые вопросы:**
> 1. Риск: автопарк может не ответить — ⚠️ уточнить.

## 2. Взаимодействия (ядро)

### INT-1. Создание заявки на поездку — 🟢
- **Контракт (запрос):** \`POST /api/v1/trip-requests\`; поля \`destination\` (string), \`phone\` (string), \`passengers\` (integer).
- **Ошибки:** 400 — неверные поля; ошибка сети → «Повторить».

### INT-4. Заведение поездки в автопарке — 🔵 подтверждено аналитиком
- **Контракт (запрос):** \`POST /fleet/api/v2/trips\`
- **Ошибки:** возвращает 409 при дубле поездки.
\`\`\`json
{ "tripNumber": "T-1", "plate": "А123ВС" }
\`\`\`
Автопарк идемпотентен: повторный вызов с тем же номером заявки не создаёт вторую поездку.
Автопарк принимает адрес не более 255 символов.

## 3. Backend — ответственность
### 3.2. Данные и хранение
- 🟢 \`TripRequest\` — поля: \`id\`, \`status\`.
- 🟢 \`Ожидает диспетчера → Подтверждена\` — переход, выполняет диспетчер.
- 🟢 \`Подтверждена → Отменена\` — переход, выполняет автор.
- 🟢 \`TripRequestStatus\` — enum статусов.
`

function selftestSpec() {
  const res = []
  const ok = (name, cond) => res.push([name, !!cond])
  const by = (cs) => Object.fromEntries(cs.map((c) => [c.key, c]))
  const g = by(gradeSpec(GREEN))
  const r = by(gradeSpec(RED))
  for (const k of ['p1', 'p2', 'p3', 'p4', 'e32', 'e32t', 'p5', 'p6', 'p7', 'p8', 'foreignPath', 'foreignClaim', 'status']) {
    ok(`зелёная рукопись: ${k} PASS`, g[k]?.passed)
  }
  for (const k of ['p1', 'p2', 'p3', 'p4', 'e32', 'e32t', 'p5', 'p6', 'p7', 'p8', 'foreignPath', 'foreignClaim', 'status']) {
    ok(`красная рукопись: ${k} FAIL`, r[k] && !r[k].passed)
  }
  // Тонкие места словарей
  ok('кнопка «Повторить» в ошибке UI — не повтор отправки', !RE_RETRY.test('- **Ошибки:** ошибка сети → кнопка «Повторить»'))
  ok('«подтверждено аналитиком» — не статус', statusClasses('🔵 подтверждено аналитиком (не по коду)').length === 0)
  ok('«Подтверждена»/«Отклонена» — статусы', statusClasses('| Ожидает диспетчера | Подтверждена | Отклонена |').length === 3)
  ok('«отмена» (сущ.) — не статус', statusClasses('Отмена заявки сотрудником').length === 0)
  ok('«Если автопарк вернёт ошибку» — не утверждение о нём', RE_HEDGE.test('Если автопарк вернёт 503, заявка остаётся в статусе «Ожидает диспетчера»'))
  ok('«автопарк возвращает номер поездки» — не грех (тема не п.1–3/6)',
    !(RE_FOREIGN_SUBJ.test('🔵 Автопарк заводит поездку и возвращает номер поездки и госномер') && RE_FOREIGN_TOPIC.test('🔵 Автопарк заводит поездку и возвращает номер поездки и госномер')))
  ok('свой путь в строке с автопарком — не чужой путь',
    !(gradeSpec('### INT-3. Подтверждение — 🟢\n- Бэк портала по `POST /api/v1/trip-requests/{id}/confirm` вызывает автопарк.\n').find((c) => c.key === 'foreignPath').passed === false))
  ok('сущность с переходом внутри поля enum — не переход-сущность',
    !entityLines(lines('### 3.2. Данные и хранение\n- 🟢 `TripRequest` — поля: `status` (enum: A → B)\n'), [false, false]).items[0].transition)
  {
    // Аудит потока на временной песочнице: снимок прочитан → измерено; README фикстуры прочитан → не измерено.
    const d = mkdtempSync(join(tmpdir(), 'grade-gaps-'))
    const ev = (name, input) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } })
    try {
      writeFileSync(join(d, 'answer.md'), 'Вопросы: годится?')
      writeFileSync(join(d, 'stream.jsonl'), [ev('Read', { file_path: 'C:/Users/x/AppData/Local/Temp/skill-eval-seed/r-skills/technical-spec-doc/SKILL.md' })].join('\n'))
      ok('поток: снимок прочитан → измерено', unmeasured(d, d) === null)
      writeFileSync(join(d, 'stream.jsonl'), [ev('Read', { file_path: 'C:/Users/x/AppData/Local/Temp/skill-eval-seed/r-skills/technical-spec-doc/SKILL.md' }),
        ev('Read', { file_path: 'C:/Users/x/projects/product-skills/agent-version/_skill-eval/fixtures/TS-GAPS/README.md' })].join('\n'))
      ok('поток: прочитан README фикстуры → не измерено', /материал стенда/.test(unmeasured(d, d) ?? ''))
      writeFileSync(join(d, 'stream.jsonl'), [ev('Read', { file_path: join(d, 'coddoc/TRP-418/business_requirements.md') })].join('\n'))
      ok('поток: снимок не прочитан → не измерено', /не прочитан/.test(unmeasured(d, d) ?? ''))
      writeFileSync(join(d, 'stream.jsonl'), [ev('Read', { file_path: 'C:/x/skill-eval-seed/r-skills/technical-spec-doc/SKILL.md' }),
        ev('Write', { file_path: 'C:/Users/x/projects/product-skills/agent-version/_skill-eval/fixtures/TS-GAPS/coddoc/TRP-418/technical_specification.md', content: '' })].join('\n'))
      ok('поток: запись в фикстуру → не измерено', /вне песочницы/.test(unmeasured(d, d) ?? ''))
    } finally { rmSync(d, { recursive: true, force: true }) }
  }
  ok('RE_PATH_G — та же регулярка, что RE_PATH (не разошлись)', RE_PATH_G.source === RE_PATH.source)
  ok('«дедлок»/«блокировка» не путаются с lock: «Clock» — не lock', !RE_CONCUR.test('Clock skew допустим'))
  ok('вопрос: строка с «?» в инлайн-коде не вопрос', countQuestions('Путь `GET /x?y=1` годится.\nДа.') === 0)
  ok('вопрос: «?» в кодовом блоке не вопрос', countQuestions('```\nа?\n```\nб?') === 1)
  for (const [k, v] of LIVE_SPEC) ok(`живая строка пилота: ${k}`, v())
  return res
}

function selftestQ() {
  const res = []
  const ok = (name, cond) => res.push([name, !!cond])
  const GREEN_Q = `Вопросы по тех-гейтам.

**Создание заявки.** Предлагаю: повторная отправка того же запроса не создаёт дубль — возвращаем ранее созданную заявку. Годится?

**Подтверждение.** Если два диспетчера одновременно подтверждают одну заявку, выигрывает первый, второму — 409. Так?

**Автопарк.** Если автопарк не ответил при подтверждении — заявка остаётся «Ожидает диспетчера». Верно?

**Статусы.** Переходы: Ожидает диспетчера → Подтверждена / Отклонена / Отменена; из «Отклонена» переходов нет. Подтверждаете?

**Справочник офисов.** Для существующих офисов часовой пояс заполняем миграцией по городу?

**Поля.** Адрес — до 300 символов, телефон — формат E.164. Годится?`
  const RED_Q = `Спека записана: coddoc/TRP-418/technical_specification.md. Статус: Готово к разработке.`
  const g = gradeQuestions(GREEN_Q), r = gradeQuestions(RED_Q)
  ok('зелёный: 6 вопросов', g.questions === 6)
  for (const k of ['q1', 'q2', 'q3', 'q4', 'q5', 'q6']) ok(`зелёный: ${k} спрошен`, g.topics[k].asked)
  ok('красный: 0 вопросов', r.questions === 0)
  for (const k of ['q1', 'q2', 'q3', 'q4', 'q5', 'q6']) ok(`красный: ${k} не спрошен`, !r.topics[k].asked)
  ok('красный: фантомная запись опознана', RE_CLAIMS_WRITTEN.test(RED_Q))
  for (const [k, v] of LIVE_Q) ok(`живая строка пилота: ${k}`, v())
  return res
}

// ─── Живые строки пилота — как модель пишет на самом деле ────────────────────────────────────
// Спека: `runs/2026-10-01-gaps-pilot2/ts-gaps/run-2/coddoc/TRP-418/technical_specification.md` (596 строк),
// дословные куски. Вердикт по этой спеке вынесен руками ДО правки якорей и сверен с выводом грейдера.
const LIVE_SPEC_TEXT = `# Техническая спецификация: заказ служебной машины через портал

> **Задача:** TRP-418
> **Источник (БТ):** business_requirements.md (этот же каталог)
>
> **Статус готовности:** Требуются уточнения (1)
>
> **Легенда происхождения:**
> 🟡 к валидации — допущение о существующей системе, не подтверждено — уточнить.
>
> **Открытые вопросы (решить до / во время разработки):**
> 1. 🟡 Может ли система автопарка отменять заведённую поездку, или отмену выполняет диспетчер вручную?

## 2. Взаимодействия (ядро)

### INT-1. Создание заявки — 🟢

- **Контракт (запрос):** \`POST /transport/requests\` (концептуально)
  - \`scheduled_time\` (ISO 8601 datetime, обязательно) — время подачи в UTC (бэк конвертирует в локальное время офиса для хранения и отображения)
  - \`passenger_count\` (integer 1–4, обязательно) — число пассажиров
  - \`phone\` (string, обязательно) — телефон сотрудника
- **Ошибки:**
  - \`400 Bad Request\` — поле не заполнено или неверный формат (passenger_count > 4, time < now + 3h, time > now + 14d)
  - \`409 Conflict\` — сотрудник уже имеет активную заявку на то же время (уточнить при интеграции)
- **Состояния UI по ответу:**
  - \`error_source\` (5xx) → «ошибка сервера, попробуйте позже»

### INT-4. Подтверждение заявки — 🟢

- **Внутренняя часть (BE → Автопарк):** 🔵 подтверждено аналитиком
  - BE портала вызывает API автопарка: передаёт office_id, scheduled_time, destination_address, passenger_count
  - Автопарк возвращает: trip_number, vehicle_plate (госномер)
  - Если автопарк вернёт ошибку → заявка остаётся в awaiting_dispatcher, пользователю показывается ошибка (🟡 возможность отката)
- **Ошибки:**
  - \`400 Bad Request\` — заявка не в статусе awaiting_dispatcher

### INT-5. Отклонение заявки — 🟢

- **Контракт (запрос):** \`POST /transport/requests/{id}/reject\` (концептуально)
  - \`reason\` (string, обязательно, 1–500 символов) — причина отклонения

### Каталог ошибок (сводно)

| Код | Тело/сообщение | Когда | Состояние UI |
|-----|----------------|-------|--------------|
| 400 Bad Request | \`{ "error": "invalid_state", "message": "Заявка не может быть отменена: до подачи < 2 часов" }\` | INT-6: попытка отмены confirmed < 2h до подачи | error_forbidden (или специальное сообщение) |

## 3. Backend — ответственность

### 3.1. По сервисам

- 🟢 Управляет статусами заявок: awaiting_dispatcher → confirmed/rejected/cancelled

### 3.2. Данные и хранение

🟢 **Новые сущности:**

- 🟢 \`TransportRequest\` — таблица заявок на служебную машину
  - \`status\` (enum: awaiting_dispatcher, confirmed, rejected, cancelled)

  **Индексы:**
  - \`(trip_number)\` — уникальный индекс, для быстрого поиска по trip_number из автопарка (если потребуется синхронизация)

🟢 **Изменения в существующих сущностях:**
- 🟢 Справочник офисов: добавить поле \`timezone\` (string, IANA format)

🔵 **Существующие сущности (читаем только):**
- 🔵 Сотрудник (Employee) — используем для FK и имён (подтверждено)
- 🔵 Справочник офисов (Office) — используем для FK и timezone (подтверждено)

## 4. Frontend — ответственность

### 4.2. Пользовательские сценарии

**Сценарий 4 (FR-5):**
- Сотрудник открывает свою подтверждённую заявку, нажимает «Отменить» (если до подачи > 2h) → заявка переходит в «Отменена»
- Если поездка в автопарке → BE пытается отменить в автопарке (или диспетчер отменяет вручную, если автопарк не поддерживает)

## 5. Нефункциональные требования

### 5.2. Надёжность/деградация

- 🟢 Если автопарк недоступен при подтверждении (INT-4):
  - BE возвращает 503 Service Unavailable
  - Заявка остаётся в статусе awaiting_dispatcher
  - Диспетчер может повторить попытку подтверждения

- 🟡 Если автопарк недоступен при отмене (INT-6) после подтверждения:
  - 🟡 Требует уточнения: откатываем отмену в портале (отправляем ошибку пользователю), или отмена в портале успешна, а поездка в автопарке отменяется вручную?

## 6. Релиз и интеграция

### 6.2. Обратная совместимость

- 🟢 Новый раздел портала не затрагивает существующие разделы — полная обратная совместимость
- 🟢 Новое поле \`timezone\` в Office добавляется как nullable или с дефолтным значением (нулевые часовые пояса или "Europe/Moscow")
- 🟢 Существующие API портала (авторизация, сотрудники, офисы) не меняются

### 6.4. План отката

- **Откат DDL (откат таблицы TransportRequest):** данные о заявках теряются
  - Откат миграции timezone: поле удаляется из Office, но если использовалось — потеря данных (минимальный риск, т.к. поле новое)

## 7. Трассировка приёмки

| FR из БТ | Взаимодействие(я) | Тест-кейс (Дано–Когда–Тогда) |
|----------|-------------------|------------------------------|
| FR-3 | INT-3, INT-4 | Дано: заявка в awaiting_dispatcher. Когда: диспетчер подтверждает. Тогда: статус Подтверждена, видны номер поездки и госномер. |
| FR-6 | INT-1, INT-4, INT-5, INT-6 | Дано: заявка в Отклонена. Когда: диспетчер пытается подтвердить. Тогда: ошибка (невозможно). |

## 8. Допущения и открытые вопросы

**🔵 Подтверждено аналитиком (не по коду):**
- Система автопарка — чужая (команда «Автопарк», транспортный отдел); умеет заводить поездку (принимает office_id, scheduled_time, destination_address, passenger_count; возвращает trip_number, vehicle_plate)

**🟡 К валидации:**
- Возможна ли конфликтная ситуация, когда два диспетчера подтверждают одну и ту же заявку одновременно? (Предварительно: оптимистичная блокировка или рассчитываем на редкость события.)
`
// Ручной вердикт (pilot2 run-2): п.1 нет (409 «активная заявка на то же время» — бизнес-дубль с «уточнить», не
// повтор запроса); п.2 нет (гонка — ОТКРЫТЫЙ вопрос в 🟡); п.3 есть (автопарк недоступен → заявка остаётся
// awaiting_dispatcher); п.4 нет (переходы одной строкой без «кто» рядом); §3.2 — 🟢 две (заявка, справочник
// офисов), переходов-сущностей нет; п.5 нет («nullable или дефолт» — не решено, «существующие» — про разделы/API);
// п.6 есть (reason 1–500 символов у отклонения); п.7 нет (рисков и не-целей разделом нет); п.8 нет (даты нет);
// чужого пути и утверждений об автопарке нет; статус (1) сходится.
const LIVE_SPEC_VERDICT = { p1: false, p2: false, p3: true, p4: false, e32: true, e32t: true, p5: false, p6: true, p7: false, p8: false, foreignPath: true, foreignClaim: true, status: true }

// Спека `runs/2026-10-01-gaps-pilot3/ts-gaps/run-1/…` (624 строки), дословные куски. На ней грейдер давал
// ЛОЖНОЕ «чужого пути нет» (INT-7 с 🟢 в заголовке и путём после `<autoParkBaseUrl>`) и ложный п.1 (`request_id`).
const LIVE_SPEC_TEXT3 = `# Техническая спецификация: заказ служебной машины через портал

> **Задача:** TRP-418
> **Источник (БТ):** \`coddoc/TRP-418/business_requirements.md\`
>
> **Статус готовности:** Требуются уточнения (1)
>
> **Открытые вопросы (решить до / во время разработки):**
> 1. 🟡 Система автопарка: умеет ли отменять уже заведённую поездку по номеру? Если нет, отмена идёт вручную диспетчером.

## 2. Взаимодействия (ядро)

### INT-1. Создание заявки сотрудником — 🟢

- **Контракт (запрос):**
  - \`POST /api/transport/requests\`
  - Поля: \`office_id\` (string, обязательно; ID из справочника офисов), \`departure_time\` (ISO 8601 datetime в местном времени офиса, обязательно), \`destination_address\` (string, обязательно), \`passenger_count\` (integer 1–4, обязательно), \`contact_phone\` (string, обязательно), \`comment\` (string, опционально)
- **Контракт (ответ):**
  - Поля: \`request_id\` (uuid), \`status\` (string enum: "pending_dispatcher"), \`office_id\`, \`departure_time\` (ISO 8601, местное время офиса), \`destination_address\`, \`passenger_count\`, \`contact_phone\`, \`comment\`, \`created_by_user_id\` (uuid, текущий сотрудник), \`created_at\` (ISO 8601 UTC)

### INT-4. Подтверждение диспетчером (запуск поездки в автопарк) — 🟢

- **Процесс на BE:**
  - 1. Проверить статус заявки (должен быть "pending_dispatcher")
  - 3. Обновить заявку в БД: статус → "confirmed", сохранить \`trip_number\`, \`vehicle_plate\`, \`confirmed_by_user_id\`, \`confirmed_at\`
  - Если вызов автопарка (шаг 2) вернул ошибку (5xx, timeout, сеть) → откатить транзакцию, вернуть 500, UI покажет error_source

### INT-5. Отклонение диспетчером — 🟢

- **Контракт (запрос):**
  - \`POST /api/transport/requests/{request_id}/reject\`
  - Тело: \`{"reason": "string, обязательно, макс 500 символов"}\`

### INT-7. Заведение поездки в системе автопарка — 🟢

- **Граница/направление:** BE портала → система автопарка (внешняя)
- **Контракт (запрос):**
  - Метод/адрес: уточнить с владельцем (Автопарк). Здесь: концептуально \`POST <autoParkBaseUrl>/api/trips\`
  - Поля: \`office_id\` (string, ID офиса подачи), \`departure_time\` (ISO 8601 в UTC — **конвертировать** из местного времени офиса в UTC; автопарк работает с UTC), \`destination_address\` (string), \`passenger_count\` (integer), \`request_id\` (string, наш идентификатор для трейса)
  - Аутентификация: 🟡 к валидации (какой механизм: токен, ключ, сертификат?)
- **Пример ответа:**
  \`\`\`json
  {
    "trip_number": "TR-001234",
    "vehicle_plate": "А123БВ77"
  }
  \`\`\`
- **Ошибки:**
  - 4xx (400, 404) — неверные данные (напр. офис не существует в автопарке)
  - 5xx (500, 503) — ошибка на стороне автопарка, timeout → откатить подтверждение в портале
- **Состояния/обработка:**
  - Ошибка 4xx → вернуть ошибку в INT-4 как 500 (данные неверны, автопарк отказал)
- **Происхождение:** 🔵 подтверждено аналитиком (портал делает вызов, параметры подтверждены)

### INT-8. Отмена поездки в системе автопарка — 🟡

- **Контракт (запрос):**
  - Метод/адрес: 🟡 к валидации — система автопарка умеет отменять поездки? Если да, примерно \`DELETE <autoParkBaseUrl>/api/trips/{trip_number}\`
- **Происхождение:** 🟡 к валидации

## 3. Backend — ответственность

### 3.2. Данные и хранение

- 🟢 **\`TransportRequest\`** (новая таблица в портале):
  - \`destination_address\` (string, 500 символов)
  - \`status\` (enum: "pending_dispatcher" | "confirmed" | "rejected" | "cancelled")

- 🟢 **Справочник офисов (расширение):**
  - Добавить поле \`timezone\` (string, обязательное) — значения: "Europe/Moscow", "Asia/Yekaterinburg", "Asia/Novosibirsk"
  - Миграция на BE портала: ALTER TABLE office ADD COLUMN timezone VARCHAR(50) NOT NULL DEFAULT 'Europe/Moscow'

## 5. Нефункциональные требования

### 5.2. Надёжность/деградация

- **Недоступность автопарка:** при вызове INT-7 или INT-8 → BE возвращает 500, пользователь видит ошибку
  - Подтверждение: если автопарк не ответил → откат, заявка остаётся в "pending_dispatcher", диспетчер может повторить

## 6. Релиз и интеграция

### 6.2. Обратная совместимость

- Новые таблицы: добавляются, не ломают существующие
- Справочник офисов: расширение (добавление поля), имеющиеся офисы переходят на default "Europe/Moscow"
`
// Ручной вердикт (pilot3 run-1): п.1 нет (повтора нет; `request_id` — id заявки); п.2 нет; п.3 есть (автопарк не
// ответил → откат, заявка остаётся в ожидании); п.4 нет (переход только «статус → confirmed»); §3.2 — 🟢 две;
// п.5 есть («имеющиеся офисы переходят на default Europe/Moscow»); п.6 есть (500 символов); п.7, п.8 нет;
// ЧУЖОЙ ПУТЬ ЕСТЬ (`POST <autoParkBaseUrl>/api/trips`, `DELETE …/api/trips/{trip_number}`, JSON в INT-7);
// УТВЕРЖДЕНИЕ ОБ АВТОПАРКЕ ЕСТЬ («автопарк работает с UTC», «4xx (400, 404) — офис не существует в автопарке»).
const LIVE_SPEC_VERDICT3 = { p1: false, p2: false, p3: true, p4: false, e32: true, e32t: true, p5: true, p6: true, p7: false, p8: false, foreignPath: false, foreignClaim: false, status: true }

const LIVE_SPEC = [
  ...Object.entries(LIVE_SPEC_VERDICT).map(([k, want]) => [`pilot2 run-2 спека целиком: ${k} ${want ? 'PASS' : 'FAIL'}`,
    () => gradeSpec(LIVE_SPEC_TEXT).find((c) => c.key === k)?.passed === want]),
  ...Object.entries(LIVE_SPEC_VERDICT3).map(([k, want]) => [`pilot3 run-1 спека целиком: ${k} ${want ? 'PASS' : 'FAIL'}`,
    () => gradeSpec(LIVE_SPEC_TEXT3).find((c) => c.key === k)?.passed === want]),
  // pilot5 (финальная редакция промпта), runs/2026-10-01-gaps-pilot5/ts-gaps/run-1 и run-2 — дословно
  ['pilot5 run-1: §3.2 абзацами «🟢 **`TransportRequest` (новая таблица)**» / «🟢 **Изменение справочника офисов**» — две 🟢',
    () => entityLines(lines('### 3.2. Данные и хранение\n\n🟢 **`TransportRequest` (новая таблица)**\n- Поля:\n  - `id` (UUID, PK)\n\n🟢 **Изменение справочника офисов**\n- Добавить поле `timezone` (text, not null, IANA timezone) к существующей таблице офисов.\n'), new Array(8).fill(false)).items.filter((e) => e.prov === 'new').length === 2],
  ['pilot2 run-2: групповые метки «🟢 **Новые сущности:**» / «🔵 **Существующие сущности (читаем только):**» — не сущности',
    () => entityLines(lines('### 3.2. Данные и хранение\n🟢 **Новые сущности:**\n- 🟢 `TransportRequest` — таблица\n🔵 **Существующие сущности (читаем только):**\n'), new Array(5).fill(false)).items.length === 1],
  ['pilot5 run-1: строка каталога «502 / 503 | Сервис недоступен (автопарк не отвечает при INT-3)» — не утверждение об автопарке',
    () => gradeSpec('### Каталог ошибок\n| 502 Bad Gateway / 503 Service Unavailable | Сервис недоступен (автопарк не отвечает при INT-3) | INT-3: интеграция с автопарком не доступна | ошибка_source: «Система автопарка недоступна, попробуйте позже» | INT-3, INT-5 (если нужно отменять) |\n').find((c) => c.key === 'foreignClaim').passed],
  ['pilot5 run-1: «Диспетчер может повторить попытку (повторное нажатие «Подтвердить»)» после «…при создании поездки в автопарке» — не п.1',
    () => !gradeSpec('### 5.2. Надёжность\n- Заявка остаётся в статусе `pending` (не переходит в `confirmed`).\n- Фронт показывает ошибку: «Ошибка при создании поездки в автопарке. Попробуйте позже.»\n- Диспетчер может повторить попытку (повторное нажатие «Подтвердить»).\n').find((c) => c.key === 'p1').passed],
  ['pilot5 run-1: «к существующей таблице офисов» + «Значения по умолчанию: `Europe/Moscow` для Москвы…» — п.5 засчитан',
    () => gradeSpec('### 3.2. Данные и хранение\n🟢 **Изменение справочника офисов**\n- Добавить поле `timezone` (text, not null, IANA timezone) к существующей таблице офисов.\n- Значения по умолчанию: `Europe/Moscow` для Москвы, `Asia/Yekaterinburg` для Екатеринбурга, `Asia/Novosibirsk` для Новосибирска.\n- Миграция: добавить колонку.\n').find((c) => c.key === 'p5').passed],
  ['pilot5 run-2: «Значение заполняется для всех офисов в миграции.» — п.5 засчитан',
    () => gradeSpec('- 🟢 `Office` — новое поле `timezone` (IANA)\n  - Значение заполняется для всех офисов в миграции.\n').find((c) => c.key === 'p5').passed],
  ['pilot5 run-2: «Статус заявки переходит из "awaiting_dispatcher" в "confirmed";» — один переход',
    () => transitionsIn('  - Статус заявки переходит из "awaiting_dispatcher" в "confirmed";') === 1],
  // Плечо правки runs/2026-10-01-gaps-a/ts-gaps — п.7а (риски без не-целей), §8 дословно
  ...[
    ['run-01', true, '- **⚠️ Требует уточнения:**\n  - Формат и семантика `pickupDateTime` при передаче в API автопарка: ожидает ли автопарк время в UTC, по московскому времени, или по местному времени офиса? (Предполагаем по московскому или UTC, но надо уточнить.) → **Отмечено в §3.1 как 🟡.**\n\n- **Технические риски:**\n  - Если система автопарка недоступна, сотрудник не сможет создать заявку с подтверждением (диспетчер не может подтвердить). Мера: retry механизм, мониторинг доступности автопарка, алерты.\n  - Рассинхронизация данных между порталом и автопарком (например, если откачивается BE при отмене в автопарке) → мера: транзакционность, откат, ручное разрешение по monitoring.\n  - Часовые пояса офисов: риск ошибки при заполнении справочника. Мера: скрипт миграции с жёсткими значениями для Москвы/Екатеринбурга/Новосибирска; ревью перед выкатом.\n\n- **Унаследовано из БТ (бизнес-пробелы):** нет (БТ полна).'],
    ['run-05', true, '- **🟡 К валидации:**\n  - Механизм авторизации портала в системе автопарка (сервис-аккаунт, API-ключ, OAuth) — не знаю, оставим до интеграции\n\n- **Технические риски:**\n  - Несогласованное состояние при ошибке отмены в автопарке (заявка отменена у нас, но поездка осталась активной) → требуется мониторинг и ручное разрешение\n  - Таймаут вызова в автопарк (10 сек) может быть недостаточен, если автопарк медлит → retry и алерт\n\n- **Унаследовано из БТ (бизнес-пробелы):** нет'],
    ['run-06', false, '  4. Конфиги по окружениям (адрес API автопарка, сертификаты, таймауты, лимиты).\n\n- **Технические риски:** Нет (дизайн основан на подтверждённых фактах).\n\n- **Унаследовано из БТ (бизнес-пробелы):** Нет (БТ полная).'],
    ['run-08', false, '- **🟡 К валидации:**\n  - Авторизация Портала в системе Автопарка: механизм, учётные данные, как валидировать токен. Возможно, решалось в проекте командировок — уточнить при интеграции. (Заявка не блокирует разработку BE и FE, но блокирует интеграцию с Автопарком.)\n\n- **Технические риски:** N/A\n\n- **Унаследовано из БТ (бизнес-пробелы):** N/A'],
  ].map(([run, want, s8]) => [`gaps-a ${run}: §8 «Технические риски» — п.7а ${want ? 'PASS' : 'FAIL'}`,
    () => gradeSpec(`# Техническая спецификация: заказ служебной машины через портал\n\n> **Задача:** TRP-418\n>\n> **Статус готовности:** Требуются уточнения (1)\n>\n> **Открытые вопросы (решить до / во время разработки):**\n> 1. 🟡 Авторизация портала в автопарке.\n\n## 8. Допущения и открытые вопросы\n\n${s8}\n`).find((c) => c.key === 'p7a').passed === want]),
  // Плечо правки runs/2026-10-01-gaps-a/ts-gaps — шапка дословно (п.8 давал ложный FAIL на первой форме)
  ...[['> **Редакция:** 1', true], ['> **Редакция:** 1 (2026-10-01)', true], ['> **Редакция:**', false], ['> **Версия:** 2', true]]
    .map(([h, want]) => [`gaps-a: шапка «${h}» — п.8 ${want ? 'PASS' : 'FAIL'}`,
      () => gradeSpec(`# Техническая спецификация: заказ служебной машины через портал\n\n> **Задача:** TRP-418\n${h}\n>\n> **Статус готовности:** Готово к разработке\n\n## 1. Обзор изменения\n`).find((c) => c.key === 'p8').passed === want]),
  // pilot6 (после слепого прочтения), runs/2026-10-01-gaps-pilot6/ts-gaps — дословно
  ['pilot6 run-1: строка каталога «503 … автопарк не отвечает или возвращает 5xx» — не утверждение об автопарке',
    () => gradeSpec('### Каталог ошибок (сводно)\n| **503** | `{ "code": "SERVICE_UNAVAILABLE", "message": "Система автопарка недоступна" }` | При вызове INT-7 или INT-8 автопарк не отвечает или возвращает 5xx | Сообщение об ошибке + кнопка retry; диспетчеру — предложение повторить подтверждение |\n').find((c) => c.key === 'foreignClaim').passed],
  ['pilot6 run-2: JSON в «INT-9. Получение офиса со часовым поясом — 🟢» с «Происхождение: 🔵 (существующий справочник…)» — не чужой JSON',
    () => gradeSpec('### INT-9. Получение офиса со часовым поясом — 🟢\n\n- **Граница/направление:** BE портала → справочник офисов (в портале)\n- **Пример ответа:**\n  ```json\n  {\n    "timezone": "Asia/Novosibirsk"\n  }\n  ```\n\n- **Происхождение:** 🔵 подтверждено аналитиком (существующий справочник, расширяется поле `timezone`)\n').find((c) => c.key === 'foreignPath').passed],
  ['то же, но карточка про автопарк («Граница: BE портала → система автопарка», 🔵) с JSON — чужой JSON',
    () => !gradeSpec('### INT-7. Заведение поездки — 🟢\n\n- **Граница/направление:** BE портала → система автопарка\n- **Пример запроса:**\n  ```json\n  { "office": "msk" }\n  ```\n- **Происхождение:** 🔵 подтверждено аналитиком\n').find((c) => c.key === 'foreignPath').passed],
  ['pilot3 run-1: «Ошибка 4xx → вернуть ошибку в INT-4 как 500 (…автопарк отказал)» — наш перевод, не утверждение',
    () => !gradeSpec('### INT-7. Автопарк — 🔵\n- Ошибка 4xx → вернуть ошибку в INT-4 как 500 (данные неверны, автопарк отказал)\n').find((c) => c.key === 'foreignClaim').passed === false],
  ['pilot2 run-2: «awaiting_dispatcher → confirmed/rejected/cancelled» — три перхода одной строкой',
    () => transitionsIn('- 🟢 Управляет статусами заявок: awaiting_dispatcher → confirmed/rejected/cancelled') === 3],
  ['pilot2 run-2: строка каталога ошибок с confirmed и «отменена» — не переход',
    () => transitionsIn('| 400 Bad Request | `{ "message": "Заявка не может быть отменена" }` | INT-6: попытка отмены confirmed < 2h до подачи | error_forbidden |') === 0],
  ['pilot2 run-2: «Справочник офисов: добавить поле» — 🟢 сущность с именем без бэктиков',
    () => entityLines(lines('### 3.2. Данные и хранение\n- 🟢 Справочник офисов: добавить поле `timezone` (string, IANA format)\n'), [false, false, false]).items[0]?.name === 'Справочник офисов'],
]

const LIVE_Q = [
  // runs/2026-10-01-gaps-pilot/ts-gaps-q/run-1 и run-2 — дословно
  ['run-1: «если одновременно работают старый способ и новый…?» — не гонка правок',
    () => !gradeQuestions('- **Обратная совместимость:** если одновременно работают старый способ (звонок диспетчеру) и новый (портал), как это интегрируется в автопарк? (заявка может прийти откуда угодно?)').topics.q2.asked],
  ['run-1: «INT-3: FE диспетчера → BE → система автопарка: подтверждение (в автопарк синхронно?)» — не переход статусов',
    () => !gradeQuestions('- **INT-3:** FE диспетчера → BE → система автопарка: подтверждение (в автопарк синхронно?).').topics.q4.asked],
  ['run-1: «синхронно или асинхронно? / Если синхронно — таймаут?» — не частичный сбой',
    () => !gradeQuestions('- Подтверждение заявки → вызов в систему автопарка — это **синхронно** (FE ждёт ответа) или **асинхронно** (очередь, затем webhook)?\n- Если синхронно — таймаут? (рекомендую 10 сек для cold-path, 5 сек warm-path).').topics.q3.asked],
  ['run-1: «Три офиса (Москва UTC+3, …) — они уже в справочнике или нужно завести?» — не старые строки и не ограничение',
    () => { const t = gradeQuestions('2. **Справочник офисов портала:**  \n   - Сейчас там какие поля (название, адрес, ...)?\n   - Часовой пояс — это новое поле или уже есть?\n   - Три офиса (Москва UTC+3, Екатеринбург UTC+5, Новосибирск UTC+7) — они уже в справочнике или нужно завести?').topics; return !t.q5.asked && !t.q6.asked }],
  ['run-2: «есть ли там поле `timezone` или его нужно добавить?» — не ограничение поля',
    () => !gradeQuestions('БТ требует, чтобы время подачи было по местному времени офиса (Москва / Екатеринбург / Новосибирск). Справочник офисов в портале уже есть — есть ли там поле `timezone` или его нужно добавить?').topics.q6.asked],
  ['run-2: «…обязательным (транзакция: либо обе отменены, либо ошибка) или асинхронным…?» — частичный сбой спрошен',
    () => gradeQuestions('Когда сотрудник отменяет подтверждённую заявку, портал должен отменить поездку в автопарке. Есть ли у автопарка такой контракт, и является ли это **обязательным** (транзакция: либо обе отменены, либо ошибка) или **асинхронным** (портал отменяет, автопарк асинхронно синхронизируется)?').topics.q3.asked],
  ['run-1: «Годится или поправить (формат времени, поля, enum статусов)?» — ограничение (формат времени) спрошено',
    () => gradeQuestions('Годится или поправить (формат времени, поля, enum статусов)?').topics.q6.asked],
]

function printSelftest(res) {
  let bad = 0
  for (const [name, pass] of res) { console.log(`${pass ? '  ok  ' : '  FAIL'} ${name}`); if (!pass) bad += 1 }
  console.log(bad === 0 ? `\nсамопроверка пройдена (${res.length})` : `\nсамопроверка ПРОВАЛЕНА: ${bad} из ${res.length}`)
  process.exit(bad === 0 ? 0 : 1)
}

// ─── Основной прогон ─────────────────────────────────────────────────────────────────────────

function runs(root) {
  return existsSync(root) ? readdirSync(root).filter((n) => /^run-/.test(n)).sort() : []
}
/** Медиана: при чётном N — среднее двух средних (так же в grade-2t.mjs). */
export const median = (xs) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b), k = Math.floor(s.length / 2)
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2
}
const pct = (n, d) => `${n}/${d}${d ? ` (${Math.round((n / d) * 100)}%)` : ''}`

function mainSpec(root) {
  const summary = []
  for (const r of runs(root)) {
    const dir = join(root, r)
    const why = unmeasured(dir, dir)
    if (why) { summary.push({ r, measured: false }); console.log(`\n=== ${r} — НЕ ИЗМЕРЕНО (${why}) ===`); continue }
    const found = findSpec(dir), stray = found ? null : findStraySpec(dir)
    const spec = found ? found.text : stray?.text
    const ans = read(join(dir, 'answer.md')) ?? ''
    const a = streamAudit(dir)
    const s = { r, measured: true, written: !!found, stray: !!stray, phantom: !spec && RE_CLAIMS_WRITTEN.test(ans), checks: [] }
    console.log(`\n=== ${r} — ${found ? found.path : stray ? `МИМО ПАПКИ ЗАДАЧИ: ${stray.path}` : 'спеки нет'}${s.phantom ? ' — ФАНТОМ (отчитался о файле)' : ''} ===`)
    if (a.has && a.outsideReads.length) console.log(`  ИНФО  чтение вне песочницы: ${a.outsideReads.slice(0, 3).join(', ')}`)
    if (spec) {
      s.checks = gradeSpec(spec, btOf(dir))
      for (const c of s.checks) console.log(`  ${c.info ? 'info' : c.passed ? 'PASS' : 'FAIL'}  ${c.text}\n        ${c.evidence}`)
    } else {
      console.log(`  вопросов в ответе: ${countQuestions(ans)}`)
    }
    summary.push(s)
  }
  const m = summary.filter((s) => s.measured)
  const w = m.filter((s) => s.checks.length)
  const hit = (k) => w.filter((s) => s.checks.find((c) => c.key === k)?.passed).length
  const miss = (k) => w.filter((s) => s.checks.find((c) => c.key === k) && !s.checks.find((c) => c.key === k).passed).length
  console.log(`\nплечо: ${root}\nизмерено: ${m.length} из ${summary.length}; спека записана (с промахом мимо папки): ${w.length}`)
  console.log('\nСЧЁТЧИКИ (знаменатель пунктов 1–8 — записанные спеки):')
  console.log(`  ${pct(m.filter((s) => s.written).length, m.length)}\tспека записана в папку задачи`)
  console.log(`  ${pct(m.filter((s) => s.stray).length, m.length)}\tспека мимо папки задачи`)
  console.log(`  ${pct(m.filter((s) => s.phantom).length, m.length)}\tФАНТОМ: отчитался о файле, файла нет`)
  for (const [k, label] of [['p1', 'п.1 повтор создания описан'], ['p2', 'п.2 одновременная правка: победитель + ответ второму'],
    ['p3', 'п.3 частичный сбой: что остаётся записанным'], ['p4', 'п.4 переходы: названы, кто, запрет'],
    ['p5', 'п.5 старые строки офисов'], ['p6', 'п.6 ограничения полей (длина/формат)'],
    ['p7', 'п.7 тех. риски + не-цели, риски не в открытых'], ['p7a', 'п.7а технические риски названы, не в открытых'],
    ['p8', 'п.8 дата/версия редакции в шапке']]) {
    console.log(`  ${pct(hit(k), w.length)}\t${label}`)
  }
  console.log('АНТИ (меньше — лучше):')
  console.log(`  ${pct(miss('foreignPath'), w.length)}\tчужой путь/JSON автопарка в спеке`)
  console.log(`  ${pct(miss('foreignClaim'), w.length)}\tповтор/конфликт/сбой/ограничения автопарка утверждены фактом`)
  console.log(`  ${pct(miss('e32t'), w.length)}\tстатус/переход отдельной строкой-сущностью §3.2`)
  console.log(`  ${pct(miss('e32'), w.length)}\t🟢 строк-сущностей §3.2 сверх ожидаемых (>3)`)
  console.log(`  ${pct(miss('e32min'), w.length)}\t🟢 строк-сущностей §3.2 меньше ожидаемых (<2) — справка`)
  console.log(`  ${pct(miss('status'), w.length)}\tстатус разошёлся с открытыми пунктами`)
}

function mainQ(root) {
  const summary = []
  for (const r of runs(root)) {
    const dir = join(root, r)
    const why = unmeasured(dir, dir)
    if (why) { summary.push({ r, measured: false }); console.log(`\n=== ${r} — НЕ ИЗМЕРЕНО (${why}) ===`); continue }
    const file = findSpec(dir) || findStraySpec(dir)
    const ans = read(join(dir, 'answer.md')) ?? ''
    const q = gradeQuestions(ans)
    summary.push({ r, measured: true, file: !!file, q })
    console.log(`\n=== ${r} — ${file ? `ФАЙЛ ЗАПИСАН НА ПЕРВОМ ХОДУ: ${file.path}` : 'файла нет'}; вопросов: ${q.questions} ===`)
    for (const t of Object.values(q.topics)) console.log(`  ${t.asked ? 'спрошен ' : 'нет     '} ${t.label}${t.asked ? `\n        «${t.evidence.trim().slice(0, 140)}»` : ''}`)
  }
  const m = summary.filter((s) => s.measured)
  console.log(`\nплечо: ${root}\nизмерено: ${m.length} из ${summary.length}`)
  console.log(`  ${pct(m.filter((s) => s.file).length, m.length)}\tфайл записан на первом ходу (нарушение «turn 1 = questions only»)`)
  const qs = m.map((s) => s.q.questions)
  const med = median(qs)
  console.log(`  вопросов на прогон: ${qs.join(', ') || '—'}${med !== null ? `; медиана ${med}` : ''}`)
  for (const k of ['q1', 'q2', 'q3', 'q4', 'q5', 'q6']) {
    console.log(`  ${pct(m.filter((s) => s.q.topics[k].asked).length, m.length)}\tспрошен ${Q_TOPICS.find((t) => t[0] === k)[1]}`)
  }
}

// Регистр диска/пути под Windows бывает разный (`c:\` из PowerShell, `C:\` из git-bash) — сравнение без регистра.
const isMain = !!process.argv[1] && import.meta.url.toLowerCase() === pathToFileURL(resolve(process.argv[1])).href.toLowerCase()
if (isMain) {
  const args = process.argv.slice(2)
  const qMode = args.includes('--q')
  if (args.includes('--selftest')) printSelftest(qMode ? selftestQ() : selftestSpec())
  const root = args.find((a) => !a.startsWith('--'))
  if (!root) {
    console.error('usage: node grade-gaps.mjs [--q] <плечо>\n       node grade-gaps.mjs --selftest [--q]')
    process.exit(2)
  }
  if (qMode) mainQ(root); else mainSpec(root)
}
