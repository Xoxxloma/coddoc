#!/usr/bin/env node
// grade-sq.mjs — проба `sq-audit`: скилл `sdd-quality-audit` на фикстуре SQ-AUDIT.
//
//   node grade-sq.mjs <каталог с песочницами run-NN>
//   node grade-sq.mjs --selftest
//
// ЧТО МЕРЯЕТСЯ. Скилл обходит `coddoc/` из одиннадцати фич и пишет `sdd-quality-report.md` в корень песочницы.
// Грейдится ФАЙЛ на диске, а не пересказ в чате. Эталон и смысл каждой фичи — `fixtures/SQ-AUDIT/README.md`.
//
// Проверки:
//   отчёт      — файл `sdd-quality-report*.md` в корне песочницы
//   docs       — в `coddoc/` ничего не создано и не изменено
//   строки     — у каждой из одиннадцати папок своя строка сводной таблицы
//   н/п        — колонки «н/п: баг-репорт», «н/п: узел-фундамент», «спеки нет» там, где должны
//   счёт       — сумма частей = итог, максимум = веса применимых критериев, процент = округление
//   хорошая    — PSS-2210: БТ ≥ 4.0, спека ≥ 4.5
//   версия     — PSS-2211 (новый шаблон) ≥ 4.0 и отличается от PSS-2210 (старый) не больше чем на 0.5
//   частичная  — PSS-2212: БТ крит. 4 ≤ 0.5; в спеке снижено хоть в одной посаженной дыре (2, 3, 5)
//                и ни в одной непосаженной (1, 4); обе ≥ 50%
//   протыкано  — PSS-2213: БТ и спека < 50% и «шаблонно» у обоих
//   багфикс    — ARS-312: спека ≥ 80%, н/п не меньше двух из крит. 2, 3, 5
//   фундамент  — ARS-100/_foundation: крит. 1 спеки — н/п
//   внимание   — в «Требуют внимания» есть PSS-2213, PSS-2214, PSS-2215, PSS-2216 и нет PSS-2210/2211/2212, ARS-312
//   флаг       — «шаблонно» только у PSS-2213 (заглушки эпика не проверяются)
//   форма      — «не по форме» у БТ PSS-2214 (свободная форма) и не у его спеки (нет 4 из 23, 17%);
//                у PSS-2210 (старый шаблон), PSS-2211, PSS-2212, PSS-2213, ARS-312 — «нет»
//                спеки PSS-2215 (по коду) и PSS-2216 (правлена руками) — «не по форме»
//   свободная  — PSS-2214: БТ ≥ 4.0 — тот же текст, что у PSS-2211; форма баллы не снижает
//   по коду    — происхождение «по коду» у PSS-2215 и ни у одной другой спеки
//   правлена   — PSS-2216 «скилл, правлена руками»; PSS-2210/2212/2213/2214, ARS-312 — «скилл»
//   без источника — PSS-2215 (рядом нет документа сверху): БТ «нет», крит. 1 спеки = 0, а не н/п
//   детали     — в «Деталях» только подсвеченные: PSS-2213 и PSS-2214 есть, у PSS-2214 — только ответ по
//                БТ (его спека по форме), у PSS-2216 — только по спеке; PSS-2210/2211/2212, ARS-312 нет;
//                эхо-строк «рубрика прочитана» нет
//
// Правила репы: песочница без ответа или с отказом API — «НЕ ИЗМЕРЕНО»; регулярки литеральные,
// `\b`/`\w` рядом с кириллицей не применяются.

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE_DOCS = join(HERE, 'fixtures', 'SQ-AUDIT', 'coddoc')
// Документы, у которых форма шаблона цела: в колонке «не по форме» у них «нет».
const IN_FORM = ['PSS-2210', 'PSS-2211', 'PSS-2212', 'PSS-2213', 'ARS-312']
// Спеки, написанные скиллом и не тронутые руками: происхождение у них «скилл».
const BY_SKILL = ['PSS-2210', 'PSS-2212', 'PSS-2213', 'PSS-2214', 'ARS-312']
const RE_API_FAILURE = /API Error|Request not allowed|Please run \/login|Credit balance|rate limit|session limit|usage limit/i
const W_BT = [0.5, 1, 1, 1, 1]
const W_SPEC = [1, 1, 1, 1, 1]

