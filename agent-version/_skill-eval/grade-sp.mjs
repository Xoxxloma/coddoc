// Грейдер регрессии §2.5 (SP-1/SP-2/SP-7 на ARS-120, SP-3 на ARS-57, SP-5 на ARS-121).
// Работает по answer.md прогона — там лежит текст спеки, который модель «записала бы».
// Запуск: node agent-version/_skill-eval/grade-sp.mjs <probe>
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeSpecHeadings } from './spec-markdown.mjs';

const probe = process.argv[2];
const runsDir = process.argv[3] || join(process.cwd(), 'agent-version/_skill-eval/runs/2026-07-31-stages');
const isDir = (p) => existsSync(p) && statSync(p).isDirectory();
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');

// Четвёртый аргумент — имя папки прогонов, если оно не совпадает с именем пробы.
// Нужен, чтобы прогнать НОВЫЕ проверки по СТАРЫМ артефактам: грейдер валидируется на
// заведомо известном результате, а не публикуется вместе с числом, которое он же и произвёл.
const folderOverride = process.argv[4];
function runsOf(name) {
  const d = join(runsDir, folderOverride || name);
  if (!isDir(d)) return [];
  // прогон без answer.md не состоялся — в знаменатель не идёт
  return readdirSync(d)
    .filter((f) => /^run-\d+$/.test(f))
    .sort()
    .map((f) => join(d, f))
    .filter((p) => existsSync(join(p, 'answer.md')));
}

