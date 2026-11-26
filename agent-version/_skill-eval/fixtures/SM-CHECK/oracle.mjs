// Независимый оракул для service-map-2.0/reference/check.py.
// Написан по контракту (бриф задачи + service-map/SKILL.md «Гард на утоньшение» + card.template.md),
// БЕЗ чтения check.py. Считает те же числа, что скрипт печатает.
//
//   node oracle.mjs <опись> <черновик> [<прежняя>]   → JSON с числами
//
// Решения там, где контракт молчит (каждое — кандидат в «неоднозначность контракта»):
//  A1. Строка описи без отступа, начинающаяся с «#», «⟹» или «(», ключом не является
//      («(нет — тип backend)» — пометка, а не ключ). «справочник:» ключа не даёт (контракт).
//  A2. «Без файла-источника» проверяется только у строк-ключей (верхний уровень), не у фактов:
//      гейт SKILL.md — «в описи против каждого ключа стоит файл». Файл — в хвосте после
//      последнего « — » есть токен с «/» или «имя.расш».
//  A3. «состояние: X.поле …» → «объект X», X = первое слово после «состояние:», до первой точки.
//  A4. Пара ключа описи в черновике: блоки (контракт, топики, задачи, сущности, бизнес),
//      первая колонка «Экраны»/«Роли и доступ»/«Зависит от», ВТОРАЯ колонка (вызов) «Потребляемых API».
//      «Нет в описи» считается только по классам описи из брифа: контракт, сущности, задачи,
//      топики, бизнес-правила, экраны, роли.
//  A5. Группы «Что умеет»: HTTP-ключи контракта по первым двум сегментам пути без обвязки (ведущие
//      «api»/«openapi»/«vN» не в счёт, параметр «:x»/«{x}» обрывает), плюс каждая фоновая задача и
//      каждый потребляемый топик.
//  A6. [уточнено координатором] Строка таблицы, у которой первая ячейка после нормализации — «—»
//      (пустая форма «| — | | |» и строка знания «| — | не определено: … |»), ключом не является
//      ни в одном классе и в «строк таблиц» не считается.
//  A7. Гард — по МНОЖЕСТВАМ ключей (SKILL.md: «возьми множества ключей»): дубли строк — один ключ.
//  A8. [уточнено координатором] Ключ роли («Роли и доступ») — текст ячейки до первого « — »;
//      область в скобках остаётся частью ключа. Одинаково для прежней карточки и черновика;
//      в описи ключ роли — как у любой строки: до « — ». Другие таблицы не режутся.
//  A10. [уточнено координатором] Строка описи без отступа, начинающаяся с «<!--» (строка свежести части), ключом не является.
//  A9. [уточнено координатором] Строка описи без « — » — ключ без файла, кроме подписи вида
//      «Эндпоинты:» (строка кончается двоеточием).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SEP = ' — ';
const VERB = /^(get|post|put|patch|delete|head|options)$/i;

export function norm(s) {
  let t = String(s ?? '').replace(/[`«»]/g, '').replace(/\s+/g, ' ').trim();
  const sp = t.indexOf(' ');
  const first = sp < 0 ? t : t.slice(0, sp);
  if (VERB.test(first)) t = first.toUpperCase() + (sp < 0 ? '' : t.slice(sp));
  return t;
}

function headKey(h) {
  const i = h.indexOf(SEP);
  return norm(i < 0 ? h : h.slice(0, i));
}

// A11. Ключ по шаблону (card.template.md, «Ключи строк»; общий у check.py и assemble.py): контракт —
// метод и путь без строки запроса (хвост после «?» без «/») либо тип операции и имя без аргументов;
// топик — направление и текст в бэктиках, без них — единственное слово после направления; сущность и
// задача — одно слово. Не сводится — '' (берётся как есть, «ключ не опознан»).
const HTTPV = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) /;
export function kcanon(cls, h) {
  const k = norm(h);
  if (cls === 'контракт') {
    if (HTTPV.test(k)) { const [v, p = ''] = k.split(' '); const kk = `${v} ${p}`; const m = kk.match(/\?[^/]*$/); return m ? kk.slice(0, m.index) : kk; } // путь — одно слово
    if (/^(query|mutation|subscription|rpc) /.test(k)) return k.replace(/ *\(.*\)$/, '');
    if (/^[A-Za-z_][A-Za-z0-9_.]*[./][A-Za-z_][A-Za-z0-9_]*(\(.*\))?$/.test(k)) return k;
    return '';
  }
  if (cls === 'топики') {
    const d = k.split(' ')[0];
    if (!/^(публикует|потребляет|транспорт)$/.test(d)) return '';   // транспорт — общая обвязка брокера, как в keys.awk
    const t = h.match(/`[^`]+`/);
    if (t) return d + ' ' + t[0].slice(1, -1);
    const rest = k.slice(d.length + 1);
    return rest !== '' && !rest.includes(' ') ? d + ' ' + rest : '';
  }
  if (cls === 'сущности' || cls === 'задачи') return k !== '' && !k.includes(' ') ? k : '';
  return k;
}
// ключ строки описи и вызова «Потребляемых API»: класс — по виду строки
export function kopis(h) {
  const k = norm(h);
  if (/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|query|mutation|subscription|rpc) /.test(k)) return kcanon('контракт', h) || k;
  if (/^(публикует|потребляет|транспорт) /.test(k)) return kcanon('топики', h) || k;
  // вызов соседа: «<сервис> <вызов>» или «<сервис> :: <вызов>» — ключ «<сервис> :: <вызов>», как у строки карточки
  const m = k.match(/^([^ :]+)(?: ::)? ((?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|query|mutation|subscription|rpc) .*)$/);
  if (m) return `${m[1]} :: ${kopis(m[2])}`;
  return k;
}
// A19. [срез 0] Ключ сравнения. У HTTP-ключа путь — сегменты через «/»; параметр — целый сегмент в любой записи:
// `{x}`, `{x:регэксп}`, `:x`, `<x>`, `<тип:x>`, `*`; имя с точкой (`{upload.s3.public_url}`, путь из конфига) — не
// параметр, а часть пути; пустые сегменты (двойной и хвостовой «/») не в счёт. Сверка (опись ↔ черновик, план,
// гард, авторы частей) — без имени параметра: ck(k). Дубль черновика и повтор строки описи — с именем: ck(k, true)
// (`:id` = `{id}`, но `{ids}` ≠ `{userId}`). Вызов соседа «<сервис> :: <вызов>» — так же его вызов. Не HTTP — как
// есть. Показывается ключ, как его написал автор.
function paramName(seg) {
  const m = seg.match(/^\{([A-Za-z_]\w*)(?::.*)?\}$/) || seg.match(/^:([A-Za-z_]\w*)$/) || seg.match(/^<(?:[A-Za-z_]\w*:)?([A-Za-z_]\w*)>$/);
  if (m) return m[1];
  return seg === '*' ? '' : null;
}
export function ck(k, names = false) {
  const i = k.indexOf(' :: ');
  if (i >= 0) return k.slice(0, i + 4) + ck(k.slice(i + 4), names);
  const m = k.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) (\S*)/);
  if (!m) return k;
  let p = m[2].split('/').filter((s, j) => j === 0 || s !== '').map((s) => {
    const n = paramName(s);
    return n === null ? s : names ? `{${n}}` : '{}';
  }).join('/');
  if (p === '') p = '/';
  else if (!p.startsWith('/')) p = '/' + p;
  return `${m[1]} ${p}`;
}
const ckn = (k) => ck(k, true);
const CANON_SECTIONS = new Set(['Публичный контракт', 'Владеет данными', 'Фоновые задачи', 'События']);
function blockKey(sec, cls, header) {
  const i = header.indexOf(SEP);
  const h = i < 0 ? header : header.slice(0, i);
  if (!CANON_SECTIONS.has(sec)) return { key: norm(h), bad: false };
  const k = kcanon(cls, h);
  return k ? { key: k, bad: false } : { key: norm(h), bad: true };
}

function splitLines(text) {
  return String(text ?? '').replace(/^﻿/, '').split(/\r?\n/).map((l) => l.replace(/\r$/, ''));
}

// ---------- карточка (черновик или прежняя) ----------

const BLOCK_SECTIONS = {
  'Публичный контракт': 'контракт',
  'Публичный API': 'контракт',
  'Владеет данными': 'сущности',
  'Фоновые задачи': 'задачи',
  'События': 'топики',
  'Бизнес-правила': 'бизнес',
};
const TABLE_SECTIONS = {
  'Экраны': 'экраны',
  'Роли и доступ': 'роли',
  'Зависит от': 'зависит',
  'Потребляемые API': 'api',
  'Состояние и данные': 'состояние',   // фронт: что хранится — пара строкам описи, в «нет в описи» не идёт
};

function cells(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim());
}
const isSep = (r) => {
  const c = cells(r);
  return c.length > 0 && c.every((x) => /^:?-+:?$/.test(x));
};
// пустая форма и строка знания: первая ячейка после нормализации — «—» (A6)
const isDashRow = (r) => norm(cells(r)[0]) === '—';
// ключ роли: до первого « — », скобка с областью остаётся (A8)
const roleKey = (c) => headKey(c[0]);

