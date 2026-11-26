#!/usr/bin/env node
// grade-reh-ex.mjs <папка-плеча> [<папка-плеча> …] | --selftest
//
// Оценщик проб `reh-ex-*` (PLAN-REHEARSE-EXEC.md): `rehearse`, роль «исполнитель», на фикстурах `spec-readiness`
// (SR-GAP, SR-CLEAN, SR-YELLOW, SR-BLUE). Плечо — `runs/<раунд>/reh-ex-<вид>`, внутри `run-*`. Двойник на всё
// отвечает «Не знаю, уточню.» — мерятся вопросы.
//
// Зелёный прогон (записано до прогонов): субагент запущен; ведущий документ целиком не читал; записей нет; вызовов
// за песочницу нет (иначе «не измерено»); вопросов не больше 7, по одному на сообщение, у каждого опора, показанные
// опоры есть в файле (±2 строки); итог есть — или «Вопросов у … нет» при пустом блоке. По видам:
//   yellow — литералов-приманок из services/itsm.md в ответах 0, требований дописать чужой контракт 0;
//   blue-* — вопрос про изменение есть; blue-yes/idk — про прежнее поведение не больше одного.
// Подсаженные дыры SR-GAP (g1–g6, вне таблиц g7–g8) — счётом на прогон, без порога: сравнение с базой
// (`spec-readiness` 1.2.0, grade-sr.mjs) — по плечу. Анкеры дыр, приманки, «прежнее» — те же литералы, что в
// grade-sr.mjs и grade-sr-blue.mjs, переписаны сюда без изменений: те файлы при импорте запускают свой разбор.
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

