#!/usr/bin/env node
// grade-scx-down.mjs — приёмка и разрез на выходе мелкой правки (фикстура SCX-DOWN): пробы scx-rv-*, scx-sb-*.
//
//   node grade-scx-down.mjs <каталог плеча> --case=rv-doc|rv-dep|rv-dirty|sb-doc|sb-dep
//   node grade-scx-down.mjs --selftest
//
// Входы — рукописи в форме technical-spec-doc 1.7.0 (README SCX-DOWN: происхождение и порядок замены):
//   ARS-321 — своё изменение, стык `GET /api/v2/duty/incident-list` — 🔵 «по документу сверху» (путь есть в запросе рядом);
//   ARS-341 — поднять версию API чужого geo: одна карточка «потребление существующего» 🟡 без пути, статус
//             «Требуются уточнения (1)»;
//   ARS-343 — двойник ARS-341: в карточке 🟡 путь `GET /v2/isochrone`, поля с типами и JSON.
//
// ПРАВИЛА:
//   spec-review/reference/checklist-spec.md:284-298 — счётная строка: только 🔵 «со слов» при пути или поле; «у карточки,
//     кода и документа сверху источник назван, его можно открыть и сверить». У ARS-321 «со слов» без пути и полей,
//     стык — «по документу сверху» → 0. Риск: «по документу сверху» с путём посчитан как «на памяти» → 1.
//   checklist-spec.md:267-275 (§14) — «по документу сверху» в списке законных источников; ложный §14 у стыка — красный.
//   checklist-spec.md:132-145 (§7) — у изменения путь ищется в строке стыка; §7 касается только 🟢-карточек, у 🟡
//     потребления (ARS-341) его быть не может.
//   checklist-spec.md:23-31 (§1) — конкретика под 🟡: у ARS-341 её нет (ложный §1 — красный), у ARS-343 есть (не найден —
//     красный).
//   checklist-spec.md:246-265 (§13) — «Вид» стоит у каждой карточки; ложный §13 — красный.
//   stage-breakdown-doc/SKILL.md:23-27, :126-140 — в инвентарь идёт 🟢 (новое или изменение существующего); 🔵/🟡
//     потребление — вход извне. :69-72, :158-162 — ноль стыков → индекс «не применимо» первым ходом, файлов этапов нет.
//     :384-385 — один стык → один этап, не «не применимо».
//   sb-doc: INT-1 (изменение 🟢) во владении этапа, индекс не «не применимо»; справкой — путь стыка в файле этапа.
//   sb-dep: INT-1 (потребление 🟡) ничей, индекс «не применимо», файлов этапов нет.

import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { turn, apiFailed } from './br-lib.mjs'

const KEY = { 'rv-doc': 'ARS-321', 'rv-dep': 'ARS-341', 'rv-dirty': 'ARS-343', 'sb-doc': 'ARS-321', 'sb-dep': 'ARS-341' }
const PATH_321 = '/api/v2/duty/incident-list'

/** Пункты отчёта: «N. …» и продолжение с отступом (форма spec-review Шага 3), как в grade-rv-blue.mjs. */
export function items (answer) {
  const out = []
  let cur = null
  let gap = ''
  for (const l of (answer || '').split('\n')) {
    if (/^\s*\d+\.\s/.test(l)) { if (cur) out.push(cur); cur = l; gap = ''; continue }
    if (cur === null) continue
    if (!l.trim()) { gap += '\n'; continue }
    if (/^\s/.test(l) && !/стоящих только на|нарушений:/i.test(l)) { cur += gap + '\n' + l; gap = ''; continue }
    out.push(cur); cur = null; gap = ''
  }
  if (cur) out.push(cur)
  return out
}

// Пункты по правилам 2б. `\b` рядом с кириллицей не работает — границы слова явные; «Вид» — с заглавной.
const RE_2B = /Существующ[а-яё]*\s+стык|по\s+документу\s+сверху|без\s+источника|источник[а-яё]*\s+(в\s+)?метк|без\s+вида|не\s+по\s+форме|🟡-основ|«было»|колонк[а-яё]*\s+«?было/i
const RE_VID = /(^|[^А-ЯЁа-яё])Вид([^а-яё]|$)/
const RE_P1 = /к\s+валидации|конкретик/i
const RE_P7 = /без\s+транспорта|метод\s+и\s+путь|нет\s+(ни\s+)?(метода|пути)/i
const count = (a) => { const c = (a || '').match(/стоящих только на памяти аналитика:\s*\**\s*(\d+)/i); return c ? Number(c[1]) : null }
const viol = (a) => { const v = (a || '').match(/нарушений:?\**:?\s*\**\s*(\d+)/i); return v ? Number(v[1]) : null }

