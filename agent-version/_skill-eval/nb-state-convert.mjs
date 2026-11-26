#!/usr/bin/env node
// nb-state-convert.mjs — перевод засевов ноута в форму analyst-notebook 2.0.0 (PLAN-NOTEBOOK-STATE.md, «Форма строки»):
// номер у каждого пункта, связи номером, пометки состояния на старой строке.
//
//   node nb-state-convert.mjs notebook <путь к notebook.md>... [--write]
//   node nb-state-convert.mjs points <путь к *.points.md> <путь к ноуту-источнику в СТАРОЙ форме> [--write]
//
// Без --write печатает итог и строки, которые не удалось разрешить. Разрешение «начала в кавычках» и стороны спора —
// по словам: пункт записи, чей текст начинается с текста в кавычках; не нашёлся — самый похожий, и строкой в отчёте.
// Ответ на спор без `вместо:` оспоренного получает его (Р2а: ответ на спор всегда заменяет оспоренный).
import { readFileSync, writeFileSync } from 'node:fs'

const lf = (s) => s.replace(/\r\n/g, '\n')
const norm = (s) => s.toLowerCase().replace(/ё/g, 'е')
const words = (s) => norm(s).split(/[^a-zа-я0-9%]+/).filter(Boolean)
const flat = (s) => words(s).join(' ')
const stemSet = (s) => new Set(words(s).filter((x) => x.length >= 3).map((x) => x.slice(0, 5)))
const sim = (a, b) => { const A = stemSet(a); const B = stemSet(b); if (!A.size || !B.size) return 0; let n = 0; for (const x of A) if (B.has(x)) n++; return n / (A.size + B.size - n) }

