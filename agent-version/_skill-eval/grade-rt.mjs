#!/usr/bin/env node
// grade-rt.mjs — пробы rt-bug / rt-feature / rt-menu / rt-nokey: МАРШРУТ проводника,
// под-скиллы заглушены.
//
//   node grade-rt.mjs <каталог с песочницами> --probe=bug|feature|menu|nokey|noreview|check|fix|other|epic|gate|feature-gate
//   node grade-rt.mjs --selftest
//
// ГЕЙТ 2Б (2026-09-22): после ЗАПИСИ документа сверху вопрос «идём дальше?» задаётся всегда
// (1.2.0); готовый документ идёт мимо приёмки и гейта (1.3.0). Меряется ПО ХОДАМ (`stream*.jsonl` +
// `answer-NN.md`). `feature-gate` — БТ пишет заглушка: спека обязана запуститься ходом, следующим за
// вопросом. `gate` — БТ готов на диске: приёмки и вопроса нет, спека первым ходом. На остальных
// плечах те же счётчики печатаются справкой.
//
// ПОРЯДОК НА ВХОДЕ (плечи `menu` и `nokey`, заведены 2026-08-18). До правки маршрут спрашивал
// ключ задачи ДВАЖДЫ: `analyst-workspace` своим ходом между меню «БТ или баг» и запуском
// под-скилла, и следом сам под-скилл своим Gate 0. Лишний ход убран, порядок теперь один:
// кнопка → меню из двух вариантов → под-скилл; ключ спрашивает только под-скилл.
//
// Плечи `bug` и `feature` этого не видят по построению: ключ подан в их промптах строкой
// «Ключ задачи: …», и к моменту развилки спрашивать уже нечего. На них тот же анкер работает
// как ПЕРЕСПРАШИВАНИЕ (ключ дан — значит любая просьба его назвать лишняя), на `menu`/`nokey` —
// как лишний ход. Событие одно, смысл разный, поэтому счётчик печатается на всех четырёх.
//
// ЧТО ГРЕЙДИТСЯ. `_trace.log` — файл, который заглушки пишут на диск, вызванные по-настоящему.
// НЕ отчёт агента: он может рассказать о вызове, не сделав его, и наоборот. Правило репы
// «грейдить файл, а не формулировку» здесь означает «грейдить след вызова, а не пересказ».
//
// ПОЧЕМУ ТРАССА, А НЕ ПОТОК. Поток (`stream.jsonl`) показал бы вызовы точнее, но заглушка пишет
// в трассу ещё и ПЕРЕДАННОЕ (источник, флаг багфикса), чего в имени вызова нет. Поток остаётся
// вторым источником: по нему `check-escape.mjs` доказывает побег.
//
// ПРАВИЛА: регулярки литеральные; `\b`/`\w` рядом с кириллицей НЕ применять; побег — «не
// измерено»; счётчик на каждый дефект.

