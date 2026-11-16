// Самотест «Обзора» to-html: не теряет ли обзор текст документа.
//
// Берёт все business_requirements.md, technical_specification.md, bug_report.md и change_request.md из
// _skill-eval/fixtures/** (кроме /stubs/, одинаковые по содержимому — один раз), кладёт каждый в свою папку
// песочницы, пакует pack.sh, открывает каждый документ в виде «Обзор» и сверяет слова: всё, что человек
// читает в виде «Текст», должно быть и в обзоре — не меньше раз, чем в документе. Лишние слова в обзоре — не ошибка.
//
// Запуск (из этой папки, node 20): node overview-coverage.mjs [chrome|msedge]
//   TO_HTML_REF=<папка> — подменная reference/ вместо agent-version/to-html/reference (проверка на испорченной копии).
// Код выхода 1 — у какого-то документа обзор не отрисовался (или открылся не тот файл), или в нём не хватает слов.
//
// Не считаются словами документа: разметка markdown (# * ` | > ~~, маркеры и номера пунктов, строки-ограды
// блоков кода, адреса ссылок, html-теги), frontmatter, номера разделов в заголовках, подписи-ключи **Ключ:**
// в начале строки цитаты-шапки и в начале пункта списка, строка заголовков таблицы, эмодзи и пунктуация.

import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const evalDir = resolve(here, '..');
const fixtures = join(evalDir, 'fixtures');
const ref = process.env.TO_HTML_REF ? resolve(process.env.TO_HTML_REF) : resolve(evalDir, '..', 'to-html', 'reference');
const box = join(evalDir, 'selftest', 'to-html-overview');
const channel = process.argv[2] || 'chrome';
const SHOW = 15;

const KIND = {
  'business_requirements.md': 'БТ',
  'technical_specification.md': 'спека',
  'bug_report.md': 'баг-репорт',
  'change_request.md': 'запрос на правку',
};

// ---------------------------------------------------------------- документы

function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (KIND[name]) out.push(p);
  }
  return out;
}

const seen = new Map();
for (const p of walk(fixtures)) {
  const rel = relative(fixtures, p).split(sep).join('/');
  if (('/' + rel).includes('/stubs/')) continue;
  const buf = readFileSync(p);
  const key = createHash('sha1').update(buf).digest('hex');
  const doc = seen.get(key);
  if (doc) { doc.copies++; continue; }
  seen.set(key, { rel, name: rel.split('/').pop(), buf, text: buf.toString('utf8'), copies: 0 });
}
const docs = [...seen.values()];

// ---------------------------------------------------------------- песочница и упаковка

rmSync(box, { recursive: true, force: true });
mkdirSync(box, { recursive: true });
// Своя папка на документ: обзор смотрит соседей (спеку рядом с БТ, этапы, эпик), а соседи добавили бы
// в обзор чужих слов и спрятали бы потерю.
docs.forEach((d, i) => {
  d.dir = String(i + 1).padStart(3, '0') + '-' + d.rel.split('/')[0];
  d.path = d.dir + '/' + d.name;
  mkdirSync(join(box, d.dir));
  writeFileSync(join(box, d.path), d.buf);
});
// Потолок — папка над песочницей: git не уходит выше, в репозиторий скиллов, и .coddoc-tmp/ пишется в песочницу.
const env = { ...process.env, GIT_CEILING_DIRECTORIES: dirname(box) };
execFileSync('git', ['init', '-q'], { cwd: box, env });
const packOut = execFileSync('bash', [join(ref, 'pack.sh').split(sep).join('/'), '--no-open', box], { cwd: box, env }).toString('utf8');
const last = packOut.trim().split(/\r?\n/).pop();
if (!/^to-html: updated /.test(last)) throw new Error('pack: ' + packOut);
const pageUrl = last.split(' page=')[1];

// ---------------------------------------------------------------- слова

// Слово — буквы и цифры; знак-модификатор (U+FE0F у «⚠️») — часть слова, но не слово сам по себе.
const WORD = /[\p{L}\p{N}][\p{L}\p{M}\p{N}]*/gu;
const tokens = (s) => (s.normalize('NFC').toLowerCase().match(WORD) || []);

