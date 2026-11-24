#!/usr/bin/env node
// grade-occ.mjs — общий грейдер проб `occ-*` (PLAN-CASES-ACCEPTANCE 2026-11-23): места публикации того же
// события / того же значения поля в §6.2 спеки и в файлах этапов. Истина — `fixtures/<FX>/truth-occ.json`
// (форма — у `parseTruth` ниже), состав и ловушки — README фикстур `OCC-*`.
//
//   node grade-occ.mjs <плечо с run-NN/> --fx=<ФИКСТУРА>
//   node grade-occ.mjs --selftest
//
// §6.2 — подраздел `### 6.2.` (и `### ~~6.2.`) до следующего заголовка `##`/`###`. «Строка» — непустая строка
// §6.2 после заголовка: строка таблицы, пункт списка или абзац; разделитель таблицы `|---|` строкой не считается.
// Регэкспы из truth компилируются с флагом `i`.
//
// Метрики по `kind`. ЦВЕТ — ПО СУТИ (зелёный — все метрики сути); ФОРМА цвет не меняет, печатается по прогону и
// отдельной строкой итогов (архитектор 2026-11-23: верный перечень в другой форме не должен краснеть, иначе скилл
// правят под строгость пробы).
//   positive  — суть: мест найдено N/N — НЕизменяемых (без `named`) в §6.2; изменяемое место (`named`) названо где
//               угодно в спеке, иначе красный «изменяемое место названо»; ловушка 0; выдумано 0 (в блоках мест нет
//               `valueTokens`, кроме законных у своего места — см. ниже). Блок места — его строка и вложенные под ней
//               строки без своего места (значение во вложенном пункте).
//               форма: каждое место своей строкой (нет строки, где совпали 2+ места); 🔵 или `services/` в САМОЙ
//               строке места (вводная строка над списком — в диагностике); общая проверка («до правки | прежн |
//               как сейчас/раньше | не меня…» где-то в §6.2); у места `valued` его блок несёт `valued.re`
//               (архитектор 2026-11-24: шаблон спеки значение не требует, только запрещает выдумывать);
//   one-place — из `places` найдено не больше одного места, и это `places[0]`; лишних мест 0 (`forbidden`,
//               если truth их даёт — выдуманные места другого имени грейдер не угадывает); ловушка 0; выдумано 0;
//   no-change — ни одного `forbidden` в §6.2 (§6.2 «не применимо» — норма); ловушка 0, если truth её даёт;
//   stage     — файлы `<папка спеки>/stages/stage-*.md`; чей этап — по заголовку `# …` и строке `owns:`
//               (`stageSide`); этап `with` несёт все `places` (весь файл), в КАЖДОМ этапе `without` мест 0.
//               Не ровно один `with`, файл под обоими регэкспами или ни одного `without` — другой разрез,
//               «не измерено» (README OCC-SB); этапы ни под одним — «неопознанных этапов N», на цвет не влияют.
// «Выдумано» не считает значения из `allow` своего места (`places[].allow`, необязательный ключ); у места `valued`
// законны его `allow` и `valued.re`, остальные `valueTokens` проверяются и там. Принятый риск: отрицание тоже
// красное — строка «`temporarily_unavailable` в файл не попадает» у выгрузки считается выдумкой.
// Диагностика (на цвет не влияет): сколько мест названо в §2 и §7, «неопознанных мест в §6.2: N» (строки, похожие
// на место, но не из places/trap/forbidden; у one-place и no-change — с текстом), статус; у этапов — файлы и чьи.
//
// Исходы прогона (RUNNER.md): «не измерено» — отказ API, побег из песочницы, запись вне неё, прочитан материал
// стенда, снимок скилла не прочитан (только пробы спеки), пустой ответ без артефакта, ПОДМЕНА (артефакта нет,
// а `answer.md` несёт спеку / файл этапа); «вопросы» — артефакта нет, в последнем ходе есть строки с «?»
// (законный исход, не красный, в знаменатель зелёных не входит); «✗» — артефакта нет и вопросов нет
// (с пометкой «фантом», если ответ отчитался о файле), или провалены метрики.
//
// Строка: пункт списка с местом и значением на соседних строках (вложенный пункт) значение «теряет» — оно не в
// строке места. Принято: строка таблицы и пункт списка — та форма, которую проба ждёт.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname, posix, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { countQuestions, lines, streamAudit } from './grade-gaps.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const KINDS = ['positive', 'one-place', 'no-change', 'stage']

const RE_COMMON = /до\s+правки|прежн|как\s+(сейчас|раньше)|не\s+меня/i
const RE_MARK = /🔵|services\//
const RE_SEP = /^\|?[\s|:]*-{3,}[\s|:-]*$/
const RE_LIST_OR_ROW = /^(\||[-*+]\s|\d+[.)]\s)/
/** Подмена: артефакта на диске нет, а `answer.md` несёт его текст (RUNNER.md, «Ловушка»). */
const RE_SPEC_IN_ANSWER = /^#\s*Техническая специф/im
const RE_STAGE_IN_ANSWER = /^type:\s*stage\s*$/m
// Литералы из grade-gaps.mjs / grade-2t.mjs — менять вместе.
const RE_CLAIMS_WRITTEN = /(спек[аи]|спецификаци[ияю]|документ|этап[ыа]?|файл[ыа]?)[^.\n]{0,60}(записан|готов|создан|сохранён|сохранен)|(файл|путь)\s*:?\s*`?[^`\n]{0,20}coddoc\//i
const RE_API_FAILURE = /API Error|Request not allowed|Please run \/login|Credit balance|rate limit|session limit|usage limit|hit your [\w-]* ?limit/i
const isApiFailure = (t) => !!t && (t.length < 600 ? RE_API_FAILURE.test(t) : RE_API_FAILURE.test(t.slice(0, 200)))
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8').replace(/\r/g, '') : null)

// ─── Истина ──────────────────────────────────────────────────────────────────────────────────

/**
 * truth-occ.json → проверенный объект с откомпилированными регэкспами. Граница ввода: файл пишут руками,
 * поэтому форма проверяется здесь, и битая истина роняет грейд, а не даёт тихий зелёный.
 *   { probe, kind, spec, places: [{id, re, named?, allow?}], valued: {place, re} | null, valueTokens: [re],
 *     trap: [{id, re}], forbidden: [{id, re}], stage: {with, without} | null }
 * Необязательные ключи места: `named: true` — изменяемое место: документ сверху называет случай, который меняется в
 * нём (размечается только по документу сверху); у positive засчитывается в любом разделе спеки, а не только в §6.2;
 * `caseRe: re` — только у `named`: слова случая из документа сверху; место названо, если `re` ИЛИ `caseRe` совпал где
 * угодно в спеке; в разборе строк §6.2 (своей строкой, выдумано, ловушка) `caseRe` не участвует;
 * `allow: [re]` — значения, законные у этого места: «выдумано» их у своего места не считает.
 */
