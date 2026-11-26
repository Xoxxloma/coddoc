// Раскладка прогонов тира A для `spec-review`: у каждого прогона своя песочница.
//
// Почему копия на КАЖДЫЙ прогон, а не одна на пробу: скилл по правилам не пишет на диск, но
// запрет в промпте изоляцией не является — на прошлом замере при двадцати параллельных агентах
// один записал результат прямо в фикстуру. Один такой промах в общей песочнице испортил бы все
// последующие прогоны молча: они читали бы уже починенный документ.
//
// Запуск: node agent-version/_skill-eval/setup-rv-runs.mjs <папка-раунда> [N]

import { mkdirSync, cpSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const roundDir = process.argv[2];
const N = Number(process.argv[3] ?? 10);
if (!roundDir) {
  console.error('нужен путь к папке раунда');
  process.exit(1);
}

// проба -> [фикстура, файл артефакта, тип, чек-лист, источник]
const KINDS = [
  ['spec-dirty', 'RV-DIRTY', 'coddoc/RMS-4021/technical_specification.md', 'тех-спецификация', 'checklist-spec.md', 'coddoc/RMS-4021/business_requirements.md'],
  ['spec-clean', 'RV-CLEAN', 'coddoc/RMS-4021/technical_specification.md', 'тех-спецификация', 'checklist-spec.md', 'coddoc/RMS-4021/business_requirements.md'],
  ['spec-loop', 'RV-LOOP', 'coddoc/RMS-4021/technical_specification.md', 'тех-спецификация', 'checklist-spec.md', 'coddoc/RMS-4021/business_requirements.md'],
  ['bt-design', 'RV-DIRTY', 'coddoc/RMS-4021/business_requirements.md', 'бизнес-требования', 'checklist-bt.md', null],
  ['bt-clean', 'RV-CLEAN', 'coddoc/RMS-4021/business_requirements.md', 'бизнес-требования', 'checklist-bt.md', null],
  ['stage-cut', 'RV-DIRTY', 'coddoc/RMS-4021/stages/stage-01.md', 'файл задачи', 'checklist-stage.md', null],
  ['stage-clean', 'RV-CLEAN', 'coddoc/RMS-4021/stages/stage-01.md', 'файл задачи', 'checklist-stage.md', null],
];

const skillDir = resolve(here, '..', 'spec-review');
const rows = [];

KINDS.forEach(([kind, fixture, artefact, type, checklist, source], idx) => {
  for (let i = 1; i <= N; i += 1) {
    const runDir = join(roundDir, `eval-${idx}-${kind}`, `run-${String(i).padStart(2, '0')}`);
    const sandbox = join(runDir, 'sandbox');
    mkdirSync(join(runDir, 'outputs'), { recursive: true });
    if (!existsSync(sandbox)) cpSync(join(here, 'fixtures', fixture), sandbox, { recursive: true });
    rows.push({
      kind,
      run: `run-${String(i).padStart(2, '0')}`,
      artefact: resolve(sandbox, artefact).replace(/\\/g, '/'),
      source: source ? resolve(sandbox, source).replace(/\\/g, '/') : null,
      checklist: resolve(skillDir, 'reference', checklist).replace(/\\/g, '/'),
      type,
      report: resolve(runDir, 'outputs', 'report.md').replace(/\\/g, '/'),
    });
  }
});

writeFileSync(join(roundDir, 'runs.json'), JSON.stringify(rows, null, 2), 'utf8');
console.log(`песочниц: ${rows.length}, реестр: ${join(roundDir, 'runs.json')}`);
