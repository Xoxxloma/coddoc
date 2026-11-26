// TD-PATH — task-decomposition-doc на эпике, который лежит НЕ в `coddoc/<KEY>/`.
//
// Эпик:  AI-SDD/coddoc/PSS-40/business_requirements.md   (в песочнице есть ещё и КОРНЕВАЯ `coddoc/`
// — настоящая продуктовая документация, ловушка на шаблон `coddoc/<KEY>/`).
// Правда: дети кладутся ВНУТРЬ папки эпика — AI-SDD/coddoc/PSS-40/PSS-41/ и /PSS-42/.
//
// Запуск: node agent-version/_skill-eval/grade-td-path.mjs <папка-плеча> [gate]
//   без аргумента  — плечо td-path-w  (грейдится диск)
//   gate           — плечо td-gate    (грейдится отказ: файлов нет, спрошен путь)
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const runsDir = process.argv[2];
const MODE = ['gate', 'alias'].includes(process.argv[3]) ? process.argv[3] : 'write';
if (!runsDir) { console.error('нужен путь к папке плеча'); process.exit(1); }

const isDir = (p) => existsSync(p) && statSync(p).isDirectory();
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');

// Две раскладки одной пробы. `alias` — та, на которой дефект принесли с живой работы:
// ключ эпика `T-T-M-1.2` НЕ матчит regex скилла, а у детей ключи настоящие, и рядом под
// `coddoc/` лежит обычная задача — то есть шаблон «ключ задачи → своя папка под coddoc/» виден
// прогону на диске и тянет детей в корень.
const LAYOUT = MODE === 'alias'
  ? {
      seed: 'seed-alias',
      epicDir: ['coddoc', 'T-T-M-1.2'],
      kids: ['AAA-1', 'AAA-2', 'AAA-3', 'AAA-4'],
      owner: { 'FR-1': 'AAA-1', 'FR-2': 'AAA-1', 'FR-3': 'AAA-2', 'FR-4': 'AAA-2',
               'FR-5': 'AAA-3', 'FR-6': 'AAA-3', 'FR-7': 'AAA-4', 'FR-8': 'AAA-4' },
      root: 'coddoc/',
      seeded: [join('coddoc', 'OPS-77', 'business_requirements.md')],
    }
  : {
      seed: 'seed',
      epicDir: ['AI-SDD', 'coddoc', 'PSS-40'],
      kids: ['PSS-41', 'PSS-42'],
      owner: { 'FR-1': 'PSS-41', 'FR-2': 'PSS-41', 'FR-3': 'PSS-41', 'FR-4': 'PSS-42', 'FR-5': 'PSS-42' },
      root: 'AI-SDD/coddoc/',
      seeded: [join('AI-SDD', 'services', 'manifest.yaml'), join('coddoc', 'index.md'), join('coddoc', 'deploy.md')],
    };
const KIDS = LAYOUT.kids;
const OWNER = LAYOUT.owner;
const EPIC_DIR = LAYOUT.epicDir;
const EPIC_BT = join(...EPIC_DIR, 'business_requirements.md');

function walk(dir, acc = []) {
  if (!isDir(dir)) return acc;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (isDir(p)) walk(p, acc); else acc.push(p);
  }
  return acc;
}
// Файлы, которые прогон получил в засеве. Всё остальное на диске — его запись.
const SEEDED = new Set([
  EPIC_BT,
  join('AI-SDD', 'coddoc', 'PSS-12', 'business_requirements.md'),
  ...LAYOUT.seeded,
  'answer.md',
]);
// Файлы самого стенда, а не прогона: пул кладёт их в песочницу рядом с артефактами. Без этого
// фильтра «ни одного файла мимо папки эпика» краснеет на КАЖДОМ прогоне, включая идеальный, —
// и проба показывает дефект скилла там, где его нет.
const HARNESS = (r) => {
  const f = posix(r).split('/').pop();
  return f === 'answer.md' || f === 'stream.jsonl' || f.startsWith('_');
};
const posix = (p) => p.split(sep).join('/');