// orphan — файл части: блоки до первого `## ` — в секцию по форме ключа каждого блока (как кладёт склейка):
// ключ контракта — «Публичный контракт», топика — «События», иначе блок не считается.
export function parseCard(text, orphan = false) {
  const blocks = { контракт: [], сущности: [], задачи: [], топики: [], бизнес: [] };
  const rawRows = { экраны: [], роли: [], зависит: [], api: [], состояние: [] };
  let sec = null;
  let cur = null;
  let orph = false;
  for (const line of splitLines(text)) {
    const h = line.match(/^#{1,2} (.*)$/);
    if (h) {
      sec = line.startsWith('## ') ? h[1].trim() : null;
      cur = null;
      orph = false;
      continue;
    }
    if (line.startsWith('### ') && orphan && (sec === null || orph)) {
      orph = true;
      const hh = line.slice(4).split(SEP)[0];
      sec = kcanon('контракт', hh) ? 'Публичный контракт' : kcanon('топики', hh) ? 'События' : null;
    }
    if (line.startsWith('### ')) {
      const cls = BLOCK_SECTIONS[sec];
      cur = cls ? { header: line.slice(4), body: false, unav: false, ...blockKey(sec, cls, line.slice(4)) } : null;
      if (cls) blocks[cls].push(cur);
      continue;
    }
    if (cur && line.startsWith('- ')) { cur.body = true; if (line.startsWith('- недоступно')) cur.unav = true; }
    const t = TABLE_SECTIONS[sec];
    if (t && line.startsWith('|')) rawRows[t].push(line);
  }
  const tables = {};
  for (const [t, rows] of Object.entries(rawRows)) {
    tables[t] = [];
    rows.forEach((r, i) => {
      if (isSep(r)) return;
      if (i + 1 < rows.length && isSep(rows[i + 1])) return; // строка заголовка
      if (isDashRow(r)) return;
      const c = cells(r); c.unav = r.includes('недоступно');   // пометка «недоступно» — словом в строке
      tables[t].push(c);
    });
  }
  return { blocks, tables };
}

function blockMap(list) {
  const m = new Map();
  for (const b of list) {
    const k = b.key;
    m.set(k, (m.get(k) ?? false) || b.body);
  }
  return m;
}
function bizKey(header) {
  const k = headKey(header);
  if (k.startsWith('сообщение')) return { kind: 'msg', key: k };
  if (k.startsWith('ограничение')) return { kind: 'lim', key: k };
  return { kind: 'obj', key: 'объект ' + k };
}

export const GUARD_CLASSES = ['контракт', 'сущности', 'задачи', 'топики', 'экраны', 'потребляемые API', 'роли', 'зависит от'];

// Сведённый ключ гарда (keys.awk k_role, k_dep, k_nopre) — второй проход, только для ключей без точной
// пары: то же, записанное в двух сканах по-разному, — одна пара.
const kRole = (k) => k.replace(/[ \t]*\(.*$/, '');
export function kDep(k) {
  let r = k.replace(/[ \t]*\(.*$/, '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[A-Z]/g, (c) => c.toLowerCase()).replace(/_/g, '-');
  r = r.replace(/^clients?\./, '').replace(/^web-?client-?/, '');
  while (/[.-](host|url|uri|endpoint|base-url)$/.test(r)) r = r.replace(/[.-](host|url|uri|endpoint|base-url)$/, '');
  return r.replace(/-client$/, '');
}
const normPre = (pre) => { const p = (pre ?? '').replace(/\/+/g, '/').replace(/\/$/, '').replace(/^\//, ''); return p ? '/' + p : ''; };
function kNoPre(k, pre) {
  const m = k.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) (\/.*)$/);
  const p = normPre(pre);
  if (!m || !p) return k;
  if (m[2] === p) return `${m[1]} /`;
  return m[2].startsWith(p + '/') ? `${m[1]} ${m[2].slice(p.length)}` : k;
}
function guardKeys(card) {
  const rowMap = (rows, f) => new Map(rows.map((c) => [f(c), false]));
  return {
    'контракт': blockMap(card.blocks.контракт),
    'сущности': blockMap(card.blocks.сущности),
    'задачи': blockMap(card.blocks.задачи),
    'топики': blockMap(card.blocks.топики),
    'экраны': rowMap(card.tables.экраны, (c) => norm(c[0])),
    'потребляемые API': rowMap(card.tables.api, (c) => norm(c[0]) + ' :: ' + kopis(c[1] ?? '')),
    'роли': rowMap(card.tables.роли, roleKey),
    'зависит от': rowMap(card.tables.зависит, (c) => norm(c[0])),
  };
}
// Пары по классу в два прохода (check.py gmatch): ключ сравнения (A19, без имени параметра), затем среди оставшихся —
// сведённый. Повтор ключа — по тому же ключу сравнения: `{id}` и `{list_id}` одной карточки — один ключ (A7).
function guardMatch(c, p, n, prefix) {
  // A22. Справка: у одного пути (A19, без имени) в прежней карточке несколько записей (с именем), в новой — меньше:
  // строка «путь <первая запись>: блоков было N, стало M»; вердикт гарда она не меняет.
  const writings = (m) => {
    const w = new Map(); const first = new Map();
    for (const k of m.keys()) { const g = ck(k); if (!w.has(g)) { w.set(g, new Set()); first.set(g, k); } w.get(g).add(ckn(k)); }
    return [w, first];
  };
  const [pw, pf] = writings(p); const [nw] = writings(n);
  const paths = [...pw].filter(([g, s]) => s.size >= 2 && (nw.get(g)?.size ?? 0) < s.size)
    .map(([g, s]) => `${pf.get(g)}: блоков было ${s.size}, стало ${nw.get(g)?.size ?? 0}`);
  const group = (m) => {
    const out = new Map(); const first = new Map();
    for (const [k, b] of m) {
      const g = ck(k);
      if (!first.has(g)) { first.set(g, k); out.set(k, b); } else { const d = first.get(g); out.set(d, out.get(d) || b); }
    }
    return out;
  };
  p = group(p); n = group(n);
  // путь контракта сводится только у черновика: прежняя карточка могла писаться без префикса, не наоборот
  const gk = c === 'роли' ? kRole
    : c === 'зависит от' ? (k) => kDep(k) || k
    : c === 'контракт' && normPre(prefix) ? (k, side) => (side === 'd' ? ck(kNoPre(k, prefix)) : ck(k)) : null;
  const P = [...p.keys()].sort(); const N = [...n.keys()].sort();
  const mate = new Map(); const taken = new Set();
  const byKey = new Map(N.map((k) => [ck(k), k]));
  for (const k of P) { const d = byKey.get(ck(k)); if (d !== undefined && !taken.has(d)) { mate.set(k, d); taken.add(d); } }
  if (gk) {
    // в группе сведённого ключа пара — с наибольшим общим началом ключа (байты UTF-8, как в check.py)
    const lcp = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); let i = 0; while (i < x.length && i < y.length && x[i] === y[i]) i++; return i; };
    const gp = new Map(); const gd = new Map();
    for (const k of P) if (!mate.has(k)) { const x = gk(k, 'p'); if (!gp.has(x)) gp.set(x, []); gp.get(x).push(k); }
    for (const k of N) if (!taken.has(k)) { const x = gk(k, 'd'); if (!gd.has(x)) gd.set(x, []); gd.get(x).push(k); }
    for (const [x, ps] of gp) {
      const ds = gd.get(x) ?? [];
      for (;;) {
        let best = -1; let bi; let bj;
        for (const a of ps) { if (mate.has(a)) continue; for (const b of ds) { if (taken.has(b)) continue; const l = lcp(a, b); if (l > best) { best = l; bi = a; bj = b; } } }
        if (best < 0) break;
        mate.set(bi, bj); taken.add(bj);
      }
    }
  }
  const gone = P.filter((k) => !mate.has(k)).length;
  const appeared = N.filter((k) => !taken.has(k)).length;
  const emptied = P.filter((k) => mate.has(k) && p.get(k) && !n.get(mate.get(k))).length;
  return [P.length, gone, appeared, emptied, paths];
}

// ---------- опись ----------

function hasFile(line) {
  const i = line.lastIndexOf(SEP);
  if (i < 0) return false;
  const tail = line.slice(i + SEP.length);
  return /[A-Za-z0-9_.-]+\/[A-Za-z0-9_.\/-]*[A-Za-z0-9_]|[A-Za-z0-9_-]+\.[A-Za-z][A-Za-z0-9]{0,5}(?![A-Za-z0-9])/.test(tail);
}

export function parseOpis(text) {
  const keys = new Map(); // key -> {kind, fact}
  const byName = new Map(); // ckn(key) -> key
  const nofile = [];
  const totals = [];
  let cur = null;
  for (let line of splitLines(text)) {
    if (line.trim() === '') continue;
    // прежняя форма объявленной без реализации операции — тот же ключ, что со строкой `недоступно:`
    if (line.startsWith('> объявлено без реализации: ')) line = line.slice('> объявлено без реализации: '.length);
    if (line.trim().startsWith('⟹')) { totals.push(line.trim()); cur = null; continue; }
    if (/^\s/.test(line)) {
      if (cur && line.trim().startsWith('·')) cur.fact = true;
      continue;
    }
    if (line.startsWith('<!--')) { cur = null; continue; } // строка свежести части — не ключ (A10)
    if (line.startsWith('#') || line.startsWith('(') || line.startsWith('>')) { cur = null; continue; } // «> пройдено: …» остатка — не ключ
    if (line.startsWith('справочник:') || line.startsWith('зависит:')) { cur = null; continue; } // улики, не ключи
    const i = line.indexOf(SEP);
    if (i < 0 && line.trim().endsWith(':')) { cur = null; continue; } // подпись «Эндпоинты:» (A9)
    const kt = i < 0 ? line : line.slice(0, i);
    let key;
    let kind = 'other';
    if (kt.startsWith('вход:')) {
      key = 'вход'; // пара — строка «вход» в «Роли и доступ»
      if (line.includes('не определено')) { if (!keys.has(key)) keys.set(key, { kind, fact: false }); cur = keys.get(key); continue; } // ответ без файла — тоже ответ
    } else if (kt.startsWith('состояние:')) {
      const rest = norm(kt.slice('состояние:'.length));
      key = 'объект ' + rest.split(' ')[0].split('.')[0];
      kind = 'obj';
    } else if (kt.startsWith('сообщение:')) {
      key = norm('сообщение ' + kt.slice('сообщение:'.length));
      kind = 'msg';
    } else if (kt.startsWith('ограничение:')) {
      key = norm('ограничение ' + kt.slice('ограничение:'.length));
      kind = 'lim';
    } else {
      key = kopis(kt.replace(/^[Рр]оль:\s*/, '')); // «роль: OWNER» ↔ строка таблицы «OWNER»; ключ по шаблону (A11)
    }
    // повтор ключа с тем же именем параметра пути (`:id` = `{id}`, A19) — один ключ, показан первый
    const g = ckn(key);
    if (byName.has(g)) key = byName.get(g); else byName.set(g, key);
    if (!hasFile(line)) nofile.push(key);
    if (!keys.has(key)) keys.set(key, { kind, fact: false });
    cur = keys.get(key);
  }
  return { keys, nofile, totals };
}

// ---------- группы «Что умеет» ----------

// HTTP: путь без общего префикса приложения и сегментов версии `v<число>`; ведущие сегменты, общие для всех путей
// (не параметр; у самого короткого остаётся свой), — обвязка; группа — два первых сегмента после неё, параметр обрывает.
function httpGroups(paths, prefix) {
  const pfx = prefix ? '/' + prefix.replace(/\/+/g, '/').replace(/^\//, '').replace(/\/$/, '') : '';
  const segs = paths.map((k) => {
    if (pfx && pfx !== '/' && (k === pfx || k.startsWith(pfx + '/'))) k = k.slice(pfx.length);
    return k.split('/').slice(1).filter((x) => x !== '' && !/^v\d+$/.test(x));
  });
  let c = 0;
  if (segs.length > 1) {
    const mn = Math.min(...segs.map((s) => Math.max(s.length, 1)));
    while (c < mn - 1 && !/^[:{]/.test(segs[0][c] ?? '') && segs.every((s) => s[c] === segs[0][c])) c++;
  }
  return segs.map((s) => {
    if (c >= s.length || /^[:{]/.test(s[c])) return '/';
    return '/' + s[c] + (c + 1 < s.length && !/^[:{]/.test(s[c + 1]) ? '/' + s[c + 1] : '');
  });
}

// брокер в строке «Стека»: слово «шина» в ячейке слоя или слово «брокер»; у строки таблицы — только с продуктом во
// второй ячейке: «нет», прочерк или пусто — брокера нет (`| Шина | нет |`, `| Шина | — |`) [срез 0]
function isBroker(l) {
  const c = l.startsWith('|') ? l.split('|') : null;
  const cell = c ? (c[1] ?? '').replace(/`/g, '').trim() : '';
  if (!(/(^|[\s,(/])шина/i.test(cell) || /брокер/i.test(l))) return false;
  if (!c) return true;
  const prod = (c[2] ?? '').replace(/`/g, '').trim();
  return !(prod === '' || /^[—–-]$/.test(prod) || /^нет(?![а-яё])/i.test(prod));
}

// ---------- всё вместе ----------

// opt.parts — нарезанный сервис (CHECK_PARTS): строки «Бизнес-правил» описи без блока сверяются с описями частей,
// а не здесь («нет в черновике» их не считает); opt.prefix — общий префикс разведчика (CHECK_PREFIX) для ключа гарда.
export function analyze(opisText, draftText, prevText, opt = {}) {
  const d = parseCard(draftText);
  const o = parseOpis(opisText);
  { // ключ описи вызовом при том же ключе без скобок — один ключ (после склейки частей бывают оба)
    const callBare = (k) => (/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) /.test(k) || !/[^ (]\(.*\)$/.test(k) ? k : k.replace(/\(.*\)$/, ''));
    for (const [k, v] of [...o.keys]) { const b = callBare(k); if (b !== k && o.keys.has(b)) { if (v.fact) o.keys.get(b).fact = true; o.keys.delete(k); } }
  }

  const cnt = (list) => [list.length, list.filter((b) => b.body).length, list.filter((b) => !b.body).length];
  const topicDir = (b) => b.key.split(' ')[0];
  const biz = d.blocks.бизнес.map((b) => bizKey(b.header));
  const draft = {
    'контракт': cnt(d.blocks.контракт),
    'сущности': cnt(d.blocks.сущности),
    'задачи': cnt(d.blocks.задачи),
    'топики': [d.blocks.топики.length,
      d.blocks.топики.filter((b) => topicDir(b) === 'потребляет').length,
      d.blocks.топики.filter((b) => topicDir(b) === 'публикует').length],
    'бизнес': ['obj', 'msg', 'lim'].map((k) => biz.filter((x) => x.kind === k).length),
    'таблицы': [d.tables.экраны.length, d.tables.роли.length, d.tables.зависит.length, d.tables.api.length],
  };

  const okinds = [...o.keys.values()].map((v) => v.kind);
  const opis = {
    'ключей': o.keys.size,
    'бизнес': ['obj', 'msg', 'lim'].map((k) => okinds.filter((x) => x === k).length),
    'без файла': o.nofile.length,
    'итоги': o.totals,
  };

  // индекс ключей черновика: ключ с именем параметра (A19) -> {cls, blocks, raws — ключи блоков, как написаны}
  const idx = new Map();
  const classKeys = { контракт: new Set(), сущности: new Set(), задачи: new Set(), топики: new Set(), бизнес: new Set(), экраны: new Set(), роли: new Set() };
  const classKn = { контракт: new Set(), сущности: new Set(), задачи: new Set(), топики: new Set(), бизнес: new Set(), экраны: new Set(), роли: new Set() };
  const add = (cls, key, block) => {
    if (classKeys[cls]) { classKeys[cls].add(key); classKn[cls].add(ckn(key)); }
    const g = ckn(key);
    if (!idx.has(g)) idx.set(g, { cls, blocks: [], raws: [] });
    const e = idx.get(g);
    if (e.cls === cls && block) { e.blocks.push(block); e.raws.push(key); }
  };
  for (const b of d.blocks.контракт) add('контракт', b.key, b);
  for (const b of d.blocks.топики) add('топики', b.key, b);
  for (const b of d.blocks.задачи) add('задачи', b.key, b);
  for (const b of d.blocks.сущности) add('сущности', b.key, b);
  for (const b of d.blocks.бизнес) add('бизнес', bizKey(b.header).key, b);
  for (const c of d.tables.экраны) add('экраны', norm(c[0]));
  for (const c of d.tables.роли) add('роли', roleKey(c));
  // вызов соседа — ключ «<сервис> :: <вызов>» (как check.py); строка описи с одним вызовом сводится к нему
  const altApi = new Map();
  for (const c of d.tables.api) { const full = `${norm(c[0])} :: ${kopis(c[1] ?? '')}`; add('потребляет', full); altApi.set(ckn(kopis(c[1] ?? '')), ckn(full)); }
  for (const c of d.tables.зависит) add('зависит', norm(c[0]));
  for (const c of d.tables.состояние ?? []) add('состояние', norm(c[0]));

  // Пара ключу описи: точная (строки запроса и аргументов в ключах обеих сторон уже нет, A11).
  const pair = new Map();
  const taken = new Set();
  for (const k of o.keys.keys()) if (idx.has(ckn(k))) { pair.set(k, ckn(k)); taken.add(ckn(k)); }
  for (const k of o.keys.keys()) if (!pair.has(k) && altApi.has(ckn(k))) { pair.set(k, altApi.get(ckn(k))); taken.add(altApi.get(ckn(k))); }
  // ключ сравнения без имени параметра пути (A19: `{id}` ↔ `{list_id}`) — среди ключей черновика без пары; у вызова
  // соседа — и без сервиса
  const freeK = new Map();
  for (const [g, e] of idx) {
    if (taken.has(g)) continue;
    if (!freeK.has(ck(g))) freeK.set(ck(g), g);
    if (e.cls === 'потребляет') { const c = ck(g.split(' :: ')[1] ?? ''); if (!freeK.has(c)) freeK.set(c, g); }
  }
  for (const k of o.keys.keys()) {
    if (pair.has(k)) continue;
    const g = freeK.get(ck(k));
    if (g !== undefined && !taken.has(g)) { pair.set(k, g); taken.add(g); }
  }
  // второй проход — ключ контракта без HTTP-глагола сводится без хвоста в скобках («Svc.Assign(Req)»)
  const HTTP = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) /;
  const nop = (k) => (HTTP.test(k) || !/[^ (]\(.*\)$/.test(k) ? k : k.replace(/\(.*\)$/, '')); // хвост-вызов: скобка без пробела перед ней
  const freeP = new Map();
  for (const [k, e] of idx) if (!taken.has(k) && e.cls === 'контракт' && !freeP.has(nop(ck(k)))) freeP.set(nop(ck(k)), k);
  for (const k of o.keys.keys()) {
    if (pair.has(k)) continue;
    const dk = freeP.get(nop(ck(k)));
    if (dk !== undefined && !taken.has(dk)) { pair.set(k, dk); taken.add(dk); }
  }
  // четвёртый проход — операция GraphQL с типом и без него («mutation saveTask» ↔ «saveTask»)
  const bop = (k) => nop(k).replace(/^(query|mutation|subscription) /, '');
  const freeO = new Map();
  for (const [k, e] of idx) if (!taken.has(k) && e.cls === 'контракт' && !freeO.has(bop(ck(k)))) freeO.set(bop(ck(k)), k);
  for (const k of o.keys.keys()) {
    if (pair.has(k)) continue;
    const dk = freeO.get(bop(ck(k)));
    if (dk !== undefined && !taken.has(dk)) { pair.set(k, dk); taken.add(dk); }
  }
  // один ключ двумя блоками: с хвостом в скобках и без либо тот же ключ (с именем параметра, A19) дважды
  const BLOCKC = new Set(['контракт', 'сущности', 'задачи', 'топики']);
  const dupItems = [
    ...[...idx].filter(([k, e]) => e.cls === 'контракт' && nop(k) !== k && idx.get(nop(k))?.cls === 'контракт').map(([k, e]) => [idx.get(nop(k)).raws[0] ?? nop(k), e.raws[0] ?? k]),
    ...[...idx].filter(([, e]) => BLOCKC.has(e.cls) && e.blocks.length > 1).map(([, e]) => [e.raws[0], e.raws[1]]),
  ];
  const dups = dupItems.length;
  const byClass = {};
  let missingInDraft = 0;
  let factEmpty = 0;
  const emptyList = [];
  for (const [k, v] of o.keys) {
    const e = pair.has(k) ? idx.get(pair.get(k)) : undefined;
    if (!e && opt.parts && v.kind !== 'other') { byClass['«Бизнес-правила» — по описям частей'] = (byClass['«Бизнес-правила» — по описям частей'] ?? 0) + 1; continue; }
    if (!e) { missingInDraft++; byClass['без пары'] = (byClass['без пары'] ?? 0) + 1; continue; }
    byClass[e.cls] = (byClass[e.cls] ?? 0) + 1;
    if (v.fact && e.blocks.length > 0 && e.blocks.every((b) => !b.body)) { factEmpty++; emptyList.push(k); }
  }
  let missingInOpis = 0;
  for (const set of Object.values(classKn)) for (const k of set) if (!taken.has(k)) missingInOpis++;

  const groups = new Set(); const http = [];
  for (const k of classKeys.контракт) {
    const m = k.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) (\S+)/);
    if (m && m[2].startsWith('/')) { http.push(m[2]); continue; }
    // gRPC и `Класс.метод` — по сервису или классу, GraphQL — по операции
    let g = k.replace(/^rpc /, '').replace(/\(.*$/, '');
    g = (!/ /.test(g) && /\./.test(g)) ? g.replace(/\.[^.]*$/, '') : k;
    groups.add(g);
  }
  for (const g of httpGroups(http, opt.prefix)) groups.add(g);
  for (const k of classKeys.задачи) groups.add('задача ' + k);
  for (const k of classKeys.топики) if (k.startsWith('потребляет')) groups.add(k);

  // перечень добора (SKILL.md 3.0.8): ключ описи с источником без блока и ключ описи без источника
  // при блоке в карточке (оба — кроме «Бизнес-правил»), факт описи при пустом блоке, один ключ двумя
  // блоками. Сверка запись не останавливает.
  const nofile = new Set(o.nofile);
  const missSrc = [...o.keys].filter(([k, v]) => !pair.has(k) && v.kind === 'other' && !nofile.has(k)).length;
  const pairNoSrc = [...o.keys].filter(([k, v]) => pair.has(k) && v.kind === 'other' && nofile.has(k)).length;
  // ключи карточки по классам — для маркерного гейта: ключ контракта вызовом при том же ключе
  // без скобок — один ключ; перегрузки без голого ключа — разные.
  const cardKeys = {};
  for (const c of ['контракт', 'сущности', 'задачи', 'топики', 'экраны']) {
    const set = classKn[c];
    cardKeys[c] = [...set].filter((k) => !(c === 'контракт' && nop(k) !== k && set.has(nop(k)))).length;
  }
  draft['ключи'] = cardKeys;
  // пункты перечня добора списками — для раскладки по авторам (не поле сравнения)
  const METH = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) |^(query|mutation|subscription) |^[A-Za-z_][A-Za-z0-9_.]*[.\/][A-Za-z_][A-Za-z0-9_]*$/;
  const items = {
    ADD: [...o.keys].filter(([k, v]) => !pair.has(k) && v.kind === 'other' && !nofile.has(k)).map(([k]) => [k]),
    NOSRC: [...o.keys].filter(([k, v]) => pair.has(k) && v.kind === 'other' && nofile.has(k)).map(([k]) => [k]),
    EMPTY: emptyList.map((k) => [k]),
    DUP: dupItems,
    nometh: [...classKeys.контракт].filter((k) => !METH.test(k)).map((k) => [k]),
    NOKEY: [...new Set(['сущности', 'задачи', 'топики'].flatMap((c) => d.blocks[c].filter((b) => b.bad).map((b) => b.key)))].map((k) => [k]),
  };
  const sverka = {
    'добор': `${missSrc}/${pairNoSrc}/${factEmpty}/${dups}`,
    'нет в черновике': missingInDraft,
    'нет в описи': missingInOpis,
    'факт, пустой блок': factEmpty,
    'по классам': byClass,
    'групп': groups.size,
  };

  let guard = null;
  let fired = [];
  let route = null;
  const paths = [];
  if (prevText !== null && prevText !== undefined) {
    const P = guardKeys(parseCard(prevText));
    const N = guardKeys(d);
    guard = {};
    for (const c of GUARD_CLASSES) {
      const [was, gone, appeared, emptied, pp] = guardMatch(c, P[c], N[c], opt.prefix);
      guard[c] = [was, gone, appeared, emptied];
      paths.push(...pp);
      if ((gone >= 3 && 3 * gone > was) || (emptied >= 3 && 3 * emptied > was)) fired.push(c);
    }
    route = fired.length ? 'В _pending' : 'ПОВЕРХ';
  }
  return { 'черновик': draft, 'опись': opis, 'сверка': sverka, 'гард': guard, 'сработал': fired, 'маршрут': route, 'пути': paths, _items: items };
}

// ---------- «== КАНДИДАТЫ ПРОВЕРОК» ----------
// Решения там, где контракт раздела молчит:
//  C1. [уточнено координатором] Роль «—» (первая ячейка «—»: пустая форма, строка знания)
//      и пустая роль переключателем не считаются.
//  C2. «Хвост-файл»: строка секции кончается `\S+/<имя>.<буквы>` (+ «`», «)», пробелы);
//      абсолютный путь «/v1/x.csv» тоже подходит. Строки до первого «## » не смотрятся.
//      [уточнено] Заголовки «### …» не кандидаты.
//  C3. «Секрет» ищется во всех строках вне ограждений, включая шапку до первого «## »;
//      [уточнено] кроме заголовков «### …».
//  C5. [уточнено] Порядок секций в «порядок блоков нарушен:» не задан — сравнивается как множество.
//  C4. Ключ порядка у HTTP-блока — «путь + пробел + ГЛАГОЛ».

const hasCode = (s) => {
  const t = s.replace(/`[^`]*`/g, '');
  return / \/[a-z]/.test(t) || /\b(GET|POST|PUT|PATCH|DELETE)\b/.test(t) || /\b[a-z]+[A-Z][A-Za-z]*\b/.test(t) || /[a-z]+\.[a-z-]+\.[a-z-]+/.test(t);
};
const isSepRow = (l) => /^\s*\|[\s:|-]*-[\s:|-]*\|?\s*$/.test(l);

export function manifestNames(text) {
  if (text === null) return null;
  const out = [];
  for (const l of splitLines(text)) {
    const m = l.match(/^\s*(?:-\s*)?name:\s*["']?([^"'\s#]+)/);
    if (m) out.push(m[1]);
  }
  return out;
}

export function findManifest(draftPath) {
  const d = path.dirname(draftPath);
  for (const p of [path.join(d, '..', 'manifest.yaml'), path.join(d, 'manifest.yaml')]) if (fs.existsSync(p)) return p;
  return null;
}

export function candidates(text, names) {
  const raw = splitLines(text);
  const vis = [];
  let fence = false;
  let sec = null;
  raw.forEach((s, i) => {
    if (/^\s*```/.test(s)) { fence = !fence; return; }
    if (fence) return;
    if (s.startsWith('## ')) sec = s.slice(3).trim();
    vis.push({ n: i + 1, s, sec });
  });
  const inSec = (p) => vis.filter((v) => v.sec !== null && p(v.sec));
  const dataRows = (p) => {
    const out = [];
    let seen = false;
    let cur = null;
    for (const v of inSec(p)) {
      if (v.sec !== cur) { cur = v.sec; seen = false; }
      if (v.s.startsWith('## ')) continue;
      if (isSepRow(v.s)) { seen = true; continue; }
      if (seen && v.s.trimStart().startsWith('|')) out.push({ ...v, c0: cells(v.s)[0] ?? '' });
    }
    return out;
  };
  const blocks = (p) => {
    const out = [];
    let cur = null;
    for (const v of inSec(p)) {
      if (v.s.startsWith('## ')) { cur = null; continue; }
      if (v.s.startsWith('### ')) { cur = { n: v.n, header: v.s.slice(4), body: [], sec: v.sec }; out.push(cur); continue; }
      if (cur) cur.body.push(v.s);
    }
    return out;
  };
  const isBR = (s) => s === 'Бизнес-правила';
  const isContract = (s) => s === 'Публичный контракт' || s === 'Публичный API';
  const nm = names ?? [];
  const r = {};

  r['бр.заголовки'] = inSec(isBR).filter((v) => v.s.startsWith('### ') && !/^`[^`]+`/.test(v.s.slice(4)) && !/^сообщение [«`]/.test(v.s.slice(4))).map((v) => v.n);
  r['бр.код'] = inSec(isBR).filter((v) => hasCode(v.s)).map((v) => v.n);
  const roles = dataRows((s) => s === 'Роли и доступ').map((v) => {
    const c = v.c0.replace(/`/g, '');
    const i = c.indexOf(SEP);
    return (i < 0 ? c : c.slice(0, i)).trim();
  }).filter((x) => x !== '' && x !== '—');
  r['бр.ограничения'] = blocks(isBR).filter((b) => b.header.startsWith('ограничение')).filter((b) => {
    const t = ['### ' + b.header, ...b.body].join('\n');
    return !nm.some((x) => t.includes(x)) && !roles.some((x) => t.includes(x));
  }).map((b) => b.n);
  r['назначение'] = inSec((s) => s === 'Назначение').filter((v) => v.s.trim() !== '' && (hasCode(v.s) || v.s.includes('`'))).map((v) => v.n);
  r['что умеет'] = dataRows((s) => s.startsWith('Что умеет')).filter((v) => hasCode(v.c0)).map((v) => v.n);
  r['стек'] = inSec((s) => s === 'Стек').filter((v) => /[0-9]/.test(v.s) && !isSepRow(v.s)).map((v) => v.n);
  r['слипшиеся'] = dataRows((s) => ['Экраны', 'Роли и доступ', 'Зависит от', 'Потребляемые API'].includes(s)).filter((v) => v.c0.includes(', ')).map((v) => v.n);
  r['не из манифеста'] = dataRows((s) => s === 'Зависит от' || s === 'Потребляемые API').filter((v) => {
    const c = v.c0.replace(/`/g, '').trim();
    return c !== '—' && !nm.includes(c) && !v.s.includes('вне манифеста');
  }).map((v) => v.n);
  r['манифест'] = names === null ? 'нет' : 'есть';
  // [уточнено координатором] строки-заголовки «### …» — ключи: ни хвост-файл, ни секрет
  r['хвост-файл'] = vis.filter((v) => v.sec !== null && !v.s.startsWith('### ') && /\S+\/[^\s\/]+\.[A-Za-z]+[`)]*\s*$/.test(v.s)).map((v) => v.n);
  r['секрет'] = vis.filter((v) => !v.s.startsWith('### ') && /[A-Za-z0-9+\/=_-]{21,}/.test(v.s.replace(/`[^`]*`/g, ''))).map((v) => v.n);
  r['события'] = blocks((s) => s === 'События').length;
  // брокер — слово «шина» в ячейке слоя (форма шаблона) или слово «брокер» в строке, продукт не важен
  r['брокер'] = inSec((s) => s === 'Стек').some((v) => isBroker(v.s)) ? 'да' : 'нет';
  r['без сущностей'] = blocks(isContract).filter((b) => {
    const k = headKey(b.header).toLowerCase();
    if (/health|metrics|ready|live|version|docs|swagger|openapi/.test(k)) return false;
    return !b.body.some((l) => l.startsWith('сущности:'));
  }).map((b) => b.n);
  const order = [];
  const secs = [...new Set(vis.filter((v) => v.sec !== null && !isBR(v.sec) && v.s.startsWith('### ')).map((v) => v.sec))];
  for (const s of secs) {
    const bl = blocks((x) => x === s);
    const key = (h) => {
      let k = h.replace(/`/g, '');
      const i = k.indexOf(SEP);
      k = (i < 0 ? k : k.slice(0, i)).trim();
      const m = isContract(s) && k.match(/^(GET|POST|PUT|PATCH|DELETE)\s+(.*)$/i);
      return m ? `${m[2]} ${m[1].toUpperCase()}` : k;
    };
    for (let i = 1; i < bl.length; i++) {
      if (Buffer.compare(Buffer.from(key(bl[i].header)), Buffer.from(key(bl[i - 1].header))) < 0) { order.push(`${s} (строка ${bl[i].n})`); break; }
    }
  }
  r['порядок'] = order.length ? order : 'соблюдён';
  // A20. [срез 2] Механические проверки (правило — регэксп, счёт, порядок; исход — добор с перечнем) — виды добора,
  // а не кандидаты: пункт — строка черновика; автор у нарезанного — по ключу блока или строки, если секция — секция
  // частей (контракт, данные, события, задачи, потребляемые API), иначе голова (route = null).
  const PARTSEC = /^(Публичный контракт|Владеет данными|События|Фоновые задачи|Потребляемые API)/;
  const ctx = new Map();
  {
    let cur = null; let curSec = null;
    for (const v of vis) {
      if (v.sec !== curSec) { curSec = v.sec; cur = null; }
      if (v.s.startsWith('## ')) { cur = null; continue; }
      if (v.s.startsWith('### ')) { const cls = BLOCK_SECTIONS[v.sec]; cur = cls ? blockKey(v.sec, cls, v.s.slice(4)).key : headKey(v.s.slice(4)); }
      let key = cur;
      if (v.s.trimStart().startsWith('|') && v.sec === 'Потребляемые API') { const c = cells(v.s); key = `${norm(c[0])} :: ${kopis(c[1] ?? '')}`; }      ctx.set(v.n, { sec: v.sec, key });
    }
  }
  const route = (n) => { const c = ctx.get(n); return c && c.sec !== null && PARTSEC.test(c.sec) ? (c.key || null) : null; };
  const at = (n) => [raw[n - 1], route(n)];
  r._form = {
    BRHDR: r['бр.заголовки'].map((n) => [raw[n - 1], null]),
    BRCODE: r['бр.код'].map((n) => [raw[n - 1], null]),
    USERCODE: [...r['назначение'], ...r['что умеет']].map((n) => [raw[n - 1], null]),
    TAILFILE: r['хвост-файл'].map(at),
    CELLS: r['слипшиеся'].map(at),
    NOENT: r['без сущностей'].map(at),
    ORDER: order.map((o) => at(+o.match(/строка (\d+)\)$/)[1])),
  };
  for (const k of ['бр.заголовки', 'бр.код', 'назначение', 'что умеет', 'слипшиеся', 'хвост-файл', 'без сущностей', 'порядок']) delete r[k];
  return r;
}

