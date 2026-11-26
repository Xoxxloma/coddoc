#!/usr/bin/env node
// grade-bfx-rv.mjs — пробы rv-bfx-* (скилл: spec-review, reference/checklist-spec.md), фикстура BFX-DOWN.
//
//   node grade-bfx-rv.mjs <каталог плеча> --case=clean|nomark|was|nosrc
//   node grade-bfx-rv.mjs --selftest
//
// Спека на багфикс, починка меняет контракт: одна карточка «изменение существующего», стык 🔵 «по документу сверху»,
// рядом `bug_report.md` — источник требований (spec-review/SKILL.md:81-82: «его нет, но лежит bug_report.md →
// источник репорт»). Грейдится отчёт хода 1 (answer.md) и поток вызовов (передан ли репорт субагенту).
//
//   clean  (MTR-512) — ложных пунктов нет:
//     §1  — под 🟡 ничего нет (checklist-spec.md:25-31);
//     §3  — FR-1 есть в §7 и в «Трассировке» INT-1 (checklist-spec.md:62-75);
//     §7  — путь стоит в строке «Существующий стык», «ищи и там» (checklist-spec.md:138-139);
//     §13 — «Вид», стык с меткой, таблица «было → стало» есть, стык 🔵 (checklist-spec.md:248-259);
//     §14 — у 🔵 стыка источник «по документу сверху» — один из четырёх названных (checklist-spec.md:269-272);
//     счётная строка = 0: «со слов» с путём или полем у карточки и стыка нет, а документ сверху — названный
//       источник (checklist-spec.md:286-294);
//     источник передан: bug_report.md в промпте субагента (spec-review/SKILL.md:91-93) — без него §3 молчал бы
//       по построению, и «ложного §3 нет» было бы пустым.
//   nomark (MTR-514) — у строки «Существующий стык» нет метки → найдено (checklist-spec.md:255).
//   was    (MTR-515) — стык 🟡, а в «было» у capacity значение → найдено (checklist-spec.md:256-259; заодно §1 :26-28).
//   nosrc  (MTR-516) — у 🔵 стыка с путём и полями нет источника → найдено (checklist-spec.md:274-275).
// Прочие пункты отчёта — справкой.
//
// ПРАВИЛА РЕПЫ: `\b` рядом с кириллицей не применять (в JS граница слова — только латиница).

import { readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { turn, apiFailed } from './br-lib.mjs'

/**
 * Пункты отчёта: строка «N. …» и продолжение С ОТСТУПОМ (форма — spec-review/SKILL.md:140-163). Первая непустая строка
 * без отступа закрывает пункт. Логика — как items() в grade-rv-blue.mjs (там и разбор, почему); скопирована, потому что
 * модуль grade-rv-blue.mjs исполняет CLI при импорте.
 */
const RE_ITEM = /^\s*\d+\.\s/
const RE_COUNT = /стоящих только на|нарушений:/i
export function items (answer) {
  const out = []
  let cur = null
  let gap = ''
  for (const l of answer.split('\n')) {
    if (RE_ITEM.test(l)) { if (cur) out.push(cur); cur = l; gap = ''; continue }
    if (cur === null) continue
    if (!l.trim()) { gap += '\n'; continue }
    if (/^\s/.test(l) && !RE_COUNT.test(l)) { cur += gap + '\n' + l; gap = ''; continue }
    out.push(cur); cur = null; gap = ''
  }
  if (cur) out.push(cur)
  return out
}

// Пункты чек-листа по содержанию: ведущий не обязан писать номер пункта, а имя пункта — пишет.
const R1 = /к\s+валидации|под\s+(?:меткой\s+)?«?🟡/i
const R3 = /FR-1(?!\d)[^\n]{0,120}(без\s+контракт|без\s+критери|не\s+назван|не\s+покрыт|не\s+трассир|не\s+встречает)|требовани[ея]\s+без\s+(контракта|критерия)|взаимодействие\s+без\s+FR|не\s+называет\s+ни\s+одного\s+FR/i
const R7 = /без\s+транспорта|нет\s+(ни\s+)?(метода|пути)|метод\s+и\s+путь/i
const R13 = /(^|[^а-яё])Вид([^а-яё]|$)|Существующ[а-яё]*\s+стык|«было»|колонк[а-яё]*\s+«?было|было\s*(→|->)\s*стало|таблиц[а-яё]*\s+изменени/i
const R14 = /источник[а-яё]*[^\n]{0,60}(метк|🔵)|(метк|🔵)[^\n]{0,60}источник|без\s+источник/i

export function grade (answer, kase, stream) {
  const its = items(answer)
  const v = answer.match(/нарушений:?\**:?\s*\**\s*(\d+)/i)
  const c = answer.match(/стоящих только на памяти аналитика:\s*\**\s*(\d+)/i)
  const m = {}
  if (kase === 'clean') {
    const by = (re) => its.filter((b) => re.test(b))
    m['нет ложного §1'] = by(R1).length === 0
    m['нет ложного §3 (FR-1 без контракта/критерия)'] = by(R3).length === 0
    m['нет ложного §7 у карточки изменения'] = by(R7).length === 0
    m['нет ложного §13'] = by(R13).length === 0
    m['нет ложного §14 (документ сверху — источник)'] = by(R14).length === 0
    m['счётная строка = 0'] = !!c && Number(c[1]) === 0
    m['источник передан: bug_report.md'] = srcPassed(stream, answer)
    m._other = its.filter((b) => ![R1, R3, R7, R13, R14].some((re) => re.test(b)))
  } else if (kase === 'nomark') {
    m['найдено: стык без метки'] = its.some((b) => /стык|\/v1\/rooms/i.test(b) && /метк|пометк|происхожд/i.test(b))
    m._other = its.filter((b) => !/стык|\/v1\/rooms/i.test(b))
  } else if (kase === 'was') {
    m['найдено: «было» на 🟡-основе'] = its.some((b) => (/было/i.test(b) || /прежн[а-яё]*\s+пол/i.test(b)) && /capacity|🟡/i.test(b))
    m._other = its.filter((b) => !/было|прежн[а-яё]*\s+пол/i.test(b))
  } else {
    m['найдено: 🔵 стыка без источника'] = its.some((b) => /источник/i.test(b) && /стык|\/v1\/rooms|INT-1(?!\d)|🔵/i.test(b))
    m._other = its.filter((b) => !/источник/i.test(b))
  }
  m._viol = v ? Number(v[1]) : null
  m._count = c ? Number(c[1]) : null
  return m
}

/** Репорт ушёл субагенту: Agent/Task-вызов ведущего, в промпте которого есть bug_report.md. Нет потока — по отчёту. */
export function srcPassed (stream, answer) {
  if (!stream) return /bug_report\.md/.test(answer || '')
  for (const line of stream.split('\n')) {
    if (!line.includes('tool_use')) continue
    let o; try { o = JSON.parse(line) } catch { continue }
    const content = o?.message?.content
    if (!Array.isArray(content)) continue
    for (const x of content) {
      if (x?.type === 'tool_use' && ['Agent', 'Task'].includes(x.name) && /bug_report\.md/.test(JSON.stringify(x.input || {}))) return true
    }
  }
  return false
}

function selftest () {
  let f = 0
  const ok = (name, cond) => { console.log(`  ${cond ? '✅' : '❌'} ${name}`); if (!cond) f++ }
  const crit = (g) => Object.entries(g).filter(([k]) => !k.startsWith('_'))
  const allOk = (g) => crit(g).every(([, v]) => v)
  const failing = (g) => crit(g).filter(([, v]) => !v).map(([k]) => k)
  const streamWith = (txt) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Agent', input: { prompt: txt } }] } })
  const SRC = streamWith('Прочитай чек-лист …/checklist-spec.md и проверь по нему файл /x/coddoc/MTR-512/technical_specification.md.\nИсточник требований: /x/coddoc/MTR-512/bug_report.md.')
  const NOSRC = streamWith('Источник требований: не передан — проверяй файл сам по себе.')
  const clean0 = 'артефакт: coddoc/MTR-512/technical_specification.md\nтип: тех-спецификация\nнарушений: 0\n\nнарушений записанных правил нет; это не значит, что решение верное — содержание проверяет аналитик.\n\nутверждений, стоящих только на памяти аналитика: 0\n'
  ok('clean: пустой отчёт, источник передан — зелёный', allOk(grade(clean0, 'clean', SRC)))
  ok('clean: источник не передан — красный только по источнику', failing(grade(clean0, 'clean', NOSRC)).join() === 'источник передан: bug_report.md')
  ok('clean: потока нет, путь репорта в отчёте — источник засчитан', grade(clean0 + '\nИсточник: coddoc/MTR-512/bug_report.md\n', 'clean', null)['источник передан: bug_report.md'])
  ok('clean: счётная строка 1 — красный', !grade(clean0.replace('аналитика: 0', 'аналитика: 1'), 'clean', SRC)['счётная строка = 0'])
  ok('clean: счётной строки нет — красный', !grade('нарушений: 0\n', 'clean', SRC)['счётная строка = 0'])
  const one = (txt) => 'нарушений: 1\n\n' + txt + '\n\nутверждений, стоящих только на памяти аналитика: 0\n'
  const fp14 = one('1. §2 INT-1, строка 41 — конкретика под 🔵 без источника в метке\n   «`GET /v1/rooms` … — 🔵 подтверждено аналитиком (по документу сверху; …)»\n   → Укажите в метке, откуда путь и поля.')
  ok('clean: ложный §14 пойман', failing(grade(fp14, 'clean', SRC)).includes('нет ложного §14 (документ сверху — источник)'))
  const fp7 = one('1. §2 INT-1, строка 38 — карточка 🟢 без транспорта\n   «- **Контракт (запрос):** без изменений.»\n   → Назовите метод и путь либо имя события.')
  ok('clean: ложный §7 пойман', failing(grade(fp7, 'clean', SRC)).join() === 'нет ложного §7 у карточки изменения')
  const fp3 = one('1. §7 — FR-1 не назван ни в одной INT-карточке (требование без контракта)\n   «| FR-1 | INT-1; §4.2 |»\n   → Вернитесь в technical-spec-doc.')
  ok('clean: ложный §3 пойман', failing(grade(fp3, 'clean', SRC)).includes('нет ложного §3 (FR-1 без контракта/критерия)'))
  const fp13 = one('1. §2 INT-1, строка 42 — у изменения нет таблицы «было → стало»\n   «- **Изменение:**»\n   → Добавьте таблицу.')
  ok('clean: ложный §13 пойман', failing(grade(fp13, 'clean', SRC)).includes('нет ложного §13'))
  const fp1 = one('1. §2 INT-1 — конкретика под меткой «🟡 к валидации»\n   «`GET /v1/rooms`»\n   → Подтвердите путь.')
  ok('clean: ложный §1 пойман', failing(grade(fp1, 'clean', SRC)).includes('нет ложного §1'))
  const other = one('1. §6.4, строка 104 — неприменимый пункт оформлен неверно\n   «- ~~**Откат только FE**: не применимо — фронт не меняется~~»\n   → `~~` захватывает служебную разметку — зачеркните только текст.')
  ok('clean: пункт §11 — справкой, не в критерии', allOk(grade(other, 'clean', SRC)) && grade(other, 'clean', SRC)._other.length === 1)
  // «было бы» в рекомендации не делает пункт пунктом §13
  const wouldBe = one('1. §6.4, строка 104 — неприменимый пункт оформлен неверно\n   «~~…~~»\n   → Чтобы было видно, что пункт неприменим, зачеркните текст целиком.')
  ok('clean: «чтобы было видно» не считается §13', grade(wouldBe, 'clean', SRC)['нет ложного §13'])
  ok('nomark: найдено', grade(one('1. §2 INT-1, строка 41 — у строки «Существующий стык» нет метки\n   «- **Существующий стык:** `GET /v1/rooms`, …»\n   → Поставьте 🔵 с источником или 🟡.'), 'nomark')['найдено: стык без метки'])
  ok('nomark: пустой отчёт — красный', !grade('нарушений: 0\n', 'nomark')['найдено: стык без метки'])
  ok('was: найдено по «было»', grade(one('1. §2 INT-1, строка 46 — «было» у поля на 🟡-основе\n   «| `capacity` | … | `string`, `"12"` | `integer`, `12` |»\n   → Прежнее поле аналитик не подтвердил.'), 'was')['найдено: «было» на 🟡-основе'])
  ok('was: найдено по §1 «прежнее поле»', grade(one('1. §2 INT-1, строка 53 — прежнее поле в примере под 🟡\n   «{ "capacity": 12 }»\n   → Уберите.'), 'was')['найдено: «было» на 🟡-основе'])
  ok('was: пустой отчёт — красный', !grade('нарушений: 0\n', 'was')['найдено: «было» на 🟡-основе'])
  ok('nosrc: найдено', grade(one('1. §2 INT-1, строка 41 — конкретика под 🔵 без источника в метке\n   «`GET /v1/rooms` … — 🔵 подтверждено аналитиком (валидировать при интеграции)»\n   → Укажите источник.'), 'nosrc')['найдено: 🔵 стыка без источника'])
  ok('nosrc: «источник» только в абзаце после списка — не засчитан', !grade('нарушений: 1\n\n1. §6.4 — оформление\n   «~~…~~»\n\nИсточник требований: coddoc/MTR-516/bug_report.md.\n\nутверждений, стоящих только на памяти аналитика: 0\n', 'nosrc')['найдено: 🔵 стыка без источника'])
  console.log(`самопроверка: ${f ? 'провалов ' + f : '✓'}`)
  return f
}

if (process.argv.includes('--selftest')) process.exit(selftest() ? 1 : 0)
const CASES = ['clean', 'nomark', 'was', 'nosrc']
const arg = process.argv[2]
const kase = (process.argv.find((a) => a.startsWith('--case=')) || '').slice(7)
if (!arg || !existsSync(arg) || !CASES.includes(kase)) { console.error('usage: node grade-bfx-rv.mjs <каталог плеча> --case=clean|nomark|was|nosrc | --selftest'); process.exit(1) }
const runs = readdirSync(arg).filter((n) => /^run-\d+$/.test(n) && statSync(join(arg, n)).isDirectory()).sort()
console.log(`\nпроба rv-bfx-${kase}, ${arg}`)
let measured = 0; let green = 0
const fails = {}
for (const n of runs) {
  const dir = join(arg, n)
  const t1 = turn(dir, 1)
  if (apiFailed(dir, [t1.answer])) { console.log(`  ${n}: НЕ ИЗМЕРЕНО`); continue }
  measured++
  const g = grade(t1.answer || '', kase, t1.stream)
  const bad = Object.entries(g).filter(([k, v]) => !k.startsWith('_') && !v).map(([k]) => k)
  for (const b of bad) fails[b] = (fails[b] || 0) + 1
  if (!bad.length) green++
  console.log(`  ${n}: ${bad.length ? 'красный' : 'зелёный'} · нарушений ${g._viol ?? '?'} · на памяти ${g._count ?? '?'}${bad.length ? '  ✗ ' + bad.join(' · ') : ''}`)
  for (const o of g._other.slice(0, 4)) console.log(`        прочее: ${o.split('\n')[0].trim().slice(0, 120)}`)
}
console.log(`\n  по признакам (прогонов с промахом): ${Object.entries(fails).map(([k, v]) => `${k} ${v}`).join('; ') || 'нет'}`)
console.log(`  ${green}/${measured}\tзелёных  ← КРИТЕРИЙ\n`)
