// e2e своей раскладки «Обзора» (to-html): два БТ одного типа → pack.sh → Chrome/Edge по file:// → правка мышкой и
// кнопками, сохранение скачиванием и в папку (File System Access), чтение раскладки при следующей сборке.
//
// Запуск (из этой папки): node layout-e2e.mjs [chrome|msedge]
//   TO_HTML_REF=<папка> — подменная reference/ вместо agent-version/to-html/reference.
// Папку в диалоге выбора headless не выбрать: showDirectoryPicker подменяется папкой OPFS (настоящий
// FileSystemDirectoryHandle), всё остальное — как у человека.

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const ref = process.env.TO_HTML_REF ? resolve(process.env.TO_HTML_REF) : resolve(here, '..', '..', 'to-html', 'reference');
const box = resolve(here, '..', 'selftest', 'to-html-layout');
const channel = process.argv[2] || 'chrome';

let failures = 0;
const check = (ok, what) => { console.log(`  ${ok ? '✓' : '✗'} ${what}`); if (!ok) failures++; return ok; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------- набор: два БТ, разделы частично разные
// Ключ раздела — по правилу вида («^Введение» → «введение»); особые разделы — без номера, чтобы не попасть под правило по номеру.

const brd = (letter, extra) => `# Бизнес-требования: пропуск ${letter}

> **Задача:** T-${letter}
> **Статус:** Готово к оценке

## 1. Введение и контекст
### 1.1. Описание проблемы
Альфа — проблема.
### 1.4. Как сейчас
Бета — как сейчас.
${extra.intro || ''}
## 2. Бизнес-требования
### 2.1. Бизнес-цель
Гамма — цель.

## ${extra.sec}
${extra.text}

## 4. Функциональные требования
### 4.1. Описание функционала
**FR-1. Первое требование**
Эпсилон — текст требования.
### 4.2. Критерии приёмки
- **[FR-1]** Дано заявка, когда её открыли, тогда видно статус.
`;

rmSync(box, { recursive: true, force: true });
mkdirSync(join(box, 'A'), { recursive: true });
mkdirSync(join(box, 'B'), { recursive: true });
writeFileSync(join(box, 'A', 'business_requirements.md'), brd('A', { sec: 'Особый раздел А', text: 'Дельта — только в А.' }));
writeFileSync(join(box, 'B', 'business_requirements.md'), brd('B', { sec: 'Особый раздел Б', text: 'Зета — только в Б.',
  intro: '### 1.5. Новое в Б\nЭта — подраздел только в Б.\n' }));
const env = { ...process.env, GIT_CEILING_DIRECTORIES: dirname(box) };
execFileSync('git', ['init', '-q'], { cwd: box, env });
const lays = join(box, '.coddoc-tmp', 'to-html', 'layouts');
function pack() {
  const out = execFileSync('bash', [join(ref, 'pack.sh').split(sep).join('/'), '--no-open', box], { cwd: box, env }).toString('utf8');
  const last = out.trim().split(/\r?\n/).pop();
  if (!/^to-html: updated /.test(last)) throw new Error('pack: ' + out);
  return last.split(' page=')[1];
}
let url = pack();

console.log('Сборка');
check(existsSync(join(lays, 'to-html-layouts.txt')), 'папка раскладок с пометкой создана');
const layoutsJs = readFileSync(join(box, '.coddoc-tmp', 'to-html', 'to-html-layout', 'layouts.js'), 'utf8');
check(/window\.CODDOC_LAYOUT_DIR = ".*layouts";/.test(layoutsJs) && /window\.CODDOC_LAYOUTS = \{\s*\};/.test(layoutsJs), 'layouts.js: путь к папке, раскладок нет');

// ---------------------------------------------------------------- браузер

const browser = await chromium.launch({ channel, headless: true });
let ctx, page, errors, warnings;
async function fresh(init) {
  // Прежний контекст не закрываем: playwright-core 1.49 с Edge роняет процесс на закрытии (TargetClosedError).
  ctx = await browser.newContext({ viewport: { width: 1440, height: 1500 }, acceptDownloads: true });
  await ctx.addInitScript(() => { try { sessionStorage.setItem('cv:mode', 'overview'); } catch (e) { /* about:blank */ } });
  if (init) await ctx.addInitScript(init);
  page = await ctx.newPage();
  errors = []; warnings = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); if (m.type() === 'warning') warnings.push(m.text()); });
}
const open = async (doc) => {
  await page.goto('about:blank');
  await page.goto(url + '#f=' + encodeURIComponent(doc + '/business_requirements.md'));
  await page.waitForSelector('#doc .cv > .cvg');
};
// Ключи блоков: на сетке (в правке — и скрытые) и в полосе «Скрыто».
const keys = () => page.$$eval('#doc .cv > .cvg > .cvg-i', (els) => els.map((e) => e.getAttribute('data-k')));
const hiddenKeys = () => page.$$eval('#doc .cvg-hidden .cvg-i', (els) => els.map((e) => e.getAttribute('data-k')));
const widths = () => page.$$eval('#doc .cv > .cvg > .cvg-i', (els) => Object.fromEntries(els.map((e) => [e.getAttribute('data-k'), e.style.getPropertyValue('--w')])));
const tile = (k) => page.locator(`#doc .cvg-i[data-k="${k}"]`);
const btn = (k, a) => tile(k).locator(`.cvg-bar button[data-a="${a}"]`).click();
const toc = () => page.locator('#toc a').allInnerTexts();
const noFsApi = () => { window.showDirectoryPicker = undefined; };
async function saveDownload() {
  const [d] = await Promise.all([page.waitForEvent('download'), page.click('.cvg-tools [data-a="save"]')]);
  const p = join(box, 'dl-' + d.suggestedFilename());
  await d.saveAs(p);
  await page.waitForSelector('.cvg-note');
  return { name: d.suggestedFilename(), json: JSON.parse(readFileSync(p, 'utf8')), path: p };
}

