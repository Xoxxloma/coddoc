// grade-sm-neighbours.mjs — SM-REAL с соседом-заглушкой hello-api (SM_REAL_HELLO=1).
//
//   node grade-sm-neighbours.mjs <раунд> [префикс песочниц, по умолчанию keyed-]
//
// По песочнице:
//   поиск соседей — ведущий (не субагент) звал Glob с `.git` в паттерне: Шаг 2.1 выполнялся;
//   названы       — `hello-api` / `resonance-web` в ответе или в actions.log;
//   вопрос        — вызовов AskUserQuestion у ведущего;
//   чтений        — запусков читающего субагента ведущим (бриф Шага 3), по сервисам;
//   добор         — второй запуск по тому же сервису; печатается начало блока «Добор» и
//                   отдельно — есть ли в нём слово «источник».
// Не измерено: нет answer.md, есть _api-failure.txt или _bg-abandoned*.txt без ответа.
// Регэкспы из строк не собираются; поиск подстрок — includes.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

const [round, prefix = 'keyed-'] = process.argv.slice(2)
if (!round || !existsSync(round)) { console.error('нужна папка раунда'); process.exit(1) }
const sb = join(round, 'sandbox')
const dirs = existsSync(sb)
  ? readdirSync(sb).filter((d) => d.startsWith(prefix) && statSync(join(sb, d)).isDirectory()).sort()
  : []
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '')
const SERVICES = ['repairy-api', 'repairy-web', 'resonance-api', 'resonance-web', 'hello-api']
const READER = 'читающий субагент'

console.log(`\nсоседи и добор, ${round} (${prefix}*)`)
console.log('песочница · поиск соседей · названы hello-api / resonance-web · AskUserQuestion · чтений по сервисам · добор · запись в чужие репы · цена')
for (const d of dirs) {
  const dir = join(sb, d)
  const answer = read(join(dir, 'answer.md'))
  if (!answer.trim()) { console.log(`  ${d}: не измерено (ответа нет)`); continue }
  const trace = read(join(dir, '_trace.jsonl')).split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const lead = trace.filter((t) => !t.sub)
  const gitGlobs = lead.filter((t) => t.tool === 'Glob' && (t.pattern || '').includes('.git')).length
  const asks = lead.filter((t) => t.tool === 'AskUserQuestion').length
  const log = read(join(dir, 'w', 'AI-SDD', 'actions.log'))
  const said = answer + '\n' + log
  const named = ['hello-api', 'resonance-web'].map((n) => (said.includes(n) ? n : '—')).join(' / ')

  // Запуски субагентов ведущим — из потока: в _trace.jsonl промпта нет. Сервис — по подписи
  // вызова, затем по тексту брифа; вид — добор / уборка / копия / чтение.
  const reads = new Map()
  const dobor = []
  for (const line of read(join(dir, '_stream.jsonl')).split('\n')) {
    if (!line.trim()) continue
    let j; try { j = JSON.parse(line) } catch { continue }
    if (j.type !== 'assistant' || j.parent_tool_use_id) continue
    for (const c of (j.message && j.message.content) || []) {
      if (c.type !== 'tool_use' || (c.name !== 'Agent' && c.name !== 'Task')) continue
      const p = (c.input && c.input.prompt) || ''
      const desc = (c.input && c.input.description) || ''
      const svc = SERVICES.find((s) => desc.includes(s)) || SERVICES.find((s) => p.includes(s)) || '?'
      const all = desc + '\n' + p
      if (all.includes('Удали ровно') || (all.includes('без изменений') && !all.includes(READER))) continue
      const isDobor = desc.toLowerCase().includes('добор') || p.includes('## Добор')
      if (!isDobor) { reads.set(svc, (reads.get(svc) || 0) + 1); continue }
      // Перечень — после стандартной шапки блока «Добор» (SKILL.md, 3.4), если она есть.
      const HEAD_END = 'сам не правит ничего.'
      const he = p.indexOf(HEAD_END)
      const at = he >= 0 ? he + HEAD_END.length : p.indexOf('Добор')
      const tail = (at >= 0 ? p.slice(at, at + 1500) : p.slice(-1500)).replace(/\s+/g, ' ').trim()
      const low = tail.toLowerCase()
      const source = ['файл-источник', 'файла-источника', 'без файла', 'источник у ключа', 'файл не назван', 'не назван файл'].some((k) => low.includes(k))
      dobor.push({ svc, source, tail })
    }
  }
  const readsStr = [...reads].map(([s, n]) => `${s}×${n}`).join(', ') || '0'
  const doborStr = dobor.length ? dobor.map((x) => `${x.svc}${x.source ? ' (источник)' : ''}`).join(', ') : 'нет'
  const dirt = existsSync(join(dir, '_dirt.txt')) ? 'ДА' : 'нет'
  const cost = read(join(dir, '_cost.txt')).trim()
  console.log(`  ${d}: ${gitGlobs ? `да (${gitGlobs})` : 'нет'} · ${named} · ${asks} · ${readsStr} · ${doborStr} · ${dirt} · ${cost ? '$' + Number(cost).toFixed(2) : '—'}`)
  for (const x of dobor) console.log(`      добор ${x.svc}: ${x.tail.slice(0, 500)}`)
}
