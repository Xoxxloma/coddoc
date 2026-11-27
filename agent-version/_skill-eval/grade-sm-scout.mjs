#!/usr/bin/env node
// grade-sm-scout.mjs — грейдер пробы разведчика Шага 3.0 (критерий А-1, PLAN-AUTOSPLIT.md §5).
//
//   node grade-sm-scout.mjs <папка-раунда> [--sandbox <dir>]  — прогоны <раунд>/sm-scout/<фикстура>/<прогон>/
//   node grade-sm-scout.mjs --truth-check [--sandbox <dir>]   — эталонные маркеры truth.json против правды
//   node grade-sm-scout.mjs selftest                           — грейдер на известном результате
//
// Что меряется. Разведчик возвращает строки `<класс> :: <регэксп> :: <glob> :: ключ|ориентир`. Ведущий
// скилла считает ключи инструментом Grep (`output_mode="count"`) по каждой строке. Грейдер повторяет
// ровно этот счёт ТЕМ ЖЕ ДВИЖКОМ: ripgrep, встроенный в Claude Code, с теми же флагами, что
// инструмент Grep (`--hidden`, исключение .git/.svn/…, `--max-columns 500`, `-c -H --null`, `--glob` по
// разбору поля glob), по дереву сервиса в песочнице раунда — том самом, что видел разведчик.
//
// Вердикт по классу — сумма строк `ключ` в [0,8; 1,5] × правды (fixtures/SM-SCOUT/truth.json). Класс с
// правдой 0 зелёный, если сумма 0 или класс не назван. Ловушки — отдельными строками, любая > 0 красит
// прогон: `@Query` в контракте, `@Table` в сущностях, пометка класса как маркер ключа (`@DgsComponent`,
// `@RestController`, `@Controller` либо совпадение на аннотации над объявлением класса), `@DgsData`
// не-корневого типа среди ключей. Ловушки ищутся по МЕСТУ совпадений в дереве, а не по тексту
// регэкспа: красит то, что ведущий на самом деле насчитал бы. Ещё красят: регэксп не компилируется,
// строка маркера вне формы, пик контекста > 60k, Glob `**/*` (`**`) по корню дерева.
//
// «Строго» — по букве критерия. «Мягко» — класс с пометкой `без_ключа_законно` в truth.json (топики
// только в конфиге, хранение без ORM) зелёный и без строки `ключ`: план разрешает «ориентир» (§2, §8).
//
// Не измерено (в знаменатель не идёт): `_api-failure.txt`, нет answer.md, нет стрима или в нём нет
// usage, прогон вызвал инструмент кроме Read/Grep/Glob (дефект стенда, не разведчика).
import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve, dirname, basename, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIX = join(HERE, 'fixtures', 'SM-SCOUT')
const TRUTH = JSON.parse(readFileSync(join(FIX, 'truth.json'), 'utf8'))
const CLASSES = ['контракт', 'сущности', 'задачи', 'топики']
const [LO, HI] = TRUTH['окно'] || [0.8, 1.5]
const PEAK_MAX = 60000
const PASS_SHARE = 0.8            // критерий фикстуры: 4 из 5
const OWN_TOOLS = new Set(['Read', 'Grep', 'Glob'])
const VCS_DIRS = ['.git', '.svn', '.hg', '.bzr', '.jj', '.sl']   // как у инструмента Grep
const ROOT_TYPES = new Set(['Query', 'Mutation', 'Subscription'])

