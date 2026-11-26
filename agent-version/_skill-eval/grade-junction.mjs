#!/usr/bin/env node
// grade-junction.mjs — стык meeting-intake → петля: как скилл БТ или спеки разбирает файл встречи.
//
//   node grade-junction.mjs <каталог с песочницами> --fx BR-VAC|BR-LONG|BR-NEW|TS-ACC|TS-REW
//
// Грейдится итоговый документ задачи против засева: решения встречи легли, открытое осталось открытым,
// статус пересчитан, лишнего (реализации в БТ, токенов карточки в спеке) нет, чужой текст без основания
// не тронут. Первый ход печатается счётчиками: вопросы, переспрос решённого читается глазами.

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const lf = (s) => s.replace(/\r\n/g, '\n')
const read = (p) => lf(readFileSync(p, 'utf8'))
const RE_API_FAILURE = /API Error|Request not allowed|Please run \/login|Credit balance|rate limit|session limit|usage limit/i
// Строка «открытого»: блок «Открытые вопросы» в шапке, ⚠️, TBD, ❓, «ждём/ждёт».
const OPEN = /⚠️|TBD|❓|ждём|ждёт|Открыт|не решено|не назван/i
// Документы переносят строки: «…руководителем в списке⏎ставится генеральный директор». Признаки ищутся
// в окне из двух соседних строк (пилот 2026-10-14: в одной строке — две ложные красные).
const lines = (t) => { const l = t.split('\n'); return l.map((s, i) => s + ' ' + (l[i + 1] || '')) }
const anyLine = (t, ...res) => lines(t).some((l) => res.every((re) => re.test(l)))

