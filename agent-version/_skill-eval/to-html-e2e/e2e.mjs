// e2e страницы to-html: фикстуры → pack.sh → Chrome по file:// → проверки того, что видит человек.
//
// Запуск (из этой папки, после npm install): node e2e.mjs [chrome|msedge]
// Браузер — установленный в системе (playwright-core сам браузеры не качает).

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { makeFixtures, journal } from '../to-html-fixtures.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ref = resolve(here, '..', '..', 'to-html', 'reference');
const box = resolve(here, '..', 'selftest', 'to-html-e2e');
const channel = process.argv[2] || 'chrome';

let failures = 0;
const check = (ok, what) => { console.log(`  ${ok ? '✓' : '✗'} ${what}`); if (!ok) failures++; return ok; };

// ---------------------------------------------------------------- наборы

rmSync(box, { recursive: true, force: true });
const fx = join(box, 'fx');
mkdirSync(fx, { recursive: true });
makeFixtures(fx);
// Большой журнал — время открытия; имя файла в NFD (как хранит macOS), ссылка на него — в NFC.
writeFileSync(join(fx, 'TH-VAULT', 'Журнал-5МБ.md'), journal(4.8 * 1024 * 1024));
mkdirSync(join(fx, 'TH-NFD'), { recursive: true });
writeFileSync(join(fx, 'TH-NFD', 'README.md'), '# NFD\n\n[ссылка на «й»](<Мой файл.md>)\n');
writeFileSync(join(fx, 'TH-NFD', 'Мой файл.md'.normalize('NFD')), '# Файл с й\n');

function pack(...args) {
  return packIn(fx, ...args);
}
// Песочница — вне репозитория: без потолка git нашёл бы репозиторий скиллов и писал бы в его .coddoc-tmp/.
function packIn(cwd, ...args) {
  const env = { ...process.env, GIT_CEILING_DIRECTORIES: box };
  const out = execFileSync('bash', [join(ref, 'pack.sh').split(sep).join('/'), '--no-open', ...args], { cwd, env }).toString('utf8');
  const last = out.trim().split(/\r?\n/).pop();
  if (!/^to-html: updated /.test(last)) throw new Error('pack: ' + out);
  return last.split(' page=')[1];
}

const urls = {
  docs: pack('TH-DOCS'),
  vault: pack('TH-VAULT'),
  edge: pack('TH-EDGE'),
  nfd: pack('TH-NFD'),
  nb: pack('TH-NB/notes/выдача-лодок'),
  // Корень вне папки запуска: base — абсолютный file:///…
  outside: packIn(join(fx, 'TH-NB'), '../TH-DOCS'),
  blank: pathToFileURL(join(ref, 'viewer', 'index.html')).href,
};

// ---------------------------------------------------------------- проверки

const browser = await chromium.launch({ channel, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
// «Файл не найден» ожидаем: пустую страницу открываем без data.js.
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_FILE_NOT_FOUND/.test(m.text())) errors.push(m.text()); });
// Диалог по умолчанию — ошибка; проверка замены набора включает «принять» или «отказаться».
let dialogMode = 'error';
let lastDialog = '';
page.on('dialog', (d) => {
  lastDialog = d.message();
  if (dialogMode === 'accept') d.accept();
  else { if (dialogMode === 'error') errors.push('диалог: ' + d.message()); d.dismiss(); }
});

// Текст без значка-якоря «#» у заголовков.
const text = (sel) => page.locator(sel).first().evaluate((el) => {
  const c = el.cloneNode(true);
  c.querySelectorAll('.anchor').forEach((a) => a.remove());
  return c.textContent.trim();
});
// textContent, а не innerText: страница восстанавливает прокрутку, раздел за экраном с content-visibility
// не отрисован, и innerText у него пустой.
const tc = (sel) => page.locator(sel).first().evaluate((el) => el.textContent.trim());
const hash = () => page.evaluate(() => decodeURIComponent(location.hash));
const treeOf = () => page.locator('#tree a.row[title]').evaluateAll((as) => as.map((a) => a.getAttribute('title')).sort());
// Открыть адрес с #файлом полной загрузкой: goto на ту же страницу с другим # — переход внутри неё, и
// goto возвращается раньше, чем страница обработает hashchange.
const visit = async (u) => { await page.goto('about:blank'); await page.goto(u); };
// Переход по ссылке асинхронный (hashchange) — ждём смены адреса, иначе читаем старую страницу.
const go = async (sel) => {
  const prev = await page.evaluate(() => location.hash);
  await page.click(sel);
  await page.waitForFunction((p) => location.hash !== p, prev, { timeout: 5000 });
  await page.waitForTimeout(30);
};
const inView = (sel) => page.locator(sel).first().evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight; });
// Развёрнутое — по окну: fixed внутри раздела с content-visibility считается от раздела.
const fillsScreen = (sel) => page.locator(sel).first().evaluate((el) => {
  const r = el.getBoundingClientRect();
  return r.top >= 0 && r.left >= 0 && r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9;
});

