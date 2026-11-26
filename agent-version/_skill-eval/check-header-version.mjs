#!/usr/bin/env node
// check-header-version.mjs — номер в шаблоне шапки совпадает с `version:` пишущего скилла.
//
//   node check-header-version.mjs [--root=<папка со скиллами>]
//
// Frontmatter до модели не доходит, поэтому шаблон несёт номер сам. Без этой проверки повышение
// версии оставит старый номер в шаблоне, и документы будут молча врать, на чём сделаны. Модель не нужна.

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const arg = process.argv.find((a) => a.startsWith('--root='))
const ROOT = arg ? arg.slice('--root='.length) : join(HERE, '..')

const SKILLS = [
  'business-requirements-doc',
  'bug-report-doc',
  'change-request-doc',
  'technical-spec-doc',
  'task-decomposition-doc',
]

let bad = 0
for (const skill of SKILLS) {
  const text = readFileSync(join(ROOT, skill, 'SKILL.md'), 'utf8')
  const version = (text.match(/^version:\s*(\S+)/m) || [])[1]
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
  const found = [...body.matchAll(new RegExp(`${skill} (\\d+\\.\\d+\\.\\d+)`, 'g'))].map((m) => m[1])
  const ok = Boolean(version) && found.length > 0 && found.every((v) => v === version)
  if (!ok) bad++
  console.log(`${ok ? 'ок    ' : 'ОШИБКА'} ${skill}: version ${version ?? 'нет'}, в шаблоне ${found.join(', ') || 'нет'}`)
}
process.exit(bad ? 1 : 0)