// A20. Порядок и состав секций `##` — колонка типа (`type:` шапки черновика) таблицы порядка card.template.md: нет
// секции (кроме «Заметок команды» — без notes её нет), лишняя, дважды, не по порядку. Типа в шапке нет — сверки нет.
const TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'service-map-2.0', 'reference', 'card.template.md');
function sectionItems(text) {
  const lines = splitLines(text);
  let type = '';
  if (lines[0] === '---') for (const l of lines.slice(1)) { if (l === '---') break; const m = l.match(/^type:\s*([A-Za-z]+)/); if (m) type = m[1]; }
  if (!type || !fs.existsSync(TEMPLATE)) return [];
  const t = splitLines(fs.readFileSync(TEMPLATE, 'utf8'));
  const h = t.findIndex((l) => l.startsWith('| `backend` |'));
  if (h < 0) return [];
  const col = cells(t[h]).map((c) => c.replace(/`/g, '')).indexOf(type);
  if (col < 0) return [];
  const want = [];
  for (let i = h + 1; i < t.length && t[i].startsWith('|'); i++) { if (isSep(t[i])) continue; const c = cells(t[i])[col]; if (c && c !== '—') want.push(c); }
  let fence = false; const heads = [];
  for (const l of lines) { if (/^```/.test(l)) { fence = !fence; continue; } if (!fence && l.startsWith('## ')) heads.push(l.slice(3).trim()); }
  const out = []; const seen = [];
  for (const x of heads) { if (seen.includes(x)) out.push(`секция «${x}» дважды`); else seen.push(x); }
  for (const x of seen) if (!want.includes(x)) out.push(`лишняя секция «${x}»`);
  for (const x of want) if (!seen.includes(x) && x !== 'Заметки команды') out.push(`нет секции «${x}»`);
  const got = seen.filter((x) => want.includes(x));
  if (got.join('\n') !== want.filter((x) => got.includes(x)).join('\n')) out.push('порядок секций');
  return out.map((x) => [x, null]);
}

