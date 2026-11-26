#!/usr/bin/env node
// grade-2t.mjs — грейдер двухходовой пробы `ts-conv-2t` (фикстура TS-CONV, скилл technical-spec-doc).
// Ход 1 — `opt-prompt.txt` (только «напиши спеку по БТ»), ответ в `answer-01.md`, поток `stream.jsonl`;
// ход 2 — `conv-turn2.txt` (ответы аналитика, источник «не знаю»), ответ в `answer-02.md`, поток `stream-02.jsonl`;
// `answer.md` — склейка ходов (её пишет пул), здесь не читается: переспрос ищется ТОЛЬКО во втором ходе.
//
//   node grade-2t.mjs <плечо>        — <раунд>/ts-conv-2t или сам <раунд> (тогда берётся его ts-conv-2t)
//   node grade-2t.mjs --selftest
//
// По прогону:
//   - спека записана к концу 2-го хода (`coddoc/<KEY>/technical_specification.md`; мимо папки — отдельно);
//     записана уже на 1-м ходу — нарушение «turn 1 = questions only», видно по Write/Edit в `stream.jsonl`;
//   - фантом: второй ход отчитался о записанном файле, файла нет;
//   - переспрошен гейт, уже отвеченный в `conv-turn2.txt` — анкеры `REASKED_GATES` из grade-ts.mjs,
//     «?» в той же строке, поиск только в `answer-02.md`;
//   - чужой путь `/v1/sessions/count` в спеке (без легенды);
//   - число вопросов в `answer-01.md` (определение «вопроса» — общее с grade-gaps.mjs, импортируется).
// Прогон без второго хода по вине стенда (отказ API, побег, нет `answer-02.md`) — «не измерено».

import { readFileSync, existsSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { countQuestions, findSpec, findStraySpec, stripLegend, lines, median } from './grade-gaps.mjs'

const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null)

// Литерал из grade-ts.mjs (L451–456) — тот же набор, те же формы; менять только вместе с ним.
export const REASKED_GATES = [
  { label: 'частота обновления', re: /раз в минуту|ежеминутн|60 сек/i },
  { label: 'прочерк при недоступности', re: /прочерк/i },
  { label: 'доступ только админу', re: /только админ|видит только админ/i },
  { label: 'источник не подтверждён', re: /не знаю|подтвердить не мог/i },
]
export const reasked = (turn2) =>
  REASKED_GATES.filter((g) => lines(turn2).some((l) => g.re.test(l) && l.includes('?'))).map((g) => g.label)

const FOREIGN_PATH = '/v1/sessions/count'
const RE_CLAIMS_WRITTEN = /(спек[аи]|спецификаци[ияю]|документ)[^.\n]{0,60}(записан|готов|создан|сохранён|сохранен)|(файл|путь)\s*:?\s*`?[^`\n]{0,20}coddoc\//i
const RE_API_FAILURE = /API Error|Request not allowed|Please run \/login|Credit balance|rate limit|session limit|usage limit|hit your limit/i
const isApiFailure = (t) => !!t && (t.length < 600 ? RE_API_FAILURE.test(t) : RE_API_FAILURE.test(t.slice(0, 200)))

/** Записал ли ход спеку: Write/Edit по technical_specification.md в потоке ведущего. */
export function wroteSpecInStream(streamText) {
  for (const raw of lines(streamText)) {
    if (!raw.trim()) continue
    let j; try { j = JSON.parse(raw) } catch { continue }
    if (j.type !== 'assistant' || j.parent_tool_use_id) continue
    for (const c of (j.message?.content ?? [])) {
      if (c.type === 'tool_use' && ['Write', 'Edit', 'MultiEdit'].includes(c.name)
        && /technical_specification\.md$/i.test(String(c.input?.file_path ?? ''))) return true
    }
  }
  return false
}

