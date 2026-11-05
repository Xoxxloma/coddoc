#!/usr/bin/env node
// judge-chk-pack.mjs <папка-раунда chk> <папка-выхода>
//
// Пакеты слепого судьи (PLAN-REHEARSE-CHECK.md, приёмка п. 4): по каждому прогону `chk-*` — спека, документ сверху и
// два списка — база `spec-readiness` (runs/2026-11-04-rex-base) и режим проверки — под буквами A/B в случайном
// порядке. Оба списка приведены к голым вопросам: у нового сняты «Чем грозит», роли и опоры, у базы — счётные строки;
// судья сравнивает содержание, не форму. Разметка букв — в `<выход>/_key.json`, судье её не показывать.
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, statSync } from 'node:fs'
import { join, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const BASE = join(HERE, 'runs', '2026-11-04-rex-base')
const KIND = {
  gap: { fx: 'SR-GAP', key: 'PSS-2210', top: 'business_requirements.md', base: 'sr-gap' },
  clean: { fx: 'SR-CLEAN', key: 'OFC-880', top: 'business_requirements.md', base: 'sr-clean' },
  yellow: { fx: 'SR-YELLOW', key: 'SUP-702', top: 'business_requirements.md', base: 'sr-yellow' },
  'blue-yes': { fx: 'SR-BLUE', key: 'SHT-410', top: null, base: 'sr-blue-yes' },
  'blue-idk': { fx: 'SR-BLUE', key: 'SHT-411', top: null, base: 'sr-blue-idk' },
  'blue-cr': { fx: 'SR-BLUE', key: 'UA-420', top: null, base: 'sr-blue-cr' },
}
const read = p => (existsSync(p) ? readFileSync(p, 'utf8') : '')

function newList(sb) {
  const blocks = []
  for (const line of read(join(sb, 'stream.jsonl')).split('\n')) {
    if (!line.trim()) continue
    let j; try { j = JSON.parse(line) } catch { continue }
    if (j.type !== 'assistant' || j.parent_tool_use_id || !Array.isArray(j.message?.content)) continue
    for (const c of j.message.content) if (c.type === 'text' && /Проверка:/.test(c.text)) blocks.push(String(c.text))
  }
  const text = blocks[0] || read(join(sb, 'answer.md'))
  const out = []
  for (const l of text.slice(Math.max(0, text.indexOf('Проверка:'))).split('\n')) {
    const m = l.match(/^\s*[*_]*(\d+)[.)][*_]*\s+(.*)$/)
    if (m) out.push(m[2].replace(/[*_`]/g, '').trim())
  }
  return out
}
function baseList(dir) {
  const text = read(join(dir, 'run-1', 'answer.md'))
  const out = []
  let sec = ''
  for (const l of text.split('\n')) {
    if (/^(§|\[свод\])/.test(l.trim())) { sec = l.trim(); continue }
    const m = l.match(/^\s+(\d+)\.\s+(.*)$/)
    if (m) out.push(`${sec}: ${m[2].trim()}`)
  }
  return out
}

const [round, outDir] = process.argv.slice(2)
if (!round || !outDir) { console.error('usage: node judge-chk-pack.mjs <папка-раунда> <папка-выхода>'); process.exit(1) }
mkdirSync(outDir, { recursive: true })
const key = {}
for (const arm of readdirSync(round).filter(f => f.startsWith('chk-') && statSync(join(round, f)).isDirectory()).sort()) {
  const kind = arm.replace(/^chk-/, ''), K = KIND[kind]
  if (!K) continue
  const spec = resolve(HERE, 'fixtures', K.fx, 'coddoc', K.key, 'technical_specification.md')
  const top = K.top ? resolve(HERE, 'fixtures', K.fx, 'coddoc', K.key, K.top) : null
  const base = baseList(join(BASE, K.base))
  for (const run of readdirSync(join(round, arm)).filter(f => f.startsWith('run-')).sort()) {
    const neu = newList(join(round, arm, run))
    const newIsA = Math.random() < 0.5
    const [A, B] = newIsA ? [neu, base] : [base, neu]
    const fmt = xs => (xs.length ? xs.map((x, i) => `${i + 1}. ${x}`).join('\n') : '(пусто — вопросов нет)')
    const id = `${kind}-${run}`
    key[id] = { A: newIsA ? 'new' : 'base', B: newIsA ? 'base' : 'new', nNew: neu.length, nBase: base.length }
    writeFileSync(join(outDir, `${id}.md`), `Ты — техлид, который будет строить по этой спеке. Аналитик перед тем, как отдать её в разработку, получил
от двух проверок два списка вопросов — A и B. Оцени их.

Прочитай спеку ${spec} и документ сверху: ${top || 'нет'}. Другие файлы не открывай.

Метки:
- критичный — спека на него не отвечает или противоречит сама себе, и без ответа исполнитель решит сам, а неверное
  решение потеряет или задвоит данные, пропустит действие без права, покажет человеку не то или потребует переделки
  после выката;
- мелочь — спека не отвечает, но любое разумное решение исполнителя годится или правится дёшево;
- ответ есть — спека отвечает прямо;
- вне предмета — о том, чего спека по замыслу не описывает (персональные данные и сроки хранения, журналы и метрики,
  тексты и вёрстка экрана, негативные тесты, разбивка списка на страницы, числа нагрузки, которых в спеке нет), или
  требует описать чужой сервис.

Задание:
1. Размечь каждый пункт A и каждый пункт B одной меткой; для «ответ есть» — номер строки спеки.
2. Критичные вопросы, которые есть в одном списке и которых нет в другом. Тот же объект и то же непринятое решение —
   один вопрос, даже если сформулирован иначе.
3. Какой список полезнее аналитику перед разработкой — A, B или равны — и почему, 2–3 фразы. Полезнее тот, где больше
   критичного и меньше лишнего; пропущенная критичная дыра весит больше лишней мелочи.

Ответ — только этот блок:
## A
1. <метка> — <пункт в 5–10 словах>
## B
1. <метка> — <пункт>
## ТОЛЬКО В A
- <критичный вопрос коротко> (или «—»)
## ТОЛЬКО В B
- <критичный вопрос коротко> (или «—»)
## ВЫВОД
<A | B | равны> — <почему>

Список A:
${fmt(A)}

Список B:
${fmt(B)}
`)
    console.log(`${id}: new=${neu.length} base=${base.length} → ${outDir}/${id}.md`)
  }
}
writeFileSync(join(outDir, '_key.json'), JSON.stringify(key, null, 2))
