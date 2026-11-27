#!/usr/bin/env node
// make-selftest.mjs — собирает мини-песочницы самопроверки grade-sm-mono.mjs в grader-selftest/.
//
//   node fixtures/SM-MONO-RUN/make-selftest.mjs
//
// Каждый случай — папка как `<раунд>/sandbox/mono-NN/`: answer.md, _cost.txt, _stream.jsonl и карточка
// w/AI-SDD/services/<сервис>.md. Карточка строится из правды дерева фикстуры (генератор детерминирован)
// и портится намеренно — так известен верный вердикт. Заголовки — в разных законных формах (`{id}` и `:id`,
// удвоенный префикс @RequestMapping, `Класс.run`, имя таблицы, `Query.имя`), чтобы проверить нормализацию.
// Ожидания — expected.json рядом; правится руками вместе с этим файлом.
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadTruth } from '../../grade-sm-mono.mjs'

const HERE = import.meta.dirname
const OUT = join(HERE, 'grader-selftest')
const T = { 'NRS-TAIL': loadTruth('NRS-TAIL', null, { build: true }), 'SM-MONO-DGS': loadTruth('SM-MONO-DGS', null, { build: true }) }

const restHead = (key, i, aliases) => {
  const [verb, path] = key.split(' ')
  const doubled = [...aliases].find((a) => a !== key)
  const p = (i % 7 === 3 && doubled) ? doubled.split(' ')[1] : path
  return `${verb} ${i % 2 ? p.replace(/\{\}/g, ':id') : p.replace(/\{\}/g, '{id}')}`
}
const gqlHead = (key, i) => {
  const [op, name] = key.split(' ')
  const Op = op[0].toUpperCase() + op.slice(1)
  return i % 3 === 0 ? `${op} ${name}` : i % 3 === 1 ? `${Op}.${name}` : `${name} (${op})`
}

function card (fx, { dropContract = 0, dropTopics = 0, dupContract = 0, dupEntity = 0, extraContract = [], swapDir = 0 } = {}) {
  const t = T[fx]; const L = []
  L.push('---', `service: ${t.svc}`, 'type: backend', `repo: ../${t.svc}`, 'scanned: 2026-10-04', 'description: синтетика самопроверки', '---', `# ${t.svc} — backend`, '')
  L.push('## Назначение', '', 'Синтетика.', '')
  // «Бизнес-правила» с заголовками сущностей — в счёт сущностей идти не должны
  L.push('## Бизнес-правила', '')
  for (const k of [...t.T.entities.keys()].slice(0, 3)) L.push(`### \`${k}\` — объект`, '- статус: NEW → DONE', '')
  L.push('## Публичный контракт', '')
  const cs = [...t.T.contract.entries()].slice(dropContract)
  cs.forEach(([k, v], i) => {
    const h = /^(GET|POST|PUT|PATCH|DELETE) /.test(k) ? restHead(k, i, v.aliases) : gqlHead(k, i)
    L.push(`### \`${h}\``, '- сущности: → не сущность', '')
    if (i < dupContract) L.push(`### \`${h}\``, '- повтор', '')
  })
  for (const h of extraContract) L.push(`### \`${h}\``, '- лишний', '')
  L.push('## События', '')
  const ts = [...t.T.topics.entries()].slice(dropTopics)
  ts.forEach(([k, v], i) => {
    const dir = i < swapDir ? (v.dir === 'потребляет' ? 'публикует' : 'потребляет') : v.dir
    L.push(`### ${dir} \`${k}\``, '- ключ: caseId', '')
  })
  L.push('## Фоновые задачи', '')
  ;[...t.T.jobs.entries()].forEach(([k, v], i) => L.push(`### \`${i % 2 ? k + '.' + v.method : k}\``, '- расписание: cron', ''))
  L.push('## Владеет данными', '')
  ;[...t.T.entities.entries()].forEach(([k, v], i) => {
    const table = [...v.aliases].find((a) => a.includes('_'))
    const h = i % 5 === 4 && table ? table : k
    L.push(`### \`${h}\` — сущность`, '- id: UUID', '')
    if (i < dupEntity) L.push(`### \`${h}\``, '- повтор', '')
  })
  L.push('## Зависит от', '', '| Сервис или система | Зачем |', '|---|---|', '| — | |', '')
  return L.join('\n')
}