console.log('TH-DOCS — документация');
await page.goto(urls.docs);
check(await text('.doc h1') === 'Справочник команды', 'открылся README.md');
check(/f=README\.md/.test(await hash()), 'в адресе — файл');
check(await page.locator('#tree .row.active').innerText() === 'Справочник команды', 'в дереве подсвечен открытый файл');
check(!(await page.locator('#tree').innerText()).includes('не показывать'), 'скрытые папки и node_modules не в дереве');
check(await page.locator('#tree .tree-cap').innerText() === 'Вложения', 'pdf — в «Вложениях»');

await go('.doc a:text("архитектура")');
check(await text('.doc h1') === 'Как устроен сервис заказов', 'ссылка на другой файл открывает его');
check(await page.locator('#toc a').count() >= 3, 'оглавление справа заполнено');
check(await page.locator('.doc img[data-file="img/стенд.png"]').evaluate((i) => i.complete && i.naturalWidth > 0), 'картинка по пути видна');
check(await page.locator('.code [data-copy] svg').count() > 0, 'у блока кода кнопка «Копировать» со значком');
check(await page.locator('.table [data-expand] svg').count() > 0, 'у таблицы кнопка «Развернуть» со значком');
await page.locator('.doc .table [data-expand]').first().click();
check(await fillsScreen('.table.full'), 'развёрнутая таблица в разделе документа — на весь экран, а не на раздел');
await page.keyboard.press('Escape');

await go('.doc a:text("словарь")');
check(await text('.doc h1') === 'Словарь', 'ссылка с якорем открывает файл');
check(await inView('.doc [id="заказ"]'), 'и прокручивает к разделу «Заказ»');
await page.goBack();
check(await text('.doc h1') === 'Как устроен сервис заказов', '«назад» возвращает прошлый файл');

await go('#toc a:text("3. API")');
const before = await page.evaluate(() => scrollY);
await page.waitForTimeout(400);
await page.reload();
await page.waitForTimeout(200);
check(await text('.doc h1') === 'Как устроен сервис заказов', 'F5 оставляет тот же файл');
check(Math.abs((await page.evaluate(() => scrollY)) - before) < 120, 'и то же место в нём');

await page.goto(urls.docs);
await go('.doc a:text("Релиз")');
check(await text('.doc h1') === 'Релиз', 'ссылка в %-кодировке на файл с кириллицей');
await page.goto(urls.docs);
check(await page.locator('.doc a.outside').count() === 1, 'ссылка за пределы папки помечена «вне папки»');
const tree = await page.locator('#tree .row .lbl').allInnerTexts();
check(tree[0] === 'Справочник команды', 'README — первым в дереве');