// A21. «Владеет данными»: строка `- ` с несколькими полями (`- `a`, `b`: тип` или `- `a`: тип, `b`: тип`) — не добор,
// строка в отчёт с их числом.
function multiFieldLines(text) {
  let sec = null; let fence = false; let n = 0;
  for (const l of splitLines(text)) {
    if (/^```/.test(l)) { fence = !fence; continue; }
    if (fence) continue;
    if (l.startsWith('## ')) { sec = l.slice(3).trim(); continue; }
    if (sec && sec.startsWith('Владеет данными') && (/^- `?[A-Za-z_]\w*`?(\s*[,/]\s*`?[A-Za-z_]\w*`?)+\s*:/.test(l) || /^- `?[A-Za-z_]\w*`?\s*:.*[,;]\s*`?[A-Za-z_]\w*`?\s*:/.test(l))) n++;
  }
  return n;
}

// ---------- маркеры по плану и префикс (SKILL.md 3.0.8, шаг 2) ----------
// Контракт: файл плана plan.py — строки «итог/часть/файл» через табуляцию; ожидание класса — «итог» по
// сервису либо «часть NN»; ключи карточки по классам против пометок: меньше половины — гейт не пройден,
// больше вдвое — маркер видит не всё. По файлам: ключ описи ссылается на файл, если путь плана кончается
// путём из хвоста строки-ключа описи (слово с «/» либо с расширением). Ключей меньше пометок — дефицит.
// Префикс: путь ключа REST равен префиксу либо начинается с «префикс/»; иначе — ключ без префикса.

function readEnv(envPath) {
  const env = {};
  if (!envPath) return env;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return env;
}

function opisSources(opisText, roles = new Set()) {
  const tok = new Map();
  const declared = new Set();
  const seen = new Set(); // A12: ключ × файл — один раз; строки «Бизнес-правил» и ролей ключей пометок не дают
  for (let raw of String(opisText).split(/\r?\n/)) {
    if (raw.startsWith('> объявлено без реализации: ')) {
      if (declared.has(raw)) continue;
      declared.add(raw);
      raw = raw.slice('> объявлено без реализации: '.length);
    }
    if (!raw || /^[ \t]/.test(raw) || /^(#|⟹|\(|>|-|```|<!--)/.test(raw)) continue;
    const i = raw.indexOf(SEP);
    if (i < 0) continue;
    const h = raw.slice(0, i);
    if (/^(состояние|справочник|сообщение|ограничение|роль|Роль):/.test(h)) continue;
    const key = ckn(kopis(h)); // повтор ключа после склейки (`:id` = `{id}`, A19) — один ключ
    if (roles.has(key)) continue;
    for (let w of raw.slice(i + SEP.length).split(/[\s+,;]+/)) {
      w = w.replace(/[`()]/g, '').replace(/\\/g, '/').replace(/^\.\//, '');
      if (!/\//.test(w) && !/\.[A-Za-z0-9]+$/.test(w)) continue;
      if (!seen.has(key + '\t' + w)) { seen.add(key + '\t' + w); tok.set(w, (tok.get(w) ?? 0) + 1); }
    }
  }
  return tok;
}

const nopK = (k) => (/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) /.test(k) || !/[^ (]\(.*\)$/.test(k) ? k : k.replace(/\(.*\)$/, ''));

// ключи карточки по классам с тем же правилом, что у сервиса: вызов при голом ключе — один ключ
function keyCounts(cardText, orphan = false) {
  const d = parseCard(cardText, orphan);
  const sets = {
    контракт: new Set(d.blocks.контракт.map((b) => ckn(b.key))),
    сущности: new Set(d.blocks.сущности.map((b) => b.key)),
    задачи: new Set(d.blocks.задачи.map((b) => b.key)),
    топики: new Set(d.blocks.топики.map((b) => b.key)),
    экраны: new Set(d.tables.экраны.map((c) => norm(c[0])).filter((k) => k && k !== '—')),
  };
  const out = {};
  for (const [c, set] of Object.entries(sets)) out[c] = [...set].filter((k) => !(c === 'контракт' && nopK(k) !== k && set.has(nopK(k)))).length;
  return out;
}

// папка частей: ключи карточки каждой части; авторы блоков и ключей описи (часть NN, голова)
function readParts(dir) {
  const parts = new Map(); const card = new Map(); const opis = new Map(); const pbody = [];
  const add = (m, k, a) => { if (!m.has(k)) m.set(k, new Set()); m.get(k).add(a); };
  for (const name of fs.readdirSync(dir).sort()) {
    const m = name.match(/^(?:part-(\d+)|(head))\.md$/);
    if (!m) continue;
    const a = m[1] ?? 'голова';
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    const d = parseCard(text, !!m[1]);
    for (const c of ['контракт', 'сущности', 'задачи', 'топики']) for (const b of d.blocks[c]) add(card, b.key, a);
    for (const b of d.blocks.бизнес) add(card, bizKey(b.header).key, a);
    for (const c of d.tables.экраны) add(card, norm(c[0]), a);
    for (const c of d.tables.роли) add(card, roleKey(c), a);    if (m[1]) parts.set(a, keyCounts(text, true));
    if (m[1]) for (const b of d.blocks.контракт) pbody.push({ a, key: b.key, body: b.body });
    const op = path.join(dir, name.replace(/\.md$/, '.opis.md'));
    if (fs.existsSync(op)) for (const k of parseOpis(fs.readFileSync(op, 'utf8')).keys.keys()) add(opis, k, a);
  }
  const notes = fs.readdirSync(dir).filter((n) => /^(part-.*|head)\.opis\.md$/.test(n)).map((n) => fs.readFileSync(path.join(dir, n), 'utf8'));
  return { parts, card, opis, notes, pbody };
}

// Пустота по частям: у части больше половины блоков контракта без фактов — её ключи, пустые и в
// склеенной карточке, идут ей в добор.
function partEmptyItems(pbody, draftText) {
  const draftBody = new Map();
  for (const b of parseCard(draftText).blocks.контракт) { const k = ckn(b.key); draftBody.set(k, (draftBody.get(k) ?? false) || b.body); }
  const byPart = new Map();
  for (const r of pbody) { if (!byPart.has(r.a)) byPart.set(r.a, []); byPart.get(r.a).push(r); }
  const keys = new Set();
  for (const rows of byPart.values()) {
    if (2 * rows.filter((r) => r.body).length >= rows.length) continue;
    for (const r of rows) if (!r.body && draftBody.get(ckn(r.key)) === false) keys.add(r.key);
  }
  return [...keys].sort().map((k) => [k]);
}

// Ключ «недоступно»: под ключом описи строка `недоступно:` (прежняя форма — строка «> объявлено без
// реализации: <ключ> — …»). В карточке у него пометка: у блока строка `- недоступно…`, у строки таблицы — это
// слово. Ключ есть в карточке без пометки ни в одном месте — пункт добора автору. Ключа нет в карточке — не
// здесь (это «нет блока»). Сравнение без хвоста-вызова у не-HTTP ключей и без имён параметров пути.
function unavKeys(opisTexts) {
  const NOTE = '> объявлено без реализации: ';
  const out = new Set(); let key = '';
  for (const l of opisTexts.flatMap(splitLines)) {
    if (l.startsWith(NOTE)) { const s = l.slice(NOTE.length); const i = s.indexOf(SEP); out.add(kopis(i < 0 ? s : s.slice(0, i))); key = ''; continue; }
    if (/^[ \t]+недоступно:/.test(l)) { if (key) out.add(key); continue; }
    if (/^[ \t]/.test(l)) continue;
    if (l === '' || /^(#|⟹|\(|>|-|```|<!--)/.test(l)) { key = ''; continue; }
    const i = l.indexOf(SEP); const h = i < 0 ? l : l.slice(0, i);
    key = /^(зависит|состояние|справочник|сообщение|ограничение|роль|Роль):/.test(h) ? '' : kopis(h);
  }
  return out;
}
function declItems(opisTexts, draftText) {
  const same = (k) => nopK(ck(k)); // A19: параметр пути в любой записи, без имени
  const U = new Set([...unavKeys(opisTexts)].map(same));
  const d = parseCard(draftText);
  const entries = [
    ...Object.values(d.blocks).flat().map((b) => [b.key, b.unav]),
    ...d.tables.экраны.map((c) => [norm(c[0]), c.unav]), ...d.tables.роли.map((c) => [roleKey(c), c.unav]),
    ...d.tables.зависит.map((c) => [norm(c[0]), c.unav]), ...d.tables.api.map((c) => [norm(c[0]) + ' :: ' + kopis(c[1] ?? ''), c.unav]),
    ...(d.tables.состояние ?? []).map((c) => [norm(c[0]), c.unav]),
  ];
  const ok = new Set(entries.filter(([k, u]) => u && U.has(same(k))).map(([k]) => same(k)));
  return [...new Set(entries.filter(([k, u]) => !u && U.has(same(k)) && !ok.has(same(k))).map(([k]) => k))].sort().map((k) => [k]);
}