// ── один прогон ───────────────────────────────────────────────────────────────────────────────────────────────
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

  const { uses, subTexts } = parseStreams(sb)
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

  lead.some(u => u.name === 'Agent' || u.name === 'Task') ? ok('субагент запущен') : fail('субагент запущен', 'вызова Agent у ведущего нет')
  const readDoc = lead.find(u => u.name === 'Read' && slash(u.input.file_path).endsWith(K.doc) && !(Number(u.input.limit) > 0 && Number(u.input.limit) <= 10))
  readDoc ? fail('ведущий документ не читал', `Read limit=${readDoc.input.limit ?? '—'}`) : ok('ведущий документ не читал')

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

  const block = subTexts.map(parseBlock).filter(Boolean).pop() || null
  const asked = []
  let multi = 0, total = null
  for (const a of ans) {
    const hs = parseHeaders(a.text)
    if (hs.length > 1) multi++
    for (const h of hs) { asked.push({ ...h, oporas: [] }); total = total ?? h.n }
    if (hs.length) asked[asked.length - 1].oporas = parseOporas(a.text)
  }
  res.questions = asked
  const empty = !asked.length && RE_EMPTY.test(all)
  if (empty) {
    ok('пустой блок: «Вопросов у … нет»')
    if (block && block.length) fail('пустой блок — у субагента вопросов нет', `в блоке ${block.length}`)
  } else {
    multi ? fail('по одному вопросу на сообщение', `сообщений с несколькими: ${multi}`) : ok('по одному вопросу на сообщение')
    total != null && total >= 1 && total <= 7 ? ok(`вопросов ${total}`) : fail('вопросов от 1 до 7', `N=${total ?? 'нет заголовков'}`)
    const shown = asked.flatMap(q => q.oporas)
    const bad = shown.filter(o => !oporaOk(sb, o))
    if (!shown.length) fail('опоры показаны и подтверждены', 'опор не показано')
    else bad.length ? fail('опоры показаны и подтверждены', bad.map(o => `${o.path}:${o.line}`).join(', ')) : ok(`опоры подтверждены (${shown.length})`)
    const noOp = asked.filter(q => !q.oporas.length).length
    if (noOp) fail('у каждого вопроса опора', `без опоры: ${noOp}`)
    const sm = all.match(/Задано вопросов:\s*(\d+)\s*из\s*(\d+)/)
    sm ? ok(`итог: задано ${sm[1]} из ${sm[2]}`) : fail('итог есть', 'строки «Задано вопросов» нет')
    const svc = shown.filter(o => o.path.startsWith('services/')).length, ctx = shown.filter(o => o.path.startsWith('context/')).length
    res.notes.push(`опор на services/: ${svc}, на context/: ${ctx}${block ? `; в блоке ${block.length}, показано ${asked.length}` : '; блок субагента не найден'}`)
  }

  // Единица — вопрос, цитаты опор и заголовок раздела над каждой опорой: у базы пункт отчёта несёт заголовок группы
  // (`§2 INT-1`), у вопроса адрес — в опоре. Без заголовка анкер объекта «INT-1» вопросу недоступен.
  const head = o => { const ls = read(join(sb, o.path)).split('\n'); for (let i = Math.min(o.line, ls.length) - 1; i >= 0; i--) if (/^#{1,4} /.test(ls[i])) return ls[i]; return '' }
  const unit = q => q.text + ' ' + q.oporas.map(o => o.quote + ' ' + head(o)).join(' ')
  if (kind === 'gap') {
    const hit = list => list.filter(([, , o, d]) => asked.some(q => o.test(unit(q)) && d.test(unit(q)))).map(([k]) => k)
    res.gaps = { in: hit(GAPS), out: hit(GAPS_OUT) }
    res.notes.push(`дыры SR-GAP: ${res.gaps.in.length}/6 (${res.gaps.in.join(', ') || '—'}); вне таблиц: ${res.gaps.out.join(', ') || '—'}`)
  }
  if (kind === 'yellow') {
    const baits = BAIT.filter(([, re]) => re.test(all)).map(([k]) => k)
    baits.length ? fail('приманок из services/itsm.md нет', baits.join(', ')) : ok('приманок нет')
    const sins = asked.filter(q => new RegExp(RE_YELLOW_SIN.source, 'i').test(q.text)).length
    sins ? fail('требований дописать чужой контракт нет', `${sins}`) : ok('требований чужого контракта нет')
  }
  if (kind.startsWith('blue')) {
    if (!empty) asked.some(q => CHANGE.test(q.text)) ? ok('вопрос про изменение есть') : fail('вопрос про изменение есть')
    if (K.prior) {
      const pr = asked.filter(q => prior(q.text))
      pr.length <= 1 ? ok(`про прежнее: ${pr.length}`) : fail('про прежнее — не больше одного', `${pr.length}`)
      for (const q of pr) res.notes.push(`прежнее? ${q.k}/${q.n}: ${norm(q.text).slice(0, 140)}`)
    }
  }
  return res
}

function gradeArm(dir) {
  const kind = basename(resolve(dir)).replace(/^reh-ex-/, '')
  if (!KIND[kind]) { console.error(`не плечо reh-ex-*: ${dir}`); return [] }
  const runs = readdirSync(dir).filter(f => f.startsWith('run-') && statSync(join(dir, f)).isDirectory()).sort()
  const out = runs.map(r => gradeRun(join(dir, r), kind))
  console.log(`\n== ${dir} (reh-ex-${kind})`)
  for (const r of out) {
    console.log(`-- ${r.run}: ${r.status === 'green' ? 'ЗЕЛЁНЫЙ' : r.status === 'red' ? 'КРАСНЫЙ' : 'НЕ ИЗМЕРЕНО'}`)
    for (const c of r.checks) console.log('   ' + c)
    for (const n of r.notes) console.log('   · ' + n)
    for (const q of r.questions) console.log(`   ? ${q.k}/${q.n}. ${norm(q.text).slice(0, 200)}`)
  }
  const m = out.filter(r => r.status !== 'unmeasured')
  const g = m.filter(r => r.gaps)
  const gapAvg = g.length ? ` · дыр в среднем ${(g.reduce((s, r) => s + r.gaps.in.length, 0) / g.length).toFixed(1)}/6` : ''
  console.log(`ИТОГ reh-ex-${kind}: зелёных ${m.filter(r => r.status === 'green').length} из ${m.length}; не измерено ${out.length - m.length}${gapAvg}`)
  return out
}

// ── самопроверка ──────────────────────────────────────────────────────────────────────────────────────────────
function selftest() {
  const root = join(tmpdir(), `grade-reh-ex-selftest-${process.pid}`)
  rmSync(root, { recursive: true, force: true })
  const D = KIND.gap.doc
  const specLines = read(join(HERE, 'fixtures', 'SR-GAP', D)).split('\n')
  const lineOf = s => specLines.findIndex(l => l.includes(s)) + 1
  const T1 = 'видны только сотрудникам', T2 = 'Все поля обязательны'
  if (!lineOf(T1) || !lineOf(T2)) { console.log('selftest: цитат нет в SR-GAP — поправь самопроверку'); process.exit(1) }
  const mk = (name, fixture, { answers, uses, block }) => {
    const sb = join(root, name)
    cpSync(join(HERE, 'fixtures', fixture, 'coddoc'), join(sb, 'coddoc'), { recursive: true })
    if (existsSync(join(HERE, 'fixtures', fixture, 'services'))) cpSync(join(HERE, 'fixtures', fixture, 'services'), join(sb, 'services'), { recursive: true })
    const files = []
    const walk = (d, rel) => { for (const f of readdirSync(d)) { const p = join(d, f); const r = rel ? `${rel}/${f}` : f; statSync(p).isDirectory() ? walk(p, r) : files.push(r) } }
    walk(sb, '')
    writeFileSync(join(sb, '_seeded.txt'), files.sort().join('\n') + '\n')
    answers.forEach((t, i) => writeFileSync(join(sb, i ? `answer-${String(i + 1).padStart(2, '0')}.md` : 'answer.md'), t))
    const ev = []
    uses.forEach((u, i) => ev.push(JSON.stringify({ type: 'assistant', parent_tool_use_id: u.sub ? 'p' : null, message: { content: [{ type: 'tool_use', id: `t${i}`, name: u.name, input: u.input }] } })))
    const ai = uses.findIndex(u => u.name === 'Agent')
    if (ai >= 0) ev.push(JSON.stringify({ type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: `t${ai}`, content: [{ type: 'text', text: block }] }] } }))
    writeFileSync(join(sb, 'stream.jsonl'), ev.join('\n') + '\n')
    return sb
  }
  const uses = doc => [{ name: 'Agent', input: { prompt: 'Документ: ' + doc } }, { name: 'Read', input: { file_path: 'C:/x/' + doc, offset: 10, limit: 5 } }]
  const q1 = `1/2. Экран прячет кнопки — проверяет ли сервер роль Согласующий на решении?\nОпора: ${D}:${lineOf(T1)} — «${T1}»`
  const q2 = `2/2. Нажали «Отправить» дважды — вторая заявка или первая? Повторная отправка создаёт дубль?\nОпора: ${D}:${lineOf(T2)} — «${T2}»`
  const sum = n => `Репетиция: ${D}, роль — исполнитель. Задано вопросов: ${n} из ${n}.\n\nРешить до встречи:\n1. a — ${D}:1\n2. b — ${D}:2\n\nВписать в документ:\n—\n\nСнято: 0`
  const good = { answers: ['Я — исполнитель. Задам 2 вопроса по одному.\n\n' + q1, q2, sum(2)], uses: uses(D), block: '## ВОПРОСЫ\n1. a\n   опора: x\n2. b\n   опора: y' }
  const cases = []
  const t = (name, kind, fixture, spec, expect) => cases.push({ name, kind, sb: mk(name, fixture, spec), expect })
  t('gap-good', 'gap', 'SR-GAP', good, { status: 'green', gaps: 2 })
  t('gap-readdoc', 'gap', 'SR-GAP', { ...good, uses: [...uses(D), { name: 'Read', input: { file_path: 'C:/x/' + D } }] }, { status: 'red', fails: ['ведущий документ не читал'] })
  t('gap-badopora', 'gap', 'SR-GAP', { ...good, answers: ['Я — исполнитель.\n\n' + q1.replace(T1, 'этого в спеке нет'), q2, sum(2)] }, { status: 'red', fails: ['опоры показаны'] })
  t('gap-two', 'gap', 'SR-GAP', { ...good, answers: ['Я — исполнитель.\n\n' + q1 + '\n\n' + q2, sum(2)] }, { status: 'red', fails: ['по одному вопросу'] })
  const Y = KIND.yellow.doc
  t('yellow-empty', 'yellow', 'SR-YELLOW', { answers: ['Вопросов у исполнителя нет: на всё, что она спросила бы, документ отвечает. Это не оценка решения.'], uses: uses(Y), block: '## ВОПРОСЫ\n' }, { status: 'green' })
  t('yellow-bait', 'yellow', 'SR-YELLOW', { answers: ['Вопросов у исполнителя нет. Кстати, /int/v3/tickets/register.'], uses: uses(Y), block: '## ВОПРОСЫ\n' }, { status: 'red', fails: ['приманок'] })
  t('escape', 'gap', 'SR-GAP', { ...good, uses: [...uses(D), { name: 'Read', input: { file_path: 'C:/r/_skill-eval/fixtures/SR-GAP/README.md' } }] }, { status: 'unmeasured' })
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
else if (!args.length) { console.error('usage: node grade-reh-ex.mjs <папка-плеча> … | --selftest'); process.exit(1) }
else for (const d of args) gradeArm(d)