const DOC_A = [':hero', 'введение', 'введение/описание проблемы', 'введение/как сейчас',
  'бизнес-требования', 'бизнес-требования/бизнес-цель', 'особый раздел а', 'функциональные требования'];

// ---------------------------------------------------------------- без раскладки

console.log('Обзор без раскладки');
await fresh(noFsApi);
await open('A');
check(eq(await keys(), DOC_A), `блоки — в порядке документа: ${(await keys()).join(' | ')}`);
const w0 = await widths();
check(w0['введение/описание проблемы'] === '6' && w0['введение/как сейчас'] === '6' && w0['функциональные требования'] === '12',
  'ширина по описанию вида: ряд из двух — по 6, раздел — 12');
check(await page.locator('[data-cvg-edit]').count() === 1, 'кнопка «Редактировать форму» над обзором');
check(await page.$eval('#doc .cv > .cvg', (g) => g.getAttribute('data-view')) === 'brd', 'сетка знает вид: brd');

// ---------------------------------------------------------------- правка

console.log('Правка');
await page.click('[data-cvg-edit]');
check(await page.locator('.cvg-tools').count() === 1, 'панель правки появилась');
check(await page.locator('#doc .cvg-bar').count() === DOC_A.length, 'у каждого блока — полоса с кнопками');
await btn('особый раздел а', 'hide');
check(await tile('особый раздел а').evaluate((e) => e.classList.contains('cvg-off')), '«Скрыть» — блок помечен скрытым и остаётся на сетке');
await btn('введение/как сейчас', 'prev');
for (let i = 0; i < 6; i++) await btn('бизнес-требования/бизнес-цель', 'narrow');
check((await widths())['бизнес-требования/бизнес-цель'] === '6', '«Уже» ×6 — ширина 6/12');
check(await tile('бизнес-требования/бизнес-цель').locator('.cvg-w').innerText() === '6/12', 'подпись ширины 6/12');

