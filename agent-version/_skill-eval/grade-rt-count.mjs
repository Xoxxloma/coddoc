#!/usr/bin/env node
// grade-rt-count.mjs — пробы rt-count-bt / rt-count-cr: гейт Шага 2Б `analyst-workspace` на ЧИСТОМ документе
// сверху, отчёт приёмки — в нынешней форме (`spec-review` 1.5.0: у БТ счётной строки нет, у запроса — одна строка 🔵).
//
//   node grade-rt-count.mjs <каталог плеча> [--case=bt|cr]   (без --case — по имени каталога rt-count-<case>;
//                                                            прежние имена rt-count-bt0|cr0 читаются как bt|cr)
//   node grade-rt-count.mjs --selftest
//
// ИСТОРИЯ. Заведена под ревью ветки feat/blue-contract: `spec-review` 1.3.0–1.4.1 кончал отчёт строками о границе —
// у БТ «критериев с порогом без примера на границе: N», у запроса ««как должно стать» с порогом без примера на
// границе: N» рядом со строкой 🔵 «решений, стоящих только на слове аналитика: N». Плечи rt-count-bt|cr шли на
// заглушке с ними (stubs/count), контроль rt-count-bt0|cr0 — на форме `main` ea0304a3 (stubs/bare). 1.5.0 строки о
// границе убрал; нынешняя форма совпала с прежним контролем, и пара слита в один набор stubs/ (= прежний stubs/bare
// байт в байт). Какой формой шёл прогон, грейдер узнаёт по телу заглушки `spec-review` в потоке (у прежней в нём есть
// «без примера на границе»), так что старые раунды перегрейживаются им же: критерий у обеих форм один.
//   Раунды 2026-10-26 (текст оркестратора — снимок `_skills/` раунда):
//     w3 (bt, cr) — форма «граница», analyst-workspace 2.1.0: подпись «N находок, M пробелов», цена «есть находки»;
//     w4 (bt0, cr0) — форма «текущая», 2.1.0;
//     w5 (bt, cr) — «граница», 2.1.1 с подписью «N нарушений, M открытых вопросов», но цена ещё «есть находки»;
//     w6 (bt, cr), w7 (bt) — «граница», текст = нынешний;
//     w8 (bt, cr) — «граница», нынешний + строка «Остальные строки отчёта приёмки — справка: передай их в тексте
//       вопроса как есть; вариантов они не добавляют» (снята после раунда).
//   Ни один прежний раунд не шёл на паре «нынешний текст + нынешняя форма».
//
// ЧТО ВЕРНО — ИЗ ЗАПИСАННЫХ ПРАВИЛ (строки — текст ветки 2026-10-26: analyst-workspace 2.1.1, spec-review 1.5.0):
//   analyst-workspace/reference/stage-bt.md:63 — «Гейт — ОДИН вопрос, и он задаётся ВСЕГДА»; :67–68 — «Поправить
//     документ сейчас — N нарушений, M открытых вопросов — выводится только когда N+M > 0; нечего править — варианта
//     нет». До 2.1.1 подпись была «— N находок, M пробелов» (w3/w4); признак «число выдано за …» узнаёт обе.
//   stage-bt.md:105–106 — «Нарушений ноль и открытых вопросов ноль — вопрос всё равно задаётся, просто без варианта
//     «Поправить»». N — нарушения приёмки: analyst-workspace/SKILL.md:121–122 «нарушения уходят в вопрос гейта …
//     нарушения и открытые вопросы лишь добавляют ему вариант «Поправить»»; SKILL.md:154 — выход приёмки «строка
//     «нарушений: N»». M — блок «Открытые вопросы» документа (stage-bt.md:61–62).
//   spec-review/SKILL.md:173–185 — при нуле нарушений «нарушений: 0», форма та же; spec-review/reference/
//     checklist-bt.md:172–184 — у БТ счётной строки нет; checklist-changerequest.md:160 «Справочная строка — не
//     нарушение, а счёт», :169 «Высокое число здесь — норма, а не находка». У документов фикстуры (prebaked/*)
//     «Открытых вопросов» нет. Итог: N = 0, M = 0 → «Поправить» на гейте нет, и строка 🔵 не выдаётся ни за
//     нарушение, ни за открытый вопрос.
//   stage-bt.md:82 — цена у «Идти дальше» («открытые вопросы разъедутся/осядут…; нарушения останутся в документе»)
//     дописывается, когда «Есть вариант «Поправить»»; варианта нет — цены нет.
//   Вопрос про границу сверх гейта — второй вопрос (stage-bt.md:63 «ОДИН вопрос»; SKILL.md:48 правило 2 «Каждый шаг =
//     один вопрос»). В нынешней форме приёмка о границе молчит; тема может прийти только от самого оркестратора — он
//     читает документ (stage-bt.md:61), а у prebaked/* пример на границе вырезан. Писатели: пример — форма гипотезы,
//     «границу не переспрашивай» (business-requirements-doc/SKILL.md:785–786, change-request-doc/SKILL.md:342–344).
//   Писатель (business-requirements-doc / change-request-doc) снова запущен после гейта — документ отправлен на
//     доработку без нарушений. По «Идти дальше» БТ идёт в Шаг 3 → при «не применимо» в Шаг 5 (stage-bt.md:88–89,
//     :123; stage-split.md:68), запрос — сразу в Шаг 5 со флагом мелкой правки (stage-bt.md:92–94).
//
// ЧЕГО ПРАВИЛА ОРКЕСТРАТОРА НЕ ОПРЕДЕЛЯЮТ — печатается справкой, в зелёное не входит:
//   совет про границу или приглашение вернуться к писателю — без варианта и без вопроса («границы стоит уточнить»,
//   «скажите — вернёмся в change-request-doc»): правило «число без совета» записано только у ведущего spec-review
//   (SKILL.md:15–18, :165–167), у оркестратора о счётных строках ни слова; ограничен его СПИСОК вариантов (:67–87);
//   показана ли строка 🔵 аналитику в вопросе гейта — не сказано нигде (форма результата SKILL.md:315–319 — для
//   точек 2–5, у точки 1 отдельной строки нет, stage-bt.md:102).
//
// ПРАВИЛА: регулярки литеральные; `\b`/`\w` рядом с кириллицей не применяются; побег и отказ API — «НЕ ИЗМЕРЕНО».

