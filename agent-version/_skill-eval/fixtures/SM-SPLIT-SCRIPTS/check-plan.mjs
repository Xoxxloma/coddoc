// Проверка вывода plan.py: разбор строк контракта, сверка с expect.json (руками) и с оракулом, инварианты.
// Исход каждой проверки: ok | ОШИБКА | неоднозначность | устойчивость | справочно.
import { plan, parseCounts, canon, relOf, round, variant, VARIANTS, resolve, isTest } from './plan-oracle.mjs'

const num = (s) => Number(String(s).replace(',', '.'))
const classList = (s) => {
  const m = {}
  for (const it of String(s || '').split(/,\s+|;\s+/)) {
    const x = it.trim().match(/^(.+?)\s+(\d+(?:[.,]\d+)?)$/)
    if (x) m[x[1].trim()] = num(x[2])
  }
  return m
}

export function parsePlan (text) {
  const r = { itog: null, none: null, head: null, parts: [], tail: null, outside: null, sverka: null, rest: [], refuse: null, testsLine: false, looseOri: null, other: [] }
  for (const line of String(text).split(/\r?\n/)) {
    let m
    if ((m = line.match(/^итог по классам:\s*(.*)$/))) {
      const [a, b] = m[1].split('|')
      r.itog = { ключ: classList(a), ориентир: classList((b || '').replace(/^\s*ориентир:\s*/, '')) }
    } else if ((m = line.match(/^нарезка не нужна:\s*вес\s+(?:по ключам\s+)?([\d.,]+)\s*≤\s*K\s*=\s*([\d.,]+)/))) r.none = { W: num(m[1]), K: num(m[2]) }
    else if ((m = line.match(/^вес сервиса\s+([\d.,]+)\s+при\s+K\s*=\s*([\d.,]+),\s*w\s*=\s*([\d.,]+)/))) r.head = { W: num(m[1]), K: num(m[2]), w: num(m[3]) }
    else if ((m = line.match(/^часть\s+(\d+)\s+вес\s+([\d.,]+)\s*(?:\(([^)]*)\))?:\s*(папки|файлы)\s+(.*?)\s*$/))) {
      r.parts.push({ nn: Number(m[1]), w: num(m[2]), cls: classList(m[3] || ''), kind: m[4], paths: m[5].split(/;\s*/).map((s) => s.trim()).filter(Boolean) })
    } else if ((m = line.match(/^частей\s+(\d+);\s*остаток\s*—\s*(.*)$/))) r.tail = { S: Number(m[1]), rest: m[2] }
    else if ((m = line.match(/^вне корней сервиса:\s*вес\s+([\d.,]+)/))) r.outside = num(m[1])
    else if ((m = line.match(/^к сверке:\s*(.*)$/))) {
      const [a, b] = m[1].split('|')
      r.sverka = { ключ: classList(a), ориентир: classList((b || '').replace(/^\s*ориентир:\s*/, '')) }
    } else if ((m = line.match(/^\s+(папка|файлы прямо в)\s+(.*?)\s*$/))) r.rest.push({ kind: m[1], path: m[2] })
    else if ((m = line.match(/^ОТКАЗ:\s*(.*)$/))) r.refuse = m[1]
    else if (/^в тестовых папках:/.test(line)) r.testsLine = true
    else if ((m = line.match(/^остатку по ориентиру:\s*(.*)$/))) r.looseOri = m[1].split(/;\s*/).reduce((a, x) => a + (Number((x.match(/ (\d+)$/) || [])[1]) || 0), 0)
    else if (line.trim()) r.other.push(line)
  }
  return r
}

const sameMap = (a, b) => {
  const ka = Object.keys(a || {}).filter((k) => a[k]); const kb = Object.keys(b || {}).filter((k) => b[k])
  return ka.length === kb.length && ka.every((k) => round(a[k]) === round(b[k]))
}
const fmtMap = (m) => Object.entries(m || {}).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(', ') || '—'

