// Проверка вывода assemble.py и promote.py по контракту брифа стенда (скрипты не читались).
import fs from 'node:fs'
import path from 'node:path'
import { parseCard, splitBlocks, tableOf, lf, normKey, blockCmp, rowCmp, isSep, BLOCK_SECTIONS, TABLE_SECTIONS } from './asm-lib.mjs'

const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null)
const nonEmpty = (lines) => lines.filter((l) => l.trim())
const isStub = (l) => /^\s*—\s*$/.test(l) || /^\s*не определено/.test(l)
const normT = (s) => s.trim().replace(/\s+/g, ' ')
const msetEq = (a, b) => { const x = [...a].sort(), y = [...b].sort(); return x.length === y.length && x.every((v, i) => v === y[i]) }
const msetDiff = (got, want) => {
  const g = [...got]; const lost = []
  for (const w of want) { const i = g.indexOf(w); if (i >= 0) g.splice(i, 1); else lost.push(w) }
  return `нет: [${lost.map((s) => s.slice(0, 50)).join(' ¦ ') || '—'}], лишнее: [${g.map((s) => s.slice(0, 50)).join(' ¦ ') || '—'}]`
}

function sectionMap (text) {
  const card = parseCard(text)
  const m = new Map()
  for (const s of card.sections) if (!m.has(s.name)) m.set(s.name, s)
  return { card, m }
}

// опись: ожидаемая последовательность строк без свежести и ⟹ — из файлов частей
function opisExpectedLines (partsDir, order) {
  const out = []
  for (const f of order) {
    const t = read(path.join(partsDir, f)); if (t === null) continue
    const lines = lf(t).split('\n')
    if (/^<!-- service-map:/.test(lines[0])) lines.shift()
    for (const l of lines) if (l.trim() && !/^\s*⟹/.test(l)) out.push(l.replace(/\s+$/, ''))
  }
  return out
}

function checkOpis (res, add, opisText, partsDir, exp, label = 'опись') {
  if (opisText === null) { add(`${label}: файл записан`, false, 'нет файла'); return }
  const lines = lf(opisText).split('\n')
  add(`${label}: без строк свежести`, !lines.some((l) => /<!-- service-map:/.test(l)), lines.find((l) => /<!-- service-map:/.test(l)) || '')
  const idxT = lines.map((l, i) => (/^\s*⟹/.test(l) ? i : -1)).filter((i) => i >= 0)
  const lastBody = lines.reduce((a, l, i) => (l.trim() && !/^\s*⟹/.test(l) ? i : a), -1)
  add(`${label}: строки ⟹ — в конце`, idxT.every((i) => i > lastBody), `⟹ на строках ${idxT.slice(0, 5).join(',')}, последняя строка тела ${lastBody}`)
  const got = idxT.map((i) => normT(lines[i]))
  const want = exp.totals.map(normT)
  add(`${label}: ⟹ просуммированы по форме`, msetEq(got, want), msetDiff(got, want))
  if (msetEq(got, want) && got.join('|') !== want.join('|')) res.push({ check: `${label}: порядок ⟹`, status: 'справочно', detail: `порядок иной, чем первое появление: ${got.join(' ¦ ')}` })
  const body = lines.filter((l) => l.trim() && !/^\s*⟹/.test(l)).map((l) => l.replace(/\s+$/, ''))
  const wantBody = opisExpectedLines(partsDir, exp.order)
  const same = body.length === wantBody.length && body.every((l, i) => l === wantBody[i])
  add(`${label}: списки головы и частей подряд`, same, same ? '' : (msetEq(body, wantBody) ? 'тот же набор строк, другой порядок' : msetDiff(body, wantBody)))
}

// строка «дубли ключей склеены: …» и следующие строки с отступом (вывод бывает в столбик)
function dupText (stdout) {
  const L = stdout.split('\n'); const out = []
  for (let i = 0; i < L.length; i++) {
    if (!/склеен/.test(L[i])) continue
    out.push(L[i])
    for (let k = i + 1; k < L.length && /^\s+\S/.test(L[k]); k++) out.push(L[k])
  }
  return out.join(' ')
}

function headingsOf (sec) { return sec ? splitBlocks(sec.lines).blocks.map((b) => b.heading) : [] }