import { readdirSync, readFileSync, existsSync, writeFileSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { turn, apiFailed, RE_API_FAILURE } from './br-lib.mjs'

// Счётные строки. Строка 🔵 — дословно по checklist-changerequest.md:166 (у ARS-327 один пункт «Как должно стать», с 🔵).
// Строки о границе — прежняя форма (чек-листы 1.3.0–1.4.1): только для старых прогонов и для вычитания в edgeAdvice.
const RE_CNT_EDGE_BT = /критериев с порогом без примера на границе:\s*\**\s*2/i
const RE_CNT_EDGE_CR = /как должно стать»?\s*с порогом без примера на границе:\s*\**\s*1/i
const RE_CNT_WORD = /решений, стоящих только на слове аналитика:\s*\**\s*1/i
const COUNT_LITERALS = [
  /критериев с порогом без примера на границе:\s*\**\s*\d+/gi,
  /«?как должно стать»?\s*с порогом без примера на границе:\s*\**\s*\d+/gi,
  /решений, стоящих только на слове аналитика:\s*\**\s*\d+/gi,
]

export const CASES = {
  bt: { writer: 'business-requirements-doc', top: 'business_requirements.md' },
  cr: { writer: 'change-request-doc', top: 'change_request.md' },
}
// Прежние имена плеч: контроль на форме `main` (w4) — та же форма, что нынешняя.
export const ALIAS = { bt0: 'bt', cr0: 'cr' }
const caseOf = (k) => ALIAS[k] ?? k

// Форма отчёта заглушки приёмки → счётные строки, которые она отдаёт по документу сверху.
//   «текущая» — spec-review 1.5.0 = форма main ea0304a3 (stubs/; прежний stubs/bare, раунд w4);
//   «граница» — spec-review 1.3.0–1.4.1 (прежний stubs/count, раунды w3, w5–w8).
export const FORMS = {
  текущая: { bt: [], cr: [RE_CNT_WORD] },
  граница: { bt: [RE_CNT_EDGE_BT], cr: [RE_CNT_WORD, RE_CNT_EDGE_CR] },
}

/** Форма заглушки по её телу в потоке (сообщение user с «# Заглушка `spec-review`»); не видно тела — null. */
export function stubForm (streams) {
  let seen = false
  for (const st of streams) {
    for (const line of (st || '').split(/\r?\n/)) {
      if (!line.includes('Заглушка `spec-review`')) continue
      let j; try { j = JSON.parse(line) } catch { continue }
      if (j.type !== 'user') continue
      const body = JSON.stringify(j.message?.content ?? '')
      if (!body.includes('Заглушка `spec-review`')) continue
      seen = true
      if (body.includes('без примера на границе')) return 'граница'
    }
  }
  return seen ? 'текущая' : null
}

// Вопрос гейта — анкер из grade-rt.mjs:109 (обе формы скилла: «идём дальше?» и «Идти дальше —»).
export const RE_GATE = /ид[её]м дальше|идти дальше|продолжаем[^.\n?]{0,80}\?/i

// Вариант «Поправить» — подпись и пояснение из stage-bt.md:67–71. Подпись узнаётся в любой строке; пересказ —
// только как ВАРИАНТ: пункт списка «Доработать/Исправить/Дополнить документ|БТ|запрос», либо пояснение варианта
// «вернёмся в интервью по БТ / в `change-request-doc`» пунктом списка или с его же «дешевле, чем чинить».
// «Скажите — вернёмся в …» прозой без варианта — совет (справка), правилами не ограничен.
const RE_ITEM = /^\s*(\*\*)?(\d+[.)]|[-*•])\s/
const RE_FIX_LABEL = /Поправить/i
const RE_FIX_PARA = /^\s*(\*\*)?(\d+[.)]|[-*•])\s*(\*\*)?\s*(Доработать|Исправить|Дополнить)\s+(документ|БТ|бизнес-требован|запрос)/i
const RE_FIX_BACK = /(верн[её]мся|вернуться)\s+в\s+(интервью|`?change-request-doc|`?business-requirements-doc)/i
// Упоминание варианта с отрицанием — не предложение: ««Поправить» нет», «не показываю «Поправить»», «без варианта
// «Поправить»», «варианта «Поправить …» здесь нет», «варианта «Поправить» не будет», «появляется только при …».
const RE_FIX_NEG = new RegExp([
  'Поправить[^\\n]{0,40}?[»"]\\s*(—\\s*)?(здесь\\s+|тут\\s+)?нет(?=\\s*([.,:;)!»]|$))',
  'Поправить[^\\n]{0,40}?[»"]\\s*(—\\s*)?(здесь\\s+|тут\\s+|сейчас\\s+)?не\\s+будет(?![а-яё])',
  'Поправить\\s*(—\\s*)?нет(?=\\s*([.,:;)!»]|$))',
  '(нет|не\\s+будет)\\s+(и\\s+)?(варианта|кнопки|пункта)[^.\\n]{0,20}Поправить',
  'не\\s+(показ|вывод|вывож|предлага|добавл|став|включ)[а-яё]*[^.\\n]{0,40}Поправить',
  'Поправить[^.\\n]{0,40}не\\s+(показ|вывод|вывож|предлага|добавл|став|включ|нуж|появ)',
  'Поправить[^.\\n]{0,40}отсутству',
  '(убира|убра|опуска|опусти|пропуска)[а-яё]*[^.\\n]{0,30}Поправить',
  'без\\s+(варианта\\s+|кнопки\\s+)?[«"]?Поправить',
  'Поправить[^.\\n]{0,40}(появля|выводит|показыва|бывает|нуж)[а-яё]*\\s+только\\s+(при|когда|если)',
].join('|'), 'i')

export function fixOffered (line) {
  const offer = RE_FIX_LABEL.test(line) || RE_FIX_PARA.test(line) ||
    (RE_FIX_BACK.test(line) && (RE_ITEM.test(line) || /дешевле/i.test(line)))
  return offer && !RE_FIX_NEG.test(line)
}

// Число выдано за нарушения или открытые вопросы — в обеих подписях варианта (stage-bt.md:67): нынешней «N нарушений,
// M открытых вопросов» и прежней «N находок, M пробелов»; цифрой или словом: «2 находки», «1 нарушение», «одно
// нарушение», «2 открытых вопроса», «находок: 2», «открытых вопросов 1». Ноль не в счёт; «ни одного …» — не счёт.
const NOUNS = '(находк|нарушени|пробел|открыт[а-яё]*\\s+(вопрос|пункт))'
const RE_CLAIM = new RegExp([
  '(^|[^0-9.,])[1-9][0-9]*\\s+' + NOUNS,
  '(^|[^а-яё])(?<!ни\\s)(один|одна|одно|два|две|три|четыре)\\s+' + NOUNS,
  '(находок|нарушений|пробелов|открытых\\s+(вопросов|пунктов))\\s*[:—–-]?\\s*\\**\\s*[1-9]',
].join('|'), 'i')
export const claimsFindings = (line) => RE_CLAIM.test(line)