// Прогоном считается папка, где агент записал ХОТЬ ЧТО-ТО сверх засева ИЛИ ответил.
// Проверять артефакт по ПРАВИЛЬНОМУ пути здесь нельзя: прогон, положивший детей мимо папки
// эпика, обязан попасть в знаменатель и провалить счётчик пути, а не выпасть из замера.
function runsOf(d) {
  const all = readdirSync(d).filter((f) => /^run-\d+$/.test(f)).sort().map((f) => join(d, f));
  // Побег из песочницы: прогон записал результат мимо своей папки (в фикстуру, в корень репы).
  // Он не «провалил путь» — он не измерен, и в знаменателе ему не место. Метка ставится руками
  // после разбора трассы, автоматически атрибутировать побег нельзя.
  const escaped = all.filter((r) => existsSync(join(r, '_escaped.txt')));
  const done = all.filter((r) => walk(r).length > 0 && !escaped.includes(r));
  const empty = all.length - done.length - escaped.length;
  if (empty) console.error(`  !! ${empty} из ${all.length} папок пусты — не прогнаны.`);
  if (escaped.length) console.error(`  !! ПОБЕГ: ${escaped.length} из ${all.length} записали мимо песочницы — исключены, знаменатель ${done.length}.`);
  return done;
}

// Куда прогон положил ребёнка: разбор ЛЮБОГО написанного файла, а не проверка ожидаемого пути.
function classify(rel) {
  const p = posix(rel);
  const kid = KIDS.find((k) => p.includes(k));
  if (!kid) return null;
  const inEpicDir = p.startsWith(posix(join(...EPIC_DIR)) + '/');
  const asFolder = p.includes(`/${kid}/`);
  if (inEpicDir && asFolder && p.endsWith('/business_requirements.md')) return { kid, verdict: 'ok' };
  if (inEpicDir && !asFolder) return { kid, verdict: 'flat' };          // ключ в имени файла
  if (!inEpicDir && p.startsWith(LAYOUT.root)) return { kid, verdict: 'sibling' };
  if (p.startsWith('coddoc/')) return { kid, verdict: 'root-docs' };      // шаблон от корня песочницы
  return { kid, verdict: 'elsewhere' };
}

// Владение считается по ФОРМУЛИРОВКЕ требования в §4.1 («- **FR-3.** …»), а не по упоминанию
// «FR-3» где угодно в файле. Ребёнок законно называет чужие FR в «не входит в слайс» и в шапке
// разреза — по упоминанию такой файл читался бы как «владеет всеми пятью», и счётчик краснел бы
// на прогоне, разложившем FR правильно (поймано на run-4 круга «до»).
const owns = (text, fr) => text.includes('**' + fr + '.**');

function checkWrite(run) {
  const written = walk(run).map((p) => relative(run, p)).filter((r) => !SEEDED.has(r) && !HARNESS(r));
  const placed = written.map(classify).filter(Boolean);
  const ok = new Set(placed.filter((x) => x.verdict === 'ok').map((x) => x.kid));
  const bad = placed.filter((x) => x.verdict !== 'ok');

  const kidText = Object.fromEntries(KIDS.map((k) => [k, read(join(run, ...EPIC_DIR, k, 'business_requirements.md'))]));
  const decomp = read(join(run, ...EPIC_DIR, 'decomposition.md'));

  // Разрез по существу — сторож: без него «пути верные» можно получить пустыми файлами.
  const frWrong = Object.entries(OWNER).filter(([fr, owner]) => {
    const hits = KIDS.filter((k) => owns(kidText[k], fr));
    return hits.length !== 1 || hits[0] !== owner;
  }).map(([fr]) => fr);

  // `TD_FIXTURE=TD-RU` — копия засева на словах 5.35 (проба `td-ru-w`); эпик сверяется с СВОИМ засевом.
  const epicTouched = read(join(run, EPIC_BT)) !== read(join(HERE, 'fixtures', process.env.TD_FIXTURE || 'TD-PATH', LAYOUT.seed, EPIC_BT));
  const strays = written.filter((r) => !posix(r).startsWith(posix(join(...EPIC_DIR)) + '/'));

  return {
    'TD.1 индекс лежит в папке эпика': decomp.length > 0,
    [`TD.2 все ${KIDS.length} детей записаны ПО ВЕРНОМУ пути`]: ok.size === KIDS.length,
    'TD.3 ни одного файла мимо папки эпика': strays.length === 0,
    'TD.4 ключ ребёнка папкой, а не в имени файла': !placed.some((x) => x.verdict === 'flat'),
    ...(MODE === 'alias' ? {} : { 'TD.5 корневая coddoc/ не тронута': !placed.some((x) => x.verdict === 'root-docs') }),
    'TD.6 FR разложены как в §4.5': frWrong.length === 0,
    'TD.7 эпик-БТ не переписан': !epicTouched,
    _detail: bad.length
      ? bad.map((x) => `${x.kid}:${x.verdict}`).join(',') + ` | ${strays.map(posix).slice(0, 3).join(' ')}`
      : `все на месте${frWrong.length ? ' | FR не у того: ' + frWrong : ''}`,
  };
}