function unmeasured(dir) {
  if (existsSync(join(dir, '_api-failure.txt'))) return 'отказ API'
  if (existsSync(join(dir, '_api-failure-turn.txt'))) return `отказ API на ходу: ${(read(join(dir, '_api-failure-turn.txt')) ?? '').trim()}`
  if (existsSync(join(dir, '_escaped.txt'))) return 'прогон вышел за песочницу (_escaped.txt)'
  const a1 = read(join(dir, 'answer-01.md')), a2 = read(join(dir, 'answer-02.md'))
  if (!a1 || !a1.trim()) return 'первого хода нет (answer-01.md пуст)'
  if (isApiFailure(a1)) return 'отказ API в первом ходе'
  if (a2 === null) return 'второго хода нет (answer-02.md отсутствует)'
  if (isApiFailure(a2)) return 'отказ API во втором ходе'
  return null
}

export function gradeRun(dir) {
  const a1 = read(join(dir, 'answer-01.md')) ?? ''
  const a2 = read(join(dir, 'answer-02.md')) ?? ''
  const found = findSpec(dir), stray = found ? null : findStraySpec(dir)
  const spec = found ? found.text : stray?.text
  const body = spec ? stripLegend(spec) : ''
  return {
    written: !!found,
    stray: stray ? stray.path : null,
    turn1Write: wroteSpecInStream(read(join(dir, 'stream.jsonl')) ?? ''),
    phantom: !spec && RE_CLAIMS_WRITTEN.test(a2),
    reasked: reasked(a2),
    foreignPath: body ? lines(body).filter((l) => l.includes(FOREIGN_PATH)).length : 0,
    q1: countQuestions(a1),
    q2: countQuestions(a2),
  }
}

// ─── Самопроверка: рукопись + живые строки прежних плеч ts-conv-2t ────────────────────────────

function selftest() {
  const res = []
  const ok = (name, cond) => res.push([name, !!cond])
  // Рукопись
  ok('переспрос: «раз в минуту?» в одной строке', reasked('Обновляем раз в минуту?').includes('частота обновления'))
  ok('пересказ без «?» — не переспрос', reasked('Обновляем раз в минуту, прочерк при недоступности.').length === 0)
  ok('«?» в соседней строке — не переспрос (правило grade-ts)', reasked('Прочерк при недоступности\nВерно?').length === 0)
  ok('путь в стрим-событии записи спеки опознан', wroteSpecInStream(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: 'C:/x/coddoc/ARS-201/technical_specification.md' } }] } })))
  ok('запись субагентом не считается записью хода', !wroteSpecInStream(JSON.stringify({ type: 'assistant', parent_tool_use_id: 'x', message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: 'coddoc/ARS-201/technical_specification.md' } }] } })))
  ok('фантом: «Спека записана: coddoc/…» опознан', RE_CLAIMS_WRITTEN.test('Спека записана: `coddoc/ARS-201/technical_specification.md`'))
  // Живые строки: runs/2026-09-23-ts-comb-base-v2/ts-conv-2t
  ok('живое (base-v2 run-01, ход 2): «Вы сказали «…подтвердить не могу». …новый? Или …» в одной строке — переспрос',
    reasked('Вы сказали «я код не читаю, кто отдаёт число активных сессий — подтвердить не могу». Это означает, что в бэке Арсенала уже **существует источник** этих данных (таблица сессий, кэш, счётчик), и нужно либо использовать существующий endpoint, либо спроектировать новый? Или это **новая функциональность в бэке** — добавить подсчёт активных сессий заново?').includes('источник не подтверждён'))
  ok('живое (base-v2 run-01, ход 2): «При недоступности … прочерк «—».» без «?» — не переспрос',
    reasked('При недоступности источника (null / 5xx / таймаут) → показываем прочерк «—». ').length === 0)
  ok('живое (base-v2 run-01, ход 1): 10 гейтов с «?» — вопросов ≥ 10',
    countQuestions(LIVE_T1) >= 10)
  for (const [k, v] of LIVE) ok(`живое: ${k}`, v())
  let bad = 0
  for (const [name, pass] of res) { console.log(`${pass ? '  ok  ' : '  FAIL'} ${name}`); if (!pass) bad += 1 }
  console.log(bad === 0 ? `\nсамопроверка пройдена (${res.length})` : `\nсамопроверка ПРОВАЛЕНА: ${bad} из ${res.length}`)
  process.exit(bad === 0 ? 0 : 1)
}

