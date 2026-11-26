#!/usr/bin/env node
// grade-nbs.mjs — пробы состояния ноута analyst-notebook 2.0.0 (PLAN-NOTEBOOK-STATE.md): номер у пункта, пометки на старой
// строке, цепочки замен, ответ на заменённый, спор, выгрузка и вопрос по ноуту с цепочками.
//
//   node grade-nbs.mjs <папка пробы> --fx <ПАПКА ФИКСТУРЫ> [--spec <файл спеки>]
//   node grade-nbs.mjs <папка пробы> --fx <ПАПКА ФИКСТУРЫ> --generic   (прежние пробы ноута: только форма 2.0.0)
//   node grade-nbs.mjs --selftest [-v]
//
// Раскладка: одиночная проба — <папка>/run-NN/ (песочница); цепочка (`run-chain.sh`) — <папка>/run-<i>/stage-<k>/run-1/.
// Ожидания — `fixtures/<ФИКСТУРА>/state.json` (или `--spec`): стадии по порядку, у каждой режим и что должно выйти.
// Засев стадии 1 — `fixtures/<ФИКСТУРА>/seed/`, стадии k — ноут песочницы стадии k−1.
//
// Общие проверки каждой стадии записи (красное):
//   история цела — строки засева на месте, как были или с ` ‖ …` в конце; новое — только ниже;
//   у каждого пункта номер = место; номера не повторяются; у каждой связи — парная пометка и наоборот; связь не на выбывший;
//   ни одного пункта вне видов; у `решено` есть `решил:`; опора нового пункта (ground-check) — в тексте вызова, реплик и ноута;
//   `confirmFirst` — на ходу 1 ноут не записан (вопрос перед записью).
// Спека стадии записи: `new` — какие пункты должны появиться (`has` — регулярки по тексту, все; `kind`; `decider` — основа
// имени в `решил:`; `links` — связи номером, `@<стадия>.<метка>` — номер пункта, найденного на той стадии); `marks` — какие
// пометки должны встать; `onlyListed` — других пометок нет; `maxNew` — потолок новых пунктов; `notNew` — таких новых нет.
// Стадия выгрузки: строки файла — ровно действующие пункты ноута (по номерам), без пометок и хвостов связей, текст как в
// ноуте; `mustNotHave` — регулярки, которых в выгрузке нет. Стадия вопроса: ноут не тронут; `must` / `mustNot` по ответу.
// «НЕ ИЗМЕРЕНО» — только отказ API (маркер раннера); стадия без ответа — красный.
import { readFileSync, existsSync, readdirSync, statSync, mkdirSync, writeFileSync, rmSync, mkdtempSync, cpSync } from 'node:fs'
import { join, dirname, relative, resolve as pathResolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { groundCheck, fmtMissing, stripRefs } from './ground-check.mjs'
import { lf, parseNotebook, activeItems, checkIds, checkPairs, staleLinks, historyIntact, addedMarks, exportLineOk, normId } from './nb-state.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXROOT = join(HERE, 'fixtures')
const RE_API = /API Error|Request not allowed|Please run \/login|Credit balance|rate limit|session limit|usage limit/i
// Видов четыре: `набросок` слит в `мысль` (2.2.0, Р4).
const KINDS = new Set(['решено', 'открыто', 'сведение', 'мысль'])
const norm = (s) => String(s).toLowerCase().replace(/ё/g, 'е')
const read = (p) => lf(readFileSync(p, 'utf8'))
const readIf = (p) => (existsSync(p) ? read(p) : '')
const short = (s) => { const t = String(s).trim(); return t.length > 110 ? t.slice(0, 107) + '…' : t }
const rx = (s) => new RegExp(norm(s), 'i')

// Пути — в NFC: засев песочницы на macOS ложится в NFD («й», «ё» — буква и знак), а пути в константах и спеках — в NFC.
function listFiles (dir, base = dir, out = []) {
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || (dir === base && (/^_/.test(e.name) || /^(answer|stream)/.test(e.name)))) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) listFiles(p, base, out); else out.push(relative(base, p).split('\\').join('/').normalize('NFC'))
  }
  return out
}
const globToRe = (g) => new RegExp('^' + g.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$')

const turnOf = (n) => { const m = n.match(/^stream-(\d+)\.jsonl$/); return m ? Number(m[1]) : 1 }
function writesOnTurn1 (sb, rel) {
  if (!existsSync(sb)) return null
  for (const f of readdirSync(sb).filter((n) => /^stream(-\d+)?\.jsonl$/.test(n) && turnOf(n) === 1)) {
    for (const line of read(join(sb, f)).split('\n')) {
      let e; try { e = JSON.parse(line) } catch { continue }
      for (const c of (e?.message?.content || [])) {
        if (c?.type !== 'tool_use') continue
        if (/^(Write|Edit|MultiEdit)$/.test(c.name) && String(c.input?.file_path || '').replace(/\\/g, '/').normalize('NFC').endsWith(rel)) return c.name
        // Запись через shell: `>>` / `>` / `tee` в путь ноута (у прогона стенда Bash есть, у скилла — нет).
        const cmd = String(c.input?.command || '').normalize('NFC')
        if (c.name === 'Bash' && cmd.includes(rel) && new RegExp(`(>>?|tee(\\s+-a)?)\\s*['"]?[^\\s'"]*${rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(cmd)) return 'Bash'
      }
    }
  }
  return null
}
const answers = (sb) => {
  if (!existsSync(sb)) return []
  const ns = readdirSync(sb).filter((n) => /^answer-\d+\.md$/.test(n)).sort()
  return ns.length ? ns.map((n) => read(join(sb, n))) : (existsSync(join(sb, 'answer.md')) ? [read(join(sb, 'answer.md'))] : [])
}
const apiFailed = (sb) => existsSync(join(sb, '_api-failure.txt')) || existsSync(join(sb, '_api-failure-turn.txt')) ||
  answers(sb).some((a) => RE_API.test(a) && a.length < 400)

// `disputes` — номер оспоренного пункта у спора; `waits` — основа имени в `ждёт:`.
const itemMatches = (it, m, ctx) => (!m.kind || [].concat(m.kind).includes(it.kind)) && (m.has || []).every((h) => rx(h).test(norm(it.text))) &&
  (!m.decider || rx('решил[аи]?\\s*:[^;]*' + m.decider).test(norm(it.text))) &&
  (!m.waits || rx('жд[её]т\\s*:[^;]*' + m.waits).test(norm(it.text))) &&
  (!m.disputes || it.disputes === ctx.resolve(m.disputes))

// ---------- стадия записи ----------
function gradeWrite (st, ctx) {
  const F = []; const W = []
  const nbRel = ctx.spec.notebook
  const fin = readIf(join(ctx.sb, nbRel))
  if (!fin) return { fails: ['ноут не найден в песочнице'], warn: W }
  const seed = ctx.seedNb
  // Файлы: кроме ноута (и его sources/) ничего не создано и не изменено.
  for (const f of listFiles(ctx.sb)) {
    if (f === nbRel || f.startsWith(dirname(nbRel) + '/sources/')) continue
    if (!(f in ctx.seedFiles)) F.push(`лишний файл: ${f}`)
    else if (read(join(ctx.sb, f)) !== ctx.seedFiles[f]) F.push(`изменён файл засева: ${f}`)
  }
  // Ноут заведён прогоном (в засеве его нет) — сверять историю не с чем.
  const h = seed ? historyIntact(seed, fin) : { bad: [], newLines: lf(fin).split('\n') }
  F.push(...h.bad.map((x) => `история: ${x}`))
  const nb = parseNotebook(fin)
  const startNew = lf(fin).split('\n').length - h.newLines.length
  const newItems = nb.items.filter((it) => it.idx >= startNew)
  // Номер — у каждого нового пункта; строку засева без номера (дописана руками) не трогают — она адресуется местом.
  F.push(...checkIds(nb, (it) => it.idx >= startNew).map((x) => `номера: ${x}`))
  { const seen = new Set(); for (const it of nb.items) { if (it.id && seen.has(it.id)) F.push(`номера: номер ${it.id} дважды`); if (it.id) seen.add(it.id) } }
  F.push(...checkPairs(nb).map((x) => `пары: ${x}`))
  F.push(...staleLinks(nb).filter((x) => newItems.some((it) => x.startsWith(it.ref + ' '))).map((x) => `связь на выбывший: ${x}`))
  for (const it of newItems) {
    if (!KINDS.has(it.kind)) F.push(`вид «${it.kind}» вне пяти: «${short(it.line)}»`)
    if (it.kind === 'решено' && !/решил[аи]?\s*:/i.test(it.text)) F.push(`решено без «решил:»: «${short(it.line)}»`)
    const g = ctx.generic ? { ok: true } : groundCheck(stripRefs(it.text), ctx.groundSrc)
    if (!g.ok) F.push(`выдумано в «${short(it.text)}»: ${fmtMissing(g)}`)
  }
  if (st.confirmFirst) { const w = writesOnTurn1(ctx.sb, nbRel); if (w) F.push(`ноут записан на ходу 1 (${w}) — до ответа на вопрос`) }
  // `writeFirst` — список, подтверждённый в источнике, без находок сверки: пишется на ходу 1, без вопроса (Р5).
  if (st.writeFirst && !writesOnTurn1(ctx.sb, nbRel)) F.push('ноут не записан на ходу 1 — список без находок пишется без вопроса')
  // Ожидания спеки.
  const ids = {}
  for (const m of st.new || []) {
    const hit = newItems.filter((it) => itemMatches(it, m, ctx))
    if (!hit.length) { F.push(`нет нового пункта «${m.as}» (${[m.kind, ...(m.has || [])].filter(Boolean).join(', ')})`); continue }
    if (hit.length > 1) W.push(`пункт «${m.as}» найден ${hit.length} раза — взят последний`)
    const it = hit[hit.length - 1]; ids[m.as] = it.ref
    for (const k of m.links || []) {
      const to = ctx.resolve(k.to)
      if (!it.links.some((x) => x.kind === k.kind && x.to === to)) F.push(`у «${m.as}» (${it.ref}) нет «${k.kind}: ${to}»${it.links.length ? ` — есть: ${it.links.map((x) => `${x.kind}: ${x.to ?? x.raw}`).join('; ')}` : ''}`)
    }
    for (const k of it.links) if (!(m.links || []).some((x) => x.kind === k.kind && ctx.resolve(x.to) === k.to)) F.push(`у «${m.as}» лишняя связь «${k.kind}: ${k.to ?? k.raw}»`)
  }
  ctx.ids[ctx.k] = ids
  const added = addedMarks(seed, fin)
  for (const m of st.marks || []) {
    const on = ctx.resolve(m.on); const by = m.by ? ids[m.by] : null
    if (m.by && !by) continue
    if (!added.some((x) => x.id === on && x.state === m.state && (!by || x.to === by))) F.push(`нет пометки «‖ ${m.state}${by ? ': ' + by : ''}» у ${on}`)
  }
  if (st.onlyListed) {
    for (const x of added) {
      const ok = (st.marks || []).some((m) => ctx.resolve(m.on) === x.id && m.state === x.state)
      if (!ok) F.push(`лишняя пометка у ${x.id}: «‖ ${x.state}: ${x.to}»`)
    }
  }
  if (st.maxNew != null && newItems.length > st.maxNew) F.push(`новых пунктов ${newItems.length}, ждали не больше ${st.maxNew}: ${newItems.map((x) => `«${short(x.text)}»`).join(' ')}`)
  for (const m of st.notNew || []) { const bad = newItems.find((it) => itemMatches(it, m, ctx)); if (bad) F.push(`новый пункт, которого быть не должно: «${short(bad.line)}»`) }
  for (const m of st.untouched || []) { const id = ctx.resolve(m); if (added.some((x) => x.id === id)) F.push(`пометка у ${id}, его трогать нельзя`) }
  // `front` — поля шапки ноута (регулярки, все), `frontNot` — полей, которых в шапке нет (Р6, Р8).
  const frontOf = (t) => { const m = lf(t).match(/^---\n([\s\S]*?)\n---/); return m ? m[1] : '' }
  const fieldOf = (name) => (frontOf(fin).split('\n').find((l) => l.startsWith(name + ':')) || '').slice(name.length + 1).trim()
  for (const [name, res] of Object.entries(st.front || {})) { const v = norm(fieldOf(name)); if (!v) F.push(`в шапке нет «${name}:»`); else for (const r of res) if (!rx(r).test(v)) F.push(`в шапке «${name}:» нет «${r}»: «${short(v)}»`) }
  for (const name of st.frontNot || []) if (frontOf(fin).split('\n').some((l) => l.startsWith(name + ':'))) F.push(`в шапке поле «${name}:», его быть не должно`)
  if (st.front && st.front['роли']) { const v = fieldOf('роли'); const g = groundCheck(v.replace(/\s*—\s*/g, ' — решил: '), ctx.groundSrc); if (!g.ok) F.push(`роли не из источника: ${fmtMissing(g)}`) }
  // `answer1Must` — в ответе хода 1 (вопрос до записи), `answerMust` — во всех ходах: регулярки по тексту ответа.
  const ans = answers(ctx.sb).map((a) => norm(a))
  for (const m of st.answer1Must || []) if (!rx(m).test(ans[0] || '')) F.push(`в ответе хода 1 нет «${m}»`)
  for (const m of st.answerMust || []) if (!rx(m).test(ans.join('\n'))) F.push(`в ответе нет «${m}»`)
  for (const m of st.answer1MustNot || []) { const l = (ans[0] || '').split('\n').find((x) => x.includes('?') && rx(m).test(x)); if (l) F.push(`в ответе хода 1 вопрос, которого быть не должно: «${short(l)}»`) }
  return { fails: [...new Set(F)], warn: W }
}

// ---------- стадия выгрузки ----------
function gradeExport (st, ctx) {
  const F = []; const W = []
  const re = globToRe(st.file)
  const files = listFiles(ctx.sb).filter((f) => re.test(f) && !(f in ctx.seedFiles))
  if (files.length !== 1) return { fails: [`файлов выгрузки ${files.length} (${st.file})`], warn: W }
  const text = read(join(ctx.sb, files[0]))
  const nb = parseNotebook(ctx.seedNb)
  if (readIf(join(ctx.sb, ctx.spec.notebook)) !== ctx.seedNb) F.push('ноут изменён выгрузкой')
  if (!/^# Пункты:/.test(text)) F.push('первая строка — не «# Пункты:»')
  const want = new Map(activeItems(nb).map((x) => [x.ref, x]))
  const got = new Map()
  for (const l of text.split('\n').filter((x) => /^- \[/.test(x))) {
    const bad = exportLineOk(l); if (bad) F.push(`${bad}: «${short(l)}»`)
    const id = normId((l.match(/·\s*([^·]+)$/) || [])[1] || '')
    if (!id) continue
    if (got.has(id)) F.push(`${id} в выгрузке дважды`)
    got.set(id, l)
    const it = nb.byId.get(id)
    if (!it) { F.push(`${id} — нет такого пункта в ноуте: «${short(l)}»`); continue }
    if (!want.has(id)) F.push(`выбывший пункт в выгрузке: ${id} «${short(it.text)}» (${it.marks.map((m) => m.raw).join('; ')})`)
    const body = l.replace(/^- \[[^\]]*\]\s*/, '').replace(/\s*·\s*[^·]+$/, '')
    if (norm(body).replace(/\s+/g, ' ') !== norm(it.text).replace(/\s+/g, ' ')) W.push(`текст ${id} не как в ноуте`)
    if ((l.match(/^- \[([^\]]*)\]/) || [])[1] !== it.kind) F.push(`вид ${id} не как в ноуте`)
  }
  for (const [id, it] of want) if (!got.has(id)) F.push(`действующего нет в выгрузке: ${id} «${short(it.text)}»`)
  for (const m of st.mustNotHave || []) if (rx(m).test(norm(text))) F.push(`в выгрузке есть «${m}»`)
  return { fails: F, warn: W }
}

// ---------- стадия вопроса ----------
function gradeAsk (st, ctx) {
  const F = []; const W = []
  if (readIf(join(ctx.sb, ctx.spec.notebook)) !== ctx.seedNb) F.push('ноут изменён в режиме вопроса')
  for (const f of listFiles(ctx.sb)) if (!(f in ctx.seedFiles)) F.push(`создан файл в режиме вопроса: ${f}`)
  const ans = norm(answers(ctx.sb).join('\n\n'))
  for (const m of st.must || []) if (!rx(m).test(ans)) F.push(`в ответе нет «${m}»`)
  // Ссылки опоры: каждая — на пункт ноута; на выбывший — только в строке о прошлом («раньше», «было», «заменено»).
  // Оспоренный пункт при действующем споре — сторона спора: ссылка на него законна (спор — обе стороны).
  const sideOfLiveDispute = (it) => { const last = it.marks[it.marks.length - 1]; const sp = last && last.state === 'оспорен' && nb.byId.get(last.to); return !!sp && !sp.marks.length }
  const nb = parseNotebook(ctx.seedNb)
  for (const l of ans.split('\n')) {
    for (const m of l.matchAll(/\d{4}-\d{2}-\d{2},?\s*№\s*\d+\.\d+/g)) {
      const it = nb.byId.get(normId(m[0]))
      if (!it) F.push(`ссылка ${m[0]} — нет такого пункта`)
      else if (it.marks.length && !sideOfLiveDispute(it) && !/(раньше|было|замен|вместо|прежн|сначала|до этого|изначальн|менял|спор|оспор|закрыт)/.test(l)) F.push(`опора на выбывший ${it.ref}: «${short(l)}»`)
    }
  }
  // `mustNot` — строки ответа: регулярка `re` нашлась, а в строке нет ни действующего значения того же предмета (`unless`),
  // ни слов о прошлом («раньше», «было», «заменено», «вернулось», «потом») — подано действующим. История рядом с
  // действующим — не ложь. Строка в спеке — то же, что `{ re }`.
  const PAST = /(раньше|было|замен|вместо|прежн|сначала|до этого|изначальн|менял|вернул|потом|первому вариант)/
  for (const m of st.mustNot || []) {
    const { re, unless } = typeof m === 'string' ? { re: m } : m
    const bad = ans.split('\n').find((l) => rx(re).test(l) && !PAST.test(l) && !(unless && rx(unless).test(l)))
    if (bad) F.push(`выбывшее подано действующим: «${short(bad)}»`)
  }
  return { fails: F, warn: W }
}

// ---------- прогон ----------
function seedFilesOf (dir) { const out = {}; for (const f of listFiles(dir)) out[f] = read(join(dir, f)); return out }

export function gradeRun (runDir, fxDir, spec) {
  const chain = spec.stages.length > 1 || existsSync(join(runDir, 'stage-1'))
  const fails = []; const warn = []
  const ids = {}
  let seedFiles = seedFilesOf(join(FIXROOT, fxDir, 'seed'))
  for (let k = 1; k <= spec.stages.length; k++) {
    const st = spec.stages[k - 1]
    const sb = chain ? join(runDir, `stage-${k}`, 'run-1') : runDir
    if (!existsSync(sb) || !answers(sb).length) {
      if (existsSync(join(runDir, '_chain-stand-failure.txt')) || (existsSync(sb) && apiFailed(sb))) return { measured: false, why: `стадия ${k}: отказ стенда или API` }
      fails.push(`стадия ${k}: нет ответа`); break
    }
    if (apiFailed(sb)) return { measured: false, why: `стадия ${k}: отказ API` }
    const promptText = readIf(join(runDir, `stage-${k}-prompt.txt`)) || readIf(join(FIXROOT, fxDir, st.prompt || 'w-prompt.txt'))
    const replies = (st.turn2 ? readIf(join(FIXROOT, fxDir, st.turn2)) : readIf(join(FIXROOT, fxDir, 'w-turn2.txt')))
    const seedNb = seedFiles[spec.notebook] ?? ''
    const ctx = {
      k, sb, spec, ids, seedFiles, seedNb,
      groundSrc: [promptText, replies, ...Object.values(seedFiles)].join('\n'),
      resolve: (ref) => { const m = String(ref).match(/^@(\d+)\.(\w+)$/); return m ? (ids[m[1]] || {})[m[2]] ?? `?${ref}` : normId(ref) || ref },
    }
    const r = st.mode === 'export' ? gradeExport(st, ctx) : st.mode === 'ask' ? gradeAsk(st, ctx) : gradeWrite(st, ctx)
    fails.push(...r.fails.map((x) => (spec.stages.length > 1 ? `ст.${k}: ` : '') + x))
    warn.push(...r.warn.map((x) => (spec.stages.length > 1 ? `ст.${k}: ` : '') + x))
    seedFiles = seedFilesOf(sb)
  }
  return { measured: true, pass: fails.length === 0, fails, warn }
}

const specOf = (fxDir, file = 'state.json') => JSON.parse(readFileSync(join(FIXROOT, fxDir, file), 'utf8'))

// `--generic` — прежние пробы ноута (grade-nb.mjs мерит их смысл): только форма 2.0.0. Каждый изменённый или новый ноут
// песочницы — история цела, номера и пары, связь не на выбывший, виды; каждая новая выгрузка `notebook-*.points.md` —
// ровно действующие пункты своего ноута. Ожиданий фикстуры нет; опору и вопрос до записи мерит grade-nb.mjs.
export function gradeGeneric (runDir, fxDir) {
  const sb = runDir
  if (!answers(sb).length) return apiFailed(sb) ? { measured: false, why: 'отказ API' } : { measured: true, pass: false, fails: ['нет ответа'], warn: [] }
  if (apiFailed(sb)) return { measured: false, why: 'отказ API' }
  const seedFiles = seedFilesOf(join(FIXROOT, fxDir, 'seed'))
  const fails = []; const warn = []
  const files = listFiles(sb)
  for (const nbRel of files.filter((f) => /^notes\/[^/]+\/notebook\.md$/.test(f))) {
    const fin = read(join(sb, nbRel))
    if (seedFiles[nbRel] === fin) continue
    const ctx = { k: 1, sb, spec: { notebook: nbRel }, ids: {}, seedFiles, seedNb: seedFiles[nbRel] ?? '', groundSrc: '', resolve: (r) => normId(r) || r }
    const r = gradeWrite({ mode: 'write' }, { ...ctx, generic: true })
    fails.push(...r.fails.filter((x) => !/^(лишний файл|изменён файл засева|выдумано)/.test(x)).map((x) => `${nbRel}: ${x}`))
  }
  for (const pts of files.filter((f) => /^notes\/[^/]+\/notebook-[^/]*\.points\.md$/.test(f) && !(f in seedFiles))) {
    const nbRel = dirname(pts) + '/notebook.md'
    const ctx = { k: 1, sb, spec: { notebook: nbRel }, ids: {}, seedFiles, seedNb: seedFiles[nbRel] ?? '', resolve: (r) => r }
    const r = gradeExport({ mode: 'export', file: pts }, ctx)
    // Часть ноута (`с <даты>`, `про <предмет>`) мерит grade-nb.mjs: здесь пропуск действующего — предупреждение.
    const part = (x) => /^действующего нет в выгрузке/.test(x)
    fails.push(...r.fails.filter((x) => !part(x)).map((x) => `${pts}: ${x}`)); warn.push(...r.warn, ...r.fails.filter(part).map((x) => `${pts}: ${x}`))
  }
  return { measured: true, pass: fails.length === 0, fails, warn }
}

function main () {
  if (process.argv.includes('--selftest')) return selftest()
  const dir = process.argv[2]; const fx = process.argv[process.argv.indexOf('--fx') + 1]
  const specFile = process.argv.includes('--spec') ? process.argv[process.argv.indexOf('--spec') + 1] : 'state.json'
  if (!dir || !existsSync(dir) || process.argv.indexOf('--fx') < 0 || !fx) { console.error('usage: node grade-nbs.mjs <папка пробы> --fx <ФИКСТУРА> [--spec <файл> | --generic] | --selftest'); process.exit(1) }
  const generic = process.argv.includes('--generic')
  const spec = generic ? null : specOf(fx, specFile)
  const runs = readdirSync(dir).filter((n) => /^run-\d+$/.test(n) && statSync(join(dir, n)).isDirectory()).sort()
  let green = 0; let measured = 0; const skipped = []
  console.log(`${fx} (${generic ? 'форма 2.0.0' : specFile}) — ${dir}`)
  for (const n of runs) {
    const r = generic ? gradeGeneric(join(dir, n), fx) : gradeRun(join(dir, n), fx, spec)
    if (!r.measured) { skipped.push(`${n} (${r.why})`); console.log(`  ${n}: НЕ ИЗМЕРЕНО — ${r.why}`); continue }
    measured++; if (r.pass) green++
    console.log(`  ${n}: ${r.pass ? 'ЗЕЛЁНЫЙ' : 'КРАСНЫЙ'}`)
    for (const f of r.fails) console.log(`         ✗ ${f}`)
    for (const w of r.warn) console.log(`         · ${w}`)
  }
  console.log(`\nИТОГ ${fx}: ${green}/${measured} зелёных${skipped.length ? `; не в счёт: ${skipped.join(', ')}` : ''}\n`)
}

// ---------- самопроверка: эталоны фикстур и порчи ----------
// Эталон стадии — `fixtures/<ФИКСТУРА>/etalon/stage-<k>/` (файлы песочницы после стадии, `answer-01.md` — по желанию).
// Песочница самопроверки: файлы эталона, ответ хода 1, пустой поток (на ходу 1 записи нет).
const FIXTURES = () => readdirSync(FIXROOT).filter((d) => existsSync(join(FIXROOT, d, 'state.json')) && existsSync(join(FIXROOT, d, 'etalon')))
  .flatMap((d) => readdirSync(join(FIXROOT, d)).filter((f) => /^state.*\.json$/.test(f) && existsSync(join(FIXROOT, d, 'etalon' + f.slice(5, -5)))).map((f) => ({ d, f, et: 'etalon' + f.slice(5, -5) })))

function selftest () {
  const verbose = process.argv.includes('-v')
  let fails = 0; let n = 0
  const ck = (name, ok, extra = '') => { n++; if (!ok) fails++; if (!ok || verbose) console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`) }
  for (const { d, f, et } of FIXTURES()) {
    const spec = specOf(d, f)
    const etDir = et
    const build = (mut) => { const s2 = JSON.parse(JSON.stringify(spec)); const b = buildRunAt(d, etDir, s2, mut); return { ...b, r: gradeRun(b.run, d, s2) } }
    const good = build(null)
    ck(`${d}/${f}: эталон зелёный`, good.r.pass, good.r.fails.join(' | '))
    rmSync(good.root, { recursive: true, force: true })
    // Порчи — общие: каждая должна дать красный.
    const nbRel = spec.notebook
    const editNb = (k0, fn) => (k, sb) => { if (k !== k0) return; const p = join(sb, nbRel); if (existsSync(p)) writeFileSync(p, fn(read(p))) }
    spec.stages.forEach((st, i) => {
      const k = i + 1
      const muts = []
      if (st.mode === 'write' && (st.marks || []).length) {
        muts.push(['пометку забыли', editNb(k, (t) => { const ls = t.split('\n'); const j = ls.findIndex((l) => /‖/.test(l) && !lastSeedHas(d, etDir, k, nbRel, l)); if (j >= 0) ls[j] = ls[j].replace(/\s*‖[^‖]*$/, ''); return ls.join('\n') })])
        muts.push(['старая строка переписана', editNb(k, (t) => t.replace(/(- \[решено\] [^\n]*?)(\d+)( час)/, (m, a, num, b) => `${a}${Number(num) + 5}${b}`))])
      }
      if (st.mode === 'write' && (st.new || []).some((m) => (m.links || []).length)) {
        muts.push(['связь без номера пункта', editNb(k, (t) => t.replace(/(;\s*(?:вместо|отвечает на):\s*\d{4}-\d{2}-\d{2} №\d+)\.\d+/, '$1'))])
      }
      if (st.mode === 'export') {
        muts.push(['выбывший в выгрузке', (kk, sb) => { if (kk !== k) return; const p = findExport(sb, st.file); if (!p) return; const nb = parseNotebook(readIf(join(sb, nbRel))); const gone = nb.items.find((x) => x.marks.length); if (gone) writeFileSync(p, read(p) + `- [${gone.kind}] ${gone.text} · ${gone.ref}\n`) }])
        muts.push(['действующий пропал', (kk, sb) => { if (kk !== k) return; const p = findExport(sb, st.file); if (!p) return; const ls = read(p).split('\n'); const j = ls.findIndex((l) => /^- \[/.test(l)); ls.splice(j, 1); writeFileSync(p, ls.join('\n')) }])
        muts.push(['пометка в выгрузке', (kk, sb) => { if (kk !== k) return; const p = findExport(sb, st.file); if (!p) return; writeFileSync(p, read(p).replace(/(\n- \[[^\n]*)/, '$1 ‖ заменён: 2026-10-30 №1.1')) }])
      }
      if (st.mode === 'ask') {
        muts.push(['ноут тронут', editNb(k, (t) => t + '\n- [мысль] лишнее · 2026-10-30 №1.1\n')])
      }
      // Порчи фикстуры — `mutations` спеки: правки текста файла стадии (`target` — ноут или глоб файла), каждая — красный.
      for (const m of (spec.mutations || []).filter((x) => x.stage === k)) {
        muts.push([m.name, (kk, sb) => {
          if (kk !== k) return
          const p = !m.target || m.target === 'notebook' ? join(sb, nbRel) : m.target.includes('*') ? findExport(sb, m.target) : join(sb, m.target)
          if (!p || !existsSync(p)) return
          let t = read(p)
          for (const [a, b] of m.edits) { if (!t.includes(a)) throw new Error(`${d}: порча «${m.name}» — нет текста «${a}»`); t = t.split(a).join(b) }
          writeFileSync(p, t)
        }])
      }
      for (const [name, mut] of muts) {
        const b = build(mut)
        ck(`${d}/${f} ст.${k}: порча «${name}» → красный`, b.r.measured && !b.r.pass, b.r.pass ? 'зелёный' : (verbose ? b.r.fails.slice(0, 2).join(' | ') : ''))
        rmSync(b.root, { recursive: true, force: true })
      }
    })
  }
  console.log(`самопроверка grade-nbs: ${n - fails}/${n}${fails ? ` — ${fails} FAIL` : ' ok'}`)
  process.exit(fails ? 1 : 0)
}
function buildRunAt (fxDir, etDir, spec, mutate) {
  const root = mkdtempSync(join(tmpdir(), 'nbs-'))
  const run = join(root, 'run-01')
  const chain = spec.stages.length > 1
  for (let k = 1; k <= spec.stages.length; k++) {
    const sb = chain ? join(run, `stage-${k}`, 'run-1') : run
    mkdirSync(sb, { recursive: true })
    cpSync(join(FIXROOT, fxDir, etDir, `stage-${k}`), sb, { recursive: true })
    if (!existsSync(join(sb, 'answer-01.md'))) writeFileSync(join(sb, 'answer-01.md'), 'Записать так?')
    // Стадия, которая пишет на ходу 1 (`writeFirst`), — в потоке хода 1 Edit ноута; иначе поток пуст.
    const st = spec.stages[k - 1]
    writeFileSync(join(sb, 'stream.jsonl'), st.writeFirst ? JSON.stringify({ message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: join(sb, spec.notebook) } }] } }) + '\n' : '')
    if (mutate) mutate(k, sb)
  }
  return { root, run }
}
function lastSeedHas (fxDir, etDir, k, nbRel, line) {
  const prev = k === 1 ? join(FIXROOT, fxDir, 'seed', nbRel) : join(FIXROOT, fxDir, etDir, `stage-${k - 1}`, nbRel)
  return readIf(prev).split('\n').includes(line)
}
function findExport (sb, glob) { const re = globToRe(glob); const f = listFiles(sb).find((x) => re.test(x)); return f ? join(sb, f) : null }

const IS_MAIN = !!process.argv[1] && fileURLToPath(import.meta.url) === pathResolve(process.argv[1])
if (IS_MAIN) main()
