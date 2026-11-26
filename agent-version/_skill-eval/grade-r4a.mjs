// Раунд 4, режим A — узел-фундамент #0 пишет свою спеку (своего БТ у него нет).
// Проверки по диску. Дорогая ошибка режима: фундамент лёг не туда / у #0 завели БТ /
// контракт без JSON — дети не смогут к нему писать.
//
// Запуск: node agent-version/_skill-eval/grade-r4a.mjs <папка-режима-A>
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const runsDir = process.argv[2];
if (!runsDir) { console.error('нужен путь к папке прогонов'); process.exit(1); }
const isDir = (p) => existsSync(p) && statSync(p).isDirectory();
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');

function walk(dir, acc = []) {
  if (!isDir(dir)) return acc;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (isDir(p)) walk(p, acc); else acc.push(p);
  }
  return acc;
}
// Прогоном считается папка, где на диске появился хоть один technical_specification.md.
// Спека, положенная НЕ туда, обязана попасть в знаменатель и провалить A1,
// а не выпасть из замера — иначе дефект пути маскируется под «не прогнан».
const onlyRe = process.argv[3] ? new RegExp(process.argv[3]) : null;
function runsOf(d) {
  const all = readdirSync(d).filter((f) => /^run-\d+$/.test(f) && (!onlyRe || onlyRe.test(f)))
    .sort().map((f) => join(d, f));
  const done = all.filter((r) => walk(r).some((p) => /technical_specification\.md$/.test(p)));
  const skipped = all.length - done.length;
  if (skipped) console.error(`  !! ${skipped} из ${all.length} папок не записали ни одной спеки — не прогнаны.`);
  return done;
}

const KIDS = ['ARS-101', 'ARS-102', 'ARS-103'];

function check(run) {
  const epic = join(run, 'coddoc', 'ARS-100');
  const fndPath = join(epic, '_foundation', 'technical_specification.md');
  const spec = read(fndPath);
  const specs = walk(run).filter((p) => /technical_specification\.md$/.test(p));
  const head = spec.split(/^## /m)[0] || '';

  // A2: спека #0 — единственная. Спека в папке эпика или ребёнка = перезатёрли чужое место.
  const strays = specs.filter((p) => !/_foundation[\\/]technical_specification\.md$/.test(p));
  // A3: у #0 своего БТ не бывает.
  const ownBt = existsSync(join(epic, '_foundation', 'business_requirements.md'));
  // A4: в шапке ключ эпика, выдуманного ключа для #0 нет.
  const epicKey = /ARS-100/.test(head);
  const invented = (head.match(/ARS-\d+/g) || []).filter((k) => k !== 'ARS-100' && !KIDS.includes(k));
  // A5..A8: контракт годен к наследованию.
  const green = /🟢/.test(spec) && /### INT-/.test(spec);
  const json = /```json/.test(spec);
  const nullSem = /null/.test(spec) && /недоступ/i.test(spec);
  // Оба стыка: текущее число И ряд за период с зафиксированным enum гранулярности.
  // Меряем СОДЕРЖАНИЕМ, а не числом карточек: свести оба контракта в одну INT-карточку —
  // легальная форма, скилл требует «контракт(ы) общего стыка», а не отдельную карточку на стык.
  const enumOk = /hour/.test(spec) && /day/.test(spec) && /week/.test(spec);
  const nowInt = /\bcount\b/.test(spec);
  const seriesInt = /series|dataPoints|points|ряд[  ]/i.test(spec);
  const twoInts = nowInt && seriesInt;
  // A9: порядок выката — фундамент раньше потребителей.
  // Синонимы равноправны: «первым», «раньше», «ДО потребителей», «сначала … потом».
  // Требовать одно конкретное слово нельзя — скилл фиксирует порядок, а не формулировку.
  const ORD = 'перв|раньше|до потребител|до детей|сначала';
  const order = new RegExp(`(#0|фундамент)[^\\n]{0,140}(${ORD})`, 'i').test(spec)
    || new RegExp(`(${ORD})[^\\n]{0,140}(#0|фундамент)`, 'i').test(spec);
  // A10: статус в механической форме — счёт, а не рассуждение.
  const status = /Готово к разработке/.test(head) || /Требуются уточнения\s*\(\d+\)/.test(head);

  return {
    'A1 спека #0 в _foundation/ папки эпика': spec.length > 0,
    'A2 чужие спеки не перезатёрты': strays.length === 0,
    'A3 у #0 не заведено своего БТ': !ownBt,
    'A4 в шапке ключ эпика, свой не выдуман': epicKey && invented.length === 0,
    'A5 INT-карточка с 🟢 происхождением': green,
    'A6 JSON-пример ответа есть': json,
    'A7 семантика null расписана': nullSem,
    'A8 оба стыка, enum гранулярности зафиксирован': twoInts && enumOk,
    'A9 §6.1 фундамент раньше потребителей': order,
    'A10 статус в механической форме': status,
    _detail: `INT=${(spec.match(/^### INT-/gm) || []).length}${strays.length ? ' лишние:' + strays.map((p) => p.split(/[\\/]/).slice(-2).join('/')) : ''}${invented.length ? ' выдуман:' + invented : ''}`,
  };
}

const runs = runsOf(runsDir);
if (!runs.length) { console.error('прогонов нет'); process.exit(1); }
const totals = new Map();
let whole = 0;
console.log(`=== R4 режим A — ${runs.length} прогонов ===`);
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
