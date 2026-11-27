#!/usr/bin/env node
// grade-sm-mono.mjs — полный прогон service-map на синтетическом монолите (run-sm-mono.sh).
// Критерии Б-5 и Б-6 плана PLAN-AUTOSPLIT.md §5.
//
//   node grade-sm-mono.mjs <папка-раунда> [--json]     отчёт и <раунд>/GRADE-MONO.txt
//   node grade-sm-mono.mjs --truth <NRS-TAIL|SM-MONO-DGS|SM-MONO-SPEC|SM-MONO-SPEC-BIG>  правда по дереву фикстуры, числа по классам
//   node grade-sm-mono.mjs --selftest                   мини-песочницы fixtures/SM-MONO-RUN/grader-selftest/
//
// ПРАВДА — множества ключей, извлечённые из сгенерированного дерева (`fixtures/<фикстура>/out/<сервис>`;
// нет — дерево первой песочницы раунда), а не числа из головы. Число каждого класса сверяется с
// expected.md фикстуры (NRS-TAIL 139/88/9/18, SM-MONO-DGS 120/60/10/12); не сошлось — грейдер отказывается.
//   контракт — REST: глагол + путь с префиксом класс-уровневого @RequestMapping (у NRS-TAIL путь метода
//              уже содержит префикс — тогда засчитывается и он, и удвоенный путь, каким его собрал бы Spring);
//              DGS: тип операции + имя (`query findCases0`), только корневые Query/Mutation/Subscription;
//   сущности — классы @Entity (засчитывается имя класса, оно же без суффикса Entity, имя таблицы);
//   задачи   — классы с @Scheduled (у всех метод `run`, поэтому ключ — класс; `Класс.run` тоже годится);
//   топики   — имена из application.yaml под `topics`/`topic`; направление — `producers` → публикует,
//              иначе потребляет. Доля — по имени; расхождение направления печатается отдельно.
//   REST из спецификации — операция `src/main/resources/openapi.yaml` в правде, только если её operationId
//              реализован методом класса `implements …Api`; объявленная без реализации и топик из
//              `src/test` — «призраки»: в правду не идут, в карточке считаются отдельно (критерий Б-7).
// КАРТОЧКА — `w/AI-SDD/services/<сервис>.md`; ключи — заголовки `###` в секциях «Публичный контракт»,
// «Владеет данными», «Фоновые задачи», «События». Грейдится файл, не формулировка отчёта.
// БЛОКИ КОНТРАКТА (справочно, без критерия) — блок от `### ` до следующего `### `/`## `; пустой — ни одной
//   строки, начинающейся с «- ». Считается по карточке и по каждой `.work/<сервис>/part-NN.md`.
//   «GraphQL без типа» — заголовок блока не с HTTP-глагола и не с `query `/`mutation `/`subscription `.
// SM-MONO-SPEC --big-spec (вариант SM-MONO-SPEC-BIG: дерево песочницы со всеми operationId ключа или
//   `_variant.txt` с `--big-spec`) — факты операций спеки по `fixtures/SM-MONO-SPEC/big-spec-key.tsv`:
//   засчитан, если в блоке своей операции есть и анкер (целым словом, без учёта регистра), и код.
// ТРАССА — `_stream.jsonl` (не `_trace.jsonl` и не ответ): ведущий — события без parent_tool_use_id.
// Не измерено — `_api-failure.txt`, нет answer.md (брошено в фоне без удачного повтора, обрыв).
import { readFileSync, existsSync, readdirSync, statSync, writeFileSync, mkdtempSync, cpSync, rmSync, mkdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'

const HERE = import.meta.dirname
const FIXT = {
  'NRS-TAIL': { svc: 'cargonet', expect: { contract: 139, entities: 88, jobs: 9, topics: 18 } },
  'SM-MONO-DGS': { svc: 'casedesk', expect: { contract: 120, entities: 60, jobs: 10, topics: 12 } },
  // casedesk плюс REST из openapi.yaml без аннотаций (28 реализовано, 2 только объявлены) и тестовый конфиг с 4 топиками
  'SM-MONO-SPEC': { svc: 'casedesk', expect: { contract: 148, entities: 60, jobs: 10, topics: 12 } },
  // make.sh --big-spec: 100 операций спеки, 98 реализованы, у каждой факт-анкер из ключа; дерево — своё out/big-spec
  'SM-MONO-SPEC-BIG': { svc: 'casedesk', dir: 'SM-MONO-SPEC', out: join('out', 'big-spec'), variant: '--big-spec', key: 'big-spec-key.tsv', expect: { contract: 218, entities: 60, jobs: 10, topics: 12 } },
  // make.sh --owners: ручки JAX-RS без пометок, общие сущности у ручек двух модулей, поля из базового класса
  'SM-MONO-SPEC-OWN': { svc: 'casedesk', dir: 'SM-MONO-SPEC', out: join('out', 'owners'), variant: '--owners', shared: ['InspectorEntity', 'RegionEntity', 'OfficeEntity'], expect: { contract: 156, entities: 66, jobs: 10, topics: 12 } },
  // make.sh --crosscut: роли, переходы и отправки в местах использования; правда сквозных фактов — ниже, по разделу 6 make.sh
  'SM-MONO-SPEC-CROSS': {
    svc: 'casedesk', dir: 'SM-MONO-SPEC', out: join('out', 'crosscut'), variant: '--crosscut', expect: { contract: 155, entities: 64, jobs: 12, topics: 15 },
    cross: {
      roles: ['PLANNER', 'INSPECTOR', 'SUPERVISOR', 'ADMIN', 'LEAD'],
      access: {
        'POST /api/inspections': ['PLANNER'], 'POST /api/inspections/{id}/start': ['INSPECTOR'],
        'POST /api/inspections/{id}/pause': ['INSPECTOR', 'SUPERVISOR'], 'POST /api/inspections/{id}/cancel': ['SUPERVISOR'],
        'POST /api/inspections/{id}/finish': ['LEAD|руковод'], 'GET /api/admin/inspections/stats': ['ADMIN'], 'GET /api/inspections/{id}': ['без проверки'],
      },
      state: { entity: 'InspectionEntity', values: ['PLANNED', 'STARTED', 'PAUSED', 'FINISHED', 'CANCELLED'] },
      noBlock: ['InspectionHistoryEntity', 'InspectionMemberEntity'], refValues: ['LOW', 'HIGH'],
      messages: ['kontrol.inspection.started.v1', 'kontrol.inspection.finished.v1', 'inspection-report'],
      publish: ['kontrol.inspection.started.v1', 'kontrol.inspection.finished.v1'], consume: ['kontrol.inspection.halt.v1'],
      when: { 'kontrol.inspection.started.v1': 'start', 'kontrol.inspection.finished.v1': 'finish' },
      dep: 'registry-service', notDep: ['postgres', 'postgresql', 'kafka'],
    },
  },
}
const fxDir = (fx) => FIXT[fx].dir || fx
const CLASSES = ['contract', 'entities', 'jobs', 'topics']
const RU = { contract: 'контракт', entities: 'сущности', jobs: 'задачи', topics: 'топики' }
const SECTION = { contract: 'Публичный контракт', entities: 'Владеет данными', jobs: 'Фоновые задачи', topics: 'События' }
const PEAK_LEAD_MAX = 200000   // решение владельца 10-04 после попытки 1 Б: «всё, что до 200к, укладывается»
const SHARE_MIN = 0.95
const SCRIPTS = ['plan.sh', 'assemble.sh', 'promote.sh', 'check.sh']

const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8').replace(/\r\n?/g, '\n') : '')
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === '.git' ? [] : walk(join(d, e.name))) : [join(d, e.name)]))