console.log('Схемы Mermaid');
await page.goto(urls.docs);
check(await page.evaluate(() => window.mermaid === undefined && !document.querySelector('script[src*="mermaid"]')), 'без схем Mermaid не грузится');
await go('.doc a:text("архитектура")');
await page.locator('.doc .diagram svg').first().waitFor({ timeout: 15000 });
check(await page.locator('.doc .diagram svg').count() === 1, 'схема в документе нарисована');
await visit(urls.docs + '#f=' + encodeURIComponent('схемы.md'));
await page.waitForFunction(() => document.querySelectorAll('.diagram[data-drawn]').length === 2, null, { timeout: 15000 });
check(await page.locator('.doc .diagram svg').count() === 1, 'рабочая схема нарисована');
check((await tc('.doc .diagram .note-box.err')).startsWith('Схема не нарисовалась'), 'у сломанной — текст ошибки');
check(await page.locator('.doc .diagram .mm-src').count() === 1, 'и её исходник');
check((await text('.doc')).includes('Текст после сломанной схемы'), 'текст после сломанной схемы на месте');
check(await page.evaluate(() => !document.querySelector('body > [id^="dto-html-mm"]')), 'временных контейнеров Mermaid в странице не осталось');
const themeTo = async (t) => {
  for (let i = 0; i < 3 && (await page.evaluate(() => document.documentElement.dataset.theme)) !== t; i++) await page.click('.side-foot [data-theme-btn]');
  await page.waitForFunction((w) => [...document.querySelectorAll('.diagram[data-drawn]')].every((b) => b.dataset.drawn === w || b.dataset.drawn === 'error'),
    t, { timeout: 15000 });
};
const darkSvg = () => page.locator('.doc .diagram svg').first().evaluate((s) => s.outerHTML.includes('#23283d'));
await themeTo('dark');
check(await darkSvg(), 'тёмная тема — схема перерисована тёмной');
await themeTo('light');
check(!(await darkSvg()), 'светлая — светлой');
await page.locator('.doc [data-expand-fig]').first().click();
check(await fillsScreen('.figure.full'), 'развёрнутая схема в разделе документа — на весь экран, а не на раздел');
await page.keyboard.press('Escape');
await go('#tree a[title="поток.mmd"]');
await page.locator('.doc .diagram svg').first().waitFor({ timeout: 15000 });
check(await page.locator('.doc .code').count() === 1, '.mmd — схема и её исходник');
await page.click('.doc [data-expand-fig]');
check(await page.locator('.figure.full').count() === 1, '«развернуть» — на весь экран');
await page.keyboard.press('Escape');
check(await page.locator('.figure.full').count() === 0, 'Esc — обратно');

const imgShown = (sel) => page.locator(sel).evaluate((i) =>
  new Promise((done) => (i.complete ? done(i.naturalWidth > 0) : (i.onload = () => done(i.naturalWidth > 0), i.onerror = () => done(false)))));
await visit(urls.outside + '#f=architecture.md');
check(await imgShown('.doc img[data-file="img/стенд.png"]'), 'набор вне папки запуска: картинка по file:///… видна');
await visit(urls.outside + '#f=README.md');
check(await page.locator('.doc a.outside[href^="file:"]').count() === 1, 'и ссылка «вне папки» ведёт по file:///…');

console.log('Заметки: [[ссылки]], ![[вставки]], плашки');
await page.goto(urls.docs);
check(await page.locator('.doc .nb-ref, .doc .nb-id').count() === 0, 'в обычной документации правило ноута молчит');
await go('.doc a:text-is("Дежурства")');
check(await text('.doc h1') === 'Дежурства', '[[Дежурства]] находит файл в подпапке по имени');
await visit(urls.docs + '#f=architecture.md');
check(await tc('.doc .callout.note .callout-title') === 'Заметка', '> [!note] — плашка «Заметка»');
check((await tc('.doc .callout.note')).includes('Документ живой'), 'и её текст');
await visit(urls.vault + '#f=' + encodeURIComponent('Журнал.md'));
check(await page.locator('.doc a:text-is("Ремонт кухни")').count() > 0, '[[Ремонт кухни]] — ссылка');
check(await tc('.doc .callout.warning .callout-title') === 'Важно', '> [!warning] Важно — плашка с заголовком');
const firstPhoto = page.locator('.doc img[data-file="вложения/разметка-розеток.jpg"]').first();
await firstPhoto.scrollIntoViewIfNeeded();
check(await firstPhoto.evaluate((i) => new Promise((done) => (i.complete ? done(i.naturalWidth > 0) : (i.onload = () => done(i.naturalWidth > 0), i.onerror = () => done(false))))),
  '![[фото]] из другой папки видно');
await go('.doc a:text-is("смете ремонта")');
check(await text('.doc h1') === 'Ремонт кухни', '[[Имя#Раздел|подпись]] открывает файл');
check(await inView('.doc [id="бюджет"]'), 'и прокручивает к разделу');
check(await page.locator('.doc a.att').count() === 1, '![[смета.xlsx]] — значок вложения');
await visit(urls.vault + '#f=' + encodeURIComponent('Проекты/Поездка в Казань.md'));
check(await tc('.doc a.missing') === 'Нет такой заметки', '[[несуществующая]] — пунктиром, не битой ссылкой');

