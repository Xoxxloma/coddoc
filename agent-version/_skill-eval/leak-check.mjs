// leak-check.mjs — следы проб в текстах скиллов петли дискавери (и обратно: примеры скиллов в фикстурах).
// Кандидаты: цитаты «…» из трёх и больше слов, имена и названия (слово с заглавной не в начале фразы), латиница и
// ключи задач, «число + единица». Кандидат — утечка, если он есть в фикстурах и его нет в текстах других скиллов
// набора (там он общий, а не из проб). Принятые совпадения — в `leak-allow.txt` (строка — токен), с причиной после `#`.
//   node leak-check.mjs [скилл …]      (без аргументов — четыре скилла петли)
// Код выхода 1 — есть неразобранные совпадения.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const LOOP = ['meeting-intake', 'notes-to-intent', 'meeting-recall', 'analyst-notebook']
const skills = process.argv.slice(2).length ? process.argv.slice(2) : LOOP
const TEXT = /\.(md|txt|vtt|srt|ya?ml|json|csv)$/i

function walk (dir, out = []) {
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (TEXT.test(e.name) && statSync(p).size < 2e6) out.push(p)
  }
  return out
}
const norm = (s) => s.toLowerCase().replace(/ё/g, 'е').replace(/[\u00a0\s]+/g, ' ')
const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

// Только сырые входы проб: материал стенда (README, expected, реплики, манифест) и эталоны пересказывают скилл законно.
const STAND_FILE = /(^|[\\/])(README\.md|expected\.md|_manifest\.txt|[^\\/]*-turn\d?\.txt|PROVENANCE\.txt|KEY\.md)$|[\\/]etalon[^\\/]*[\\/]/
const fixtures = walk(join(HERE, 'fixtures')).filter((p) => !STAND_FILE.test(p)).map((p) => ({ p, t: norm(read(p)) }))
const others = readdirSync(ROOT, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith('_') && !LOOP.includes(e.name) && e.name !== 'runs')
  .flatMap((e) => walk(join(ROOT, e.name)))
const otherText = norm(others.map(read).join('\n'))
const allow = existsSync(join(HERE, 'leak-allow.txt'))
  ? new Set(read(join(HERE, 'leak-allow.txt')).split('\n').map((l) => norm(l.replace(/#.*$/, '')).trim()).filter(Boolean))
  : new Set()

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const wordRe = (w) => new RegExp('(^|[^а-яa-z0-9])' + esc(norm(w)) + '($|[^а-яa-z0-9])')

function candidates (text) {
  const out = []
  const lines = text.split('\n')
  lines.forEach((line, i) => {
    const L = i + 1
    for (const m of line.matchAll(/«([^»]{6,})»/g)) {
      const q = m[1].trim()
      if (q.split(/\s+/).length >= 3) out.push({ kind: 'цитата', tok: q, L })
    }
    // Слово с заглавной не в начале фразы: имя, система, название.
    for (const m of line.matchAll(/(?<=[а-яёa-z0-9,:]\s+)([А-ЯЁ][а-яё]{2,}(?:-[А-ЯЁ]?[а-яё]+)?)/g)) out.push({ kind: 'имя', tok: m[1], L })
    for (const m of line.matchAll(/\b([A-Z][A-Z0-9]+-\d+)\b/g)) out.push({ kind: 'ключ', tok: m[1], L })
    for (const m of line.matchAll(/(\d+(?:[.,]\d+)?\s+(?:час|минут|дн|день|недел|месяц|лет|год|раз|рубл|процент|%)[а-я]*)/gi)) out.push({ kind: 'число', tok: m[1], L })
  })
  return out
}

let hits = 0
for (const s of skills) {
  const dir = join(ROOT, s)
  for (const f of walk(dir)) {
    const seen = new Set()
    for (const c of candidates(read(f))) {
      const key = c.kind + norm(c.tok)
      if (seen.has(key) || allow.has(norm(c.tok))) continue
      seen.add(key)
      const re = c.kind === 'цитата' ? null : wordRe(c.tok)
      const inFx = fixtures.filter(({ t }) => (re ? re.test(t) : t.includes(norm(c.tok))))
      if (!inFx.length) continue
      if (c.kind !== 'цитата' && c.kind !== 'ключ' && (re ? re.test(otherText) : otherText.includes(norm(c.tok)))) continue
      hits++
      const where = inFx.slice(0, 3).map(({ p }) => relative(join(HERE, 'fixtures'), p).split('\\').join('/')).join(', ')
      console.log(`${relative(ROOT, f).split('\\').join('/')}:${c.L}  ${c.kind} «${c.tok}» — фикстуры (${inFx.length}): ${where}`)
    }
  }
}
console.log(hits ? `совпадений: ${hits} — разобрать: заменить в скилле или внести в leak-allow.txt с причиной` : 'совпадений нет')
process.exit(hits ? 1 : 0)