// Файл плана для check.py (пятый аргумент plan.py) — тот же план, что в stdout, строками через табуляцию:
// итог = «к сверке» (а без тестов — «итог по классам») по ключам; сумма пометок по файлам = итог;
// ожидания частей = ключ-классы строк «часть NN»; хозяин файла — часть, чьи пути его покрывают.
export function checkPlanTsv (out) {
  const res = []
  const add = (check, ok, detail) => res.push({ check: `файл плана: ${check}`, status: ok ? 'ok' : 'ОШИБКА', detail: ok ? '' : detail })
  if (out.tsv === null) return [{ check: 'файл плана', status: 'не измерено', detail: 'файла нет' }]
  const rows = out.tsv.split(/\r?\n/).filter(Boolean).map((l) => l.split('\t'))
  if (out.rc !== 0) { add('при отказе пуст', rows.length === 0, `строк ${rows.length}`); return res }
  const P = parsePlan(out.stdout)
  const itog = {}; const parts = {}; const files = []; const paths = []; const rest = []
  let bad = 0
  for (const r of rows) {
    if (r[0] === 'итог' && r.length === 3) itog[r[1]] = (itog[r[1]] ?? 0) + num(r[2])
    else if (r[0] === 'часть' && r.length === 4) (parts[r[1]] ??= {})[r[2]] = num(r[3])
    else if (r[0] === 'файл' && r.length === 5) files.push({ path: r[1], cl: r[2], n: num(r[3]), nn: r[4] })
    else if (r[0] === 'путь' && r.length === 4 && ['папки', 'файлы'].includes(r[2])) paths.push({ path: canon(r[1]), kind: r[2], nn: r[3] })
    else if (r[0] === 'остаток' && r.length === 4 && ['папка', 'файлы'].includes(r[2])) rest.push(`${r[1]}\t${r[2] === 'файлы' ? 'файлы прямо в' : 'папка'}\t${r[3]}`)
    else if (r[0] === 'операция' && r.length === 6 && /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(r[1]) && r[2].startsWith('/')) continue   // спецификация по дереву — сверяет SM-CHECK
    else if (r[0] === 'топик' && r.length === 3 && r[1]) continue                                                                     // конфиг по дереву — сверяет SM-CHECK
    else bad++
  }
  // пункты остатка = список остатка в stdout, номер — S+1; список не напечатан — строк нет
  const wantRest = P.rest.map((x) => `${String(P.parts.length + 1).padStart(2, '0')}\t${x.kind}\t${x.path}`)
  add('пункты остатка = список остатка stdout', JSON.stringify([...rest].sort()) === JSON.stringify([...wantRest].sort()), `файл ${rest.length}: ${rest.slice(0, 3).join(' ¦ ')}; stdout ${wantRest.length}: ${wantRest.slice(0, 3).join(' ¦ ')}`)
  add('строки по форме', bad === 0, `не по форме: ${bad}`)
  const want = (P.sverka ?? P.itog)?.ключ ?? {}
  if (P.outside === null) add('итог = итог плана по ключам', sameMap(itog, want), `файл ${fmtMap(itog)}; stdout ${fmtMap(want)}`)
  else add('итог без путей вне корней — не больше итога плана', Object.entries(itog).every(([k, v]) => v <= (want[k] ?? 0)), `файл ${fmtMap(itog)}; stdout ${fmtMap(want)}`)
  const byFile = {}
  for (const f of files) byFile[f.cl] = (byFile[f.cl] ?? 0) + f.n
  add('сумма по файлам = итог', sameMap(byFile, itog), `по файлам ${fmtMap(byFile)}; итог ${fmtMap(itog)}`)
  const fromOut = {}
  for (const p of P.parts) fromOut[String(p.nn).padStart(2, '0')] = Object.fromEntries(Object.entries(p.cls).filter(([k]) => !k.startsWith('ориентир')))
  const nns = [...new Set([...Object.keys(fromOut), ...Object.keys(parts)])].sort()
  const badParts = nns.filter((nn) => !sameMap(parts[nn], fromOut[nn]))
  add('ожидания частей = классы строк «часть NN»', badParts.length === 0, badParts.slice(0, 3).map((nn) => `часть ${nn}: файл ${fmtMap(parts[nn])}; stdout ${fmtMap(fromOut[nn])}`).join(' | '))
  const wrong = []
  for (const f of files) {
    if (!P.parts.length) { if (f.nn !== '-') wrong.push(`${f.path} → ${f.nn} без частей`); continue }
    const part = P.parts.find((p) => String(p.nn).padStart(2, '0') === f.nn)
    const cf = canon(f.path)
    if (!part || !part.paths.some((q) => { const cq = canon(q); return cf === cq || cf.startsWith(cq + '/') })) wrong.push(`${f.path} → ${f.nn}`)
  }
  add('хозяин файла — часть, чьи пути его покрывают', wrong.length === 0, wrong.slice(0, 3).join('; '))
  const wantPaths = P.parts.flatMap((p) => p.paths.map((q) => `${String(p.nn).padStart(2, '0')}\t${p.kind}\t${canon(q)}`)).sort()
  const gotPaths = paths.map((p) => `${p.nn}\t${p.kind}\t${p.path}`).sort()
  add('пути владения = пути частей stdout', JSON.stringify(gotPaths) === JSON.stringify(wantPaths), `файл ${gotPaths.join('; ')}; stdout ${wantPaths.join('; ')}`)
  return res
}

