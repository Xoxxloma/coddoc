// Сравнить два снимка overview-coverage.mjs (SNAP=…): слова обзора (набор и порядок) и оглавление по документам.
// Запуск: node snap-diff.mjs <до.json> <после.json>
import { readFileSync } from 'node:fs';
const [a, b] = process.argv.slice(2).map((f) => JSON.parse(readFileSync(f, 'utf8')));
const bag = (s) => { const m = new Map(); for (const w of s.split(' ')) m.set(w, (m.get(w) || 0) + 1); return m; };
let same = 0, order = 0, words = 0, toc = 0;
const show = [];
for (const k of Object.keys(a)) {
  const x = a[k], y = b[k];
  if (!y) { words++; show.push(`${k}: нет в «после»`); continue; }
  const ba = bag(x.words), bb = bag(y.words);
  const lost = [...ba].filter(([w, n]) => (bb.get(w) || 0) < n).map(([w, n]) => `${w}×${n - (bb.get(w) || 0)}`);
  const added = [...bb].filter(([w, n]) => (ba.get(w) || 0) < n).map(([w, n]) => `${w}×${n - (ba.get(w) || 0)}`);
  const tocDiff = JSON.stringify(x.toc) !== JSON.stringify(y.toc);
  if (lost.length || added.length) { words++; show.push(`${k}: слова − ${lost.slice(0, 8).join(' ')} | + ${added.slice(0, 8).join(' ')}`); }
  else if (x.words !== y.words) { order++; if (order <= 6) show.push(`${k}: тот же набор слов, другой порядок`); }
  if (tocDiff) { toc++; if (toc <= 6) show.push(`${k}: оглавление\n   до:    ${x.toc.join(' | ')}\n   после: ${y.toc.join(' | ')}`); }
  if (!lost.length && !added.length && x.words === y.words && !tocDiff) same++;
}
console.log(show.join('\n'));
console.log(`\nдокументов ${Object.keys(a).length}: совпали ${same}; другой набор слов ${words}; другой порядок ${order}; другое оглавление ${toc}`);