export function parseTruth(raw, where = 'truth') {
  const t = typeof raw === 'string' ? JSON.parse(raw) : raw
  const fail = (msg) => { throw new Error(`${where}: ${msg}`) }
  const rx = (src, at) => {
    if (typeof src !== 'string' || !src) fail(`${at} — нужна непустая строка-регэксп`)
    try { return new RegExp(src, 'i') } catch (e) { return fail(`${at} — битый регэксп ${JSON.stringify(src)}: ${e.message}`) }
  }
  if (!t || typeof t !== 'object' || Array.isArray(t)) fail('не объект')
  if (!KINDS.includes(t.kind)) fail(`kind «${t.kind}» не из ${KINDS.join(' | ')}`)
  if (typeof t.spec !== 'string' || !/(^|\/)technical_specification\.md$/.test(t.spec)) fail('spec — путь к …/technical_specification.md')
  const list = (key) => {
    const v = t[key] ?? []
    if (!Array.isArray(v)) fail(`${key} — не массив`)
    return v.map((x, i) => {
      if (!x || typeof x.id !== 'string' || !x.id) fail(`${key}[${i}] — нужен id`)
      const item = { id: x.id, re: rx(x.re, `${key}[${i}].re`) }
      if (key !== 'places') return item
      if (x.named != null && typeof x.named !== 'boolean') fail(`places[${i}].named — не true/false`)
      if (x.allow != null && !Array.isArray(x.allow)) fail(`places[${i}].allow — не массив`)
      if (x.caseRe != null && x.named !== true) fail(`places[${i}].caseRe — только у named`)
      return { ...item, named: x.named === true, caseRe: x.caseRe != null ? rx(x.caseRe, `places[${i}].caseRe`) : null,
        allow: (x.allow ?? []).map((s, j) => rx(s, `places[${i}].allow[${j}]`)) }
    })
  }
  const places = list('places'), trap = list('trap'), forbidden = list('forbidden')
  const vt = t.valueTokens ?? []
  if (!Array.isArray(vt)) fail('valueTokens — не массив')
  const valueTokens = vt.map((s, i) => rx(s, `valueTokens[${i}]`))
  let valued = null
  if (t.valued != null) {
    if (!places.some((p) => p.id === t.valued.place)) fail(`valued.place «${t.valued.place}» нет в places`)
    valued = { place: t.valued.place, re: rx(t.valued.re, 'valued.re') }
  }
  let stage = null
  if (t.stage != null) {
    stage = { with: rx(t.stage.with, 'stage.with'), without: t.stage.without ? rx(t.stage.without, 'stage.without') : null }
  }
  if (t.kind === 'positive' && places.length < 2) fail('positive: в places меньше двух мест')
  if (t.kind === 'one-place' && !places.length) fail('one-place: places пуст')
  if (t.kind === 'no-change' && !forbidden.length) fail('no-change: forbidden пуст — мерить нечего')
  if (t.kind === 'stage' && (!stage || !places.length)) fail('stage: нужны stage.with и places')
  return { probe: String(t.probe ?? ''), kind: t.kind, spec: t.spec, places, valued, valueTokens, trap, forbidden, stage }
}

// ─── Разбор спеки ────────────────────────────────────────────────────────────────────────────

