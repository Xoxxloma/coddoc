#!/usr/bin/env node
// grade-rv-bug.mjs — приёмка баг-репорта (фикстура RV-BUG, чек-лист checklist-bugreport.md).
//
//   node grade-rv-bug.mjs <каталог с песочницами> --probe=clean|dirty
//   node grade-rv-bug.mjs --selftest
//
// ЧТО ГРЕЙДИТСЯ. `answer.md` — приёмка по правилу НИЧЕГО не пишет на диск, другого артефакта нет.
// Это тот случай, где текст ответа законно является предметом: он и есть выход скилла.
//
// ГЛАВНОЕ ПЛЕЧО — ЧИСТОЕ. У проверяющего инструмента худший отказ не «пропустил», а «покраснел на
// корректном документе»: список, краснящий зря, перестают читать целиком, и вместе с ложными
// находками теряются настоящие. Поэтому у `clean` три отдельных счётчика на предсказуемые ложные
// поводы, а не один общий «нашла лишнее».
//
// ПРАВИЛА РЕПЫ, из-за которых он написан именно так:
//   - регулярки литеральные, из строк не собираются;
//   - `\b` и `\w` рядом с кириллицей НЕ применять: в JS `\w` — только латиница, и граница слова
//     после русской буквы не срабатывает никогда (обожглись на `grade-bg.mjs` 2026-08-18);
//   - отказ API — «не измерено», а не «провалено»;
//   - счётчик на каждый дефект, общего процента нет.

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const RE_API_FAILURE = /API Error|Request not allowed|Please run \/login|Credit balance|rate limit|session limit|usage limit/i

export function isApiFailure (t) {
  if (!t) return true
  if (t.length > 600) return false
  return RE_API_FAILURE.test(t.slice(0, 300))
}

// ВНИМАНИЕ: эхо-строки `чек-лист прочитан, тип: …` в этом артефакте НЕТ и быть не должно.
// Это рукопожатие СУБАГЕНТА с ведущим; в чат уходит отчёт аналитику, где её нет по устройству.
// Первая редакция грейдера её искала и напечатала «чек-лист не открывали» 10/10 на ОБОИХ плечах —
// включая грязное, которое нашло 5,4 нарушения из 6. Анкер мерил не тот артефакт.

/** Метки жирного вокруг подписи обязательны в шаблоне: прогоны пишут `**нарушений:** 0`. */
const RE_ZERO = /\*{0,2}нарушений:?\*{0,2}:?\s*0(?!\d)/i
const RE_COUNT = /\*{0,2}нарушений:?\*{0,2}:?\s*(\d+)/i
/** Оба имени: «утверждений» — общее для набора, «требований» — из первой редакции чек-листа. */
const RE_TALLY = /\*{0,2}(?:утверждений|требований), стоящих только на памяти аналитика:?\*{0,2}:?\s*(\d+)/i

// ─── Ложные поводы, предсказуемые на ЧИСТОМ документе ───────────────────────────────────────

/** Причины дефекта в этой форме нет по устройству; требование её добавить — ложная находка. */
const RE_FP_CAUSE = /причин[аыу][^.\n]{0,60}(не назван|отсутств|нет|не указан)|укажите причин|добавьте причин/i

/** `🟡 со слов аналитика` — норма и самый частый исход, а не находка. */
const RE_FP_YELLOW = /(🔵|🟡|со слов аналитика)[^.\n]{0,80}(нарушен|не подтвержд|требует подтвержд|недопустим)|подтвердит[ье][^.\n]{0,40}(🔵|🟡|со слов)/i

/** «документа нет — со слов аналитика» — это фраза, а не путь; принять её за битую ссылку нельзя. */
const RE_FP_SOURCE = /source[^.\n]{0,60}(битый|не существует|неверный путь|некорректн)|путь[^.\n]{0,40}документа нет/i

// ─── Шесть посаженных нарушений ГРЯЗНОГО документа ──────────────────────────────────────────

const PLANTED = [
  ['source ведёт в несуществующий файл', /ARS-777|source[^.\n]{0,80}(нет|не существу|не найден)/i],
  // «без пометки» — самая частая формулировка отчёта, и первая редакция её не ловила: ждала
  // «нет». Поймано самопроверкой до прогонов.
  ['ожидаемый результат без пометки происхождения', /без пометк|без указания происхожд|(пометк|происхожден)[^.\n]{0,60}(нет|отсутств|не простав)|нет (пометки|🟢|🟡)/i],
  ['ожидаемый результат не нумерован', /FR-[^.\n]{0,60}(нет|отсутств|не нумер)|не нумерован|пронумеруйте/i],
  ['шаги воспроизведения не шаги', /шаг[^.\n]{0,80}(проз|не нумерован|нет нумерац)|раздел[^.\n]{0,40}прозой/i],
  ['раздел «Фактический результат» пуст', /фактический результат[^.\n]{0,60}(пуст|не заполн)|пуст[^.\n]{0,60}фактический/i],
  ['число в статусе не сходится', /\(3\)|стату[сa][^.\n]{0,80}(не сход|не совпад)|в блоке[^.\n]{0,30}1 пункт/i],
]