// Цена у «Идти дальше» — только при варианте «Поправить» (stage-bt.md:82–85): «открытые вопросы разъедутся/осядут…;
// нарушения приёмки останутся в документе»; прежняя форма «пробелы … находки» — для прогонов w3–w5.
export const RE_PRICE = /(находки|нарушения)(\s+приёмки)?\s+(останутся\s+в\s+документе|в\s+документе\s+останутся)|(пробел[а-яё]*|открыт[а-яё]*\s+вопрос[а-яё]*)[^.\n]{0,40}?\s(разъедутся|осядут)/i

// Совет про границу: строка о границе с глаголом действия над ней; глагол и отрицание ищутся в строке без самой
// счётной строки — иначе её «без примера» читалось бы советом, а «…: 2 — допишите примеры» терялось бы.
const RE_EDGE = /границ|граничн|ближайш[а-яё]*\s+значени/i
const RE_ADV = /уточн|допис|допиш|добав|дополн|переспр|поправ|исправ|закрыть|закро|перечит|посмотр|проверь|согласу|обсуд|укаж|указать|назов|назвать|пропис|пропиш|верн[её]м|вернуть|верну/i
const RE_ADV_NEG = /не\s+(переспраш|переспрос|нужн|требу|обязательн|блокир|нарушени|будем|станем|предлага|совету|рекоменд)|без\s+переспрос|форма\s+гипотезы/i
const RE_BUT = /,\s*но\s|\sно\s|однако/i
const stripCounts = (s) => COUNT_LITERALS.reduce((t, re) => t.replace(re, ''), s)
export function edgeAdvice (line) {
  const s = stripCounts(line)
  return RE_EDGE.test(line) && RE_ADV.test(s) && (!RE_ADV_NEG.test(s) || RE_BUT.test(s))
}
/** Вопрос про границу: ПРЕДЛОЖЕНИЕ с «?», само несущее совет про границу («…или сначала уточним границу?»). */
export const edgeQuestion = (line) => (line.match(/[^.!?\n]*\?/g) || []).some(edgeAdvice)

/** Признаки на тексте хода гейта. */
export function gateSigns (text, counts) {
  const lines = (text || '').replace(/\r\n/g, '\n').split('\n')
  const edgeQ = lines.filter(edgeQuestion)
  return {
    fix: lines.filter(fixOffered),
    claim: lines.filter(claimsFindings),
    price: RE_PRICE.test(text || ''),
    edgeQ,
    edgeAdv: lines.filter((l) => edgeAdvice(l) && !edgeQ.includes(l)),
    relayed: counts.length ? counts.every((re) => re.test(text || '')) : null,
  }
}

/**
 * Запуск под-скилла в ходе — копия grade-rt.mjs:116–133: вызов `Skill`, чтение `SKILL.md` заглушки или запись её строки
 * в `_trace.log`. Один след достаточен: нужен ХОД, а не способ.
 */
export function turnLaunches (streamText, name) {
  if (!streamText) return false
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
      if (b.name === 'Bash' && (i.command ?? '').includes(name) && /_trace/.test(i.command ?? '')) return true
      if ((b.name === 'Write' || b.name === 'Edit') && /_trace\.log/.test(i.file_path ?? '') &&
        ((i.content ?? '') + (i.new_string ?? '')).includes(name)) return true
    }
  }
  return false
}

/** Текст, который модель сама вывела в ходе (блоки `text` ассистента) — не инструкция заглушки из сообщения user. */
function assistantText (streamText) {
  let out = ''
  for (const line of (streamText || '').split(/\r?\n/)) {
    if (!line.includes('"text"')) continue
    let j; try { j = JSON.parse(line) } catch { continue }
    if (j.type !== 'assistant') continue
    for (const b of j.message?.content ?? []) if (b.type === 'text') out += b.text + '\n'
  }
  return out
}

/** Трасса с подбором кодировки — как grade-rt.mjs:readTrace (cp1251 от PowerShell на Windows). */
function readTrace (path) {
  if (!existsSync(path)) return []
  const buf = readFileSync(path)
  let t = buf.toString('utf8')
  if (t.includes('�')) { try { const cp = new TextDecoder('windows-1251').decode(buf); if (!cp.includes('�')) t = cp } catch {} }
  return t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
}

export function gradeRun (dir, kase) {
  const k = caseOf(kase)
  const C = CASES[k]
  const r = { dir, measured: true, why: '', verdict: '' }
  if (existsSync(join(dir, '_escaped.txt'))) { r.measured = false; r.why = 'побег из песочницы'; return r }
  if (existsSync(join(dir, '_api-failure-turn.txt'))) { r.measured = false; r.why = 'отказ API посреди ходов'; return r }
  const turns = []
  for (let n = 1; n <= 16; n++) {
    const t = turn(dir, n)
    if (n > 1 && t.answer === null && t.stream === null) break
    turns.push(t)
  }
  if (apiFailed(dir, [turns[0].answer])) { r.measured = false; r.why = 'отказ API'; return r }
  if (turns.slice(1).some((t) => t.answer && RE_API_FAILURE.test(t.answer.slice(0, 300)) && t.answer.length < 600)) {
    r.measured = false; r.why = 'отказ API в позднем ходе'; return r
  }
  const form = stubForm(turns.map((t) => t.stream))
  r.formSeen = form !== null
  r.form = form ?? 'текущая'
  const counts = FORMS[r.form][k]
  const lines = readTrace(join(dir, '_trace.log'))
  const turnOf = (name) => { const i = turns.findIndex((t) => turnLaunches(t.stream, name)); return i < 0 ? 0 : i + 1 }
  r.reviewedTop = lines.some((l) => l.startsWith('spec-review') && l.includes(C.top))
  r.reviewTurn = turnOf('spec-review')
  r.writerTurns = turns.map((t, i) => (turnLaunches(t.stream, C.writer) ? i + 1 : 0)).filter(Boolean)
  r.specTurn = turnOf('technical-spec-doc')
  const specLine = lines.filter((l) => l.startsWith('technical-spec-doc')).find((l) => /=/.test(l)) ?? ''
  r.specFlag = /флаг=(\S+)/.exec(specLine)?.[1] ?? ''
  r.smallFlag = /мелк|small/i.test(r.specFlag)

  r.gateTurn = 0
  if (r.reviewedTop && r.reviewTurn > 0) {
    for (let n = r.reviewTurn; n <= turns.length; n++) if (RE_GATE.test(turns[n - 1].answer || '')) { r.gateTurn = n; break }
  }
  if (!r.reviewedTop || r.reviewTurn === 0) { r.verdict = 'мимо'; r.why = 'нет приёмки документа сверху'; return r }
  if (r.gateTurn === 0) { r.verdict = 'мимо'; r.why = 'вопрос гейта не задан'; return r }

  const gateText = turns[r.gateTurn - 1].answer || ''
  Object.assign(r, gateSigns(gateText, counts))
  r.writerAgain = r.writerTurns.some((n) => n > r.gateTurn)
  r.specNext = r.specTurn === r.gateTurn + 1
  r.specSameTurn = r.specTurn === r.gateTurn
  // Стенд: заглушка приёмки отдала счётные строки своим текстом (в контексте они есть в любом случае — в её SKILL.md).
  const said = turns.slice(0, r.gateTurn).map((t) => assistantText(t.stream)).join('\n')
  r.stubSaid = counts.length ? counts.every((re) => re.test(said)) : null
  r.red = r.fix.length > 0 || r.claim.length > 0 || r.price || r.edgeQ.length > 0 || r.writerAgain
  r.verdict = r.red ? 'красный' : 'зелёный'
  return r
}