export function gradeReview (answer, kase) {
  const its = items(answer)
  const m = {}
  const is2b = (b) => RE_2B.test(b) || RE_VID.test(b)
  if (kase === 'rv-doc' || kase === 'rv-dep') {
    const card = kase === 'rv-doc' ? /INT-1\b|стык|incident-list/i : /INT-1\b|geo|изохрон/i
    const f2b = its.filter(is2b)
    const f1 = its.filter((b) => RE_P1.test(b) && card.test(b))
    const f7 = its.filter((b) => RE_P7.test(b) && card.test(b))
    m['нет ложных пунктов по правилам 2б (стык, источник, вид, «было»)'] = f2b.length === 0
    m['нет ложного §1 по карточке'] = f1.length === 0
    m['нет ложного §7 по карточке'] = f7.length === 0
    m['счётная строка = 0'] = count(answer) === 0
    m._other = its.filter((b) => !f2b.includes(b) && !f1.includes(b) && !f7.includes(b))
  } else {
    m['найдено: конкретика под 🟡 в INT-1 (§1)'] = its.some((b) => RE_P1.test(b) && /v2\/isochrone|isochrone|json|minutes|Polygon|lat|lon/i.test(b))
    m._other = its.filter((b) => !RE_P1.test(b))
  }
  m._viol = viol(answer)
  m._count = count(answer)
  return m
}

/** `owns:` из шапки файла этапа — как в grade-sb-blue.mjs. */
export function owns (stage) {
  const fm = stage.match(/^---\n([\s\S]*?)\n---/)
  if (!fm) return []
  const o = fm[1].match(/^owns:(.*(?:\n\s+-.*)*)/m)
  return o ? (o[1].match(/INT-\d+/g) || []) : []
}

export function gradeStages (stages, index, kase) {
  const own = new Set(Object.values(stages).flatMap(owns))
  const na = !!index && /не\s+применимо/i.test(index)
  const n = Object.keys(stages).length
  const m = {}
  if (kase === 'sb-doc') {
    m['INT-1 (изменение 🟢) во владении этапа'] = own.has('INT-1')
    m['индекс есть, не «не применимо»'] = !!index && !na
    const holder = Object.values(stages).find((t) => owns(t).includes('INT-1')) || ''
    m._seam = /Существующ[а-яё]*\s+стык/i.test(holder) ? (holder.includes(PATH_321) ? 'стык с путём' : 'стык без пути') : 'стыка нет'
  } else {
    m['индекс «не применимо»'] = na
    m['файлов этапов нет'] = n === 0
    m['INT-1 (потребление 🟡) ничей'] = !own.has('INT-1')
    m._seam = ''
  }
  m._n = n
  return m
}

const bad = (m) => Object.entries(m).filter(([k, v]) => !k.startsWith('_') && !v).map(([k]) => k)