/** Ловушка: пункт 6 чек-листа намеренно чист — значение статуса законное, неверно только число. */
const RE_TRAP_VOCAB = /словар|Готово к разработке|недопустимое значение статуса|статус вне/i

export function gradeRun (dir, probe) {
  const r = { dir, probe, measured: true, why: '' }
  const p = join(dir, 'answer.md')
  const a = existsSync(p) ? readFileSync(p, 'utf8') : ''
  if (existsSync(join(dir, '_escaped.txt'))) { r.measured = false; r.why = 'побег из песочницы'; return r }
  if (isApiFailure(a)) { r.measured = false; r.why = 'отказ API'; return r }

  r.echo = true // эхо-строки в отчёте аналитику нет по устройству — см. комментарий выше
  const m = RE_COUNT.exec(a)
  r.declared = m ? Number(m[1]) : null
  r.zero = RE_ZERO.test(a)
  const t = RE_TALLY.exec(a)
  r.tally = t ? Number(t[1]) : null

  if (probe === 'clean') {
    r.fpCause = RE_FP_CAUSE.test(a)
    r.fpYellow = RE_FP_YELLOW.test(a)
    r.fpSource = RE_FP_SOURCE.test(a)
    r.pass = r.echo && r.zero
  } else {
    r.found = PLANTED.filter(([, re]) => re.test(a)).map(([n]) => n)
    r.trap = RE_TRAP_VOCAB.test(a)
    r.pass = r.echo && r.found.length >= 5 && !r.trap
  }
  return r
}

// ─── Самопроверка ───────────────────────────────────────────────────────────────────────────
// Валидируется до прогонов на двух заведомо известных отчётах: безупречном и полном находок.

const REF_CLEAN = `чек-лист прочитан, тип: баг-репорт
артефакт: coddoc/ARS-312/bug_report.md
нарушений: 0

требований, стоящих только на памяти аналитика: 1`

const REF_DIRTY = `чек-лист прочитан, тип: баг-репорт
артефакт: coddoc/ARS-411/bug_report.md
нарушений: 6

1. Шапка, строка 4 — source указывает на файл, которого нет
   «source: coddoc/ARS-777/technical_specification.md»
   → Файла по этому пути нет.
2. Раздел 4, строка 22 — ожидаемый результат без пометки происхождения
   «Должно работать так: в выгруженном файле те же строки»
   → Проставьте пометку.
3. Раздел 4, строка 22 — ожидаемый результат не нумерован
   → Пронумеруйте как FR-1.
4. Раздел 2, строка 16 — шаги воспроизведения написаны прозой
   → Разложите на нумерованные действия.
5. Раздел 3, строка 19 — Фактический результат пуст
   → Заполните.
6. Шапка, строка 8 — число в статусе не сходится: в блоке 1 пункт, в статусе (3)
   → Перепишите число.

требований, стоящих только на памяти аналитика: 0`