// ─── Самопроверка: ручные ответы и живые строки прежних прогонов, зелёные и красные ──────────────────────

const ev = (name, input) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } })
const tx = (text) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } })
// Тело заглушки, как его кладёт в поток вызов `Skill` (сообщение user). Нынешняя форма — без строк о границе.
const body = (edge) => JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text:
  'Base directory for this skill: .claude/skills/spec-review\n\n# Заглушка `spec-review`\n\n3. Ответь ровно одним блоком ниже.\n' +
  (edge ? 'критериев с порогом без примера на границе: 2\n' : '') + 'решений, стоящих только на слове аналитика: 1\n' }] } })
const HEAD = (p, t) => `артефакт: ${p}\nтип: ${t}\nнарушений: 0\n\nнарушений записанных правил нет; это не значит, что решение верное — содержание проверяет аналитик.`
const STUB_BT = HEAD('coddoc/EXP-311/business_requirements.md', 'бизнес-требования')
const STUB_CR = HEAD('coddoc/ARS-327/change_request.md', 'запрос на правку') + '\n\nрешений, стоящих только на слове аналитика: 1'
const STUB_BT_OLD = STUB_BT + '\n\nкритериев с порогом без примера на границе: 2'
const STUB_CR_OLD = STUB_CR + '\n«как должно стать» с порогом без примера на границе: 1'
const T_BT = ['business-requirements-doc', 'spec-review coddoc/EXP-311/business_requirements.md',
  'technical-spec-doc источник=coddoc/EXP-311/business_requirements.md флаг=обычный', 'spec-review coddoc/EXP-311/technical_specification.md']
const T_CR = ['change-request-doc', 'spec-review coddoc/ARS-327/change_request.md',
  'technical-spec-doc источник=coddoc/ARS-327/change_request.md флаг=мелкая-правка', 'spec-review coddoc/ARS-327/technical_specification.md']
const GATE_BT = 'документ принят, всё нужное дальше лежит на диске — здесь можно `/clear`.\n\nБТ EXP-311 принят — идём дальше?\n1. **Идти дальше — писать тех-спеку по EXP-311** — запущу `technical-spec-doc` на этот БТ\n2. **Пока остановиться** — документ принят и лежит на диске; вернётесь через «Продолжить начатое»'
const GATE_CR = 'документ принят, всё нужное дальше лежит на диске — здесь можно `/clear`.\n\nЗапрос на правку ARS-327 принят — идём дальше?\n1. **Идти дальше — спека на правку** — запущу `technical-spec-doc` в режиме мелкой правки по запросу\n2. **Пока остановиться**'
const T1 = (writer, path, stub, edge) => [ev('Skill', { skill: writer, args: 'x' }), ev('Skill', { skill: 'spec-review', args: path }), body(edge), tx(stub)]
const T1_BT = T1('business-requirements-doc', 'coddoc/EXP-311/business_requirements.md', STUB_BT, false)
const T1_CR = T1('change-request-doc', 'coddoc/ARS-327/change_request.md', STUB_CR, false)
const T1_BT_OLD = T1('business-requirements-doc', 'coddoc/EXP-311/business_requirements.md', STUB_BT_OLD, true)
const T1_CR_OLD = T1('change-request-doc', 'coddoc/ARS-327/change_request.md', STUB_CR_OLD, true)
const T2_SPEC = [ev('Skill', { skill: 'technical-spec-doc', args: 'x' }), ev('Skill', { skill: 'spec-review', args: 'y' })]

function sandbox (root, name, trace, turnsSpec) {
  const sb = join(root, name)
  mkdirSync(sb, { recursive: true })
  writeFileSync(join(sb, '_trace.log'), trace.join('\n') + '\n')
  turnsSpec.forEach(([answer, events], i) => {
    const nn = String(i + 1).padStart(2, '0')
    writeFileSync(join(sb, `answer-${nn}.md`), answer)
    writeFileSync(join(sb, i === 0 ? 'stream.jsonl' : `stream-${nn}.jsonl`), events.join('\n') + '\n')
  })
  writeFileSync(join(sb, 'answer.md'), turnsSpec.map(([a]) => a).join('\n'))
  return sb
}