// часть → каноническая строка: вид | пути (Ri:rel, сортированы) | вес | ключ-классы
const partSig = (p, keyClasses) => {
  const cls = Object.entries(p.cls || {}).filter(([k, v]) => v && (!keyClasses || keyClasses.includes(k))).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join(',')
  return `${p.kind}|${[...p.paths].sort().join(';')}|${round(p.w)}|${cls}`
}
const expRel = (p) => (/^R(\d|\?):/.test(p) ? p : `R1:${p}`)
const sigsOfExpected = (parts, keyClasses) => parts.map((p) => partSig({ ...p, paths: p.paths.map(expRel) }, keyClasses)).sort()
const sigsOfParsed = (parsed, roots, keyClasses) => parsed.parts.map((p) => partSig({ ...p, paths: p.paths.map((x) => relOf(x, roots)) }, keyClasses)).sort()
const sigsOfOracle = (res) => res.parts.map((p) => partSig({ ...p, paths: p.paths.map((x) => relOf(x, res.roots)) }, res.keyClasses)).sort()
const samePartition = (a, b) => {
  if (a.length !== b.length) return false
  const fix = (s) => s.replace(/R\?:/g, '')
  return a.every((s, i) => s === b[i] || (s.includes('R?:') && fix(s) === b[i].replace(/R\d:/g, '')) || (b[i].includes('R?:') && fix(b[i]) === s.replace(/R\d:/g, '')))
}
const diffPart = (got, want) => {
  const g = new Set(got), w = new Set(want)
  const lost = want.filter((x) => !g.has(x)); const extra = got.filter((x) => !w.has(x))
  return `ждали [${lost.join(' ¦ ') || '—'}], получено [${extra.join(' ¦ ') || '—'}]`
}