// Ключ строки — по пути документа в ячейках; порядок важен: специфичное раньше общего.
const ROW_KEYS = [
  ['FND', '_foundation'],
  ['ARS-101', 'ARS-101'],
  ['ARS-312', 'ARS-312'],
  ['PSS-2210', 'PSS-2210'],
  ['PSS-2211', 'PSS-2211'],
  ['PSS-2212', 'PSS-2212'],
  ['PSS-2213', 'PSS-2213'],
  ['PSS-2214', 'PSS-2214'],
  ['PSS-2215', 'PSS-2215'],
  ['PSS-2216', 'PSS-2216'],
  ['EPIC', 'ARS-100']
]

function walk (dir) {
  const out = []
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) out.push(...walk(p)); else out.push(p)
  }
  return out
}

/** Ячейка оценки: «0.5+1+н/п+1+1 = 3.5 из 4.5 (78%)» → части, итог, максимум, процент. */
export function parseScore (cell) {
  const m = cell.match(/^(.*?)=\s*([\d.,]+)\s*из\s*([\d.,]+)\s*\(\s*(\d+)\s*%\s*\)/)
  if (!m) return null
  const num = (x) => Number(x.replace(',', '.'))
  const parts = m[1].split('+').map((x) => x.trim()).filter(Boolean).map((x) => (x.includes('н/п') ? null : num(x)))
  if (parts.some((x) => x !== null && Number.isNaN(x))) return null
  return { parts, sum: num(m[2]), max: num(m[3]), pct: Number(m[4]) }
}

export function arithmeticOk (sc, weights) {
  if (!sc || sc.parts.length !== weights.length) return false
  const sum = sc.parts.reduce((a, x) => a + (x ?? 0), 0)
  const max = weights.reduce((a, w, i) => a + (sc.parts[i] === null ? 0 : w), 0)
  if (Math.abs(sum - sc.sum) > 0.01 || Math.abs(max - sc.max) > 0.01) return false
  if (sc.parts.some((x, i) => x !== null && (x < 0 || x > weights[i] + 0.001))) return false
  return max === 0 || Math.abs(Math.round((sum / max) * 100) - sc.pct) <= 1
}

/** Сводная таблица: заголовок с колонками «фича» и «jira», дальше строки с `|`. */
export function parseTable (text) {
  const lines = text.split(/\r?\n/)
  const hi = lines.findIndex((l) => l.trim().startsWith('|') && /фича/i.test(l) && /jira/i.test(l))
  if (hi < 0) return null
  const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
  const head = cells(lines[hi]).map((c) => c.toLowerCase())
  const col = (re) => head.findIndex((h) => re.test(h))
  const idx = {
    bt: head.findIndex((h) => h === 'бт'),
    btScore: col(/^бт оценка/),
    spec: head.findIndex((h) => h === 'спека'),
    specScore: col(/^спек[аи]? оценка/),
    flag: col(/шаблонно/),
    form: col(/не по форме/),
    origin: col(/происхождение/)
  }
  const rows = {}
  for (let i = hi + 2; i < lines.length && lines[i].trim().startsWith('|'); i++) {
    const c = cells(lines[i])
    const joined = c.join(' ')
    const key = ROW_KEYS.find(([, needle]) => joined.includes(needle))
    if (!key || rows[key[0]]) continue
    rows[key[0]] = {
      bt: c[idx.bt] ?? '', btScore: c[idx.btScore] ?? '', spec: c[idx.spec] ?? '',
      specScore: c[idx.specScore] ?? '', flag: c[idx.flag] ?? '', form: idx.form < 0 ? '' : (c[idx.form] ?? ''),
      origin: idx.origin < 0 ? '' : (c[idx.origin] ?? '')
    }
  }
  return rows
}