// Мышью: «Функциональные требования» — на верхнюю половину «Введения» (блок во всю ширину → перед ним).
{
  const a = await tile('функциональные требования').locator('.cvg-t').boundingBox();
  await tile('введение').scrollIntoViewIfNeeded();
  const b0 = await tile('введение').boundingBox();
  await page.mouse.move(a.x + 10, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b0.x + b0.width / 2, b0.y + 8, { steps: 12 });
  await page.mouse.up();
}
const afterDrag = await keys();
check(afterDrag.indexOf('функциональные требования') === afterDrag.indexOf('введение') - 1, `перетаскивание: требования встали перед введением (${afterDrag.join(' | ')})`);
// Ширина — за правый край: шапку до середины сетки.
{
  await tile(':hero').scrollIntoViewIfNeeded();
  const h = await tile(':hero').locator('.cvg-rs').boundingBox();
  const g = await page.$eval('#doc .cv > .cvg', (el) => { const r = el.getBoundingClientRect(); return { x: r.left, w: el.clientWidth, gap: parseFloat(getComputedStyle(el).columnGap) }; });
  const col = (g.w - g.gap * 11) / 12;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + 6 * col + 5 * g.gap + 3, h.y + h.height / 2, { steps: 10 });
  await page.mouse.up();
}
check((await widths())[':hero'] === '6', `ширина мышью: шапка — 6/12 (${(await widths())[':hero']})`);
const order1 = await keys();

console.log('Сохранить — скачиванием (браузер без выбора папки)');
const s1 = await saveDownload();
check(s1.name === 'brd.json', 'скачан brd.json');
check(s1.json.format === 1 && s1.json.view === 'brd' && eq(s1.json.items.map((x) => x.k), order1), 'в файле — вид, формат и порядок блоков');
const byK = Object.fromEntries(s1.json.items.map((x) => [x.k, x]));
check(byK['особый раздел а'].hide === true && byK[':hero'].w === 6 && byK['бизнес-требования/бизнес-цель'].w === 6 && !('hide' in byK[':hero']), 'в файле — скрытый блок и ширина');
check(eq(await keys(), order1.filter((k) => k !== 'особый раздел а')), 'обзор — по новой раскладке');
check(eq(await hiddenKeys(), ['особый раздел а']), 'скрытый блок — в полосе «Скрыто»');
check(/Скрыто в раскладке: 1/.test(await page.locator('.cvg-hidden summary').innerText()), 'подпись полосы: «Скрыто в раскладке: 1»');
const note = await page.locator('.cvg-note').innerText().catch(() => '');
check(/brd\.json скачан/.test(note) && note.includes('layouts'), `пометка: файл скачан, куда положить (${note.replace(/\s+/g, ' ').slice(0, 120)})`);
const t1 = await toc();
check(t1[0].startsWith('4.') && !t1.some((t) => /Особый/.test(t)), `оглавление — в новом порядке, без скрытого (${t1.slice(0, 3).join(' | ')})`);
await page.reload();
await page.waitForSelector('#doc .cv > .cvg');
check(eq(await keys(), order1.filter((k) => k !== 'особый раздел а')), 'F5 — раскладка та же (вкладка помнит до пересборки)');

// ---------------------------------------------------------------- следующая сборка читает файл