// инварианты, не зависящие от ожидания
export function invariants (parsed, countsText, K, w, rootsArg) {
  const roots = String(rootsArg).split(',').map(canon)
  const bad = []
  const files = new Map()
  for (const l of parseCounts(countsText)) {
    const p = resolve(l.path, roots)
    const root = roots.filter((r) => p.startsWith(r + '/')).sort((a, b) => b.length - a.length)[0]
    if (!root || isTest(p.slice(root.length + 1))) continue
    const f = files.get(p) || { w: 0, kw: 0, cls: {}, ori: {}, on: 0 }
    f.w += l.type === 'ключ' ? l.n : w * l.n
    if (l.type === 'ключ') { f.kw += l.n; f.cls[l.cls] = (f.cls[l.cls] || 0) + l.n } else { f.ori[l.cls] = (f.ori[l.cls] || 0) + l.n; f.on += l.n }
    files.set(p, f)
  }
  const W = round([...files.values()].reduce((a, f) => a + f.w, 0))
  const abs = (x) => { const c = canon(x); return /^([A-Z]:)?\//.test(c) ? c : roots[0] + '/' + c }
  const cover = new Map()
  let sum = 0
  const dirW = (d) => [...files.entries()].filter(([p]) => p.startsWith(d + '/')).reduce((a, [, f]) => a + f.w, 0)
  for (const p of parsed.parts) {
    let pw = 0; const cls = {}; const ori = {}
    for (const x of p.paths) {
      const a = abs(x)
      const hit = p.kind === 'файлы' ? [...files.keys()].filter((f) => f === a) : [...files.keys()].filter((f) => f.startsWith(a + '/'))
      if (!hit.length) bad.push(`часть ${p.nn}: «${x}» не покрывает ни одного файла с весом`)
      if (p.kind === 'папки' && round(dirW(a)) > K) bad.push(`часть ${p.nn}: папка «${x}» тяжелее K (${round(dirW(a))})`)
      for (const f of hit) {
        cover.set(f, (cover.get(f) || 0) + 1)
        pw += files.get(f).w
        for (const [c, n] of Object.entries(files.get(f).cls)) cls[c] = (cls[c] || 0) + n
        for (const [c, n] of Object.entries(files.get(f).ori)) ori[c] = (ori[c] || 0) + n
      }
    }
    for (const [c, n] of Object.entries(ori)) if (n && p.cls['ориентир ' + c] !== n) bad.push(`часть ${p.nn}: ориентир ${c} напечатан ${p.cls['ориентир ' + c] ?? '—'}, по путям ${n}`)
    for (const k of Object.keys(p.cls)) if (k.startsWith('ориентир ') && !ori[k.slice(9)]) bad.push(`часть ${p.nn}: напечатан «${k}», а ориентира в её путях нет`)
    if (round(pw) !== round(p.w)) bad.push(`часть ${p.nn}: напечатан вес ${p.w}, по её путям ${round(pw)}`)
    const single = p.kind === 'файлы' && p.paths.length === 1
    if (round(p.w) > K && !single) bad.push(`часть ${p.nn}: вес ${p.w} > K=${K}, а это не один файл`)
    const keyPrinted = Object.fromEntries(Object.entries(p.cls).filter(([k]) => k in cls || !Object.keys(cls).length))
    for (const [c, n] of Object.entries(cls)) if (n && p.cls[c] !== n) bad.push(`часть ${p.nn}: класс ${c} напечатан ${p.cls[c] ?? '—'}, по путям ${n}`)
    void keyPrinted
    sum += p.w
  }
  let loose = 0; let looseOn = 0
  for (const [f, fw] of files) {
    const n = cover.get(f) || 0
    if (!n) looseOn += fw.on
    if (fw.kw > 0 && n !== 1) bad.push(`файл с ключами (вес ${round(fw.w)}) в частях ${n} раз: …${f.slice(-60)}`)
    else if (n > 1) bad.push(`файл в частях ${n} раз: …${f.slice(-60)}`)
    if (!n) loose += fw.w
  }
  if (parsed.parts.length && round(sum + loose) !== W) bad.push(`сумма весов частей ${round(sum)} + ориентир вне частей ${round(loose)} ≠ общий вес ${W}`)
  if (parsed.parts.length && (parsed.looseOri || 0) !== looseOn) bad.push(`«остатку по ориентиру» в сумме ${parsed.looseOri ?? 'нет строки'}, по счёту вне частей ${looseOn}`)
  const nns = parsed.parts.map((p) => p.nn)
  if (nns.some((n, i) => n !== i + 1)) bad.push(`номера частей не 01…S подряд: ${nns.join(',')}`)
  if (parsed.tail && parsed.tail.S !== parsed.parts.length) bad.push(`«частей ${parsed.tail.S}», а строк частей ${parsed.parts.length}`)
  return { bad, W }
}

// синтетический случай: ex — expect.json, out — {rc, stdout, stderr, counts, args:[K,w,roots]}
export function checkPlanCase (ex, out) {
  const res = []
  const cat = ex.category === 'устойчивость' ? 'устойчивость' : 'ОШИБКА'
  const add = (check, ok, detail, status) => res.push({ check, status: ok ? 'ok' : (status || cat), detail: ok ? '' : detail })
  const [K, w, rootsArg] = out.args
  const roots = String(rootsArg).split(',').map(canon)
  const P = parsePlan(out.stdout)
  if (ex.mode === 'отказ') {
    add('код выхода 3', out.rc === 3, `код ${out.rc}`)
    add('строка «ОТКАЗ: …»', P.refuse !== null, `вывод: ${out.stdout.trim().split('\n').slice(0, 2).join(' / ')}`)
    add('плана нет', P.parts.length === 0 && !P.head && !P.none && !P.tail, `строк частей ${P.parts.length}`)
    return res
  }
  add('код выхода 0', out.rc === 0, `код ${out.rc}; stderr: ${out.stderr.trim().split('\n').slice(0, 2).join(' / ')}`)
  // итоги
  if (!P.itog) add('строка «итог по классам»', false, 'нет строки')
  else {
    const okK = sameMap(P.itog.ключ, ex.itog.ключ)
    if (okK) add('итог: классы ключ', true)
    else if (ex.itog_alt && sameMap(P.itog.ключ, ex.itog_alt.ключ)) add('итог: классы ключ', false, `${fmtMap(P.itog.ключ)} — ${ex.itog_alt.label}`, 'неоднозначность')
    else add('итог: классы ключ', false, `получено ${fmtMap(P.itog.ключ)}, ждали ${fmtMap(ex.itog.ключ)}`)
    add('итог: ориентир', sameMap(P.itog.ориентир, ex.itog.ориентир), `получено ${fmtMap(P.itog.ориентир)}, ждали ${fmtMap(ex.itog.ориентир)}`)
  }
  if (ex.no_outside) add('нет строки «вне корней сервиса» (все файлы внутри корня)', P.outside === null, `напечатано «вне корней сервиса: вес ${P.outside}» — корень или пути счёта не приведены к одному виду`)
  if (ex.outside) add('строка «вне корней сервиса»', P.outside !== null && round(P.outside) === ex.outside, `получено ${P.outside ?? 'нет строки'}, ждали ${ex.outside}`)
  if (ex.sverka) add('строка «в тестовых папках»', P.testsLine, 'нет строки')
  if (ex.sverka) add('строка «к сверке» (без тестовых папок)', !!P.sverka && sameMap(P.sverka.ключ, ex.sverka.ключ) && sameMap(P.sverka.ориентир, ex.sverka.ориентир), P.sverka ? `получено ${fmtMap(P.sverka.ключ)} | ${fmtMap(P.sverka.ориентир)}` : 'нет строки')
  if (ex.mode === 'не нужна') {
    add('«нарезка не нужна: вес W ≤ K»', !!P.none && P.none.W === (ex.none_W ?? ex.W) && P.none.K === ex.K, P.none ? `W=${P.none.W}, K=${P.none.K}; ждали W=${ex.W}, K=${ex.K}` : 'нет строки')
    add('частей нет', P.parts.length === 0 && !P.head, `строк частей ${P.parts.length}`)
    return res
  }
  add('«вес сервиса W при K, w»', !!P.head && round(P.head.W) === ex.W && P.head.K === ex.K && round(P.head.w) === ex.w, P.head ? `W=${P.head.W}, K=${P.head.K}, w=${P.head.w}; ждали W=${ex.W}, K=${ex.K}, w=${ex.w}` : (P.none ? `напечатано «нарезка не нужна» (вес ${P.none.W})` : 'нет строки'))
  add('«частей S; остаток — …»', !!P.tail && P.tail.S === P.parts.length, P.tail ? `S=${P.tail.S}, строк частей ${P.parts.length}` : 'нет строки')
  const keyClasses = Object.keys(ex.itog.ключ)
  const got = sigsOfParsed(P, roots, keyClasses)
  const want = sigsOfExpected(ex.parts, keyClasses)
  if (samePartition(got, want)) add('разбиение на части', true)
  else {
    const alt = (ex.alts || []).find((a) => samePartition(got, sigsOfExpected(a.parts, keyClasses)))
    if (alt) add('разбиение на части', false, alt.label, 'неоднозначность')
    else add('разбиение на части', false, diffPart(got, want))
  }
  if (ex.normal_output) {
    const badp = P.parts.flatMap((p) => p.paths).filter((x) => /\\|\/\.{1,2}(\/|$)|\/\/|^\.{1,2}\/|.\/$|^\/[a-zA-Z]\//.test(x))
    add('пути частей в нормальном виде (без обратного слеша, «..», «/./», «//», хвостового «/», «/c/…»)', badp.length === 0, `например: ${badp.slice(0, 2).join(' ¦ ')}`)
  }
  if (ex.rest) {
    const gotR = P.rest.map((x) => `${x.kind} ${relOf(x.path, roots)}`).sort()
    const wantR = ex.rest.map((x) => x.replace(/^(папка|файлы прямо в) (?!R\d:)/, (_, k) => `${k} R1:`)).sort()
    if (!wantR.length) add('«остаток — пусто»', !!P.tail && /пусто/.test(P.tail.rest), P.tail ? P.tail.rest : 'нет строки')
    add('остаток списком', gotR.length === wantR.length && gotR.every((x, i) => x === wantR[i]), `получено [${gotR.join(' ¦ ') || '—'}], ждали [${wantR.join(' ¦ ')}]`)
  }
  const inv = invariants(P, out.counts, K, w, rootsArg)
  add('инварианты (файл с ключами ровно в одной части, остальные не больше чем в одной, веса, ≤ K, сумма)', inv.bad.length === 0, inv.bad.slice(0, 4).join('; '))
  if (ex.controls) {
    // «УЗКИЙ МАРКЕР: <класс> — маркер дал M в <файл>, разведчик видел N» | «контроль <класс>: маркер дал M в <файл>, разведчик видел N — сходится»
    const got = []
    for (const l of out.stdout.split(/\r?\n/)) {
      let m = l.match(/^УЗКИЙ МАРКЕР: (\S+) — маркер дал (\d+) в .+, разведчик видел (\d+)$/)
      if (m) { got.push(`${m[1]} ${m[2]}/${m[3]} узкий`); continue }
      m = l.match(/^контроль (\S+): маркер дал (\d+) в .+, разведчик видел (\d+) — сходится$/)
      if (m) got.push(`${m[1]} ${m[2]}/${m[3]} сходится`)
    }
    const want = ex.controls.map((c) => `${c.cls} ${c.m}/${c.n} ${c.narrow ? 'узкий' : 'сходится'}`)
    got.sort(); want.sort()
    add('строки контроля разведчика', got.length === want.length && got.every((x, i) => x === want[i]), `получено [${got.join(' ¦ ') || '—'}], ждали [${want.join(' ¦ ')}]`)
    const unres = out.stdout.split(/\r?\n/).filter((l) => /^контроль \S+ не сверен:/.test(l)).length
    add('строки «контроль … не сверен»', unres === (ex.controls_unresolved || 0), `получено ${unres}, ждали ${ex.controls_unresolved || 0}`)
    const badLine = out.stdout.match(/^контроль не по форме .*?: (\d+);/m)
    add('строка «контроль не по форме»', (badLine ? Number(badLine[1]) : 0) === (ex.controls_bad || 0), `получено ${badLine ? badLine[1] : 'нет строки'}, ждали ${ex.controls_bad || 0}`)
  }
  return res
}

// реальный вход: сверка с оракулом (основной вариант, затем альтернативы) + инварианты
export function checkPlanReal (out) {
  const res = []
  const add = (check, ok, detail, status) => res.push({ check, status: ok ? 'ok' : (status || 'ОШИБКА'), detail: ok ? '' : detail })
  const [K, w, rootsArg] = out.args
  add('код выхода 0', out.rc === 0, `код ${out.rc}; stderr: ${out.stderr.trim().split('\n').slice(0, 2).join(' / ')}`)
  const P = parsePlan(out.stdout)
  const o = plan(out.counts, K, w, rootsArg)
  if (o.mode === 'отказ') { add('отказ, как у оракула', out.rc === 3 && P.refuse !== null, `код ${out.rc}`); return res }
  add('итог по классам = суммы counts', !!P.itog && sameMap(P.itog.ключ, o.itog.ключ) && sameMap(P.itog.ориентир, o.itog.ориентир), P.itog ? `получено ${fmtMap(P.itog.ключ)} | ${fmtMap(P.itog.ориентир)}; оракул ${fmtMap(o.itog.ключ)} | ${fmtMap(o.itog.ориентир)}` : 'нет строки')
  if (o.mode === 'не нужна') { add('нарезка не нужна', !!P.none, 'нет строки'); return res }
  add('вес сервиса', !!P.head && round(P.head.W) === o.W, P.head ? `W=${P.head.W}, оракул ${o.W}` : 'нет строки')
  const got = sigsOfParsed(P, o.roots, o.keyClasses)
  if (samePartition(got, sigsOfOracle(o))) add(`разбиение = оракул (частей ${o.parts.length})`, true)
  else {
    const names = Object.keys(VARIANTS).filter((n) => n !== 'primary')
    const hit = names.find((n) => samePartition(got, sigsOfOracle(plan(out.counts, K, w, rootsArg, variant(n)))))
    if (hit) add('разбиение = оракул', false, `совпало с вариантом ${hit} (частей ${P.parts.length})`, 'неоднозначность')
    else add('разбиение = оракул', false, `частей ${P.parts.length}, у оракула ${o.parts.length}; ${diffPart(got, sigsOfOracle(o)).slice(0, 300)}`)
  }
  const inv = invariants(P, out.counts, K, w, rootsArg)
  add('инварианты', inv.bad.length === 0, inv.bad.slice(0, 4).join('; '))
  return res
}

// самопроверка оракула: основной вариант против expect.json, альтернативы — против своих вариантов
export function checkOracle (ex, counts, args) {
  const [K, w, rootsArg] = args
  const bad = []
  const o = plan(counts, K, w, rootsArg)
  if (ex.mode === 'отказ' || o.mode === 'отказ') { if (o.mode !== ex.mode) bad.push(`режим ${o.mode} ≠ ${ex.mode}`); return bad }
  if (!sameMap(o.itog.ключ, ex.itog.ключ)) bad.push(`итог ${fmtMap(o.itog.ключ)} ≠ ${fmtMap(ex.itog.ключ)}`)
  if (!sameMap(o.itog.ориентир, ex.itog.ориентир)) bad.push(`ориентир ${fmtMap(o.itog.ориентир)} ≠ ${fmtMap(ex.itog.ориентир)}`)
  if (ex.itog_alt && !sameMap(plan(counts, K, w, rootsArg, variant('itog=inroot')).itog.ключ, ex.itog_alt.ключ)) bad.push('itog_alt ≠ вариант itog=inroot')
  if (o.W !== ex.W) bad.push(`W ${o.W} ≠ ${ex.W}`)
  if (o.mode !== ex.mode) bad.push(`режим ${o.mode} ≠ ${ex.mode}`)
  if ((ex.outside || 0) !== o.outside) bad.push(`вне корней ${o.outside} ≠ ${ex.outside || 0}`)
  if (ex.mode === 'план') {
    const kc = Object.keys(ex.itog.ключ)
    if (!samePartition(sigsOfOracle(o), sigsOfExpected(ex.parts, kc))) bad.push(`части: ${diffPart(sigsOfOracle(o), sigsOfExpected(ex.parts, kc))}`)
    for (const a of ex.alts || []) {
      const v = plan(counts, K, w, rootsArg, variant(a.variant))
      if (!samePartition(sigsOfOracle(v), sigsOfExpected(a.parts, kc))) bad.push(`альтернатива ${a.variant}: ${diffPart(sigsOfOracle(v), sigsOfExpected(a.parts, kc))}`)
      if (samePartition(sigsOfOracle(v), sigsOfExpected(ex.parts, kc))) bad.push(`альтернатива ${a.variant} не отличима от основного ожидания`)
    }
  }
  return bad
}
