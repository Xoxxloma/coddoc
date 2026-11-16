// Самотест services-graph: разбор карточек (viewer/parse.js) и упаковщики pack.sh / pack.ps1.
//
// Часть 1 — разбор: фикстуры ID-DIAG и SM-EDGES (карточки v1, обе формы «Событий») и точечные случаи на месте.
// Часть 2 — упаковщики: песочница selftest/services-graph/ (в .gitignore); что попало в data.js, байт в байт после base64,
// подпись, сервис в фокусе, ошибки, запуск из подпапки и вне репозитория, путь с кириллицей и пробелом.
//
// Исполнители: sh — всегда; на Windows ещё ps (обычный режим) и ps-clm — ограниченный режим языка, как на
// корпоративных машинах (обёртка clm-run.ps1, та же, что у to-html).
//
// Запуск: node agent-version/_skill-eval/selftest-services-graph.mjs [parse] [sh|ps|ps-clm ...]
//   без аргументов — разбор и все исполнители этой ОС.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const ref = process.env.SERVICES_GRAPH_REF || resolve(here, '..', 'services-graph', 'reference');
const box = join(here, 'selftest', 'services-graph');
const win = process.platform === 'win32';
const P = createRequire(import.meta.url)(join(ref, 'viewer', 'parse.js'));

let failures = 0;
const check = (ok, what) => {
  if (!ok) { failures++; console.log('  ✗ ' + what); }
  return ok;
};
const eq = (a, b, what) => check(JSON.stringify(a) === JSON.stringify(b), `${what}: ждали ${JSON.stringify(b)}, вышло ${JSON.stringify(a)}`);

function readSnapshot(dir) {
  const files = [];
  for (const f of readdirSync(dir).sort()) {
    const p = join(dir, f);
    if (/\.(md|ya?ml)$/i.test(f)) files.push([f, readFileSync(p, 'utf8')]);
  }
  if (existsSync(join(dir, '_history'))) for (const f of readdirSync(join(dir, '_history')).sort()) files.push(['_history/' + f, readFileSync(join(dir, '_history', f), 'utf8')]);
  return files;
}
const edgeKeys = g => g.edges.map(e => `${e.kind} ${e.source}>${e.target} ${e.items.length}${e.topics.length ? ' ' + e.topics.join(',') : ''}`).sort();
const issueKeys = g => g.issues.map(i => `${i.kind} ${i.service}${i.from ? ' <' + i.from : ''}`).sort();

// ---------------------------------------------------------------- часть 1: разбор

