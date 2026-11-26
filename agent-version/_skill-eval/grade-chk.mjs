#!/usr/bin/env node
// grade-chk.mjs <папка-плеча chk-*> [<папка-плеча> …] | --selftest
//
// Оценщик проб `chk-*` (PLAN-REHEARSE-CHECK.md): `rehearse` в режиме «проверка» на фикстурах `spec-readiness`
// (SR-GAP, SR-CLEAN, SR-YELLOW, SR-BLUE). Один ход: три роли параллельно, сводящий, список одним сообщением.
//
// Зелёный прогон (записано до прогонов): субагенты трёх ролей с поправкой `check-brief.md` и сводящий с `merge.md`
// запущены; ведущий документ целиком не читал, аналитику вопросов не задавал, файлов не писал; один ход; список —
// заголовок «Проверка: … Критичных вопросов: N», N = числу пунктов, не больше десяти, у каждого пункта опора, угроза
// и роли, показанные опоры есть в файле (±2 строки); или «Критичных вопросов нет». По видам:
//   yellow — литералов-приманок из services/itsm.md 0, требований дописать чужой контракт 0;
//   blue-* — пункт про изменение есть (если список не пуст); blue-yes/idk — про прежнее поведение не больше одного.
// Подсаженные дыры SR-GAP — признаками (без порога, сверяются глазами); анкеры, приманки и «прежнее» — те же
// литералы, что в grade-reh-ex.mjs (из grade-sr.mjs и grade-sr-blue.mjs), без изменений.
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, rmSync, cpSync, statSync } from 'node:fs'
import { join, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const KIND = {
  gap: { fixture: 'SR-GAP', doc: 'coddoc/PSS-2210/technical_specification.md' },
  clean: { fixture: 'SR-CLEAN', doc: 'coddoc/OFC-880/technical_specification.md' },
  yellow: { fixture: 'SR-YELLOW', doc: 'coddoc/SUP-702/technical_specification.md' },
  'blue-yes': { fixture: 'SR-BLUE', doc: 'coddoc/SHT-410/technical_specification.md', prior: true },
  'blue-idk': { fixture: 'SR-BLUE', doc: 'coddoc/SHT-411/technical_specification.md', prior: true },
  'blue-cr': { fixture: 'SR-BLUE', doc: 'coddoc/UA-420/technical_specification.md', prior: false },
}

// ── литералы из grade-sr.mjs (строки 34–140, 173, 190–197) ──────────────────────────────────────────────────────
const RE_G1_OBJ = /Согласующ|\/decision|решени[ея] по заявке|авторизац|(?<![а-яё])рол[ьи](?![а-яё])/i
// ПОРЯДОК СЛОВ — ЖИВОЙ, А НЕ МОЙ. Прежняя редакция ждала «сервер … проверяет», а форма вопроса
// звучит наоборот: «проверяет ли сервер роль …». Плюс «только скрывает кнопку» — та же мысль,
// что «доверяет экрану», но других слов. Замер 2026-08-19: дыра найдена дословно в трёх прогонах,
// счётчик показал 20%.
// `бэк` БЕЗ «энд» И ПОРЯДОК СЛОВ. Вторая ветка ждала `сервер|бэкенд|на входе`, а прогон написал
// «проверяет ли бэк роль Согласующий или достаточно departmentId» — короткое `бэк` стояло только
// в первой ветке, где идёт ПОСЛЕ слова «проверяет». Плюс «доверяет фронту»: так прогоны называют
// то же самое, что «только скрывает кнопку».
const RE_G1_DEC = /(?:сервер[а-яё]*|бэкенд[а-яё]*|бэк(?![а-яё])|backend)[^.\n]{0,80}(?:провер|довер|валидир|контрол)|(?:провер|валидир|контрол)[а-яё]*[^.\n]{0,80}(?:сервер|бэкенд|бэк(?![а-яё])|на входе)|только (?:в |на )?(?:UI|интерфейс[а-яё]*|экран[а-яё]*|фронт[а-яё]*)|только скрывает|довер[а-яё]+[^.\n]{0,20}(?:фронт|экран|клиент)|(?:скрыти[а-яё]*|видимост[а-яё]*)[^.\n]{0,60}не[^.\n]{0,20}(?:авторизац|защит|прав)/i

// ─── Дыра 2. Повторная подача заявки ────────────────────────────────────────────────────────
// Объект: подача. Решение: идентичность / что делает вторая доставка.
const RE_G2_OBJ = /POST \/v1\/passes\b|\/v1\/passes\b|подач\w* заявк|создани\w* заявк|INT-1/i
const RE_G2_DEC = /идемпотент|повторн\w*[^.\n]{0,60}(?:запрос|отправк|доставк|нажат|подач|вызов|клик)|двойн\w*[^.\n]{0,40}(?:нажат|отправк|клик)|дважды|дубл(?:ир|икат|ей|я)|уникальност|уникальн\w*[^.\n]{0,30}(?:индекс|ключ|ограничен)/i

// ─── Дыра 3. Уведомление против фиксации заявки ─────────────────────────────────────────────
// Объект: уведомление. Решение: порядок относительно сохранения / что при откате.
const RE_G3_OBJ = /уведомлен|notify-gw|письм[оаеу]|INT-6/i
// ДЕФЕКТ, найденный глазами на контроле 2026-08-17. В первой редакции стояло
// `откат\w*[^.\n]{0,80}(?:письм|уведомлен|отправ)`, и строка «Откат миграции: отправляется ли
// через DOWN» давала попадание: «откат» + «отправ» в одной строке, про уведомления там ни слова.
// Прогон, не нашедший дыру, получал за неё зачёт. Альтернатива с откатом сужена до письма.
// ОКНО «ПОРЯДОК … УВЕДОМЛЕНИЕ» РАСШИРЕНО с 50 до 90. Прогон написал «в каком порядке выполняются
// проверка справочника, создание заявки, отправка уведомления» — между «порядке» и «отправка»
// встали два перечисленных шага, и пятидесяти символов не хватило на четыре знака.
const RE_G3_DEC = /(?:до|после|перед)[^.\n]{0,40}(?:фиксац|коммит|сохранени|записи в|транзакц)|транзакц|откат[а-яё]*[^.\n]{0,80}(?:письм|уведомлен)|(?:письм|уведомлен)[а-яё]*[^.\n]{0,80}откат|порядок[^.\n]{0,90}(?:отправк|сохранен|уведомлен)|в каком порядке[^.\n]{0,90}уведомлен/i

// ─── Дыра 4. `422` не привязан к полю формы ─────────────────────────────────────────────────
// Объект: код 422. Решение: как экран узнаёт, какое поле подсветить.
const RE_G4_OBJ = /\b422\b/
// ДАТЕЛЬНЫЙ ПАДЕЖ, найденный глазами 2026-08-21. Стояло `пол[ея]` и `к какому пол[юя]` — то есть
// «поле» и «поля» засчитывались, а «к полю», «к какому КОНКРЕТНОМУ полю», «привязав её к полю»
// — нет. На плече правки формы дыра найдена в шести прогонах из десяти, счётчик показал три:
// формулировки разошлись с моими, а не скилл перестал находить. Ровно тот класс дефекта, что
// уже ловили на `g5` («кнопки блокируются» против «блокируются кнопки»).
// ПРИЛАГАТЕЛЬНОЕ МЕЖДУ «КАКОЕ» И «ПОЛЕ». Ждали `какое пол` подряд, прогон написал «какое
// КОНКРЕТНОЕ поле содержит ошибку при 422». Плюс формулировка «по полям отдельно или одним
// сообщением», которой прогоны описывают ровно эту дыру, а правило её не знало.
const RE_G4_DEC = /подсвет|к как[а-яё]+[^.\n]{0,25}пол[еюя]|как[а-яё]{1,4}[^.\n]{0,30}пол[еяюи]|каких пол|перечень пол|списк[а-яё]* пол|по (?:отдельным )?пол[яеюи]м|пол[яеюи]м[^.\n]{0,25}(?:отдельн|или)|привяз[а-яё]*[^.\n]{0,30}(?:пол[еюя]|ошибк)|пол[еяю][^.\n]{0,40}(?:с ошибк|содержит ошибк|не прошл|невалид)|(?:тел[оа]|структур[а-яё]*|формат[а-яё]*)[^.\n]{0,40}(?:ошибк|422)|422[^.\n]{0,80}(?:пол[еюя]|структур|тел[оа])/i

// ─── Дыра 5. Решение в строке списка ────────────────────────────────────────────────────────
// Объект: строка списка / кнопка решения. Решение: состояние во время запроса, чужое изменение.
// ГОЛОЕ «СТРОКА» И «СТАТУС НА ЭКРАНЕ». Объект требовал `строк` ВМЕСТЕ со `списк` или `заявк` в
// сорока символах — а прогон пишет «оптимистичное обновление строки (сразу) или после ответа»:
// слова «список» рядом нет, оно в заголовке группы. Другой прогон пишет «видны ли изменения
// статуса на экране сразу» — там нет ни строки, ни кнопки. Объект расширен, отбор держит решение.
const RE_G5_OBJ = /строк[а-яё]*|списк[а-яё]*|кнопк|«Согласовать»|"Согласовать"|Согласовать(?![а-яё])|статус[а-яё]*|экран[а-яё]*/i
// ЛОЖНЫЙ ОТРИЦАТЕЛЬНЫЙ, найденный на пилоте 2026-08-17. Стояло `блокир\w*[^.\n]{0,40}кнопк` —
// то есть засчитывалось «блокируются кнопки» и не засчитывалось «кнопки блокируются». Живой
// отчёт написал второе, дыру нашёл, а счётчик показал ноль. Добавлены обратный порядок и слова,
// которыми состояние строки называют на самом деле: индикатор, loading, «при отправке».
// «СРАЗУ ИЛИ ПОСЛЕ ОТВЕТА СЕРВЕРА» — так прогоны называют эту дыру чаще всего, и правило этой
// формулировки не знало. Она же и есть вопрос: перерисовывать строку по нажатию или по ответу.
const RE_G5_DEC = /пока (?:идёт|идет|выполня|запрос|обрабат|отправ|сохран)|во время (?:запроса|обработк|отправк)|при отправке|уже[^.\n]{0,40}(?:обработ|соглас|отозв|принят|реш)[^.\n]{0,40}друг|друг[а-яё]+ согласующ|оптимистичн|сразу[^.\n]{0,60}(?:или|после ответа)|после ответа сервера|блокир[а-яё]*[^.\n]{0,40}(?:кнопк|строк|повторн)|(?:кнопк|строк)[а-яё]*[^.\n]{0,40}блокир|индикатор|loading|перезапрос|повторн[а-яё]*[^.\n]{0,30}нажат/i

// ─── Дыра 6. «Согласовать» против «Отозвать» ────────────────────────────────────────────────
// Объект: отзыв. Решение: одновременность, кто выигрывает, что получает проигравший.
// `409` в спеке не встречается ни разу — предложить его можно только найдя эту дыру.
// `INT-4` И «КОНФЛИКТ». Прогон пишет «одновременные конфликтующие действия (например, INT-3 и
// INT-4 на одну заявку)» — слова «отзыв» в пункте нет, есть его номер.
// `INT-4` УБРАН, ХОТЯ И ДОБАВЛЯЛСЯ СЮДА. Заголовок группы сносится в каждый её пункт, и группа
// «§2 INT-3, INT-4, INT-5» раздавала `INT-4` всем своим пунктам подряд — включая «можно ли нажать
// второй раз пока идёт запрос». Номер в заголовке объектом пункта не является. Прогон, ради
// которого номер добавляли, ловится словом «конфликтующие».
const RE_G6_OBJ = /отзыв|отозв|withdraw|конфликт[а-яё]*/i
// «ТЕМ ВРЕМЕНЕМ» И «ДРУГИМ ПОЛЬЗОВАТЕЛЕМ» — тот же вопрос другими словами: «что если заявка тем
// временем согласована или отклонена другим». Голое «уже согласована» сюда НЕ добавлено намеренно:
// оно есть и в законном вопросе про конечные статусы («что при попытке отозвать уже согласованную»),
// который гонкой не является, и добавление дало бы ложный зачёт.
const RE_G6_DEC = /одновременн|параллельн|гонк[аиуе]|конкурентн|конфликтующ|race|тем временем|друг[а-яё]+ (?:пользовател|согласующ)|кто (?:выигр|побед|первый)|первый[^.\n]{0,40}(?:побед|выигр|успел)|\b409\b|конечн[а-яё]*[^.\n]{0,40}статус[а-яё]*[^.\n]{0,40}(?:отказ|ошибк|код)/i

// ─── Дыра 7. Пачка прошла наполовину — ВНЕ ТАБЛИЦ ──────────────────────────────────────────
// Объект: пакетная операция. Решение: что при частичном отказе. Объекта «пакетная операция» нет
// ни в одной ролевой таблице — эта дыра и дыра 8 проверяют, работает ли правило порождения на
// объекте, которого в таблице не написано.
const RE_G7_OBJ = /пакетн|массов|нескольк\w+ заявк|выбранн\w+|\/v1\/passes\/decisions|INT-5|галочк/i
// ЖИВЫЕ ФОРМУЛИРОВКИ, а не мои. Первая редакция ждала слов «частичный», «целиком или»,
// «атомарно» — модель написала «полный отказ или обработка доступных», и счётчик дал 0 на
// прогоне, где дыра найдена дословно. Добавлены обе формы: «полный отказ или…», «весь запрос
// или…», «остальные» рядом с отказом.
const RE_G7_DEC = /частичн|част[ьи][^.\n]{0,60}(?:не прош|отказ|ошиб|не удал)|целиком или|полный отказ|весь (?:запрос|пакет|список)[^.\n]{0,30}или|все или ничего|атомарн|остальн\w+[^.\n]{0,40}(?:обработ|примен|прош)|(?:обработ|примен)\w+[^.\n]{0,30}доступн|по строке на каждую|исход каждой|результат по каждой/i

// ─── Дыра 8. Данные после срока хранения — ВНЕ ТАБЛИЦ ──────────────────────────────────────
// Объект: автоочистка по сроку. Решение: удалить запись или обезличить поля.
const RE_G8_OBJ = /срок\w* хранени|шесть месяцев|6 месяцев|по истечени|персональн\w+ данн/i
// Та же правка по живому тексту: модель написала «механизм удаления персональных данных — кто и
// когда инициирует удаление», а ждались «обезличить» и «удалить заявку».
const RE_G8_DEC = /обезлич|анонимиз|очистк|кто (?:запускает|и когда|инициир)|инициир\w+[^.\n]{0,30}удал|механизм\w*[^.\n]{0,20}удал|удал\w*[^.\n]{0,50}(?:заявк|запис|целиком|данн)|(?:заявк|запис|данн)\w*[^.\n]{0,50}удал|необязательн\w*[^.\n]{0,30}схем/i

// Пятая колонка — ТЕМА дыры, нарочно широкая. По ней ничего не засчитывается; она нужна сторожу
// «тема есть, зачёта нет». Широкая тема плюс узкая пара анкеров дают то, чего не даёт ни одно из
// двух по отдельности: числа остаются строгими, а промах анкера перестаёт быть невидимым.
const GAPS = [
  ['g1', 'роль «Согласующий» проверяется только в UI', RE_G1_OBJ, RE_G1_DEC, /Согласующ|авторизац|рол[ьи]/i],
  ['g2', 'повторная подача заявки', RE_G2_OBJ, RE_G2_DEC, /повторн|идемпотент|дубл|дважды/i],
  ['g3', 'уведомление до или после фиксации', RE_G3_OBJ, RE_G3_DEC, /уведомлен|письм[оаеу]|notify/i],
  ['g4', '422 не привязан к полю формы', RE_G4_OBJ, RE_G4_DEC, /\b422\b|валидац/i],
  ['g5', 'строка списка во время решения', RE_G5_OBJ, RE_G5_DEC, /пока идёт|во время|оптимистичн|сразу|индикатор|нажат/i],
  ['g6', 'согласование против отзыва одновременно', RE_G6_OBJ, RE_G6_DEC, /одновременн|конкурентн|гонк|конфликт|тем временем/i],
]

// Внетабличные считаются ОТДЕЛЬНО: смешивать их с табличными нельзя, они меряют разное.
const GAPS_OUT = [
  ['g7', 'пачка прошла наполовину (вне таблиц)', RE_G7_OBJ, RE_G7_DEC],
  ['g8', 'данные после срока хранения (вне таблиц)', RE_G8_OBJ, RE_G8_DEC],
]
const RE_YELLOW_SIN = /(?:INT-2|INT-3|INT-4|INT-5|INT-6|staff-directory|notify-gw|itsm|sms-gw|\bacs\b|СКУД)[^\n]{0,160}(?:допис|дополн|детализир|уточнит\w*\s+контракт|(?:привести|привед\w*)\s+пример|указать\s+(?:путь|метод|эндпоинт|схем|пример)|укажите\s+(?:путь|метод|эндпоинт|схем)|нужн\w*[^\n]{0,20}(?:пример|схем|JSON|путь|эндпоинт))/gi
const BAIT = [
  ['/int/v3/tickets/register', /\/int\/v3\/tickets\/register/],
  ['/int/v3/tickets/queue', /\/int\/v3\/tickets\/queue/],
  ['regEntryUid', /regEntryUid/],
  ['queueCode', /queueCode/],
  ['4412', /\b4412\b/],
  ['itsm.ticket.status_changed', /itsm\.ticket\.status_changed/],
]

// ── литералы из grade-sr-blue.mjs ─────────────────────────────────────────────────────────────────────────────
const CHANGE = /пропуск|BADGE|badge|bikeRack|велосипед|велокрепл|officeCode|офис|сортир|approverName|согласующ/i
const PRIOR = [
  /последн\w*\s+мест|одновременно\s+записыва|двое\s+(?:одновременно\s+)?записыва/i,
  /потолок|предел\w*\s+числа|по\s+чему\s+две\s+записи|вторая\s+запись|повторн\w+\s+запис\w+\s+того\s+же/i,
  /уже\s+ушёл|ушедш|departureAt/i,
  /рейс\s+исчез|стал\s+недоступен/i,
  /сколько\s+рейсов|постранич|порци/i,
  /уже\s+записан/i,
  /отозвал|потер\w+\s+рол|уже\s+выданн\w*\s+сесси/i,
  /рейсов\s+нет|пуст\w*\s+списк|нет\s+вовсе/i,
  /прежн\w*\s+(?:путь|ответ|пол[ея]|формат)|какое\s+взаимодействие\s+§2\s+отдаёт\s+это\s+поле/i,
]
const prior = it => PRIOR.some(r => r.test(it)) && !CHANGE.test(it)

const read = p => (existsSync(p) ? readFileSync(p, 'utf8') : '')
const slash = s => String(s || '').split('\\').join('/')
const norm = s => String(s || '').split('`').join('').split('*').join('').replace(/\s+/g, ' ').trim()

// ── поток вызовов (как в grade-reh.mjs) ───────────────────────────────────────────────────────────────────────
function parseStreams(sb) {
  const files = readdirSync(sb).filter(f => f === 'stream.jsonl' || (f.startsWith('stream-') && f.endsWith('.jsonl'))).sort()
  const uses = [], subTexts = [], names = new Map()
  for (const f of files) {
    for (const line of read(join(sb, f)).split('\n')) {
      if (!line.trim()) continue
      let j; try { j = JSON.parse(line) } catch { continue }
      const content = j.message && Array.isArray(j.message.content) ? j.message.content : []
      const sub = !!j.parent_tool_use_id
      if (j.type === 'system' && j.subtype === 'task_notification' && j.summary) subTexts.push(String(j.summary))
      if (j.type === 'assistant' && sub) for (const c of content) if (c.type === 'text' && String(c.text).includes('## ВОПРОСЫ')) subTexts.push(String(c.text))
      if (j.type === 'assistant') {
        for (const c of content) { if (c.type !== 'tool_use') continue; names.set(c.id, c.name); uses.push({ name: c.name, sub, input: c.input || {} }) }
      } else if (j.type === 'user' && !sub) {
        for (const c of content) {
          if (c.type !== 'tool_result') continue
          const n = names.get(c.tool_use_id)
          if (n !== 'Agent' && n !== 'Task') continue
          subTexts.push(Array.isArray(c.content) ? c.content.filter(x => x.type === 'text').map(x => x.text).join('\n') : String(c.content || ''))
        }
      }
    }
  }
  return { uses, subTexts }
}
function parseOporas(text) {
  const out = []
  for (const line of text.split('\n')) {
    let rest = line
    for (;;) {
      const m = rest.match(/([A-Za-z0-9_./-]+\.(?:md|yaml)):(\d+)[`*\s]*[—–-]+\s*«([^»]+)»/)
      if (!m) break
      out.push({ path: m[1].replace(/^\.\//, ''), line: Number(m[2]), quote: m[3] })
      rest = rest.slice(m.index + m[0].length)
    }
  }
  return out
}
function oporaOk(sb, o) {
  const lines = read(join(sb, o.path)).split('\n')
  // SKILL.md Шаг 3 (1.1.0): слова цитаты подряд; кавычки и знаки препинания не в счёт
  const bare = s => norm(s).replace(/[.,;:!?…«»"'„“”()—–-]+/g, ' ').replace(/\s+/g, ' ').trim()
  const q = bare(o.quote)
  if (!q || !lines.length) return false
  // «есть в показанных строках» (Шаг 3): цитата может перейти на соседнюю строку окна
  for (let i = Math.max(0, o.line - 3); i <= Math.min(lines.length - 1, o.line + 1); i++) {
    if (bare(lines[i]).includes(q) || (i + 1 < lines.length && bare(lines[i] + ' ' + lines[i + 1]).includes(q))) return true
  }
  return false
}
function parseHeaders(text) {
  const out = [], lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    // отклик ведущего перед номером в той же строке («Записал. 4/6. …») — тоже заголовок вопроса
    const m = lines[i].match(/^\s*(?:[А-ЯЁа-яё]+[.!]\s+)?[*_]*(\d+)\s*\/\s*(\d+)\s*[.)][*_]*\s+(.*)$/)
    if (!m) continue
    const body = [m[3]]
    for (let k = i + 1; k < lines.length; k++) { if (!lines[k].trim() || /^\s*[*_]*Опора/i.test(lines[k])) break; body.push(lines[k]) }
    out.push({ k: Number(m[1]), n: Number(m[2]), text: body.join(' ') })
  }
  return out
}
function parseBlock(text) {
  const i = text.indexOf('## ВОПРОСЫ')
  if (i < 0) return null
  const qs = []
  for (const line of text.slice(i).split('\n').slice(1)) {
    const m = line.match(/^\s*(\d+)\.\s+(.*)$/)
    if (m) { qs.push({ text: m[2], oporas: [] }); continue }
    if (qs.length && /опора:/i.test(line)) qs[qs.length - 1].oporas.push(...parseOporas(line))
  }
  return qs
}
function turnText(sb, t) {
  const f = join(sb, t === 1 ? 'stream.jsonl' : `stream-${String(t).padStart(2, '0')}.jsonl`)
  const texts = []
  for (const line of read(f).split('\n')) {
    if (!line.trim()) continue
    let j; try { j = JSON.parse(line) } catch { continue }
    if (j.type !== 'assistant' || j.parent_tool_use_id || !j.message || !Array.isArray(j.message.content)) continue
    for (const c of j.message.content) if (c.type === 'text' && String(c.text).trim()) texts.push(String(c.text))
  }
  return texts.join('\n\n')
}
const RE_EMPTY = /Вопросов у \S+ нет/

// ── режим «проверка»: список одним сообщением ─────────────────────────────────────────────────────────────────
const RE_HEAD = /Проверка:[^\n]*(?:\n[^\n]*)?Критичных вопросов:\s*(\d+)/
const RE_NONE = /Критичных вопросов нет/
const RE_NOLIST = /не прошли сверку опор/
const ROLE_FILES = [['исполнитель', 'role-executor.md'], ['архитектор', 'role-architect.md'], ['безопасник', 'role-security.md']]
const ROLE_WORD = /^(?:исполнитель|архитектор|безопасник)$/i

function parseList(text) {
  const i = text.search(/Проверка:/)
  const items = []
  if (i < 0) return items
  for (const line of text.slice(i).split('\n').slice(1)) {
    const m = line.match(/^\s*[*_]*(\d+)[.)][*_]*\s+(.*)$/)
    if (m) { items.push({ k: Number(m[1]), text: m[2], threat: '', roles: '', oporas: [] }); continue }
    if (!items.length) continue
    const it = items[items.length - 1]
    const field = (re) => line.replace(re, '').replace(/^[*_\s]+/, '').trim()
    if (/^\s*[*_]*Опора/i.test(line)) it.oporas.push(...parseOporas(line))
    else if (/^\s*[*_]*Чем грозит/i.test(line)) it.threat = field(/^\s*[*_]*Чем грозит[*_]*:[*_]*/i)
    else if (/^\s*[*_]*Кто спросил/i.test(line)) it.roles = field(/^\s*[*_]*Кто спросил[*_]*:[*_]*/i)
    else if (line.trim() && !it.threat && !it.roles && !it.oporas.length) it.text += ' ' + line.trim()
  }
  return items
}

// Субагенты ведущего: роль — по карточке в промпте, сводящий — по `merge.md`; ответ — по tool_result.
function agentCalls(sb) {
  const files = readdirSync(sb).filter(f => f === 'stream.jsonl' || (f.startsWith('stream-') && f.endsWith('.jsonl'))).sort()
  const calls = new Map(), byMsg = new Map()
  for (const f of files) {
    for (const line of read(join(sb, f)).split('\n')) {
      if (!line.trim()) continue
      let j; try { j = JSON.parse(line) } catch { continue }
      if (j.parent_tool_use_id) continue
      const content = j.message && Array.isArray(j.message.content) ? j.message.content : []
      if (j.type === 'assistant') {
        for (const c of content) {
          if (c.type !== 'tool_use' || (c.name !== 'Agent' && c.name !== 'Task')) continue
          const p = String((c.input && c.input.prompt) || '')
          const who = p.includes('merge.md') ? 'свод' : (ROLE_FILES.find(([, file]) => p.includes(file)) || ['?'])[0]
          calls.set(c.id, { who, prompt: p, result: '', msg: j.message.id || c.id })
          if (who !== 'свод' && who !== '?') byMsg.set(j.message.id || c.id, (byMsg.get(j.message.id || c.id) || 0) + 1)
        }
      } else if (j.type === 'user') {
        for (const c of content) {
          if (c.type !== 'tool_result' || !calls.has(c.tool_use_id)) continue
          calls.get(c.tool_use_id).result = Array.isArray(c.content) ? c.content.filter(x => x.type === 'text').map(x => x.text).join('\n') : String(c.content || '')
        }
      }
    }
  }
  return { calls: [...calls.values()], parallel: Math.max(0, ...byMsg.values()) }
}
function leadBlocks(sb) {
  const out = []
  for (const f of readdirSync(sb).filter(f => f === 'stream.jsonl' || (f.startsWith('stream-') && f.endsWith('.jsonl'))).sort())
    for (const line of read(join(sb, f)).split('\n')) {
      if (!line.trim()) continue
      let j; try { j = JSON.parse(line) } catch { continue }
      if (j.type !== 'assistant' || j.parent_tool_use_id || !j.message || !Array.isArray(j.message.content)) continue
      for (const c of j.message.content) if (c.type === 'text' && String(c.text).trim()) out.push(String(c.text))
    }
  return out
}
const countBlock = (text, head) => { const i = text.indexOf(head); return i < 0 ? null : text.slice(i).split('\n').filter(l => /^\s*\d+\.\s+/.test(l)).length }

function gradeRun(sb, kind) {
  const K = KIND[kind]
  const res = { run: basename(sb), checks: [], notes: [], status: 'green', gaps: null, questions: [] }
  const fail = (name, why) => { res.checks.push(`✘ ${name}${why ? ' — ' + why : ''}`); res.status = 'red' }
  const ok = name => res.checks.push(`✔ ${name}`)
  const un = why => { res.status = 'unmeasured'; res.checks.push(`… ${why} — не измерено`); return res }
  if (['_api-failure.txt', '_api-failure-turn.txt', '_escaped.txt'].some(f => existsSync(join(sb, f)))) return un('отказ API или побег')
  const answers = readdirSync(sb).filter(f => /^answer(-\d+)?\.md$/.test(f)).sort()
  if (!answers.length) return un('ответа нет')
  const turnNo = f => (f === 'answer.md' ? 1 : Number(f.match(/\d+/)[0]))
  const ans = [...new Set(answers.map(turnNo))].sort((a, b) => a - b).map(t => ({ t, text: turnText(sb, t) || read(join(sb, t === 1 ? 'answer.md' : `answer-${String(t).padStart(2, '0')}.md`)) }))
  const all = ans.map(a => a.text).join('\n\n')

  const { uses } = parseStreams(sb)
  const lead = uses.filter(u => !u.sub)
  const sbAbs = slash(resolve(sb)).toLowerCase()
  const sbVariants = [sbAbs, '/' + sbAbs.replace(/^([a-z]):/, '$1')]
  const strings = v => (typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : [])
  const escaped = uses.find(u => strings(u.input).some(raw => {
    let s = slash(raw).toLowerCase()
    if (s.includes('fixtures/') || s.includes('twin-')) return true
    for (const v of sbVariants) s = s.split(v).join('')
    return s.includes('_skill-eval')
  }))
  if (escaped) return un(`вызов за песочницу (${escaped.name})`)

  // субагенты: три роли с поправкой check-brief.md и сводящий
  const { calls, parallel } = agentCalls(sb)
  for (const [role, file] of ROLE_FILES) {
    const c = calls.filter(x => x.who === role)
    if (!c.length) { fail(`субагент «${role}»`, `нет вызова Agent с ${file}`); continue }
    c.every(x => x.prompt.includes('check-brief.md')) ? ok(`субагент «${role}» с поправкой`) : fail(`субагент «${role}» с поправкой`, 'в промпте нет check-brief.md')
  }
  calls.some(x => x.who === 'свод') ? ok('сводящий запущен') : fail('сводящий запущен', 'нет вызова Agent с merge.md')
  res.notes.push(`роли параллельно: ${parallel} в одном сообщении; ` + calls.map(x => `${x.who}: ${x.who === 'свод' ? countBlock(x.result, '## СПИСОК') : countBlock(x.result, '## ВОПРОСЫ')}`).join(', '))

  const readDoc = lead.find(u => u.name === 'Read' && slash(u.input.file_path).endsWith(K.doc) && !(Number(u.input.limit) > 0 && Number(u.input.limit) <= 10))
  readDoc ? fail('ведущий документ не читал', `Read limit=${readDoc.input.limit ?? '—'}`) : ok('ведущий документ не читал')
  lead.some(u => u.name === 'AskUserQuestion') ? fail('вопросов аналитику нет', 'AskUserQuestion') : ok('вопросов аналитику нет')
  ans.length === 1 ? ok('один ход') : fail('один ход', `ходов ${ans.length}`)

  const writes = uses.filter(u => ['Write', 'Edit', 'NotebookEdit', 'MultiEdit'].includes(u.name))
  const seeded = new Set(read(join(sb, '_seeded.txt')).split('\n').map(s => s.trim()).filter(Boolean))
  const extra = []
  const walk = (d, rel) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f), r = rel ? `${rel}/${f}` : f
      if (!rel && (f.startsWith('answer') || f.startsWith('stream') || f.startsWith('_') || f === '.claude')) continue
      if (statSync(p).isDirectory()) walk(p, r)
      else if (seeded.size && !seeded.has(r)) extra.push(r)
    }
  }
  walk(sb, '')
  writes.length || extra.length ? fail('файлов не записано', [...writes.map(w => w.name + ' ' + slash(w.input.file_path)), ...extra].join(', ')) : ok('файлов не записано')

  // список — в одном сообщении ведущего
  // первый — отдельный текстовый блок ведущего; склейка хода — запасной путь
  const msgs = [...leadBlocks(sb), ...ans.map(a => a.text)].filter(t => RE_HEAD.test(t) || RE_NONE.test(t) || RE_NOLIST.test(t))
  const msg = msgs[0] || ''
  const hm = msg.match(RE_HEAD)
  const items = hm ? parseList(msg) : []
  res.questions = items
  // merge.md: блок `## СНЯТО` — для сводящего, аналитику не показывается (check.md П3)
  if (/СНЯТО/.test(all)) fail('блок СНЯТО аналитику не показан')
  if (!hm && !RE_NONE.test(msg) && !RE_NOLIST.test(msg)) fail('список есть', 'строки «Проверка: … Критичных вопросов» нет')
  else if (!hm) ok(RE_NONE.test(msg) ? 'пустой список: «Критичных вопросов нет»' : 'пункты не прошли сверку')
  else {
    const n = Number(hm[1])
    n === items.length ? ok(`пунктов ${n}`) : fail('число в заголовке = пунктам', `заголовок ${n}, пунктов ${items.length}`)
    items.length <= 10 ? ok('не больше десяти') : fail('не больше десяти', `${items.length}`)
    const shown = items.flatMap(q => q.oporas)
    const bad = shown.filter(o => !oporaOk(sb, o))
    const noOp = items.filter(q => !q.oporas.length).length
    noOp ? fail('у каждого пункта опора', `без опоры: ${noOp}`) : ok('у каждого пункта опора')
    if (shown.length) bad.length ? fail('опоры подтверждены', bad.map(o => `${o.path}:${o.line}`).join(', ')) : ok(`опоры подтверждены (${shown.length})`)
    const noThreat = items.filter(q => !q.threat).length, noRoles = items.filter(q => !q.roles).length
    noThreat || noRoles ? fail('у пункта «Чем грозит» и «Кто спросил»', `без угрозы: ${noThreat}, без ролей: ${noRoles}`) : ok('у пунктов угроза и роли')
    const badRole = items.filter(q => q.roles && !q.roles.split(/\s*,\s*/).every(r => ROLE_WORD.test(r.replace(/[.*_]/g, '').trim())))
    if (badRole.length) fail('роли — из трёх', badRole.map(q => q.roles).join(' | '))
    const byRole = ROLE_FILES.map(([r]) => `${r} ${items.filter(q => new RegExp(r, 'i').test(q.roles)).length}`).join(', ')
    const svc = shown.filter(o => o.path.startsWith('services/')).length
    res.notes.push(`по ролям: ${byRole}; опор на services/: ${svc}`)
  }

  const head = o => { const ls = read(join(sb, o.path)).split('\n'); for (let i = Math.min(o.line, ls.length) - 1; i >= 0; i--) if (/^#{1,4} /.test(ls[i])) return ls[i]; return '' }
  const unit = q => q.text + ' ' + q.oporas.map(o => o.quote + ' ' + head(o)).join(' ')
  if (kind === 'gap') {
    const hit = list => list.filter(([, , o, d]) => items.some(q => o.test(unit(q)) && d.test(unit(q)))).map(([k]) => k)
    res.gaps = { in: hit(GAPS), out: hit(GAPS_OUT) }
    res.notes.push(`дыры SR-GAP по признакам: ${res.gaps.in.length}/6 (${res.gaps.in.join(', ') || '—'}); вне таблиц: ${res.gaps.out.join(', ') || '—'} — сверить глазами`)
  }
  if (kind === 'yellow') {
    const baits = BAIT.filter(([, re]) => re.test(all)).map(([k]) => k)
    baits.length ? fail('приманок из services/itsm.md нет', baits.join(', ')) : ok('приманок нет')
    const sins = items.filter(q => new RegExp(RE_YELLOW_SIN.source, 'i').test(q.text)).length
    sins ? fail('требований дописать чужой контракт нет', `${sins}`) : ok('требований чужого контракта нет')
  }
  if (kind.startsWith('blue')) {
    if (items.length) items.some(q => CHANGE.test(q.text)) ? ok('пункт про изменение есть') : fail('пункт про изменение есть')
    if (K.prior) {
      const pr = items.filter(q => prior(q.text))
      pr.length <= 1 ? ok(`про прежнее: ${pr.length}`) : fail('про прежнее — не больше одного', `${pr.length}`)
      for (const q of pr) res.notes.push(`прежнее? ${q.k}: ${norm(q.text).slice(0, 140)}`)
    }
  }
  return res
}

function gradeArm(dir) {
  const kind = basename(resolve(dir)).replace(/^chk-/, '')
  if (!KIND[kind]) { console.error(`не плечо chk-*: ${dir}`); return [] }
  const runs = readdirSync(dir).filter(f => f.startsWith('run-') && statSync(join(dir, f)).isDirectory()).sort()
  const out = runs.map(r => gradeRun(join(dir, r), kind))
  console.log(`\n== ${dir} (chk-${kind})`)
  for (const r of out) {
    console.log(`-- ${r.run}: ${r.status === 'green' ? 'ЗЕЛЁНЫЙ' : r.status === 'red' ? 'КРАСНЫЙ' : 'НЕ ИЗМЕРЕНО'}`)
    for (const c of r.checks) console.log('   ' + c)
    for (const n of r.notes) console.log('   · ' + n)
    for (const q of r.questions) console.log(`   ? ${q.k}. [${q.roles}] ${norm(q.text).slice(0, 220)}\n       грозит: ${norm(q.threat).slice(0, 160)}`)
  }
  const m = out.filter(r => r.status !== 'unmeasured')
  console.log(`ИТОГ chk-${kind}: зелёных ${m.filter(r => r.status === 'green').length} из ${m.length}; не измерено ${out.length - m.length}`)
  return out
}

function selftest() {
  const root = join(tmpdir(), `grade-chk-selftest-${process.pid}`)
  rmSync(root, { recursive: true, force: true })
  const D = KIND.gap.doc
  const specLines = read(join(HERE, 'fixtures', 'SR-GAP', D)).split('\n')
  const lineOf = s => specLines.findIndex(l => l.includes(s)) + 1
  const T1 = 'видны только сотрудникам', T2 = 'Все поля обязательны'
  if (!lineOf(T1) || !lineOf(T2)) { console.log('selftest: цитат нет в SR-GAP — поправь самопроверку'); process.exit(1) }
  const mk = (name, fixture, { answer, agents, extraUses = [] }) => {
    const sb = join(root, name)
    cpSync(join(HERE, 'fixtures', fixture, 'coddoc'), join(sb, 'coddoc'), { recursive: true })
    if (existsSync(join(HERE, 'fixtures', fixture, 'services'))) cpSync(join(HERE, 'fixtures', fixture, 'services'), join(sb, 'services'), { recursive: true })
    const files = []
    const walk = (d, rel) => { for (const f of readdirSync(d)) { const p = join(d, f); const r = rel ? `${rel}/${f}` : f; statSync(p).isDirectory() ? walk(p, r) : files.push(r) } }
    walk(sb, '')
    writeFileSync(join(sb, '_seeded.txt'), files.sort().join('\n') + '\n')
    writeFileSync(join(sb, 'answer.md'), answer)
    const ev = []
    agents.forEach((a, i) => ev.push(JSON.stringify({ type: 'assistant', parent_tool_use_id: null, message: { id: a.msg || `m${i}`, content: [{ type: 'tool_use', id: `a${i}`, name: 'Agent', input: { prompt: a.prompt } }] } })))
    agents.forEach((a, i) => ev.push(JSON.stringify({ type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: `a${i}`, content: [{ type: 'text', text: a.result }] }] } })))
    extraUses.forEach((u, i) => ev.push(JSON.stringify({ type: 'assistant', parent_tool_use_id: null, message: { id: `x${i}`, content: [{ type: 'tool_use', id: `x${i}`, name: u.name, input: u.input }] } })))
    ev.push(JSON.stringify({ type: 'assistant', parent_tool_use_id: null, message: { id: 'fin', content: [{ type: 'text', text: answer }] } }))
    writeFileSync(join(sb, 'stream.jsonl'), ev.join('\n') + '\n')
    return sb
  }
  const role = f => ({ prompt: `Прочитай задание /s/brief.md, поправку /s/check-brief.md и карточку роли /s/${f}`, result: '## ВОПРОСЫ\n1. a\n   опора: x\n2. b\n   опора: y', msg: 'roles' })
  const merge = { prompt: 'Прочитай задание /s/merge.md', result: '## СПИСОК\n1. a\n2. b' }
  const agents = [role('role-executor.md'), role('role-architect.md'), role('role-security.md'), merge]
  const it1 = `1. Экран прячет кнопки — проверяет ли сервер роль Согласующий на решении?\n   Чем грозит: решение примет сотрудник без права.\n   Кто спросил: безопасник, исполнитель\n   Опора: ${D}:${lineOf(T1)} — «${T1}»`
  const it2 = `2. Нажали «Отправить» дважды — вторая заявка или первая? Повторная отправка создаёт дубль?\n   Чем грозит: задвоятся заявки.\n   Кто спросил: исполнитель\n   Опора: ${D}:${lineOf(T2)} — «${T2}»`
  const list = (n, body) => `Проверка: ${D} — исполнитель, архитектор, безопасник. Критичных вопросов: ${n}.\n\n${body}\n\nОтветьте текстом здесь же; вписать ответы в документ — доработкой в \`/analyst-workspace\`.`
  const good = { answer: list(2, it1 + '\n' + it2), agents }
  const cases = []
  const t = (name, kind, fixture, spec, expect) => cases.push({ name, kind, sb: mk(name, fixture, spec), expect })
  t('gap-good', 'gap', 'SR-GAP', good, { status: 'green', gaps: 2 })
  t('gap-nomerge', 'gap', 'SR-GAP', { ...good, agents: agents.slice(0, 3) }, { status: 'red', fails: ['сводящий'] })
  t('gap-norole', 'gap', 'SR-GAP', { ...good, agents: [agents[0], agents[1], merge] }, { status: 'red', fails: ['«безопасник»'] })
  t('gap-readdoc', 'gap', 'SR-GAP', { ...good, extraUses: [{ name: 'Read', input: { file_path: 'C:/x/' + D } }] }, { status: 'red', fails: ['ведущий документ не читал'] })
  t('gap-badopora', 'gap', 'SR-GAP', { ...good, answer: list(2, it1.replace(T1, 'этого в спеке нет') + '\n' + it2) }, { status: 'red', fails: ['опоры подтверждены'] })
  t('gap-count', 'gap', 'SR-GAP', { ...good, answer: list(3, it1 + '\n' + it2) }, { status: 'red', fails: ['число в заголовке'] })
  t('gap-shownsnyato', 'gap', 'SR-GAP', { ...good, answer: list(2, it1 + '\n' + it2) + '\n\n## СНЯТО\n- исполнитель, x — не критично' }, { status: 'red', fails: ['СНЯТО'] })
  t('gap-nothreat', 'gap', 'SR-GAP', { ...good, answer: list(2, it1.replace(/\n   Чем грозит:[^\n]*/, '') + '\n' + it2) }, { status: 'red', fails: ['«Чем грозит»'] })
  const Y = KIND.yellow.doc
  const none = `Проверка: ${Y} — исполнитель, архитектор, безопасник.\n\nКритичных вопросов нет: на всё, что спросили бы исполнитель, архитектор и безопасник, документ отвечает. Это не оценка решения.`
  t('yellow-none', 'yellow', 'SR-YELLOW', { answer: none, agents }, { status: 'green' })
  t('yellow-bait', 'yellow', 'SR-YELLOW', { answer: none + ' Кстати, regEntryUid.', agents }, { status: 'red', fails: ['приманок'] })
  t('escape', 'gap', 'SR-GAP', { ...good, extraUses: [{ name: 'Read', input: { file_path: 'C:/r/_skill-eval/fixtures/SR-GAP/README.md' } }] }, { status: 'unmeasured' })
  let okAll = true
  for (const c of cases) {
    const r = gradeRun(c.sb, c.kind)
    const failsOk = (c.expect.fails || []).every(f => r.checks.some(x => x.startsWith('✘') && x.includes(f)))
    const gapsOk = c.expect.gaps == null || (r.gaps && r.gaps.in.length === c.expect.gaps)
    const pass = r.status === c.expect.status && failsOk && gapsOk
    if (!pass) okAll = false
    console.log(`${pass ? 'OK  ' : 'FAIL'} ${c.name}: ${r.status}${pass ? '' : '\n   ' + r.checks.join('\n   ') + '\n   · ' + r.notes.join('\n   · ')}`)
  }
  rmSync(root, { recursive: true, force: true })
  console.log(okAll ? `selftest: ${cases.length}/${cases.length}` : 'selftest: ЕСТЬ ПРОВАЛЫ')
  process.exit(okAll ? 0 : 1)
}

const args = process.argv.slice(2)
if (args[0] === '--selftest') selftest()
else if (!args.length) { console.error('usage: node grade-chk.mjs <папка-плеча chk-*> … | --selftest'); process.exit(1) }
else for (const d of args) gradeArm(d)