// вырезать секцию §2.5 из текста спеки
function section25(t) {
  const m = t.match(/##+\s*2\.5[\s\S]*?(?=\n##+\s*3\.|\n##+\s*«|$)/);
  return m ? m[0] : '';
}
// строки таблицы этапов: | 01 | ... | ... | ... |
function stageRows(sec) {
  return sec
    .split('\n')
    .filter((l) => /^\|\s*\d{1,2}\s*\|/.test(l))
    .map((l) => l.split('|').map((c) => c.trim()).filter((c, i, a) => i > 0 && i < a.length - 1));
}
const NA = /не примен/i;

const CHECKS = {
  // TS-4 — регрессия technical-spec-doc после удаления §2.5 (артефакт на ARS-120).
  // SP-1/SP-2/SP-7 меряли §2.5 и после её удаления пусты; TS-4 меряет то, что осталось
  // обязанностью скилла, плюс новый пункт 9 Self-Review (пометки происхождения у ВСЕХ карточек).
  ts4(run) {
    const t = read(join(run, 'answer.md'));
    const has = (re) => re.test(t);

    // секции шаблона: §1..§8 (§2.5 больше не существует и появиться не должна)
    const wanted = [/##+\s*1\./, /##+\s*2\./, /##+\s*3\./, /##+\s*4\./, /##+\s*5\./, /##+\s*6\./, /##+\s*7\./, /##+\s*8\./];
    const headingText = normalizeSpecHeadings(t);
    const missing = wanted.filter((re) => !re.test(headingText));

    // INT-карточки и пометки происхождения у каждой
    const intCards = t.match(/^#+\s*INT-\d+\..*$/gm) || [];
    const intTagged = intCards.filter((h) => /🟢|🔵|🟡|❓/.test(h));

    // статус: заглушки нет, значение механически согласовано с наличием открытых пунктов
    const placeholder = /ПРОСТАВЛЯЕТСЯ ПОСЛЕ ЗАПИСИ/.test(t);
    const statusLine = (t.match(/Статус готовности:\s*\**\s*([^\n*]+)/) || [])[1] || '';
    const needsWork = /Требуются уточнения/i.test(statusLine);
    // ЛЕГЕНДА ШАБЛОНА НЕСЁТ ТЕ ЖЕ МАРКЕРЫ, и без её отсева проверка односторонняя: любая
    // спека выглядит имеющей открытые пункты, поэтому верное «Готово к разработке» не могло
    // быть зачтено НИКОГДА — TS-4.4 краснела на правильном документе. Строки легенды это
    // цитата, начинающаяся с маркера; фильтр взят из `grade-ts.mjs`, где он уже работает.
    const liveBody = t
      .split('\n')
      .filter((l) => !/^\s*>\s*(🟢|🔵|🟡|❓|⚠️)/.test(l))
      .join('\n');
    const hasOpen = /к валидации|TBD|⚠️/.test(liveBody);
    // Число в статусе — сам механизм, а не оформление: посчитать N можно только по блоку,
    // а посчитав, уже нельзя подставить «Готово к разработке» при N ≥ 1.
    const statusHasCount = /Требуются уточнения\s*\(\s*\d+\s*\)/i.test(statusLine);

    // кардинальный грех на этой фикстуре: формат сообщения внешней системы остаётся к валидации.
    // Красный — конкретное имя топика/очереди, выданное за факт.
    const inventedTopic = /(topic|топик|очередь|queue)\s*[:«"`]\s*[a-z0-9._-]{4,}/i.test(t);

    const jsonFences = (t.match(/```json/g) || []).length;

    return {
      'TS-4.1 все секции §1..§8 на месте': missing.length === 0,
      'TS-4.2 §2.5 не появилась (её нет в шаблоне)': section25(t).length === 0,
      'TS-4.3 заглушки статуса не осталось': !placeholder,
      'TS-4.4 статус механически верен': hasOpen ? needsWork : statusLine.length > 0,
      'TS-4.8 число открытых пунктов в статусе': hasOpen ? statusHasCount : true,
      'TS-4.5 у каждой INT-карточки пометка происхождения': intCards.length > 0 && intTagged.length === intCards.length,
      'TS-4.6 имя топика не выдумано': !inventedTopic,
      'TS-4.7 JSON-пример у 🟢-контракта есть': jsonFences >= 1,
      _detail: `секций нет=${missing.length} int=${intCards.length}/${intTagged.length} статус="${statusLine.trim()}" открытые=${hasOpen} заглушка=${placeholder} json=${jsonFences} топик=${inventedTopic}`,
    };
  },

  // SP-1 + SP-2 + SP-7 на общем артефакте (ARS-120, три звена потока)
  sp1(run) {
    const t = read(join(run, 'answer.md'));
    const sec = section25(t);
    const rows = stageRows(sec);
    const filled = rows.filter((r) => r.length >= 4 && r[1] && r[2] && r[3] && !/^—?$/.test(r[3]));
    const layer = /\|\s*\d+\s*\|\s*(бэкенд|бекенд|фронтенд|фронт|BE|FE|серверная часть|клиентская часть)\s*\|/i.test(sec);
    return {
      'SP-1.1 секция §2.5 присутствует': sec.length > 0,
      'SP-1.2 строк этапов >= 3': rows.length >= 3,
      'SP-1.3 у каждого этапа все три колонки непусты': rows.length > 0 && filled.length === rows.length,
      'SP-1.4 есть строка про параллельность': /параллельн/i.test(sec),
      'SP-1.5 есть отсылка к порядку выката (§6.1)': /6\.1|порядок выката/i.test(sec),
      'SP-2.1 этапы не названы слоями': !layer,
      'SP-7.1 вердикт §4.5 не перенесён': !(NA.test(sec) && rows.length === 0),
      _detail: `строк=${rows.length} заполнено=${filled.length} na=${NA.test(sec)} слои=${layer}`,
    };
  },

  // SP-3 — ловушка слоя на ARS-57: «не применимо» либо ровно один этап
  sp3(run) {
    const t = read(join(run, 'answer.md'));
    const sec = section25(t);
    const rows = stageRows(sec);
    return {
      'SP-3.1 секция §2.5 не выброшена': sec.length > 0,
      'SP-3.2 «не применимо» либо один этап': (NA.test(sec) && rows.length === 0) || rows.length === 1,
      'SP-3.3 причина по существу, не отписка': !/задача (небольш|маленьк|прост)/i.test(sec),
      'SP-3.4 нет двух этапов «счёт / отображение»': rows.length < 2,
      _detail: `строк=${rows.length} na=${NA.test(sec)}`,
    };
  },

  // SP-5 — неделимая работа на ARS-121
  sp5(run) {
    const t = read(join(run, 'answer.md'));
    const sec = section25(t);
    const rows = stageRows(sec);
    return {
      'SP-5.1 секция §2.5 не выброшена': sec.length > 0,
      'SP-5.2 «не применимо» либо один этап': (NA.test(sec) && rows.length === 0) || rows.length === 1,
      'SP-5.3 этапы не выдуманы': !/(подготовить данные|отрисовать|покрыть тестами|написать тесты)/i.test(sec),
      'SP-5.4 причина названа': NA.test(sec) ? sec.replace(/\s+/g, ' ').length > 80 : true,
      _detail: `строк=${rows.length} na=${NA.test(sec)} длина=${sec.replace(/\s+/g, ' ').length}`,
    };
  },
};

CHECKS.sp1base = CHECKS.sp1;
CHECKS.sp1new2 = CHECKS.sp1;   // круг 2: §2.5 сжата + #0 вынесен
CHECKS.sp1new3 = CHECKS.sp1;   // круг 3: откат неполный (блок §6.1 остался сжатым)
CHECKS.sp1new4 = CHECKS.sp1;   // круг 4: §2.5 = база + одна вставка про stage-breakdown-doc
CHECKS.sp3new = CHECKS.sp3;    // круг 2: §2.5 сжата
CHECKS.sp3base = CHECKS.sp3;
CHECKS.sp5new = CHECKS.sp5;
CHECKS.sp5base = CHECKS.sp5;
CHECKS.sp1new = CHECKS.sp1;

if (!CHECKS[probe]) {
  console.error(`неизвестная проба: ${probe}. Доступны: ${Object.keys(CHECKS).join(', ')}`);
  process.exit(1);
}
const runs = runsOf(probe);
if (!runs.length) { console.error(`нет прогонов в ${join(runsDir, probe)}`); process.exit(1); }

const tally = {};
const lines = [];
for (const run of runs) {
  const res = CHECKS[probe](run);
  const detail = res._detail; delete res._detail;
  const failed = Object.entries(res).filter(([, v]) => !v).map(([k]) => k);
  for (const [k, v] of Object.entries(res)) {
    tally[k] = tally[k] || { pass: 0, total: 0 };
    tally[k].total++; if (v) tally[k].pass++;
  }
  lines.push(`${run.split(/[\\/]/).pop()}: ${failed.length ? 'FAIL — ' + failed.join('; ') : 'PASS'}  [${detail}]`);
}
console.log(`\n=== ${probe.toUpperCase()} — ${runs.length} прогонов ===`);
lines.forEach((l) => console.log(l));
console.log('\n--- по пунктам ---');
for (const [k, v] of Object.entries(tally)) console.log(`${v.pass}/${v.total}  ${k}`);
console.log(`\nПРОБА ЦЕЛИКОМ: ${lines.filter((l) => l.includes(': PASS')).length}/${runs.length}`);