// A13. «Бизнес-правила» нарезанного сервиса пишет голова по описям частей: сущность строки `состояние:`
// части — блок секции, каждое значение-токен — «`токен`» в этом блоке; хоть одно имя отправки строки
// `сообщение:` («<кому>, <имена через запятую>» перед « — <файл>») — где-то в секции. Пропуск — добор головы.
function rulesItems(dir, draftText) {
  const tok = (s) => s.replace(/[`"«»]/g, '').replace(/^[ \t]+/, '').replace(/[ \t.,;:]+$/, '');
  const ents = []; const vals = new Map(); const msgs = new Map();
  for (const name of fs.readdirSync(dir).sort()) {
    if (!/^part-.*\.opis\.md$/.test(name)) continue;
    for (const line of splitLines(fs.readFileSync(path.join(dir, name), 'utf8'))) {
      if (line.startsWith('состояние:')) {
        let s = line.replace(/^состояние: */, ''); const p = s.indexOf(SEP); if (p >= 0) s = s.slice(0, p);
        const e = tok(s.replace(/[. ].*/, '')); if (!e) continue;
        if (!vals.has(e)) { vals.set(e, []); ents.push(e); }
        if (!s.includes(' ')) continue;
        for (const v of s.replace(/^[^ ]+ /, '').split('|')) { const t = tok(v); if (/^[A-Za-z0-9_]+$/.test(t) && !vals.get(e).includes(t)) vals.get(e).push(t); }
      } else if (line.startsWith('сообщение:')) {
        const P = line.split(SEP); if (P.length < 3) continue;
        // «<кому>, <имена отправки через запятую>»: у каждого имени — последнее слово
        const names = P[P.length - 2].split(', ').slice(1).map((q) => { const W = q.trim().split(/\s+/); return tok(W[W.length - 1] ?? ''); })
          .filter((x) => /[A-Za-z]/.test(x) && !/[^A-Za-z0-9_.:/-]/.test(x));
        const ns = names.join(' ');
        if (ns && !msgs.has(ns)) msgs.set(ns, P[0].replace(/^сообщение: */, ''));
      }
    }
  }
  const body = new Map(); let all = ''; let inb = false; let bk = '';
  for (const line of splitLines(draftText)) {
    if (line.startsWith('## ')) { inb = line.startsWith('## Бизнес-правила'); bk = ''; continue; }
    if (!inb) continue;
    if (line.startsWith('### ')) { let h = line.slice(4); const p = h.indexOf(SEP); if (p >= 0) h = h.slice(0, p); bk = h.replace(/`/g, '').trim(); if (!body.has(bk)) body.set(bk, ''); }
    all += ' ' + line;
    if (bk) body.set(bk, body.get(bk) + ' ' + line);
  }
  const out = [];
  for (const e of ents) {
    if (!body.has(e)) { out.push([`объект ${e}: блока нет`]); continue; }
    const miss = vals.get(e).filter((v) => !body.get(e).includes('`' + v + '`'));
    if (miss.length) out.push([`объект ${e}: нет строк значений ${miss.join(', ')}`]);
  }
  for (const [ns, vid] of msgs) if (!ns.split(' ').some((x) => all.includes(x))) out.push([`сообщение ${vid} (${ns}): блока нет`]);
  return out;
}