function selftest () {
  let bad = 0
  const ck = (n, got, want) => {
    const ok = got === want
    if (!ok) bad++
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${n}: ${got} (ожидалось ${want})`)
  }
  ck('жирная подпись не мешает вердикту', RE_ZERO.test('**нарушений:** 0'), true)
  ck('жирная подпись не мешает счётной строке', Number(RE_TALLY.exec('**утверждений, стоящих только на памяти аналитика:** 1')[1]), 1)
  ck('старое имя счётной строки тоже ловится', Number(RE_TALLY.exec('требований, стоящих только на памяти аналитика: 2')[1]), 2)
  ck('чистый: нарушений 0', RE_ZERO.test(REF_CLEAN), true)
  ck('грязный: нарушений НЕ 0', RE_ZERO.test(REF_DIRTY), false)
  ck('счётная строка чистого', Number(RE_TALLY.exec(REF_CLEAN)[1]), 1)

  const found = PLANTED.filter(([, re]) => re.test(REF_DIRTY)).map(([n]) => n)
  ck('найдено посаженных из 6', found.length, 6)
  for (const [n] of PLANTED) if (!found.includes(n)) console.log(`        не поймано: ${n}`)

  ck('ловушка словаря на верном отчёте молчит', RE_TRAP_VOCAB.test(REF_DIRTY), false)
  ck('чистый: ложный повод «нет причины» молчит', RE_FP_CAUSE.test(REF_CLEAN), false)
  ck('чистый: ложный повод про 🟡 молчит', RE_FP_YELLOW.test(REF_CLEAN), false)
  ck('чистый: ложный повод про source молчит', RE_FP_SOURCE.test(REF_CLEAN), false)

  ck('ловится «нет причины»', RE_FP_CAUSE.test('Причина дефекта не названа — укажите причину'), true)
  ck('ловится придирка к 🟡', RE_FP_YELLOW.test('Пометка 🟡 недопустима без подтверждения'), true)
  ck('ловится придирка к source', RE_FP_SOURCE.test('source битый: путь не существует'), true)
  ck('ловится ловушка словаря', RE_TRAP_VOCAB.test('Статус вне словаря: значение недопустимо'), true)

  ck('отказ API', isApiFailure('API Error: Request not allowed'), true)
  ck('длинный текст со словом rate limit — не отказ', isApiFailure('x'.repeat(700) + ' rate limit'), false)

  console.log(bad === 0 ? '\nсамопроверка: ok' : `\nсамопроверка: ПРОВАЛОВ ${bad}`)
  return bad === 0
}

// ─── Точка входа ────────────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
if (argv.includes('--selftest')) process.exit(selftest() ? 0 : 1)

const root = argv.find((x) => !x.startsWith('--'))
const pa = argv.find((x) => x.startsWith('--probe='))
const PROBE = pa ? pa.slice('--probe='.length) : ''

if (!root || !['clean', 'dirty'].includes(PROBE)) {
  console.error('usage: node grade-rv-bug.mjs <каталог> --probe=clean|dirty')
  console.error('       node grade-rv-bug.mjs --selftest')
  process.exit(1)
}
if (!existsSync(root)) { console.error(`нет каталога: ${root}`); process.exit(1) }

const runs = readdirSync(root, { withFileTypes: true })
  .filter((e) => e.isDirectory() && /^run-\d+$/.test(e.name))
  .map((e) => join(root, e.name))
  .sort()

if (runs.length === 0) { console.error(`в ${root} нет папок run-NN`); process.exit(1) }

const all = runs.map((d) => gradeRun(d, PROBE))
const ok = all.filter((r) => r.measured)
const N = ok.length
const c = (f) => ok.filter(f).length
const pct = (n) => `${String(n).padStart(2)}/${N}`

console.log(`\nпроба rv-bug-${PROBE}, ${root}`)
console.log(`прогонов: ${all.length}, измерено: ${N}, не измерено: ${all.length - N}`)
for (const r of all.filter((x) => !x.measured)) console.log(`  НЕ ИЗМЕРЕНО ${r.dir}: ${r.why}`)
console.log('')

if (PROBE === 'clean') {
  console.log(`  ${pct(c((r) => !r.zero))}\tЛОЖНОЕ СРАБАТЫВАНИЕ: нашла нарушение на чистом  ← КРИТЕРИЙ`)
  console.log(`  ${pct(c((r) => r.fpCause))}\t  из них: потребовала причину дефекта — её в форме нет`)
  console.log(`  ${pct(c((r) => r.fpYellow))}\t  из них: назвала 🟡 «со слов аналитика» нарушением`)
  console.log(`  ${pct(c((r) => r.fpSource))}\t  из них: приняла «документа нет» за битый путь`)
  console.log(`  ${pct(c((r) => !r.echo))}\tчек-лист не открывали — нет эхо-строки`)
  console.log(`  ${pct(c((r) => r.tally !== 1))}\tсчётная строка не равна 1`)
  console.log(`  ${pct(c((r) => r.pass))}\tзелёных`)
} else {
  const avg = N ? (ok.reduce((s, r) => s + (r.found?.length ?? 0), 0) / N).toFixed(1) : '—'
  console.log(`  найдено посаженных, в среднем: ${avg} из 6\n`)
  for (const [n] of PLANTED) console.log(`  ${pct(c((r) => r.found?.includes(n)))}\t${n}`)
  console.log('')
  console.log(`  ${pct(c((r) => r.trap))}\tЛОВУШКА: названо нарушение словаря статуса, которого нет  ← КРИТЕРИЙ`)
  console.log(`  ${pct(c((r) => !r.echo))}\tчек-лист не открывали`)
  console.log(`  ${pct(c((r) => r.pass))}\tзелёных`)
}
console.log('')