function checkGate(run) {
  const written = walk(run).map((p) => relative(run, p)).filter((r) => !SEEDED.has(r) && !HARNESS(r));
  const ans = read(join(run, 'answer.md'));
  const asksPath = /путь к|дай путь|укажи путь|назови путь|пришли путь|записать файлом|сохрани.{0,25}файл|запиш.{0,25}файл/i.test(ans);
  const namesSkill = /business-requirements-doc/i.test(ans);
  return {
    'TG.1 ни одного файла не записано': written.length === 0,
    'TG.2 в ответе спрошен путь / запись файлом': asksPath,
    'TG.3 назван business-requirements-doc': namesSkill,
    _detail: written.length ? 'записал: ' + written.map(posix).slice(0, 3).join(' ') : 'файлов нет',
  };
}

const runs = runsOf(runsDir);
if (!runs.length) { console.error('прогонов нет'); process.exit(1); }
const totals = new Map();
let whole = 0;
// Законный третий исход раскладки `alias`: ключ эпика `T-T-M-1.2` не матчит regex гейта, и
// скилл вправе ОТКАЗАТЬСЯ. Отказ — не промах пути: сложенный со счётчиками «дети на месте», он
// читался бы как уронивший разрез. Поэтому отдельная строка и свой знаменатель.
const refused = [];
const isRefusal = (run) => {
  const wrote = walk(run).map((x) => relative(run, x)).filter((r) => !SEEDED.has(r) && !HARNESS(r));
  if (wrote.length) return false;
  return /ключ|regex|формат/i.test(read(join(run, "answer.md")));
};
const ARM = { gate: 'плечо td-gate', alias: 'плечо td-alias — эпик T-T-M-1.2', write: 'плечо td-path-w' }[MODE];
console.log(`=== TD-PATH (${ARM}) — ${runs.length} прогонов ===`);
for (const r of runs) {
  if (MODE === 'alias' && isRefusal(r)) {
    refused.push(r);
    console.log(`${r.split(/[\/]/).pop()}: ОТКАЗ по гейту ключа — файлов нет (считается отдельно)`);
    continue;
  }
  const res = MODE === 'gate' ? checkGate(r) : checkWrite(r);
  const d = res._detail; delete res._detail;
  const bad = Object.entries(res).filter(([, v]) => !v).map(([k]) => k);
  for (const [k, v] of Object.entries(res)) totals.set(k, (totals.get(k) || 0) + (v ? 1 : 0));
  if (!bad.length) whole++;
  console.log(`${r.split(/[\/]/).pop()}: ${bad.length ? 'FAIL — ' + bad.join('; ') : 'PASS'}  [${d}]`);
}
console.log('\n--- по пунктам ---');
const scored = runs.length - refused.length;
for (const [k, v] of totals) console.log(`${v}/${scored}  ${k}`);
if (refused.length) console.log(`
ОТКАЗ по гейту ключа: ${refused.length}/${runs.length} — эти прогоны в счётчиках выше НЕ участвуют.`);
console.log(`\nПРОБА ЦЕЛИКОМ: ${whole}/${scored}`);