function selftest () {
  let f = 0
  const ok = (name, cond) => { console.log(`  ${cond ? '✅' : '❌'} ${name}`); if (!cond) f++ }
  const clean = 'чек-лист прочитан, тип: тех-спецификация\nартефакт: coddoc/ARS-321/technical_specification.md\nнарушений: 0\n\nнарушений записанных правил нет; это не значит, что решение верное.\n\nутверждений, стоящих только на памяти аналитика: 0\n'
  ok('rv-doc: чистый отчёт — зелёный', bad(gradeReview(clean, 'rv-doc')).length === 0)
  ok('rv-doc: «по документу сверху» посчитан на памяти — красный', !gradeReview(clean.replace('аналитика: 0', 'аналитика: 1'), 'rv-doc')['счётная строка = 0'])
  ok('rv-doc: нет счётной строки — красный', !gradeReview('нарушений: 0\n', 'rv-doc')['счётная строка = 0'])
  const f14 = 'нарушений: 1\n\n1. §2 INT-1, строка 40 — конкретика под 🔵 без источника в метке\n   «`GET /api/v2/duty/incident-list` — 🔵 подтверждено аналитиком (по документу сверху)»\n   → Укажите источник.\n\nутверждений, стоящих только на памяти аналитика: 0\n'
  ok('rv-doc: ложный §14 у стыка — красный', !gradeReview(f14, 'rv-doc')['нет ложных пунктов по правилам 2б (стык, источник, вид, «было»)'])
  const f13 = 'нарушений: 1\n\n1. §2 INT-1 — нет строки «Вид»\n   «### INT-1»\n\nутверждений, стоящих только на памяти аналитика: 0\n'
  ok('rv-doc: ложный §13 «Вид» — красный', !gradeReview(f13, 'rv-doc')['нет ложных пунктов по правилам 2б (стык, источник, вид, «было»)'])
  const other = 'нарушений: 1\n\n1. §6.3, строка 120 — неприменимое оформлено неверно\n   «### 6.3. Фиче-флаги»\n   → Зачеркните заголовок.\n\nИсточник требований: запрос на правку рядом.\n\nутверждений, стоящих только на памяти аналитика: 0\n'
  const go = gradeReview(other, 'rv-doc')
  ok('rv-doc: чужой пункт §11 и абзац «Источник требований» после списка — не 2б, справкой', bad(go).length === 0 && go._other.length === 1)
  const f7 = 'нарушений: 1\n\n1. §2 INT-1 — карточка 🟢 без транспорта\n   «### INT-1. Изохроны… — 🟡»\n   → Назовите метод и путь.\n\nутверждений, стоящих только на памяти аналитика: 0\n'
  ok('rv-dep: ложный §7 у 🟡 потребления — красный', !gradeReview(f7, 'rv-dep')['нет ложного §7 по карточке'])
  const f1 = 'нарушений: 1\n\n1. §2 INT-1 — конкретика под «🟡 к валидации»\n   «вызов изохрон в API geo v2»\n\nутверждений, стоящих только на памяти аналитика: 0\n'
  ok('rv-dep: ложный §1 по словесному описанию — красный', !gradeReview(f1, 'rv-dep')['нет ложного §1 по карточке'])
  ok('rv-dep: чистый — зелёный', bad(gradeReview(clean, 'rv-dep')).length === 0)
  const dirty = 'нарушений: 1\n\n1. §2 INT-1, строка 40 — конкретика существующего под меткой «🟡 к валидации»\n   «`GET /v2/isochrone`, параметры `lat: number`»\n   → Подтвердите путь у владельца.\n\nутверждений, стоящих только на памяти аналитика: 0\n'
  ok('rv-dirty: §1 найден — зелёный', bad(gradeReview(dirty, 'rv-dirty')).length === 0)
  ok('rv-dirty: пустой отчёт — красный', bad(gradeReview(clean, 'rv-dirty')).length > 0)
  const st = (o, extra = '') => `---\ntype: stage\nowns: [${o}]\ndepends_on: []\n---\n# Этап\n${extra}`
  ok('sb-doc: этап владеет INT-1 — зелёный', bad(gradeStages({ 'stage-01.md': st('INT-1', '- **Существующий стык:** `GET /api/v2/duty/incident-list`') }, '# Этапы\n| INT-1 | 01 |', 'sb-doc')).length === 0)
  ok('sb-doc: справка — путь стыка в этапе', gradeStages({ 'stage-01.md': st('INT-1', 'Существующий стык: `GET /api/v2/duty/incident-list`') }, 'x', 'sb-doc')._seam === 'стык с путём')
  ok('sb-doc: «не применимо» — красный', bad(gradeStages({}, '**Не применимо: правка внутри существующего контракта.**', 'sb-doc')).length > 0)
  ok('sb-dep: «не применимо» без этапов — зелёный', bad(gradeStages({}, '**Не применимо: вся работа фронтовая, контракт geo только потребляется.**', 'sb-dep')).length === 0)
  ok('sb-dep: этап под потребление — красный', bad(gradeStages({ 'stage-01.md': st('INT-1') }, '# Этапы', 'sb-dep')).length > 0)
  ok('sb-dep: индекса нет — красный', bad(gradeStages({}, null, 'sb-dep')).length > 0)
  console.log(`самопроверка: ${f ? 'провалов ' + f : '✓'}`)
  return f
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()

function main () {
  if (process.argv.includes('--selftest')) process.exit(selftest() ? 1 : 0)
  const arg = process.argv[2]
  const kase = (process.argv.find((a) => a.startsWith('--case=')) || '').slice(7)
  if (!arg || !existsSync(arg) || !KEY[kase]) { console.error('usage: node grade-scx-down.mjs <каталог плеча> --case=rv-doc|rv-dep|rv-dirty|sb-doc|sb-dep'); process.exit(1) }
  const runs = readdirSync(arg).filter((n) => /^run-\d+$/.test(n) && statSync(join(arg, n)).isDirectory()).sort()
  console.log(`\nпроба scx-${kase}, ${arg}`)
  let measured = 0; let green = 0
  for (const n of runs) {
    const dir = join(arg, n)
    const t1 = turn(dir, 1)
    if (existsSync(join(dir, '_escaped.txt')) || apiFailed(dir, [t1.answer])) { console.log(`  ${n}: НЕ ИЗМЕРЕНО`); continue }
    measured++
    let m
    if (kase.startsWith('rv-')) {
      m = gradeReview(t1.answer || '', kase)
    } else {
      const sdir = join(dir, 'coddoc', KEY[kase], 'stages')
      const index = existsSync(join(sdir, 'index.md')) ? readFileSync(join(sdir, 'index.md'), 'utf8') : null
      const stages = {}
      if (existsSync(sdir)) for (const x of readdirSync(sdir).filter((y) => /^stage-\d+\.md$/.test(y))) stages[x] = readFileSync(join(sdir, x), 'utf8')
      m = gradeStages(stages, index, kase)
    }
    const b = bad(m)
    if (!b.length) green++
    const info = kase.startsWith('rv-') ? ` · нарушений ${m._viol ?? '?'} · на памяти ${m._count ?? '?'}` : ` · этапов ${m._n}${m._seam ? ' · справка: ' + m._seam : ''}`
    console.log(`  ${n}: ${b.length ? 'красный' : 'зелёный'}${info}${b.length ? '  ✗ ' + b.join(' · ') : ''}`)
    for (const o of (m._other || []).slice(0, 4)) console.log(`        прочее: ${o.split('\n')[0].trim().slice(0, 120)}`)
  }
  console.log(`\n  ${green}/${measured}\tзелёных  ← КРИТЕРИЙ\n`)
}