console.log('Ноут аналитика');
await visit(urls.nb + '#f=' + encodeURIComponent('сводка-решений-2026-10-17.md'));
check(await page.locator('.doc a.nb-ref').count() === 1 && await page.locator('.doc li[id]').count() === 0, 'в выкладке номер пункта — ссылка, а не свой якорь');
await go('.doc a.nb-ref');
check(await text('.doc h1') === 'Ноут: выдача лодок', 'ссылка ведёт в notebook.md');
check(await inView('.doc li[id="n-2026-10-14-1-1"]'), 'к строке пункта 2026-10-14 №1.1');
check(await page.locator('.doc a.nb-id').count() === 3, 'свои номера пунктов — тихими ссылками (3)');
check(await page.locator('.doc [id="n-2026-10-14-1"]').count() === 1, 'у записи «### 1 · …» — свой якорь');
check(await page.locator('.doc li.nb-off').count() === 1, 'пункт с «‖» приглушён');
check((await tc('.doc .nb-tail')).includes('закрыт'), 'хвост после «‖» — отдельно');
await go('.doc .nb-tail a.nb-ref');
check(await inView('.doc li[id="n-2026-10-16-1-1"]'), 'ссылка из хвоста «закрыт: …» ведёт к закрывшему пункту');
check(await page.locator('.doc a.path-link').count() === 1, '«исходник: sources/…» — ссылка');
await go('.doc a.path-link');
check(/sources\/2026-10-16-1\.md/.test(await hash()), 'и открывает исходник');
await visit(urls.nb + '#f=' + encodeURIComponent('notebook-2026-10-17.points.md'));
check(await page.locator('.doc a.nb-ref').count() === 1, 'в списке пунктов номер — ссылка');

console.log('Поиск');
const typed = async (s) => { await page.fill('#q', s); await page.waitForTimeout(200); };
await visit(urls.nb + '#f=notebook.md');
await page.keyboard.press('Control+k');
check(await page.locator('#search').isVisible(), 'Ctrl+K открывает поиск');
check(await page.evaluate(() => document.activeElement?.id === 'q'), 'курсор сразу в поле');
await typed('инструктаже');
check((await page.locator('#searchRes .s-group small').allInnerTexts()).includes('sources/2026-10-16-1.md'), 'слово из sources/ находится');
await typed('выдает');
check(await page.locator('#searchRes .s-item').count() > 0, 'ё = е: «выдает» находит «выдаёт»');
check((await page.locator('#searchRes .s-item mark').first().innerText()).toLowerCase() === 'выдаёт', 'и подсвечивает «выдаёт»');
await typed('лодку марсоход');
check((await page.locator('#searchRes').innerText()).includes('Ничего не нашлось'), 'несколько слов — нужны все');
await typed('инструктаже');
await page.keyboard.press('ArrowDown');
check(await page.locator('#searchRes .s-item.on').getAttribute('data-n') === '1', '↓ — следующий результат');
await page.locator('#searchRes .s-item', { hasText: 'Здравствуйте' }).click();
await page.waitForFunction(() => location.hash.includes('sources'), null, { timeout: 5000 });
check(await page.locator('#search').isHidden(), 'щелчок по результату закрывает поиск');
await page.locator('.doc mark.hit').first().waitFor({ timeout: 3000 });
check((await tc('.doc mark.hit')) === 'инструктаже', 'и подсвечивает найденное в открытом файле');
await page.click('.side-head [data-open-search]');
check(await page.locator('#search').isVisible(), 'кнопка «Поиск» тоже открывает');
await page.keyboard.press('Escape');
check(await page.locator('#search').isHidden(), 'Esc закрывает');

await visit(urls.vault + '#f=' + encodeURIComponent('Журнал.md'));
await page.keyboard.press('Control+k');
await typed('бюджет');
check(await page.locator('#searchRes .s-item b').first().innerText() === 'Бюджет', 'совпадение в заголовке — выше совпадений в тексте');
await page.keyboard.press('Enter');
await page.waitForFunction(() => location.hash.includes(encodeURIComponent('Ремонт')), null, { timeout: 5000 });
check(await text('.doc h1') === 'Ремонт кухни', 'Enter открывает файл раздела');
check(await inView('.doc mark.hit'), 'и подсвеченное найденное на экране');

await visit(urls.vault + '#f=' + encodeURIComponent('Журнал-5МБ.md'));
await page.keyboard.press('Control+k');
const ts = Date.now();
await page.fill('#q', 'счётчиков');
await page.locator('#searchRes .s-item').first().waitFor({ timeout: 10000 });
const searchMs = Date.now() - ts;
check(searchMs < 1000, `первый поиск по набору с журналом 4,8 МБ — ${searchMs} мс (< 1000)`);
check((await page.locator('#searchCount').innerText()).includes('из'), 'больше 50 совпадений — «50 из N»');
await page.keyboard.press('Escape');