const ITEM = /^- \[([^\]]+)\] (.*)$/
const LINK = /;\s*(вместо|отвечает на):\s*(\d{4}-\d{2}-\d{2}),?\s*№\s*(\d+)(?:\.(\d+))?\s*(?:[«"“]([^»"”]*)[»"”])?/g
const SIDE = /\(([^()]*?),\s*(\d{4}-\d{2}-\d{2}),?\s*№\s*(\d+)(?:\.(\d+))?\)/
const textOf = (body) => body.replace(LINK, '').replace(/\s*·\s*\d{4}-\d{2}-\d{2} №\d+\.\d+.*$/, '').trim()

function parse (text) {
  const lines = lf(text).split('\n')
  const items = []
  let date = null; let entry = null; let pos = 0; let inFront = lines[0] === '---'
  lines.forEach((l, i) => {
    if (inFront) { if (i > 0 && l === '---') inFront = false; return }
    let m
    if ((m = l.match(/^## (\d{4}-\d{2}-\d{2})\s*$/))) { date = m[1]; entry = null; return }
    if ((m = l.match(/^### (\d+)/))) { entry = Number(m[1]); pos = 0; return }
    if ((m = l.match(ITEM)) && date && entry) {
      pos++
      items.push({ i, date, entry, pos, kind: m[1], body: m[2], id: `${date} №${entry}.${pos}`, marks: [] })
    }
  })
  return { lines, items }
}

function resolve (items, date, entry, quote, self, report) {
  const cand = items.filter((x) => x.date === date && x.entry === entry && x !== self)
  if (!cand.length) { report.push(`нет записи ${date} №${entry} для «${quote ?? ''}» (строка ${self.i + 1})`); return null }
  if (cand.length === 1 && !quote) return cand[0]
  if (quote) {
    const q = flat(quote)
    const hit = cand.filter((x) => flat(textOf(x.body)).startsWith(q))
    if (hit.length === 1) return hit[0]
    if (hit.length > 1) report.push(`«${quote}» — начало ${hit.length} пунктов ${date} №${entry}, взят первый (строка ${self.i + 1})`)
    if (hit.length) return hit[0]
    const best = cand.map((x) => [sim(textOf(x.body), quote), x]).sort((a, b) => b[0] - a[0])[0]
    report.push(`«${quote}» — не начало ни одного пункта ${date} №${entry}; по сходству ${best[0].toFixed(2)}: ${best[1].id} (строка ${self.i + 1})`)
    return best[1]
  }
  report.push(`${date} №${entry} без кавычек, пунктов ${cand.length} — взят первый (строка ${self.i + 1})`)
  return cand[0]
}

export function convertNotebook (text) {
  const report = []
  const { lines, items } = parse(text)
  if (items.some((x) => /·\s*\d{4}-\d{2}-\d{2} №\d+\.\d+/.test(x.body))) return { text, report: ['уже в новой форме'] }
  for (const it of items) {
    let body = it.body
    const links = []
    body = body.replace(LINK, (m, kind, d, n, k, quote) => {
      const t = k ? items.find((x) => x.id === `${d} №${n}.${k}`) : resolve(items, d, Number(n), quote, it, report)
      if (!t) return m
      links.push({ kind, t })
      return `; ${kind}: ${t.id}`
    })
    // Спор: сторона `(<кто>, <дата> №<n>)` → номер оспоренного пункта.
    if (it.kind === 'открыто' && /что\s+верно/i.test(body)) {
      const sm = body.match(SIDE)
      if (sm) {
        const old = body.slice(body.search(/что\s+верно\s*:/i)).replace(/^что\s+верно\s*:\s*/i, '').split(' (')[0]
        const t = sm[4] ? items.find((x) => x.id === `${sm[2]} №${sm[3]}.${sm[4]}`) : resolve(items, sm[2], Number(sm[3]), old, it, report)
        if (t) {
          body = body.replace(SIDE, `(${sm[1]}, ${t.id})`)
          it.disputes = t
          t.marks.push({ at: it.i, m: `оспорен: ${it.id}` })
        }
      }
    }
    for (const { kind, t } of links) t.marks.push({ at: it.i, m: `${kind === 'вместо' ? 'заменён' : 'закрыт'}: ${it.id}` })
    it.links = links
    it.newBody = body
  }
  // Р2а: ответ на спор заменяет оспоренный, даже если выбрано старое.
  for (const it of items) {
    const ans = (it.links || []).find((l) => l.kind === 'отвечает на' && l.t.disputes)
    if (!ans) continue
    const disputed = ans.t.disputes
    if ((it.links || []).some((l) => l.kind === 'вместо' && l.t === disputed)) continue
    it.newBody = it.newBody.replace(/(;\s*отвечает на:\s*[^;·]+)/, `$1; вместо: ${disputed.id}`)
    disputed.marks.push({ at: it.i, m: `заменён: ${it.id}` })
    report.push(`ответ на спор ${it.id} без «вместо» оспоренного — дописано: вместо ${disputed.id}`)
  }
  for (const it of items) {
    const marks = it.marks.sort((a, b) => a.at - b.at).map((x) => ` ‖ ${x.m}`).join('')
    lines[it.i] = `- [${it.kind}] ${it.newBody.replace(/\s+$/, '')} · ${it.id}${marks}`
  }
  const active = items.filter((x) => !x.marks.length).length
  report.unshift(`пунктов: ${items.length}, действует: ${active}, с пометками: ${items.length - active}`)
  return { text: lines.join('\n'), report }
}

// Выгрузка из ноута: ` · <дата> №<n>` → номер пункта той записи, чей текст совпал с текстом строки.
export function convertPoints (text, oldNotebook) {
  const report = []
  const { items } = parse(oldNotebook)
  const out = lf(text).split('\n').map((l, i) => {
    const m = l.match(/^(- \[[^\]]+\] )(.*?)\s*·\s*(\d{4}-\d{2}-\d{2}) №(\d+)\s*$/)
    if (!m) return l
    const cand = items.filter((x) => x.date === m[3] && x.entry === Number(m[4]))
    const exact = cand.filter((x) => flat(textOf(x.body)) === flat(m[2]))
    const t = exact[0] || cand.map((x) => [sim(textOf(x.body), m[2]), x]).sort((a, b) => b[0] - a[0])[0]?.[1]
    if (!t) { report.push(`строка ${i + 1}: нет записи ${m[3]} №${m[4]}`); return l }
    if (!exact.length) report.push(`строка ${i + 1}: по сходству → ${t.id}`)
    return `${m[1]}${m[2]} · ${t.id}`
  })
  return { text: out.join('\n'), report }
}

function byOrder (text) {
  const seen = {}
  const out = lf(text).split('\n').map((l) => l.replace(/^(- \[[^\]]+\] .*?)\s*·\s*(\d{4}-\d{2}-\d{2}) №(\d+)\s*$/, (m, head, d, n) => {
    const key = `${d} №${n}`; seen[key] = (seen[key] || 0) + 1
    return `${head} · ${key}.${seen[key]}`
  }))
  return { text: out.join('\n'), report: ['номера по порядку строк записи (ноута-источника нет)'] }
}

function main () {
  const [mode, ...rest] = process.argv.slice(2)
  const write = rest.includes('--write')
  const args = rest.filter((a) => a !== '--write')
  if (mode === 'notebook') {
    for (const p of args) {
      const src = readFileSync(p, 'utf8')
      const { text, report } = convertNotebook(src)
      console.log(`== ${p}\n  ${report.join('\n  ')}`)
      if (write && text !== lf(src)) writeFileSync(p, text)
    }
  } else if (mode === 'points') {
    const [p, nb] = args
    // Ноута-источника в фикстуре нет (`-`) — номер по порядку строк той же записи в списке: выгрузка идёт в порядке ноута.
    const { text, report } = nb === '-' ? byOrder(readFileSync(p, 'utf8')) : convertPoints(readFileSync(p, 'utf8'), readFileSync(nb, 'utf8'))
    console.log(`== ${p}\n  ${report.join('\n  ') || 'всё по тексту'}`)
    if (write) writeFileSync(p, text)
  } else {
    console.error('usage: node nb-state-convert.mjs notebook <файлы>... [--write] | points <список> <ноут> [--write]')
    process.exit(1)
  }
}
main()