function testParse() {
  console.log('разбор');
  const fx = join(here, 'fixtures');

  // ID-DIAG: события блоками, внешняя система без бэктиков, зеркала все с парой.
  let g = P.build(readSnapshot(join(fx, 'ID-DIAG', 'services')));
  eq(edgeKeys(g), [
    'call dispatch-api>objects-registry 1',
    'call dispatch-web>dispatch-api 6',
    'call notify>ext:SMS-шлюз оператора 1',
    'call notify>objects-registry 1',
    'event dispatch-api>notify 0 incident.created',
  ], 'ID-DIAG рёбра');
  eq(issueKeys(g), [], 'ID-DIAG расхождения');
  eq(g.topics.filter(t => !t.pub.length || !t.sub.length).map(t => t.topic), ['incident.closed', 'objects.guard-mode.changed'], 'ID-DIAG топики без пары');
  eq(g.nodes.find(n => n.id === 'dispatch-api').counts, { endpoints: 5, api: null, events: 1, jobs: 1, entities: 3, screens: null, roles: 2 }, 'ID-DIAG счётчики dispatch-api');

  // SM-EDGES: события таблицей, карточка вне манифеста, 15 зеркал без пары, «вне манифеста» в «Потребляемых API».
  g = P.build(readSnapshot(join(fx, 'SM-EDGES', 'tree', 'services')));
  const calls = edgeKeys(g).filter(k => k.startsWith('call'));
  eq(calls, [
    'call geo>auth 2', 'call incident-api>auth 1', 'call incident-api>geo 1', 'call incident-web>auth 1',
    'call incident-web>ext:API-шлюз 1', 'call incident-web>geo 1', 'call incident-web>incident-api 1', 'call legacy-reports>auth 1',
  ], 'SM-EDGES вызовы');
  check(edgeKeys(g).filter(k => k.startsWith('mirror')).length === 15, 'SM-EDGES: 15 зеркал без пары');
  check(issueKeys(g).filter(k => k.startsWith('one-sided')).length === 15, 'SM-EDGES: 15 расхождений one-sided');
  check(issueKeys(g).includes('not-in-manifest legacy-reports'), 'SM-EDGES: legacy-reports вне манифеста');
  check(g.nodes.filter(n => n.mirrorOnly).length === 15, 'SM-EDGES: узлы stale-* только по флажку');
  eq(g.topics.map(t => t.topic), ['auth.session.revoked', 'incident.created'], 'SM-EDGES топики из таблицы');

  // Точечные случаи.
  const card = (name, type, body, fm = true) => [`${name}.md`, (fm ? `---\nservice: ${name}\ntype: ${type}\ndescription: ${name}\n---\n` : '') + `# ${name} — ${type}\n\n${body}\n`];
  g = P.build([
    ['manifest.yaml', 'services:\n  - name: Auth   # канонический\n    path: ../auth\n    type: backend\n    notes: |\n      Строка с # внутри.\n\n      Вторая после пустой.\n  - name: web\n    path: ../web\n    type: frontend\n  - name: ghost\n    path: ../ghost\n    type: backend\n'],
    card('Auth', 'backend', '## Зависит от\n| Сервис или система | Зачем |\n|---|---|\n| не определено: роли раздаёт шлюз | |\n| `Каталог ИБ` | проверка прав; вне манифеста |\n\n## События\n| Направление | Топик | Когда |\n|---|---|---|\n| публикует | `a.b` | всегда |\n\n## Кто меня потребляет\n| Сервис | Что вызывает | Зачем |\n|---|---|---|\n| `web` | `GET /a\\|b` | вызов с чертой |\n| `api` | — | только из «Зависит от» |'),
    card('web', 'frontend', '## Потребляемые API\n| Сервис | Вызов | Зачем |\n|---|---|---|\n| `auth` | `GET /a\\|b` | вызов с чертой |\n\n```md\n## Зависит от\n| `fake` | в блоке кода |\n```\n', false),
    card('api', 'backend', '## Зависит от\n| Сервис или система | Зачем |\n|---|---|\n| `Auth` | сессии |\n\n## События\n\n### потребляет `a.b`\nтекст'),
    card('api', 'backend', '## Назначение\nвторая карточка того же сервиса'),
  ].map(([f, t], i) => [i === 4 ? 'api-copy.md' : f, t]));
  const ids = g.nodes.map(n => n.id).sort();
  eq(ids, ['Auth', 'api', 'ext:Каталог ИБ', 'ghost', 'web'], 'точечные: узлы');
  eq(g.nodes.find(n => n.id === 'Auth').notes, 'Строка с # внутри.\n\nВторая после пустой.', 'точечные: notes блоком');
  eq(g.nodes.find(n => n.id === 'web').type, 'frontend', 'точечные: тип из заголовка без шапки');
  eq(edgeKeys(g), ['call Auth>ext:Каталог ИБ 1', 'call api>Auth 1', 'call web>Auth 1', 'event Auth>api 0 a.b'], 'точечные: рёбра (регистр имени, черта в ячейке, блок кода не секция)');
  eq(g.edges.find(e => e.id === 'call:web->Auth').items[0].call, 'GET /a|b', 'точечные: экранированная черта');
  eq(issueKeys(g), ['duplicate-card api', 'no-card ghost', 'not-in-manifest api'], 'точечные: расхождения');
  check(g.nodes.find(n => n.id === 'ext:Каталог ИБ').outsideMarked === true, 'точечные: пометка «вне манифеста»');

  // Без манифеста: карточки — узлы, «нет в манифесте» не пишется.
  g = P.build([card('a', 'backend', '## Зависит от\n| С | З |\n|---|---|\n| `b` | x |'), card('b', 'lib', '')]);
  eq(issueKeys(g), [], 'без манифеста: расхождений нет');
  eq(edgeKeys(g), ['call a>b 1'], 'без манифеста: ребро');
}

