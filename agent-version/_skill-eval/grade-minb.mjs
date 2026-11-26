#!/usr/bin/env node
// grade-minb.mjs — пробы meeting-intake 1.1.0: ноут аналитика на входе (IN, ANS) и цель «в ноут» (OUT, REC, SAME).
//
//   node grade-minb.mjs <каталог проб> --fx IN|OUT|REC|ANS|SAME
//   node grade-minb.mjs --selftest
//
// Грейдится ФАЙЛ в песочнице, а не отчёт. IN — вход `coddoc/PVZ-318/notebook-<дата>-bt.md` по анкерам
// fixtures/MI-NB-IN/expected.md; ANS — вход `coddoc/RET-214/notebook-<дата>-bt.md` из ноута с `отвечает на:`
// (fixtures/MI-NB-ANS/expected.md); OUT, REC и SAME — новая запись в конце ноута по
// fixtures/MI-NB-{OUT,REC,SAME}/expected.md. Разбор — каждая цитата сверяется со строкой источника ±2 (ноут,
// расшифровка или протокол), как в grade-meet.mjs; у каждой строки `цитаты:` — текст в кавычках (Шаг 8). Ответы
// прогона (`answer-*.md`) и потоки (`stream*.jsonl`) читаются только для критериев о ходах: выбор темы, ключ задачи,
// спор со старым пунктом (SAME), стоп на «решений нет» — других следов у них нет.

import { resolve as pathResolve } from 'node:path'
import { readdirSync, readFileSync, existsSync, statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const lf = (s) => s.replace(/\r\n/g, '\n')
const read = (p) => lf(readFileSync(p, 'utf8'))
const RE_API_FAILURE = /API Error|Request not allowed|Please run \/login|Credit balance|rate limit|session limit|usage limit/i

const NB = 'notes/посылки-от-частных-лиц/notebook.md'
const NB_REC = 'notes/отмена-записи/notebook.md'
const NB_ANS = 'notes/возврат-товара-без-чека/notebook.md'
const CALL = 'calls/2026-10-10-pvz-kak-seychas.txt'
const BT77 = 'coddoc/MED-77/business_requirements.md'
const REC77 = 'coddoc/MED-77/meeting-2026-10-14.recall.md'

// Граница слова для кириллицы — `(^|[^а-яё])`: `\b` в JS только ASCII. Новые регулярки по кириллице — через `w()`.
const w = (stem, flags = 'i') => new RegExp('(^|[^а-яёa-z])' + stem, flags)
// Несколько регулярок одним условием «любая из».
const anyRe = (...rs) => ({ test: (s) => rs.some((r) => r.test(s)) })
// Весы: «с весами», «где есть весы», «на весах», «с весовым оборудованием» (ревью 1.1.0); «вес посылки» — не весы.
const RE_SCALES = anyRe(w('вес(ы|ами|ах|ов)(?![а-яё])'), w('весов\\S*\\s+(оборудовани|аппарат|техник)'))
const RE_15KG = /(^|[^\d])15\s*(кг|килогр)|пятнадцат\S*\s+килогр/i
const RE_X = /(в\s+любом|во\s+всех|в\s+каждом)\s+(пункт|точк|ПВЗ)|(^|[^а-яё])везде([^а-яё]|$)|без\s+исключени/i
// Вопрос ноута про вложение («во всех пунктах смотреть вложение?») — не X.
const RE_INSIDE = /внутри|вложени|вскрыв|досмотр|содержим/i
const RE_THOUGHT = /трек[^.;]{0,60}чек|(^|[^а-яё])чек[^.;]{0,60}трек/i
const RE_SKETCH = /экран\S*\s+оператор|сканир\S*[^.;]{0,80}наклейк|наклейк\S*[^.;]{0,40}трек|взвешива\S*[^.;]{0,60}наклейк/i
// Пометка называет аналитика: «(со слов аналитика)», «(набросок аналитика, не подтверждён)», «(мысль аналитика)».
// Круг 2, mi-nb-in run-1: смысл тот же, а дословной фразы ждал только оценщик — принимающие скиллы на неё не опираются,
// защита держится на разделе «Открыто».
// Пилот 1.1.0: «(предложил аналитик, решения нет)» — любая пометка в скобках, называющая аналитика.
const RE_BY_ANALYST = /со\s+слов\s+аналитика|\([^()\n]*аналитик[^()\n]*\)/i
// Якоря во входе и в пунктах ноута: номер строки, ссылка на запись ноута, время с секундами.
const RE_ANCHOR_INPUT = /(^|[^A-Za-z])L\d+([^0-9]|$)|№|\d\d:\d\d:\d\d/
const RE_ANCHOR_ITEM = /(^|[^A-Za-z])L\d+([^0-9]|$)|\d\d:\d\d:\d\d/
// Предупреждение пациенту об оставшейся отмене — мысль аналитика из протокола (L22, ответ «Моя мысль» L34).
const RE_WARN_PATIENT = /предупрежд|осталась\s+(одна|последн)|остал\S*\s+одн\S*\s+отмен|последн\S*\s+отмен/i
// «за 12 часов», «12 ч», «12-часовой», а также «было за 24 часа, стало за 12» — круг 1, mi-nb-rec run-1: верный
// пункт красился.
const RE_H12 = anyRe(/(^|[^\d])12\s*-?\s*(час|ч([^а-яё]|$))/i, w('двенадцат'), /(^|[^\d])24\s*час[^.;]{0,40}[^\d]12([^\d]|$)/i)
// Вопросы скилла в ответах прогона.
const RE_KEY_ASK = /ключ\S*\s+задач\S*\s*\?|как(ой|ов)\s+(у\s+(неё|задачи)\s+)?ключ|если\s+(его\s+)?(ещё\s+)?нет\s*[—–-]+\s*так\s+и\s+напишите|назов\S*\s+ключ|укаж\S*\s+ключ/i
const RE_NO_DECISIONS = /решений\s+(на\s+встрече\s+)?нет/i

// Предложения-вопросы ответа: кусок до «?» от прошлой границы предложения.
const questions = (text) => text.match(/[^.!?\n]*\?/g) || []
// Вопрос о выборе темы — только вопрос или просьба выбрать: утверждение «темы с решениями — одна» не вопрос (ревью 1.1.0).
// «Какая тема стояла в приглашении?» — о встрече, не выбор: именительный падеж не берётся.
const RE_THEME_Q = anyRe(w('(как|котор)(ую|ой|ие|их)\\s+(из\\s+|\\S+\\s+)?(тем|предмет)'), w('(тем|предмет)\\S*[^.!?\\n]{0,40}(выбира|выбер|выбор)'), w('выбор\\S*\\s+(\\S+\\s+)?(тем|предмет)'))
const RE_THEME_PICK = w('выбер(и|ите)\\s+(\\S+\\s+)?(тем|предмет)')
export const themeAsked = (dialog) => RE_THEME_PICK.test(dialog) || questions(dialog).some((q) => RE_THEME_Q.test(q))
// Вопрос о споре со старым пунктом ноута (шаблон Шага 7 «спорит с …: в открытые, новое или старое?») или «что действует».
const RE_DISPUTE_Q = anyRe(w('спор(ит|ят|ящ)\\S*\\s+с'), w('(нов\\S+\\s+или\\s+стар|стар\\S+\\s+или\\s+нов)'), w('что\\s+(действует|верно)'), w('как(ое|ой|ая)\\s+(из\\s+них\\s+|\\S+\\s+)?(действует|верн)'), /(^|\D)(24\s*(час\S*)?\s+или\s+(за\s+)?12|12\s*(час\S*)?\s+или\s+(за\s+)?24)(\D|$)/i)
const RE_DISPUTE_TEMPLATE = w('в\\s+открытые,\\s+нов\\S+\\s+или\\s+стар')
export const disputeAsked = (dialog) => RE_DISPUTE_TEMPLATE.test(dialog) || questions(dialog).some((q) => RE_DISPUTE_Q.test(q))
// Ход-стоп Шага 2: ответ кончается «решений нет», вопроса нет, ноут в этом ходу не писан (ревью 1.1.0). С целью «в ноут»
// при сведениях это ошибка: реплика стенда «согласен» доводит диалог до записи и прячет стоп.
const RE_STOP_TAIL = /решени\S*[^.!?\n]{0,30}?\s(нет|не\s+было)([^а-яё]|$)/i
const RE_ASKS = /\?|вариант\S*\s*:|ответьте|выберите/i

export const FX = {
  IN: {
    kind: 'input',
    seed: { [NB]: `fixtures/MI-NB-IN/seed/${NB}` },
    source: `fixtures/MI-NB-IN/seed/${NB}`,
    inputRe: /^coddoc\/PVZ-318\/notebook-(\d{4}-\d\d-\d\d)-bt\.md$/,
    razborRe: /^coddoc\/PVZ-318\/notebook-(\d{4}-\d\d-\d\d)\.razbor\.md$/,
    razborHeading: /^#{2,3} Во вход/m,
    minQuotes: 6,
    keyAsk: 'warn',
    inputName: 'coddoc/PVZ-318/notebook-<дата>-bt.md',
  },
  // 1.1.0: `отвечает на:` в ноуте на входе закрывает открытый вопрос (fixtures/MI-NB-ANS/expected.md).
  ANS: {
    kind: 'input',
    seed: { [NB_ANS]: `fixtures/MI-NB-ANS/seed/${NB_ANS}` },
    source: `fixtures/MI-NB-ANS/seed/${NB_ANS}`,
    inputRe: /^coddoc\/RET-214\/notebook-(\d{4}-\d\d-\d\d)-bt\.md$/,
    razborRe: /^coddoc\/RET-214\/notebook-(\d{4}-\d\d-\d\d)\.razbor\.md$/,
    razborHeading: /^#{2,3} Во вход/m,
    minQuotes: 5,
    keyAsk: 'warn',
    inputName: 'coddoc/RET-214/notebook-<дата>-bt.md',
    gradeInput: (text, razbor) => gradeInputANS(text, razbor),
  },
  OUT: {
    kind: 'notebook',
    notebook: NB,
    seed: { [NB]: `fixtures/MI-NB-OUT/seed/${NB}`, [CALL]: `fixtures/MI-NB-OUT/seed/${CALL}` },
    source: `fixtures/MI-NB-OUT/seed/${CALL}`,
    lastSeedDate: '2026-10-10',
    razborRe: /^notes\/посылки-от-частных-лиц\/meeting-[^/]*\.razbor\.md$/,
    razborHeading: /^#{2,3} В ноут/m,
    minQuotes: 5,
    noDocs: true,
    keyAsk: 'red',
    gradeItems: (its) => gradeItemsOUT(its),
  },
  REC: {
    kind: 'notebook',
    notebook: NB_REC,
    seed: { [NB_REC]: `fixtures/MI-NB-REC/seed/${NB_REC}`, [BT77]: `fixtures/MI-NB-REC/seed/${BT77}`, [REC77]: `fixtures/MI-NB-REC/seed/${REC77}` },
    source: `fixtures/MI-NB-REC/seed/${REC77}`,
    lastSeedDate: '2026-10-09',
    razborRe: /^notes\/отмена-записи\/meeting-[^/]*\.razbor\.md$/,
    razborHeading: /^#{2,3} В ноут/m,
    minQuotes: 4,
    keyAsk: 'warn',
    gradeItems: (its) => gradeItemsREC(its),
  },
  // 1.1.0: тот же человек передумал — `вместо:` без вопроса (fixtures/MI-NB-SAME/expected.md).
  SAME: {
    kind: 'notebook',
    notebook: NB_REC,
    seed: { [NB_REC]: `fixtures/MI-NB-SAME/seed/${NB_REC}`, [BT77]: `fixtures/MI-NB-SAME/seed/${BT77}`, [REC77]: `fixtures/MI-NB-SAME/seed/${REC77}` },
    source: `fixtures/MI-NB-SAME/seed/${REC77}`,
    lastSeedDate: '2026-10-09',
    razborRe: /^notes\/отмена-записи\/meeting-[^/]*\.razbor\.md$/,
    razborHeading: /^#{2,3} В ноут/m,
    minQuotes: 4,
    keyAsk: 'warn',
    noDispute: true,
    gradeItems: (its) => gradeItemsSAME(its),
  },
}

// ---------- вход (IN) ----------

function sections (text) {
  const out = {}
  let cur = null
  for (const line of text.split('\n')) {
    const m = line.match(/^##\s+(.+?)\s*$/)
    if (m) { cur = m[1]; out[cur] = []; continue }
    if (cur) out[cur].push(line)
  }
  return out
}

// Пункт — строка «- …», «* …», «N. …» или «N) …» со строками-продолжениями (как в grade-meet.mjs).
function items (lines) {
  const out = []
  const MARK = /^\s*(-|\*|\d+[.)])\s+/
  for (const l of lines) {
    if (/^ ?(-|\*|\d+[.)])\s+/.test(l)) out.push(l.replace(MARK, ''))
    else if (l.trim() && out.length) out[out.length - 1] += ' ' + l.trim().replace(MARK, '')
  }
  return out
}