// Слова документа — то, что человек читает в «Тексте», с номером строки, разделом и блоком (абзац, пункт списка,
// строка таблицы, заголовок), где слово стоит.
function docWords(text) {
  const lines = text.replace(/^﻿/, '').normalize('NFC').split(/\r?\n/);
  const out = [];
  let i = 0;
  if (/^---\s*$/.test(lines[0])) {
    const end = lines.findIndex((l, k) => k > 0 && /^---\s*$/.test(l));
    if (end > 0) i = end + 1;
  }
  const unquote = (l) => l.replace(/^\s*(?:>\s?)+/, '');
  const isDelim = (l) => /\|/.test(l) && /-/.test(l) && /^[\s|:-]+$/.test(l);
  // Ячейки строки таблицы — как их делит markdown-it 14 (GFM): по «|» без «\» перед ним, и внутри `кода` тоже.
  const cells = (l) => l.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/);
  // Html-теги — разметка, в «Тексте» их не видно; внутри `кода` — видно.
  const untag = (s) => s.split(/(`+[^`]*`+)/).map((p, j) => (j % 2 ? p : p.replace(/<\/?[a-zA-Z][\w-]*(?:\s[^<>]*)?\/?>/g, ' '))).join('');
  let fence = '', section = '', inHead = false, seenH1 = false, cols = 0, block = 0, brk = true;
  for (; i < lines.length; i++) {
    const raw = lines[i];
    const quoted = /^\s*>/.test(raw);
    let l = unquote(raw);
    const f = l.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !l.trim().slice(f[1].length).trim()) { fence = ''; continue; }
      push(l, 'code');
      continue;
    }
    if (f) { fence = f[1]; block++; continue; }
    if (!l.trim()) { brk = true; cols = 0; continue; }
    const h = l.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) {
      const title = h[2].replace(/^\d+(?:\.\d+)*\.?\s+/, '');
      section = h[2];
      inHead = h[1].length === 1 && !seenH1;
      if (h[1].length === 1) seenH1 = true;
      cols = 0;
      block++; brk = true;
      push(title, 'heading');
      continue;
    }
    // Таблица: строка заголовков — нет; в строке тела ячейки сверх ширины таблицы markdown-it не показывает.
    if (!/\|/.test(l)) cols = 0;
    if (isDelim(l)) continue;
    const next = i + 1 < lines.length ? unquote(lines[i + 1]) : '';
    if (/\|/.test(l) && isDelim(next) && cells(l).length === cells(next).length) { cols = cells(next).length; continue; }
    let where = quoted && inHead ? 'head' : 'text';
    if (cols) { l = cells(l).slice(0, cols).join(' | '); where = 'table'; }
    const item = !cols && l.match(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/);
    if (item) l = l.slice(item[0].length);
    if (brk || cols || item || /^\*\*[^*\n]+?:\*\*/.test(l)) block++;
    brk = !!cols;
    if (item || (quoted && inHead)) l = l.replace(/^\*\*[^*\n]+?:\*\*/, '');
    // Ссылка: текст считается, адрес — нет.
    l = untag(l.replace(/!?\[([^\]]*)\]\((?:<[^>]*>|[^)\s]*)(?:\s+"[^"]*")?\)/g, '$1'));
    push(l, where);
  }
  return out;
  function push(s, where) {
    for (const w of tokens(s)) out.push({ w, line: i + 1, block, src: lines[i], section, where });
  }
}

// Сколько раз каждое слово.
function counts(ws) {
  const m = new Map();
  for (const w of ws) m.set(w, (m.get(w) || 0) + 1);
  return m;
}

// Каких вхождений не хватает. Счёт слов говорит только «сколько», а не «где»: у слова с нехваткой k берём
// k вхождений, хуже всего покрытых обзором. Покрытие — по кускам документа до 6 слов подряд, которые есть
// в обзоре подряд: самый длинный такой кусок вокруг вхождения внутри его блока (в долях от возможного),
// среднее этого по блоку и самый длинный кусок через границы блоков (заголовок, который обзор не показал,
// со словами вокруг не стыкуется). Пропавший абзац так и показывается своими строками, а не первым
// вхождением того же слова выше по тексту.
const LONGEST = 6;
function missing(dw, ow) {
  const need = counts(dw.map((x) => x.w)), have = counts(ow);
  const grams = new Set(ow);
  for (let n = 2; n <= LONGEST; n++) for (let s = 0; s + n <= ow.length; s++) grams.add(ow.slice(s, s + n).join(' '));
  const ws = dw.map((x) => x.w);
  const longest = (k, a, b) => {
    for (let n = Math.min(LONGEST, b - a + 1); n >= 1; n--) {
      for (let s = Math.max(a, k - n + 1); s <= k && s + n - 1 <= b; s++) if (grams.has(ws.slice(s, s + n).join(' '))) return n;
    }
    return 0;
  };
  const blocks = new Map();
  dw.forEach((x, k) => { const r = blocks.get(x.block) || blocks.set(x.block, { a: k, b: k, sum: 0 }).get(x.block); r.b = k; });
  const inner = dw.map((x, k) => { const { a, b } = blocks.get(x.block); return longest(k, a, b) / Math.min(LONGEST, b - a + 1); });
  dw.forEach((x, k) => { blocks.get(x.block).sum += inner[k]; });
  const byWord = new Map();
  dw.forEach((x, k) => {
    if ((need.get(x.w) || 0) <= (have.get(x.w) || 0)) return;
    const r = blocks.get(x.block);
    const score = inner[k] + r.sum / (r.b - r.a + 1) + longest(k, 0, ws.length - 1) / LONGEST;
    (byWord.get(x.w) || byWord.set(x.w, []).get(x.w)).push({ ...x, k, score });
  });
  const lost = [];
  for (const [w, occ] of byWord) {
    const short = need.get(w) - (have.get(w) || 0);
    lost.push(...occ.sort((a, b) => a.score - b.score || a.k - b.k).slice(0, short));
  }
  return lost.sort((a, b) => a.k - b.k);
}

// ---------------------------------------------------------------- браузер

const browser = await chromium.launch({ channel, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => { try { sessionStorage.setItem('cv:mode', 'overview'); } catch (e) { /* по умолчанию и так обзор */ } });
const page = await ctx.newPage();
let errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

// textContent обзора, но с пробелом на границе блоков: textContent склеивает «<h3>Ключ</h3><div>текст</div>»
// в «Ключтекст», и оба слова пропали бы. Свёрнутые <details> и скрытое тоже идут: человек их раскрывает.
const overviewText = () => page.evaluate(() => {
  const cv = document.querySelector('#doc .cv');
  if (!cv) return null;
  const out = [];
  const walk = (n) => {
    if (n.nodeType === 3) { out.push(n.nodeValue); return; }
    if (n.nodeType !== 1) return;
    const el = /** @type {Element} */ (n);
    if (el.tagName === 'BR') { out.push(' '); return; }
    const d = getComputedStyle(el).display;
    const inline = d === 'inline' || d === 'contents';
    if (!inline) out.push(' ');
    el.childNodes.forEach(walk);
    if (!inline) out.push(' ');
  };
  walk(cv);
  return out.join('');
});

const clip = (s, w) => {
  const t = s.trim();
  if (t.length <= 110) return t;
  const at = Math.max(0, t.toLowerCase().indexOf(w) - 40);
  return (at > 0 ? '…' : '') + t.slice(at, at + 110) + (at + 110 < t.length ? '…' : '');
};
const placeOf = (x) => (x.where === 'head' ? 'шапка' : x.section ? x.section.replace(/[*`~]/g, '') : 'до первого заголовка') + (x.where === 'table' ? ' · таблица' : '');