console.log('Следующая сборка');
writeFileSync(join(lays, 'brd.json'), readFileSync(s1.path));
url = pack();
await fresh(noFsApi);
await open('A');
check(eq(await keys(), order1.filter((k) => k !== 'особый раздел а')), 'новая вкладка: раскладка — из файла папки раскладок');
await open('B');
const kb = await keys();
check(kb.indexOf('введение/новое в б') === kb.indexOf('введение/как сейчас') + 1, `блок только из Б — сразу за своим соседом по документу (${kb.join(' | ')})`);
check(kb.indexOf('особый раздел б') === kb.indexOf('бизнес-требования/бизнес-цель') + 1, 'раздел только из Б — за своим соседом');
check(!kb.includes('особый раздел а') && !(await hiddenKeys()).length, 'раздела А в Б нет — пропущен, полосы «Скрыто» нет');
await page.click('[data-cvg-edit]');
check(await tile('особый раздел б').locator('.cvg-tag').count() === 1, 'в правке у нового блока — «нет в раскладке»');
await btn('особый раздел б', 'hide');
const s2 = await saveDownload();
const k2 = s2.json.items.map((x) => x.k);
check(k2.includes('особый раздел а') && s2.json.items.find((x) => x.k === 'особый раздел а').hide === true, 'сохранение из Б не стёрло блок А (скрыт, как был)');
check(k2.indexOf('особый раздел а') === k2.indexOf('бизнес-требования/бизнес-цель') + 1 || k2.indexOf('особый раздел а') === k2.indexOf('бизнес-требования/бизнес-цель') + 2,
  `блок А — у прежнего соседа (${k2.join(' | ')})`);
check(k2.includes('особый раздел б') && k2.includes('введение/новое в б'), 'и блоки Б записаны');

// ---------------------------------------------------------------- сломанный файл

console.log('Сломанный файл раскладки');
writeFileSync(join(lays, 'brd.json'), '{ oops');
url = pack();
await fresh(noFsApi);
await open('A');
check(eq(await keys(), DOC_A), 'обзор — как в документе');
check(warnings.some((w) => /brd\.json не прочитана/.test(w)), 'в консоли — предупреждение, не ошибка');
writeFileSync(join(lays, 'brd.json'), JSON.stringify({ format: 1, view: 'spec', items: [] }));
url = pack();
await fresh(noFsApi);
await open('A');
check(eq(await keys(), DOC_A), 'файл чужого вида — не применяется');
rmSync(join(lays, 'brd.json'));

// ---------------------------------------------------------------- сохранение в папку (File System Access)

