// Раунд 4, режим B — дочерний узел наследует контракт узла-фундамента #0.
// Самая дорогая ошибка петли: ребёнок не прочитал контракт по переданному пути и спроектировал
// свой. Тогда дети эпика разъезжаются контрактами ВСЕ СРАЗУ.
//
// Ловушка фикстуры: в спеке #0 флаг доступности назван `available`. Если ребёнок пишет
// `sourceAvailable` — он не унаследовал, а переизобрёл: это имя напрашивается из БТ, а не из #0.
//
// Запуск: node agent-version/_skill-eval/grade-r4b.mjs <папка> [фильтр-прогонов]
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const runsDir = process.argv[2];
if (!runsDir) { console.error('нужен путь к папке прогонов'); process.exit(1); }
const onlyRe = process.argv[3] ? new RegExp(process.argv[3]) : null;
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
// Прогоном считается папка, где появилась спека ребёнка ХОТЬ ГДЕ-ТО. Спека, положенная не туда,
// обязана попасть в знаменатель и провалить B1, а не выпасть из замера.
function runsOf(d) {
  const all = readdirSync(d).filter((f) => /^run-\d+$/.test(f) && (!onlyRe || onlyRe.test(f)))
    .sort().map((f) => join(d, f));
  const done = all.filter((r) => walk(r).some(
    (p) => /technical_specification\.md$/.test(p) && !/_foundation/.test(p)));
  const skipped = all.length - done.length;
  if (skipped) console.error(`  !! ${skipped} из ${all.length} папок не записали спеку ребёнка — не прогнаны.`);
  return done;
}

function check(run) {
  const epic = join(run, 'coddoc', 'ARS-100');
  const kidPath = join(epic, 'ARS-101', 'technical_specification.md');
  const spec = read(kidPath);
  const fnd = read(join(epic, '_foundation', 'technical_specification.md'));
  const head = spec.split(/^## /m)[0] || '';

  // B2/B3/B4 — состав контракта скопирован, а не переизобретён.
  const inheritedFlag = /\bavailable\b/.test(spec);
  const inheritedCount = /\bcount\b/.test(spec);
  // Переизобретённые имена флага, которые напрашиваются из БТ, но в #0 их нет.
  const renamed = (spec.match(/sourceAvailable|isAvailable|dataAvailable|sourceStatus/g) || []);

  // B5 — маркер наследования проставлен.
  const marker = /depends-on\s*#0|зависит от\s*#0/i.test(spec);

  // B6 — унаследованный стык не переоткрыт как своё новое проектирование.
  // Ищем карточку, где есть `available`, и смотрим, не помечена ли она 🟢 новое.
  const cards = spec.split(/^### /m);
  const inhCard = cards.find((c) => /\bavailable\b/.test(c)) || '';
  const reopened = /🟢\s*(новое|НОВОЕ)/.test(inhCard);

  // B7 — спека #0 не перезатёрта: заглушка фикстуры осталась заглушкой.
  const fndIntact = /заглушка фикстуры/.test(fnd) && fnd.split('\n').length <= 30;

  // B8 — статус в механической форме (счёт, а не рассуждение).
  const status = /Готово к разработке/.test(head) || /Требуются уточнения\s*\(\d+\)/.test(head);

  // B9 — ради чего контракт и нужен ребёнку: фронтовые состояния разведены.
  // null-от-источника и валидный ноль — разные экраны (§4.3).
  const stZero = /(валидн|обычн|как значение)[^\n]{0,60}(ноль|нол|«0»|\b0\b)/i.test(spec)
    || /(ноль|«0»)[^\n]{0,80}(валидн|обычн|показыва)/i.test(spec);
  const stErr = /недоступ/i.test(spec);
  const stLoad = /скелетон|загрузк/i.test(spec);

  // B10 — БТ ребёнка не перезатёрто спекой.
  const btIntact = /# Бизнес-требования/.test(read(join(epic, 'ARS-101', 'business_requirements.md')));

  return {
    'B1 спека ребёнка в папке ARS-101': spec.length > 0,
    'B2 флаг доступности унаследован дословно': inheritedFlag,
    'B3 поле count на месте': inheritedCount,
    'B4 контракт не переименован': renamed.length === 0,
    'B5 маркер depends-on #0 проставлен': marker,
    'B6 стык не переоткрыт как своё 🟢 новое': !reopened,
    'B7 спека #0 не перезатёрта': fndIntact,
    'B8 статус в механической форме': status,
    'B9 состояния фронта разведены (ноль/недоступно/загрузка)': stZero && stErr && stLoad,
    'B10 БТ ребёнка не перезатёрто': btIntact,
    _detail: `${renamed.length ? 'переизобретено:' + [...new Set(renamed)] : 'имена из #0'}`,
  };
}

const runs = runsOf(runsDir);
if (!runs.length) { console.error('прогонов нет'); process.exit(1); }
const totals = new Map();
let whole = 0;
console.log(`=== R4 режим B — ${runs.length} прогонов ===`);
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