console.log('Экспорт');
const exportOf = async (what) => {
  await page.click('#exportBtn');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click(`[data-export="${what}"]`)]);
  const saved = join(box, 'export-' + dl.suggestedFilename());
  await dl.saveAs(saved);
  return { name: dl.suggestedFilename(), path: saved, html: readFileSync(saved, 'utf8') };
};
const openExport = async (file) => {
  const ex = await ctx.newPage();
  const url = pathToFileURL(file).href;
  const outside = [];
  const exErrors = [];
  ex.on('request', (r) => { if (!r.url().startsWith('data:') && r.url().split('#')[0] !== url) outside.push(r.url()); });
  ex.on('pageerror', (e) => exErrors.push(e.message));
  await ex.goto(url);
  return { ex, outside, exErrors };
};
await visit(urls.docs + '#f=README.md');
const docsFiles = (await treeOf()).filter((p) => !p.endsWith('.pdf'));
const folder = await exportOf('folder');
check(/^TH-DOCS-\d{4}-\d\d-\d\d\.html$/.test(folder.name), `вся папка — файл ${folder.name}`);
check(!/<script[^>]+src=|<link\b/i.test(folder.html), 'внешних скриптов и стилей нет');
check(!folder.html.includes('markdown-it') && !folder.html.includes('mermaid.min'), 'markdown-it и mermaid внутрь не попали');
{
  const { ex, outside, exErrors } = await openExport(folder.path);
  check(outside.length === 0, 'открывается без единого запроса наружу' + (outside.length ? ': ' + outside.join(' ') : ''));
  check(await ex.locator('.part').count() === docsFiles.length, `частей — по файлу (${docsFiles.length}), вложений среди них нет`);
  check(await ex.locator('.part:not([hidden])').count() === 1, 'видна одна часть');
  check(await ex.locator('.tree-cap').innerText() === 'Вложения — в файл не вложены', 'вложения — списком, с пометкой');
  check(await ex.locator('img[src^="data:image"]').count() >= 1 && await ex.locator('img[data-file]').count() === 0, 'картинки — внутри файла');
  check(await ex.locator('.diagram .mm-light svg').count() >= 2 && await ex.locator('.diagram .mm-dark svg').count() >= 2, 'схемы — готовыми SVG, светлой и тёмной');
  const exGo = async (sel) => {
    const prev = await ex.evaluate(() => location.hash);
    await ex.click(sel);
    await ex.waitForFunction((p) => location.hash !== p, prev, { timeout: 5000 });
    await ex.waitForTimeout(30);
  };
  await exGo('.tree a.row[title="README.md"]');
  await exGo('.part:not([hidden]) a:text("архитектура")');
  check(await ex.locator('.part:not([hidden])').getAttribute('data-title') === 'Как устроен сервис заказов', 'ссылка между файлами — переход внутри файла');
  check(await ex.locator('#toc a').count() >= 3, 'оглавление части');
  await exGo('.part:not([hidden]) a:text("словарь")');
  check(await ex.locator('.part:not([hidden])').getAttribute('data-title') === 'Словарь', 'ссылка с якорем — в другую часть');
  check(await ex.locator('.part:not([hidden]) h2').first().evaluate((h) => { const r = h.getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight; }), 'и к разделу');
  const th0 = await ex.evaluate(() => document.documentElement.dataset.theme);
  await ex.click('.side-foot [data-theme-btn]');
  check(await ex.evaluate(() => document.documentElement.dataset.theme) !== th0, 'тема переключается');
  check(exErrors.length === 0, 'ошибок в экспорте нет' + (exErrors.length ? ': ' + exErrors.join(' | ') : ''));
  await ex.close();
}
await visit(urls.docs + '#f=architecture.md');
const one = await exportOf('doc');
check(one.name === 'architecture.html', `этот документ — файл ${one.name}`);
{
  const { ex, outside } = await openExport(one.path);
  check(outside.length === 0, 'открывается без запросов');
  check(await ex.locator('.part').count() === 1 && await ex.locator('.side').count() === 0, 'одна часть, без дерева');
  check(await ex.locator('#toc a').count() >= 3, 'с оглавлением');
  check(await ex.locator('.unlinked').count() >= 1, 'ссылки на другие файлы — пунктиром, без перехода');
  check(await ex.locator('img[src^="data:image"]').count() === 1 && await ex.locator('.diagram svg').count() >= 1, 'картинка и схема внутри');
  await ex.close();
}
await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
await page.click('#exportBtn');
await page.click('[data-export="office"]');
await page.waitForFunction(() => (document.getElementById('toast')?.textContent ?? '').includes('Скопировано'), null, { timeout: 30000 });
const clip = await page.evaluate(async () => {
  const out = {};
  for (const it of await navigator.clipboard.read()) for (const t of it.types) out[t] = await (await it.getType(t)).text();
  return out;
});
const ch = clip['text/html'] ?? '';
check(ch.includes('<table') && ch.includes('border:1px solid'), 'Confluence/Word: таблица с рамками в стилях тегов');
check(ch.includes('data:image/png'), 'схема — картинкой PNG');
check(!ch.includes('class=') && !ch.includes('<svg'), 'без классов и svg — только то, что понимают Word и Confluence');
check((clip['text/plain'] ?? '').startsWith('# Как устроен сервис заказов'), 'простым текстом — исходный md');