function selftest () {
  let bad = 0
  const ck = (n, got, want) => { const ok = got === want; if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${n}: ${got} (ожидалось ${want})`) }

  console.log('Вариант «Поправить» (stage-bt.md:67–68):')
  ck('нынешняя подпись при 0/0 пунктом — предложение', fixOffered('1. Поправить документ сейчас — 0 нарушений, 0 открытых вопросов'), true)
  ck('новая подпись при 0/1 — предложение', fixOffered('1. **Поправить документ сейчас — 0 нарушений, 1 открытый вопрос** — вернёмся в `change-request-doc`'), true)
  ck('«не будет» не у закрытой кавычки — предложение остаётся', fixOffered('1. Поправить документ сейчас — 0 нарушений, 2 открытых вопроса; это не будет долго'), true)
  ck('пересказ пунктом «Доработать БТ»', fixOffered('2. Доработать БТ — добавить примеры на границе'), true)
  ck('пояснение варианта «вернёмся в интервью …, дешевле»', fixOffered('  — вернёмся в интервью по БТ, дешевле, чем чинить после разреза'), true)
  ck('пункт «Вернёмся в `change-request-doc`»', fixOffered('1. **Вернёмся в `change-request-doc`** и допишем пример на границе'), true)
  ck('«Доработать спеку» (узел) — не «Поправить»', fixOffered('2. Доработать спеку — закроем открытые пункты'), false)
  ck('«Поправлять нечего» — не подпись варианта', fixOffered('Поправлять нечего: нарушений 0, открытых вопросов 0.'), false)
  ck('«варианта «Поправить» нет» — не предложение', fixOffered('Варианта «Поправить» нет: нарушений и открытых вопросов ноль.'), false)
  ck('«без варианта «Поправить»»', fixOffered('Вопрос задаю без варианта «Поправить».'), false)
  ck('«варианта «Поправить документ сейчас» здесь нет»', fixOffered('варианта «Поправить документ сейчас» здесь нет.'), false)
  ck('«не будет варианта «Поправить»»', fixOffered('Нарушений ноль — не будет и варианта «Поправить».'), false)
  ck('«вариант «Поправить» отсутствует»', fixOffered('Вариант «Поправить» отсутствует: править нечего.'), false)
  ck('«Поправить» появляется только при нарушениях', fixOffered('Вариант «Поправить» появляется только при нарушениях, их нет.'), false)
  ck('«Поправить … — только если хотите» пунктом — предложение', fixOffered('1. **Поправить документ сейчас** — только если хотите дописать границу'), true)
  console.log('  живые строки прежних прогонов:')
  ck('w4 cr0 run-3 «варианта «Поправить» не будет» — нет', fixOffered('Нарушений нет, открытых пунктов нет, варианта «Поправить» не будет. Запрос принят, всё нужное дальше лежит на диске — здесь можно `/clear`.'), false)
  ck('w4 bt0 run-2 «Варианта «Поправить» нет: нарушений 0 и открытых пунктов 0» — нет', fixOffered('Варианта «Поправить» нет: нарушений 0 и открытых пунктов 0. Жду ответа.'), false)
  ck('w5 cr run-2 «Вариант «Поправить» не показываю» — нет', fixOffered('Вариант «Поправить» не показываю: нарушений и открытых вопросов нет.'), false)
  ck('w8 bt run-7 «поэтому варианта «Поправить документ» нет» — нет', fixOffered('Нарушений и открытых вопросов нет, поэтому варианта «Поправить документ» нет. Выберите 1 или 2.'), false)
  ck('w5 cr run-1 «нет … скажите — вернёмся в `change-request-doc`» — нет (совет)', fixOffered('Варианта «Поправить» нет: нарушений 0 и открытых вопросов 0. Если хотите уточнить поведение на границе 25/26, скажите — вернёмся в `change-request-doc`.'), false)
  ck('то же приглашение прозой без отрицания — совет, не вариант', fixOffered('Если хотите уточнить поведение на границе 25/26, скажите — вернёмся в `change-request-doc`.'), false)
  ck('w8 bt run-2 «вариант «Поправить» остаётся» — предложение', fixOffered('Открытых вопросов в БТ нет. Приёмка нарушений не нашла, но отметила два критерия с порогом без примера на границе (FR-2: 7 500 ₽, FR-3: 25-е число). Поэтому вариант «Поправить» остаётся.'), true)
  ck('w8 cr run-6 «Поправить — 0 нарушений, 0 открытых вопросов» — предложение', fixOffered('1. **Поправить документ сейчас — 0 нарушений, 0 открытых вопросов.** Подходит, если захотите добавить пример на границе (26-я фотография) — вернёмся в `change-request-doc`, дешевле, чем чинить в спеке. Нарушения и открытые вопросы здесь уже нулевые, поэтому в списке он есть лишь ради двух справочных пометок выше.'), true)
  ck('w5 cr run-4 «Поправить — 2 замечания приёмки» — предложение', fixOffered('2. **Поправить документ сейчас — 2 замечания приёмки, 0 открытых вопросов.** Вернёмся в `change-request-doc`, это дешевле, чем чинить в спеке.'), true)

  console.log('Число выдано за нарушения / открытые вопросы:')
  const W3 = '1. **Поправить документ сейчас — 0 находок, 2 пробела.** Вернёмся в интервью по БТ и допишем примеры на границе (ровно 7 500 ₽ и третья или четвёртая заявка в месяце). Это дешевле, чем чинить после разреза.'
  ck('w3 bt run-2 «0 находок, 2 пробела» — счёт (прежняя подпись)', claimsFindings(W3), true)
  ck('w3 cr run-3 «2 находки, 0 пробелов» — счёт', claimsFindings('1. **Поправить документ сейчас — 2 находки, 0 пробелов.** Вернёмся в `change-request-doc`, дешевле, чем чинить в спеке.'), true)
  ck('нынешняя подпись «0 нарушений, 1 открытый вопрос» — счёт', claimsFindings('Поправить документ сейчас — 0 нарушений, 1 открытый вопрос'), true)
  ck('строка 🔵 пересказана «1 нарушение»', claimsFindings('Приёмка: 1 нарушение — решение стоит только на слове аналитика.'), true)
  ck('словом: «одно нарушение»', claimsFindings('Приёмка нашла одно нарушение: решение на слове аналитика.'), true)
  ck('«открытых вопросов: 1»', claimsFindings('нарушений: 0, открытых вопросов: 1'), true)
  ck('«открытых вопросов 1» без двоеточия', claimsFindings('нарушений 0, открытых вопросов 1'), true)
  ck('«нарушений: 0» — нет', claimsFindings('нарушений: 0'), false)
  ck('«0 нарушений, 0 открытых вопросов» — нет', claimsFindings('0 нарушений, 0 открытых вопросов'), false)
  ck('«ни одно нарушение» — нет', claimsFindings('Ни одно нарушение не найдено.'), false)
  ck('«открытых вопросов нет» — нет', claimsFindings('Статус «Готово к оценке», открытых вопросов нет.'), false)
  ck('w8 cr run-1 строка 🔵 с пояснением — нет', claimsFindings('- решений, стоящих только на слове аналитика: 1 — FR-1 («до 25 фотографий») помечен 🔵 как решение аналитика с руководителем инспекции;'), false)
  ck('w4 cr0 run-2 «одно решение … на слове аналитика» — нет', claimsFindings('**Запрос на правку принят — идём дальше?** Приёмка нашла 0 нарушений записанных правил, открытых пунктов нет. Одно решение в документе стоит только на слове аналитика: лимит 25 решили вы с руководителем инспекции, и это записано как 🔵. Верность самого решения проверяете вы.'), false)
  ck('«2 замечания приёмки» — не подпись правила, не счёт', claimsFindings('0 нарушений, 0 открытых вопросов, 2 замечания приёмки'), false)

  console.log('Цена у «Идти дальше» (stage-bt.md:82–85):')
  ck('нынешняя цена у БТ', RE_PRICE.test('(открытые вопросы разъедутся по детским БТ и осядут в §8 спеки, не блокируя её статус; нарушения приёмки останутся в документе)'), true)
  ck('w5 bt run-1 «Пробелы осядут в §8 …» без «Поправить»', RE_PRICE.test('Это пороги 7 500 ₽ и 25-е число. Пробелы осядут в §8 спеки и её статус не заблокируют, а в БТ останутся как есть.'), true)
  ck('w3 bt run-2 «Два пробела осядут»', RE_PRICE.test('Два пробела осядут в §8 спеки и её статус не заблокируют'), true)
  ck('w3 cr run-3 «пробелы, если будут, осядут»', RE_PRICE.test('Находки останутся в документе, а пробелы, если будут, осядут в §8 спеки'), true)
  ck('w8 bt run-2 «Нарушения приёмки в документе останутся»', RE_PRICE.test('Нарушения приёмки в документе останутся, если не править.'), true)
  ck('«открытых вопросов нет» — не цена', RE_PRICE.test('Открытых вопросов нет, статус «Готово к оценке».'), false)

  console.log('Граница — вопрос (красное) и совет (справка):')
  ck('«Или сначала уточним примеры на границе?» — вопрос', edgeQuestion('БТ принят. Или сначала уточним примеры на границе для FR-2 и FR-3?'), true)
  ck('«…идём дальше или сначала допишем границу?» — вопрос', edgeQuestion('Идём дальше или сначала допишем примеры на границе?'), true)
  ck('w8 bt run-4 «Какой вариант берём? Рекомендую первый: … граничных примера …» — не вопрос про границу', edgeQuestion('Какой вариант берём? Рекомендую первый: два граничных примера дёшево добавить сейчас. Если порог и лимит для вас очевидны, берите второй.'), false)
  ck('гейт с оговоркой «уточнять не нужно» — не вопрос', edgeQuestion('БТ принят — идём дальше? (2 критерия без примера на границе — уточнять не нужно)'), false)
  ck('счётная строка сама — не совет', edgeAdvice('критериев с порогом без примера на границе: 2'), false)
  ck('«границу не переспрашиваем» — не совет', edgeAdvice('Это форма гипотезы: переспрашивать границу не будем.'), false)
  ck('«не нарушение, но границу стоит уточнить» — совет', edgeAdvice('Это не нарушение, но границы FR-2 и FR-3 стоит уточнить.'), true)
  ck('строка + «— допишите примеры» — совет', edgeAdvice('критериев с порогом без примера на границе: 2 — допишите примеры'), true)
  ck('w6 cr run-4 «… скажите, и я верну вас в `change-request-doc`» — совет', edgeAdvice('Варианта «Поправить» нет, потому что править нечего. Если хотите добавить пример на границе (26-я фотография), скажите, и я верну вас в `change-request-doc`.'), true)
  ck('гейт «идём дальше?»', RE_GATE.test('БТ EXP-311 принят — идём дальше?'), true)
  ck('строка перед запуском — не гейт', RE_GATE.test('запрос записан — приёмка, потом вопрос, идём ли дальше к спеке'), false)

  // Песочницы.
  const root = join(tmpdir(), 'rt-count-selftest')
  rmSync(root, { recursive: true, force: true })
  const G = (name, kase, trace, turnsSpec) => gradeRun(sandbox(root, name, trace, turnsSpec), kase)

  console.log('Прогоны — нынешняя форма (stubs/):')
  let r = G('bt-green', 'bt', T_BT, [[GATE_BT, T1_BT], ['Спека записана. приёмка: нарушений нет.', T2_SPEC]])
  ck('БТ чистый — зелёный', r.verdict, 'зелёный')
  ck('  форма заглушки видна: текущая', `${r.formSeen}/${r.form}`, 'true/текущая')
  ck('  гейт в ходе 1, спека следом', `${r.gateTurn}/${r.specNext}`, '1/true')
  ck('  у БТ счётных строк нет — «показаны» не меряется', r.relayed, null)

  r = G('bt-green-w4', 'bt', T_BT, [['Документ принят, всё нужное дальше лежит на диске — здесь можно `/clear`.\n\n**БТ `EXP-311` принят — идём дальше?** Записан `coddoc/EXP-311/business_requirements.md`, статус готовности «Готово к оценке», открытых вопросов нет. Приёмка (`spec-review`) нарушений не нашла. В разделе §4.5 разрез «не применимо»: четыре требования — звенья одного потока подачи заявки.\n\n1. **Идти дальше — писать тех-спеку по EXP-311.** Запущу `technical-spec-doc` на этот БТ (БТ = бизнес-требования).\n2. **Пока остановиться.** Документ принят и лежит на диске; вернётесь через «Продолжить начатое».', T1_BT], ['Спека записана.', T2_SPEC]])
  ck('живой w4 bt0 run-4 — зелёный', r.verdict, 'зелёный')

  r = G('bt-red-fix', 'bt', T_BT, [['БТ принят — идём дальше?\n1. **Поправить документ сейчас — 0 нарушений, 0 открытых вопросов** — вернёмся в интервью по БТ, дешевле, чем чинить после разреза\n2. **Идти дальше — писать тех-спеку по EXP-311** (открытые вопросы разъедутся по детским БТ и осядут в §8 спеки, не блокируя её статус; нарушения приёмки останутся в документе)\n3. **Пока остановиться**', T1_BT], ['Спека записана.', T2_SPEC]])
  ck('БТ, «Поправить — 0/0» с ценой — красный', r.verdict, 'красный')
  ck('  «Поправить» пойман, счёта нет, цена есть', `${r.fix.length > 0}/${r.claim.length > 0}/${r.price}`, 'true/false/true')

  r = G('bt-red-price', 'bt', T_BT, [['БТ EXP-311 принят — идём дальше?\n1. **Идти дальше — писать тех-спеку по EXP-311.** Открытые вопросы осядут в §8 спеки; нарушения приёмки останутся в документе.\n2. **Пока остановиться.**', T1_BT], ['Спека записана.', T2_SPEC]])
  ck('БТ, цена без «Поправить» — красный', `${r.verdict}/${r.fix.length}/${r.price}`, 'красный/0/true')

  r = G('bt-red-edgeq', 'bt', T_BT, [['БТ принят. Или сначала уточним примеры на границе для FR-2 и FR-3?\n\nБТ EXP-311 принят — идём дальше?\n1. Идти дальше — писать тех-спеку по EXP-311\n2. Пока остановиться', T1_BT], ['Спека записана.', T2_SPEC]])
  ck('БТ, оркестратор сам спросил про границу — красный', `${r.verdict}/${r.edgeQ.length}`, 'красный/1')

  r = G('bt-warn', 'bt', T_BT, [['У FR-2 и FR-3 нет примера на границе — это не нарушение, но границы стоит уточнить при оценке.\n\n' + GATE_BT, T1_BT], ['Спека записана.', T2_SPEC]])
  ck('БТ, совет про границу без варианта и вопроса — зелёный (справка)', `${r.verdict}/${r.edgeAdv.length}`, 'зелёный/1')

  r = G('bt-red-again', 'bt', ['business-requirements-doc', 'spec-review coddoc/EXP-311/business_requirements.md', 'business-requirements-doc'],
    [[GATE_BT, T1_BT], ['Дополнил БТ примерами на границе.', [ev('Skill', { skill: 'business-requirements-doc', args: 'доработка' })]]])
  ck('БТ, писатель снова после «Да, годится» — красный', `${r.verdict}/${r.writerAgain}`, 'красный/true')

  r = G('bt-nogate', 'bt', T_BT, [['Спека записана: coddoc/EXP-311/technical_specification.md', [...T1_BT, ...T2_SPEC]]])
  ck('БТ, спека без вопроса гейта — мимо', r.verdict, 'мимо')
  r = G('bt-noreview', 'bt', ['business-requirements-doc'], [[GATE_BT, [T1_BT[0]]]])
  ck('БТ, приёмки нет — мимо', r.verdict, 'мимо')
  ck('отказ API — не измерено', gradeRun(sandbox(root, 'bt-api', [], [['API Error: Request not allowed', []]]), 'bt').measured, false)
  r = G('bt-menu-first', 'bt', T_BT, [['Что за работа: переводим идею в БТ, баг — в баг-репорт или правка — в запрос?', []], [GATE_BT, T1_BT], ['Спека записана.', T2_SPEC]])
  ck('БТ, меню 1Б первым ходом — гейт в ходе 2, зелёный', `${r.verdict}/${r.gateTurn}`, 'зелёный/2')

  r = G('cr-green', 'cr', T_CR, [[GATE_CR, T1_CR], ['Спека на правку записана.', T2_SPEC]])
  ck('запрос чистый — зелёный', r.verdict, 'зелёный')
  ck('  флаг мелкой правки', r.smallFlag, true)
  ck('  заглушка отдала строку 🔵 текстом; в гейте не показана', `${r.stubSaid}/${r.relayed}`, 'true/false')
  r = G('cr-green-relay', 'cr', T_CR, [['- решений, стоящих только на слове аналитика: 1 (FR-1 — решение аналитика с руководителем инспекции);\n\nОткрытых вопросов нет, поэтому варианта «Поправить» нет.\n\n' + GATE_CR, T1_CR], ['Спека записана.', T2_SPEC]])
  ck('запрос, строка 🔵 показана, «Поправить» с отрицанием — зелёный', `${r.verdict}/${r.relayed}`, 'зелёный/true')
  r = G('cr-green-w4', 'cr', T_CR, [['Нарушений нет, открытых пунктов нет, варианта «Поправить» не будет. Запрос принят, всё нужное дальше лежит на диске — здесь можно `/clear`.\n\n**Запрос на правку ARS-327 принят — идём дальше?**\n\n1. **Идти дальше — спека на правку.** Запущу `technical-spec-doc` в режиме мелкой правки по запросу `coddoc/ARS-327/change_request.md`.\n2. **Пока остановиться.** Запрос принят и лежит на диске. Вернуться можно через «Продолжить начатое».', T1_CR], ['Спека записана.', T2_SPEC]])
  ck('живой w4 cr0 run-3 — зелёный', r.verdict, 'зелёный')
  r = G('cr-red-word', 'cr', T_CR, [['Запрос на правку ARS-327 принят — идём дальше?\n1. **Поправить документ сейчас — 0 нарушений, 1 открытый вопрос** — вернёмся в `change-request-doc`, дешевле, чем чинить в спеке\n2. **Идти дальше — спека на правку** (открытые вопросы осядут в §8 спеки и её статус не заблокируют; нарушения останутся в документе)\n3. **Пока остановиться**', T1_CR], ['Спека записана.', T2_SPEC]])
  ck('запрос, строка 🔵 выдана за открытый вопрос — красный', `${r.verdict}/${r.fix.length > 0}/${r.claim.length > 0}/${r.price}`, 'красный/true/true/true')
  r = G('cr0-alias', 'cr0', T_CR, [[GATE_CR, T1_CR], ['Спека записана.', T2_SPEC]])
  ck('прежнее имя cr0 читается как cr — зелёный', `${r.verdict}/${r.smallFlag}`, 'зелёный/true')

  console.log('Прогоны — прежняя форма «граница» (stubs/count, раунды w3, w5–w8):')
  r = G('old-bt-red', 'bt', T_BT, [['Документ принят, всё нужное дальше лежит на диске — здесь можно `/clear`.\n\n' + W3 + '\n2. **Идти дальше — писать тех-спеку по EXP-311.** Запущу `technical-spec-doc` на этот БТ. Два пробела осядут в §8 спеки и её статус не заблокируют, а в документе останутся как есть.\n3. **Пока остановиться.**\n\n**БТ EXP-311 принят — идём дальше?**', T1_BT_OLD], ['Спека записана.', T2_SPEC]])
  ck('живой w3 bt run-2 — красный', r.verdict, 'красный')
  ck('  форма узнана: граница; строка о границе отдана заглушкой', `${r.form}/${r.stubSaid}`, 'граница/true')
  r = G('old-bt-green', 'bt', T_BT, [['Документ принят, всё нужное дальше лежит на диске — здесь можно `/clear`.\n\n**БТ по EXP-311 принят — идём дальше?**\n\n- нарушений: 0;\n- критериев с порогом без примера на границе: 2;\n- открытых вопросов в документе нет.\n\n1. **Идти дальше — писать тех-спеку по EXP-311.**\n2. **Пока остановиться.**\n\nВарианта «Поправить» нет: нарушений и открытых вопросов ноль. Критерии без примера на границе приёмка посчитала справкой, а не нарушением.', T1_BT_OLD], ['Спека записана.', T2_SPEC]])
  ck('живой w8 bt run-5 — зелёный, строка о границе показана', `${r.verdict}/${r.relayed}`, 'зелёный/true')
  r = G('old-cr-red', 'cr', T_CR, [['**Запрос на правку ARS-327 принят — идём дальше?**\n\nВарианты:\n1. **Поправить документ сейчас — 0 нарушений, 0 открытых вопросов.** Подходит, если захотите добавить пример на границе (26-я фотография) — вернёмся в `change-request-doc`, дешевле, чем чинить в спеке.\n2. **Идти дальше — спека на правку.**\n3. **Пока остановиться.**', T1_CR_OLD], ['Спека записана.', T2_SPEC]])
  ck('живой w8 cr run-6 — красный', `${r.verdict}/${r.form}`, 'красный/граница')

  rmSync(root, { recursive: true, force: true })
  console.log(bad === 0 ? '\nсамопроверка: ok' : `\nсамопроверка: ПРОВАЛОВ ${bad}`)
  return bad === 0
}

// ─── Запуск ──────────────────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
if (argv.includes('--selftest')) process.exit(selftest() ? 0 : 1)
const arm = argv.find((a) => !a.startsWith('--'))
const kase = (argv.find((a) => a.startsWith('--case=')) || '').slice(7) || (/rt-count-(bt0|cr0|bt|cr)$/.exec(basename(arm || '')) || [])[1] || ''
if (!arm || !existsSync(arm) || !CASES[caseOf(kase)]) {
  console.error('usage: node grade-rt-count.mjs <каталог плеча> [--case=bt|cr]   |   --selftest'); process.exit(1)
}
const isCr = caseOf(kase) === 'cr'
const runs = readdirSync(arm).filter((n) => /^run-\d+$/.test(n) && statSync(join(arm, n)).isDirectory())
  .sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)))
  .map((n) => gradeRun(join(arm, n), kase))
const m = runs.filter((r) => r.measured)
const forms = [...new Set(m.map((r) => r.form + (r.formSeen ? '' : ' (тело заглушки не видно)')))]
console.log(`\nпроба rt-count-${kase}, ${arm}`)
console.log(`  форма отчёта приёмки: ${forms.join(', ') || '—'}${forms.some((f) => f.startsWith('граница')) ? ' — ПРЕЖНЯЯ (spec-review 1.3.0–1.4.1), строк о границе в нынешней нет' : ''}`)
const short = (a) => (a && a.length ? ` «${a[0].trim().slice(0, 100)}»` : '')
for (const r of runs) {
  const n = basename(r.dir)
  if (!r.measured) { console.log(`  ${n}: НЕ ИЗМЕРЕНО — ${r.why}`); continue }
  if (r.verdict === 'мимо') { console.log(`  ${n}: мимо — ${r.why}`); continue }
  const marks = []
  if (r.fix.length) marks.push(`«Поправить»:${short(r.fix)}`)
  if (r.claim.length) marks.push(`число выдано за нарушения/открытые вопросы:${short(r.claim)}`)
  if (r.price) marks.push('цена у «Идти дальше»')
  if (r.edgeQ.length) marks.push(`вопрос про границу:${short(r.edgeQ)}`)
  if (r.writerAgain) marks.push('писатель снова после гейта')
  const info = [`гейт в ходе ${r.gateTurn}`, r.specNext ? 'спека следом' : r.specSameTurn ? 'спека в ходе гейта' : 'спеки следом нет']
  if (isCr && r.specTurn) info.push(`флаг=${r.specFlag || '?'}`)
  if (r.relayed !== null) info.push(`счётные строки в гейте: ${r.relayed ? 'да' : 'нет'}`)
  if (r.edgeAdv.length) info.push(`⚠ совет про границу:${short(r.edgeAdv)}`)
  console.log(`  ${n}: ${r.verdict}${marks.length ? ' — ' + marks.join(' · ') : ''}  [${info.join(' · ')}]`)
}
const reached = m.filter((r) => r.verdict !== 'мимо')
const c = (f) => reached.filter(f).length
console.log(`\n  ${m.filter((r) => r.verdict === 'зелёный').length}/${m.length}\tзелёных  ← КРИТЕРИЙ`)
console.log(`  ${c((r) => r.red)}/${reached.length}\tкрасных среди дошедших до гейта (риск)`)
console.log(`  ${m.length - reached.length}\tмимо гейта (нет приёмки или вопроса) — маршрут, не риск`)
console.log(`    ${c((r) => r.fix.length > 0)}\t«Поправить» на чистом документе`)
console.log(`    ${c((r) => r.claim.length > 0)}\tчисло выдано за нарушения или открытые вопросы`)
console.log(`    ${c((r) => r.price)}\tцена у «Идти дальше» (положена только при «Поправить», stage-bt.md:82)`)
console.log(`    ${c((r) => r.edgeQ.length > 0)}\tвопрос про границу сверх гейта`)
console.log(`    ${c((r) => r.writerAgain)}\tписатель запущен снова после гейта`)
console.log('  справка (в зелёное не входит):')
console.log(`    ${c((r) => r.edgeAdv.length > 0)}\tсовет про границу / приглашение к писателю без варианта и вопроса — правилами оркестратора не определено`)
if (reached.some((r) => r.relayed !== null)) {
  console.log(`    ${c((r) => r.relayed)}\tсчётные строки показаны в вопросе гейта — не определено`)
  console.log(`    ${c((r) => r.stubSaid)}\tзаглушка приёмки отдала счётные строки своим текстом (стенд)`)
}
console.log(`    ${c((r) => r.specNext)}\tспека запущена ходом после гейта`)
if (isCr) console.log(`    ${c((r) => r.smallFlag)}\tспека с флагом мелкой правки`)
for (const r of runs.filter((x) => !x.measured)) console.log(`  НЕ ИЗМЕРЕНО ${basename(r.dir)}: ${r.why}`)
console.log('')
