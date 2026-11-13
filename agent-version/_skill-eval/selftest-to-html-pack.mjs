// Самотест упаковщика to-html: pack.sh и pack.ps1 против независимого оракула.
//
// Оракул здесь же, на node: по тем же правилам (что входит в набор, какой файл открыть, куда писать)
// считает ожидаемое и сверяет с тем, что записали скрипты, — файл за файлом, байт в байт после base64.
// Скрипты гоняются с --no-open в песочнице selftest/to-html/ (в .gitignore). Выход — в .coddoc-tmp/to-html/
// корня репозитория: fx/ — свой репозиторий (git init), plain/ и prune/ — вне репозитория; GIT_CEILING_DIRECTORIES
// не даёт git подняться из песочницы в репозиторий скиллов.
//
// Исполнители: sh — всегда; на Windows ещё ps (обычный режим) и ps-clm — ограниченный режим языка,
// как на корпоративных машинах (только командлеты): его включает обёртка clm-run.ps1.
//
// Запуск: node agent-version/_skill-eval/selftest-to-html-pack.mjs [sh|ps|ps-clm ...]

import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, existsSync, utimesSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { makeFixtures } from './to-html-fixtures.mjs';

const here = dirname(fileURLToPath(import.meta.url));
// TO_HTML_REF — подсунуть испорченную копию reference/ и убедиться, что самотест её ловит.
const ref = process.env.TO_HTML_REF || resolve(here, '..', 'to-html', 'reference');
const box = join(here, 'selftest', 'to-html');
const win = process.platform === 'win32';

const MAX_FILES = 2000;
const MAX_TEXT = 5 * 1024 * 1024;
const MAX_IMG = 15 * 1024 * 1024;
const TEXT = /\.(md|markdown|txt|puml|plantuml|mmd|ya?ml|json)$/i;
const IMG = /\.(png|jpe?g|gif|webp|svg)$/i;

let failures = 0;
const check = (ok, what) => {
  if (!ok) { failures++; console.log('  ✗ ' + what); }
  return ok;
};

// ---------------------------------------------------------------- оракул

const skip = (name) => name.startsWith('.') || name === 'node_modules';

function walk(root, depth = -1, prefix = '', out = []) {
  for (const e of readdirSync(join(root, prefix), { withFileTypes: true })) {
    if (skip(e.name)) continue;
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) { if (depth !== 0) walk(root, depth - 1, rel, out); }
    else out.push(rel);
  }
  return out;
}

function normRel(p) {
  const out = [];
  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') { if (!out.length) return ''; out.pop(); continue; }
    out.push(part);
  }
  return out.join('/');
}