console.log('TH-EDGE — краевые файлы');
await page.goto(urls.edge);
await go('#tree a[title="cp1251.md"]');
check(await text('.doc h1') === 'Лодка', 'cp1251 распознан');
await go('#tree a[title="html.md"]');
check(await page.locator('.doc script').count() === 0 && await page.locator('.doc details').count() === 1, 'html: <script> вырезан, <details> остался');
await go('#tree a[title="шапка.md"]');
check(await page.locator('.doc dl.fm dt').allInnerTexts().then((k) => k.join(',') === 'тема,ключ'), 'шапка --- — карточкой');
check(await text('.doc h1') === 'Заголовок', 'и заголовок после неё');
await go('#tree a[title="big.md"]');
check((await text('.doc')).includes('больше 5 МБ'), 'файл больше предела — пометка, а не пустота');
await go('#tree a[title="решётка#и%процент.md"]');
check(await text('.doc h1') === 'решётка', '# и % в имени файла');
await go('#tree a[title="Заглавные.MD"]');
check((await text('.doc h1')).startsWith('заглавные'), '.MD заглавными — как markdown');

console.log('TH-NFD — имя в NFD');
await page.goto(urls.nfd);
await go('.doc a:text("ссылка")');
check(await text('.doc h1') === 'Файл с й', 'ссылка в NFC находит файл с именем в NFD');

console.log('TH-VAULT — заметки и большой журнал');
// Полная загрузка страницы сразу на большом журнале: чтение data.js (~7 МБ base64) + разбор + показ.
await page.goto('about:blank');
const t0 = Date.now();
await visit(urls.vault + '#f=' + encodeURIComponent('Журнал-5МБ.md'));
await page.locator('.doc h1').first().waitFor();
const ms = Date.now() - t0;
check(await text('.doc h1') === 'Журнал', 'открыт большой журнал');
check(ms < 1500, `журнал 5 МБ открылся за ${ms} мс (< 1500)`);
check(await page.locator('.doc section.sec').count() > 10, 'большой файл разбит на части по ##');
check(await page.locator('#toc [data-collapse]').count() === 1, 'длинное оглавление сворачивается');
check(await page.locator('#toc nav > ul > li.collapsed').count() > 0, 'и свёрнуто по умолчанию');

console.log('Тема, узкий экран, инит');
await page.goto(urls.docs);
// Начинаем с «как в системе», в какой бы теме нас ни оставили проверки выше.
for (let i = 0; i < 3 && (await page.evaluate(() => document.documentElement.dataset.theme)) !== 'auto'; i++) await page.click('.side-foot [data-theme-btn]');
await page.click('.side-foot [data-theme-btn]');
const t1 = await page.evaluate(() => document.documentElement.dataset.theme);
await page.click('.side-foot [data-theme-btn]');
const t2 = await page.evaluate(() => document.documentElement.dataset.theme);
check(t1 === 'light' && t2 === 'dark', `тема переключается: ${t1} → ${t2}`);
await page.reload();
check(await page.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'тема запоминается');
await page.setViewportSize({ width: 390, height: 844 });
check(await page.locator('#drawerBtn').isVisible(), 'на телефоне — кнопка дерева');
await page.click('#drawerBtn');
check(await page.evaluate(() => document.body.classList.contains('drawer')), 'дерево выезжает');
check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'нет прокрутки вбок');
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(urls.blank);
check(await page.locator('#init').isVisible() && !(await page.locator('#app').isVisible()), 'без data.js — экран «инит»');

