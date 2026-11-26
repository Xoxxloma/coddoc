// Сравнение результатов edges.py с ожиданием. Вызывается из test-edges.py:
//   node compare.mjs <папка SM-EDGES-SCRIPT> <папка с копиями и выводами>
// Фазы: (1) оракул ↔ expect.json (синтетика); (2) скрипт ↔ expect.json: печать, секции,
// байты вне секции, нетронутые файлы; (3) настоящий слепок: скрипт ↔ оракул и скрипт ↔ секции ведущего.
import fs from 'node:fs';
import path from 'node:path';
import { edges } from './oracle.mjs';

const [, , HERE, OUT] = process.argv;
if (!HERE || !OUT) { console.error('usage: node compare.mjs <SM-EDGES-SCRIPT> <out>'); process.exit(2); }
const HEAD = '## Кто меня потребляет';

// ---------- печать скрипта ----------
function parseOut(text) {
  const r = { 'нет': false, K: null, M: null, 'зеркал': {}, 'пропусков': {}, 'не тронута': [] };
  for (const line of text.split(/\r?\n/)) {
    let m;
    if ((m = line.match(/^\s*(\S+) — зеркал (\d+)\s*$/))) r['зеркал'][m[1]] = +m[2];
    else if ((m = line.match(/^\s*(\S+) — строк в сервисы без карточки слепка: (\d+)/))) r['пропусков'][m[1]] = +m[2];
    else if ((m = line.match(/^\s*(\S+) — секции .*нет, не тронута/))) r['не тронута'].push(m[1]);
    else if ((m = line.match(/Шаг 5: карточек слепка (\d+), зеркал всего (\d+)/))) { r.K = +m[1]; r.M = +m[2]; }
    else if (/карточек слепка нет — Шага 5 нет/.test(line)) r['нет'] = true;
  }
  return r;
}
const fmtMap = (o) => Object.entries(o ?? {}).filter(([, n]) => n > 0 || n === 0).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, n]) => `${k} ${n}`).join(', ') || '—';
const fmtNZ = (o) => fmtMap(Object.fromEntries(Object.entries(o ?? {}).filter(([, n]) => n > 0)));
function flatPrint(p) {
  const m = new Map();
  if (p['нет']) { m.set('печать.нет слепка', 'да'); return m; }
  m.set('печать.нет слепка', 'нет');
  m.set('печать.K', String(p.K));
  m.set('печать.M', String(p.M));
  m.set('печать.зеркал', fmtMap(p['зеркал']));
  m.set('печать.пропусков', fmtNZ(p['пропусков']));
  m.set('печать.не тронута', [...(p['не тронута'] ?? [])].sort().join(', ') || '—');
  return m;
}

// ---------- файлы ----------
const lineSplit = (s) => s.split(/(?<=\n)/);
function sectionBounds(text) {
  const lines = lineSplit(text);
  const i = lines.findIndex((l) => l.replace(/\r?\n$/, '') === HEAD);
  if (i < 0) return null;
  let j = i + 1;
  while (j < lines.length && !lines[j].startsWith('## ')) j++;
  return { prefix: lines.slice(0, i).join(''), suffix: lines.slice(j).join('') };
}
function firstDiff(a, b) {
  const A = a.split('\n');
  const B = b.split('\n');
  for (let k = 0; k < Math.max(A.length, B.length); k++) {
    if (A[k] !== B[k]) return `стр. ${k + 1}: ждали «${JSON.stringify(A[k] ?? '(конец)').slice(1, -1)}», есть «${JSON.stringify(B[k] ?? '(конец)').slice(1, -1)}»`;
  }
  return 'отличие только в байтах окончаний';
}
// карточка с секцией: всё вне секции — байт в байт, секция — ожидаемые строки (окончания \r\n допускаются)
function checkCard(inText, outText, expLines) {
  const b = sectionBounds(inText);
  if (!b) return 'во входе нет секции';
  if (!outText.startsWith(b.prefix)) return 'до секции изменено: ' + firstDiff(b.prefix, outText.slice(0, b.prefix.length));
  if (outText.length < b.prefix.length + b.suffix.length || !outText.endsWith(b.suffix)) return 'после секции изменено: ' + firstDiff(b.suffix, outText.slice(-b.suffix.length || outText.length));
  const mid = outText.slice(b.prefix.length, outText.length - b.suffix.length);
  const want = expLines.map((l) => l + '\n').join('');
  if (mid.replace(/\r\n/g, '\n') !== want) return 'секция: ' + firstDiff(want, mid.replace(/\r\n/g, '\n'));
  return 'ок';
}
function eolInfo(inText, outText) {
  const count = (s) => {
    const crlf = (s.match(/\r\n/g) ?? []).length;
    return `CRLF ${crlf}, LF ${(s.match(/\n/g) ?? []).length - crlf}`;
  };
  const b = sectionBounds(inText);
  const kept = b && outText.startsWith(b.prefix) && outText.endsWith(b.suffix);
  const mid = kept ? outText.slice(b.prefix.length, outText.length - b.suffix.length) : null;
  return `вход: ${count(inText)}; выход: ${count(outText)}` + (kept ? `; в секции ${count(mid)}, вне секции байт в байт` : '; вне секции окончания изменены');
}
function walk(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name)).replace(/\\/g, '/')]));
}