/** Текст §6.2 (первая строка — остаток заголовка) или null, если подраздела нет. */
export function sec62(spec) {
  const parts = spec.split(/^###\s+(?:~~)?6\.2(?:\.|\s)/m)
  return parts.length < 2 ? null : parts[1].split(/^#{2,3}\s/m)[0]
}
/** Раздел `## N.` до следующего `## `. */
function section(spec, n) {
  const parts = spec.split(new RegExp(`^##\\s+(?:~~)?${n}\\.`, 'm'))
  return parts.length < 2 ? '' : parts[1].split(/^##\s/m)[0]
}
/** Строки §6.2: без остатка заголовка, пустых и разделителей таблицы. */
export function rows62(s62) {
  return s62 === null ? [] : lines(s62).slice(1).map((l) => l.trim()).filter((l) => l && !RE_SEP.test(l))
}
function status(spec) {
  const st = spec.match(/Статус готовности:\*\*\s*(Готово к разработке|Требуются уточнения\s*\(\d+\))/)
  return st ? st[1] : /ПРОСТАВЛЯЕТСЯ/.test(spec) ? 'заглушка не снята' : 'не проставлен'
}
const idsIn = (text, list) => list.filter((p) => p.re.test(text)).map((p) => p.id)
const spans = (re, text) => [...text.matchAll(new RegExp(re.source, 'gi'))].filter((m) => m[0]).map((m) => [m.index, m.index + m[0].length])

/**
 * Значения из `valueTokens` в строке места `p`, которых нет в его `allow`. Значение законно, если его участок строки
 * перекрыт совпадением какого-нибудь `allow` — так регэкспы токена и разрешения не обязаны совпадать буква в букву.
 */
function strayValues(text, p, T) {
  const legal = p.id === T.valued?.place ? [...p.allow, T.valued.re] : p.allow
  const ok = legal.flatMap((a) => spans(a, text))
  return T.valueTokens.flatMap((v) => spans(v, text))
    .filter(([s, e]) => !ok.some(([as, ae]) => as < e && s < ae))
    .map(([s, e]) => text.slice(s, e))
}

/**
 * Строки §6.2, похожие на место (путь ручки, топик с двумя точками, «поток / задача / ручка / консьюмер»), но не
 * совпавшие ни с `places`, ни с `trap`, ни с `forbidden`: выдуманное место с новым именем. Только диагностика —
 * общая проверка «в остальных потоках — как до правки» сюда тоже попадает.
 */
const RE_PLACE_LIKE = /\/v\d|\/api\/|[a-z][\w-]*\.[a-z][\w-]*\.[a-z]|поток|задач|ручк|консьюмер|consumer/i
/**
 * Текст места `id` в строке §6.2. Место в строке одно — весь блок (строка + вложенные пункты). Мест несколько (это
 * форма, «своей строкой») — только его сегменты: от начала совпадения места до начала следующего совпадения любого
 * места; последний — до конца блока, текст до первого места ничей. По нему считаются «выдумано», `allow` и
 * «значение у места со значением» (пилот 2026-11-23: «номер волны» у закрытия волны приписывался всем шести местам).
 */
function segText(h, id, byId) {
  if (h.ps.length < 2) return h.block
  const starts = h.ps.flatMap((pid) => spans(byId.get(pid).re, h.block).map(([s]) => [s, pid])).sort((a, b) => a[0] - b[0])
  return starts.filter(([, pid]) => pid === id)
    .map(([s]) => h.block.slice(s, starts.find(([t]) => t > s)?.[0]))
    .join('\n')
}

function unknownPlaces(rs, T) {
  const known = [...T.places, ...T.trap, ...T.forbidden]
  return rs.filter((l) => RE_PLACE_LIKE.test(l) && !known.some((k) => k.re.test(l)))
}

/** Вводная строка над списком/таблицей: ближайшая выше, которая не пункт, не строка таблицы и не место. */
function leadIn(hits, i) {
  for (let j = i - 1; j >= 0; j -= 1) {
    if (hits[j].ps.length || RE_LIST_OR_ROW.test(hits[j].text)) continue
    return hits[j].text
  }
  return ''
}

/** Метрики §6.2 для kind positive | one-place | no-change → { m: [{name, ok, detail}], diag: [] }. */
export function gradeSpec(spec, T) {
  const s62 = sec62(spec)
  const rs = rows62(s62)
  // Блок места — его строка и вложенные под ней строки без своего места (значение во вложенном пункте — по сути
  // то же место). Отступ берётся из сырых строк §6.2: `rows62` их обрезает, порядок у обоих один.
  const indent = s62 === null ? [] : lines(s62).slice(1).filter((l) => l.trim() && !RE_SEP.test(l.trim())).map((l) => l.match(/^\s*/)[0].length)
  const hits = rs.map((text) => ({ text, ps: idsIn(text, T.places) }))
  hits.forEach((h, i) => {
    const sub = []
    for (let j = i + 1; j < hits.length && indent[j] > indent[i] && !hits[j].ps.length; j += 1) sub.push(hits[j].text)
    h.block = [h.text, ...sub].join('\n')
  })
  const found = T.places.map((p) => p.id).filter((id) => hits.some((h) => h.ps.includes(id)))
  const traps = T.trap.filter((t) => rs.some((l) => t.re.test(l))).map((t) => t.id)
  const forb = T.forbidden.filter((f) => rs.some((l) => f.re.test(l))).map((f) => f.id)
  const byId = new Map(T.places.map((p) => [p.id, p]))
  const invented = hits
    .map((h) => ({ ...h, vals: h.ps.flatMap((id) => strayValues(segText(h, id, byId), byId.get(id), T).map((v) => `${id}: ${v}`)) }))
    .filter((h) => h.vals.length)
  const m = []
  // `form` — короткое имя метрики формы: цвет она не меняет (`isGreen`), в итогах — отдельной строкой.
  const add = (name, ok, detail = '', form = '') => m.push({ name, ok: !!ok, detail, form })

  if (T.kind === 'positive') {
    // Решение архитектора по базе 2026-11-23: в §6.2 обязаны стоять НЕизменяемые места; изменяемые (`named`) уже
    // описаны требованиями правки и засчитываются в любом разделе спеки (§2, §6.2, §7…).
    const fixed = T.places.filter((p) => !p.named).map((p) => p.id)
    const miss = fixed.filter((id) => !found.includes(id))
    add('мест найдено', !miss.length, `${fixed.length - miss.length}/${fixed.length}${miss.length ? `, нет: ${miss.join(', ')}` : ''}`)
    // Изменяемое место спека законно называет и словами случая (`caseRe`: статус, формулировка документа сверху).
    const unnamed = T.places.filter((p) => p.named && !p.re.test(spec) && !p.caseRe?.test(spec)).map((p) => p.id)
    if (T.places.some((p) => p.named)) add('изменяемое место названо', !unnamed.length, unnamed.length ? `нигде нет: ${unnamed.join(', ')}` : '')
    const multi = hits.filter((h) => h.ps.length > 1)
    add('каждое место своей строкой', !multi.length, multi.map((h) => h.ps.join('+')).join('; '), 'своей строкой')
    add('ловушка 0', !traps.length, traps.join(', '))
    add('выдумано 0', !invented.length, invented.flatMap((h) => h.vals).join('; '))
    const bare = hits.filter((h) => h.ps.length && !RE_MARK.test(h.text))
    add('🔵/services/ у строк мест', !bare.length, bare.map((h) => h.ps.join('+')).join('; '), '🔵 в строке')
    add('общая проверка', RE_COMMON.test(rs.join('\n')), '', 'общая проверка')
    // Форма, не цвет (архитектор 2026-11-24): шаблон спеки значение у места не требует, только запрещает выдумывать.
    if (T.valued) {
      const vl = hits.filter((h) => h.ps.includes(T.valued.place))
      add('значение у места со значением', vl.some((h) => T.valued.re.test(segText(h, T.valued.place, byId))),
        vl.length ? `${T.valued.place}: значения нет` : `${T.valued.place}: места нет`, 'значение у места')
    }
  } else if (T.kind === 'one-place') {
    const extra = found.filter((id) => id !== T.places[0].id)
    add('не больше одного места', found.length <= 1 && !extra.length, found.join(', '))
    if (T.forbidden.length) add('лишних мест 0', !forb.length, forb.join(', '))
    add('ловушка 0', !traps.length, traps.join(', '))
    add('выдумано 0', !invented.length, invented.flatMap((h) => h.vals).join('; '))
  } else if (T.kind === 'no-change') {
    add('мест существующего события 0', !forb.length, forb.join(', '))
    if (T.trap.length) add('ловушка 0', !traps.length, traps.join(', '))
  } else {
    throw new Error(`gradeSpec: kind ${T.kind} — не спека`)
  }

  const diag = []
  if (s62 === null) diag.push('§6.2 нет')
  const ref = T.places.length ? T.places : T.forbidden
  const cnt = (txt) => idsIn(txt, ref).length
  diag.push(`мест: §6.2 ${cnt(rs.join('\n'))}/${ref.length}, §2 ${cnt(section(spec, 2))}, §7 ${cnt(section(spec, 7))}`)
  const unknown = unknownPlaces(rs, T)
  diag.push(`неопознанных мест в §6.2: ${unknown.length}${T.kind !== 'positive' && unknown.length
    ? ` — ${unknown.map((l) => `«${l.length > 90 ? `${l.slice(0, 90)}…` : l}»`).join('; ')}` : ''}`)
  if (T.kind === 'positive') {
    const leadOnly = hits.filter((h, i) => h.ps.length && !RE_MARK.test(h.text) && RE_MARK.test(leadIn(hits, i))).length
    if (leadOnly) diag.push(`🔵/services/ только во вводной строке: ${leadOnly}`)
  }
  diag.push(`статус: ${status(spec)}`)
  return { m, diag }
}

// ─── Разбор этапов ───────────────────────────────────────────────────────────────────────────

/** Голова этапа по README OCC-SB: заголовок `# Этап NN — …` и строка `owns:` фронтматтера. */
export function stageFields(text) {
  let ls = lines(text)
  let owns = ''
  if (ls[0]?.trim() === '---') {
    const end = ls.findIndex((l, i) => i > 0 && l.trim() === '---')
    if (end > 0) { owns = ls.slice(1, end).find((l) => /^owns:/.test(l)) ?? ''; ls = ls.slice(end + 1) }
  }
  return [ls.find((l) => /^#\s/.test(l)) ?? '', owns]
}

/**
 * Чей этап — по голове (заголовок + `owns:`): `with`, `without`, оба (`ambiguous` — этап события слит с соседом)
 * или ни один (`none` — неопознанный этап, например отдельные данные или FE). «Что делает» не смотрится: там этап
 * журнала законно пишет «событие», и утечка ушла бы в этап правки.
 */
export function stageSide(text, stage) {
  const head = stageFields(text).join('\n')
  const w = stage.with.test(head), o = !!stage.without && stage.without.test(head)
  return w && o ? 'ambiguous' : w ? 'with' : o ? 'without' : 'none'
}

/**
 * files: [{name, text}] → { m, diag } или { why }. Мерится только разрез, где этап правки отдельный: ровно один
 * `with`, ни одного файла, который ловят оба регэкспа, и (если `without` задан) хотя бы один `without`. Иначе —
 * другой разрез, «не измерено» (README OCC-SB). Неопознанные этапы на цвет не влияют — только диагностика.
 */
export function gradeStages(files, T) {
  const m = []
  const add = (name, ok, detail = '') => m.push({ name, ok: !!ok, detail })
  const side = new Map(files.map((f) => [f, stageSide(f.text, T.stage)]))
  const pick = (s) => files.filter((f) => side.get(f) === s)
  const W = pick('with'), O = pick('without'), amb = pick('ambiguous'), none = pick('none')
  const nm = (fs) => fs.map((f) => f.name.split('/').pop()).join(', ')
  if (W.length !== 1 || amb.length || (T.stage.without && !O.length)) {
    return { why: `другой разрез: этапов ${files.length}, с правкой ${W.length}${T.stage.without ? `, без правки ${O.length}` : ''}${amb.length ? `, ловят оба регэкспа: ${nm(amb)}` : ''}` }
  }
  const has = (f) => idsIn(f.text, T.places)
  const got = has(W[0])
  const miss = T.places.map((p) => p.id).filter((id) => !got.includes(id))
  add('этап с правкой несёт все места', !miss.length, `${got.length}/${T.places.length}${miss.length ? `, нет: ${miss.join(', ')}` : ''}`)
  if (T.stage.without) {
    const leak = O.filter((f) => has(f).length)
    add('в этапах без правки мест 0', !leak.length, leak.map((f) => `${nm([f])}: ${has(f).join(', ')}`).join('; '))
  }
  const diag = [`этапов ${files.length}; с правкой: ${nm(W)}; без правки: ${T.stage.without ? nm(O) : '—'}`,
    `неопознанных этапов ${none.length}${none.length ? ` (${nm(none)})` : ''}`]
  return { m, diag }
}

// ─── Прогон ──────────────────────────────────────────────────────────────────────────────────

function walk(dir, base = dir, acc = []) {
  if (!existsSync(dir)) return acc
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, base, acc)
    else acc.push(p.slice(base.length + 1).split('\\').join('/'))
  }
  return acc
}

/** Последний ход: старший `answer-NN.md` (многоходовые пробы), иначе `answer.md`. */
function lastAnswer(dir) {
  const turns = readdirSync(dir).filter((n) => /^answer-\d+\.md$/.test(n)).sort()
  return read(join(dir, turns.length ? turns[turns.length - 1] : 'answer.md')) ?? ''
}

function unmeasured(dir, kind) {
  if (existsSync(join(dir, '_api-failure.txt'))) return 'отказ API'
  if (existsSync(join(dir, '_api-failure-turn.txt'))) return `отказ API на ходу: ${(read(join(dir, '_api-failure-turn.txt')) ?? '').trim()}`
  if (existsSync(join(dir, '_escaped.txt'))) return 'прогон вышел за песочницу (_escaped.txt)'
  const ans = read(join(dir, 'answer.md'))
  if (ans && isApiFailure(ans)) return 'отказ API в тексте ответа'
  const a = streamAudit(dir)
  if (a.has && a.outsideWrites.length) return `запись вне песочницы: ${a.outsideWrites[0]}`
  if (a.has && a.harness.length) return `прочитан материал стенда: ${a.harness[0]}`
  // Регэксп чтения снимка в streamAudit — под technical-spec-doc; у разреза этапов не проверяется.
  if (a.has && kind !== 'stage' && !a.skillRead) return 'снимок скилла не прочитан'
  const streams = readdirSync(dir).filter((n) => /^stream(-\d+)?\.jsonl$/.test(n))
  if (streams.some((n) => /truth-occ/.test(read(join(dir, n)) ?? ''))) return 'прочитан материал стенда: truth-occ.json'
  // Свой поток вызовов в песочнице (раунды до 2026-11-24 его туда клали): обращение к нему — не измерено.
  for (const n of streams) for (const ln of (read(join(dir, n)) ?? '').split('\n')) {
    if (!ln.includes('"tool_use"')) continue
    let j; try { j = JSON.parse(ln) } catch { continue }
    for (const c of j.message?.content ?? []) {
      if (c.type === 'tool_use' && /stream(-\d+)?\.jsonl/.test(JSON.stringify(c.input ?? {}))) return 'прочитан свой поток вызовов (stream*.jsonl)'
    }
  }
  return null
}

/** Цвет — по сути: метрики формы (`form`) его не меняют и печатаются отдельно. */
export const isGreen = (g) => g.m.every((x) => x.ok || x.form)

/** Артефакта нет: подмена → «не измерено», вопросы → «вопросы», иначе ✗. */
export function noArtifact(kind, answer, last) {
  const what = kind === 'stage' ? 'этап' : 'спека'
  if ((kind === 'stage' ? RE_STAGE_IN_ANSWER : RE_SPEC_IN_ANSWER).test(answer)) return { out: 'skip', why: `подмена артефакта: ${what} уехала в answer.md` }
  if (!answer.trim()) return { out: 'skip', why: 'пустой ответ, на диске тоже пусто' }
  const q = countQuestions(last)
  if (q > 0) return { out: 'q', diag: [`вопросов ${q}`] }
  const label = kind === 'stage' ? 'этапы записаны' : 'спека записана'
  return { out: 'fail', m: [{ name: label, ok: false, detail: RE_CLAIMS_WRITTEN.test(last) ? 'фантом: отчитался о файле' : '' }], diag: [] }
}

function gradeRun(dir, T) {
  const why = unmeasured(dir, T.kind)
  if (why) return { out: 'skip', why }
  const answer = read(join(dir, 'answer.md')) ?? ''
  const last = lastAnswer(dir)
  const seeded = new Set((read(join(dir, '_seeded.txt')) ?? '').split('\n').filter(Boolean))
  const fresh = walk(dir).filter((p) => !seeded.has(p) && !p.startsWith('_') && !p.startsWith('.claude/'))
  const verdict = (g) => ({ out: isGreen(g) ? 'pass' : 'fail', ...g })

  if (T.kind === 'stage') {
    const stDir = `${posix.dirname(T.spec)}/stages/`
    let paths = fresh.filter((p) => p.startsWith(stDir) && /^stage-[^/]*\.md$/.test(p.slice(stDir.length)))
    const stray = !paths.length
    if (stray) paths = fresh.filter((p) => /(^|\/)stages\/stage-[^/]*\.md$/.test(p))
    if (!paths.length) {
      const r = noArtifact('stage', answer, last)
      const idx = read(join(dir, stDir, 'index.md'))
      if (idx && /не\s+применимо/i.test(idx)) (r.diag ??= []).push('index.md: «не применимо»')
      return r
    }
    const g = gradeStages(paths.map((p) => ({ name: p, text: read(join(dir, p)) ?? '' })), T)
    if (g.why) return { out: 'skip', why: g.why }
    if (stray) g.diag.unshift(`мимо папки спеки: ${posix.dirname(paths[0])}`)
    return verdict(g)
  }

  let rel = existsSync(join(dir, T.spec)) ? T.spec : null
  const stray = !rel
  if (stray) rel = fresh.find((p) => /(^|\/)technical_specification\.md$/.test(p)) ?? null
  if (!rel) return noArtifact(T.kind, answer, last)
  const g = gradeSpec(read(join(dir, rel)) ?? '', T)
  if (stray) g.diag.unshift(`мимо пути truth: ${rel}`)
  return verdict(g)
}

// ─── Самотест ────────────────────────────────────────────────────────────────────────────────
// Домен образца выдуман под самотест и ни с одной фикстурой не совпадает: сервис отправлений, событие
// `shipment-status`, поле `externalRef`; четыре места; значение названо только у ручки отмены;
// ловушка — событие `shipment-stats` ночной выгрузки статистики.

const ST_PLACES = [
  { id: 'cancel', re: '/cancel|отмен[а-яё]* отправлени' },
  { id: 'courier', re: 'курьерск[а-яё]* служб|courier-status' },
  { id: 'expire', re: 'просроченн|expire-overdue' },
  { id: 'returns', re: 'возврат[а-яё]* со склада|warehouse-returns' },
]
const ST_POS = {
  probe: 'selftest', kind: 'positive', spec: 'coddoc/SHP-7/technical_specification.md', places: ST_PLACES,
  valued: { place: 'cancel', re: 'номер[а-яё]* возврата' },
  valueTokens: ['номер[а-яё]* возврата', 'id отправлени', 'трек-номер'],
  trap: [{ id: 'stats', re: 'shipment-stats|выгрузк[а-яё]* статистик' }], forbidden: [], stage: null,
}
const ROW = {
  cancel: '| Ручка `POST /internal/shipments/{id}/cancel` | номер возврата — по FR-1 | 🔵 `services/shipments.md` |',
  courier: '| Поток статусов курьерской службы | как до правки | 🔵 `services/shipments.md` |',
  expire: '| Задача закрытия просроченных отправлений | как до правки | 🔵 `services/shipments.md` |',
  returns: '| Поток возвратов со склада | как до правки | 🔵 `services/shipments.md` |',
}
const specWith = (s62) => [
  '# Техническая спецификация: номер возврата в событии отмены', '',
  '> **Статус готовности:** Готово к разработке', '> **Тип:** мелкая правка', '',
  '## 2. Взаимодействия (ядро)', '### INT-1. Отмена отправления — изменение существующего',
  '- Ручка `POST /internal/shipments/{id}/cancel` публикует `shipment-status`.', '',
  '## 6. Релиз и интеграция', '### 6.1. Порядок выката', 'Один сервис.',
  s62, '### 6.3. Фиче-флаги', 'Не применимо: флагов нет.', '',
  '## 7. Трассировка приёмки', '| FR-1 | INT-1 | Дано отправление, когда его отменяют через `/cancel`, тогда в `externalRef` номер возврата |',
].join('\n')
const table62 = (rowsList, extra = []) => [
  '### 6.2. Обратная совместимость',
  'Событие `shipment-status` уходит из четырёх мест:', '',
  '| Место | Что уходит в `externalRef` | Источник |', '|---|---|---|', ...rowsList, '',
  'Проверка: при отмене — по требованию, в остальных местах поле то же, что до правки.', ...extra,
].join('\n')
const ALL = [ROW.cancel, ROW.courier, ROW.expire, ROW.returns]

const ST_SB = {
  ...ST_POS, kind: 'stage', valued: null, trap: [],
  stage: { with: 'номер[а-яё]* возврата', without: 'истори|журнал' },
}
const stageFile = (nn, title, what, body) => ({
  name: `coddoc/SHP-7/stages/stage-${nn}.md`,
  text: ['---', 'type: stage', 'task: SHP-7', `stage: "${nn}"`, '---', '', `# Этап ${nn} — ${title}`, '', '## Что делает', what, '',
    '## Выход (стык) — контракт из спеки, дословно', ...body].join('\n'),
})
const COMPAT = ['## Обратная совместимость', ...ALL]

function selftestChecks() {
  const res = []
  const ok = (name, cond) => res.push([name, !!cond])
  const T = parseTruth(ST_POS, 'selftest')
  const failed = (g) => g.m.filter((x) => !x.ok).map((x) => x.name)
  const only = (g, name) => { const f = failed(g); return f.length === 1 && f[0] === name }

  const green = gradeSpec(specWith(table62(ALL)), T)
  ok('positive зелёный: все метрики', failed(green).length === 0)
  ok('positive зелёный: §7 в §6.2 не засчитан, виден в диагностике', green.diag.some((d) => /§2 1, §7 1/.test(d)))
  ok('красный: пропущено место → только «мест найдено»',
    only(gradeSpec(specWith(table62([ROW.cancel, ROW.courier, ROW.returns])), T), 'мест найдено'))
  ok('красный: ловушка в перечне → только «ловушка 0»',
    only(gradeSpec(specWith(table62([...ALL, '| Ночная выгрузка статистики `shipment-stats` | как до правки | 🔵 `services/shipments.md` |'])), T), 'ловушка 0'))
  ok('красный: значение у места без источника → только «выдумано 0»',
    only(gradeSpec(specWith(table62([ROW.cancel, ROW.courier.replace('как до правки', 'id отправления'), ROW.expire, ROW.returns])), T), 'выдумано 0'))
  ok('красный: два места в одной строке → только «каждое место своей строкой»',
    only(gradeSpec(specWith(table62([ROW.cancel, '| Потоки статусов курьерской службы и возвратов со склада | как до правки | 🔵 `services/shipments.md` |', ROW.expire])), T), 'каждое место своей строкой'))
  ok('у места со значением значения нет → цвет зелёный, форма ✗ только «значение у места со значением»',
    (() => { const g = gradeSpec(specWith(table62([ROW.cancel.replace('номер возврата', 'новое значение'), ROW.courier, ROW.expire, ROW.returns])), T)
      return isGreen(g) && only(g, 'значение у места со значением') && !!g.m.find((x) => x.name === 'значение у места со значением').form })())
  const noMark = ['### 6.2. Обратная совместимость', 'По карточке `services/shipments.md` (🔵) событие уходит из:',
    '- ручки `POST /internal/shipments/{id}/cancel` — номер возврата;', '- потока статусов курьерской службы;',
    '- задачи закрытия просроченных отправлений;', '- потока возвратов со склада.', 'В остальных местах — как до правки.'].join('\n')
  const gm = gradeSpec(specWith(noMark), T)
  ok('метка только во вводной строке → «🔵/services/» красный, диагностика её видит',
    only(gm, '🔵/services/ у строк мест') && gm.diag.some((d) => /вводной строке: 4/.test(d)))
  // Строки мест с «как до правки» сами несут проверку — здесь их колонка пустая, чтобы мерилась строка под перечнем.
  const dash = ALL.map((r) => r.replace('как до правки', '—'))
  ok('строки мест без «как до правки», проверка под перечнем есть → зелёный', failed(gradeSpec(specWith(table62(dash)), T)).length === 0)
  ok('§6.2 без общей проверки → только «общая проверка»',
    only(gradeSpec(specWith(table62(dash).replace('Проверка: при отмене — по требованию, в остальных местах поле то же, что до правки.', 'Проверить четыре места.')), T), 'общая проверка'))

  // Суть против формы: перечень полный и верный, но значение во вложенном пункте, метка во вводной строке, два места
  // в одной строке, общей проверки нет. Форма красная по всем трём — цвет зелёный; без места — красный.
  const formBad = ['### 6.2. Обратная совместимость', 'По карточке `services/shipments.md` (🔵) событие уходит из:',
    '- ручки `POST /internal/shipments/{id}/cancel`', '  - в `externalRef` — номер возврата;',
    '- потоков статусов курьерской службы и возвратов со склада;', '- задачи закрытия просроченных отправлений.', 'Проверить все места.']
  const gf = gradeSpec(specWith(formBad.join('\n')), T)
  ok('суть верна, форма плохая → зелёный, форма — три провала без влияния на цвет',
    isGreen(gf) && failed(gf).sort().join('|') === ['каждое место своей строкой', 'общая проверка', '🔵/services/ у строк мест'].sort().join('|')
    && gf.m.filter((x) => !x.ok).every((x) => x.form))
  ok('суть неверна (места нет), форма та же плохая → красный',
    !isGreen(gradeSpec(specWith(formBad.filter((l) => !/просроченн/.test(l)).join('\n')), T)))
  ok('значение чужого места во вложенном пункте — «выдумано 0»',
    failed(gradeSpec(specWith(formBad.join('\n').replace('- задачи закрытия просроченных отправлений.', '- задачи закрытия просроченных отправлений\n  - в поле id отправления')), T)).includes('выдумано 0'))

  // Изменяемое место (`named`) засчитывается в любом разделе, неизменяемое — только в §6.2.
  const TNM = parseTruth({ ...ST_POS, places: ST_PLACES.map((p) => (p.id === 'expire' ? { ...p, named: true } : p)) }, 'selftest')
  const in2 = (s, line) => s.replace('## 6. Релиз и интеграция', `${line}\n\n## 6. Релиз и интеграция`)
  ok('named, хороший: изменяемое место только в §2 → зелёный',
    failed(gradeSpec(in2(specWith(table62([ROW.cancel, ROW.courier, ROW.returns])), '- Задача закрытия просроченных отправлений тоже шлёт событие.'), TNM)).length === 0)
  ok('named, плохой: неизменяемое место только в §2 → только «мест найдено»',
    only(gradeSpec(in2(specWith(table62([ROW.cancel, ROW.expire, ROW.returns])), '- Поток статусов курьерской службы тоже шлёт событие.'), TNM), 'мест найдено'))
  ok('named: изменяемого места нет нигде → только «изменяемое место названо»',
    only(gradeSpec(specWith(table62([ROW.cancel, ROW.courier, ROW.returns])), TNM), 'изменяемое место названо'))

  // `caseRe`: изменяемое место названо словами случая, а не именем места из карточки.
  const TCS = parseTruth({ ...ST_POS, places: ST_PLACES.map((p) => (p.id === 'expire' ? { ...p, named: true, caseRe: 'срок\\s+хранения\\s+ист[её]к|\\bexpired\\b' } : p)) }, 'selftest')
  const caseIn2 = in2(specWith(table62([ROW.cancel, ROW.courier, ROW.returns])), '- Когда срок хранения истёк (`expired`), событие шлётся с новым значением.')
  ok('caseRe, хороший: случай словами в §2 → зелёный; без caseRe та же спека — «изменяемое место названо»',
    failed(gradeSpec(caseIn2, TCS)).length === 0 && only(gradeSpec(caseIn2, TNM), 'изменяемое место названо'))
  ok('caseRe не разбирает §6.2: место + слова случая в одной строке — не «два места»',
    failed(gradeSpec(specWith(table62([ROW.cancel, ROW.courier.replace('Поток статусов курьерской службы', 'Поток статусов курьерской службы; срок хранения истёк'), ROW.returns])), TCS)).length === 0)
  ok('truth: caseRe не у named — ошибка', (() => { try { parseTruth({ ...ST_POS, places: [{ ...ST_PLACES[0], caseRe: 'x' }, ST_PLACES[1]] }); return false } catch { return true } })())

  // Все места одной строкой «A (→ x), B (→ y, значение), C (→ z)»: значение относится к сегменту своего места.
  const oneLine = (a) => specWith(['### 6.2. Обратная совместимость',
    `- 🔵 по \`services/shipments.md\`: поток курьерской службы (→ как до правки${a}), ручка \`POST /internal/shipments/{id}/cancel\` (→ номер возврата), задача закрытия просроченных отправлений (→ как до правки), поток возвратов со склада (→ как до правки).`].join('\n'))
  const subst = (g) => failed(g).filter((n) => !g.m.find((x) => x.name === n).form)
  const gl = gradeSpec(oneLine(''), T)
  ok('сегменты, хороший: значение у места со значением в его сегменте → зелёный, «своей строкой» — только форма',
    isGreen(gl) && failed(gl).join('|') === 'каждое место своей строкой')
  const glb = gradeSpec(oneLine(', номер возврата'), T)
  ok('сегменты, плохой: то же значение и у потока курьерской службы → красный «выдумано 0» по нему одному',
    !isGreen(glb) && subst(glb).join('|') === 'выдумано 0' && glb.m.find((x) => x.name === 'выдумано 0').detail === 'courier: номер возврата')

  // Границы §6.2: зачёркнутый заголовок и конец на следующем `###`.
  ok('§6.2: `### ~~6.2.` опознан, `### 6.3.` его закрывает',
    rows62(sec62('### ~~6.2. Обратная совместимость~~\n~~Не применимо: новая ручка~~\n### 6.3. Флаги\nпросроченн')).join('|') === '~~Не применимо: новая ручка~~')
  ok('§6.2 нет → места не найдены, диагностика «§6.2 нет»',
    (() => { const g = gradeSpec('# Т\n## 6. Релиз\n### 6.1. Выкат\nпросроченных\n', T); return failed(g).includes('мест найдено') && g.diag.includes('§6.2 нет') })())

  const TN = parseTruth({ ...ST_POS, kind: 'no-change', places: [], valued: null, valueTokens: [], forbidden: ST_PLACES }, 'selftest')
  ok('no-change зелёный: §6.2 «не применимо»',
    failed(gradeSpec(specWith('### ~~6.2. Обратная совместимость~~\n~~Не применимо: новая ручка, существующих потребителей нет~~'), TN)).length === 0)
  ok('красный: no-change с перечнем → «мест существующего события 0»',
    failed(gradeSpec(specWith(table62(ALL)), TN)).includes('мест существующего события 0'))

  const TO = parseTruth({ ...ST_POS, kind: 'one-place', places: [ST_PLACES[0]], valued: null, forbidden: ST_PLACES.slice(1) }, 'selftest')
  ok('one-place зелёный: одно место без значения', failed(gradeSpec(specWith(table62([ROW.cancel.replace('номер возврата — по FR-1', 'по FR-1')])), TO)).length === 0)
  ok('красный: one-place с лишними местами → «лишних мест 0»',
    only(gradeSpec(specWith(table62([ROW.cancel.replace('номер возврата — по FR-1', 'по FR-1'), ROW.courier])), TO), 'лишних мест 0'))

  // `allow`: у курьерского потока трек-номер законен (`named` принят валидатором и на метрики не влияет).
  const TA = parseTruth({ ...ST_POS, places: ST_PLACES.map((p) => (p.id === 'courier' ? { ...p, named: true, allow: ['трек-номер'] } : p)) }, 'selftest')
  const withCourier = (v) => specWith(table62([ROW.cancel, ROW.courier.replace('как до правки', v), ROW.expire, ROW.returns]))
  ok('allow, хороший: трек-номер у места с allow — зелёный; та же строка без allow — «выдумано 0»',
    failed(gradeSpec(withCourier('трек-номер'), TA)).length === 0 && only(gradeSpec(withCourier('трек-номер'), T), 'выдумано 0'))
  ok('allow, плохой: рядом значение вне allow → только «выдумано 0», в детали только оно',
    (() => { const g = gradeSpec(withCourier('трек-номер или id отправления'), TA); return only(g, 'выдумано 0') && g.m.find((x) => x.name === 'выдумано 0').detail === 'courier: id отправлени' })())

  // Место `valued`: своё значение (`valued.re`) законно, чужое из `valueTokens` — выдумка и у него.
  const withCancel = (v) => specWith(table62([ROW.cancel.replace('номер возврата — по FR-1', v), ROW.courier, ROW.expire, ROW.returns]))
  ok('valued, хороший: у места со значением его значение — зелёный', failed(gradeSpec(withCancel('номер возврата'), T)).length === 0)
  ok('valued, плохой: «номер возврата; после правки — id отправления» → только «выдумано 0»',
    (() => { const g = gradeSpec(withCancel('номер возврата; после правки — id отправления'), T); return only(g, 'выдумано 0') && g.m.find((x) => x.name === 'выдумано 0').detail === 'cancel: id отправлени' })())

  // Неопознанное место: похоже на место, но не из places/trap/forbidden. Цвет не меняет, у one-place печатает текст.
  ok('неопознанных, хороший: зелёный образец — 0', green.diag.includes('неопознанных мест в §6.2: 0'))
  const inventedPlace = '| Поток сверки остатков `stock.reconcile.daily` | как до правки | 🔵 `services/shipments.md` |'
  const gu = gradeSpec(specWith(table62([ROW.cancel.replace('номер возврата — по FR-1', 'по FR-1'), inventedPlace])), TO)
  ok('неопознанных, плохой: выдуманный поток у one-place — 1 с текстом, цвет прежний',
    failed(gu).length === 0 && gu.diag.some((d) => d.startsWith('неопознанных мест в §6.2: 1 — «| Поток сверки остатков')))

  const TS = parseTruth(ST_SB, 'selftest')
  const CANCEL = '`POST /internal/shipments/{id}/cancel`'
  const s01 = (body) => stageFile('01', 'Номер возврата в событии отмены', 'В поле `externalRef` события отмены уходит номер возврата.', body)
  const s02 = (body) => stageFile('02', 'Экран истории отправления', 'Показывает историю статусов отправления.', body)
  const s03 = (body) => stageFile('03', 'Журнал отмен', 'Пишет журнал отмен для поддержки.', body)
  ok('stage зелёный: места в этапе правки, в этапе истории — нет',
    failed(gradeStages([s01([CANCEL, ...COMPAT]), s02(['`GET /shipments/{id}/history`'])], TS)).length === 0)
  const sr = failed(gradeStages([s01([CANCEL]), s02(['`GET /shipments/{id}/history`', ...COMPAT])], TS))
  ok('красный: места не в том этапе → «в этапах без правки мест 0» (и «несёт все места»)',
    sr.includes('в этапах без правки мест 0') && sr.includes('этап с правкой несёт все места'))
  // Три этапа: один with и два without.
  ok('stage, три этапа, зелёный: места только в этапе правки',
    failed(gradeStages([s01([CANCEL, ...COMPAT]), s02([]), s03([])], TS)).length === 0)
  const r3 = gradeStages([s01([CANCEL, ...COMPAT]), s02([]), s03(COMPAT)], TS)
  ok('stage, три этапа, красный: места во втором without → только «в этапах без правки мест 0», этап и места названы',
    only(r3, 'в этапах без правки мест 0') && /^stage-03.md: cancel, courier, expire, returns$/.test(r3.m.find((x) => x.name === 'в этапах без правки мест 0').detail))
  const s04 = stageFile('04', 'Миграция данных', 'Переносит старые записи.', [])
  const g4 = gradeStages([s01([CANCEL, ...COMPAT]), s02([]), s03([]), s04], TS)
  ok('stage: неопознанный этап — в диагностику, цвет прежний',
    failed(g4).length === 0 && g4.diag.includes('неопознанных этапов 1 (stage-04.md)'))
  ok('stage: один общий этап — другой разрез, не измерено',
    /другой разрез/.test(gradeStages([s01([CANCEL, ...COMPAT])], TS).why ?? ''))
  ok('stage: этап под обоими регэкспами (правка слита с историей) — другой разрез, не измерено',
    /ловят оба/.test(gradeStages([stageFile('01', 'Номер возврата и экран истории', 'Всё сразу.', COMPAT), s03([])], TS).why ?? ''))
  ok('stage: голова — заголовок и owns', stageFields(s02([]).text).join('|') === '# Этап 02 — Экран истории отправления|')
  // «Что делает» этапа истории называет номер возврата: голова его не видит, утечка не прячется в этап правки.
  const s02both = (body) => stageFile('02', 'Экран истории отправления', 'Показывает историю, в том числе номер возврата.', body)
  ok('stage: «Что делает» не решает — этап истории остаётся without, утечка поймана',
    stageSide(s02both([]).text, TS.stage) === 'without'
    && failed(gradeStages([s01([CANCEL, ...COMPAT]), s02both(COMPAT)], TS)).includes('в этапах без правки мест 0'))

  // Исходы без артефакта.
  ok('подмена: спека в answer.md → не измерено', noArtifact('positive', '# Техническая спецификация: x\n## 6.', '').out === 'skip')
  ok('подмена этапа: фронтматтер этапа в answer.md → не измерено', noArtifact('stage', '---\ntype: stage\n---\n# Этап 01', '').out === 'skip')
  ok('вопросы в последнем ходе → «вопросы»', noArtifact('positive', 'Ход 1.\nКакой номер задачи?', 'Какой номер задачи?').out === 'q')
  ok('«?» в инлайн-коде — не вопрос; отчёт о файле без файла — ✗ фантом',
    (() => { const r = noArtifact('positive', 'Спека записана: `coddoc/SHP-7/technical_specification.md?`', 'Спека записана: `coddoc/SHP-7/technical_specification.md?`'); return r.out === 'fail' && /фантом/.test(r.m[0].detail) })())

  // Истина: битая форма роняет грейд.
  const throws = (f) => { try { f(); return false } catch { return true } }
  ok('truth: valued.place вне places — ошибка', throws(() => parseTruth({ ...ST_POS, valued: { place: 'nope', re: 'x' } })))
  ok('truth: битый регэксп — ошибка', throws(() => parseTruth({ ...ST_POS, trap: [{ id: 'x', re: '(' }] })))
  ok('truth: no-change без forbidden — ошибка', throws(() => parseTruth({ ...ST_POS, kind: 'no-change', forbidden: [] })))
  ok('truth: places[].allow не массивом — ошибка', throws(() => parseTruth({ ...ST_POS, places: [{ ...ST_PLACES[0], allow: 'x' }, ST_PLACES[1]] })))
  return res
}

function selftest(verbose) {
  const res = selftestChecks()
  const bad = res.filter(([, pass]) => !pass)
  if (verbose) for (const [name, pass] of res) console.log(`${pass ? '  ok  ' : '  FAIL'} ${name}`)
  else for (const [name] of bad) console.log(`  FAIL ${name}`)
  console.log(bad.length ? `самотест ПРОВАЛЕН: ${bad.length} из ${res.length}` : `самотест: ✓ (${res.length})`)
  return bad.length
}

// ─── Main ────────────────────────────────────────────────────────────────────────────────────

// Импорт модуля (сверка truth новой фикстуры: `parseTruth`) грейд не запускает; регистр пути — как в grade-gaps.mjs.
const isMain = !!process.argv[1] && import.meta.url.toLowerCase() === pathToFileURL(resolve(process.argv[1])).href.toLowerCase()
if (isMain) main()

function main() {
  const args = process.argv.slice(2)
  if (args.includes('--selftest')) process.exit(selftest(true) ? 1 : 0)
  const root = args.find((a) => !a.startsWith('--'))
  const fx = (args.find((a) => a.startsWith('--fx=')) ?? '').slice(5)
  if (!root || !fx) {
    console.error('usage: node grade-occ.mjs <плечо с run-NN/> --fx=<ФИКСТУРА>\n       node grade-occ.mjs --selftest')
    process.exit(2)
  }
  if (selftest(false)) process.exit(1)
  const truthPath = join(HERE, 'fixtures', fx, 'truth-occ.json')
  if (!existsSync(truthPath)) { console.error(`нет истины: ${truthPath}`); process.exit(2) }
  const T = parseTruth(readFileSync(truthPath, 'utf8'), truthPath)
  if (!existsSync(root)) { console.error(`нет плеча: ${root}`); process.exit(2) }

  const runs = readdirSync(root).filter((d) => /^run-\d+$/.test(d)).sort()
  console.log(`плечо: ${root}\nфикстура: ${fx} (${T.kind}${T.probe ? `, ${T.probe}` : ''})`)
  const tot = new Map()
  let green = 0, red = 0, qs = 0, skip = 0
  for (const r of runs) {
    const g = gradeRun(join(root, r), T)
    if (g.out === 'skip') { skip += 1; console.log(`${r}: не измерено: ${g.why}`); continue }
    const fm = (g.m ?? []).filter((x) => x.form)
    const form = fm.length ? [`форма: ${fm.map((x) => `${x.form} ${x.ok ? '✓' : `✗${x.detail ? ` (${x.detail})` : ''}`}`).join(', ')}`] : []
    const diag = [...form, ...(g.diag ?? [])].length ? `  · ${[...form, ...(g.diag ?? [])].join(' · ')}` : ''
    if (g.out === 'q') { qs += 1; console.log(`${r}: вопросы${diag}`); continue }
    for (const x of g.m) {
      const key = x.form ? `\u0000${x.form}` : x.name
      const c = tot.get(key) ?? [0, 0]; c[1] += 1; if (x.ok) c[0] += 1; tot.set(key, c)
    }
    if (g.out === 'pass') { green += 1; console.log(`${r}: ✓${diag}`); continue }
    red += 1
    console.log(`${r}: ✗ ${g.m.filter((x) => !x.ok && !x.form).map((x) => (x.detail ? `${x.name} (${x.detail})` : x.name)).join(', ')}${diag}`)
  }
  console.log('итоги (знаменатель — прогоны, где метрика мерилась; цвет — по сути):')
  const forms = [...tot].filter(([key]) => key.startsWith('\u0000'))
  for (const [name, [k, n]] of tot) if (!name.startsWith('\u0000')) console.log(`  ${k}/${n}\t${name}`)
  console.log(`  ${green}/${green + red}\tзелёных  (прогонов ${runs.length}: вопросы ${qs}, не измерено ${skip})`)
  if (forms.length) console.log(`  форма (цвет не меняет): ${forms.map(([key, [k, n]]) => `${key.slice(1)} ${k}/${n}`).join(', ')}`)
}