import { readdirSync, readFileSync, existsSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const RE_API_FAILURE = /API Error|Request not allowed|Please run \/login|Credit balance|rate limit|session limit|usage limit/i

/**
 * НАСТОЯЩАЯ просьба назвать ключ, а не упоминание ключа в отчёте.
 * Анкер взят дословно из `grade-bg.mjs`, где он уже прошёл починку: первая редакция там искала
 * подстроку «ключ задачи» и печатала «ключ переспрошен» 11 из 12, потому что под неё попадала
 * строка реестра `Ключ задачи (ARS-312) — ✅`, то есть отчёт о ЗАКРЫТОМ гейте. Копия намеренная:
 * два грейдера меряют одно событие, и расходиться анкерам нельзя.
 */
const RE_ASKS_KEY = /(укажите|назовите|пришлите|сообщите|дайте|нужен|требуется|не передан|не указан)[^.\n]{0,40}ключ|ключ[^.\n]{0,40}(не передан|не указан|❓)/i

/**
 * Половины кнопки Шага 1Б. Проверяются ОБЕ: один вариант — это не развилка, а утверждение.
 * `\b`/`\w` рядом с кириллицей не применяются — правило репы, `\b` считается по [A-Za-z0-9_].
 */
const RE_OPT_BT = /бизнес-требован|идею в БТ|новая возможност|нового функционал/i
const RE_OPT_BUG = /баг-репорт|баг-репорте|сломанное поведение/i

/**
 * НЕ ТОТ ШАГ. Первая редакция `showsMenu` была слепой, и слепа она была по построению: подпись
 * стартовой кнопки Шага 1 — «Бизнес: Переводим Идею в БТ, баг — в баг-репорт», а пояснение рядом
 * с ней — «новая возможность идёт в бизнес-требования, сломанное поведение — в баг-репорт».
 * В ней СИДЯТ ОБЕ половины, которые ищут `RE_OPT_BT` и `RE_OPT_BUG`. Значит прогон, который
 * ПЕРЕСПРОСИЛ стартовый вопрос Шага 1 вместо развилки Шага 1Б (а это нарушение правила 2 — ответ
 * уже дан), получал зелёное. Отличаем по соседям: у Шага 1 четыре варианта, и три остальных на
 * Шаге 1Б появиться не могут.
 */
const RE_STEP1_NEIGHBOURS = /Продолжить начатое|обновить описание сервисов|Создаем Спецификацию|создаём спецификацию|готового документа/i

/**
 * УЗЕЛ «ЧТО ДАЛЬШЕ?» (`analyst-workspace` 2.0.0): после спеки — один вопрос из четырёх вариантов,
 * порядок — константа: Проверить спеку → Доработать спеку → Разбить на этапы → Начать другую задачу.
 * Узел опознаётся в ответе ОДНОГО хода по всем четырём подписям; порядок — по первому вхождению
 * каждой. Старый флоу (хвост Шага 5, развилка из 1.3.0) ловится отдельными счётчиками.
 */
const NODE_LABELS = [/Проверить спек/i, /Доработать спек/i, /Разбить (спек[уи] (эпика )?)?на этапы/i, /Начать другую задачу/i]
const RE_OLD_STATION = /запустите[^.\n]{0,20}\/spec-readiness/i
const RE_OLD_SPLIT = /Нет, спеки достаточно|Разбить спек[уи][^.\n]{0,30}на этапы\?/i
const RE_OLD_OPTIONS = /Взять следующий узел|На сегодня закончить/i

/**
 * Узел в тексте ответа: показаны ли все четыре подписи и стоят ли они в постоянном порядке. Порядок —
 * ПОДПОСЛЕДОВАТЕЛЬНОСТЬЮ: каждая подпись ищется после предыдущей. По первым вхождениям нельзя: строка
 * про архивацию перед узлом («… выберите «Начать другую задачу» → «Доработка готова»», Sonnet 2/2 на
 * `rt-epic`) ставила четвёртую подпись раньше первой, и верный узел читался как перестановка.
 */
export function nodeIn (text) {
  const shown = NODE_LABELS.every((re) => re.test(text))
  let pos = 0
  let ordered = shown
  for (const re of NODE_LABELS) {
    if (!ordered) break
    const m = re.exec(text.slice(pos))
    if (!m) ordered = false; else pos += m.index + m[0].length
  }
  return { shown, ordered }
}

/**
 * ГЕЙТ ШАГА 2Б (правка 1.2.0, 2026-09-22): вопрос «документ принят — идём дальше?» задаётся ВСЕГДА,
 * и это единственная остановка между документом сверху и `technical-spec-doc`. Меряется не по
 * склейке, а ПО ХОДАМ: спека обязана запуститься ходом, СЛЕДУЮЩИМ за тем, в котором задан вопрос.
 * Склейка `answer.md` порядок не хранит — по ней «вопрос задан» и «спека запущена в том же ходу»
 * неразличимы, а второе и есть дефект.
 *
 * Анкер — обе формы из текста скилла: вопрос («идём дальше?») и подпись варианта («Идти дальше —»).
 * `\b` рядом с кириллицей не применяется.
 */
// «Продолжаем …?» — живая формулировка Haiku (пилот 2026-10-01: «Продолжаем писать техническую спеку на
// SMSEC-77?»): вопрос задан, анкер его не видел. Ловится только вопросительная форма.
const RE_GATE = /ид[её]м дальше|идти дальше|продолжаем[^.\n?]{0,80}\?/i

/**
 * Ход, в котором запущена спека, по потоку `stream*.jsonl` этого хода. Запуск опознаётся по любому
 * из следов: вызов `Skill` с именем, чтение `SKILL.md` заглушки, запись её строки в `_trace.log`
 * (`Bash`/`Write`/`Edit`). Один след достаточен: нужен ХОД, а не способ.
 */
export function turnLaunches (streamText, name) {
  const read = new RegExp(name + '[\\\\/]SKILL\\.md')
  for (const line of streamText.split(/\r?\n/)) {
    if (!line.includes(name)) continue
    let j; try { j = JSON.parse(line) } catch { continue }
    const c = j.message?.content
    if (!Array.isArray(c)) continue
    for (const b of c) {
      if (b.type !== 'tool_use') continue
      const i = b.input ?? {}
      if (b.name === 'Skill' && (i.skill ?? '').includes(name)) return true
      if (b.name === 'Read' && read.test(i.file_path ?? '')) return true
      // имя скилла — как запись трассы (`echo "<скилл> …" >> _trace.log`), не как кусок пути: путь песочницы может
      // содержать имя скилла (ворктри `rehearse`)
      if (b.name === 'Bash' && new RegExp(`(?:echo|printf)\\s+(?:-\\w+\\s+)?["']?${name}[\\s"']`).test(i.command ?? '') && /_trace/.test(i.command ?? '')) return true
      if ((b.name === 'Write' || b.name === 'Edit') && /_trace\.log/.test(i.file_path ?? '') &&
        ((i.content ?? '') + (i.new_string ?? '')).includes(name)) return true
    }
  }
  return false
}
export const turnLaunchesSpec = (streamText) => turnLaunches(streamText, 'technical-spec-doc')

/** Номер хода (с 1), в котором запущен под-скилл; 0 — не запущен. Ход 1 — `stream.jsonl`, дальше `stream-NN.jsonl`. */
export function skillTurn (dir, name) {
  const streamOf = (k) => join(dir, k === 1 ? 'stream.jsonl' : `stream-${String(k).padStart(2, '0')}.jsonl`)
  for (let k = 1; k <= 16; k++) {
    const p = streamOf(k)
    if (!existsSync(p)) { if (k === 1) continue; break }
    if (turnLaunches(readFileSync(p, 'utf8'), name)) return k
  }
  return 0
}
export const specTurn = (dir) => skillTurn(dir, 'technical-spec-doc')

/** Ответы всех ходов по порядку: `answer-NN.md`, у одноходового — `answer.md`. */
function turnAnswers (dir) {
  const out = []
  for (let k = 1; k <= 16; k++) {
    const t = answerOfTurn(dir, k)
    if (!t && k > 1) break
    out.push(t)
  }
  return out
}

/** Текст ответа хода k: `answer-NN.md` у многоходового прогона, `answer.md` — у одноходового. */
export function answerOfTurn (dir, k) {
  const p = join(dir, `answer-${String(k).padStart(2, '0')}.md`)
  if (existsSync(p)) return readFileSync(p, 'utf8')
  if (k === 1 && existsSync(join(dir, 'answer.md'))) return readFileSync(join(dir, 'answer.md'), 'utf8')
  return ''
}

/**
 * Просьба, ПЕРЕАДРЕСОВАННАЯ под-скиллу, просьбой проводника не является: «ключ спросит
 * `bug-report-doc`» — это исполнение правила, а не его нарушение. Без этого исключения анкер
 * красил бы верное поведение: в хендоффе полного маршрута про ключ сказать законно.
 */
const RE_KEY_DELEGATED = /(спросит|запросит|уточнит|соберёт|соберет)[^.\n]{0,60}(под-скилл|подскилл|скилл|bug-report-doc|business-requirements-doc)|(под-скилл|подскилл|bug-report-doc|business-requirements-doc)[^.\n]{0,60}(спросит|запросит|уточнит)/i

export function isApiFailure (t) {
  if (!t) return true
  if (t.length > 600) return false
  return RE_API_FAILURE.test(t.slice(0, 300))
}

/** Строки трассы → массив имён под-скиллов в порядке вызова. */
export function parseTrace (text) {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
}

const REPLACEMENT = String.fromCharCode(0xFFFD)

/**
 * ЧТЕНИЕ ТРАССЫ С ПОДБОРОМ КОДИРОВКИ.
 *
 * Поймано 2026-08-20 на прогоне base10/run-04: строка трассы пришла как
 * `technical-spec-doc ????????=coddoc/... ????=???????` — латиница цела, кириллица мусор.
 * Причина виндовая и не наша: заглушка велит «допиши строку в `_trace.log`», агент дописывает
 * её PowerShell'ом, а `Add-Content` по умолчанию пишет системной кодировкой (cp1251), не UTF-8.
 *
 * Цена дефекта — ЛОЖНАЯ НАХОДКА: анкеры «источник=» и «флаг=» по такой строке не срабатывают, и
 * прогон с ПОЛНЫМ маршрутом читается как «спека запущена без флага багфикса». Ровно тот класс,
 * против которого заведено правило репы «грейдить файл, а не формулировку»: файл-то мы читаем,
 * но читаем не теми байтами.
 *
 * Чиним на стороне ЧТЕНИЯ, а не в заглушке: правка фикстуры обнулила бы базу, снятую тем же днём.
 * Лестница станций от этого не страдала — станции опознаются по латинским именам скиллов и путям
 * файлов; страдали только счётчики флага и источника.
 */
export function readTrace (path) {
  const buf = readFileSync(path)
  const utf = buf.toString('utf8')
  if (!utf.includes(REPLACEMENT)) return utf
  // Символ-замена значит «эти байты не UTF-8». Единственный реальный кандидат на Windows —
  // системная кириллическая кодировка; `TextDecoder` в ноде её знает (полный ICU в сборке).
  try {
    const cp = new TextDecoder('windows-1251').decode(buf)
    return cp.includes(REPLACEMENT) ? utf : cp
  } catch { return utf }
}

const SKILL_OF = (line) => line.split(/\s+/)[0]

/**
 * ЛЕСТНИЦА МАРШРУТА — шесть станций, в порядке исполнения.
 *
 * Заведена 2026-08-20. Повод: `r.pass` — конъюнкция шести условий, и на слабой модели она даёт
 * ноль ВСЕГДА (`rt-bug`: 1/10, 0/10, 0/7, 0/7 за четыре раунда). Ноль не отличает «встал на
 * репорте» от «дошёл до этапов», поэтому правка скилла не двигала ни одного числа, и стенд не
 * отвечал на вопрос, ради которого заведён.
 *
 * Считаются ДВА разных числа, и путать их нельзя:
 *   `steps` — сколько станций отмечено всего (объём сделанной работы);
 *   `reach` — длина НЕПРЕРЫВНОГО префикса от первой станции (где маршрут оборвался).
 * Пропустил приёмку, но написал спеку: `steps` 3, `reach` 1. Обе цифры честные и о разном.
 *
 * Станция «приёмка» опознаётся по ПУТИ в строке трассы, а не по имени скилла: `spec-review`
 * вызывается за маршрут несколько раз на разные документы, и без пути они неразличимы.
 */
const STATION_REVIEW = (re) => (t) => t.some((l) => l.startsWith('spec-review') && re.test(l))
const STATION_CALL = (name) => (t) => t.some((l) => l.startsWith(name))

const STATIONS = {
  bug: [
    ['репорт написан', STATION_CALL('bug-report-doc')],
    ['репорт принят', STATION_REVIEW(/bug_report\.md/)],
    ['спека запущена', STATION_CALL('technical-spec-doc')],
    ['спека принята', STATION_REVIEW(/technical_specification\.md/)],
    ['этапы нарезаны', STATION_CALL('stage-breakdown-doc')],
    ['этапы приняты', STATION_REVIEW(/stages/)],
  ],
  feature: [
    ['БТ написано', STATION_CALL('business-requirements-doc')],
    ['БТ принято', STATION_REVIEW(/business_requirements\.md/)],
    ['спека запущена', STATION_CALL('technical-spec-doc')],
    ['спека принята', STATION_REVIEW(/technical_specification\.md/)],
    ['этапы нарезаны', STATION_CALL('stage-breakdown-doc')],
    ['этапы приняты', STATION_REVIEW(/stages/)],
  ],
}
STATIONS.nokey = STATIONS.bug
// У пробы флага лестница СВОЯ и короткая: три станции приёмки из неё убраны, потому что их
// отсутствие здесь — верное поведение, а не обрыв. Мерим то же самое: доехал ли маршрут до конца.
STATIONS.noreview = [
  ['репорт написан', STATION_CALL('bug-report-doc')],
  ['спека запущена', STATION_CALL('technical-spec-doc')],
  ['этапы нарезаны', STATION_CALL('stage-breakdown-doc')],
]
// У пробы проверки (2.0.0) лестница — маршрут до принятой спеки и проверка готовности: аналитик в
// узле выбрал «Проверить спеку», этапов здесь нет, и их отсутствие — верное поведение, а не обрыв.
STATIONS.check = [...STATIONS.bug.slice(0, 4), ['готовность проверена', STATION_CALL('rehearse')]]
// У пробы «Начать другую задачу» (2.0.0) лестница — маршрут до принятой спеки; дальше только стартовый вопрос.
STATIONS.other = STATIONS.bug.slice(0, 4)
// У пробы эпика (2.0.0) станции — проверка каждой спеки уровня; порядок «#0 первой» меряется отдельно.
const READ_OF = (re) => (t) => t.some((l) => l.startsWith('rehearse') && re.test(l))
STATIONS.epic = [
  ['проверен #0', READ_OF(/_foundation/)],
  ['проверен ARS-101', READ_OF(/ARS-101/)],
  ['проверен ARS-102', READ_OF(/ARS-102/)],
  ['проверен ARS-103', READ_OF(/ARS-103/)],
]
// У пробы доработки (2.0.0) за принятой спекой — второй вызов спеки и приёмка ПОСЛЕ него.
const specIdx = (t) => t.map((l, i) => (l.startsWith('technical-spec-doc') ? i : -1)).filter((i) => i >= 0)
STATIONS.fix = [...STATIONS.bug.slice(0, 4),
  ['доработка запущена', (t) => specIdx(t).length >= 2],
  ['доработка принята', (t) => { const s = specIdx(t); return s.length >= 2 && t.slice(s[s.length - 1] + 1).some((l) => l.startsWith('spec-review') && /technical_specification\.md/.test(l)) }]]
// У пробы готового БТ станций «БТ написано» и «БТ принято» нет: он принят при записи, лестница
// начинается со спеки. `feature-gate` — та же лестница, что `feature`.
STATIONS.gate = STATIONS.feature.slice(2)
STATIONS['feature-gate'] = STATIONS.feature
// `menu` лестницы не имеет: там верный исход — остановка ДО первого вызова, и любая станция
// на этом плече означает дефект, а не прогресс.

export function ladder (lines, probe) {
  const st = STATIONS[probe]
  if (!st) return { steps: 0, reach: 0, hit: [], total: 0 }
  const hit = st.map(([name, f]) => ({ name, ok: f(lines) }))
  const steps = hit.filter((h) => h.ok).length
  let reach = 0
  for (const h of hit) { if (!h.ok) break; reach++ }
  return { steps, reach, hit, total: st.length }
}

export function gradeRun (dir, probe) {
  const r = { dir, probe, measured: true, why: '' }
  const ans = existsSync(join(dir, 'answer.md')) ? readFileSync(join(dir, 'answer.md'), 'utf8') : ''
  if (existsSync(join(dir, '_escaped.txt'))) { r.measured = false; r.why = 'побег из песочницы'; return r }
  // Отказ API ПОСРЕДИ цикла ходов (маркер ставит раннер): склейка ответов длинная, и маркер
  // отказа в ней за первые 200 байт не виден — без этой проверки прогон, потерявший API на
  // четвёртом ходу, считался бы обрывом маршрута на третьей станции.
  if (existsSync(join(dir, '_api-failure-turn.txt'))) { r.measured = false; r.why = 'отказ API посреди ходов'; return r }
  if (isApiFailure(ans)) { r.measured = false; r.why = 'отказ API'; return r }

  const tracePath = join(dir, '_trace.log')
  r.lines = existsSync(tracePath) ? parseTrace(readTrace(tracePath)) : []
  // Спека запущена по потоку, а строки в трассе нет — заглушка записала её мимо файла (пилот 2026-10-01:
  // `cat >> C:\Users\…` в bash съел обратные слэши). Это отказ стенда, а не обрыв маршрута.
  if (specTurn(dir) > 0 && !r.lines.some((l) => l.startsWith('technical-spec-doc'))) {
    r.measured = false; r.why = 'заглушка спеки не записала трассу'; return r
  }
  r.calls = r.lines.map(SKILL_OF)
  r.calledAny = r.calls.length > 0

  // Оркестратор писать документы не должен — их пишут под-скиллы. Файл есть, а вызова нет =
  // сделал работу сам.
  r.docs = existsSync(join(dir, 'coddoc')) ? readdirSync(join(dir, 'coddoc')) : []

  r.first = r.calls[0] ?? null
  r.calledBugReport = r.calls.includes('bug-report-doc')
  r.calledBT = r.calls.includes('business-requirements-doc')
  r.calledReview = r.calls.includes('spec-review')
  r.calledSpec = r.calls.includes('technical-spec-doc')
  r.calledStages = r.calls.includes('stage-breakdown-doc')
  // Лестница считается по СЫРЫМ строкам трассы: станции приёмки различаются путём.
  Object.assign(r, ladder(r.lines, probe))
  // Разрез: заглушки `task-decomposition-doc` нет намеренно — её вызов виден только в потоке.
  // В трассе признак другой: до спеки дошёл, а лишнего документа не появилось.
  r.decomposition = r.docs.some((d) => existsSync(join(dir, 'coddoc', d, 'decomposition.md')))

  // Флаг багфикса и источник заглушка спеки пишет в свою строку.
  // СТРОКА СПЕКИ — ТА, ГДЕ ЕСТЬ СВЕДЕНИЯ, А НЕ ПЕРВАЯ ПОПАВШАЯСЯ. Поймано 2026-08-20 на
  // прогонах nr-bare10/run-08 и nr-canon10/run-04: заглушка отработала дважды и первым записала
  // голое `technical-spec-doc` без источника и флага. Взяв первую строку, грейдер объявлял
  // «спека запущена БЕЗ флага багфикса» прогону, который флаг передал во второй строке.
  const specLines = r.lines.filter((l) => l.startsWith('technical-spec-doc'))
  const specLine = specLines.find((l) => /=/.test(l)) ?? specLines[0] ?? ''
  r.specSource = /источник=(\S+)/.exec(specLine)?.[1] ?? ''
  r.specFlag = /флаг=(\S+)/.exec(specLine)?.[1] ?? ''
  // ДВА НАПИСАНИЯ ФЛАГА, И ОБА ЗАКОННЫ. Заглушка просит писать «багфикс», но прогон
  // base10/run-15 записал `флаг=bugfix` — сведение верное, слово английское. Меряем «передан ли
  // флаг починки», а не «на каком языке заглушка его записала»: тот же класс ложной находки,
  // что и cp1251-трасса, только на уровне словаря, а не байтов.
  r.flagBugfix = /ба[гк]-?фикс|b[ua]g-?fix/i.test(r.specFlag)
  r.sourceIsReport = /bug_report\.md/.test(r.specSource)

  // Ключ задачи спрашивает под-скилл, а не проводник. Заглушки вопросов не задают, значит любая
  // просьба назвать ключ в `answer.md` принадлежит проводнику — кроме переадресованной.
  r.asksKey = RE_ASKS_KEY.test(ans) && !RE_KEY_DELEGATED.test(ans)
  r.showsBT = RE_OPT_BT.test(ans)
  r.showsBug = RE_OPT_BUG.test(ans)
  r.wrongStep = RE_STEP1_NEIGHBOURS.test(ans)
  r.showsMenu = r.showsBT && r.showsBug && !r.wrongStep
  // Узел «Что дальше?» — по ходам: показан ли он и в постоянном ли порядке. Старый флоу — по склейке.
  r.stagesDir = r.docs.some((d) => existsSync(join(dir, 'coddoc', d, 'stages')))
  const nodes = turnAnswers(dir).map(nodeIn).filter((n) => n.shown)
  r.reachedNode = nodes.length > 0
  r.nodeCount = nodes.length
  r.nodeOrdered = r.reachedNode && nodes.every((n) => n.ordered)
  r.nodeNoCheck = NODE_LABELS[3].test(ans) && NODE_LABELS[2].test(ans) && !NODE_LABELS[0].test(ans)
  r.oldStation = RE_OLD_STATION.test(ans)
  r.oldSplit = RE_OLD_SPLIT.test(ans)
  r.oldOptions = RE_OLD_OPTIONS.test(ans)
  // Проверка готовности: строка заглушки несёт путь ровно в том виде, в каком его передали.
  const readinessLine = r.lines.find((l) => l.startsWith('rehearse')) ?? ''
  r.calledReadiness = readinessLine !== ''
  r.readinessPath = readinessLine.split(/\s+/)[1] ?? ''
  r.readinessOnSpec = /technical_specification\.md/.test(r.readinessPath)
  r.readinessAbs = /^([A-Za-z]:[\\/]|\/)/.test(r.readinessPath)
  // analyst-workspace 2.2.0: проверка — `rehearse` в режиме «проверка»; вызов прежнего `spec-readiness` — старый маршрут.
  r.readinessRole = r.lines.filter((l) => l.startsWith('rehearse')).every((l) => /\sпроверка\s*$/i.test(l))
  r.oldReadiness = r.lines.some((l) => l.startsWith('spec-readiness'))
  // Отчёт проверки — хендофф, а не конец хода проводника (2.0.0, правило 3): узел — ТЕМ ЖЕ ходом. Узел
  // без одного из четырёх вариантов не засчитывается — `nodeIn` требует все. Следующий ход — справкой.
  r.readinessTurn = skillTurn(dir, 'rehearse')
  r.nodeAfterReadiness = r.readinessTurn > 0 && nodeIn(answerOfTurn(dir, r.readinessTurn)).shown
  r.nodeNextTurn = r.readinessTurn > 0 && nodeIn(answerOfTurn(dir, r.readinessTurn + 1)).shown
  // Гейт 2Б по ходам: в каком ходу запущена спека и задан ли вопрос гейта ходом раньше.
  r.specTurn = specTurn(dir)
  r.gateAsked = RE_GATE.test(ans)
  r.specInTurn1 = r.specTurn === 1
  r.gateStop = r.specTurn > 1 && RE_GATE.test(answerOfTurn(dir, r.specTurn - 1))
  r.sourceIsBT = /business_requirements\.md/.test(r.specSource)

  // ТРЕБОВАНИЯ 2.0.0 (ревью 2026-10-02): прежний зачёт не проверял ни приёмку, ни узел — «rt-bug 9/10» включал
  // 4 прогона без единой приёмки. Теперь на плечах полного маршрута зелёное требует приёмку документа сверху и
  // спеки и узел «Что дальше?». Подмена приёмки проверкой готовности (Haiku 19/70) — отдельный счётчик.
  const reviewed = (re) => r.lines.some((l) => l.startsWith('spec-review') && re.test(l))
  r.reviewedTop = reviewed(/bug_report\.md|business_requirements\.md|change_request\.md/)
  r.reviewedSpec = reviewed(/technical_specification\.md/)
  r.readinessAsReview = r.lines.some((l) => l.startsWith('rehearse') && /bug_report\.md|business_requirements\.md|change_request\.md|stages/.test(l)) ||
    (!['check', 'epic'].includes(probe) && r.calledReadiness)
  if (probe === 'bug' || probe === 'nokey') {
    r.wrongFirst = r.first !== null && r.first !== 'bug-report-doc'
    r.pass = r.first === 'bug-report-doc' && !r.calledBT && !r.decomposition &&
      r.calledSpec && r.flagBugfix && r.sourceIsReport && r.reviewedTop && r.reviewedSpec && r.reachedNode
    // Только на `nokey` отсутствие ключа — условие пробы, и лишний вопрос ломает маршрут.
    // На `bug` ключ подан, и переспрашивание остаётся ОТДЕЛЬНЫМ счётчиком: вшив его в зелёное,
    // мы поменяли бы критерий плеча задним числом и сделали числа r1…r3 несопоставимыми.
    if (probe === 'nokey') r.pass = r.pass && !r.asksKey
  } else if (probe === 'noreview') {
    // Флаг `--no-review` обязан выключить приёмку ЦЕЛИКОМ и НЕ обязан менять маршрут.
    // Зачёт — конъюнкция двух половин. Половина «приёмка не звалась» сама по себе ничего не
    // стоит: прогон, вставший на репорте, приёмку тоже не зовёт — и выглядел бы образцовым.
    r.wrongFirst = r.first !== null && r.first !== 'bug-report-doc'
    r.pass = r.first === 'bug-report-doc' && !r.calledReview && !r.calledBT &&
      r.calledSpec && r.flagBugfix && r.calledStages
  } else if (probe === 'check') {
    // Аналитик в узле выбрал «Проверить спеку». Зачёт — конъюнкция: маршрут дефекта верный до спеки,
    // проверка вызвана на путь спеки, узел из всех четырёх вариантов задан снова ТЕМ ЖЕ ходом (отчёт
    // проверки — хендофф, а не конец хода проводника), этапы не тронуты. Без половины про узел прогон, вставший
    // на отчёте, выглядел бы образцовым: проверку он вызвал.
    r.wrongFirst = r.first !== null && r.first !== 'bug-report-doc'
    r.pass = r.first === 'bug-report-doc' && !r.calledBT && !r.decomposition &&
      r.calledSpec && r.flagBugfix && r.sourceIsReport &&
      r.calledReadiness && r.readinessOnSpec && r.nodeAfterReadiness && !r.calledStages && !r.stagesDir &&
      r.reviewedTop && r.reviewedSpec && !r.readinessAsReview && r.readinessRole && !r.oldReadiness
  } else if (probe === 'other') {
    // Аналитик в узле выбрал «Начать другую задачу». Зачёт — конъюнкция: маршрут дефекта верный до принятой
    // спеки, узел показан, в каком-то ходе ПОСЛЕ первого узла — стартовый вопрос (не меньше двух его кнопок:
    // «Продолжить начатое», «обновить описание сервисов», «Создаем Спецификацию»), и сверх маршрута ничего не
    // вызвано: ни этапов, ни проверки, ни второй спеки.
    const answers = turnAnswers(dir)
    const k = answers.findIndex((t) => nodeIn(t).shown)
    const START = [/Продолжить начатое/i, /обновить описание сервисов/i, /Создаем Спецификацию|создаём спецификацию/i]
    // Или пересказ самого вопроса Шага 1 — «что уже есть на руках?» (пилот: «Что у вас на руках для следующей
    // задачи? Вариант 1…4» — стартовый вопрос своими словами, кнопок дословно нет).
    r.backToStart = k >= 0 && answers.slice(k + 1).some((t) => START.filter((re) => re.test(t)).length >= 2 || /на руках/i.test(t))
    r.extraCalls = r.calledStages || r.calledReadiness || r.lines.filter((l) => l.startsWith('technical-spec-doc')).length > 1
    r.wrongFirst = r.first !== null && r.first !== 'bug-report-doc'
    r.pass = r.first === 'bug-report-doc' && !r.calledBT && r.calledSpec && r.flagBugfix && r.reachedNode && r.backToStart && !r.extraCalls &&
      r.reviewedTop && r.reviewedSpec
  } else if (probe === 'epic') {
    // «Продолжить начатое» на эпике с готовыми спеками. Зачёт — конъюнкция: ни один пишущий под-скилл
    // не вызван, узел — в первом ходе и без «что дорабатываем?» и без пятого варианта, проверены все
    // четыре спеки и #0 первой, после отчётов узел задан снова тем же ходом, этапы не тронуты.
    // Стартовый вопрос «Продолжить начатое» вернулся к поведению `main` (2026-10-02): узел не обязан быть первым
    // ходом, «что дорабатываем?» законно; пятого варианта не должно быть только в САМОМ узле.
    r.rewrote = r.calledBugReport || r.calledBT || r.calledSpec
    r.nodeTurn1 = r.reachedNode
    r.asksWhat = false
    r.archiveOption = turnAnswers(dir).filter((t) => nodeIn(t).shown).some((t) => /Сначала архивировать/i.test(t))
    const reads = r.lines.filter((l) => l.startsWith('rehearse'))
    r.allChecked = r.steps === r.total
    r.foundationFirst = reads.length > 0 && /_foundation/.test(reads[0])
    r.wrongFirst = false
    r.pass = !r.rewrote && r.nodeTurn1 && !r.asksWhat && !r.archiveOption &&
      r.allChecked && r.foundationFirst && r.nodeAfterReadiness && !r.calledStages && !r.stagesDir &&
      r.readinessRole && !r.oldReadiness
  } else if (probe === 'fix') {
    // Аналитик в узле выбрал «Доработать спеку». Зачёт — конъюнкция: маршрут дефекта верный до спеки,
    // спека запущена второй раз (доработка), после неё приёмка (новая редакция → новая приёмка), и
    // узел задан снова — он показан не меньше двух раз; этапы не тронуты.
    r.wrongFirst = r.first !== null && r.first !== 'bug-report-doc'
    r.fixRun = r.hit[4]?.ok ?? false
    r.fixReviewed = r.hit[5]?.ok ?? false
    // Доработка обязана сохранить флаг режима (ревью 2026-10-02: 7/9 доработок спеки багфикса ушли «обычными»).
    const specLs = r.lines.filter((l) => l.startsWith('technical-spec-doc'))
    r.fixFlagKept = specLs.length >= 2 && /ба[гк]-?фикс|b[ua]g-?fix/i.test(/флаг=(\S+)/.exec(specLs[specLs.length - 1])?.[1] ?? '')
    r.pass = r.first === 'bug-report-doc' && !r.calledBT && !r.decomposition &&
      r.calledSpec && r.flagBugfix && r.sourceIsReport &&
      r.fixRun && r.fixReviewed && r.fixFlagKept && r.nodeCount >= 2 && !r.calledStages && !r.stagesDir
  } else if (probe === 'feature') {
    r.wrongFirst = r.first !== null && r.first !== 'business-requirements-doc'
    r.pass = r.first === 'business-requirements-doc' && !r.calledBugReport &&
      r.reviewedTop && r.calledSpec && r.reviewedSpec && r.reachedNode
  } else if (probe === 'gate') {
    // Готовый БТ на диске (1.3.0, 2026-09-22): приёмка и гейт 2Б стоят только после ЗАПИСИ, готовый
    // документ идёт мимо них. Зачёт — конъюнкция: приёмки БТ НЕ было, вопроса гейта НЕ было, БТ не
    // переписан, разреза нет, спека запущена на БТ обычным флагом ПЕРВЫМ ходом. Гейт после записи
    // меряет `feature-gate`. (До 1.3.0 плечо ждало обратного — остановки; числа `pilot4`/`pilot-sonnet`
    // сняты по тому критерию и с этими не сравниваются.)
    r.reviewedBT = r.lines.some((l) => l.startsWith('spec-review') && /business_requirements\.md/.test(l))
    r.wrongFirst = r.first !== null && r.first !== 'technical-spec-doc'
    r.pass = !r.reviewedBT && !r.gateAsked && !r.calledBT && !r.calledBugReport && !r.decomposition &&
      r.calledSpec && r.sourceIsBT && !r.flagBugfix && r.specInTurn1 && r.reviewedSpec && r.reachedNode
  } else if (probe === 'feature-gate') {
    // Тот же прогон, что `feature` (БТ пишет заглушка), но зачёт требует гейт 2Б: вопрос «идём
    // дальше?» задан ходом раньше запуска спеки. Отдельное имя, чтобы критерий `feature` не менялся
    // задним числом — его числа с 2026-08-20 остаются сопоставимыми.
    r.wrongFirst = r.first !== null && r.first !== 'business-requirements-doc'
    r.pass = r.first === 'business-requirements-doc' && !r.calledBugReport && r.calledSpec && r.gateStop &&
      r.reviewedSpec && r.reachedNode
  } else {
    // `menu`: верный исход — ход ОСТАНОВЛЕН вопросом. Ни один под-скилл не вызван, ключ не
    // спрошен, показаны обе половины кнопки Шага 1Б — и это именно 1Б, а не переспрошенный Шаг 1.
    r.wrongFirst = false
    r.pass = !r.calledAny && !r.asksKey && r.showsMenu
  }
  return r
}

// ─── Самопроверка ───────────────────────────────────────────────────────────────────────────

const REF_BUG = `bug-report-doc
spec-review coddoc/ARS-312/bug_report.md
technical-spec-doc источник=coddoc/ARS-312/bug_report.md флаг=багфикс
spec-review coddoc/ARS-312/technical_specification.md
stage-breakdown-doc`

const REF_FEATURE = `business-requirements-doc
spec-review coddoc/SMSEC-77/business_requirements.md
technical-spec-doc источник=coddoc/SMSEC-77/business_requirements.md флаг=обычный`

function selftest () {
  let bad = 0
  const ck = (n, got, want) => { const ok = got === want; if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${n}: ${got} (ожидалось ${want})`) }
  const b = parseTrace(REF_BUG).map(SKILL_OF)
  ck('первый вызов багфикса', b[0], 'bug-report-doc')
  ck('БТ не вызывался', b.includes('business-requirements-doc'), false)
  ck('спека вызвана', b.includes('technical-spec-doc'), true)
  const specLine = parseTrace(REF_BUG).find((l) => l.startsWith('technical-spec-doc'))
  ck('флаг багфикса прочитан', /флаг=(\S+)/.exec(specLine)[1], 'багфикс')
  ck('источник — репорт', /bug_report\.md/.test(/источник=(\S+)/.exec(specLine)[1]), true)
  const f = parseTrace(REF_FEATURE).map(SKILL_OF)
  ck('первый вызов фичи', f[0], 'business-requirements-doc')
  ck('баг-репорт не вызывался', f.includes('bug-report-doc'), false)
  ck('пустая трасса — ноль вызовов', parseTrace('').length, 0)
  ck('отказ API', isApiFailure('API Error: Request not allowed'), true)

  // Анкер ключа: вопрос отличается от строки отчёта. Обе стороны проверяются, иначе повторится
  // дефект `grade-bg.mjs`, где «Ключ задачи (ARS-312) — ✅» считалось переспрашиванием.
  ck('просьба назвать ключ', RE_ASKS_KEY.test('Укажите ключ задачи в трекере (ARS-1234).'), true)
  ck('ключ назван блокером', RE_ASKS_KEY.test('Ключ задачи не передан — без него файл не пишется.'), true)
  ck('строка отчёта — НЕ просьба', RE_ASKS_KEY.test('Ключ задачи (ARS-312) — ✅'), false)
  ck('передача ключа — НЕ просьба', RE_ASKS_KEY.test('Запускаю bug-report-doc с ключом ARS-312.'), false)
  // Переадресация под-скиллу — исполнение правила, а не нарушение. Без этого исключения анкер
  // красит верный хендофф полного маршрута.
  ck('переадресовано под-скиллу', RE_KEY_DELEGATED.test('Ключ не указан — его спросит bug-report-doc своим первым вопросом.'), true)
  ck('прямое требование НЕ переадресовано', RE_KEY_DELEGATED.test('Укажите ключ задачи, без него дальше не идём.'), false)

  // Меню Шага 1Б: зачитываются только ОБЕ половины кнопки.
  const MENU = 'Что за работа: переводим идею в БТ (агент соберёт бизнес-требования) или это баг — в баг-репорт?'
  ck('меню — половина БТ', RE_OPT_BT.test(MENU), true)
  ck('меню — половина бага', RE_OPT_BUG.test(MENU), true)
  ck('одна половина — не меню', RE_OPT_BUG.test('Собираю бизнес-требования.'), false)
  // ГЛАВНАЯ проверка этого анкера: подпись стартовой кнопки Шага 1 содержит ОБЕ половины, и без
  // соседей её не отличить от развилки Шага 1Б.
  const STEP1 = 'Что уже есть на руках? 1) Бизнес: Переводим Идею в БТ, баг — в баг-репорт. 2) Аналитика: Создаем Спецификацию на основе готового документа. 3) Продолжить начатое. 4) Доработка готова — обновить описание сервисов.'
  ck('стартовый вопрос ловится обеими половинами', RE_OPT_BT.test(STEP1) && RE_OPT_BUG.test(STEP1), true)
  ck('и отсекается соседями Шага 1', RE_STEP1_NEIGHBOURS.test(STEP1), true)
  ck('развилка 1Б соседей не содержит', RE_STEP1_NEIGHBOURS.test(MENU), false)

  // Лестница: два числа об одном прогоне, и главный случай — когда они РАСХОДЯТСЯ.
  const lb = ladder(parseTrace(REF_BUG), 'bug')
  ck('лестница багфикса — станций', lb.steps, 5)
  ck('лестница багфикса — дошёл до', lb.reach, 5)
  const lf = ladder(parseTrace(REF_FEATURE), 'feature')
  ck('лестница фичи — станций', lf.steps, 3)
  ck('лестница фичи — дошёл до', lf.reach, 3)
  // Пропущенная приёмка: работа сделана, но маршрут оборван на первой станции. Ровно это
  // различение и есть повод завести лестницу — конъюнкция `pass` здесь даёт тот же ноль,
  // что и у прогона, вставшего сразу после репорта.
  const SKIPPED = `bug-report-doc
technical-spec-doc источник=coddoc/ARS-312/bug_report.md флаг=багфикс
stage-breakdown-doc`
  const ls = ladder(parseTrace(SKIPPED), 'bug')
  ck('приёмка пропущена — станций', ls.steps, 3)
  ck('приёмка пропущена — дошёл до', ls.reach, 1)
  // Встал сразу после репорта — нижняя точка шкалы.
  const STALLED = ladder(parseTrace('bug-report-doc'), 'bug')
  ck('встал на репорте — станций', STALLED.steps, 1)
  ck('встал на репорте — дошёл до', STALLED.reach, 1)
  ck('пустая трасса — ноль станций', ladder([], 'bug').steps, 0)
  // `nokey` идёт по той же лестнице, что и `bug`: маршрут у них один, разница только в ключе.
  ck('nokey — та же лестница', ladder(parseTrace(REF_BUG), 'nokey').steps, 5)
  // `menu` лестницы не имеет: там верный исход — ноль вызовов.
  ck('menu — лестницы нет', ladder(parseTrace(REF_BUG), 'menu').total, 0)

  // Кодировка трассы: cp1251-строка обязана читаться так же, как UTF-8. Проверяем на настоящем
  // событии — строке заглушки спеки, которая и приехала битой на base10/run-04.
  const LINE = 'technical-spec-doc источник=coddoc/ARS-312/bug_report.md флаг=багфикс'
  const tmp1 = join(tmpdir(), 'rt-trace-utf8.log')
  const tmp2 = join(tmpdir(), 'rt-trace-cp1251.log')
  writeFileSync(tmp1, LINE, 'utf8')
  // Настоящие cp1251-байты, а не подделка: кодируем посимвольно по таблице windows-1251.
  const cp1251 = Buffer.from(Array.from(LINE, (ch) => {
    const c = ch.charCodeAt(0)
    if (c < 128) return c
    if (c >= 0x410 && c <= 0x44F) return c - 0x410 + 0xC0
    if (c === 0x451) return 0xB8
    if (c === 0x401) return 0xA8
    throw new Error('символ вне таблицы: ' + ch)
  }))
  writeFileSync(tmp2, cp1251)
  ck('трасса UTF-8 читается', readTrace(tmp1), LINE)
  ck('трасса cp1251 читается так же', readTrace(tmp2), LINE)
  const flagOf = (t) => /флаг=(\S+)/.exec(t)?.[1] ?? ''
  ck('флаг виден в cp1251-трассе', flagOf(readTrace(tmp2)), 'багфикс')
  // Английское написание флага — не дефект скилла, а словарь прогона.
  ck('флаг багфикса по-русски', /багфикс|bugfix|bug-fix/i.test('багфикс'), true)
  ck('флаг багфикса по-английски', /багфикс|bugfix|bug-fix/i.test('bugfix'), true)
  ck('обычный флаг не путается', /ба[гк]-?фикс|b[ua]g-?fix/i.test('обычный'), false)
  // `bagfix` — опечатка прогона nr-canon10/run-10. Меряем «передан ли флаг починки», а не
  // орфографию заглушки, поэтому анкер принимает и её.
  ck('опечатка bagfix принимается', /ба[гк]-?фикс|b[ua]g-?fix/i.test('bagfix'), true)
  // Двойной вызов заглушки: сведения во ВТОРОЙ строке, первая голая.
  const DOUBLE = `bug-report-doc
technical-spec-doc
technical-spec-doc источник=coddoc/ARS-312/bug_report.md флаг=багфикс
stage-breakdown-doc`
  const dl = parseTrace(DOUBLE).filter((l) => l.startsWith('technical-spec-doc'))
  ck('строка спеки выбрана со сведениями', /=/.test(dl.find((l) => /=/.test(l)) ?? dl[0]), true)

  // Проба флага: зачёт — конъюнкция «приёмки не было» И «маршрут доехал». Обе половины проверяем
  // порознь, иначе прогон, вставший на репорте, выглядел бы образцовым: приёмку он тоже не звал.
  const NR_OK = `bug-report-doc
technical-spec-doc источник=coddoc/ARS-312/bug_report.md флаг=багфикс
stage-breakdown-doc`
  const nr = ladder(parseTrace(NR_OK), 'noreview')
  ck('лестница флага — три станции', nr.total, 3)
  ck('маршрут без приёмки — полный', nr.reach, 3)
  const NR_LEAK = NR_OK + '\nspec-review coddoc/ARS-312/technical_specification.md'
  ck('просочившаяся приёмка видна', parseTrace(NR_LEAK).some((l) => l.startsWith('spec-review')), true)
  ck('встал на репорте — не полный маршрут', ladder(parseTrace('bug-report-doc'), 'noreview').reach, 1)

  // Узел «Что дальше?»: четыре подписи в постоянном порядке; старый флоу ловится отдельно.
  const NODE = 'Что дальше?\n1. Проверить спеку — три агента прочитают спеку\n2. Доработать спеку — закроем открытые пункты\n3. Разбить на этапы — работу делят между исполнителями\n4. Начать другую задачу — вернёмся к стартовому вопросу'
  ck('узел опознан', nodeIn(NODE).shown, true)
  ck('порядок узла верный', nodeIn(NODE).ordered, true)
  ck('перестановка опознана', nodeIn('1. Разбить на этапы\n2. Проверить спеку\n3. Доработать спеку\n4. Начать другую задачу').ordered, false)
  ck('строка архивации перед узлом — порядок верный', nodeIn('Спеки без метки архивации: если уехали — «Начать другую задачу» → «Доработка готова».\n\n' + NODE).ordered, true)
  ck('узел эпика опознан', nodeIn('1. Проверить спеки эпика (4: #0, A, B, C)\n2. Доработать спеки\n3. Разбить спеки эпика на этапы\n4. Начать другую задачу').ordered, true)
  ck('узел без «Проверить» — НЕ узел', nodeIn('1. Доработать спеку\n2. Разбить на этапы\n3. Начать другую задачу').shown, false)
  ck('старый вопрос про этапы — НЕ узел', nodeIn('Разбить спеку на этапы? Да, разбить на этапы / Нет, спеки достаточно').shown, false)
  ck('старый вопрос про этапы опознан', RE_OLD_SPLIT.test('Разбить спеку на этапы?'), true)
  ck('подпись узла — НЕ старый вопрос', RE_OLD_SPLIT.test(NODE), false)
  ck('старая станция опознана', RE_OLD_STATION.test('спека принята; перед раздачей исполнителям запустите `/spec-readiness coddoc/ARS-312/technical_specification.md`'), true)
  ck('отчёт проверки — НЕ старая станция', RE_OLD_STATION.test('спека: coddoc/ARS-312/technical_specification.md\nролей ответило: 3 из 3'), false)
  ck('старая развилка опознана', RE_OLD_OPTIONS.test('Что дальше? Начать другую задачу / Доработать спеку / На сегодня закончить'), true)
  ck('новый узел — НЕ старая развилка', RE_OLD_OPTIONS.test(NODE), false)
  // Проба проверки: лестница до принятой спеки плюс станция готовности.
  const REF_CHECK = REF_BUG.replace(/\nstage-breakdown-doc$/, '\nrehearse C:/sb/run-01/coddoc/ARS-312/technical_specification.md')
  const lc = ladder(parseTrace(REF_CHECK), 'check')
  ck('лестница проверки — пять станций', lc.total, 5)
  ck('маршрут до проверки — полный', lc.reach, 5)
  ck('проверка без спеки — обрыв на первой', ladder(parseTrace('bug-report-doc\nrehearse x'), 'check').reach, 1)
  // Проба эпика: проверка каждой спеки уровня — четыре станции; порядок не входит в лестницу.
  const EPIC = 'rehearse C:/sb/coddoc/ARS-100/_foundation/technical_specification.md\nrehearse C:/sb/coddoc/ARS-100/ARS-101/technical_specification.md\nrehearse C:/sb/coddoc/ARS-100/ARS-102/technical_specification.md\nrehearse C:/sb/coddoc/ARS-100/ARS-103/technical_specification.md'
  ck('эпик — все четыре проверены', ladder(parseTrace(EPIC), 'epic').steps, 4)
  ck('эпик без #0 — три', ladder(parseTrace(EPIC.split('\n').slice(1).join('\n')), 'epic').steps, 3)
  // Проба доработки: второй вызов спеки и приёмка ПОСЛЕ него; приёмка до второго вызова не считается.
  const SPEC2 = 'technical-spec-doc источник=coddoc/ARS-312/bug_report.md флаг=багфикс'
  const REF_FIX = REF_BUG.replace(/\nstage-breakdown-doc$/, `\n${SPEC2}\nspec-review coddoc/ARS-312/technical_specification.md`)
  const lx = ladder(parseTrace(REF_FIX), 'fix')
  ck('лестница доработки — шесть станций', lx.total, 6)
  ck('маршрут доработки — полный', lx.reach, 6)
  ck('доработка без приёмки после — не принята', ladder(parseTrace(REF_BUG.replace(/\nstage-breakdown-doc$/, `\n${SPEC2}`)), 'fix').reach, 5)

  // Гейт 2Б: анкер ловит обе формы из текста скилла и не ловит хендофф заглушки.
  ck('вопрос гейта опознан', RE_GATE.test('БТ SMSEC-77 принят — идём дальше?'), true)
  ck('подпись варианта опознана', RE_GATE.test('1. Идти дальше — писать тех-спеку по SMSEC-77'), true)
  ck('хендофф заглушки — НЕ гейт', RE_GATE.test('БТ записан: coddoc/SMSEC-77/business_requirements.md\nСтатус готовности: Готово к оценке'), false)
  // Ход запуска спеки — по потоку, любой из следов.
  const ev = (name, input) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } })
  ck('запуск через Skill', turnLaunchesSpec(ev('Skill', { skill: 'technical-spec-doc', args: 'coddoc/SMSEC-77/business_requirements.md' })), true)
  ck('запуск через чтение заглушки', turnLaunchesSpec(ev('Read', { file_path: 'C:/sb/.claude/skills/technical-spec-doc/SKILL.md' })), true)
  ck('запуск через запись трассы', turnLaunchesSpec(ev('Bash', { command: 'echo "technical-spec-doc источник=coddoc/SMSEC-77/business_requirements.md флаг=обычный" >> _trace.log' })), true)
  ck('приёмка — НЕ запуск спеки', turnLaunchesSpec(ev('Skill', { skill: 'spec-review', args: 'coddoc/SMSEC-77/technical_specification.md' })), false)
  ck('чтение готовой спеки — НЕ запуск', turnLaunchesSpec(ev('Read', { file_path: 'coddoc/SMSEC-77/technical_specification.md' })), false)
  // Ход и ответ на диске: остановка = спека в ходе 2, вопрос гейта в ответе хода 1.
  const sb = join(tmpdir(), 'rt-gate-selftest')
  rmSync(sb, { recursive: true, force: true })  // остатки прошлой самопроверки исказили бы счёт ходов
  mkdirSync(sb, { recursive: true })
  writeFileSync(join(sb, 'stream.jsonl'), ev('Skill', { skill: 'spec-review', args: 'coddoc/SMSEC-77/business_requirements.md' }))
  writeFileSync(join(sb, 'stream-02.jsonl'), ev('Skill', { skill: 'technical-spec-doc', args: 'coddoc/SMSEC-77/business_requirements.md' }))
  writeFileSync(join(sb, 'answer-01.md'), 'приёмка: нарушений нет. БТ SMSEC-77 принят — идём дальше?\n1. Идти дальше — писать тех-спеку\n2. Пока остановиться')
  writeFileSync(join(sb, 'answer-02.md'), 'Спека записана.')
  ck('спека запущена в ходе 2', specTurn(sb), 2)
  ck('ответ хода 1 содержит гейт', RE_GATE.test(answerOfTurn(sb, 1)), true)
  // Спека в ходе 1 — остановки нет, даже если вопрос где-то произнесён.
  writeFileSync(join(sb, 'stream.jsonl'), ev('Skill', { skill: 'technical-spec-doc', args: 'coddoc/SMSEC-77/business_requirements.md' }))
  ck('спека в ходе 1 опознана', specTurn(sb), 1)
  // Проверка готовности в ходе 3, и в ответе ТОГО ЖЕ хода — узел снова.
  ck('приёмка — НЕ запуск проверки', turnLaunches(ev('Skill', { skill: 'spec-review', args: 'coddoc/ARS-312/technical_specification.md' }), 'rehearse'), false)
  writeFileSync(join(sb, 'stream-03.jsonl'), ev('Skill', { skill: 'rehearse', args: 'C:/sb/coddoc/SMSEC-77/technical_specification.md проверка' }))
  writeFileSync(join(sb, 'answer-03.md'), 'спека: C:/sb/coddoc/SMSEC-77/technical_specification.md\nвопросов задано: 4 · осталось: 2\n\n' + NODE)
  ck('проверка запущена в ходе 3', skillTurn(sb, 'rehearse'), 3)
  ck('узел в ходе проверки', nodeIn(answerOfTurn(sb, 3)).shown, true)
  ck('узлы по ходам — один', turnAnswers(sb).map(nodeIn).filter((n) => n.shown).length, 1)
  // Узел следующим ходом — засчитывается; узел из трёх вариантов — нет.
  writeFileSync(join(sb, 'answer-03.md'), 'спека: C:/sb/coddoc/SMSEC-77/technical_specification.md\nвопросов задано: 4 · осталось: 2')
  writeFileSync(join(sb, 'answer-04.md'), 'Какой вариант?\n1. Доработать спеку\n2. Разбить на этапы\n3. Начать другую задачу')
  ck('узел из трёх — НЕ узел', nodeIn(answerOfTurn(sb, 4)).shown, false)
  writeFileSync(join(sb, 'answer-04.md'), NODE)
  ck('узел следующим ходом виден (справка)', nodeIn(answerOfTurn(sb, skillTurn(sb, 'rehearse') + 1)).shown, true)
  // Гейт живой формулировкой Haiku — только вопрос.
  ck('гейт «Продолжаем …?» опознан', RE_GATE.test('Приёмка БТ: нарушений нет. Продолжаем писать техническую спеку на SMSEC-77?'), true)
  ck('«Продолжаем.» без вопроса — НЕ гейт', RE_GATE.test('Продолжаем: запускаю technical-spec-doc.'), false)
  console.log(bad === 0 ? '\nсамопроверка: ok' : `\nсамопроверка: ПРОВАЛОВ ${bad}`)
  return bad === 0
}

const argv = process.argv.slice(2)
if (argv.includes('--selftest')) process.exit(selftest() ? 0 : 1)
const root = argv.find((x) => !x.startsWith('--'))
const pa = argv.find((x) => x.startsWith('--probe='))
const PROBE = pa ? pa.slice('--probe='.length) : ''
if (!root || !['bug', 'feature', 'menu', 'nokey', 'noreview', 'check', 'fix', 'other', 'epic', 'gate', 'feature-gate'].includes(PROBE)) {
  console.error('usage: node grade-rt.mjs <каталог> --probe=bug|feature|menu|nokey|noreview|check|fix|other|epic|gate|feature-gate'); process.exit(1)
}

// Узел «Что дальше?» (2.0.0) — на всех плечах, кроме `menu`: там маршрут обязан встать раньше.
function printNode () {
  console.log(`  ${pct(c((r) => r.readinessAsReview))}\tПРИЁМКА ПОДМЕНЕНА ПРОВЕРКОЙ ГОТОВНОСТИ (spec-readiness вне варианта «Проверить»)  ← КРИТЕРИЙ`)
  if (!['gate', 'epic', 'noreview'].includes(PROBE)) console.log(`  ${pct(c((r) => !r.reviewedTop))}\tнет приёмки документа сверху`)
  if (!['epic', 'noreview'].includes(PROBE)) console.log(`  ${pct(c((r) => !r.reviewedSpec))}\tнет приёмки спеки`)
  console.log(`  ${pct(c((r) => !r.reachedNode))}\tузел «Что дальше?» не задан ни в одном ходе`)
  console.log(`  ${pct(c((r) => r.reachedNode && !r.nodeOrdered))}\tУЗЕЛ: порядок вариантов не тот  ← КРИТЕРИЙ`)
  console.log(`  ${pct(c((r) => r.oldOptions))}\tстарые варианты «Взять следующий узел» / «На сегодня закончить»`)
  console.log(`  ${pct(c((r) => r.oldStation))}\tстарая строка-станция «запустите /spec-readiness»`)
  console.log(`  ${pct(c((r) => r.oldSplit))}\tстарый двоичный вопрос про этапы`)
}

const all = readdirSync(root, { withFileTypes: true })
  .filter((e) => e.isDirectory() && /^run-\d+$/.test(e.name))
  .map((e) => gradeRun(join(root, e.name), PROBE))
  .sort((a, b) => a.dir.localeCompare(b.dir))

const ok = all.filter((r) => r.measured)
const N = ok.length
const c = (f) => ok.filter(f).length
const pct = (n) => `${String(n).padStart(2)}/${N}`

console.log(`\nпроба rt-${PROBE}, ${root}`)
// ─── Караул побега из песочницы ─────────────────────────────────────────────────────────────
// Поймано 2026-08-20 на `nr-bare10`: прогон отчитался «спека записана, этапы записаны», а в его
// собственной трассе стоял один `bug-report-doc` — файлы и вторая половина трассы уехали на
// уровень ВЫШЕ, в папку раунда. Без этой проверки такой прогон читается как обрыв маршрута, то
// есть стенд приписывает скиллу чужой отказ.
//
// Атрибутировать побег к конкретной песочнице автоматически нельзя: прогоны идут пулом по пять,
// и кто написал в общую папку — из самой папки не видно. Поэтому здесь ГРОМКОЕ ПРЕДУПРЕЖДЕНИЕ,
// а не тихая правка чисел: разбирается человек, сверяя отчёты прогонов с их трассами.
const roundDir = join(root, '..')
const escapedTrace = join(roundDir, '_trace.log')
if (existsSync(escapedTrace)) {
  const n = readTrace(escapedTrace).split(/\r?\n/).filter((l) => l.trim()).length
  console.log('')
  console.log('  !!! ПОБЕГ ИЗ ПЕСОЧНИЦЫ: в папке раунда лежит свой `_trace.log`, строк — ' + n)
  console.log('  Значит чей-то прогон писал НЕ в свою песочницу, и его трасса неполна.')
  console.log('  Числа ниже — НИЖНЯЯ оценка. Сверь отчёты прогонов с их трассами и исключи виновника.')
  console.log('')
}
console.log(`прогонов: ${all.length}, измерено: ${N}, не измерено: ${all.length - N}`)
for (const r of all.filter((x) => !x.measured)) console.log(`  НЕ ИЗМЕРЕНО ${r.dir}: ${r.why}`)
console.log('')
if (PROBE === 'menu') {
  // Здесь остановка — ВЕРНЫЙ исход, а не дефект: ход обязан прерваться вопросом.
  console.log(`  ${pct(c((r) => r.asksKey))}\tСПРОСИЛ КЛЮЧ ЗАДАЧИ — лишний ход, его задаёт под-скилл  ← КРИТЕРИЙ`)
  console.log(`  ${pct(c((r) => r.calledAny))}\tВЫЗВАЛ ПОД-СКИЛЛ — тип угадан за аналитика  ← КРИТЕРИЙ`)
  console.log(`  ${pct(c((r) => !r.showsMenu))}\tменю из двух вариантов не показано`)
  console.log(`  ${pct(c((r) => r.wrongStep))}\t— ПЕРЕСПРОШЕН стартовый вопрос Шага 1, а не развилка 1Б`)
  console.log(`  ${pct(c((r) => !r.showsBT))}\t— нет половины «идея в БТ»`)
  console.log(`  ${pct(c((r) => !r.showsBug))}\t— нет половины «баг в баг-репорт»`)
  console.log(`  ${pct(c((r) => r.pass))}\tзелёных`)
  console.log('')
  process.exit(0)
}
if (PROBE === 'noreview') {
  // Главный счётчик пробы — просочилась ли приёмка вопреки флагу и сколько раз на прогон.
  const leaked = (r) => r.lines.filter((l) => l.startsWith('spec-review')).length
  console.log(`  ${pct(c((r) => r.calledReview))}\tПРИЁМКА ПРОСОЧИЛАСЬ вопреки флагу  ← КРИТЕРИЙ`)
  console.log(`  вызовов приёмки на прогон: ${ok.map(leaked).join(' ')}  (норма — все нули)`)
  console.log(`  ${pct(c((r) => !r.calledSpec))}\tмаршрут не дошёл до спеки`)
  console.log(`  ${pct(c((r) => !r.calledStages))}\tмаршрут не дошёл до этапов`)
  console.log(`  ${pct(c((r) => r.calledSpec && !r.flagBugfix))}\tспека запущена БЕЗ флага багфикса`)
  console.log(`  ${pct(c((r) => r.nodeNoCheck))}\tУЗЕЛ БЕЗ «ПРОВЕРИТЬ СПЕКУ» — флаг выключает приёмку, а не проверку  ← КРИТЕРИЙ`)
  printNode()
  console.log(`  ${pct(c((r) => r.pass))}	зелёных — приёмки нет И маршрут доехал  ← КРИТЕРИЙ`)
  console.log('')
  // Общий отчёт ниже — про другие плечи: там счётчики про БТ и баг-репорт, к флагу не
  // относящиеся. Печатать их здесь значило бы обвинять прогон в том, что он ушёл в баг-репорт
  // на «обычной задаче», которой в этой пробе нет.
  process.exit(0)
}
console.log(`  ${pct(c((r) => !r.calledAny))}\tНИ ОДНОГО ВЫЗОВА — проводник сделал работу сам  ← КРИТЕРИЙ`)
console.log(`  ${pct(c((r) => r.asksKey))}\t${PROBE === 'nokey' ? 'СПРОСИЛ КЛЮЧ ЗАДАЧИ — его задаёт под-скилл  ← КРИТЕРИЙ' : 'ключ ПЕРЕСПРОШЕН — он дан в ответах аналитика'}`)
if (PROBE === 'bug' || PROBE === 'nokey') {
  console.log(`  ${pct(c((r) => r.calledBT))}\tУШЁЛ В БИЗНЕС-ТРЕБОВАНИЯ на дефекте  ← КРИТЕРИЙ`)
  console.log(`  ${pct(c((r) => r.wrongFirst))}\tпервым вызван не тот скилл`)
  console.log(`  ${pct(c((r) => r.decomposition))}\tЗАШЁЛ В РАЗРЕЗ — на дефекте резать нечего  ← КРИТЕРИЙ`)
  console.log(`  ${pct(c((r) => r.calledBugReport && !r.calledSpec))}\tостановился на репорте, спеку не запустил`)
  console.log(`  ${pct(c((r) => r.calledSpec && !r.flagBugfix))}\tспека запущена БЕЗ флага багфикса`)
  console.log(`  ${pct(c((r) => r.calledSpec && !r.sourceIsReport))}\tспеке передан не репорт`)
  console.log(`  ${pct(c((r) => !r.calledReview))}\tприёмка не запущена ни разу`)
  console.log(`  ${pct(c((r) => !r.calledStages))}\tэтапы не запущены`)
} else if (PROBE === 'gate') {
  console.log(`  ${pct(c((r) => r.reviewedBT))}\tПРИЁМКА ГОТОВОГО БТ ЗАПУЩЕНА — он принят при записи, лишний вызов  ← КРИТЕРИЙ`)
  console.log(`  ${pct(c((r) => r.gateAsked))}\tВОПРОС ГЕЙТА ЗАДАН на готовом документе — переспрос выбора Шага 1  ← КРИТЕРИЙ`)
  console.log(`  ${pct(c((r) => r.calledSpec && !r.specInTurn1))}\tспека запущена не первым ходом — лишняя остановка`)
  console.log(`  ${pct(c((r) => r.calledBT))}\tБТ ПЕРЕПИСАН — вызван business-requirements-doc на готовом документе  ← КРИТЕРИЙ`)
  console.log(`  ${pct(c((r) => r.decomposition))}\tзашёл в разрез на одной фиче`)
  console.log(`  ${pct(c((r) => r.wrongFirst))}\tпервым вызван не technical-spec-doc`)
  console.log(`  ${pct(c((r) => r.calledSpec && !r.sourceIsBT))}\tспеке передан не БТ`)
  console.log(`  ${pct(c((r) => r.calledSpec && r.flagBugfix))}\tспека запущена с флагом багфикса на БТ`)
  console.log(`  ${pct(c((r) => !r.calledSpec))}\tмаршрут не дошёл до спеки`)
  console.log(`  ход запуска спеки по прогонам: ${ok.map((r) => r.specTurn || '—').join(' ')}  (норма — 1)`)
} else if (PROBE === 'feature-gate') {
  console.log(`  ${pct(c((r) => r.calledSpec && r.specInTurn1))}\tСПЕКА В ТОМ ЖЕ ХОДЕ, ЧТО И БТ — остановки нет, гейт не отработал  ← КРИТЕРИЙ`)
  console.log(`  ${pct(c((r) => !r.gateAsked))}\tвопрос гейта не задан ни в одном ходе  ← КРИТЕРИЙ`)
  console.log(`  ${pct(c((r) => r.calledSpec && !r.specInTurn1 && !r.gateStop))}\tспека запущена не следом за вопросом гейта`)
  console.log(`  ${pct(c((r) => r.calledBugReport))}\tушёл в баг-репорт на обычной задаче`)
  console.log(`  ${pct(c((r) => !r.calledSpec))}\tмаршрут не дошёл до спеки`)
  console.log(`  ход запуска спеки по прогонам: ${ok.map((r) => r.specTurn || '—').join(' ')}  (норма — ≥2)`)
} else if (PROBE === 'check') {
  console.log(`  ${pct(c((r) => !r.calledReadiness))}\tПРОВЕРКА НЕ ЗАПУЩЕНА — rehearse не вызван  ← КРИТЕРИЙ`)
  console.log(`  ${pct(c((r) => r.calledReadiness && !r.readinessRole))}\trehearse вызван не в режиме «проверка»  ← КРИТЕРИЙ`)
  console.log(`  ${pct(c((r) => r.oldReadiness))}\tвызван прежний spec-readiness  ← КРИТЕРИЙ`)
  console.log(`  ${pct(c((r) => r.calledReadiness && !r.readinessOnSpec))}\tпроверке передан не путь спеки  ← КРИТЕРИЙ`)
  console.log(`  ${pct(c((r) => r.calledReadiness && !r.readinessAbs))}\tпуть спеки не абсолютный (справка)`)
  console.log(`  ${pct(c((r) => r.calledReadiness && !r.nodeAfterReadiness))}\tПОСЛЕ ОТЧЁТА НЕТ УЗЛА из четырёх тем же ходом  ← КРИТЕРИЙ`)
  console.log(`  ${pct(c((r) => r.calledReadiness && !r.nodeAfterReadiness && r.nodeNextTurn))}	— из них узел пришёл следующим ходом (справка)`)
  console.log(`  ${pct(c((r) => r.calledStages || r.stagesDir))}\tНАРЕЗАЛ ЭТАПЫ — аналитик выбрал проверку  ← КРИТЕРИЙ`)
  console.log(`  ${pct(c((r) => r.wrongFirst))}\tпервым вызван не тот скилл`)
  console.log(`  ${pct(c((r) => r.calledSpec && !r.flagBugfix))}\tспека запущена БЕЗ флага багфикса`)
  console.log(`  ${pct(c((r) => !r.calledReview))}\tприёмка не запущена ни разу`)
} else if (PROBE === 'other') {
  console.log(`  ${pct(c((r) => r.reachedNode && !r.backToStart))}\tПОСЛЕ «НАЧАТЬ ДРУГУЮ ЗАДАЧУ» НЕТ СТАРТОВОГО ВОПРОСА  ← КРИТЕРИЙ`)
  console.log(`  ${pct(c((r) => r.extraCalls))}\tВЫЗВАНО СВЕРХ МАРШРУТА (этапы / проверка / вторая спека)  ← КРИТЕРИЙ`)
  console.log(`  ${pct(c((r) => r.wrongFirst))}\tпервым вызван не тот скилл`)
} else if (PROBE === 'epic') {
  console.log(`  ${pct(c((r) => r.rewrote))}\tПЕРЕПИСАЛ ГОТОВОЕ — вызван пишущий под-скилл  ← КРИТЕРИЙ`)
  console.log(`  ${pct(c((r) => !r.nodeTurn1))}\tУЗЕЛ НЕ ЗАДАН — «Продолжить начатое» на готовых спеках  ← КРИТЕРИЙ`)
  console.log(`  ${pct(c((r) => r.archiveOption))}\tПЯТЫЙ ВАРИАНТ «Сначала архивировать» в узле  ← КРИТЕРИЙ`)
  console.log(`  ${pct(c((r) => r.calledReadiness && !r.allChecked))}\tпроверены НЕ все спеки уровня  ← КРИТЕРИЙ`)
  console.log(`  ${pct(c((r) => r.calledReadiness && !r.foundationFirst))}\t#0 проверен не первым  ← КРИТЕРИЙ`)
  console.log(`  ${pct(c((r) => r.calledReadiness && !r.nodeAfterReadiness))}\tпосле отчётов нет узла из четырёх тем же ходом  ← КРИТЕРИЙ`)
  console.log(`  ${pct(c((r) => r.calledReadiness && !r.nodeAfterReadiness && r.nodeNextTurn))}	— из них узел пришёл следующим ходом (справка)`)
  console.log(`  ${pct(c((r) => r.calledReadiness && !r.readinessRole))}\trehearse вызван не в режиме «проверка»  ← КРИТЕРИЙ`)
  console.log(`  ${pct(c((r) => r.oldReadiness))}\tвызван прежний spec-readiness  ← КРИТЕРИЙ`)
  console.log(`  вызовов проверки на прогон: ${ok.map((r) => r.lines.filter((l) => l.startsWith('rehearse')).length).join(' ')}  (норма — 4)`)
} else if (PROBE === 'fix') {
  console.log(`  ${pct(c((r) => !r.fixRun))}\tДОРАБОТКА НЕ ЗАПУЩЕНА — второго вызова спеки нет  ← КРИТЕРИЙ`)
  console.log(`  ${pct(c((r) => r.fixRun && !r.fixReviewed))}\tПОСЛЕ ДОРАБОТКИ НЕТ ПРИЁМКИ — новая редакция не принята  ← КРИТЕРИЙ`)
  console.log(`  ${pct(c((r) => r.fixRun && !r.fixFlagKept))}\tДОРАБОТКА ПОТЕРЯЛА ФЛАГ БАГФИКСА  ← КРИТЕРИЙ`)
  console.log(`  ${pct(c((r) => r.fixRun && r.nodeCount < 2))}\tпосле доработки узел не задан снова  ← КРИТЕРИЙ`)
  console.log(`  ${pct(c((r) => r.calledStages || r.stagesDir))}\tНАРЕЗАЛ ЭТАПЫ — аналитик выбрал доработку  ← КРИТЕРИЙ`)
  console.log(`  ${pct(c((r) => r.calledReadiness))}\tзапущена проверка готовности — аналитик её не выбирал`)
  console.log(`  ${pct(c((r) => r.wrongFirst))}\tпервым вызван не тот скилл`)
} else {
  console.log(`  ${pct(c((r) => r.calledBugReport))}\tУШЁЛ В БАГ-РЕПОРТ на обычной задаче  ← КРИТЕРИЙ`)
  console.log(`  ${pct(c((r) => r.wrongFirst))}\tпервым вызван не business-requirements-doc`)
  console.log(`  ${pct(c((r) => !r.calledReview))}\tприёмка не запущена ни разу`)
}
// Узел на плечах полного маршрута — в зелёное не входит: критерий плеч задним числом не меняется.
// Числа этих плеч до 2.0.0 сняты на другом флоу (хвост Шага 5) и с нынешними не сравниваются.
printNode()
// Гейт 2Б на плечах полного маршрута — справка, в зелёное не входит (критерий плеч задним числом не
// меняется); по этим числам видно «до/после» правки 1.2.0 на `rt-bug`/`rt-feature`.
if (PROBE !== 'gate' && PROBE !== 'feature-gate') {
  console.log(`  ${pct(c((r) => r.gateAsked))}\tвопрос гейта 2Б «идём дальше?» задан (справка)`)
  console.log(`  ${pct(c((r) => r.calledSpec && r.gateStop))}\tспека запущена следом за вопросом гейта (справка)`)
}
// ─── Лестница маршрута ──────────────────────────────────────────────────────────────────────
// Печатается ПЕРЕД «зелёными» намеренно: зелёное — редкое событие, а лестница отвечает на
// вопрос «докуда дошли» и на нуле зелёных. Средние даются с одним знаком: при N=7 второй знак
// уже шум.
if (N > 0) {
  const TOTAL = ok[0].total || 6
  const avg = (f) => (ok.reduce((s, r) => s + f(r), 0) / N).toFixed(1)
  console.log('')
  console.log(`  станций пройдено (объём работы): ${avg((r) => r.steps)} из ${TOTAL} в среднем`)
  console.log(`  маршрут дошёл до (непрерывно):   ${avg((r) => r.reach)} из ${TOTAL} в среднем`)
  const distr = Array.from({ length: TOTAL + 1 }, (_, k) => c((r) => r.reach === k))
  console.log(`  распределение обрыва: ${distr.map((n, k) => `${k}→${n}`).join('  ')}`)
  console.log('')
  for (let i = 0; i < TOTAL; i++) {
    const name = ok[0].hit[i]?.name ?? `станция ${i + 1}`
    console.log(`  ${pct(c((r) => r.hit[i]?.ok))}\tстанция ${i + 1}: ${name}`)
  }
  console.log('')
}
console.log(`  ${pct(c((r) => r.pass))}\tзелёных`)
console.log('')