const ev = (o) => JSON.stringify(o)
const usage = (ctx) => ({ input_tokens: 5, cache_creation_input_tokens: 1000, cache_read_input_tokens: ctx - 1005 })
function stream ({ svc, leadPeak = 120000, subPeaks = [180000, 90000], leadReadWork = false, subReadWork = false } = {}) {
  const L = [ev({ type: 'system', subtype: 'init' })]
  const work = `C:\\sb\\w\\AI-SDD\\services\\.work\\${svc}\\part-02.md`
  L.push(ev({ type: 'assistant', parent_tool_use_id: null, message: { usage: usage(30000), content: [{ type: 'tool_use', id: 't_lead_1', name: 'Bash', input: { command: `bash C:/snap/service-map/reference/check.sh .work/${svc}.opis.md .work/${svc}.md` } }] } }))
  subPeaks.forEach((p, i) => {
    const id = `toolu_sub_${i + 1}`
    L.push(ev({ type: 'assistant', parent_tool_use_id: null, message: { usage: usage(leadPeak - 1000 * (subPeaks.length - i)), content: [{ type: 'tool_use', id, name: 'Agent', input: { description: `часть 0${i + 1}`, prompt: '…' } }] } }))
    const cmd = i === 0 ? `bash C:/snap/service-map/reference/plan.sh .work/${svc}/counts.txt 80 0.1 C:/sb/w/${svc}` : `bash C:/snap/service-map/reference/assemble.sh .work/${svc} 2 2026-10-04 .work/${svc}.md .work/${svc}.opis.md && bash C:/snap/service-map/reference/promote.sh .work/${svc}.md services/${svc}.md`
    L.push(ev({ type: 'assistant', parent_tool_use_id: id, message: { usage: usage(p), content: [{ type: 'tool_use', id: `${id}_b`, name: 'Bash', input: { command: cmd } }] } }))
    if (subReadWork && i === 0) L.push(ev({ type: 'assistant', parent_tool_use_id: id, message: { usage: usage(p - 500), content: [{ type: 'tool_use', id: `${id}_r`, name: 'Read', input: { file_path: work } }] } }))
  })
  if (leadReadWork) L.push(ev({ type: 'assistant', parent_tool_use_id: null, message: { usage: usage(leadPeak - 500), content: [{ type: 'tool_use', id: 't_lead_r', name: 'Read', input: { file_path: work } }] } }))
  L.push(ev({ type: 'assistant', parent_tool_use_id: null, message: { usage: usage(leadPeak), content: [{ type: 'text', text: 'Отчёт Шага 6.' }] } }))
  L.push(ev({ type: 'result', result: 'Отчёт Шага 6.', total_cost_usd: 1.25 }))
  return L.join('\n') + '\n'
}

function make (name, fx, { cardOpts, noCard = false, streamOpts = {}, apiFailure = false, bgOnly = false } = {}) {
  const d = join(OUT, name); rmSync(d, { recursive: true, force: true })
  const svc = T[fx].svc
  mkdirSync(join(d, 'w', 'AI-SDD', 'services'), { recursive: true })
  writeFileSync(join(d, 'w', 'AI-SDD', 'services', 'manifest.yaml'), `services:\n  - name: ${svc}\n    path: ../${svc}\n    type: backend\n`)
  if (!noCard) writeFileSync(join(d, 'w', 'AI-SDD', 'services', `${svc}.md`), card(fx, cardOpts))
  writeFileSync(join(d, '_stream.jsonl'), stream({ svc, ...streamOpts }))
  writeFileSync(join(d, '_cost.txt'), '1.25')
  if (apiFailure) writeFileSync(join(d, '_api-failure.txt'), 'API Error: 529 Overloaded')
  else if (bgOnly) writeFileSync(join(d, '_bg-abandoned.txt'), 'Субагенты работают в фоне — жду уведомления.')
  else writeFileSync(join(d, 'answer.md'), 'Отчёт Шага 6.')
}

mkdirSync(OUT, { recursive: true })
make('nrs-green', 'NRS-TAIL')
make('nrs-no-card', 'NRS-TAIL', { noCard: true })
make('nrs-contract-90', 'NRS-TAIL', { cardOpts: { dropContract: 14 } })
make('nrs-topics-17', 'NRS-TAIL', { cardOpts: { dropTopics: 1 } })
make('nrs-lead-read-work', 'NRS-TAIL', { streamOpts: { leadReadWork: true } })
make('nrs-sub-read-work', 'NRS-TAIL', { streamOpts: { subReadWork: true } })
make('nrs-peak-151k', 'NRS-TAIL', { streamOpts: { leadPeak: 151000 } })
make('nrs-dup-header', 'NRS-TAIL', { cardOpts: { dupContract: 1, dupEntity: 1 } })
make('nrs-api-failure', 'NRS-TAIL', { apiFailure: true })
make('nrs-bg-abandoned', 'NRS-TAIL', { bgOnly: true })
make('dgs-green', 'SM-MONO-DGS')
make('dgs-extras', 'SM-MONO-DGS', { cardOpts: { extraContract: ['CasesItem.status', 'CasesItem.owner', 'ChecksItem.result', 'POST /graphql', 'select c from CaseEntity c'] } })
make('dgs-topic-direction', 'SM-MONO-DGS', { cardOpts: { swapDir: 2 } })
console.log(`собрано в ${OUT}`)
