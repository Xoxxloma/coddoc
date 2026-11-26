// Раунд 3 петли — task-decomposition-doc на эпике ARS-100.
// Проверки по диску. Ожидание: 3 ребёнка, FR-1..5 разложены без потерь и без дублей,
// порядок сборки зафиксирован, техника в детские БТ не протекла.
//
// Запуск: node agent-version/_skill-eval/grade-r3.mjs <папка-раунда>
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const runsDir = process.argv[2];
if (!runsDir) { console.error('нужен путь к папке раунда'); process.exit(1); }
const isDir = (p) => existsSync(p) && statSync(p).isDirectory();
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');

// Прогоном считается папка, где агент записал ХОТЬ ЧТО-ТО сверх входного файла.
// Проверять наличие артефакта по ПРАВИЛЬНОМУ пути здесь нельзя: прогон, записавший
// детей плоскими именами в корень, обязан попасть в знаменатель и провалить R3.2,
// а не выпасть из замера. Иначе дефект пути маскируется под «не прогнан».
function walk(dir, acc = []) {
  if (!isDir(dir)) return acc;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (isDir(p)) walk(p, acc); else acc.push(p);
  }
  return acc;
}
function runsOf(d) {
  const all = readdirSync(d).filter((f) => /^run-\d+$/.test(f)).sort().map((f) => join(d, f));
  const done = all.filter((r) => walk(r).filter((p) => /\.md$/.test(p)).length > 1);
  const skipped = all.length - done.length;
  if (skipped) console.error(`  !! ${skipped} из ${all.length} папок ничего не записали — не прогнаны.`);
  return done;
}

const KIDS = ['ARS-101', 'ARS-102', 'ARS-103'];
// Ожидаемое владение по ответам аналитика в промпте.
const OWNER = { 'FR-1': 'ARS-101', 'FR-2': 'ARS-101', 'FR-3': 'ARS-102', 'FR-4': 'ARS-102', 'FR-5': 'ARS-103' };

function check(run) {
  const epic = join(run, 'coddoc', 'ARS-100');
  const decomp = read(join(epic, 'decomposition.md'));
  const kidFiles = Object.fromEntries(KIDS.map((k) => [k, read(join(epic, k, 'business_requirements.md'))]));
  const kidsWritten = KIDS.filter((k) => kidFiles[k].length > 0);

  // Инвариант покрытия: каждый FR ровно у одного ребёнка, и у ПРАВИЛЬНОГО.
  const placed = {};
  for (const fr of Object.keys(OWNER)) {
    placed[fr] = KIDS.filter((k) => new RegExp(`\\b${fr}\\b`).test(kidFiles[k]));
  }
  const lost = Object.entries(placed).filter(([, ks]) => ks.length === 0).map(([fr]) => fr);
  const dup = Object.entries(placed).filter(([, ks]) => ks.length > 1).map(([fr]) => fr);
  const wrong = Object.entries(placed)
    .filter(([fr, ks]) => ks.length === 1 && ks[0] !== OWNER[fr])
    .map(([fr]) => fr);

  // Порядок сборки назван в индексе.
  const order = /ARS-101[\s\S]{0,120}ARS-102[\s\S]{0,120}ARS-103/.test(decomp);
  // Трассировка «эпик-FR → ребёнок» есть в индексе.
  const trace = KIDS.every((k) => decomp.includes(k)) && /FR-/.test(decomp);
  // Техника не протекла: узел-фундамент и микросервисы в ДЕТСКИХ БТ появиться не должны.
  const leak = KIDS.some((k) => /#0|узел-фундамент|микросервис/i.test(kidFiles[k]));
  // Плейсхолдеры вместо реальных ключей — ТОЛЬКО в детских БТ.
  // В decomposition.md строка «по каждой папке coddoc/<EPIC>/<CHILD-KEY>/ запусти ...» —
  // законный текст следующего шага из шаблона скилла, а не незаполненный плейсхолдер.
  const placeholder = KIDS.some((k) => /<CHILD-KEY>|XXX-\d/.test(kidFiles[k]));

  return {
    'R3.1 decomposition.md записан': decomp.length > 0,
    'R3.2 три детских БТ записаны': kidsWritten.length === 3,
    'R3.3 ни один FR не потерян': lost.length === 0,
    'R3.4 ни один FR не задвоен': dup.length === 0,
    'R3.5 FR у того ребёнка, что назвал аналитик': wrong.length === 0,
    'R3.6 порядок сборки зафиксирован': order,
    'R3.7 трассировка FR→ребёнок в индексе': trace,
    'R3.8 техника не протекла в детские БТ': !leak,
    'R3.9 ключи реальные, не плейсхолдеры': !placeholder,
    _detail: `детей=${kidsWritten.length}${lost.length ? ' потеряно:' + lost : ''}${dup.length ? ' задвоено:' + dup : ''}${wrong.length ? ' не у того:' + wrong : ''}`,
  };
}

const runs = runsOf(runsDir);
if (!runs.length) { console.error('прогонов нет'); process.exit(1); }
const totals = new Map();
let whole = 0;
console.log(`=== R3 — ${runs.length} прогонов ===`);
for (const r of runs) {
  const res = check(r);
  const d = res._detail; delete res._detail;
  const bad = Object.entries(res).filter(([, v]) => !v).map(([k]) => k);
  for (const [k, v] of Object.entries(res)) totals.set(k, (totals.get(k) || 0) + (v ? 1 : 0));
  if (!bad.length) whole++;
  console.log(`${r.split(/[\\/]/).pop()}: ${bad.length ? 'FAIL — ' + bad.join('; ') : 'PASS'}  [${d}]`);
}
console.log('\n--- по пунктам ---');
for (const [k, v] of totals) console.log(`${v}/${runs.length}  ${k}`);
console.log(`\nПРОБА ЦЕЛИКОМ: ${whole}/${runs.length}`);
