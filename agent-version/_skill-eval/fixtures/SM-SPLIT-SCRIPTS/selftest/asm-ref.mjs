// Эталонная склейка по контракту — только для самопроверки стенда (test-split-scripts.sh --selftest):
// прогнать проверки на заведомо верном исполнителе. С assemble.sh скилла не связана и его не читала.
//   node asm-ref.mjs <папка частей> <S> <дата> <черновик> <опись>
import fs from 'node:fs'
import path from 'node:path'
import { parseCard, splitBlocks, tableOf, lf, normKey, blockCmp, rowCmp, sumTotals, PART_SECTIONS, callBare } from '../asm-lib.mjs'

const [, , dir, S, date, draftOut, opisOut] = process.argv
// SM_REF_BUG — намеренные порчи эталона, чтобы убедиться, что проверки краснеют: nodedup, sortplain, keepstubs, nosum, nodate, lastbody
const BUG = new Set(String(process.env.SM_REF_BUG || '').split(',').filter(Boolean))
const nn = (i) => String(i).padStart(2, '0')
const files = ['head.md', ...Array.from({ length: +S }, (_, i) => [`part-${nn(i + 1)}.md`, `part-${nn(i + 1)}.opis.md`]).flat()]
if (fs.existsSync(path.join(dir, 'head.opis.md'))) files.push('head.opis.md')
const text = {}
for (const f of files) {
  const p = path.join(dir, f)
  if (!fs.existsSync(p)) { console.log(`ОТКАЗ: нет файла ${f}`); process.exit(3) }
  const t = lf(fs.readFileSync(p, 'utf8'))
  const first = t.split('\n')[0]
  const who = f.startsWith('head') ? 'голова' : `часть ${f.slice(5, 7)}`
  const mark = first.trim().match(/^<!-- service-map: часть (\d+) (\S+) -->$/)
  const fresh = f.startsWith('head') ? first.trim() === `<!-- service-map: голова ${date} -->` : mark && Number(mark[1]) === Number(f.slice(5, 7)) && mark[2] === date
  if (!BUG.has('nodate') && !fresh) { console.log(`ОТКАЗ: ${f} — первая строка «${first.slice(0, 60)}», ждал свежесть ${who} ${date}`); process.exit(3) }
  text[f] = t.split('\n').slice(1).join('\n')
}
const head = parseCard(text['head.md'])
const parts = Array.from({ length: +S }, (_, i) => parseCard(text[`part-${nn(i + 1)}.md`]))
// L7: секции частей без метки у головы
const marked = new Set(head.sections.filter((s) => s.lines.some((l) => l.trim() === '<!-- части -->')).map((s) => s.name))
const headNames = new Set(head.sections.map((s) => s.name))
parts.forEach((p, i) => { for (const ps of p.sections) {
  if (marked.has(ps.name)) continue
  const { pre, blocks } = splitBlocks(ps.lines)
  if (!blocks.length && !tableOf(pre).rows.length) continue
  if (PART_SECTIONS.test(ps.name)) { console.log(`ОТКАЗ: голова — в каркасе нет метки в секции «${ps.name}»`); process.exit(3) }
  if (!headNames.has(ps.name)) { console.log(`ОТКАЗ: часть ${nn(i + 1)} — секция «${ps.name}» не из шаблона`); process.exit(3) }
  console.log(`отброшено: секция «${ps.name}» у части ${nn(i + 1)} — её пишет голова`)
} })
const out = [...head.preamble]
const blocksBySec = {}; const dups = []
for (const s of head.sections) {
  out.push(s.head)
  const at = s.lines.findIndex((l) => l.trim() === '<!-- части -->')
  if (at < 0) { out.push(...s.lines); continue }
  const seen = new Map(); const rows = []; const stubs = []
  // L6: ключи секции у всех частей — чтобы свести «вызовом» и «без скобок»
  const allKeys = new Set(parts.flatMap((p) => p.sections.filter((x) => x.name === s.name).flatMap((ps) => splitBlocks(ps.lines).blocks.map((b) => normKey(b.heading)))))
  const canon = (k) => (/^Публичный (контракт|API)/.test(s.name) && callBare(k) !== k && allKeys.has(callBare(k)) ? callBare(k) : k)
  for (const p of parts) {
    for (const ps of p.sections.filter((x) => x.name === s.name)) {
      const { pre, blocks } = splitBlocks(ps.lines)
      const t = tableOf(pre)
      for (const r of t.rows) if (!rows.includes(r)) rows.push(r)
      for (const l of t.other) if (l.trim() === '—' || /^не определено/.test(l.trim())) stubs.push(l.trim())
      for (const b of blocks) {
        const k = canon(normKey(b.heading))
        if (BUG.has('nodup') || BUG.has('nodedup')) { seen.set(k + '#' + seen.size, { heading: b.heading, body: [...b.body] }); continue }
        if (!seen.has(k)) { seen.set(k, { heading: b.heading, body: [...b.body] }); continue }
        const cur = seen.get(k); if (BUG.has('lastbody')) { cur.heading = b.heading; cur.body = [...b.body] } if (!dups.includes(`${s.name}: ${k}`)) dups.push(`${s.name}: ${k}`)
        const have = new Set(cur.body.filter((l) => /^- /.test(l)))
        const add = b.body.filter((l) => /^- /.test(l) && !have.has(l))
        let last = -1; cur.body.forEach((l, i) => { if (/^- /.test(l)) last = i })
        cur.body.splice(last < 0 ? cur.body.length : last + 1, 0, ...add)
      }
    }
  }
  const blocks = [...seen.values()].sort((a, b) => (BUG.has('sortplain') ? (normKey(a.heading) < normKey(b.heading) ? -1 : 1) : blockCmp(s.name)(a.heading, b.heading)))
  blocksBySec[s.name] = blocks.length
  const ins = []
  blocks.forEach((b, i) => { if (i) ins.push(''); ins.push(b.heading, ...b.body) })
  rows.sort(rowCmp(s.name)); ins.push(...rows)
  if (BUG.has('keepstubs') && (blocks.length || rows.length)) ins.push(...stubs)
  if (!blocks.length && !rows.length) ins.push(...(stubs.length ? [...new Set(stubs)] : ['—']))
  out.push(...s.lines.slice(0, at), ...ins, ...s.lines.slice(at + 1))
}
const opis = []; const totals = []
for (const f of ['head.opis.md', ...Array.from({ length: +S }, (_, i) => `part-${nn(i + 1)}.opis.md`)]) {
  if (!(f in text)) continue
  for (const l of text[f].split('\n')) { if (/^\s*⟹/.test(l)) totals.push(l); else opis.push(l) }
}
fs.writeFileSync(draftOut, out.join('\n'))
fs.writeFileSync(opisOut, [...opis, ...(BUG.has('nosum') ? totals : sumTotals(totals))].join('\n') + '\n')
console.log(`собрано: ${draftOut} из головы и ${S} частей`)
console.log(`блоков по секциям: ${Object.entries(blocksBySec).map(([k, v]) => `${k} ${v}`).join(', ')}`)
console.log(`дубли ключей склеены: ${dups.join('; ') || 'нет'}`)
