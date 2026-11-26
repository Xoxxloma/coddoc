#!/usr/bin/env node
// grade-mr.mjs — стык «протокол по памяти → meeting-intake»: пробы mr-new, mr-chg.
//
//   node grade-mr.mjs <каталог проб> --fx NEW|CHG
//   node grade-mr.mjs --selftest
//
// Критерии — fixtures/MR-NEW/README.md и fixtures/MR-CHG/README.md (записаны до прогона; здесь только
// переведены в проверки, номер проверки = номер критерия). Грейдится ФАЙЛ: вход
// `coddoc/<KEY>/meeting-2026-10-14-bt.md` и разбор рядом; документ задачи из засева — байт в байт.
// Вне критериев, предупреждениями: протокол тронут, цитаты разбора не сходятся с протоколом (±2), лишние файлы.
//
// ОДИНОЧНЫЙ РЕЖИМ — АРХИВ, ПУТЬ 1.x. `node grade-mr.mjs <каталог> --fx …` грейдил вход meeting-intake 1.x из протокола
// (`*-bt.md` + `*.razbor.md`); в 2.0 meeting-intake пишет список пунктов, вход пишет notes-to-intent. Запуск печатает это
// и выходит. Живые части — `gradeNEW` / `gradeCHG` (их импортирует grade-ni.mjs) и `--selftest`.

import { resolve as pathResolve } from 'node:path'
import { readdirSync, readFileSync, existsSync, statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const lf = (s) => s.replace(/\r\n/g, '\n')
const read = (p) => lf(readFileSync(p, 'utf8'))
const RE_API_FAILURE = /API Error|Request not allowed|Please run \/login|Credit balance|rate limit|session limit|usage limit/i

const PROTO_NEW = 'coddoc/FIT-412/meeting-2026-10-14.recall.md'
const PROTO_CHG = 'coddoc/MED-77/meeting-2026-10-14.recall.md'
const BT_CHG = 'coddoc/MED-77/business_requirements.md'

// Регулярки — литералы; граница слова для кириллицы — `(^|[^а-яё])`, `\b` в JS только ASCII. Новые — через `w()`.
const w = (stem, flags = 'i') => new RegExp('(^|[^а-яёa-z])' + stem, flags)
const anyRe = (...rs) => ({ test: (s) => rs.some((r) => r.test(s)) })
const UNSURE = /не\s+уверен|смутн|не\s+точн|вроде|кажется|со\s+слов\s+аналитика|не\s+помн|\?/i
// «один/одна/одно» — не число лимита: «одно значение на все занятия», «одна из открытых тем» (ревью 1.1.0).
const NUM = /\d|(^|[^а-яё])(два|две|двух|три|тр[её]х|четыр\S*|пять|пяти|шесть|шести|семь|семи|восем\S*|девят\S*|десят\S*|двадцат\S*|тридцат\S*|сорок\S*|пятьдесят\S*)([^а-яё]|$)/i
// 12 часов — как RE_H12 в grade-minb.mjs: «12 ч», «12-часовой», «было за 24 часа, стало за 12».
const RE_H12 = anyRe(/(^|[^\d])12\s*-?\s*(час|ч([^а-яё]|$))/i, w('двенадцат'), /(^|[^\d])24\s*час[^.;]{0,40}[^\d]12([^\d]|$)/i)
// Лимит меняют: прежнее значение (5, FR-2) рядом — не новое число.
const CHANGE = w('(меня|измен|поменя|пересматр|нов\\S*\\s+(значени|лимит|числ))')
// Мысль аналитика L25 — «показывать клиенту его место в очереди». Нужен глагол показа рядом: «встаёт в очередь»,
// «занимает своё место в очереди» — это решение о листе ожидания, а не мысль (ревью 1.1.0).
const SHOW = '(показ|вид(ит|ят|еть|н[аоы]?|ен)|отображ|сообща|подсвеч|зна(ет|ют|ть)|узна)'
const PLACE = '(^|[^а-яё])(мест[оауе]|позици\\S*|номер\\S*)(?![а-яё])'
const RE_OWN_PLACE = anyRe(w(SHOW + '[^\\n.;]{0,50}?' + PLACE + '[^\\n.;]{0,12}очеред'), new RegExp(PLACE + '[^\\n.;]{0,12}очеред\\S*[^\\n.;]{0,40}' + SHOW, 'i'))
// Платные занятия в «Решено»: решение о них или срок Анны — пункт «Уточнить»; «по платным — открытый вопрос» — нет.
const OPEN_MARK = anyRe(w('открыт\\S*\\s+вопрос'), w('вопрос\\S*\\s+открыт'), w('(не|ещё\\s+не|пока\\s+не)\\s+реш'), w('в\\s+открыт'), w('открыт(о|ым)(?![а-яё])'))
const PUSH = /пуш|push|уведомлени\S*\s+на\s+телефон|(sms|смс)[^.;\n]{0,40}добав|добав[^.;\n]{0,40}(sms|смс)/i
const DATEISH = /\d{1,2}\s*(-?го\s+)?(октябр|ноябр)|\d{1,2}\.\d{1,2}|пятниц|понедельник|вторник|(^|[^а-яё])сред[ау]([^а-яё]|$)|четверг|недел/i

export const FX = {
  NEW: {
    seed: { [PROTO_NEW]: `fixtures/MR-NEW/seed/${PROTO_NEW}` },
    proto: PROTO_NEW,
    inputRel: 'coddoc/FIT-412/meeting-2026-10-14-bt.md',
    razborRel: 'coddoc/FIT-412/meeting-2026-10-14.razbor.md',
    criteria: 8,
  },
  CHG: {
    seed: { [PROTO_CHG]: `fixtures/MR-CHG/seed/${PROTO_CHG}`, [BT_CHG]: `fixtures/MR-CHG/seed/${BT_CHG}` },
    proto: PROTO_CHG,
    doc: BT_CHG,
    inputRel: 'coddoc/MED-77/meeting-2026-10-14-bt.md',
    razborRel: 'coddoc/MED-77/meeting-2026-10-14.razbor.md',
    criteria: 7,
  },
}

// ---------- вход ----------

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

// Пункт — «- …», «* …», «N. …», «N) …» со строками-продолжениями (как в grade-meet.mjs).
function items (lines) {
  const out = []
  const MARK = /^\s*(-|\*|\d+[.)])\s+/
  for (const l of lines) {
    if (/^ ?(-|\*|\d+[.)])\s+/.test(l)) out.push(l.replace(MARK, ''))
    else if (l.trim() && out.length) out[out.length - 1] += ' ' + l.trim().replace(MARK, '')
  }
  return out
}