// Раздел — по началу заголовка: «## Решено» и «## Решено (3)» — один раздел.
function itemsOf (secs, names) {
  const keys = Object.keys(secs)
  const pick = names ? keys.filter((k) => names.some((n) => k.toLowerCase().startsWith(n.toLowerCase()))) : keys
  return pick.flatMap((k) => items(secs[k]).map((t) => ({ sec: names ? names.find((n) => k.toLowerCase().startsWith(n.toLowerCase())) : k, t })))
}

// Y — о том, где принимают: «вес посылки 15 кг, взвешиваем на весах» — не Y.
const RE_WHERE = anyRe(w('(пункт|точк|ПВЗ)'), w('прин(им|ят|има)'))
const IN_MUST = [
  { id: 'y', d: 'нет в «Решено»: только пункты с весами (Y)', sec: ['Решено'], re: [RE_SCALES, RE_WHERE] },
  { id: 'pay', d: 'нет в «Решено»: оплата онлайн в приложении', sec: ['Решено'], re: [/оплат|плат[ия]т|денег|деньг/i, /онлайн|в\s+приложени/i] },
  { id: 'kg15', d: 'нет в «Решено»: вес до 15 кг', sec: ['Решено'], re: [RE_15KG], alt: [{ sec: ['Не входит'], re: [RE_15KG, /тяжел|больш|свыше|более/i] }] },
  { id: 'open', d: 'нет в «Открыто»: смотреть ли вложение — ждёт СБ', sec: ['Открыто'], re: [/внутри|вложени|вскрыв|досмотр|содержим/i, /безопасност|(^|[^а-яёa-z])СБ([^а-яёa-z]|$)/i] },
  { id: 'svNow', d: 'нет в «Сведениях»: сейчас только выдача и возвраты', sec: ['Сведения'], re: [/возврат|частн\S*[^.;]{0,40}не\s+(принима|бер)|не\s+(принима|бер)\S*[^.;]{0,40}частн|посылк\S*[^.;]{0,30}не\s+(принима|бер)/i] },
  { id: 'svVol', d: 'нет в «Сведениях»: 180 заказов в день', sec: ['Сведения'], re: [/(^|[^\d])180([^\d]|$)/] },
  { id: 'svPick', d: 'нет в «Сведениях»: забор раз в день после 19:00', sec: ['Сведения'], re: [/(^|[^\d])19([^\d]|$)/, /раз\s+в\s+день|ежедневн|вечер|забира|забор|машин/i] },
  { id: 'svScales', d: 'нет в «Сведениях»: весы в ~400 пунктах из 1200', sec: ['Сведения'], re: [/(^|[^\d])1\s?200([^\d]|$)/] },
]

