// Независимый оракул для service-map/reference/edges.py (Шаг 5: обратные рёбра).
// Написан по контракту координатора, БЕЗ чтения edges.py. Ничего не пишет на диск.
//   node oracle.mjs <папка services> <manifest.yaml>  → JSON: числа печати и новые тексты карточек
//
// Решения там, где контракт молчит (кандидаты в «неоднозначность»):
//  B1. Имена слепка — значения `name:` в строках манифеста (YAML-комментарии «# …» не в счёт), по порядку.
//  B2. Ключ сортировки пустого вызова — его зеркальная ячейка «—» (а не пустая строка).
//  B3. Равные ключи (источник, вызов) — в порядке обхода: карточки по манифесту, внутри — по файлу.
//  B4. «зеркал всего M» — сумма зеркал, записанных в карточки с секцией; зеркала в карточку без
//      секции «Кто меня потребляет» не пишутся и в M не входят.
//  B5. Ячейки делятся по неэкранированной «|»; «\|» остаётся внутри ячейки как есть.
//  B6. Вставленный блок кончается пустой строкой и переводами «\n», в том числе в конце файла.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HEAD = '## Кто меня потребляет';

export function manifestNames(text) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    if (/^\s*#/.test(raw)) continue;
    const m = raw.match(/^\s*(?:-\s*)?name:\s*(.*?)\s*$/);
    if (m && m[1]) out.push(m[1].replace(/^["']|["']$/g, ''));
  }
  return out;
}

function cells(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim());
}
const isSep = (c) => c.length > 0 && c.every((x) => /^:?-+:?$/.test(x));

// строки данных таблицы секции `title` (без заголовка, разделителя и строк с «—» в первой ячейке)
function tableRows(text, title) {
  const lines = text.split('\n').map((l) => l.replace(/\r$/, ''));
  const rows = [];
  let inSec = false;
  for (const l of lines) {
    if (l.startsWith('## ')) { inSec = l.trim() === `## ${title}`; continue; }
    if (inSec && l.startsWith('|')) rows.push(cells(l));
  }
  return rows.filter((c, i) => !isSep(c) && !(i + 1 < rows.length && isSep(rows[i + 1])) && c[0] !== '—');
}

const bytes = (s) => Buffer.from(s, 'utf8');
const cmp = (a, b) => Buffer.compare(bytes(a), bytes(b));

// Строки секции «Кто меня потребляет»: { src, key, line } без заголовка, разделителя и пустой формы.
function sectionRows(text) {
  const out = [];
  let inSec = false; let hdr = false;
  for (const raw of text.split(/\r?\n/)) {
    if (raw.startsWith('## ')) { inSec = raw.startsWith(HEAD); hdr = false; continue; }
    if (!inSec || !raw.startsWith('|')) continue;
    if (/^\|[ \t:|-]*$/.test(raw)) { hdr = true; continue; }
    if (!hdr) continue;
    const c = cells(raw);
    const src = (c[0] ?? '').replace(/`/g, '').trim();
    if (src === '' || src === '—') continue;
    const call = (c[1] ?? '').replace(/`/g, '').trim() || '—';
    out.push({ src, key: call, line: raw });
  }
  return out;
}

export function edges(servicesDir, manifestPath, only = null) {
  const names = manifestNames(fs.readFileSync(manifestPath, 'utf8'));
  const snap = [...new Set(names)].filter((n) => fs.existsSync(path.join(servicesDir, `${n}.md`)));
  const texts = Object.fromEntries(snap.map((n) => [n, fs.readFileSync(path.join(servicesDir, `${n}.md`), 'utf8')]));
  const mirrors = Object.fromEntries(snap.map((n) => [n, []]));
  const skipped = Object.fromEntries(snap.map((n) => [n, 0]));
  let seq = 0;
  for (const src of snap) {
    const take = (c, call, why) => {
      const tgt = c[0].replace(/`/g, '').trim();
      if (!snap.includes(tgt) || tgt === src) { skipped[src]++; return; }
      const callCell = call === '' ? '—' : call;
      mirrors[tgt].push({ src, key: callCell.replace(/`/g, ''), line: `| \`${src}\` | ${callCell} | ${why} |`, seq: seq++ });
    };
    for (const c of tableRows(texts[src], 'Потребляемые API')) take(c, c[1] ?? '', c[2] ?? '');
    for (const c of tableRows(texts[src], 'Зависит от')) take(c, '—', c[1] ?? '');
  }
  const cards = {};
  let K = snap.length;
  let M = 0;
  // --only: сервисы прогона, их цели сейчас и прежние (строки от них в чужой секции); прочие не трогаются
  const S = only ? new Set(only.filter((n) => snap.includes(n))) : null;
  const touched = S ? new Set([...S, ...snap.filter((n) => mirrors[n].some((m) => S.has(m.src)) || sectionRows(texts[n]).some((r) => S.has(r.src)))]) : null;
  for (const n of snap) {
    if (touched && !touched.has(n)) { cards[n] = { untouched: true, section: true, mirrors: 0, skipped: skipped[n], lines: null, newText: texts[n] }; continue; }
    let rows = mirrors[n];
    if (S && !S.has(n)) rows = [...sectionRows(texts[n]).filter((r) => !S.has(r.src)).map((r) => ({ ...r, seq: -1 })), ...mirrors[n].filter((m) => S.has(m.src))];
    const list = rows.sort((a, b) => cmp(a.src, b.src) || cmp(a.key, b.key) || a.seq - b.seq).map((m) => m.line);
    const lines = texts[n].split(/(?<=\n)/); // строки с окончаниями
    const i = lines.findIndex((l) => l.replace(/\r?\n$/, '') === HEAD);
    if (i < 0) {
      cards[n] = { section: false, mirrors: list.length, skipped: skipped[n], lines: null, newText: texts[n] };
      continue;
    }
    let j = i + 1;
    while (j < lines.length && !lines[j].startsWith('## ')) j++;
    const block = [HEAD, '| Сервис | Что вызывает | Зачем |', '|---|---|---|', ...(list.length ? list : ['| — | | |']), ''];
    // концы строк секции — как у её заголовка в карточке (CRLF после выгрузки git на Windows), как в edges.py
    const eol = /\r\n$/.test(lines[i]) ? '\r\n' : '\n';
    const newText = lines.slice(0, i).join('') + block.map((l) => l + eol).join('') + lines.slice(j).join('');
    cards[n] = { section: true, mirrors: list.length, skipped: skipped[n], lines: block, newText };
    M += list.length;
  }
  return {
    'нет': K === 0,
    K,
    M,
    'зеркал': Object.fromEntries(snap.filter((n) => cards[n].section && !cards[n].untouched).map((n) => [n, cards[n].mirrors])),
    'пропусков': Object.fromEntries(snap.filter((n) => skipped[n] > 0 && (!S || S.has(n))).map((n) => [n, skipped[n]])),
    'не тронута': snap.filter((n) => !cards[n].section),
    cards,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const [, , dir, man] = process.argv;
  if (!dir || !man) { console.error('usage: node oracle.mjs <services> <manifest.yaml>'); process.exit(2); }
  const r = edges(dir, man);
  for (const c of Object.values(r.cards)) delete c.newText;
  console.log(JSON.stringify(r, null, 1));
}