// синтетический случай
export function checkAsmCase (ex, d) {
  const res = []
  const cat = ex.category === 'устойчивость' ? 'устойчивость' : 'ОШИБКА'
  const add = (check, ok, detail, status) => res.push({ check, status: ok ? 'ok' : (status || cat), detail: ok ? '' : detail })
  const stdout = (read(path.join(d, 'stdout')) || '') + '\n' + (read(path.join(d, 'stderr')) || '')
  const rc = Number(read(path.join(d, 'rc')))
  const draft = read(path.join(d, 'draft.md'))
  const opis = read(path.join(d, 'opis.md'))
  const partsDir = path.join(d, 'parts')
  if (ex.want === 'refuse') {
    add('код выхода 3', rc === 3, `код ${rc}`)
    add('строка «ОТКАЗ: …»', /ОТКАЗ:/.test(stdout), stdout.trim().split('\n').slice(0, 2).join(' / '))
    add('черновик не тронут', draft === 'СТОРОЖ: прежний черновик\n', draft === null ? 'файл удалён' : `содержимое заменено (${draft.length} байт)`)
    add('опись не записана', opis === null, 'файл описи создан')
    if (ex.mentions) add(`отказ называет виновного (${ex.mentions})`, new RegExp(ex.mentions).test(stdout), stdout.trim().split('\n').slice(0, 2).join(' / '))
    return res
  }
  if (ex.want === 'any') {
    res.push({ check: 'исход', status: 'справочно', detail: `код ${rc}; ${/ОТКАЗ:/.test(stdout) ? 'ОТКАЗ' : (draft ? 'собрано' : 'ничего не записано')}` })
    return res
  }
  add('код выхода 0', rc === 0, `код ${rc}; ${stdout.trim().split('\n').slice(0, 2).join(' / ')}`)
  add('без «ОТКАЗ»', !/ОТКАЗ:/.test(stdout), stdout.trim().split('\n').find((l) => /ОТКАЗ/.test(l)) || '')
  add('печатает «собрано: …»', /собрано:/.test(stdout), 'нет строки')
  if (ex.mentions) add(`в выводе есть «${ex.mentions}»`, new RegExp(ex.mentions).test(stdout), 'нет')
  if (draft === null) { add('черновик записан', false, 'нет файла'); return res }
  const head = lf(read(path.join(partsDir, 'head.md')) || '')
  const H = sectionMap(head); const G = sectionMap(lf(draft))
  add('метки «<!-- части -->» заменены', !/<!-- части -->/.test(draft), 'метка осталась')
  add('строки свежести частей не попали в черновик', !/<!-- service-map: часть/.test(draft), 'есть')
  const firstLine = lf(draft).split('\n')[0]
  res.push({ check: 'первая строка черновика', status: 'справочно', detail: /<!-- service-map: голова/.test(firstLine) ? 'строка свежести головы осталась первой (frontmatter уже не первая строка)' : `«${firstLine.slice(0, 40)}»` })
  const ho = H.card.sections.map((s) => s.name); const go = G.card.sections.map((s) => s.name)
  add('порядок секций — как в голове', ho.join('|') === go.join('|'), `голова: ${ho.join(', ')}; черновик: ${go.join(', ')}`)
  for (const [name, e] of Object.entries(ex.sections || {})) {
    const sec = G.m.get(name)
    if (!sec) { add(`«${name}»: секция есть`, false, 'нет секции'); continue }
    const { pre, blocks } = splitBlocks(sec.lines)
    if (e.headings) {
      const got = blocks.map((b) => b.heading)
      const ok = got.join('\n') === e.headings.join('\n')
      add(`«${name}»: заголовки ### и их порядок`, ok, msetEq(got, e.headings) ? `тот же набор, порядок: ${got.map(normKey).join(' · ')}` : msetDiff(got, e.headings))
    }
    if (e.noStub) add(`«${name}»: заглушки частей убраны`, !nonEmpty(pre).some(isStub) && !blocks.some((b) => b.body.some((l) => /^\s*—\s*$/.test(l))), `осталось: ${nonEmpty(pre).join(' / ')}`)
    if (e.stubOnly) add(`«${name}»: без блоков — заглушка «—»`, blocks.length === 0 && nonEmpty(sec.lines).some((l) => /^\s*—\s*$/.test(l)), `строки секции: ${nonEmpty(sec.lines).join(' / ') || '(пусто)'}`)
    if (e.mustLine) add(`«${name}»: строка «${e.mustLine.slice(0, 30)}…» осталась`, sec.lines.some((l) => l.trim() === e.mustLine), `строки секции: ${nonEmpty(sec.lines).join(' / ') || '(пусто)'}${e.mustLineAmbig ? ' — ' + e.mustLineAmbig : ''}`, e.mustLineAmbig ? 'неоднозначность' : undefined)
    if (e.rows) {
      const got = sec.lines.filter((l) => l.trim().startsWith('|')).map((l) => l.trim())
      add(`«${name}»: строки таблицы (заголовок один, дубль один раз, по первой ячейке)`, got.join('\n') === e.rows.join('\n'), `получено: ${got.join(' / ')}`)
    }
    if (e.rowsInclude) for (const r of e.rowsInclude) add(`«${name}»: строка ${r}`, sec.lines.some((l) => l.trim() === r), 'нет строки')
  }
  for (const [h, e] of Object.entries(ex.blocks || {})) {
    let found = null
    for (const s of G.card.sections) for (const b of splitBlocks(s.lines).blocks) if (b.heading === h) found = b
    if (!found) { add(`блок ${h}: есть`, false, 'нет блока'); continue }
    const got = nonEmpty(found.body)
    add(`блок ${h}: строки (заголовок и не-«- » от первого, «- » объединены без повторов)`, msetEq(got, e.lines), msetDiff(got, e.lines))
    for (const a of e.absent || []) add(`блок ${h}: нет «${a}»`, !got.includes(a), 'строка второй части попала в склейку')
  }
  for (const name of ex.unchanged || []) {
    const a = H.m.get(name); const b = G.m.get(name)
    add(`«${name}»: секция головы без изменений`, !!a && !!b && nonEmpty(a.lines).join('\n') === nonEmpty(b.lines).join('\n'), b ? 'текст отличается' : 'секции нет')
  }
  // пустая строка между блоками
  const L = lf(draft).split('\n'); const noBlank = []
  for (let i = 1; i < L.length; i++) if (/^### /.test(L[i]) && L[i - 1].trim() !== '' && !/^## /.test(L[i - 1])) noBlank.push(L[i].slice(0, 40))
  add('между блоками — пустая строка', noBlank.length === 0, `без пустой строки перед: ${noBlank.slice(0, 4).join(' · ')}`)
  // дубли в выводе
  const dupLines = dupText(stdout)
  const clean = (s) => s.replace(/[`«»]/g, '')
  if ((ex.dups || []).length) {
    const miss = ex.dups.filter((k) => !clean(dupLines).includes(clean(k)))
    add('«дубли ключей склеены: …» называет дубли', !!dupLines && miss.length === 0, dupLines ? `не названы: ${miss.join(', ')}; строка: ${dupLines.slice(0, 160)}` : 'строки нет')
  } else if (ex.dups) res.push({ check: 'строка о дублях без дублей', status: 'справочно', detail: dupLines ? dupLines.slice(0, 120) : 'нет' })
  const perSec = stdout.split('\n').filter((l) => /блок/i.test(l) && !/склеен/.test(l)).join(' / ')
  res.push({ check: 'блоков по секциям (вывод)', status: 'справочно', detail: perSec.slice(0, 200) || 'строки не нашёл' })
  if (ex.noCR) add('нет \\r в черновике и описи', !/\r/.test(draft) && !/\r/.test(opis || ''), `\\r: черновик ${(draft.match(/\r/g) || []).length}, опись ${((opis || '').match(/\r/g) || []).length}`)
  for (const i of ex.info || []) {
    const sec = G.m.get(i.section)
    res.push({ check: `«${i.section}»: ${i.what}`, status: 'справочно', detail: sec ? (nonEmpty(sec.lines).join(' / ') || '(пусто)') : 'секции нет' })
  }
  if (ex.opis) checkOpis(res, add, opis, partsDir, ex.opis)
  return res
}

// круговой случай: expect.json сгенерирован prep.mjs roundtrip
export function checkRoundtrip (ex, d) {
  const res = []
  const add = (check, ok, detail, status) => res.push({ check, status: ok ? 'ok' : (status || 'ОШИБКА'), detail: ok ? '' : detail })
  const stdout = (read(path.join(d, 'stdout')) || '') + '\n' + (read(path.join(d, 'stderr')) || '')
  const rc = Number(read(path.join(d, 'rc')))
  const draft = read(path.join(d, 'draft.md'))
  add('код выхода 0', rc === 0, `код ${rc}; ${stdout.trim().split('\n').slice(0, 2).join(' / ')}`)
  if (draft === null) { add('черновик записан', false, 'нет файла'); return res }
  const G = sectionMap(lf(draft)); const H = sectionMap(lf(read(path.join(d, 'parts', 'head.md'))))
  add('порядок секций как в карточке', G.card.sections.map((s) => s.name).join('|') === ex.order.join('|'), G.card.sections.map((s) => s.name).join(', '))
  let total = 0; let srcTotal = 0; let orderDiff = 0
  for (const [name, e] of Object.entries(ex.sections)) {
    const sec = G.m.get(name)
    const got = headingsOf(sec)
    total += got.length; srcTotal += e.headings.length
    if (!e.headings.length) {
      add(`«${name}»: заглушка источника`, !!sec && msetEq(nonEmpty(sec.lines).filter((l, i, a) => a.indexOf(l) === i), e.stub || []), sec ? nonEmpty(sec.lines).join(' / ') : 'нет секции')
      continue
    }
    add(`«${name}»: набор заголовков ### = исходный (${e.headings.length})`, msetEq(got, e.headings), msetDiff(got, e.headings))
    if (msetEq(got, e.headings)) add(`«${name}»: порядок по ключу (правило контракта)`, got.join('\n') === e.headings.join('\n'), `первое расхождение: «${got.find((h, i) => h !== e.headings[i])}» на месте «${e.headings.find((h, i) => h !== got[i])}»`)
    if (got.join('\n') !== e.sourceOrder.join('\n')) orderDiff++
  }
  add('заголовков ### всего = в исходной', total === srcTotal, `${total} против ${srcTotal}`)
  let badBlocks = 0; let lineOrder = 0; const firstBad = []
  for (const [key, want] of Object.entries(ex.blocks)) {
    const [name, h] = key.split(' :: ')
    const b = G.m.get(name) && splitBlocks(G.m.get(name).lines).blocks.find((x) => x.heading === h)
    const got = b ? nonEmpty(b.body) : null
    if (!got || !msetEq(got, want)) { badBlocks++; if (firstBad.length < 2) firstBad.push(`${h.slice(0, 50)}: ${got ? msetDiff(got, want) : 'нет блока'}`) } else if (got.join('\n') !== want.join('\n')) lineOrder++
  }
  add(`строки тел блоков = исходные (${Object.keys(ex.blocks).length} блоков)`, badBlocks === 0, `расходятся ${badBlocks}: ${firstBad.join(' | ')}`)
  add('строки «копия: …» вторых частей не попали', !/копия: другое описание/.test(draft), 'попали')
  res.push({ check: 'порядок строк внутри склеенных блоков', status: 'справочно', detail: `блоков с иным порядком строк при том же наборе: ${lineOrder}` })
  res.push({ check: 'порядок блоков против исходной карточки', status: 'справочно', detail: `секций, где порядок отличается от исходного: ${orderDiff} (у исходной «ограничение» раньше «сообщение»)` })
  for (const [name, e] of Object.entries(ex.rows)) {
    const sec = G.m.get(name)
    const t = sec ? tableOf(sec.lines) : { rows: [], header: null }
    const all = sec ? sec.lines.filter((l) => l.trim().startsWith('|')) : []
    add(`«${name}»: заголовок таблицы один`, all.filter((l) => l === e.header).length === 1 && all.filter(isSep).length === 1, `заголовков ${all.filter((l) => l === e.header).length}, разделителей ${all.filter(isSep).length}`)
    add(`«${name}»: строки = исходные, дубль один раз`, msetEq(t.rows, e.rows), msetDiff(t.rows, e.rows))
    const sorted = [...e.rows].sort(rowCmp(name))
    if (msetEq(t.rows, e.rows)) add(`«${name}»: строки по первой ячейке`, t.rows.join('\n') === sorted.join('\n'), t.rows.map((r) => r.split('|')[1].trim()).join(' · '))
  }
  for (const name of ex.unchanged) {
    const a = H.m.get(name); const b = G.m.get(name)
    add(`«${name}»: без изменений`, !!a && !!b && nonEmpty(a.lines).join('\n') === nonEmpty(b.lines).join('\n'), b ? 'текст отличается' : 'секции нет')
  }
  const dupLines = dupText(stdout).replace(/[`«»]/g, '')
  const allDups = Object.values(ex.dups).flat()
  const miss = allDups.filter((k) => !dupLines.includes(k.replace(/[`«»]/g, '')))
  add(`«дубли ключей склеены» называет все ${allDups.length}`, miss.length === 0, `не названы ${miss.length}: ${miss.slice(0, 3).join(', ')}`)
  checkOpis(res, add, read(path.join(d, 'opis.md')), path.join(d, 'parts'), ex.opis)
  return res
}