// ---------------------------------------------------------------- часть 2: упаковщики

const engines = {
  sh: args => ['bash', [join(ref, 'pack.sh').split(sep).join('/'), '--no-open', ...args]],
  ps: args => ['powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(ref, 'pack.ps1'), '-NoOpen', ...args]],
  'ps-clm': args => ['powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(box, 'clm-run.ps1'), join(ref, 'pack.ps1'), '-NoOpen', ...args]],
};

function run(engine, cwd, args) {
  const [cmd, argv] = engines[engine](args);
  let out = '', code = 0;
  const env = { ...process.env, GIT_CEILING_DIRECTORIES: box, SERVICES_GRAPH_NO_OPEN: '1' };
  try { out = execFileSync(cmd, argv, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8'); }
  catch (e) { out = (e.stdout || '').toString('utf8') + (e.stderr || '').toString('utf8'); code = e.status ?? 1; }
  return { out, code, last: out.trim().split(/\r?\n/).pop() || '' };
}

function loadData(work) {
  const window = {};
  runInNewContext(readFileSync(join(work, 'data.js'), 'utf8').replace(/^﻿/, ''), { window });
  return window.SERVICES_GRAPH_DATA;
}

// Что должно попасть в набор: *.md и manifest.y(a)ml верхнего уровня, _history/*.md; остальное — нет.
function expected(dir) {
  const want = {};
  for (const f of readdirSync(dir)) {
    if (/\.md$/i.test(f) || /^manifest\.ya?ml$/i.test(f)) want[f] = readFileSync(join(dir, f));
  }
  if (existsSync(join(dir, '_history'))) for (const f of readdirSync(join(dir, '_history'))) if (/\.md$/i.test(f)) want['_history/' + f] = readFileSync(join(dir, '_history', f));
  return want;
}

function verifyOk(engine, what, r, work, snap, label, focus) {
  if (!check(r.code === 0 && /^services-graph: (ok|updated) /.test(r.last), `${engine} ${what}: ${r.last}\n${r.out}`)) return;
  const d = loadData(work);
  const want = expected(snap);
  const got = Object.fromEntries(d.files.map(([f, b]) => [f, b == null ? null : Buffer.from(b, 'base64')]));
  eq(Object.keys(got).sort(), Object.keys(want).sort(), `${engine} ${what}: состав набора`);
  for (const f of Object.keys(want)) if (got[f]) check(Buffer.compare(got[f], want[f]) === 0, `${engine} ${what}: ${f} байт в байт`);
  eq(d.root, label, `${engine} ${what}: подпись`);
  eq(d.focus, focus, `${engine} ${what}: сервис в фокусе`);
  const cards = Object.keys(want).filter(f => !f.includes('/') && f.endsWith('.md')).length;
  check(r.last.includes(` cards=${cards} `), `${engine} ${what}: cards=${cards} в строке ${r.last}`);
  // Адрес из последней строки — тот, что агент даёт человеку, если вкладка не открылась: ведёт на эту страницу.
  const url = (r.last.match(/ page=(\S+)$/) || [])[1] || '';
  let page = '';
  try { page = fileURLToPath(url); } catch (e) { page = 'битый адрес: ' + url; }
  eq(page, join(work, 'index.html'), `${engine} ${what}: page= ведёт на страницу`);
  const html = readFileSync(join(work, 'index.html'), 'utf8');
  check(!html.includes('__MADE__'), `${engine} ${what}: __MADE__ заменён`);
  for (const f of ['app.js', 'parse.js', 'vendor/cytoscape.min.js', 'vendor/markdown-it.min.js', 'vendor/purify.min.js']) check(existsSync(join(work, f)), `${engine} ${what}: есть ${f}`);
  // Конец в конец: страница разберёт то, что положил упаковщик.
  const g = P.build(d.files.map(([f, b]) => [f, b == null ? null : Buffer.from(b, 'base64').toString('utf8')]));
  check(g.cards === cards, `${engine} ${what}: страница видит ${cards} карточек, а не ${g.cards}`);
}

function verifyPack(engine) {
  console.log(engine);
  rmSync(box, { recursive: true, force: true });
  const repo = join(box, 'repo'), snap = join(repo, 'services');
  mkdirSync(join(snap, '_history'), { recursive: true });
  mkdirSync(join(snap, '_pending'), { recursive: true });
  cpSync(join(here, 'fixtures', 'ID-DIAG', 'services'), snap, { recursive: true });
  writeFileSync(join(snap, '_history', 'notify.md'), '2026-10-01 | DSP-1 | push по инциденту\n');
  writeFileSync(join(snap, '_pending', 'cand.md'), '# не берётся\n');
  writeFileSync(join(snap, 'notes.txt'), 'не берётся\n');
  mkdirSync(join(repo, 'coddoc'));
  mkdirSync(join(repo, 'context'));
  writeFileSync(join(repo, 'context', 'rules.txt'), 'папка без карточек\n');
  execFileSync('git', ['init', '-q'], { cwd: repo });
  writeFileSync(join(box, 'clm-run.ps1'), '﻿# Запускает скрипт в ограниченном режиме языка, как на корпоративной машине.\n' +
    '$script = $args[0]\n$rest = @($args | Select-Object -Skip 1)\n' +
    "$ExecutionContext.SessionState.LanguageMode = 'ConstrainedLanguage'\n& $script @rest\nexit $LASTEXITCODE\n");
  const work = join(repo, '.coddoc-tmp', 'services-graph');

  verifyOk(engine, 'без аргументов', run(engine, repo, []), work, snap, 'services', '');
  check(existsSync(join(repo, '.coddoc-tmp', '.gitignore')), `${engine}: .coddoc-tmp/.gitignore`);
  verifyOk(engine, 'сервис', run(engine, repo, ['notify']), work, snap, 'services', 'notify');
  verifyOk(engine, 'папка и сервис', run(engine, repo, ['services', 'dispatch-web']), work, snap, 'services', 'dispatch-web');
  verifyOk(engine, 'сервис как папка без карточек', run(engine, repo, ['context']), work, snap, 'services', 'context');
  verifyOk(engine, 'из подпапки', run(engine, join(repo, 'coddoc'), []), work, snap, 'services', '');

  const odd = join(repo, 'слепок сервисов');
  cpSync(snap, odd, { recursive: true });
  verifyOk(engine, 'кириллица и пробел', run(engine, repo, ['слепок сервисов/']), work, odd, 'слепок сервисов', '');

  const cyr = join(box, 'репо с пробелом');
  cpSync(snap, join(cyr, 'services'), { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: cyr });
  verifyOk(engine, 'репозиторий в папке с кириллицей', run(engine, cyr, []), join(cyr, '.coddoc-tmp', 'services-graph'), join(cyr, 'services'), 'services', '');

  const plain = join(box, 'plain');
  cpSync(snap, join(plain, 'services'), { recursive: true });
  verifyOk(engine, 'вне репозитория', run(engine, plain, []), join(plain, '.coddoc-tmp', 'services-graph'), join(plain, 'services'), 'services', '');

  let r = run(engine, join(box), []);
  check(r.code !== 0 && r.last === 'services-graph: error not-found', `${engine} нет services/: ${r.last}`);
  r = run(engine, repo, ['нет/такой']);
  check(r.code !== 0 && r.last === 'services-graph: error not-found', `${engine} путь, которого нет: ${r.last}`);
  const empty = join(box, 'empty');
  mkdirSync(join(empty, 'services'), { recursive: true });
  writeFileSync(join(empty, 'services', 'manifest.yaml'), 'services:\n');
  r = run(engine, empty, []);
  check(r.code !== 0 && r.last === 'services-graph: error no-cards', `${engine} нет карточек: ${r.last}`);
}

// ---------------------------------------------------------------- запуск
const argv = process.argv.slice(2);
const all = win ? ['sh', 'ps', 'ps-clm'] : ['sh'];
if (!argv.length || argv.includes('parse')) testParse();
for (const e of argv.length ? argv.filter(a => a !== 'parse') : all) verifyPack(e);
console.log(failures ? `\nпровалов: ${failures}` : '\nвсё сошлось');
process.exit(failures ? 1 : 0);
