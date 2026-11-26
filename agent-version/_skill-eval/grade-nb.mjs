#!/usr/bin/env node
// grade-nb.mjs — пробы analyst-notebook 1.1.0–1.2.0 (`nb-*`): запись в ноут, сборка выкладки, вопрос по ноуту; 1.2.0 —
// запись списка пунктов `*.points.md`, выгрузка `собери пункты [с <даты>]`, строка-маршрут на расшифровку.
//
//   node grade-nb.mjs <каталог с песочницами пробы> --fx NEW|THOUGHT|CONTRA|NOAUTH|FILE|VIEW-API|VIEW-CHAT|
//                                                      DISPUTE|ANSWER|ASK|LONG|VIEW-PART|
//                                                      PTS-IN|PTS-NEW|PTS-REC|EXPORT|EXPORT-SINCE|ROUTE|
//                                                      DESC-ONE|DESC-TWO|AUTO
//   node grade-nb.mjs --selftest [-v]        (-v — какие ещё проверки краснеют на каждой порче)
//
// 1.2.0 (fixtures/NB-PTS-*, NB-EXPORT*, NB-ROUTE): пункты записи — пункты списка как есть, без ` · L<n>`, заголовок
// `встреча <дата> | встреча по памяти <дата>`, `> исходник: <путь к списку>`, сверка Шага 4 (`вместо:` того же человека,
// `отвечает на:`); выгрузка — файл `notebook-<дата>.points.md`: только действующее, строки как в ноуте, ` · <дата> №<n>`
// у каждого пункта, без хвостов связей, мысли и наброски своими видами, без вопроса о них; расшифровка по ссылке — строка
// `/meeting-intake <путь>`, файлов нет, vtt не прочитан.
//
// Контракт — analyst-notebook/SKILL.md 1.1.0 и reference/view-check.md: виды совпадений (уже есть, уточнение,
// `отвечает на:`, `вместо:` того же человека, спор разных людей), режим `спроси`, сборка в любой форме, длинная
// вставка в `sources/`, кандидат в «решил» — только из имён этого текста, выкладка — только после проверки субагентом.
//
// Грейдятся ФАЙЛЫ песочницы: ноут `notes/<тема>/notebook.md`, выкладка рядом с ним, исходник в `sources/`, засев.
// Засев сравнивается со снимком, взятым при засеве: `_seeded.sha256` песочницы (`<sha256>  <путь>` или `<sha256> *<путь>`,
// хеш байтов, как файл лёг в песочницу) — тогда побайтно, ноут, переписанный в CRLF, — изменён; снимка нет — по LF-тексту
// (CRLF рабочей копии при `core.autocrlf` — не изменение). `_seeded.txt` — список путей, как у остальных оценщиков.
// Для разбора — LF и без BOM.
// Опора (выдумка) — `ground-check.mjs` плюс то, чего в нём нет (`inventedIn`): пункт новой записи — против текста вызова,
// реплики и списка; элемент выкладки и пункт выгрузки — против пунктов ноута с текстом под `>`.
// «НЕ ИЗМЕРЕНО» — только отказ API (маркер раннера с ошибкой API или пустым потоком хода); прогон без ответа, который
// ничего не записал, — красный «файл не записан».
// Текст ответа — только там, где критерий про заданный вопрос: CONTRA, NOAUTH, DISPUTE, ANSWER (вопрос до записи),
// FILE (строка про meeting-intake), VIEW-CHAT (ход, где собрана выкладка), ASK (ответ по ноуту). Поток вызовов —
// запись ноута на первом ходу (все пробы записи), чтение vtt и pdf, запись в режиме вопроса, проверка выкладки
// субагентом до записи файла.
// Критерии — fixtures/NB-*/expected.md. Новый раздел даты — любая `## ГГГГ-ММ-ДД` позже последней даты засева.

import { readdirSync, readFileSync, existsSync, statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs'
import { join, relative, dirname, basename, posix, resolve as pathResolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { groundCheck } from './ground-check.mjs'
import { parseNotebook } from './nb-state.mjs'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const lf = (s) => s.replace(/\r\n/g, '\n')
// Для разбора: LF и без BOM. Для сравнения с засевом — `bytes`, сырые байты (против снимка `_seeded.sha256`).
const read = (p) => lf(readFileSync(p, 'utf8')).replace(/^﻿/, '')
const bytes = (p) => readFileSync(p)
const RE_API_FAILURE = /API Error|Request not allowed|Please run \/login|Credit balance|rate limit|session limit|usage limit/i
// Граница слова для кириллицы: `\b` в JS — только ASCII.
const w = (stem, flags = 'i') => new RegExp('(^|[^а-яёa-z])' + stem, flags)
const norm = (s) => s.toLowerCase().replace(/ё/g, 'е')
const words = (s) => norm(s).split(/[^a-zа-я0-9]+/).filter(Boolean)
const flat = (s) => words(s).join(' ')

const LAST_SEED = '2026-10-10'
const FIRST_SEED = '2026-10-06'
const NB_RET = 'notes/возврат-товара-без-чека/notebook.md'
const NB_API = 'notes/api-бонусной-программы-для-партнёров/notebook.md'
// 2.2.0: видов четыре — `набросок` слит в `мысль` (PLAN-NOTEBOOK-STATE.md, Р4).
const KINDS = new Set(['решено', 'открыто', 'сведение', 'мысль'])
// Ссылка «дата №»: «2026-10-06 №1», «2026-10-06, №1».
const REF = /\d{4}-\d{2}-\d{2},?\s*№\s*\d+/
const refAt = (date, n) => new RegExp(date + ',?\\s*№\\s*' + n + '(?!\\d)')
const REFS_G = /(\d{4}-\d{2}-\d{2}),?\s*№\s*(\d+)/g
const STRIP_REFS = (s) => s.replace(/\d{4}-\d{2}-\d{2}(,?\s*№\s*\d+(\.\d+)?)?/g, ' ').replace(/№\s*\d+(\.\d+)?/g, ' ')
const DATE_H = /^## (\d{4}-\d{2}-\d{2})\s*$/
const DECIDED_BY = /решил[аи]?\s*:/i
// Старый пункт NB-CONTRA — строка засева дословно (сравнение строкой, не регуляркой).
const OLD_CARD = '- [решено] Возврат только на карту, с которой платили — решил: Соколова М. · 2026-10-08 №1.2'
// 2.0.0: номера пунктов засева, на которые ссылаются замена и ответ (fixtures/NB-CONTRA, NB-ANSWER).
const OLD_CARD_ID = '2026-10-08 №1.2'
const OLD_Q_ACT_ID = '2026-10-09 №1.2'
const OLD_Q_LINE = '- [открыто] Кто подписывает акт возврата без чека — ждёт: Гарипова Л. · 2026-10-09 №1.2'
// Есть ли у строки засева пометка `‖ <state>…` в выходе.
const markedAs = (text, seedText, line, state) => (marksAdded(text, seedText).get(line) || []).some((m) => new RegExp('^' + state, 'i').test(m))
// Начало пункта для «…» после `вместо:` и `отвечает на:` (сравнение словами через flat, не регуляркой).
const OLD_CARD_TEXT = 'Возврат только на карту, с которой платили'
const OLD_Q_ACT = 'Кто подписывает акт возврата без чека'
const PART_FROM = '2026-10-08'
// Факты, которые есть только в расшифровке NB-FILE.
const VTT_ONLY = [/(^|\D)48(\D|$)/, w('(сорок\\s*восем|короб|промышлен|зуев|кладовщик|фотограф)')]
const VTT_FILES = /sklad\.vtt|reglament\.pdf/

// ---------- 1.2.0: список пунктов, выгрузка, маршрут ----------

const NB_REC = 'notes/отмена-записи/notebook.md'
const LIST_IN = 'coddoc/_inbox/meeting-2026-10-13.points.md'
const LIST_NEW = 'coddoc/_inbox/meeting-2026-10-12.points.md'
const LIST_REC = 'coddoc/MED-77/meeting-2026-10-14.points.md'
const NB_ROOM = 'notes/бронирование-переговорных/notebook.md'
const ROUTE_VTT = 'calls/2026-10-13-vozvraty.vtt'
const ROUTE_VTT_RE = /2026-10-13-vozvraty\.vtt/
// Факты, которые есть только в расшифровке NB-ROUTE.
const ROUTE_ONLY = [/(^|\D)17(\D|$)/, w('(кузнецов|заречн)')]
// Ссылка на строку источника в конце пункта списка: ` · L57`, ` · протокол L45`.
const L_TAIL = /\s*·\s*(?:протокол\s+)?L\d+\s*$/
const L_ANY = /(^|[\s·(])L\d+(?!\d)/
// Хвост связи пункта ноута: `; вместо: <дата> №<n> «…»`, `; отвечает на: …` — где бы ни стоял.
const LINK_ANY = /(?:вместо|отвечает\s+на)\s*:/i
// Сравнение пункта «как есть»: основы слов по 5 букв, по порядку — склонение имени («Дёмин К.» / «Дёмина К.»), «решила:»,
// кавычки и знаки — не правка; потерянное слово, хвост автора, «(по памяти, не уверен)» — правка.
const stemFlat = (s) => words(s).map((x) => x.slice(0, 5)).join(' ')
const stemSet = (s) => new Set(words(s).filter((x) => x.length >= 3).map((x) => x.slice(0, 5)))
const sim = (a, b) => { const A = stemSet(a); const B = stemSet(b); if (!A.size || !B.size) return 0; let n = 0; for (const x of A) if (B.has(x)) n++; return n / (A.size + B.size - n) }
// ---------- 1.2.0: ноут по словам из строки вызова (шапка `о чём:`), вызов без слэша ----------

const NB_AS = 'notes/интеграция-с-ас-друг/notebook.md'
const NB_REP = 'notes/отчётность-ас-друг/notebook.md'
const NB_DUTY = 'notes/дежурства-на-складе/notebook.md'
// Варианты вопроса о ноуте: тема и `о чём` каждого из двух («<тема> — <о чём>», Шаг 1).
const PICK_AS = [w('интеграц'), w('(обмен|портал|обслуж)')]
const PICK_REP = [w('отч[её]тн'), w('(выгруз|ежемесяч|бухгалтер|выполненн)')]
const OTHER_NB = w('(отч[её]тн|дежурств)')

// Дата встречи в заголовке записи: ISO, «13.10», «13.10.2026», «13 октября».
const MONTHS = ['январ', 'феврал', 'март', 'апрел', 'ма[яй]', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр']
const meetDateRe = (d) => { const [y, m, dd] = d.split('-'); return new RegExp(`${d}|(^|\\D)0?${Number(dd)}\\.${m}(\\.(${y}|${y.slice(2)}))?(\\D|$)|(^|\\D)0?${Number(dd)}\\s+${MONTHS[Number(m) - 1]}`, 'i') }

// Срок и время — группой: есть в пункте, нет в источнике → выдумано. Числа (цифрой и словом) сверяет значением
// ground-check.mjs: «три дня» при «3 дня» в источнике — не выдумка, «тридцать» при «двадцать» — выдумка.
const GROUPS = [
  w('недел'),
  w('месяц'),
  w('сут(ки|ок|кам|ках)(?![а-яё])'),
  w('(день|дня|дней|дням|днях)(?![а-яё])'),
  w('(час|часа|часов|часам)(?![а-яё])'),
  w('минут'),
  w('(год|года|году|лет)(?![а-яё])'),
  w('(январ|феврал|март|апрел|ма[яйе](?![а-яё])|июн|июл|август|сентябр|октябр|ноябр|декабр)'),
  w('(понедельник|вторник|сред[ау](?![а-яё])|четверг|пятниц|суббот|воскресен)'),
  w('(завтра|послезавтра)(?![а-яё])'),
  w('квартал'),
]

// ---------- круг harden: большой ноут (NB-BIG), двойник аналитика (NB-TWIN) ----------

const NB_BIG = 'notes/заселение-без-администратора/notebook.md'
const NB_TWIN = 'notes/доставка-букетов-к-точному-времени/notebook.md'
// Соседи спора без ответа (стр. 84, 85) и отвеченного спора (стр. 75–77) идут как есть — правка E9; на тексте 1.2.0
// «пункт по этой ссылке» читается и как вся запись (fixtures/NB-BIG/expected.md, стык 1).
const BIG_NEIGHBORS = [75, 76, 77, 84, 85]
const BIG_DISPUTE_REF = '2026-10-09 №1'
// Выбывшие — метками expected, а не сходством слов: победитель похож на заменённого (41↔126, 66↔144 — 0,70).
// `y` — строка выгрузки: вид, концевая ссылка, строка целиком.
const BIG_GONE = [
  { ln: '31', t: (y) => y.kind === 'открыто' && w('освободил').test(y.l) },
  { ln: '41', t: (y) => w('сутк').test(y.l) && y.ref === '2026-09-23 №1' },
  { ln: '62', t: (y) => y.kind === 'открыто' && w('интернет').test(y.l) },
  { ln: '66', t: (y) => y.kind === 'мысль' && y.ref === '2026-09-24 №2' && w('один').test(y.l) },
  { ln: '74/118', t: (y) => /100\s*%/.test(y.l) && ['2026-09-25 №1', '2026-10-01 №2'].includes(y.ref) },
  { ln: '83', t: (y) => y.kind === 'решено' && w('не\\s+сработал').test(y.l) },
  { ln: '94', t: (y) => y.kind === 'открыто' && w('кто\\s+пишет').test(y.l) },
]

// ---------- выкладка API (NB-VIEW) ----------

const HANDLES = [
  { id: 'balance', re: /\/balance(?![\w-])/, kind: 'решено', ref: '2026-10-06 №1' },
  { id: 'accruals', re: /\/accruals(?![\w/-])/, kind: 'решено', ref: '2026-10-06 №1' },
  { id: 'reversals', re: /\/reversals(?![\w-])/, kind: 'решено', ref: '2026-10-09 №1' },
  { id: 'redemptions', re: /\/redemptions(?![\w-])/, kind: 'мысль', ref: '2026-10-08 №1' },
  { id: 'transactions', re: /\/transactions(?![\w-])/, kind: 'мысль', ref: '2026-10-08 №1' },
  { id: 'webhooks', re: /\/webhooks(?![\w-])/, kind: 'мысль', ref: '2026-10-08 №1' },
]
const OLD_A = /\/bonus\/cancel(?![\w-])/
// Зачёркнутый путь A — тоже пометка замены.
const STRUCK_A = /~~[^~\n]*\/bonus\/cancel[^~\n]*~~/
const MARK = w('(замен|вместо|устар|прежн|ранее|раньше|не\\s+дейст|не\\s+делаем|отказал|стар(ый|ая|ое|ого)(?![а-яё])|пересмотр|было(?![а-яё])|был(?![а-яё]))')
const DECIDED = /(?<![а-яё])(?<!не\s)(решено|согласовано|утверждено)/i
// Путь — и после `**` и `[`: «**/partners/…**», «[/partners/…](…)».
const PATH_RE = /(^|[\s`(|«"'*[])(\/[a-z{][A-Za-z0-9_{}-]*(?:\/[A-Za-z0-9_{}-]+)*)/g
const PAIR_RE = /(GET|POST|PUT|PATCH|DELETE)[\s|`*[]*(\/[a-z{][A-Za-z0-9_{}/-]*)/g
// Вид «мысль» у слов аналитика (2.2.0; прежнее «набросок» — тоже): мысль, мысли, набросок, наброски.
const DRAFT = w('(мысл[ьи]|наброс(?:ок|к))')
// Открытые вопросы 2026-10-08 №2: авторизация; списание, когда бонусов не хватает.
const OPEN_Q = [{ id: 'авторизация', re: w('авториз') }, { id: 'бонусов не хватает', re: w('(не\\s+хват|недостат)') }]
const AS_DECIDED = (c) => (DECIDED.test(c) || DECIDED_BY.test(c)) && !w('(открыт|жд[её]т|не\\s+решен)').test(c)
const NOT_API = /^\/(c|d|tmp|home|users)(\/|$)|\/notes(\/|$)/i

// ---------- выкладка в чат (NB-VIEW) ----------

const STORIES = [
  { id: 's1', d: 'баланс клиента на кассе', re: [w('баланс'), w('(предлож|оплат)')] },
  { id: 's2', d: 'событие о списании', re: [w('(списал|списани|списыва)'), w('(событи|уведом|опрашив)')] },
  { id: 's3', d: 'выгрузка начислений', re: [w('(выгруз|свер)')] },
]
const STORY_REF = refAt('2026-10-08', 1)
const DEADLINE = w('(срок|запуск)')
const NOPE = w('(?:в\\s+ноуте\\s+(?:нет|ничего|не\\s+(?:найден|нашл|нашёл|нашел|упомина|сказано|указан|говорится))|нет\\s+в\\s+ноуте|ноут\\S*\\s+(?:не\\s+содерж|молчит)|не\\s+(?:нашл|нашёл|нашел|найден|упомина|указан|обсужда|записан)|пункт\\S*[^\\n]{0,30}нет(?![а-яё])|нет\\s+(?:ни\\s+одного\\s+)?пункт|отсутству)')
const DATE_WORDS = [
  w('(январ|феврал|март|апрел|ма[яйе](?![а-яё])|июн|июл|август|сентябр|октябр|ноябр|декабр|квартал|к\\s+концу|в\\s+(этом|следующем)\\s+(месяце|году|квартале))'),
  /(^|[^\d])\d{1,2}\.\d{1,2}(\.\d{2,4})?([^\d]|$)/,
  /(^|[^A-Za-z])Q[1-4]([^\d]|$)/,
  w('(через|за)\\s+\\d+\\s*(дн|недел|месяц)'),
]

// ---------- вопросы до записи (CONTRA, DISPUTE, ANSWER) ----------

// Вопрос «что верно»: какое из решений верно / действует / актуально, «новое или старое». «Если что-то неверно —
// поправлю» — не он: «что-то» отсечено, «неверно» — не начало слова.
const RE_WHICH_ASK = w('(?:(?:что|как(?:ое|ой|ая|ие))(?![а-яё-])[^\\n?]{0,40}(?<![а-яё])(?:верн|действу|актуальн|правильн|в\\s+силе)|нов(?:ое|ый|ая|ого)\\s*(?:,|или)\\s*стар|стар(?:ое|ый|ая|ого)\\s*(?:,|или)\\s*нов)')
// Цитата в «…» — не вопрос скилла: «вопрос «что действует» не задаю — записать так?» не спрашивает, что верно.
const unquoted = (l) => l.replace(/«[^»\n]*»/g, ' ').replace(/"[^"\n]*"/g, ' ')
// «Всё, что выше, — верно?», «Что записываю — верно?» — вопрос Шага 5 о записи, а не «что верно»: между «что» и
// «верно» — указание на саму запись.
const NOT_WHICH = w('(выше|ниже|записываю|записал|пишу|получил)')
const whichAsk = (l) => { const m = unquoted(l).match(RE_WHICH_ASK); return !!m && !NOT_WHICH.test(m[0]) }
// Обычный вопрос Шага 5 перед записью.
const RE_CONFIRM = w('(?:записат|записыва|запиш|пишу|поправ|подтверд|так\\s*(?:\\?|или)|верно\\s*\\?|правильно\\s*\\?|годится|подходит|соглас|ок\\s*\\?|ок\\s+ли)')
// Вопрос о споре: «что действует», «спор», «в открытые». «…или „не знаю“ — тогда в открытые» под вопросом «кто
// решил» — не он: с ним замена без вопроса о споре проходила бы.
const disputeAsk = (l) => { const u = unquoted(l); return whichAsk(l) || w('спор').test(u) || (w('в\\s+открыт').test(u) && !RE_WHO.test(u)) }
// Текст в кавычках после ссылки: «…», "…", “…”, „…“ — какие кавычки, не важно.
const QUOTED = String.raw`(?:«([^»\n]*)»|"([^"\n]*)"|[“„]([^”“\n]*)[”“])`
const RE_REPL_CONTRA = new RegExp(String.raw`вместо\s*:\s*(2026-10-08,?\s*№\s*1(?:\.(\d+))?)(?!\d)\s*` + QUOTED + '?')
const RE_ANS_ACT = new RegExp(String.raw`отвечает\s+на\s*:\s*(2026-10-09,?\s*№\s*1(?:\.(\d+))?)(?!\d)\s*` + QUOTED + '?')
const quoteOf = (m) => (m ? m.slice(3).find((x) => x !== undefined) || '' : '')
// В кавычках — начало старого пункта: одно слово — мало, весь пункт с хвостом — законно.
const startsItem = (quote, item) => { const q = flat(quote); const it = flat(item); return q.split(' ').length >= 2 && (it.startsWith(q) || q.startsWith(it)) }
// Текст пункта без вида, хвостов связи (`; вместо: <дата> №<n> «…»`, `; отвечает на: …` — где бы ни стояли) и ссылок
// ` · L<n>`: так пункт ноута сравнивается с пунктом списка.
const LINK_TAIL = new RegExp(String.raw`;?\s*(?:вместо|отвечает\s+на)\s*:\s*\d{4}-\d{2}-\d{2},?\s*№\s*\d+(?:\.\d+)?\s*` + QUOTED + '?', 'gi')
// 2.0.0: номер пункта в конце строки (` · 2026-10-08 №1.2`) и пометки состояния (` ‖ заменён: …`) — не текст пункта.
const ID_TAIL = /\s*·\s*\d{4}-\d{2}-\d{2},?\s*№\s*\d+\.\d+\s*$/
const MARKS = /\s*‖[^\n]*$/
// Строка выгрузки из строки ноута: без пометок и хвостов связей, концевой номер пункта — как есть.
const exportLine = (l) => l.replace(MARKS, '').replace(/;\s*(?:вместо|отвечает\s+на)\s*:\s*\d{4}-\d{2}-\d{2},?\s*№\s*\d+(?:\.\d+)?/gi, '').trimEnd()
const core = (l) => l.replace(MARKS, '').replace(ID_TAIL, '').replace(/^\s*(?:[-*•+]|\d+[.)])\s*\[[^\]]*\]\s*/, '').replace(LINK_TAIL, ' ').replace(new RegExp(L_ANY.source, 'g'), ' ')

// ---------- вопрос по ноуту (NB-ASK) ----------

const ASK_MARK = w('(замен|вместо|устар|прежн|ранее|раньше|не\\s+дейст|отмен|передумал|стар(ый|ая|ое|ого)(?![а-яё])|пересмотр|было(?![а-яё])|был(?![а-яё]))')
const ASK_OLD = [w('только\\s+на\\s+карту'), /с\s+которой\s+платили/i]
const ASK_ACT = w('(подпис|акт(а|у|ом|е)?(?![а-яё]))')
const ASK_OPEN = [/жд[её]т\s*:/i, w('открыт(о|ый|ым)(?![а-яё])')]
// «Закрыло открытый вопрос 2026-10-08 №1» — круг 5, run-1: глагол «закрыл…» тоже говорит, что вопрос закрыт.
const ASK_CLOSED_OK = w('(старш|закрыт|закрыл|отвеч|ответ|был)')
const V14 = /(^|[^\d-])14\s*(дн|календ|рабоч)|четырнадцат/i
const V30 = /(^|[^\d-])30\s*(дн|календ|рабоч)|тридцат\S*\s+дн/i
// «Записать открытым вопросом — к кому?» под соседним ответом — не пометка спора: только «открыто».
const DISPUTE_MARK = w('(спор|расход|разошл|что\\s+верно|открыто(?![а-яё])|жд[её]т|не\\s+решен|не\\s+выбр|или(?![а-яё]))')
// Вердикт рядом с одной стороной: «действует 14 дней», «последнее слово — 30 дней», «14 дней — в силе».
const CHOICE = /(?<!не\s)(действу\S*|актуальн\S*|в\s+силе|(?<!что\s)верн(?:о|ое|ый)(?![а-яё])|правильн\S*|итог\S*|последн\S*)[^\n]{0,25}(?:14|30)\s*(?:дн|календ)|(?:14|30)\s*дн\S*[^\n]{0,25}(?<!не\s)(?:действу|актуальн|в\s+силе)/gi
// Не выбор: вопрос («что действует — 14 или 30?»); внутри вердикта обе стороны, спор или отрицание («действует 14 или
// 30 дней», «итог: спор между 14 и 30 днями», «действующего решения нет: 14 дней …»).
const choiceIn = (l) => !l.includes('?') && [...l.matchAll(CHOICE)].some((m) =>
  !w('(или|либо|спор|расход|против|нет(?![а-яё])|не\\s)').test(m[0]) && !(/14/.test(m[0]) && /30/.test(m[0])) &&
  !/(что|как\S*|кто)\s*[:—–-]?\s*$/i.test(l.slice(Math.max(0, m.index - 12), m.index)))
const ABSENT_Q = w('(лимит|сумм)')
const ABSENT_INVENT = w('(тысяч|руб)')

// ---------- выкладка из части ноута (NB-VIEW-PART) ----------

const ARROW = /-->|->>|-\.->|==>|->|—>|–>|→|⟶|⇒|⇢|⟹|➜|➔|▶|►|←|<-|↔/
const P_KASSA = w('касс')
const P_APP = w('(мобильн|приложени)')
const P_UCHET = w('уч[её]тн')
const P_API = /(^|[^A-Za-z])API([^A-Za-z]|$)|наш\S*\s+(сервис|систем|бэкенд)/i
const VERB = w('(переда|отправл|сообща|запраш|вызыва|получа|забира|шл[её]т|шлют|отда[её]т|отдаю|подписыва|присыла|д[её]рга|уведомл)')
const LEGEND = w('(легенд|обозначени|условн\\S*\\s+знак)')
const OUTSIDE = w('(не\\s+брал|не\\s+вош[лё]|не\\s+вход|не\\s+попал|исключ|вне\\s+(част|срез|выборк)|за\\s+пределами|не\\s+включ|не\\s+учитыв|отброш|пропущ)')
// Участники, которых в ноуте нет. Без «почти», «в первую очередь»: почта и очередь — только сочетаниями.
const INVENTED_PART = w('(банк|эквайр|crm|1[сc](?![а-яёa-z0-9])|офд|шлюз|sms|смс|push|пуш(?![а-яё])|e-?mail|электронн\\S*\\s+почт|почтов|kafka|кафк|брокер|очеред\\S*\\s+сообщ|шин\\S*\\s+(данн|сообщ|событ)|личн\\S*\\s+кабинет)')
// Обмены, названные только в записях до части (2026-10-06 №1, 2026-10-07 №1).
const EARLY_TRAPS = [
  // «Отмена начисления» (/reversals, решение части 2026-10-09 №1) — не ранний обмен «касса → начисление бонусов»: круг 5,
  // run-3 — узел «Партнёр: касса и мобильное приложение» со стрелкой отмены красился.
  { d: 'касса + начисление', t: (l) => P_KASSA.test(l) && (w('начисл').test(l) || /\/accruals/.test(l)) && !(w('отмен\\S*\\s+начисл').test(l) || /\/reversals/.test(l)) },
  { d: 'приложение + баланс', t: (l) => P_APP.test(l) && (w('баланс').test(l) || /\/balance/.test(l)) },
  { d: 'номер чека', t: (l) => w('номер\\S*\\s+чек').test(l) },
  { d: 'сумма покупки', t: (l) => w('сумм\\S*\\s+покуп').test(l) },
  { d: 'раз в сутки', t: (l) => w('сутк').test(l) },
]
// Связи части: предмет и ссылка на свою запись — в одной строке (с узлами Mermaid, подставленными по имени).
const PART_CONN = [
  { id: 'вебхук о списании', re: [w('(вебхук|событи|уведом)|webhook'), w('списан')], refs: ['2026-10-10 №1', '2026-10-08 №1'] },
  { id: 'история в приложении', re: [P_APP, /(^|[^а-яё])(истори|операци)|transactions/i], refs: ['2026-10-10 №1', '2026-10-08 №2'] },
  { id: 'учётная система', re: [P_UCHET], refs: ['2026-10-10 №1'] },
  { id: 'подписка на события', re: [/(^|[^а-яё])подпис[кы]|\/webhooks/i], not: w('списан'), refs: ['2026-10-08 №1'] },
  { id: 'выгрузка начислений', re: [w('(выгруз|свер)')], refs: ['2026-10-08 №1'] },
  { id: 'баланс на кассе', re: [P_KASSA, w('баланс')], refs: ['2026-10-08 №1'] },
  { id: 'авторизация', re: [w('авториз')], refs: ['2026-10-08 №2'] },
]
const PART_MIN = 4

// ---------- фикстуры ----------

const D = {
  written: 'файл не записан',
  one: 'ровно один notes/<папка>/notebook.md',
  head: 'шапка: тема и «ключ: —»',
  files: 'кроме ноута ничего не создано и не изменено',
  old: 'старая часть ноута байт в байт',
  date: 'один новый раздел даты, записи с ### 1',
  kinds: 'пункты пяти видов',
  decidedBy: 'у каждого [решено] есть «решил:»',
  invented: 'в пунктах нет чисел, сроков, имён, кодов не из промпта и реплики',
  decided: '[решено] … решил: Соколова',
  open: '[открыто] … ждёт: юристы',
  fact: '[сведение] с числом 37',
  quote: 'строки чата под «>»',
  heading: '### 1 · мысль аналитика',
  thought: 'пункт [мысль]',
  noDecided: 'нет [решено]',
  asked: 'до записи задан вопрос',
  beforeWrite: 'на первом ходу ноут не записан (до ответа на вопрос Шага 5)',
  writeFirst: 'список без находок записан на ходу 1, без вопроса «Записать так?» (Р5)',
  replaced: '[решено] наличными — решил: Соколова; вместо: 2026-10-08 №1',
  oldItem: 'старый пункт про карту на месте',
  openItem: 'пункт про склад есть и не [решено]',
  noAuthor: '«решил:» только с именем из промпта',
  intake: 'строка «/meeting-intake calls/2026-10-10-sklad.vtt»',
  fileEntry: 'запись «файл docs-in/reglament.pdf», пункт из слов аналитика, не [решено]',
  noVtt: 'фактов только из vtt в ноуте нет',
  noRead: 'vtt и pdf не прочитаны',
  notebook: 'ноут байт в байт',
  viewFile: 'один файл notes/<тема>/<…>-<дата>.md',
  vhead: 'шапка «Собрано из ноута»',
  all6: 'все 6 ручек',
  oldPath: 'POST /bonus/cancel не подан действующим',
  drafts: 'наброски — «набросок», не «решено»',
  refs: 'у строки с ручкой ссылка «дата №»',
  noInvented: 'путей и ручек не из ноута нет',
  elemWords: 'числа, латиница и люди в полях элементов — из пунктов ноута',
  openQ: 'открытые вопросы 2026-10-08 №2 не поданы «решено»',
  checked: 'файл выкладки записан после проверки субагентом',
  stories: 'истории со ссылками «дата №»',
  noDeadline: 'про сроки — «в ноуте нет»',
  noDate: 'без выдуманной даты',
  confirm: 'до записи спрошено «Записать так?»',
  noWhich: 'вопроса «что верно» в ходе 1 нет',
  bothSides: 'в ходе 1 спор с обеими сторонами: Соколова и старое, Гарипова и новое, вопрос',
  openDispute: '[открыто] что верно: оба ответа — ждёт: Соколова',
  noDecidedNew: 'нет [решено] с позицией Гариповой',
  noReplace: 'нет «вместо:» в новой записи',
  answered: 'пункт про старшего кассира — отвечает на: 2026-10-09 №1.2, у вопроса «‖ закрыт»',
  money: 'деньги — наличными, ссылка 2026-10-09 №1',
  noReplaced: 'заменённое «только на карту» не подано действующим',
  closed: 'акт — старший кассир со ссылкой 2026-10-10 №1, не открытый вопрос',
  dispute: 'дни — обе стороны (14 и 30), пометка спора и ссылка, без выбора',
  absent: 'лимит по сумме — «в ноуте нет» без выдумки',
  source: 'исходник notes/<тема>/sources/<дата>-<№>.md со вставкой дословно',
  sourceLine: 'строка «> исходник:» ведёт к файлу исходника',
  noCopy: 'вставка в ноут не скопирована (≤5 строк)',
  entryItems: 'в записи [решено] Соколовой и [открыто]',
  refsPart: 'у каждой строки связи ссылка «дата №»',
  noEarly: 'ни ссылок, ни обменов из записей до 2026-10-08',
  noInventedPart: 'связей не из пунктов части нет',
  enough: `не меньше ${PART_MIN} связей части со ссылкой`,
  // ---- 1.2.0: запись списка ----
  listHead: 'заголовок записи «встреча <дата встречи>: …» (по памяти — «встреча по памяти <дата>: …»)',
  asIs: 'пункты записи — пункты списка как есть: ни потерянных, ни переписанных, ни своих',
  noLineRef: 'в пунктах ноута нет « · L<n>» из списка',
  sourceList: 'строка «> исходник:» ведёт к файлу списка',
  noLinks: 'в новой записи нет «вместо:» и «отвечает на:»',
  noExtraLinks: '«вместо:» — только у пункта про наличные, «отвечает на:» — только у пункта про старшего кассира',
  decided12: '[решено] об отмене за 12 часов с «решил:»',
  thoughtKept: 'предупреждение пациенту — [мысль], не другим видом',
  // ---- 1.2.0: выгрузка ----
  ptsFile: 'один файл notes/<тема>/notebook-<дата>.points.md',
  ptsHead: 'шапка: «# Пункты: …», «> Источник: notes/<тема>/notebook.md», «> Задача: —»',
  range: 'строка «> Ноут: … записи <первая дата части>–<последняя>»',
  complete: 'все действующие пункты части в списке',
  expAsIs: 'строки пунктов — как в ноуте, ни своих, ни переписанных',
  noReplacedItem: 'заменённого и оспоренного (спор «что верно» по его ссылке) пункта нет',
  ptsLines: 'каждый пункт — строка «- [вид] …»: /notes-to-intent другие не читает',
  noClosedQ: 'закрытого вопроса нет',
  answerIn: 'ответ на закрытый вопрос есть',
  thoughts: '[мысль] и [набросок] части — в списке своими видами',
  refsOk: 'у каждого пункта « · <дата> №<n>» — ссылка на его запись',
  noLinksOut: 'в списке нет «вместо:» и «отвечает на:»',
  noAsk: 'вопроса о мыслях и набросках нет',
  noBefore: 'пунктов из записей раньше даты части нет',
  // ---- 1.2.0: маршрут ----
  route: 'строка «/meeting-intake calls/2026-10-13-vozvraty.vtt»',
  // ---- 1.2.0: ноут по словам, вызов словами ----
  about: 'в шапке строка «о чём:», её слова — из текста (или темы)',
  noPick: 'вопроса о выборе ноута нет',
  pickShown: 'вопрос о ноуте: оба ноута про АС Друг, у каждого тема и «о чём»',
  oneOfTwo: 'запись ровно в один из двух ноутов про АС Друг',
  descItems: '[решено] «по одной» — решил: Киселёв; пункт про номер заявки',
  invoked: 'скилл вызван сам: Skill analyst-notebook или чтение .claude/skills/analyst-notebook/SKILL.md',
  // ---- круг harden: NB-BIG ----
  neighbors: 'соседи спора в записи идут как есть (по правке E9)',
  noGone: 'выбывших пунктов нет (метки expected: стр. 31, 41, 62, 66, 74/118, 83, 94)',
  disputeLine: 'спор 2026-10-09 №1 — [открыто] «что верно» с обеими сторонами (диспетчер, горничная), концевая ссылка его',
  planFirst: 'ход 1 — план и вопрос «файлом или в чат», файла выкладки на ходу 1 нет',
  refsRows: 'строка таблицы без ссылки — только с опорой в ноуте (решение, число, срок, человек)',
  winners: 'победители цепочек и сосед 42 — «решено» со своей ссылкой (стр. 42, 126, 144, 173)',
  disputeOpen: 'оспоренное (стр. 83) и спор 2026-10-09 №1 не поданы «решено» без пометки о споре или расхождении',
  disputeMarked: 'оспоренное «решено» с пометкой «расходится» / «спор» — баг 2 по тексту 1.2.0 (по правке E9)',
  noReplacedRow: 'заменённое (стр. 41, 74) не подано действующим',
  noDraftDecided: 'наброски (2026-09-24 №2 «один код», 2026-10-12 №1) не поданы решёнными',
  noClosedOpen: 'закрытые вопросы (стр. 31, 62, 94, 118) не поданы открытыми',
  decider: 'решивший, если назван, — тот, что в «решил:» пункта по ссылке',
  // ---- круг harden: NB-TWIN ----
  askDispute: 'до записи — вопрос о споре: обе стороны, Дробышева и Мельничук, 15 и 30',
  askWho: 'до записи — вопрос «кто решил» о звонке',
  reshow: 'после «Поправить» — пункты ещё раз тем же вопросом, с 35, без записи',
  writeAfterOk: 'ноут записан только после ответа «Записать»',
  fact35: '[сведение] об опозданиях — с «35», «25» нет ни в одном пункте записи',
  noDecided30: 'нет [решено] о допуске 30 минут, «вместо:» и «что верно»',
  callOpen: 'звонок получателю — [открыто] без «решил:»',
  quoteVerbatim: 'письмо под «>» дословно, «35» в строку письма не вписано',
}

// «Вопрос до записи» (Шаг 5 → Шаг 6) — во всех пробах записи: на ходу 1 ноут не записан.
const WRITE_COMMON = ['files', 'old', 'date', 'kinds', 'decidedBy', 'invented', 'beforeWrite']
const FX = {
  // 1.2.0: в шапке нового ноута — `о чём:` словами текста (fixtures/NB-NEW/expected.md, «Правка 1.2.0»).
  NEW: { dir: 'NB-NEW', mode: 'write', prompt: 'w-prompt.txt', reply: 'w-turn2.txt', notebook: null,
    checks: ['one', 'head', 'about', 'files', 'date', 'kinds', 'decidedBy', 'invented', 'beforeWrite', 'decided', 'open', 'fact', 'quote'] },
  THOUGHT: { dir: 'NB-THOUGHT', mode: 'write', prompt: 'w-prompt.txt', reply: 'w-turn2.txt', notebook: NB_RET,
    checks: [...WRITE_COMMON, 'heading', 'thought', 'noDecided'] },
  // 1.1.0: тот же человек передумал — замена без вопроса «что верно» (fixtures/NB-CONTRA/expected.md, «Правка 1.1.0»).
  CONTRA: { dir: 'NB-CONTRA', mode: 'write', prompt: 'w-prompt.txt', reply: 'w-turn2.txt', notebook: NB_RET,
    checks: [...WRITE_COMMON, 'confirm', 'noWhich', 'replaced', 'oldItem'],
    desc: { replaced: '[решено] наличными — решил: Соколова; вместо: 2026-10-08 №1 «…»' } },
  NOAUTH: { dir: 'NB-NOAUTH', mode: 'write', prompt: 'w-prompt.txt', reply: 'w-turn2.txt', notebook: NB_RET,
    checks: [...WRITE_COMMON, 'asked', 'openItem', 'noAuthor'],
    desc: { asked: 'до записи спрошено, кто решил' } },
  FILE: { dir: 'NB-FILE', mode: 'write', prompt: 'w-prompt.txt', reply: 'w-turn2.txt', notebook: NB_RET,
    checks: [...WRITE_COMMON, 'intake', 'fileEntry', 'noVtt', 'noRead'] },
  'VIEW-API': { dir: 'NB-VIEW', mode: 'view-file', prompt: 'w-prompt-api.txt', reply: 'w-turn2-api.txt', notebook: NB_API,
    checks: ['files', 'notebook', 'viewFile', 'checked', 'vhead', 'all6', 'oldPath', 'drafts', 'openQ', 'refs', 'noInvented', 'elemWords'],
    desc: { files: 'кроме выкладки ничего не создано и не изменено' } },
  'VIEW-CHAT': { dir: 'NB-VIEW', mode: 'view-chat', prompt: 'w-prompt-chat.txt', reply: 'w-turn2-chat.txt', notebook: NB_API,
    checks: ['files', 'notebook', 'stories', 'drafts', 'noDeadline', 'noDate', 'elemWords'],
    desc: { files: 'новых файлов нет', drafts: 'истории-наброски не поданы «решено» / «решил:»' } },
  // ---- analyst-notebook 1.1.0 ----
  DISPUTE: { dir: 'NB-DISPUTE', mode: 'write', prompt: 'w-prompt.txt', reply: 'w-turn2.txt', notebook: NB_RET,
    checks: [...WRITE_COMMON, 'bothSides', 'openDispute', 'noDecidedNew', 'noReplace'] },
  ANSWER: { dir: 'NB-ANSWER', mode: 'write', prompt: 'w-prompt.txt', reply: 'w-turn2.txt', notebook: NB_RET,
    checks: [...WRITE_COMMON, 'noWhich', 'answered'] },
  ASK: { dir: 'NB-ASK', mode: 'ask', prompt: 'w-prompt.txt', reply: 'w-turn2.txt', notebook: NB_RET,
    checks: ['files', 'money', 'noReplaced', 'closed', 'dispute', 'absent'],
    desc: { files: 'ничего не создано и не изменено, записи нет' } },
  LONG: { dir: 'NB-LONG', mode: 'write', prompt: 'w-prompt.txt', reply: 'w-turn2.txt', notebook: NB_RET,
    allow: /^notes\/возврат-товара-без-чека\/sources\//,
    checks: [...WRITE_COMMON, 'source', 'sourceLine', 'noCopy', 'entryItems'],
    desc: { files: 'кроме ноута и исходника ничего не создано и не изменено' } },
  'VIEW-PART': { dir: 'NB-VIEW-PART', mode: 'view-file', prompt: 'w-prompt.txt', reply: 'w-turn2.txt', notebook: NB_API,
    viewText: (v, nb, gsrc) => gradePartText(v, nb, gsrc),
    checks: ['files', 'notebook', 'viewFile', 'checked', 'refsPart', 'noEarly', 'noInventedPart', 'enough', 'elemWords'],
    desc: { files: 'кроме выкладки ничего не создано и не изменено' } },
  // ---- analyst-notebook 1.2.0 ----
  // Список встречи в ноут: засев NB-CONTRA; Соколова меняет своё решение (`вместо:` без вопроса о споре), Гарипова
  // отвечает на открытый вопрос (`отвечает на:`), сведение Дёмина рядом с его открытым вопросом, но не ответ, новое решение.
  'PTS-IN': { dir: 'NB-PTS-IN', mode: 'write', prompt: 'w-prompt.txt', reply: 'w-turn2.txt', notebook: NB_RET, list: LIST_IN,
    meet: { memo: false, date: '2026-10-13' },
    checks: [...WRITE_COMMON, 'confirm', 'noWhich', 'listHead', 'asIs', 'noLineRef', 'sourceList', 'replaced', 'answered', 'noExtraLinks'],
    desc: { files: 'кроме ноута ничего не создано и не изменено (список — байт в байт)', replaced: '[решено] наличными — решил: Соколова; вместо: 2026-10-08 №1 «…»' } },
  // Ноутов нет: ноут заводится, тема — гипотезой, запись из пунктов списка.
  'PTS-NEW': { dir: 'NB-PTS-NEW', mode: 'write', prompt: 'w-prompt.txt', reply: 'w-turn2.txt', notebook: null, list: LIST_NEW,
    meet: { memo: false, date: '2026-10-12' },
    checks: ['one', 'head', 'files', 'date', 'kinds', 'decidedBy', 'invented', 'beforeWrite', 'listHead', 'asIs', 'noLineRef', 'sourceList', 'noLinks'],
    desc: { files: 'кроме ноута ничего не создано и не изменено (список — байт в байт)' } },
  // Список из протокола по памяти (meeting-recall 1.1.0) — ожидания старой MI-NB-REC: мысль осталась мыслью.
  'PTS-REC': { dir: 'NB-PTS-REC', mode: 'write', prompt: 'w-prompt.txt', reply: 'w-turn2.txt', notebook: NB_REC, list: LIST_REC,
    meet: { memo: true, date: '2026-10-14' },
    // 2.3.0 (Р5): ноут известен, сверка ничего не нашла — список пишется на ходу 1, без вопроса.
    checks: [...WRITE_COMMON.filter((id) => id !== 'beforeWrite'), 'writeFirst', 'listHead', 'asIs', 'noLineRef', 'sourceList', 'noLinks', 'decided12', 'thoughtKept'],
    desc: { files: 'кроме ноута ничего не создано и не изменено (список и протокол — байт в байт)' } },
  // Выгрузка всего ноута и с даты: замена, закрытый вопрос, мысли и наброски в двух записях.
  EXPORT: { dir: 'NB-EXPORT', mode: 'export', prompt: 'w-prompt.txt', reply: 'w-turn2.txt', notebook: NB_RET, since: null,
    checks: ['files', 'notebook', 'ptsFile', 'checked', 'ptsHead', 'range', 'ptsLines', 'complete', 'expAsIs', 'noReplacedItem', 'noClosedQ', 'answerIn', 'thoughts', 'refsOk', 'noLinksOut', 'noAsk'],
    desc: { files: 'кроме списка ничего не создано и не изменено' } },
  'EXPORT-SINCE': { dir: 'NB-EXPORT-SINCE', mode: 'export', prompt: 'w-prompt.txt', reply: 'w-turn2.txt', notebook: NB_RET, since: '2026-10-09',
    checks: ['files', 'notebook', 'ptsFile', 'checked', 'ptsHead', 'range', 'ptsLines', 'complete', 'expAsIs', 'noBefore', 'answerIn', 'thoughts', 'refsOk', 'noLinksOut', 'noAsk'],
    desc: { files: 'кроме списка ничего не создано и не изменено', noBefore: 'пунктов из записей до 2026-10-09 нет', answerIn: 'ответ 2026-10-10 №1 на вопрос 2026-10-08 №1 — в списке' } },
  // Расшифровка по ссылке: строка с командой, записи нет, vtt не прочитан.
  ROUTE: { dir: 'NB-ROUTE', mode: 'route', prompt: 'w-prompt.txt', reply: 'w-turn2.txt', notebook: NB_RET,
    checks: ['files', 'notebook', 'route', 'noRead'],
    desc: { files: 'ничего не создано и не изменено, Write/Edit нет', noRead: 'vtt не прочитан' } },
  // Шаг 1 1.2.0: слова о ноуте из строки вызова — по основам в `тема:`/`ключ:`/`о чём:`. Засев — три ноута: два про АС Друг
  // (заявки; отчётность), третий про склад.
  'DESC-ONE': { dir: 'NB-DESC-ONE', mode: 'write', prompt: 'w-prompt.txt', reply: 'w-turn2.txt', notebook: NB_AS,
    checks: [...WRITE_COMMON, 'noPick', 'descItems'],
    desc: { files: 'другие ноуты и файлы не тронуты, нового нет', old: 'ноут «интеграция с АС Друг»: старая часть байт в байт' } },
  'DESC-TWO': { dir: 'NB-DESC-TWO', mode: 'write', prompt: 'w-prompt.txt', reply: 'w-turn2.txt', notebook: null, candidates: [NB_AS, NB_REP],
    checks: ['files', 'oneOfTwo', 'old', 'date', 'kinds', 'decidedBy', 'invented', 'beforeWrite', 'pickShown', 'descItems'],
    desc: { files: 'третий ноут и другие файлы не тронуты, нового нет' } },
  // Вызов словами, без слэша: скилл лежит в `.claude/skills/` песочницы, промпт его не называет (раннер: AUTO_SKILL).
  // ---- круг harden (PLAN-LOOP-HARDEN.md, Н11, Н12). `edit` — проверки «по правке» E9: красные на исправленной версии
  // (`--edit`), на текущей печатаются отдельно и в счёт не идут.
  // Большой ноут: выгрузка — действующее со спором без ответа, отвеченным спором, цепочками замен; выбывшие — метками.
  'BIG-EXPORT': { dir: 'NB-BIG', mode: 'export', prompt: 'w-prompt-export.txt', reply: 'w-turn2-export.txt', notebook: NB_BIG, since: null, firstSeed: '2026-09-21', lastSeed: '2026-10-13',
    gone: BIG_GONE, neighbors: BIG_NEIGHBORS, disputeRef: BIG_DISPUTE_REF, edit: ['neighbors'], checkOrder: true,
    checks: ['files', 'notebook', 'ptsFile', 'checked', 'ptsHead', 'range', 'ptsLines', 'complete', 'neighbors', 'expAsIs', 'noGone', 'disputeLine', 'answerIn', 'thoughts', 'refsOk', 'noLinksOut', 'noAsk'],
    desc: { files: 'кроме списка ничего не создано и не изменено', ptsHead: 'шапка: «# Пункты: …», «> Источник: …/notebook.md», «> Задача: HST-318»', complete: 'все действующие пункты (кроме соседей спора) в списке' } },
  // Большой ноут: таблица решений — оспоренное не решено (баг 2), победители цепочек, подмена решившего.
  'BIG-VIEW': { dir: 'NB-BIG', mode: 'view-file', prompt: 'w-prompt-view.txt', reply: 'w-turn2-view.txt', notebook: NB_BIG, firstSeed: '2026-09-21', lastSeed: '2026-10-13',
    viewText: (v, nb, gsrc, prompt) => gradeBigView(v, nb, prompt), edit: ['neighbors', 'disputeMarked'], planFirst: true, checkOrder: true,
    checks: ['files', 'notebook', 'viewFile', 'checked', 'vhead', 'refsRows', 'winners', 'disputeOpen', 'disputeMarked', 'noReplacedRow', 'noDraftDecided', 'noClosedOpen', 'decider', 'elemWords', 'neighbors'],
    desc: { files: 'кроме выкладки ничего не создано и не изменено', neighbors: 'сосед спора стр. 85 (дежурный телефон в сообщении) — «решено» (по правке E9)', elemWords: 'числа, коды и люди в полях строки — из записи по её ссылке' } },
  // Двойник: «Поправить» (35, а не 25), спор — «Старое», кто решил звонок — «Не знаю», затем «Записать».
  TWIN: { dir: 'NB-TWIN', mode: 'write', prompt: 'w-prompt.txt', reply: 'w-turn2.txt', notebook: NB_TWIN, twin: true, firstSeed: '2026-10-07', lastSeed: '2026-10-12',
    checks: [...WRITE_COMMON, 'fact35', 'noDecided30', 'callOpen', 'quoteVerbatim', 'noLinks'],
    desc: { heading: 'заголовок записи — «письмо Мельничука А. …»', invented: 'в пунктах нет чисел, имён, кодов не из письма и ответов двойника', confirm: 'до записи спрошено «Записать так или поправить?»', noLinks: 'в новой записи нет «вместо:» и «отвечает на:» (час пик, 30 минут, вопрос Мельничука)' } },
  AUTO: { dir: 'NB-AUTO', mode: 'write', prompt: 'w-prompt.txt', reply: 'w-turn2.txt', notebook: NB_AS,
    checks: [...WRITE_COMMON, 'invoked', 'noPick', 'descItems'],
    desc: { files: 'другие ноуты и файлы не тронуты, нового нет', old: 'ноут «интеграция с АС Друг»: старая часть байт в байт' } },
}
const desc = (fx, id) => (fx.desc && fx.desc[id]) || D[id]

// ---------- песочница ----------

// Файлы стенда в корне песочницы: их пишет пул, а не скилл.
const STAND = /^(answer(-\d+)?\.md|stream(-\d+)?\.jsonl|_.*)$/

// Пути — в NFC: засев песочницы на macOS ложится в NFD («й», «ё» — буква и знак), а пути в константах и спеках — в NFC.
function listFiles (dir, base = dir, out = []) {
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue
    if (dir === base && STAND.test(e.name)) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) listFiles(p, base, out)
    else out.push(relative(base, p).split('\\').join('/').normalize('NFC'))
  }
  return out
}

// Засев — текстом, как лежит на диске (из него строятся песочницы самопроверки), и байтами — для сравнения.
const parse = (s) => lf(s).replace(/^﻿/, '')
// Самопроверка видит засев в LF при любой рабочей копии: с `core.autocrlf=true` фикстуры на диске в CRLF, а порчи и
// эталоны самопроверки написаны с `\n` — самопроверка падала на чистом checkout. Прогоны сверяются со снимком засева
// `_seeded.sha256` песочницы, без снимка — по LF-тексту (`sameAsSeed`, `seededText`).
let SELFTEST_LF = false
const seedCache = {}
function seedOf (fx) {
  if (seedCache[fx.dir]) return seedCache[fx.dir]
  const root = join(HERE, 'fixtures', fx.dir, 'seed')
  const out = {}
  for (const rel of listFiles(root)) { const t = readFileSync(join(root, rel), 'utf8'); out[rel] = SELFTEST_LF ? lf(t) : t }
  seedCache[fx.dir] = out
  return out
}
const seedBytes = (fx, rel) => { const p = join(HERE, 'fixtures', fx.dir, 'seed', rel); return SELFTEST_LF ? Buffer.from(lf(readFileSync(p, 'utf8'))) : bytes(p) }
const sha256 = (b) => createHash('sha256').update(b).digest('hex')
// Снимок засева `_seeded.sha256`: путь → хеш байтов, как файл лёг в песочницу. Форма `sha256sum`: Linux — два пробела,
// Windows — « *» (двоичный режим); путь от корня песочницы, `./` в начале — тот же путь.
const hashCache = new Map()
function seededHashes (dir) {
  if (hashCache.has(dir)) return hashCache.get(dir)
  const p = join(dir, '_seeded.sha256')
  let m = null
  if (existsSync(p)) {
    m = new Map()
    for (const l of lf(readFileSync(p, 'utf8')).split('\n')) {
      const x = l.match(/^([0-9a-f]{64}) [ *](.+)$/i)
      if (x) m.set(x[2].trim().replace(/\\/g, '/').replace(/^\.\//, ''), x[1].toLowerCase())
    }
  }
  hashCache.set(dir, m)
  return m
}
// Засев, каким он лёг в песочницу: из вариантов фикстуры (как на диске, LF, CRLF) — тот, чей хеш в снимке. Снимка нет
// или хеш ни к одному варианту не подошёл (фикстуру правили после засева) — null: сверка по LF-тексту.
function seededText (dir, fx, rel) {
  const h = seededHashes(dir)
  if (!h || !h.has(rel)) return null
  const t = seedBytes(fx, rel).toString('utf8')
  return [t, lf(t), lf(t).replace(/\n/g, '\r\n')].find((v) => sha256(Buffer.from(v)) === h.get(rel)) ?? null
}
// Файл засева в песочнице не изменён: есть хеш в снимке — байт в байт с ним (CRLF вместо LF, BOM — изменение); нет —
// по LF-тексту (BOM — изменение, CRLF рабочей копии — нет).
const sameAsSeed = (dir, fx, rel) => {
  if (!existsSync(join(dir, rel))) return false
  const h = seededHashes(dir)
  if (h && h.has(rel)) return sha256(bytes(join(dir, rel))) === h.get(rel)
  return lf(readFileSync(join(dir, rel), 'utf8')) === lf(seedBytes(fx, rel).toString('utf8'))
}
const fixtureText = (fx, name) => read(join(HERE, 'fixtures', fx.dir, name))

// Поток по ходам: stream.jsonl — ход 1, stream-NN.jsonl — ход NN. Сортировка по имени ставила ход 1 последним.
const turnOf = (name) => { const m = name.match(/^stream-(\d+)\.jsonl$/); return m ? Number(m[1]) : 1 }
function toolUses (dir, which = 'all') {
  const out = []
  if (!existsSync(dir)) return out
  const names = readdirSync(dir).filter((n) => /^stream(-\d+)?\.jsonl$/.test(n)).sort((a, b) => turnOf(a) - turnOf(b))
  for (const f of which === 'first' ? names.filter((n) => turnOf(n) === 1) : names) {
    for (const line of read(join(dir, f)).split('\n')) {
      let e; try { e = JSON.parse(line) } catch { continue }
      const content = e && e.message && Array.isArray(e.message.content) ? e.message.content : []
      // События субагентов идут в потоке ведущего с `parent_tool_use_id`.
      for (const c of content) if (c && c.type === 'tool_use') out.push({ name: c.name, input: c.input || {}, sub: !!e.parent_tool_use_id, turn: turnOf(f) })
    }
  }
  return out
}
const strIn = (u) => Object.values(u.input).filter((v) => typeof v === 'string').join(' ')

function answerTurn (dir, n) {
  const p = join(dir, `answer-${String(n).padStart(2, '0')}.md`)
  if (existsSync(p)) return read(p)
  return n === 1 && existsSync(join(dir, 'answer.md')) ? read(join(dir, 'answer.md')) : ''
}
// Ходы ответа — answer-NN.md по порядку; их нет — answer.md одним ходом.
function answerTurns (dir) {
  const ns = existsSync(dir) ? readdirSync(dir).filter((n) => /^answer-\d+\.md$/.test(n)).sort((a, b) => parseInt(a.slice(7), 10) - parseInt(b.slice(7), 10)) : []
  if (ns.length) return ns.map((n) => read(join(dir, n)))
  return existsSync(join(dir, 'answer.md')) ? [read(join(dir, 'answer.md'))] : []
}
// Склейка ходов через пустую строку: answer.md стенда клеит их встык, и последняя строка хода сливалась с первой
// строкой следующего; ход — отдельное сообщение, его строки не продолжение чужих.
const answerAll = (dir) => answerTurns(dir).join('\n\n')

// ---------- ноут ----------

function splitFront (text) {
  const m = text.match(/^---\n([\s\S]*?)\n---[ \t]*(\n|$)/)
  return m ? { front: m[1], body: text.slice(m[0].length) } : { front: null, body: text }
}
const field = (front, name) => {
  if (front == null) return null
  const l = front.split('\n').find((x) => x.startsWith(name + ':'))
  return l === undefined ? null : l.slice(name.length + 1).trim()
}

// 2.0.0: к строке засева можно дописать только пометки ` ‖ <состояние>: <номер>` в конце. Для сверки старой части они
// снимаются: строка выхода, которая — строка засева плюс одни пометки, становится строкой засева. `\r` в конце — как был.
// Строки тела сверяются от конца шапки `---`: шапку скилл править вправе, число её строк может измениться.
const bodyAt = (L) => { if (L[0]?.replace(/\r$/, '') !== '---') return 0; const j = L.findIndex((l, k) => k > 0 && l.replace(/\r$/, '') === '---'); return j < 0 ? 0 : j + 1 }
export function unmark (finalText, seedText) {
  if (seedText == null) return finalText
  const S = seedText.split('\n'); const F = finalText.split('\n')
  const s0 = bodyAt(S); const f0 = bodyAt(F)
  for (let j = 0; s0 + j < S.length && f0 + j < F.length; j++) {
    const i = f0 + j; const a = S[s0 + j].replace(/\r$/, ''); const b = F[i].replace(/\r$/, '')
    if (a !== b && b.startsWith(a) && /^(\s*‖\s*[^‖\r]+)+$/.test(b.slice(a.length))) F[i] = F[i].endsWith('\r') ? a + '\r' : a
  }
  return F.join('\n')
}
// Пометки, дописанные к строкам засева: строка засева → её пометки в выходе.
export function marksAdded (finalText, seedText) {
  const out = new Map(); if (seedText == null) return out
  // Строки тела — от конца шапки, как в `unmark`: дописанная в шапку строка (`роли:`) не сдвигает сверку.
  const S = seedText.split('\n'); const F = finalText.split('\n')
  const s0 = bodyAt(S); const f0 = bodyAt(F)
  for (let j = 0; s0 + j < S.length && f0 + j < F.length; j++) {
    const a = S[s0 + j].replace(/\r$/, ''); const b = F[f0 + j].replace(/\r$/, '')
    if (a !== b && b.startsWith(a) && /^(\s*‖\s*[^‖\r]+)+$/.test(b.slice(a.length))) out.set(a, b.slice(a.length).split('‖').map((x) => x.trim()).filter(Boolean))
  }
  return out
}

// Новое — то, что дописано после засеянного тела ноута. Тело засева изменено — новое ищется от первого
// раздела даты позже засева, чтобы остальные проверки всё равно отработали.
export function splitNew (finalText0, seedText, last = LAST_SEED) {
  const finalText = unmark(finalText0, seedText)
  const F = splitFront(finalText)
  if (seedText == null) return { front: F.front, newPart: F.body.replace(/^\s*# [^\n]*(\n|$)/, ''), oldOk: null, headChanged: false }
  const S = splitFront(seedText)
  const sb = S.body.replace(/\s+$/, '')
  const oldOk = F.body.startsWith(sb) && (F.body.length === sb.length || F.body[sb.length] === '\n')
  let newPart
  if (oldOk) newPart = F.body.slice(sb.length)
  else {
    const ls = F.body.split('\n')
    const i = ls.findIndex((l) => { const m = l.match(DATE_H); return !!m && m[1] > last })
    newPart = i < 0 ? '' : ls.slice(i).join('\n')
  }
  return { front: F.front, newPart, oldOk, headChanged: F.front !== S.front }
}

export function checkDate (newPart, last = LAST_SEED) {
  const ls = newPart.replace(/^\s+/, '').split('\n')
  const m = (ls[0] || '').match(DATE_H)
  if (!m) return 'новое не начинается разделом «## ГГГГ-ММ-ДД»'
  if (!(m[1] > last)) return `дата ${m[1]} не позже засева`
  const h = ls.filter((l) => /^##? /.test(l))
  if (h.length !== 1) return `заголовков «#»/«##» в новом: ${h.length}`
  const first = ls.slice(1).find((l) => l.trim())
  if (!first || !/^### 1(?!\d)/.test(first)) return 'первая запись не «### 1»'
  const nums = ls.filter((l) => /^### /.test(l)).map((l) => Number((l.match(/^### (\d+)/) || [])[1]))
  if (nums.some((n, i) => n !== i + 1)) return `номера записей: ${nums.join(', ')}`
  return null
}

function entriesOf (newPart) {
  const out = []; let cur = null
  for (const l of newPart.split('\n')) {
    const m = l.match(/^### (\d+)\s*[·•.:—–-]?\s*(.*)$/)
    if (m) { cur = { n: Number(m[1]), title: m[2].trim(), lines: [] }; out.push(cur) } else if (cur) cur.lines.push(l)
  }
  return out
}
const isItem = (l) => /^- \[/.test(l)
const kindOf = (l) => (l.match(/^- \[([^\]]*)\]/) || [])[1]
const short = (s) => (s.length > 90 ? s.slice(0, 87) + '…' : s)

// Хвосты спора 1.1.0 у `[открыто] что верно:` — `(<кто>, <дата> №<n>)` старой стороны и `ждёт: <кто решает>` — берут
// имена из ноута, а не из текста: имя законно, если оно есть в ноуте. Без имени или с числом хвост не снимается.
const namesIn = (s) => [...s.matchAll(/[А-ЯЁ][а-яё]{2,}/g)].map((m) => m[0])
const stemOf = (x) => norm(x).slice(0, Math.max(3, Math.min(5, x.length - 1)))
const knownIn = (who, text) => { const ns = namesIn(who); const ws = words(text); return ns.length > 0 && !/\d/.test(STRIP_REFS(who)) && ns.every((n) => ws.some((x) => x.startsWith(stemOf(n)))) }
function disputeTails (t, nb) {
  if (!nb || !/что\s+верно/i.test(t)) return t
  return t.replace(/\(([^()\n]*?)[\s,;·—–-]*\d{4}-\d{2}-\d{2},?\s*№\s*\d+(?:\.\d+)?\s*\)/g, (m, who) => (knownIn(who, nb) ? ' ' : m))
    .replace(/(жд[её]т\s*:)([^;\n]*)/gi, (m, k, who) => (knownIn(who, nb) ? k + ' ' : m))
}

// Опора — одна проверка на весь оценщик: пункт новой записи, `о чём:` шапки, элемент выкладки, пункт выгрузки. Основа —
// общий модуль ground-check.mjs: числа значением, цифрой и словом («три дня» при «3 дня» — опора есть, число из даты в пути
// файла — нет); люди и роли в `решил:` / `ждёт:` / `со слов`; латиница целым токеном. Сверх модуля — то, чего в нём нет:
// кириллическая аббревиатура, имя с заглавной не в начале фразы и имя с инициалом где угодно («Белов С. согласен…»),
// слова срока (день недели, месяц, «завтра», единица срока). Ссылки «дата №» не считаются, текст в кавычках после `вместо:`
// и `отвечает на:` — тоже: это цитата старого пункта ноута, её сверяют проверки замены и ответа (1.1.0: «Кто подписывает…»
// в кавычках читалось именем «Кто», которого нет в письме). `opt.nb` — текст ноута для хвостов спора; `opt.only` — что
// искать: num, code, person, name, group.
const GC_KIND = { число: 'num', латиница: 'code', человек: 'person' }
export function inventedIn (item, src, opt = {}) {
  const only = new Set(opt.only || ['num', 'code', 'person', 'name', 'group'])
  const noQuotes = item.replace(/^\s*(?:[-*•+]|\d+[.)])\s*\[[^\]]*\]\s*/, '').replace(new RegExp(String.raw`(вместо|отвечает\s+на)\s*:[^«"“„\n;]*` + QUOTED, 'gi'), ' ')
  const t0 = disputeTails(noQuotes, opt.nb)
  // Поле человека — слово с двоеточием (`решил:`, `ждёт:`) или «со слов». «Кто решил — неизвестно», «покупатель ждёт
  // возврата» в тексте пункта — не поле: модуль ловит слово и без двоеточия и берёт остаток строки за имя. Заглушка в поле
  // («решил: неизвестно», «ждёт: не знаю») — не человек.
  const fields = t0.replace(/(^|[^а-яё])(решил[аи]?|решает|принял[аи]?|жд[её]т)(?!\s*:)/gi, '$1 ')
    .replace(/(:\s*)(неизвестн[а-яё]*|не\s+знаю|не\s+(?:назван|сказан|указан)[а-яё]*|не\s+видно|кто\s+именно)/gi, '$1—')
  const g = groundCheck(fields, src)
  const miss = g.missing.find((x) => only.has(GC_KIND[x.kind]))
  if (miss) return `${miss.kind} «${miss.tok}»`
  const t = STRIP_REFS(t0)
  if (only.has('code')) {
    const srcLow = norm(src)
    for (const tok of t.match(/[А-ЯЁ]{2,}(?![а-яё])/g) || []) if (!srcLow.includes(norm(tok))) return `код «${tok}»`
  }
  if (only.has('name')) {
    // Имя — слово с заглавной не в начале фразы, а с инициалом («Белов С.») — где угодно; склонение — по основе до 5 букв.
    const srcW = words(src)
    for (const m of t.matchAll(/([А-ЯЁ][а-яё]{2,})(?=\s+[А-ЯЁ]\.)/g)) if (!srcW.some((x) => x.startsWith(stemOf(m[1])))) return `имя «${m[1]}»`
    for (const m of t.matchAll(/[А-ЯЁ][а-яё]{2,}/g)) {
      const before = t.slice(0, m.index).replace(/\s+$/, '')
      if (!before || /[.!?…]$/.test(before)) continue
      if (!srcW.some((x) => x.startsWith(stemOf(m[0])))) return `имя «${m[0]}»`
    }
  }
  if (only.has('group')) for (const g of GROUPS) { const m = t.match(g); if (m && !g.test(src)) return `«${m[0].replace(/^[^а-яёa-z]/i, '')}»` }
  return null
}

// ---------- поток: запись и чтение файлов ----------

// Тело heredoc — текст, а не команда: `cat >> notebook.md <<'EOF' … файл docs-in/reglament.pdf … EOF` дописывает ноут, а
// не читает pdf (круг 2, nb-file run-1 — ложный красный «прочитан»). Остаток первой строки (`<<'EOF' > notebook.md`) —
// команда, он остаётся. PowerShell here-string `@'…'@` / `@"…"@` — так же.
export function noHeredoc (cmd) {
  return cmd.replace(/<<-?\s*(['"]?)(\w+)\1([^\n]*)\n[\s\S]*?\n[ \t]*\2[ \t]*(?=\n|$)/g, (m, q, tag, rest) => ' ' + rest)
    .replace(/@(['"])[ \t]*\r?\n[\s\S]*?\r?\n\1@/g, ' ')
}
// Команда по частям: `&&`, `||`, `;`, `|`, перевод строки. Путь pdf в одной части и `cat` в другой — не чтение pdf.
export const cmdParts = (cmd) => noHeredoc(cmd).split(/&&|\|\||[;|\n]/).map((x) => x.trim()).filter(Boolean)

const normPath = (p) => String(p || '').replace(/\\/g, '/')
// Запись в цель `tgt` (исходник регулярки без якорей) одной частью команды: перенаправление в неё (`2>/dev/null` — не
// запись в ноут), tee, sed -i, Set-Content / Add-Content / Out-File, cp/mv с целью последним аргументом.
export function writesIn (part, tgt) {
  const T = String.raw`(?:"[^"\n]*${tgt}"|'[^'\n]*${tgt}'|[^\s"'<>|;&]*${tgt})`
  const has = new RegExp(tgt)
  return new RegExp(String.raw`\d?>>?\s*` + T).test(part) ||
    new RegExp(String.raw`(^|\s)tee(\s+-\S+)*\s+` + T).test(part) ||
    (/(^|\s)(sed|perl)\s+(-\w*i\w*|--in-place)/.test(part) && has.test(part)) ||
    (/(Set-Content|Add-Content|Out-File|(Write|Append)All(Text|Lines)|(write|append)FileSync|write_text)/i.test(part) && has.test(part)) ||
    (/(^|\s)(cp|mv|Copy-Item|Move-Item)\s/i.test(part) && new RegExp(T + String.raw`\s*$`).test(part))
}
const WRITE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']
// Вызов пишет файл, путь которого ловит `pathRe` (для Write/Edit) или `tgt` (для команды).
const writesTarget = (u, pathRe, tgt) =>
  (WRITE_TOOLS.includes(u.name) && pathRe.test(normPath(u.input.file_path || u.input.notebook_path))) ||
  (['Bash', 'PowerShell'].includes(u.name) && cmdParts(u.input.command || '').some((p) => writesIn(p, tgt)))
const useText = (u) => `${u.sub ? 'субагент ' : ''}${u.name} ${short(normPath(u.input.file_path || u.input.command || ''))}`

// Запись ноута — сам notebook.md и исходник в sources/ (Шаг 6.1 — тоже запись, после вопроса).
const NB_PATH = /(^|\/)notes\/[^/]+\/(notebook\.md|sources\/[^/]+)$/
const NB_TGT = String.raw`(?:notebook\.md(?![\w.])|sources[\\/][^\s"'<>|;&]+)`
function wroteFirstTurn (dir) {
  const u = toolUses(dir, 'first').find((x) => writesTarget(x, NB_PATH, NB_TGT))
  return u ? useText(u) : null
}

// Grep без path и glob (или по корню песочницы, по calls/ или docs-in/) читает всю песочницу — и vtt, и pdf.
// Так же рекурсивный grep/rg в команде, если он не ограничен notes/.
const grepAll = (u) => {
  if (u.name !== 'Grep' || u.input.type) return false
  const path = normPath(u.input.path).replace(/\/+$/, ''); const glob = String(u.input.glob || '')
  const pathAll = !path || path === '.' || /(^|\/)run-\d+$/.test(path) || /(^|\/)(calls|docs-in)$/.test(path)
  const globAll = !glob || /vtt|pdf/i.test(glob) || /^(\*\*\/)?\*(\.\*)?$/.test(glob)
  return pathAll && globAll
}
// `re` — какие файлы не читать: vtt и pdf NB-FILE (по умолчанию), vtt NB-ROUTE.
function readsOfVtt (dir, re = VTT_FILES) {
  const READ_CMD = /(^|[\s(])(cat|head|tail|less|more|type|strings|Get-Content|gc|sed|awk|grep|rg|python3?|node|pdftotext|od|xxd|iconv|Select-String|sls)(\s|$)/i
  const RECURSIVE = /(^|[\s(])(rg|grep\s+(-\w*[rR]\w*|--recursive))(\s|$)/
  return toolUses(dir).filter((u) =>
    (u.name === 'Read' && re.test(normPath(u.input.file_path))) ||
    (u.name === 'Grep' && (re.test([u.input.path, u.input.glob].filter(Boolean).join(' ')) || grepAll(u))) ||
    (['Bash', 'PowerShell'].includes(u.name) && cmdParts(u.input.command || '').some((p) =>
      (re.test(p) && READ_CMD.test(p)) || (RECURSIVE.test(p) && !/notes[\\/]/.test(p)))))
    .map((u) => `${u.sub ? 'субагент' : 'ведущий'} ${u.name} ${short(strIn(u))}`)
}

const RE_WHO = w('(?:(кто|кем|чь[её])[^\\n?]{0,40}(реш|принял|принят|договор|утверд|согласов)|(реш|принял|принят|договор|утверд)[а-яё]*[^\\n?]{0,40}(кто|кем|чь[её])(?![а-яё])|решил[^\\n?]{0,60}\\?)')
// Строка пункта в ответе: «1. [решено] …», «- [открыто] …». Заглушка «решил: ?» в ней — не вопрос.
const ITEM_LINE = /^\s*[*_]*(\d+[.)]|[-*•])[*_]*\s*\[/
const STUB = /решил[аи]?\s*:\s*[*_]*\?+[*_]*/gi
// Вопрос «кто решил» — вне строк пунктов; «?» не обязателен: «Кто решил, из текста не видно — назовите или „не знаю“».
const askedWho = (a1) => a1.split('\n').filter((l) => !ITEM_LINE.test(l)).some((l) => RE_WHO.test(l.replace(STUB, ' ')))
// `решил:` с кем-то, кого нет в промпте: «Соколова М.» из старого ноута, «аналитик». Заглушка (`—`, `?`, «неизвестно»,
// «не знаю») — не автор.
const NO_WHO = /^[\s*_—–\-?]*$|^[\s*_]*(неизвестн|не\s+знаю|не\s+назван|не\s+сказан|не\s+указан|не\s+видно|кто\s+именно)/i
function authorNotIn (item, prompt) {
  for (const m of item.matchAll(/решил[аи]?\s*:([^;\n]*)/gi)) {
    const who = m[1].split(/\s+[—–]\s+/)[0]
    if (NO_WHO.test(who)) continue
    const ns = namesIn(who)
    if (!ns.length || !knownIn(who, prompt)) return who.trim()
  }
  return null
}
const RE_OLD_NAMED = [refAt('2026-10-08', 1), w('только\\s+на\\s+карту'), /с\s+которой\s+платили/i]

// Тело засева (после шапки ---) — в начале тела ноута байт в байт: CRLF, BOM, пробелы — изменение. Шапку скилл
// править вправе.
const rawBody = (s) => { const m = s.match(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/); return m ? s.slice(m[0].length) : s }
export function oldBytesOk (finalRaw0, seedRaw) {
  const finalRaw = unmark(finalRaw0, seedRaw)
  const sb = rawBody(seedRaw).replace(/\s+$/, ''); const fb = rawBody(finalRaw)
  return fb.startsWith(sb) && (fb.length === sb.length || /[\r\n]/.test(fb[sb.length]))
}

// Вставка NB-LONG — промпт без строки вызова и без пустых строк, строки без пробелов по краям.
const pasteLines = (fx) => fixtureText(fx, fx.prompt).split('\n').slice(1).map((l) => l.trim()).filter(Boolean)

// Вставка в файле подряд и в том же порядке. Префикс `> ` и пробелы по краям — оформление, не потеря.
export function verbatim (content, paste) {
  const fl = lf(content).split('\n').map((l) => l.replace(/^\s*>\s?/, '').trim()).filter(Boolean)
  for (let i = 0; i + paste.length <= fl.length; i++) if (paste.every((p, k) => fl[i + k] === p)) return { miss: null, extra: fl.length - paste.length }
  return { miss: paste.find((p) => !fl.includes(p)) || '(порядок строк)', extra: 0 }
}

// Реплики двойника аналитика: `_twin/reply-NN.txt` — реплика, с которой начался ход NN.
export function twinReplies (dir) {
  const td = join(dir, '_twin')
  if (!existsSync(td)) return []
  return readdirSync(td).filter((f) => /^reply-\d+\.txt$/.test(f)).map((f) => ({ turn: Number(f.match(/\d+/)[0]), text: read(join(td, f)) })).sort((a, b) => a.turn - b.turn)
}

function gradeWrite (dir, fx) {
  const R = {}; const warn = []
  const seed = seedOf(fx)
  // Источник слов пункта — промпт, реплика и (1.2.0) список пунктов из строки вызова без ` · L<n>`: номер строки источника —
  // не число пункта (иначе выдуманное «52» проходило из-за `L52`). С двойником — и его реплики (ответы аналитика).
  const twin = fx.twin ? twinReplies(dir) : []
  const src = fixtureText(fx, fx.prompt) + '\n' + fixtureText(fx, fx.reply) + (fx.list ? '\n' + parse(seed[fx.list]).split('\n').map((l) => l.replace(L_TAIL, '')).join('\n') : '') +
    twin.map((x) => '\n' + x.text).join('')
  const files = listFiles(dir)
  let nbPath = fx.notebook
  if (fx.candidates) {
    // DESC-TWO: ноут выбирает аналитик ответом на вопрос — запись в любой из двух, второй и третий не тронуты.
    const ch = fx.candidates.filter((f) => !sameAsSeed(dir, fx, f))
    R.oneOfTwo = ch.length === 1 ? null : `изменено ноутов из двух: ${ch.length}`
    nbPath = ch[0] || fx.candidates[0]
    if (ch.length === 1 && nbPath !== fx.candidates[0]) warn.push(`записано в ${nbPath}: текст — про заявки, ближе ${fx.candidates[0]}`)
  } else if (!fx.notebook) {
    const nbs = files.filter((f) => /^notes\/[^/]+\/notebook\.md$/.test(f))
    R.one = nbs.length === 1 ? null : `ноутов: ${nbs.length}`
    nbPath = nbs[0] || null
  }
  // Ноут засева, в который пишем: заданный пробой или выбранный из кандидатов.
  const nbKey = fx.notebook || (fx.candidates ? nbPath : null)
  const extra = files.filter((f) => f !== nbPath && !(f in seed) && !(fx.allow && fx.allow.test(f)))
  const changed = Object.keys(seed).filter((f) => f !== nbPath && !sameAsSeed(dir, fx, f))
  R.files = extra.length || changed.length ? [extra.length && 'лишние: ' + extra.join(', '), changed.length && 'изменены: ' + changed.join(', ')].filter(Boolean).join('; ') : null
  // На ходу 1 — только вопрос Шага 5; запись ноута или исходника — после ответа.
  const w1 = wroteFirstTurn(dir)
  R.beforeWrite = w1 ? `ноут записан на ходу 1: ${w1}` : null
  // 2.3.0 (Р5): список без находок сверки — запись на ходу 1, без вопроса «Записать так?».
  if (fx.checks.includes('writeFirst')) {
    const q = answerTurn(dir, 1).split('\n').find((l) => l.includes('?') && RE_CONFIRM.test(l))
    R.writeFirst = !w1 ? 'ноут не записан на ходу 1' : q ? `вопрос перед записью: «${short(q.trim())}»` : null
  }
  const text = nbPath && existsSync(join(dir, nbPath)) ? read(join(dir, nbPath)) : null
  if (text === null) { for (const id of fx.checks) if (!(id in R)) R[id] = 'ноута нет'; return { R, warn } }

  const nbSeed = nbKey ? parse(seed[nbKey]) : null
  const sp = splitNew(text, nbSeed, fx.lastSeed)
  if (nbKey) {
    const raw = readFileSync(join(dir, nbPath), 'utf8')
    // Байты старой части — со снимком засева (`_seeded.sha256`); снимка нет — по LF-тексту.
    const was = seededText(dir, fx, nbKey)
    const h = seededHashes(dir)
    if (h && h.has(nbKey) && was === null) warn.push('засев ноута не сверить со снимком: хеш не подошёл к фикстуре — сверка по LF-тексту')
    const bytesOk = was !== null ? oldBytesOk(raw, was) : oldBytesOk(lf(raw), lf(seed[nbKey]))
    R.old = !sp.oldOk ? 'засеянная часть изменена' : !bytesOk ? 'засеянная часть изменена побайтно (переводы строк, BOM, пробелы)' : null
    if (sp.headChanged) warn.push('шапка ноута изменена')
  }
  R.date = checkDate(sp.newPart, fx.lastSeed)
  const items = sp.newPart.split('\n').filter(isItem)
  const entries = entriesOf(sp.newPart)
  const badKind = items.find((l) => !KINDS.has(kindOf(l)))
  R.kinds = badKind ? `«${short(badKind)}»` : null
  const noBy = items.find((l) => kindOf(l) === 'решено' && !DECIDED_BY.test(l))
  R.decidedBy = noBy ? `«${short(noBy)}»` : null
  R.invented = null
  // ` · L<n>` из списка в пункте — дефект `noLineRef`, не выдумка: здесь не считается.
  const noL = (l) => (fx.list ? l.replace(new RegExp(L_ANY.source, 'g'), ' ') : l)
  // NB-TWIN, стык 2: `ждёт:` у решения без решившего — имя только из ноута — предупреждение, а не выдумка.
  const waitNb = (l) => (!fx.twin || !nbSeed ? l : l.replace(/(жд[её]т\s*:)([^;\n]*)/i, (m, k, who) => {
    if (!namesIn(who).length || knownIn(who, src) || !knownIn(who, nbSeed)) return m
    warn.push(`«ждёт:» — имя только из ноута: «${who.trim()}»`)
    return k + ' —'
  }))
  for (const l of items) { const why = inventedIn(waitNb(noL(l)), src, { nb: nbSeed }); if (why) { R.invented = `${why} в «${short(l)}»`; break } }
  for (const e of entries) if (!e.lines.some((l) => /^>/.test(l))) warn.push(`запись ### ${e.n} без текста под «>»`)
  if (!items.length) warn.push('в новом нет пунктов')

  if (fx === FX.NEW || fx === FX['PTS-NEW']) {
    const tema = field(sp.front, 'тема'); const key = field(sp.front, 'ключ')
    R.head = sp.front == null ? 'нет шапки ---' : !tema || /^[—–-]?$/.test(tema) ? 'нет темы' : key == null || !/^[—–-]$/.test(key) ? `ключ: ${key}` : null
    if (!/^# /m.test(text)) warn.push('нет заголовка «# Ноут: …»')
    // Папка нового ноута — тема строчными, пробелы — дефисы (Шаг 1).
    if (tema && nbPath !== `notes/${norm(tema).replace(/ё/g, 'е').replace(/\s+/g, '-')}/notebook.md` && nbPath !== `notes/${tema.toLowerCase().replace(/\s+/g, '-')}/notebook.md`) warn.push(`папка ноута не из темы «${tema}»: ${nbPath}`)
  }
  if (fx === FX.NEW) {
    // 1.2.0, Шаг 1: новый ноут — `о чём:` (одна фраза: предмет, системы, люди — только из текста). Анкер — против
    // выдуманного факта: красный только имя, система или код (латиница, аббревиатура), число, которых нет в промпте,
    // реплике и теме ноута. Общие слова («правила», «роль», «проверка», «товара») — не факт: круг 4 красил их ложно.
    // «—» — предупреждение.
    const about = field(sp.front, 'о чём')
    const tema = field(sp.front, 'тема') || ''
    const why = about == null || /^[—–-]?$/.test(about) ? null : inventedIn(about, src + '\n' + tema, { only: ['num', 'code', 'name'] })
    R.about = about == null ? 'нет строки «о чём:» в шапке' : why ? `${why} не из текста («${short(about)}»)` : null
    if (about != null && /^[—–-]?$/.test(about)) warn.push('«о чём: —» у нового ноута')
    R.decided = items.some((l) => kindOf(l) === 'решено' && /решил[аи]?\s*:[^\n]*Соколов/i.test(l)) ? null : 'нет'
    R.open = items.some((l) => kindOf(l) === 'открыто' && /жд[её]т\s*:[^\n]*юри/i.test(l)) ? null : 'нет'
    R.fact = items.some((l) => kindOf(l) === 'сведение' && /(^|\D)37(\D|$)/.test(l)) ? null : 'нет'
    const chat = fixtureText(fx, fx.prompt).split('\n').filter((l) => /^[А-ЯЁ][а-яё]+ [А-ЯЁ]\.: /.test(l))
    const q = ' ' + flat(sp.newPart.split('\n').filter((l) => /^>/.test(l)).map((l) => l.replace(/^>\s?/, '')).join(' ')) + ' '
    const miss = chat.filter((c) => !q.includes(' ' + flat(c) + ' '))
    R.quote = miss.length ? `нет ${miss.length} из ${chat.length}: «${short(miss[0])}»` : null
    if (items.some((l) => w('(кофемашин|телефон|табличк)').test(l))) warn.push('шум пунктом')
  }
  if (fx === FX.THOUGHT) {
    const e = entries[0]
    R.heading = e && e.n === 1 && w('мысл').test(e.title) ? null : `«### ${e ? e.n + ' · ' + e.title : '—'}»`
    R.thought = items.some((l) => kindOf(l) === 'мысль') ? null : 'нет'
    const bad = items.find((l) => kindOf(l) === 'решено')
    R.noDecided = bad ? `«${short(bad)}»` : null
  }
  const a1 = answerTurn(dir, 1)
  const qLines = a1.split('\n').filter((l) => l.includes('?'))
  if (fx === FX.CONTRA || fx === FX.ANSWER || fx === FX['PTS-IN']) {
    const which = qLines.find(whichAsk)
    R.noWhich = which ? `«${short(which.trim())}»` : null
  }
  if (fx === FX.NOAUTH) {
    R.asked = askedWho(a1) ? null : 'вопроса «кто решил» в ответе хода 1 нет (строки пунктов и «решил: ?» не в счёт)'
    // Кандидат-гипотеза в вопросе («кто решил? например, Соколова М. из прошлых записей») — не дефект: по принципу
    // интервью пользователя гипотеза в вопросе законна, грех — только в файле (решение пользователя 2026-10-15; правило
    // «кандидат только из текста» снято). Файл держит `noAuthor`: «решил:» без имени, названного аналитиком, — красный.
  }
  // PTS-IN — засев NB-CONTRA и NB-ANSWER: те же замена и ответ, но пунктами списка.
  if (fx === FX.CONTRA || fx === FX['PTS-IN']) {
    R.confirm = qLines.some((l) => RE_CONFIRM.test(l)) ? null : 'вопроса «Записать так?» в ответе хода 1 нет'
    const its = items.filter((l) => kindOf(l) === 'решено' && w('налич').test(l) && /решил[аи]?\s*:[^;\n]*Соколов/i.test(l))
    // 2.0.0: `вместо:` — номером пункта (2026-10-08 №1.2), у старой строки — `‖ заменён`; кавычки не нужны.
    const m = its.map((l) => l.match(RE_REPL_CONTRA)).find(Boolean)
    R.replaced = !its.length ? 'нет [решено] наличными — решил: Соколова' : !m ? `нет «вместо: ${OLD_CARD_ID}»`
      : !m[2] ? `ссылка на запись, а не на пункт: «вместо: ${m[1]}»` : m[2] !== '2' ? `заменён не тот пункт: «вместо: ${m[1]}»`
        : !markedAs(text, nbSeed, OLD_CARD, 'замен') ? `у ${OLD_CARD_ID} нет «‖ заменён»` : null
    R.oldItem = text.split('\n').some((l) => l === OLD_CARD || l.startsWith(OLD_CARD + ' ‖')) ? null : 'нет'
  }
  if (fx === FX.CONTRA) {
    const later = [2, 3, 4, 5].map((n) => answerTurn(dir, n)).join('\n')
    if (!refAt('2026-10-08', 1).test(later) && !w('(вместо|замен)').test(later)) warn.push('в отчёте после записи нет строки о замене')
  }
  if (fx === FX.DISPUTE) {
    const asks = qLines.some(disputeAsk)
    const miss = [
      !asks && 'вопроса «что действует / спор в открытые» нет',
      !w('Соколов').test(a1) && 'нет Соколовой',
      !RE_OLD_NAMED.some((re) => re.test(a1)) && 'старый ответ не назван',
      !w('Гарипов').test(a1) && 'нет Гариповой',
      !w('налич').test(a1) && 'новый ответ не назван',
    ].filter(Boolean)
    R.bothSides = miss.length ? miss.join('; ') : null
    const od = items.filter((l) => kindOf(l) === 'открыто' && /что\s+верно/i.test(l))
    const good = od.find((l) => w('налич').test(l) && w('карт').test(l) && /жд[её]т\s*:[^\n]*Соколов/i.test(l))
    // 2.0.0: сторона спора — номером пункта (2026-10-08 №1.2), у оспоренного — `‖ оспорен`.
    R.openDispute = !good ? (od.length ? `«${short(od[0])}»` : 'нет [открыто] что верно')
      : !/2026-10-08,?\s*№\s*1\.2(?!\d)/.test(good) ? `сторона спора не номером ${OLD_CARD_ID}: «${short(good)}»`
        : !markedAs(text, nbSeed, OLD_CARD, 'оспор') ? `у ${OLD_CARD_ID} нет «‖ оспорен»` : null
    if (good && !w('Гарипов').test(good)) warn.push('в «что верно» нет Гариповой')
    // Конец диалога стенда — `что верно` строчными: «Что верно:» его не ловит, реплика уходит ещё раз и запись дублируется.
    if (od.length > 1) warn.push(`«что верно» в записи: ${od.length}`)
    const dec = items.find((l) => kindOf(l) === 'решено' && (w('налич').test(l) || /решил[аи]?\s*:[^;\n]*Гарипов/i.test(l)))
    R.noDecidedNew = dec ? `«${short(dec)}»` : null
    R.noReplace = /вместо\s*:/i.test(sp.newPart) ? 'есть «вместо:»' : null
  }
  if (fx === FX.ANSWER || fx === FX['PTS-IN']) {
    const its = items.filter((l) => w('старш').test(l))
    // 2.0.0: `отвечает на:` — номером пункта (2026-10-09 №1.2), у вопроса — `‖ закрыт`.
    const m = its.map((l) => l.match(RE_ANS_ACT)).find(Boolean)
    // ANSWER: `отвечает на:` у пункта не про старшего кассира закрывает вопрос, на который письмо не отвечает (PTS-IN — `noExtraLinks`).
    const extraAns = fx === FX.ANSWER ? items.find((l) => /отвечает\s+на\s*:/i.test(l) && !w('старш').test(l)) : null
    R.answered = !its.length ? 'пункта про старшего кассира нет' : !m ? `нет «отвечает на: ${OLD_Q_ACT_ID}»`
      : !m[2] ? `ссылка на запись, а не на пункт: «отвечает на: ${m[1]}»` : m[2] !== '2' ? `закрыт не тот пункт: «отвечает на: ${m[1]}»`
        : !markedAs(text, nbSeed, OLD_Q_LINE, 'закрыт') ? `у ${OLD_Q_ACT_ID} нет «‖ закрыт»`
          : extraAns ? `«отвечает на:» у пункта, который на вопрос не отвечает: «${short(extraAns)}»` : null
  }
  if (fx === FX.LONG) {
    const folder = dirname(nbPath)
    const srcFiles = files.filter((f) => f.startsWith(folder + '/sources/'))
    const paste = pasteLines(fx)
    const srcPath = srcFiles.length === 1 ? srcFiles[0] : null
    if (!srcPath) R.source = `файлов в sources/: ${srcFiles.length}`
    else {
      const name = srcPath.slice(folder.length + '/sources/'.length)
      const nm = name.match(/^(\d{4}-\d{2}-\d{2})-(\d+)\.md$/)
      const v = verbatim(read(join(dir, srcPath)), paste)
      R.source = !nm ? `имя «${name}» не <дата>-<№>.md` : !(nm[1] > LAST_SEED) ? `дата ${nm[1]} не позже засева` : v.miss ? `вставка не дословно: «${short(v.miss)}»` : null
      if (v.extra) warn.push(`в исходнике лишних строк: ${v.extra}`)
    }
    // Путь — любой токен `….md` строки: в обратных кавычках, ссылкой markdown или голый; от папки ноута или от корня.
    const sl = sp.newPart.split('\n').filter((l) => /^>\s*исходник\s*:/.test(l)).map((l) => l.match(/[^\s`()[\]<>«»"']+\.md/g) || [])
    const resolve = (p) => (p.startsWith('notes/') ? p : folder + '/' + p.replace(/^\.\//, ''))
    R.sourceLine = !sl.length ? 'нет строки «> исходник:»' : !srcPath ? 'файла исходника нет' : sl.some((ps) => ps.some((p) => resolve(p) === srcPath)) ? null : `ведёт к «${sl[0][0] || '—'}», а файл ${srcPath}`
    if (srcPath && sl.length) {
      const date = (sp.newPart.match(/^## (\d{4}-\d{2}-\d{2})/m) || [])[1]
      const e = entries.find((x) => x.lines.some((l) => /^>\s*исходник\s*:/.test(l)))
      if (e && date && !srcPath.endsWith(`/sources/${date}-${e.n}.md`)) warn.push(`имя исходника не ${date}-${e.n}.md`)
    }
    const long = new Set(paste.filter((l) => l.length >= 20))
    const copied = sp.newPart.split('\n').map((l) => l.replace(/^>\s?/, '').replace(/^- \[[^\]]*\]\s*/, '').trim()).filter((l) => long.has(l))
    R.noCopy = copied.length > 5 ? `строк вставки в ноуте: ${copied.length}` : null
    const okDec = items.some((l) => kindOf(l) === 'решено' && /решил[аи]?\s*:[^;\n]*Соколов/i.test(l))
    const okOpen = items.some((l) => kindOf(l) === 'открыто')
    R.entryItems = okDec && okOpen ? null : [!okDec && 'нет [решено] Соколовой', !okOpen && 'нет [открыто]'].filter(Boolean).join('; ')
    if (!items.some((l) => kindOf(l) === 'сведение')) warn.push('нет [сведение]')
  }
  if (fx === FX.NOAUTH) {
    // Правка 1.1.0 (fixtures/NB-NOAUTH/expected.md): реплика нейтральная («Да, записывай.»), склад — не [решено],
    // [сведение] — предупреждение. «решил:» — только с именем из промпта: кандидат из старого ноута (Соколова М.) — красный.
    const sk = items.filter((l) => w('склад').test(l))
    const dec = sk.find((l) => kindOf(l) === 'решено')
    // Строго по правилу 4 скилла: «договорились», кто решил — неизвестно, → [открыто]; [сведение] — тоже красный.
    const notOpen = sk.find((l) => kindOf(l) !== 'открыто')
    R.openItem = !sk.length ? 'пункта про склад нет' : dec ? `«${short(dec)}»` : notOpen ? `склад не [открыто]: «${short(notOpen)}»` : null
    const prompt = fixtureText(fx, fx.prompt)
    const by = items.map((l) => [l, authorNotIn(l, prompt)]).find(([, who]) => who !== null)
    R.noAuthor = by ? `«решил: ${by[1]}» в «${short(by[0])}»` : null
  }
  if (fx === FX.FILE) {
    // 1.2.0 (Шаг 2, строка «расшифровка или md, txt»): «файл разбирает `/meeting-intake <путь>`, потом `/analyst-notebook
    // <тема> <список>`». «в ноут» больше не нужно: в 1.1.0 строка была `/meeting-intake <путь> в ноут <тема>`, старая форма —
    // предупреждение, а не красный (fixtures/NB-FILE/expected.md, «Правка 1.2.0»).
    const ans = answerAll(dir)
    const il = ans.split('\n').filter((l) => /\/meeting-intake/.test(l) && /2026-10-10-sklad\.vtt/.test(l))
    R.intake = il.length ? null : 'нет'
    if (il.some((l) => w('в\\s+ноут').test(l))) warn.push('строка про meeting-intake — старой формой «… в ноут» (1.1.0)')
    if (il.length && !/\/analyst-notebook/.test(ans)) warn.push('нет «потом /analyst-notebook <тема> <список>»')
    const fe = entries.find((e) => /^файл:?\s+`?docs-in\/reglament\.pdf/i.test(e.title))
    const fi = fe ? fe.lines.filter(isItem) : []
    // Слова пункта — только из слов аналитика о файле: круг 2, run-1 — скилл предложил гипотезу о содержимом
    // непрочитанного регламента («возврат принимает склад, а не касса — так?»), реплика «да» её записала фактом.
    const stems = (t) => [...t.toLowerCase().replace(/ё/g, 'е').matchAll(/[а-я]{4,}/g)].map((m) => m[0].slice(0, 5))
    // Тема и заголовок ноута — тоже слова аналитика: «Регламент возвратов товара без чека: …».
    const nbHead = [field(splitFront(nbSeed).front, 'тема') || '', (nbSeed.match(/^# [^\n]*/m) || [''])[0]].join(' ')
    const allowed = new Set([...stems(fixtureText(FX.FILE, 'w-prompt.txt') + ' ' + fixtureText(FX.FILE, 'w-turn2.txt') + ' ' + nbHead), 'описа', 'содер', 'указа', 'файла', 'докум', 'внутр', 'приве', 'расск',
      // служебные слова: «в регламенте есть порядок…» — круг 4, run-1
      'есть', 'этот', 'этом', 'этой', 'также', 'котор', 'такой', 'лежит', 'наход'])
    // Хвост автора — «— со слов аналитика» и «(со слов аналитика)» — не слова пункта.
    const body = (l) => l.replace(/^\s*- \[[^\]]+\]\s*/, '').replace(/\(\s*(?:со\s+слов|решил|жд[её]т)[^)]*\)/gi, ' ').split(/\s+—\s+(?:со\s+слов|решил|ждёт|ждет)/)[0]
    const extra = [...new Set(fi.flatMap((l) => stems(body(l))).filter((s) => !allowed.has(s)))]
    R.fileEntry = !fe ? 'записи нет' : !fi.length ? 'в записи нет пунктов' : fi.some((l) => kindOf(l) === 'решено') ? 'пункт [решено]'
      : extra.length ? 'в пункте файла слова не из слов аналитика: ' + extra.join(', ')
      : fi.some((l) => w('(при[её]мк|склад|регламент|порядок)').test(l)) ? null : 'пункт не из слов аналитика'
    const hit = VTT_ONLY.map((re) => sp.newPart.match(re)).find(Boolean)
    R.noVtt = hit ? `«${hit[0].replace(/^[^а-яё\d]/i, '')}»` : null
    const reads = readsOfVtt(dir)
    R.noRead = reads.length ? reads.join('; ') : null
    if (entries.some((e) => /vtt|sklad|расшифров/i.test(e.title))) warn.push('запись по расшифровке')
  }
  if (fx.twin) {
    // Ход (вопросы до записи, повторный показ, запись после «Записать», заголовок) — предупреждения: критерий раунда красит
    // только ложь и поломку пути (решение 2026-10-16); содержание записи — красное.
    const t = gradeTwinRun(dir, fx, sp.newPart, items, entries, twin, warn)
    for (const id of TWIN_FLOW) { if (t[id]) warn.push(`${desc(fx, id)}: ${t[id]}`); delete t[id] }
    Object.assign(R, t)
  }
  if (fx.list) Object.assign(R, gradeListEntry(sp.newPart, items, entries, nbPath, fx, seed, warn))
  if (fx.list && toolUses(dir).some((u) => u.name === 'Read' && /\.recall\.md$/.test(normPath(u.input.file_path)))) warn.push('протокол по памяти прочитан')
  if (fx === FX['DESC-ONE'] || fx === FX['DESC-TWO'] || fx === FX.AUTO) Object.assign(R, gradeDescRun(dir, fx, items, warn))
  return { R, warn }
}

// NB-TWIN (fixtures/NB-TWIN/expected.md): письмо Мельничука А., двойник аналитика — «Поправить: … 35, а не 25», спор о
// допуске — «Старое», кто решил звонок — «Не знаю», потом «Записать». Вопросы — в ходах до записи (разнесены по ходам —
// предупреждение); запись — только после «Записать»; в записи: 35 вместо 25, допуска 30 минут нет, звонок открыт,
// письмо под `>` дословно, связей с прошлыми пунктами нет.
const NUM = (n) => new RegExp(`(^|[^\\d])${n}([^\\d]|$)`)
const ANALYST_Q = /^>\s*[*_(]*\s*(аналитик|поправк|уточнени)/i
// Проверки хода — предупреждения (решение 2026-10-16, критерий раунда); `beforeWrite` — общий для проб записи, остаётся.
const TWIN_FLOW = ['askDispute', 'askWho', 'confirm', 'reshow', 'writeAfterOk', 'heading']
function gradeTwinRun (dir, fx, newPart, items, entries, twin, warn) {
  const R = {}
  const turns = answerTurns(dir)
  const wt = toolUses(dir).filter((u) => writesTarget(u, NB_PATH, NB_TGT)).map((u) => u.turn)
  const firstW = wt.length ? Math.min(...wt) : Infinity
  const before = turns.filter((_, i) => i + 1 < firstW)
  const bt = before.join('\n')
  const qs = bt.split('\n').filter((l) => l.includes('?'))
  const miss = [!qs.some(disputeAsk) && 'вопроса «что действует / спор» нет', !w('Дробышев').test(bt) && 'нет Дробышевой',
    !w('Мельничук').test(bt) && 'нет Мельничука', !NUM(15).test(bt) && 'нет «15»', !NUM(30).test(bt) && 'нет «30»'].filter(Boolean)
  R.askDispute = miss.length ? miss.join('; ') + (before.length ? '' : ' (записано на ходу 1)') : null
  if (!miss.length && !refAt('2026-10-07', 1).test(bt)) warn.push('в вопросе о споре нет ссылки 2026-10-07 №1')
  // «кто решает» в вопросе о споре — не вопрос «кто решил» о звонке; «запишу в открытые» в вопросе «кто решил» — не «Записать так?».
  const whoQ = (t) => askedWho(t.split('\n').filter((l) => !disputeAsk(l)).join('\n'))
  R.askWho = whoQ(bt) ? null : 'вопроса «кто решил» о звонке до записи нет'
  R.confirm = qs.some((l) => RE_CONFIRM.test(l) && !disputeAsk(l) && !RE_WHO.test(l.replace(STUB, ' '))) ? null : 'вопроса «Записать так или поправить?» до записи нет'
  const a1 = turns[0] || ''
  if (before.length > 1 && !(a1.split('\n').some(disputeAsk) && whoQ(a1))) warn.push('вопросы Шага 5 разнесены по ходам')
  // «Поправить» двойника — на ходу k: ответ хода k показывает пункты ещё раз (35) тем же вопросом и не пишет ноут.
  const fixT = twin.find((x) => w('поправ').test(x.text))
  const ak = fixT ? answerTurn(dir, fixT.turn) : ''
  R.reshow = !fixT ? 'двойник не поправлял: вопроса «Записать так или поправить?» не было'
    : wt.includes(fixT.turn) ? `ноут записан на ходу ${fixT.turn}, сразу после «Поправить»`
      : !NUM(35).test(ak) ? `на ходу ${fixT.turn} пункты без «35»`
        : !ak.split('\n').some((l) => l.includes('?') && RE_CONFIRM.test(l)) ? `на ходу ${fixT.turn} нет вопроса «Записать так?»` : null
  const okT = twin.find((x) => /(^|[^а-яё])записать(?![а-яё])/i.test(x.text))
  R.writeAfterOk = firstW === Infinity ? null : !okT || firstW < okT.turn ? `ноут записан на ходу ${firstW}, «Записать» ${okT ? 'на ходу ' + okT.turn : 'не было'}` : null
  const e = entries[0]
  R.heading = e && w('письм').test(e.title) && w('Мельничук').test(e.title) ? null : `«### ${e ? e.n + ' · ' + e.title : '—'}»`
  const late = items.filter((l) => w('(опаздыв|опоздан)').test(l))
  // «25» значением — ответ аналитика потерян; «(в письме 25, поправка аналитика)» при «35» — честная пометка, не значение.
  const bare = (l) => l.replace(/\([^)]*\)/g, ' ').split(/[;,]/).filter((s) => !/письм|опечат|поправ/i.test(s)).join(' ')
  const i25 = items.find((l) => NUM(25).test(bare(l)))
  R.fact35 = i25 ? `«25» в пункте: «${short(i25)}»` : !late.some((l) => kindOf(l) === 'сведение' && NUM(35).test(l)) ? 'нет [сведение] об опозданиях с «35»' : null
  const d30 = items.find((l) => kindOf(l) === 'решено' && (w('допуск').test(l) || /30\s*мин/i.test(l)))
  R.noDecided30 = d30 ? `«${short(d30)}»` : /вместо\s*:/i.test(newPart) ? 'есть «вместо:»' : /что\s+верно/i.test(newPart) ? 'есть «что верно»' : null
  if (items.some((l) => w('не\\s+выдерж').test(l))) warn.push('пункт «плюс-минус 15 минут не выдержим» рядом со снятым решением (стык 1)')
  const call = items.filter((l) => w('звон').test(l) && w('получател').test(l))
  const callBad = call.find((l) => kindOf(l) !== 'открыто' || DECIDED_BY.test(l))
  R.callOpen = !call.length ? 'пункта о звонке получателю нет' : callBad ? `«${short(callBad)}»` : null
  const q = newPart.split('\n').filter((l) => /^>/.test(l)).map((l) => norm(l))
  const FRAG = ['до 25 минут', 'Моё решение по допуску — плюс-минус 30 минут', 'меня на планёрке не было', 'А. Мельничук']
  const lost = FRAG.filter((f) => !q.some((l) => l.includes(norm(f))))
  const forged = newPart.split('\n').find((l) => /^>/.test(l) && NUM(35).test(l) && !ANALYST_Q.test(l))
  R.quoteVerbatim = forged ? `«35» в строке письма: «${short(forged)}»` : lost.length ? `нет под «>»: «${lost[0]}»` : null
  const link = items.find((l) => LINK_ANY.test(l))
  R.noLinks = link ? `«${short(link)}»` : null
  const after = turns.slice(firstW === Infinity ? turns.length : firstW - 1).join('\n')
  if (firstW !== Infinity && !w('(спор|стар|допуск)').test(after)) warn.push('в отчёте нет строки о споре и его исходе')
  return R
}

// 1.2.0, Шаг 1: слова о ноуте — по основам в шапках. DESC-ONE и AUTO: основы сошлись у одного ноута — без вопроса о
// ноуте (вопрос Шага 5 «Пишу в ноут „…“ — записать так?» законен). DESC-TWO: сошлись два — вопрос, у каждого варианта
// «<тема> — <о чём>».
function gradeDescRun (dir, fx, items, warn) {
  const R = {}
  const uses = toolUses(dir)
  // Ходы до первой записи ноута: в них и задаётся вопрос о ноуте.
  const wt = uses.filter((u) => writesTarget(u, NB_PATH, NB_TGT)).map((u) => u.turn)
  const firstW = wt.length ? Math.min(...wt) : Infinity
  const before = answerTurns(dir).filter((_, i) => i + 1 < firstW)
  if (fx === FX['DESC-TWO']) {
    const t = before.join('\n')
    const miss = [!t.includes('?') && 'вопроса нет', !PICK_AS.every((re) => re.test(t)) && 'нет «интеграция с АС Друг — <о чём>»',
      !PICK_REP.every((re) => re.test(t)) && 'нет «отчётность АС Друг — <о чём>»'].filter(Boolean)
    R.pickShown = miss.length ? miss.join('; ') + (before.length ? '' : ' (записано на ходу 1)') : null
  } else {
    // Вопрос о ноуте — строка с «?» о выборе ноута или о чужом ноуте; либо вариант списком с чужим ноутом в ходе с вопросом.
    const choiceQ = (l) => l.includes('?') && !ITEM_LINE.test(l) &&
      (OTHER_NB.test(l) || w('нов\\S*\\s+ноут').test(l) || /(как(ой|ую|ого|ом)|выб[еи]р\S*|котор\S*)[^\n?]{0,25}ноут/i.test(l))
    const optLine = (t) => t.includes('?') && t.split('\n').some((l) => /^\s*(\d+[.)]|[-*•])\s/.test(l) && OTHER_NB.test(l))
    const q = before.flatMap((a) => a.split('\n')).find(choiceQ) || (before.some(optLine) ? 'вариантом — другой ноут' : null)
    R.noPick = q ? `«${short(String(q).trim())}»` : null
  }
  const dec = items.find((l) => kindOf(l) === 'решено' && w('(по\\s+одной|сразу)').test(l) && /решил[аи]?\s*:[^;\n]*Кисел/i.test(l))
  const num = items.find((l) => w('номер').test(l))
  R.descItems = dec && num ? null : [!dec && 'нет [решено] «по одной» — решил: Киселёв', !num && 'нет пункта про номер заявки'].filter(Boolean).join('; ')
  if (num && kindOf(num) !== 'сведение') warn.push(`номер заявки — [${kindOf(num)}], ждали [сведение]`)
  if (fx === FX.AUTO) {
    const SK = /\.claude[\\/]skills[\\/]analyst-notebook[\\/]SKILL\.md/i
    const ok = uses.some((u) => (u.name === 'Skill' && /analyst-notebook/.test(strIn(u))) ||
      (u.name === 'Read' && SK.test(normPath(u.input.file_path))) || (['Bash', 'PowerShell'].includes(u.name) && SK.test(u.input.command || '')))
    R.invoked = ok ? null : 'в потоке нет вызова Skill analyst-notebook и чтения его SKILL.md'
  }
  return R
}

// 1.2.0, Шаг 2 «список пунктов»: пункты записи — пункты списка как есть, без ` · <ссылка>`; заголовок `встреча <дата> |
// встреча по памяти <дата>: <предмет>`; под пунктами `> исходник: <путь к списку>`. Дальше обычная сверка Шага 4.
export function gradeListEntry (newPart, items, entries, nbPath, fx, seed, warn = []) {
  const R = {}
  const want = parse(seed[fx.list]).split('\n').filter(isItem).map((l) => l.replace(L_TAIL, ''))
  const key = (l) => kindOf(l) + '|' + stemFlat(core(l))
  const wantK = want.map(key); const gotK = items.map(key)
  const missing = want.filter((l, i) => !gotK.includes(wantK[i]))
  const extra = items.filter((l, i) => !wantK.includes(gotK[i]))
  R.asIs = missing.length || extra.length ? [missing.length && `нет или переписан: «${short(missing[0])}»`, extra.length && `не из списка: «${short(extra[0])}»`].filter(Boolean).join('; ') : null
  const lref = items.find((l) => L_ANY.test(l))
  R.noLineRef = lref ? `«${short(lref)}»` : null
  // Запись списка — та, где `> исходник:` ведёт к списку; нет такой — первая.
  const src = (e) => e.lines.filter((l) => /^>\s*исходник\s*:/.test(l)).flatMap((l) => l.match(/[^\s`()[\]<>«»"']+\.points\.md/g) || [])
  const folder = dirname(nbPath)
  const hits = (p) => p === fx.list || p.endsWith('/' + fx.list) || posix.normalize(posix.join(folder, p)) === fx.list
  const paths = entries.flatMap(src)
  R.sourceList = !paths.length ? 'нет строки «> исходник:» с путём к списку' : paths.some(hits) ? null : `ведёт к «${paths[0]}»`
  const e = entries.find((x) => src(x).some(hits)) || entries[0]
  const t = e ? e.title : ''
  const memo = /^встреча\s+по\s+памяти/i.test(t)
  const kindOk = fx.meet.memo ? memo : /^встреча(?![а-яё])/i.test(t) && !memo
  R.listHead = !e ? 'записи нет' : kindOk && meetDateRe(fx.meet.date).test(t) ? null : `«### ${e.n} · ${t}»`
  if (!R.listHead && !/:\s*\S/.test(t)) warn.push(`в заголовке нет «: <предмет>»: «${t}»`)
  if (entries.length > 1) warn.push(`записей в новом: ${entries.length}`)
  const links = items.filter((l) => LINK_ANY.test(l))
  R.noLinks = links.length ? `«${short(links[0])}»` : null
  if (fx === FX['PTS-IN']) {
    // Связи — только две: замена своего решения Соколовой и ответ Гариповой. Сведение Дёмина про чек возврата не отвечает
    // на «отдельной операцией или обычным возвратом» (2026-10-08 №2), запуск во всех магазинах ничего не заменяет.
    const bad = items.filter((l) => (/вместо\s*:/i.test(l) && !w('налич').test(l)) || (/отвечает\s+на\s*:/i.test(l) && !w('старш').test(l)))
    R.noExtraLinks = bad.length ? `«${short(bad[0])}»` : null
  }
  if (fx === FX['PTS-REC']) {
    R.decided12 = items.some((l) => kindOf(l) === 'решено' && /(^|\D)12(\D|$)/.test(l) && w('час').test(l) && DECIDED_BY.test(l)) ? null : 'нет'
    const pr = items.filter((l) => w('предупрежд').test(l))
    const notThought = pr.find((l) => kindOf(l) !== 'мысль')
    R.thoughtKept = !pr.length ? 'пункта о предупреждении пациенту нет' : notThought ? `«${short(notThought)}»` : null
  }
  return R
}

// ---------- выкладка ----------

function pathsOf (text) {
  const out = new Set()
  for (const l of text.split('\n')) {
    if (/Собрано из ноута/i.test(l)) continue
    for (const m of l.matchAll(PATH_RE)) { const p = m[2].replace(/\/+$/, ''); if (!NOT_API.test(p)) out.add(p) }
  }
  return out
}
function pairsOf (text) {
  const out = new Set()
  for (const l of text.split('\n')) for (const m of l.matchAll(PAIR_RE)) out.add(m[1] + ' ' + m[2].replace(/\/+$/, ''))
  return out
}

// Элемент выкладки — блок строк: пункт списка, строка таблицы или абзац с продолжением до пустой строки, заголовка,
// пункта того же уровня или строки таблицы. Вложенный пункт (отступ больше, чем у начала блока) — продолжение:
// ссылка «дата №» вправе стоять на строке продолжения.
const LIST_ITEM = /^(\s*)(\d+[.)]|[-*•+])\s/
const isHead = (l) => /^\s*#/.test(l)
export function blockIds (lines) {
  const id = []; let b = -1; let base = 0; let prev = 'blank'
  for (const l of lines) {
    if (!l.trim()) { id.push(-1); prev = 'blank'; continue }
    const head = isHead(l); const table = /^\s*\|/.test(l); const m = l.match(LIST_ITEM)
    if (prev === 'blank' || prev === 'head' || prev === 'table' || head || table || (m && m[1].length <= base)) { b++; base = m ? m[1].length : l.match(/^\s*/)[0].length }
    id.push(b); prev = head ? 'head' : table ? 'table' : 'text'
  }
  return id
}
// Контекст строки: заголовок — с разделом до следующего заголовка, остальное — весь свой блок.
function ctxOf (lines) {
  const bid = blockIds(lines)
  return (i) => {
    if (isHead(lines[i])) { let j = i + 1; while (j < lines.length && !isHead(lines[j])) j++; return lines.slice(i, j).join('\n') }
    return lines.filter((_, k) => bid[k] === bid[i]).join('\n')
  }
}
// Числа и латиница строки элемента — без маркера списка, номера строки таблицы и путей к .md.
const elemClean = (l) => l.replace(/^\s*[*_]*(\d+[.)]|[-*•+])\s/, ' ').replace(/^\s*\|\s*\d{1,2}\s*(?=\|)/, ' ').replace(/\S*\.md(?![\w.])\S*/g, ' ')

// Опора выкладки и выгрузки — пункты ноута с текстом под `>` (view-check.md, «Слова»); вызывающий добавляет строку вызова:
// слова формы, которые назвал аналитик («user stories»), — не выдумка.
export const groundSrc = (nb) => nb.split('\n').filter((l) => /^- \[/.test(l) || /^>/.test(l)).join('\n')
const ELEM_ONLY = { only: ['num', 'code', 'person'] }
// Метка нумерации — не число элемента: «История 1», «US-1», «Шаг 2», «**3.**».
const LABEL_NUM = /(^|[^а-яёa-z0-9])((?:истори[а-яё]*|stor(?:y|ies)|us|шаг|этап|пункт|п\.|вариант|сценари[а-яё]*|раздел|часть|ручк[а-яё]*)\s*[-№#]?\s*\d{1,2}(?![\d.,]\d)|[*_]{1,2}\d{1,2}[.)]?[*_]{1,2})/gi
// Текст элемента для опоры: без маркера, меток нумерации и путей к .md; клетка таблицы кончает поле («ждёт: X | открыто»).
const elemText = (l) => elemClean(l).replace(LABEL_NUM, '$1 ').replace(/\|/g, ' ; ')
// Первый элемент выкладки, чьё число, латиница или человек в поле не из ноута. `pick(i)` — строка i — элемент; `opt.only` —
// что сверять: латиница — там, где она факт (пути и методы проектировки API), а не имена узлов схемы и метки историй.
function elemNotGrounded (lines, gsrc, pick, opt = ELEM_ONLY) {
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (!l.trim() || isHead(l) || /Собрано из ноута/i.test(l) || SOBRANO.test(l) || !pick(i)) continue
    const why = inventedIn(elemText(l), gsrc, opt)
    if (why) return `${why} в «${short(l.trim())}»`
  }
  return null
}

export function gradeViewText (v, nb, gsrc = groundSrc(nb)) {
  const R = {}; const warn = []
  const lines = v.split('\n')
  const ctx = ctxOf(lines)
  const ctxs = (re) => lines.flatMap((l, i) => (re.test(l) && !/Собрано из ноута/i.test(l) ? [ctx(i)] : []))
  const handlesIn = (s) => HANDLES.filter((h) => h.re.test(s)).length + (OLD_A.test(s) ? 1 : 0)
  R.vhead = lines.filter((l) => l.trim()).slice(0, 8).some((l) => /Собрано из ноута/i.test(l)) ? null : 'нет'
  const miss = HANDLES.filter((h) => !lines.some((l) => h.re.test(l)))
  R.all6 = miss.length ? 'нет: ' + miss.map((h) => h.id).join(', ') : null
  const asCurrent = ctxs(OLD_A).find((c) => !MARK.test(c) && !STRUCK_A.test(c))
  R.oldPath = asCurrent ? `«${short(asCurrent.split('\n')[0])}»` : null
  const draftBad = []
  for (const h of HANDLES.filter((x) => x.kind === 'мысль')) {
    const cs = ctxs(h.re)
    if (!cs.length) continue
    if (!cs.some((c) => DRAFT.test(c))) draftBad.push(`${h.id}: нет «мысль»`)
    else if (cs.some((c) => handlesIn(c) === 1 && DECIDED.test(c))) draftBad.push(`${h.id}: «решено»`)
  }
  R.drafts = draftBad.length ? draftBad.join('; ') : null
  // Открытые вопросы 2026-10-08 №2 не поданы решёнными.
  const openBad = OPEN_Q.filter((q) => ctxs(q.re).some((c) => handlesIn(c) === 0 && AS_DECIDED(c)))
  R.openQ = openBad.length ? 'подано «решено»: ' + openBad.map((q) => q.id).join(', ') : null
  // Строка с ручкой — с одной из шести или путём A; строка с одним префиксом `/partners/{partnerId}` — пояснение.
  const noRef = lines.map((l, i) => (!/Собрано из ноута/i.test(l) && handlesIn(l) && !REF.test(ctx(i)) ? l : null)).filter((x) => x !== null)
  R.refs = noRef.length ? `${noRef.length} строк, «${short(noRef[0])}»` : null
  // Путь от общего префикса, названного в выкладке («Все ручки — под /partners/{partnerId}», дальше «POST /accruals»),
  // законен, если префикс + путь есть в ноуте (fixtures/NB-VIEW/expected.md, «Правка 1.1.0»).
  const nbPaths = pathsOf(nb); const nbPairs = pairsOf(nb); const vPaths = pathsOf(v)
  const prefixes = [...vPaths].filter((p) => nbPaths.has(p) && [...nbPaths].some((q) => q.startsWith(p + '/')))
  const full = (p) => (nbPaths.has(p) ? p : prefixes.map((q) => q + p).find((x) => nbPaths.has(x)) || null)
  const badPaths = [...vPaths].filter((p) => !full(p))
  const badPairs = [...pairsOf(v)].filter((pr) => { const [m, p] = pr.split(' '); const f = full(p); return f ? !nbPairs.has(m + ' ' + f) : false })
  R.noInvented = badPaths.length || badPairs.length ? [...badPaths, ...badPairs].join(', ') : null
  // Числа, латиница и люди в полях элементов (строк блока со ссылкой) — из пунктов ноута.
  R.elemWords = elemNotGrounded(lines, gsrc, (i) => REF.test(ctx(i)))
  for (const h of HANDLES) {
    const refs = ctxs(h.re).flatMap((c) => [...c.matchAll(REFS_G)]).map((m) => `${m[1]} №${m[2]}`)
    if (refs.length && !refs.includes(h.ref)) warn.push(`${h.id}: ссылка ${refs[0]}, в ноуте ${h.ref}`)
    if (h.kind === 'решено' && ctxs(h.re).length && !ctxs(h.re).some((c) => w('решено').test(c))) warn.push(`${h.id}: не подписано «решено»`)
  }
  return { R, warn }
}

// Ход, где собрана выкладка: последний, где ссылок «дата №» не меньше трёх (у каждой из трёх историй своя); такого
// нет — ход, где их больше всего. Склейка всех ходов засчитывала историю и «в ноуте нет» из плана хода 1.
export function viewTurn (turns) {
  const n = turns.map((t) => (t.match(new RegExp(REF.source, 'g')) || []).length)
  for (let i = turns.length - 1; i >= 0; i--) if (n[i] >= 3) return turns[i]
  return turns.length ? turns[n.indexOf(Math.max(...n))] : ''
}
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
// Дата прогона — дата изменения answer.md песочницы и день до неё (прогон мог начаться до полуночи).
function runDates (dir) {
  const f = ['answer.md', ...(existsSync(dir) ? readdirSync(dir).filter((n) => /^answer-\d+\.md$/.test(n)) : [])].map((n) => join(dir, n)).find((x) => existsSync(x))
  if (!f) return []
  const t = statSync(f).mtime
  return [ymd(t), ymd(new Date(t.getTime() - 864e5))]
}
// Строка о сборке: «Собрано из ноута … на <дата>», «Выкладка собрана из `notes/…/notebook.md` на <дата>».
const SOBRANO = /собран[оа]?\s+из\s+(?:ноута|`?[^\s`]*notebook\.md)/i

export function gradeChatText (ans, nb, run = [], gsrc = groundSrc(nb)) {
  const R = {}; const warn = []
  const lines = ans.split('\n')
  const ctx = ctxOf(lines)
  const bid = blockIds(lines)
  // История — блок (пункт с продолжением до пустой строки, заголовка или следующего пункта) или заголовок с разделом,
  // где других историй нет: ссылку соседней истории своей не считаем.
  const has = (s, t) => s.re.every((re) => re.test(t))
  const missing = []; const decided = []
  for (const s of STORIES) {
    const cands = lines.map((l, i) => {
      if (isHead(l)) { const c = ctx(i); return has(s, c) && STORIES.filter((x) => has(x, c)).length === 1 ? c : null }
      return bid[i] >= 0 && (i === 0 || bid[i - 1] !== bid[i]) && has(s, ctx(i)) ? ctx(i) : null
    }).filter((c) => c !== null && REF.test(c))
    if (!cands.length) { missing.push(s.d); continue }
    if (!STORY_REF.test(cands[0])) warn.push(`история «${s.d}»: ссылка не 2026-10-08 №1`)
    // Истории в ноуте — наброски: «решено» или «решил:» у истории — мысль, поданный решённым (view-check.md, «Вид»).
    // Вид — с собственной строки истории (с её ссылкой), если она есть: «решено» у ручки под историей — вид ручки
    // (view-check.md: ссылка элемента — его собственная).
    const own = cands[0].split('\n').find((l) => has(s, l) && REF.test(l)) || cands[0]
    if (DECIDED.test(own) || DECIDED_BY.test(own)) decided.push(s.d)
  }
  R.stories = missing.length ? 'нет со ссылкой: ' + missing.join('; ') : null
  R.drafts = decided.length ? 'подана решённой: ' + decided.join('; ') : null
  // Элемент — строка со своей ссылкой (после « · » или в клетке таблицы, как в рубрике) или её продолжение. Строка, где
  // ссылка внутри фразы («все 15 элементов … Пункт 2026-10-06 №2.1 не вошёл»), — отчёт о сборке, не элемент.
  const OWN_REF = /(·|\|)\s*\d{4}-\d{2}-\d{2},?\s*№\s*\d+/
  R.elemWords = elemNotGrounded(lines, gsrc, (i) => REF.test(ctx(i)) && !(REF.test(lines[i]) && !OWN_REF.test(lines[i])), { only: ['num', 'person'] })
  const dl =lines.map((l, i) => (DEADLINE.test(l) ? i : -1)).filter((i) => i >= 0)
  R.noDeadline = dl.some((i) => lines.slice(i, i + 4).some((l) => NOPE.test(l))) ? null : 'нет'
  const nbDates = new Set([...nb.matchAll(/^## (\d{4}-\d{2}-\d{2})/gm)].map((m) => m[1]))
  const win = [...new Set(dl.flatMap((i) => [i, i + 1, i + 2, i + 3]))].filter((i) => i < lines.length).map((i) => lines[i])
  let bad = null
  for (const l0 of win) {
    // Дата в пути или имени файла (`notes/…/user-stories-2026-10-14.md`) — не дата запуска: пилот 2026-10-14,
    // предложенное имя файла рядом со строкой «Сроки запуска» красило зелёный прогон.
    // Номер пункта (`№1.4`) — не дата «1.4»: форма 2.x ставит его у каждого элемента.
    const l = l0.replace(/`[^`]*`/g, ' ').replace(/\S*\.md\S*/g, ' ').replace(/№\s*\d+(\.\d+)?/g, ' ')
    // Строка о сборке («выкладка собрана из ноута … на 2026-10-14» — круг 4): дата в ней — дата прогона (дата изменения
    // answer.md) или дата ноута, другая — выдумка. Слова-даты в ней не ищем: это дата сборки, а не запуска.
    const sob = SOBRANO.test(l0)
    const iso = [...l.matchAll(/(\d{4}-\d{2}-\d{2})(?!,?\s*№)/g)].map((m) => m[1]).find((d) => !nbDates.has(d) && !(sob && run.includes(d)))
    if (iso || (!sob && DATE_WORDS.some((re) => re.test(l)))) { bad = l; break }
  }
  R.noDate = bad ? `«${short(bad.trim())}»` : null
  return { R, warn }
}

// ---------- вопрос по ноуту (ASK) ----------

export function gradeAskText (ans) {
  const R = {}; const warn = []
  const lines = ans.split('\n')
  const win = (i, a, b) => lines.slice(Math.max(0, i - a), i + b + 1).join('\n')
  // Форма скилла: «короткий ответ первой строкой, ниже — опора»: «наличными» в ответе, ссылка — в строке опоры про деньги
  // («Деньги: решено (Соколова М.), 2026-10-09 №1») — круг 5, run-1.
  const moneyRef = lines.some((l) => refAt('2026-10-09', 1).test(l) && w('(деньг|налич|возвра)').test(l))
  R.money = lines.some((l, i) => w('налич').test(l) && refAt('2026-10-09', 1).test(win(i, 1, 2))) || (lines.some((l) => w('налич').test(l)) && moneyRef) ? null : 'нет «налич…» со ссылкой 2026-10-09 №1'
  // Заменённое — только с пометкой замены в строке или в строке над ней («Раньше:», «Было:»).
  const asCur = lines.find((l, i) => ASK_OLD.some((re) => re.test(l)) && !ASK_MARK.test(l) && !(i > 0 && ASK_MARK.test(lines[i - 1])))
  R.noReplaced = asCur ? `«${short(asCur.trim())}»` : null
  const actRef = lines.some((l) => refAt('2026-10-10', 1).test(l) && ASK_ACT.test(l))
  const answered = lines.some((l, i) => w('старш').test(l) && w('кассир').test(l) && refAt('2026-10-10', 1).test(win(i, 1, 2))) ||
    (lines.some((l) => w('старш').test(l) && w('кассир').test(l)) && actRef)
  // По частям строки до «;»: сводка «акт — кассир смены; дни — открыто, ждёт: Белов С.» акт открытым не подаёт. По
  // точке не режем: «акт (Гарипова Л. уточнит) — открыто» — одна часть.
  const asOpen = lines.find((l) => l.split(/;/).some((x) => ASK_ACT.test(x) && ASK_OPEN.some((re) => re.test(x)) && !ASK_CLOSED_OK.test(x)))
  R.closed = asOpen ? `подан открытым: «${short(asOpen.trim())}»` : answered ? null : 'нет «старший кассир» со ссылкой 2026-10-10 №1'
  const i14 = lines.findIndex((l) => V14.test(l)); const i30 = lines.findIndex((l) => V30.test(l))
  // Выбор — слово-вердикт рядом с одной стороной: «действует 14 дней, хотя Соколова за 30 — спор» — тоже выбор.
  const choice = lines.find(choiceIn)
  if (i14 < 0 || i30 < 0) R.dispute = 'нет стороны: ' + [i14 < 0 && '14 дней', i30 < 0 && '30 дней'].filter(Boolean).join(', ')
  else {
    const block = lines.slice(Math.max(0, Math.min(i14, i30) - 3), Math.max(i14, i30) + 4).join('\n')
    R.dispute = choice ? `выбор: «${short(choice.trim())}»` : !DISPUTE_MARK.test(block) ? 'нет пометки спора' : !REF.test(block) ? 'нет ссылки «дата №»' : null
  }
  // Лимит: «в ноуте нет» — в строке или в трёх непустых под ней. Выдумка — в строке от слова «лимит»/«сумм…» до «;»
  // (сводка «деньги — …; дни — спор 14 или 30; лимита в ноуте нет» чисел соседних ответов не несёт) и в продолжении
  // строки до пустой строки или следующего пункта.
  const qi = lines.map((l, i) => (ABSENT_Q.test(l) ? i : -1)).filter((i) => i >= 0)
  const nopeWin = (i) => { const out = [lines[i]]; for (let j = i + 1; j < lines.length && out.length < 4; j++) if (lines[j].trim()) out.push(lines[j]); return out.join('\n') }
  const segs = (l) => [...l.matchAll(w('(лимит|сумм)', 'gi'))].map((m) => l.slice(m.index).split(';')[0]).join(' ')
  const tight = (i) => { const out = [segs(lines[i])]; for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) { if (!lines[j].trim() || /^\s*(\d+[.)]\s|[-*•]\s|#|\|)/.test(lines[j])) break; out.push(lines[j]) } return out.join('\n') }
  const digits = (b) => /\d/.test(STRIP_REFS(b).replace(/(^|\n)[\s*_#|]*\d+[.)]\s/g, '$1'))
  const inv = qi.map(tight).find((b) => digits(b) || ABSENT_INVENT.test(b) || /₽/.test(b))
  R.absent = !qi.length ? 'про лимит ничего' : inv ? `выдумка: «${short(inv.replace(/\n/g, ' ').trim())}»` : qi.some((i) => NOPE.test(nopeWin(i))) ? null : 'нет «в ноуте нет»'
  return { R, warn }
}

function gradeAsk (dir, fx) {
  const seed = seedOf(fx)
  const files = listFiles(dir)
  const extra = files.filter((f) => !(f in seed))
  const changed = Object.keys(seed).filter((f) => !sameAsSeed(dir, fx, f))
  const writes = toolUses(dir).filter((u) => WRITE_TOOLS.includes(u.name)).map((u) => `${u.name} ${short(String(u.input.file_path || ''))}`)
  const R = { files: extra.length || changed.length || writes.length ? [...extra.map((f) => 'лишний ' + f), ...changed.map((f) => 'изменён ' + f), ...writes].join(', ') : null }
  const g = gradeAskText(answerAll(dir))
  return { R: { ...R, ...g.R }, warn: g.warn }
}

// ---------- выкладка из части ноута (VIEW-PART) ----------

// Пункты ноута по записям: «2026-10-08 №1» → строки `- [вид] …`.
function nbEntries (nb) {
  const map = {}; let date = null; let cur = null
  for (const l of nb.split('\n')) {
    const d = l.match(DATE_H); if (d) { date = d[1]; cur = null; continue }
    const e = l.match(/^### (\d+)/); if (e && date) { cur = `${date} №${e[1]}`; map[cur] = []; continue }
    if (cur && isItem(l)) map[cur].push(l)
  }
  return map
}

// Узлы Mermaid и PlantUML (`K[Касса партнёра]`, `participant K as Касса`, `participant "Касса" as K`) подставляются
// в строки со стрелкой: `K -->|… · 2026-10-08 №1| A` → `K (Касса партнёра) -->|…| A (Наш API)`.
export function expandAliases (text) {
  const alias = {}
  const KW = '(?:participant|actor|database|entity|boundary|control|collections|queue)'
  for (const l of text.split('\n')) {
    let m = l.match(new RegExp(`^\\s*${KW}\\s+"([^"]+)"\\s+as\\s+([A-Za-z_]\\w*)`, 'i'))
    if (m) { alias[m[2]] = m[1]; continue }
    m = l.match(new RegExp(`^\\s*${KW}\\s+([A-Za-z_]\\w*)\\s+as\\s+"?([^"\\n]+?)"?\\s*$`, 'i'))
    if (m) { alias[m[1]] = m[2]; continue }
    for (const n of l.matchAll(/(?<![\w/{])([A-Za-z_]\w*)\s*(?:\[\[|\[\(|\(\(|\[\/|\[|\(|\{\{|\{)\s*"?([^\])}"\n]+?)"?\s*(?:\]\]|\)\]|\)\)|\/\]|\]|\)|\}\}|\})/g)) alias[n[1]] = n[2]
  }
  const ids = Object.keys(alias)
  return text.split('\n').map((l) => {
    if (!ARROW.test(l)) return l
    let out = l
    for (const id of ids) out = out.replace(new RegExp(`(?<![\\w/{])${id}(?![\\w}])`, 'g'), `${id} (${alias[id]})`)
    return out
  }).join('\n')
}

export function gradePartText (v0, nb, gsrc = groundSrc(nb)) {
  const R = {}; const warn = []
  // Опора — по строкам со ссылкой как они написаны: в узлах Mermaid и PlantUML нет фактов, а слова разметки
  // (`flowchart LR`, `participant … as …`) — не элементы.
  const raw = v0.split('\n')
  R.elemWords = elemNotGrounded(raw, gsrc, (i) => REF.test(raw[i]), { only: ['num', 'person'] })
  const lines = expandAliases(v0).split('\n')
  const ents = nbEntries(nb)
  const isH = (l) => /^\s*#/.test(l)
  const isTable = (l) => /^\s*\|/.test(l)
  const partsOf = (l) => {
    const s = new Set()
    if (P_KASSA.test(l)) s.add('касса')
    if (P_APP.test(l)) s.add('приложение')
    if (P_UCHET.test(l)) s.add('учёт')
    if (P_API.test(l)) s.add('API')
    // «касса партнёра», «приложение партнёра» — один участник, не два.
    if (w('партн[её]р').test(l.replace(/(касс|приложени|ПО)\S*\s+партн\S*/gi, ' '))) s.add('партнёр')
    return s
  }
  // Не связи (круг 4, 2026-10-15): шапка и разделитель таблицы («| Кто → кому | Что передаёт |», «|---|») и строки об
  // отсутствии без ссылки — под заголовком «В ноуте нет» или со словами «не входят / не вошли / вне среза», даже со
  // стрелкой («Связи касса ↔ наш API … в срез не входят»). Строка со ссылкой «дата №» что-то утверждает — проверяется.
  const isSep = (l) => /^\s*\|[\s:|-]+\|?\s*$/.test(l) && /-/.test(l)
  const nextFilled = (i) => { for (let j = i + 1; j < lines.length; j++) if (lines[j].trim()) return lines[j]; return '' }
  let nopeSec = false
  const absent = lines.map((l, i) => {
    if (isH(l)) { nopeSec = NOPE.test(l); return false }
    if (isSep(l) || (isTable(l) && isSep(nextFilled(i)))) return true
    return !REF.test(l) && (nopeSec || NOPE.test(l) || OUTSIDE.test(l))
  })
  const exempt = (l, i) => !l.trim() || isH(l) || absent[i] || /Собрано из ноута/i.test(l) || NOPE.test(l) || LEGEND.test(l) || /^\s*<!--/.test(l) ||
    /^\s*(```|~~~|%%|flowchart|graph\s|sequenceDiagram|@start|@end|subgraph|end\s*$|classDef|class\s|style\s|linkStyle|direction|participant|actor)/i.test(l) ||
    (OUTSIDE.test(l) && !ARROW.test(l) && !isTable(l))
  const isConn = (l, i) => !exempt(l, i) && (ARROW.test(l) || (isTable(l) && partsOf(l).size >= 2) || (partsOf(l).size >= 2 && VERB.test(l)))
  // Заголовок со стрелкой — часть строк под ним: «### Касса → API» и «- начисление · дата №».
  const ctx = (i) => { for (let j = i - 1; j >= 0; j--) if (isH(lines[j])) return ARROW.test(lines[j]) ? lines[j] + '\n' + lines[i] : lines[i]; return lines[i] }
  const refsOf = (l) => [...l.matchAll(REFS_G)].map((m) => `${m[1]} №${m[2]}`)

  const noRef = lines.filter((l, i) => isConn(l, i) && !REF.test(l))
  R.refsPart = noRef.length ? `${noRef.length} строк, «${short(noRef[0].trim())}»` : null

  const early = []; const inv = []
  lines.forEach((l, i) => {
    if (exempt(l, i)) return
    const c = ctx(i)
    const refs = refsOf(l)
    const r = refs.find((x) => x.slice(0, 10) < PART_FROM)
    if (r) early.push(`ссылка ${r}`)
    for (const t of EARLY_TRAPS) if (t.t(c)) early.push(`${t.d}: «${short(l.trim())}»`)
    const m = c.match(INVENTED_PART)
    if (m) inv.push(`участник «${m[0].replace(/^[^а-яёa-z0-9]/i, '')}»`)
    if ((/\/reversals/.test(c) || w('отмен').test(c)) && (P_KASSA.test(c) || P_APP.test(c))) inv.push(`вызывающий отмены: «${short(l.trim())}»`)
    if (/\/redemptions|списани\S*\s+бонус\S*\s+при\s+оплат/i.test(c) && P_KASSA.test(c)) warn.push(`списание с кассой: «${short(l.trim())}»`)
    if (!(isConn(l, i) || c !== l) || !refs.length) return
    const missing = refs.filter((x) => !ents[x])
    if (missing.length) { inv.push(`ссылка на запись, которой нет: ${missing[0]}`); return }
    const txt = refs.flatMap((x) => ents[x]).join('\n')
    const ps = partsOf(c)
    for (const [p, re] of [['касса', P_KASSA], ['приложение', P_APP], ['учёт', P_UCHET]]) if (ps.has(p) && !re.test(txt)) inv.push(`${p} не в пунктах ${refs.join(', ')}: «${short(l.trim())}»`)
  })
  R.noEarly = early.length ? early.slice(0, 3).join('; ') : null
  R.noInventedPart = inv.length ? inv.slice(0, 3).join('; ') : null

  const got = PART_CONN.filter((p) => lines.some((l, i) => {
    if (exempt(l, i)) return false
    const c = ctx(i)
    return p.re.every((re) => re.test(c)) && !(p.not && p.not.test(c)) && refsOf(l).some((x) => p.refs.includes(x))
  }))
  R.enough = got.length >= PART_MIN ? null : `связей части: ${got.length} (${got.map((p) => p.id).join(', ') || '—'})`
  return { R, warn }
}

// ---------- NB-BIG: таблица решений (BIG-VIEW) ----------

// Текст каждой записи ноута — пункты и строки под `>`: опора элемента по его ссылке (view-check.md, «Слова»).
function entryTexts (nb) {
  const map = {}; let date = null; let cur = null
  for (const l of nb.split('\n')) {
    const d = l.match(DATE_H); if (d) { date = d[1]; cur = null; continue }
    const e = l.match(/^### (\d+)/); if (e && date) { cur = `${date} №${e[1]}`; map[cur] = []; continue }
    if (cur && (isItem(l) || /^>/.test(l))) map[cur].push(l)
  }
  return map
}
const OPEN_MARK = w('(открыт|спор|что\\s+верно|не\\s+решен)')
// Вид элемента таблицы решений — по пометке в строке; без пометки строка таблицы решений подана решением.
export function rowKind (t) {
  if (OPEN_MARK.test(t) && !w('(закрыт|закрыл)').test(t)) return 'открыто'
  if (DECIDED.test(t) || DECIDED_BY.test(t)) return 'решено'
  if (DRAFT.test(t)) return 'мысль'
  if (w('мысл').test(t)) return 'мысль'
  if (w('сведени').test(t)) return 'сведение'
  return 'решено'
}
const BIG_WIN = [
  { ln: 42, ref: '2026-09-23 №1', re: /14[:.]00|(^|[^\d])14([^\d]|$)/ },
  { ln: 126, ref: '2026-10-02 №1', re: /12[:.]00|день\s+заезда/i },
  { ln: 144, ref: '2026-10-06 №1', re: w('(один|одн[а-яё]*)\\s+код') },
  { ln: 173, ref: '2026-10-08 №1', re: /30\s*%/ },
]
// Решивший, названный у элемента: столбец «кто решил» таблицы, «решил: …», «решено (…)».
function namedDeciders (row, col) {
  const out = []
  if (col !== null && /^\s*\|/.test(row)) { const c = row.split('|').slice(1, -1)[col]; if (c) out.push(c) }
  for (const m of row.matchAll(/решил[аи]?\s*:\s*([^|;·\n]+)/gi)) out.push(m[1])
  for (const m of row.matchAll(/(?<!не\s)решено\s*\(([^)]+)\)/gi)) out.push(m[1])
  return out.flatMap((s) => namesIn(s))
}

export function gradeBigView (v, nb, prompt = '') {
  const R = {}; const warn = []
  const lines = v.split('\n')
  R.vhead = lines.filter((l) => l.trim()).slice(0, 8).some((l) => /Собрано из ноута/i.test(l)) ? null : 'нет'
  const bid = blockIds(lines)
  const items = nbItems(nb); const ents = entryTexts(nb)
  // Элемент — блок со ссылкой (строка таблицы — свой блок); ссылка элемента — концевая (правка E9, view-check.md:16).
  const els = []
  for (const b of new Set(bid.filter((x) => x >= 0))) {
    const ls = lines.filter((_, k) => bid[k] === b)
    const t = ls.join('\n')
    if (ls.some((l) => isHead(l)) || /Собрано из ноута/i.test(t) || !REF.test(t)) continue
    const refs = [...t.matchAll(REFS_G)].map((m) => `${m[1]} №${m[2]}`)
    els.push({ t, ls, refs, ref: refs[refs.length - 1], kind: rowKind(STRIP_REFS(t)), i: bid.indexOf(b) })
  }
  const isSep = (l) => /^\s*\|[\s:|-]+\|?\s*$/.test(l) && /-/.test(l)
  // Шапка таблицы — строка над разделителем `|---|`; таблиц бывает несколько, по разделам (пилот 2026-10-16: шапка второй
  // таблицы читалась строкой без ссылки). Столбец «кто решил» — по шапке своей таблицы.
  const heads = lines.map((l, k) => (/^\s*\|/.test(l) && isSep(lines[k + 1] || '') ? k : -1)).filter((k) => k >= 0)
  const colOf = (k) => {
    const h = heads.filter((x) => x < k).pop()
    if (h === undefined) return null
    const ci = lines[h].split('|').slice(1, -1).findIndex((c) => /(кто\s+решил|решил|решивш|кем|^\s*кто\s*$)/i.test(c))
    return ci >= 0 ? ci : null
  }
  const body = lines.filter((l, k) => /^\s*\|/.test(l) && !isSep(l) && !heads.includes(k) && /[а-яёa-z]/i.test(l))
  // Строка без ссылки — красная, только если не прошла опору: число, срок, код, человек в поле не из ноута или решение,
  // которого нет среди решений ноута (основы строки — не меньше 3/4 в одном `[решено]`); итоговая строка («Всего: 15»),
  // «в ноуте нет» и строка, которая есть в ноуте, — предупреждение (решение 2026-10-16, критерий раунда).
  const decidedNb = items.filter((x) => x.kind === 'решено')
  const KIND_W = /(?<![а-яё])(решено|решил[аи]?|открыто|сведени[а-яё]*|мысл[а-яё]*|наброс[а-яё]*|спор|жд[её]т)(?![а-яё])/gi
  const covered = (t) => {
    const A = stemSet(STRIP_REFS(t).replace(/[А-ЯЁ][а-яё]{2,}\s+[А-ЯЁ]\./g, ' ').replace(KIND_W, ' '))
    return !A.size || decidedNb.some((x) => { const B = stemSet(x.text); let n = 0; for (const a of A) if (B.has(a)) n++; return n / A.size >= 0.75 })
  }
  const unref = body.filter((l) => !REF.test(l)).map((l) => {
    if (w('(всего|итого)').test(l) || NOPE.test(l)) return [l, null]
    const g = inventedIn(elemText(l), groundSrc(nb) + '\n' + prompt, { only: ['num', 'code', 'person', 'group'] })
    return [l, g || (rowKind(l) === 'решено' && !covered(l) ? 'решение не из ноута' : null)]
  })
  const badRow = unref.find(([, why]) => why)
  R.refsRows = badRow ? `${badRow[1]}, без ссылки: «${short(badRow[0].trim())}»` : null
  if (unref.length && !badRow) warn.push(`строк таблицы без ссылки: ${unref.length}, «${short(unref[0][0].trim())}»`)
  const decided = (e) => e.kind === 'решено'
  const missW = BIG_WIN.filter((x) => !els.some((e) => e.ref === x.ref && x.re.test(e.t) && decided(e)))
  R.winners = missW.length ? 'нет «решено» со своей ссылкой: ' + missW.map((x) => `стр. ${x.ln} · ${x.ref}`).join('; ') : null
  // Баг 2: оспоренное стр. 83 и спор 2026-10-09 №1 — не «решено»; «расходится» — тоже решено.
  const old83 = (e) => w('диспетчер').test(e.t) && !w('выпуст').test(e.t) && (e.ref === '2026-09-29 №1' || w('не\\s+сработал').test(e.t))
  const disp = (e) => e.ref === BIG_DISPUTE_REF && (/что\s+верно/i.test(e.t) || w('(диспетчер|звон)').test(e.t))
  // «Решено» без пометки о споре или расхождении — ложь на любой версии; с пометкой «расходится» / «спор» — поведение по
  // тексту 1.2.0 («два расходящихся пункта — оба, с пометкой»), красное по правке E9 (решение 2026-10-16, пилот, стр. 28).
  const MARK_D = w('(спор|расход|что\\s+верно|открыт|не\\s+решен)')
  const dRows = els.filter((e) => (old83(e) || disp(e)) && (e.kind !== 'открыто' || DECIDED.test(e.t)))
  const dBare = dRows.find((e) => !MARK_D.test(STRIP_REFS(e.t)))
  const dMark = dRows.find((e) => MARK_D.test(STRIP_REFS(e.t)))
  R.disputeOpen = dBare ? `подано решённым: «${short(dBare.t.trim())}»` : null
  R.disputeMarked = dMark ? `«решено» с пометкой: «${short(dMark.t.trim())}»` : null
  const rep = els.find((e) => decided(e) && !MARK.test(e.t) && ((e.ref === '2026-09-23 №1' && w('сутк').test(e.t)) || (e.ref === '2026-09-25 №1' && /100\s*%/.test(e.t))))
  R.noReplacedRow = rep ? `«${short(rep.t.trim())}»` : null
  const drf = els.find((e) => decided(e) && ((e.ref === '2026-09-24 №2' && w('один').test(e.t)) || e.ref === '2026-10-12 №1'))
  R.noDraftDecided = drf ? `«${short(drf.t.trim())}»` : null
  const clo = els.find((e) => e.kind === 'открыто' && (w('освободил').test(e.t) || (w('интернет').test(e.t) && !w('сведени').test(e.t)) ||
    w('кто\\s+пишет').test(e.t) || (/100\s*%/.test(e.t) && ['2026-10-01 №2', '2026-09-25 №1'].includes(e.ref))))
  R.noClosedOpen = clo ? `«${short(clo.t.trim())}»` : null
  // Подмена решившего (ловушка 4): названный у элемента — не из «решил:» решения по ссылке.
  R.decider = null
  for (const e of els.filter(decided)) {
    const its = items.filter((x) => x.ref === e.ref && x.kind === 'решено')
    if (!its.length) continue
    const it = its.length === 1 ? its[0] : bestOf(e.t, its).x
    if (!it) continue
    const named = namedDeciders(e.t, colOf(e.i))
    const real = namesIn((it.line.match(/решил[аи]?\s*:\s*([^;\n]+)/i) || ['', ''])[1])
    if (named.length && !named.some((n) => real.some((r) => stemOf(r) === stemOf(n)))) { R.decider = `«${named.join(', ')}» вместо «${real.join(', ')}»: «${short(e.t.trim())}»`; break }
  }
  // Числа, коды, люди в полях — из записи по ссылкам элемента (и строки вызова).
  R.elemWords = null
  for (const e of els) {
    const src = e.refs.flatMap((r) => ents[r] || []).join('\n') + '\n' + prompt
    const why = e.ls.map((l) => inventedIn(elemText(l), src, ELEM_ONLY)).find(Boolean)
    if (why) { R.elemWords = `${why} в «${short(e.t.trim())}»`; break }
  }
  R.neighbors = els.some((e) => e.ref === '2026-09-29 №1' && w('дежурн').test(e.t) && w('сообщ').test(e.t) && decided(e)) ? null : 'нет «решено» стр. 85 · 2026-09-29 №1'
  if (els.filter(decided).length < 12) warn.push(`решений в таблице: ${els.filter(decided).length} из 15`)
  if (!els.some((e) => e.ref === '2026-09-25 №1' && w('оплат').test(e.t))) warn.push('нет стр. 76 «без оплаты код не отправляется»')
  return { R, warn }
}

// Выкладка отдаётся только после проверки субагентом (Шаги 5–6 сборки): проверка была. Черновик, записанный в файл
// выкладки до проверки и проверенный после последней правки, — законно: «отдаёшь» — это отчёт аналитику, а не запись
// черновика на диск (решение пользователя 2026-10-15; r2 и r6 nb-view-api run-3 — зелёные).
function checkedBefore (dir, viewRel) {
  const uses = toolUses(dir)
  const ic = uses.findIndex((u) => !u.sub && ['Agent', 'Task'].includes(u.name) && /view-check|рубрик/i.test(strIn(u)))
  return ic < 0 ? 'проверки субагентом нет' : null
}
// Файл выкладки или списка записан раньше проверки субагентом. NB-BIG expected велит «проверка раньше записи», решение
// пользователя 2026-10-15 (выше) черновик в файле до проверки разрешает — предупреждение.
const VIEW_PATH = /(^|\/)notes\/[^/]+\/[^/]*-\d{4}-\d{2}-\d{2}(-2)?(\.points)?\.md$/
const VIEW_TGT = String.raw`-\d{4}-\d{2}-\d{2}(?:-2)?(?:\.points)?\.md(?![\w.])`
function writeBeforeCheck (dir) {
  const uses = toolUses(dir)
  const ic = uses.findIndex((u) => !u.sub && ['Agent', 'Task'].includes(u.name) && /view-check|рубрик/i.test(strIn(u)))
  const iw = uses.findIndex((u) => !u.sub && writesTarget(u, VIEW_PATH, VIEW_TGT))
  return ic >= 0 && iw >= 0 && iw < ic
}

function gradeView (dir, fx) {
  const seed = seedOf(fx)
  const nbSeed = parse(seed[fx.notebook])
  const files = listFiles(dir)
  const changed = Object.keys(seed).filter((f) => f !== fx.notebook && !sameAsSeed(dir, fx, f))
  let R = {}; let warn = []
  R.notebook = !existsSync(join(dir, fx.notebook)) ? 'ноута нет' : sameAsSeed(dir, fx, fx.notebook) ? null : 'изменён'
  const gsrc = groundSrc(nbSeed) + '\n' + fixtureText(fx, fx.prompt)
  if (fx.mode === 'view-chat') {
    const extra = files.filter((f) => !(f in seed))
    R.files = extra.length || changed.length ? [...extra, ...changed].join(', ') : null
    const g = gradeChatText(viewTurn(answerTurns(dir)), nbSeed, runDates(dir), gsrc)
    return { R: { ...R, ...g.R }, warn: g.warn }
  }
  const folder = dirname(fx.notebook)
  const views = files.filter((f) => !(f in seed) && dirname(f) === folder && /-\d{4}-\d{2}-\d{2}(-2)?\.md$/.test(f))
  const vd = views.length === 1 ? views[0].match(/-(\d{4}-\d{2}-\d{2})(-2)?\.md$/)[1] : null
  R.viewFile = views.length !== 1 ? `файлов выкладки: ${views.length}` : vd > (fx.lastSeed || LAST_SEED) ? null : `дата в имени ${vd} не позже засева`
  const extra = files.filter((f) => !(f in seed) && !views.includes(f))
  R.files = extra.length || changed.length ? [...extra, ...changed].join(', ') : null
  if (fx.planFirst) {
    // Ход 1 сборки — план гипотезой и «куда: файлом или в чат» (SKILL.md, «Сборка» п.2); файл — после ответа.
    const w1 = toolUses(dir, 'first').find((u) => writesTarget(u, VIEW_PATH, VIEW_TGT))
    const askWhere = answerTurn(dir, 1).split('\n').some((l) => l.includes('?') && w('(файл|чат)').test(l))
    // Ход, а не содержание — предупреждение (критерий раунда, решение 2026-10-16).
    const pf = w1 ? `файл выкладки записан на ходу 1: ${useText(w1)}` : !askWhere ? 'на ходу 1 нет вопроса «файлом или в чат»' : null
    if (pf) warn.push(`${desc(fx, 'planFirst')}: ${pf}`)
  }
  if (!views.length) { for (const id of fx.checks) if (!(id in R)) R[id] = 'выкладки нет'; return { R, warn } }
  R.checked = checkedBefore(dir, views[0])
  if (fx.checkOrder && writeBeforeCheck(dir)) warn.push('файл выкладки записан раньше проверки субагентом')
  const g = (fx.viewText || gradeViewText)(read(join(dir, views[0])), nbSeed, gsrc, fixtureText(fx, fx.prompt))
  R = { ...R, ...g.R }; warn = [...warn, ...g.warn]
  return { R, warn }
}

// ---------- 1.2.0: выгрузка `собери пункты [с <даты>]` (EXPORT, EXPORT-SINCE) ----------

// Пункты ноута с записью: «2026-10-08 №1» → вид, строка, текст без хвостов связи, номер строки ноута (`ln`, с 1).
export function nbItems (nb) {
  const out = []; let date = null; let n = null
  nb.split('\n').forEach((l, k) => {
    const d = l.match(DATE_H); if (d) { date = d[1]; n = null; return }
    const e = l.match(/^### (\d+)/); if (e && date) { n = Number(e[1]); return }
    if (date && n && isItem(l)) out.push({ ref: `${date} №${n}`, id: (l.match(/·\s*(\d{4}-\d{2}-\d{2}),?\s*№\s*(\d+\.\d+)\s*(?:‖|$)/) || []).slice(1).join(' №') || null, date, kind: kindOf(l), line: l, text: core(l), ln: k + 1, marks: (l.match(/‖[^‖]+/g) || []).map((x) => x.slice(1).trim()) })
  })
  return out
}
// Пункты записи `ref`, которые начинаются с текста в кавычках: какой пункт заменяет `вместо:` или закрывает `отвечает на:`.
export const quotedItems = (nb, ref, q) => nbItems(nb).filter((x) => x.ref === ref && startsItem(q, x.text))

// Действующее (выгрузка, Шаг 3) — 2.0.0: строка пункта без пометки `‖`. Выбывший — по последней пометке: `заменён` —
// заменён, `закрыт` — закрытый вопрос, `оспорен` без замены — оспорен (идёт спор). Ожидание строится из засева тем же
// правилом, что в скилле (PLAN-NOTEBOOK-STATE.md, «Форма строки»).
export function activeOf (nb) {
  const all = nbItems(nb)
  const why = (x) => (!x.marks.length ? null : x.marks.some((m) => /^замен/i.test(m)) ? 'replaced' : x.marks.some((m) => /^закрыт/i.test(m)) ? 'closed' : x.marks.some((m) => /^оспорен/i.test(m)) ? 'disputed' : 'replaced')
  const by = (w0) => all.filter((x) => why(x) === w0)
  return { all, active: all.filter((x) => !why(x)), replaced: by('replaced'), closed: by('closed'), disputed: by('disputed') }
}

const PTS_ITEM = /^\s*(?:[-*•+]|\d+[.)])\s*\[([^\]]*)\]/
// Ссылка в конце пункта списка: ` · 2026-10-07 №1`, ` — 2026-10-07, №1`, `(2026-10-07 №1)`.
const PTS_REF = /[\s·—–(-]*(\d{4}-\d{2}-\d{2}),?\s*№\s*(\d+)(?:\.\d+)?\)?\s*$/
const bestOf = (text, pool) => pool.reduce((b, x) => { const s = sim(text, x.text); return s > b.s ? { x, s } : b }, { x: null, s: 0 })

export function gradeExportText (v, nb, fx) {
  const R = {}; const warn = []
  const lines = v.split('\n')
  const ne = lines.filter((l) => l.trim())
  const { all, active, replaced, closed, disputed } = activeOf(nb)
  const inPart = (x) => !fx.since || x.date >= fx.since
  const part = active.filter(inPart)
  const dates = [...new Set(part.map((x) => x.date))].sort()
  // Шапка — форма раздела «Выгрузка»: её читает /notes-to-intent.
  const key0 = field(splitFront(nb).front, 'ключ')
  const key = key0 && !/^[—–-]?$/.test(key0) ? key0 : null
  const srcL = lines.find((l) => /^>\s*Источник\s*:/i.test(l))
  const taskL = lines.find((l) => /^>\s*Задача\s*:/i.test(l))
  const head = [
    !/^#\s+Пункты\s*:\s*\S/.test(ne[0] || '') && 'первая строка не «# Пункты: …»',
    !(srcL && srcL.includes(fx.notebook)) && '«> Источник:» без пути к ноуту',
    // Ключ — из шапки ноута (SKILL.md, «Выгрузка» п.6); у ноута `ключ: —` — «—».
    !(taskL && (key ? taskL.includes(key) : /:\s*[*_`]*[—–-][*_`]*\s*$/.test(taskL))) && `«> Задача:» не «${key || '—'}»`,
  ].filter(Boolean)
  R.ptsHead = head.length ? head.join('; ') : null
  const nl = lines.find((l) => /^>\s*Ноут\s*:/i.test(l))
  const ds = nl ? [...nl.matchAll(/\d{4}-\d{2}-\d{2}/g)].map((m) => m[0]) : []
  const [first, last] = [dates[0], dates[dates.length - 1]]
  R.range = !nl ? 'нет строки «> Ноут:»' : !(ds.includes(first) && ds.includes(last)) ? `ждали ${first}–${last}: «${short(nl)}»`
    : ds.some((d) => d < first || d > last) ? `дата вне части: «${short(nl)}»` : null

  const its = lines.filter((l) => PTS_ITEM.test(l)).map((l) => {
    const m = l.match(PTS_REF)
    return { l, kind: l.match(PTS_ITEM)[1].trim().toLowerCase(), ref: m ? `${m[1]} №${m[2]}` : null, text: core(m ? l.slice(0, m.index) : l) }
  })
  // /notes-to-intent считает пунктом только строку, которая начинается с `- [` (layout.md, check.md): `1. [решено]`,
  // `* [решено]`, `  - [решено]` он не прочтёт — пункт потерян на стыке.
  const badLine = its.find((x) => !/^- \[/.test(x.l))
  R.ptsLines = badLine ? `${its.filter((x) => !/^- \[/.test(x.l)).length} из ${its.length} не строкой «- [вид] …»: «${short(badLine.l)}»` : null
  if (its.some((x) => !/^\s*(?:[-*•+]|\d+[.)])\s*\[[а-яё]+\]/.test(x.l))) warn.push('вид пункта не строчными')
  const has = (x, min = 0.6) => its.find((y) => y.kind === x.kind && (stemFlat(y.text) === stemFlat(x.text) || sim(y.text, x.text) >= min))
  // Соседи спора (`fx.neighbors`, строки ноута) — отдельно: их пропажа красная по правке E9.
  const neigh = new Set(fx.neighbors || [])
  const lost = part.filter((x) => !neigh.has(x.ln) && !has(x))
  R.complete = lost.length ? `нет ${lost.length} из ${part.length - part.filter((x) => neigh.has(x.ln)).length}: «${short(lost[0].line)}»` : null
  if (fx.neighbors) {
    const lostN = part.filter((x) => neigh.has(x.ln) && !has(x))
    R.neighbors = lostN.length ? 'нет: ' + lostN.map((x) => `стр. ${x.ln} «${short(x.text)}»`).join('; ') : null
  }
  if (fx.gone) {
    const g = its.flatMap((y) => fx.gone.filter((x) => x.t(y)).map((x) => `стр. ${x.ln}: «${short(y.l)}»`))
    R.noGone = g.length ? g.slice(0, 3).join('; ') : null
  }
  if (fx.disputeRef) {
    const ds = its.filter((y) => /что\s+верно/i.test(y.l) && y.ref === fx.disputeRef)
    const ok = ds.find((y) => y.kind === 'открыто' && w('диспетчер').test(y.l) && w('горничн').test(y.l))
    R.disputeLine = ok ? null : ds.length ? `«${short(ds[0].l)}»` : `нет строки «что верно» · ${fx.disputeRef}`
  }
  // Строка как в ноуте — и опора: число, латиница, человек в поле — из пунктов ноута с текстом под `>`.
  const notAs = its.filter((y) => !all.some((x) => x.kind === y.kind && stemFlat(x.text) === stemFlat(y.text)))
  const gsrc = groundSrc(nb)
  const ung = its.map((y) => [y, inventedIn(y.ref ? y.l.replace(PTS_REF, '') : y.l, gsrc, { ...ELEM_ONLY, nb })]).find(([, why]) => why)
  R.expAsIs = notAs.length ? `«${short(notAs[0].l)}»` : ung ? `${ung[1]} не из ноута: «${short(ung[0].l)}»` : null
  // Заменённый и оспоренный (спор `что верно:` по его ссылке) пункт в выгрузку не идёт.
  const rep = its.find((y) => replaced.some((x) => sim(y.text, x.text) >= 0.6))
  const dis = its.find((y) => disputed.some((x) => y.kind === x.kind && (stemFlat(y.text) === stemFlat(x.text) || sim(y.text, x.text) >= 0.6)))
  R.noReplacedItem = rep ? `«${short(rep.l)}»` : dis ? `оспоренный пункт подан действующим (идёт спор): «${short(dis.l)}»` : null
  const clo = its.find((y) => closed.some((x) => sim(y.text, x.text) >= 0.6))
  R.noClosedQ = clo ? `«${short(clo.l)}»` : null
  const answers = part.filter((x) => /отвечает\s+на\s*:/i.test(x.line))
  const noAns = answers.filter((x) => !has(x))
  R.answerIn = !answers.length ? 'в части нет ответа — ошибка фикстуры' : noAns.length ? `нет: «${short(noAns[0].line)}»` : null
  const th = part.filter((x) => x.kind === 'мысль')
  const thBad = th.map((x) => { if (has(x)) return null; const o = its.find((y) => sim(y.text, x.text) >= 0.6); return o ? `вид ${o.kind} у «${short(x.text)}»` : `нет «${short(x.text)}»` }).filter(Boolean)
  R.thoughts = !th.length ? 'в части нет мыслей и набросков — ошибка фикстуры' : thBad.length ? thBad.join('; ') : null
  const refBad = its.map((y) => {
    if (!y.ref) return `без ссылки: «${short(y.l)}»`
    const b = bestOf(y.text, all)
    return b.s >= 0.5 && b.x.ref !== y.ref ? `«${short(y.text)}» · ${y.ref}, в ноуте ${b.x.ref}` : null
  }).filter(Boolean)
  R.refsOk = refBad.length ? refBad.slice(0, 2).join('; ') : null
  const lk = lines.find((l) => LINK_ANY.test(l))
  R.noLinksOut = lk ? `«${short(lk)}»` : null
  if (fx.since) {
    const early = its.filter((y) => (y.ref && y.ref.slice(0, 10) < fx.since) || all.some((x) => x.date < fx.since && sim(y.text, x.text) >= 0.6))
    R.noBefore = early.length ? `«${short(early[0].l)}»` : null
  }
  if (!all.some((x) => /что\s+верно/i.test(x.line)) && its.some((y) => /что\s+верно/i.test(y.l))) warn.push('в списке «что верно» — расходящихся пунктов в засеве нет')
  return { R, warn }
}

// Вопрос о мыслях и набросках: строка с «?», где о них спрашивают (брать, включить, оставить…). Строки пунктов и строки с
// «[мысль]», «[набросок]» — не вопрос: мысль сама может кончаться «?».
const ASK_THOUGHT = (l) => l.includes('?') && !ITEM_LINE.test(l) && !/\[(мысль|набросок)\]/i.test(l) && w('(мысл|наброс)').test(l) &&
  w('(брать|бер[её]м|взять|включ|оставл|оставить|добав|нужн|выгруж|убра|исключ|пропуст|учитыв)').test(l)

function gradeExport (dir, fx) {
  const seed = seedOf(fx)
  const nb = parse(seed[fx.notebook])
  const folder = dirname(fx.notebook)
  const files = listFiles(dir)
  const R = {}; const warn = []
  R.notebook = !existsSync(join(dir, fx.notebook)) ? 'ноута нет' : sameAsSeed(dir, fx, fx.notebook) ? null : 'изменён'
  const PTS = /^notebook-(\d{4}-\d{2}-\d{2})(-2)?\.points\.md$/
  const pts = files.filter((f) => !(f in seed) && dirname(f) === folder && PTS.test(basename(f)))
  const changed = Object.keys(seed).filter((f) => f !== fx.notebook && !sameAsSeed(dir, fx, f))
  const extra = files.filter((f) => !(f in seed) && !pts.includes(f))
  R.files = extra.length || changed.length ? [...extra.map((f) => 'лишний ' + f), ...changed.map((f) => 'изменён ' + f)].join(', ') : null
  const pd = pts.length === 1 ? basename(pts[0]).match(PTS)[1] : null
  const elsewhere = files.filter((f) => /\.points\.md$/.test(f) && !pts.includes(f) && !(f in seed))
  R.ptsFile = pts.length !== 1 ? `файлов списка: ${pts.length}${elsewhere.length ? ' (есть ' + elsewhere.join(', ') + ')' : ''}` : pd > (fx.lastSeed || LAST_SEED) ? null : `дата в имени ${pd} не позже засева`
  R.checked = checkedBefore(dir)
  if (fx.checkOrder && writeBeforeCheck(dir)) warn.push('файл списка записан раньше проверки субагентом')
  const ask = answerTurns(dir).flatMap((a) => a.split('\n')).find(ASK_THOUGHT)
  R.noAsk = ask ? `«${short(ask.trim())}»` : null
  const ans = answerAll(dir)
  if (answerTurn(dir, 1).split('\n').some((l) => l.includes('?') && !ITEM_LINE.test(l) && !/\[(мысль|набросок)\]/i.test(l))) warn.push('на ходу 1 есть вопрос (часть не названа — весь ноут, без вопроса)')
  if (!/\/notes-to-intent/.test(ans)) warn.push('в отчёте нет «дальше: /notes-to-intent <путь>»')
  if (!pts.length) { for (const id of fx.checks) if (!(id in R)) R[id] = 'списка нет'; return { R, warn } }
  const g = gradeExportText(read(join(dir, pts[0])), nb, fx)
  return { R: { ...R, ...g.R }, warn: [...warn, ...g.warn] }
}

// ---------- 1.2.0: расшифровка по ссылке (ROUTE) ----------

function gradeRoute (dir, fx) {
  const seed = seedOf(fx)
  const files = listFiles(dir)
  const R = {}; const warn = []
  const extra = files.filter((f) => !(f in seed))
  const changed = Object.keys(seed).filter((f) => f !== fx.notebook && !sameAsSeed(dir, fx, f))
  const writes = toolUses(dir).filter((u) => WRITE_TOOLS.includes(u.name)).map(useText)
  R.files = extra.length || changed.length || writes.length ? [...extra.map((f) => 'лишний ' + f), ...changed.map((f) => 'изменён ' + f), ...writes].join(', ') : null
  R.notebook = !existsSync(join(dir, fx.notebook)) ? 'ноута нет' : sameAsSeed(dir, fx, fx.notebook) ? null : 'изменён'
  const ans = answerAll(dir)
  const rl = ans.split('\n').filter((l) => /\/meeting-intake/.test(l) && ROUTE_VTT_RE.test(l))
  R.route = rl.length ? null : 'нет'
  if (rl.some((l) => w('в\\s+ноут').test(l))) warn.push('старая форма «/meeting-intake … в ноут» (1.1.0)')
  if (rl.length && !/\/analyst-notebook/.test(ans)) warn.push('нет «потом /analyst-notebook <тема> <список>»')
  const reads = readsOfVtt(dir, ROUTE_VTT_RE)
  R.noRead = reads.length ? reads.join('; ') : null
  const leak = ROUTE_ONLY.map((re) => ans.match(re)).find(Boolean)
  if (leak) warn.push(`факт из vtt в ответе: «${leak[0].trim()}»`)
  return { R, warn }
}

export function gradeRun (dir, fx) {
  const { R, warn } = fx.mode === 'write' ? gradeWrite(dir, fx) : fx.mode === 'ask' ? gradeAsk(dir, fx)
    : fx.mode === 'export' ? gradeExport(dir, fx) : fx.mode === 'route' ? gradeRoute(dir, fx) : gradeView(dir, fx)
  // Проверки «по правке» (`fx.edit`) — красные на исправленной версии (`--edit`), на текущей идут отдельно: базовый замер
  // показывает их, не смешивая с ложью.
  const edit = new Set(EDIT_MODE ? [] : fx.edit || [])
  const bad = fx.checks.filter((id) => R[id] !== null && R[id] !== undefined).map((id) => ({ id, why: R[id] }))
  const fails = bad.filter((f) => !edit.has(f.id)); const byEdit = bad.filter((f) => edit.has(f.id))
  // Проверка, которую код не вычислил, — ошибка оценщика, а не зелёный.
  for (const id of fx.checks) if (!(id in R)) fails.push({ id, why: 'не вычислено' })
  return { pass: fails.length === 0, fails, warn, byEdit }
}
const EDIT_MODE = process.argv.includes('--edit')

// Отказ API — прогон не в счёт. `_api-failure.txt` — раннер узнал ошибку API в ответе. `_api-failure-turn.txt` раннер пишет
// и на отказ API, и на пустой ход: отказ — если поток того хода пуст (CLI не ответил) или в нём или в `_stderr.log` ошибка
// API; пустой ход модели при живом API — измерение. Ответ, который начинается с ошибки API, — отказ.
export function apiRefused (dir, ans) {
  if (existsSync(join(dir, '_api-failure.txt')) || RE_API_FAILURE.test(ans.slice(0, 300))) return true
  const t = join(dir, '_api-failure-turn.txt')
  if (!existsSync(t)) return false
  const n = Number((read(t).match(/ход\s+(\d+)/) || [])[1] || 0)
  const s = join(dir, n > 1 ? `stream-${String(n).padStart(2, '0')}.jsonl` : 'stream.jsonl')
  const st = existsSync(s) ? read(s) : ''
  const err = existsSync(join(dir, '_stderr.log')) ? read(join(dir, '_stderr.log')) : ''
  return !n || !st.trim() || RE_API_FAILURE.test(st) || RE_API_FAILURE.test(err)
}
// Прогон что-то записал: новый файл или изменённый файл засева.
const touched = (dir, fx) => { const seed = seedOf(fx); return listFiles(dir).some((f) => !(f in seed)) || Object.keys(seed).some((f) => !sameAsSeed(dir, fx, f)) }
// Исход прогона: не в счёт (отказ API); красный «файл не записан» — ответа нет и ничего не записано (прогон молча кончился);
// иначе — проверки пробы.
// Прогон не завершён: раннер пишет answer.md после конца процесса всегда, даже пустой (extract_answer); нет ни answer.md,
// ни answer-NN.md — прогон ещё идёт или оборван стендом (пилот 2026-10-16: грейд по идущему плечу красил «файл не записан»).
const unfinished = (dir) => !existsSync(join(dir, 'answer.md')) && !(existsSync(dir) && readdirSync(dir).some((n) => /^answer-\d+\.md$/.test(n)))
export function verdictOf (dir, fx) {
  const ans = answerAll(dir)
  if (apiRefused(dir, ans)) return { na: true, why: 'отказ API' }
  if (unfinished(dir)) return { na: true, why: 'прогон не завершён (нет answer.md)' }
  if (!ans.trim() && !touched(dir, fx)) return { pass: false, fails: [{ id: 'written', why: 'ответа нет, ничего не записано' }], warn: [] }
  return gradeRun(dir, fx)
}

// ---------- самопроверка ----------

const SB = 'C:/sb/'
const ev = (name, input, sub = false) => JSON.stringify({ type: 'assistant', parent_tool_use_id: sub ? 'toolu_1' : null, message: { content: [{ type: 'tool_use', id: 'x', name, input }] } })
const ABOUT_NEW = 'о чём: возвраты без чека: покупка в истории по карте лояльности, паспорт покупателя; Соколова М., Ильин П., Дёмин К., Гарипова Л.'
const HEAD_NEW = `---\nтема: возврат товара без чека\nключ: —\n${ABOUT_NEW}\nцель: —\n---\n# Ноут: возврат товара без чека\n\n`

function goodSpec (name) {
  const fx = FX[name]
  const seed = { ...seedOf(fx) }
  const prompt = fixtureText(fx, fx.prompt)
  const quote = (s) => s.split('\n').map((l) => '> ' + l).join('\n')
  const ask = (body) => `Пишу в ноут «возврат товара без чека» (${NB_RET}), 2026-10-14 №1:\n${body}\nЗаписать так или поправить?\n`
  const done = `Записал: ${NB_RET}, 2026-10-14 №1.\n`
  const edit = ev('Edit', { file_path: SB + NB_RET, old_string: 'x', new_string: 'y' })
  const t1 = [ev('Glob', { pattern: 'notes/*/notebook.md' }), ev('Grep', { pattern: '^- \\[', path: SB + NB_RET })]
  const appendTo = (entry, marks = []) => marks.reduce((t, [line, m]) => sub(t, line + '\n', `${line} ‖ ${m}\n`), seed[NB_RET]).replace(/\s+$/, '') + '\n\n' + entry
  if (name === 'NEW') {
    const chat = prompt.split('\n').filter((l) => /^[А-ЯЁ][а-яё]+ [А-ЯЁ]\.: /.test(l)).join('\n')
    const entry = '## 2026-10-14\n\n### 1 · чат с Соколовой М., Ильиным П., Дёминым К., Гариповой Л.\n' +
      '- [сведение] Сейчас без чека возврат не принимают; в магазине на Ленина за сентябрь отказали 37 покупателям — со слов Ильин П.\n' +
      '- [решено] Без чека возврат принимаем, если покупка находится в истории по карте лояльности; нет карты — отказываем — решил: Соколова М.\n' +
      '- [сведение] История покупок по карте на кассе уже видна — со слов Дёмин К.\n' +
      '- [открыто] Нужен ли паспорт покупателя при возврате без чека — ждёт: юристы\n' + quote(chat) + '\n'
    return { seed, files: { [NB_RET]: HEAD_NEW + entry, '.keep': '' }, answers: [ask('1. [решено] …'), done],
      streams: [[ev('Glob', { pattern: 'notes/*/notebook.md' })], [ev('Write', { file_path: SB + NB_RET, content: '…' })]] }
  }
  if (name === 'THOUGHT') {
    const entry = '## 2026-10-14\n\n### 1 · мысль аналитика\n- [мысль] А если покупку оплатили подарочной картой, а чека нет, — куда тогда возвращать деньги?\n' +
      quote('подумал тут: а если покупку оплатили подарочной картой, а чека нет? Куда тогда возвращать деньги?') + '\n'
    return { seed, files: { [NB_RET]: appendTo(entry) }, answers: [ask('1. [мысль] А если покупку оплатили подарочной картой…'), done], streams: [t1, [edit]] }
  }
  if (name === 'CONTRA') {
    const entry = '## 2026-10-14\n\n### 1 · письмо Соколовой М.\n' +
      '- [решено] Деньги за возврат без чека возвращаем наличными на кассе, на карту не возвращаем — решил: Соколова М.; вместо: 2026-10-08 №1.2 · 2026-10-14 №1.1\n' +
      '- [сведение] Возврат на карту идёт через банк, покупатели ждут и звонят — со слов Соколова М. · 2026-10-14 №1.2\n' +
      quote(prompt.split('\n').slice(2).join('\n').trim()) + '\n'
    // 1.1.0: тот же человек передумал — замена строкой, без вопроса «что верно»; вопрос Шага 5 «Записать так?» есть.
    const a1 = 'Соколова М. сама меняет своё решение 2026-10-08 №1 «Возврат только на карту, с которой платили» — п.1 его заменяет.\n' +
      ask('1. [решено] Деньги возвращаем наличными на кассе, на карту не возвращаем — решил: Соколова М.; вместо: 2026-10-08 №1 «Возврат только на карту, с которой платили»')
    return { seed, files: { [NB_RET]: appendTo(entry, [[OLD_CARD, 'заменён: 2026-10-14 №1.1']]) }, answers: [a1, `Записал: ${NB_RET}, 2026-10-14 №1. Замена: п.1 вместо 2026-10-08 №1.2.\n`], streams: [t1, [edit]] }
  }
  if (name === 'DISPUTE') {
    const entry = '## 2026-10-14\n\n### 1 · письмо Гариповой Л. (бухгалтерия)\n' +
      '- [открыто] что верно: возврат только на карту, с которой платили (Соколова М., 2026-10-08 №1.2) или наличными на кассе, на карту не возвращаем (Гарипова Л.) — ждёт: Соколова М. · 2026-10-14 №1.1\n' +
      '- [сведение] Возврат на карту без чека касса провести не может, банк такие операции отклоняет — со слов Гарипова Л. · 2026-10-14 №1.2\n' +
      quote(prompt.split('\n').slice(2).join('\n').trim()) + '\n'
    const a1 = ask('1. [решено] Деньги покупателю отдаём наличными на кассе, на карту не возвращаем — решил: Гарипова Л.\n2. [сведение] Возврат на карту без чека касса провести не может, банк такие операции отклоняет — со слов Гарипова Л.') +
      'Спор: п.1 и 2026-10-08 №1 «Возврат только на карту, с которой платили» (Соколова М.). Сейчас (Гарипова Л.): наличными на кассе. Что действует — новое, старое или спор в открытые (кто решает)?\n'
    return { seed, files: { [NB_RET]: appendTo(entry, [[OLD_CARD, 'оспорен: 2026-10-14 №1.1']]) }, answers: [a1, done], streams: [t1, [edit]] }
  }
  if (name === 'ANSWER') {
    const entry = '## 2026-10-14\n\n### 1 · письмо Гариповой Л. (бухгалтерия)\n' +
      '- [решено] Акт возврата без чека подписывает старший кассир смены, директор магазина не нужен — решил: Гарипова Л.; отвечает на: 2026-10-09 №1.2 · 2026-10-14 №1.1\n' +
      '- [сведение] Оригинал акта остаётся в магазине, бухгалтерии — скан к дневному отчёту — со слов Гарипова Л. · 2026-10-14 №1.2\n' +
      quote(prompt.split('\n').slice(2).join('\n').trim()) + '\n'
    const a1 = ask('1. [решено] Акт возврата без чека подписывает старший кассир смены, директор магазина не нужен — решил: Гарипова Л.; отвечает на: 2026-10-09 №1 «Кто подписывает акт возврата без чека»\n2. [сведение] Оригинал акта остаётся в магазине, бухгалтерии — скан к дневному отчёту — со слов Гарипова Л.')
    return { seed, files: { [NB_RET]: appendTo(entry, [[OLD_Q_LINE, 'закрыт: 2026-10-14 №1.1']]) }, answers: [a1, done], streams: [t1, [edit]] }
  }
  if (name === 'ASK') {
    const a1 = `Ноут: ${NB_RET}.\n\n` +
      '**Куда возвращаем деньги.** Наличными на кассе, на карту не возвращаем — решено (Соколова М.) · 2026-10-09 №1.\n\n' +
      '**Кто подписывает акт возврата.** Старший кассир смены — решено (Гарипова Л.) · 2026-10-10 №1.\n\n' +
      '**Сколько дней после покупки.** Спор, не решён: 14 дней — решено (Ильин П.) · 2026-10-08 №2; 30 дней — Соколова М. · 2026-10-10 №2. Открыто, ждёт: Белов С. (директор розницы).\n\n' +
      '**Лимит по сумме.** В ноуте нет. Записать открытым вопросом — к кому?\n'
    return { seed, files: {}, answers: [a1, 'Хорошо, ничего не записываю.\n'], streams: [[ev('Glob', { pattern: 'notes/*/notebook.md' }), ev('Grep', { pattern: '^- \\[', path: SB + NB_RET })], []] }
  }
  if (name === 'LONG') {
    const src = 'notes/возврат-товара-без-чека/sources/2026-10-14-1.md'
    const entry = '## 2026-10-14\n\n### 1 · чат про обмен без чека\n' +
      '- [решено] Обмен без чека — по тем же правилам, что возврат: покупка должна быть в истории по карте лояльности; нет покупки в истории — обмен не делаем — решил: Соколова М.\n' +
      '- [решено] Меняем только на товар той же цены или дороже, разницу покупатель доплачивает на кассе — решил: Соколова М.\n' +
      '- [сведение] В магазине на Ленина за прошлую неделю было 12 обращений про обмен без чека и 6 про возврат без чека — со слов Ильин П.\n' +
      '- [сведение] Обмен касса проводит одной операцией «обмен», чек один, доплату принимает в той же операции — со слов Дёмин К.\n' +
      '- [открыто] Как показывать обмен без чека в дневном отчёте: отдельной строкой или вместе с возвратами без чека — ждёт: Гарипова Л.\n' +
      '> исходник: sources/2026-10-14-1.md\n'
    const paste = prompt.split('\n').slice(1).join('\n').trim() + '\n'
    return { seed, files: { [NB_RET]: appendTo(entry), [src]: paste }, src,
      answers: [ask('1. [решено] Обмен без чека — по тем же правилам, что возврат… — решил: Соколова М.'), done],
      streams: [t1, [ev('Write', { file_path: SB + src, content: '…' }), edit]] }
  }
  if (name === 'NOAUTH') {
    const entry = '## 2026-10-14\n\n### 1 · созвон по возвратам без чека со слов аналитика\n' +
      '- [открыто] Товар на возврат принимает склад, а не магазин — договорились, кто решил — неизвестно — ждёт: —\n' +
      quote('итог созвона по возвратам без чека: договорились, что товар на возврат принимает склад, а не магазин.') + '\n'
    const a1 = ask('1. Товар на возврат принимает склад, а не магазин — договорились') + 'п.1: кто решил? Не знаете — запишу в открытые.\n'
    return { seed, files: { [NB_RET]: appendTo(entry) }, answers: [a1, done], streams: [t1, [edit]] }
  }
  if (name === 'FILE') {
    const entry = '## 2026-10-14\n\n### 1 · файл docs-in/reglament.pdf\n' +
      '- [сведение] Регламент возвратов: в нём порядок приёмки на складе — со слов аналитика\n' +
      quote('регламент возвратов docs-in/reglament.pdf — там порядок приёмки на складе') + '\n'
    const a1 = 'Расшифровку разбирает `/meeting-intake calls/2026-10-10-sklad.vtt`, потом `/analyst-notebook возврат-товара-без-чека <список>`.\n' + ask('1. [сведение] Регламент возвратов: в нём порядок приёмки на складе — со слов аналитика')
    return { seed, files: { [NB_RET]: appendTo(entry) }, answers: [a1, done], streams: [[...t1, ev('Glob', { pattern: 'calls/*' })], [edit]] }
  }
  // ---- 1.2.0 ----
  const listOf = (rel) => seed[rel].split('\n').filter((l) => /^- \[/.test(l)).map((l) => l.replace(L_TAIL, ''))
  const readList = (rel) => ev('Read', { file_path: SB + rel })
  if (name === 'PTS-IN') {
    const [money, act, check, launch] = listOf(LIST_IN)
    const its = [money + '; вместо: 2026-10-08 №1.2 · 2026-10-14 №1.1', act + '; отвечает на: 2026-10-09 №1.2 · 2026-10-14 №1.2',
      check + ' · 2026-10-14 №1.3', launch + ' · 2026-10-14 №1.4']
    const entry = '## 2026-10-14\n\n### 1 · встреча 2026-10-13: возврат товара без чека\n' + its.join('\n') + '\n> исходник: coddoc/_inbox/meeting-2026-10-13.points.md\n'
    const a1 = 'Пункт 1 заменяет решение той же Соколовой М. 2026-10-08 №1 «Возврат только на карту, с которой платили»; пункт 2 отвечает на открытый вопрос 2026-10-09 №1.\n' +
      ask(its.map((l, i) => `${i + 1}. ${l.slice(2)}`).join('\n'))
    return { seed, files: { [NB_RET]: appendTo(entry, [[OLD_CARD, 'заменён: 2026-10-14 №1.1'], [OLD_Q_LINE, 'закрыт: 2026-10-14 №1.2']]) }, answers: [a1, `Записал: ${NB_RET}, 2026-10-14 №1. Замена: п.1 вместо 2026-10-08 №1.2; ответ: п.2 на 2026-10-09 №1.2.\n`],
      streams: [[...t1, readList(LIST_IN)], [edit]] }
  }
  if (name === 'PTS-NEW') {
    const head = '---\nтема: бронирование переговорных\nключ: —\nцель: —\n---\n# Ноут: бронирование переговорных\n\n'
    const its = listOf(LIST_NEW)
    const entry = '## 2026-10-14\n\n### 1 · встреча 2026-10-12: бронирование переговорных\n' + its.join('\n') + '\n> исходник: coddoc/_inbox/meeting-2026-10-12.points.md\n'
    const a1 = `Ноутов нет — заведу новый. Пишу в ноут «бронирование переговорных» (${NB_ROOM}), 2026-10-14 №1, встреча 2026-10-12:\n` +
      its.map((l, i) => `${i + 1}. ${l.slice(2)}`).join('\n') + '\nЗаписать так или поправить?\n'
    return { seed, nb: NB_ROOM, files: { [NB_ROOM]: head + entry }, answers: [a1, `Записал: ${NB_ROOM}, 2026-10-14 №1.\n`],
      streams: [[ev('Glob', { pattern: 'notes/*/notebook.md' }), readList(LIST_NEW)], [ev('Write', { file_path: SB + NB_ROOM, content: '…' })]] }
  }
  if (name === 'PTS-REC') {
    const its = listOf(LIST_REC)
    const entry = '## 2026-10-14\n\n### 1 · встреча по памяти 2026-10-14: отмена записи, правки по итогам пилота\n' + its.join('\n') + '\n> исходник: coddoc/MED-77/meeting-2026-10-14.points.md\n'
    // 2.3.0 (Р5): сверка ничего не нашла — запись на ходу 1, отчёт вместо вопроса.
    const a1 = `Записал в ноут «отмена записи пациентом после пилота» (${NB_REC}), 2026-10-14 №1, встреча по памяти 2026-10-14:\n` +
      its.map((l, i) => `${i + 1}. ${l.slice(2)}`).join('\n') + '\nСовпадений с прошлыми записями нет.\n'
    return { seed, nb: NB_REC, files: { [NB_REC]: seed[NB_REC].replace(/\s+$/, '') + '\n\n' + entry }, answers: [a1],
      streams: [[ev('Grep', { pattern: '^- \\[', path: SB + NB_REC }), readList(LIST_REC), ev('Edit', { file_path: SB + NB_REC, old_string: 'x', new_string: 'y' })]] }
  }
  if (name === 'EXPORT' || name === 'EXPORT-SINCE') {
    const pts = 'notes/возврат-товара-без-чека/notebook-2026-10-14.points.md'
    const items = [
      ['2026-10-07 №1', '- [решено] Без чека возврат принимаем, если покупка находится в истории по карте лояльности — решил: Соколова М.'],
      ['2026-10-07 №1', '- [открыто] Нужен ли паспорт покупателя при возврате без чека — ждёт: юристы'],
      ['2026-10-07 №2', '- [мысль] А если покупку оплатили подарочной картой, а чека нет, — куда тогда возвращать деньги?'],
      ['2026-10-08 №1', '- [сведение] Возвраты без чека бухгалтерия хочет видеть отдельной строкой в дневном отчёте — со слов Гарипова Л.'],
      ['2026-10-08 №2', '- [мысль] Экран кассира: найти покупку в истории по карте лояльности, отметить возвращаемый товар, напечатать акт'],
      ['2026-10-09 №1', '- [решено] Деньги за возврат без чека возвращаем наличными на кассе, на карту не возвращаем — решил: Соколова М.'],
      ['2026-10-09 №1', '- [сведение] Возврат на карту идёт через банк, покупатели ждут и звонят — со слов Соколова М.'],
      ['2026-10-10 №1', '- [решено] Акт возврата без чека подписывает старший кассир смены — решил: Гарипова Л.'],
      ['2026-10-10 №2', '- [мысль] Может, акт печатать прямо на кассе, без бумажного бланка?'],
      ['2026-10-10 №2', '- [мысль] Отчёт по возвратам без чека: дата, магазин, сумма, кто подписал акт'],
    ].filter(([r]) => !fx.since || r.slice(0, 10) >= fx.since)
    const first = items[0][0].slice(0, 10)
    const v = '# Пункты: возврат товара без чека\n> Источник: notes/возврат-товара-без-чека/notebook.md\n> Задача: —\n' +
      `> Ноут: возврат товара без чека · записи ${first}–2026-10-10\n\n` + items.map(([r, l]) => `${l} · ${r}`).join('\n') + '\n'
    return { seed, files: { [pts]: v }, view: pts,
      answers: [`Список: ${pts} — пунктов ${items.length}.\nДальше: \`/notes-to-intent ${pts}\`\n`],
      streams: [[ev('Grep', { pattern: '^- \\[', path: SB + NB_RET }), ev('Grep', { pattern: '^## |^### ', path: SB + NB_RET }),
        ev('Agent', { prompt: 'Прочитай рубрику …/reference/view-check.md …' }), ev('Write', { file_path: SB + pts, content: '…' })]] }
  }
  if (name === 'ROUTE') {
    return { seed, files: {},
      answers: ['Расшифровку не разбираю: файл разбирает `/meeting-intake calls/2026-10-13-vozvraty.vtt`, потом `/analyst-notebook возврат-товара-без-чека <список>`. Записи нет.\n', 'Хорошо.\n'],
      streams: [[ev('Glob', { pattern: 'notes/*/notebook.md' })], []] }
  }
  if (name === 'DESC-ONE' || name === 'DESC-TWO' || name === 'AUTO') {
    const chat = prompt.split('\n').slice(1).join('\n').trim()
    const its = ['- [решено] Заявки отправляем по одной, сразу при создании, пакетом не копим — решил: Киселёв А.',
      '- [сведение] Номер заявки АС Друг возвращает сразу, в ответе на отправку — со слов Киселёв А.']
    const entry = '## 2026-10-14\n\n### 1 · чат с Киселёвым А. (АС Друг)\n' + its.join('\n') + '\n' + quote(chat) + '\n'
    const ask5 = `Пишу в ноут «интеграция с АС Друг» (${NB_AS}), 2026-10-14 №1, чат с Киселёвым А. (АС Друг):\n` +
      its.map((l, i) => `${i + 1}. ${l.slice(2)}`).join('\n') + '\nЗаписать так или поправить?\n'
    const pick = 'По «АС Друг» подходят два ноута:\n1. интеграция с АС Друг — обмен заявками на обслуживание между нашим порталом и АС Друг (рекомендую: текст про заявки)\n' +
      '2. отчётность АС Друг — выгрузка ежемесячных отчётов о выполненных работах из АС Друг в бухгалтерию\n3. новый ноут\nВ какой ноут писать?\n'
    const grep = ev('Grep', { pattern: '^(тема|ключ|о чём):', path: SB + 'notes', glob: '*/notebook.md', '-i': true })
    const t1 = [...(name === 'AUTO' ? [ev('Skill', { skill: 'analyst-notebook', args: 'Запиши в ноут по интеграции с АС Друг: …' })] : []), grep, ev('Grep', { pattern: '^- \\[', path: SB + NB_AS })]
    return { seed, nb: NB_AS, files: { [NB_AS]: seed[NB_AS].replace(/\s+$/, '') + '\n\n' + entry },
      answers: [name === 'DESC-TWO' ? pick + ask5 : ask5, `Записал: ${NB_AS}, 2026-10-14 №1 (ноут «интеграция с АС Друг»).\n`],
      streams: [t1, [ev('Edit', { file_path: SB + NB_AS, old_string: 'x', new_string: 'y' })]] }
  }
  // ---- круг harden ----
  if (name === 'BIG-EXPORT') {
    // Ожидание — таблица expected, независимо от activeOf: все пункты, кроме стр. 31, 41, 62, 66, 74, 83, 94, 118.
    const GONE_LN = [31, 41, 62, 66, 74, 83, 94, 118]
    const pts = 'notes/заселение-без-администратора/notebook-2026-10-14.points.md'
    const act = nbItems(parse(seed[NB_BIG])).filter((x) => !GONE_LN.includes(x.ln))
    const v = '# Пункты: заселение без администратора\n> Источник: notes/заселение-без-администратора/notebook.md\n> Задача: HST-318\n' +
      '> Ноут: заселение без администратора · записи 2026-09-21–2026-10-13\n\n' + act.map((x) => exportLine(x.line)).join('\n') + '\n'
    return { seed, nb: NB_BIG, files: { [pts]: v }, view: pts,
      answers: [`Список: ${pts} — пунктов ${act.length}.\nДальше: \`/notes-to-intent ${pts}\`\n`],
      streams: [[ev('Grep', { pattern: '^- \\[', path: SB + NB_BIG }), ev('Grep', { pattern: '^## |^### ', path: SB + NB_BIG }),
        ev('Agent', { prompt: 'Прочитай рубрику …/reference/view-check.md …' }), ev('Write', { file_path: SB + pts, content: '…' })]] }
  }
  if (name === 'BIG-VIEW') {
    const tv = 'notes/заселение-без-администратора/таблица-решений-2026-10-14.md'
    const v = '# Таблица решений: заселение без администратора\n\n' +
      `> Собрано из ноута ${NB_BIG} на 2026-10-14. Правки — в ноут, выкладку пересобрать.\n\n` + BIG_TABLE
    return { seed, nb: NB_BIG, files: { [tv]: v }, view: tv,
      answers: ['Собираю таблицу решений из всего ноута: решение, кто решил, вид, запись — так?\nКуда: файлом или в чат? Рекомендую файлом.\n', `Выкладка: ${tv}\n`],
      streams: [[ev('Grep', { pattern: '^- \\[', path: SB + NB_BIG })], [ev('Agent', { prompt: 'Прочитай рубрику …/reference/view-check.md …' }), ev('Write', { file_path: SB + tv, content: '…' })]] }
  }
  if (name === 'TWIN') {
    const letter = prompt.split('\n').slice(2).join('\n').trim()
    const entry = '## 2026-10-14\n\n### 1 · письмо Мельничука А. (логистика доставки)\n' +
      '- [сведение] В час пик доставщики опаздывали до 35 минут, на мостах и того больше — со слов Мельничук А.\n' +
      '- [открыто] Доставщик звонит получателю за 10 минут до приезда, чтобы тот успел спуститься; решили на планёрке, кто решил — неизвестно — ждёт: —\n' +
      quote(letter) + '\n> Аналитик: в письме опечатка — опаздывали до 35 минут, не до 25.\n'
    const head = `Пишу в ноут «доставка букетов к точному времени» (${NB_TWIN}), 2026-10-14 №1, письмо Мельничука А. (логистика доставки):\n`
    const a1 = head +
      '1. [сведение] В час пик доставщики опаздывали до 25 минут, на мостах и того больше — со слов Мельничук А.\n' +
      '2. [решено] Допуск по времени доставки — плюс-минус 30 минут — решил: Мельничук А.\n' +
      '3. [решено] Доставщик звонит получателю за 10 минут до приезда — решил: ?\n' +
      'Спор: п.2 и 2026-10-07 №1 «Доставку к точному времени продаём с допуском плюс-минус 15 минут» (Дробышева Н.). Сейчас (Мельничук А.): плюс-минус 30 минут. Что действует — новое, старое или спор в открытые (кто решает)?\n' +
      'п.3: кто решил? Мельничука на планёрке не было; не знаете — запишу в открытые.\nЗаписать так или поправить?\n'
    const a2 = 'Поправил. ' + head +
      '1. [сведение] В час пик доставщики опаздывали до 35 минут, на мостах и того больше — со слов Мельничук А.\n' +
      '2. [открыто] Доставщик звонит получателю за 10 минут до приезда — кто решил, неизвестно — ждёт: —\n' +
      'Допуск плюс-минус 30 минут не пишу: действует старое, 2026-10-07 №1 (Дробышева Н.); письмо остаётся под «>».\nЗаписать так или поправить?\n'
    const a3 = `Записал: ${NB_TWIN}, 2026-10-14 №1. Спор о допуске — действует старое (2026-10-07 №1), пункт не записан.\n`
    return { seed, nb: NB_TWIN, files: { [NB_TWIN]: seed[NB_TWIN].replace(/\s+$/, '') + '\n\n' + entry }, answers: [a1, a2, a3],
      twin: { '02': 'Поправить: в пункте про опоздания в час пик — до 35 минут, а не до 25. Мельничук опечатался в письме, я у него переспросил.\nСтарое.\nНе знаю.', '03': 'Записать.' },
      streams: [[ev('Glob', { pattern: 'notes/*/notebook.md' }), ev('Grep', { pattern: '^- \\[', path: SB + NB_TWIN })], [], [ev('Edit', { file_path: SB + NB_TWIN, old_string: 'x', new_string: 'y' })]] }
  }
  const view = 'проектировка-api-2026-10-14.md'
  const folder = dirname(NB_API)
  if (name === 'VIEW-API') {
    const v = '# Проектировка API: бонусная программа для партнёров\n\n' +
      `> Собрано из ноута ${NB_API} на 2026-10-14. Правки — в ноут, выкладку пересобрать.\n\n` +
      '## Ручки\n' +
      '- GET /partners/{partnerId}/customers/{customerId}/balance — баланс клиента — решено (Белкина Т.) · 2026-10-06 №1\n' +
      '- POST /partners/{partnerId}/accruals — начисление за покупку — решено (Орлов Д.) · 2026-10-06 №1\n' +
      '- POST /partners/{partnerId}/reversals — отмена начисления, номер начисления в теле — решено (Белкина Т.) · 2026-10-09 №1\n' +
      '- POST /partners/{partnerId}/redemptions — списание бонусов при оплате — мысль · 2026-10-08 №1\n' +
      '- GET /partners/{partnerId}/customers/{customerId}/transactions — история операций клиента — мысль · 2026-10-08 №1\n' +
      '- POST /partners/{partnerId}/webhooks — подписка партнёра на события — мысль · 2026-10-08 №1\n\n' +
      '## Кто вызывает\n' +
      '- Начисление вызывает кассовое ПО партнёра сразу после оплаты — сведение (Орлов Д.) · 2026-10-06 №1\n' +
      '- Баланс запрашивают касса партнёра и его мобильное приложение — сведение (Орлов Д.) · 2026-10-06 №1\n' +
      '- Остальные ручки — в ноуте нет\n\n' +
      '## Открытые вопросы\n' +
      '- Как партнёр авторизуется в API: ключ API или OAuth — открыто, ждёт: служба безопасности · 2026-10-08 №2\n' +
      '- Что отвечать при списании, если бонусов не хватает — открыто, ждёт: Орлов Д. · 2026-10-08 №2\n'
    return { seed, files: { [`${folder}/${view}`]: v }, view: `${folder}/${view}`,
      answers: ['Разделы: ручки (метод, путь, что делает, статус), кто вызывает, открытые вопросы — так?\nКуда: файлом или в чат? Рекомендую файлом.\n', `Выкладка: ${folder}/${view}\n`],
      streams: [[ev('Grep', { pattern: '^- \\[', path: SB + NB_API })], [ev('Agent', { prompt: 'Прочитай рубрику …' }), ev('Read', { file_path: SB + NB_API }, true), ev('Write', { file_path: SB + folder + '/' + view, content: '…' })]] }
  }
  if (name === 'VIEW-PART') {
    const pv = 'схема-обмена-2026-10-14.md'
    const v = '# Схема обмена по API бонусов (записи с 2026-10-08)\n\n' +
      `> Собрано из ноута ${NB_API} на 2026-10-14, записи с 2026-10-08. Правки — в ноут, выкладку пересобрать.\n\n` +
      '## Кто кому что передаёт\n' + VP_LIST + '\n' +
      '## Открыто\n' +
      '- Как партнёр авторизуется в API — открыто, ждёт: служба безопасности · 2026-10-08 №2\n' +
      '- Кто вызывает отмену начисления (POST /partners/{partnerId}/reversals) — в ноуте нет\n'
    return { seed, files: { [`${folder}/${pv}`]: v }, view: `${folder}/${pv}`,
      answers: ['Собираю схему обмена из записей с 2026-10-08 по 2026-10-10 списком «кто → кому: что» — так?\nКуда: файлом или в чат? Рекомендую файлом.\n', `Выкладка: ${folder}/${pv}\n`],
      streams: [[ev('Grep', { pattern: '^- \\[', path: SB + NB_API })], [ev('Agent', { prompt: 'Прочитай рубрику …' }), ev('Write', { file_path: SB + folder + '/' + pv, content: '…' })]] }
  }
  // VIEW-CHAT
  const a2 = '# User stories по партнёрам и сроки запуска\n\n' +
    `> Собрано из ноута ${NB_API} на 2026-10-14.\n\n` +
    '## Истории партнёров\n' +
    '1. Как партнёр, хочу видеть баланс клиента на кассе, чтобы сразу предложить оплатить покупку бонусами — мысль · 2026-10-08 №1\n' +
    '2. Как партнёр, хочу получать событие, когда клиент списал бонусы в моей точке, чтобы не опрашивать историю — мысль · 2026-10-08 №1\n' +
    '3. Как партнёр, хочу выгрузить все начисления за месяц, чтобы сверить их со своим учётом — мысль · 2026-10-08 №1\n\n' +
    '## Сроки запуска\nВ ноуте нет.\n'
  return { seed, files: {}, answers: ['Разделы: истории партнёров, сроки запуска — так?\nКуда: файлом или в чат? Рекомендую файлом.\n', a2, 'Готово, выкладка выше.\n'],
    streams: [[ev('Grep', { pattern: '^- \\[', path: SB + NB_API })], [ev('Agent', { prompt: 'Прочитай рубрику …' })], []] }
}

// Дата прогона в самопроверке — 2026-10-14 при любом дне запуска: дата изменения answer.md.
const RUN_AT = new Date(2026, 9, 14, 15, 0, 0)
// Песочница прогона из спецификации: засев, итог, ответы, поток, реплики двойника; `dir` — куда (nb-mut.mjs строит run-N).
export function build (spec, dir = mkdtempSync(join(tmpdir(), 'grade-nb-'))) {
  mkdirSync(dir, { recursive: true })
  const put = (rel, content) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), content) }
  // Засев, как лёг в песочницу (`seedCrlf` — рабочая копия с `core.autocrlf`), и его снимок `_seeded.sha256`, как пишет раннер
  // (`noSha` — снимка нет).
  const seeded = Object.fromEntries(Object.entries(spec.seed).map(([rel, c]) => [rel, spec.seedCrlf ? lf(c).replace(/\n/g, '\r\n') : c]))
  for (const [rel, c] of Object.entries(seeded)) put(rel, c)
  hashCache.delete(dir)
  if (!spec.noSha) put('_seeded.sha256', Object.entries(seeded).map(([rel, c]) => `${sha256(Buffer.from(c))}${spec.shaStar ? ' *' : '  '}${rel}`).join('\n') + '\n')
  for (const [rel, c] of Object.entries(spec.files)) put(rel, c)
  spec.answers.forEach((a, i) => put(`answer-${String(i + 1).padStart(2, '0')}.md`, a))
  // Как у стенда: ходы встык, без перевода строки между ними.
  if (!spec.noAnswerFile) put('answer.md', spec.answers.join(''))
  for (const n of readdirSync(dir).filter((x) => /^answer(-\d+)?\.md$/.test(x))) utimesSync(join(dir, n), RUN_AT, RUN_AT)
  spec.streams.forEach((evs, i) => put(i === 0 ? 'stream.jsonl' : `stream-${String(i + 1).padStart(2, '0')}.jsonl`, evs.join('\n') + '\n'))
  // Реплики двойника, как пишет пул: `_twin/reply-NN.txt` — реплика, с которой начался ход NN.
  for (const [n, t] of Object.entries(spec.twin || {})) put(`_twin/reply-${n}.txt`, t)
  put('_seeded.txt', Object.keys(spec.seed).join('\n'))
  return dir
}

export const clone = (s) => JSON.parse(JSON.stringify(s))
// Порча ноута / выкладки / ответа хода k: замена подстроки, которая обязана найтись.
const sub = (text, from, to) => { if (!text.includes(from)) throw new Error(`порча не нашла «${from}»`); return text.replace(from, to) }
// Ноут песочницы — `s.nb` (1.2.0: отмена записи, переговорные), по умолчанию ноут про возвраты.
const nbOf = (s) => s.nb || NB_RET
const nbEdit = (from, to) => (s) => { s.files[nbOf(s)] = sub(s.files[nbOf(s)], from, to); return s }
const nbInsertItem = (line) => (s) => { const t = s.files[nbOf(s)]; const i = t.indexOf('\n- [', t.indexOf('## 2026-10-14')); if (i < 0) throw new Error('нет пункта'); const j = t.indexOf('\n', i + 1); s.files[nbOf(s)] = t.slice(0, j + 1) + line + '\n' + t.slice(j + 1); return s }
const addFile = (rel, c = 'x') => (s) => { s.files[rel] = c; return s }
// Засев ноута лёг в CRLF (рабочая копия с `core.autocrlf`), дописанное — как есть.
// Старая часть — по строкам засева (2.0.0: в ней могут стоять пометки ` ‖ …`): эти строки — в CRLF, дописанное — в LF.
const seedCrlfOk = (s) => { const n = s.seed[nbOf(s)].replace(/\s+$/, '').split('\n').length; const ls = s.files[nbOf(s)].split('\n'); s.seedCrlf = true; s.files[nbOf(s)] = ls.map((l, i) => (i < n - 1 ? l + '\r' : l)).join('\n'); return s }
const ansEdit = (k, f) => (s) => { s.answers[k] = f(s.answers[k]); return s }
const viewEdit = (from, to) => (s) => { s.files[s.view] = sub(s.files[s.view], from, to); return s }

const COMMON_BAD = [
  { id: 'files', d: 'лишний файл в coddoc/', f: addFile('coddoc/RET-1/business_requirements.md') },
  { id: 'kinds', d: 'вид [факт]', f: nbInsertItem('- [факт] проверить с кассой') },
  { id: 'decidedBy', d: '[решено] без «решил:»', f: nbInsertItem('- [решено] Обмен вместо возврата') },
  { id: 'invented', d: 'число не из текста', f: nbInsertItem('- [сведение] Отказов было 52 — со слов аналитика') },
  { id: 'invented', d: 'день недели', f: nbInsertItem('- [открыто] Ответ ждём до пятницы — ждёт: —') },
  { id: 'invented', d: 'имя не из текста', f: nbInsertItem('- [сведение] Возвраты согласует Петров А.') },
  { id: 'invented', d: 'число словом и месяц', f: nbInsertItem('- [сведение] Касса хранит историю три месяца — со слов аналитика') },
  { id: 'invented', d: 'код не из текста', f: nbInsertItem('- [сведение] Возврат проводят в CRM — со слов аналитика') },
  // Опора ground-check.mjs: роль в поле человека, имя с инициалом в начале пункта.
  { id: 'invented', d: 'роль в «решил:» не из текста', f: nbInsertItem('- [решено] Порядок согласован — решил: отдел закупок') },
  { id: 'invented', d: 'роль в «ждёт:» не из текста', f: nbInsertItem('- [открыто] Порядок не согласован — ждёт: служба безопасности') },
  { id: 'invented', d: 'имя с инициалом в начале пункта', f: nbInsertItem('- [сведение] Шубин Р. согласен с этим порядком — со слов аналитика') },
  // «Вопрос до записи» — во всех пробах записи.
  { id: 'beforeWrite', d: 'Edit ноута на ходу 1', f: (s) => { s.streams[0].push(ev('Edit', { file_path: SB + NB_RET, old_string: 'x', new_string: 'y' })); return s } },
  { id: 'beforeWrite', d: 'cat <<EOF >> ноут на ходу 1 (цель — после heredoc)', f: (s) => { s.streams[0].push(ev('Bash', { command: `cat <<'EOF' >> "${NB_RET}"\n## 2026-10-14\nEOF` })); return s } },
  { id: 'beforeWrite', d: 'PowerShell Add-Content с here-string на ходу 1', f: (s) => { s.streams[0].push(ev('PowerShell', { command: `Add-Content -Path "${NB_RET}" -Encoding utf8 -Value @'\n## 2026-10-14\n'@` })); return s } },
]
const seededBad = (from, to) => [
  { id: 'old', d: 'правка старого пункта', f: nbEdit(from, to) },
  // Засев — по снимку `_seeded.sha256` (его пишет `build`): переписанный в CRLF или с BOM ноут — изменён.
  { id: 'old', d: 'ноут переписан в CRLF', f: (s) => { s.files[nbOf(s)] = s.files[nbOf(s)].replace(/\n/g, '\r\n'); return s } },
  { id: 'old', d: 'ноут переписан с BOM', f: (s) => { s.files[nbOf(s)] = '﻿' + s.files[nbOf(s)]; return s } },
  { id: 'date', d: 'запись под датой засева', f: nbEdit('## 2026-10-14\n\n### 1', '## 2026-10-10\n\n### 1') },
  { id: 'date', d: 'запись ### 3 в старый раздел', f: nbEdit('\n## 2026-10-14\n\n### 1', '\n### 2') },
]
const SEEDED_BAD = seededBad('кассиры отказывают — со слов Ильин П.', 'кассиры отказывают всем — со слов Ильин П.')

// Таблица решений NB-BIG по правке E9: 15 действующих решений, кроме оспоренного стр. 83, и спор 2026-10-09 №1 открытым.
const BIG_ROW = {
  15: '| Администратора на входе убираем, заселение — по коду, без участия людей | Туманов А. | решено | 2026-09-21 №1 |',
  30: '| Бельё постоялец застилает сам: комплект кладём в шкафчик его койки | Калинкина В. | решено | 2026-09-22 №1 |',
  42: '| Код от входной двери действует с 14:00 дня заезда до 12:00 дня выезда | Калинкина В. | решено | 2026-09-23 №1 |',
  43: '| Код уходит сообщением в мессенджер на телефон из брони | Калинкина В. | решено | 2026-09-23 №1 |',
  76: '| Без оплаты код не отправляется | Подгорный С. | решено | 2026-09-25 №1 |',
  85: '| Дежурный телефон пишем в сообщении с кодом | Калинкина В. | решено | 2026-09-29 №1 |',
  103: '| Горничная берёт список выездов на день из PMS, на планшете | Калинкина В. | решено | 2026-09-30 №1 |',
  110: '| Бронь, по которой не заехали до 12:00 следующего дня, снимается, койка снова уходит в продажу | Калинкина В. | решено | 2026-10-01 №1 |',
  126: '| Код от входной двери приходит в день заезда, в 12:00 (раньше — за сутки) | Калинкина В. | решено | 2026-10-02 №1 |',
  144: '| Один код на входную дверь, комнату и шкафчик постояльца | Калинкина В. | решено | 2026-10-06 №1 |',
  156: '| Связку PMS с облаком замков пишет Валиев Р., поставщик даёт доступ к API | Туманов А. | решено | 2026-10-07 №1 |',
  162: '| При бронировании постоялец ставит на сайте галочку, что согласен с правилами проживания | Калинкина В. | решено | 2026-10-07 №2 |',
  163: '| За час до выезда постояльцу уходит напоминание: выезд до 12:00, бельё — в корзину у входа | Калинкина В. | решено | 2026-10-07 №2 |',
  173: '| При бронировании списываем 30%, остаток — в день заезда, до отправки кода | Туманов А., Подгорный С. | решено | 2026-10-08 №1 |',
  184: '| Если код не сработал: диспетчер в офисе (Калинкина В., 2026-09-29 №1) или дежурная горничная в хостеле (Шамрай З.) | ждёт: Туманов А. | открыто, спор | 2026-10-09 №1 |',
  206: '| Первым на заселение по коду переводим хостел у вокзала, хостел на набережной — после месяца работы первого | Туманов А. | решено | 2026-10-13 №1 |',
}
const BIG_TABLE = '| Решение | Кто решил | Вид | Запись |\n|---|---|---|---|\n' + Object.values(BIG_ROW).join('\n') + '\n'
// Строки выгрузки NB-BIG по номеру строки ноута: пункт без хвостов связи и ` · <запись>` — для эталона и порч.
const BIG_X = Object.fromEntries(nbItems(parse(readFileSync(join(HERE, 'fixtures', 'NB-BIG', 'seed', NB_BIG), 'utf8')))
  .map((x) => [x.ln, exportLine(x.line)]))
const ptsAdd = (line) => (s) => { s.files[s.view] = s.files[s.view].replace(/\s+$/, '') + '\n' + line + '\n'; return s }

// Выкладка VIEW-PART: зелёная — списком; законные варианты — той же сутью в другой нотации.
const VP_LIST =
  '- Партнёр → наш API: подписка на события (POST /partners/{partnerId}/webhooks) — мысль · 2026-10-08 №1\n' +
  '- Наш API → партнёр: вебхук о каждом списании бонусов на адрес из подписки — решено (Белкина Т.) · 2026-10-10 №1\n' +
  '- Мобильное приложение партнёра → наш API: запрос истории операций клиента — сведение (Ахмедов Р.) · 2026-10-10 №1\n' +
  '- Наш API → учётная система бонусов: каждое списание, балансы клиентов хранятся там — сведение (Белкина Т.) · 2026-10-10 №1\n' +
  '- Наш API → касса партнёра: баланс клиента, чтобы предложить оплатить покупку бонусами — мысль · 2026-10-08 №1\n' +
  '- Наш API → партнёр: выгрузка всех начислений за месяц для сверки — мысль · 2026-10-08 №1\n'
const VP_MERMAID = '```mermaid\nflowchart LR\n' +
  '  P[Партнёр]\n  K[Касса партнёра]\n  M[Мобильное приложение партнёра]\n  A[Наш API]\n  U[Учётная система бонусов]\n' +
  '  P -->|подписка на события — мысль · 2026-10-08 №1| A\n' +
  '  A -->|вебхук о каждом списании — решено · 2026-10-10 №1| P\n' +
  '  M -->|запрос истории операций — сведение · 2026-10-10 №1| A\n' +
  '  A -->|каждое списание — сведение · 2026-10-10 №1| U\n' +
  '  A -->|баланс клиента на кассе — мысль · 2026-10-08 №1| K\n' +
  '  A -->|выгрузка начислений за месяц — мысль · 2026-10-08 №1| P\n```\n'
const VP_SEQ = '```mermaid\nsequenceDiagram\n' +
  '  participant P as Партнёр\n  participant K as Касса партнёра\n  participant M as Мобильное приложение партнёра\n  participant A as Наш API\n  participant U as Учётная система бонусов\n' +
  '  P->>A: подписка на события — мысль · 2026-10-08 №1\n' +
  '  A->>P: вебхук о каждом списании — решено · 2026-10-10 №1\n' +
  '  M->>A: запрос истории операций — сведение · 2026-10-10 №1\n' +
  '  A->>U: каждое списание — сведение · 2026-10-10 №1\n' +
  '  A->>K: баланс клиента на кассе — мысль · 2026-10-08 №1\n```\n'
const VP_TABLE = '| Откуда | Куда | Что | Вид | Запись |\n|---|---|---|---|---|\n' +
  '| Партнёр | Наш API | подписка на события | мысль | 2026-10-08 №1 |\n' +
  '| Наш API | Партнёр | вебхук о каждом списании | решено (Белкина Т.) | 2026-10-10 №1 |\n' +
  '| Мобильное приложение партнёра | Наш API | запрос истории операций | сведение | 2026-10-10 №1 |\n' +
  '| Наш API | Учётная система бонусов | каждое списание | сведение | 2026-10-10 №1 |\n' +
  '| Наш API | Касса партнёра | баланс клиента | мысль | 2026-10-08 №1 |\n'
const VP_HEADS = '### Наш API → партнёр\n- вебхук о каждом списании — решено (Белкина Т.) · 2026-10-10 №1\n- выгрузка всех начислений за месяц — мысль · 2026-10-08 №1\n\n' +
  '### Партнёр → наш API\n- подписка на события — мысль · 2026-10-08 №1\n\n' +
  '### Мобильное приложение партнёра → наш API\n- запрос истории операций клиента — сведение (Ахмедов Р.) · 2026-10-10 №1\n\n' +
  '### Наш API → учётная система бонусов\n- каждое списание — сведение (Белкина Т.) · 2026-10-10 №1\n'

const BAD = {
  NEW: [
    { id: 'one', d: 'второй ноут', f: addFile('notes/другая-тема/notebook.md', HEAD_NEW) },
    { id: 'head', d: 'ключ выдуман', f: nbEdit('ключ: —', 'ключ: RET-1') },
    { id: 'date', d: 'дата засева', f: nbEdit('## 2026-10-14', '## 2026-10-09') },
    { id: 'date', d: 'первая запись ### 2', f: nbEdit('### 1 ·', '### 2 ·') },
    { id: 'decided', d: 'решил не Соколова', f: nbEdit('решил: Соколова М.', 'решил: Ильин П.') },
    { id: 'open', d: 'ждёт не юристов', f: nbEdit('ждёт: юристы', 'ждёт: —') },
    { id: 'fact', d: 'нет 37', f: nbEdit('отказали 37 покупателям', 'отказывали покупателям') },
    { id: 'quote', d: 'строка шума выкинута из «>»', f: nbEdit('> Ильин П.: Кстати, кто-нибудь знает, кофемашину на третьем этаже починили?\n', '') },
    // 1.2.0: «о чём» нового ноута.
    { id: 'about', d: 'строки «о чём:» нет', f: nbEdit(ABOUT_NEW + '\n', '') },
    { id: 'about', d: 'в «о чём» система не из текста', f: nbEdit(ABOUT_NEW, ABOUT_NEW + '; интеграция с CRM') },
    { id: 'about', d: 'в «о чём» имя не из текста', f: nbEdit(ABOUT_NEW, ABOUT_NEW + ', Петров А.') },
    { id: 'about', d: 'в «о чём» система-аббревиатура не из текста', f: nbEdit(ABOUT_NEW, 'о чём: возвраты без чека через ЕГАИС') },
    { id: 'about', d: 'в «о чём» система с заглавной не из текста', f: nbEdit(ABOUT_NEW, 'о чём: возвраты без чека, история покупок в Лояльность-Онлайн') },
    { id: 'about', d: 'в «о чём» число не из текста', f: nbEdit(ABOUT_NEW, ABOUT_NEW + '; 52 отказа') },
    ...COMMON_BAD,
  ],
  THOUGHT: [
    ...SEEDED_BAD, ...COMMON_BAD,
    { id: 'heading', d: 'запись не «мысль»', f: nbEdit('### 1 · мысль аналитика', '### 1 · вопрос аналитика') },
    { id: 'thought', d: 'вид [открыто]', f: nbEdit('- [мысль]', '- [открыто]') },
    { id: 'kinds', d: '[набросок] — вид вне четырёх (2.2.0)', f: nbInsertItem('- [набросок] Подарочной картой — только обмен на другой товар') },
    { id: 'noDecided', d: '[решено] в записи мысли', f: nbInsertItem('- [решено] Подарочной картой — только обмен на другой товар — решил: Соколова М.') },
  ],
  CONTRA: [
    ...SEEDED_BAD, ...COMMON_BAD,
    { id: 'confirm', d: 'вопроса «Записать так?» нет', f: ansEdit(0, (a) => sub(a, 'Записать так или поправить?\n', 'Пишу.\n')) },
    { id: 'noWhich', d: 'спрошено «что верно»', f: ansEdit(0, (a) => a + 'Что верно — новое, старое, не знаю?\n') },
    { id: 'noWhich', d: 'спрошено «новое или старое»', f: ansEdit(0, (a) => a + 'Оставляем новое или старое?\n') },
    { id: 'noWhich', d: 'спрошено «какое решение действует»', f: ansEdit(0, (a) => a + 'Какое из двух решений действует?\n') },
    { id: 'beforeWrite', d: 'запись на ходу 1', f: (s) => { s.streams[0].push(ev('Edit', { file_path: SB + NB_RET, old_string: 'x', new_string: 'y' })); return s } },
    { id: 'replaced', d: 'без «вместо:»', f: nbEdit('; вместо: 2026-10-08 №1.2', '') },
    { id: 'replaced', d: '«вместо:» на запись, а не на пункт', f: nbEdit('вместо: 2026-10-08 №1.2', 'вместо: 2026-10-08 №1') },
    { id: 'replaced', d: 'у старого пункта нет пометки', f: nbEdit(OLD_CARD + ' ‖ заменён: 2026-10-14 №1.1', OLD_CARD) },
    { id: 'replaced', d: 'решил не Соколова', f: nbEdit('не возвращаем — решил: Соколова М.; вместо', 'не возвращаем — решил: Ильин П.; вместо') },
    { id: 'oldItem', d: 'старый пункт удалён', f: nbEdit(OLD_CARD + ' ‖ заменён: 2026-10-14 №1.1\n', '') },
    { id: 'replaced', d: 'заменён другой пункт той же записи', f: nbEdit('вместо: 2026-10-08 №1.2', 'вместо: 2026-10-08 №1.1') },
    // Снимок засева: засеяно в CRLF (рабочая копия с `core.autocrlf`), старая часть после прогона — в LF.
    { id: 'old', d: 'засев в CRLF по снимку, старая часть переписана в LF', f: (s) => { s.seedCrlf = true; return s } },
    { id: 'noWhich', d: '«Какое решение записать как действующее?»', f: ansEdit(0, (a) => a + 'Какое решение записать как действующее?\n') },
  ],
  DISPUTE: [
    ...SEEDED_BAD, ...COMMON_BAD,
    { id: 'bothSides', d: 'вопроса о споре нет', f: ansEdit(0, (a) => sub(a, ' Что действует — новое, старое или спор в открытые (кто решает)?', '')) },
    { id: 'bothSides', d: 'старая сторона без имени и ответа', f: ansEdit(0, (a) => sub(a, 'Спор: п.1 и 2026-10-08 №1 «Возврат только на карту, с которой платили» (Соколова М.).', 'Расходится с прошлым пунктом.')) },
    { id: 'bothSides', d: 'замена без вопроса, как у того же человека', f: ansEdit(0, (a) => sub(a, 'Спор: п.1 и 2026-10-08 №1 «Возврат только на карту, с которой платили» (Соколова М.). Сейчас (Гарипова Л.): наличными на кассе. Что действует — новое, старое или спор в открытые (кто решает)?\n', 'п.1 заменяет 2026-10-08 №1 «Возврат только на карту, с которой платили».\n')) },
    { id: 'beforeWrite', d: 'запись на ходу 1', f: (s) => { s.streams[0].push(ev('Edit', { file_path: SB + NB_RET, old_string: 'x', new_string: 'y' })); return s } },
    { id: 'openDispute', d: 'ждёт не Соколову', f: nbEdit('— ждёт: Соколова М. · 2026-10-14 №1.1', '— ждёт: — · 2026-10-14 №1.1') },
    { id: 'openDispute', d: 'сторона спора — запись, а не пункт', f: nbEdit('(Соколова М., 2026-10-08 №1.2)', '(Соколова М., 2026-10-08 №1)') },
    { id: 'openDispute', d: 'у оспоренного нет пометки', f: nbEdit(OLD_CARD + ' ‖ оспорен: 2026-10-14 №1.1', OLD_CARD) },
    { id: 'openDispute', d: 'без «что верно»', f: nbEdit('- [открыто] что верно: возврат', '- [открыто] Куда возвращать деньги: возврат') },
    { id: 'openDispute', d: 'одна сторона', f: nbEdit(' или наличными на кассе, на карту не возвращаем (Гарипова Л.)', '') },
    { id: 'noDecidedNew', d: '[решено] Гариповой', f: nbInsertItem('- [решено] Деньги покупателю отдаём наличными на кассе — решил: Гарипова Л.') },
    { id: 'noReplace', d: '«вместо:» в записи', f: nbInsertItem('- [сведение] Банк отклоняет возвраты на карту без чека — со слов Гарипова Л.; вместо: 2026-10-08 №1.2 · 2026-10-14 №1.3') },
    // «…или „не знаю“ — тогда в открытые» под вопросом «кто решил» — не вопрос о споре.
    { id: 'bothSides', d: 'замена без вопроса о споре, но с «кто решил … в открытые?»', f: ansEdit(0, (a) => sub(a, 'Спор: п.1 и 2026-10-08 №1 «Возврат только на карту, с которой платили» (Соколова М.). Сейчас (Гарипова Л.): наличными на кассе. Что действует — новое, старое или спор в открытые (кто решает)?\n', 'п.1 заменяет решение Соколовой М. 2026-10-08 №1 «Возврат только на карту, с которой платили».\nп.1: решил Гарипова Л.? или «не знаю» — тогда в открытые.\n')) },
    // Хвосты спора — именем из ноута; имя не из ноута и имя из ноута в обычном пункте — выдумка.
    { id: 'invented', d: 'в скобке спора имя не из ноута', f: nbEdit('(Соколова М., 2026-10-08 №1.2)', '(Петров А., 2026-10-08 №1.2)') },
    { id: 'invented', d: 'в «ждёт:» спора имя не из ноута', f: nbEdit('— ждёт: Соколова М. · 2026-10-14 №1.1', '— ждёт: Соколова М., Белов С. · 2026-10-14 №1.1') },
    { id: 'invented', d: 'имя из ноута в «ждёт:» обычного пункта', f: nbInsertItem('- [открыто] Как кассе проводить возврат наличными — ждёт: Дёмин К.') },
  ],
  ANSWER: [
    ...SEEDED_BAD, ...COMMON_BAD,
    { id: 'noWhich', d: 'спрошено «что действует»', f: ansEdit(0, (a) => a + 'Что действует — новое или старое?\n') },
    { id: 'answered', d: 'без «отвечает на:»', f: nbEdit('; отвечает на: 2026-10-09 №1.2', '') },
    { id: 'answered', d: 'ответ не на тот вопрос', f: nbEdit('отвечает на: 2026-10-09 №1.2', 'отвечает на: 2026-10-08 №2.1') },
    { id: 'answered', d: 'ссылка на запись, а не на пункт', f: nbEdit('отвечает на: 2026-10-09 №1.2', 'отвечает на: 2026-10-09 №1') },
    { id: 'answered', d: 'закрыт другой пункт той же записи', f: nbEdit('отвечает на: 2026-10-09 №1.2', 'отвечает на: 2026-10-09 №1.1') },
    { id: 'answered', d: 'у вопроса нет пометки', f: nbEdit(OLD_Q_LINE + ' ‖ закрыт: 2026-10-14 №1.1', OLD_Q_LINE) },
    { id: 'answered', d: 'сведение «отвечает» на другой вопрос', f: nbEdit('скан к дневному отчёту — со слов Гарипова Л. · 2026-10-14 №1.2', 'скан к дневному отчёту — со слов Гарипова Л.; отвечает на: 2026-10-08 №1.3 · 2026-10-14 №1.2') },
  ],
  ASK: [
    { id: 'files', d: 'ноут дописан', f: (s) => { s.files[NB_RET] = s.seed[NB_RET] + '\n## 2026-10-14\n'; return s } },
    { id: 'files', d: 'Write в потоке', f: (s) => { s.streams[1].push(ev('Write', { file_path: SB + 'notes/x.md', content: '…' })); return s } },
    { id: 'files', d: 'лишний файл', f: addFile('notes/возврат-товара-без-чека/ответ-2026-10-14.md') },
    { id: 'files', d: 'ноут переписан в CRLF', f: (s) => { s.files[NB_RET] = s.seed[NB_RET].replace(/\n/g, '\r\n'); return s } },
    { id: 'money', d: 'без ссылки', f: ansEdit(0, (a) => sub(a, 'решено (Соколова М.) · 2026-10-09 №1', 'решено (Соколова М.)')) },
    { id: 'noReplaced', d: 'заменённое действующим', f: ansEdit(0, (a) => sub(a, 'Наличными на кассе, на карту не возвращаем — решено (Соколова М.) · 2026-10-09 №1.', 'Только на карту, с которой платили — решено (Соколова М.) · 2026-10-07 №1.')) },
    { id: 'closed', d: 'акт открытым', f: ansEdit(0, (a) => sub(a, 'Старший кассир смены — решено (Гарипова Л.) · 2026-10-10 №1.', 'Открыто, ждёт: Гарипова Л. · 2026-10-08 №1.')) },
    { id: 'closed', d: 'без ответа', f: ansEdit(0, (a) => sub(a, 'Старший кассир смены — решено (Гарипова Л.) · 2026-10-10 №1.', 'Гарипова Л. ответила.')) },
    { id: 'dispute', d: '«действует 30 дней», спор ниже', f: ansEdit(0, (a) => sub(a, 'Спор, не решён: 14 дней — решено (Ильин П.) · 2026-10-08 №2; 30 дней — Соколова М. · 2026-10-10 №2. Открыто, ждёт: Белов С. (директор розницы).', 'Действует 30 дней — Соколова М. · 2026-10-10 №2.\nРаньше Ильин П. решил 14 дней · 2026-10-08 №2, но есть спор — ждёт: Белов С.')) },
    { id: 'dispute', d: '«действует 14 дней, хотя … 30 дней — спор» в одной строке', f: ansEdit(0, (a) => sub(a, 'Спор, не решён: 14 дней — решено (Ильин П.) · 2026-10-08 №2; 30 дней — Соколова М. · 2026-10-10 №2.', 'Действует 14 дней после покупки (Ильин П., 2026-10-08 №2), хотя Соколова М. предлагала 30 дней — это спор (2026-10-10 №2).')) },
    { id: 'dispute', d: 'одна сторона', f: ansEdit(0, (a) => sub(a, '14 дней — решено (Ильин П.) · 2026-10-08 №2; ', '')) },
    { id: 'dispute', d: 'без пометки спора', f: ansEdit(0, (a) => sub(a, 'Спор, не решён: 14 дней — решено (Ильин П.) · 2026-10-08 №2; 30 дней — Соколова М. · 2026-10-10 №2. Открыто, ждёт: Белов С. (директор розницы).', '14 дней — Ильин П. · 2026-10-08 №2; 30 дней — Соколова М. · 2026-10-10 №2.')) },
    { id: 'absent', d: 'выдуман лимит', f: ansEdit(0, (a) => sub(a, 'В ноуте нет. Записать открытым вопросом — к кому?', 'До 10 000 рублей — так принято.')) },
    { id: 'absent', d: '«в ноуте нет», но число', f: ansEdit(0, (a) => sub(a, 'В ноуте нет.', 'В ноуте нет, обычно лимит — 5000.')) },
    { id: 'absent', d: 'выдумка строкой ниже', f: ansEdit(0, (a) => sub(a, '**Лимит по сумме.** В ноуте нет. Записать открытым вопросом — к кому?', '**Лимит по сумме.**\nДо 10 000 рублей на чек.')) },
    { id: 'absent', d: 'про лимит ничего', f: ansEdit(0, (a) => sub(a, '\n**Лимит по сумме.** В ноуте нет. Записать открытым вопросом — к кому?\n', '\n')) },
  ],
  LONG: [
    ...SEEDED_BAD, ...COMMON_BAD,
    { id: 'files', d: 'исходник не в sources/', f: (s) => { s.files['notes/возврат-товара-без-чека/2026-10-14-1.md'] = s.files[s.src]; delete s.files[s.src]; return s } },
    { id: 'source', d: 'исходника нет', f: (s) => { delete s.files[s.src]; return s } },
    { id: 'source', d: 'строка вставки потеряна', f: (s) => { s.files[s.src] = sub(s.files[s.src], '[10:21] Дёмин К.: Пардон.\n', ''); return s } },
    { id: 'source', d: 'вставка пересказом', f: (s) => { s.files[s.src] = sub(s.files[s.src], 'Покупатели чаще приходят не за деньгами, а поменять размер или цвет.', 'Покупатели хотят поменять размер или цвет.'); return s } },
    { id: 'source', d: 'имя не <дата>-<№>.md', f: (s) => { const t = s.files[s.src]; delete s.files[s.src]; s.src = 'notes/возврат-товара-без-чека/sources/обмен.md'; s.files[s.src] = t; s.files[NB_RET] = s.files[NB_RET].replace('sources/2026-10-14-1.md', 'sources/обмен.md'); return s } },
    { id: 'source', d: 'два исходника', f: (s) => { s.files['notes/возврат-товара-без-чека/sources/2026-10-14-2.md'] = s.files[s.src]; return s } },
    { id: 'sourceLine', d: 'нет «> исходник:»', f: nbEdit('> исходник: sources/2026-10-14-1.md\n', '> чат про обмен без чека\n') },
    { id: 'sourceLine', d: 'путь мимо файла', f: nbEdit('> исходник: sources/2026-10-14-1.md', '> исходник: sources/2026-10-14-2.md') },
    { id: 'noCopy', d: 'вставка скопирована в ноут', f: nbEdit('> исходник: sources/2026-10-14-1.md\n', '> исходник: sources/2026-10-14-1.md\n' + pasteLines(FX.LONG).slice(0, 12).map((l) => '> ' + l).join('\n') + '\n') },
    { id: 'entryItems', d: 'нет [открыто]', f: nbEdit('- [открыто] Как показывать обмен без чека в дневном отчёте: отдельной строкой или вместе с возвратами без чека — ждёт: Гарипова Л.\n', '') },
    { id: 'entryItems', d: 'решения не Соколовой', f: (s) => { const t = s.files[NB_RET]; const i = t.indexOf('## 2026-10-14'); s.files[NB_RET] = t.slice(0, i) + t.slice(i).replace(/решил: Соколова М\./g, 'решил: Ильин П.'); return s } },
    { id: 'beforeWrite', d: 'исходник записан на ходу 1', f: (s) => { s.streams[0].push(ev('Write', { file_path: SB + s.src, content: '…' })); return s } },
  ],
  NOAUTH: [
    ...SEEDED_BAD, ...COMMON_BAD,
    { id: 'asked', d: 'вопроса «кто решил» нет', f: ansEdit(0, (a) => a.replace(/п\.1: кто решил[^\n]*\n/, '')) },
    // Заглушка «решил: ?» и «решил: кто именно?» в строке пункта — не вопрос.
    { id: 'asked', d: 'только заглушка «решил: ?» в строке пункта', f: ansEdit(0, (a) => a.replace(/п\.1: кто решил[^\n]*\n/, '').replace('1. Товар на возврат принимает склад, а не магазин — договорились', '1. [решено] Товар на возврат принимает склад, а не магазин — решил: ?')) },
    { id: 'asked', d: 'только «решил: кто именно?» в строке пункта', f: ansEdit(0, (a) => a.replace(/п\.1: кто решил[^\n]*\n/, '').replace('1. Товар на возврат принимает склад, а не магазин — договорились', '1. [решено] Товар на возврат принимает склад, а не магазин — решил: кто именно?')) },
    { id: 'beforeWrite', d: 'запись на ходу 1', f: (s) => { s.streams[0].push(ev('Write', { file_path: SB + NB_RET, content: '…' })); return s } },
    { id: 'openItem', d: 'склад — [сведение]', f: nbEdit('- [открыто] Товар на возврат принимает склад, а не магазин — договорились, кто решил — неизвестно — ждёт: —', '- [сведение] Договорились, что товар на возврат принимает склад, а не магазин — со слов аналитика') },
    { id: 'openItem', d: 'склад — [решено], «решил: —»', f: nbEdit('- [открыто] Товар на возврат принимает склад, а не магазин — договорились, кто решил — неизвестно — ждёт: —', '- [решено] Товар на возврат принимает склад, а не магазин — решил: —') },
    { id: 'noAuthor', d: '«решил:» в открытом', f: nbEdit('— ждёт: —\n', '— ждёт: —; решил: аналитик\n') },
    // Кандидат из старого ноута, принятый нейтральной репликой.
    { id: 'noAuthor', d: '«решил: Соколова М.» — имя из старого ноута', f: nbEdit('- [открыто] Товар на возврат принимает склад, а не магазин — договорились, кто решил — неизвестно — ждёт: —', '- [решено] Товар на возврат принимает склад, а не магазин — решил: Соколова М.') },
  ],
  FILE: [
    ...SEEDED_BAD, ...COMMON_BAD,
    { id: 'files', d: 'vtt изменён', f: (s) => { s.files['calls/2026-10-10-sklad.vtt'] = s.seed['calls/2026-10-10-sklad.vtt'] + '\nNOTE разобрано\n'; return s } },
    { id: 'files', d: 'vtt переписан в CRLF', f: (s) => { s.files['calls/2026-10-10-sklad.vtt'] = s.seed['calls/2026-10-10-sklad.vtt'].replace(/\n/g, '\r\n'); return s } },
    { id: 'intake', d: 'строки про meeting-intake нет', f: ansEdit(0, (a) => a.replace(/Расшифровку разбирает[^\n]*\n/, '')) },
    { id: 'fileEntry', d: 'пункт файла [решено]', f: nbEdit('- [сведение] Регламент возвратов: в нём порядок приёмки на складе — со слов аналитика', '- [решено] Регламент возвратов: в нём порядок приёмки на складе — решил: аналитик') },
    { id: 'fileEntry', d: 'записи-ссылки нет', f: nbEdit('### 1 · файл docs-in/reglament.pdf', '### 1 · регламент возвратов') },
    { id: 'fileEntry', d: 'гипотеза о содержимом файла', f: nbEdit('в нём порядок приёмки на складе — со слов аналитика', 'в нём порядок приёмки на складе; возврат принимает склад, а не касса — со слов аналитика') },
    { id: 'noVtt', d: 'факт из vtt', f: nbInsertItem('- [сведение] Приёмка на складе — по акту, который подписывает кладовщик') },
    { id: 'noRead', d: 'Read vtt', f: (s) => { s.streams[0].push(ev('Read', { file_path: SB + 'calls/2026-10-10-sklad.vtt' })); return s } },
    { id: 'noRead', d: 'субагент cat pdf', f: (s) => { s.streams[1].push(ev('Bash', { command: 'cat docs-in/reglament.pdf | head' }, true)); return s } },
    { id: 'noRead', d: 'Grep без path и glob — по всей песочнице', f: (s) => { s.streams[0].push(ev('Grep', { pattern: 'склад', output_mode: 'content' })); return s } },
    { id: 'noRead', d: 'рекурсивный rg по песочнице', f: (s) => { s.streams[0].push(ev('Bash', { command: 'rg -n "приёмк" .' })); return s } },
    { id: 'noRead', d: 'Get-Content pdf | Select-Object', f: (s) => { s.streams[0].push(ev('PowerShell', { command: 'Get-Content docs-in/reglament.pdf | Select-Object -First 20' })); return s } },
    // Число, которое в тексте вызова есть только в дате пути `calls/2026-10-10-sklad.vtt`, — выдумка.
    { id: 'invented', d: 'число только из даты в пути', f: (s) => { s.files[NB_RET] += '\n### 2 · мысль аналитика\n- [сведение] Приёмку на складе ведут 10 сотрудников — со слов аналитика\n> порядок приёмки на складе\n'; return s } },
  ],
  'VIEW-API': [
    { id: 'files', d: 'лишний файл', f: addFile(dirname(NB_API) + '/черновик.md') },
    { id: 'notebook', d: 'ноут дописан', f: (s) => { s.files[NB_API] = s.seed[NB_API] + '\n## 2026-10-14\n'; return s } },
    { id: 'notebook', d: 'ноут переписан в CRLF', f: (s) => { s.files[NB_API] = s.seed[NB_API].replace(/\n/g, '\r\n'); return s } },
    { id: 'viewFile', d: 'дата засева в имени', f: (s) => { const v = s.files[s.view]; delete s.files[s.view]; s.view = s.view.replace('2026-10-14', '2026-10-09'); s.files[s.view] = v; return s } },
    { id: 'viewFile', d: 'выкладка не в папке ноута', f: (s) => { const v = s.files[s.view]; delete s.files[s.view]; s.view = 'notes/выкладки/проектировка-api-2026-10-14.md'; s.files[s.view] = v; return s } },
    { id: 'vhead', d: 'нет шапки', f: viewEdit(`> Собрано из ноута ${NB_API} на 2026-10-14. Правки — в ноут, выкладку пересобрать.\n`, '') },
    { id: 'all6', d: 'нет webhooks', f: viewEdit('- POST /partners/{partnerId}/webhooks — подписка партнёра на события — мысль · 2026-10-08 №1\n', '') },
    { id: 'oldPath', d: 'путь A действующим', f: viewEdit('## Кто вызывает', '- POST /bonus/cancel — отмена начисления — решено (Белкина Т.) · 2026-10-06 №2\n\n## Кто вызывает') },
    { id: 'drafts', d: 'набросок подан решённым', f: viewEdit('списание бонусов при оплате — мысль', 'списание бонусов при оплате — решено (Орлов Д.)') },
    { id: 'drafts', d: 'набросок без подписи', f: viewEdit('история операций клиента — мысль', 'история операций клиента') },
    { id: 'refs', d: 'ручка без ссылки', f: viewEdit('подписка партнёра на события — мысль · 2026-10-08 №1', 'подписка партнёра на события — мысль') },
    { id: 'noInvented', d: 'путь не из ноута', f: viewEdit('## Кто вызывает', '- DELETE /partners/{partnerId}/accruals/{accrualId} — отмена — решено (Белкина Т.) · 2026-10-09 №1\n\n## Кто вызывает') },
    { id: 'noInvented', d: 'метод не из ноута', f: viewEdit('- POST /partners/{partnerId}/reversals', '- PUT /partners/{partnerId}/reversals') },
    { id: 'noInvented', d: 'путь не из ноута после «**»', f: viewEdit('## Кто вызывает', '- **/partners/{partnerId}/refunds** — возврат — решено (Белкина Т.) · 2026-10-09 №1\n\n## Кто вызывает') },
    { id: 'noInvented', d: 'путь не из ноута после «[»', f: viewEdit('## Кто вызывает', '- [/partners/{partnerId}/refunds](#) — возврат — решено (Белкина Т.) · 2026-10-09 №1\n\n## Кто вызывает') },
    { id: 'noInvented', d: 'метод не из ноута «**PUT**»', f: viewEdit('- POST /partners/{partnerId}/reversals', '- **PUT** /partners/{partnerId}/reversals') },
    { id: 'noInvented', d: 'путь от префикса, который в выкладке не назван', f: viewEdit('- POST /partners/{partnerId}/webhooks', '- POST /webhooks') },
    { id: 'checked', d: 'проверки субагентом нет', f: (s) => { s.streams[1] = s.streams[1].filter((e) => !e.includes('"name":"Agent"')); return s } },
    { id: 'openQ', d: 'открытый вопрос подан «решено»', f: viewEdit('- Как партнёр авторизуется в API: ключ API или OAuth — открыто, ждёт: служба безопасности · 2026-10-08 №2', '- Как партнёр авторизуется в API: ключ API — решено (служба безопасности) · 2026-10-08 №2') },
    { id: 'openQ', d: 'открытый вопрос — «решил:»', f: viewEdit('- Что отвечать при списании, если бонусов не хватает — открыто, ждёт: Орлов Д. · 2026-10-08 №2', '- При списании, если бонусов не хватает, отвечаем отказом — решил: Орлов Д. · 2026-10-08 №2') },
    { id: 'elemWords', d: 'число не из ноута', f: viewEdit('— начисление за покупку — решено (Орлов Д.)', '— начисление за покупку, ответ 201 — решено (Орлов Д.)') },
    { id: 'elemWords', d: 'латиница не из ноута', f: viewEdit('номер начисления в теле', 'номер начисления в теле (accrualId)') },
    { id: 'elemWords', d: 'число не из ноута на строке продолжения', f: viewEdit('— начисление за покупку — решено (Орлов Д.) · 2026-10-06 №1', '— начисление за покупку — решено (Орлов Д.) · 2026-10-06 №1\n  лимит — 1000 бонусов за чек') },
    { id: 'elemWords', d: 'роль в «ждёт:» не из ноута', f: viewEdit('ждёт: служба безопасности · 2026-10-08 №2', 'ждёт: юристы · 2026-10-08 №2') },
  ],
  'VIEW-CHAT': [
    { id: 'files', d: 'выкладка файлом', f: addFile(dirname(NB_API) + '/истории-2026-10-14.md') },
    { id: 'notebook', d: 'ноут изменён', f: (s) => { s.files[NB_API] = s.seed[NB_API].replace('раз в сутки', 'раз в час'); return s } },
    { id: 'stories', d: 'история без ссылки', f: ansEdit(1, (a) => sub(a, 'чтобы не опрашивать историю — мысль · 2026-10-08 №1', 'чтобы не опрашивать историю — мысль')) },
    { id: 'noDeadline', d: 'про сроки ничего', f: ansEdit(1, (a) => sub(a, '## Сроки запуска\nВ ноуте нет.\n', '')) },
    { id: 'noDate', d: 'выдуманная дата', f: ansEdit(1, (a) => sub(a, 'В ноуте нет.', 'В ноуте нет. Ориентир по запуску — 1 декабря.')) },
    { id: 'noDate', d: 'выдуманный квартал', f: ansEdit(1, (a) => sub(a, 'В ноуте нет.', 'В ноуте нет, но запуск — в следующем квартале.')) },
    // Грейдится ход, где собрана выкладка, а не склейка ходов: история и «в ноуте нет» из плана хода 1 не в счёт.
    { id: 'stories', d: 'история со ссылкой только в плане хода 1', f: (s) => { s.answers[0] += '2. Как партнёр, хочу получать событие, когда клиент списал бонусы в моей точке, чтобы не опрашивать историю — мысль · 2026-10-08 №1\n'; s.answers[1] = sub(s.answers[1], '2. Как партнёр, хочу получать событие, когда клиент списал бонусы в моей точке, чтобы не опрашивать историю — мысль · 2026-10-08 №1\n', ''); return s } },
    { id: 'noDeadline', d: '«в ноуте нет» про сроки только в плане хода 1', f: (s) => { s.answers[0] += 'Сроков запуска в ноуте нет.\n'; s.answers[1] = sub(s.answers[1], '## Сроки запуска\nВ ноуте нет.\n', '## Сроки запуска\n'); return s } },
    // Истории списком без пустых строк: блок — пункт, ссылка соседнего пункта не его.
    { id: 'stories', d: 'ссылка только у последней истории списка', f: ansEdit(1, (a) => a.replace(' — мысль · 2026-10-08 №1\n2.', ' — мысль\n2.').replace(' — мысль · 2026-10-08 №1\n3.', ' — мысль\n3.')) },
    { id: 'noDate', d: 'чужая дата в строке «Собрано из ноута»', f: ansEdit(1, (a) => sub(a, `> Собрано из ноута ${NB_API} на 2026-10-14.`, `> Собрано из ноута ${NB_API} на 2026-12-01.`)) },
    // Истории в ноуте — наброски.
    { id: 'drafts', d: 'история подана «решено»', f: ansEdit(1, (a) => sub(a, 'покупку бонусами — мысль · 2026-10-08 №1', 'покупку бонусами — решено (Белкина Т.) · 2026-10-08 №1')) },
    { id: 'drafts', d: 'история с «решил:»', f: ansEdit(1, (a) => sub(a, 'со своим учётом — мысль · 2026-10-08 №1', 'со своим учётом — мысль; решил: Орлов Д. · 2026-10-08 №1')) },
    { id: 'elemWords', d: 'число не из ноута в истории', f: ansEdit(1, (a) => sub(a, 'все начисления за месяц', 'все начисления за 3 месяца')) },
    { id: 'elemWords', d: 'роль в «ждёт:» не из ноута', f: ansEdit(1, (a) => sub(a, 'опрашивать историю — мысль · 2026-10-08 №1', 'опрашивать историю — мысль, ждёт: юристы · 2026-10-08 №1')) },
  ],
  'VIEW-PART': [
    { id: 'files', d: 'лишний файл', f: addFile(dirname(NB_API) + '/черновик.md') },
    { id: 'notebook', d: 'ноут дописан', f: (s) => { s.files[NB_API] = s.seed[NB_API] + '\n## 2026-10-14\n'; return s } },
    { id: 'viewFile', d: 'дата засева в имени', f: (s) => { const v = s.files[s.view]; delete s.files[s.view]; s.view = s.view.replace('2026-10-14', '2026-10-09'); s.files[s.view] = v; return s } },
    { id: 'refsPart', d: 'стрелка без ссылки', f: viewEdit('балансы клиентов хранятся там — сведение (Белкина Т.) · 2026-10-10 №1', 'балансы клиентов хранятся там — сведение (Белкина Т.)') },
    { id: 'refsPart', d: 'строка таблицы без ссылки', f: viewEdit('## Открыто', '| Касса партнёра | Наш API | запрос баланса |\n\n## Открыто') },
    { id: 'refsPart', d: 'ребро Mermaid без подписи', f: viewEdit('## Открыто', '```mermaid\nflowchart LR\n  M[Мобильное приложение партнёра] --> A[Наш API]\n```\n\n## Открыто') },
    { id: 'noEarly', d: 'ссылка на 2026-10-07', f: viewEdit('## Открыто', '- Касса партнёра → наш API: номер чека и сумма покупки — сведение (Ахмедов Р.) · 2026-10-07 №1\n\n## Открыто') },
    // Раздел «В ноуте нет» снимает только строки без ссылки: строка со ссылкой что-то утверждает.
    { id: 'noEarly', d: 'под «## В ноуте нет» — обмен со ссылкой до части', f: viewEdit('## Открыто', '## В ноуте нет\n- Касса партнёра → наш API: номер чека и сумма покупки · 2026-10-07 №1\n\n## Открыто') },
    { id: 'refsPart', d: 'строка таблицы без ссылки под шапкой', f: viewEdit('## Открыто', '| Откуда → куда | Что |\n|---|---|\n| Касса партнёра → наш API | запрос баланса |\n\n## Открыто') },
    { id: 'noEarly', d: 'обмен до части с подменённой ссылкой', f: viewEdit('## Открыто', '- Касса партнёра → наш API: начисление бонусов сразу после оплаты — сведение · 2026-10-08 №1\n\n## Открыто') },
    { id: 'noEarly', d: 'приложение запрашивает баланс', f: viewEdit('## Открыто', '- Мобильное приложение партнёра → наш API: баланс клиента — сведение · 2026-10-10 №1\n\n## Открыто') },
    { id: 'noInventedPart', d: 'банк', f: viewEdit('## Открыто', '- Наш API → банк: возврат денег за списание — решено · 2026-10-10 №1\n\n## Открыто') },
    { id: 'noInventedPart', d: 'приложение не из пунктов записи', f: viewEdit('- Партнёр → наш API: подписка на события', '- Мобильное приложение партнёра → наш API: подписка на события') },
    { id: 'noInventedPart', d: 'касса вызывает отмену', f: viewEdit('## Открыто', '- Касса партнёра → наш API: отмена начисления (POST /partners/{partnerId}/reversals) — решено (Белкина Т.) · 2026-10-09 №1\n\n## Открыто') },
    { id: 'noInventedPart', d: 'ссылка на запись, которой нет', f: viewEdit('решено (Белкина Т.) · 2026-10-10 №1', 'решено (Белкина Т.) · 2026-10-10 №7') },
    // Участник только в узле, в ребре — его имя: без подстановки узлов проверка его не видит.
    { id: 'noInventedPart', d: 'узел flowchart: приложение не из пунктов записи', f: viewEdit(VP_LIST, VP_MERMAID.replace('  P -->|подписка на события', '  M -->|подписка на события')) },
    { id: 'noInventedPart', d: 'участник sequenceDiagram: приложение не из пунктов записи', f: viewEdit(VP_LIST, VP_SEQ.replace('  P->>A: подписка на события', '  M->>A: подписка на события')) },
    { id: 'noEarly', d: 'узел flowchart: касса + начисление', f: viewEdit(VP_LIST, VP_MERMAID.replace('  A -->|каждое списание', '  K -->|начисление бонусов · 2026-10-08 №1| A\n  A -->|каждое списание')) },
    { id: 'enough', d: 'связей три', f: (s) => { s.files[s.view] = s.files[s.view].split('\n').filter((l) => !/подписка на события|касса партнёра: баланс|выгрузка|авторизуется/.test(l)).join('\n'); return s } },
    { id: 'checked', d: 'проверки субагентом нет', f: (s) => { s.streams[1] = s.streams[1].filter((e) => !e.includes('"name":"Agent"')); return s } },
    { id: 'elemWords', d: 'число не из ноута в связи', f: viewEdit('вебхук о каждом списании бонусов на адрес из подписки', 'вебхук о каждом списании бонусов, повтор 3 раза') },
    { id: 'elemWords', d: 'роль в «ждёт:» не из ноута', f: viewEdit('ждёт: служба безопасности · 2026-10-08 №2', 'ждёт: юристы · 2026-10-08 №2') },
  ],
  // ---- 1.2.0 ----
  'PTS-IN': [
    ...SEEDED_BAD, ...COMMON_BAD,
    { id: 'confirm', d: 'вопроса «Записать так?» нет', f: ansEdit(0, (a) => sub(a, 'Записать так или поправить?\n', 'Пишу.\n')) },
    { id: 'noWhich', d: 'спрошено «что действует»', f: ansEdit(0, (a) => a + 'Что действует — новое или старое?\n') },
    { id: 'listHead', d: 'заголовок не «встреча <дата>»', f: nbEdit('### 1 · встреча 2026-10-13: возврат товара без чека', '### 1 · письмо Соколовой М.') },
    { id: 'listHead', d: '«встреча по памяти» у расшифровки', f: nbEdit('### 1 · встреча 2026-10-13:', '### 1 · встреча по памяти 2026-10-13:') },
    { id: 'listHead', d: 'дата прогона вместо даты встречи', f: nbEdit('### 1 · встреча 2026-10-13:', '### 1 · встреча 2026-10-14:') },
    { id: 'asIs', d: 'пункт пересказан', f: nbEdit('Касса печатает покупателю чек возврата сразу после операции', 'Касса сразу печатает чек') },
    { id: 'asIs', d: 'пункт списка потерян', f: nbEdit('- [решено] Возврат без чека запускаем сразу во всех магазинах сети, без пилота — решил: Соколова М. · 2026-10-14 №1.4\n', '') },
    { id: 'asIs', d: 'хвост автора потерян', f: nbEdit('сразу после операции — со слов Дёмин К.', 'сразу после операции') },
    { id: 'noLineRef', d: '« · L39» перенесена в ноут', f: nbEdit('сразу после операции — со слов Дёмин К. · 2026-10-14 №1.3\n', 'сразу после операции — со слов Дёмин К. · L39 · 2026-10-14 №1.3\n') },
    { id: 'sourceList', d: 'нет «> исходник:»', f: nbEdit('> исходник: coddoc/_inbox/meeting-2026-10-13.points.md\n', '> встреча 2026-10-13\n') },
    { id: 'sourceList', d: 'путь мимо списка', f: nbEdit('> исходник: coddoc/_inbox/meeting-2026-10-13.points.md', '> исходник: coddoc/_inbox/meeting-2026-10-12.points.md') },
    { id: 'replaced', d: 'без «вместо:»', f: nbEdit('; вместо: 2026-10-08 №1.2', '') },
    { id: 'answered', d: 'без «отвечает на:»', f: nbEdit('; отвечает на: 2026-10-09 №1.2', '') },
    { id: 'replaced', d: 'заменён другой пункт той же записи', f: nbEdit('вместо: 2026-10-08 №1.2', 'вместо: 2026-10-08 №1.1') },
    { id: 'answered', d: 'закрыт другой пункт той же записи', f: nbEdit('отвечает на: 2026-10-09 №1.2', 'отвечает на: 2026-10-09 №1.1') },
    { id: 'replaced', d: 'у старого пункта нет пометки', f: nbEdit(OLD_CARD + ' ‖ заменён: 2026-10-14 №1.1', OLD_CARD) },
    { id: 'noExtraLinks', d: 'сведение Дёмина — «ответом» на его вопрос', f: nbEdit('сразу после операции — со слов Дёмин К. · 2026-10-14 №1.3', 'сразу после операции — со слов Дёмин К.; отвечает на: 2026-10-08 №2.2 · 2026-10-14 №1.3') },
    { id: 'noExtraLinks', d: 'запуск «заменяет» решение Соколовой', f: nbEdit('без пилота — решил: Соколова М. · 2026-10-14 №1.4', 'без пилота — решил: Соколова М.; вместо: 2026-10-08 №1.1 · 2026-10-14 №1.4') },
  ],
  'PTS-NEW': [
    ...COMMON_BAD,
    { id: 'one', d: 'второй ноут', f: addFile('notes/другая-тема/notebook.md', '---\nтема: другая\nключ: —\nцель: —\n---\n# Ноут: другая\n') },
    { id: 'head', d: 'ключ выдуман', f: nbEdit('ключ: —', 'ключ: ROOM-1') },
    { id: 'head', d: 'темы нет', f: nbEdit('тема: бронирование переговорных', 'тема: —') },
    { id: 'date', d: 'дата засева', f: nbEdit('## 2026-10-14', '## 2026-10-09') },
    { id: 'date', d: 'первая запись ### 2', f: nbEdit('### 1 ·', '### 2 ·') },
    { id: 'listHead', d: 'заголовок не «встреча <дата>»', f: nbEdit('### 1 · встреча 2026-10-12: бронирование переговорных', '### 1 · чат с Тарасовой Е.') },
    { id: 'asIs', d: 'пункт списка потерян', f: nbEdit('- [сведение] В офисе 12 переговорных, из них 3 большие — со слов Белова К.\n', '') },
    { id: 'asIs', d: 'вид пункта изменён', f: nbEdit('- [открыто] Снимать ли бронь', '- [решено] Снимать ли бронь') },
    { id: 'noLineRef', d: '« · L7» перенесена в ноут', f: nbEdit('бывают двойные брони — со слов Белова К.', 'бывают двойные брони — со слов Белова К. · L7') },
    { id: 'sourceList', d: 'нет «> исходник:»', f: nbEdit('> исходник: coddoc/_inbox/meeting-2026-10-12.points.md\n', '') },
    { id: 'noLinks', d: '«отвечает на:» в новом ноуте', f: nbEdit('— ждёт: АХО', '— ждёт: АХО; отвечает на: 2026-10-12 №1 «Сейчас переговорные»') },
    { id: 'files', d: 'список изменён', f: (s) => { s.files[LIST_NEW] = s.seed[LIST_NEW].replace(/ · L\d+/g, ''); return s } },
  ],
  'PTS-REC': [
    ...seededBad('около 340 записей', 'около 350 записей'), ...COMMON_BAD.filter((c) => c.id !== 'beforeWrite'),
    { id: 'writeFirst', d: 'вопрос «Записать так?» и запись на ходу 2', f: (s) => { s.answers = [s.answers[0].replace('Записал в ноут', 'Пишу в ноут').replace('Совпадений с прошлыми записями нет.', 'Записать так или поправить?'), 'Записал.\n']; s.streams = [s.streams[0].slice(0, -1), [s.streams[0][s.streams[0].length - 1]]]; return s } },
    { id: 'writeFirst', d: 'запись на ходу 1, но с вопросом «Записать так?»', f: ansEdit(0, (a) => a + 'Записать так или поправить?\n') },
    { id: 'listHead', d: '«встреча» вместо «встреча по памяти»', f: nbEdit('### 1 · встреча по памяти 2026-10-14:', '### 1 · встреча 2026-10-14:') },
    { id: 'asIs', d: '«(по памяти, не уверен)» потеряно', f: nbEdit('К SMS добавили пуш? (по памяти, не уверен) — ждёт: —', 'К SMS добавили пуш — ждёт: —') },
    { id: 'noLineRef', d: '« · L57» перенесена в ноут', f: nbEdit('(по памяти, не уверен) — ждёт: —\n', '(по памяти, не уверен) — ждёт: — · L57\n') },
    { id: 'sourceList', d: 'исходник — протокол, а не список', f: nbEdit('> исходник: coddoc/MED-77/meeting-2026-10-14.points.md', '> исходник: coddoc/MED-77/meeting-2026-10-14.recall.md') },
    { id: 'noLinks', d: 'ДМС «отвечает» на вопрос регистратуры', f: nbEdit('— ждёт: Ким Сергей', '— ждёт: Ким Сергей; отвечает на: 2026-10-09 №1 «Нужно ли регистратору видеть»') },
    { id: 'decided12', d: '12 часов — открытым', f: nbEdit('- [решено] Отмена за 12 часов вместо 24 — решил: Зайцева Ольга', '- [открыто] Отмена за 12 часов вместо 24? — ждёт: Зайцева Ольга') },
    { id: 'thoughtKept', d: 'мысль стала решением', f: nbEdit('- [мысль] Предупреждение пациенту об оставшейся отмене', '- [решено] Предупреждение пациенту об оставшейся отмене — решил: Зайцева Ольга') },
    { id: 'thoughtKept', d: 'мысль стала открытым вопросом', f: nbEdit('- [мысль] Предупреждение пациенту об оставшейся отмене', '- [открыто] Предупреждать ли пациента об оставшейся отмене — ждёт: —') },
    { id: 'files', d: 'протокол изменён', f: (s) => { s.files['coddoc/MED-77/meeting-2026-10-14.recall.md'] = s.seed['coddoc/MED-77/meeting-2026-10-14.recall.md'] + '\n'; return s } },
  ],
  EXPORT: [
    ...exportBad('2026-10-07'),
    { id: 'noReplacedItem', d: 'заменённый пункт в выгрузке', f: viewEdit('- [открыто] Нужен ли паспорт', '- [решено] Возврат только на карту, с которой платили — решил: Соколова М. · 2026-10-07 №1\n- [открыто] Нужен ли паспорт') },
    { id: 'noClosedQ', d: 'закрытый вопрос в выгрузке', f: viewEdit('- [мысль] Экран кассира', '- [открыто] Кто подписывает акт возврата без чека — ждёт: Гарипова Л. · 2026-10-08 №1\n- [мысль] Экран кассира') },
    { id: 'thoughts', d: 'ранняя мысль потеряна', f: viewEdit('- [мысль] А если покупку оплатили подарочной картой, а чека нет, — куда тогда возвращать деньги? · 2026-10-07 №2\n', '') },
    { id: 'range', d: 'первая дата не та', f: viewEdit('записи 2026-10-07–2026-10-10', 'записи 2026-10-08–2026-10-10') },
  ],
  'EXPORT-SINCE': [
    ...exportBad('2026-10-09'),
    { id: 'noBefore', d: 'пункт до даты части', f: viewEdit('- [решено] Деньги', '- [открыто] Нужен ли паспорт покупателя при возврате без чека — ждёт: юристы · 2026-10-07 №1\n- [решено] Деньги') },
    { id: 'noBefore', d: 'пункт до даты с подменённой ссылкой', f: viewEdit('- [решено] Деньги', '- [мысль] А если покупку оплатили подарочной картой, а чека нет, — куда тогда возвращать деньги? · 2026-10-09 №1\n- [решено] Деньги') },
    { id: 'range', d: 'вся история вместо части', f: viewEdit('записи 2026-10-09–2026-10-10', 'записи 2026-10-07–2026-10-10') },
  ],
  ROUTE: [
    { id: 'files', d: 'файл создан: исходник в sources/', f: addFile('notes/возврат-товара-без-чека/sources/2026-10-14-1.md', 'x') },
    { id: 'files', d: 'список написан самим ноутом', f: addFile('coddoc/_inbox/meeting-2026-10-13.points.md', '# Пункты: возврат\n') },
    { id: 'files', d: 'Write в потоке', f: (s) => { s.streams[0].push(ev('Write', { file_path: SB + 'notes/x.md', content: '…' })); return s } },
    { id: 'files', d: 'vtt изменён', f: (s) => { s.files[ROUTE_VTT] = s.seed[ROUTE_VTT] + '\nNOTE разобрано\n'; return s } },
    { id: 'notebook', d: 'запись в ноуте', f: (s) => { s.files[NB_RET] = s.seed[NB_RET] + '\n## 2026-10-14\n\n### 1 · файл calls/2026-10-13-vozvraty.vtt\n'; return s } },
    { id: 'route', d: 'строки нет', f: ansEdit(0, () => 'Записи нет.\n') },
    { id: 'route', d: 'команда без пути', f: ansEdit(0, (a) => a.replace('`/meeting-intake calls/2026-10-13-vozvraty.vtt`', '`/meeting-intake`')) },
    { id: 'noRead', d: 'Read vtt', f: (s) => { s.streams[0].push(ev('Read', { file_path: SB + ROUTE_VTT })); return s } },
    { id: 'noRead', d: 'субагент cat vtt', f: (s) => { s.streams[0].push(ev('Bash', { command: `cat ${ROUTE_VTT} | head` }, true)); return s } },
    { id: 'noRead', d: 'Grep без path — по всей песочнице', f: (s) => { s.streams[0].push(ev('Grep', { pattern: 'наличн' })); return s } },
  ],
  'DESC-ONE': [...descBad(), ...descPickBad()],
  'DESC-TWO': [
    ...descBad(),
    { id: 'oneOfTwo', d: 'запись в оба ноута', f: (s) => { s.files[NB_REP] = s.seed[NB_REP].replace(/\s+$/, '') + '\n\n## 2026-10-14\n\n### 1 · чат с Киселёвым А.\n- [сведение] x — со слов Киселёв А.\n> x\n'; return s } },
    { id: 'oneOfTwo', d: 'записи нет', f: (s) => { s.files[NB_AS] = s.seed[NB_AS]; return s } },
    { id: 'pickShown', d: 'вопроса о ноуте нет', f: ansEdit(0, (a) => a.replace(/^По «АС Друг»[\s\S]*?В какой ноут писать\?\n/, '')) },
    { id: 'pickShown', d: 'варианты без «о чём»', f: ansEdit(0, (a) => a.replace(' — обмен заявками на обслуживание между нашим порталом и АС Друг', '').replace(' — выгрузка ежемесячных отчётов о выполненных работах из АС Друг в бухгалтерию', '')) },
    { id: 'pickShown', d: 'второго ноута в вопросе нет', f: ansEdit(0, (a) => a.replace(/2\. отчётность АС Друг[^\n]*\n/, '')) },
  ],
  AUTO: [
    ...descBad(), ...descPickBad(),
    { id: 'invoked', d: 'скилл не вызван — ноут записан «сам»', f: (s) => { s.streams[0] = s.streams[0].filter((e) => !e.includes('"name":"Skill"')); return s } },
    { id: 'invoked', d: 'вызван другой скилл', f: (s) => { s.streams[0] = s.streams[0].map((e) => e.replace('"skill":"analyst-notebook"', '"skill":"meeting-intake"')); return s } },
  ],
  // ---- круг harden: ловушки fixtures/NB-BIG/expected.md и NB-TWIN/expected.md ----
  'BIG-EXPORT': [
    { id: 'files', d: 'лишний файл', f: addFile('notes/заселение-без-администратора/черновик.md') },
    { id: 'notebook', d: 'ноут дописан', f: (s) => { s.files[NB_BIG] = s.seed[NB_BIG] + '\n## 2026-10-14\n'; return s } },
    { id: 'ptsFile', d: 'имя не notebook-<дата>.points.md', f: (s) => { const v = s.files[s.view]; delete s.files[s.view]; s.view = 'notes/заселение-без-администратора/пункты-2026-10-14.md'; s.files[s.view] = v; return s } },
    { id: 'checked', d: 'проверки субагентом нет', f: (s) => { s.streams[0] = s.streams[0].filter((e) => !e.includes('"name":"Agent"')); return s } },
    { id: 'ptsHead', d: '«> Задача: —» при ключе HST-318', f: viewEdit('> Задача: HST-318', '> Задача: —') },
    { id: 'range', d: 'первая дата не та', f: viewEdit('записи 2026-09-21–2026-10-13', 'записи 2026-09-23–2026-10-13') },
    { id: 'ptsLines', d: 'пункты строками «1. [решено]»', f: (s) => { let k = 0; s.files[s.view] = s.files[s.view].replace(/^- \[/gm, () => `${++k}. [`); return s } },
    // Ловушка 1: два пункта с одним началом — выкинуть 42, оставить 41.
    { id: 'complete', d: 'ловушка 1: стр. 42 «действует с 14:00» потеряна', f: viewEdit(BIG_X[42] + '\n', '') },
    { id: 'noGone', d: 'ловушка 1: стр. 41 «за сутки» подана действующей', f: ptsAdd(BIG_X[41]) },
    { id: 'noGone', d: 'закрытый вопрос стр. 31 «какие койки освободились»', f: ptsAdd(BIG_X[31]) },
    { id: 'noGone', d: 'закрытый вопрос стр. 62 «без интернета»', f: ptsAdd(BIG_X[62]) },
    { id: 'noGone', d: 'принятый набросок стр. 66 «код один на всё»', f: ptsAdd(BIG_X[66]) },
    // Ловушка 3: отвеченный спор.
    { id: 'noGone', d: 'ловушка 3: заменённое стр. 74 «Предоплата 100%»', f: ptsAdd(BIG_X[74]) },
    { id: 'noGone', d: 'ловушка 3: отвеченный спор стр. 118 открытым', f: ptsAdd(BIG_X[118]) },
    // Ловушка 2: оспоренное как решённое.
    { id: 'noGone', d: 'ловушка 2: оспоренное стр. 83 «[решено] не сработал»', f: ptsAdd(BIG_X[83]) },
    { id: 'noGone', d: 'закрытый вопрос стр. 94 «кто пишет связку»', f: ptsAdd(BIG_X[94]) },
    { id: 'disputeLine', d: 'ловушка 2: спор стр. 184 подан [решено] по внутренней ссылке', f: viewEdit('- [открыто] что верно: Если код', '- [решено] что верно: Если код') },
    { id: 'disputeLine', d: 'спора стр. 184 нет', f: (s) => { s.files[s.view] = s.files[s.view].split('\n').filter((l) => !/что верно: Если код/.test(l)).join('\n'); return s } },
    { id: 'neighbors', edit: true, d: 'соседи спора стр. 84, 85 выкинуты со всей записью', f: (s) => { s.files[s.view] = sub(sub(s.files[s.view], BIG_X[84] + '\n', ''), BIG_X[85] + '\n', ''); return s } },
    { id: 'neighbors', edit: true, d: 'соседи отвеченного спора стр. 75–77 выкинуты', f: (s) => { for (const n of [75, 76, 77]) s.files[s.view] = sub(s.files[s.view], BIG_X[n] + '\n', ''); return s } },
    { id: 'expAsIs', d: 'число не из ноута', f: viewEdit('вместе 96 коек', 'вместе 120 коек') },
    { id: 'answerIn', d: 'ответ стр. 156 потерян', f: viewEdit(BIG_X[156] + '\n', '') },
    { id: 'thoughts', d: 'мысль стр. 150 подана открытой', f: viewEdit('- [мысль] Если без связи', '- [открыто] Если без связи') },
    { id: 'refsOk', d: 'концевая ссылка стр. 42 не та', f: viewEdit(BIG_X[42], BIG_X[42].replace('· 2026-09-23 №1', '· 2026-10-02 №1')) },
    { id: 'noLinksOut', d: '«вместо:» у стр. 126 в списке', f: viewEdit(BIG_X[126], BIG_X[126].replace(' · 2026-10-02 №1', '; вместо: 2026-09-23 №1 «Код от входной двери приходит постояльцу за сутки до заезда» · 2026-10-02 №1')) },
    { id: 'noAsk', d: 'вопрос, брать ли мысли', f: ansEdit(0, (a) => a + 'Мысли и наброски брать в список?\n') },
  ],
  'BIG-VIEW': [
    { id: 'files', d: 'лишний файл', f: addFile('notes/заселение-без-администратора/черновик.md') },
    { id: 'notebook', d: 'ноут дописан', f: (s) => { s.files[NB_BIG] = s.seed[NB_BIG] + '\n## 2026-10-14\n'; return s } },
    { id: 'viewFile', d: 'дата засева в имени', f: (s) => { const v = s.files[s.view]; delete s.files[s.view]; s.view = s.view.replace('2026-10-14', '2026-10-09'); s.files[s.view] = v; return s } },
    { id: 'checked', d: 'проверки субагентом нет', f: (s) => { s.streams[1] = s.streams[1].filter((e) => !e.includes('"name":"Agent"')); return s } },
    { id: 'vhead', d: 'нет «Собрано из ноута»', f: viewEdit(`> Собрано из ноута ${NB_BIG} на 2026-10-14. Правки — в ноут, выкладку пересобрать.\n`, '') },
    // Строка без ссылки красная, только если не прошла опору (решение 2026-10-16, критерий раунда).
    { id: 'refsRows', d: 'строка без ссылки: решение не из ноута («и на почту»)', f: viewEdit(BIG_ROW[43], BIG_ROW[43] + '\n| Код уходит и на почту | Калинкина В. | решено | |') },
    { id: 'refsRows', d: 'строка без ссылки: число не из ноута', f: viewEdit(BIG_ROW[43], BIG_ROW[43] + '\n| Код действует 48 часов | Калинкина В. | решено | |') },
    { id: 'winners', d: 'победитель стр. 126 потерян', f: viewEdit(BIG_ROW[126] + '\n', '') },
    { id: 'winners', d: 'принятый набросок стр. 144 подан наброском', f: viewEdit(BIG_ROW[144], BIG_ROW[144].replace('| решено |', '| мысль |')) },
    // Ловушка 2 / баг 2: оспоренное как решённое.
    { id: 'disputeOpen', d: 'баг 2: стр. 83 «диспетчер» подана «решено»', f: viewEdit(BIG_ROW[85], '| Если код не сработал, постоялец звонит на дежурный телефон, отвечает диспетчер в офисе | Калинкина В. | решено | 2026-09-29 №1 |\n' + BIG_ROW[85]) },
    // На текущей версии — по правке (решение 2026-10-16); строка пилота 2026-10-16 (run-1, стр. 28) дословно.
    { id: 'disputeMarked', edit: true, d: 'пилот 2026-10-16: стр. 83 «решено» с пометкой «расходится: открыт спор»', f: viewEdit(BIG_ROW[85], '| Если код не сработал, постоялец звонит на дежурный телефон, отвечает диспетчер в офисе (расходится: открыт спор, см. «Открыто») | решено (Калинкина В.) · 2026-09-29 №1 |\n' + BIG_ROW[85]) },
    { id: 'disputeMarked', edit: true, d: 'баг 2: стр. 83 «решено» с пометкой «расходится»', f: viewEdit(BIG_ROW[85], '| Если код не сработал — диспетчер в офисе (расходится с 2026-10-09 №1) | Калинкина В. | решено | 2026-09-29 №1 |\n' + BIG_ROW[85]) },
    { id: 'disputeOpen', d: 'спор 2026-10-09 №1 подан «решено»', f: viewEdit('| ждёт: Туманов А. | открыто, спор | 2026-10-09 №1 |', '| Туманов А. | решено | 2026-10-09 №1 |') },
    { id: 'noReplacedRow', d: 'ловушка 1: стр. 41 «за сутки» — «решено»', f: viewEdit(BIG_ROW[42], '| Код от входной двери приходит постояльцу за сутки до заезда | Калинкина В. | решено | 2026-09-23 №1 |\n' + BIG_ROW[42]) },
    { id: 'noReplacedRow', d: 'ловушка 3: стр. 74 «Предоплата 100%» — «решено»', f: viewEdit(BIG_ROW[76], '| Предоплата 100% при бронировании на сайте | Подгорный С. | решено | 2026-09-25 №1 |\n' + BIG_ROW[76]) },
    { id: 'noDraftDecided', d: 'набросок «один код на всё» 2026-09-24 №2 — «решено»', f: viewEdit(BIG_ROW[76], '| Код один на всё: входная дверь, комната и шкафчик | Калинкина В. | решено | 2026-09-24 №2 |\n' + BIG_ROW[76]) },
    { id: 'noDraftDecided', d: 'набросок «фото документа» 2026-10-12 №1 — «решено»', f: viewEdit(BIG_ROW[206], '| Фото документа постоялец загружает на сайте после бронирования | — | решено | 2026-10-12 №1 |\n' + BIG_ROW[206]) },
    { id: 'noClosedOpen', d: 'закрытый стр. 31 — «открыто»', f: viewEdit(BIG_ROW[206], BIG_ROW[206] + '\n| Как горничная узнаёт, какие койки освободились | ждёт: Шамрай З. | открыто | 2026-09-22 №1 |') },
    { id: 'noClosedOpen', d: 'закрытый стр. 62 — «открыто»', f: viewEdit(BIG_ROW[206], BIG_ROW[206] + '\n| Работают ли замки без интернета | ждёт: Гусейнов Э. | открыто | 2026-09-24 №1 |') },
    { id: 'noClosedOpen', d: 'закрытый стр. 94 — «открыто»', f: viewEdit(BIG_ROW[206], BIG_ROW[206] + '\n| Кто пишет связку PMS с облаком замков | ждёт: Туманов А. | открыто | 2026-09-29 №2 |') },
    { id: 'noClosedOpen', d: 'ловушка 3: отвеченный спор стр. 118 — «открыто»', f: viewEdit(BIG_ROW[206], BIG_ROW[206] + '\n| Предоплата 100% или 30% при бронировании | ждёт: Туманов А., Подгорный С. | открыто, спор | 2026-10-01 №2 |') },
    // Ловушка 4: подмена решившего.
    { id: 'decider', d: 'ловушка 4: стр. 15 — Калинкина из заголовка записи', f: viewEdit(BIG_ROW[15], BIG_ROW[15].replace('Туманов А.', 'Калинкина В.')) },
    { id: 'decider', d: 'ловушка 4: стр. 103 — Шамрай из заголовка записи', f: viewEdit(BIG_ROW[103], BIG_ROW[103].replace('| Калинкина В. |', '| Шамрай З. |')) },
    { id: 'decider', d: 'ловушка 4: стр. 156 — исполнитель Валиев вместо решившего', f: viewEdit(BIG_ROW[156], BIG_ROW[156].replace('| Туманов А. |', '| Валиев Р. |')) },
    { id: 'elemWords', d: 'время не из записи по ссылке', f: viewEdit('не заехали до 12:00 следующего дня', 'не заехали до 15:00 следующего дня') },
    { id: 'elemWords', d: 'в «ждёт:» человек не из записи по ссылке', f: viewEdit('| ждёт: Туманов А. | открыто, спор |', '| ждёт: Гусейнов Э. | открыто, спор |') },
    { id: 'neighbors', edit: true, d: 'сосед спора стр. 85 выкинут со всей записью', f: viewEdit(BIG_ROW[85] + '\n', '') },
  ],
  TWIN: [
    ...seededBad('цветы устанут — со слов Оганесян К.', 'цветы вянут — со слов Оганесян К.'), ...COMMON_BAD,
    { id: 'old', d: 'ловушка 2: правка стр. 13 «15» → «30»', f: nbEdit('с допуском плюс-минус 15 минут — решил: Дробышева Н.', 'с допуском плюс-минус 30 минут — решил: Дробышева Н.') },
    // Ловушка 3: поправка не туда.
    { id: 'fact35', d: 'ловушка 3: «25» осталось в пункте', f: nbEdit('опаздывали до 35 минут, на мостах и того больше — со слов', 'опаздывали до 25 минут, на мостах и того больше — со слов') },
    { id: 'quoteVerbatim', d: 'ловушка 3: «35» вписано в строку письма', f: nbEdit('> Посмотрели маршруты за прошлую неделю: в час пик доставщики опаздывали до 25 минут', '> Посмотрели маршруты за прошлую неделю: в час пик доставщики опаздывали до 35 минут') },
    { id: 'quoteVerbatim', d: 'строки письма под «>» нет', f: nbEdit('> А. Мельничук\n', '') },
    // Ловушка 2: спор, решённый наоборот.
    { id: 'noDecided30', d: 'ловушка 2: [решено] допуск 30 минут с «вместо:»', f: nbInsertItem('- [решено] Допуск доставки к точному времени — плюс-минус 30 минут — решил: Мельничук А.; вместо: 2026-10-07 №1 «Доставку к точному времени продаём»') },
    { id: 'noDecided30', d: '«что верно» после ответа «Старое»', f: nbInsertItem('- [открыто] что верно: плюс-минус 15 минут (Дробышева Н., 2026-10-07 №1) или плюс-минус 30 минут (Мельничук А.) — ждёт: —') },
    // Ловушка 1: выдуманный решивший.
    { id: 'callOpen', d: 'ловушка 1: звонок — «решил: Мельничук А.»', f: nbEdit('- [открыто] Доставщик звонит получателю за 10 минут до приезда, чтобы тот успел спуститься; решили на планёрке, кто решил — неизвестно — ждёт: —', '- [решено] Доставщик звонит получателю за 10 минут до приезда — решил: Мельничук А.') },
    { id: 'callOpen', d: 'звонок [открыто], но с «решил:»', f: nbEdit('кто решил — неизвестно — ждёт: —', 'решил: Мельничук А. — ждёт: —') },
    // Ловушка 4: ложная связь по основе.
    { id: 'noLinks', d: 'ловушка 4: «вместо:» на стр. 31 «В час пик доставщик успевает три адреса»', f: nbEdit('на мостах и того больше — со слов Мельничук А.', 'на мостах и того больше — со слов Мельничук А.; вместо: 2026-10-09 №1 «В час пик доставщик успевает три адреса»') },
    { id: 'noLinks', d: 'ловушка 4: «отвечает на:» стр. 32 — вопрос Мельничука', f: nbEdit('на мостах и того больше — со слов Мельничук А.', 'на мостах и того больше — со слов Мельничук А.; отвечает на: 2026-10-09 №1 «Сколько заказов к точному времени ставить одному доставщику в час»') },
    { id: 'noLinks', d: 'ловушка 4: «вместо:» на набросок стр. 36 «шаг 30 минут»', f: nbEdit('на мостах и того больше — со слов Мельничук А.', 'на мостах и того больше — со слов Мельничук А.; вместо: 2026-10-09 №2 «На сайте покупатель выбирает дату и время с шагом 30 минут»') },
    { id: 'invented', d: 'число не из письма и ответов', f: nbInsertItem('- [сведение] На адрес в час пик уходит 40 минут — со слов Мельничук А.') },
    { id: 'invented', d: 'имя только из ноута в тексте пункта', f: nbInsertItem('- [сведение] Жалобы на опоздания собирает Сазонов Ф. — со слов Мельничук А.') },
  ],
}

// Порчи проб «ноут по словам» (DESC-ONE, DESC-TWO, AUTO): запись в ноут «интеграция с АС Друг».
function descBad () {
  return [
    ...seededBad('АС Друг её только исполняет', 'АС Друг её исполняет'), ...COMMON_BAD,
    { id: 'files', d: 'третий ноут дописан', f: (s) => { s.files[NB_DUTY] = s.seed[NB_DUTY] + '\n## 2026-10-14\n'; return s } },
    { id: 'descItems', d: 'решения «по одной» нет', f: nbEdit('- [решено] Заявки отправляем по одной, сразу при создании, пакетом не копим — решил: Киселёв А.\n', '') },
    { id: 'descItems', d: 'решение без Киселёва', f: nbEdit('пакетом не копим — решил: Киселёв А.', 'пакетом не копим — решил: аналитик') },
    { id: 'descItems', d: 'пункта про номер нет', f: nbEdit('- [сведение] Номер заявки АС Друг возвращает сразу, в ответе на отправку — со слов Киселёв А.\n', '') },
  ]
}
// Вопрос о выборе ноута там, где основы сошлись у одного (DESC-ONE, AUTO).
function descPickBad () {
  return [
    { id: 'noPick', d: '«В какой ноут писать?»', f: ansEdit(0, (a) => 'Нашёл ноуты про АС Друг. В какой ноут писать?\n' + a) },
    { id: 'noPick', d: 'вопрос с чужим ноутом', f: ansEdit(0, (a) => 'Пишу в «интеграция с АС Друг» или в «отчётность АС Друг»?\n' + a) },
    { id: 'noPick', d: 'варианты списком с чужим ноутом', f: ansEdit(0, (a) => 'Куда пишу?\n1. интеграция с АС Друг — обмен заявками\n2. отчётность АС Друг — выгрузка отчётов\n' + a) },
    { id: 'files', d: 'запись в «отчётность АС Друг»', f: (s) => { s.files[NB_REP] = s.seed[NB_REP].replace(/\s+$/, '') + '\n\n' + s.files[NB_AS].slice(s.seed[NB_AS].replace(/\s+$/, '').length).replace(/^\s+/, ''); s.files[NB_AS] = s.seed[NB_AS]; return s } },
  ]
}

// Порчи выгрузки, общие для EXPORT и EXPORT-SINCE: строки, которые есть в обеих частях (записи с 2026-10-09).
function exportBad (first) {
  const pts = (s) => s.view
  const mv = (to) => (s) => { const v = s.files[pts(s)]; delete s.files[pts(s)]; s.view = to; s.files[to] = v; return s }
  return [
    { id: 'files', d: 'лишний файл', f: addFile('notes/возврат-товара-без-чека/черновик.md') },
    { id: 'notebook', d: 'ноут дописан', f: (s) => { s.files[NB_RET] = s.seed[NB_RET] + '\n## 2026-10-14\n'; return s } },
    { id: 'notebook', d: 'ноут переписан в CRLF', f: (s) => { s.files[NB_RET] = s.seed[NB_RET].replace(/\n/g, '\r\n'); return s } },
    { id: 'ptsFile', d: 'имя не notebook-<дата>.points.md', f: mv('notes/возврат-товара-без-чека/пункты-2026-10-14.md') },
    { id: 'ptsFile', d: 'список не в папке ноута', f: mv('coddoc/_inbox/notebook-2026-10-14.points.md') },
    { id: 'ptsFile', d: 'дата засева в имени', f: mv('notes/возврат-товара-без-чека/notebook-2026-10-09.points.md') },
    { id: 'checked', d: 'проверки субагентом нет', f: (s) => { s.streams[0] = s.streams[0].filter((e) => !e.includes('"name":"Agent"')); return s } },
    { id: 'ptsHead', d: 'нет «# Пункты:»', f: viewEdit('# Пункты: возврат товара без чека\n', '') },
    { id: 'ptsHead', d: 'ключ выдуман', f: viewEdit('> Задача: —', '> Задача: RET-1') },
    { id: 'ptsHead', d: 'источник без пути к ноуту', f: viewEdit('> Источник: notes/возврат-товара-без-чека/notebook.md', '> Источник: ноут') },
    { id: 'range', d: 'нет «> Ноут:»', f: viewEdit(`> Ноут: возврат товара без чека · записи ${first}–2026-10-10\n`, '') },
    { id: 'range', d: 'последняя дата не та', f: viewEdit(`${first}–2026-10-10`, `${first}–2026-10-09`) },
    { id: 'complete', d: 'действующий пункт потерян', f: viewEdit('- [сведение] Возврат на карту идёт через банк, покупатели ждут и звонят — со слов Соколова М. · 2026-10-09 №1\n', '') },
    { id: 'expAsIs', d: 'пункт пересказан', f: viewEdit('покупатели ждут и звонят — со слов Соколова М.', 'покупатели долго ждут денег — со слов Соколова М.') },
    { id: 'expAsIs', d: 'свой пункт', f: viewEdit('- [решено] Деньги', '- [решено] Возврат без чека — только в будние дни — решил: Соколова М. · 2026-10-09 №1\n- [решено] Деньги') },
    { id: 'answerIn', d: 'ответа нет', f: viewEdit('- [решено] Акт возврата без чека подписывает старший кассир смены — решил: Гарипова Л. · 2026-10-10 №1\n', '') },
    { id: 'thoughts', d: 'мысль потеряна в выгрузке', f: viewEdit('- [мысль] Может, акт печатать прямо на кассе, без бумажного бланка? · 2026-10-10 №2\n', '') },
    { id: 'thoughts', d: 'мысль подана открытым вопросом', f: viewEdit('- [мысль] Может, акт печатать', '- [открыто] Может, акт печатать') },
    { id: 'thoughts', d: 'набросок подан решением', f: viewEdit('- [мысль] Отчёт по возвратам', '- [решено] Отчёт по возвратам') },
    { id: 'refsOk', d: 'неверная ссылка «дата №»', f: viewEdit('без бумажного бланка? · 2026-10-10 №2', 'без бумажного бланка? · 2026-10-10 №1') },
    { id: 'refsOk', d: 'ссылки нет', f: viewEdit('звонят — со слов Соколова М. · 2026-10-09 №1', 'звонят — со слов Соколова М.') },
    { id: 'noLinksOut', d: '«вместо:» в выгрузке', f: viewEdit('на карту не возвращаем — решил: Соколова М. · 2026-10-09 №1', 'на карту не возвращаем — решил: Соколова М.; вместо: 2026-10-07 №1 «Возврат только на карту, с которой платили» · 2026-10-09 №1') },
    { id: 'noLinksOut', d: '«отвечает на:» в выгрузке', f: viewEdit('старший кассир смены — решил: Гарипова Л. · 2026-10-10 №1', 'старший кассир смены — решил: Гарипова Л.; отвечает на: 2026-10-08 №1 «Кто подписывает акт возврата без чека» · 2026-10-10 №1') },
    { id: 'noAsk', d: 'вопрос, брать ли мысли', f: ansEdit(0, (a) => a + 'Мысли и наброски брать в список?\n') },
    { id: 'noAsk', d: 'вопрос, включать ли наброски', f: ansEdit(0, (a) => 'Наброски аналитика включать — или только решения и вопросы?\n' + a) },
    // /notes-to-intent читает пунктом только строку `- [`.
    { id: 'ptsLines', d: 'пункты строками «1. [решено]»', f: (s) => { let k = 0; s.files[pts(s)] = s.files[pts(s)].replace(/^- \[/gm, () => `${++k}. [`); return s } },
    { id: 'ptsLines', d: 'пункты строками «* [Решено]»', f: (s) => { s.files[pts(s)] = s.files[pts(s)].replace(/^- \[(.)/gm, (m, a) => '* [' + a.toUpperCase()); return s } },
    { id: 'ptsLines', d: 'пункты с отступом', f: (s) => { s.files[pts(s)] = s.files[pts(s)].replace(/^- \[/gm, '  - ['); return s } },
    { id: 'ptsLines', d: 'один пункт строкой «* [сведение]»', f: viewEdit('- [сведение] Возврат на карту', '* [сведение] Возврат на карту') },
    { id: 'expAsIs', d: 'число в пункте не из ноута', f: viewEdit('кто подписал акт · 2026-10-10 №2', 'кто подписал акт, 3 копии · 2026-10-10 №2') },
  ]
}

// Законные варианты — обязаны остаться зелёными.
const OK_VARIANTS = {
  NEW: [
    { d: '«решила:»', f: nbEdit('решил: Соколова М.', 'решила: Соколова М.') },
    { d: 'разделитель «—» в заголовке записи', f: nbEdit('### 1 ·', '### 1 —') },
    { d: 'файлы с точкой и стенда не лишние', f: (s) => { s.files['_stderr.log'] = 'x'; s.files['.claude/settings.local.json'] = '{}'; return s } },
    { d: 'новый ноут с BOM — шапка читается', f: (s) => { s.files[NB_RET] = '﻿' + s.files[NB_RET]; return s } },
    { d: 'Write ноута на ходу 2', f: (s) => { s.streams[1].push(ev('Write', { file_path: SB + NB_RET, content: '…' })); return s } },
    // 1.2.0: «о чём» — словами темы ноута тоже законно; «—» — предупреждение.
    { d: '«о чём» словами темы («товар» есть только в теме)', f: nbEdit(ABOUT_NEW, 'о чём: возврат товара без чека: покупка в истории по карте лояльности') },
    { d: '«о чём: —» — предупреждение', warn: /о чём: —/, f: nbEdit(ABOUT_NEW, 'о чём: —') },
    { d: '«о чём» со служебными словами «между», «через»', f: nbEdit(ABOUT_NEW, 'о чём: возвраты без чека через историю покупок по карте лояльности; между Соколовой М. и юристами') },
    // Круг 4, nb-new run-1 и run-2 — дословно: общие слова не из текста — не выдумка факта.
    { d: '«о чём» общими словами (круг 4, run-1)', f: nbEdit(ABOUT_NEW, 'о чём: правила возврата товара без чека, что отвечать покупателям, роль карты лояльности') },
    { d: '«о чём» общими словами и именами из текста (круг 4, run-2)', f: nbEdit(ABOUT_NEW, 'о чём: возврат товара без чека, проверка покупки по карте лояльности на кассе; Соколова М., Ильин П., Дёмин К., Гарипова Л.') },
    { d: '«о чём» с заглавной в начале фразы', f: nbEdit(ABOUT_NEW, 'о чём: Правила и процесс возврата без чека для магазинов розничной сети') },
  ],
  THOUGHT: [
    { d: 'шапка ноута изменена — предупреждение', f: nbEdit('цель: —', 'цель: разобрать возвраты без чека') },
    { d: '[открыто] рядом с мыслью', f: nbInsertItem('- [открыто] Куда возвращать деньги при оплате подарочной картой — ждёт: —') },
    // `2>/dev/null` и tee во временный файл на ходу 1 — не запись ноута.
    { d: 'grep ноута с 2>/dev/null и tee в /tmp на ходу 1', f: (s) => { s.streams[0].push(ev('Bash', { command: `grep -n "^- \\[" "${NB_RET}" 2>/dev/null; tail -n 3 "${NB_RET}" | tee /tmp/last.txt` })); return s } },
    { d: 'cp ноута в /tmp на ходу 1', f: (s) => { s.streams[0].push(ev('Bash', { command: `cp "${NB_RET}" /tmp/notebook.md.bak` })); return s } },
    { d: 'дозапись через cat >> на ходу 2', f: (s) => { s.streams[1].push(ev('Bash', { command: `cat >> "${NB_RET}" <<'EOF'\n## 2026-10-14\nEOF` })); return s } },
  ],
  CONTRA: [
    { d: '«Всё верно?» вместо «Записать так?»', f: ansEdit(0, (a) => sub(a, 'Записать так или поправить?', 'Всё верно?')) },
    { d: '«если что-то неверно — поправлю»', f: ansEdit(0, (a) => sub(a, 'Записать так или поправить?', 'Если что-то неверно — поправлю. Записать?')) },
    { d: 'мета-строка: вопрос «что действует» в кавычках', f: ansEdit(0, (a) => sub(a, 'Записать так или поправить?', 'Тот же человек — вопрос «что действует» не задаю. Записать так или поправить?')) },
    { d: '«Правильно?»', f: ansEdit(0, (a) => sub(a, 'Записать так или поправить?', 'Правильно?')) },
    { d: '«подтвердите замену?»', f: ansEdit(0, (a) => sub(a, 'Записать так или поправить?', 'Подтвердите замену — записываю?')) },
    { d: 'после номера — начало старого пункта в кавычках', f: nbEdit('вместо: 2026-10-08 №1.2 · ', 'вместо: 2026-10-08 №1.2 «Возврат только на карту, с которой платили» · ') },
    { d: 'отчёта о замене нет — предупреждение', warn: /строки о замене/, f: ansEdit(1, () => 'Записал.\n') },
    // Вопрос Шага 5 о самой записи — не «что верно».
    { d: '«Всё, что выше, — верно?»', f: ansEdit(0, (a) => sub(a, 'Записать так или поправить?', 'Всё, что выше, — верно?')) },
    { d: '«Что записываю — верно?»', f: ansEdit(0, (a) => sub(a, 'Записать так или поправить?', 'Что записываю — верно?')) },
    { d: 'кавычки "…" после номера', f: nbEdit('вместо: 2026-10-08 №1.2 · ', 'вместо: 2026-10-08 №1.2 "Возврат только на карту, с которой платили" · ') },
    { d: 'ссылка «2026-10-08, №1.2» в «вместо:»', f: nbEdit('вместо: 2026-10-08 №1.2', 'вместо: 2026-10-08, №1.2') },
    // Снимок засева: рабочая копия с `core.autocrlf` засеяла ноут в CRLF, а фикстура — LF; запись дописана в LF.
    { d: 'засев в CRLF, снимок `_seeded.sha256`', f: seedCrlfOk },
    { d: 'засев в CRLF, снимок в форме Windows « *»', f: (s) => { s.shaStar = true; return seedCrlfOk(s) } },
    { d: 'засев в CRLF, снимка нет — сверка по LF-тексту', f: (s) => { s.noSha = true; return seedCrlfOk(s) } },
  ],
  DISPUTE: [
    { d: '«Что верно:» с заглавной', f: nbEdit('- [открыто] что верно:', '- [открыто] Что верно:') },
    { d: '«ждёт: Соколова М. (розница)»', f: nbEdit('— ждёт: Соколова М. · 2026-10-14 №1.1', '— ждёт: Соколова М. (розница) · 2026-10-14 №1.1') },
    { d: 'вопрос «новое, старое или в открытые?»', f: ansEdit(0, (a) => sub(a, 'Что действует — новое, старое или спор в открытые (кто решает)?', 'Новое, старое или в открытые — и кто решает?')) },
    { d: 'без имени Гариповой в «что верно» — предупреждение', warn: /нет Гариповой/, f: nbEdit(' (Гарипова Л.) — ждёт', ' — ждёт') },
    { d: '[решено] не про деньги', f: nbInsertItem('- [решено] Кассирам о порядке сообщит бухгалтерия — решил: Соколова М.') },
    { d: 'два «что верно» — предупреждение', warn: /«что верно» в записи: 2/, f: nbInsertItem('- [открыто] Что верно: только на карту (Соколова М.) или наличными (Гарипова Л.) — ждёт: Соколова М.') },
    // Хвосты спора 1.1.0 — с именами из ноута, которых нет в письме и реплике.
    { d: 'в «ждёт:» спора второе имя из ноута', f: nbEdit('— ждёт: Соколова М. · 2026-10-14 №1.1', '— ждёт: Соколова М., Ильин П. · 2026-10-14 №1.1') },
    { d: 'скобка спора «(решил: Соколова М., 2026-10-08 №1.2)»', f: nbEdit('(Соколова М., 2026-10-08 №1.2)', '(решил: Соколова М., 2026-10-08 №1.2)') },
    { d: 'в скобке спора автор из ноута не из письма', f: nbEdit('(Соколова М., 2026-10-08 №1.2)', '(Соколова М. и Ильин П., 2026-10-08 №1.2)') },
  ],
  ANSWER: [
    { d: 'пункт [сведение]', f: nbEdit('- [решено] Акт возврата без чека подписывает старший кассир смены, директор магазина не нужен — решил: Гарипова Л.;', '- [сведение] Акт возврата без чека подписывает старший кассир смены, директор магазина не нужен — со слов Гарипова Л.;') },
    { d: 'после номера — начало вопроса в кавычках', f: nbEdit('отвечает на: 2026-10-09 №1.2 · ', 'отвечает на: 2026-10-09 №1.2 «Кто подписывает акт» · ') },
    { d: '«Записать так?» и «решил Гарипова?»', f: ansEdit(0, (a) => a + 'п.1: решил Гарипова Л.? Записать так?\n') },
    { d: 'ссылка «2026-10-09, №1.2» в «отвечает на:»', f: nbEdit('отвечает на: 2026-10-09 №1.2', 'отвечает на: 2026-10-09, №1.2') },
  ],
  ASK: [
    { d: 'ответ на ходу 2 (ход 1 — вопрос о ноуте)', f: (s) => { s.answers = ['Отвечаю по ноуту «возврат товара без чека»?\n', s.answers[0]]; return s } },
    { d: 'заменённое с пометкой «Раньше»', f: ansEdit(0, (a) => sub(a, '· 2026-10-09 №1.\n', '· 2026-10-09 №1.\nРаньше — только на карту, с которой платили (2026-10-07 №1), заменено 2026-10-09 №1.\n')) },
    { d: 'заменённое под строкой «Было:»', f: ansEdit(0, (a) => sub(a, '· 2026-10-09 №1.\n', '· 2026-10-09 №1.\nБыло:\n- Возврат только на карту, с которой платили · 2026-10-07 №1\n')) },
    { d: 'закрытый вопрос назван закрытым', f: ansEdit(0, (a) => sub(a, '· 2026-10-10 №1.\n', '· 2026-10-10 №1.\nВопрос про акт был открытым (2026-10-08 №1, ждали Гарипову Л.) — закрыт.\n')) },
    // Круг 5, run-1: короткий ответ сверху, опора ниже — «наличными» и ссылка в разных строках; «Закрыло открытый вопрос».
    { d: 'короткий ответ + опора, «Закрыло открытый вопрос»', f: (s) => { s.answers = ['1. **Куда возвращаем деньги:** наличными на кассе.\n2. **Кто подписывает акт:** старший кассир смены.\n3. **Сколько дней:** спор, 14 или 30 дней. Не выбираю.\n4. **Лимит по сумме:** в ноуте нет.\n\n**Опора**\n- Деньги: `решено (Соколова М.)`, 2026-10-09 №1. Заменило прежнее «только на карту, с которой платили» (2026-10-07 №1).\n- Акт: `решено (Гарипова Л.)`, 2026-10-10 №1. Закрыло открытый вопрос 2026-10-08 №1.\n- Срок: спор — 14 дней (Ильин П.) или 30 дней (Соколова М.), открыто, ждёт: Белов С. · 2026-10-10 №2.\n- Лимит по сумме: в ноуте нет.\n']; return s } },
    { d: '«итог: спор между 14 и 30 днями»', f: ansEdit(0, (a) => sub(a, 'Спор, не решён:', 'Итог: спор между 14 и 30 днями.')) },
    { d: '«действующего решения нет: спор»', f: ansEdit(0, (a) => sub(a, 'Спор, не решён:', 'Действующего решения нет: спор.')) },
    { d: 'сводка первой строкой, лимит последним', f: ansEdit(0, (a) => 'Коротко: деньги — наличными на кассе; акт — старший кассир смены; дни — спор, 14 или 30 дней; лимита по сумме в ноуте нет.\n\n' + a) },
    { d: 'сводка первой строкой, лимит первым', f: ansEdit(0, (a) => 'Коротко: лимита по сумме в ноуте нет; деньги — наличными на кассе; дни — спор, 14 или 30 дней.\n\n' + a) },
    { d: 'вопрос «что действует — 14 или 30 дней?»', f: ansEdit(0, (a) => sub(a, 'Спор, не решён:', 'Что действует — 14 или 30 дней? Спор, не решён:')) },
    { d: '«ни 14, ни 30 дней не действуют, пока не решит Белов»', f: ansEdit(0, (a) => sub(a, 'Спор, не решён:', 'Спор: ни 14, ни 30 дней не действуют, пока не решит Белов С.;')) },
    { d: 'спор списком', f: ansEdit(0, (a) => sub(a, 'Спор, не решён: 14 дней — решено (Ильин П.) · 2026-10-08 №2; 30 дней — Соколова М. · 2026-10-10 №2. Открыто, ждёт: Белов С. (директор розницы).', 'Спор, не решён (ждёт: Белов С.):\n- 14 дней — решено (Ильин П.) · 2026-10-08 №2\n- 30 дней — Соколова М. · 2026-10-10 №2')) },
    { d: 'таблица', f: ansEdit(0, () => '| Вопрос | Ответ | Пункт |\n|---|---|---|\n' +
      '| Куда возвращаем деньги | наличными на кассе, на карту не возвращаем — решено (Соколова М.) | 2026-10-09 №1 |\n' +
      '| Кто подписывает акт | старший кассир смены — решено (Гарипова Л.) | 2026-10-10 №1 |\n' +
      '| Сколько дней | спор: 14 дней (Ильин П.) или 30 дней (Соколова М.) — открыто, ждёт: Белов С. | 2026-10-08 №2, 2026-10-10 №2 |\n' +
      '| Лимит по сумме | в ноуте нет | — |\n') },
    { d: '«4. Есть ли лимит по сумме? Про лимит в ноуте ничего нет»', f: ansEdit(0, (a) => sub(a, '**Лимит по сумме.** В ноуте нет.', '**4. Есть ли лимит по сумме?** Про лимит по сумме в ноуте ничего нет.')) },
    { d: 'ссылки «дата, №»', f: ansEdit(0, (a) => a.replace(/(\d{4}-\d{2}-\d{2}) №/g, '$1, №')) },
    { d: 'сводка «акт — кассир смены; дни — открыто, ждёт: Белов С.»', f: ansEdit(0, (a) => 'Коротко: деньги — наличными; акт — кассир смены (Гарипова Л.); дни — открыто, ждёт: Белов С.; лимита в ноуте нет.\n\n' + a) },
    // Ходы встык в answer.md: строка «лимит» хода 1 и число хода 2 — не одна строка.
    { d: 'ход 1 без перевода строки, в ходе 2 число', f: (s) => { s.answers[0] = s.answers[0].replace(/\n$/, ''); s.answers[1] = 'Хорошо, ничего не записываю: все 4 ответа выше.\n'; return s } },
  ],
  LONG: [
    { d: 'исходник с заголовком — предупреждение', warn: /лишних строк/, f: (s) => { s.files[s.src] = '# Исходник: чат про обмен без чека, 2026-10-14 №1\n\n' + s.files[s.src]; return s } },
    { d: 'исходник строками «> »', f: (s) => { s.files[s.src] = s.files[s.src].split('\n').map((l) => (l ? '> ' + l : l)).join('\n'); return s } },
    { d: 'путь в обратных кавычках', f: nbEdit('> исходник: sources/2026-10-14-1.md', '> исходник: `sources/2026-10-14-1.md`') },
    { d: 'путь от корня', f: nbEdit('> исходник: sources/2026-10-14-1.md', '> исходник: notes/возврат-товара-без-чека/sources/2026-10-14-1.md') },
    { d: 'путь ссылкой markdown', f: nbEdit('> исходник: sources/2026-10-14-1.md', '> исходник: [sources/2026-10-14-1.md](sources/2026-10-14-1.md)') },
    { d: 'три строки вставки под пунктами', f: nbEdit('> исходник: sources/2026-10-14-1.md\n', pasteLines(FX.LONG).slice(50, 53).map((l) => '> ' + l).join('\n') + '\n> исходник: sources/2026-10-14-1.md\n') },
  ],
  NOAUTH: [
    { d: 'кандидат из прошлых записей гипотезой в вопросе', f: ansEdit(0, (a) => a.replace(/п\.1: кто решил[^\n]*\n/, 'п.1: кто решил? В прошлых записях решения по возвратам принимала Соколова М. — она? Или «не знаю» — тогда в открытые.\n')) },
    { d: '«Кто принял это решение?»', f: ansEdit(0, (a) => a.replace('п.1: кто решил? Не знаете — запишу в открытые.', 'Кто принял это решение? Если не знаете — запишу в открытые.')) },
    { d: 'вопрос без «?»: «Кто решил, из текста не видно — назовите»', f: ansEdit(0, (a) => a.replace('п.1: кто решил? Не знаете — запишу в открытые.', 'Кто решил, из текста не видно — назовите или ответьте «не знаю», тогда в открытые.')) },
    { d: 'заглушка «решил: ?» в пункте и вопрос строкой ниже', f: ansEdit(0, (a) => a.replace('1. Товар на возврат принимает склад, а не магазин — договорились', '1. [решено] Товар на возврат принимает склад, а не магазин — решил: ?')) },
    { d: '«решил: неизвестно» в открытом', f: nbEdit('договорились, кто решил — неизвестно — ждёт: —', 'договорились; решил: неизвестно — ждёт: —') },
  ],
  FILE: [
    { d: 'ls и Glob по calls/ — не чтение', f: (s) => { s.streams[0].push(ev('Bash', { command: 'ls -la calls/ docs-in/' }), ev('Glob', { pattern: 'calls/2026-10-10-sklad.vtt' })); return s } },
    { d: 'путь в обратных кавычках в заголовке', f: nbEdit('### 1 · файл docs-in/reglament.pdf', '### 1 · файл `docs-in/reglament.pdf`') },
    { d: 'дозапись ноута через cat >> с путём pdf в heredoc (ход 2)', f: (s) => { s.streams[1].push(ev('Bash', { command: "cat >> \"notes/возврат-товара-без-чека/notebook.md\" <<'EOF'\n### 1 · файл docs-in/reglament.pdf\n> регламент docs-in/reglament.pdf\nEOF\ntail -n 8 notes/x/notebook.md" })); return s } },
    { d: 'дозапись PowerShell here-string с путём pdf (ход 2)', f: (s) => { s.streams[1].push(ev('PowerShell', { command: "Add-Content -Path notes/возврат-товара-без-чека/notebook.md -Encoding utf8 -Value @'\n### 1 · файл docs-in/reglament.pdf\n> cat docs-in/reglament.pdf\n'@" })); return s } },
    { d: 'ls pdf && cat ноута — чтение ноута, не pdf', f: (s) => { s.streams[0].push(ev('Bash', { command: 'ls -la docs-in/reglament.pdf && cat notes/возврат-товара-без-чека/notebook.md' })); return s } },
    { d: 'Grep по notes/ без glob', f: (s) => { s.streams[0].push(ev('Grep', { pattern: 'склад', path: 'notes/' })); return s } },
    { d: 'пункт файла словами «описан»', f: nbEdit('Регламент возвратов: в нём порядок приёмки на складе', 'В регламенте возвратов описан порядок приёмки на складе') },
    { d: 'пункт файла словами темы ноута', f: nbEdit('Регламент возвратов: в нём порядок приёмки на складе', 'Регламент возвратов товара без чека: в нём порядок приёмки на складе') },
    { d: 'хвост «(со слов аналитика)» в скобках', f: nbEdit('в нём порядок приёмки на складе — со слов аналитика', 'в нём порядок приёмки на складе (со слов аналитика)') },
    // 1.2.0: «в ноут» больше не требуется; старая форма 1.1.0 — предупреждение, без «/analyst-notebook» — тоже.
    { d: 'старая форма «… в ноут» — предупреждение', warn: /старой формой/, f: ansEdit(0, (a) => sub(a, '`/meeting-intake calls/2026-10-10-sklad.vtt`, потом `/analyst-notebook возврат-товара-без-чека <список>`', '`/meeting-intake calls/2026-10-10-sklad.vtt в ноут возврат товара без чека`')) },
  ],
  'VIEW-API': [
    // Решение пользователя 2026-10-15: черновик в файле выкладки до проверки, проверка после последней правки — законно.
    { d: 'черновик записан в файл до проверки', f: (s) => { s.streams[1] = [s.streams[1][2], s.streams[1][0], s.streams[1][1]]; return s } },
    { d: 'таблица', f: (s) => { s.files[s.view] = s.files[s.view].replace(/^- (GET|POST) (\S+) — ([^—]+) — ([^·]+) · (.+)$/gm, '| $1 | $2 | $3 | $4 | $5 |'); return s } },
    { d: 'ручки подразделами', f: (s) => { s.files[s.view] = s.files[s.view].replace(/^- (GET|POST) (\S+) — ([^—]+) — ([^·]+) · (.+)$/gm, '### $1 $2\n- $3 — $4 · $5\n'); return s } },
    { d: 'путь A на строке B с «вместо»', f: viewEdit('номер начисления в теле — решено (Белкина Т.)', 'номер начисления в теле, вместо POST /bonus/cancel — решено (Белкина Т.)') },
    { d: 'пояснение с префиксом /partners/{partnerId} без ссылки', f: viewEdit('## Ручки\n', '## Ручки\nВсе ручки — под /partners/{partnerId}.\n') },
    { d: 'путь A зачёркнут', f: viewEdit('## Кто вызывает', '- ~~POST /bonus/cancel~~ · 2026-10-06 №2\n\n## Кто вызывает') },
    { d: 'пути в обратных кавычках', f: (s) => { s.files[s.view] = s.files[s.view].replace(/^- (GET|POST) (\S+) —/gm, '- `$1 $2` —'); return s } },
    { d: 'путь наброска в открытом вопросе', f: viewEdit('- Что отвечать при списании,', '- Что отвечать при списании (POST /partners/{partnerId}/redemptions),') },
    { d: 'ссылка на строке продолжения', f: viewEdit('— подписка партнёра на события — мысль · 2026-10-08 №1', '— подписка партнёра на события\n  набросок · 2026-10-08 №1') },
    { d: 'ручка на вложенной строке, ссылка на строке пункта', f: viewEdit('- POST /partners/{partnerId}/webhooks — подписка партнёра на события — мысль · 2026-10-08 №1', '- Подписка партнёра на события — мысль · 2026-10-08 №1\n  - POST /partners/{partnerId}/webhooks') },
    { d: 'пути от префикса, названного в выкладке', f: (s) => { s.files[s.view] = sub(s.files[s.view], '## Ручки\n', '## Ручки\nВсе ручки — под /partners/{partnerId}.\n').replace(/^- (GET|POST) \/partners\/\{partnerId\}\//gm, '- $1 /'); return s } },
    { d: 'ссылки «дата, №»', f: (s) => { s.files[s.view] = s.files[s.view].replace(/(\d{4}-\d{2}-\d{2}) №/g, '$1, №'); return s } },
    { d: 'пути в «**…**»', f: (s) => { s.files[s.view] = s.files[s.view].replace(/^- (GET|POST) (\S+) —/gm, '- **$1** **$2** —'); return s } },
    { d: '«наброски», «из наброска»', f: (s) => { s.files[s.view] = s.files[s.view].replace('списание бонусов при оплате — мысль', 'списание бонусов при оплате — из наброска аналитика').replace('история операций клиента — мысль', 'история операций клиента — наброски'); return s } },
    { d: 'ручки нумерованным списком (номера — не числа элемента)', f: (s) => { let k = 0; s.files[s.view] = s.files[s.view].replace(/^- (GET|POST)/gm, (m, x) => `${++k}. ${x}`); return s } },
    { d: 'Write выкладки после проверки, черновик для проверки — другим файлом', f: (s) => { s.streams[1].unshift(ev('Write', { file_path: SB + dirname(NB_API) + '/draft-check.tmp', content: '…' })); return s } },
    { d: 'метки «Ручка 1», «**2.**» у ручек', f: (s) => { let k = 0; s.files[s.view] = s.files[s.view].replace(/^- (GET|POST)/gm, (m, x) => (++k === 1 ? `- Ручка 1: ${x}` : `- **${k}.** ${x}`)); return s } },
  ],
  'VIEW-CHAT': [
    { d: 'ссылка на следующей строке', f: ansEdit(1, (a) => a.replace(/ — мысль · 2026-10-08 №1/g, '\n   мысль · 2026-10-08 №1')) },
    { d: '«нет ни одного пункта про сроки»', f: ansEdit(1, (a) => sub(a, 'В ноуте нет.', 'Ни одного пункта про сроки — нет в ноуте.')) },
    { d: 'имя файла с датой рядом со сроками', f: ansEdit(1, (a) => sub(a, 'В ноуте нет.', 'В ноуте нет.\nКуда: файлом или в чат? Рекомендую файлом: `notes/x/user-stories-2026-10-14.md`.')) },
    // Дата прогона — дата изменения answer.md (в самопроверке 2026-10-14), а не окно дат.
    { d: '«выкладка собрана из ноута … на <дата прогона>» рядом со сроками', f: ansEdit(1, (a) => sub(a, 'В ноуте нет.', `В ноуте нет. Выкладка собрана из ноута \`${NB_API}\` на 2026-10-14.`)) },
    { d: 'история в несколько строк под своим заголовком', f: ansEdit(1, (a) => sub(a, '1. Как партнёр, хочу видеть баланс клиента на кассе, чтобы сразу предложить оплатить покупку бонусами — мысль · 2026-10-08 №1\n', '### 1. Баланс на кассе\nКак партнёр, хочу видеть баланс клиента на кассе,\nчтобы сразу предложить оплатить покупку бонусами.\nнабросок · 2026-10-08 №1\n\n### Остальные\n')) },
    { d: 'вид и ссылка вложенными пунктами', f: ansEdit(1, (a) => sub(a, '1. Как партнёр, хочу видеть баланс клиента на кассе, чтобы сразу предложить оплатить покупку бонусами — мысль · 2026-10-08 №1\n', '1. Как партнёр, хочу видеть баланс клиента на кассе, чтобы сразу предложить оплатить покупку бонусами.\n   - вид: набросок\n   - пункт: 2026-10-08 №1\n')) },
    { d: 'ход 1 без перевода строки в конце', f: ansEdit(0, (a) => a.replace(/\n$/, '')) },
    { d: 'после выкладки ход с одной ссылкой', f: (s) => { s.answers[2] = 'Выкладка выше; истории — из 2026-10-08 №1.\n'; return s } },
    { d: 'ссылки «дата, №»', f: ansEdit(1, (a) => a.replace(/(\d{4}-\d{2}-\d{2}) №/g, '$1, №')) },
    // Метки нумерации и латиница формы — не факты элемента.
    { d: 'метки «**US-1.**», «История 2:»', f: ansEdit(1, (a) => a.replace('1. Как партнёр, хочу видеть', '**US-1.** Как партнёр, хочу видеть').replace('2. Как партнёр, хочу получать', 'История 2: Как партнёр, хочу получать')) },
  ],
  'VIEW-PART': [
    { d: 'Mermaid с латинскими именами узлов', f: viewEdit(VP_LIST, VP_MERMAID.replace(/\bP\b/g, 'Partner').replace(/\bA\b/g, 'BonusAPI').replace(/\bK\b/g, 'Kassa').replace(/\bM\b/g, 'MobileApp').replace(/\bU\b/g, 'Ledger')) },
    { d: 'ссылки «дата, №»', f: (s) => { s.files[s.view] = s.files[s.view].replace(/(\d{4}-\d{2}-\d{2}) №/g, '$1, №'); return s } },
    { d: 'Mermaid flowchart с узлами', f: viewEdit(VP_LIST, VP_MERMAID) },
    { d: 'Mermaid sequenceDiagram', f: viewEdit(VP_LIST, VP_SEQ) },
    { d: 'таблица «откуда — куда — что»', f: viewEdit(VP_LIST, VP_TABLE) },
    { d: 'подразделы со стрелкой в заголовке', f: viewEdit(VP_LIST, VP_HEADS) },
    { d: 'строка о записях вне части с их ссылками', f: viewEdit('## Кто кому что передаёт\n', '## Кто кому что передаёт\nЗаписи 2026-10-06 №1 и 2026-10-07 №1 не вошли — они до 2026-10-08.\n') },
    { d: '«вне среза» со ссылками на записи до части', f: viewEdit('## Кто кому что передаёт\n', '## Кто кому что передаёт\nВне среза: 2026-10-06 №1, 2026-10-06 №2, 2026-10-07 №1.\n') },
    { d: 'ASCII-стрелка «──▶» без глагола', f: viewEdit('## Открыто', 'Касса партнёра ◀── баланс клиента (мысль · 2026-10-08 №1) ── Наш API\n\n## Открыто') },
    { d: 'легенда со стрелкой', f: viewEdit('## Кто кому что передаёт\n', '## Кто кому что передаёт\nЛегенда: A → B — A передаёт B.\n') },
    { d: '«почти», «в первую очередь» — не участники', f: viewEdit('## Кто кому что передаёт\n', '## Кто кому что передаёт\nПочти все обмены идут через наш API, в первую очередь — списания.\n') },
    { d: 'список участников без ссылки', f: viewEdit('## Кто кому что передаёт\n', '## Кто кому что передаёт\nУчастники: партнёр, касса партнёра, мобильное приложение партнёра, наш API, учётная система бонусов.\n') },
    { d: 'списание с кассой — предупреждение', warn: /списание с кассой/, f: viewEdit('## Открыто', '- Касса партнёра → наш API: списание бонусов при оплате (POST /partners/{partnerId}/redemptions) — мысль · 2026-10-08 №1\n\n## Открыто') },
    // Круг 4 (2026-10-15): шапка таблицы со стрелкой и строка раздела «В ноуте нет» со стрелкой — не связи.
    { d: 'таблица с шапкой «| Кто → кому | Что передаёт | Статус |» (круг 4, run-1)', f: viewEdit(VP_LIST, '| Кто → кому | Что передаёт | Статус |\n|---|---|---|\n' +
      '| Наш API → партнёру (на адрес из его подписки) | вебхук о каждом списании бонусов — решено (Белкина Т.) · 2026-10-10 №1 | решено |\n' +
      '| Мобильное приложение партнёра → наш API | запрос истории операций клиента напрямую — сведение (со слов Ахмедов Р.) · 2026-10-10 №1 | сведение |\n' +
      '| Наш API → учётная система бонусов | каждое списание; балансы клиентов хранятся там — сведение (со слов Белкина Т.) · 2026-10-10 №1 | сведение |\n' +
      '| Партнёр → наш API | подписка партнёра на события: POST /partners/{partnerId}/webhooks — мысль · 2026-10-08 №1 | мысль |\n') },
    { d: 'раздел «## В ноуте нет» со стрелкой и «не входят» (круг 4, run-2)', f: viewEdit('## Открыто', '## В ноуте нет\n- Связи касса партнёра ↔ наш API в записях с 2026-10-08 (они в записях до этой даты, в срез не входят).\n\n## Открыто') },
    { d: 'строка со стрелкой «не вошли в срез» без ссылки', f: viewEdit('## Открыто', '- Касса партнёра → наш API: обмены до 2026-10-08 в срез не вошли\n\n## Открыто') },
  ],
  // ---- 1.2.0 ----
  'PTS-IN': [
    { d: 'путь к списку от папки ноута', f: nbEdit('> исходник: coddoc/_inbox/', '> исходник: ../../coddoc/_inbox/') },
    { d: 'путь к списку в обратных кавычках', f: nbEdit('> исходник: coddoc/_inbox/meeting-2026-10-13.points.md', '> исходник: `coddoc/_inbox/meeting-2026-10-13.points.md`') },
    { d: '«решила: Гарипова Л.», «со слов Дёмина К.»', f: (s) => nbEdit('решил: Гарипова Л.', 'решила: Гарипова Л.')(nbEdit('сразу после операции — со слов Дёмин К.', 'сразу после операции — со слов Дёмина К.')(s)) },
    { d: 'дата встречи «13.10»', f: nbEdit('### 1 · встреча 2026-10-13:', '### 1 · встреча 13.10:') },
    { d: 'дата встречи «13 октября»', f: nbEdit('### 1 · встреча 2026-10-13:', '### 1 · встреча 13 октября:') },
    { d: 'без «: предмет» — предупреждение', warn: /нет «: <предмет>»/, f: nbEdit('### 1 · встреча 2026-10-13: возврат товара без чека', '### 1 · встреча 2026-10-13') },
    { d: 'пункты в другом порядке', f: (s) => { const t = s.files[NB_RET]; const a = t.match(/^- \[сведение\] Касса печатает[^\n]*\n/m)[0]; s.files[NB_RET] = t.replace(a, '').replace('\n> исходник:', '\n' + a.trimEnd() + '\n> исходник:'); return s } },
    { d: '«отвечает на:» перед «решил:»', f: nbEdit('директор магазина не нужен — решил: Гарипова Л.; отвечает на: 2026-10-09 №1.2', 'директор магазина не нужен; отвечает на: 2026-10-09 №1.2 — решил: Гарипова Л.') },
    { d: 'кавычки после номера', f: nbEdit('вместо: 2026-10-08 №1.2 · ', 'вместо: 2026-10-08 №1.2 «Возврат только на карту» · ') },
    { d: 'протокол не читался, список прочитан Grep', f: (s) => { s.streams[0].push(ev('Grep', { pattern: '^- \\[', path: SB + LIST_IN })); return s } },
  ],
  'PTS-NEW': [
    { d: 'папка не из темы — предупреждение', warn: /папка ноута не из темы/, f: (s) => { const t = s.files[NB_ROOM]; delete s.files[NB_ROOM]; s.nb = 'notes/переговорные/notebook.md'; s.files[s.nb] = t; return s } },
    { d: 'новый ноут с BOM', f: (s) => { s.files[NB_ROOM] = '﻿' + s.files[NB_ROOM]; return s } },
    { d: 'ссылка на список markdown', f: nbEdit('> исходник: coddoc/_inbox/meeting-2026-10-12.points.md', '> исходник: [meeting-2026-10-12.points.md](coddoc/_inbox/meeting-2026-10-12.points.md)') },
  ],
  'PTS-REC': [
    { d: 'дата встречи «14.10.2026»', f: nbEdit('### 1 · встреча по памяти 2026-10-14:', '### 1 · встреча по памяти 14.10.2026:') },
    { d: 'протокол прочитан — предупреждение', warn: /протокол по памяти прочитан/, f: (s) => { s.streams[0].push(ev('Read', { file_path: SB + 'coddoc/MED-77/meeting-2026-10-14.recall.md' })); return s } },
    { d: '«решила: Зайцева Ольга»', f: nbEdit('вместо 24 — решил: Зайцева Ольга', 'вместо 24 — решила: Зайцева Ольга') },
  ],
  EXPORT: [
    ...exportOk(),
    { d: 'диапазон «2026-10-07 … 2026-10-10»', f: viewEdit('записи 2026-10-07–2026-10-10', 'записи 2026-10-07 … 2026-10-10') },
  ],
  'EXPORT-SINCE': exportOk(),
  ROUTE: [
    { d: 'ls и Glob по calls/ — не чтение', f: (s) => { s.streams[0].push(ev('Bash', { command: 'ls -la calls/' }), ev('Glob', { pattern: 'calls/*.vtt' })); return s } },
    { d: 'старая форма «… в ноут» — предупреждение', warn: /старая форма/, f: ansEdit(0, (a) => sub(a, '`/meeting-intake calls/2026-10-13-vozvraty.vtt`, потом `/analyst-notebook возврат-товара-без-чека <список>`', '`/meeting-intake calls/2026-10-13-vozvraty.vtt в ноут возврат-товара-без-чека`')) },
    { d: 'команды двумя строками', f: ansEdit(0, () => 'Расшифровку не разбираю.\n1. `/meeting-intake calls/2026-10-13-vozvraty.vtt`\n2. `/analyst-notebook возврат-товара-без-чека <список>`\n') },
    { d: 'Grep ноута — не чтение vtt', f: (s) => { s.streams[0].push(ev('Grep', { pattern: '^- \\[', path: SB + NB_RET })); return s } },
  ],
  'DESC-ONE': descOk(),
  'DESC-TWO': [
    { d: 'запись в «отчётность АС Друг» — предупреждение', warn: /текст — про заявки/, f: (s) => { s.files[NB_REP] = s.seed[NB_REP].replace(/\s+$/, '') + '\n\n' + s.files[NB_AS].slice(s.seed[NB_AS].replace(/\s+$/, '').length).replace(/^\s+/, ''); s.files[NB_AS] = s.seed[NB_AS]; return s } },
    { d: 'вопрос о ноуте на ходу 1, Шаг 5 — на ходу 2, запись — на ходу 3', f: (s) => { const [q, rest] = [s.answers[0].split('В какой ноут писать?\n')[0] + 'В какой ноут писать?\n', s.answers[0].split('В какой ноут писать?\n')[1]]; s.answers = [q, rest, s.answers[1]]; s.streams = [s.streams[0], [], s.streams[1]]; return s } },
    { d: 'варианты в одну строку «тема (о чём)»', f: ansEdit(0, (a) => a.replace(/^По «АС Друг»[\s\S]*?В какой ноут писать\?\n/, 'В какой ноут: «интеграция с АС Друг» (обмен заявками с порталом) — рекомендую, или «отчётность АС Друг» (выгрузка отчётов в бухгалтерию)?\n')) },
  ],
  AUTO: [
    ...descOk(),
    { d: 'вместо Skill — чтение .claude/skills/analyst-notebook/SKILL.md', f: (s) => { s.streams[0] = s.streams[0].map((e) => (e.includes('"name":"Skill"') ? ev('Read', { file_path: SB + '.claude/skills/analyst-notebook/SKILL.md' }) : e)); return s } },
  ],
  // ---- круг harden ----
  'BIG-EXPORT': [
    { d: 'ссылки «дата, №»', f: (s) => { s.files[s.view] = s.files[s.view].replace(/(\d{4}-\d{2}-\d{2}) №/g, '$1, №'); return s } },
    { d: 'пункты в обратном порядке', f: (s) => { const ls = s.files[s.view].split('\n'); const it = ls.filter((l) => /^- \[/.test(l)).reverse(); let k = 0; s.files[s.view] = ls.map((l) => (/^- \[/.test(l) ? it[k++] : l)).join('\n'); return s } },
    { d: 'список записан раньше проверки — предупреждение (решение 2026-10-15)', warn: /раньше проверки/, f: (s) => { const a = s.streams[0]; s.streams[0] = [a[0], a[1], a[3], a[2]]; return s } },
    { d: 'засев в CRLF, снимок `_seeded.sha256`', f: (s) => { s.seedCrlf = true; return s } },
  ],
  'BIG-VIEW': [
    { d: 'без столбца «Кто решил»', f: (s) => { s.files[s.view] = s.files[s.view].replace(/^(\|[^|\n]*\|)[^|\n]*\|/gm, '$1'); return s } },
    { d: 'спора в таблице нет (стык 3)', f: viewEdit(BIG_ROW[184] + '\n', '') },
    { d: 'стр. 83 строкой «спор, не решено» со ссылкой на спор', f: viewEdit(BIG_ROW[85], '| Если код не сработал — диспетчер в офисе | Калинкина В. | спор, не решено | 2026-09-29 №1, 2026-10-09 №1 |\n' + BIG_ROW[85]) },
    { d: 'победитель с пометкой «вместо 2026-09-23 №1 «за сутки»»', f: viewEdit('(раньше — за сутки)', '(вместо 2026-09-23 №1 «за сутки»)') },
    { d: 'спор «не решено»', f: viewEdit('| открыто, спор |', '| спор, не решено |') },
    // Пилот 2026-10-16 (runs/2026-10-16-hb-nb-big-view, run-1): таблицы по разделам, у каждой своя шапка и `|---|`;
    // вид, решивший и ссылка — одной клеткой «решено (Калинкина В.) · 2026-09-23 №1». Шапки — не строки без ссылки.
    { d: 'пилот 2026-10-16: таблицы по разделам, у каждой шапка «| Решение | Вид, кто решил, ссылка |»', f: (s) => {
      const rows = Object.values(BIG_ROW).map((r) => { const [a, b, c, d] = r.split('|').slice(1, -1).map((x) => x.trim()); return `| ${a} | ${c} (${b}) · ${d} |` })
      const head = '| Решение | Вид, кто решил, ссылка |\n|---|---|\n'
      s.files[s.view] = s.files[s.view].replace(BIG_TABLE, '## Общее\n' + head + rows.slice(0, 8).join('\n') + '\n\n## Остальное\n' + head + rows.slice(8).join('\n') + '\n')
      return s
    } },
    { d: 'списком вместо таблицы', f: (s) => { s.files[s.view] = s.files[s.view].replace(BIG_TABLE, Object.values(BIG_ROW).map((r) => { const [a, b, c, d] = r.split('|').slice(1, -1).map((x) => x.trim()); return `- ${a} — ${c} (${b}) · ${d}` }).join('\n') + '\n'); return s } },
    { d: 'файл записан раньше проверки — предупреждение (решение 2026-10-15)', warn: /раньше проверки/, f: (s) => { s.streams[1] = [s.streams[1][1], s.streams[1][0]]; return s } },
    { d: 'на ходу 1 нет вопроса «файлом или в чат» — предупреждение (ход)', warn: /ход 1 — план/, f: ansEdit(0, (a) => sub(a, 'Куда: файлом или в чат? Рекомендую файлом.\n', '')) },
    { d: 'файл выкладки записан на ходу 1 — предупреждение (ход)', warn: /ход 1 — план/, f: (s) => { s.streams[0].push(ev('Write', { file_path: SB + s.view, content: '…' })); return s } },
    { d: 'итоговая строка «Всего решений: 15» без ссылки — предупреждение', warn: /без ссылки/, f: viewEdit(BIG_ROW[206], BIG_ROW[206] + '\n| Всего решений | 15 | | |') },
    { d: 'решение из ноута без ссылки — предупреждение', warn: /без ссылки/, f: viewEdit(BIG_ROW[43], BIG_ROW[43] + '\n| Код уходит сообщением в мессенджер на телефон из брони | Калинкина В. | решено | |') },
  ],
  TWIN: [
    { d: '«ждёт:» у звонка — имя только из ноута — предупреждение (стык 2)', warn: /имя только из ноута/, f: nbEdit('кто решил — неизвестно — ждёт: —', 'кто решил — неизвестно — ждёт: Дробышева Н.') },
    { d: '«ждёт: Мельничук А.» у звонка', f: nbEdit('кто решил — неизвестно — ждёт: —', 'кто решил — неизвестно — ждёт: Мельничук А.') },
    { d: 'сведение «15 минут не выдержим» — предупреждение (стык 1)', warn: /не выдержим/, f: nbInsertItem('- [сведение] Плюс-минус 15 минут доставка не выдержит — со слов Мельничук А.') },
    { d: 'вопрос «кто решил» на ходу 2 — предупреждение', warn: /разнесены/, f: (s) => { s.answers[0] = s.answers[0].replace(/^п\.3:[^\n]*\n/m, ''); s.answers[1] = s.answers[1].replace('Записать так или поправить?', 'Звонок: кто решил? Не знаете — в открытые.\nЗаписать так или поправить?'); return s } },
    { d: 'звонок — вопросом', f: nbEdit('- [открыто] Доставщик звонит получателю за 10 минут до приезда, чтобы тот успел спуститься; решили на планёрке, кто решил — неизвестно — ждёт: —', '- [открыто] Звонит ли доставщик получателю за 10 минут до приезда — решили на планёрке, кто — неизвестно — ждёт: —') },
    { d: 'заголовок не «письмо Мельничука» — предупреждение (ход)', warn: /заголовок записи/, f: nbEdit('### 1 · письмо Мельничука А. (логистика доставки)', '### 1 · созвон с логистикой') },
    { d: 'вопроса о споре нет — предупреждение (ход)', warn: /вопрос о споре/, f: ansEdit(0, (a) => a.replace(/^Спор:[^\n]*\n/m, '')) },
    { d: 'вопроса «кто решил» нет — предупреждение (ход)', warn: /вопрос «кто решил»/, f: ansEdit(0, (a) => a.replace(/^п\.3:[^\n]*\n/m, '')) },
    { d: '«Записать так или поправить?» не спрошено — предупреждение (ход)', warn: /Записать так или поправить/, f: (s) => { s.answers[0] = s.answers[0].replace('Записать так или поправить?', 'Пишу.'); s.answers[1] = s.answers[1].replace('Записать так или поправить?', 'Пишу.'); return s } },
    { d: 'после «Поправить» пункты с «25» — предупреждение (ход)', warn: /пункты ещё раз/, f: ansEdit(1, (a) => a.replace('до 35 минут', 'до 25 минут')) },
    { d: 'ноут записан сразу после «Поправить» — предупреждение (ход)', warn: /пункты ещё раз/, f: (s) => { s.streams[1].push(ev('Edit', { file_path: SB + NB_TWIN, old_string: 'x', new_string: 'y' })); return s } },
    { d: 'ноут записан до «Записать» — предупреждение (ход)', warn: /только после ответа «Записать»/, f: (s) => { s.streams[1].push(ev('Edit', { file_path: SB + NB_TWIN, old_string: 'x', new_string: 'y' })); s.streams[2] = []; return s } },
    { d: 'Мельничук кандидатом в вопросе «кто решил» (стык 3)', f: ansEdit(0, (a) => a.replace(/^п\.3:[^\n]*\n/m, 'п.3: кто решил — Мельничук А.? Или не знаете — тогда в открытые.\n')) },
  ],
}

// Законные варианты проб «ноут по словам», где основы сошлись у одного ноута.
function descOk () {
  return [
    { d: 'в отчёте о шагах «нашёл три ноута, подходит один» без вопроса', f: ansEdit(0, (a) => 'Ноутов три, по «интеграции с АС Друг» подходит один — «интеграция с АС Друг»; «отчётность АС Друг» — про выгрузку отчётов.\n' + a) },
    { d: '«решила:» и «со слов Киселёва А.»', f: (s) => nbEdit('решил: Киселёв А.', 'решила: Киселёв А.')(nbEdit('со слов Киселёв А.', 'со слов Киселёва А.')(s)) },
    { d: 'номер — [решено] — предупреждение', warn: /номер заявки — \[решено\]/, f: nbEdit('- [сведение] Номер заявки АС Друг возвращает сразу, в ответе на отправку — со слов Киселёв А.', '- [решено] Номер заявки АС Друг возвращает сразу, в ответе на отправку — решил: Киселёв А.') },
  ]
}

// Законные варианты выгрузки, общие для EXPORT и EXPORT-SINCE.
function exportOk () {
  const all = (fn) => (s) => { s.files[s.view] = fn(s.files[s.view]); return s }
  return [
    { d: 'ссылки «дата, №»', f: all((v) => v.replace(/(\d{4}-\d{2}-\d{2}) №/g, '$1, №')) },
    { d: 'ссылка через «—»', f: all((v) => v.replace(/ · (\d{4}-\d{2}-\d{2} №)/g, ' — $1')) },
    { d: 'ссылка в скобках', f: all((v) => v.replace(/ · (\d{4}-\d{2}-\d{2} №\d+)$/gm, ' ($1)')) },
    { d: 'пункты в обратном порядке', f: all((v) => { const ls = v.split('\n'); const it = ls.filter((l) => /^- \[/.test(l)).reverse(); let k = 0; return ls.map((l) => (/^- \[/.test(l) ? it[k++] : l)).join('\n') }) },
    { d: '«решила: Гарипова Л.»', f: viewEdit('решил: Гарипова Л.', 'решила: Гарипова Л.') },
    { d: '«> Задача: —» в обратных кавычках', f: viewEdit('> Задача: —', '> Задача: `—`') },
    { d: 'в отчёте пункт-мысль с «?»', f: ansEdit(0, (a) => a + '- [мысль] Может, акт печатать прямо на кассе, без бумажного бланка? · 2026-10-10 №2\n') },
    { d: 'в отчёте «мысли и наброски — как есть, спросит /notes-to-intent»', f: ansEdit(0, (a) => a + 'Мысли и наброски — как есть: брать ли их во вход, спросит /notes-to-intent.\n') },
    { d: 'в отчёте пунктов по видам', f: ansEdit(0, (a) => a + 'Решено — 3, открыто — 1, сведение — 2, мысль — 2, набросок — 2.\n') },
    { d: 'вид с заглавной — предупреждение', warn: /не строчными/, f: viewEdit('- [решено] Деньги', '- [Решено] Деньги') },
    { d: 'засев в CRLF, снимок `_seeded.sha256`, ноут не тронут', f: (s) => { s.seedCrlf = true; return s } },
    { d: 'засев в CRLF, снимка нет — сверка по LF-тексту', f: (s) => { s.seedCrlf = true; s.noSha = true; return s } },
  ]
}

function fixtureSanity (ck) {
  const nbDates = (t) => [...t.matchAll(/^## (\d{4}-\d{2}-\d{2})/gm)].map((m) => m[1])
  for (const [name, fx] of Object.entries(FX)) {
    const seed = seedOf(fx)
    for (const [rel, t] of Object.entries(seed)) if (/notebook\.md$/.test(rel)) ck(`${name}: даты засева в ${fx.firstSeed || FIRST_SEED}…${fx.lastSeed || LAST_SEED}`, nbDates(t).every((d) => d >= (fx.firstSeed || FIRST_SEED) && d <= (fx.lastSeed || LAST_SEED)), true)
    for (const f of [fx.prompt, fx.reply]) ck(`${name}: ${f} есть`, existsSync(join(HERE, 'fixtures', fx.dir, f)), true)
  }
  // Засев для регулярок — LF и без BOM: рабочая копия с `core.autocrlf=true` отдаёт фикстуры в CRLF, и `\n\n` в
  // проверках засева не находился (самопроверка падала на чистом checkout). Байты засева сравнивает `sameAsSeed`.
  const S = (n) => Object.fromEntries(Object.entries(seedOf(FX[n])).map(([k, v]) => [k, parse(v)]))
  // Регулярки конца диалога стенда (run-ctx-v2.sh) засевом не срабатывают.
  ck('NEW: notes/ в засеве нет', Object.keys(S('NEW')).some((f) => /^notes\//.test(f)), false)
  ck('THOUGHT: «^- [мысль]» в засеве нет', /^- \[мысль\]/m.test(S('THOUGHT')[NB_RET]), false)
  ck('CONTRA: «вместо:» в засеве нет', S('CONTRA')[NB_RET].includes('вместо:'), false)
  ck('CONTRA: старый пункт в 2026-10-08 №1', /## 2026-10-08\n\n### 1 [^\n]*\n(- [^\n]*\n)*/.exec(S('CONTRA')[NB_RET])[0].split('\n').includes(OLD_CARD), true)
  ck('NOAUTH: «склад» в засеве нет', w('склад').test(S('NOAUTH')[NB_RET]), false)
  ck('FILE: «reglament» в ноуте нет', /reglament/i.test(S('FILE')[NB_RET]), false)
  const vtt = S('FILE')['calls/2026-10-10-sklad.vtt']
  ck('FILE: факты vtt есть в vtt', VTT_ONLY.every((re) => re.test(vtt)), true)
  ck('FILE: фактов vtt нет в промпте и ноуте', VTT_ONLY.some((re) => re.test(fixtureText(FX.FILE, 'w-prompt.txt')) || re.test(S('FILE')[NB_RET])), false)
  ck('FILE: pdf в засеве', 'docs-in/reglament.pdf' in S('FILE'), true)
  const nb = S('VIEW-API')[NB_API]
  ck('VIEW: про сроки в ноуте ничего', DEADLINE.test(nb), false)
  ck('VIEW: других .md с датой в notes/ нет', Object.keys(S('VIEW-API')).some((f) => /^notes\/.*-\d{4}-\d{2}-\d{2}(-2)?\.md$/.test(f)), false)
  ck('VIEW: все 6 ручек и путь A в ноуте', HANDLES.every((h) => h.re.test(nb)) && OLD_A.test(nb), true)
  ck('VIEW: замена пути A — вместо: 2026-10-06 №2.1', /^- \[решено\][^\n]*\/reversals[^\n]*вместо: 2026-10-06 №2\.1 · /m.test(nb), true)
  ck('VIEW: путь A один в записи 2026-10-06 №2', /### 2 [^\n]*\n- \[решено\][^\n]*\/bonus\/cancel[^\n]*\n>[^\n]*\n\n## 2026-10-08/.test(nb), true)
  ck('VIEW: решено с «решил:» — 4, мысли — 6, открыто — 2', [/^- \[решено\].*решил:/gm, /^- \[мысль\]/gm, /^- \[открыто\]/gm].map((re) => (nb.match(re) || []).length).join('/'), '4/6/2')
  ck('VIEW: истории — 3', STORIES.every((s) => nb.split('\n').some((l) => /^- \[мысль\] Как партнёр/.test(l) && s.re.every((re) => re.test(l)))), true)
  const chatN = fixtureText(FX.NEW, 'w-prompt.txt').split('\n').filter((l) => /^[А-ЯЁ][а-яё]+ [А-ЯЁ]\.: /.test(l)).length
  ck('NEW: строк чата 12–18', chatN >= 12 && chatN <= 18, true)
  // Ожидаемый исход заканчивает диалог стенда (DONE_GREP/DONE_RE run-ctx-v2.sh).
  const g = (n) => goodSpec(n).files
  ck('конец nb-thought ловится', /^- \[мысль\]/m.test(g('THOUGHT')[NB_RET]), true)
  ck('конец nb-contra ловится', /вместо:/.test(g('CONTRA')[NB_RET]), true)
  ck('конец nb-noauth ловится', /^- \[(открыто|решено|сведение)\].*склад/m.test(g('NOAUTH')[NB_RET]), true)
  ck('конец nb-file ловится', /reglament\.pdf/.test(g('FILE')[NB_RET]), true)
  ck('конец nb-new ловится', Object.keys(g('NEW')).some((f) => /\/notes\/[^/]+\/notebook\.md$/.test('/' + f)), true)
  ck('конец nb-view-api ловится', Object.keys(g('VIEW-API')).some((f) => /\/notes\/[^/]+\/[^/]*-20[0-9][0-9]-[0-9][0-9]-[0-9][0-9](-2)?\.md$/.test('/' + f)), true)

  // ---- 1.1.0 ----
  const N = (n) => S(n)[NB_RET]
  const reply = (n) => fixtureText(FX[n], FX[n].reply)
  ck('CONTRA: реплика не отвечает на «что верно»', RE_WHICH_ASK.test(reply('CONTRA')) || w('(верн|нов(ое|ый)|стар(ое|ый)|передумал|замен)').test(reply('CONTRA')), false)
  ck('DISPUTE: засев = засев CONTRA', N('DISPUTE') === N('CONTRA'), true)
  ck('DISPUTE: «что верно» в засеве нет', /что верно/i.test(N('DISPUTE')), false)
  ck('DISPUTE: Соколовой в промпте нет', w('Соколов').test(fixtureText(FX.DISPUTE, 'w-prompt.txt')), false)
  ck('ANSWER: засев = засев CONTRA', N('ANSWER') === N('CONTRA'), true)
  ck('ANSWER: «отвечает на:» в засеве нет', N('ANSWER').includes('отвечает на:'), false)
  ck('ANSWER: вопрос про акт — открыто в 2026-10-09 №1', /## 2026-10-09\n\n### 1 [^\n]*\n(- [^\n]*\n)*/.exec(N('ANSWER'))[0].split('\n').some((l) => l.startsWith(`- [открыто] ${OLD_Q_ACT} — ждёт: Гарипова Л. · ${OLD_Q_ACT_ID}`)), true)
  ck('ASK: в засеве вместо:, отвечает на:, что верно:', ['вместо:', 'отвечает на:', 'что верно:'].every((x) => N('ASK').includes(x)), true)
  ck('ASK: про лимит и сумму в засеве ничего', ABSENT_Q.test(N('ASK')), false)
  ck('ASK: вопросов в промпте — 4', (fixtureText(FX.ASK, 'w-prompt.txt').match(/\?/g) || []).length, 4)
  ck('ASK: 14 и 30 дней — в решении и в споре', [V14, V30].every((re) => N('ASK').split('\n').some((l) => /^- \[открыто\] что верно/.test(l) && re.test(l))), true)
  ck('LONG: засев = засев CONTRA', N('LONG') === N('CONTRA'), true)
  ck('LONG: «> исходник:» и sources/ в засеве нет', /^> исходник:/m.test(N('LONG')) || Object.keys(S('LONG')).some((f) => f.includes('/sources/')), false)
  ck('LONG: вставка 50–70 строк', ((n) => n >= 50 && n <= 70)(pasteLines(FX.LONG).length), true)
  const vp = S('VIEW-PART')[NB_API]
  const ents = nbEntries(vp)
  const partItems = Object.keys(ents).filter((k) => k.slice(0, 10) >= PART_FROM).flatMap((k) => ents[k])
  const earlyItems = Object.keys(ents).filter((k) => k.slice(0, 10) < PART_FROM).flatMap((k) => ents[k])
  ck('VIEW-PART: других .md с датой в notes/ нет', Object.keys(S('VIEW-PART')).some((f) => /^notes\/.*-\d{4}-\d{2}-\d{2}(-2)?\.md$/.test(f)), false)
  ck('VIEW-PART: засев NB-VIEW внутри', S('VIEW-API')[NB_API].split('\n').filter((l) => /^- \[/.test(l)).every((l) => vp.split('\n').includes(l)), true)
  ck('VIEW-PART: участников-выдумок в ноуте нет', INVENTED_PART.test(vp), false)
  ck('VIEW-PART: каждая ловушка — в пунктах до части', EARLY_TRAPS.every((t) => earlyItems.some((l) => t.t(l))), true)
  ck('VIEW-PART: ловушек нет в пунктах части', EARLY_TRAPS.some((t) => partItems.some((l) => t.t(l))), false)
  ck('VIEW-PART: каждая связь части — в пункте своей записи', PART_CONN.every((p) => p.refs.some((r) => (ents[r] || []).some((l) => p.re.every((re) => re.test(l))))), true)
  ck('VIEW-PART: кто вызывает отмену — не сказано', (ents['2026-10-09 №1'] || []).some((l) => P_KASSA.test(l) || P_APP.test(l)), false)
  ck('конец nb-dispute ловится', /что верно/.test(g('DISPUTE')[NB_RET]), true)
  ck('конец nb-answer ловится', /отвечает на:/.test(g('ANSWER')[NB_RET]), true)
  ck('конец nb-long ловится', /^> исходник:/m.test(g('LONG')[NB_RET]), true)
  ck('конец nb-view-part ловится', Object.keys(g('VIEW-PART')).some((f) => /\/notes\/[^/]+\/[^/]*-20[0-9][0-9]-[0-9][0-9]-[0-9][0-9](-2)?\.md$/.test('/' + f)), true)

  // ---- 1.2.0 ----
  const listIts = (n, rel) => S(n)[rel].split('\n').filter((l) => /^- \[/.test(l))
  const listHeadOk = (n, rel) => { const t = S(n)[rel].split('\n'); return /^# Пункты: \S/.test(t[0]) && /^> Источник: \S/.test(t[1]) && /^> Задача: \S/.test(t[2]) && /^> Встреча: \d{4}-\d{2}-\d{2} /.test(t[3]) }
  // Конец диалога стенда — `points.md` в coddoc/ или notes/ (grep по содержимому): засев его не содержит.
  const mentionsPts = (n) => Object.entries(S(n)).some(([f, t]) => /^(coddoc|notes)\//.test(f) && /points\.md/.test(t))
  ck('PTS-IN: ноут = засев CONTRA', S('PTS-IN')[NB_RET] === N('CONTRA'), true)
  ck('PTS-IN: шапка списка по форме output.md', listHeadOk('PTS-IN', LIST_IN), true)
  ck('PTS-IN: пунктов 4, у каждого « · L<n>»', listIts('PTS-IN', LIST_IN).filter((l) => L_TAIL.test(l)).length, 4)
  ck('PTS-IN: «points.md» в coddoc/ и notes/ засева нет', mentionsPts('PTS-IN'), false)
  ck('PTS-IN: старый пункт про карту и вопрос про акт в засеве', S('PTS-IN')[NB_RET].includes(OLD_CARD) && S('PTS-IN')[NB_RET].includes(`- [открыто] ${OLD_Q_ACT} — ждёт: Гарипова Л.`), true)
  ck('PTS-NEW: notes/ в засеве нет', Object.keys(S('PTS-NEW')).some((f) => /^notes\//.test(f)), false)
  ck('PTS-NEW: шапка списка по форме, «> Задача: —»', listHeadOk('PTS-NEW', LIST_NEW) && /^> Задача: —$/m.test(S('PTS-NEW')[LIST_NEW]), true)
  ck('PTS-REC: шапка списка по форме, «по памяти аналитика»', listHeadOk('PTS-REC', LIST_REC) && /по памяти аналитика$/m.test(S('PTS-REC')[LIST_REC]), true)
  ck('PTS-REC: «points.md» в coddoc/ и notes/ засева нет', mentionsPts('PTS-REC'), false)
  ck('PTS-REC: в ноуте нет [решено] и связей — менять нечего', /^- \[решено\]|вместо:|отвечает на:/m.test(S('PTS-REC')[NB_REC]), false)
  ck('PTS-REC: [мысль] в списке одна — о предупреждении', listIts('PTS-REC', LIST_REC).filter((l) => kindOf(l) === 'мысль').map((l) => w('предупрежд').test(l)).join(), 'true')
  // «Моя мысль» — строка `Аналитик:`, предмет — в вопросе над ней (meeting-recall 1.1.0, Шаг 5).
  ck('PTS-REC: «L<n>» списка — строки протокола о том же', listIts('PTS-REC', LIST_REC).every((l) => { const n = Number(l.match(/L(\d+)$/)[1]); const pl = S('PTS-REC')['coddoc/MED-77/meeting-2026-10-14.recall.md'].split('\n').slice(n - 2, n).join(' '); return sim(core(l), pl) > 0 }), true)
  const ex = activeOf(S('EXPORT')[NB_RET])
  ck('EXPORT: действующих 10, заменён 1, закрыт 1', `${ex.active.length}/${ex.replaced.length}/${ex.closed.length}`, '10/1/1')
  ck('EXPORT: заменён «Возврат только на карту»', (ex.replaced[0] || {}).text.startsWith(OLD_CARD_TEXT), true)
  ck('EXPORT: закрыт «Кто подписывает акт»', (ex.closed[0] || {}).text.startsWith(OLD_Q_ACT), true)
  ck('EXPORT: мысли — в трёх днях', String(new Set(ex.active.filter((x) => x.kind === 'мысль').map((x) => x.date)).size), '3')
  ck('EXPORT: расходящихся пунктов без пометок нет («что верно» не нужен)', /что верно/i.test(S('EXPORT')[NB_RET]), false)
  ck('EXPORT-SINCE: засев = засев EXPORT', S('EXPORT-SINCE')[NB_RET] === S('EXPORT')[NB_RET], true)
  const exS = ex.active.filter((x) => x.date >= FX['EXPORT-SINCE'].since)
  ck('EXPORT-SINCE: с 2026-10-09 действующих 5, ответ на вопрос 2026-10-08 — среди них', exS.length === 5 && exS.some((x) => /отвечает на: 2026-10-08/.test(x.line)), true)
  ck('EXPORT: .points.md в засеве нет', Object.keys(S('EXPORT')).some((f) => /\.points\.md$/.test(f)), false)
  // Спор в выгрузке (SKILL.md, «Выгрузка» п.3): засевы проб выгрузки спора не содержат — правило проверяется функцией по
  // ноуту NB-ASK, где спор 2026-10-10 №2 ссылается на пункт «14 дней» 2026-10-08 №2.
  const askNb = S('ASK')[NB_RET]
  const ak = activeOf(askNb)
  ck('спор: в ноуте NB-ASK оспорен один пункт — «14 дней», 2026-10-08 №2', ak.disputed.map((x) => x.ref + ' ' + V14.test(x.line)).join(), '2026-10-08 №2 true')
  ck('спор: сам спор действует', ak.active.some((x) => /что\s+верно/.test(x.line)), true)
  const expOf = (xs) => '# Пункты: возврат товара без чека\n> Источник: notes/возврат-товара-без-чека/notebook.md\n> Задача: —\n> Ноут: возврат товара без чека · записи 2026-10-07–2026-10-10\n\n' +
    xs.map((x) => exportLine(x.line)).join('\n') + '\n'
  const exFx = { notebook: NB_RET, since: null }
  const okE = gradeExportText(expOf(ak.active), askNb, exFx).R
  ck('спор: выгрузка по правилу — полна, как в ноуте, без оспоренного', [okE.complete, okE.expAsIs, okE.noReplacedItem, okE.ptsLines].join('|'), '|||')
  ck('спор: оспоренный пункт рядом со спором — красный', gradeExportText(expOf([...ak.active, ...ak.disputed]), askNb, exFx).R.noReplacedItem !== null, true)
  ck('спор: оспоренный пункт вместо спора — красный', gradeExportText(expOf([...ak.active.filter((x) => !/что\s+верно/.test(x.line)), ...ak.disputed]), askNb, exFx).R.noReplacedItem !== null, true)
  ck('ROUTE: ноут = засев CONTRA', S('ROUTE')[NB_RET] === N('CONTRA'), true)
  ck('ROUTE: факты vtt есть в vtt', ROUTE_ONLY.every((re) => re.test(S('ROUTE')[ROUTE_VTT])), true)
  ck('ROUTE: фактов vtt нет в промпте и ноуте', ROUTE_ONLY.some((re) => re.test(fixtureText(FX.ROUTE, 'w-prompt.txt')) || re.test(S('ROUTE')[NB_RET])), false)
  ck('конец nb-pts-in ловится', /points\.md/.test(g('PTS-IN')[NB_RET]), true)
  ck('конец nb-pts-rec ловится', /points\.md/.test(g('PTS-REC')[NB_REC]), true)
  ck('конец nb-pts-new ловится', Object.keys(g('PTS-NEW')).some((f) => /\/notes\/[^/]+\/notebook\.md$/.test('/' + f)), true)
  ck('конец nb-export ловится', Object.keys(g('EXPORT')).some((f) => /\/notes\/[^/]+\/notebook-20[0-9][0-9]-[0-9][0-9]-[0-9][0-9](-2)?\.points\.md$/.test('/' + f)), true)
  ck('конец nb-export-since ловится', Object.keys(g('EXPORT-SINCE')).some((f) => /\/notes\/[^/]+\/notebook-20[0-9][0-9]-[0-9][0-9]-[0-9][0-9](-2)?\.points\.md$/.test('/' + f)), true)

  // ---- 1.2.0: ноут по словам, вызов словами ----
  const D1 = S('DESC-ONE')
  ck('DESC: засев DESC-TWO и AUTO = засев DESC-ONE', ['DESC-TWO', 'AUTO'].every((n) => JSON.stringify(S(n)) === JSON.stringify(D1)), true)
  ck('DESC: три ноута, у каждого «о чём:»', [NB_AS, NB_REP, NB_DUTY].every((p) => /^о чём: \S/m.test(D1[p] || '')), true)
  // Шаг 1: основы слов о ноуте ищутся в строках `тема:`, `ключ:`, `о чём:` шапок.
  const headOf = (p) => (D1[p].match(/^---\n([\s\S]*?)\n---/) || ['', ''])[1].split('\n').filter((l) => /^(тема|ключ|о чём):/.test(l)).join('\n')
  const hits = (stems) => [NB_AS, NB_REP, NB_DUTY].filter((p) => stems.every((s) => new RegExp(s, 'i').test(headOf(p))))
  ck('DESC-ONE: «интеграц» + «друг» сходятся только у «интеграция с АС Друг»', hits(['интеграц', 'друг']).join(), NB_AS)
  ck('DESC-TWO: «друг» сходится у двух ноутов про АС Друг', hits(['друг']).join(), [NB_AS, NB_REP].join())
  const pl = (n) => fixtureText(FX[n], 'w-prompt.txt').split('\n')
  ck('DESC: текст чата одинаков у трёх проб', ['DESC-TWO', 'AUTO'].every((n) => pl(n).slice(1).join('\n') === pl('DESC-ONE').slice(1).join('\n')), true)
  ck('DESC-ONE: в строке вызова «по интеграции с АС Друг»', /в ноут по интеграции с АС Друг:/.test(pl('DESC-ONE')[0]), true)
  ck('DESC-TWO: в строке вызова только «по АС Друг»', /в ноут по АС Друг:/.test(pl('DESC-TWO')[0]) && !w('интеграц').test(pl('DESC-TWO')[0]), true)
  ck('AUTO: промпт без слэша и без имени скилла', /^\//.test(pl('AUTO')[0]) || /analyst|notebook|skill|скилл/i.test(fixtureText(FX.AUTO, 'w-prompt.txt')), false)
  // Конец диалога стенда — «Кисел» в notes/ (имя из текста чата): засев его не содержит.
  ck('DESC: «Кисел» в засеве нет', Object.values(D1).some((t) => /Кисел/.test(t)), false)
  ck('DESC: в пунктах засева нет «по одной» и «номер» — новому тексту не на что ссылаться', Object.values(D1).some((t) => t.split('\n').some((l) => /^- \[/.test(l) && w('(по\\s+одной|номер)').test(l))), false)
  ck('конец nb-desc-* и nb-auto ловится', /Кисел/.test(g('DESC-ONE')[NB_AS]), true)

  // ---- круг harden: NB-BIG, NB-TWIN — засев против таблиц expected ----
  const big = S('BIG-EXPORT')[NB_BIG]
  const ba = activeOf(big)
  const goneB = [...ba.replaced, ...ba.closed, ...ba.disputed]
  ck('BIG: пунктов 64, действующих 56', `${ba.all.length}/${ba.active.length}`, '64/56')
  ck('BIG: выбывают стр. 31, 41, 62, 66, 74, 83, 94, 118', goneB.map((x) => x.ln).sort((a, b) => a - b).join(), '31,41,62,66,74,83,94,118')
  ck('BIG: действующие — решено 15, открыто 10, сведение 25, мысль 6', ['решено', 'открыто', 'сведение', 'мысль'].map((k) => ba.active.filter((x) => x.kind === k).length).join('/'), '15/10/25/6')
  const asY = (x) => ({ l: BIG_X[x.ln], kind: x.kind, ref: x.ref })
  ck('BIG: метки выбывших не бьют действующих', ba.active.filter((x) => BIG_GONE.some((m) => m.t(asY(x)))).map((x) => x.ln).join() || 'нет', 'нет')
  ck('BIG: у каждого выбывшего — своя метка', goneB.every((x) => BIG_GONE.some((m) => m.t(asY(x)))), true)
  ck('BIG: соседи спора стр. 75–77, 84, 85 — действующие', BIG_NEIGHBORS.every((n) => ba.active.some((x) => x.ln === n)), true)
  ck('BIG: победители 42, 126, 144, 173 — «решено» своей записи', BIG_WIN.every((x) => ba.active.some((y) => y.ln === x.ln && y.kind === 'решено' && y.ref === x.ref && x.re.test(y.line))), true)
  ck('BIG: ключ HST-318', field(splitFront(big).front, 'ключ'), 'HST-318')
  ck('конец nb-big-export ловится', Object.keys(g('BIG-EXPORT')).some((f) => /\/notes\/[^/]+\/notebook-20[0-9][0-9]-[0-9][0-9]-[0-9][0-9](-2)?\.points\.md$/.test('/' + f)), true)
  ck('конец nb-big-view ловится', Object.keys(g('BIG-VIEW')).some((f) => /\/notes\/[^/]+\/[^/]*-20[0-9][0-9]-[0-9][0-9]-[0-9][0-9](-2)?\.md$/.test('/' + f)), true)
  const tw = S('TWIN')[NB_TWIN]
  ck('TWIN: «получател» и «звон» в пунктах засева нет', tw.split('\n').some((l) => /^- \[/.test(l) && w('(получател|звон)').test(l)), false)
  ck('TWIN: «вместо:», «отвечает на:», «что верно» в засеве нет', /вместо:|отвечает на:|что верно/.test(tw), false)
  ck('TWIN: «35» в письме нет — только в ответе двойника', NUM(35).test(fixtureText(FX.TWIN, 'w-prompt.txt')), false)
  ck('конец nb-twin ловится', /получател/.test(g('TWIN')[NB_TWIN]), true)
}

const VERBOSE = process.argv.includes('-v')
function selftest () {
  SELFTEST_LF = true
  let bad = 0
  const ck = (name, got, want) => { const ok = got === want; if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : `: ${got} (ждали ${want})`}`) }
  console.log('\nзасев')
  fixtureSanity(ck)
  for (const name of Object.keys(FX)) {
    const fx = FX[name]
    console.log(`\n${name}`)
    const run = (spec) => { const dir = build(spec); try { return gradeRun(dir, fx) } finally { rmSync(dir, { recursive: true, force: true }) } }
    const g = run(goodSpec(name))
    ck('зелёная песочница — зелёная', g.pass && !g.byEdit.length, true)
    if (!g.pass || g.byEdit.length) console.log('        ', [...g.fails, ...g.byEdit].map((f) => `${f.id}: ${f.why}`).join(' · '))
    if (g.warn.length) console.log('         предупреждения:', g.warn.join(' · '))
    for (const v of OK_VARIANTS[name] || []) {
      const r = run(v.f(clone(goodSpec(name))))
      ck(`законно: ${v.d}`, r.pass && !r.byEdit.length, true)
      if (v.warn) ck(`  и предупреждение: ${v.d}`, r.warn.some((x) => v.warn.test(x)), true)
      if (!r.pass || r.byEdit.length) console.log('        ', [...r.fails, ...r.byEdit].map((f) => `${f.id}: ${f.why}`).join(' · '))
    }
    const covered = new Set()
    for (const c of BAD[name]) {
      const r = run(c.f(clone(goodSpec(name))))
      covered.add(c.id)
      // Порча «по правке» — красная по правке: в отдельном списке, не в провалах.
      ck(`${c.id} краснеет${c.edit ? ' по правке' : ''}: ${c.d}`, c.edit ? r.byEdit.some((f) => f.id === c.id) && !r.fails.some((f) => f.id === c.id) : r.fails.some((f) => f.id === c.id), true)
      if (VERBOSE) { const other = r.fails.filter((f) => f.id !== c.id).map((f) => f.id); if (other.length) console.log(`          заодно: ${other.join(', ')}`) }
    }
    const uncovered = fx.checks.filter((id) => !covered.has(id))
    ck('порча есть у каждой проверки', uncovered.join(', ') || 'все', 'все')
  }
  // «НЕ ИЗМЕРЕНО» — только отказ API; прогон, который молча кончился без ответа и без файла, — красный.
  console.log('\nисход прогона (CONTRA)')
  const verdict = (f) => {
    const dir = build(f(clone(goodSpec('CONTRA'))))
    try { const r = verdictOf(dir, FX.CONTRA); return r.na ? 'не измерено' : r.pass ? 'зелёный' : 'красный: ' + r.fails.map((x) => x.id).join(',') } finally { rmSync(dir, { recursive: true, force: true }) }
  }
  const noRun = (s) => { s.answers = []; s.files = {}; return s }
  ck('эталон — зелёный', verdict((s) => s), 'зелёный')
  ck('_api-failure.txt — не измерено', verdict((s) => { noRun(s).files['_api-failure.txt'] = 'API Error: 529 overloaded'; return s }), 'не измерено')
  ck('ответ — ошибка API — не измерено', verdict((s) => { s.answers = ['API Error: 500 Internal server error']; s.files = {}; return s }), 'не измерено')
  ck('ответа нет, ничего не записано — красный «файл не записан»', verdict(noRun), 'красный: written')
  ck('нет answer.md — прогон не завершён, не измерено', verdict((s) => { noRun(s).noAnswerFile = true; return s }), 'не измерено')
  ck('ответа нет, ноут записан — оценка проверками', /^красный: (?!written)/.test(verdict((s) => { s.answers = []; return s })), true)
  ck('_api-failure-turn.txt, поток хода 2 пуст — не измерено', verdict((s) => { s.answers = [s.answers[0], '']; s.files = { '_api-failure-turn.txt': 'ход 2: отказ API или пустой ответ' }; s.streams[1] = []; return s }), 'не измерено')
  ck('_api-failure-turn.txt, ход 2 отработал молча — оценка', /^красный/.test(verdict((s) => { s.answers = [s.answers[0], '']; s.files = { '_api-failure-turn.txt': 'ход 2: отказ API или пустой ответ' }; return s })), true)
  console.log(bad === 0 ? '\nсамопроверка: ok' : `\nсамопроверка: ПРОВАЛОВ ${bad}`)
  process.exit(bad === 0 ? 0 : 1)
}

// ---------- прогон ----------

function main () {
  const arg = process.argv[2]
  if (arg === '--selftest') selftest()
  const fxName = process.argv[process.argv.indexOf('--fx') + 1]
  const fx = FX[fxName]
  if (!arg || !existsSync(arg) || !fx || process.argv.indexOf('--fx') < 0) {
    console.error('usage: node grade-nb.mjs <каталог с песочницами пробы> --fx NEW|THOUGHT|CONTRA|NOAUTH|FILE|VIEW-API|VIEW-CHAT|DISPUTE|ANSWER|ASK|LONG|VIEW-PART|PTS-IN|PTS-NEW|PTS-REC|EXPORT|EXPORT-SINCE|ROUTE|DESC-ONE|DESC-TWO|AUTO | --selftest')
    process.exit(1)
  }
  const runs = readdirSync(arg).filter((n) => /^run-\d+$/.test(n) && statSync(join(arg, n)).isDirectory()).sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)))
  console.log(`\nпроба nb-${fxName.toLowerCase()}, ${arg}`)
  let measured = 0; let green = 0; let edited = 0; const apiFail = []
  for (const n of runs) {
    const dir = join(arg, n)
    const r = verdictOf(dir, fx)
    if (r.na) { apiFail.push(`${n} (${r.why})`); console.log(`  ${n}: НЕ ИЗМЕРЕНО — ${r.why}`); continue }
    measured++
    if (r.pass) green++
    const turns = readdirSync(dir).filter((f) => /^answer-\d+\.md$/.test(f)).length || 1
    console.log(`  ${n}: ${r.pass ? 'ЗЕЛЁНЫЙ' : 'КРАСНЫЙ — ' + r.fails.map((f) => `${desc(fx, f.id)} (${f.why})`).join('; ')}`)
    if (r.byEdit && r.byEdit.length) { edited++; console.log(`         по правке: ${r.byEdit.map((f) => `${desc(fx, f.id)} (${f.why})`).join('; ')}`) }
    console.log(`         ходов: ${turns}${r.warn.length ? ' · предупреждения: ' + r.warn.join(' · ') : ''}`)
  }
  console.log(`\nИТОГ ${fxName}: ${green}/${measured} зелёных${edited ? `; по правке красных: ${edited}/${measured}${EDIT_MODE ? '' : ' (в счёт не идут; --edit — в счёт)'}` : ''}${apiFail.length ? `; не в счёт: ${apiFail.join(', ')}` : ''}\n`)
}

// Для selftest/loop/nb-mut.mjs: пробы, эталоны, порчи и законные варианты самопроверки — прогоняются там командой.
export { FX, goodSpec, BAD, OK_VARIANTS }

// Модуль импортируют (selftest/loop/nb-mut.mjs) — прогон только при запуске файлом.
const IS_MAIN = !!process.argv[1] && fileURLToPath(import.meta.url) === pathResolve(process.argv[1])
if (IS_MAIN) main()
