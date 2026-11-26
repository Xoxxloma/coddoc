#!/usr/bin/env node
// grade-br-data.mjs — пробы гейта 15 «Бизнес-данные» (скилл: business-requirements-doc 1.2.0),
// PLAN-BR-SECTIONS §1.1.
//
//   node grade-br-data.mjs <каталог плеча> --case=obj|none|dlt0|dlt1|file
//   node grade-br-data.mjs --selftest
//
// ЧТО МЕРЯЕТСЯ. Гейт 15 закрывается списком объектов; сведения по объектам — ни вопросом, ни
// гипотезой: они только переносятся из материала пользователя.
//   obj  — новый функционал, карточки BR-REAL (объекты там названы кодом: `WorkItem` — позиция
//          сметы). Ход 1: вопросы, файла нет, кодовых имён объектов нет, вопроса/гипотезы по
//          сведениям нет. Ход 2: §4.3 с объектами (фото, работа по смете, акт приёмки), без
//          кодовых имён и без сведений, которых аналитик не давал.
//   none — тот же бриф без окружения: ход 1 не ссылается на карточки/код, которых нет.
//   dlt0 — доработка, ответ «данные не меняются» → §4.3 «не применимо: причина».
//   dlt1 — доработка, ответ «появляется причина отклонения» → §4.3 называет её и что она новая.
//   file — регресс прода: один ход «ПРОДОЛЖЕНИЕ», состав данных в файле coddoc/MNT-410/data.md →
//          БТ этим ходом, в §4.3 все 12 сведений файла бизнес-названиями, кодовых имён нет нигде.
//
// Критерии названы до прогонов (PLAN-BR-SECTIONS §1.0: N = 3, провал новой пробы → разбор).

import { readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { read, turn, apiFailed, writesBt, sectionByTitle, askedBlocks, dropNegated } from './br-lib.mjs'

const CASES = {
  obj: { rel: 'coddoc/REP-301/business_requirements.md', turns: 2 },
  none: { rel: 'coddoc/REP-311/business_requirements.md', turns: 2 },
  dlt0: { rel: 'coddoc/REP-302/business_requirements.md', turns: 2 },
  dlt1: { rel: 'coddoc/REP-302/business_requirements.md', turns: 2 },
  file: { rel: 'coddoc/MNT-410/business_requirements.md', turns: 1 },
}

// Кодовые имена объектов из карточки repairy-api (заголовки «Бизнес-правил»: `### \`WorkItem\` — …`).
// Имена ролей сюда НЕ входят: их скилл обязан давать дословно.
export const RE_CODE_OBJ = /\b(WorkAcceptanceItem|WorkAcceptance|WorkItem|ProjectCustomer|ProjectMember)\b|`Project`|\bProject\b(?!Member|Customer)/
const RE_CODE_STATE = /\b(ACCEPTED|REJECTED|REVIEWED|PENDING)\b/
// Сведения о фото, которых аналитик не давал: их появление — гипотеза или выдумка сведений.
export const RE_ATTR = /(дат[аыуе]\s+(съ[её]мк|загрузк)|время\s+(съ[её]мк|загрузк)|автор\p{L}*\s+(фото|снимк)|подпис\p{L}*\s+(к\s+)?фото|описани\p{L}*\s+(к\s+)?фото|геолок|координат|формат\p{L}*\s+(фото|файл|изображ)|размер\p{L}*\s+(фото|файл)|разрешени\p{L}*\s+(фото|снимк|изображ)|EXIF)/iu
// Вопрос о составе сведений «вообще»: «какие поля / сведения / атрибуты …?».
export const RE_ATTR_Q = /(какие|какой\s+набор)\s+(поля|сведени\p{L}*|атрибут\p{L}*|реквизит\p{L}*|данные\s+о\s+фото)[^?\n]{0,120}\?/iu
// Ссылка на источник, которого в окружении `none` нет.
export const RE_FAKE_SRC = /(services\/|карточк\p{L}*\s+(сервис|сервера)|в\s+карточке|по\s+коду|из\s+кода|repairy)/iu

// Файл coddoc/MNT-410/data.md — 12 сведений и их кодовые имена. Сведение засчитывается по смысловой основе,
// а не по фразе файла: перенос таблицей «Станок → инвентарный номер, цех, модель…» — тот же перенос
// (без привязки к форме файла — решение человека 2026-10-07). Текст §4.3 перед сверкой — `norm()`.
export const FILE_ITEMS = [
  ['Инвентарный номер станка', /инвентарн\p{L}* номер/u],
  ['Цех', /(?<!\p{L})цех(?!\p{L})/u],
  ['Модель станка', /(?<!\p{L})модел[ьи]/u],
  ['Дата последнего планового ремонта', /последн\p{L}* планов\p{L}* ремонт/u],
  ['Код неисправности', /(?<!\p{L})код(?!\p{L})/u],
  ['Описание неисправности от системы мониторинга', /(?<!\p{L})описани/u],
  ['Время обнаружения неисправности', /обнаружени/u],
  ['Признак остановки станка', /признак\p{L}* останов|остановк\p{L}* станка|остановлен ли/u],
  ['Номер заявки', /(?<!инвентарный )номер(?!\p{L})|номер\p{L}* заявк/u],
  ['Уровень срочности', /срочност/u],
  ['Ответственный мастер', /ответственн\p{L}*( \p{L}+)? мастер|назначенн\p{L}* мастер|мастер\p{L}*,? (котор|назнач|ответствен)/u],
  ['Плановая дата устранения', /(дат|срок)\p{L}* (\p{L}+ )?устранени/u],
]
export const RE_FILE_CODE = /\b(machine|fault|request)\.\w+|\b(invNo|workshop|lastServiceDate|detectedAt|dueDate)\b|`urgency`|`master`/

const norm = (s) => (s || '').toLowerCase().replace(/ё/g, 'е').replace(/[*_`«»"]/g, '').replace(/\s+/g, ' ')

export function gradeT1 (cs, answer, stream) {
  const r = {}
  r.wrote = writesBt(stream) > 0
  // Только вопросы и варианты: пересказ прочитанной карточки с токеном — не дефект (L189–191, BR-REAL).
  const qa = askedBlocks(answer)
  r.code = RE_CODE_OBJ.test(qa)
  // Строки гипотезы о рисках (гейт 6) — не о сведениях: «риск — большие размеры файлов» (пилот A, br-data-none).
  const qaData = qa.split('\n').filter((l) => !/риск/i.test(l)).join('\n')
  r.attr = RE_ATTR.test(qaData) || RE_ATTR_Q.test(qaData)
  r.fake = cs === 'none' && RE_FAKE_SRC.test(dropNegated(qa))
  r.ok = !r.wrote && !r.code && !r.attr && !r.fake
  return r
}

export function gradeDoc (cs, text) {
  const r = { exists: text !== null }
  if (!r.exists) { r.ok = false; return r }
  const sec = sectionByTitle(text, /бизнес[- ]?данн/i)
  const s = sec ? sec.body : null
  r.num = sec ? sec.num : null
  r.has43 = s !== null && s.length > 0
  if (!r.has43) { r.ok = false; return r }
  r.code = RE_CODE_OBJ.test(s) || RE_CODE_STATE.test(s)
  if (cs === 'obj' || cs === 'none') {
    r.objects = /фото/i.test(s) && /(смет|работ)/i.test(s) && /акт/i.test(s)
    r.attr = RE_ATTR.test(s)
    r.ok = r.objects && !r.attr && !r.code
  } else if (cs === 'dlt0') {
    r.na = /не\s+применимо/i.test(s)
    r.ok = r.na && !r.code
  } else if (cs === 'dlt1') {
    r.reason = /причин\p{L}*[^\n]{0,40}отклон|отклон\p{L}*[^\n]{0,40}причин/iu.test(s)
    r.change = /(появ|нов|добав)/i.test(s)
    r.ok = r.reason && r.change && !r.code
  } else if (cs === 'file') {
    const ns = norm(s)
    // Короткое «Цех» — целым словом: «цеха» в соседней строке его не засчитывает.
    r.missing = FILE_ITEMS.filter(([, re]) => !re.test(ns)).map(([name]) => name)
    r.fileCode = RE_FILE_CODE.test(text)
    r.ok = r.missing.length === 0 && !r.fileCode
  }
  return r
}

function selftest () {
  let bad = 0
  const ck = (n, got, want) => { const ok = got === want; if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${n}: ${got} (ожидалось ${want})`) }
  const q1 = 'Ключ дан. Понял так по данным: появляется фото работы; опирается на позицию сметы и акт приёмки — они уже есть. Верно?'
  ck('T1 obj: гипотеза объектами — зелёный', gradeT1('obj', q1, '').ok, true)
  ck('T1 obj: кодовое имя `WorkItem` — красный', gradeT1('obj', q1 + ' (`WorkItem`)', '').ok, false)
  ck('T1 obj: гипотеза сведений «дата съёмки» — красный', gradeT1('obj', q1 + ' У фото: дата съёмки и автор фото — так?', '').ok, false)
  ck('T1 obj: «какие поля у фото?» — красный', gradeT1('obj', 'Какие поля нужны у фото работы?', '').ok, false)
  ck('T1 obj: «сколько фото» — не сведение, зелёный', gradeT1('obj', q1 + ' Сколько фото можно приложить к работе?', '').ok, true)
  ck('T1 obj: роль `CUSTOMER` — не объект, зелёный', gradeT1('obj', q1 + ' Роли из карточки: `CUSTOMER`, `FOREMAN` — верно?', '').ok, true)
  ck('T1 none: «в карточке сервиса» при пустом окружении — красный', gradeT1('none', 'В карточке сервиса вижу акт приёмки — верно?', '').ok, false)
  ck('T1 none: без ссылок — зелёный', gradeT1('none', q1, '').ok, true)
  const doc = (body43) => `# БТ\n\n### 4.2. Критерии приёмки\n- **[FR-1]** Дано…\n\n### 4.3. Бизнес-данные\n${body43}\n\n### 4.5. Разбиение на части\nНе применимо: одна поставка.\n`
  const obj43 = '| № | Объект | Что это | В системе |\n|---|---|---|---|\n| 1 | Фото работы | фото «до» и «после» | новое |\n| 2 | Работа по смете | позиция сметы | уже есть |\n| 3 | Акт приёмки | акт, в котором заказчик принимает работы | уже есть |'
  ck('T2 obj: объекты на месте — зелёный', gradeDoc('obj', doc(obj43)).ok, true)
  ck('T2 obj: §4.3 нет — красный', gradeDoc('obj', '# БТ\n### 4.2. Критерии\n…\n### 4.5. Разбиение\n…').ok, false)
  ck('T2 obj: кодовое имя в ячейке — красный', gradeDoc('obj', doc(obj43.replace('позиция сметы', '`WorkItem`'))).ok, false)
  ck('T2 obj: выдуманное сведение «геолокация» — красный', gradeDoc('obj', doc(obj43 + '\n\nСведения фото: геолокация, дата съёмки.')).ok, false)
  ck('T2 obj: «§4.3 Пользовательские сценарии» — не «Бизнес-данные», красный', gradeDoc('obj', doc(obj43).replace('### 4.3. Бизнес-данные', '### 4.3 Пользовательские сценарии')).ok, false)
  ck('T1 obj: токен в пересказе карточки, не в вопросе — зелёный', gradeT1('obj', 'В карточке repairy-api описаны работы сметы (`WorkItem`) и акты.\n\n' + q1, '').ok, true)
  ck('T1 none: «окружение (services/) не найдено» — зелёный', gradeT1('none', 'Окружение (services/, context/) не найдено — работаю от брифа.\n\n' + q1, '').ok, true)
  ck('T1 none: «риски: большие размеры файлов?» — не вопрос о сведениях, зелёный', gradeT1('none', '- Есть ли риски: потеря фото, конфиденциальность, большие размеры файлов?\n\n' + q1, '').ok, true)
  ck('T1 obj: «какие поля у фото — дата съёмки?» — красный', gradeT1('obj', 'Какие сведения хранить у фото — дата съёмки, автор?', '').ok, false)
  ck('T1 none: «в карточке сервиса вижу …?» — красный', gradeT1('none', 'В карточке сервиса вижу фото у работы — так?', '').ok, false)
  ck('T2 obj: заголовок «## §4.3» — разбирается', gradeDoc('obj', doc(obj43).replace('### 4.3.', '## §4.3')).ok, true)
  ck('T2 dlt0: «не применимо: причина» — зелёный', gradeDoc('dlt0', doc('Не применимо: данные не меняются — причина отклонения в акте уже есть.')).ok, true)
  ck('T2 dlt0: таблица вместо «не применимо» — красный', gradeDoc('dlt0', doc(obj43)).ok, false)
  ck('T2 dlt1: причина отклонения появляется — зелёный', gradeDoc('dlt1', doc('| 1 | Работа в акте приёмки | … | появляется причина отклонения |')).ok, true)
  ck('T2 dlt1: «не применимо» — красный', gradeDoc('dlt1', doc('Не применимо: данные не меняются.')).ok, false)
  const all = FILE_ITEMS.map(([it], i) => `| ${i + 1} | ${it} | … |`).join('\n')
  const grouped = '| 1 | Станок | инвентарный номер; цех; модель; дата последнего планового ремонта |\n' +
    '| 2 | Неисправность | код; описание от системы мониторинга; время обнаружения; признак остановки станка |\n' +
    '| 3 | Заявка на ремонт | номер; уровень срочности; ответственный мастер; плановая дата устранения |'
  ck('T2 file: все 12 сведений — зелёный', gradeDoc('file', doc(all)).ok, true)
  ck('T2 file: потеряно «Цех» — красный', gradeDoc('file', doc(all.replace('| Цех |', '| |'))).ok, false)
  ck('T2 file: «Цех» потерян, но есть «цеха» рядом — красный', gradeDoc('file', doc(all.replace('| Цех |', '| |') + '\nФильтр списка — по номеру цеха.')).ok, false)
  ck('T2 file: короткие названия под объектами — зелёный', gradeDoc('file', doc(grouped)).ok, true)
  ck('T2 file: потерян номер заявки, инвентарный номер есть — красный', gradeDoc('file', doc(grouped.replace('| номер;', '|'))).ok, false)
  ck('T2 file: потерян признак остановки, «может остановиться» рядом — красный', gradeDoc('file', doc(grouped.replace('; признак остановки станка', '') + '\nНеисправность — поломка, из-за которой станок может остановиться.')).ok, false)
  ck('T2 file: потерян признак остановки, «срочная, если станок остановлен» рядом — красный', gradeDoc('file', doc(grouped.replace('; признак остановки станка', '') + '\nСрочность: «срочная», если станок остановлен, иначе «обычная».')).ok, false)
  ck('T2 file: потерян мастер, «мастер» в описании объекта — красный', gradeDoc('file', doc(grouped.replace('; ответственный мастер', '') + '\nЗаявка — то, по чему работает мастер.')).ok, false)
  ck('T2 file: кодовое имя `machine.invNo` где угодно — красный', gradeDoc('file', doc(all) + '\nсм. `machine.invNo`').ok, false)
  ck('T2 file: «Время обнаружения неисправности» с «ё»/регистром — находится', gradeDoc('file', doc(all.replace('Время обнаружения неисправности', 'время обнаружения НЕИСПРАВНОСТИ'))).ok, true)
  console.log(bad === 0 ? '\nсамопроверка: ok' : `\nсамопроверка: ПРОВАЛОВ ${bad}`)
  process.exit(bad === 0 ? 0 : 1)
}