// A14. Остаток: пункт его списка в плане (строки «остаток <NN> <папка|файлы> <путь>») без строки
// «> пройдено: <пункт> — …» в описи остатка (путь тот же либо хвост другого) — добор остатка.
function restItems(planText, dir) {
  const np = (p) => p.replace(/`/g, '').replace(/\\/g, '/').replace(/\/\/+/g, '/').trim().replace(/^\.\//, '').replace(/\/$/, '');
  const tail = (p, q) => q.length > p.length && q.endsWith('/' + p);
  const rows = String(planText).split(/\r?\n/).map((l) => l.split('\t')).filter((r) => r[0] === 'остаток');
  if (!rows.length) return [];
  const nn = rows[0][1];
  const f = path.join(dir, `part-${nn}.opis.md`);
  const done = fs.existsSync(f) ? splitLines(fs.readFileSync(f, 'utf8')).filter((l) => l.startsWith('> пройдено: ')).map((l) => {
    let s = l.slice('> пройдено: '.length); const i = s.indexOf(SEP); if (i >= 0) s = s.slice(0, i);
    return np(s.replace(/^(папка|файлы прямо в|файлы) +/, ''));
  }) : [];
  return rows.filter((r) => { const p = np(r[3]); return !done.some((d) => d === p || tail(d, p) || tail(p, d)); })
    .map((r) => [`${r[2] === 'файлы' ? 'файлы прямо в' : 'папка'} ${np(r[3])} (остаток ${nn})`, nn]);
}

// A15. Список от кода (строки плана «операция», «топик»): операции нет среди ключей контракта карточки — путь
// как в спецификации или за общим префиксом, параметры пути без имён, без хвостового «/»; объявленная без
// реализации не в счёт — пункт части спецификации (6-я колонка), а без неё — остатка. Топиков конфига в
// «Событиях» меньше половины — пункт остатка; брокер в «Стеке» при одном событии или без них и без того
// пункта — тоже. Остатка нет — «без хозяина» у нарезанного, «читающий» у одиночного.
function listItems(planText, draftText, opisTexts, prefix, sliced) {
  const hk = (k) => ck(k); // A19: параметр пути в любой записи, без имени; двойной и хвостовой «/» сведены
  const rows = String(planText).split(/\r?\n/).map((l) => l.split('\t'));
  const rnn = sliced ? (rows.find((r) => r[0] === 'остаток') ?? [])[1] : undefined;
  const rest = rnn ?? (sliced ? 'без хозяина' : 'читающий');
  const d = parseCard(draftText);
  const have = new Set(d.blocks.контракт.map((b) => b.key).filter((k) => /^[A-Z]+ \//.test(k)).map(hk));
  const top = new Set(d.blocks.топики.map((b) => b.key.replace(/^\S+ /, '')));
  const NOTE = '> объявлено без реализации: ';
  const decl = new Set(opisTexts.flatMap(splitLines).filter((l) => l.startsWith(NOTE)).map((l) => {
    const s = l.slice(NOTE.length); const i = s.indexOf(SEP); return kopis(i < 0 ? s : s.slice(0, i));
  }).filter((k) => /^[A-Z]+ \//.test(k)).map(hk));
  const spec = []; let nt = 0; let nh = 0; const miss = [];
  for (const r of rows) {
    if (r[0] === 'операция') {
      const k = hk(`${r[1]} ${r[2]}`); const kp = hk(`${r[1]} ${(prefix || '') + r[2]}`);
      if (!(have.has(k) || have.has(kp) || decl.has(k) || decl.has(kp))) spec.push([`${r[1]} ${r[2]} (${r[3]})`, r[5] !== '-' ? r[5] : rest]);
    } else if (r[0] === 'топик') { nt++; if (top.has(r[1])) nh++; else miss.push(r[1]); }
  }
  const topics = [];
  if (nt > 0 && 2 * nh < nt) topics.push([`топики конфига без блоков «Событий»: есть ${nh} из ${nt}; нет — ${miss.join(', ')}`, rest]);
  let inStack = false; let broker = false;
  for (const l of splitLines(draftText)) { if (l.startsWith('## ')) { inStack = l.startsWith('## Стек'); continue; } if (inStack && isBroker(l)) broker = true; }
  if (broker && d.blocks.топики.length <= 1 && !topics.length) topics.push([`брокер в «Стеке», а событий ${d.blocks.топики.length}`, rest]);
  return { SPEC: spec, TOPICS: topics };
}

// Строки уровня сервиса: ENTRY — в черновике есть «Роли и доступ», а строки `вход:` нет ни в одной описи;
// DEP — сосед из строки `зависит:` описей без строки «Зависит от» (имена сводятся без обвязки клиента, kDep).
function serviceItems(draftText, opisTexts) {
  const lines = opisTexts.flatMap(splitLines);
  const entry = splitLines(draftText).some((l) => l.startsWith('## Роли и доступ')) && !lines.some((l) => l.startsWith('вход:')) ? [['в описи нет строки «вход:»']] : [];
  const d = parseCard(draftText);
  const have = new Set(d.tables.зависит.map((c) => kDep(norm(c[0]))));
  const dep = []; const seen = new Set();
  for (const l of lines) {
    if (!l.startsWith('зависит:')) continue;
    let s = l.replace(/^зависит:[ \t]*/, ''); const i = s.indexOf(SEP); if (i >= 0) s = s.slice(0, i);
    s = s.replace(/`/g, '').trim(); const k = kDep(s);
    if (s && !have.has(k) && !seen.has(k)) { seen.add(k); dep.push([`${s} — строки «Зависит от» нет`]); }
  }
  return { ENTRY: entry, DEP: dep };
}

