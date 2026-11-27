// Разбор карточки и правила склейки assemble.py — по контракту брифа стенда, БЕЗ чтения assemble.py.
// Общий для prep.mjs (круговой случай: режет карточку на голову и части) и check-assemble.mjs.
//
// Решения там, где контракт молчит (кандидаты в «неоднозначность контракта»):
//  L1. Секции части — заголовки «## <Секция>» с тем же именем, что в голове.
//  L2. Блок — от «### » до следующего «### »/«## »; хвостовые пустые строки блоку не принадлежат.
//  L3. Строки таблицы — строки на «|»; заголовок таблицы — первая строка, за которой идёт разделитель
//      «|---|…»; у головы он стоит над «<!-- части -->».
//  L4. Ключ блока: текст после «### » до первого « — », без бэктиков и «», пробелы схлопнуты, первое
//      слово — HTTP-глагол — заглавными.
//  L5. «Первый» из дублей — по номеру части (01 раньше 02).
//  L6. Ключ контракта вызовом («query task(id: ID!)», «Svc.Assign(Req)» — скобка без пробела перед ней, не у
//      HTTP-ключа) — тот же ключ, что без скобок, если без скобок он есть у какой-то части: один блок.
//  L7. Блоки или строки части в секции, где у головы нет метки: секция из набора частей (PART_SECTIONS) —
//      отказ с «голова»; секция есть у головы, но не из набора, — отбрасывается; иначе — отказ с «часть NN».
export const PART_SECTIONS = /^(Публичный (контракт|API)|Владеет данными|События|Фоновые задачи|Бизнес-правила|Потребляемые API)/
export const callBare = (k) => (/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) /.test(k) || !/[^ (]\(.*\)$/.test(k) ? k : k.replace(/\(.*\)$/, ''))
export const BLOCK_SECTIONS = ['Бизнес-правила', 'Публичный контракт', 'События', 'Фоновые задачи', 'Владеет данными', 'Публичный API']
export const TABLE_SECTIONS = ['Зависит от', 'Потребляемые API', 'Экраны']
const VERB = /^(get|post|put|patch|delete|head|options)$/i

export const lf = (s) => s.replace(/\r\n/g, '\n')
export const cmpBytes = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))

export function normKey (heading) {
  let t = heading.replace(/^###\s+/, '')
  const i = t.indexOf(' — ')
  if (i >= 0) t = t.slice(0, i)
  t = t.replace(/[`«»]/g, '').replace(/\s+/g, ' ').trim()
  const sp = t.indexOf(' ')
  const first = sp < 0 ? t : t.slice(0, sp)
  if (VERB.test(first)) t = first.toUpperCase() + (sp < 0 ? '' : t.slice(sp))
  return t
}

// карточка → преамбула + секции по «## »
export function parseCard (text) {
  const lines = lf(text).split('\n')
  const out = { preamble: [], sections: [] }
  let cur = null
  for (const l of lines) {
    if (/^## /.test(l)) { cur = { name: l.slice(3).trim(), head: l, lines: [] }; out.sections.push(cur); continue }
    if (cur) cur.lines.push(l); else out.preamble.push(l)
  }
  return out
}

export function splitBlocks (lines) {
  const pre = []; const blocks = []
  let cur = null
  for (const l of lines) {
    if (/^### /.test(l)) { cur = { heading: l, body: [] }; blocks.push(cur); continue }
    if (cur) cur.body.push(l); else pre.push(l)
  }
  for (const b of blocks) while (b.body.length && !b.body[b.body.length - 1].trim()) b.body.pop()
  return { pre, blocks }
}

export const isSep = (l) => /^\|\s*:?-{2,}/.test(l.trim())
export function tableOf (lines) {
  const t = lines.filter((l) => l.trim().startsWith('|'))
  let header = null; let sep = null; const rows = []
  for (let i = 0; i < t.length; i++) {
    if (!sep && isSep(t[i])) { sep = t[i]; continue }
    if (!header && !sep && i + 1 < t.length && isSep(t[i + 1])) { header = t[i]; continue }
    rows.push(t[i])
  }
  return { header, sep, rows, other: lines.filter((l) => l.trim() && !l.trim().startsWith('|')) }
}

const firstCell = (row) => row.split('|')[1]?.trim() ?? ''
const twoCells = (row) => { const c = row.split('|'); return [(c[1] || '').trim(), (c[2] || '').trim()] }
export function rowCmp (section) {
  if (section === 'Потребляемые API') return (a, b) => { const x = twoCells(a), y = twoCells(b); return cmpBytes(x[0], y[0]) || cmpBytes(x[1], y[1]) }
  return (a, b) => cmpBytes(firstCell(a), firstCell(b))
}

// порядок блоков по контракту
export function blockCmp (section) {
  if (section === 'Публичный контракт') {
    const split = (k) => { const m = k.match(/^([A-Z]+) (\S.*)$/); return m && VERB.test(m[1]) ? [m[2], m[1]] : [k, ''] }
    return (a, b) => { const x = split(normKey(a)), y = split(normKey(b)); return cmpBytes(x[0], y[0]) || cmpBytes(x[1], y[1]) }
  }
  if (section === 'Бизнес-правила') {
    const grp = (k) => (/^сообщение /.test(k) ? 1 : /^ограничение /.test(k) ? 2 : 0)
    return (a, b) => { const x = normKey(a), y = normKey(b); return grp(x) - grp(y) || cmpBytes(x, y) }
  }
  return (a, b) => cmpBytes(normKey(a), normKey(b))
}

// ⟹-строка → форма и числа
export function shapeOf (line) {
  const nums = []
  const shape = line.trim().replace(/\s+/g, ' ').replace(/\d+/g, (m) => { nums.push(Number(m)); return '#' })
  return { shape, nums }
}
export function sumTotals (lines) {
  const order = []; const acc = new Map()
  for (const l of lines) {
    const { shape, nums } = shapeOf(l)
    if (!acc.has(shape)) { acc.set(shape, nums.map(() => 0)); order.push(shape) }
    const a = acc.get(shape); nums.forEach((n, i) => { a[i] += n })
  }
  return order.map((s) => { let i = 0; const a = acc.get(s); return s.replace(/#/g, () => String(a[i++])) })
}