console.log('Сохранить — в папку раскладок (страница по http://127.0.0.1: на file:// OPFS закрыт)');
url = pack();
// Диалог выбора папки — подмена: папка OPFS «good» (с пометкой) или «bad» (без неё). OPFS даёт настоящий
// FileSystemDirectoryHandle (его можно хранить в IndexedDB), но только не на file:// — поэтому тот же набор
// отдаётся простым http-сервером; страница и код сохранения те же.
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = createServer((req, res) => {
  const p = join(box, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(box) || !existsSync(p) || !statSync(p).isFile()) { res.writeHead(req.url === '/favicon.ico' ? 204 : 404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' });
  res.end(readFileSync(p));
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
url = `http://127.0.0.1:${server.address().port}/.coddoc-tmp/to-html/to-html-layout/index.html`;
const picker = (which) => {
  window.__pick = which;
  window.showDirectoryPicker = async () => {
    const root = await navigator.storage.getDirectory();
    const d = await root.getDirectoryHandle(window.__pick, { create: true });
    if (window.__pick === 'good') { const m = await d.getFileHandle('to-html-layouts.txt', { create: true }); const w = await m.createWritable(); await w.write('x'); await w.close(); }
    window.__picked = (window.__picked || 0) + 1;
    return d;
  };
};
const opfsRead = (name) => page.evaluate(async (n) => {
  const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('good');
  return (await (await d.getFileHandle(n)).getFile()).text();
}, name);
await fresh(`(${picker})('bad')`);
await open('A');
await page.click('[data-cvg-edit]');
// Окно «Куда сохранить» — модальное: пока оно открыто, страницу не тронуть, поэтому блок скрываем до сохранения.
await btn('особый раздел а', 'hide');
const dlgOpen = () => page.evaluate(() => !!document.querySelector('dialog.cvg-dlg')?.open);
const saveAsk = async () => { await page.click('.cvg-tools [data-a="save"]'); await page.waitForSelector('dialog.cvg-dlg[open]'); };
await saveAsk();
const ask = await page.locator('dialog.cvg-dlg').innerText();
check(/Куда сохранить/.test(ask) && /Выберите папку/.test(ask) && ask.includes('layouts'), 'первое сохранение — окно «Куда сохранить» с путём к папке');
check(eq(await page.locator('dialog.cvg-dlg .btn').allInnerTexts(), ['Выбрать папку…', 'Скачать файл']) &&
  await page.locator('dialog.cvg-dlg code + .cvg-ico[data-a="copy"]').count() === 1, 'в окне два действия — выбрать папку или скачать; у пути — иконка «скопировать»');
check(await page.locator('.cvg-tools .cvg-msg').count() === 0, 'второй плашки в панели правки нет');
await page.click('dialog.cvg-dlg [data-a="close"]');
check(!(await dlgOpen()) && await page.locator('.cvg-tools').count() === 1, '✕ — окно закрыто, правка продолжается');
await saveAsk();
await page.keyboard.press('Escape');
check(!(await dlgOpen()), 'Esc — окно закрыто');
await saveAsk();
await page.mouse.click(5, 5);
check(!(await dlgOpen()) && await page.locator('.cvg-tools').count() === 1, 'щелчок мимо окна — окно закрыто, правка продолжается');
await saveAsk();
await page.click('dialog.cvg-dlg [data-a="pick"]');
await page.waitForFunction(() => /нет файла|не дал/.test(document.querySelector('dialog.cvg-dlg')?.textContent || ''));
const bad = await page.locator('dialog.cvg-dlg').innerText();
check(/нет файла to-html-layouts\.txt/.test(bad) && await page.locator('dialog.cvg-dlg [data-a="pick"]').count() === 1 && await dlgOpen(),
  `папка без пометки — в том же окне «это не папка раскладок», выбор на месте (${bad.replace(/\s+/g, " ").slice(0, 70)})`);
await page.evaluate(() => { window.__pick = 'good'; });
await page.click('dialog.cvg-dlg [data-a="pick"]');
await page.waitForSelector('.cvg-note');
const saved1 = JSON.parse(await opfsRead('brd.json'));
check(saved1.view === 'brd' && saved1.items.find((x) => x.k === 'особый раздел а')?.hide === true, 'файл записан в выбранную папку');
check(/сохранена/.test(await page.locator('.cvg-note').innerText()) && !(await dlgOpen()), 'пометка «сохранена», окно закрыто');
await page.click('[data-cvg-edit]');
await btn('особый раздел а', 'hide');
const picked = await page.evaluate(() => window.__picked);
await page.click('.cvg-tools [data-a="save"]');
await page.waitForSelector('.cvg-note');
const saved2 = JSON.parse(await opfsRead('brd.json'));
check(await page.evaluate(() => window.__picked) === picked && saved2.items.find((x) => x.k === 'особый раздел а')?.hide !== true,
  'второе сохранение — сразу в ту же папку, без диалога');

// ---------------------------------------------------------------- «Отмена» и «Сбросить»

console.log('Отмена и «Сбросить»');
await page.click('[data-cvg-edit]');
const before = await keys();
await btn(':hero', 'next');
await page.click('.cvg-tools [data-a="cancel"]');
await page.waitForSelector('#doc .cv > .cvg');
check(eq(await keys(), before) && await page.locator('.cvg-tools').count() === 0, '«Отмена» — как было, панель закрыта');
await page.click('[data-cvg-edit]');
await btn(':hero', 'next');
await btn('особый раздел а', 'hide');
await page.click('.cvg-tools [data-a="reset"]');
check(eq(await keys(), DOC_A) && await page.locator('.cvg-off').count() === 0, '«Сбросить» — порядок документа, ничего не скрыто');

console.log('\nОшибки страницы: ' + (errors.length ? errors.join(' | ') : 'нет'));
if (errors.length) failures++;
console.log(failures ? `\nне сошлось: ${failures}` : '\nвсё сошлось');
server.close();
process.on('uncaughtException', (e) => { if (/TargetClosed/.test(String(e))) process.exit(failures ? 1 : 0); throw e; });
await browser.close().catch(() => {});
process.exit(failures ? 1 : 0);