// ─── движок ──────────────────────────────────────────────────────────────────────────────
// Инструмент Grep Claude Code зовёт ripgrep: в нативной сборке — сам бинарь claude под argv0 «rg»
// с `--no-config`; при USE_BUILTIN_RIPGREP=0 — системный rg. Ищем тот же бинарь.
function probe(cmd, argv0) {
  try {
    const r = spawnSync(cmd, ['--no-config', '--version'], { argv0, encoding: 'utf8', timeout: 30000, windowsHide: true })
    return r.status === 0 && /^ripgrep /.test(r.stdout || '') ? r.stdout.split('\n')[0].trim() : null
  } catch { return null }
}
function claudeCandidates() {
  const out = []
  const exe = process.platform === 'win32' ? 'claude.exe' : 'claude'
  const pkgs = []
  if (process.env.APPDATA) pkgs.push(join(process.env.APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code'))
  try {
    const w = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['claude'], { encoding: 'utf8' })
    for (const p of (w.stdout || '').split(/\r?\n/).filter(Boolean)) {
      pkgs.push(join(dirname(p), 'node_modules', '@anthropic-ai', 'claude-code'))
      if (process.platform !== 'win32' || /\.exe$/i.test(p)) out.push(p)
    }
  } catch { /* нет where/which */ }
  for (const pk of pkgs) {
    out.push(join(pk, 'bin', exe))
    for (const plat of ['win32-x64', 'win32-arm64', 'linux-x64', 'linux-arm64', 'darwin-arm64', 'darwin-x64'])
      out.push(join(pk, 'node_modules', '@anthropic-ai', `claude-code-${plat}`, exe))
  }
  out.push(join(homedir(), '.local', 'bin', exe))
  return [...new Set(out)].filter(p => existsSync(p))
}
function vendorCandidates() {
  const out = []
  const pk = process.env.APPDATA ? join(process.env.APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'vendor', 'ripgrep') : null
  if (pk && existsSync(pk)) for (const d of readdirSync(pk)) {
    for (const f of ['rg.exe', 'rg']) if (existsSync(join(pk, d, f))) out.push(join(pk, d, f))
  }
  return out
}
function findEngine() {
  if (process.env.SM_SCOUT_ENGINE === 'js') return { kind: 'js', label: 'JS RegExp — выбран явно (SM_SCOUT_ENGINE=js), только для диагностики' }
  if (process.env.SM_RG) {
    const v = probe(process.env.SM_RG, process.env.SM_RG_ARGV0 || undefined)
    if (v) return { kind: 'rg', cmd: process.env.SM_RG, argv0: process.env.SM_RG_ARGV0 || undefined, label: `${v} (SM_RG=${process.env.SM_RG})` }
  }
  for (const c of claudeCandidates()) {
    const v = probe(c, 'rg')
    if (v) return { kind: 'rg', cmd: c, argv0: 'rg', label: `${v} — встроенный в Claude Code (${c}, argv0=rg)` }
  }
  for (const c of vendorCandidates()) {
    const v = probe(c)
    if (v) return { kind: 'rg', cmd: c, argv0: undefined, label: `${v} — vendor Claude Code (${c})` }
  }
  const v = probe('rg')
  if (v) return { kind: 'rg', cmd: 'rg', argv0: undefined, label: `${v} — системный rg из PATH (НЕ тот, что у инструмента Grep, если он встроенный)` }
  return { kind: 'js', label: 'JS RegExp — ripgrep не найден. РАСХОЖДЕНИЯ: синтаксис регэкспов (у rg нет обратных ссылок и lookaround — здесь они «компилируются»; \\b, \\w и классы по Unicode у rg, по ASCII здесь), .gitignore не учитывается, glob — упрощённый. Числа ориентировочные.' }
}
let ENGINE = null

// Поле glob разбирается так же, как в инструменте Grep: по пробелам; кусок с {…} — целиком, иначе по запятым.
function globList(glob) {
  const out = []
  for (const t of String(glob || '').split(/\s+/)) {
    if (!t) continue
    if (t.includes('{') && t.includes('}')) out.push(t)
    else out.push(...t.split(',').filter(Boolean))
  }
  return out
}
function baseArgs() {
  const a = ['--no-config', '--hidden']
  for (const d of VCS_DIRS) a.push('--glob', '!' + d)
  return a
}
function patArgs(p) { return p.startsWith('-') ? ['-e', p] : [p] }
const countCache = new Map()
function rgRun(args) {
  return spawnSync(ENGINE.cmd, args, { argv0: ENGINE.argv0, encoding: 'utf8', maxBuffer: 512 << 20, windowsHide: true })
}
// Счёт строк — как Grep output_mode="count".
function countLines(pattern, glob, target) {
  const key = ['c', pattern, glob, target].join('\u0001')
  if (countCache.has(key)) return countCache.get(key)
  let res
  if (ENGINE.kind === 'js') res = jsScan(pattern, glob, target, false)
  else {
    const a = baseArgs(); a.push('--max-columns', '500', '-c', '-H', '--null', ...patArgs(pattern))
    for (const g of globList(glob)) a.push('--glob', g)
    a.push(target)
    const r = rgRun(a)
    if (r.status === 2 && !r.stdout) res = { error: (r.stderr || 'ошибка rg').replace(/\s+/g, ' ').trim().slice(0, 300) }
    else {
      let n = 0
      for (const line of (r.stdout || '').split('\n')) {
        if (!line) continue
        const i = line.lastIndexOf('\0'); if (i < 0) continue
        n += Number(line.slice(i + 1)) || 0
      }
      res = { n, warn: r.status === 2 ? (r.stderr || '').trim().split('\n')[0] : '' }
    }
  }
  countCache.set(key, res)
  return res
}
// Совпадения с местом — для ловушек.
const matchCache = new Map()
function matches(pattern, glob, target) {
  const key = ['m', pattern, glob, target].join('\u0001')
  if (matchCache.has(key)) return matchCache.get(key)
  let res
  if (ENGINE.kind === 'js') res = jsScan(pattern, glob, target, true)
  else {
    const a = baseArgs(); a.push('--json', ...patArgs(pattern))
    for (const g of globList(glob)) a.push('--glob', g)
    a.push(target)
    const r = rgRun(a)
    const list = []
    for (const line of (r.stdout || '').split('\n')) {
      if (!line.startsWith('{"type":"match"')) continue
      let j; try { j = JSON.parse(line) } catch { continue }
      const d = j.data
      list.push({ path: d.path && d.path.text, line: d.line_number, text: (d.lines && d.lines.text) || '', subs: (d.submatches || []).map(s => (s.match && s.match.text) || '') })
    }
    res = list
  }
  matchCache.set(key, res)
  return res
}

// Запасной движок — только если ripgrep не найден (см. метку в отчёте).
function globToRe(g) {
  let s = '', i = 0
  while (i < g.length) {
    const ch = g[i]
    if (ch === '*' && g[i + 1] === '*') { s += '.*'; i += 2; if (g[i] === '/') i++; continue }
    if (ch === '*') { s += '[^/]*'; i++; continue }
    if (ch === '?') { s += '[^/]'; i++; continue }
    if (ch === '{') { const j = g.indexOf('}', i); if (j > i) { s += '(' + g.slice(i + 1, j).split(',').map(x => x.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('|') + ')'; i = j + 1; continue } }
    s += ch.replace(/[.+^$()|[\]\\]/g, '\\$&'); i++
  }
  return new RegExp('^' + s + '$')
}
function jsScan(pattern, glob, target, withPlaces) {
  let flags = 'u', p = pattern
  if (p.startsWith('(?i)')) { flags += 'i'; p = p.slice(4) }
  let re; try { re = new RegExp(p, flags) } catch (e) { return withPlaces ? [] : { error: String(e.message) } }
  const globs = globList(glob).map(g => ({ neg: g.startsWith('!'), re: globToRe(g.replace(/^!/, '')), path: g.includes('/') }))
  const pos = globs.filter(g => !g.neg)
  const out = []; let n = 0
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (VCS_DIRS.includes(e.name)) continue
      const full = join(dir, e.name)
      if (e.isDirectory()) { walk(full); continue }
      const rel = relative(target, full).replace(/\\/g, '/')
      const test = (g) => g.re.test(g.path ? rel : e.name)
      if (globs.some(g => g.neg && test(g))) continue
      if (pos.length && !pos.some(test)) continue
      let text; try { text = readFileSync(full, 'utf8') } catch { continue }
      text.split(/\r?\n/).forEach((ln, k) => {
        const m = ln.match(re)
        if (m) { n++; if (withPlaces) out.push({ path: full, line: k + 1, text: ln, subs: [m[0]] }) }
      })
    }
  }
  walk(target)
  return withPlaces ? out : { n }
}

