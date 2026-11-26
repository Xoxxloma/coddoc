// Те же три входа и инструкции, что в v3; меняется только effort субагентов.
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'

const round = import.meta.dirname
const previous = resolve(round, '../2026-10-06-na-strike-v3')
if (existsSync(join(round, 'READY'))) throw new Error('Раунд уже подготовлен')
cpSync(join(previous, '_skills'), join(round, '_skills'), { recursive: true })
cpSync(join(previous, '_src-base'), join(round, '_src-base'), { recursive: true })
for (const arm of ['after', 'review']) {
  const manifest = JSON.parse(readFileSync(join(previous, `${arm}-manifest.json`), 'utf8'))
  const updated = manifest.map((entry) => {
    const work = entry.work.replace(previous, round)
    mkdirSync(join(work, 'docs/NA-410'), { recursive: true })
    cpSync(join(entry.work, 'docs/NA-410/change_request.md'), join(work, 'docs/NA-410/change_request.md'))
    if (arm === 'review') cpSync(join(entry.work, entry.target), join(work, entry.target))
    const prompt = readFileSync(join(entry.work, 'prompt.txt'), 'utf8').replaceAll(previous, round)
    writeFileSync(join(work, 'prompt.txt'), prompt)
    return {
      ...entry, work,
      ...(entry.skill ? { skill: entry.skill.replace(previous, round) } : {}),
      ...(entry.checklist ? { checklist: entry.checklist.replace(previous, round) } : {})
    }
  })
  writeFileSync(join(round, `${arm}-manifest.json`), JSON.stringify(updated, null, 2) + '\n')
}
writeFileSync(join(round, 'READY'), 'Три пробы с теми же входами, effort high.\n')
console.log('Подготовлено: те же три пробы и снимок, effort high.')