function section (text, title) {
  const i = text.indexOf(`## ${title}`)
  if (i < 0) return null
  const rest = text.slice(i + title.length + 3)
  const j = rest.search(/\n## /)
  return j < 0 ? rest : rest.slice(0, j)
}

export function gradeReport (text) {
  const ck = {}
  const rows = parseTable(text) || {}
  const need = ROW_KEYS.map(([k]) => k)
  ck['строки'] = need.every((k) => rows[k])
  const r = (k) => rows[k] || { bt: '', btScore: '', spec: '', specScore: '', flag: '', form: '', origin: '' }
  ck['н/п'] = /спеки нет/i.test(r('PSS-2211').specScore + r('PSS-2211').spec) &&
    /н\/п[^|]*баг/i.test(r('ARS-312').btScore + r('ARS-312').bt) &&
    /н\/п[^|]*фундамент/i.test(r('FND').btScore + r('FND').bt) &&
    /спеки нет/i.test(r('EPIC').specScore + r('EPIC').spec)
  const sc = {}
  for (const k of need) {
    sc[k] = { bt: parseScore(r(k).btScore), spec: parseScore(r(k).specScore) }
  }
  const scored = []
  for (const k of need) {
    if (sc[k].bt) scored.push(arithmeticOk(sc[k].bt, W_BT))
    if (sc[k].spec) scored.push(arithmeticOk(sc[k].spec, W_SPEC))
  }
  ck['счёт'] = scored.length >= 10 && scored.every(Boolean)
  const btS = (k) => sc[k].bt?.sum ?? -1
  const spS = (k) => sc[k].spec?.sum ?? -1
  const pct = (x) => x?.pct ?? -1
  const part = (x, i) => (x ? x.parts[i] : undefined)
  ck['хорошая'] = btS('PSS-2210') >= 4.0 && spS('PSS-2210') >= 4.5
  ck['версия'] = btS('PSS-2211') >= 4.0 && btS('PSS-2210') >= 0 && Math.abs(btS('PSS-2210') - btS('PSS-2211')) <= 0.5
  const p12b = sc['PSS-2212'].bt; const p12s = sc['PSS-2212'].spec
  // Роли БТ (крит. 5) не проверяются: исполнитель отзыва в фикстуре угадывается по тексту, и 1 по правилу
  // «между 0.5 и 1 — старший» законен. В спеке три посаженные дыры на границе 0.5/1 (данные одной строкой,
  // роли только в UI, без примеров у части карточек): требуется, чтобы снижение попало хотя бы в одну из
  // них и ни одно — в непосаженные (1 и 4). Какая именно дожата до 0.5 — печатается отдельно.
  const planted = p12s ? [1, 2, 4].filter((i) => p12s.parts[i] !== null && p12s.parts[i] <= 0.5).length : 0
  const offTarget = p12s ? [0, 3].some((i) => p12s.parts[i] !== null && p12s.parts[i] < 1) : true
  ck['частичная'] = !!p12b && !!p12s && part(p12b, 3) !== null && part(p12b, 3) <= 0.5 &&
    planted >= 1 && !offTarget && pct(p12b) >= 50 && pct(p12s) >= 50
  const f13 = r('PSS-2213').flag
  ck['протыкано'] = pct(sc['PSS-2213'].bt) >= 0 && pct(sc['PSS-2213'].bt) < 50 && pct(sc['PSS-2213'].spec) >= 0 && pct(sc['PSS-2213'].spec) < 50 &&
    /БТ/.test(f13) && /спек/i.test(f13)
  const bug = sc['ARS-312'].spec
  ck['багфикс'] = !!bug && bug.pct >= 80 && [1, 2, 4].filter((i) => bug.parts[i] === null).length >= 2
  ck['фундамент'] = !!sc.FND.spec && sc.FND.spec.parts[0] === null
  const att = section(text, 'Требуют внимания') || ''
  ck['внимание'] = ['PSS-2213', 'PSS-2214', 'PSS-2215', 'PSS-2216'].every((k) => att.includes(k)) &&
    !['PSS-2210', 'PSS-2211', 'PSS-2212', 'ARS-312'].some((k) => att.includes(k))
  ck['флаг'] = ['PSS-2210', 'PSS-2211', 'PSS-2212', 'ARS-312', 'PSS-2214', 'PSS-2215', 'PSS-2216'].every((k) => /нет/i.test(r(k).flag))
  const f14 = r('PSS-2214').form; const f16 = r('PSS-2216').form
  ck['форма'] = /БТ/.test(f14) && !/спек/i.test(f14) && IN_FORM.every((k) => /^нет\.?$/i.test(r(k).form.trim())) &&
    /спек/i.test(r('PSS-2215').form) && /спек/i.test(f16) && !/БТ/.test(f16)
  const org = (k) => r(k).origin.trim().toLowerCase()
  ck['по коду'] = /по коду/.test(org('PSS-2215')) && ![...BY_SKILL, 'PSS-2216'].some((k) => /по коду/.test(org(k)))
  ck['правлена'] = /правлен/.test(org('PSS-2216')) && BY_SKILL.every((k) => /^скилл\.?$/.test(org(k)))
  const s15 = sc['PSS-2215'].spec
  ck['без источника'] = !!s15 && s15.parts[0] === 0 && /^нет/i.test((r('PSS-2215').bt || r('PSS-2215').btScore).trim())
  ck['свободная'] = btS('PSS-2214') >= 4.0
  const det = section(text, 'Детали') || ''
  // Подраздел на строку или по подразделу на документ («PSS-2213 (БТ)», «PSS-2213 (спека)») — склеиваем по ключу.
  const sub = (key) => det.split(/\n(?=### )/).filter((s) => s.split('\n')[0].includes(key)).join('\n')
  ck['детали'] = /Цель *—/.test(sub('PSS-2213')) && /Функционал из источника *—/.test(sub('PSS-2213')) &&
    /Цель *—/.test(sub('PSS-2214')) && !/Функционал из источника *—/.test(sub('PSS-2214')) &&
    /Функционал из источника *—/.test(sub('PSS-2216')) && !/Цель *—/.test(sub('PSS-2216')) &&
    !['PSS-2210', 'PSS-2211', 'PSS-2212', 'ARS-312'].some((k) => det.includes(k)) && !/рубрика прочитана/i.test(text)
  const p12 = p12s ? `данные ${p12s.parts[1]} роли ${p12s.parts[2]} контракты ${p12s.parts[4]}` : '-'
  const forms = ['PSS-2214', 'PSS-2215', 'PSS-2216', ...IN_FORM].map((k) => `${k}: ${r(k).form || '-'}`).join('; ') +
    '  происхождение: ' + ['PSS-2215', 'PSS-2216', ...BY_SKILL].map((k) => `${k}: ${r(k).origin || '-'}`).join('; ')
  return { ck, sc, p12, forms }
}

function gradeOne (dir, seeded) {
  const ans = join(dir, 'answer.md')
  if (!existsSync(ans)) return { measured: false, why: 'нет answer.md' }
  const a = readFileSync(ans, 'utf8')
  if (RE_API_FAILURE.test(a.slice(0, 300))) return { measured: false, why: 'отказ API' }
  const rep = readdirSync(dir).filter((n) => /^sdd-quality-report(-\d+)?\.md$/.test(n)).sort()
  const docsOk = (() => {
    const d = join(dir, 'coddoc')
    if (!existsSync(d)) return false
    const now = walk(d).map((p) => relative(d, p).replace(/\\/g, '/')).sort()
    if (now.join('\n') !== seeded.join('\n')) return false
    return now.every((p) => readFileSync(join(d, p), 'utf8') === readFileSync(join(FIXTURE_DOCS, p), 'utf8'))
  })()
  if (!rep.length) return { measured: true, ck: { 'отчёт': false, docs: docsOk } }
  const g = gradeReport(readFileSync(join(dir, rep[0]), 'utf8'))
  return { measured: true, ...g, ck: { 'отчёт': true, docs: docsOk, ...g.ck } }
}

function selftest () {
  let bad = 0
  const ck = (n, got, want) => { const ok = got === want; if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${n}: ${got} (ожидалось ${want})`) }
  ck('счёт с н/п', arithmeticOk(parseScore('н/п+1+0.5+1+1 = 3.5 из 4.0 (88%)'), W_SPEC), true)
  ck('счёт БТ с весом 0.5', arithmeticOk(parseScore('0.25+1+1+0.5+0 = 2.75 из 4.5 (61%)'), W_BT), true)
  ck('неверная сумма', arithmeticOk(parseScore('0.5+1+1+1+1 = 4.0 из 4.5 (89%)'), W_BT), false)
  ck('максимум без вычета н/п', arithmeticOk(parseScore('н/п+1+1+1+1 = 4.0 из 5.0 (80%)'), W_SPEC), false)
  ck('балл выше веса', arithmeticOk(parseScore('1+1+1+1+1 = 5.0 из 4.5 (111%)'), W_BT), false)
  ck('запятая вместо точки', arithmeticOk(parseScore('0,5+1+1+1+1 = 4,5 из 4,5 (100%)'), W_BT), true)
  ck('не оценка', parseScore('н/п: баг-репорт'), null)
  const good = [
    '## Требуют внимания', '- PSS-2213 · БТ 0.5 из 4.5 (11%) · шаблонно: да',
    '- PSS-2214 · БТ 4.5 из 4.5 (100%) · не по форме: нет 10 из 16 разделов (63%)',
    '- PSS-2215 · спека 2.0 из 5.0 (40%) · не по форме: нет 19 из 23 разделов (83%) · по коду',
    '- PSS-2216 · спека 4.5 из 5.0 (90%) · не по форме: нет 10 из 23 разделов (43%)', '',
    '## Сводная таблица',
    '| команда | ai-sdd repo | аналитик | фича | jira | БТ | БТ оценка | Спека | Спек оценка | шаблонно | не по форме | происхождение |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
    '| А | | | ф | PSS-2210 | coddoc/PSS-2210/business_requirements.md | 0.5+1+1+1+1 = 4.5 из 4.5 (100%) | coddoc/PSS-2210/technical_specification.md | 1+1+1+1+1 = 5.0 из 5.0 (100%) | нет | нет | скилл |',
    '| А | | | ф | PSS-2211 | coddoc/PSS-2211/business_requirements.md | 0.5+1+1+1+1 = 4.5 из 4.5 (100%) | спеки нет | спеки нет | нет | нет | — |',
    '| А | | | ф | PSS-2212 | coddoc/PSS-2212/business_requirements.md | 0.5+1+0.5+0.5+0.5 = 3.0 из 4.5 (67%) | coddoc/PSS-2212/technical_specification.md | 1+0.5+0.5+1+0.5 = 3.5 из 5.0 (70%) | нет | нет | скилл |',
    '| А | | | ф | PSS-2213 | coddoc/PSS-2213/business_requirements.md | 0+0.5+0+0+0 = 0.5 из 4.5 (11%) | coddoc/PSS-2213/technical_specification.md | 0+0+0+0.5+0 = 0.5 из 5.0 (10%) | БТ, спека | нет | скилл |',
    '| А | | | ф | PSS-2214 | coddoc/PSS-2214/business_requirements.md | 0.5+1+1+1+1 = 4.5 из 4.5 (100%) | coddoc/PSS-2214/technical_specification.md | 1+1+1+1+1 = 5.0 из 5.0 (100%) | нет | БТ 63% | скилл |',
    '| А | | | ф | PSS-2215 | нет | нет | coddoc/PSS-2215/technical_specification.md | 0+0.5+0+1+0.5 = 2.0 из 5.0 (40%) | нет | спека 83% | по коду |',
    '| А | | | ф | PSS-2216 | coddoc/PSS-2216/business_requirements.md | 0.5+1+1+1+1 = 4.5 из 4.5 (100%) | coddoc/PSS-2216/technical_specification.md | 1+1+0.5+1+1 = 4.5 из 5.0 (90%) | нет | спека 43% | скилл, правлена руками |',
    '| А | | | ф | ARS-312 | н/п: баг-репорт | н/п: баг-репорт | coddoc/ARS-312/technical_specification.md | 1+н/п+н/п+1+н/п = 2.0 из 2.0 (100%) | нет | нет | скилл |',
    '| А | | | ф | ARS-100 | coddoc/ARS-100/business_requirements.md | 0+0+0.5+0+0 = 0.5 из 4.5 (11%) | спеки нет | спеки нет | БТ | БТ 81% | — |',
    '| А | | | ф | ARS-100 | н/п: узел-фундамент | н/п: узел-фундамент | coddoc/ARS-100/_foundation/technical_specification.md | н/п+0+0+0+0 = 0.0 из 4.0 (0%) | спека | спека 96% | мимо фреймворка |',
    '| А | | | ф | ARS-101 | coddoc/ARS-100/ARS-101/business_requirements.md | 0+0+0+0+0 = 0.0 из 4.5 (0%) | coddoc/ARS-100/ARS-101/technical_specification.md | 0+0+0+0+0 = 0.0 из 5.0 (0%) | БТ, спека | БТ 94%, спека 96% | мимо фреймворка |',
    '', '## Детали', '',
    '### PSS-2213 — ф', '', '1. Цель — 0 из 0.5', '1. Функционал из источника — 0 из 1', '',
    '### PSS-2215 — ф', '', '1. Функционал из источника — 0 из 1', '',
    '### PSS-2216 — ф', '', '1. Функционал из источника — 1 из 1', '',
    '### PSS-2214 — ф', '', 'файл: coddoc/PSS-2214/business_requirements.md', '1. Цель — 0.5 из 0.5', 'форма: нет 12 из 16 — …'
  ].join('\n')
  const g = gradeReport(good)
  ck('эталонный отчёт — все проверки', Object.values(g.ck).every(Boolean), true)
  ck('PSS-2212 в «внимании» — красный', gradeReport(good.replace('- PSS-2213', '- PSS-2212 · x\n- PSS-2213')).ck['внимание'], false)
  ck('версия разошлась — красный', gradeReport(good.replace('0.5+1+1+1+1 = 4.5 из 4.5 (100%) | спеки нет', '0.5+0+1+1+1 = 3.5 из 4.5 (78%) | спеки нет')).ck['версия'], false)
  ck('нет строки фундамента — красный', gradeReport(good.split('\n').filter((l) => !l.includes('_foundation')).join('\n')).ck['строки'], false)
  ck('старый шаблон «не по форме» — красный', gradeReport(good.replace('(100%) | нет | нет |', '(100%) | нет | спека 30% |')).ck['форма'], false)
  ck('спека PSS-2214 «не по форме» — красный', gradeReport(good.replace('| нет | БТ 63% |', '| нет | БТ 63%, спека 26% |')).ck['форма'], false)
  ck('нет колонки формы — красный', gradeReport(good.replace(' | не по форме |', ' |')).ck['форма'], false)
  ck('в «Деталях» хороший документ — красный', gradeReport(good + '\n\n### PSS-2210 — ф\n\n1. Цель — 0.5 из 0.5').ck['детали'], false)
  ck('в «Деталях» спека PSS-2214 (по форме) — красный', gradeReport(good + '\n1. Функционал из источника — 1 из 1').ck['детали'], false)
  ck('нет «Деталей» — красный', gradeReport(good.split('\n## Детали')[0]).ck['детали'], false)
  ck('багфикс «по коду» — красный', gradeReport(good.replace('(100%) | нет | нет | скилл |\n| А | | | ф | ARS-100', '(100%) | нет | нет | по коду |\n| А | | | ф | ARS-100')).ck['по коду'], false)
  ck('правленная «по коду» — красный', gradeReport(good.replace('скилл, правлена руками', 'по коду')).ck['по коду'], false)
  ck('PSS-2215 не «по коду» — красный', gradeReport(good.replace('| спека 83% | по коду |', '| спека 83% | мимо фреймворка |')).ck['по коду'], false)
  ck('PSS-2215 крит. 1 н/п — красный', gradeReport(good.replace('0+0.5+0+1+0.5 = 2.0 из 5.0 (40%)', 'н/п+0.5+0+1+0.5 = 2.0 из 4.0 (50%)')).ck['без источника'], false)
  ck('PSS-2216 «скилл» — красный', gradeReport(good.replace('скилл, правлена руками', 'скилл')).ck['правлена'], false)
  ck('подраздел на документ — зелёный', gradeReport(good.replace('1. Цель — 0 из 0.5\n', '1. Цель — 0 из 0.5\n\n### PSS-2213 — ф (спека)\n')).ck['детали'], true)
  console.log(bad === 0 ? '\nсамопроверка: ok' : `\nсамопроверка: ПРОВАЛОВ ${bad}`)
  process.exit(bad === 0 ? 0 : 1)
}

const argv = process.argv.slice(2)
if (argv.includes('--selftest')) selftest()
const root = argv.find((x) => !x.startsWith('--'))
if (!root) { console.error('usage: node grade-sq.mjs <каталог с run-NN> | --selftest'); process.exit(1) }
const seeded = walk(FIXTURE_DOCS).map((p) => relative(FIXTURE_DOCS, p).replace(/\\/g, '/')).sort()
const runs = readdirSync(root).filter((n) => /^run-\d+$/.test(n) && statSync(join(root, n)).isDirectory()).sort()
const rows = runs.map((n) => [n, gradeOne(join(root, n), seeded)])
const ok = rows.filter(([, r]) => r.measured)
console.log(`\nпроба sq-audit, ${root}\nпрогонов: ${rows.length}, измерено: ${ok.length}`)
const tally = {}
for (const [n, r] of rows) {
  if (!r.measured) { console.log(`  ${n}: НЕ ИЗМЕРЕНО (${r.why})`); continue }
  const failed = Object.entries(r.ck).filter(([, v]) => !v).map(([k]) => k)
  for (const [k, v] of Object.entries(r.ck)) tally[k] = (tally[k] || 0) + (v ? 1 : 0)
  console.log(`  ${n}: ${failed.length ? 'красный — ' + failed.join(', ') : 'зелёный'}  PSS-2212 спека: ${r.p12 ?? '-'}  форма: ${r.forms ?? '-'}`)
}
console.log('\nпо проверкам:')
for (const [k, v] of Object.entries(tally)) console.log(`  ${k}: ${v}/${ok.length}`)
const green = ok.filter(([, r]) => Object.values(r.ck).every(Boolean)).length
console.log(`\n  ${green}/${ok.length}\tзелёных — все проверки  ← КРИТЕРИЙ\n`)
