// Подготовка входов для test-split-scripts.sh. Моделей не зовёт, пишет только в <база>.
//
//   node prep.mjs plan <папка случая> <база-posix> <база-win>
//      дерево случая на диске (пустые файлы: plan.py вправе смотреть в ФС), counts.txt с настоящими
//      путями в форме случая (posix — как у bash, win — C:\…\ с обратными слэшами), args.txt:
//      K, w, корни через запятую — по строке.
//   node prep.mjs real <папка _skill-eval> <база-posix> <база-win>
//      counts.txt по деревьям фикстур (NRS-TAIL, SM-MONO-DGS, repairy-api из as-base) — как вывод
//      Grep со счётом: Windows-пути, число совпавших строк на файл; по папке real-<имя>/ на вход.
//
// <база-posix> передаётся без конвертации путей MSYS (MSYS2_ARG_CONV_EXCL='*' в раннере).
import fs from 'node:fs'
import path from 'node:path'

const [, , mode, src, basePosix, baseWin] = process.argv
if (!mode || !src || !basePosix || !baseWin) { console.error('usage: node prep.mjs plan|real <src> <база-posix> <база-win>'); process.exit(2) }
const bw = baseWin.replace(/\//g, '\\').replace(/\\$/, '')
const bp = basePosix.replace(/\/$/, '')

function touch (abs) { fs.mkdirSync(path.dirname(abs), { recursive: true }); if (!fs.existsSync(abs)) fs.writeFileSync(abs, '') }

if (mode === 'plan') {
  const ex = JSON.parse(fs.readFileSync(path.join(src, 'expect.json'), 'utf8'))
  const tpl = fs.readFileSync(path.join(src, 'counts.txt'), 'utf8')
  const win = ex.form === 'win'
  const rootDir = (key) => (key === 'X' ? '' : ex.roots[key])
  const wdir = path.join(baseWin, 'w')
  // искажённые формы пути (args_form — корень 4-м аргументом, counts_form — пути в файле счёта):
  // dotdot «…/AI-SDD/../svc», dotdot2 «…/a/b/../../svc», dotslash «…/./svc/», mixslash — слеши вперемешку,
  // msys «/c/…», lowerdrive «c:/…», fwd — «C:/…» с прямыми слешами; rel «./src/…» и relbare «src/…» — без корня
  const MIX = ['\\\\', '//', '\\', '/\\', '\\/', '///']
  const mutate = (name, root, rest) => {
    const fwd = root.replace(/\\/g, '/').replace(/\/$/, '')
    const i = fwd.lastIndexOf('/'); const parent = fwd.slice(0, i); const last = fwd.slice(i + 1)
    const tail = rest ? '/' + rest : ''
    switch (name) {
      case 'dotdot': return `${parent}/AI-SDD/../${last}${tail}`
      case 'dotdot2': return `${parent}/a/b/../../${last}${tail}`
      case 'dotslash': return `${parent}/./${last}${rest ? '/' + rest : '/'}`
      case 'mixslash': { let n = 0; return (fwd + tail).replace(/\//g, () => MIX[n++ % MIX.length]) }
      case 'msys': return (fwd + tail).replace(/^([A-Za-z]):/, (_, d) => '/' + d.toLowerCase())
      case 'lowerdrive': return (fwd + tail).replace(/^([A-Za-z]):/, (_, d) => d.toLowerCase() + ':')
      case 'fwd': return fwd + tail
      case 'rel': return './' + rest
      case 'relbare': return rest
      default: throw new Error('форма ' + name)
    }
  }
  const cleanRoot = (key) => (win ? bw + '\\w\\' + rootDir(key).replace(/\//g, '\\') : bp + '/w/' + rootDir(key)).replace(/[\\/]$/, '')
  const form = (key, rest, mode) => {
    if (mode && key !== 'X') return mutate(mode, cleanRoot(key), rest)
    const rel = [rootDir(key), rest].filter(Boolean).join('/')
    return win ? bw + '\\w\\' + rel.replace(/\//g, '\\') : bp + '/w/' + rel
  }
  const disk = (key, rest) => path.join(baseWin, 'w', rootDir(key), rest)
  const out = tpl.split(/\r?\n/).map((l) => {
    const c = l.match(/^## контроль :: (.+?) :: (`?)\{(R\d|X)\}\/(.*?)(`?) :: (\d+)\s*$/)
    if (c) return `## контроль :: ${c[1]} :: ${c[2]}${form(c[3], c[4], ex.counts_form)}${c[5]} :: ${c[6]}`
    const m = l.match(/^\{(R\d|X)\}\/(.*?):(\d+)\s*$/)
    if (!m) return l
    touch(disk(m[1], m[2]))
    return `${form(m[1], m[2], ex.counts_form)}:${m[3]}`
  })
  for (const r of Object.keys(ex.roots)) fs.mkdirSync(disk(r, ''), { recursive: true })
  for (const e of ex.tree_extra || []) touch(disk('R1', e))
  // папки для «..»: чтобы скрипт, смотрящий в ФС, не споткнулся о несуществующий путь
  for (const f of [ex.args_form, ex.counts_form]) {
    if (f === 'dotdot') fs.mkdirSync(path.join(wdir, 'AI-SDD'), { recursive: true })
    if (f === 'dotdot2') fs.mkdirSync(path.join(wdir, 'a', 'b'), { recursive: true })
  }
  fs.writeFileSync(path.join(baseWin, 'counts.txt'), out.join('\n'))
  const roots = Object.keys(ex.roots).map((r) => form(r, '', ex.args_form).replace(ex.args_form ? /^$/ : /[\\/]$/, '')).join(',')
  fs.writeFileSync(path.join(baseWin, 'args.txt'), `${ex.K}\n${ex.w}\n${roots}\n`)
  process.exit(0)
}

if (mode === 'real') {
  const EVAL = src
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    if (e.name === '.git' || e.name === 'node_modules') return []
    const p = path.join(d, e.name)
    return e.isDirectory() ? walk(p) : [p]
  })
  const inputs = [
    { name: 'NRS-TAIL', root: path.join(EVAL, 'fixtures/NRS-TAIL/out/cargonet'), K: 40, w: 0.5, markers: [
      ['контракт', 'ключ', /@(Get|Post|Put|Delete)Mapping\b/, /\.java$/],
      ['сущности', 'ключ', /@Entity\b/, /\.java$/],
      ['задачи', 'ключ', /@Scheduled\b/, /\.java$/],
      ['топики', 'ориентир', /class \w+MessageHandler\d*\b/, /\.java$/],
    ] },
    { name: 'NRS-TAIL-K100', root: path.join(EVAL, 'fixtures/NRS-TAIL/out/cargonet'), K: 100, w: 0.25, same: 'NRS-TAIL' },
    { name: 'SM-MONO-DGS', root: path.join(EVAL, 'fixtures/SM-MONO-DGS/out/casedesk'), K: 40, w: 0.5, markers: [
      ['контракт', 'ключ', /@(Get|Post|Put|Patch|Delete)Mapping\(/, /\.java$/],
      ['контракт', 'ключ', /@Dgs(Query|Mutation|Subscription)\b/, /\.java$/],
      ['контракт', 'ключ', /@DgsData\(parentType\s*=\s*"(Query|Mutation|Subscription)"/, /\.java$/],
      ['сущности', 'ключ', /@Entity\b/, /\.java$/],
      ['задачи', 'ключ', /@Scheduled\(/, /\.java$/],
      ['топики', 'ориентир', /class \w+EventProcessor\b/, /\.java$/],
    ] },
    { name: 'repairy-api', root: path.join(EVAL, 'runs/2026-10-04-as-base/sandbox/scan-1/w/repairy-api'), K: 30, w: 1, markers: [
      ['контракт', 'ключ', /@(Get|Post|Put|Patch|Delete)\(/, /\.ts$/],
      ['сущности', 'ключ', /^model \w+/, /\.prisma$/],
      ['задачи', 'ключ', /@(Cron|Interval)\(/, /\.ts$/],
    ] },
  ]
  const made = []
  const cache = {}
  for (const inp of inputs) {
    const def = inp.same ? inputs.find((x) => x.name === inp.same) : inp
    if (!fs.existsSync(inp.root)) { console.log(`real ${inp.name}: нет дерева ${inp.root} — пропуск`); continue }
    let text = cache[def.name]
    if (!text) {
      const files = walk(inp.root).sort()
      const blocks = def.markers.map(([cls, type, re, glob]) => {
        const lines = []
        for (const f of files) {
          if (!glob.test(f)) continue
          const n = fs.readFileSync(f, 'utf8').split(/\r?\n/).filter((l) => re.test(l)).length
          if (n) lines.push(`${f.replace(/\//g, '\\')}:${n}`)
        }
        return `## ${cls} :: ${type}\n${lines.join('\n')}`
      })
      text = cache[def.name] = blocks.join('\n') + '\n'
    }
    const dir = path.join(baseWin, `real-${inp.name}`)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'counts.txt'), text)
    fs.writeFileSync(path.join(dir, 'args.txt'), `${inp.K}\n${inp.w}\n${inp.root.replace(/\//g, '\\')}\n`)
    // тот же вход с корнем через «/»: логика разбиения мерится и тогда, когда «\» в корне скрипт не держит
    const dirF = path.join(baseWin, `real-${inp.name}-fwd`)
    fs.mkdirSync(dirF, { recursive: true })
    fs.writeFileSync(path.join(dirF, 'counts.txt'), text)
    fs.writeFileSync(path.join(dirF, 'args.txt'), `${inp.K}\n${inp.w}\n${inp.root.replace(/\\/g, '/')}\n`)
    made.push(inp.name)
  }
  console.log(`real: ${made.join(', ') || 'ни одного дерева'}`)
  process.exit(0)
}
if (mode === 'asm') {
  // <src> — папка случая; <база-win> — куда; parts/ с мутациями и CRLF, сторож черновика, args.txt (S, дата)
  const ex = JSON.parse(fs.readFileSync(path.join(src, 'expect.json'), 'utf8'))
  const from = ex.base ? path.join(src, '..', ex.base, 'parts') : path.join(src, 'parts')
  const to = path.join(baseWin, 'parts')
  fs.mkdirSync(to, { recursive: true })
  for (const f of fs.readdirSync(from)) fs.copyFileSync(path.join(from, f), path.join(to, f))
  for (const m of ex.mutate || []) {
    const p = path.join(to, m.file)
    if (m.op === 'delete') { fs.rmSync(p, { force: true }); continue }
    const lines = fs.readFileSync(p, 'utf8').split('\n')
    if (m.op === 'date') lines[0] = lines[0].replace(/\d{4}-\d{2}-\d{2}/, m.date)
    if (m.op === 'strip-first') lines.shift()
    if (m.op === 'number') lines[0] = lines[0].replace(/часть \d+/, `часть ${m.nn}`)
    if (m.op === 'append') { fs.writeFileSync(p, lines.join('\n').replace(/\n*$/, '\n') + m.text); continue }
    if (m.op === 'replace') { const t = lines.join('\n'); if (!t.includes(m.from)) throw new Error(`replace: в ${m.file} нет «${m.from}»`); fs.writeFileSync(p, t.replace(m.from, m.to)); continue }
    if (m.op === 'chomp') { fs.writeFileSync(p, lines.join('\n').replace(/\n+$/, '')); continue }   // файл без перевода строки в конце
    fs.writeFileSync(p, lines.join('\n'))
  }
  for (const f of ex.crlf || []) { const p = path.join(to, f); fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/\r?\n/g, '\r\n')) }
  if (ex.sentinel) fs.writeFileSync(path.join(baseWin, 'draft.md'), 'СТОРОЖ: прежний черновик\n')
  fs.writeFileSync(path.join(baseWin, 'args.txt'), `${ex.S}\n${ex.date}\n`)
  process.exit(0)
}

if (mode === 'roundtrip') {
  // <src> — настоящая карточка; режется на голову и 3 части с намеренными дублями; ожидание — в expect.json
  const { parseCard, splitBlocks, tableOf, normKey, blockCmp, BLOCK_SECTIONS, TABLE_SECTIONS, sumTotals, lf } = await import('./asm-lib.mjs')
  const date = process.argv[6] || '2026-10-04'
  const S = 3
  const card = parseCard(lf(fs.readFileSync(src, 'utf8')))
  const parts = Array.from({ length: S + 1 }, () => new Map()) // [1..S]: секция → строки
  const opis = Array.from({ length: S + 1 }, () => ({ keys: [], c: { e: 0, ef: 0, ent: 0, t: 0, tf: 0, top: 0, topf: 0, obj: 0, msg: 0, lim: 0 } }))
  const add = (p, sec, lines) => { if (!parts[p].has(sec)) parts[p].set(sec, []); parts[p].get(sec).push(...lines) }
  const head = [`<!-- service-map: голова ${date} -->`, ...card.preamble]
  const exp = { 'о чём': 'круговой: настоящая карточка разрезана на голову и 3 части (с намеренными дублями), склейка обязана вернуть те же заголовки ### и строки тел', S, date, want: 'ok', sections: {}, blocks: {}, rows: {}, unchanged: [], dups: {}, order: [], opisTotals: [] }
  const variant = (sec, h) => {
    let t = h.replace(/^###\s+/, '').replace(/`/g, '')
    if (sec === 'Публичный контракт') t = t.replace(/^([A-Z]+) /, (m, v) => v.toLowerCase() + ' ')
    t = t.replace(/[«»]/g, '').replace(/ — .*$/, '')
    return `### ${t} — копия части`
  }
  for (const s of card.sections) {
    exp.order.push(s.name)
    if (BLOCK_SECTIONS.includes(s.name)) {
      head.push(s.head, '', '<!-- части -->', '')
      const { pre, blocks } = splitBlocks(s.lines)
      exp.sections[s.name] = { headings: [...blocks.map((b) => b.heading)].sort(blockCmp(s.name)), sourceOrder: blocks.map((b) => b.heading) }
      exp.dups[s.name] = []
      const stub = pre.filter((l) => l.trim())
      if (!blocks.length) { for (const p of [1, 2]) add(p, s.name, ['', ...stub, '']); exp.sections[s.name].stub = stub; continue }
      blocks.forEach((b, i) => {
        const p = (i % S) + 1
        const bullets = b.body.filter((l) => /^- /.test(l))
        exp.blocks[`${s.name} :: ${b.heading}`] = b.body.filter((l) => l.trim())
        const key = normKey(b.heading)
        const o = opis[p]; o.keys.push(`${key} — src/part-${p}/x.ts`)
        const facts = bullets.length > 0
        if (s.name === 'Публичный контракт') { o.c.e++; if (facts) o.c.ef++ }
        if (s.name === 'Владеет данными') o.c.ent++
        if (s.name === 'Фоновые задачи') { o.c.t++; if (facts) o.c.tf++ }
        if (s.name === 'События') { o.c.top++; if (facts) o.c.topf++ }
        if (s.name === 'Бизнес-правила') { if (/^сообщение /.test(key)) o.c.msg++; else if (/^ограничение /.test(key)) o.c.lim++; else o.c.obj++ }
        if (i % 11 === 5 && p < S && bullets.length >= 2) {
          // раздел: первая половина пунктов у владельца, вторая (+ один общий) — у следующей части под другим заголовком
          const half = Math.ceil(bullets.length / 2)
          const second = new Set(bullets.slice(half - 1))
          const firstBody = b.body.filter((l) => !(/^- /.test(l) && second.has(l) && bullets.indexOf(l) >= half))
          add(p, s.name, ['', b.heading, ...firstBody, ''])
          add(p + 1, s.name, ['', variant(s.name, b.heading), 'копия: другое описание — должно пропасть', ...bullets.slice(half - 1), ''])
          exp.dups[s.name].push(key)
          return
        }
        add(p, s.name, ['', b.heading, ...b.body, ''])
        if (i % 7 === 3 && p < S) {
          add(S, s.name, ['', variant(s.name, b.heading), 'копия: другое описание — должно пропасть', ...bullets.filter((_, j) => j % 2 === 0), ''])
          exp.dups[s.name].push(key)
        }
      })
      continue
    }
    if (TABLE_SECTIONS.includes(s.name)) {
      const t = tableOf(s.lines)
      head.push(s.head, '', t.header, t.sep, '<!-- части -->', '')
      exp.rows[s.name] = { header: t.header, rows: t.rows }
      t.rows.forEach((r, j) => {
        const p = (j % S) + 1
        add(p, s.name, [r])
        if (j % 5 === 2) add(((p) % S) + 1, s.name, [r])
      })
      for (let p = 1; p <= S; p++) if (parts[p].has(s.name)) parts[p].set(s.name, ['', t.header, t.sep, ...parts[p].get(s.name), ''])
      continue
    }
    head.push(s.head, ...s.lines)
    exp.unchanged.push(s.name)
  }
  // роли — в опись головы
  const roles = card.sections.find((s) => s.name === 'Роли и доступ')
  const roleRows = roles ? tableOf(roles.lines).rows : []
  const headOpis = [`<!-- service-map: голова ${date} -->`, '## Роли', ...roleRows.map((r) => `${r.split('|')[1].trim().replace(/`/g, '')} — src/roles.ts`), `⟹ ролей ${roleRows.length}`]
  const to = path.join(baseWin, 'parts'); fs.mkdirSync(to, { recursive: true })
  fs.writeFileSync(path.join(to, 'head.md'), head.join('\n').replace(/\n*$/, '\n'))
  fs.writeFileSync(path.join(to, 'head.opis.md'), headOpis.join('\n') + '\n')
  const allTotals = [`⟹ ролей ${roleRows.length}`]
  for (let p = 1; p <= S; p++) {
    const nn = String(p).padStart(2, '0')
    const body = [`<!-- service-map: часть ${nn} ${date} -->`]
    for (const [sec, lines] of parts[p]) body.push(`## ${sec}`, ...lines)
    fs.writeFileSync(path.join(to, `part-${nn}.md`), body.join('\n') + '\n')
    const c = opis[p].c
    const tot = [`⟹ эндпоинтов ${c.e}, из них с фактами ${c.ef}`, `⟹ топиков ${c.top}, из них с фактами ${c.topf}`, `⟹ фоновых задач ${c.t}, из них с фактами ${c.tf}`, `⟹ сущностей ${c.ent}`, `⟹ объектов ${c.obj}, сообщений ${c.msg}, ограничений ${c.lim}`]
    allTotals.push(...tot)
    fs.writeFileSync(path.join(to, `part-${nn}.opis.md`), [`<!-- service-map: часть ${nn} ${date} -->`, `## Ключи части ${nn}`, ...opis[p].keys, '## Итоги', ...tot].join('\n') + '\n')
  }
  exp.opis = { totals: sumTotals(allTotals), order: ['head.opis.md', ...Array.from({ length: S }, (_, i) => `part-${String(i + 1).padStart(2, '0')}.opis.md`)] }
  fs.writeFileSync(path.join(baseWin, 'expect.json'), JSON.stringify(exp, null, 1))
  fs.writeFileSync(path.join(baseWin, 'args.txt'), `${S}\n${date}\n`)
  const nd = Object.values(exp.dups).reduce((a, x) => a + x.length, 0)
  console.log(`roundtrip: секций ${card.sections.length}, блоков ${Object.keys(exp.blocks).length}, намеренных дублей ${nd}`)
  process.exit(0)
}
if (mode === 'promote') {
  // случаи promote.py: черновик (кириллица, CRLF в части строк, без перевода строки в конце; 7 «### », 11 «| »),
  // meta.json для проверки (пути C:/…), cases.txt для раннера: имя|черновик|куда|подмена cp (posix-пути)
  const draft = ['---', 'service: копия-api', '---', '# копия-api — backend', '', '## Публичный контракт', '',
    '### `GET /a`', '- поле', '', '### `POST /a`\r', '- поле\r', '', '### `GET /б`', '  ### не заголовок (отступ)', '### `PUT /a`', '### `DELETE /a`', '### `PATCH /a`', '### `GET /z`', '',
    '## Зависит от', '', '| Сервис | Зачем |', '|---|---|', '| `a` | а |', '| `b` | б |\r', '| `c` | в |', '| `d` | г |', '| `e` | д |', '| `f` | е |', '| `g` | ж |', '| `h` | з |', '| `i` | и |', '|x не строка таблицы', '', 'последняя строка без перевода'].join('\n')
  const cases = [
    { name: 'p1-ok', want: 'ok', dest: 'карточки сервисов/my svc.md', mk: ['карточки сервисов'] },
    { name: 'p2-overwrite', want: 'ok', dest: 'services/svc.md', before: 'прежняя карточка\n' },
    { name: 'p3-unreachable', want: 'diverge', dest: 'plainfile/card.md', file: { plainfile: 'это файл, не папка\n' } },
    { name: 'p4-injected-cp', want: 'injected', dest: 'services/svc.md', before: 'прежняя карточка\n', inject: 1 },
    { name: 'p5-draft-missing', want: 'info', dest: 'services/svc.md', noDraft: true, category: 'справочно' },
    { name: 'p6-dest-is-dir', want: 'not-ok', dest: 'services', mk: ['services'] },
  ]
  const list = []
  for (const c of cases) {
    const dw = path.join(baseWin, c.name); const dp = `${bp}/${c.name}`
    fs.mkdirSync(dw, { recursive: true })
    for (const m of c.mk || []) fs.mkdirSync(path.join(dw, m), { recursive: true })
    for (const [f, t] of Object.entries(c.file || {})) fs.writeFileSync(path.join(dw, f), t)
    if (c.before !== undefined) { fs.mkdirSync(path.dirname(path.join(dw, c.dest)), { recursive: true }); fs.writeFileSync(path.join(dw, c.dest), c.before) }
    if (!c.noDraft) fs.writeFileSync(path.join(dw, 'draft.md'), draft)
    const meta = { want: c.want, category: c.category, draft: path.join(dw, 'draft.md'), dest: path.join(dw, c.dest), before: c.before, counts: c.want === 'ok' ? { '«### »': 7, '«| »': 10 } : undefined, extra: c.name === 'p6-dest-is-dir' ? path.join(dw, c.dest, 'draft.md') : undefined }
    fs.writeFileSync(path.join(dw, 'meta.json'), JSON.stringify(meta, null, 1))
    list.push(`${c.name}|${dp}/draft.md|${dp}/${c.dest}|${c.inject || 0}`)
  }
  fs.writeFileSync(path.join(baseWin, 'cases.txt'), list.join('\n') + '\n')
  process.exit(0)
}
console.error('режим: plan | real | asm | roundtrip | promote'); process.exit(2)