export function gradeInputIN (text, razbor = '') {
  const secs = sections(text)
  const red = []
  const warn = []
  const hit = (c) => itemsOf(secs, c.sec).some(({ t }) => c.re.every((re) => re.test(t)))
  // Сведение, которое разбор отнёс к слою «спека», законно лежит в разделе разбора «Для другого документа»:
  // правило слоя у meeting-intake общее (пилот 2026-10-14 — «180 заказов в день» как «нагрузка», слой спека).
  const other = (razbor.split(/^## Для другого документа[^\n]*\n/m)[1] || '').split(/^## /m)[0]
  for (const m of IN_MUST) {
    if (hit(m) || (m.alt || []).some(hit)) continue
    if (m.id.startsWith('sv') && m.re.every((re) => re.test(other))) { warn.push(m.d + ' — в разборе «для другого документа»'); continue }
    red.push(m.d)
  }
  const head = text.split(/^## /m)[0]
  if (!/цель:\s*\**\s*новый\s+БТ/i.test(head)) red.push('цель в шапке — не «новый БТ»')
  if (!/^# Ноут .+ на \d{4}-\d\d-\d\d/m.test(head)) warn.push('заголовок не «# Ноут <тема> на <дата>»')
  if (!/^> Ноут:[^\n]*notebook\.md[^\n]*2026-10-06[^\n]*2026-10-10/m.test(head)) warn.push('нет строки «> Ноут: <путь> · записи 2026-10-06–2026-10-10»')
  const all = itemsOf(secs, null)
  for (const { sec, t } of all) {
    if (/^Решено/i.test(sec) && RE_X.test(t) && !RE_SCALES.test(t)) red.push(`X в «Решено»: «${t.slice(0, 60)}»`)
    // X заменён Y тем же человеком (`вместо:`): открытым вопросом или спором «в любом пункте или с весами» он тоже не
    // идёт (ревью 1.1.0).
    if (/^Открыто/i.test(sec) && RE_X.test(t) && !RE_INSIDE.test(t)) red.push(`X в «Открыто»: «${t.slice(0, 60)}»`)
    const what = RE_THOUGHT.test(t) ? 'мысль' : RE_SKETCH.test(t) ? 'набросок' : null
    if (what) {
      if (/^Решено/i.test(sec)) red.push(`${what} в «Решено»`)
      else if (!/^Открыто/i.test(sec)) red.push(`${what} в «${sec}», а не в «Открыто»`)
      else if (!RE_BY_ANALYST.test(t)) red.push(`${what} в «Открыто» без «(со слов аналитика)»`)
    }
    if (RE_ANCHOR_INPUT.test(t)) red.push(`якорь во входе: «${t.slice(0, 50)}»`)
  }
  return { red, warn, pass: !red.length }
}

// ---------- вход ANS: ответ на открытый вопрос ноута ----------

const RE_PASSPORT = /паспорт/i
// Ответ «паспорт не нужен» (ревью 1.1.0): «недостаточно», «не хватает», «без паспорта не принимаем» — обратный ответ,
// не засчитываются; «необязателен», «вместо паспорта», «не проверяем» — тот же ответ другими словами.
const RE_PASS_NO = anyRe(
  w('не\\s*(нуж|треб|обязат|спрашива|запрашива|провер|предъявл)'),
  w('(без|вместо)\\s+паспорт(?![^.;]{0,40}(не\\s+(принима|оформля|возвраща)|нельзя))'),
  /(?<![а-яё])(?<!не\s)(достаточно|хватает|хватит)/i,
)
const ANS_MUST = [
  { id: 'a', d: 'нет в «Решено»: паспорт не нужен (ответ на открытый вопрос)', sec: ['Решено'], re: [RE_PASSPORT, RE_PASS_NO] },
  { id: 'hist', d: 'нет в «Решено»: принимаем, если покупка в истории по карте лояльности', sec: ['Решено'], re: [/истори/i, /лояльн/i] },
  // «на ту же карту, которой оплачивали» — тот же ответ (ревью 1.1.0: ждал дословно «на карт» и «платил»).
  { id: 'card', d: 'нет в «Решено»: деньги только на карту, с которой платили', sec: ['Решено'], re: [w('на\\s+(\\S+\\s+){0,3}карт'), /плат(ил|ят|ял|[её]ж)|оплач|оплат/i] },
  { id: 'act', d: 'нет в «Открыто»: кто подписывает акт возврата', sec: ['Открыто'], re: [/(^|[^а-яё])акт/i, /подпис/i] },
  // Пилот 1.1.0: цель «правка работающего» законна (функция меняет то, что уже работает), и тогда «как сейчас» стоит
  // в «Решено» парой «как сейчас: … → как должно стать: …» (output.md) — засчитывается там.
  { id: 'svNow', d: 'нет в «Сведениях»: сейчас без чека не принимают', sec: ['Сведения'], re: [/не\s+(принима|бер[уеё])|отказыва/i],
    alt: [{ sec: ['Решено'], re: [/как\s+сейчас/i, /не\s+(принима|бер[уеё])|отказыва/i] }] },
  // «за последние 12 месяцев» — тот же срок (ревью 1.1.0).
  { id: 'svYear', d: 'нет в «Сведениях»: касса показывает историю за последний год', sec: ['Сведения'], re: [anyRe(/(^|[^а-яё])год/i, /(^|[^\d])12\s*месяц/i, w('двенадцат\\S*\\s+месяц'))] },
  { id: 'svReport', d: 'нет в «Сведениях»: отдельной строкой в дневном отчёте', sec: ['Сведения'], re: [/отч[её]т/i, /отдельн|дневн/i] },
]

export function gradeInputANS (text, razbor = '') {
  const secs = sections(text)
  const red = []
  const warn = []
  const hit = (c) => itemsOf(secs, c.sec).some(({ t }) => c.re.every((re) => re.test(t)))
  // Сведение в разделе разбора «Для другого документа» — законная раскладка слоя (как в IN).
  const other = (razbor.split(/^## Для другого документа[^\n]*\n/m)[1] || '').split(/^## /m)[0]
  for (const m of ANS_MUST) {
    if (hit(m) || (m.alt || []).some(hit)) continue
    if (m.id.startsWith('sv') && m.re.every((re) => re.test(other))) { warn.push(m.d + ' — в разборе «для другого документа»'); continue }
    red.push(m.d)
  }
  // Вопрос, закрытый `отвечает на:`, открытым во входе не бывает — ни словами вопроса, ни «закрыт: …».
  const q = itemsOf(secs, ['Открыто']).find(({ t }) => RE_PASSPORT.test(t))
  if (q) red.push(`закрытый вопрос в «Открыто»: «${q.t.slice(0, 60)}»`)
  const head = text.split(/^## /m)[0]
  if (!/^# Ноут .+ на \d{4}-\d\d-\d\d/m.test(head)) warn.push('заголовок не «# Ноут <тема> на <дата>»')
  if (!/^> Ноут:[^\n]*notebook\.md[^\n]*2026-10-07[^\n]*2026-10-10/m.test(head)) warn.push('нет строки «> Ноут: <путь> · записи 2026-10-07–2026-10-10»')
  for (const { t } of itemsOf(secs, null)) if (RE_ANCHOR_INPUT.test(t)) red.push(`якорь во входе: «${t.slice(0, 50)}»`)
  return { red, warn, pass: !red.length }
}

// ---------- новая запись ноута (OUT, REC) ----------

// Пункты новой записи: строки «- …» после заголовка `### N · … — /meeting-intake` до следующего заголовка.
function parseRecord (text) {
  const lines = text.split('\n')
  const heads = lines.map((l, i) => (/^### \d+ · [^\n]*— \/meeting-intake/.test(l) ? i : -1)).filter((i) => i >= 0)
  if (!heads.length) return { heads: 0, items: [], razborLine: false }
  const out = []
  let razborLine = false
  for (let i = heads[0] + 1; i < lines.length && !/^#{2,3} /.test(lines[i]); i++) {
    if (/^- /.test(lines[i])) out.push(lines[i])
    else if (/^> разбор:/.test(lines[i])) razborLine = true
    else if (lines[i].trim() && !/^>/.test(lines[i]) && out.length) out[out.length - 1] += ' ' + lines[i].trim()
  }
  return { heads: heads.length, items: out, razborLine }
}

const KINDS = /^- \[(решено|открыто|сведение|мысль|набросок)\]/
const RE_REPLACES = /(^|[^а-яё])вместо:/i
const RE_ANSWERS = /отвечает\s+на:/i
// Ссылка на пункт ноута после `вместо:` — дата или №; «вместо: 24 часа» обычным текстом — не связь.
const RE_REPLACES_LINK = /(^|[^а-яё])вместо:\s*(\d{4}-\d\d-\d\d|№)/i

// Связь с прошлым пунктом ноута (Шаг 7). OUT и REC: созвон и протокол ни на один открытый вопрос ноута не отвечают и
// ни одного пункта не меняют (OUT L21 «смотрим товар» — осмотр возврата, а не вложения посылки) — любая связь выдумана.
function noLinks (its, allowed = () => false) {
  const red = []
  for (const t of its) {
    if (RE_ANSWERS.test(t)) red.push(`«отвечает на:» в записи: «${t.slice(0, 60)}»`)
    else if (RE_REPLACES_LINK.test(t) && !allowed(t)) red.push(`«вместо:» в записи: «${t.slice(0, 60)}»`)
  }
  return red
}

function gradeItemsOUT (its) {
  const red = []
  const warn = []
  const sved = its.filter((t) => /^- \[сведение\][^\n]*[—–-]\s*со\s+слов\s+\S/.test(t)).length
  if (sved < 3) red.push(`[сведение] … — со слов <кто>: ${sved}, нужно ≥3`)
  if (!its.some((t) => /^- \[открыто\][^\n]*[—–-]\s*жд[её]т:\s*[^\s—–-]/.test(t))) red.push('нет [открыто] … — ждёт: <кто>')
  const dec = its.filter((t) => /^- \[решено\]/.test(t))
  if (dec.length) red.push(`[решено] в записи: «${dec[0].slice(0, 60)}»`)
  red.push(...noLinks(its))
  return { red, warn }
}

function gradeItemsREC (its) {
  const red = noLinks(its)
  const warn = []
  const h12 = its.filter((t) => /^- \[решено\]/.test(t) && RE_H12.test(t))
  if (!h12.length) red.push('нет [решено] о сроке отмены 12 часов')
  else if (!h12.some((t) => /реш(ил|ила|или):/i.test(t))) warn.push('у [решено] о 12 часах нет «решил:»')
  const wp = its.filter((t) => RE_WARN_PATIENT.test(t))
  if (!wp.length) red.push('нет [мысль] о предупреждении пациенту')
  for (const t of wp) if (!/^- \[мысль\]/.test(t)) red.push(`предупреждение пациенту не [мысль]: «${t.slice(0, 60)}»`)
  // Предупреждения — вне критериев expected.md, для чтения глазами.
  const limit = its.filter((t) => /лимит|в\s+месяц/i.test(t))
  if (limit.some((t) => /(^|[^\d])3([^\d]|$)|(^|[^а-яё])(три|тр[её]х)([^а-яё]|$)/i.test(t))) warn.push('число лимита 3 в записи')
  if (limit.some((t) => /остав|не\s+мен|без\s+изменен|прежн/i.test(t))) warn.push('«лимит оставили» в записи')
  if (its.some((t) => /^- \[решено\]/.test(t) && /Гусев|сч[её]тчик/i.test(t))) warn.push('поручение Гусева пунктом [решено]')
  if (its.some((t) => /колл-?\s*центр/i.test(t))) warn.push('колл-центр в записи (уже записан в БТ)')
  if (its.some((t) => /^- \[решено\]/.test(t) && /пуш|push|уведомлени\S*\s+на\s+телефон/i.test(t) && !/не\s+уверен|кажется|со\s+слов\s+аналитика|не\s+помн/i.test(t))) warn.push('пуш [решено] без пометки сомнения')
  return { red, warn }
}

// SAME: в засеве ноута 2026-10-08 №1 — `[решено] Отменить запись можно не позднее чем за 24 часа до приёма — решил:
// Зайцева О.`; протокол — 12 часов, утвердила та же Зайцева. Шаг 7: «тот же человек передумал» — `вместо:` без вопроса.
const SAME_OLD = 'Отменить запись можно не позднее чем за 24 часа до приёма — решил: Зайцева О.'
const RE_VMESTO = /вместо:\s*(\d{4}-\d\d-\d\d)\s*№\s*(\d+)[\s,:—–-]*[«"“]([^»"”]*)[»"”]/i
const RE_H24 = anyRe(/(^|[^\d])24\s*-?\s*(час|ч([^а-яё]|$))/i, w('сут(ки|ок)'))

// Кавычки `вместо:` — начало старого пункта (analyst-notebook: «заменяет пункт, который начинается с текста в
// кавычках»): кусок от начала, не короче двух слов, или кусок со сроком «24»; «…» внутри — пропуск.
export function vmestoQuoteOk (q) {
  const old = norm(SAME_OLD)
  const parts = norm(q).split(/…|\.\.\./).map((p) => p.replace(/[.,;:!?]+$/, '').trim()).filter(Boolean)
  if (!parts.length || !parts.every((p) => old.includes(p))) return false
  return (old.startsWith(parts[0]) && parts[0].split(' ').length >= 2) || parts.some((p) => /24/.test(p))
}

function gradeItemsSAME (its) {
  const red = []
  const warn = []
  const h12 = its.filter((t) => /^- \[решено\]/.test(t) && RE_H12.test(t))
  if (!h12.length) red.push('нет [решено] о сроке отмены 12 часов')
  else if (!h12.some((t) => RE_REPLACES.test(t))) red.push('у [решено] о 12 часах нет «вместо: 2026-10-08 №1 «…»»')
  else {
    const m = h12.map((t) => t.match(RE_VMESTO)).find(Boolean)
    if (!m) red.push('«вместо:» у [решено] о 12 часах не по форме «<дата> №<n> «<начало пункта>»»')
    else {
      if (m[1] !== '2026-10-08' || m[2] !== '1') red.push(`«вместо:» на ${m[1]} №${m[2]}, а пункт о 24 часах — 2026-10-08 №1`)
      if (!vmestoQuoteOk(m[3])) red.push(`«вместо:» с кавычками не из пункта о 24 часах: «${m[3].slice(0, 50)}»`)
    }
  }
  red.push(...noLinks(its, (t) => h12.includes(t)))
  // Спор вместо замены: «что верно: 24 … или 12 …» открытым вопросом или старое правило решением.
  for (const t of its) {
    if (h12.includes(t)) continue
    if (/что\s+верно/i.test(t) || RE_H24.test(t)) red.push(`спор или старый срок в записи: «${t.slice(0, 60)}»`)
  }
  // Мысль аналитика — критерий MI-NB-REC; здесь только для чтения глазами.
  const wp = its.filter((t) => RE_WARN_PATIENT.test(t))
  if (wp.some((t) => !/^- \[мысль\]/.test(t))) warn.push('предупреждение пациенту не [мысль]')
  return { red, warn }
}

// ---------- разбор ----------

const norm = (s) => s.toLowerCase().replace(/ё/g, 'е').replace(/[«»"“”]/g, '').replace(/\s+/g, ' ').trim()

function sourceTexts (raw) {
  return lf(raw).replace(/^\uFEFF/, '').split('\n').map((l) => {
    const m = l.match(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d - .+?: (.*)$/)
    return norm(m ? m[1] : l)
  })
}

// Опечатка в 1–2 символа — не выдумка (как в grade-meet.mjs): допуск 5% длины, перестановка слов не влезает.
function near (win, p) {
  if (win.includes(p)) return true
  const k = Math.max(1, Math.floor(p.length * 0.05))
  if (p.length < 8) return false
  let prev = new Array(p.length + 1)
  let cur = new Array(p.length + 1)
  for (let j = 0; j <= p.length; j++) prev[j] = j
  for (let i = 1; i <= win.length; i++) {
    cur[0] = 0
    for (let j = 1; j <= p.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (win[i - 1] === p[j - 1] ? 0 : 1))
    }
    if (cur[p.length] <= k) return true;
    [prev, cur] = [cur, prev]
  }
  return false
}

// Цитата — на одной строке записи. Якорь: `L<n>` или `L<n>–L<m>`, дальше по формату источника — дата и номер
// записи ноута (`2026-10-08 №1`), время чата, говорящий с двоеточием; всё необязательно.
const RE_QUOTE = /L(\d+)(?:[–-]L?(\d+))?:?[ \t]+(?:\d{4}-\d\d-\d\d[ \t]*(?:№[ \t]*\d+)?[ \t]*:?[ \t]*)?(?:\[?[\d:.,]+\]?(?:[ \t]*-->[ \t]*[\d:.,]+)?[ \t]+)?(?:[^:«»\n]{1,60}:[ \t]*)?«([^»]+)»/g

// Шаг 8 (1.1.0): у каждой записи разбора в `цитаты:` — текст в кавычках, а не номер строки. Строка `цитаты:` с номерами
// `L<n>` и без текста в кавычках — разбор не проверить (круг 3, mi-nb-out run-2: «цитаты: L14, L16» у 17 записей из 18).
// Строка без номеров («со слов аналитика, без цитаты» Шага 6) — не судится.
const RE_QUOTE_LINE = /^[\s>*-]*цитат[аы]?\**\s*:/i
const RE_HAS_TEXT = /[«"“][^»"”]*[\p{L}\p{N}][^»"”]*[»"”]/u
// Перенос списка цитат на следующие строки («   | L16 …: «…»») — продолжение той же строки `цитаты:`.
const RE_QUOTE_CONT = /^\s+(\||L\d|[«"“])/
export function bareQuoteLines (text) {
  const lines = text.split('\n')
  return lines.filter((l, i) => {
    if (!RE_QUOTE_LINE.test(l) || !/(^|[^A-Za-z])L\d+/.test(l) || RE_HAS_TEXT.test(l)) return false
    for (let k = i + 1; k < lines.length && RE_QUOTE_CONT.test(lines[k]); k++) if (RE_HAS_TEXT.test(lines[k])) return false
    return true
  })
}

// `alt` — строки второго источника (ноут у цели «в ноут»): дословная строка ноута в разборе — не выдумка, а сверка
// Шага 7; она идёт предупреждением.
export function gradeRazbor (text, tLines, minQuotes, alt = []) {
  const r = { quotes: 0, bad: [], moved: [], fromAlt: [] }
  const full = tLines.join(' ')
  const altFull = alt.join(' ')
  for (const m of text.matchAll(RE_QUOTE)) {
    const n = Number(m[1])
    const end = m[2] ? Math.max(n, Number(m[2])) : n
    const win = tLines.slice(Math.max(0, n - 3), end + 2).join(' ')
    const parts = m[3].split(/…|\.\.\./).map(norm).map((p) => p.replace(/[.,;:!?]+$/, '').trim()).filter((p) => p.length >= 2)
    // Цитата без букв и цифр («?», «??», «…») — не выдумка (ревью 1.1.0, mr-new r3 run-2: «оговорка: L14 «??»»): сырой
    // текст есть в окне — цитата сошлась; нет — это не цитата, в счёт не идёт.
    if (!parts.length) {
      if (norm(m[3]) && win.includes(norm(m[3]))) r.quotes++
      continue
    }
    r.quotes++
    if (parts.every((p) => near(win, p))) continue
    if (parts.every((p) => near(full, p))) r.moved.push(`L${n} «${m[3].slice(0, 40)}»`)
    else if (altFull && parts.every((p) => near(altFull, p))) r.fromAlt.push(`L${n} «${m[3].slice(0, 40)}»`)
    else r.bad.push(`L${n} «${m[3].slice(0, 50)}»`)
  }
  r.bare = bareQuoteLines(text)
  r.minQuotes = minQuotes
  r.pass = r.quotes >= minQuotes && !r.bad.length && !r.bare.length
  return r
}

// ---------- песочница ----------

function listFiles (dir, base = dir) {
  const out = []
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...listFiles(p, base))
    else out.push(relative(base, p).split('\\').join('/'))
  }
  return out
}

// Файлы стенда: в корне песочницы их пишет пул, в `_twin/` — двойник.
const isStand = (f) => (!f.includes('/') && /^(answer(-\d+)?\.md|stream(-\d+)?\.jsonl|_[^/]*)$/.test(f)) || f.startsWith('_twin/')

// Ходы прогона: `answer-NN.md`, поток хода 1 — `stream.jsonl`, хода N — `stream-NN.jsonl`. Ходов нет — `answer.md`.
function turnsOf (dir) {
  const names = existsSync(dir) ? readdirSync(dir).filter((f) => /^answer-\d+\.md$/.test(f)).sort() : []
  if (names.length) return names.map((f) => ({ n: Number(f.match(/\d+/)[0]), text: read(join(dir, f)) }))
  return existsSync(join(dir, 'answer.md')) ? [{ n: 1, text: read(join(dir, 'answer.md')) }] : []
}

function dialogText (dir) {
  return turnsOf(dir).map((t) => t.text).join('\n')
}

// Писал ли ход в ноут: Write/Edit по пути ноута или Bash с перенаправлением в notebook.md. Потока хода нет — `null`.
function wroteNotebook (dir, n, nbRel) {
  const names = (n === 1 ? ['stream.jsonl', 'stream-01.jsonl'] : [`stream-${String(n).padStart(2, '0')}.jsonl`]).filter((f) => existsSync(join(dir, f)))
  if (!names.length) return null
  for (const f of names) {
    for (const line of read(join(dir, f)).split('\n')) {
      let e; try { e = JSON.parse(line) } catch { continue }
      const content = e && e.message && Array.isArray(e.message.content) ? e.message.content : []
      for (const c of content) {
        if (!c || c.type !== 'tool_use' || !c.input) continue
        const p = String(c.input.file_path || '').replace(/\\/g, '/')
        if (['Write', 'Edit', 'MultiEdit'].includes(c.name) && p.endsWith(nbRel)) return true
        if (c.name === 'Bash' && /notebook\.md/.test(String(c.input.command || '')) && /(>>|>\s*\S*notebook\.md|tee\s)/.test(String(c.input.command || ''))) return true
      }
    }
  }
  return false
}

// Ходы-стопы (см. RE_STOP_TAIL): хвост ответа — «решений нет», вопроса нет, ноут в ходе не писан. Потока хода нет:
// ход не последний — не писал; последний — не судится (без записи его и так красит «в ноуте нет новой записи»).
export function stopTurns (dir, nbRel) {
  const turns = turnsOf(dir)
  const last = turns.length ? turns[turns.length - 1].n : 0
  return turns.filter((t) => {
    if (!RE_STOP_TAIL.test(t.text.trim().slice(-200)) || RE_ASKS.test(t.text)) return false
    const wrote = wroteNotebook(dir, t.n, nbRel)
    return wrote === null ? t.n !== last : !wrote
  }).map((t) => t.n)
}

export function gradeRun (dir, fx) {
  const red = []
  const warn = []
  const info = []
  const files = listFiles(dir)
  const seeded = new Set(Object.keys(fx.seed))
  if (existsSync(join(dir, '_seeded.txt'))) for (const l of read(join(dir, '_seeded.txt')).split('\n')) if (l.trim()) seeded.add(l.trim())
  for (const [rel, src] of Object.entries(fx.seed)) {
    if (rel === fx.notebook) continue
    if (!existsSync(join(dir, rel)) || read(join(dir, rel)) !== read(join(HERE, src))) red.push(`засев тронут: ${rel}`)
  }
  const tLines = sourceTexts(readFileSync(join(HERE, fx.source), 'utf8'))
  const dialog = dialogText(dir)
  let razbors = []
  let mine = []

  if (fx.kind === 'input') {
    const inputs = files.filter((f) => fx.inputRe.test(f))
    razbors = files.filter((f) => fx.razborRe.test(f))
    const strayInputs = files.filter((f) => /-(bt|spec)\.md$/.test(f) && !fx.inputRe.test(f) && !seeded.has(f))
    const strayRazbors = files.filter((f) => /\.razbor\.md$/.test(f) && !fx.razborRe.test(f) && !seeded.has(f))
    if (inputs.length !== 1) red.push(inputs.length ? `входов ${inputs.length}` : `нет входа ${fx.inputName}`)
    if (strayInputs.length) red.push('вход не там или не тот: ' + strayInputs.join(', '))
    if (razbors.length !== 1) red.push(razbors.length ? `разборов ${razbors.length}` : 'нет разбора рядом со входом')
    if (strayRazbors.length) red.push('разбор не рядом со входом: ' + strayRazbors.join(', '))
    mine = [...inputs, ...razbors, ...strayInputs, ...strayRazbors]
    if (inputs.length === 1) {
      const gi = (fx.gradeInput || gradeInputIN)(read(join(dir, inputs[0])), razbors.length === 1 ? read(join(dir, razbors[0])) : '')
      red.push(...gi.red)
      warn.push(...gi.warn)
      if (razbors.length === 1 && inputs[0].match(fx.inputRe)[1] !== razbors[0].match(fx.razborRe)[1]) warn.push('дата входа и разбора разная')
    }
    if (themeAsked(dialog)) red.push('спрошен выбор темы')
  } else {
    const seedNb = read(join(HERE, fx.seed[fx.notebook]))
    const nbPath = join(dir, fx.notebook)
    const nb = existsSync(nbPath) ? read(nbPath) : ''
    const base = seedNb.replace(/\n+$/, '')
    const prefixOk = nb.startsWith(base) && (nb.length === base.length || nb[base.length] === '\n')
    if (!nb) red.push('ноута нет')
    else if (!prefixOk) red.push('ноут до прежнего конца тронут')
    const tail = prefixOk ? nb.slice(base.length) : nb
    // Ноут как был — скилл ничего не дописал (в OUT это и есть стоп на «решений нет»).
    if (prefixOk && !tail.trim()) red.push('в ноуте нет новой записи')
    else if (prefixOk) {
      const first = tail.split('\n').find((l) => l.trim())
      const dm = first && first.match(/^## (\d{4}-\d\d-\d\d)\s*$/)
      if (!dm) red.push('новая запись не под новым разделом даты')
      else if (dm[1] <= fx.lastSeedDate) red.push(`раздел даты ${dm[1]} не новее ${fx.lastSeedDate}`)
    }
    const rec = parseRecord(tail)
    if (!rec.heads) { if (tail.trim()) red.push('нет записи «### N · … — /meeting-intake»') } else {
      if (rec.heads > 1) warn.push(`записей «— /meeting-intake»: ${rec.heads}`)
      if (!rec.razborLine) warn.push('у записи нет строки «> разбор: …»')
      const odd = rec.items.filter((t) => !KINDS.test(t))
      if (odd.length) warn.push(`пункт не из пяти видов: «${odd[0].slice(0, 50)}»`)
      const anch = rec.items.filter((t) => RE_ANCHOR_ITEM.test(t))
      if (anch.length) red.push(`якорь в пункте: «${anch[0].slice(0, 50)}»`)
      const g = fx.gradeItems(rec.items)
      red.push(...g.red)
      warn.push(...g.warn)
    }
    // Цель «в ноут»: тему не выбирают (Шаг 2) — вопрос о ней красный и в OUT, и в REC (ревью 1.1.0).
    if (themeAsked(dialog)) red.push('спрошен выбор темы')
    const stops = stopTurns(dir, fx.notebook)
    if (stops.length) red.push(`ход ${stops.join(', ')}: стоп на «решений нет» без записи и без вопроса`)
    if (fx.noDispute && disputeAsked(dialog)) red.push('спрошен спор со старым пунктом или «что действует»')
    razbors = files.filter((f) => fx.razborRe.test(f))
    const strayRazbors = files.filter((f) => /\.razbor\.md$/.test(f) && !fx.razborRe.test(f) && !seeded.has(f))
    const inputs = files.filter((f) => /-(bt|spec)\.md$/.test(f) && !seeded.has(f))
    if (razbors.length !== 1) red.push(razbors.length ? `разборов в папке ноута ${razbors.length}` : 'нет разбора в папке ноута')
    if (strayRazbors.length) red.push('разбор не в папке ноута: ' + strayRazbors.join(', '))
    if (inputs.length) red.push('записан вход: ' + inputs.join(', '))
    if (fx.noDocs && (existsSync(join(dir, 'coddoc')) || files.some((f) => f.startsWith('coddoc/')))) red.push('создана папка coddoc/')
    mine = [fx.notebook, ...razbors, ...strayRazbors, ...inputs]
    if (RE_NO_DECISIONS.test(dialog)) info.push('в ответах «решений нет»')
  }

  const extra = files.filter((f) => !seeded.has(f) && !isStand(f) && !mine.includes(f))
  if (extra.length) red.push('лишние файлы: ' + extra.join(', '))
  if (RE_KEY_ASK.test(dialog)) (fx.keyAsk === 'red' ? red : warn).push('спрошен ключ задачи')

  let razbor = null
  if (razbors.length === 1) {
    const text = read(join(dir, razbors[0]))
    const alt = fx.kind === 'notebook' ? sourceTexts(read(join(HERE, fx.seed[fx.notebook]))) : []
    razbor = gradeRazbor(text, tLines, fx.minQuotes, alt)
    if (razbor.bad.length) red.push('выдуманные цитаты: ' + razbor.bad.join('; '))
    if (razbor.bare.length) red.push(`строк «цитаты:» без текста в кавычках: ${razbor.bare.length} (Шаг 8), первая: «${razbor.bare[0].trim().slice(0, 50)}»`)
    if (razbor.quotes < fx.minQuotes) red.push(`в разборе цитат ${razbor.quotes}, нужно ≥${fx.minQuotes}`)
    if (razbor.moved.length) warn.push(`номер строки не тот у ${razbor.moved.length}: ${razbor.moved.join('; ')}`)
    if (razbor.fromAlt.length) warn.push(`цитаты из ноута, а не из источника: ${razbor.fromAlt.join('; ')}`)
    if (!fx.razborHeading.test(text)) warn.push(`у разбора нет раздела «${fx.kind === 'input' ? 'Во вход' : 'В ноут'}»`)
  }
  return { red, warn, info, razbor, pass: !red.length }
}

// ---------- самопроверка ----------

const DATE = '2026-10-15'

const ETALON = {
  IN: {
    files: {
      [`coddoc/PVZ-318/notebook-${DATE}-bt.md`]: `# Ноут посылки от частных лиц в пунктах выдачи на ${DATE}

> Задача: PVZ-318 · цель: новый БТ
> Документ: нет
> Ноут: ${NB} · записи 2026-10-06–2026-10-10

## Решено
1. Посылки принимаем только в пунктах выдачи, где есть весы, а не во всех — решила Орлова Е.
2. Отправку человек оплачивает онлайн в приложении при оформлении; в пункте выдачи денег не берут — решила Орлова Е.
3. Максимальный вес посылки — 15 кг — решила Орлова Е.

## Открыто
- Должен ли оператор смотреть, что внутри посылки, перед приёмом — ждёт: служба безопасности
- Печатать ли трек-номер прямо на чеке приёмки (со слов аналитика) — ждёт: —
- Экран оператора: сканирует код из приложения, взвешивает посылку, печатает наклейку с трек-номером (со слов аналитика) — ждёт: —

## Сведения
- Сейчас пункты выдачи только выдают заказы и принимают возвраты покупателей, посылки от частных лиц не принимают — со слов Орловой Е.
- Пункт выдачи в среднем выдаёт около 180 заказов в день, в пиковые дни — до 400 — со слов Савченко Д.
- Машина забирает отправления из пункта раз в день, вечером, после 19:00 — со слов Савченко Д.
- Весы есть примерно в 400 пунктах из 1200 — со слов Орловой Е.
`,
      [`coddoc/PVZ-318/notebook-${DATE}.razbor.md`]: `# Разбор ноута на ${DATE}: посылки от частных лиц в пунктах выдачи

> Источник: ${NB}
> Тема: строки L1–L43; итогов нет
> Документы задачи: нет
> Вход: coddoc/PVZ-318/notebook-${DATE}-bt.md

## Во вход notebook-${DATE}-bt.md
#1 сведение · БТ · как сейчас
   суть: сейчас пункты выдачи только выдают заказы и принимают возвраты
   цитаты: L14 2026-10-06 №1 Орлова: «сейчас ПВЗ только выдают и принимают возвраты, частные посылки не берём вообще»
   во вход: п.1
#2 решение · БТ · где принимаем посылки
   суть: только пункты с весами
   цитаты: L42 2026-10-10 №1 Орлова Е.: «во всех пунктах не получится, берём только точки с весами»
   было: #10
   во вход: п.2
#3 решение · БТ · оплата отправки
   цитаты: L16 2026-10-06 №1: «Платит человек в приложении, когда оформляет.»
#4 решение · БТ · вес посылки
   цитаты: L43 2026-10-10 №1 Орлова Е.: «Потолок по весу — 15 кг на посылку.»
#5 открытый вопрос · БТ · вложение
   цитаты: L30 2026-10-08 №1 Савченко Д.: «а вскрывать или смотреть вложение — это не ко мне, пусть СБ скажет»
#6 сведение · БТ · объём выдачи
   цитаты: L28 2026-10-08 №1 Савченко Д.: «по выдаче в среднем 180 заказов в день на точку, в пик до 400»
#7 сведение · БТ · забор
   цитаты: L29 2026-10-08 №1 Савченко Д.: «машина забирает раз в день, вечером, после 19»
#8 сведение · БТ · весы
   цитаты: L42 2026-10-10 №1 Орлова Е.: «Это примерно 400 из 1200.»
#9 открытый вопрос · БТ · трек на чеке
   цитаты: L20 2026-10-06 №2 «а если трек сразу на чеке печатать?»
#11 открытый вопрос · БТ · экран оператора
   цитаты: L34 2026-10-08 №2 «экран оператора: скан QR из приложения → вес → печать наклейки с треком»

## Отменено и не принято
#10 отменено · БТ · где принимаем посылки
   цитаты: L15 2026-10-06 №1 «Хочет сразу во всех пунктах, без исключений.»
`,
    },
  },
  OUT: {
    tail: `
## ${DATE}

### 1 · созвон 2026-10-10: как сейчас работает пункт выдачи — /meeting-intake
- [сведение] В смене обычно один оператор, в пятницу и выходные — двое; смена 12 часов, с 9 до 21 — со слов Гаврилова О. П.
- [сведение] Вечером, с 18 до 21, очередь бывает до 10 человек — со слов Гаврилова О. П.
- [сведение] Приём возврата занимает в среднем 3–5 минут — со слов Гаврилова О. П.
- [сведение] Возвратов 20–30 в день на точку — со слов Гаврилова О. П. и Савченко Д.
- [сведение] В каждой точке стоит термопринтер, лента 58 мм — со слов Гаврилова О. П.
- [открыто] Сколько места на складе точки можно отдать под посылки — ждёт: Тихонова А. (региональный управляющий)
- [открыто] Можно ли печатать на термопринтере наклейку крупнее, на коробку — ждёт: техподдержка точек
> разбор: notes/посылки-от-частных-лиц/meeting-2026-10-10.razbor.md
`,
    files: {
      'notes/посылки-от-частных-лиц/meeting-2026-10-10.razbor.md': `# Разбор встречи 2026-10-10: как сейчас работает пункт выдачи

> Источник: ${CALL}
> Тема: строки L1–L71; итоги: L66–L68
> Документы задачи: нет
> Ноут: ${NB}, запись ${DATE} №1

## В ноут
#1 сведение · БТ · смена
   цитаты: L8 14:00:47 Гаврилов Олег Петрович: «Обычно один оператор. В пятницу и в выходные двое, поток больше.» | L10 14:00:58 Гаврилов Олег Петрович: «Двенадцать часов, с девяти до девяти.»
   в ноут: п.1
#2 сведение · БТ · вечерний пик
   цитаты: L14 14:01:16 Гаврилов Олег Петрович: «Вечером, с шести до девяти. Люди с работы идут, очередь бывает человек до десяти.»
#3 сведение · БТ · приём возврата
   цитаты: L26 14:02:27 Гаврилов Олег Петрович: «В среднем три пять минут, я бы так сказал.»
#4 сведение · БТ · возвратов в день
   цитаты: L28 14:02:37 Гаврилов Олег Петрович: «У нас двадцать тридцать в день.» | L29 14:02:44 Савченко Дмитрий: «По сети примерно так же, двадцать тридцать на точку.»
#5 сведение · БТ · термопринтер
   цитаты: L35 14:03:26 Гаврилов Олег Петрович: «Он в каждой точке стоит» | L38 14:03:58 Гаврилов Олег Петрович: «лента 58 мм»
#6 открытый вопрос · БТ · место на складе
   цитаты: L46 14:04:47 Гаврилов Олег Петрович: «Сколько места под посылки можно отдать, это не я решаю.… Я у неё уточню.»
#7 открытый вопрос · БТ · наклейка крупнее
   цитаты: L41 14:04:14 Гаврилов Олег Петрович: «Это к техподдержке точек, я у них уточню.»

## Отброшено
- L65 — «записала»: маркер без решения
`,
    },
  },
  REC: {
    tail: `
## ${DATE}

### 1 · созвон 2026-10-14: отмена записи, правки после пилота — /meeting-intake
- [решено] Отменить запись можно не позднее чем за 12 часов до приёма вместо 24 — решил: Зайцева О.
- [решено] Лимит отмен в месяц меняется, новое значение не названо — решил: Зайцева О.
- [открыто] Можно ли отменять запись по ДМС так же — ждёт: Ким С.
- [открыто] Добавили ли к SMS пуш и кто это принял — ждёт: —
- [мысль] И стоило бы предупреждать пациента, что у него осталась одна отмена.
> разбор: notes/отмена-записи/meeting-2026-10-14.razbor.md
`,
    files: {
      'notes/отмена-записи/meeting-2026-10-14.razbor.md': `# Разбор встречи 2026-10-14: отмена записи, правки после пилота

> Источник: ${REC77}
> Тема: строки L1–L65; итоги: L37, L42–L60
> Документы задачи: ${BT77}
> Ноут: ${NB_REC}, запись ${DATE} №1

## В ноут
#1 решение · БТ · срок отмены
   цитаты: L19 Аналитик: «Главное — срок отмены сократили: было за 24 часа, стало за 12, и Ольга Зайцева это утвердила.» | L37 Аналитик: «12 часов и новый лимит — согласовано, остальное после Кима»
   в ноут: п.1
#2 решение · БТ · лимит отмен
   цитаты: L19 Аналитик: «Лимит отмен в месяц тоже поменяли, а на сколько, не помню.»
#3 открытый вопрос · БТ · отмена по ДМС
   цитаты: L22 Аналитик: «можно ли отменять запись по ДМС так же, пока не решили»
#4 условное · БТ · пуш к SMS
   цитаты: L22 Аналитик: «Кажется, ещё к SMS добавили пуш.» | L11 заметки: «SMS + пуш?»
   решение аналитика: в открытые вопросы

## Уже записано
#5 вне рамок · БТ · колл-центр
   цитаты: L13 «колл-центр не трогаем»

## Поручения
#6 поручение · вне документов · счётчик отмен
   цитаты: L22 Аналитик: «Павел Гусев посмотрит, где у нас хранится счётчик отмен.»

## Отброшено
- L22, L34 — предупреждение пациенту об оставшейся отмене: мысль аналитика
`,
    },
  },
  SAME: {
    tail: `
## ${DATE}

### 1 · созвон 2026-10-14: отмена записи, правки после пилота — /meeting-intake
- [решено] Отменить запись можно не позднее чем за 12 часов до приёма — решил: Зайцева О.; вместо: 2026-10-08 №1 «Отменить запись можно не позднее чем за 24 часа»
- [решено] Лимит отмен в месяц меняется, новое значение не названо — решил: Зайцева О.
- [открыто] Можно ли отменять запись по ДМС так же — ждёт: Ким С.
- [открыто] Добавили ли к SMS пуш и кто это принял — ждёт: —
- [мысль] Предупреждать ли пациента, что у него осталась одна отмена
> разбор: notes/отмена-записи/meeting-2026-10-14.razbor.md
`,
    files: {
      'notes/отмена-записи/meeting-2026-10-14.razbor.md': `# Разбор встречи 2026-10-14: отмена записи, правки после пилота

> Источник: ${REC77}
> Тема: строки L1–L65; итоги: L37, L42–L60
> Документы задачи: ${BT77}
> Ноут: ${NB_REC}, запись ${DATE} №1

## В ноут
#1 решение · БТ · срок отмены
   цитаты: L19 Аналитик: «Главное — срок отмены сократили: было за 24 часа, стало за 12, и Ольга Зайцева это утвердила.» | L37 Аналитик: «12 часов и новый лимит — согласовано, остальное после Кима»
   в ноут: п.1
#2 решение · БТ · лимит отмен
   цитаты: L19 Аналитик: «Лимит отмен в месяц тоже поменяли, а на сколько, не помню.»
#3 открытый вопрос · БТ · отмена по ДМС
   цитаты: L22 Аналитик: «можно ли отменять запись по ДМС так же, пока не решили»
#4 условное · БТ · пуш к SMS
   цитаты: L22 Аналитик: «Кажется, ещё к SMS добавили пуш.» | L11 заметки: «SMS + пуш?»
   решение аналитика: в открытые вопросы

## Поручения
#5 поручение · вне документов · счётчик отмен
   цитаты: L22 Аналитик: «Павел Гусев посмотрит, где у нас хранится счётчик отмен.»

## Отброшено
- L34 — мысль аналитика: предупреждение пациенту об оставшейся отмене
`,
    },
  },
  ANS: {
    files: {
      [`coddoc/RET-214/notebook-${DATE}-bt.md`]: `# Ноут возврат товара без чека на ${DATE}

> Задача: RET-214 · цель: правка работающего
> Документ: нет
> Ноут: ${NB_ANS} · записи 2026-10-07–2026-10-10

## Решено
1. Как сейчас: без чека возврат не принимают → как должно стать: принимаем, если покупка находится в истории по карте лояльности — решила Соколова М.
2. Деньги за возврат без чека возвращаем только на карту, с которой платили — решила Соколова М.
3. Паспорт при возврате без чека не нужен: достаточно карты лояльности и подписи покупателя на заявлении о возврате — решил Котов А. (юрист)

## Открыто
- Кто подписывает акт возврата без чека — ждёт: Гарипова Л.

## Сведения
- Сейчас без чека возврат не принимают совсем, кассиры отказывают — со слов Ильина П.
- Касса показывает историю покупок по карте лояльности за последний год — со слов Дёмина К.
- Возвраты без чека бухгалтерия хочет видеть отдельной строкой в дневном отчёте — со слов Гариповой Л.
`,
      [`coddoc/RET-214/notebook-${DATE}.razbor.md`]: `# Разбор ноута на ${DATE}: возврат товара без чека

> Источник: ${NB_ANS}
> Тема: строки L1–L36; итогов нет
> Документы задачи: нет
> Вход: coddoc/RET-214/notebook-${DATE}-bt.md

## Во вход notebook-${DATE}-bt.md
#1 сведение · БТ · как сейчас
   цитаты: L15 2026-10-07 №1 Ильин П.: «Сейчас без чека не принимаем совсем, кассиры отказывают.»
   во вход: п.1
#2 решение · БТ · когда принимаем
   цитаты: L16 2026-10-07 №1 Соколова М.: «Принимаем, если покупка находится в истории по карте лояльности.»
#3 решение · БТ · куда деньги
   цитаты: L16 2026-10-07 №1 Соколова М.: «Деньги — только на карту, с которой платили. Решили.»
#4 решение · БТ · паспорт
   цитаты: L35 2026-10-10 №1: «Паспорт при возврате без чека не требуем: хватает карты лояльности и подписи покупателя на заявлении о возврате.»
#5 сведение · БТ · история на кассе
   цитаты: L22 2026-10-07 №2: «Касса уже показывает историю покупок по карте лояльности, глубина — последний год.»
#6 сведение · БТ · дневной отчёт
   цитаты: L29 2026-10-08 №1: «Гарипова сказала, что возвраты без чека хотят видеть отдельной строкой в дневном отчёте.»
#7 открытый вопрос · БТ · акт
   цитаты: L29 2026-10-08 №1: «Кто подписывает акт возврата — уточнит.»
`,
    },
  },
}

function buildSandbox (fx, et) {
  const sb = mkdtempSync(join(tmpdir(), 'grade-minb-'))
  for (const [rel, src] of Object.entries(fx.seed)) { mkdirSync(join(sb, rel, '..'), { recursive: true }); writeFileSync(join(sb, rel), read(join(HERE, src))) }
  writeFileSync(join(sb, '_seeded.txt'), Object.keys(fx.seed).join('\n') + '\n')
  writeFileSync(join(sb, 'answer-01.md'), 'Разбор готов. Сводка ниже.')
  writeFileSync(join(sb, 'answer.md'), 'Разбор готов. Сводка ниже.')
  if (et.tail) writeFileSync(join(sb, fx.notebook), read(join(HERE, fx.seed[fx.notebook])) + et.tail)
  for (const [rel, text] of Object.entries(et.files)) { mkdirSync(join(sb, rel, '..'), { recursive: true }); writeFileSync(join(sb, rel), text) }
  return sb
}

function selftest () {
  let bad = 0
  // При провале печатается последний разбор песочницы: видно, какая проверка сработала.
  let last = null
  const ck = (n, got, want) => { const ok = got === want; if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${n}: ${got} (ожидалось ${want})`); if (!ok && last) console.log('        ', last.red.join(' | ')) }
  for (const [name, fx] of Object.entries(FX)) {
    console.log(`\n${name}`)
    const et = ETALON[name]
    const sb = buildSandbox(fx, et)
    const edit = (rel, f) => { const p = join(sb, rel); const old = read(p); writeFileSync(p, f(old)); return () => writeFileSync(p, old) }
    // Откат удаляет и опустевшие папки: пустая `coddoc/` после отката — уже «создана папка coddoc/».
    const unput = (rel) => {
      rmSync(join(sb, rel))
      const parts = rel.split('/').slice(0, -1)
      for (let k = parts.length; k > 0; k--) {
        const d = join(sb, ...parts.slice(0, k))
        if (readdirSync(d).length) break
        rmSync(d, { recursive: true })
      }
    }
    const put = (rel, text) => { mkdirSync(join(sb, rel, '..'), { recursive: true }); writeFileSync(join(sb, rel), text); return () => unput(rel) }
    // Мутация на время одной проверки: применить, оценить, откатить.
    const with_ = (undo, fn) => { try { return fn() } finally { undo() } }
    const move = (from, to) => {
      const t = read(join(sb, from)); rmSync(join(sb, from))
      mkdirSync(join(sb, to, '..'), { recursive: true }); writeFileSync(join(sb, to), t)
      return () => { unput(to); writeFileSync(join(sb, from), t) }
    }
    const g = () => (last = gradeRun(sb, fx))
    try {
      const g0 = g()
      ck('эталон — зелёный', g0.pass, true)
      if (!g0.pass) console.log('      ', g0.red)
      ck('эталон без предупреждений', g0.warn.join('; '), '')
      const raz = Object.keys(et.files).find((f) => f.endsWith('.razbor.md'))
      console.log(`      цитат в эталоне разбора: ${g0.razbor && g0.razbor.quotes}`)
      ck('выдуманная цитата — красный', with_(edit(raz, (t) => t.replace(/(цитаты: L\d+[^«\n]*«)[^»]{10,}»/, '$1Это мы точно решили, записываю»')), () => g().pass), false)
      const moved = with_(edit(raz, (t) => t.replace(/цитаты: L(\d+)/, (_, n) => `цитаты: L${Number(n) + 9}`)), () => g())
      ck('верная цитата на чужой строке — предупреждение, не красный', `${moved.pass}/${moved.warn.some((w) => /номер строки/.test(w))}`, 'true/true')
      ck('мало цитат — красный', with_(edit(raz, (t) => t.replace(/«/g, '"').replace(/»/g, '"')), () => g().pass), false)
      ck('нет раздела в разборе — предупреждение', with_(edit(raz, (t) => t.replace(/^## (Во вход|В ноут).*$/m, '## Разное')), () => { const x = g(); return `${x.pass}/${x.warn.some((w) => /нет раздела/.test(w))}` }), 'true/true')
      ck('лишний файл — красный', with_(put('notes/extra.md', 'x'), () => g().pass), false)
      ck('файлы стенда — не лишние', with_(put('_stderr.log', ''), () => g().pass), true)
      const seedOther = Object.keys(fx.seed).find((k) => k !== fx.notebook)
      if (seedOther) ck(`засев тронут (${seedOther}) — красный`, with_(edit(seedOther, (t) => t + '\nправка\n'), () => g().pass), false)
      ck('ключ спрошен', with_(edit('answer-01.md', () => 'Ключ задачи? если его ещё нет — так и напишите'), () => g().pass), fx.keyAsk !== 'red')
      // Ревью 1.1.0: Шаг 8 — текст в каждой строке `цитаты:`; цитата без букв — не выдумка; вопрос темы — только вопрос.
      ck('строка «цитаты:» из одних номеров — красный', with_(edit(raz, (t) => t.replace(/^(\s*цитаты: ).*$/m, '$1L14, L16')), () => g().red.some((x) => /без текста/.test(x))), true)
      ck('строка «цитаты:» с текстом у одного номера из двух — засчитано', with_(edit(raz, (t) => t.replace(/^(\s*цитаты: .*)$/m, '$1 | L3')), () => g().pass), true)
      ck('цитата «?» без букв не на своей строке — не выдумка и не в счёт', with_(edit(raz, (t) => t.replace(/^(\s*цитаты: .*)$/m, '$1 | L900 «?»')), () => { const x = g(); return `${x.pass}/${x.razbor.quotes}` }), `true/${g0.razbor.quotes}`)
      ck('цитата «…» — не выдумка и не в счёт', with_(edit(raz, (t) => t.replace(/^(\s*цитаты: .*)$/m, '$1 | L5 «…»')), () => { const x = g(); return `${x.pass}/${x.razbor.quotes}` }), `true/${g0.razbor.quotes}`)
      ck('вопрос «Какую тему дописать?» — красный', with_(edit('answer-01.md', () => 'Встреча разобрана на две темы.\n\n**Какую тему дописать в ноут?** Рекомендую первую.\n\n1. Место под посылки\n2. Возврат'), () => g().red.includes('спрошен выбор темы')), true)
      ck('«Выберите тему:» без «?» — красный', with_(edit('answer-01.md', () => 'Выберите тему: 1. Место 2. Возврат'), () => g().red.includes('спрошен выбор темы')), true)
      ck('«Темы с решениями — одна» — не вопрос темы', with_(edit('answer-01.md', () => 'Темы с решениями — одна, без вопроса. Записать 5 пунктов?'), () => g().pass), true)
      ck('«в выбор не идёт» — не вопрос темы', with_(edit('answer-01.md', () => 'Третья тема — офтоп, в выбор не идёт. Записать 5 пунктов?'), () => g().pass), true)
      ck('«Как назвать тему записи?» — не вопрос выбора темы', with_(edit('answer-01.md', () => 'Как назвать тему записи? Предлагаю «отмена записи».'), () => g().red.includes('спрошен выбор темы')), false)
      ck('«Какую из тем дописать?» — красный', with_(edit('answer-01.md', () => 'Какую из тем дописать в ноут?'), () => g().red.includes('спрошен выбор темы')), true)
      ck('«Какой предмет разбираем?» — красный', with_(edit('answer-01.md', () => 'Какой предмет разбираем первым?'), () => g().red.includes('спрошен выбор темы')), true)
      ck('«какая тема стояла в приглашении?» — не выбор темы', with_(edit('answer-01.md', () => 'Как называлась встреча, какая тема стояла в приглашении?'), () => g().red.includes('спрошен выбор темы')), false)

      if (name === 'IN') {
        const inp = Object.keys(et.files).find((f) => f.endsWith('-bt.md'))
        const addDec = (line) => edit(inp, (t) => t.replace('## Решено\n', `## Решено\n0. ${line}\n`))
        const drop = (re) => edit(inp, (t) => t.split('\n').filter((l) => !re.test(l)).join('\n'))
        ck('ноут тронут — красный', with_(edit(NB, (t) => t.replace('ключ: PVZ-318', 'ключ: PVZ-319')), () => g().pass), false)
        ck('X в «Решено» — красный', with_(addDec('Посылки принимаем в любом пункте выдачи сети.'), () => g().pass), false)
        ck('«везде» в «Решено» — красный', with_(addDec('Посылки принимаем везде.'), () => g().pass), false)
        ck('«во всех, где есть весы» — не X', with_(addDec('Принимаем во всех пунктах, где есть весы.'), () => g().pass), true)
        ck('нет Y — красный', with_(drop(/где есть весы/), () => g().pass), false)
        ck('«вес посылки» — не Y', with_(drop(/где есть весы/), () => with_(addDec('Вес посылки не больше 15 кг.'), () => g().red.some((x) => /Y/.test(x)))), true)
        ck('нет оплаты — красный', with_(drop(/оплачивает/), () => g().pass), false)
        ck('нет 15 кг — красный', with_(drop(/15 кг/), () => g().pass), false)
        ck('15 кг в «Не входит» — засчитано', with_(drop(/15 кг/), () => with_(edit(inp, (t) => t.replace('## Сведения\n', '## Не входит\n- Посылки тяжелее 15 кг не принимаем.\n\n## Сведения\n')), () => g().pass)), true)
        ck('мысль в «Решено» — красный', with_(drop(/трек-номер прямо/), () => with_(addDec('Трек-номер печатаем на чеке приёмки.'), () => g().pass)), false)
        ck('набросок в «Открыто» без пометки — красный', with_(edit(inp, (t) => t.replace('наклейку с трек-номером (со слов аналитика)', 'наклейку с трек-номером')), () => g().pass), false)
        ck('мысль в «Сведениях» — красный', with_(drop(/трек-номер прямо/), () => with_(edit(inp, (t) => t.replace('## Сведения\n', '## Сведения\n- Трек-номер можно печатать на чеке (со слов аналитика).\n')), () => g().pass)), false)
        ck('сведение «1200» потеряно — красный', with_(drop(/из 1200/), () => g().pass), false)
        ck('сведение «19:00» без числа — красный', with_(edit(inp, (t) => t.replace(', после 19:00', '')), () => g().pass), false)
        ck('сведение ушло в «Решено» — красный', with_(drop(/180 заказов/), () => with_(addDec('Пункт выдаёт около 180 заказов в день.'), () => g().pass)), false)
        ck('нет открытого про вложение — красный', with_(drop(/внутри посылки/), () => g().pass), false)
        ck('якорь L12 во входе — красный', with_(addDec('Оплата онлайн (L13).'), () => g().pass), false)
        ck('№ во входе — красный', with_(addDec('Заменяет 2026-10-06 №1.'), () => g().pass), false)
        ck('цель «правка работающего» — красный', with_(edit(inp, (t) => t.replace('цель: новый БТ', 'цель: правка работающего')), () => g().pass), false)
        ck('«**цель:** новый БТ» — засчитано', with_(edit(inp, (t) => t.replace('цель: новый БТ', '**цель:** новый БТ')), () => g().pass), true)
        ck('вход -spec вместо -bt — красный', with_(move(inp, inp.replace('-bt.md', '-spec.md')), () => g().pass), false)
        ck('вход в coddoc/_inbox — красный', with_(move(inp, `coddoc/_inbox/notebook-${DATE}-bt.md`), () => g().pass), false)
        ck('выбор темы спрошен — красный', with_(edit('answer-01.md', () => 'Темы с решениями:\n1. Посылки\n2. Весы\n**Какую тему разбираем?**'), () => g().pass), false)
        ck('«тема одна» — не вопрос темы', with_(edit('answer-01.md', () => 'Тема одна — ноут целиком, без вопроса.'), () => g().pass), true)
        ck('дата разбора другая — предупреждение', with_(move(raz, raz.replace(DATE, '2026-10-16')), () => { const x = g(); return `${x.pass}/${x.warn.some((w) => /дата/.test(w))}` }), 'true/true')
        // Ревью 1.1.0: Y другими словами; X, заменённый Y, открытым вопросом или спором.
        ck('Y «с весовым оборудованием» — засчитано', with_(edit(inp, (t) => t.replace('где есть весы', 'где есть весовое оборудование')), () => g().pass), true)
        ck('Y «взвешивают на весах» — засчитано', with_(edit(inp, (t) => t.replace('Посылки принимаем только в пунктах выдачи, где есть весы', 'Посылки принимают только пункты выдачи, где посылку взвешивают на весах')), () => g().pass), true)
        ck('«вес посылки, взвешиваем на весах» без пункта — не Y', with_(drop(/где есть весы/), () => with_(addDec('Максимальный вес посылки 15 кг, взвешиваем на весах.'), () => g().red.some((x) => /Y/.test(x)))), true)
        ck('X в «Открыто» — красный', with_(edit(inp, (t) => t.replace('## Открыто\n', '## Открыто\n- Принимаем ли посылки в любом пункте выдачи сети — ждёт: Орлова Е.\n')), () => g().red.some((x) => /X в «Открыто»/.test(x))), true)
        ck('спор X/Y в «Открыто» — красный', with_(edit(inp, (t) => t.replace('## Открыто\n', '## Открыто\n- Что верно: принимаем во всех пунктах выдачи или только там, где есть весы — ждёт: Орлова Е.\n')), () => g().red.some((x) => /X в «Открыто»/.test(x))), true)
        ck('«во всех пунктах» в вопросе о вложении — не X', with_(edit(inp, (t) => t.replace('Должен ли оператор смотреть', 'Должен ли оператор во всех пунктах смотреть')), () => g().pass), true)
      } else if (name === 'ANS') {
        const inp = Object.keys(et.files).find((f) => f.endsWith('-bt.md'))
        const addTo = (sec, line) => edit(inp, (t) => t.replace(`## ${sec}\n`, `## ${sec}\n- ${line}\n`))
        const drop = (re) => edit(inp, (t) => t.split('\n').filter((l) => !re.test(l)).join('\n'))
        const reds = (re) => g().red.some((x) => re.test(x))
        ck('ноут тронут — красный', with_(edit(NB_ANS, (t) => t.replace('ключ: RET-214', 'ключ: RET-215')), () => g().pass), false)
        ck('закрытый вопрос в «Открыто» — красный', with_(addTo('Открыто', 'Нужен ли паспорт покупателя при возврате без чека — ждёт: Котов А. (юрист)'), () => reds(/закрытый вопрос/)), true)
        ck('закрытый вопрос в «Открыто» с ответом — красный', with_(addTo('Открыто', 'Паспорт — закрыто: не нужен (Котов А.)'), () => reds(/закрытый вопрос/)), true)
        ck('ответа нет в «Решено» — красный', with_(drop(/Паспорт при возврате/), () => reds(/паспорт не нужен/)), true)
        ck('ответ в «Сведениях», а не в «Решено» — красный', with_(drop(/Паспорт при возврате/), () => with_(addTo('Сведения', 'Паспорт при возврате без чека не нужен — со слов Котова А.'), () => reds(/паспорт не нужен/))), true)
        ck('«паспорт не требуется» — засчитано', with_(edit(inp, (t) => t.replace('Паспорт при возврате без чека не нужен: достаточно', 'Паспорт при возврате без чека не требуется, хватает')), () => g().pass), true)
        ck('«без паспорта» — засчитано', with_(edit(inp, (t) => t.replace('Паспорт при возврате без чека не нужен: достаточно карты', 'Возврат без чека оформляем без паспорта — по карте')), () => g().pass), true)
        ck('«паспорт не обязателен» — засчитано', with_(edit(inp, (t) => t.replace('Паспорт при возврате без чека не нужен: достаточно', 'Паспорт при возврате без чека не обязателен; нужны')), () => g().pass), true)
        ck('ответ «паспорт нужен» — красный', with_(edit(inp, (t) => t.replace('Паспорт при возврате без чека не нужен: достаточно карты лояльности и подписи', 'Паспорт при возврате без чека нужен вместе с подписью')), () => reds(/паспорт не нужен/)), true)
        ck('нет решения «по истории карты» — красный', with_(drop(/в истории по карте лояльности — решила/), () => reds(/истории по карте/)), true)
        ck('нет решения «только на карту» — красный', with_(drop(/только на карту/), () => reds(/только на карту/)), true)
        ck('нет открытого про акт — красный', with_(drop(/подписывает акт/), () => reds(/акт возврата/)), true)
        ck('сведение «последний год» потеряно — красный', with_(drop(/последний год/), () => reds(/последний год/)), true)
        ck('сведение «дневной отчёт» потеряно — красный', with_(drop(/дневном отчёте/), () => reds(/дневном отчёте/)), true)
        ck('сведение «не принимают» потеряно — красный', with_(drop(/кассиры отказывают/), () => with_(drop(/Как сейчас:/), () => reds(/не принимают/))), true)
        ck('«как сейчас» только парой в «Решено» — засчитано', with_(drop(/кассиры отказывают/), () => reds(/не принимают/)), false)
        ck('сведение в разборе «для другого документа» — предупреждение', with_(drop(/последний год/), () => with_(edit(raz, (t) => t + '\n## Для другого документа\n#8 сведение · спека · касса\n   суть: касса показывает историю покупок за последний год\n'), () => { const x = g(); return `${x.pass}/${x.warn.some((w) => /для другого документа/.test(w))}` })), 'true/true')
        ck('цель «новый БТ» — не проверяется', with_(edit(inp, (t) => t.replace('цель: правка работающего', 'цель: новый БТ')), () => g().pass), true)
        ck('№ во входе — красный', with_(addTo('Решено', 'Отвечает на 2026-10-07 №1.'), () => g().pass), false)
        ck('вход -spec вместо -bt — красный', with_(move(inp, inp.replace('-bt.md', '-spec.md')), () => g().pass), false)
        ck('вход в coddoc/_inbox — красный', with_(move(inp, `coddoc/_inbox/notebook-${DATE}-bt.md`), () => g().pass), false)
        ck('выбор темы спрошен — красный', with_(edit('answer-01.md', () => 'Темы с решениями:\n1. Возврат\n2. Акт\n**Какую тему разбираем?**'), () => g().pass), false)
        // Ревью 1.1.0: обратный ответ не засчитывается, тот же ответ другими словами засчитывается.
        const pass = (from, to) => edit(inp, (t) => t.replace(from, to))
        const P = 'Паспорт при возврате без чека не нужен: достаточно карты лояльности и подписи покупателя на заявлении о возврате'
        ck('«паспорт нужен: карты недостаточно» — красный', with_(pass(P, 'Паспорт при возврате без чека нужен: одной карты лояльности недостаточно'), () => reds(/паспорт не нужен/)), true)
        ck('«паспорт нужен, карты не хватает» — красный', with_(pass(P, 'Паспорт при возврате без чека нужен, одной карты лояльности не хватает'), () => reds(/паспорт не нужен/)), true)
        ck('«без паспорта не принимаем» — красный', with_(pass(P, 'Без паспорта возврат без чека не принимаем'), () => reds(/паспорт не нужен/)), true)
        ck('«паспорт необязателен» — засчитано', with_(pass(P, 'Паспорт при возврате без чека необязателен'), () => g().pass), true)
        ck('«вместо паспорта — карта и подпись» — засчитано', with_(pass(P, 'Вместо паспорта при возврате без чека — карта лояльности и подпись покупателя на заявлении'), () => g().pass), true)
        ck('«паспорт не нужен; одной подписи недостаточно» — засчитано', with_(pass(P, 'Паспорт при возврате без чека не нужен; одной подписи недостаточно, нужна ещё карта лояльности'), () => g().pass), true)
        ck('«на ту же карту, которой оплачивали» — засчитано', with_(pass('возвращаем только на карту, с которой платили', 'возвращаем на ту же карту, которой оплачивали покупку'), () => g().pass), true)
        ck('«наличными, если платили картой» — не «на карту»', with_(pass('возвращаем только на карту, с которой платили', 'возвращаем наличными, даже если платили картой'), () => reds(/только на карту/)), true)
        ck('«сейчас без чека не берут» — засчитано', with_(pass('не принимают совсем, кассиры отказывают', 'сейчас совсем не берут'), () => g().pass), true)
        ck('«за последние 12 месяцев» — засчитано', with_(pass('за последний год', 'за последние 12 месяцев'), () => g().pass), true)
      } else {
        const nbEdit = (f) => edit(fx.notebook, f)
        const recLine = (re, line) => nbEdit((t) => t.replace(re, line))
        const addItem = (line) => nbEdit((t) => t.replace(/^(> разбор:)/m, `${line}\n$1`))
        ck('ноут без новой записи — красный', with_(nbEdit(() => read(join(HERE, fx.seed[fx.notebook]))), () => g().red.includes('в ноуте нет новой записи')), true)
        ck('старая запись тронута — красный', with_(nbEdit((t) => t.replace(/^(## 2026-10-0\d)$/m, '$1 ')), () => g().pass), false)
        ck('шапка тронута — красный', with_(nbEdit((t) => t.replace(/^ключ: .*$/m, 'ключ: ABC-1')), () => g().pass), false)
        ck('запись без новой даты — красный', with_(nbEdit((t) => t.replace(new RegExp(`\\n## ${DATE}\\n`), '\n')), () => g().pass), false)
        ck('запись без «— /meeting-intake» — красный', with_(nbEdit((t) => t.replace(' — /meeting-intake', '')), () => g().pass), false)
        ck('якорь L22 в пункте — красный', with_(addItem('- [открыто] Что-то ещё (L22) — ждёт: Ким С.'), () => g().pass), false)
        ck('разбор не в папке ноута — красный', with_(move(raz, `coddoc/_inbox/${raz.split('/').pop()}`), () => g().pass), false)
        ck('записан вход -bt — красный', with_(put('notes/x/meeting-2026-10-14-bt.md', 'x'), () => g().pass), false)
        ck('нет «> разбор:» — предупреждение', with_(nbEdit((t) => t.replace(/^> разбор:.*\n/m, '')), () => { const x = g(); return `${x.pass}/${x.warn.some((w) => /разбор:/.test(w))}` }), 'true/true')
        // Ревью 1.1.0: ход-стоп на «решений нет» — без записи и без вопроса; реплика стенда доводит до записи и прячет стоп.
        const turns = (a1, a2, write) => {
          const undo = [edit('answer-01.md', () => a1), put('answer-02.md', a2)]
          if (write) undo.push(put('stream.jsonl', JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'x', name: 'Edit', input: { file_path: 'C:\\sb\\' + fx.notebook.split('/').join('\\'), old_string: 'a', new_string: 'b' } }] } }) + '\n'))
          return () => undo.reverse().forEach((u) => u())
        }
        const stopRed = () => g().red.some((x) => /стоп на «решений нет»/.test(x))
        ck('ход-стоп «решений нет» без записи и вопроса — красный', with_(turns('Разбор готов.\n\nАналитических решений на встрече нет.', 'Запись добавлена в ноут.'), stopRed), true)
        ck('«решений нет» в ходе, где ноут записан, — не стоп', with_(turns('Запись добавлена в ноут.\n\nАналитических решений на встрече нет.', 'Готово.', true), stopRed), false)
        ck('«решений нет» в середине хода с вопросом — не стоп', with_(turns('Решений на встрече нет, но есть сведения.\n\nЗаписать 18 пунктов в ноут?', 'Запись добавлена.'), stopRed), false)
        ck('стоп «Решений по теме нет — файлов не пишу.» — красный', with_(turns('Разбор готов.\n\nРешений по теме нет — файлов не пишу.', 'Запись добавлена.'), stopRed), true)
        if (name !== 'SAME') {
          ck('«отвечает на:» в записи — красный', with_(addItem('- [сведение] Оператор смотрит товар перед приёмом — со слов Гаврилова О. П.; отвечает на: 2026-10-08 №1 «Должен ли оператор смотреть»'), () => g().red.some((x) => /отвечает на/.test(x))), true)
          ck('«вместо:» в записи — красный', with_(addItem('- [решено] Пилот идёт в трёх филиалах — решил: Зайцева О.; вместо: 2026-10-08 №1 «Пилот отмены записи»'), () => g().red.some((x) => /вместо:/.test(x))), true)
          ck('«вместо 24» без двоеточия — не связь', g0.red.some((x) => /вместо:/.test(x)), false)
          ck('«вместо: 24 часа» обычным текстом — не связь', with_(addItem('- [сведение] Срок отмены, вместо: 24 часа, теперь короче — со слов Зайцевой О.'), () => g().red.some((x) => /вместо:/.test(x))), false)
        }
        if (name === 'OUT') {
          ck('[решено] в записи — красный', with_(addItem('- [решено] Смена 12 часов — решил: Гаврилов О. П.'), () => g().pass), false)
          ck('два сведения — красный', with_(nbEdit((t) => t.replace(/^- \[сведение\] (Приём|Возвратов|В каждой).*\n/gm, '')), () => g().pass), false)
          ck('сведение без «со слов» не считается', with_(nbEdit((t) => t.replace(/^- \[сведение\] (Приём|Возвратов).*\n/gm, '').replace(/лента 58 мм — со слов Гаврилова О. П./, 'лента 58 мм')), () => g().pass), false)
          ck('[открыто] с «ждёт: —» — красный', with_(nbEdit((t) => t.replace(/ждёт: Тихонова А\. \(региональный управляющий\)/, 'ждёт: —').replace('ждёт: техподдержка точек', 'ждёт: —')), () => g().pass), false)
          ck('«ждет:» без ё — засчитано', with_(nbEdit((t) => t.replace('ждёт: Тихонова', 'ждет: Тихонова').replace('ждёт: техподдержка', 'ждет: техподдержка')), () => g().pass), true)
          ck('создана coddoc/ — красный', with_(put('coddoc/.keep', ''), () => g().pass), false)
          ck('расшифровка тронута — красный', with_(edit(CALL, (t) => t + 'x\n'), () => g().pass), false)
          ck('«решений нет» в ответах — заметка', with_(edit('answer-01.md', () => 'Аналитических решений на встрече нет, но есть сведения.'), () => { const x = g(); return `${x.pass}/${x.info.length}` }), 'true/1')
          ck('запись дописана без пустой строки в конце засева', with_(nbEdit((t) => t.replace(/\n\n## 2026-10-15/, '\n## 2026-10-15')), () => g().pass), true)
        } else if (name === 'SAME') {
          const vm = (q) => recLine(/; вместо: .*$/m, q === null ? '' : `; вместо: ${q}`)
          const reds = (re) => g().red.some((x) => re.test(x))
          ck('нет «вместо:» у 12 часов — красный', with_(vm(null), () => reds(/нет «вместо/)), true)
          ck('«вместо:» на 2026-10-09 №1 — красный', with_(vm('2026-10-09 №1 «Отменить запись можно не позднее»'), () => reds(/а пункт о 24 часах/)), true)
          ck('«вместо:» с началом «Отменить запись можно не позднее» — засчитано', with_(vm('2026-10-08 №1 «Отменить запись можно не позднее»'), () => g().pass), true)
          ck('«вместо:» с куском «…за 24 часа до приёма» — засчитано', with_(vm('2026-10-08 №1 «…за 24 часа до приёма»'), () => g().pass), true)
          ck('«вместо:» с «Отменить запись можно не позднее чем за 24 часа…» — засчитано', with_(vm('2026-10-08 №1 «Отменить запись можно не позднее чем за 24 часа…»'), () => g().pass), true)
          ck('«вместо:» с кавычками чужого пункта — красный', with_(vm('2026-10-08 №1 «Пилот отмены записи»'), () => reds(/не из пункта о 24/)), true)
          ck('«вместо:» с одним словом «Отменить» — красный', with_(vm('2026-10-08 №1 «Отменить»'), () => reds(/не из пункта о 24/)), true)
          ck('«вместо:» без кавычек — красный', with_(vm('2026-10-08 №1'), () => reds(/не по форме/)), true)
          ck('«вместо: 2026-10-08 № 1, «…»» с запятой — засчитано', with_(vm('2026-10-08 № 1, «Отменить запись можно не позднее чем за 24 часа»'), () => g().pass), true)
          ck('«вместо:» с пунктом целиком и «— решил:» — засчитано', with_(vm('2026-10-08 №1 «Отменить запись можно не позднее чем за 24 часа до приёма — решил: Зайцева О.»'), () => g().pass), true)
          ck('«отвечает на:» в записи — красный', with_(addItem('- [решено] Регистратор видит причину отмены — решил: Зайцева О.; отвечает на: 2026-10-09 №1 «Нужно ли регистратору»'), () => reds(/отвечает на/)), true)
          ck('«вместо:» у другого пункта — красный', with_(recLine(/^(- \[решено\] Лимит.*)$/m, '$1; вместо: 2026-10-08 №1 «Пилот отмены записи»'), () => reds(/«вместо:» в записи/)), true)
          ck('спор «что верно: 24 или 12» в [открыто] — красный', with_(addItem('- [открыто] Что верно: отмена за 24 часа (Зайцева О., 2026-10-08 №1) или за 12 часов (Зайцева О.) — ждёт: Зайцева О.'), () => reds(/спор или старый срок/)), true)
          ck('старое правило «за сутки» решением — красный', with_(addItem('- [решено] Отмена за сутки до приёма остаётся для ДМС — решил: Зайцева О.'), () => reds(/спор или старый срок/)), true)
          ck('вопрос по шаблону спора — красный', with_(edit('answer-01.md', () => 'п.1 спорит с 2026-10-08 №1 (Зайцева О.): «за 24 часа»: в открытые, новое или старое?'), () => reds(/спрошен спор/)), true)
          ck('«Что действует: 24 часа или 12?» — красный', with_(edit('answer-01.md', () => 'Срок отмены в ноуте другой. Что действует: 24 часа или 12?'), () => reds(/спрошен спор/)), true)
          ck('строка сводки про замену без вопроса — не спор', with_(edit('answer-01.md', () => 'п.1 вместо 2026-10-08 №1 «Отменить запись можно…» — решила та же Зайцева О., спора нет.\n\nЗаписать 5 пунктов в ноут?'), () => g().pass), true)
          ck('мысль не [мысль] — предупреждение, не красный', with_(recLine(/^- \[мысль\] /m, '- [открыто] '), () => { const x = g(); return `${x.pass}/${x.warn.some((w) => /пациенту/.test(w))}` }), 'true/true')
          ck('цитата разбора — строка ноута, а не протокола — предупреждение', with_(edit(raz, (t) => t.replace('   в ноут: п.1', '   цитаты: L15 ноут 2026-10-08 №1: «Отменить запись можно не позднее чем за 24 часа до приёма»\n   в ноут: п.1')), () => { const x = g(); return `${x.pass}/${x.warn.some((w) => /из ноута/.test(w))}` }), 'true/true')
          ck('12 часов без «вместо:», но с «вместо 24» в тексте — красный', with_(vm(null), () => with_(recLine(/до приёма — решил/, 'до приёма вместо 24 — решил'), () => reds(/нет «вместо/))), true)
        } else {
          ck('предупреждение [решено] — красный', with_(recLine(/^- \[мысль\] /m, '- [решено] '), () => g().pass), false)
          ck('предупреждение [сведение] — красный', with_(recLine(/^- \[мысль\] /m, '- [сведение] '), () => g().pass), false)
          ck('предупреждение [открыто] — красный', with_(recLine(/^- \[мысль\] (.*)$/m, '- [открыто] $1 — ждёт: —'), () => g().pass), false)
          ck('предупреждения нет — красный', with_(nbEdit((t) => t.replace(/^- \[мысль\].*\n/m, '')), () => g().pass), false)
          ck('мысль — вся строка L22 дословно — засчитано', with_(recLine(/^- \[мысль\] .*$/m, '- [мысль] Ещё ДМС обсуждали: можно ли отменять запись по ДМС так же, пока не решили. Кажется, ещё к SMS добавили пуш. И стоило бы предупреждать пациента, что у него осталась одна отмена.'), () => g().pass), true)
          ck('12 часов [сведение] — красный', with_(recLine(/^- \[решено\] Отменить/m, '- [сведение] Отменить'), () => g().pass), false)
          ck('«12 ч» засчитано', with_(recLine(/за 12 часов/, 'за 12 ч'), () => g().pass), true)
          ck('«было за 24 часа, стало за 12» засчитано', with_(recLine(/не позднее чем за 12 часов до приёма вместо 24/, 'было за 24 часа до приёма, стало за 12'), () => g().pass), true)
          ck('«112 часов» — не 12', with_(recLine(/за 12 часов/, 'за 112 часов'), () => g().pass), false)
          ck('без «решил:» — предупреждение', with_(recLine(/вместо 24 — решил: Зайцева О\./, 'вместо 24'), () => { const x = g(); return `${x.pass}/${x.warn.some((w) => /решил/.test(w))}` }), 'true/true')
          ck('пуш [решено] без сомнения — предупреждение', with_(addItem('- [решено] К SMS добавили пуш — решил: Зайцева О.'), () => { const x = g(); return `${x.pass}/${x.warn.some((w) => /пуш/.test(w))}` }), 'true/true')
          ck('пуш [решено] «(не уверен)» — без предупреждения', with_(addItem('- [решено] К SMS добавили пуш (со слов аналитика, не уверен) — решил: не помню'), () => g().warn.some((w) => /пуш/.test(w))), false)
          ck('лимит 3 — предупреждение', with_(addItem('- [решено] Лимит — 3 отмены в месяц — решил: Зайцева О.'), () => { const x = g(); return `${x.pass}/${x.warn.some((w) => /лимит/.test(w))}` }), 'true/true')
          ck('протокол тронут — красный', with_(edit(REC77, (t) => t.replace('Моя мысль.', 'Звучало на встрече.')), () => g().pass), false)
          ck('вход coddoc/MED-77 — красный', with_(put('coddoc/MED-77/meeting-2026-10-14-bt.md', 'x'), () => g().pass), false)
        }
      }
    } finally { rmSync(sb, { recursive: true, force: true }) }
  }
  // Цитата с якорем ноута: дата и № записи между номером строки и «ёлочкой» (IN).
  const tl = sourceTexts(readFileSync(join(HERE, FX.IN.source), 'utf8'))
  ck('«L28 2026-10-08 №1 «…»» — цитата считается и сходится', JSON.stringify(gradeRazbor('цитаты: L28 2026-10-08 №1 «по выдаче в среднем 180 заказов в день на точку»', tl, 1)), JSON.stringify({ quotes: 1, bad: [], moved: [], fromAlt: [], bare: [], minQuotes: 1, pass: true }))
  ck('«L28: «…»» — цитата считается', gradeRazbor('цитаты: L28: «по выдаче в среднем 180 заказов»', tl, 1).quotes, 1)
  ck('поле на следующей строке не читается цитатой', gradeRazbor('   итог: L28\n   опора: «как прозвучало» → X', tl, 0).quotes, 0)
  ck('диапазон L28–L30 сходится', gradeRazbor('L28–L30 Савченко Д.: «в пик до 400… пусть СБ скажет»', tl, 1).bad.length, 0)
  // Ревью 1.1.0: цитата без букв — сырой текст против окна; строки `цитаты:` без текста; RE_H12; кавычки `вместо:`.
  const lq = (s) => { const x = gradeRazbor(s, tl, 0); return `${x.quotes}/${x.bad.length}` }
  ck('«?» есть в окне строки — цитата сошлась', lq('оговорка: L19 «?»'), '1/0')
  ck('«?» нет в окне строки — не цитата, не выдумка', lq('оговорка: L3 «?»'), '0/0')
  ck('«…» — не цитата, не выдумка', lq('цитаты: L28 «…» | L29 «машина забирает раз в день»'), '1/0')
  ck('«цитаты: L14, L16» — строка без текста', bareQuoteLines('#1 сведение\n   цитаты: L14, L16\n').length, 1)
  ck('«цитаты: L14 «…»» — строка без текста', bareQuoteLines('   цитаты: L14 «…»').length, 1)
  ck('«цитаты: L14 "текст"» в прямых кавычках — не номер без текста', bareQuoteLines('   цитаты: L14 "сейчас ПВЗ только выдают"').length, 0)
  ck('«цитаты: — (со слов аналитика)» без номеров — не судится', bareQuoteLines('   цитаты: — (со слов аналитика)').length, 0)
  ck('«**цитаты:** L14» — строка без текста', bareQuoteLines('   **цитаты:** L14').length, 1)
  ck('текст цитаты перенесён на следующую строку — не номер без текста', bareQuoteLines('   цитаты: L14 Орлова:\n     «сейчас ПВЗ только выдают»\n   суть: x').length, 0)
  ck('«цитаты: L14, L16», под ней «оговорка: L14 «??»» — строка без текста', bareQuoteLines('   цитаты: L14, L16\n   оговорка: L14 «??»').length, 1)
  ck('RE_H12: «12-часовой срок»', RE_H12.test('Срок отмены 12-часовой'), true)
  ck('RE_H12: «двенадцать часов»', RE_H12.test('за двенадцать часов'), true)
  ck('RE_H12: «112 часов» — не 12', RE_H12.test('за 112 часов'), false)
  ck('RE_H12: «24 часа» — не 12', RE_H12.test('за 24 часа до приёма'), false)
  ck('кавычки `вместо:` «Отменить запись можно не позднее» — начало пункта', vmestoQuoteOk('Отменить запись можно не позднее'), true)
  ck('кавычки `вместо:` «за 24 часа» — кусок со сроком', vmestoQuoteOk('за 24 часа'), true)
  ck('кавычки `вместо:` «запись можно» — не начало и без срока', vmestoQuoteOk('запись можно'), false)
  ck('кавычки `вместо:` «Отменить запись за 12 часов» — не из пункта', vmestoQuoteOk('Отменить запись за 12 часов'), false)
  console.log(bad === 0 ? '\nсамопроверка: ok' : `\nсамопроверка: ПРОВАЛОВ ${bad}`)
  process.exit(bad === 0 ? 0 : 1)
}

// ---------- прогон ----------

// Импорт из другого оценщика (grade-ni.mjs) не должен запускать прогон.
const IS_MAIN = !!process.argv[1] && fileURLToPath(import.meta.url) === pathResolve(process.argv[1])
if (IS_MAIN) {
  const arg = process.argv[2]
  if (arg === '--selftest') selftest()
  const fxName = process.argv[process.argv.indexOf('--fx') + 1]
  const fx = FX[fxName]
  if (!arg || !existsSync(arg) || !fx) { console.error('usage: node grade-minb.mjs <каталог проб> --fx IN|OUT|REC|ANS|SAME | --selftest'); process.exit(1) }
  const runs = readdirSync(arg).filter((n) => /^run-\d+$/.test(n) && statSync(join(arg, n)).isDirectory()).sort()
  console.log(`\nпроба mi-nb-${fxName.toLowerCase()}, ${arg}`)
  let measured = 0; let green = 0
  for (const n of runs) {
    const dir = join(arg, n)
    const ans = existsSync(join(dir, 'answer.md')) ? readFileSync(join(dir, 'answer.md'), 'utf8') : ''
    // Отказ API — прогон не в счёт (пул пишет `_api-failure*.txt`).
    if (existsSync(join(dir, '_api-failure.txt')) || existsSync(join(dir, '_api-failure-turn.txt')) || !ans.trim() || RE_API_FAILURE.test(ans.slice(0, 300))) { console.log(`  ${n}: НЕ ИЗМЕРЕНО`); continue }
    measured++
    const r = gradeRun(dir, fx)
    if (r.pass) green++
    const turns = readdirSync(dir).filter((f) => /^answer-\d+\.md$/.test(f)).length || 1
    console.log(`  ${n}: ${r.pass ? 'ЗЕЛЁНЫЙ' : 'КРАСНЫЙ — ' + r.red.join('; ')}`)
    console.log(`         ходов: ${turns}${r.razbor ? `, цитат: ${r.razbor.quotes}` : ''}${r.info.length ? ' · ' + r.info.join(' · ') : ''}`)
    if (r.warn.length) console.log(`         предупреждения: ${r.warn.join(' · ')}`)
  }
  console.log(`\nИТОГ ${fxName}: ${green}/${measured}`)
}