function links(root, rel) {
  const text = readFileSync(join(root, rel), 'utf8');
  const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
  const found = [];
  for (const m of text.matchAll(/\]\(<([^>]+)>|\]\(([^) ]+)/g)) {
    let t = m[1] ?? m[2];
    if (/^(https?:|mailto:|#|\/)/.test(t)) continue;
    t = decodeURIComponent(t.split('#')[0].split('?')[0]);
    const n = normRel(dir ? `${dir}/${t}` : t);
    if (n && existsSync(join(root, n)) && statSync(join(root, n)).isFile()) found.push(n);
  }
  for (const m of text.matchAll(/\[\[([^\]|#]+)/g)) {
    const name = m[1];
    const near = [name, `${name}.md`].map((c) => (dir ? `${dir}/${c}` : c)).find((c) => existsSync(join(root, c)));
    const any = near ?? walk(root, 2).find((f) => [name, `${name}.md`].includes(f.split('/').pop()));
    if (any) found.push(any);
  }
  return found;
}

// Корень репозитория, как его найдёт git: ближайшая вверх папка с .git, не выше песочницы; нет — текущая.
function topOf(cwd) {
  for (let d = cwd; d.startsWith(box + sep); d = dirname(d)) if (existsSync(join(d, '.git'))) return d;
  return cwd;
}

function expected(cwd, args) {
  const top = topOf(cwd);
  const abs = args.map((a) => resolve(cwd, a));
  if (abs.some((a) => !existsSync(a))) return { error: 'not-found' };
  let mode = 'blank', root = '', open = '', list = [];
  if (abs.length === 1 && statSync(abs[0]).isDirectory()) {
    mode = 'dir'; root = abs[0]; list = walk(root);
  } else if (abs.length === 1) {
    mode = 'file'; root = dirname(abs[0]); open = abs[0].slice(root.length + 1); list = walk(root, 2);
    if (list.length > MAX_FILES) {
      mode = 'links'; list = [open];
      let frontier = [open];
      for (let step = 0; step < 2; step++) {
        const next = [];
        for (const f of frontier) if (TEXT.test(f)) for (const l of links(root, f)) if (!list.includes(l) && !next.includes(l)) next.push(l);
        list.push(...next);
        frontier = next;
      }
    }
  } else if (abs.length > 1) {
    mode = 'list';
    const dirs = abs.map((a) => (statSync(a).isDirectory() ? a : dirname(a)));
    root = dirs.reduce((c, d) => { while (!(d + sep).startsWith(c + sep)) c = dirname(c); return c; });
    for (const a of abs) {
      const rel = relative(root, a).split(sep).join('/');
      if (statSync(a).isDirectory()) list.push(...walk(root, -1, rel));
      else { list.push(rel); open ||= rel; }
    }
  }
  list = [...new Set(list)].sort();
  if (list.length > MAX_FILES) return { error: 'too-many' };
  if ((mode === 'dir' || mode === 'list') && !list.some((f) => TEXT.test(f))) return { error: 'no-text' };
  if (mode === 'dir' && !open) {
    open = list.find((f) => f.toLowerCase() === 'readme.md') ?? list.find((f) => f.toLowerCase() === 'index.md') ?? '';
    if (!open) {
      let best = -1;
      for (const f of list) {
        if (f.includes('/') || !/\.(md|markdown)$/i.test(f)) continue;
        const s = statSync(join(root, f)).size;
        if (s > best) { best = s; open = f; }
      }
    }
  }
  let label = '', base = '', slug = '_blank';
  if (mode !== 'blank') {
    if (root === top) { label = '.'; base = '../../../'; slug = top.split(sep).pop(); }
    else if (root.startsWith(top + sep)) {
      label = relative(top, root).split(sep).join('/'); base = `../../../${label}/`; slug = label.split('/').join('--');
    } else {
      label = root.split(sep).join('/'); base = `file://${win ? '/' : ''}${label}/`; slug = null; // хеш у скриптов свой
    }
  }
  if (slug) slug = slug.replace(/[:*?"<>|\\]/g, '_');
  return { mode, root, open, list, label, base, slug, top };
}

// ---------------------------------------------------------------- исполнители

const engines = {
  sh: (cwd, args) => ['bash', [join(ref, 'pack.sh').split(sep).join('/'), '--no-open', ...args]],
  ps: (cwd, args) => ['powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(ref, 'pack.ps1'), '-NoOpen', ...args]],
  'ps-clm': (cwd, args) => ['powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(box, 'clm-run.ps1'),
    join(ref, 'pack.ps1'), '-NoOpen', ...args]],
};

function run(engine, cwd, args) {
  const [cmd, argv] = engines[engine](cwd, args);
  let out = '', code = 0;
  const t0 = Date.now();
  const env = { ...process.env, GIT_CEILING_DIRECTORIES: box };
  try { out = execFileSync(cmd, argv, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8'); }
  catch (e) { out = (e.stdout || '').toString('utf8') + (e.stderr || '').toString('utf8'); code = e.status ?? 1; }
  const last = out.trim().split(/\r?\n/).pop() || '';
  return { out, code, last, ms: Date.now() - t0 };
}

function loadJs(path, name) {
  const code = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
  const window = {};
  runInNewContext(code, { window });
  return window[name];
}

// ---------------------------------------------------------------- случаи

const cases = [
  { name: 'папка документации', cwd: '.', args: ['TH-DOCS'] },
  { name: 'папка заметок', cwd: '.', args: ['TH-VAULT'] },
  { name: 'один файл ноута', cwd: '.', args: ['TH-NB/notes/выдача-лодок/notebook.md'] },
  { name: 'файл + папка', cwd: '.', args: ['TH-DOCS/README.md', 'TH-DOCS/процессы'] },
  { name: 'краевые байты', cwd: '.', args: ['TH-EDGE'] },
  { name: 'файл в огромной папке → его ссылки', cwd: '.', args: ['TH-ONE/проект/заметка.md'] },
  { name: 'запуск из подпапки репозитория', cwd: 'TH-DOCS', args: ['.'] },
  { name: 'корень в соседней папке репозитория', cwd: 'TH-NB', args: ['../TH-VAULT'] },
  { name: 'корень вне репозитория', cwd: '.', args: ['../plain'] },
  { name: 'вне репозитория: корень = текущая папка', cwd: '../plain', args: ['.'] },
  { name: 'без путей — пустая страница', cwd: '.', args: [] },
  { name: 'папка больше предела', cwd: '.', args: ['TH-ONE/проект'], error: 'too-many' },
  { name: 'нет пути', cwd: '.', args: ['нет-такого'], error: 'not-found' },
  { name: 'папка без текста', cwd: '.', args: ['TH-IMG'], error: 'no-text' },
];

function verify(engine, c) {
  const cwd = resolve(box, 'fx', c.cwd);
  const exp = expected(cwd, c.args);
  const r = run(engine, cwd, c.args);
  console.log(`[${engine}] ${c.name} — ${r.ms} мс`);
  if (c.error || exp.error) {
    check(exp.error === c.error, `оракул ждёт ${exp.error}, случай — ${c.error}`);
    check(r.last === `to-html: error ${c.error}`, `ждали «to-html: error ${c.error}», последняя строка: ${r.last}`);
    check(r.code !== 0, 'код выхода при ошибке — не 0');
    return;
  }
  if (!check(r.code === 0 && /^to-html: updated files=\d+ text=\d+ img=\d+ other=\d+ page=file:\/\/\/?\S+$/.test(r.last),
    `последняя строка: ${r.last}\n${r.out}`)) return;
  check(/^[\x20-\x7e]+$/.test(r.last), 'последняя строка — только ASCII');
  const nums = Object.fromEntries([...r.last.matchAll(/(\w+)=(\d+)/g)].map((m) => [m[1], +m[2]]));
  check(nums.files === exp.list.length, `files=${nums.files}, ждали ${exp.list.length}`);
  check(nums.text === exp.list.filter((f) => TEXT.test(f)).length, `text=${nums.text}`);
  check(nums.img === exp.list.filter((f) => IMG.test(f)).length, `img=${nums.img}`);

  const page = fileURLToPath(r.last.split(' page=')[1]);
  const out = dirname(page);
  const work = join(exp.top, '.coddoc-tmp', 'to-html');
  if (exp.slug) check(out === join(work, exp.slug), `папка выхода ${out}, ждали ${join(work, exp.slug)}`);
  else check(dirname(out) === work, `папка выхода ${out}, ждали внутри ${work}`);
  check(readFileSync(join(exp.top, '.coddoc-tmp', '.gitignore'), 'utf8').trim() === '*', '.coddoc-tmp/.gitignore = «*»');
  if (cwd !== exp.top) check(!existsSync(join(cwd, '.coddoc-tmp')), 'в подпапке своей .coddoc-tmp нет');
  check(!readdirSync(work).some((n) => n.startsWith('list.') || n.endsWith('.xml')), 'временные файлы скрипта убраны');
  const html = readFileSync(page, 'utf8');
  check(!html.includes('__MADE__') && /data\.js\?v=\d{14}/.test(html), 'метка снимка в index.html');

  const d = loadJs(join(out, 'data.js'), 'MDV_DATA');
  check(d && d.v === 1 && /^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(d.made), 'data.js: v и made');
  check(d.root === exp.label, `root «${d.root}», ждали «${exp.label}»`);
  check(d.base === exp.base, `base «${d.base}», ждали «${exp.base}»`);
  if (d.base && !d.base.startsWith('file:')) check(resolve(out, d.base) === exp.root, `base от страницы ведёт в ${resolve(out, d.base)}, ждали ${exp.root}`);
  check(d.open === exp.open, `open «${d.open}», ждали «${exp.open}»`);
  const got = d.files.map((f) => f[0]).sort();
  if (!check(JSON.stringify(got) === JSON.stringify(exp.list), 'набор файлов')) {
    console.log('    лишние: ' + got.filter((f) => !exp.list.includes(f)).join(', '));
    console.log('    нет:    ' + exp.list.filter((f) => !got.includes(f)).join(', '));
  }
  for (const [path, size, content] of d.files) {
    if (!exp.list.includes(path)) continue;
    const disk = readFileSync(join(exp.root, path));
    check(size === disk.length, `${path}: размер ${size}, на диске ${disk.length}`);
    const wantText = TEXT.test(path) && disk.length <= MAX_TEXT;
    if (!wantText) { check(content === null, `${path}: содержимого быть не должно`); continue; }
    check(typeof content === 'string' && Buffer.from(content, 'base64').equals(disk), `${path}: байты после base64`);
  }
  const a = loadJs(join(out, 'assets.js'), 'MDV_ASSETS') || [];
  const wantImg = exp.list.filter((f) => IMG.test(f) && statSync(join(exp.root, f)).size <= MAX_IMG).sort();
  check(JSON.stringify(a.map((x) => x[0]).sort()) === JSON.stringify(wantImg), 'assets.js: набор картинок');
  for (const [path, mime, b64] of a) {
    check(/^image\//.test(mime), `${path}: mime ${mime}`);
    check(Buffer.from(b64, 'base64').equals(readFileSync(join(exp.root, path))), `${path}: байты картинки`);
  }
  return { out, cwd, args: c.args };
}

// Повторный вызов: тот же выход, assets.js не пересобирается, пока картинки не поменялись.
function verifyRepeat(engine) {
  const cwd = resolve(box, 'fx');
  console.log(`[${engine}] повторный вызов`);
  const img = join(cwd, 'TH-DOCS', 'img', 'стенд.png');
  const older = new Date(Date.now() - 120_000);
  for (const f of ['img/стенд.png', 'img/схема.svg']) utimesSync(join(cwd, 'TH-DOCS', f), older, older);
  run(engine, cwd, ['TH-DOCS']);
  const assets = join(cwd, '.coddoc-tmp', 'to-html', 'TH-DOCS', 'assets.js');
  const old = new Date(Date.now() - 60_000);
  utimesSync(assets, old, old);
  const r1 = run(engine, cwd, ['TH-DOCS']);
  check(r1.code === 0, 'второй вызов прошёл');
  check(Math.abs(statSync(assets).mtimeMs - old.getTime()) < 2000, 'assets.js не пересобран без изменений');
  const now = new Date();
  utimesSync(img, now, now);
  run(engine, cwd, ['TH-DOCS']);
  check(statSync(assets).mtimeMs > old.getTime() + 30_000, 'assets.js пересобран после правки картинки');
}

// Чистка: в .coddoc-tmp/to-html остаются 10 последних наборов, текущий среди них, набор с точкой в имени тоже
// считается; .gitignore и папки других скиллов в .coddoc-tmp не тронуты.
function verifyPrune(engine) {
  const cwd = join(box, 'prune');
  const sets = join(cwd, '.coddoc-tmp', 'to-html');
  const other = join(cwd, '.coddoc-tmp', 'retro', 'x.journal.txt');
  mkdirSync(dirname(other), { recursive: true });
  writeFileSync(other, '');
  utimesSync(dirname(other), new Date(0), new Date(0));
  const old = (i) => `${i === 1 ? '.' : ''}old-${String(i).padStart(2, '0')}`;
  for (let i = 1; i <= 12; i++) {
    mkdirSync(join(sets, old(i)), { recursive: true });
    writeFileSync(join(sets, old(i), 'data.js'), '');
    const t = new Date(Date.now() - (13 - i) * 60_000);
    utimesSync(join(sets, old(i)), t, t);
  }
  console.log(`[${engine}] чистка старых наборов`);
  const r = run(engine, cwd, ['../fx/TH-DOCS']);
  if (!check(r.code === 0, `вызов прошёл: ${r.last}`)) return;
  const cur = dirname(fileURLToPath(r.last.split(' page=')[1])).split(sep).pop();
  const left = readdirSync(sets, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  const want = [cur, ...[4, 5, 6, 7, 8, 9, 10, 11, 12].map(old)].sort();
  check(JSON.stringify(left) === JSON.stringify(want), `осталось ${left.join(', ')}, ждали ${want.join(', ')}`);
  check(existsSync(join(cwd, '.coddoc-tmp', '.gitignore')), '.gitignore не удалён');
  check(existsSync(other), 'папка другого скилла не тронута');
}

// ---------------------------------------------------------------- запуск

const wanted = process.argv.slice(2);
const list = wanted.length ? wanted : win ? ['sh', 'ps', 'ps-clm'] : ['sh'];

check(readFileSync(join(ref, 'pack.ps1')).subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])),
  'pack.ps1 хранится в UTF-8 с BOM');

for (const engine of list) {
  rmSync(box, { recursive: true, force: true });
  mkdirSync(join(box, 'fx'), { recursive: true });
  makeFixtures(join(box, 'fx'));
  execFileSync('git', ['init', '-q'], { cwd: join(box, 'fx') });
  mkdirSync(join(box, 'plain'));
  writeFileSync(join(box, 'plain', 'README.md'), '# Вне репозитория\n');
  writeFileSync(join(box, 'clm-run.ps1'), '\uFEFF# Запускает скрипт в ограниченном режиме языка, как на корпоративной машине.\n' +
    '$script = $args[0]\n$rest = @($args | Select-Object -Skip 1)\n' +
    "$ExecutionContext.SessionState.LanguageMode = 'ConstrainedLanguage'\n& $script @rest\nexit $LASTEXITCODE\n");
  for (const c of cases) verify(engine, c);
  verifyRepeat(engine);
  verifyPrune(engine);
}

console.log(failures ? `\nпровалов: ${failures}` : '\nвсё сошлось');
process.exit(failures ? 1 : 0);