console.log('Инит — выбор папки и перетаскивание');
await page.goto(urls.docs);
const packedTree = await treeOf();
await page.goto(urls.blank);
await page.setInputFiles('#dirInput', join(fx, 'TH-DOCS'));
await page.locator('#app').waitFor({ state: 'visible' });
check(JSON.stringify(await treeOf()) === JSON.stringify(packedTree), 'выбранная папка — то же дерево, что у упакованной (скрытое и node_modules отброшены)');
check(await text('.doc h1') === 'Справочник команды', 'открылся README');
check(await page.locator('#setName').innerText() === 'TH-DOCS', 'набор назван именем папки');
check((await page.locator('#snap').innerText()).includes('F5'), 'внизу — предупреждение, что F5 сбросит');
await go('.doc a:text("архитектура")');
check(await text('.doc h1') === 'Как устроен сервис заказов', 'ссылки между файлами работают');
check(await imgShown('.doc img[data-file="img/стенд.png"]'), 'картинка из выбранных файлов видна');
const droppedExport = await exportOf('doc');
check(/<img[^>]+src="data:image\/png/.test(droppedExport.html), 'экспорт выбранной папки — картинка внутри, из самого файла');
await go('#tree a[title="регламент-дежурств.pdf"]');
check(await page.locator('.doc a[href^="blob:"]').count() === 1, 'вложение открывается из выбранного файла');
await page.reload();
check(await page.locator('#init').isVisible(), 'после F5 — снова «инит»: браузер файлы не помнит');

const drop = (names) => page.evaluate((files) => {
  const dt = new DataTransfer();
  for (const [name, body] of files) dt.items.add(new File([body], name));
  for (const t of ['dragenter', 'dragover', 'drop']) window.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }));
}, names);
await drop([['первый.md', '# Первый\n\nОн длиннее второго, поэтому открывается первым.\n\n[второй](второй.md)\n'], ['второй.md', '# Второй\n']]);
await page.locator('#app').waitFor({ state: 'visible' });
check(await text('.doc h1') === 'Первый', 'перетащенные файлы открылись, первым — самый большой .md');
await go('.doc a:text("второй")');
check(await text('.doc h1') === 'Второй', 'и ссылки между ними работают');

dialogMode = 'dismiss';
await drop([['третий.md', '# Третий\n']]);
await page.waitForTimeout(300);
check(/вместо «перетащенные файлы»/.test(lastDialog), 'бросить поверх открытого — спрашивает');
check(await text('.doc h1') === 'Второй', 'отказ — набор не тронут');
dialogMode = 'accept';
await drop([['третий.md', '# Третий\n']]);
await page.waitForFunction(() => document.querySelector('.doc h1')?.textContent?.includes('Третий'), null, { timeout: 5000 });
check(JSON.stringify(await treeOf()) === JSON.stringify(['третий.md']), 'согласие — набор заменён');
dialogMode = 'error';

await page.goto(urls.blank);
await page.setInputFiles('#dirInput', join(fx, 'TH-IMG'));
await page.waitForTimeout(300);
check(/нет текстовых/.test(await page.locator('#initWarn').innerText()), 'папка без текста — понятная пометка');
await page.setInputFiles('#dirInput', join(fx, 'TH-ONE', 'проект'));
await page.waitForTimeout(500);
check(/Больше 2000 файлов/.test(await page.locator('#initWarn').innerText()), 'папка больше 2000 файлов — пометка, а не зависание');

check(errors.length === 0, 'ошибок в консоли нет' + (errors.length ? ': ' + errors.join(' | ') : ''));
// Итог — до закрытия: playwright-core 1.49 с Edge иногда роняет процесс на закрытии (TargetClosedError),
// и строка итога не печаталась. На закрытии эта ошибка код выхода не меняет.
console.log(failures ? `\nпровалов: ${failures}` : '\nвсё сошлось');
process.on('uncaughtException', (e) => { if (/TargetClosed/.test(String(e))) process.exit(failures ? 1 : 0); throw e; });
await browser.close().catch(() => {});
process.exit(failures ? 1 : 0);