// Отрывок первого хода base-v2 run-01 (по строке на гейт, как модель их пишет).
const LIVE_T1 = `- Предположу, что это **fullstack**: фронт (arsenal-web) вызывает бэк (auth) с запросом о числе активных. Затронуты сервисы: **arsenal-web** (FE, команда?) и **auth** (BE, команда?). Верно ли? Есть ли ещё сервисы в цепочке?
- Спроектировал одно новое взаимодействие **INT-1**: фронт периодически опрашивает число активных пользователей (или сессий?) в сервисе auth. Правильно ли я понимаю, что используется существующий endpoint \`GET /v1/sessions/count\`? Или нужен новый endpoint?
- В выжимке написано, что auth умеет \`GET /v1/sessions/count\` для «плашки активных сессий в шапке». Подтвердите: этот endpoint **уже существует** в продакшене (на auth) и отдаёт текущее число активных сессий? Если да, то я пишу его как факт с пометкой 🔵; если нет или не уверены — оставляем к валидации 🟡.
- Предлагаю контракт: \`GET /v1/sessions/count\` отдаёт JSON вида \`{ "count": <number | null> }\`, где \`null\` означает источник недоступен (по конвенциям), а \`0\` — валидный ноль. Верно? Нужно ли ещё какие-то поля в ответе (timestamp, версию, статус)?
- Если auth вернёт 5xx, таймаут или null (источник недоступен) → фронт показывает прочерк «—» (по FR-5). При \`count: 0\` → показываем «0» как обычное значение (FR-6). Если \`count: <число>\` → показываем число. Правильная ли маппинг состояний?
- На фронте скрыть счётчик для роли operator (видят только admin). Проверка роли происходит на **фронте или на бэке auth**? То есть, auth отдаст counter всем, и фронт фильтрует по роли? Или auth вернёт 403 для non-admin, и фронт покажет ошибку / пусто?
- Нет новых сущностей или таблиц; читаем только из существующей системы подсчёта активных в auth. Верно?
- Предлагаю: фронт опрашивает \`GET /v1/sessions/count\` каждые **30 секунд** (polling). По конвенциям: таймаут cold-path 8 с, warm-path 3 с. Интервал 30 с вас устраивает, или другой?
- Если endpoint на auth уже существует: можно завести фронт-изменение, и откат не требует синхронности. Верно? Или нужно синхронизировать откат FE и BE?
- Покрываем FR-1 (счётчик в шапке), FR-5 (обработка недоступности), FR-6 (нулевая активность), FR-7 (доступ по ролям). Верно ли распределение?`

// Живые строки прежних плеч (runs/2026-09-23-ts-comb-base-v2/ts-conv-2t). Первая — урок сверки с журналом:
// журнал раунда ts-comb считал переспрос по склейке `answer.md` (так читает grade-ts.mjs), и вопрос ПЕРВОГО
// хода, заданный до ответа аналитика, шёл в счёт. Числа журнала 6/10, 11/20, 12/20 воспроизводятся только
// так; по одному второму ходу — 3/10, 6/20, 8/20.
const LIVE = [
  ['run-03 ход 1: «…только администраторы. Это совпадает?» — анкер есть, но это ПЕРВЫЙ ход → не переспрос', () => {
    const d = mkdtempSync(join(tmpdir(), 'grade-2t-'))
    try {
      writeFileSync(join(d, 'answer-01.md'), 'Из выжимки auth.md видно, что счётчик может читать только роль `admin`. БТ требует, чтобы панель видели только администраторы. Это совпадает?')
      writeFileSync(join(d, 'answer-02.md'), 'Принял ответы. Реестр чист, пишу спеку.')
      return reasked(readFileSync(join(d, 'answer-01.md'), 'utf8')).length === 1 && gradeRun(d).reasked.length === 0
    } finally { rmSync(d, { recursive: true, force: true }) }
  }],
  ['run-07 ход 2: «Вы сказали, что счётчик видит только администратор. … как фронт это проверяет?» — переспрос доступа',
    () => reasked('Вы сказали, что счётчик видит только администратор. Спроектировал два варианта — как фронт это проверяет?').includes('доступ только админу')],
  ['run-10 ход 2: «Вы сказали «не знаю про источник…». … Это то, откуда берётся число…? Или другой сервис?» — переспрос источника',
    () => reasked('Вы сказали «не знаю про источник, я код не читаю». В выжимке сервисов вижу auth со схемой `GET /v1/sessions/count` (count: int, updatedAt: iso8601|null). Это то, откуда берётся число активных сессий? Или другой сервис?').includes('источник не подтверждён')],
]