// ---------- таблица ----------
const W = { c: 22, f: 30, v: 46 };
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const padR = (s, n) => s + ' '.repeat(Math.max(0, n - [...s].length));
const row = (c, f, e, g, st) => console.log(`${padR(cut(c, W.c), W.c)} ${padR(cut(f, W.f), W.f)} ${padR(cut(e, W.v), W.v)} ${padR(cut(g, W.v), W.v)} ${st}`);
const header = (t) => { console.log('\n' + t); row('случай', 'поле', 'ожидалось', 'получено', 'итог'); console.log('-'.repeat(W.c + W.f + 2 * W.v + 16)); };
const bad = [];
const notes = [];
function report(phase, name, pairs, extra = '') {
  let n = 0;
  for (const [f, e, g] of pairs) {
    if (e !== g) { n++; row(name, f, e, g, 'РАСХОЖДЕНИЕ'); bad.push({ phase, name, f, e, g }); }
  }
  if (!n) row(name, `все ${pairs.length} полей`, '', extra, 'ок');
  return n;
}
const stats = { 1: [0, 0], 2: [0, 0], 3: [0, 0] };

const casesDir = path.join(HERE, 'cases');
const caseNames = fs.readdirSync(casesDir).filter((n) => fs.existsSync(path.join(casesDir, n, 'expect.json'))).sort();
const manifestOf = (dir) => (fs.existsSync(path.join(dir, 'manifest.yaml')) ? path.join(dir, 'manifest.yaml') : path.join(dir, 'services', 'manifest.yaml'));
// args.txt случая: «--only a,b» — тот же список оракулу
const onlyOf = (dir) => {
  const f = path.join(dir, 'args.txt');
  if (!fs.existsSync(f)) return null;
  const a = fs.readFileSync(f, 'utf8').trim().split(/\s+/);
  const i = a.indexOf('--only');
  return i < 0 ? null : (a[i + 1] ?? '').split(',').map((s) => s.replace(/`/g, '').trim()).filter(Boolean);
};
const readRun = (name) => {
  const f = (s) => path.join(OUT, `${name}.${s}`);
  return {
    out: fs.existsSync(f('out')) ? fs.readFileSync(f('out'), 'utf8') : '',
    err: fs.existsSync(f('err')) ? fs.readFileSync(f('err'), 'utf8').trim() : '',
    rc: fs.existsSync(f('rc')) ? fs.readFileSync(f('rc'), 'utf8').trim() : '?',
    ms: fs.existsSync(f('ms')) ? fs.readFileSync(f('ms'), 'utf8').trim() : '?',
  };
};

// (1) оракул ↔ expect.json
header('ФАЗА 1. ОРАКУЛ против expect.json (синтетика, ожидания написаны руками)');
for (const n of caseNames) {
  const dir = path.join(casesDir, n);
  const exp = JSON.parse(fs.readFileSync(path.join(dir, 'expect.json'), 'utf8'));
  const o = edges(path.join(dir, 'services'), manifestOf(dir), onlyOf(dir));
  const pairs = [];
  const ep = flatPrint(exp['печать']);
  const op = flatPrint(o);
  for (const [f, e] of ep) pairs.push([f, e, op.get(f) ?? '(нет)']);
  for (const [card, lines] of Object.entries(exp['секции'] ?? {})) {
    const want = lines.join('\n');
    const got = (o.cards[card]?.lines ?? ['(нет секции)']).join('\n');
    pairs.push([`секция ${card}`, 'совпадает', want === got ? 'совпадает' : firstDiff(want, got)]);
  }
  stats[1][0]++;
  if (report(1, n, pairs)) stats[1][1]++;
}

// (2) скрипт ↔ expect.json
header('ФАЗА 2. СКРИПТ против expect.json (синтетика; гоняется на копии)');
for (const n of caseNames) {
  const dir = path.join(casesDir, n);
  const exp = JSON.parse(fs.readFileSync(path.join(dir, 'expect.json'), 'utf8'));
  const run = readRun(n);
  const pairs = [['код выхода', '0', run.rc], ['stderr', '(пусто)', run.err ? run.err.split('\n')[0] : '(пусто)']];
  const ep = flatPrint(exp['печать']);
  const gp = flatPrint(parseOut(run.out));
  for (const [f, e] of ep) pairs.push([f, e, gp.get(f) ?? '(нет)']);
  const outDir = path.join(OUT, n);
  const inFiles = [...walk(path.join(dir, 'services')).map((f) => `services/${f}`), ...(fs.existsSync(path.join(dir, 'manifest.yaml')) ? ['manifest.yaml'] : [])];
  const outFiles = [...walk(path.join(outDir, 'services')).map((f) => `services/${f}`), ...(fs.existsSync(path.join(outDir, 'manifest.yaml')) ? ['manifest.yaml'] : [])];
  const extra = outFiles.filter((f) => !inFiles.includes(f));
  pairs.push(['лишние файлы', '—', extra.join(', ') || '—']);
  for (const f of inFiles) {
    const inB = fs.readFileSync(path.join(dir, f));
    const outP = path.join(outDir, f);
    if (!fs.existsSync(outP)) { pairs.push([`файл ${f}`, 'ок', 'файл исчез']); continue; }
    const outB = fs.readFileSync(outP);
    const card = f.match(/^services\/([^/]+)\.md$/)?.[1];
    if (card && exp['секции']?.[card]) {
      pairs.push([`файл ${f}`, 'ок', checkCard(inB.toString('utf8'), outB.toString('utf8'), exp['секции'][card])]);
      if (inB.includes(Buffer.from('\r\n'))) notes.push(`${n}/${f}: ${eolInfo(inB.toString('utf8'), outB.toString('utf8'))}`);
    } else {
      pairs.push([`файл ${f}`, 'не изменён', Buffer.compare(inB, outB) === 0 ? 'не изменён' : 'ИЗМЕНЁН: ' + firstDiff(inB.toString('utf8'), outB.toString('utf8'))]);
    }
  }
  stats[2][0]++;
  if (report(2, n, pairs, `${run.ms} мс`)) stats[2][1]++;
}

// (3) настоящий слепок
header('ФАЗА 3. НАСТОЯЩИЙ СЛЕПОК: скрипт против оракула и против секций, собранных ведущим');
const realDir = path.join(HERE, 'real');
for (const r of fs.existsSync(realDir) ? fs.readdirSync(realDir).sort() : []) {
  const dir = path.join(realDir, r);
  const name = `real-${r}`;
  const run = readRun(name);
  const o = edges(path.join(dir, 'services'), manifestOf(dir));
  const gp = flatPrint(parseOut(run.out));
  const pairs = [['код выхода', '0', run.rc]];
  for (const [f, e] of flatPrint(o)) pairs.push([`оракул: ${f}`, e, gp.get(f) ?? '(нет)']);
  for (const f of walk(path.join(dir, 'services'))) {
    const inT = fs.readFileSync(path.join(dir, 'services', f), 'utf8');
    const outT = fs.readFileSync(path.join(OUT, name, 'services', f), 'utf8');
    const card = f.match(/^([^/]+)\.md$/)?.[1];
    const want = card && o.cards[card] ? o.cards[card].newText : inT;
    pairs.push([`оракул: файл ${f}`, 'совпадает', outT === want ? 'совпадает' : firstDiff(want, outT)]);
    pairs.push([`ведущий: файл ${f}`, 'совпадает', outT === inT ? 'совпадает' : firstDiff(inT, outT)]);
  }
  stats[3][0]++;
  if (report(3, name, pairs, `${run.ms} мс`)) stats[3][1]++;
}

console.log('\nЗАМЕТКИ (не ошибки)');
for (const s of notes) console.log('  ' + s);
console.log('\nИТОГ');
console.log(`  фаза 1 (оракул ↔ expect):  случаев ${stats[1][0]}, с расхождением ${stats[1][1]}`);
console.log(`  фаза 2 (скрипт ↔ expect):  случаев ${stats[2][0]}, с расхождением ${stats[2][1]}`);
console.log(`  фаза 3 (настоящий слепок): случаев ${stats[3][0]}, с расхождением ${stats[3][1]}`);
console.log(`  всего расхождений (полей): ${bad.length}`);
process.exit(bad.length ? 1 : 0);