// ─── ловушки по месту совпадения ─────────────────────────────────────────────────────────
const fileCache = new Map()
function fileLines(p) {
  if (!fileCache.has(p)) { let t = ''; try { t = readFileSync(p, 'utf8') } catch { /* нет */ } fileCache.set(p, t.split(/\r?\n/)) }
  return fileCache.get(p)
}
const DECL = /^(?:(?:public|protected|private|abstract|final|static|sealed|export|default|declare|open|data|internal)\s+)*(?:class|interface|enum|record|@interface|object)\s+\w+/
function parenDelta(s) {
  const t = s.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, '')
  return (t.match(/\(/g) || []).length - (t.match(/\)/g) || []).length
}
// Совпадение стоит на объявлении типа либо на аннотации/декораторе, под которым объявлен тип.
function isClassLevel(lines, i) {
  const L = lines[i]; if (L == null) return false
  const t0 = L.trim()
  if (DECL.test(t0)) return true
  if (!t0.startsWith('@')) return false
  const rest = t0.replace(/^(?:@[\w.]+(?:\([^()]*(?:\([^()]*\)[^()]*)*\))?\s*)+/, '')
  if (rest) return DECL.test(rest)
  let depth = parenDelta(L), j = i + 1
  for (let guard = 0; j < lines.length && guard < 60; guard++, j++) {
    const t = lines[j].trim()
    if (depth > 0) { depth += parenDelta(lines[j]); continue }
    if (!t || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue
    if (t.startsWith('@')) {
      const r2 = t.replace(/^(?:@[\w.]+(?:\([^()]*(?:\([^()]*\)[^()]*)*\))?\s*)+/, '')
      if (r2) return DECL.test(r2)
      depth += parenDelta(lines[j]); continue
    }
    return DECL.test(t)
  }
  return false
}
function trapsOf(cls, m) {
  const t = []
  const subs = m.subs.join('\n')
  if (cls === 'контракт' && /@Query\b/.test(subs)) t.push('query')
  if (cls === 'сущности' && /@Table\b/.test(subs)) t.push('table')
  const dg = m.text.match(/@DgsData\s*\(([^)]*)/)
  if (dg) { const p = dg[1].match(/parentType\s*=\s*"(\w+)"/); if (!p || !ROOT_TYPES.has(p[1])) t.push('dgsdata') }
  if (cls !== 'сущности') {
    if (/@(DgsComponent|RestController|Controller)\b/.test(subs)) t.push('classann')
    else if (m.path && isClassLevel(fileLines(m.path), m.line - 1)) t.push('classann')
  }
  return t
}
const TRAP_NAMES = {
  query: '`@Query` в контракте',
  table: '`@Table` в сущностях',
  classann: 'пометка класса как маркер ключа',
  dgsdata: '`@DgsData` не-корневого типа среди ключей',
}

// ─── ответ разведчика ────────────────────────────────────────────────────────────────────
const LINE_RE = /^\s*(контракт|сущности|задачи|топики)\s*::/
const KIND_RE = /^(ключ|ориентир)(?![а-яё\w])/i
function unwrap(s, notes, what) {
  let v = s.trim()
  if (v.length >= 2 && v.startsWith('`') && v.endsWith('`')) { v = v.replace(/^`+|`+$/g, ''); notes.add(`бэктики вокруг ${what} сняты`) }
  return v
}
function parseAnswer(text) {
  const markers = [], bad = [], notes = new Set()
  let listed = 0
  for (const raw of text.split(/\r?\n/)) {
    if (/^\s*(?:[-*•]|\d+[.)])\s+`?(контракт|сущности|задачи|топики)\s*::/.test(raw)) listed++
    const m = raw.match(LINE_RE); if (!m) continue
    const parts = raw.trim().split(/\s*::\s*/)
    let k = -1
    for (let i = parts.length - 1; i >= 3; i--) if (KIND_RE.test(unwrap(parts[i], new Set(), ''))) { k = i; break }
    if (k < 0) { bad.push(raw.trim()); continue }
    const kind = unwrap(parts[k], notes, 'вида').match(KIND_RE)[1].toLowerCase()
    const glob = unwrap(parts[k - 1], notes, 'glob')
    const regex = unwrap(parts.slice(1, k - 1).join('::'), notes, 'регэкспа')
    if (!regex) { bad.push(raw.trim()); continue }
    if (k < parts.length - 1) notes.add(`после вида строки есть хвост: «${parts.slice(k + 1).join(' :: ')}»`)
    markers.push({ cls: m[1], regex, glob, kind, raw: raw.trim() })
  }
  if (listed) notes.add(`строк маркеров под знаком списка (- * 1.) не разобрано: ${listed} — форма требует строку, начинающуюся с класса`)
  return { markers, bad, notes: [...notes] }
}

// Контроль разведчика (3.3.0): «контроль :: <класс> :: <файл> :: <число>» — файл, где разведчик сам
// насчитал ключи класса; ведущий сверяет с маркером. Строкой маркера не является и формат не портит.
function parseControls(text) {
  const out = []
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.trim().replace(/^`+|`+$/g, '').match(/^контроль\s*::\s*(контракт|сущности|задачи|топики)[^:]*::\s*(.+?)\s*::\s*(\d+)\s*$/)
    if (m) out.push({ cls: m[1], file: m[2].replace(/^`+|`+$/g, ''), n: Number(m[3]) })
  }
  return out
}

// ─── стрим ───────────────────────────────────────────────────────────────────────────────
const FULL_GLOB = /^(\*\*\/)*\*\*(\/\*\*)*(\/\*(\.\*)?)?$/
const norm = p => resolve(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
function globKind(input, cwd, root) {
  const pat = String(input.pattern || '').replace(/\\/g, '/')
  const segs = pat.split('/')
  let k = 0; while (k < segs.length && !/[*?[{]/.test(segs[k])) k++
  const prefix = segs.slice(0, k).join('/'), rest = segs.slice(k).join('/')
  const base = input.path ? resolve(cwd, String(input.path)) : cwd
  const dir = prefix ? resolve(base, /^[A-Za-z]:$/.test(prefix) ? prefix + '/' : prefix) : base
  const nd = norm(dir), nr = norm(root)
  const above = nr === nd || nr.startsWith(nd + '/')
  if (FULL_GLOB.test(rest)) return above ? 'root' : (nd.startsWith(nr + '/') ? 'deep' : 'other')
  if (/^\*\*\/\*\.[\w{},]+$/.test(rest) && above) return 'root-ext'
  return 'other'
}
function streamStats(file, cwd, root) {
  if (!existsSync(file)) return null
  const s = { peak: 0, peakKnown: false, globRoot: [], globRootExt: 0, globDeep: 0, tools: {}, foreign: [], initTools: null, hasResult: false, turns: 0 }
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue
    let j; try { j = JSON.parse(line) } catch { continue }
    if (j.type === 'system' && j.subtype === 'init') s.initTools = j.tools || null
    if (j.type === 'result') s.hasResult = true
    if (j.type !== 'assistant' || !j.message) continue
    const u = j.message.usage
    if (u && !j.parent_tool_use_id) {
      const v = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0)
      if (v > s.peak) s.peak = v
      s.peakKnown = true; s.turns++
    }
    for (const c of j.message.content || []) {
      if (c.type !== 'tool_use') continue
      s.tools[c.name] = (s.tools[c.name] || 0) + 1
      if (!OWN_TOOLS.has(c.name)) s.foreign.push(c.name)
      if (c.name === 'Glob') {
        const g = globKind(c.input || {}, cwd, root)
        if (g === 'root') s.globRoot.push(String((c.input || {}).pattern))
        else if (g === 'root-ext') s.globRootExt++
        else if (g === 'deep') s.globDeep++
      }
    }
  }
  return s
}

// ─── прогон ──────────────────────────────────────────────────────────────────────────────
function gradeRun(fx, runDir, sandbox) {
  const T = TRUTH.fixtures[fx]
  const cwd = resolve(sandbox, fx), root = resolve(sandbox, fx, T.tree)
  const res = { fx, run: basename(runDir), measured: true, why: '', classes: {}, traps: {}, trapWhere: {}, invalid: [], bad: [], notes: [], strict: '', lax: '', flags: [] }
  const nm = (why) => { res.measured = false; res.why = why; res.strict = res.lax = 'НЕ ИЗМЕРЕНО'; res.flags = ['не измерено']; return res }
  if (existsSync(join(runDir, '_api-failure.txt'))) return nm('отказ API')
  if (!existsSync(join(runDir, 'answer.md'))) return nm('нет answer.md')
  const st = streamStats(join(runDir, '_stream.jsonl'), cwd, root)
  if (!st) return nm('нет _stream.jsonl')
  if (st.foreign.length) return nm(`СТЕНД: прогон вызвал ${[...new Set(st.foreign)].join(', ')} — у разведчика только Read/Grep/Glob`)
  if (!st.peakKnown) return nm('в стриме нет usage — пик не измерить')
  if (st.initTools) {
    const extra = st.initTools.filter(t => !OWN_TOOLS.has(t))
    if (extra.length) res.notes.push(`СТЕНД: прогону были ДОСТУПНЫ ${extra.join(', ')} (не вызывал)`)
  }
  res.stream = st
  const answer = readFileSync(join(runDir, 'answer.md'), 'utf8')
  const { markers, bad, notes } = parseAnswer(answer)
  res.bad = bad; res.notes.push(...notes); res.markerCount = markers.length
  for (const k of Object.keys(TRAP_NAMES)) { res.traps[k] = 0; res.trapWhere[k] = new Set() }
  for (const cls of CLASSES) {
    const truth = T.classes[cls] || { n: 0 }
    const c = { n: truth.n, sum: 0, orient: 0, keys: 0, validKeys: 0, optional: !!truth['без_ключа_законно'], okStrict: false, okLax: false, why: '' }
    for (const m of markers.filter(x => x.cls === cls)) {
      const r = countLines(m.regex, m.glob, root)
      if (r.error) { res.invalid.push(`${m.raw}  →  ${r.error}`); if (m.kind === 'ключ') c.keys++; continue }
      if (r.warn) res.notes.push(`rg: ${r.warn}`)
      m.n = r.n
      if (m.kind === 'ориентир') { c.orient += r.n; continue }
      c.keys++; c.validKeys++; c.sum += r.n
      for (const p of matches(m.regex, m.glob, root)) {
        for (const t of new Set(trapsOf(cls, p))) {
          res.traps[t]++
          res.trapWhere[t].add(`${m.raw}  ⟶  ${relative(root, p.path || '').replace(/\\/g, '/')}:${p.line}: ${p.text.trim().slice(0, 90)}`)
        }
      }
    }
    if (c.n === 0) {
      c.okStrict = c.okLax = c.sum === 0
      c.why = c.sum === 0 ? (c.validKeys ? 'правда 0, грепом 0' : 'правда 0, класс не назван') : `правда 0, грепом ${c.sum}`
    } else if (!c.validKeys || c.sum === 0) {
      c.okStrict = false; c.okLax = c.optional
      c.why = (c.validKeys ? 'маркер ключа дал 0' : (c.keys ? 'регэксп ключа не компилируется' : 'строки «ключ» нет')) +
        (c.optional ? ` — законно мягко: ${truth['без_ключа_законно']}` : '')
    } else {
      const ratio = c.sum / c.n
      c.okStrict = c.okLax = ratio >= LO - 1e-9 && ratio <= HI + 1e-9
      c.why = `${ratio.toFixed(2)} × правды`
    }
    res.classes[cls] = c
  }
  // Куда показывает пометка топиков (раунд 2026-10-15): на конфиг или её нет — нарезка отдаёт
  // топики остатку, и тела событий пишутся из конфига. На строгий/мягкий вердикт А-1 не влияет.
  const tn = (T.classes['топики'] || { n: 0 }).n, tl = markers.filter(x => x.cls === 'топики')
  const isConf = g => /(ya?ml|properties|json|toml|env|conf|ini|xml)\W*$/i.test(g)
  if (tn === 0) res.topicMask = tl.length ? { ok: false, why: `правда 0, а строка есть: ${tl.map(m => m.glob).join(', ')}` } : { ok: true, why: 'правда 0, строки нет' }
  else if (!tl.length) res.topicMask = { ok: false, why: 'строки нет — топики уйдут остатку' }
  else if (tl.some(m => isConf(m.glob))) res.topicMask = { ok: false, why: `на конфиге: ${tl.filter(m => isConf(m.glob)).map(m => m.glob).join(', ')}` }
  else {
    const cnt = tl.reduce((s, m) => s + (m.n || 0), 0)
    res.topicMask = { ok: cnt >= 1 && cnt <= 2 * tn, why: `на коде (${tl.map(m => m.glob).join(', ')}), совпадений ${cnt}` + (cnt > 2 * tn ? ` — шире двойной правды ${2 * tn}` : cnt === 0 ? ' — ноль' : '') }
  }
  // Контроль: у каждого класса со строкой «ключ» не по спеке — строка контроля; маркер класса в её
  // файле против числа разведчика (меньше половины — «узкий», как у plan.sh). На вердикт А-1 не влияет.
  const ctl = parseControls(answer)
  const needCtl = CLASSES.filter(cls => markers.some(x => x.cls === cls && x.kind === 'ключ' && x.raw.split(/\s*::\s*/).length < 5))
  const missCtl = needCtl.filter(cls => !ctl.some(c => c.cls === cls))
  const ctlInfo = ctl.map(c => {
    const f = resolve(c.file)
    if (!existsSync(f)) return `${c.cls}: файла нет (${c.file})`
    let m = 0
    for (const x of markers.filter(y => y.cls === c.cls && y.kind === 'ключ')) { const r = countLines(x.regex, x.glob, f); if (!r.error) m += r.n }
    return `${c.cls} ${m}/${c.n}${m * 2 < c.n ? ' УЗКИЙ' : ''}`
  })
  res.control = { ok: missCtl.length === 0, narrow: ctlInfo.some(t => / УЗКИЙ$/.test(t)), why: (missCtl.length ? `нет у ${missCtl.join(', ')}` : `есть у всех классов с ключом (${needCtl.join(', ') || '—'})`) + (ctlInfo.length ? `; маркер/разведчик: ${ctlInfo.join(', ')}` : '') }
  for (const k of Object.keys(TRAP_NAMES)) res.trapWhere[k] = [...res.trapWhere[k]].slice(0, 3)
  const trapHit = Object.values(res.traps).some(v => v > 0)
  const common = !trapHit && !res.invalid.length && !res.bad.length && st.peak <= PEAK_MAX && st.globRoot.length === 0
  res.strict = common && CLASSES.every(c => res.classes[c].okStrict) ? 'ЗЕЛЁНЫЙ' : 'КРАСНЫЙ'
  res.lax = common && CLASSES.every(c => res.classes[c].okLax) ? 'ЗЕЛЁНЫЙ' : 'КРАСНЫЙ'
  for (const c of CLASSES) if (!res.classes[c].okStrict) res.flags.push('класс:' + c)
  for (const [k, v] of Object.entries(res.traps)) if (v > 0) res.flags.push(k)
  if (res.invalid.length) res.flags.push('регэксп')
  if (res.bad.length) res.flags.push('формат')
  if (st.peak > PEAK_MAX) res.flags.push('пик')
  if (st.globRoot.length) res.flags.push('glob')
  return res
}

const k1 = n => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n)
function printRun(r, out) {
  if (!r.measured) { out.push(`  ${r.run.padEnd(18)} НЕ ИЗМЕРЕНО — ${r.why}`); return }
  const mark = r.strict === r.lax ? r.strict : `${r.strict} (мягко ${r.lax})`
  out.push(`  ${r.run.padEnd(18)} ${mark}   строк маркеров ${r.markerCount}`)
  for (const cls of CLASSES) {
    const c = r.classes[cls]
    const ok = c.okStrict ? 'ок' : (c.okLax ? 'мягко ок' : 'КРАСНЫЙ')
    out.push(`      ${cls.padEnd(9)} ${String(c.sum).padStart(4)} / ${String(c.n).padEnd(4)} ${ok.padEnd(9)} ${c.why}${c.orient ? `; ориентир ${c.orient}` : ''}`)
  }
  out.push(`      пометка топиков: ${r.topicMask.ok ? 'ок' : 'КРАСНЫЙ'} — ${r.topicMask.why}`)
  out.push(`      контроль: ${r.control.ok ? 'ок' : 'КРАСНЫЙ'} — ${r.control.why}`)
  const tr = Object.entries(r.traps).map(([k, v]) => `${TRAP_NAMES[k]} ${v}`).join(' · ')
  out.push(`      ловушки: ${tr}`)
  for (const [k, list] of Object.entries(r.trapWhere)) for (const w of list) out.push(`        [${k}] ${w}`)
  out.push(`      регэкспов не компилируется ${r.invalid.length} · строк вне формы ${r.bad.length} · пик контекста ${k1(r.stream.peak)} ${r.stream.peak <= PEAK_MAX ? '≤' : '>'} 60k · Glob ** по корню ${r.stream.globRoot.length}` +
    ` (инфо: **/*.ext по корню ${r.stream.globRootExt}, ** по поддереву ${r.stream.globDeep}; вызовы ${Object.entries(r.stream.tools).map(([t, n]) => t + ' ' + n).join(', ') || '—'})`)
  for (const s of r.invalid) out.push(`        [регэксп] ${s}`)
  for (const s of r.bad) out.push(`        [формат] ${s}`)
  for (const s of r.notes) out.push(`        [заметка] ${s}`)
}

function gradeRound(roundDir, sandbox, { quiet = false } = {}) {
  const base = existsSync(join(roundDir, 'sm-scout')) ? join(roundDir, 'sm-scout') : roundDir
  const results = []
  const out = [`движок: ${ENGINE.label}`, `песочница: ${sandbox}`, '']
  let allPass = true, allPassLax = true
  const missing = []
  for (const fx of Object.keys(TRUTH.fixtures)) {
    const d = join(base, fx)
    if (!existsSync(d)) { missing.push(fx); continue }
    if (!existsSync(join(sandbox, fx, TRUTH.fixtures[fx].tree))) { out.push(`${fx}: НЕТ ДЕРЕВА в песочнице ${join(sandbox, fx)} — не оценить`); allPass = allPassLax = false; continue }
    const runs = readdirSync(d).filter(x => statSync(join(d, x)).isDirectory()).sort()
    if (!runs.length) { out.push(`${fx}: прогонов нет — не оценено`, ''); missing.push(fx); continue }
    out.push(`${fx}  (правда: ${CLASSES.map(c => `${c} ${TRUTH.fixtures[fx].classes[c].n}`).join(', ')})`)
    const rs = runs.map(x => gradeRun(fx, join(d, x), sandbox))
    rs.forEach(r => printRun(r, out))
    const meas = rs.filter(r => r.measured), M = meas.length
    const need = Math.ceil(PASS_SHARE * M - 1e-9)
    const g = meas.filter(r => r.strict === 'ЗЕЛЁНЫЙ').length, gl = meas.filter(r => r.lax === 'ЗЕЛЁНЫЙ').length
    const pass = M > 0 && g >= need, passL = M > 0 && gl >= need
    if (!pass) allPass = false
    if (!passL) allPassLax = false
    out.push(`  ПОМЕТКА ТОПИКОВ ${fx}: ок ${meas.filter(r => r.topicMask.ok).length} из ${M}`)
    out.push(`  КОНТРОЛЬ ${fx}: у всех классов с ключом ${meas.filter(r => r.control.ok).length} из ${M}; узкий маркер по контролю ${meas.filter(r => r.control.narrow).length} из ${M}`)
    out.push(`  КОНТРАКТ ${fx}: в окне ${meas.filter(r => r.classes['контракт'].okStrict).length} из ${M}`)
    out.push(`  ИТОГ ${fx}: строго зелёных ${g} из ${M} (нужно ≥ ${need}) — ${pass ? 'ПРОЙДЕН' : 'НЕ ПРОЙДЕН'}; мягко ${gl} из ${M} — ${passL ? 'ПРОЙДЕН' : 'НЕ ПРОЙДЕН'}; не измерено ${rs.length - M}${M && M < 5 ? '  (измерено меньше 5 — критерий 4/5 не применим буквально)' : ''}`)
    out.push('')
    results.push(...rs)
  }
  out.push(`А-1 по фикстурам раунда: строго ${allPass ? 'ПРОЙДЕН' : 'НЕ ПРОЙДЕН'}; мягко ${allPassLax ? 'ПРОЙДЕН' : 'НЕ ПРОЙДЕН'}` +
    (missing.length ? ` — НЕ ВСЕ ФИКСТУРЫ: без прогонов ${missing.join(', ')}, А-1 целиком не измерен` : ''))
  if (!quiet) console.log(out.join('\n'))
  return { results, text: out.join('\n') }
}

// ─── эталон против правды ────────────────────────────────────────────────────────────────
function truthCheck(sandbox) {
  let ok = true
  console.log(`движок: ${ENGINE.label}\nпесочница: ${sandbox}\n`)
  for (const [fx, T] of Object.entries(TRUTH.fixtures)) {
    const root = resolve(sandbox, fx, T.tree)
    if (!existsSync(root)) { console.log(`${fx}: нет дерева ${root}`); ok = false; continue }
    const { markers, bad } = parseAnswer(T.reference.join('\n'))
    if (bad.length) { console.log(`${fx}: эталон вне формы: ${bad.join(' | ')}`); ok = false }
    const line = []
    for (const cls of CLASSES) {
      let sum = 0
      for (const m of markers.filter(x => x.cls === cls && x.kind === 'ключ')) {
        const r = countLines(m.regex, m.glob, root)
        if (r.error) { console.log(`${fx}: эталон не компилируется: ${m.raw} → ${r.error}`); ok = false; continue }
        sum += r.n
      }
      const good = sum === T.classes[cls].n
      if (!good) ok = false
      line.push(`${cls} ${sum}/${T.classes[cls].n}${good ? '' : ' ≠'}`)
    }
    console.log(`${fx.padEnd(14)} ${line.join(' · ')}`)
  }
  console.log(ok ? '\nэталон = правда по всем классам' : '\nЭТАЛОН РАСХОДИТСЯ С ПРАВДОЙ — сначала разобраться (репа уехала? движок? песочница?)')
  return ok
}

// ─── самопроверка на известном результате ───────────────────────────────────────────────
function ensureSandbox(sb) {
  if (existsSync(join(sb, '_built.txt'))) return
  console.log(`собираю песочницу самопроверки: ${sb}`)
  const r = spawnSync('bash', [join(FIX, 'sandbox.sh'), sb], { stdio: 'inherit' })
  if (r.status !== 0) { console.error('песочница не собралась'); process.exit(2) }
}
function selftest() {
  const sb = join(FIX, 'out')
  ensureSandbox(sb)
  const okTruth = truthCheck(sb)
  console.log('')
  const round = join(FIX, 'grader-selftest')
  const expected = JSON.parse(readFileSync(join(round, 'expected.json'), 'utf8'))
  const { results, text } = gradeRound(round, sb, { quiet: true })
  const report = join(sb, 'selftest-GRADE.txt')   // в out/ — он в .gitignore, путь машинный
  writeFileSync(report, text + '\n')
  const rows = [['случай', 'ожидалось', 'получено', '']]
  let bad = 0
  const seen = new Set()
  for (const r of results) {
    const id = `${r.fx}/${r.run}`; seen.add(id)
    const e = expected[id]
    const got = `${r.strict}${r.lax !== r.strict ? ` / мягко ${r.lax}` : ''} [${r.flags.join(', ')}]`
    if (!e) { rows.push([id, '— нет в expected.json', got, 'НЕТ ОЖИДАНИЯ']); bad++; continue }
    const want = `${e['строго']}${e['мягко'] !== e['строго'] ? ` / мягко ${e['мягко']}` : ''} [${e['флаги'].join(', ')}]`
    const same = e['строго'] === r.strict && e['мягко'] === r.lax &&
      JSON.stringify([...e['флаги']].sort()) === JSON.stringify([...r.flags].sort())
    if (!same) bad++
    rows.push([id, want, got, same ? 'ок' : 'РАСХОЖДЕНИЕ'])
  }
  for (const id of Object.keys(expected)) if (!id.startsWith('_') && !seen.has(id)) { rows.push([id, 'есть в expected.json', 'прогона нет', 'РАСХОЖДЕНИЕ']); bad++ }
  const w = [0, 1, 2].map(i => Math.max(...rows.map(r => r[i].length)))
  for (const r of rows) console.log(`${r[0].padEnd(w[0])}  ${r[1].padEnd(w[1])}  ${r[2].padEnd(w[2])}  ${r[3]}`)
  console.log(`\nподробный отчёт грейдера: ${report}`)
  console.log(bad === 0 && okTruth ? `\nSELFTEST: ок — ${results.length} случаев, эталон = правда` : `\nSELFTEST: ПРОВАЛ — расхождений ${bad}${okTruth ? '' : ', эталон ≠ правда'}`)
  process.exit(bad === 0 && okTruth ? 0 : 1)
}

// ─── вход ────────────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }
ENGINE = findEngine()
if (argv[0] === 'selftest') selftest()
else if (argv.includes('--truth-check')) {
  const sb = resolve(opt('--sandbox') || join(FIX, 'out'))
  process.exit(truthCheck(sb) ? 0 : 1)
} else {
  const round = argv.find(a => !a.startsWith('--') && a !== opt('--sandbox'))
  if (!round) { console.error('нужна папка раунда: node grade-sm-scout.mjs <раунд> [--sandbox <dir>] | --truth-check | selftest'); process.exit(2) }
  const sb = resolve(opt('--sandbox') || join(round, 'sandbox-scout'))
  const { text } = gradeRound(resolve(round), sb)
  const base = existsSync(join(round, 'sm-scout')) ? join(round, 'sm-scout') : round
  writeFileSync(join(base, 'GRADE.txt'), text + '\n')
  console.log(`\nотчёт: ${join(base, 'GRADE.txt')}`)
}