let bad = 0;
console.log(`Обзор to-html: ${docs.length} документов из fixtures/` + (process.env.TO_HTML_REF ? ` (reference: ${ref})` : '') + '\n');
for (const d of docs) {
  errors = [];
  await page.goto('about:blank');
  await page.goto(pageUrl + '#f=' + encodeURIComponent(d.path));
  await page.waitForFunction(() => document.querySelector('#doc')?.children.length, null, { timeout: 10000 }).catch(() => {});
  const text = await overviewText();
  const label = `${d.rel}  [${KIND[d.name]}]` + (d.copies ? `  (+${d.copies} копий)` : '');
  // Файла нет в наборе — страница молча открывает первый попавшийся и переписывает адрес.
  const opened = await page.evaluate(() => new URLSearchParams(location.hash.slice(1)).get('f'));
  if (opened !== d.path) {
    bad++;
    console.log(`✗ ${label}\n    открылся не тот файл: ${opened}`);
    continue;
  }
  if (text === null) {
    bad++;
    console.log(`✗ ${label}\n    обзор не отрисовался (нет #doc .cv)` + (errors.length ? ': ' + errors.join(' | ') : ''));
    continue;
  }
  const dw = docWords(d.text);
  const lost = missing(dw, tokens(text));
  if (!lost.length) continue;
  bad++;
  const distinct = new Set(lost.map((x) => x.w));
  console.log(`✗ ${label}\n    не хватает ${lost.length} из ${dw.length} слов (разных: ${distinct.size})`);
  // До 15 разных слов, по порядку в документе, у каждого — первое пропавшее вхождение; сгруппированы по строке.
  const shown = new Set(), byLine = new Map();
  for (const x of lost) {
    if (shown.has(x.w) || shown.size >= SHOW) continue;
    shown.add(x.w);
    const g = byLine.get(x.line) || byLine.set(x.line, { x, ws: [] }).get(x.line);
    if (!g.ws.includes(x.w)) g.ws.push(x.w);
  }
  for (const { x, ws } of byLine.values()) console.log(`    стр. ${x.line} · ${placeOf(x)}: ${ws.join(', ')}\n        «${clip(x.src, ws[0])}»`);
  if (distinct.size > shown.size) console.log(`    … и ещё ${distinct.size - shown.size} разных слов`);
}

console.log(`\nпроверено ${docs.length}, с нехваткой ${bad}`);
process.on('uncaughtException', (e) => { if (/TargetClosed/.test(String(e))) process.exit(bad ? 1 : 0); throw e; });
await browser.close().catch(() => {});
process.exit(bad ? 1 : 0);