// A16. Форма «Событий», задач и «Зависит от»: блок публикации или потребления без строки-метки шаблона, блок
// фоновой задачи без строки «наложение» — пункт с недостающими метками; строка «Зависит от», чьё имя (без
// регистра латиницы) стоит словом в «Стеке», — пункт.
function formItems(draftText) {
  const NEED = { 'публикует': ['тело', 'ключ', 'когда', 'гарантия', 'не шлётся'], 'потребляет': ['читает', 'группа', 'подтверждение', 'повтор', 'ошибка'] };
  const slot = []; const st = new Set(); const dep = [];
  let sec = ''; let key = ''; let need = null; let got = new Set();
  const done = () => { if (key && need) { const miss = need.filter((x) => !got.has(x)); if (miss.length) slot.push([`${key} — нет строк ${miss.map((x) => x + ':').join(', ')}`]); } key = ''; need = null; got = new Set(); };
  for (const l of splitLines(draftText)) {
    if (l.startsWith('## ')) { done(); sec = l.slice(3).trim(); continue; }
    if (sec.startsWith('Фоновые задачи')) {
      if (l.startsWith('### ')) { done(); let h = l.slice(4); const p = h.indexOf(SEP); if (p >= 0) h = h.slice(0, p); const k = kcanon('задачи', h); if (k) { key = k; need = ['наложение']; } continue; }
      const m = key && l.match(/^- ([^`:]+):/); if (m) got.add(m[1]);
    }
    if (sec.startsWith('События')) {
      if (l.startsWith('### ')) { done(); let h = l.slice(4); const p = h.indexOf(SEP); if (p >= 0) h = h.slice(0, p); const k = kcanon('топики', h); if (k) { key = k; need = NEED[k.split(' ')[0]] ?? null; } continue; }
      const m = key && l.match(/^- ([^`:]+):/); if (m) got.add(m[1]);
    }
    if (sec.startsWith('Стек') && l.startsWith('|')) for (const w of l.replace(/[A-Z]/g, (c) => c.toLowerCase()).split(/[^a-z0-9]+/)) if (w.length > 2) st.add(w);
    if (sec.startsWith('Зависит от') && l.startsWith('|') && !/^\|[ \t:|-]*$/.test(l)) { const d = (l.split('|')[1] ?? '').replace(/`/g, '').trim(); if (d && d !== '—' && !/Сервис или система/.test(d)) dep.push(d); }
  }
  done();
  return { SLOT: slot, INFRA: dep.filter((d) => st.has(d.replace(/[A-Z]/g, (c) => c.toLowerCase()))).map((d) => [`${d} — имя стоит в «Стеке»`]), GLUED: gluedItems(draftText) };
}

// A18. Склеенная возможность: строка «Что умеет», где в первой колонке два разных однородных глагола в
// неопределённой форме — первым словом или сразу после запятой, точки с запятой, двоеточия, «и», «или»,
// «либо», «также» (окончание -ть, -ться, -ести, -зти, -йти; на -ость, -есть, -асть — существительные). После
// тире — пояснение, не действие. Текст в «» и в бэктиках не в счёт.
function gluedItems(draftText) {
  const out = []; let cs = false;
  for (const l of splitLines(draftText)) {
    if (l.startsWith('## ')) { cs = l.startsWith('## Что умеет'); continue; }
    if (!cs || !l.startsWith('|') || /^\|[ \t:|-]*$/.test(l)) continue;
    const c = l.split('|')[1] ?? '';
    if (c.includes('Возможность')) continue;
    const t = c.replace(/[ \t]+[—–][ \t].*$/, '').replace(/«[^»]*»/g, ' ').replace(/`[^`]*`/g, ' ').replace(/[«»—–]/g, ' ').replace(/[,;:/()]/g, ' # ');
    const v = new Set(); let pv = '#';
    for (const w of t.split(/[ \t.!?"'+=-]+/).filter(Boolean)) {
      if (/^(#|и|или|либо|также)$/.test(pv) && /(ть|ться|ести|зти|йти)$/.test(w) && !/(ость|есть|асть)$/.test(w)) v.add(w);
      pv = w;
    }
    if (v.size >= 2) out.push([c.trim()]);
  }
  return out;
}

// A17. Своя сущность без блока «Бизнес-правил», чьё поле-перечисление называет строка «меняет:» (описи или
// черновика), а строки «состояние:» описей с этим полем нет, — пункт («справочник:» пункт не снимает: поле
// меняют). Перечисление: два значения, разделённых «|» (пустое и null-подобные не в счёт), или тип с
// окончанием Type/Status/State/Kind/Stage/Phase/Mode. Имена сущностей — без окончания Entity, блок — по
// заголовку в бэктиках. Секции «Бизнес-правила» нет — пунктов нет.
function stateItems(draftText, opisTexts) {
  const lines = splitLines(draftText);
  if (!lines.some((l) => l.startsWith('## Бизнес-правила'))) return [];
  const base = (e) => (e.length > 6 && e.endsWith('Entity') ? e.slice(0, -6) : e);
  const keyOf = (e, f) => `${base(e)}.${f}`;
  const NULLISH = new Set(['null', 'Null', 'NULL', 'undefined', 'none', 'None', 'nil']);
  const changed = new Set(); const namedField = new Set();
  const isChange = (l) => l.trimStart().startsWith('меняет:');
  const collect = (l) => {
    for (const tok of l.split(/[^A-Za-z0-9_.]+/)) {
      const seg = tok.split('.');
      for (let i = 0; i + 1 < seg.length; i++) {
        if (/^[A-Z]\w*$/.test(seg[i]) && /^[A-Za-z_]\w*$/.test(seg[i + 1])) { changed.add(keyOf(seg[i], seg[i + 1])); i++; }
      }
    }
  };
  for (const l of opisTexts.flatMap(splitLines)) {
    if (isChange(l)) { collect(l); continue; }
    const m = l.match(/^состояние:\s*(\S+)/);
    if (!m) continue;
    const [e, f] = m[1].replace(/`/g, '').split('.');
    if (f) namedField.add(keyOf(e, f));
  }
  const ruled = new Set(); const fields = new Map();
  let sec = ''; let ent = '';
  for (const l of lines) {
    if (isChange(l)) { collect(l); continue; }
    if (l.startsWith('## ')) { sec = l.slice(3); ent = ''; continue; }
    if (l.startsWith('### ')) {
      const m = /^### `(\w+)`/.exec(l); ent = m ? m[1] : '';
      if (ent && sec.startsWith('Бизнес-правила')) ruled.add(base(ent));
      continue;
    }
    if (!ent || !sec.startsWith('Владеет данными')) continue;
    const m = /^- `?(\w+)`?\s*:(.*)$/.exec(l); if (!m) continue;
    const rest = m[2];
    const type = (rest.replace(/`/g, '').trim().match(/^\w*/) ?? [''])[0];
    let piped = 0;
    for (const run of rest.match(/`?\w+`?(?:\s*\\?\|\s*`?\w+`?)+/g) ?? []) {
      const n = run.replace(/[`\\\s]/g, '').split('|').filter((v) => v && !NULLISH.has(v)).length;
      piped = Math.max(piped, n);
    }
    const k = `${ent}.${m[1]}`;
    if (!fields.has(k)) fields.set(k, { e: ent, f: m[1], isEnum: piped >= 2 || /(Type|Status|State|Kind|Stage|Phase|Mode)$/.test(type) });
  }
  const out = [];
  for (const [k, x] of fields) {
    const key = keyOf(x.e, x.f);
    if (x.isEnum && changed.has(key) && !ruled.has(base(x.e)) && !namedField.has(key)) out.push([k]);
  }
  return out;
}

// Пометка не становится ключом описи. Владение — по файлу, затем по ближайшей папке плана;
// неоднозначный относительный хвост и отсутствие владельца дают «без хозяина».
function missedItems(planText, opisTexts) {
  const clean = (p) => {
    let s = path.posix.normalize(p.replace(/`/g, '').trim().replace(/\\/g, '/')).replace(/\/$/, '');
    if (process.platform === 'win32') s = s.replace(/^\/([a-zA-Z])\//, (_, d) => d.toUpperCase() + ':/');
    return s.replace(/^([a-zA-Z]):/, (_, d) => d.toUpperCase() + ':');
  };
  const absolute = (p) => /^(\/|[A-Za-z]:)/.test(p);
  const match = (source, owned) => source === owned || (!absolute(source) && owned.endsWith('/' + source));
  const entries = String(planText).split(/\r?\n/).map((l) => l.split('\t')).flatMap((r) => {
    if (r[0] === 'файл' && r[4] && r[4] !== '-') return [{ p: clean(r[1]), folder: false, a: r[4] }];
    if (r[0] === 'путь') return [{ p: clean(r[1]), folder: r[2] === 'папки', a: r[3] }];
    return [];
  });
  const notes = new Set(opisTexts.flatMap(splitLines).filter((l) => l.startsWith('> пропущено частью: ')).map((l) => l.slice('> пропущено частью: '.length)));
  return [...notes].map((note) => {
    const at = note.indexOf(SEP);
    if (at < 0) return [note, 'без хозяина'];
    const source = clean(note.slice(at + SEP.length));
    const candidates = [];
    for (const e of entries) {
      if (!e.folder) { if (match(source, e.p)) candidates.push({ a: e.a, score: source.length + 1 }); continue; }
      for (let q = path.posix.dirname(source); q !== '.' && q !== '/'; q = path.posix.dirname(q)) {
        if (match(q, e.p)) { candidates.push({ a: e.a, score: q.length }); break; }
      }
    }
    const best = Math.max(-1, ...candidates.map((c) => c.score));
    const owners = new Set(candidates.filter((c) => c.score === best).map((c) => c.a));
    return [note, owners.size === 1 ? [...owners][0] : 'без хозяина'];
  });
}

function markers(planText, parts, cardKeys, opisText, roles) {
  const rows = String(planText).split(/\r?\n/).filter(Boolean).map((l) => l.split('\t'));
  if (!rows.length) return { 'гейт': 'плана нет', 'классы': {}, _gate: '', _owners: [] };
  const want = new Map(); const pwant = new Map();
  const files = new Map(); // путь → {n, own}
  for (const r of rows) {
    if (r[0] === 'итог') want.set(r[1], (want.get(r[1]) ?? 0) + Number(r[2]));
    if (r[0] === 'часть') pwant.set(`${r[1]}\t${r[2]}`, (pwant.get(`${r[1]}\t${r[2]}`) ?? 0) + Number(r[3]));
    if (r[0] === 'файл') { const f = files.get(r[1]) ?? { n: 0, own: r[4] }; f.n += Number(r[3]); files.set(r[1], f); }
  }
  const cls = {}; const bad = [];
  const verdict = (label, gw, g, e) => {
    if (2 * g < e) { cls[label] = `${g}/${e} не пройден`; bad.push(`${gw}${g} из ${e}`); }
    else cls[label] = `${g}/${e} пройден${g > 2 * e ? ', вдвое' : ''}`;
  };
  for (const [c, e] of want) { if (!(c in cardKeys)) { cls[c] = 'нет класса'; continue; } verdict(c, c + ' ', cardKeys[c], e); }
  if (parts) for (const [key, e] of pwant) {
    const [nn, c] = key.split('\t');
    const label = `части ${nn}, ${c}`;
    if (!parts.has(nn) || !(c in parts.get(nn))) { cls[label] = 'нет класса'; continue; }
    verdict(label, `часть ${nn}, ${c} `, parts.get(nn)[c], e);
  }
  const gate = want.size === 0 && !(parts && pwant.size) ? 'пометок-ключей в плане нет — гейта нет' : (bad.length ? `НЕ ПРОЙДЕН — ${bad.join('; ')}` : 'пройден');
  const tok = opisSources(opisText, roles);
  const deficit = []; const owners = [];
  for (const [f, { n, own }] of files) {
    let m = 0;
    for (const [t, k] of tok) if (f === t || f.endsWith('/' + t)) m += k;
    if (m < n) { deficit.push(`${f.split('/').pop()}(${own}) ${n}/${m}`); owners.push(own); }
  }
  return { 'гейт': gate, 'классы': cls, 'файлов': `${files.size}/${deficit.length}`, 'дефицит': deficit, _gate: gate, _owners: owners };
}

export function analyzeFiles(opisPath, draftPath, prevPath, envPath) {
  const rd = (p) => fs.readFileSync(p, 'utf8');
  const env = readEnv(envPath);
  const res = analyze(rd(opisPath), rd(draftPath), prevPath ? rd(prevPath) : null, { parts: !!env.CHECK_PARTS, prefix: env.CHECK_PREFIX });
  const mp = findManifest(draftPath);
  res['кандидаты'] = candidates(rd(draftPath), mp ? manifestNames(rd(mp)) : null);
  const rel = (v) => path.join(path.dirname(envPath), v);
  const P = env.CHECK_PARTS ? readParts(rel(env.CHECK_PARTS)) : null;
  let noPfx = [];
  const p = normPre(env.CHECK_PREFIX);
  if (p) {
    const keys = new Set(parseCard(rd(draftPath)).blocks.контракт.map((b) => b.key));
    noPfx = [...keys].filter((k) => { const m = k.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) (\S+)/); return m && m[2] !== p && !m[2].startsWith(p + '/'); });
    res['черновик']['без префикса'] = noPfx.length;
  }
  let mk = null;
  if (env.CHECK_PLAN) {
    const planPath = rel(env.CHECK_PLAN);
    mk = markers(fs.existsSync(planPath) ? rd(planPath) : '', P ? P.parts : null, res['черновик']['ключи'], rd(opisPath), new Set(parseCard(rd(draftPath)).tables.роли.map(roleKey)));
    res['маркеры'] = { 'гейт': mk['гейт'], 'классы': mk['классы'], ...('файлов' in mk ? { 'файлов': mk['файлов'], 'дефицит': mk['дефицит'] } : {}) };
  }
  // исход: маркеры, доставка тела контракта, гард — и перечень добора по авторам
  const mg = mk && mk._gate ? mk._gate : 'плана нет — сверки маркеров нет';
  const [nb, bb] = res['черновик']['контракт'];
  const bodyFail = nb > 0 && 2 * bb < nb;
  const fail = [];
  if (mg.startsWith('НЕ ПРОЙДЕН')) fail.push('маркеры: ' + mg.replace(/^НЕ ПРОЙДЕН — /, ''));
  if (bodyFail) fail.push(`тело у ${bb} из ${nb} блоков контракта`);
  const route = res['маршрут'];
  const it = res._items;
  const ownerPlan = env.CHECK_PLAN && fs.existsSync(rel(env.CHECK_PLAN)) ? rd(rel(env.CHECK_PLAN)) : '';
  const contractKeys = parseCard(rd(draftPath)).blocks.контракт.map((b) => b.key);
  const lists = { ...it, NOPFX: noPfx.map((k) => [k]), MARKFILE: (mk?._owners ?? []).map((o) => [o]), MISSED: missedItems(ownerPlan, [rd(opisPath), ...(P?.notes ?? [])]), DECL: declItems([rd(opisPath), ...(P?.notes ?? [])], rd(draftPath)), PARTEMPTY: P ? partEmptyItems(P.pbody, rd(draftPath)) : [], RULES: P ? rulesItems(rel(env.CHECK_PARTS), rd(draftPath)) : [], REST: P && ownerPlan ? restItems(ownerPlan, rel(env.CHECK_PARTS)) : [],
    ...listItems(ownerPlan, rd(draftPath), [rd(opisPath), ...(P?.notes ?? [])], env.CHECK_PREFIX ? '/' + env.CHECK_PREFIX.replace(/\/$/, '').replace(/^\//, '') : '', !!P), ...formItems(rd(draftPath)),
    ...serviceItems(rd(draftPath), [rd(opisPath), ...(P?.notes ?? [])]),
    STATE: stateItems(rd(draftPath), [rd(opisPath), ...(P ? fs.readdirSync(rel(env.CHECK_PARTS)).filter((n) => /^part-.*\.opis\.md$/.test(n)).sort().map((n) => rd(path.join(rel(env.CHECK_PARTS), n))) : [])]),
    ...res['кандидаты']._form, SECS: sectionItems(rd(draftPath)) };
  const FORMK = new Set(['BRHDR', 'BRCODE', 'USERCODE', 'TAILFILE', 'CELLS', 'NOENT', 'ORDER', 'SECS']);
  // имена видов в строке ДОБОР (контракт вывода check: «ДОБОР <автор>: N (<вид> n, …)»)
  const NAMES = { ADD: 'нет блока', NOSRC: 'нет источника', EMPTY: 'пустой блок', DUP: 'дубль', nometh: 'без метода', NOKEY: 'не ключ', NOPFX: 'без префикса',
    MARKFILE: 'ключей меньше пометок', MISSED: 'пропущено частью', DECL: 'недоступно без пометки', PARTEMPTY: 'блоки части без фактов', RULES: 'правила частей',
    REST: 'пункт остатка не пройден', SPEC: 'операция спецификации', TOPICS: 'топики', SLOT: 'нет метки', GLUED: 'склеенная возможность', INFRA: 'инфраструктура',
    ENTRY: 'нет строки вход', DEP: 'сосед без строки', STATE: 'перечисление без блока', BRHDR: 'заголовок правил', BRCODE: 'код в правилах',
    USERCODE: 'код для пользователя', TAILFILE: 'хвост-файл', CELLS: 'слипшаяся ячейка', NOENT: 'без сущностей', ORDER: 'порядок блоков', SECS: 'секции не по шаблону' };
  const vid = {};
  const dobor = {};
  // авторы ключа: с именем параметра (A19), вызов без скобок, затем без имени параметра
  const ix = new Map();
  const index = (m) => {
    if (ix.has(m)) return ix.get(m);
    const byN = new Map(); const byK = new Map();
    for (const [k, A] of m) for (const [mm, kk] of [[byN, ckn(k)], [byK, ck(k)]]) { if (!mm.has(kk)) mm.set(kk, new Set()); for (const a of A) mm.get(kk).add(a); }
    ix.set(m, { byN, byK });
    return ix.get(m);
  };
  const look = (m, k) => { const { byN, byK } = index(m); return byN.get(ckn(k)) ?? byN.get(nopK(ckn(k))) ?? byK.get(ck(k)) ?? byK.get(nopK(ck(k))) ?? null; };
  for (const [cat, list] of Object.entries(lists)) for (const item of list) {
    let A;
    if (FORMK.has(cat)) A = !P ? new Set(['читающий']) : item[1] === null ? new Set(['голова']) : look(P.card, item[1]);
    else if (cat === 'MISSED') A = new Set([item[1]]);
    else if (cat === 'SPEC' || cat === 'TOPICS') A = new Set([item[1]]);
    else if (!P) A = new Set(['читающий']);
    else if (cat === 'INFRA' || cat === 'ENTRY' || cat === 'DEP' || cat === 'GLUED') A = new Set(['голова']);
    else if (cat === 'SLOT') A = look(P.card, item[0].split(SEP)[0]);
    else if (cat === 'RULES' || cat === 'STATE') A = new Set(['голова']);
    else if (cat === 'REST') A = new Set([item[1]]);
    else if (cat === 'MARKFILE') A = new Set([item[0]]);
    else if (cat === 'DUP') A = new Set([...(look(P.card, item[0]) ?? []), ...(look(P.card, item[1]) ?? [])]);
    else if (['ADD', 'NOSRC', 'EMPTY'].includes(cat)) A = look(P.opis, item[0]) ?? look(P.card, item[0]);
    else if (cat === 'NOKEY') A = look(P.card, item[0]);
    else A = look(P.card, item[0]) ?? look(P.opis, item[0]);
    if (!A || !A.size) A = new Set(['без хозяина']);    for (const a of A) {
      const l = /^\d+$/.test(a) ? `часть ${a}` : a;
      dobor[l] = (dobor[l] ?? 0) + 1;
      (vid[l] ??= {})[NAMES[cat]] = (vid[l][NAMES[cat]] ?? 0) + 1;
    }
  }
  const nmulti = multiFieldLines(rd(draftPath));
  res['исход'] = {
    'маркеры': mg,
    'тело': nb === 0 ? 'блоков контракта нет — сверки нет' : (bodyFail ? `НЕ ПРОЙДЕН — тело у ${bb} из ${nb} блоков контракта, меньше половины` : `пройден — тело у ${bb} из ${nb} блоков контракта`),
    'гард': route ?? 'прежней карточки нет',
    'исход': fail.length ? `гейт не пройден — ${fail.join('; ')}` : route === 'В _pending' ? 'в _pending — гард' : route ? 'записать поверх' : 'записать',
    'добор': dobor,
    'виды': vid,
    'в отчёт': nmulti ? [`«Владеет данными» — строк \`- \` с несколькими полями: ${nmulti}`] : [],
  };
  res['пропуски'] = {};
  for (const [note, owner] of lists.MISSED) (res['пропуски'][owner] ??= []).push(note);
  return res;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const [, , a, b, c] = process.argv;
  if (!a || !b) {
    console.error('usage: node oracle.mjs <опись> <черновик> [<прежняя>]');
    process.exit(2);
  }
  console.log(JSON.stringify(analyzeFiles(a, b, c), null, 1));
}
