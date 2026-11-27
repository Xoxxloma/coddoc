#!/usr/bin/env node
// grade-fx-none.mjs <папка-раунда> — задача без чужих стыков: скилл спеки не спрашивает о чужих системах и не заводит их.
//
// Пробы `fx-none-1` (окружения нет вовсе) и `fx-none-2` (карточки соседей лежат, задача их не касается) — пробы на
// ложное срабатывание. Раскладка: `<раунд>/<проба>/run-N/` с потоками ходов (`stream.jsonl`, `stream-NN.jsonl`),
// ответами (`answer.md` / `answer-NN.md`) и итоговой спекой `coddoc/<КЛЮЧ>/technical_specification.md`.
//
// По каждому прогону:
//   (1) ни в одном ходе нет вопроса аналитику о чужой системе — найденные вопросы печатаются текстом;
//   (2) спека записана;
//   (3) в спеке нет взаимодействий с системами вне своей команды, нет открытых пунктов о чужом, свой стык не записан 🟡;
//   (4) справочно — число вопросов по ходам и статус готовности.
// Итог прогона: КРАСНЫЙ — сработало (1) или (3); «без спеки» — красного нет, но файла нет; иначе зелёный.
// «Сверить» — не красное: вопрос-кивок об отсутствии чужого, упоминание соседа вне стыков, 🟡 без признаков контракта.
// Проверки — регулярные выражения по сказанному и записанному. Прогон без потока первого хода — «не измерено».
//
//   node grade-fx-none.mjs --selftest   — шесть синтетических прогонов, без раунда.
import { readFileSync, readdirSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'

// Чужая система — общими словами: годится для любой пробы.
const GENERIC = [
  /внешн\S*\s+(систем|сервис|источник|api|поставщик|контур|команд)/i,
  /сторонн\S*\s+(систем|сервис|api|команд)/i,
  /чуж\S*\s+(систем|сервис|команд|контракт|стык|api)/i,
  /смежн\S*\s+(систем|сервис|команд)/i,
  /друг(ой|ая|ую|ие|их|им|ими)\s+(команд|систем|сервис)/i,
  /интеграци\S*\s+с\s/i,
  /(^|[^a-zа-яё])(mes|erp|sap|1с|1c|тоир|eam|scada|асу ?тп|sso|ldap|active directory|keycloak|oidc|oauth|kafka|rabbitmq|smtp|telegram|телеграм\S*|s3|minio)([^a-zа-яё]|$)/i,
  /почтов\S+\s+(сервер|шлюз|сервис|рассылк)/i,
  /сервис\S*\s+(уведомлени|рассыл|аутентификац|авторизац|единого входа)/i,
  /един\S+\s+вход/i,
  /шин[аеуыой]+\s+(данных|событий|сообщений)/i,
  /топик/i, /очеред[ьи]\s+сообщений/i, /веб-?хук|webhook/i,
]
const PROBES = {
  // Окружения нет: своё приложение названо «приложение «Смена»», поэтому «система учёта …» здесь — чужое.
  'fx-none-1': {
    extra: [
      /систем\S*\s+(учёта|управления|планирования|мониторинга|техобслуживания|ремонтов)/i,
      /(кадров|учётн|заводск|корпоративн|производственн)\S*\s+(систем|сервис|портал|справочник)/i,
      /справочник\S*\s+оборудования/i, /график\S*\s+смен/i,
    ],
  },
  // Соседи из `services/manifest.yaml` фикстуры FX-NONE-2 — всё, кроме своих funds-registry и funds-web.
  'fx-none-2': {
    extra: [
      /restoration-lab|expo-planner|site-collection/i,
      /restoration\.task|expo\.exhibition|\/v1\/restoration|\/v1\/exhibitions/i,
      /задани\S+\s+на\s+реставраци/i, /реставрационн\S+\s+(мастерск|протокол|сервис|систем)/i,
      /(сервис|систем|команд)\S*\s+«?реставраци/i, /реставратор/i,
      /план\S*\s+выстав/i, /состав\S*\s+выстав/i, /(сервис|систем)\S*\s+выстав/i, /выставочн\S+\s+проект/i, /куратор/i,
      /онлайн-коллекци/i, /сайт\S*\s+музея/i, /команд\S*\s+«?сайт/i,
    ],
  },
}
// Отрицание присутствия: «интеграций нет», «соседей не трогаем» — упоминание чужого, но не вопрос о нём.
const NEG = /(^|[^а-яё])(нет|без|отсутству\S*|ни\s+одн\S*|не\s+входит|не\s+(трога|затраг|каса|треб|нуж|использ|вызыва|ходи|обраща|появля|завод|меня|связ|подключа|интегрир|дела|буд|зависи)\S*)([^а-яё]|$)/i
// Вопрос: знак вопроса в конце слова (не `?status=` в пути и не `string?` в типе) либо просьба без знака.
const TYPE_OPT = /\b(string|int|integer|number|boolean|bool|uuid|date|datetime|timestamp|iso8601|text|decimal|enum|object|array)\?/gi
const QMARK = /\?(?=$|[\s»"”)*_|.,:;—-])/
const REQUEST = /подтвердите|уточните|укажите|назовите|назов[её]те|подскажите|сообщите|пришлите|оставл?я?ем\s+к\s+валидации|оставить\s+к\s+валидации/i
// Свой стык спрошен как неизвестный существующий.
const OWN_UNKNOWN = /к\s+валидации|подтвердите\s+как\s+аналитик|уточн\S+\s+у\s+(команд|владельц|разработчик)/i
const CONTRACT = /контракт|эндпоинт|ручк|запрос|api|формат|адрес|доступ|токен|схем|пол[яей](?![а-яё])|событи/i
const ASK_TEAM = /уточнить\s+у\s+(команд|владельц|разработчик)|согласовать\s+с\s+(команд|владельц)|запросить\s+у\s+(команд|владельц)/i

const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8').replace(/\r/g, '') : '')
const pad = (n) => String(n).padStart(2, '0')
const short = (s, n = 260) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t }

// Чужое в строке: есть ли упоминание и все ли упоминания стоят под отрицанием.
export function foreign (line, markers) {
  let hit = false; let open = false
  for (const s of line.split(/(?<=[.!?;])\s+/)) {
    if (!markers.some((re) => re.test(s))) continue
    hit = true
    if (!NEG.test(s)) open = true
  }
  return { hit, open }
}
const isAsk = (line) => { const t = line.replace(/`[^`]*`/g, ' ').replace(TYPE_OPT, ' '); return QMARK.test(t) || REQUEST.test(t) }

function readTurn (dir, n) {
  const raw = read(join(dir, n === 1 ? 'stream.jsonl' : `stream-${pad(n)}.jsonl`))
  const texts = []; const tool = []; let wrote = false
  for (const line of raw.split('\n')) {
    if (!line) continue
    let o; try { o = JSON.parse(line) } catch { continue }
    if (o.type !== 'assistant' || o.parent_tool_use_id || !o.message || !Array.isArray(o.message.content)) continue
    for (const c of o.message.content) {
      if (c.type === 'text' && c.text.trim()) texts.push(c.text)
      if (c.type !== 'tool_use' || !c.input) continue
      if (c.name === 'AskUserQuestion' && Array.isArray(c.input.questions)) {
        for (const q of c.input.questions) tool.push([q.header, q.question, ...(q.options || []).map((op) => `${op.label || ''} — ${op.description || ''}`)].filter(Boolean).join(' · '))
      }
      const target = String(c.input.file_path || c.input.command || '')
      if (/technical_specification\.md/.test(target) && /^(Write|Edit|MultiEdit|Bash)$/.test(c.name) && (c.name !== 'Bash' || />\s*\S*technical_specification\.md|tee /.test(target))) wrote = true
    }
  }
  let text = texts.join('\n')
  if (!text.trim()) text = read(join(dir, `answer-${pad(n)}.md`)) || (n === 1 ? read(join(dir, 'answer.md')) : '')
  return { exists: raw.length > 0, text, tool, wrote }
}

// Вопросы хода: строка-вопрос с чужим — красное; чужое только под отрицанием или только строкой выше — «сверить».
export function gradeTurn (t, markers) {
  const red = []; const check = []
  const lines = []; let fence = false
  for (const l of t.text.split('\n')) { if (/^\s*```/.test(l)) { fence = !fence; lines.push(''); continue } lines.push(fence ? '' : l) }
  let asks = 0
  lines.forEach((l, i) => {
    if (!l.trim() || !isAsk(l)) return
    asks++
    const f = foreign(l, markers)
    if (f.open) { red.push(l); return }
    if (f.hit) { check.push(`кивок об отсутствии: ${l}`); return }
    for (let k = i - 1; k >= Math.max(0, i - 3) && lines[k].trim(); k--) {
      if (foreign(lines[k], markers).open) { check.push(`чужое строкой выше: ${lines[k]} ⏎ ${l}`); return }
    }
    if (OWN_UNKNOWN.test(l)) check.push(`своё спрошено как существующее: ${l}`)
  })
  for (const q of t.tool) {
    asks++
    const f = foreign(q, markers)
    if (f.open) red.push(q)
    else if (f.hit) check.push(`кивок об отсутствии: ${q}`)
    else if (OWN_UNKNOWN.test(q)) check.push(`своё спрошено как существующее: ${q}`)
  }
  return { asks, red, check }
}