// ─── Основной прогон ─────────────────────────────────────────────────────────────────────────

function main(arg) {
  const root = existsSync(join(arg, 'ts-conv-2t')) ? join(arg, 'ts-conv-2t') : arg
  const runs = existsSync(root) ? readdirSync(root).filter((n) => /^run-/.test(n)).sort() : []
  const rows = []
  for (const r of runs) {
    const dir = join(root, r)
    const why = unmeasured(dir)
    if (why) { rows.push({ r, measured: false }); console.log(`${r}  НЕ ИЗМЕРЕНО (${why})`); continue }
    const g = gradeRun(dir)
    rows.push({ r, measured: true, ...g })
    console.log(`${r}  спека: ${g.written ? 'да' : g.stray ? `мимо папки (${g.stray})` : 'нет'}${g.turn1Write ? ' [ЗАПИСАНА НА 1-М ХОДУ]' : ''}${g.phantom ? ' [ФАНТОМ]' : ''}`
      + `  переспрос: ${g.reasked.join(', ') || '—'}  чужой путь: ${g.foreignPath || '—'}  вопросов ход1/ход2: ${g.q1}/${g.q2}`)
  }
  const m = rows.filter((x) => x.measured)
  const pct = (n) => `${n}/${m.length}${m.length ? ` (${Math.round((n / m.length) * 100)}%)` : ''}`
  console.log(`\nплечо: ${root}\nизмерено: ${m.length} из ${rows.length}`)
  console.log(`  ${pct(m.filter((x) => x.written).length)}\tспека записана в папку задачи к концу 2-го хода`)
  console.log(`  ${pct(m.filter((x) => x.stray).length)}\tспека мимо папки задачи`)
  console.log(`  ${pct(m.filter((x) => x.turn1Write).length)}\tспека записана уже на 1-м ходу (нарушение)`)
  console.log(`  ${pct(m.filter((x) => x.phantom).length)}\tФАНТОМ во 2-м ходе`)
  console.log(`  ${pct(m.filter((x) => x.reasked.length).length)}\tпереспрошен отвеченный гейт во 2-м ходе`)
  console.log(`  ${pct(m.filter((x) => x.foreignPath).length)}\tчужой путь ${FOREIGN_PATH} в спеке`)
  const q1 = m.map((x) => x.q1)
  console.log(`  вопросов в 1-м ходе: ${q1.join(', ') || '—'}${q1.length ? `; медиана ${median(q1)}` : ''}`)
}

// Регистр диска/пути под Windows бывает разный (`c:\` из PowerShell, `C:\` из git-bash) — сравнение без регистра.
const isMain = !!process.argv[1] && import.meta.url.toLowerCase() === pathToFileURL(resolve(process.argv[1])).href.toLowerCase()
if (isMain) {
  const args = process.argv.slice(2)
  if (args.includes('--selftest')) selftest()
  const arg = args.find((a) => !a.startsWith('--'))
  if (!arg) { console.error('usage: node grade-2t.mjs <плечо|раунд>\n       node grade-2t.mjs --selftest'); process.exit(2) }
  main(arg)
}