// ─── нормализация ключей ────────────────────────────────────────────────────────────────
export const normPath = (p) => {
  let s = String(p).replace(/[`'"«»]/g, '').replace(/[?#].*$/, '').trim().toLowerCase()
  s = s.replace(/\{[^}/]*\}/g, '{}').replace(/(^|\/):[a-z_][a-z0-9_]*/g, '$1{}')
  s = ('/' + s).replace(/\/+/g, '/')
  if (s.length > 1) s = s.replace(/\/$/, '')
  return s
}
const restKey = (verb, path) => `${verb.toUpperCase()} ${normPath(path)}`
const gqlKey = (op, name) => `${op.toLowerCase()} ${name.toLowerCase()}`
const headCore = (h) => h.replace(/`/g, '').split(/\s+[—–]\s+/)[0].trim()

// ─── правда по дереву ───────────────────────────────────────────────────────────────────
const annoPath = (args) => {
  if (args == null) return ''
  const m = args.match(/(?:value|path)\s*=\s*"([^"]*)"/) || args.match(/^\s*"([^"]*)"/)
  return m ? m[1] : ''
}

export function extractTruth (tree) {
  const T = { contract: new Map(), entities: new Map(), jobs: new Map(), topics: new Map(), ghost: { contract: new Map(), topics: new Map() }, inherited: new Map() }
  const supers = new Map(); const ext = new Map()   // @MappedSuperclass → его поля; сущность → базовый класс
  // T[class]: каноничный ключ → { aliases: Set, dir?, file }
  const add = (cls, key, aliases, extra = {}) => {
    if (!T[cls].has(key)) T[cls].set(key, { aliases: new Set(), ...extra })
    for (const a of aliases) T[cls].get(key).aliases.add(a)
  }
  const javaFiles = walk(join(tree, 'src')).filter((f) => f.endsWith('.java'))
  for (const f of javaFiles) {
    const t = read(f)
    const rel = relative(tree, f).split(sep).join('/')
    const classIdx = t.search(/\b(class|interface|enum|record)\s+\w+/)
    const head = classIdx >= 0 ? t.slice(0, classIdx) : t
    const body = classIdx >= 0 ? t.slice(classIdx) : ''
    const cm = body.match(/^(?:class|interface|enum|record)\s+(\w+)/)
    const className = cm ? cm[1] : null
    // REST
    const pm = head.match(/@RequestMapping\s*(?:\(([^)]*)\))?/)
    const prefix = pm ? annoPath(pm[1] ?? '') : ''
    // клиент к соседу (@FeignClient) — вызов наружу, а не ручка сервиса: в контракт не идёт
    for (const m of (/@FeignClient\b/.test(head) ? [] : body.matchAll(/@(Get|Post|Put|Patch|Delete)Mapping\b\s*(?:\(([^)]*)\))?/g))) {
      const verb = m[1].toUpperCase(); const p = annoPath(m[2] ?? '')
      const nPre = prefix ? normPath(prefix) : ''; const nP = normPath(p || '/')
      const already = nPre && (nP === nPre || nP.startsWith(nPre + '/'))
      const canonical = already ? nP : normPath((prefix || '') + '/' + (p || ''))
      const aliases = [restKey(verb, canonical)]
      if (already) aliases.push(restKey(verb, normPath(prefix + '/' + p)))
      add('contract', restKey(verb, canonical), aliases, { file: rel })
    }
    // REST JAX-RS: класс-уровневый @Path и @GET/@POST/… у метода, свой @Path метода — следующей строкой
    const jp = head.match(/@Path\s*\(\s*"([^"]*)"\s*\)/)
    if (jp) {
      for (const m of body.matchAll(/@(GET|POST|PUT|PATCH|DELETE)\b(?:\s*@Path\s*\(\s*"([^"]*)"\s*\))?/g)) {
        const k = restKey(m[1], normPath(jp[1] + '/' + (m[2] || '')))
        add('contract', k, [k], { file: rel, jaxrs: true })
      }
    }
    // поля базового класса — для счёта «поля из базового класса» (не класс ключей)
    if (/@MappedSuperclass\b/.test(head) && className) supers.set(className, [...body.matchAll(/^\s+private\s+[\w<>,.?\s]+?\s+(\w+)\s*;/gm)].map((m) => m[1]))
    const xm = body.match(/^(?:class)\s+\w+\s+extends\s+(\w+)/)
    if (xm && className && /@Entity\b/.test(head)) ext.set(className, xm[1])
    // DGS — только корневые типы
    for (const m of body.matchAll(/@Dgs(Query|Mutation|Subscription)\b\s*(\(([^)]*)\))?[\s\S]*?\b(\w+)\s*\(/g)) {
      const fm = (m[3] || '').match(/field\s*=\s*"(\w+)"/)
      const name = fm ? fm[1] : m[4]
      add('contract', gqlKey(m[1], name), [gqlKey(m[1], name)], { file: rel })
    }
    for (const m of body.matchAll(/@DgsData\s*\(([^)]*)\)[\s\S]*?\b(\w+)\s*\(/g)) {
      const pt = (m[1].match(/parentType\s*=\s*"(\w+)"/) || [])[1]
      if (!/^(Query|Mutation|Subscription)$/.test(pt || '')) continue
      const name = (m[1].match(/field\s*=\s*"(\w+)"/) || [])[1] || m[2]
      add('contract', gqlKey(pt, name), [gqlKey(pt, name)], { file: rel })
    }
    // сущности
    if (/@Entity\b/.test(head) && className) {
      const table = (head.match(/@Table\s*\(\s*name\s*=\s*"([^"]+)"/) || [])[1]
      const al = [className.toLowerCase()]
      if (/Entity$/.test(className) && className.length > 6) al.push(className.replace(/Entity$/, '').toLowerCase())
      if (table) al.push(table.toLowerCase())
      add('entities', className, al, { file: rel })
    }
    // задачи
    for (const m of body.matchAll(/@Scheduled\b[^\n]*\n[\s\S]*?\b(\w+)\s*\(/g)) {
      if (!className) continue
      add('jobs', className, [className.toLowerCase(), `${className}.${m[1]}`.toLowerCase(), `${className}#${m[1]}`.toLowerCase()], { file: rel, method: m[1] })
    }
  }
  for (const [cls, sup] of ext) if (supers.has(sup)) T.inherited.set(cls, supers.get(sup))
  // REST из файла спецификации: реализованные операции — в правду, только объявленные — в призраки
  const spec = join(tree, 'src', 'main', 'resources', 'openapi.yaml')
  if (existsSync(spec)) {
    const impl = new Map()
    for (const f of javaFiles) {
      const t = read(f); if (!/\bimplements\s+\w+Api\b/.test(t)) continue
      for (const m of t.matchAll(/@Override\s+public\s+[^\n(]+?\s(\w+)\s*\(/g)) impl.set(m[1], relative(tree, f).split(sep).join('/'))
    }
    let p = null; let verb = null
    for (const raw of read(spec).split('\n')) {
      let m
      if ((m = raw.match(/^ {2}(\/\S*):\s*$/))) { p = m[1]; verb = null; continue }
      if ((m = raw.match(/^ {4}(get|post|put|patch|delete):\s*$/))) { verb = m[1]; continue }
      if (p && verb && (m = raw.match(/^ {6}operationId:\s*(\w+)/))) {
        const k = restKey(verb, p)
        if (impl.has(m[1])) add('contract', k, [k], { file: impl.get(m[1]) }); else T.ghost.contract.set(k, m[1])
      }
    }
  }
  // топики — application.yaml; конфиг из src/test — призраки
  for (const y of walk(join(tree, 'src')).filter((f) => /application[^/\\]*\.ya?ml$/.test(f))) {
    const inTest = /[\\/]src[\\/]test[\\/]/.test(y)
    const addTopic = (name, path) => (inTest ? T.ghost.topics.set(name, 'src/test') : add('topics', name, [name.toLowerCase()], { dir: path.some((k) => /producer/i.test(k)) ? 'публикует' : 'потребляет' }))
    const stack = []
    for (const raw of read(y).split('\n')) {
      if (!raw.trim() || /^\s*#/.test(raw)) continue
      const ind = raw.match(/^\s*/)[0].length
      const li = raw.match(/^\s*-\s+(.+?)\s*$/)
      if (li) {
        while (stack.length && stack[stack.length - 1].ind >= ind) stack.pop()
        const path = stack.map((s) => s.key)
        if (/^topics?$/.test(path[path.length - 1] || '')) {
          const name = li[1].replace(/['"]/g, '')
          addTopic(name, path)
        }
        continue
      }
      const kv = raw.match(/^\s*([\w.-]+):\s*(.*?)\s*$/)
      if (!kv) continue
      while (stack.length && stack[stack.length - 1].ind >= ind) stack.pop()
      stack.push({ key: kv[1], ind })
      if (kv[2] && /^topics?$/.test(kv[1])) {
        const name = kv[2].replace(/['"]/g, '')
        const path = stack.map((s) => s.key)
        addTopic(name, path)
      }
    }
  }
  return T
}

// ключ ответов большой спеки: глагол, путь, operationId, код, вид, анкер — строками через табуляцию
export function loadKey (fx) {
  const f = join(HERE, 'fixtures', fxDir(fx), FIXT[fx].key)
  if (!existsSync(f)) throw new Error(`нет ключа ответов ${f}`)
  const rows = []
  for (const l of read(f).split('\n')) {
    if (!l.trim() || l.startsWith('#')) continue
    const c = l.split('\t')
    if (c.length !== 9 || !/^\d{3}$/.test(c[5])) throw new Error(`строка ключа не по форме: ${l}`)
    rows.push({ mod: c[0], verb: c[2], path: c[3], opid: c[4], code: c[5], kind: c[6], anchor: c[7], key: restKey(c[2], c[3]) })
  }
  return rows
}
// дерево большой спеки — в его openapi.yaml есть все operationId ключа (у базы их 28 из 98)
const BIG = 'SM-MONO-SPEC-BIG'
function isBigTree (tree) {
  const ids = new Set([...read(join(tree, 'src', 'main', 'resources', 'openapi.yaml')).matchAll(/^\s+operationId:\s*(\w+)/gm)].map((m) => m[1]))
  return loadKey(BIG).every((r) => ids.has(r.opid))
}

// дерево варианта --owners — по базовому классу аудита
const OWN = 'SM-MONO-SPEC-OWN'
const isOwnTree = (tree) => existsSync(join(tree, 'src', 'main', 'java', 'ru', 'kontrol', 'casedesk', 'v2', 'common', 'persistence', 'AuditedEntity.java'))
// дерево варианта --crosscut — по сервису проверок на месте
const CROSS = 'SM-MONO-SPEC-CROSS'
const isCrossTree = (tree) => existsSync(join(tree, 'src', 'main', 'java', 'ru', 'kontrol', 'casedesk', 'v2', 'inspections', 'service', 'InspectionService.java'))

function truthTree (fx, round) {
  const svc = FIXT[fx].svc
  const own = [join(HERE, 'fixtures', fxDir(fx), 'out', svc)]
  if (FIXT[fx].out) own.push(join(HERE, 'fixtures', fxDir(fx), FIXT[fx].out, svc))
  const sbx = []
  if (round) {
    const sb = join(round, 'sandbox')
    if (existsSync(sb)) for (const d of readdirSync(sb).sort()) sbx.push(join(sb, d, 'w', svc))
  }
  // вариант SM-MONO-SPEC — по дереву: базе не годится дерево большой спеки, и наоборот; большой спеке
  // сначала песочница — out/ на её раунд подменяют и возвращают обычным
  const fits = (t) => existsSync(join(t, 'src')) && (fx === BIG ? isBigTree(t) : fx === OWN ? isOwnTree(t) : fx === CROSS ? isCrossTree(t) : fx === 'SM-MONO-SPEC' ? !isBigTree(t) && !isOwnTree(t) && !isCrossTree(t) : true)
  return (fx === BIG ? [...sbx, ...own] : [...own, ...sbx]).find(fits) || null
}

export function loadTruth (fx, round, { build = false } = {}) {
  if (!FIXT[fx]) throw new Error(`неизвестная фикстура ${fx}`)
  const outRel = FIXT[fx].out || 'out'
  const make = `bash fixtures/${fxDir(fx)}/make.sh fixtures/${fxDir(fx)}/${outRel.split(sep).join('/')}${FIXT[fx].variant ? ' ' + FIXT[fx].variant : ''}`
  let tree = truthTree(fx, round)
  if (!tree && build) {
    const r = spawnSync('bash', [join(HERE, 'fixtures', fxDir(fx), 'make.sh'), join(HERE, 'fixtures', fxDir(fx), outRel), ...(FIXT[fx].variant ? [FIXT[fx].variant] : [])], { encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`make.sh ${fx} упал: ${r.stderr}`)
    tree = truthTree(fx, round)
  }
  if (!tree) throw new Error(`нет дерева ${fx}: соберите ${make}`)
  const T = extractTruth(tree)
  const exp = FIXT[fx].expect
  // числа expected.md — тот же источник, что в шапке; файл проверяется на месте, чтобы правка правды не прошла молча
  const md = read(join(HERE, 'fixtures', fxDir(fx), 'expected.md'))
  const bad = []
  for (const c of CLASSES) {
    if (T[c].size !== exp[c]) bad.push(`${RU[c]}: извлечено ${T[c].size}, в expected.md ${exp[c]}`)
    if (md && !md.includes(`**${exp[c]}**`)) bad.push(`в expected.md нет «**${exp[c]}**» (${RU[c]}) — правда фикстуры изменилась, поправьте грейдер`)
  }
  const key = FIXT[fx].key ? loadKey(fx) : null
  if (key) for (const r of key) if (!T.contract.has(r.key)) bad.push(`строка ключа ${r.opid} (${r.key}) не в правде контракта`)
  if (bad.length) throw new Error(`правда ${fx} не сходится с expected.md:\n  ${bad.join('\n  ')}`)
  return { fx, svc: FIXT[fx].svc, tree, T, key }
}

// ─── карточка ───────────────────────────────────────────────────────────────────────────
function sectionHeads (text) {
  const res = {}; let cur = null
  for (const l of text.split('\n')) {
    if (/^## /.test(l)) { cur = l.slice(3).trim(); continue }
    if (/^# /.test(l)) { cur = null; continue }
    if (cur && /^### /.test(l)) (res[cur] ||= []).push(l.slice(4).trim())
  }
  return res
}

function matchContract (h, T) {
  const s = h.replace(/`/g, ' ')
  const r = s.match(/\b(GET|POST|PUT|PATCH|DELETE)\b\s+(\/\S*)/i)
  let k = null
  if (r) k = restKey(r[1], r[2].replace(/[),.;:]+$/, ''))
  else {
    const g = s.match(/\b(query|mutation|subscription)\b\s*[.:]?\s*(\w+)/i) || (() => { const x = s.match(/\b(\w+)\s*\(\s*(query|mutation|subscription)\s*\)/i); return x ? [x[0], x[2], x[1]] : null })()
    if (g) k = gqlKey(g[1], g[2])
  }
  if (!k) return null
  for (const [key, v] of T.contract) if (v.aliases.has(k)) return key
  return null
}
function matchByToken (h, map, re) {
  const toks = h.replace(/`/g, ' ').split(re).filter(Boolean).map((x) => x.toLowerCase())
  const joined = headCore(h).toLowerCase()
  for (const [key, v] of map) if (v.aliases.has(joined)) return key
  for (const t of toks) for (const [key, v] of map) if (v.aliases.has(t)) return key
  return null
}

export function gradeCard (text, truth) {
  const heads = sectionHeads(text)
  const res = {}
  for (const c of CLASSES) {
    // блок «транспорт» в «Событиях» — общая обвязка брокера (4.0.0), а не топик: в счёт ключей не идёт
    const hs = (heads[SECTION[c]] || []).filter((h) => !(c === 'topics' && /^транспорт\b/.test(headCore(h))))
    const found = new Set(); const extras = []; const dups = []; const seenRaw = new Set(); const dirMismatch = []
    for (const h of hs) {
      const raw = headCore(h).toLowerCase()
      let key = null
      if (c === 'contract') key = matchContract(h, truth.T)
      else if (c === 'topics') key = matchByToken(h, truth.T.topics, /[^A-Za-z0-9_.-]+/)
      else key = matchByToken(h, truth.T[c], /[^A-Za-z0-9_.#]+/)
      if (key) {
        if (found.has(key)) dups.push(h); else found.add(key)
        if (c === 'topics') {
          const want = truth.T.topics.get(key).dir
          const got = /потребл/i.test(h) ? 'потребляет' : /публик/i.test(h) ? 'публикует' : null
          if (got && got !== want) dirMismatch.push(h)
        }
      } else if (seenRaw.has(raw)) dups.push(h)
      else extras.push(h)
      seenRaw.add(raw)
    }
    const missing = [...truth.T[c].keys()].filter((k) => !found.has(k))
    res[c] = { found: found.size, truth: truth.T[c].size, share: truth.T[c].size ? found.size / truth.T[c].size : 1, extras, dups, missing, dirMismatch }
  }
  // призраки среди лишних: операция спецификации без реализации и топик тестового конфига
  const g = truth.T.ghost || { contract: new Map(), topics: new Map() }
  res.ghost = {
    contract: res.contract.extras.filter((h) => g.contract.has(restOf(h))),
    topics: res.topics.extras.filter((h) => [...g.topics.keys()].some((n) => h.toLowerCase().includes(n.toLowerCase()))),
    has: g.contract.size + g.topics.size > 0,
  }
  return res
}
function restOf (h) { const r = h.replace(/`/g, ' ').match(/\b(GET|POST|PUT|PATCH|DELETE)\b\s+(\/\S*)/i); return r ? restKey(r[1], r[2].replace(/[),.;:]+$/, '')) : null }

// ─── блоки контракта: пустота, тип GraphQL, факты большой спеки ──────────────────────────
// блок — заголовок `### ` секции «Публичный контракт» и строки до следующего `### `/`## `/`# `
export function contractBlocks (text) {
  const blocks = []; let inSec = false; let cur = null
  for (const l of text.split('\n')) {
    if (/^#{1,3} /.test(l)) {
      cur = null
      if (/^## /.test(l)) inSec = l.slice(3).trim() === SECTION.contract
      else if (/^# /.test(l)) inSec = false
      else if (inSec) { cur = { head: l.slice(4).trim(), lines: [] }; blocks.push(cur) }
      continue
    }
    if (cur) cur.lines.push(l)
  }
  return blocks
}
const typedHead = (h) => { const s = h.replace(/`/g, '').trim(); return /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s/.test(s) || /^(query|mutation|subscription)\s/.test(s) }
export function blockStats (text) {
  const b = contractBlocks(text)
  const untyped = b.filter((x) => !typedHead(x.head)).map((x) => x.head)
  return { blocks: b.length, empty: b.filter((x) => !x.lines.some((l) => l.startsWith('- '))).length, untyped: untyped.length, untypedHeads: untyped }
}
// слово целиком без учёта регистра; граница — не [A-Za-z0-9_] (кириллица рядом — граница). Без RegExp из строки.
const WORDCH = /[A-Za-z0-9_]/
export function hasWord (text, w) {
  const t = text.toLowerCase(); const k = String(w).toLowerCase()
  for (let i = t.indexOf(k); i >= 0; i = t.indexOf(k, i + 1)) {
    const a = i > 0 ? t[i - 1] : ''; const z = t[i + k.length] || ''
    if (!(a && WORDCH.test(a)) && !(z && WORDCH.test(z))) return true
  }
  return false
}
// факт засчитан, если в блоке своей операции (по глаголу и пути заголовка) есть и анкер, и код
export function gradeFacts (text, key) {
  const blocks = contractBlocks(text).map((b) => ({ rk: restOf(b.head), body: [b.head, ...b.lines].join('\n') }))
  const r = { hit: 0, anchorNoCode: 0, elsewhere: 0, absent: 0, noBlock: 0, total: key.length, miss: [] }
  for (const k of key) {
    const own = blocks.filter((b) => b.rk === k.key)
    if (!own.length) { r.noBlock++; r.miss.push(`${k.opid} (блока нет)`); continue }
    if (own.some((b) => hasWord(b.body, k.anchor) && hasWord(b.body, k.code))) { r.hit++; continue }
    if (own.some((b) => hasWord(b.body, k.anchor))) { r.anchorNoCode++; r.miss.push(`${k.opid} (${k.anchor} без ${k.code})`); continue }
    // в своих блоках анкера нет — значит, найденный в карточке лежит вне их
    if (hasWord(text, k.anchor)) { r.elsewhere++; r.miss.push(`${k.opid} (${k.anchor} вне блока)`) } else { r.absent++; r.miss.push(`${k.opid} (${k.anchor} нет)`) }
  }
  return r
}
// ─── владение по файлу (вариант --owners): поля из базового класса, ручки без пометок, общие сущности ───
function sectionBlocks (text, section) {
  const blocks = []; let inSec = false; let cur = null
  for (const l of text.split('\n')) {
    if (/^#{1,3} /.test(l)) {
      cur = null
      if (/^## /.test(l)) inSec = l.slice(3).trim() === section
      else if (/^# /.test(l)) inSec = false
      else if (inSec) { cur = { head: l.slice(4).trim(), lines: [] }; blocks.push(cur) }
      continue
    }
    if (cur) cur.lines.push(l)
  }
  return blocks
}
// поле базового класса засчитано, если его имя целым словом стоит в блоке своей сущности
export function gradeOwners (text, truth, res) {
  const blocks = sectionBlocks(text, SECTION.entities)
  const of = (cls) => blocks.filter((b) => matchByToken(b.head, new Map([[cls, truth.T.entities.get(cls)]]), /[^A-Za-z0-9_.#]+/))
  const inh = { total: 0, hit: 0, entities: truth.T.inherited.size, full: 0, miss: [] }
  for (const [cls, fields] of truth.T.inherited) {
    const body = of(cls).map((b) => b.lines.join('\n')).join('\n'); let n = 0
    for (const f of fields) { inh.total++; if (body && hasWord(body, f)) { inh.hit++; n++ } else inh.miss.push(`${cls}.${f}`) }
    if (n === fields.length) inh.full++
  }
  const jx = [...truth.T.contract].filter(([, v]) => v.jaxrs).map(([k]) => k)
  const jxMiss = jx.filter((k) => res.contract.missing.includes(k))
  const shared = (FIXT[truth.fx].shared || []).map((cls) => ({ cls, blocks: of(cls).length }))
  return { inh, jaxrs: { total: jx.length, found: jx.length - jxMiss.length, miss: jxMiss }, shared }
}

// ─── сквозные факты (вариант --crosscut): роли, доступ у ручек, переходы, сообщения, метки событий, соседи ───
// Грейдится файл карточки. Роль — токен в первой колонке «Роли и доступ» (без бэктиков, `ROLE_` и области в
// скобках, без учёта регистра); доступ — строка `доступ:` в блоке своей ручки содержит ожидаемое (через «|» —
// любое из); значение состояния — токен в бэктиках в блоке сущности, и строка не «не определено»; сообщение —
// заголовок `###` «Бизнес-правил» содержит токен; метки — строки `- <метка>:` в блоке «Событий».
export function gradeCross (text, truth) {
  const X = FIXT[truth.fx].cross
  const low = (s) => s.toLowerCase()
  const rows = (sec) => { const out = []; let inSec = false
    for (const l of text.split('\n')) { if (/^## /.test(l)) { inSec = l.slice(3).trim() === sec; continue } if (inSec && /^\|/.test(l) && !/^\|[\s:|-]*$/.test(l)) out.push(l.split('|')[1].trim()) }
    return out.slice(1) }   // первая строка — заголовок таблицы
  const roleKeys = rows('Роли и доступ').map((c) => low(c.replace(/`/g, '').replace(/\s*\(.*$/, '').replace(/^role_/i, '').trim()))
  const roles = { total: X.roles.length, found: X.roles.filter((r) => roleKeys.includes(low(r))).length, open: roleKeys.some((k) => /без входа/.test(k)), miss: X.roles.filter((r) => !roleKeys.includes(low(r))) }
  const contract = sectionBlocks(text, SECTION.contract)
  const keyOf = (h) => { const c = headCore(h); const m = c.match(/^(GET|POST|PUT|PATCH|DELETE)\s+(\S+)/i); return m ? restKey(m[1], m[2]) : low(c) }
  const accessLine = (b) => (b.lines.find((l) => /^доступ:/.test(l)) || '')
  const access = { total: 0, hit: 0, miss: [] }
  for (const [k, want] of Object.entries(X.access)) {
    access.total++
    const kk = restKey(k.split(' ')[0], k.split(' ')[1]); const b = contract.find((x) => keyOf(x.head) === kk)
    const line = b ? low(accessLine(b)) : ''
    if (line && want.every((w) => w.split('|').some((alt) => line.includes(low(alt))))) access.hit++; else access.miss.push(`${k}${b ? (line ? ` («${line.slice(0, 60)}»)` : ' (строки нет)') : ' (блока нет)'}`)
  }
  const withAccess = contract.filter((b) => accessLine(b)).length
  const br = sectionBlocks(text, 'Бизнес-правила')
  const ent = br.find((b) => { const h = headCore(b.head); return h === X.state.entity || h === X.state.entity.replace(/Entity$/, '') })
  const states = { total: X.state.values.length, hit: 0, miss: [], block: !!ent }
  for (const v of X.state.values) {
    const l = ent ? ent.lines.find((x) => x.includes('`' + v + '`')) : null
    if (l && !/не определено/.test(l)) states.hit++; else states.miss.push(v + (l ? ' (не определено)' : ''))
  }
  const extraBlocks = br.filter((b) => X.noBlock.some((n) => [n, n.replace(/Entity$/, '')].includes(headCore(b.head)))).map((b) => headCore(b.head))
  const refInObj = br.filter((b) => !/^сообщение/.test(headCore(b.head))).some((b) => X.refValues.some((v) => b.lines.join('\n').includes('`' + v + '`')))
  const heads = br.map((b) => b.head)
  const messages = { total: X.messages.length, found: X.messages.filter((m) => heads.some((h) => h.includes(m))).length, miss: X.messages.filter((m) => !heads.some((h) => h.includes(m))) }
  const ev = sectionBlocks(text, SECTION.topics)
  const evBlock = (dir, t) => ev.find((b) => headCore(b.head) === `${dir} ${t}`)
  const PUB = ['тело', 'ключ', 'когда', 'гарантия', 'не шлётся']; const CON = ['читает', 'группа', 'подтверждение', 'повтор', 'ошибка']
  const labels = (b) => new Set(b.lines.map((l) => (l.match(/^- ([^`:]+):/) || [])[1]).filter(Boolean).map((s) => s.trim()))
  const slots = { total: 0, hit: 0, miss: [] }
  for (const [dir, list, need] of [['публикует', X.publish, PUB], ['потребляет', X.consume, CON]]) for (const t of list) {
    const b = evBlock(dir, t); const got = b ? labels(b) : new Set()
    for (const s of need) { slots.total++; if (got.has(s)) slots.hit++; else slots.miss.push(`${dir} ${t}: ${s}`) }
  }
  const when = { total: 0, hit: 0, miss: [] }
  for (const [t, w] of Object.entries(X.when)) { when.total++; const b = evBlock('публикует', t); const l = b ? b.lines.find((x) => /^- когда:/.test(x)) || '' : ''; if (l.includes(w)) when.hit++; else when.miss.push(t) }
  const deps = rows('Зависит от').map((c) => low(c.replace(/`/g, '')))
  const dep = { has: deps.some((d) => d.includes(X.dep)), infra: deps.filter((d) => X.notDep.some((n) => d === n || d.startsWith(n + ' '))) }
  return { roles, access, withAccess, contractBlocks: contract.length, states, extraBlocks, refInObj, messages, slots, when, dep }
}

// части: `.work/<сервис>/part-NN.md` песочницы, по возрастанию номера
function partStats (dir, svc) {
  const d = join(dir, 'w', 'AI-SDD', 'services', '.work', svc)
  if (!existsSync(d)) return []
  return readdirSync(d).filter((f) => /^part-\d+\.md$/.test(f)).sort().map((f) => ({ part: f.slice(5, -3), ...blockStats(read(join(d, f))) }))
}

// ─── трасса и пики ──────────────────────────────────────────────────────────────────────
export function gradeStream (text) {
  const r = { lead: { peak: 0, readWork: 0, agents: 0, tools: 0 }, sub: { readWork: 0, tools: 0 }, scripts: {}, subs: [], events: 0 }
  for (const s of SCRIPTS) r.scripts[s] = { lead: 0, sub: 0 }
  const desc = new Map(); const subs = new Map()
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let e; try { e = JSON.parse(line) } catch { continue }
    if (e.type !== 'assistant' || !e.message) continue
    r.events++
    const u = e.message.usage || {}
    const ctx = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0)
    const isSub = !!e.parent_tool_use_id
    if (isSub) {
      const s = subs.get(e.parent_tool_use_id) || { id: e.parent_tool_use_id, desc: e.task_description || desc.get(e.parent_tool_use_id) || '?', peak: 0 }
      s.peak = Math.max(s.peak, ctx); subs.set(e.parent_tool_use_id, s)
    } else r.lead.peak = Math.max(r.lead.peak, ctx)
    for (const c of e.message.content || []) {
      if (c.type !== 'tool_use') continue
      const who = isSub ? 'sub' : 'lead'
      r[who].tools++
      const i = c.input || {}
      if (!isSub && (c.name === 'Agent' || c.name === 'Task')) { r.lead.agents++; desc.set(c.id, i.description || i.subagent_type || '?') }
      if (c.name === 'Read' && /(^|[\\/])\.work[\\/]/.test(String(i.file_path || ''))) r[who].readWork++
      if ((c.name === 'Bash' || c.name === 'PowerShell') && typeof i.command === 'string') {
        for (const s of SCRIPTS) if (i.command.includes(s)) r.scripts[s][who]++
      }
    }
  }
  for (const s of subs.values()) { if (s.desc === '?' && desc.has(s.id)) s.desc = desc.get(s.id); r.subs.push(s) }
  return r
}

// ─── прогон ─────────────────────────────────────────────────────────────────────────────
export function gradeRun (dir, truth) {
  const name = dir.split(/[\\/]/).pop()
  const ans = join(dir, 'answer.md')
  const bg = existsSync(dir) ? readdirSync(dir).filter((f) => /^_bg-abandoned/.test(f)).length : 0
  if (existsSync(join(dir, '_api-failure.txt'))) return { name, measured: false, why: 'отказ API / обрыв' }
  if (!existsSync(ans) || !read(ans).trim()) return { name, measured: false, why: bg ? 'брошено в фоне' : 'нет answer.md' }
  const cardPath = join(dir, 'w', 'AI-SDD', 'services', `${truth.svc}.md`)
  const card = read(cardPath)
  const cardOk = card.trim().length > 0
  const keys = cardOk ? gradeCard(card, truth) : null
  const st = gradeStream(read(join(dir, '_stream.jsonl')))
  const cost = Number(read(join(dir, '_cost.txt')).trim()) || 0
  const dirt = existsSync(join(dir, '_dirt.txt'))
  const sharesOk = cardOk && CLASSES.every((c) => keys[c].share >= SHARE_MIN)
  const topicsFull = cardOk && keys.topics.found === keys.topics.truth
  const b5 = cardOk && sharesOk && topicsFull
  const b6 = st.events > 0 && st.lead.peak > 0 && st.lead.peak <= PEAK_LEAD_MAX && st.lead.readWork === 0
  // Б-7: в карточке нет призраков и ни один ключ контракта не описан дважды; null — у фикстуры призраков нет
  const b7 = (truth.T.ghost.contract.size + truth.T.ghost.topics.size) === 0 ? null : cardOk && keys.ghost.contract.length === 0 && keys.ghost.topics.length === 0 && keys.contract.dups.length === 0
  // справочно, без критерия: пустые блоки контракта (карточка и части), GraphQL без типа, факты большой спеки
  const blocks = cardOk ? blockStats(card) : null
  const parts = partStats(dir, truth.svc)
  const facts = cardOk && truth.key ? gradeFacts(card, truth.key) : null
  const owners = cardOk && truth.fx === OWN ? gradeOwners(card, truth, keys) : null
  const cross = cardOk && truth.fx === CROSS ? gradeCross(card, truth) : null
  return { name, measured: true, card: cardOk, keys, st, cost, dirt, bg, b5, b6, b7, blocks, parts, facts, owners, cross }
}

function detectFixture (round) {
  const fx = detectBase(round)
  if (fx !== 'SM-MONO-SPEC') return fx
  // раннер вариантов не знает: большая спека — по дереву первой песочницы, без дерева — по _variant.txt
  const sb = join(round, 'sandbox')
  const tree = existsSync(sb) ? readdirSync(sb).sort().map((d) => join(sb, d, 'w', FIXT[fx].svc)).find((t) => existsSync(join(t, 'src'))) : null
  if (tree) return isCrossTree(tree) ? CROSS : isOwnTree(tree) ? OWN : isBigTree(tree) ? BIG : fx
  const v = read(join(round, '_variant.txt'))
  return v.includes(FIXT[CROSS].variant) ? CROSS : v.includes(FIXT[OWN].variant) ? OWN : v.includes(FIXT[BIG].variant) ? BIG : fx
}
function detectBase (round) {
  const j = join(round, '_mono.json')
  if (existsSync(j)) { try { return JSON.parse(read(j)).fixture } catch {} }
  const sb = join(round, 'sandbox')
  if (existsSync(sb)) for (const d of readdirSync(sb)) for (const [fx, v] of Object.entries(FIXT)) if (existsSync(join(sb, d, 'w', v.svc))) return fx
  return null
}

export function gradeRound (round, { build = false } = {}) {
  const fx = detectFixture(round)
  if (!fx) throw new Error(`не понял фикстуру раунда ${round}: нет _mono.json и песочниц с cargonet/casedesk`)
  const truth = loadTruth(fx, round, { build })
  const sb = join(round, 'sandbox')
  const dirs = existsSync(sb) ? readdirSync(sb).filter((d) => /^mono-\d+$/.test(d) && statSync(join(sb, d)).isDirectory()).sort() : []
  const runs = dirs.map((d) => gradeRun(join(sb, d), truth))
  const m = runs.filter((r) => r.measured)
  // красный прогон красит сразу (3/3 уже недостижимо); иначе зелёный — только при ≥ 3 измеренных
  const verdict = (k, n) => (k < n ? `${k}/${n} — КРАСНЫЙ` : n < 3 ? `${k}/${n} — НЕ ХВАТАЕТ ИЗМЕРЕНИЙ (нужно ≥ 3)` : `${k}/${n} — ЗЕЛЁНЫЙ`)
  return {
    round, fx, svc: truth.svc, truthCounts: Object.fromEntries(CLASSES.map((c) => [c, truth.T[c].size])), runs,
    measured: m.length, notMeasured: runs.length - m.length,
    b5: { ok: m.filter((r) => r.b5).length, n: m.length, verdict: verdict(m.filter((r) => r.b5).length, m.length) },
    b6: { ok: m.filter((r) => r.b6).length, n: m.length, verdict: verdict(m.filter((r) => r.b6).length, m.length) },
    b7: truth.T.ghost.contract.size + truth.T.ghost.topics.size === 0 ? null : { ok: m.filter((r) => r.b7).length, n: m.length, verdict: verdict(m.filter((r) => r.b7).length, m.length) },
    ghostCounts: { contract: truth.T.ghost.contract.size, topics: truth.T.ghost.topics.size },
    cost: runs.reduce((a, r) => a + (r.cost || 0), 0),
    factsTotal: truth.key ? truth.key.length : null,
  }
}

const pct = (x) => `${(x * 100).toFixed(1)} %`
function report (R) {
  const L = []
  L.push(`проба sm-mono, ${R.round}`)
  L.push(`фикстура ${R.fx}, сервис ${R.svc}; правда по дереву: ${CLASSES.map((c) => `${RU[c]} ${R.truthCounts[c]}`).join(', ')} (= expected.md)`)
  for (const r of R.runs) {
    L.push('')
    if (!r.measured) { L.push(`${r.name}: НЕ ИЗМЕРЕНО — ${r.why}`); continue }
    L.push(`${r.name}: карточка ${r.card ? 'записана' : 'НЕТ'}${r.dirt ? '  !!! ТРОГАЛ ПАПКУ СЕРВИСА (_dirt.txt)' : ''}${r.bg ? '  (был повтор после «брошено в фоне»)' : ''}`)
    if (r.card) {
      for (const c of CLASSES) {
        const k = r.keys[c]
        L.push(`  ${RU[c].padEnd(9)} ${k.found}/${k.truth} (${pct(k.share)})  лишних ${k.extras.length}, повторов ${k.dups.length}${k.dirMismatch.length ? `, направление не то ${k.dirMismatch.length}` : ''}${k.missing.length && k.missing.length <= 6 ? `  · нет: ${k.missing.join('; ')}` : k.missing.length ? `  · нет: ${k.missing.slice(0, 6).join('; ')} …и ещё ${k.missing.length - 6}` : ''}`)
        if (k.extras.length) L.push(`            лишние: ${k.extras.slice(0, 5).join(' | ')}${k.extras.length > 5 ? ` …и ещё ${k.extras.length - 5}` : ''}`)
      }
    }
    const s = r.st
    L.push(`  трасса: субагентов ${s.lead.agents}; ${SCRIPTS.map((x) => `${x} ${s.scripts[x].lead}+${s.scripts[x].sub}`).join(', ')} (ведущий+субагенты); Read .work ведущим ${s.lead.readWork} (субагентами ${s.sub.readWork})`)
    L.push(`  пик ведущего ${s.lead.peak}${s.lead.peak > PEAK_LEAD_MAX ? ' > 150k' : ''}; субагенты: ${s.subs.map((x) => `«${String(x.desc).slice(0, 40)}» ${x.peak}`).join(', ') || '—'}`)
    if (r.card && r.keys.ghost.has) L.push(`  призраки в карточке: операций без реализации ${r.keys.ghost.contract.length}${r.keys.ghost.contract.length ? ' (' + r.keys.ghost.contract.join(' | ') + ')' : ''}, тестовых топиков ${r.keys.ghost.topics.length}${r.keys.ghost.topics.length ? ' (' + r.keys.ghost.topics.join(' | ') + ')' : ''}`)
    if (r.card) L.push(`  блоки контракта без фактов: пустых ${r.blocks.empty} из ${r.blocks.blocks} (${pct(share(r.blocks))})`)
    if (r.parts.length) L.push(`  …по частям: ${r.parts.map((p) => `${p.part} — ${p.blocks ? `${p.empty} из ${p.blocks}` : 'контракта нет'}`).join(', ')}`)
    if (r.card) L.push(`  GraphQL без типа (заголовок контракта не с HTTP-глагола и не с query/mutation/subscription): ${r.blocks.untyped}${r.blocks.untyped ? `  · ${r.blocks.untypedHeads.slice(0, 5).join(' | ')}${r.blocks.untyped > 5 ? ` …и ещё ${r.blocks.untyped - 5}` : ''}` : ''}`)
    if (r.facts) {
      const f = r.facts
      L.push(`  факты спеки в блоках своих операций (анкер и код): ${f.hit} из ${f.total}; анкер без кода ${f.anchorNoCode}, анкер вне своего блока ${f.elsewhere}, анкера нет ${f.absent}, блока операции нет ${f.noBlock}${f.miss.length ? `  · ${f.miss.slice(0, 6).join('; ')}${f.miss.length > 6 ? ` …и ещё ${f.miss.length - 6}` : ''}` : ''}`)
    }
    if (r.owners) {
      const o = r.owners
      L.push(`  ручки без пометок разведчика (JAX-RS): ${o.jaxrs.found} из ${o.jaxrs.total}${o.jaxrs.miss.length ? `  · нет: ${o.jaxrs.miss.join('; ')}` : ''}`)
      L.push(`  поля из базового класса: ${o.inh.hit} из ${o.inh.total}, сущностей с полным перечнем ${o.inh.full} из ${o.inh.entities}${o.inh.miss.length ? `  · нет: ${o.inh.miss.slice(0, 8).join('; ')}${o.inh.miss.length > 8 ? ` …и ещё ${o.inh.miss.length - 8}` : ''}` : ''}`)
      L.push(`  общие сущности, блоков на каждую (нужно по одному): ${o.shared.map((s) => `${s.cls} ${s.blocks}`).join(', ')}`)
    }
    if (r.cross) {
      const x = r.cross; const nm = (a) => (a.length ? `  · нет: ${a.join('; ')}` : '')
      L.push(`  роли против правды: ${x.roles.found} из ${x.roles.total}, строка «без входа» ${x.roles.open ? 'есть' : 'НЕТ'}${nm(x.roles.miss)}`)
      L.push(`  доступ у ручек проверок: ${x.access.hit} из ${x.access.total}${nm(x.access.miss)}; строка «доступ:» у ${x.withAccess} из ${x.contractBlocks} блоков контракта`)
      L.push(`  значения статуса с переходом: ${x.states.hit} из ${x.states.total}${x.states.block ? '' : ' (блока сущности нет)'}${nm(x.states.miss)}; блоков копий и связок: ${x.extraBlocks.length}${x.extraBlocks.length ? ' (' + x.extraBlocks.join(', ') + ')' : ''}; справочник в блоке объекта: ${x.refInObj ? 'ДА' : 'нет'}`)
      L.push(`  сообщения: ${x.messages.found} из ${x.messages.total}${nm(x.messages.miss)}; метки событий: ${x.slots.hit} из ${x.slots.total}${nm(x.slots.miss)}; «когда» с входом: ${x.when.hit} из ${x.when.total}`)
      L.push(`  «Зависит от»: сосед ${x.dep.has ? 'есть' : 'НЕТ'}, инфраструктура в секции: ${x.dep.infra.length ? x.dep.infra.join(', ') : 'нет'}`)
    }
    L.push(`  Б-5 ${r.b5 ? 'да' : 'НЕТ'} · Б-6 ${r.b6 ? 'да' : 'НЕТ'}${r.b7 == null ? '' : ` · Б-7 ${r.b7 ? 'да' : 'НЕТ'}`} · цена $${r.cost.toFixed(2)}`)
  }
  L.push('')
  L.push(`измерено ${R.measured}, не измерено ${R.notMeasured}, цена $${R.cost.toFixed(2)}`)
  L.push(`Б-5 (карточка записана; ключей по каждому классу ≥ 95 % правды; топиков ${R.truthCounts.topics}/${R.truthCounts.topics}): ${R.b5.verdict}`)
  L.push(`Б-6 (пик ведущего ≤ 200 000; Read ведущего по .work/ = 0): ${R.b6.verdict}`)
  if (R.b7) L.push(`Б-7 (в карточке нет операций без реализации (в дереве их ${R.ghostCounts.contract}) и тестовых топиков (${R.ghostCounts.topics}); повторов в контракте 0): ${R.b7.verdict}`)
  // справочно, без критерия — по измеренным прогонам с карточкой
  const withCard = R.runs.filter((r) => r.measured && r.card)
  const each = (fn, sep = ', ') => withCard.map((r) => `${r.name} ${fn(r)}`).join(sep) || '—'
  L.push(`блоки контракта без фактов, по карточке: ${each((r) => `${r.blocks.empty} из ${r.blocks.blocks} (${pct(share(r.blocks))})`)}`)
  L.push(`  …по частям (всего; худшая часть): ${each((r) => {
    const ps = r.parts.filter((p) => p.blocks)
    if (!ps.length) return r.parts.length ? 'частей с контрактом нет' : 'частей нет'
    const worst = ps.reduce((a, p) => (share(p) > share(a) ? p : a))
    return `${ps.reduce((a, p) => a + p.empty, 0)} из ${ps.reduce((a, p) => a + p.blocks, 0)}, худшая ${worst.part} — ${worst.empty} из ${worst.blocks} (${pct(share(worst))})`
  }, '; ')}`)
  L.push(`GraphQL без типа: ${each((r) => r.blocks.untyped)}`)
  if (R.factsTotal != null) L.push(`факты спеки в блоках своих операций (анкер и код): ${each((r) => `${r.facts.hit}/${r.facts.total}`)}`)
  if (R.fx === CROSS) {
    L.push(`роли: ${each((r) => `${r.cross.roles.found}/${r.cross.roles.total}${r.cross.roles.open ? '+без входа' : ''}`)}; доступ у ручек: ${each((r) => `${r.cross.access.hit}/${r.cross.access.total}`)}`)
    L.push(`значения статуса с переходом: ${each((r) => `${r.cross.states.hit}/${r.cross.states.total}`)}; сообщения: ${each((r) => `${r.cross.messages.found}/${r.cross.messages.total}`)}; метки событий: ${each((r) => `${r.cross.slots.hit}/${r.cross.slots.total}`)}`)
  }
  if (R.fx === OWN) {
    L.push(`ручки без пометок разведчика (JAX-RS): ${each((r) => `${r.owners.jaxrs.found}/${r.owners.jaxrs.total}`)}`)
    L.push(`поля из базового класса: ${each((r) => `${r.owners.inh.hit}/${r.owners.inh.total}`)}`)
    L.push(`повторов сущностей (одна сущность двумя блоками): ${each((r) => r.keys.entities.dups.length)}; лишних блоков данных: ${each((r) => r.keys.entities.extras.length)}`)
  }
  return L.join('\n')
}
const share = (b) => (b.blocks ? b.empty / b.blocks : 0)

// ─── самопроверка ───────────────────────────────────────────────────────────────────────
function selftest () {
  const dir = join(HERE, 'fixtures', 'SM-MONO-RUN', 'grader-selftest')
  const exp = JSON.parse(read(join(dir, 'expected.json')))
  const truths = {}
  let bad = 0; const rows = []
  const get = (o, p) => p.split('/').reduce((a, k) => (a == null ? a : a[k]), o)   // «/», не «.»: в именах скриптов точка
  for (const [c, w] of Object.entries(exp.cases)) {
    truths[w.fixture] ||= loadTruth(w.fixture, null, { build: true })
    const r = gradeRun(join(dir, c), truths[w.fixture])
    const diffs = []
    for (const [p, v] of Object.entries(w.want)) { const g = get(r, p); if (g !== v) diffs.push(`${p}: ждали ${v}, получено ${g}`) }
    if (diffs.length) bad++
    rows.push(`  ${diffs.length ? 'FAIL' : 'ok  '}  ${c.padEnd(26)} ${w.about}${diffs.length ? '  · ' + diffs.join('; ') : ''}`)
  }
  // раунд целиком: три прогона во временной папке
  for (const [label, names, want5, want6] of exp.rounds) {
    const tmp = mkdtempSync(join(tmpdir(), 'sm-mono-st-'))
    try {
      mkdirSync(join(tmp, 'sandbox'))
      names.forEach((n, i) => cpSync(join(dir, n), join(tmp, 'sandbox', `mono-0${i + 1}`), { recursive: true }))
      writeFileSync(join(tmp, '_mono.json'), JSON.stringify({ fixture: exp.cases[names[0]].fixture }))
      const R = gradeRound(tmp)
      const ok = R.b5.verdict.includes(want5) && R.b6.verdict.includes(want6)
      if (!ok) bad++
      rows.push(`  ${ok ? 'ok  ' : 'FAIL'}  раунд «${label}»: Б-5 ${R.b5.verdict}; Б-6 ${R.b6.verdict}${ok ? '' : `  · ждали ${want5} / ${want6}`}`)
    } finally { rmSync(tmp, { recursive: true, force: true }) }
  }
  console.log('случай → ожидание → итог')
  console.log(rows.join('\n'))
  console.log(bad ? `\nсамопроверка: ПРОВАЛОВ ${bad}` : `\nсамопроверка: ok (${rows.length})`)
  process.exit(bad ? 1 : 0)
}

// ─── вход ───────────────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())
if (isMain) {
  const args = process.argv.slice(2)
  try {
    if (args[0] === '--selftest') selftest()
    else if (args[0] === '--truth') {
      const t = loadTruth(args[1], null, { build: args.includes('--build') })
      console.log(`${args[1]} (${t.tree}): ${CLASSES.map((c) => `${RU[c]} ${t.T[c].size}`).join(', ')} — сходится с expected.md`)
      if (args.includes('--list')) for (const c of CLASSES) for (const [k, v] of t.T[c]) console.log(`${RU[c]}\t${k}${v.dir ? '\t' + v.dir : ''}\t${[...v.aliases].join(' | ')}`)
    } else if (args[0] && existsSync(args[0]) && statSync(args[0]).isDirectory()) {
      const R = gradeRound(args[0])
      const txt = report(R)
      writeFileSync(join(args[0], 'GRADE-MONO.txt'), txt + '\n')
      if (args.includes('--json')) console.log(JSON.stringify(R, (k, v) => (v instanceof Set ? [...v] : v)))
      else console.log(txt)
    } else { console.error('usage: node grade-sm-mono.mjs <раунд> [--json] | --truth <фикстура> [--list] | --selftest'); process.exit(1) }
  } catch (e) { console.error(`ОТКАЗ ГРЕЙДЕРА: ${e.message}`); process.exit(2) }
}