const FX = {
  'BR-VAC': {
    doc: 'coddoc/EMP-1207/business_requirements.md',
    seed: 'fixtures/JM-BR-VAC/seed/coddoc/EMP-1207/business_requirements.md',
    must: [
      ['критерий FR-10 на день начала', (t) => (t.match(/\[FR-10\]/g) || []).length >= 2],
      ['директора → генеральный', (t) => anyLine(t, /генеральн/i, /(директорам|директоров|замест)/i)],
      ['список до 20 октября', (t) => /(20|двадцат\S*)\s+октябр|20\.10/i.test(t)],
      ['срок подачи ежегодного — открыт', (t) => anyLine(t, OPEN, /ежегодн|минимальн\S*\s+срок/i)],
      ['кто загружает изменения — открыт', (t) => anyLine(t, OPEN, /загруж|грузит/i)],
      ['статус «Требуются уточнения (N≥2)»', (t) => Number((t.match(/Статус готовности:\*\*\s*Требуются уточнения \((\d+)\)/) || [])[1] || 0) >= 2],
      ['FR-3 «не раньше следующего дня» сохранён', (t) => /не раньше\s+следующего дня/i.test(t)],
    ],
    mustNot: [
      ['реализация в БТ', /(^|[^а-яё])(бэк(?!лог)|бэкенд|фронт|сокет|опраш|сервер|скрипт|кеш|кэш)|UTC/i],
    ],
    // Чужой текст без основания: §3.2 о том, что изменения присылает отдел кадров, встреча не трогала.
    keep: [['§3.2 «изменения отдел кадров присылает списком»', /изменения отдел кадров присылает списком/i]],
  },
  'BR-LONG': {
    doc: 'coddoc/PSS-2210/business_requirements.md',
    seed: 'fixtures/JM-BR-LONG/seed/coddoc/PSS-2210/business_requirements.md',
    must: [
      ['срок подачи — до 18:00 рабочего дня', (t) => anyLine(t, /(18[:.]00|восемнадцат)/i, /рабоч/i)],
      ['передача заместителю после 16:00', (t) => anyLine(t, /заместител/i, /(16[:.]00|шестнадцат)/i)],
      ['уведомление заявителю о решении', (t) => anyLine(t, /заявител/i, /уведомл|оповещ|письм/i)],
      ['номер документа видит только бюро', (t) => anyLine(t, /номер\S*\s+(документ|паспорт)/i, /только/i, /бюро/i)],
      ['паспорт РФ / иностранный, гражданство', (t) => /иностран/i.test(t) && /гражданств/i.test(t)],
      ['цель визита из списка', (t) => anyLine(t, /переговор/i, /собеседовани/i)],
      ['время визита — часы с 8 до 18', (t) => anyLine(t, /(^|[^0-9])8([^0-9]|$)|восьми/i, /(18|восемнадцат)/i, /час|время/i)],
      ['комментарий при отклонении обязателен', (t) => anyLine(t, /коммент/i, /обязател/i)],
      ['хранение номера документа — открыто, юристы', (t) => anyLine(t, OPEN, /хран/i) && /юрист/i.test(t)],
      ['срочный пропуск — вне проекта', (t) => /срочн/i.test(t)],
      ['отчёт по визитам — вне проекта / бэклог', (t) => anyLine(t, /отч[её]т/i, /визит/i)],
      ['статус «Требуются уточнения (N≥1)»', (t) => Number((t.match(/Статус готовности:\*\*\s*Требуются уточнения \((\d+)\)/) || [])[1] || 0) >= 1],
    ],
    mustNot: [
      ['реализация в БТ', /(^|[^а-яё])(кеш|кэш|таблиц|транзакц|мессенджер|маск|настройк)|(^|[^а-яё])(почт(а|ой|у|е|ы)?|бот(а|ом|у|е|ы)?)([^а-яё]|$)|десять цифр|производственн\S*\s+календар/i],
      ['групповые заявки в требованиях', /FR-\d+[^\n]{0,200}группов/i],
    ],
    keep: [['§3.2 «Групповые заявки…» на месте', /Групповые заявки более чем/i]],
  },
  // Новый БТ по входу встречи, где фичу обсуждали с нуля: документа нет, есть только вход.
  'BR-NEW': {
    doc: 'coddoc/HRS-311/business_requirements.md',
    seed: null,
    must: [
      ['виды: с места работы и копия трудовой', (t) => /с места работы/i.test(t) && /копи\S*\s+трудов/i.test(t)],
      ['формат на выбор: электронная или бумажная', (t) => anyLine(t, /электрон/i, /бумажн/i)],
      ['срок 3 рабочих дня', (t) => /(^|[^0-9])(3|тр[её]х|три)\s+рабоч/i.test(t)],
      ['все специалисты видят, кто взял — исполнитель', (t) => anyLine(t, /специалист/i, /(взял|взят|исполнител)/i)],
      ['уведомление на портале', (t) => anyLine(t, /уведомл/i, /портал/i)],
      ['отмена, пока не взяли в работу', (t) => anyLine(t, /отмен/i, /(в работу|не взял|не взят)/i)],
      ['подпись — открыт, юристы', (t) => anyLine(t, OPEN, /подпис/i) && /юрист/i.test(t)],
      ['справка с зарплатой — открыт', (t) => anyLine(t, OPEN, /(зарплат|заработн)/i)],
      ['2-НДФЛ упомянут (вне проекта)', (t) => /НДФЛ/i.test(t)],
      ['бывшие сотрудники — вне проекта', (t) => /(бывш|уволен)/i.test(t)],
      ['курьер — вне проекта', (t) => /курьер/i.test(t)],
      ['переназначение — вне проекта', (t) => /переназнач/i.test(t)],
      ['только для себя', (t) => /(для себя|за другого|только себе)/i.test(t)],
      ['статус «Требуются уточнения (N≥2)»', (t) => Number((t.match(/Статус готовности:\*\*\s*Требуются уточнения \((\d+)\)/) || [])[1] || 0) >= 2],
    ],
    mustNot: [
      ['реализация в БТ', /(^|[^а-яё])(бэк(?!лог)|бэкенд|фронт|хранилищ|зуп|сервер)|1С|S3/i],
      ['«пять рабочих дней» (переиграно)', /(^|[^0-9])(5|пят\S*)\s+рабоч/i],
      // Строка «только электронные» без бумажной в той же строке — переигранное решение.
      ['«только электронные» (переиграно)', { test: (t) => t.split('\n').some((l) => /только\s+(в\s+)?электрон/i.test(l) && !/бумажн/i.test(l)) }],
      ['2-НДФЛ в требовании', { test: (t) => t.split('\n').some((l) => /FR-\d+/.test(l) && /НДФЛ/i.test(l) && !/(^|[^а-яё])(не|без|кроме|вне)([^а-яё]|$)/i.test(l)) }],
    ],
    keep: [],
  },
  // Доработка готовой спеки (редакция 1 из зелёного прогона jm-ts-acc) по входу второй встречи.
  'TS-REW': {
    doc: 'coddoc/ACS-208/technical_specification.md',
    seed: 'fixtures/JM-TS-REW/seed/coddoc/ACS-208/technical_specification.md',
    must: [
      ['повторы: 5 минут, вдвое, до 6 часов', (t) => anyLine(t, /(5|пят\S*)\s*мин/i, /(6|шест\S*)\s*ч/i) && /(вдвое|удва|удво|в два раза|×\s*2|множител)/i.test(t)],
      ['алерт в portal-duty', (t) => /portal-duty/.test(t)],
      ['таймаут состояния — 3 с', (t) => anyLine(t, /(^|[^0-9.])(3\s*(с|сек\S*|s)([^а-яёa-z0-9]|$)|3\s*000\s*мс|3000\s*ms|тр[её]х\s+секунд|три\s+секунд)/i, /состояни/i)],
      ['таймаут блокировки — 15 с', (t) => anyLine(t, /(^|[^0-9.])(15\s*(с|сек\S*|s)([^а-яёa-z0-9]|$)|15\s*000\s*мс|15000\s*ms|пятнадцат\S*\s+секунд)/i, /блокир/i)],
      ['таймаут заведения — 30 с', (t) => anyLine(t, /(^|[^0-9.])(30\s*(с|сек\S*|s)([^а-яёa-z0-9]|$)|30\s*000\s*мс|30000\s*ms|тридцат\S*\s+секунд)/i, /завед/i)],
      ['кэш состояния — минута', (t) => anyLine(t, /к[эе]ш/i, /((^|[^0-9])1\s*мин|одн\S*\s+минут|минуту|60\s*(с|сек\S*|s)([^а-яёa-z0-9]|$))/i)],
      ['флаг на подачу, выключен до заполнения', (t) => anyLine(t, /флаг/i, /(выключ|не включ|до заполн|пока)/i)],
      ['при заведении — доменный логин и код системы', (t) => anyLine(t, /доменн/i, /(код\S*\s+систем|targetSystemCode)/i)],
      ['промежуточный статус — открыт', (t) => anyLine(t, OPEN, /промежуточн|«Согласована»/i)],
      ['заблокированная учётка — открыт', (t) => anyLine(t, OPEN, /заблокир/i)],
      // Свои новые пробелы, открытые честно, законно поднимают N (r1 run-4: 6) — проверяется пересчёт: N равно
      // числу пунктов в блоке «Открытые вопросы» шапки, и в нём не меньше двух вопросов ИБ.
      ['статус «Требуются уточнения (N)» пересчитан, N≥2', (t) => {
        const n = Number((t.match(/Статус готовности:\*\*\s*Требуются уточнения \((\d+)\)/) || [])[1] || 0)
        // Блок — строки «>» под заголовком «**Открытые вопросы…**»; легенда выше тоже упоминает «Открытые вопросы».
        const block = (t.match(/\*\*Открытые вопросы[^\n]*\n((?:>[^\n]*\n?)*)/) || [])[1] || ''
        return n >= 2 && n === (block.match(/^>\s*\d+\.\s/gm) || []).length
      }],
      ['редакция 2', (t) => /Редакция:\*\*\s*2/.test(t)],
    ],
    mustNot: [
      ['«без кэша» (переиграно)', /без\s+к[эе]ша/i],
      ['табельный номер (переиграно)', { test: (t) => t.split('\n').some((l) => /табельн/i.test(l) && !/(^|[^а-яё])(не|вместо)\s/i.test(l)) }],
      // Только СТАРЫЕ вопросы, закрытые встречей: таймауты вызовов в idm и «нужен ли флаг». Новый TBD про таймаут
      // фронта или поведение при выключенном флаге — свой честный пробел, не нарушение (r1 run-4).
      ['таймауты вызовов в idm — всё ещё TBD', { test: (t) => anyLine(t, /TBD/, /таймаут\S*\s+вызов\S*\s+(портала\s+)?в\s+(систему управления|`?idm)/i) }],
      ['«нужен ли флаг» — всё ещё TBD', { test: (t) => anyLine(t, /TBD/, /нужен ли (фиче-)?флаг/i) }],
      ['график или канал — всё ещё «не задан»', /график\S*\s+не\s+задан|канал\S*\s+не\s+назван/i],
      ['путь или код чужой системы из карточки', /\/api\/v2\/accounts|E_SYS_UNKNOWN|E_ACC_NOT_FOUND|idm\.client|X-Idm-Client-Token|lockedAt/],
    ],
    // Встреча не трогала: повторное заведение, неактивная учётка, лимит, трассировка, расхождения с БТ.
    keep: [
      ['E_ACC_DUP', /E_ACC_DUP/],
      ['409 ACCOUNT_NOT_ACTIVE', /ACCOUNT_NOT_ACTIVE/],
      ['лимит 20 запросов', /20 запросов/],
      ['строка FR-7 в трассировке', /\|\s*FR-7\s*\|/],
      ['расхождения встречи с БТ', /Расхождения встречи с БТ/i],
    ],
  },
  'TS-ACC': {
    doc: 'coddoc/ACS-208/technical_specification.md',
    seed: null,
    turn1Ban: true,
    must: [
      ['фоновая задача с повтором', (t) => /фонов/i.test(t) && /повтор/i.test(t)],
      ['E_ACC_DUP → идентификатор, выдан', (t) => anyLine(t, /E_ACC_DUP/, /(идентификатор|id)/i)],
      ['E_ACC_STATE → запрос состояния', (t) => anyLine(t, /E_ACC_STATE/, /состояни/i)],
      ['блокировка синхронная', (t) => anyLine(t, /синхронн/i, /блокир|отзыв/i)],
      ['логин хранится', (t) => anyLine(t, /логин/i, /(хран|сохран)/i)],
      ['при сбое кнопка отзыва скрыта', (t) => anyLine(t, /(скры|не показыва|нет кнопк|без кнопк)/i, /(отозвать|отзыв)/i)],
      // «у системы есть код в idm и владелец → доступна для заявок» — то же решение без слова «подключ» (пул r1).
      ['код системы — признак подключения', (t) => anyLine(t, /код/i, /подключ|есть код|доступн\S*\s+для заяв/i)],
      ['промежуточный статус — открытый вопрос к ИБ', (t) => anyLine(t, OPEN, /Согласован|промежуточн/i)],
      ['заблокированная учётка — открытый вопрос', (t) => anyLine(t, OPEN, /заблокир/i)],
    ],
    mustNot: [
      ['путь или код чужой системы из карточки', /\/api\/v2\/accounts|E_SYS_UNKNOWN|E_ACC_NOT_FOUND|idm\.client|X-Idm-Client-Token|lockedAt/],
    ],
    keep: [],
  },
}

function toolUses (dir, file) {
  const out = []
  if (!existsSync(join(dir, file))) return out
  for (const line of read(join(dir, file)).split('\n')) {
    let e; try { e = JSON.parse(line) } catch { continue }
    const content = e && e.message && Array.isArray(e.message.content) ? e.message.content : []
    for (const c of content) if (c && c.type === 'tool_use') out.push({ name: c.name, input: c.input || {}, sub: !!e.parent_tool_use_id })
  }
  return out
}

export function gradeRun (dir, fx) {
  const r = {}
  const p = join(dir, fx.doc)
  r.exists = existsSync(p)
  const text = r.exists ? read(p) : ''
  r.untouched = fx.seed ? text === read(join(HERE, fx.seed)) : false
  r.missing = r.exists ? fx.must.filter(([, f]) => !f(text)).map(([d]) => d) : ['документа нет']
  r.violations = fx.mustNot.filter(([, re]) => re.test(text)).map(([d]) => d)
  r.lostText = fx.keep.filter(([, re]) => !re.test(text)).map(([d]) => 'удалён чужой текст: ' + d)
  // Первый ход: сколько вопросов и был ли записан документ (у спеки — нарушение «ход 1 = только вопросы»).
  const t1 = existsSync(join(dir, 'answer-01.md')) ? read(join(dir, 'answer-01.md')) : (existsSync(join(dir, 'answer.md')) ? read(join(dir, 'answer.md')) : '')
  r.q1 = (t1.match(/\?/g) || []).length
  r.wroteTurn1 = toolUses(dir, 'stream.jsonl').some((u) => !u.sub && ['Write', 'Edit'].includes(u.name) && JSON.stringify(u.input).includes(fx.doc.split('/').pop()))
  // Запрет записи в ходе 1 — только у первой записи спеки; доработка и БТ пишут сразу законно.
  r.specTurn1 = !!fx.turn1Ban && r.wroteTurn1
  r.pass = r.exists && !r.untouched && !r.missing.length && !r.violations.length && !r.lostText.length && !r.specTurn1
  return r
}

const arg = process.argv[2]
const fxName = process.argv[process.argv.indexOf('--fx') + 1]
const fx = FX[fxName]
if (!arg || !existsSync(arg) || !fx) { console.error('usage: node grade-junction.mjs <каталог с песочницами> --fx BR-VAC|BR-LONG|BR-NEW|TS-ACC|TS-REW'); process.exit(1) }
const runs = readdirSync(arg).filter((n) => /^run-\d+$/.test(n) && statSync(join(arg, n)).isDirectory()).sort()
console.log(`\nстык ${fxName}, ${arg}`)
let measured = 0; let green = 0
for (const n of runs) {
  const dir = join(arg, n)
  const ans = existsSync(join(dir, 'answer.md')) ? readFileSync(join(dir, 'answer.md'), 'utf8') : ''
  if (existsSync(join(dir, '_api-failure.txt')) || existsSync(join(dir, '_api-failure-turn.txt')) || !ans.trim() || RE_API_FAILURE.test(ans.slice(0, 300))) { console.log(`  ${n}: НЕ ИЗМЕРЕНО`); continue }
  measured++
  const r = gradeRun(dir, fx)
  if (r.pass) green++
  const turns = readdirSync(dir).filter((f) => /^answer-\d+\.md$/.test(f)).length || 1
  const notes = [
    `ходов: ${turns}, «?» в ходе 1: ${r.q1}, документ в ходе 1: ${r.wroteTurn1 ? 'да' : 'нет'}`,
    !r.exists && 'ДОКУМЕНТА НЕТ',
    r.untouched && 'документ не тронут',
    r.specTurn1 && 'СПЕКА ЗАПИСАНА В ХОДЕ 1',
    r.missing.length && 'нет: ' + r.missing.join('; '),
    r.violations.length && 'НАРУШЕНО: ' + r.violations.join('; '),
    r.lostText.length && r.lostText.join('; '),
  ].filter(Boolean)
  console.log(`  ${n}: ${r.pass ? 'зелёный' : 'красный'}  · ${notes.join(' · ')}`)
}
console.log(`\n  ${green}/${measured}\tзелёных — решения встречи легли, открытое открыто, статус пересчитан, лишнего нет  ← КРИТЕРИЙ\n`)