const arg = process.argv[2]
if (arg === '--selftest') selftest()
const cs = (process.argv.find((a) => a.startsWith('--case=')) || '').slice(7)
if (!arg || !existsSync(arg) || !CASES[cs]) { console.error('usage: node grade-br-data.mjs <каталог плеча> --case=obj|none|dlt0|dlt1|file | --selftest'); process.exit(1) }
const { rel, turns } = CASES[cs]
const runs = readdirSync(arg).filter((n) => /^run-\d+$/.test(n) && statSync(join(arg, n)).isDirectory()).sort()
console.log(`\nпроба br-data-${cs}, ${arg}`)
let measured = 0; let green = 0
for (const n of runs) {
  const dir = join(arg, n)
  const t1 = turn(dir, 1); const t2 = turns > 1 ? turn(dir, 2) : null
  if (apiFailed(dir, turns > 1 ? [t1.answer, t2.answer] : [t1.answer])) { console.log(`  ${n}: НЕ ИЗМЕРЕНО`); continue }
  measured++
  const a = turns > 1 ? gradeT1(cs, t1.answer, t1.stream) : { ok: true }
  const b = gradeDoc(cs, read(join(dir, rel)))
  const ok = a.ok && b.ok
  if (ok) green++
  const notes = [
    a.wrote && 'ход 1: ФАЙЛ ЗАПИСАН', a.code && 'ход 1: кодовое имя объекта', a.attr && 'ход 1: вопрос/гипотеза по сведениям', a.fake && 'ход 1: ссылка на несуществующий источник',
    !b.exists && 'файла нет', b.exists && !b.has43 && 'раздела «Бизнес-данные» нет', b.num && b.num !== '4.3' && `«Бизнес-данные» под номером ${b.num}`, b.code && '§4.3: кодовое имя',
    b.objects === false && '§4.3: не все объекты', b.attr && '§4.3: сведения, которых не давали',
    b.na === false && '§4.3: нет «не применимо»', b.reason === false && '§4.3: нет причины отклонения', b.change === false && '§4.3: не сказано, что новое',
    b.missing && b.missing.length && `§4.3: потеряно ${b.missing.length} из ${FILE_ITEMS.length}: ${b.missing.join('; ')}`, b.fileCode && 'кодовое имя из файла в БТ',
  ].filter(Boolean)
  console.log(`  ${n}: ${ok ? 'зелёный' : 'красный'}${notes.length ? ' · ' + notes.join(' · ') : ''}`)
}
console.log(`\n  ${green}/${measured}\tзелёных  ← КРИТЕРИЙ (N = 3: провал → разбор)\n`)