function parseInput (text) {
  const secs = sections(text)
  const of = (name) => Object.keys(secs).filter((k) => k.toLowerCase().startsWith(name)).flatMap((k) => items(secs[k]))
  return { head: text.split(/^## /m)[0], dec: of('решено'), open: of('открыто'), out: of('не входит'), info: of('сведения'), all: Object.keys(secs).flatMap((k) => items(secs[k])) }
}

// Записи разбора: от строки `#N …` до следующей `#N` или заголовка `## `.
function blocks (razbor) {
  const out = []
  let cur = null
  for (const l of (razbor || '').split('\n')) {
    if (/^#\d+\s/.test(l)) { cur = [l]; out.push(cur); continue }
    if (/^#{1,3}\s/.test(l)) { cur = null; continue }
    if (cur) cur.push(l)
  }
  return out.map((b) => b.join('\n'))
}

const cut = (t) => `«${t.slice(0, 60)}»`

export function gradeNEW (input, razbor) {
  const p = parseInput(input)
  const red = []
  const warn = []
  if (!/цель:\s*\**\s*новый\s+БТ/i.test(p.head)) red.push('1: цель в шапке — не «новый БТ»')
  // «Первому в очереди приходит пуш» — пункт про пуш, «лимит листа ожидания» — про лимит: ни тот ни другой не
  // решение «вводим лист ожидания». «Очередь» засчитывается только как «встаёт в очередь».
  // «занимает место в очереди», «становится в очередь» — то же решение другими словами (ревью 1.1.0).
  if (!p.dec.some((t) => /лист\S*\s+ожидани|(вста[её]т|встать|станов\S*|став(им|ят|ит)|попада\S*|записыва\S*|занима\S*\s+(\S+\s+)?мест\S*)\s+в\s+очеред/i.test(t) && !/лимит|размер/i.test(t))) red.push('2: нет в «Решено» листа ожидания')
  if (!p.dec.some((t) => /пуш|push/i.test(t) && /30\s*мин|тридцат\S*\s+минут|полчаса/i.test(t))) red.push('2: нет в «Решено» пуша первому и 30 минут')
  const SMS = /sms|смс/i
  const NEG = /не\s+(делаем|будет|отправля|нужн|шл[её]м|присыла|добавля)|без\s+(sms|смс)|только\s+пуш|отказ|(^|[^а-яё])нет([^а-яё]|$)/i
  // SMS в «Решено» с отрицанием («SMS не делаем, только пуш») — засчитан по смыслу (журнал стыка, r1).
  if (!(p.out.some((t) => SMS.test(t)) || p.dec.some((t) => SMS.test(t) && NEG.test(t)))) red.push('3: SMS нет в «Не входит»')
  const smsYes = p.dec.find((t) => SMS.test(t) && !NEG.test(t))
  if (smsYes) red.push(`3: SMS решением ${cut(smsYes)}`)
  const LIMIT = /лимит|размер\S*\s+(лист|очеред)/i
  const LIMIT_NUM = /лимит|размер\S*\s+(лист|очеред)|не\s+больше|максимум|человек\s+на/i
  if (![...p.dec, ...p.open].some((t) => LIMIT.test(t))) red.push('4: нет лимита листа')
  const limNum = p.all.find((t) => LIMIT_NUM.test(t) && NUM.test(t.replace(/30\s*мин\S*|тридцат\S*\s+минут\S*|(^|[^\d])2\s*час\S*|(два|двух)\s+час\S*|15\s*%/gi, ' ')))
  if (limNum) red.push(`4: число лимита ${cut(limNum)}`)
  if (!p.open.some((t) => /платн/i.test(t))) red.push('5: платные занятия не в «Открыто»')
  const RE15 = /(^|[^\d])15\s*(%|процент)|пятнадцат\S*\s+процент/i
  const asked15 = blocks(razbor).some((b) => RE15.test(b) && /решение аналитика/i.test(b))
  for (const t of [...p.dec, ...p.out, ...p.info]) if (RE15.test(t) && !UNSURE.test(t) && !asked15) red.push(`6: 15% твёрдым фактом ${cut(t)}`)
  const close2 = p.dec.find((t) => /закры/i.test(t) && /(^|[^\d])2\s*ч|(^|[^а-яё])(два|двух)\s+час/i.test(t))
  if (close2) red.push(`7: «закрыть за 2 часа» в «Решено» ${cut(close2)}`)
  const own = p.all.find((t) => RE_OWN_PLACE.test(t))
  if (own) red.push(`7: «место в очереди» во входе ${cut(own)}`)
  const task = p.dec.find((t) => /Денис|Ткач|оцен\S*[^.;]{0,40}(пуш|доработ)|уточн\S*[^.;]{0,40}финанс/i.test(t))
  if (task) red.push(`7: поручение решением ${cut(task)}`)
  // Протокол цел: у платных занятий (отдельный `###` протокола) есть запись разбора, а не строка «другая тема».
  if (!blocks(razbor).some((b) => /платн/i.test(b))) red.push('8: протокол разрезан — у платных занятий нет записи в разборе')
  const ask = p.dec.find((t) => /экран|начал\S*\s+встреч|встреч\S*\s+начал|кто\s+начал/i.test(t) || (w('(финанс|платн)').test(t) && (!OPEN_MARK.test(t) || DATEISH.test(t))))
  if (ask) red.push(`8: пункт «Уточнить» решением ${cut(ask)}`)
  if (/^## Отброшено[\s\S]*?друг\S*\s+тем/im.test(razbor || '')) warn.push('в «Отброшено» есть «другая тема»')
  return { red, warn }
}

export function gradeCHG (input, razbor) {
  const p = parseInput(input)
  const red = []
  const warn = []
  if (!/цель:\s*\**\s*(правки\s+БТ|правка\s+работающ)/i.test(p.head)) red.push('1: цель в шапке — не «правки БТ» и не «правка работающего»')
  if (!p.dec.some((t) => RE_H12.test(t))) red.push('2: нет в «Решено» срока отмены 12 часов')
  const LIMIT = /лимит|отмен\S*\s+в\s+месяц|раз\S*\s+в\s+месяц/i
  if (![...p.dec, ...p.open].some((t) => LIMIT.test(t))) red.push('3: нет лимита отмен')
  const lim = p.all.filter((t) => /лимит|в\s+месяц/i.test(t))
  const three = lim.find((t) => /(^|[^\d])3([^\d]|$)|(^|[^а-яё])(три|тр[её]х)([^а-яё]|$)/i.test(t))
  if (three) red.push(`3: число 3 ${cut(three)}`)
  const kept = lim.find((t) => /остав|не\s+мен|без\s+изменен|прежн|как\s+было/i.test(t))
  if (kept) red.push(`3: «лимит оставили» ${cut(kept)}`)
  // Число в «Решено» о лимите — кроме прежнего значения («сейчас 5», «было 5», «вместо 5», FR-2) и сроков в часах.
  // «Лимит в 5 отмен в месяц меняется» — 5 тоже прежнее значение: рядом слово о смене (ревью 1.1.0). «Лимит — 5» без
  // него — число лимита.
  const old5 = (t) => (CHANGE.test(t) ? t.replace(/(^|[^\d])5(?!\d)/g, '$1 ').replace(w('пят(ь|и)(?![а-яё])', 'gi'), '$1 ') : t)
  const decNum = p.dec.filter((t) => LIMIT.test(t)).find((t) => NUM.test(old5(t).replace(/(сейчас|было|вместо|как\s+сейчас|в\s+БТ)[^.;)]{0,30}?(5|пят\S*)|FR-\d+|\d+\s*-?\s*час\S*|(12|24)\s*ч([^а-яё]|$)/gi, ' ')))
  if (decNum) red.push(`3: число лимита в «Решено» ${cut(decNum)}`)
  if (!p.open.some((t) => /ДМС/i.test(t) && /Ким/i.test(t))) red.push('4: ДМС не в «Открыто» с Кимом')
  const pushDec = p.dec.find((t) => PUSH.test(t))
  // В «Решено» пуш законен только после вопроса Шага 6 с ответом «оставляем» (r2 run-1).
  const pushAsked = blocks(razbor).some((b) => PUSH.test(b) && /решение аналитика/i.test(b))
  const pushKept = blocks(razbor).some((b) => PUSH.test(b) && /решение аналитика:\s*\**\s*остав/i.test(b))
  if (pushDec && !pushKept) red.push(`5: пуш в «Решено» без вопроса Шага 6 с ответом «оставляем» ${cut(pushDec)}`)
  if (!p.all.some((t) => PUSH.test(t)) && !pushAsked) warn.push('пуша нет ни во входе, ни в вопросах Шага 6')
  const own = p.all.find((t) => /(предупрежд|напомина|сообща|показ)[^\n]{0,60}(осталась|остал\S*|последн)[^\n]{0,30}отмен|осталась\s+одна\s+отмен/i.test(t))
  if (own) red.push(`6: мысль аналитика во входе ${cut(own)}`)
  const gusev = p.all.filter((t) => /Гусев|сч[её]тчик/i.test(t))
  if (p.dec.some((t) => /Гусев|сч[её]тчик/i.test(t))) warn.push('поручение Гусева в «Решено»')
  else if (gusev.length) warn.push(`Гусев во входе — проверить, что как зависимость: ${cut(gusev[0])}`)
  if (!blocks(razbor).some((b) => /ДМС/i.test(b))) red.push('7: протокол разрезан — у ДМС нет записи в разборе')
  const gDate = p.dec.find((t) => /Гусев|сч[её]тчик/i.test(t) && DATEISH.test(t))
  if (gDate) red.push(`7: срок Гусева («Уточнить») решением ${cut(gDate)}`)
  return { red, warn }
}

// ---------- разбор: цитаты против протокола (предупреждение) ----------

const norm = (s) => s.toLowerCase().replace(/ё/g, 'е').replace(/[«»"“”]/g, '').replace(/\s+/g, ' ').trim()

// Как в grade-meet.mjs: дословно ±2 строки, допуск на описку 5% длины.
function near (win, p) {
  if (win.includes(p)) return true
  const k = Math.max(1, Math.floor(p.length * 0.05))
  if (p.length < 8) return false
  let prev = new Array(p.length + 1)
  let cur = new Array(p.length + 1)
  for (let j = 0; j <= p.length; j++) prev[j] = j
  for (let i = 1; i <= win.length; i++) {
    cur[0] = 0
    for (let j = 1; j <= p.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (win[i - 1] === p[j - 1] ? 0 : 1))
    if (cur[p.length] <= k) return true;
    [prev, cur] = [cur, prev]
  }
  return false
}

const RE_QUOTE = /L(\d+)(?:[–-]L?(\d+))?:?[ \t]+(?:\[?[\d:.,]+\]?[ \t]+)?(?:[^:«»\n]{1,60}:[ \t]*)?«([^»]+)»/g

function quotes (text, tLines) {
  const r = { n: 0, bad: [], moved: [] }
  const full = tLines.join(' ')
  for (const m of (text || '').matchAll(RE_QUOTE)) {
    r.n++
    const n = Number(m[1])
    const end = m[2] ? Math.max(n, Number(m[2])) : n
    const win = tLines.slice(Math.max(0, n - 3), end + 2).join(' ')
    const parts = m[3].split(/…|\.\.\./).map(norm).map((x) => x.replace(/[.,;:!?]+$/, '').trim()).filter((x) => x.length >= 2)
    // Цитата без букв и цифр («??», «…») — не выдумка (ревью 1.1.0, nb-r3-reg mr-new run-2: «оговорка: L14 «??»»):
    // сырой текст есть в окне — сошлась; нет — не цитата.
    if (!parts.length) {
      if (!(norm(m[3]) && win.includes(norm(m[3])))) r.n--
      continue
    }
    if (parts.every((x) => near(win, x))) continue
    if (parts.every((x) => near(full, x))) r.moved.push(`L${n}`)
    else r.bad.push(`L${n} «${m[3].slice(0, 40)}»`)
  }
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
const isStand = (f) => (!f.includes('/') && /^(answer(-\d+)?\.md|stream(-\d+)?\.jsonl|_[^/]*)$/.test(f)) || f.startsWith('_twin/')

export function gradeRun (dir, fx, name) {
  const red = []
  const warn = []
  const has = (rel) => existsSync(join(dir, rel))
  if (!has(fx.inputRel)) red.push(`1: нет входа ${fx.inputRel}`)
  if (fx.doc && (!has(fx.doc) || read(join(dir, fx.doc)) !== read(join(HERE, fx.seed[fx.doc])))) red.push('6: БТ тронут')
  if (!has(fx.proto) || read(join(dir, fx.proto)) !== read(join(HERE, fx.seed[fx.proto]))) warn.push('протокол тронут')
  const razbor = has(fx.razborRel) ? read(join(dir, fx.razborRel)) : null
  if (!razbor) warn.push('нет разбора')
  if (has(fx.inputRel)) {
    const g = (name === 'NEW' ? gradeNEW : gradeCHG)(read(join(dir, fx.inputRel)), razbor)
    red.push(...g.red)
    warn.push(...g.warn)
  }
  let q = null
  if (razbor) {
    q = quotes(razbor, lf(read(join(HERE, fx.seed[fx.proto]))).split('\n').map(norm))
    if (q.bad.length) warn.push('цитаты не из протокола: ' + q.bad.join('; '))
    if (q.moved.length) warn.push(`номер строки не тот у ${q.moved.length}`)
  }
  const seeded = new Set(Object.keys(fx.seed))
  if (has('_seeded.txt')) for (const l of read(join(dir, '_seeded.txt')).split('\n')) if (l.trim()) seeded.add(l.trim())
  const extra = listFiles(dir).filter((f) => !seeded.has(f) && !isStand(f) && f !== fx.inputRel && f !== fx.razborRel)
  if (extra.length) warn.push('лишние файлы: ' + extra.join(', '))
  return { red, warn, quotes: q, pass: !red.length }
}

// ---------- самопроверка ----------

const GOOD = {
  NEW: {
    input: `# Встреча 2026-10-14: Лист ожидания на групповые занятия

> Задача: FIT-412 · цель: новый БТ
> Документ: нет
> Встреча: 2026-10-14 11:00–12:00 · решали: заказчик — Морозова А.; продакт — Лебедев И.

## Решено
1. На групповые занятия делаем лист ожидания: когда мест нет, клиент встаёт в очередь. Решила Морозова А.
2. Когда место освобождается, первому в очереди приходит пуш. На подтверждение у него 30 минут, иначе место уходит следующему. Решила Морозова А.
3. Лимит на размер листа ожидания будет.

## Открыто
- Какое число лимита размера листа ожидания — ждёт: не названо
- Нужен ли лист ожидания на платных занятиях — ждёт: финансовый директор
- Закрывать ли лист ожидания за 2 часа до старта (аналитик не помнит, решили ли это) — ждёт: не названо

## Не входит
- SMS-уведомления: только пуш

## Сведения
- Сейчас запись отменяют примерно на 15% занятий, со слов Морозовой А. (аналитик помнит смутно)
`,
    razbor: `# Разбор встречи 2026-10-14: Лист ожидания на групповые занятия

## Во вход meeting-2026-10-14-bt.md
#1 решение · БТ · лист ожидания
   цитаты: L20 Аналитик: «Обсуждали лист ожидания на групповые занятия: когда мест нет, клиент встаёт в очередь.»
#6 открытый вопрос · БТ · лист ожидания на платных занятиях
   цитаты: L25 Аналитик: «Про платные занятия Анна сказала, что уточнит у финансового директора, нужен ли там лист ожидания.»

## Поручения
#7 поручение · вне документов · оценка пушей
   цитаты: L25 Аналитик: «Денис взял оценку доработки пушей.»

## Отброшено
- L34 — показ места в очереди: мысль аналитика
`,
  },
  CHG: {
    input: `# Встреча 2026-10-14: Правки отмены записи

> Задача: MED-77 · цель: правки БТ
> Документ: coddoc/MED-77/business_requirements.md
> Встреча: 2026-10-14 · решали: заказчик — Зайцева О.

## Решено
1. Срок отмены записи пациентом — за 12 часов до приёма вместо 24; решила Зайцева О.
2. Лимит отмен в месяц изменён (сейчас 5), новый лимит согласован; решила Зайцева О.

## Открыто
- На сколько изменён лимит отмен в месяц — ждёт: Зайцева О.
- Можно ли отменять запись по ДМС так же, как остальные — ждёт: Ким С., уточняет в страховом отделе
- Добавили ли к SMS об отмене пуш-уведомление (со слов аналитика, «кажется») и кто это решил — ждёт: не названо
`,
    razbor: `# Разбор встречи 2026-10-14: Правки отмены записи

## Во вход meeting-2026-10-14-bt.md
#1 решение · БТ · срок отмены
   цитаты: L19 Аналитик: «Главное — срок отмены сократили: было за 24 часа, стало за 12, и Ольга Зайцева это утвердила.»
#3 открытый вопрос · БТ · отмена по ДМС
   цитаты: L22 Аналитик: «Ещё ДМС обсуждали: можно ли отменять запись по ДМС так же, пока не решили»
#4 условное · БТ · пуш к SMS
   цитаты: L22 Аналитик: «Кажется, ещё к SMS добавили пуш.»
   решение аналитика: в открытые вопросы

## Отброшено
- L22, L34 — предупреждение пациенту: мысль аналитика
`,
  },
}

function selftest () {
  let bad = 0
  let last = null
  const ck = (n, got, want) => { const ok = got === want; if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${n}: ${got} (ожидалось ${want})`); if (!ok && last) console.log('        ', last.red.join(' | ')) }
  for (const [name, fx] of Object.entries(FX)) {
    console.log(`\n${name}`)
    const sb = mkdtempSync(join(tmpdir(), 'grade-mr-'))
    try {
      for (const [rel, src] of Object.entries(fx.seed)) { mkdirSync(join(sb, rel, '..'), { recursive: true }); writeFileSync(join(sb, rel), read(join(HERE, src))) }
      writeFileSync(join(sb, fx.inputRel), GOOD[name].input)
      writeFileSync(join(sb, fx.razborRel), GOOD[name].razbor)
      writeFileSync(join(sb, '_seeded.txt'), Object.keys(fx.seed).join('\n'))
      writeFileSync(join(sb, 'answer.md'), 'готово')
      const g = () => (last = gradeRun(sb, fx, name))
      const inp = GOOD[name].input
      const raz = GOOD[name].razbor
      const setIn = (t) => writeFileSync(join(sb, fx.inputRel), t)
      const setRaz = (t) => writeFileSync(join(sb, fx.razborRel), t)
      // Мутация входа или разбора на одну проверку.
      const tryIn = (t) => { setIn(t); try { return g().pass } finally { setIn(inp) } }
      const tryRaz = (t) => { setRaz(t); try { return g().pass } finally { setRaz(raz) } }
      const add = (sec, line) => inp.replace(`## ${sec}\n`, `## ${sec}\n0. ${line}\n`)
      const drop = (re) => inp.split('\n').filter((l) => !re.test(l)).join('\n')
      const g0 = g()
      ck('эталон — зелёный', g0.pass, true)
      ck('эталон без предупреждений', g0.warn.join('; '), '')
      ck('нет входа — красный', (() => { rmSync(join(sb, fx.inputRel)); try { return g().pass } finally { setIn(inp) } })(), false)
      ck('выдуманная цитата — только предупреждение', (() => { setRaz(raz.replace(/«[^»]{20,}»/, '«Это мы точно решили, записываю»')); try { const x = g(); return `${x.pass}/${x.warn.some((w) => /цитаты/.test(w))}` } finally { setRaz(raz) } })(), 'true/true')
      ck('протокол тронут — только предупреждение', (() => { const p = join(sb, fx.proto); const t = read(p); writeFileSync(p, t + 'x\n'); try { const x = g(); return `${x.pass}/${x.warn.includes('протокол тронут')}` } finally { writeFileSync(p, t) } })(), 'true/true')
      if (name === 'NEW') {
        ck('1: цель «правка работающего» — красный', tryIn(inp.replace('цель: новый БТ', 'цель: правка работающего')), false)
        ck('2: нет листа ожидания — красный', tryIn(drop(/лист ожидания: когда/)), false)
        ck('2: пуш без 30 минут — красный', tryIn(inp.replace('На подтверждение у него 30 минут, иначе', 'Иначе')), false)
        ck('3: SMS нет в «Не входит» — красный', tryIn(drop(/SMS-уведомления/)), false)
        ck('3: «SMS не делаем, только пуш» в «Решено» — засчитано (r1)', tryIn(add('Решено', 'SMS не делаем, только пуш.').replace(/- SMS-уведомления: только пуш\n/, '')), true)
        ck('3: «SMS и пуш» решением — красный', tryIn(add('Решено', 'Уведомляем по SMS и пушем.')), false)
        ck('4: лимит пропал — красный', tryIn(drop(/лимит/i)), false)
        ck('4: лимит 10 человек — красный', tryIn(add('Решено', 'Лимит листа ожидания — 10 человек.')), false)
        ck('4: «не больше двадцати» — красный', tryIn(add('Решено', 'В листе ожидания не больше двадцати человек.')), false)
        ck('4: «30 минут» в пункте с лимитом — не число лимита', tryIn(add('Решено', 'Лимит листа будет; на подтверждение 30 минут.')), true)
        ck('5: платные не в «Открыто» — красный', tryIn(drop(/платных/)), false)
        ck('6: 15% твёрдым фактом — красный', tryIn(inp.replace(' (аналитик помнит смутно)', '')), false)
        ck('6: 15% с «не уверен» — засчитано', tryIn(inp.replace('(аналитик помнит смутно)', '(аналитик не уверен)')), true)
        ck('6: 15% твёрдо, но был вопрос Шага 6 — засчитано', (() => { setRaz(raz.replace('## Поручения', '#9 сведение · БТ · доля отмен\n   суть: 15% отмен\n   решение аналитика: оставляем\n\n## Поручения')); try { return tryIn(inp.replace(' (аналитик помнит смутно)', '')) } finally { setRaz(raz) } })(), true)
        ck('6: 15% нет вовсе — засчитано', tryIn(drop(/15%/)), true)
        ck('7: «закрыть за 2 часа» в «Решено» — красный', tryIn(add('Решено', 'Лист ожидания закрывается за 2 часа до старта.')), false)
        ck('7: «место в очереди» — красный', tryIn(add('Решено', 'Клиенту показываем его место в очереди.')), false)
        ck('7: поручение Дениса решением — красный', tryIn(add('Решено', 'Денис оценит доработку пушей к пятнице.')), false)
        ck('8: разрезан — платных нет записью — красный', tryRaz(raz.replace(/#6 [\s\S]*?(?=\n## Поручения)/, '').replace('- L34', '- L25 — платные занятия: другая тема\n- L34')), false)
        ck('8: «кто начал встречу» решением — красный', tryIn(add('Решено', 'Встречу начал Лебедев И.')), false)
        ck('«место освобождается, первому в очереди» — не мысль аналитика', tryIn(inp), true)
        // Ревью 1.1.0: перефразы, которые красились.
        ck('2: «клиент занимает место в очереди» — лист ожидания, не мысль', tryIn(inp.replace('делаем лист ожидания: когда мест нет, клиент встаёт в очередь', 'когда мест нет, клиент занимает своё место в очереди')), true)
        ck('7: «показываем пуш, когда место освободилось, первому в очереди» — не мысль', tryIn(add('Решено', 'Клиенту показываем пуш, когда место освободилось, первому в очереди.')), true)
        ck('7: «показываем вместе с очередью» — не место в очереди', tryIn(add('Решено', 'Уведомление показываем вместе с очередью в приложении.')), true)
        ck('7: «клиент видит свою позицию в очереди» — красный', tryIn(add('Решено', 'Клиент видит свою позицию в очереди.')), false)
        ck('7: «Место клиента в очереди показываем» — красный', tryIn(add('Решено', 'Место клиента в очереди показываем в приложении.')), false)
        ck('8: «по платным — открытый вопрос» в «Решено» — не пункт «Уточнить»', tryIn(add('Решено', 'Лист ожидания — на групповые занятия; по платным — открытый вопрос.')), true)
        ck('8: «на платных тоже делаем» в «Решено» — красный', tryIn(add('Решено', 'Лист ожидания делаем и на платных занятиях.')), false)
        ck('8: «по платным уточнит к пятнице» в «Решено» — красный', tryIn(add('Решено', 'По платным — открытый вопрос, Анна уточнит у финансового директора к пятнице.')), false)
        ck('4: «одно значение на все занятия» — не число лимита', tryIn(add('Решено', 'Лимит листа ожидания будет, одно значение на все занятия.')), true)
        ck('цитата «??» есть в окне строки — без предупреждения', (() => { setRaz(raz + '\n   оговорка: L14 «??»\n'); try { return g().warn.some((x) => /цитаты/.test(x)) } finally { setRaz(raz) } })(), false)
        ck('цитата «?» не на своей строке — не цитата, без предупреждения', (() => { setRaz(raz + '\n   оговорка: L900 «?»\n'); try { return g().warn.some((x) => /цитаты/.test(x)) } finally { setRaz(raz) } })(), false)
      } else {
        ck('1: цель «новый БТ» — красный', tryIn(inp.replace('цель: правки БТ', 'цель: новый БТ')), false)
        ck('1: «правка работающего» — засчитано', tryIn(inp.replace('цель: правки БТ', 'цель: правка работающего')), true)
        ck('2: нет 12 часов — красный', tryIn(drop(/12 часов/)), false)
        ck('2: «112 часов» — не 12', tryIn(inp.replace('за 12 часов', 'за 112 часов')), false)
        ck('3: лимит пропал — красный', tryIn(drop(/лимит/i)), false)
        ck('3: лимит 3 — красный', tryIn(add('Решено', 'Лимит — 3 отмены в месяц.')), false)
        ck('3: «три отмены в месяц» — красный', tryIn(add('Решено', 'Не больше трёх отмен в месяц.')), false)
        ck('3: «лимит оставили 5» — красный', tryIn(add('Решено', 'Лимит отмен в месяц оставили 5.')), false)
        ck('3: «лимит 4» в «Решено» — красный', tryIn(add('Решено', 'Лимит отмен в месяц — 4.')), false)
        ck('3: «(сейчас 5)» — не число нового лимита', tryIn(inp), true)
        ck('3: «вместо пяти» — не число нового лимита', tryIn(inp.replace('изменён (сейчас 5)', 'изменён вместо пяти')), true)
        ck('4: ДМС без Кима — красный', tryIn(inp.replace('ждёт: Ким С., уточняет в страховом отделе', 'ждёт: страховой отдел')), false)
        ck('5: пуш в «Решено» без вопроса — красный', tryIn(add('Решено', 'К SMS об отмене добавляем пуш.')), false)
        ck('5: пуш в «Решено» после вопроса Шага 6 — засчитано (r2 run-1)', (() => { setRaz(raz.replace('решение аналитика: в открытые вопросы', 'решение аналитика: Оставляем')); try { return tryIn(drop(/пуш-уведомление/).replace('## Решено\n', '## Решено\n0. К SMS об отмене добавляется уведомление на телефон (со слов аналитика, не уверен).\n')) } finally { setRaz(raz) } })(), true)
        ck('5: «уведомление на телефон» без вопроса — красный', (() => { setRaz(raz.replace(/решение аналитика: .*\n/, '')); try { return tryIn(add('Решено', 'К SMS об отмене добавляется уведомление на телефон.')) } finally { setRaz(raz) } })(), false)
        ck('6: БТ тронут — красный', (() => { const p = join(sb, fx.doc); const t = read(p); writeFileSync(p, t.replace('24 часа', '12 часов')); try { return g().pass } finally { writeFileSync(p, t) } })(), false)
        ck('6: мысль аналитика — красный', tryIn(add('Решено', 'Предупреждать пациента, что у него осталась одна отмена.')), false)
        ck('6: Гусев зависимостью — предупреждение, не красный', (() => { setIn(inp + '\n## Сведения\n- Где хранится счётчик отмен, посмотрит Гусев П.\n'); try { const x = g(); return `${x.pass}/${x.warn.some((w) => /Гусев/.test(w))}` } finally { setIn(inp) } })(), 'true/true')
        ck('7: разрезан — ДМС нет записью — красный', tryRaz(raz.replace(/#3 [\s\S]*?(?=#4 )/, '')), false)
        ck('7: срок Гусева решением — красный', tryIn(add('Решено', 'Гусев посмотрит, где хранится счётчик отмен, до 20 октября.')), false)
        ck('«колл-центр как было» — не «лимит оставили»', tryIn(inp.replace('## Открыто\n', '## Не входит\n- Колл-центр не трогаем, всё как было.\n\n## Открыто\n')), true)
        // Ревью 1.1.0: «12 часов» как в grade-minb; прежнее значение 5 при смене лимита — не число нового.
        ck('2: «12-часовой вместо 24-часового» — засчитано', tryIn(inp.replace('за 12 часов до приёма вместо 24', '12-часовой вместо 24-часового')), true)
        ck('2: «было за 24 часа, стало за 12» — засчитано', tryIn(inp.replace('за 12 часов до приёма вместо 24', 'было за 24 часа до приёма, стало за 12')), true)
        ck('3: «Лимит в 5 отмен в месяц меняется» — не число нового лимита', tryIn(inp.replace('Лимит отмен в месяц изменён (сейчас 5), новый лимит согласован', 'Лимит в 5 отмен в месяц меняется, новое значение не названо')), true)
        ck('3: «Лимит — 5 отмен в месяц» без смены — красный', tryIn(add('Решено', 'Лимит — 5 отмен в месяц.')), false)
        ck('3: «лимит меняется на 4» — красный', tryIn(add('Решено', 'Лимит отмен в месяц меняется на 4.')), false)
        ck('3: «новое значение одно для всех филиалов» — не число', tryIn(add('Решено', 'Лимит отмен в месяц меняется, новое значение одно для всех филиалов.')), true)
      }
    } finally { rmSync(sb, { recursive: true, force: true }) }
  }
  console.log(bad === 0 ? '\nсамопроверка: ok' : `\nсамопроверка: ПРОВАЛОВ ${bad}`)
  process.exit(bad === 0 ? 0 : 1)
}

// ---------- прогон ----------

// Импорт из другого оценщика (grade-ni.mjs) не должен запускать прогон.
const IS_MAIN = !!process.argv[1] && fileURLToPath(import.meta.url) === pathResolve(process.argv[1])
if (IS_MAIN) {
  const arg = process.argv[2]
  if (arg === '--selftest') selftest()
  // Одиночный режим — архив (шапка файла): прогон meeting-intake 1.x из протокола больше не грейдится.
  console.log('grade-mr.mjs: одиночный режим — архив, путь meeting-intake 1.x (вход и разбор из протокола). Протокол по памяти в 2.0 — meeting-recall → список пунктов → notes-to-intent: грейдер `node grade-ni.mjs <каталог> --fx MR-NEW|MR-CHG`. Здесь живы только `gradeNEW` / `gradeCHG` для grade-ni.mjs и `--selftest`.')
  process.exit(2)
}
