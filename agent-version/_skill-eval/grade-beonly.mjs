// Грейдер ts-beonly (fixtures/TS-BEONLY/README.md): правка логики внутри бэкенда без нового стыка.
//   node grade-beonly.mjs <плечо>      — папка с run-NN
//   node grade-beonly.mjs --selftest
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function grade(spec) {
  const m = {};
  m['спека записана'] = spec.length > 0;
  const s2 = (spec.split(/^## 3\./m)[0].split(/^## (~~)?2\./m).slice(-1)[0]) ?? '';
  m['нет INT-карточек'] = !/^###\s+(~~)?INT-\d/m.test(s2);
  m['§2 — «новых/изменённых взаимодействий нет»'] = /новых\s*(\/|и|или)\s*изменённых\s+взаимодействий\s+нет/.test(s2);
  const s7 = (spec.split(/^## (~~)?7\./m)[2] ?? '').split(/^## /m)[0];
  m['FR-1…FR-3 в §7'] = ['FR-1', 'FR-2', 'FR-3'].every((f) => s7.includes(f));
  m['§7 без выдуманной INT'] = !/INT-\d/.test(s7);
  m['статус проставлен'] = /Статус готовности:\*\*\s*(Готово к разработке|Требуются уточнения \(\d+\))/.test(spec) && !/ПРОСТАВЛЯЕТСЯ/.test(spec);
  return m;
}

function selftest() {
  const good = ['> **Статус готовности:** Готово к разработке', '## ~~2. Взаимодействия (ядро)~~',
    '~~Не применимо: новых/изменённых взаимодействий нет; задето: начисление бонуса~~', '## 3. Backend — ответственность',
    '## 7. Трассировка приёмки', '| FR-1 | логика начисления, §3.1 | … |', '| FR-2 | §3.1 | … |', '| FR-3 | §3.1 | … |', '## 8. Допущения'].join('\n');
  const bad = ['> **Статус готовности:** <ПРОСТАВЛЯЕТСЯ ПОСЛЕ ЗАПИСИ>', '## 2. Взаимодействия (ядро)', '### INT-1. Расчёт ступени — 🟢',
    '## 3. Backend', '## 7. Трассировка приёмки', '| FR-1 | INT-1 | … |', '## 8.'].join('\n');
  let fails = 0;
  for (const [k, v] of Object.entries(grade(good))) if (!v) { fails++; console.log('  ✗ хорошая спека провалила: ' + k); }
  for (const [k, v] of Object.entries(grade(bad))) if (v && k !== 'спека записана') { fails++; console.log('  ✗ плохая спека не поймана: ' + k); }
  console.log(fails ? `самотест: провалов ${fails}` : 'самотест: ✓');
  return fails;
}

const arg = process.argv[2];
if (arg === '--selftest') process.exit(selftest() ? 1 : 0);
if (selftest()) process.exit(1);
const runs = readdirSync(arg).filter((d) => /^run-\d+$/.test(d)).sort();
const tot = {};
let green = 0;
for (const r of runs) {
  const f = join(arg, r, 'coddoc', 'LND-58', 'technical_specification.md');
  const m = grade(existsSync(f) ? readFileSync(f, 'utf8').replace(/\r/g, '') : '');
  const bad = Object.entries(m).filter(([, v]) => !v).map(([k]) => k);
  if (!bad.length) green++;
  for (const k of bad) tot[k] = (tot[k] ?? 0) + 1;
  console.log(`${r}: ${bad.length ? '✗ ' + bad.join(', ') : '✓'}`);
}
for (const [k, n] of Object.entries(tot)) console.log(`  ${n}/${runs.length}\t${k}`);
console.log(`  ${green}/${runs.length}\tзелёных`);
