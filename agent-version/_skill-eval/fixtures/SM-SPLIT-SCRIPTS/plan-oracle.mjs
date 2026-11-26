// Независимый оракул plan.py (service-map-2.0, задача Б). Написан по контракту брифа стенда,
// БЕЗ чтения plan.py и SKILL.md.
//
//   node plan-oracle.mjs <counts.txt> <K> <w> <корень>[,<корень>…] [--variant <имя>]
//      → печатает план в форме контракта (для глаз и отладки)
//   import { plan, VARIANTS } — для compare.mjs
//
// Контракт (кратко): блоки «## <класс> :: <ключ|ориентир>», строки «<путь>:<число>». Вес файла =
// Σ ключ + w × Σ ориентир; вес папки — сумма поддерева. Вес ключей ≤ K → «нарезка не нужна» (ориентир
// решения не меняет: части он только раскладывает).
// Иначе папки с ненулевым весом пакуются подряд в порядке путей (байтовая сортировка) в части ≤ K;
// папка тяжелее K режется по подпапкам рекурсивно, её собственные файлы с весом идут подряд частями
// «файлы» ≤ K; файл тяжелее K — отдельной частью; нулевые поддеревья — остаток; файлы вне корней в план
// не входят.
//
// Решения там, где контракт молчит (каждое — кандидат в «неоднозначность контракта»; у спорных есть
// вариант, и сравнение принимает любой вариант с пометкой, какой совпал):
//  O1. Итог по классам — сумма ВСЕХ строк counts (литерально «итоги по классам = суммы counts»),
//      в том числе вне корней. Вариант itog=inroot — только внутри корней.
//  O2. Общий вес W — только внутри корней («вне корней в план не входят»).
//  O3. Порядок папок — сортировка строк путей целиком, без хвостового «/» (sort=plain: «a» < «a-b» <
//      «a/x»). Варианты: sort=slash — путь + «/» («a-b/» < «a/»), sort=dfs — обход дерева, соседи по имени.
//  O4. Упаковка папок — одна последовательность на весь сервис, жадно «подряд» (next-fit).
//      Вариант pack=parent — отдельно внутри каждой разрезанной папки; pack=run — внутри папки, и
//      тяжёлая подпапка ещё и обрывает серию соседей («подряд» прерывается).
//  O5. Файл тяжелее K среди своих файлов обрывает текущую часть «файлы» (big=break). Вариант
//      big=extract — тяжёлые вынимаются, остальные пакуются подряд без разрыва.
//  O6. Корень, который сам ≤ K (бывает только при нескольких корнях), — единица «папки» целиком
//      (root=unit). Вариант root=expand — корень всегда режется на верхние папки.
//  O7. Пути сравниваются в канонической форме: «\» → «/», «/c/…» → «C:/…», буква диска заглавная.
//  O8. Там же: «//» → «/», «/./» убирается, «<папка>/..» раскрывается, хвостовой «/» снимается.
//  O9. Заголовок блока: «## класс :: ключ|ориентир» или «## класс :: регэксп :: маска :: ключ|ориентир»;
//      класс — первое поле, вид — последнее, пометка в скобках после вида на вид не влияет.
//  O10. Путь без корня («./src/…», «src/…») при одном корне считается от него; корней несколько — вне корней.
//  O11. Тестовые пути — от корня, без учёта регистра: папка test|tests в корне сервиса, src/test и
//       __tests__ на любой глубине, файлы *.test.*|*.spec.* с расширением js/jsx/ts/tsx/mjs/cjs и
//       *_test.go|py. В план и в общий вес не идут; в «итог по классам» идут. Пакет ru/bank/test и
//       openapi.spec.yaml тестами не считаются.
//  O12. Часть образуют только папки и файлы с пометками «ключ»; папки и файлы только с ориентиром —
//       остаток. Вес части по-прежнему ключ + w × ориентир по её путям. Ключей нет вовсе — «не нужна».
//  O14. Остаток списком (только в выводе, по дереву корней на диске): папка целиком вне частей —
//       «папка X» (самая верхняя такая), файл вне частей прямо в разрезанной папке — «файлы прямо в X».
//       Скрытые папки, node_modules, __pycache__ (на любой глубине), target, build, dist (только в
//       корне сервиса) и тестовые пути не идут.
//       Дерева нет или пунктов больше 60 — остаток назван словами. «к сверке» — итог без тестовых путей.
//  O13. Отказ (код 3, строка «ОТКАЗ: …», плана нет): заголовков нет или вид не ключ|ориентир; под
//       заголовком есть строка с путём к файлу без счёта в конце («….расш:текст» или путь со слешем,
//       кончающийся расширением); весь вес счёта вне корней; корень есть на диске, а файла счёта нет.
//       BOM в начале файла снимается.
import fs from 'node:fs'