function findSpec (dir) {
  const root = join(dir, 'coddoc')
  if (!existsSync(root)) return null
  for (const k of readdirSync(root)) { const p = join(root, k, 'technical_specification.md'); if (existsSync(p)) return p }
  return null
}
const negative = (s) => /^\s*(~~|—|-|–|нет(?![а-яё])|не\s+применимо|отсутству|\[?—\]?)/i.test(s) || !s.trim()

// Открытые пункты: нумерованный список шапки «Открытые вопросы»; пуст — непустые строки 🟡 / ❓ / ⚠️ в §8.
export function openItems (spec) {
  const lines = spec.split('\n'); const out = []; const tail = []
  const i = lines.findIndex((l) => /^>\s*\*\*Открытые вопросы/.test(l))
  for (let j = i + 1; i >= 0 && j < lines.length && /^>/.test(lines[j]); j++) {
    const t = lines[j].replace(/^>\s?/, '').trim()
    if (/^(\d+[.)]|[-*])\s/.test(t) && !/^\*\(/.test(t)) out.push(t)
    else if (out.length && t && !/^\*?\(/.test(t) && !/^\*[^*]/.test(t)) out[out.length - 1] += ' ' + t
  }
  const s8 = lines.findIndex((l) => /^##\s*(§\s*)?8\.?\s/.test(l))
  for (let j = s8 + 1; s8 >= 0 && j < lines.length && !/^##\s/.test(lines[j]); j++) {
    const m = lines[j].match(/^\s*[-*]\s*\*\*(🟡|❓|⚠️)[^*]*\*\*:?\s*(.*)$/)
    if (!m) continue
    let body = m[2]
    for (let k = j + 1; k < lines.length && /^\s{2,}\S/.test(lines[k]); k++) body += ' ' + lines[k].trim()
    if (!negative(body)) tail.push(`§8 ${m[1]} ${body}`)
  }
  // §8 зеркалит шапку: его строки идут в счёт, только когда список шапки пуст.
  return out.length ? out : tail
}

export function gradeSpec (spec, markers) {
  const r = { ints: 0, green: 0, red: [], check: [], open: [] }
  const lines = spec.split('\n')
  // Карточки INT: заголовок, «Граница», «Происхождение».
  for (let i = 0; i < lines.length; i++) {
    if (!/^#{2,4}\s*INT-\d+/.test(lines[i])) continue
    r.ints++
    const head = lines[i]; const body = []
    for (let j = i + 1; j < lines.length && !/^#{1,4}\s/.test(lines[j]); j++) body.push(lines[j])
    const border = body.filter((l) => /\*\*Граница/.test(l)).join(' ')
    const origin = body.filter((l) => /\*\*Происхождение/.test(l)).join(' ')
    const name = short(head.replace(/^#+\s*/, ''), 90)
    if (/🟢/.test(head) || /🟢/.test(origin)) r.green++
    if (foreign(head + ' ' + border, markers).open) r.red.push(`чужая система — участник: ${name} | ${short(border, 120)}`)
    if (/🟡/.test(head) || /🟡/.test(origin)) r.red.push(`стык записан 🟡: ${name}`)
    for (const l of body) {
      if (ASK_TEAM.test(l)) r.red.push(`«уточнить у команды» в карточке ${name}: ${short(l, 140)}`)
      else if (!/\*\*Граница/.test(l) && foreign(l, markers).open) r.check.push(`чужое в теле ${name}: ${short(l, 140)}`)
    }
  }
  // §1.2: строка таблицы с чужой системой — сверить; строка с 🟡 — красное.
  const s12 = lines.findIndex((l) => /^#{2,4}\s*(§\s*)?1\.2\.?\s/.test(l))
  for (let j = s12 + 1; s12 >= 0 && j < lines.length && !/^#{1,4}\s/.test(lines[j]); j++) {
    const l = lines[j]
    if (!/^\s*\|/.test(l) || /^\s*\|[\s:|-]+\|\s*$/.test(l) || /Происхождение/.test(l)) continue
    if (/🟡/.test(l)) r.red.push(`§1.2, сервис записан 🟡: ${short(l, 160)}`)
    else if (foreign(l, markers).hit) r.check.push(`§1.2, строка с чужой системой: ${short(l, 160)}`)
  }
  // Открытые пункты.
  for (const t of openItems(spec)) {
    r.open.push(t)
    if (foreign(t, markers).open || ASK_TEAM.test(t)) r.red.push(`открытый пункт о чужом: ${short(t, 200)}`)
    else if (/🟡|к\s+валидации/i.test(t) && CONTRACT.test(t)) r.red.push(`открытый пункт 🟡 о контракте: ${short(t, 200)}`)
    else r.check.push(`открытый пункт: ${short(t, 200)}`)
  }
  if (r.ints > 0 && r.green === 0) r.red.push('ни одной 🟢 карточки INT: своё не спроектировано')
  if (r.ints === 0) r.check.push('карточек INT в спеке нет')
  const st = spec.match(/Статус готовности:\*\*\s*([^\n]+)/)
  r.status = st ? st[1].trim() : '—'
  return r
}

export function gradeRun (dir, probe) {
  const cfg = PROBES[probe]; const markers = [...GENERIC, ...cfg.extra]
  const r = { measured: false, turns: [], red1: [], red3: [], check: [], file: false, wroteTurn: 0 }
  if (!existsSync(join(dir, 'stream.jsonl')) || readdirSync(dir).some((f) => /^_api-failure/.test(f))) return r
  r.measured = true
  for (let n = 1; n <= 12; n++) {
    const t = readTurn(dir, n)
    if (!t.exists) break
    const g = gradeTurn(t, markers)
    r.turns.push(g.asks)
    for (const q of g.red) r.red1.push(`ход ${n}: ${short(q)}`)
    for (const q of g.check) r.check.push(`ход ${n}: ${short(q)}`)
    if (t.wrote && !r.wroteTurn) r.wroteTurn = n
  }
  const f = findSpec(dir)
  r.file = !!f
  if (f) {
    r.spec = gradeSpec(read(f), markers)
    r.red3 = r.spec.red
    for (const c of r.spec.check) r.check.push(`спека: ${c}`)
  }
  r.verdict = r.red1.length || r.red3.length ? 'КРАСНЫЙ' : (r.file ? 'зелёный' : 'без спеки')
  return r
}

function report (round) {
  for (const probe of Object.keys(PROBES)) {
    const dir = join(round, probe)
    if (!existsSync(dir)) continue
    const runs = readdirSync(dir).filter((x) => /^run-\d+$/.test(x)).sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)))
    const res = runs.map((name) => ({ name, r: gradeRun(join(dir, name), probe) }))
    const m = res.filter((x) => x.r.measured)
    const count = (v) => m.filter((x) => x.r.verdict === v).length
    console.log(`\n-- ${probe}: измерено ${m.length} из ${runs.length}; зелёных ${count('зелёный')}, красных ${count('КРАСНЫЙ')}, без спеки ${count('без спеки')}`)
    console.log(`   ${m.filter((x) => !x.r.red1.length).length}/${m.length}  (1) вопросов о чужой системе нет`)
    console.log(`   ${m.filter((x) => x.r.file).length}/${m.length}  (2) спека записана`)
    console.log(`   ${m.filter((x) => x.r.file && !x.r.red3.length).length}/${m.length}  (3) в спеке нет чужих взаимодействий, открытых пунктов о чужом и 🟡-стыков`)
    console.log('   прогон | итог | вопросов о чужом | спека (ход записи) | INT всего / 🟢 | открытых пунктов | вопросов по ходам | сверить | статус')
    for (const { name, r } of res) {
      if (!r.measured) { console.log(`   ${name} | не измерено`); continue }
      const s = r.spec
      console.log('   ' + [name, r.verdict, r.red1.length, r.file ? `есть (${r.wroteTurn || '?'})` : 'нет', s ? `${s.ints} / ${s.green}` : '·',
        s ? s.open.length : '·', r.turns.join('/'), r.check.length, s ? s.status : '·'].join(' | '))
      for (const q of r.red1) console.log(`     ✗ (1) вопрос о чужой системе — ${q}`)
      for (const q of r.red3) console.log(`     ✗ (3) ${q}`)
      for (const q of r.check) console.log(`     ~ сверить — ${q}`)
    }
  }
}

// ---------- самотест: шесть синтетических прогонов ----------
function selftest () {
  const root = mkdtempSync(join(tmpdir(), 'fx-none-'))
  const say = (text) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } })
  const write = (path, content) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: path, content } }] } })
  const spec = ({ open = '> *Все технические решения приняты, спецификация готова к разработке.*', status = 'Готово к разработке', ints, row = '' }) => [
    '# Техническая спецификация: проба', '', '> **Задача:** X-1', `> **Статус готовности:** ${status}`, '>',
    '> **Легенда происхождения:**', '> 🟢 — спроектировано в этом документе.', '> 🟡 — к валидации: допущение о существующей системе.', '>',
    '> **Открытые вопросы (решить до / во время разработки):**', open, '',
    '## 1. Обзор изменения', '### 1.1. Что делаем и тип изменения', '**Суть:** новый раздел. Интеграций с другими системами нет.',
    '### 1.2. Затронутые сервисы и владельцы', '| Сервис | Роль в задаче | Владелец/команда | Происхождение |', '|---|---|---|---|',
    '| своё приложение | новые запросы и экраны | своя команда | 🟢 |', row, '',
    '## 2. Взаимодействия (ядро)', ints, '### Каталог ошибок (сводно)', '| Код | Тело | Когда | Состояние UI |', '',
    '## 8. Допущения и открытые вопросы', '- **🔵 Подтверждено аналитиком:** —', '- **🟡 К валидации:** —', '- **❓ Открытые решения:** —', '',
  ].join('\n')
  const int = (n, name, mark, border) => [`### INT-${n}. ${name} — ${mark}`, '- **Вид:** новое', `- **Граница/направление:** ${border}`,
    '- **Контракт (запрос):** `GET /v1/handovers?status=handed&page=1`', '', '  | Поле | Тип | Обяз. | Пример | Описание |', '  |---|---|---|---|---|',
    '  | `note` | string? | нет | «…» | замечание |', `- **Происхождение:** ${mark}`, '- **Трассировка:** FR-1', ''].join('\n')
  const ownInts = int(1, 'Список записей', '🟢Н', 'FE → BE') + int(2, 'Принять смену', '🟢Н', 'FE → BE')
  const ownAsk = ['Реестр: 1. Стороны — ✅ fullstack, приложение целиком своё. 3. Допущения о существующем — ✅ чужих систем задача не трогает.',
    '', 'INT-1 (🟢): экран журнала запрашивает у серверной части список записей; `GET /v1/handovers?status=handed&page=1` → `items[]`, поле `note: string?`.',
    'Спроектировал так — годится или поправить?', '', 'Сущность `Handover`: `id`, `sectionId`, `shift` (`day` | `night`), `status`. Годится?'].join('\n')
  const cases = [
    { name: 'зелёный: показал свой дизайн, записал спеку', probe: 'fx-none-1', want: 'зелёный', sver: 0,
      t1: ownAsk, t2: 'Записал спеку. Статус: Готово к разработке.', spec: spec({ ints: ownInts }) },
    { name: 'спросил про чужой контракт', probe: 'fx-none-1', want: 'КРАСНЫЙ', red1: 1,
      t1: ownAsk + '\n\nПредполагаю, что список оборудования отдаёт MES. Какой у неё контракт и кто даёт доступ — подтвердите как аналитик или оставляем к валидации.',
      t2: 'Записал спеку.', spec: spec({ ints: ownInts }) },
    { name: 'завёл взаимодействие с соседним сервисом', probe: 'fx-none-2', want: 'КРАСНЫЙ', red3: 3,
      t1: 'INT-1 (🟢): funds-web запрашивает у funds-registry журнал перемещений. Годится?', t2: 'Записал спеку.',
      spec: spec({ status: 'Требуются уточнения (1)', open: '> 1. 🟡 Как создаётся задание в restoration-lab при основании «реставрация».',
        ints: int(1, 'Журнал перемещений', '🟢Н', 'funds-web → funds-registry') + int(2, 'Сообщить о перемещении в реставрацию', '🟡', 'funds-registry → restoration-lab') }) },
    { name: 'открытый пункт про чужую систему', probe: 'fx-none-2', want: 'КРАСНЫЙ', red3: 1,
      t1: 'INT-1 (🟢): funds-web запрашивает у funds-registry журнал перемещений. Годится?', t2: 'Записал спеку.',
      spec: spec({ status: 'Требуются уточнения (1)', open: '> 1. 🟡 Формат события `expo.exhibition.approved` — уточнить у команды «Выставочные проекты».',
        ints: int(1, 'Журнал перемещений', '🟢Н', 'funds-web → funds-registry') }) },
    { name: 'вопрос «годится?» про свою ручку и кивок об отсутствии соседей', probe: 'fx-none-2', want: 'зелёный', sver: 1,
      t1: ['В `services/funds-registry.md`: `PATCH /v1/items/{id}` принимает `locationId`. Убираю `locationId` из правки карточки — годится?',
        'INT-2 (🟢): funds-web → funds-registry, `POST /v1/movements`; основание — `restoration` | `exhibition` | `recount` | `other`. Годится или поправить?',
        'Сервисы restoration-lab и expo-planner задача не трогает — верно?'].join('\n'),
      t2: 'Записал спеку.', spec: spec({ ints: int(1, 'Оформить перемещение', '🟢Н', 'funds-web → funds-registry') }) },
    { name: 'свой стык записан как неизвестный', probe: 'fx-none-2', want: 'КРАСНЫЙ', red3: 3,
      t1: 'Журнал перемещений отдаёт funds-registry. Годится?', t2: 'Записал спеку.',
      spec: spec({ status: 'Требуются уточнения (1)', open: '> 1. 🟡 Контракт журнала перемещений — к валидации.',
        ints: int(1, 'Журнал перемещений', '🟡', 'funds-web → funds-registry') }) },
  ]
  let bad = 0
  cases.forEach((c, i) => {
    const dir = join(root, c.probe, `run-${i + 1}`)
    const sp = join(dir, 'coddoc', 'X-1', 'technical_specification.md')
    mkdirSync(dirname(sp), { recursive: true })
    writeFileSync(join(dir, 'stream.jsonl'), say(c.t1) + '\n')
    writeFileSync(join(dir, 'stream-02.jsonl'), write(sp, c.spec) + '\n' + say(c.t2) + '\n')
    writeFileSync(sp, c.spec)
    const r = gradeRun(dir, c.probe)
    const fails = []
    if (r.verdict !== c.want) fails.push(`итог ${r.verdict}, ждали ${c.want}`)
    if (c.red1 !== undefined && r.red1.length !== c.red1) fails.push(`(1) красных ${r.red1.length}, ждали ${c.red1}`)
    if (c.red3 !== undefined && r.red3.length !== c.red3) fails.push(`(3) красных ${r.red3.length}, ждали ${c.red3}`)
    if (c.sver !== undefined && r.check.length !== c.sver) fails.push(`«сверить» ${r.check.length}, ждали ${c.sver}`)
    if (r.wroteTurn !== 2) fails.push(`ход записи ${r.wroteTurn}, ждали 2`)
    if (fails.length) bad++
    console.log(`${fails.length ? 'ПРОВАЛ' : 'ок    '} ${i + 1}. ${c.name} → ${r.verdict}${fails.length ? ' — ' + fails.join('; ') : ''}`)
    for (const q of [...r.red1.map((x) => '✗ (1) ' + x), ...r.red3.map((x) => '✗ (3) ' + x), ...r.check.map((x) => '~ ' + x)]) console.log(`         ${q}`)
  })
  // Прогон без потока первого хода — не измерен.
  const empty = join(root, 'fx-none-1', 'run-9'); mkdirSync(empty, { recursive: true })
  const nm = gradeRun(empty, 'fx-none-1').measured === false
  console.log(`${nm ? 'ок    ' : 'ПРОВАЛ'} прогон без stream.jsonl → не измерено`)
  if (!nm) bad++
  rmSync(root, { recursive: true, force: true })
  console.log(bad ? `\nсамотест: провалов ${bad}` : '\nсамотест: всё сошлось')
  process.exit(bad ? 1 : 0)
}

const arg = process.argv[2]
if (arg === '--selftest') selftest()
else if (!arg || arg.startsWith('--')) { console.error('usage: node grade-fx-none.mjs <папка-раунда> | --selftest'); process.exit(1) } else report(arg)