// promote.py: meta.json от раннера
export function checkPromote (d) {
  const res = []
  const meta = JSON.parse(read(path.join(d, 'meta.json')))
  const cat = meta.category || 'ОШИБКА'
  const add = (check, ok, detail, status) => res.push({ check, status: ok ? 'ok' : (status || cat), detail: ok ? '' : detail })
  const out = (read(path.join(d, 'stdout')) || '') + '\n' + (read(path.join(d, 'stderr')) || '')
  const rc = Number(read(path.join(d, 'rc')))
  const src = read(meta.draft) !== null ? fs.readFileSync(meta.draft) : null
  const dst = fs.existsSync(meta.dest) && fs.statSync(meta.dest).isFile() ? fs.readFileSync(meta.dest) : null
  if (meta.want === 'ok') {
    add('код 0', rc === 0, `код ${rc}; ${out.trim().split('\n').slice(-2).join(' / ')}`)
    add('«КОПИЯ ВЕРНА → <куда>»', /КОПИЯ ВЕРНА\s*→/.test(out), 'нет строки')
    add('копия байт-в-байт', !!src && !!dst && Buffer.compare(src, dst) === 0, dst ? `размер ${dst.length} против ${src.length}` : 'файла нет')
    for (const [what, n] of Object.entries(meta.counts || {})) {
      const hits = (out.match(new RegExp(`(?<!\\d)${n}(?!\\d)`, 'g')) || []).length
      res.push({ check: `счёт ${what} = ${n} напечатан для обоих`, status: hits >= 2 ? 'ok' : 'справочно', detail: hits >= 2 ? '' : `число ${n} встречается ${hits} раз; вывод: ${out.trim().split('\n').slice(0, 4).join(' / ')}` })
    }
  } else if (meta.want === 'diverge') {
    add('код 4', rc === 4, `код ${rc}; ${out.trim().split('\n').slice(-2).join(' / ')}`)
    add('«КОПИЯ РАСХОДИТСЯ — не записано»', /КОПИЯ РАСХОДИТСЯ/.test(out), 'нет строки')
    add('нет «КОПИЯ ВЕРНА»', !/КОПИЯ ВЕРНА/.test(out), 'есть')
    if (meta.before !== undefined) add('<куда> не тронут', dst !== null && dst.toString('utf8') === meta.before, dst === null ? 'файл исчез' : 'содержимое изменилось')
    else add('<куда> не создан', !fs.existsSync(meta.dest), 'создан')
  } else if (meta.want === 'injected') {
    if (!fs.existsSync(path.join(d, 'cp-used'))) { res.push({ check: 'подмена cp', status: 'справочно', detail: 'скрипт не зовёт cp из PATH — проверка не применима' }); return res }
    add('сбойная копия → код 4', rc === 4, `код ${rc}; ${out.trim().split('\n').slice(-2).join(' / ')}`)
    add('сбойная копия → «КОПИЯ РАСХОДИТСЯ»', /КОПИЯ РАСХОДИТСЯ/.test(out) && !/КОПИЯ ВЕРНА/.test(out), out.trim().split('\n').slice(-1)[0] || '')
    add('сбойная копия → <куда> не тронут', dst !== null && dst.toString('utf8') === meta.before, dst === null ? 'файл исчез' : 'прежняя карточка перезаписана')
  } else if (meta.want === 'not-ok') {
    const dirList = fs.existsSync(meta.dest) && fs.statSync(meta.dest).isDirectory() ? `папка, внутри: ${fs.readdirSync(meta.dest).join(', ') || 'пусто'}` : 'не папка'
    add('нет ложного «КОПИЯ ВЕРНА» (<куда> — папка, не копия)', !/КОПИЯ ВЕРНА/.test(out) || (dst !== null && src !== null && Buffer.compare(src, dst) === 0), `код ${rc}; «${out.trim().split('\n').slice(-1)[0]}»; <куда> ${dirList}`)
  } else {
    res.push({ check: 'исход', status: 'справочно', detail: `код ${rc}; ${out.trim().split('\n').slice(-2).join(' / ')}; <куда> ${fs.existsSync(meta.dest) ? (fs.statSync(meta.dest).isDirectory() ? 'папка' : 'файл') : 'нет'}${meta.extra && fs.existsSync(meta.extra) ? `; внутри папки появился ${path.basename(meta.extra)}` : ''}` })
  }
  return res
}

export { BLOCK_SECTIONS, TABLE_SECTIONS, blockCmp }