export const canon = (p) => {
  let s = String(p).trim().replace(/\\/g, '/').replace(/\/+/g, '/')
  s = s.replace(/^\/([a-zA-Z])(\/|$)/, (_, d, e) => d.toUpperCase() + ':' + (e || '/'))
  s = s.replace(/^([a-zA-Z]):/, (_, d) => d.toUpperCase() + ':')
  // O8: «/./» убирается, «<папка>/..» раскрывается (выше корня не поднимается), хвостовой «/» снимается
  const m = s.match(/^([A-Z]:)?(\/)?(.*)$/)
  const head = (m[1] || '') + (m[2] || ''); const abs = !!m[2]
  const out = []
  for (const seg of m[3].split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') { if (out.length && out[out.length - 1] !== '..') out.pop(); else if (!abs) out.push('..'); continue }
    out.push(seg)
  }
  return head + out.join('/') || head || '.'
}

export const isTest = (rel) => {
  const s = '/' + String(rel).toLowerCase()
  if (s.startsWith('/test/') || s.startsWith('/tests/') || s.includes('/src/test/') || s.includes('/__tests__/')) return true
  const name = s.slice(s.lastIndexOf('/') + 1); const parts = name.split('.')
  if (parts.length >= 3 && ['test', 'spec'].includes(parts[parts.length - 2]) && ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'].includes(parts[parts.length - 1])) return true
  return name.endsWith('_test.go') || name.endsWith('_test.py')
}

// Windows-node читает временное дерево MSYS по явному отображению из раннера.
// Сами пути плана сохраняются: их нормализацию продолжает проверять оракул.
const diskPath = (p) => {
  const from = process.env.SM_SPLIT_FS_POSIX;
  const to = process.env.SM_SPLIT_FS_WIN;
  return from && to && (p === from || p.startsWith(from + '/')) ? to + p.slice(from.length) : p;
}
const unbom = (t) => String(t).replace(/^\uFEFF/, '')
// O13: заголовки — есть ли они и все ли по форме
export const badHeaders = (text) => {
  const hs = unbom(text).split(/\r?\n/).filter((l) => /^## /.test(l) && !/^## контроль\s*::/.test(l))
  if (!hs.length) return 'нет заголовков'
  const bad = hs.filter((l) => { const f = l.slice(3).split(' :: '); return f.length < 2 || !f[0].trim() || !['ключ', 'ориентир'].includes(f[f.length - 1].replace(/\s*\(.*$/, '').trim()) })
  return bad.length ? `заголовков не по форме: ${bad.length}` : ''
}
// O10: путь без корня — от единственного корня
export const resolve = (p, roots) => {
  const raw = String(p).trim().replace(/\\/g, '/')
  if (/^(\/|[A-Za-z]:)/.test(raw) || roots.length !== 1) return canon(raw)
  return canon(roots[0] + '/' + raw.replace(/^(\.\/)+/, ''))
}
export const badLines = (text) => {
  let cur = false; let n = 0
  for (const raw of unbom(text).split(/\r?\n/)) {
    if (/^##\s/.test(raw)) { cur = true; continue }
    if (!cur || /:\d+\s*$/.test(raw)) continue
    const looksLikeFile = raw.includes('/') || raw.includes('\\')
    if (/^[^\s#].*\.[A-Za-z0-9]+:/.test(raw) || (looksLikeFile && /\.[A-Za-z0-9]+\s*$/.test(raw))) n++
  }
  return n
}

export function parseCounts (text) {
  const lines = []
  let cur = null
  for (const raw of unbom(text).split(/\r?\n/)) {
    if (/^##\s+контроль\s*::/.test(raw)) { cur = null; continue }   // контроль разведчика — не класс счёта
    if (/^##\s/.test(raw)) {
      const h = raw.match(/^##\s+(.+?)\s*::.*::\s*(ключ|ориентир)(?:\s*\([^)]*\))?\s*$/) || raw.match(/^##\s+(.+?)\s*::\s*(ключ|ориентир)(?:\s*\([^)]*\))?\s*$/)
      if (h) cur = { cls: h[1].trim(), type: h[2] }
      continue
    }
    if (!cur) continue
    const m = raw.match(/^(.*\S):(\d+)\s*$/)
    if (!m) continue
    lines.push({ path: m[1].trim(), n: Number(m[2]), cls: cur.cls, type: cur.type })
  }
  return lines
}

const isAbs = (p) => /^([A-Z]:)?\//.test(p)
const cmpBytes = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return Buffer.compare(x, y) }

export const VARIANTS = {
  primary: { itog: 'all', sort: 'plain', pack: 'global', big: 'break', root: 'unit' },
  'sort=slash': { sort: 'slash' },
  'sort=dfs': { sort: 'dfs' },
  'pack=parent': { pack: 'parent' },
  'pack=run': { pack: 'run' },
  'big=extract': { big: 'extract' },
  'root=expand': { root: 'expand' },
  'itog=inroot': { itog: 'inroot' },
}
export const variant = (name) => ({ ...VARIANTS.primary, ...(VARIANTS[name] || {}) })

export function plan (countsText, K, w, rootsArg, opt = VARIANTS.primary) {
  const o = { ...VARIANTS.primary, ...opt }
  const roots = [...new Set((Array.isArray(rootsArg) ? rootsArg : String(rootsArg).split(',')).map((r) => canon(r)).filter(Boolean))]
  const lines = parseCounts(countsText)
  const keyClasses = []; const oriClasses = []
  for (const l of lines) {
    const list = l.type === 'ключ' ? keyClasses : oriClasses
    if (!list.includes(l.cls)) list.push(l.cls)
  }
  // файлы
  const files = new Map()
  let outside = 0; const outsideFiles = []
  const itogAll = { ключ: {}, ориентир: {} }; const itogIn = { ключ: {}, ориентир: {} }
  let tests = 0; const testsBy = { ключ: {}, ориентир: {} }; const ghostTests = []
  const dirOk = (d) => { try { return fs.statSync(diskPath(d)).isDirectory() } catch { return false } }
  for (const l of lines) {
    const p = resolve(l.path, roots)
    itogAll[l.type][l.cls] = (itogAll[l.type][l.cls] || 0) + l.n
    let ri = -1
    roots.forEach((r, i) => { if ((p === r || p.startsWith(r + '/')) && (ri < 0 || r.length > roots[ri].length)) ri = i })
    const lw = l.type === 'ключ' ? l.n : w * l.n
    if (ri < 0) { outside += lw; outsideFiles.push(p); continue }
    if (isTest(p.slice(roots[ri].length + 1))) { if (dirOk(roots[ri])) ghostTests.push(p); tests += lw; testsBy[l.type][l.cls] = (testsBy[l.type][l.cls] || 0) + l.n; continue }
    itogIn[l.type][l.cls] = (itogIn[l.type][l.cls] || 0) + l.n
    let f = files.get(p)
    if (!f) { f = { path: p, root: ri, w: 0, kw: 0, cls: {}, ori: {} }; files.set(p, f) }
    f.w += lw
    if (l.type === 'ключ') f.kw += l.n
    const bag = l.type === 'ключ' ? f.cls : f.ori
    bag[l.cls] = (bag[l.cls] || 0) + l.n
  }
  // дерево по корням
  const mkNode = (path, root, parent) => ({ path, root, parent, w: 0, kw: 0, dirs: new Map(), files: [] })
  const tops = roots.map((r, i) => mkNode(r, i, null))
  for (const f of files.values()) {
    let node = tops[f.root]
    const rel = f.path.slice(node.path.length + 1).split('/')
    node.w += f.w; node.kw += f.kw
    for (let i = 0; i < rel.length - 1; i++) {
      const sub = node.path + '/' + rel[i]
      if (!node.dirs.has(sub)) node.dirs.set(sub, mkNode(sub, f.root, node))
      node = node.dirs.get(sub); node.w += f.w; node.kw += f.kw
    }
    node.files.push(f)
  }
  const W = round(tops.reduce((a, t) => a + t.w, 0))
  const KW = tops.reduce((a, t) => a + t.kw, 0)
  const res = { K, w, W, KW: round(KW), itog: o.itog === 'all' ? itogAll : itogIn, keyClasses, oriClasses, outside: round(outside), outsideFiles, tests: round(tests), testsBy, itogAll, roots, parts: [], mode: KW <= K ? 'не нужна' : 'план' }
  const hb = badHeaders(countsText)
  if (hb) { res.mode = 'отказ'; res.reason = hb; return res }
  const nbad = badLines(countsText)
  const isDir = (d) => { try { return fs.statSync(diskPath(d)).isDirectory() } catch { return false } }
  const ghosts = [...files.values()].concat([]).filter((f) => isDir(roots[f.root]) && !fs.existsSync(diskPath(f.path)))
  if (!nbad && (ghosts.length || ghostTests.some((p) => !fs.existsSync(diskPath(p))))) { res.mode = 'отказ'; res.reason = 'путей счёта нет на диске'; return res }
  if (nbad) { res.mode = 'отказ'; res.reason = `счёт неполон — строк не по форме <путь>:<число>: ${nbad}`; return res }
  if (outside > 0 && W === 0 && tests === 0) { res.mode = 'отказ'; res.reason = 'все пути счёта вне корней сервиса'; return res }
  if (res.mode === 'не нужна') return res

  const covered = (node) => { const out = []; const walk = (n) => { out.push(...n.files); for (const d of n.dirs.values()) walk(d) }; walk(node); return out }
  const sortKey = (p) => (o.sort === 'slash' ? p + '/' : p)
  const byPath = (a, b) => cmpBytes(sortKey(a.path), sortKey(b.path))
  const folderGroups = [] // [[unit…]] — последовательности для упаковки
  const fileParts = []
  const global = []
  const packFiles = (node) => {
    const own = node.files.filter((f) => f.kw > 0).sort((a, b) => cmpBytes(a.path, b.path))
    let cur = []; let cw = 0
    const flush = () => { if (cur.length) fileParts.push({ kind: 'файлы', items: cur, w: cw }); cur = []; cw = 0 }
    const heavy = own.filter((f) => f.w > K)
    const light = own.filter((f) => f.w <= K)
    if (o.big === 'extract') {
      for (const f of heavy) fileParts.push({ kind: 'файлы', items: [f], w: f.w })
      for (const f of light) { if (cur.length && cw + f.w > K) flush(); cur.push(f); cw += f.w }
      flush(); return
    }
    for (const f of own) {
      if (f.w > K) { flush(); fileParts.push({ kind: 'файлы', items: [f], w: f.w }); continue }
      if (cur.length && cw + f.w > K) flush()
      cur.push(f); cw += f.w
    }
    flush()
  }
  // pack=run: тяжёлая папка обрывает «подряд» — соседи до и после неё пакуются разными сериями
  const walkKids = (kids, unitOk) => {
    const local = []; let run = []
    for (const d of kids) {
      if (unitOk(d)) { const u = { kind: 'папки', items: [d], w: d.w }; local.push(u); run.push(u); global.push(u) } else {
        if (o.pack === 'run' && run.length) { folderGroups.push(run); run = [] }
        expand(d)
      }
    }
    if (o.pack === 'parent' && local.length) folderGroups.push(local)
    if (o.pack === 'run' && run.length) folderGroups.push(run)
  }
  const expand = (node) => {
    const kids = [...node.dirs.values()].filter((d) => d.kw > 0)
    kids.sort((a, b) => cmpBytes(a.path, b.path))
    walkKids(kids, (d) => d.w <= K)
    packFiles(node)
  }
  const topsSorted = [...tops].filter((t) => t.kw > 0).sort((a, b) => cmpBytes(a.path, b.path))
  walkKids(topsSorted, (t) => t.w <= K && o.root === 'unit')
  if (o.pack === 'global') {
    if (o.sort !== 'dfs') global.sort((a, b) => byPath(a.items[0], b.items[0]))
    folderGroups.push(global)
  } else if (o.sort !== 'dfs') for (const g of folderGroups) g.sort((a, b) => byPath(a.items[0], b.items[0]))
  const folderParts = []
  for (const g of folderGroups) {
    let cur = []; let cw = 0
    for (const u of g) {
      if (cur.length && cw + u.w > K) { folderParts.push({ kind: 'папки', items: cur, w: cw }); cur = []; cw = 0 }
      cur.push(u.items[0]); cw += u.w
    }
    if (cur.length) folderParts.push({ kind: 'папки', items: cur, w: cw })
  }
  for (const p of [...folderParts, ...fileParts]) {
    const fl = p.kind === 'папки' ? p.items.flatMap(covered) : p.items
    const cls = {}; const ori = {}
    for (const f of fl) {
      for (const [c, n] of Object.entries(f.cls)) cls[c] = (cls[c] || 0) + n
      for (const [c, n] of Object.entries(f.ori)) ori[c] = (ori[c] || 0) + n
    }
    res.parts.push({ kind: p.kind, paths: p.items.map((x) => x.path), w: round(p.w), cls, ori, files: fl.map((f) => f.path) })
  }
  // ориентир вне частей — остатку
  const inParts = new Set(res.parts.flatMap((p) => p.files))
  res.looseOri = [...files.values()].filter((f) => !inParts.has(f.path)).flatMap((f) => Object.entries(f.ori).filter(([, n]) => n).map(([c, n]) => `${f.path} — ${c} ${n}`)).sort()
  return res
}

export const round = (x) => Math.round(x * 1000) / 1000

// O14: список остатка по дереву на диске; null — дерева нет или пунктов больше 60
export function restList (res) {
  const SKIP = new Set(['node_modules', '__pycache__']); const TOP = new Set(['target', 'build', 'dist'])
  const cov = new Set(res.parts.flatMap((p) => p.paths))
  const inner = new Set()
  for (const p of cov) { const r = res.roots.filter((x) => p === x || p.startsWith(x + '/')).sort((a, b) => b.length - a.length)[0]; for (let q = p; q !== r && q.includes('/');) { q = q.slice(0, q.lastIndexOf('/')); inner.add(q) } }
  const dirs = new Set(); const loose = new Set(); let seen = false
  const walk = (d, root) => {
    let list; try { list = fs.readdirSync(diskPath(d), { withFileTypes: true }) } catch { return }
    for (const e of list) {
      const p = d + '/' + e.name
      if (e.isDirectory()) { if (!(e.name.length > 1 && e.name.startsWith('.')) && !SKIP.has(e.name) && !(d === root && TOP.has(e.name))) walk(p, root); continue }
      seen = true
      if (isTest(p.slice(root.length + 1))) continue
      const chain = []; for (let q = p; q !== root;) { q = q.slice(0, q.lastIndexOf('/')); chain.push(q) }
      if (cov.has(p) || chain.some((q) => cov.has(q))) continue
      const top = chain.filter((q) => !inner.has(q)).pop()
      if (top) dirs.add(top); else loose.add(chain[0])
    }
  }
  for (const r of res.roots) walk(r, r)
  if (!seen || dirs.size + loose.size > 60) return null
  const srt = (x) => [...x].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
  return [...srt(dirs).map((d) => `  папка ${d}`), ...srt(loose).map((d) => `  файлы прямо в ${d}`)]
}

// относительная форма пути: «Ri:rel» («.» — сам корень)
export function relOf (p, roots) {
  const c = canon(p)
  if (!isAbs(c)) return roots.length === 1 ? `R1:${c.replace(/^(\.\/)+/, '')}` : `R?:${c}`
  let best = -1
  roots.forEach((r, i) => { if ((c === r || c.startsWith(r + '/')) && (best < 0 || r.length > roots[best].length)) best = i })
  if (best < 0) return `?:${c}`
  return `R${best + 1}:${c === roots[best] ? '.' : c.slice(roots[best].length + 1)}`
}

export function fmt (res) {
  const num = (x) => String(round(x))
  const list = (m, order) => order.filter((c) => m[c]).map((c) => `${c} ${m[c]}`).join(', ')
  const out = []
  if (res.mode === 'отказ') return `ОТКАЗ: ${res.reason}`
  const ori = list(res.itog.ориентир, res.oriClasses)
  out.push(`итог по классам: ${list(res.itog.ключ, res.keyClasses)}${ori ? ` | ориентир: ${ori}` : ''}`)
  if (res.outside) out.push(`вне корней сервиса: вес ${num(res.outside)}`)
  if (res.tests) {
    out.push('в тестовых папках: вес ' + num(res.tests) + ' — в план и в сверку не идут')
    const minus = (a, b) => Object.fromEntries(Object.entries(a).map(([c, n]) => [c, n - (b[c] || 0)]))
    const o2 = list(minus(res.itogAll.ориентир, res.testsBy.ориентир), res.oriClasses)
    out.push(`к сверке: ${list(minus(res.itogAll.ключ, res.testsBy.ключ), res.keyClasses)}${o2 ? ` | ориентир: ${o2}` : ''}`)
  }
  if (res.mode === 'не нужна') { out.push(res.W > res.KW ? `нарезка не нужна: вес по ключам ${num(res.KW)} ≤ K=${res.K} (ориентир ${num(round(res.W - res.KW))} в решение не идёт)` : `нарезка не нужна: вес ${num(res.W)} ≤ K=${res.K}`); return out.join('\n') }
  out.push(`вес сервиса ${num(res.W)} при K=${res.K}, w=${res.w}`)
  const oriOf = (p) => res.oriClasses.filter((c) => p.ori[c]).map((c) => `ориентир ${c} ${p.ori[c]}`)
  res.parts.forEach((p, i) => out.push(`часть ${String(i + 1).padStart(2, '0')} вес ${num(p.w)} (${[list(p.cls, res.keyClasses), ...oriOf(p)].filter(Boolean).join(', ')}): ${p.kind} ${p.paths.join('; ')}`))
  if (res.looseOri.length) out.push(`остатку по ориентиру: ${res.looseOri.join('; ')}`)
  const rest = restList(res)
  if (rest && rest.length) { out.push(`частей ${res.parts.length}; остаток — пунктов ${rest.length}:`); out.push(...rest) } else out.push(`частей ${res.parts.length}; остаток — ${rest ? 'пусто' : 'поддеревья без пометок-ключей'}`)
  return out.join('\n')
}

// TSV эталона по контракту: классы, пути частей и каждый файл с ключами.
export function fmtTsv (res, countsText) {
  if (res.mode === 'отказ') return ''
  const files = new Map(); const totals = {}
  for (const l of parseCounts(countsText).filter((x) => x.type === 'ключ' && x.n > 0)) {
    const f = resolve(l.path, res.roots)
    const root = res.roots.find((r) => f.startsWith(r + '/'))
    if (!root || isTest(f.slice(root.length + 1))) continue
    const cls = files.get(f) ?? {}; cls[l.cls] = (cls[l.cls] ?? 0) + l.n; files.set(f, cls)
    totals[l.cls] = (totals[l.cls] ?? 0) + l.n
  }
  const out = res.keyClasses.filter((c) => totals[c]).map((c) => `итог\t${c}\t${totals[c]}`)
  res.parts.forEach((p, i) => {
    const nn = String(i + 1).padStart(2, '0')
    for (const [c, n] of Object.entries(p.cls)) if (n) out.push(`часть\t${nn}\t${c}\t${n}`)
    for (const q of p.paths) out.push(`путь\t${q}\t${p.kind}\t${nn}`)
  })
  for (const [f, cls] of [...files.entries()].sort(([a], [b]) => cmpBytes(a, b))) {
    const i = res.parts.findIndex((p) => p.paths.some((q) => f === q || (p.kind === 'папки' && f.startsWith(q + '/'))))
    const nn = i < 0 ? '-' : String(i + 1).padStart(2, '0')
    for (const [c, n] of Object.entries(cls)) out.push(`файл\t${f}\t${c}\t${n}\t${nn}`)
  }
  // пункты списка остатка, если список напечатан: остаток <S+1> <папка|файлы> <путь>
  const rnn = String(res.parts.length + 1).padStart(2, '0')
  for (const l of (res.mode === 'не нужна' ? null : restList(res)) ?? []) { const m =l.match(/^\s*(папка|файлы прямо в)\s+(.*?)\s*$/); if (m) out.push(`остаток\t${rnn}\t${m[1] === 'папка' ? 'папка' : 'файлы'}\t${m[2]}`) }
  return out.length ? out.join('\n') + '\n' : ''
}

if (process.argv[1] && process.argv[1].endsWith('plan-oracle.mjs') && process.argv.length >= 6) {
  const [, , counts, K, w, roots, ...tail] = process.argv
  const tsv = tail[0] && tail[0] !== '--variant' ? tail.shift() : null
  const vi = tail.indexOf('--variant')
  const opt = vi < 0 ? VARIANTS.primary : variant(tail[vi + 1])
  const r = plan(fs.readFileSync(counts, 'utf8'), Number(K), Number(w), roots, opt)
  console.log(fmt(r))
  if (tsv) fs.writeFileSync(diskPath(tsv), fmtTsv(r, fs.readFileSync(counts, 'utf8')))
  if (r.mode === 'отказ') process.exit(3)
}
