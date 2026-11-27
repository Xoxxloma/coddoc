// Сравнение вывода check.py с ожиданием. Вызывается из test-check.py:
//   node compare.mjs <папка SM-CHECK> <папка с выводами> <папка _skill-eval>
// Три фазы: (1) оракул ↔ expect.json на синтетике — проверка самого оракула;
// (2) скрипт ↔ expect.json на синтетике; (3) скрипт ↔ оракул на настоящих файлах.
import fs from 'node:fs';
import path from 'node:path';
import { analyzeFiles, GUARD_CLASSES } from './oracle.mjs';

const [, , HERE, OUT, EVAL] = process.argv;
if (!HERE || !OUT || !EVAL) {
  console.error('usage: node compare.mjs <SM-CHECK> <out> <_skill-eval>');
  process.exit(2);
}

// ---------- разбор вывода check.py ----------

const CLASS_PREFIX = [['без пары', 'без пары'], ['контр', 'контракт'], ['сущн', 'сущности'], ['задач', 'задачи'],
  ['топик', 'топики'], ['событ', 'топики'], ['бизн', 'бизнес'], ['экран', 'экраны'], ['рол', 'роли'],
  ['завис', 'зависит'], ['потреб', 'потребляет']];
const canonClass = (l) => {
  const s = l.trim();
  for (const [p, c] of CLASS_PREFIX) if (s.startsWith(p)) return c;
  return s;
};
const canonGuard = (l) => {
  const s = l.trim();
  return GUARD_CLASSES.find((c) => s === c) ?? GUARD_CLASSES.find((c) => s.startsWith(c.slice(0, 5))) ?? s;
};

export function parseOutput(text) {
  const r = { 'черновик': {}, 'опись': {}, 'сверка': {}, 'гард': null, 'сработал': [], 'маршрут': null };
  const lists = []; // {label, n, items}
  const snippets = []; // {n, text} из «    N: <160 байт>»
  const secretLines = []; // {n, text} из «    N: <начало прогона> (L знаков)» под строкой секретов
  let inSecret = false;
  let inTotals = false;
  let lastGuard = null;
  let inCand = false;
  let inMark = false;
  let inOut = false;
  let curCand = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('== ')) {
      inTotals = false;
      inCand = line.startsWith('== КАНДИДАТЫ');
      inMark = line.startsWith('== МАРКЕРЫ');
      inOut = line.startsWith('== ИСХОД');
      if (inOut) r['исход'] = { 'добор': {}, 'виды': {}, 'в отчёт': [] };
      if (inMark) r['маркеры'] = { 'классы': {}, 'дефицит': [] };
      if (inCand) r['кандидаты'] = {};
      if (line.startsWith('== ГАРД')) r['гард'] = {};
      continue;
    }
    if (inCand) {
      const C = r['кандидаты'];
      let m;
      if (inSecret && (m = line.match(/^ {4}(\d+): (.*)$/))) {
        C['секрет'].listed.push(+m[1]);
        C['секрет'].oldFormat = false;
        secretLines.push({ n: +m[1], text: line.slice(4) });
        continue;
      }
      inSecret = false;
      if ((m = line.match(/^ {4}(\d+): ?(.*)$/))) {
        if (curCand) C[curCand].listed.push(+m[1]);
        snippets.push({ n: +m[1], text: m[2] });
      } else if ((m = line.match(/^похожих на секрет строк: (\d+)(?: — номера: (.*))?$/))) {
        C['секрет'] = { n: +m[1], listed: (m[2] ?? '').trim().split(/\s+/).filter(Boolean).map(Number), oldFormat: m[2] !== undefined };
        inSecret = true;
        curCand = null;
      } else if ((m = line.match(/^«События»: блоков (\d+); брокер в «Стеке»: (\S+)/))) {
        C['события'] = String(+m[1]);
        C['брокер'] = m[2];
        curCand = null;
      } else if (/^порядок блоков: соблюдён/.test(line)) {
        C['порядок'] = 'соблюдён';
        curCand = null;
      } else if ((m = line.match(/^порядок блоков нарушен: (.*)$/))) {
        C['порядок'] = m[1].split(';').map((s) => s.trim()).filter(Boolean);
        curCand = null;
      } else if ((m = line.match(/^(.*): (\d+)\s*$/))) {
        const key = CAND_LABELS.find(([p]) => m[1].startsWith(p))?.[1] ?? `?${m[1]}`;
        C[key] = { n: +m[2], listed: [] };
        curCand = key;
        if (key === 'не из манифеста') C['манифест'] = /манифест: нет\)/.test(m[1]) ? 'нет' : 'есть';
      }
      continue;
    }
    if (inOut) {
      const O = r['исход'];
      let m;
      if ((m = line.match(/^маркеры: (.*)$/))) O['маркеры'] = m[1].trim();
      else if ((m = line.match(/^доставка тела: (.*)$/))) O['тело'] = m[1].trim();
      else if ((m = line.match(/^гард: (.*)$/))) O['гард'] = m[1].trim();
      else if ((m = line.match(/^ИСХОД: (.*)$/))) O['исход'] = m[1].trim();
      else if ((m = line.match(/^ДОБОР (.+?): (\d+)(?: \((.*?)\))?(?: — .*)?$/))) {
        O['добор'][m[1]] = +m[2];
        // виды пунктов: «(<вид> n, <вид> n)»
        O['виды'][m[1]] = {};
        for (const part of (m[3] ?? '').split(', ').filter(Boolean)) { const pm = part.match(/^(.+) (\d+)$/); if (pm) O['виды'][m[1]][pm[1]] = +pm[2]; }
      } else if ((m = line.match(/^в отчёт: (.*)$/))) O['в отчёт'].push(m[1]);
      continue;
    }
    if (inMark) {
      const M = r['маркеры'];
      let m;
      if ((m = line.match(/^маркеры (.+?): в карточке (\d+), пометок (\d+) — (пройден|НЕ ПРОЙДЕН)(.*)$/))) M['классы'][m[1]] = `${m[2]}/${m[3]} ${m[4] === 'пройден' ? 'пройден' : 'не пройден'}${/маркер видит/.test(m[5]) ? ', вдвое' : ''}`;
      else if ((m = line.match(/^маркеры (.+?): (?:в карточке такого класса нет|файла части нет)/))) M['классы'][m[1]] = 'нет класса';
      else if ((m = line.match(/^МАРКЕРНЫЙ ГЕЙТ: (.*)$/))) M['гейт'] = m[1].trim();
      else if (/^плана нет или он пуст/.test(line)) M['гейт'] = 'плана нет';
      else if ((m = line.match(/^по файлам: файлов с пометками (\d+), ключей в описи меньше пометок — (\d+)/))) M['файлов'] = `${m[1]}/${m[2]}`;
      else if ((m = line.match(/^ {4}(\S.*) \(часть (\S+)\): пометок (\d+), ключей (\d+)$/))) M['дефицит'].push(`${m[1].split('/').pop()}(${m[2]}) ${m[3]}/${m[4]}`);
      continue;
    }
    if (inTotals) {
      if (/^\s+⟹/.test(line)) { r['опись']['итоги'].push(line.trim()); continue; }
      inTotals = false;
    }
    let m;
    if ((m = line.match(/^(контракт|сущности|задачи) (\d+) \(с телом (\d+), пустых (\d+)\)/))) {
      r['черновик'][m[1]] = [+m[2], +m[3], +m[4]];
    } else if ((m = line.match(/^топики (\d+) \(потребляет (\d+), публикует (\d+)\)/))) {
      r['черновик']['топики'] = [+m[1], +m[2], +m[3]];
    } else if ((m = line.match(/^бизнес-правила: объектов (\d+), сообщений (\d+), ограничений (\d+)/))) {
      r['черновик']['бизнес'] = [+m[1], +m[2], +m[3]];
    } else if ((m = line.match(/^строк таблиц: экраны (\d+), роли (\d+), зависит от (\d+), потребляемые API (\d+)/))) {
      r['черновик']['таблицы'] = [+m[1], +m[2], +m[3], +m[4]];
    } else if ((m = line.match(/^ключей (\d+) \(из них строк «Бизнес-правил»: объектов (\d+), сообщений (\d+), ограничений (\d+)\)/))) {
      r['опись']['ключей'] = +m[1];
      r['опись']['бизнес'] = [+m[2], +m[3], +m[4]];
    } else if ((m = line.match(/^строк без файла-источника: (\d+)(?: — (.*))?$/))) {
      r['опись']['без файла'] = +m[1];
      lists.push({ label: 'без файла', n: +m[1], items: m[2] });
    } else if (line.startsWith('итоги описи:')) {
      r['опись']['итоги'] = [];
      inTotals = true;
    } else if ((m = line.match(/^нет в черновике: (\d+)(?: — (.*))?$/))) {
      r['сверка']['нет в черновике'] = +m[1];
      lists.push({ label: 'нет в черновике', n: +m[1], items: m[2] });
    } else if ((m = line.match(/^нет в описи: (\d+)(?: — (.*))?$/))) {
      r['сверка']['нет в описи'] = +m[1];
      lists.push({ label: 'нет в описи', n: +m[1], items: m[2] });
    } else if ((m = line.match(/^факт в описи, пустой блок: (\d+)(?: — (.*))?$/))) {
      r['сверка']['факт, пустой блок'] = +m[1];
      lists.push({ label: 'факт, пустой блок', n: +m[1], items: m[2] });
    } else if ((m = line.match(/^перечень добора: ключ описи с источником без блока (\d+), ключ с блоком без источника (\d+), факт в описи — блок пуст (\d+), один ключ дважды (\d+)/))) {
      r['сверка']['добор'] = `${m[1]}/${m[2]}/${m[3]}/${m[4]}`;
    } else if ((m = line.match(/^ключи REST без общего префикса \S+: (\d+)/))) {
      r['черновик']['без префикса'] = +m[1];
    } else if ((m = line.match(/^ключи карточки по классам: контракт (\d+), сущности (\d+), задачи (\d+), топики (\d+), экраны (\d+)/))) {
      r['черновик']['ключи'] = { 'контракт': +m[1], 'сущности': +m[2], 'задачи': +m[3], 'топики': +m[4], 'экраны': +m[5] };
    } else if ((m = line.match(/^опись по классам[^:]*:\s*(.*)$/))) {
      const bc = {};
      for (const part of m[1].split(/,\s*/)) {
        const pm = part.trim().match(/^(.+?) (\d+)$/);
        if (pm) bc[canonClass(pm[1])] = (bc[canonClass(pm[1])] ?? 0) + +pm[2];
      }
      r['сверка']['по классам'] = bc;
    } else if ((m = line.match(/^группы черновика[^(]*\((\d+)\)/))) {
      r['сверка']['групп'] = +m[1];
    } else if (r['гард'] && (m = line.match(/^(\S[^:]*): было (\d+), исчезло (\d+), появилось (\d+), опустело (\d+)/))) {
      lastGuard = canonGuard(m[1]);
      r['гард'][lastGuard] = [+m[2], +m[3], +m[4], +m[5]];
    } else if (r['гард'] && (m = line.match(/^\s+путь (.+: блоков было \d+, стало \d+)$/))) {
      (r['пути'] ??= []).push(m[1]);
    } else if (r['гард'] && lastGuard && (m = line.match(/^\s+(исчезли|появились|опустели): (.*)$/))) {
      const i = { 'исчезли': 1, 'появились': 2, 'опустели': 3 }[m[1]];
      lists.push({ label: `${lastGuard}/${m[1]}`, n: r['гард'][lastGuard][i], items: m[2] });
    } else if ((m = line.match(/правило маршрута сработало на классе «(.+?)»/))) {
      r['сработал'].push(canonGuard(m[1]));
    } else if ((m = line.match(/^МАРШРУТ: (.*)$/))) {
      r['маршрут'] = m[1].trim();
    }
  }
  return { r, lists, snippets, secretLines };
}

// [срез 2] заголовки, код в правилах, код для пользователя, слипшиеся, хвост-файл, без сущностей и порядок блоков —
// виды добора (исход.виды), а не кандидаты
const CAND_LABELS = [
  ['«Бизнес-правила», ограничений без переключателя', 'бр.ограничения'],
  ['«Стек»', 'стек'],
  ['«Зависит от» / «Потребляемые API»', 'не из манифеста'],
];
export const CAND_KEYS = ['бр.ограничения', 'стек', 'не из манифеста', 'манифест', 'секрет', 'события', 'брокер'];

// «    N: <первые 160 байт строки>» — сверка с самим черновиком.
// Длиннее 160 байт: первые ≤160 байт без разрезанной многобайтной буквы и «…»; не длиннее — строка целиком.
export function expectedSnippet(line) {
  const b = Buffer.from(line, 'utf8');
  if (b.length <= 160) return line;
  let cut = 160;
  while (cut > 0 && (b[cut] & 0xc0) === 0x80) cut--; // b[cut] — первый байт за границей; продолжение => буква разрезана
  return b.subarray(0, cut).toString('utf8') + '…';
}
// «    N: <начало прогона> (L знаков)»: прогон — первая последовательность ≥21 символа [A-Za-z0-9+/=_-]
// после удаления участков в бэктиках; начало — первые 16 символов + «…» (прогон ≥21, поэтому всегда).
export function expectedSecret(line) {
  const m = line.replace(/`[^`]*`/g, '').match(/[A-Za-z0-9+\/=_-]{21,}/);
  if (!m) return null;
  const run = m[0];
  return `${run.length <= 16 ? run : run.slice(0, 16) + '…'} (${run.length} знаков)`;
}
const draftLines = (draftPath) => fs.readFileSync(draftPath, 'utf8').split('\n').map((l) => l.replace(/\r$/, ''));
function checkSnippets(snippets, draftPath, hand) {
  const lines = draftLines(draftPath);
  const bad = [];
  for (const s of snippets) {
    const want = expectedSnippet(lines[s.n - 1] ?? '');
    if (s.text !== want) bad.push(`стр. ${s.n}: ждали «${want}», есть «${s.text}»`);
  }
  // ручные ожидания из expect.json: {"N": [байт без «…», есть ли «…»]}
  for (const [n, [bytes, ell]] of Object.entries(hand ?? {})) {
    const s = snippets.find((x) => x.n === +n);
    if (!s) { bad.push(`стр. ${n}: строки-фрагмента нет в выводе`); continue; }
    const hasEll = s.text.endsWith('…');
    const len = Buffer.byteLength(hasEll ? s.text.slice(0, -1) : s.text, 'utf8');
    if (len !== bytes || hasEll !== ell) bad.push(`стр. ${n}: ждали ${bytes} байт ${ell ? 'с' : 'без'} «…», есть ${len} байт ${hasEll ? 'с' : 'без'} «…»`);
  }
  return bad.length ? `${bad.length} не совпали; ${bad[0]}` : 'ок';
}
// строки-подстроки секретов: каждая сверяется с черновиком; extra — ручной точный список текстов (из expect.json)
function checkSecretLines(secretLines, draftPath, extra, secret) {
  const lines = draftLines(draftPath);
  const bad = [];
  if (secret && secret.n > 0 && secretLines.length === 0) bad.push('под строкой секретов нет строк «N: начало (L знаков)»' + (secret.oldFormat ? ' (старый формат «— номера:»)' : ''));
  for (const s of secretLines) {
    const want = `${s.n}: ${expectedSecret(lines[s.n - 1] ?? '')}`;
    if (s.text !== want) bad.push(`стр. ${s.n}: ждали «${want}», есть «${s.text}»`);
  }
  if (extra) {
    const got = secretLines.map((s) => s.text);
    if (JSON.stringify(got) !== JSON.stringify(extra)) bad.push(`ручной список: ждали ${JSON.stringify(extra)}, есть ${JSON.stringify(got)}`);
  }
  return bad.length ? `${bad.length} не совпали; ${bad[0]}` : 'ок';
}
// подстроки, которых в выводе быть не должно (например, строка свежести части из описи)
function checkAbsent(out, words) {
  const found = words.filter((w) => out.includes(w));
  return found.length ? `в выводе есть: ${found.join(' | ')}` : 'ок';
}
// весь stdout — валидный UTF-8
function checkUtf8(buf) {
  try { new TextDecoder('utf-8', { fatal: true }).decode(buf); return 'ок'; } catch { return 'невалидный UTF-8 в выводе'; }
}

// Списки обрезаются на 40 именах («…и ещё N»). Строки «исчезли:/появились:» гарда контракт
// требует только при исчезло > 0. Проверяется только на синтетике (там в именах нет «; »).
function checkLists(parsed) {
  const bad = [];
  for (const L of parsed.lists) {
    if (L.n === 0) continue;
    if (!L.items) { bad.push(`${L.label}: ${L.n}, а списка нет`); continue; }
    const items = L.items.split('; ');
    let rest = 0;
    const last = items[items.length - 1].match(/и ещё (\d+)\s*$/);
    if (last) { rest = +last[1]; items.pop(); }
    const wantShown = Math.min(L.n, 40);
    const wantRest = Math.max(L.n - 40, 0);
    if (items.length !== wantShown || rest !== wantRest) bad.push(`${L.label}: n=${L.n}, показано ${items.length}+«ещё ${rest}», ждали ${wantShown}+«ещё ${wantRest}»`);
  }
  const G = parsed.r['гард'];
  if (G) {
    for (const [c, v] of Object.entries(G)) {
      if (v[1] === 0) continue;
      for (const [i, word] of [[1, 'исчезли'], [2, 'появились']]) {
        if (v[i] > 0 && !parsed.lists.some((l) => l.label === `${c}/${word}`)) bad.push(`${c}: ${word} ${v[i]}, а строки «${word}:» нет`);
      }
    }
  }
  return bad.length ? bad.join(' | ') : 'ок';
}

// ---------- плоские поля для сравнения ----------

const fmtClasses = (bc) => Object.entries(bc ?? {}).filter(([, n]) => n > 0).sort(([a], [b]) => a.localeCompare(b, 'ru')).map(([k, n]) => `${k} ${n}`).join(', ') || '—';

function flatten(r) {
  const out = new Map();
  if ('пропуски' in r) for (const [a, notes] of Object.entries(r['пропуски'])) out.set(`пропуски.${a}`, [...notes].sort().join('\n'));
  const D = r['черновик'] ?? {};
  for (const k of ['контракт', 'сущности', 'задачи', 'топики', 'бизнес', 'таблицы']) if (k in D) out.set(`черновик.${k}`, D[k].join('/'));
  if ('без префикса' in D) out.set('черновик.без префикса', String(D['без префикса']));
  const MK = r['маркеры'];
  if (MK) {
    if ('гейт' in MK) out.set('маркеры.гейт', MK['гейт']);
    out.set('маркеры.классы', Object.entries(MK['классы'] ?? {}).sort(([a], [b]) => a.localeCompare(b, 'ru')).map(([k, v]) => `${k} ${v}`).join('; ') || '—');
    if ('файлов' in MK) out.set('маркеры.по файлам', `${MK['файлов']}: ${[...(MK['дефицит'] ?? [])].sort().join(', ') || '—'}`);
  }
  const OUT = r['исход'];
  if (OUT) {
    for (const k of ['маркеры', 'тело', 'гард']) if (k in OUT) out.set(`исход.${k}`, OUT[k]);
    if ('исход' in OUT) out.set('исход', OUT['исход']);
    out.set('исход.добор', Object.entries(OUT['добор'] ?? {}).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k} ${v}`).join('; ') || 'пусто');
    // виды пунктов по авторам — где ожидание их задаёт (оракул задаёт всегда)
    if ('виды' in OUT) out.set('исход.виды', Object.entries(OUT['виды']).flatMap(([a, v]) => Object.entries(v).map(([k, n]) => `${a}: ${k} ${n}`)).sort().join('; ') || '—');
    out.set('исход.в отчёт', (OUT['в отчёт'] ?? []).join(' ¦ ') || '—');
  }
  if ('ключи' in D) out.set('черновик.ключи', ['контракт', 'сущности', 'задачи', 'топики', 'экраны'].map((c) => `${c} ${D['ключи'][c] ?? 0}`).join(', '));
  const O = r['опись'] ?? {};
  if ('ключей' in O) out.set('опись.ключей', String(O['ключей']));
  if ('бизнес' in O) out.set('опись.бизнес', O['бизнес'].join('/'));
  if ('без файла' in O) out.set('опись.без файла', String(O['без файла']));
  if ('итоги' in O) out.set('опись.итоги', O['итоги'].join(' ¦ ') || '(нет)');
  const S = r['сверка'] ?? {};
  for (const k of ['нет в черновике', 'нет в описи', 'факт, пустой блок']) if (k in S) out.set(`сверка.${k}`, String(S[k]));
  if ('по классам' in S) out.set('сверка.по классам', fmtClasses(S['по классам']));
  if ('групп' in S) out.set('сверка.групп', String(S['групп']));
  if ('добор' in S) out.set('сверка.добор', S['добор']);
  if ('гард' in r) {
    if (r['гард'] === null) out.set('гард', 'нет');
    else {
      for (const c of GUARD_CLASSES) out.set(`гард.${c}`, (r['гард'][c] ?? [0, 0, 0, 0]).join('/'));
      // справка: путь с несколькими записями в прежней карточке, которых стало меньше
      out.set('гард.пути', [...(r['пути'] ?? [])].sort().join(' ¦ ') || '—');
    }
  }
  if (r['кандидаты']) {
    const C = r['кандидаты'];
    for (const k of CAND_KEYS) {
      if (!(k in C)) continue;
      const v = C[k];
      let s;
      // порядок перечисления секций контракт не задаёт — сравнивается как множество
      if (k === 'порядок') s = Array.isArray(v) ? [...v].sort().join('; ') : v;
      else if (Array.isArray(v)) s = `${v.length}: ${v.slice(0, 15).join(' ')}`.trim();
      else if (v && typeof v === 'object') s = `${v.n}: ${v.listed.join(' ')}`.trim();
      else s = String(v);
      out.set(`кандидаты.${k}`, s);
    }
  }
  if ('сработал' in r) out.set('гард.сработал', [...r['сработал']].sort().join(', ') || '—');
  if ('маршрут' in r) out.set('маршрут', r['маршрут'] ?? 'нет');
  return out;
}

// ---------- таблица ----------

const rows = [];
const W = { c: 24, f: 26, v: 44 };
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const padR = (s, n) => s + ' '.repeat(Math.max(0, n - [...s].length));
function row(c, f, e, g, st) {
  console.log(`${padR(cut(c, W.c), W.c)} ${padR(cut(f, W.f), W.f)} ${padR(cut(e, W.v), W.v)} ${padR(cut(g, W.v), W.v)} ${st}`);
}
function header(title) {
  console.log('\n' + title);
  row('случай', 'поле', 'ожидалось', 'получено', 'итог');
  console.log('-'.repeat(W.c + W.f + 2 * W.v + 16));
}

function compareCase(phase, name, expMap, gotMap, extra = {}) {
  let bad = 0;
  for (const [f, e] of expMap) {
    const g = gotMap.get(f) ?? '(нет в выводе)';
    if (g !== e) {
      bad++;
      row(name, f, e, g, 'РАСХОЖДЕНИЕ');
      rows.push({ phase, name, f, e, g, note: extra.note });
    }
  }
  for (const [f, v] of Object.entries(extra.checks ?? {})) {
    if (v !== 'ок') {
      bad++;
      row(name, f, 'ок', v, 'РАСХОЖДЕНИЕ');
      rows.push({ phase, name, f, e: 'ок', g: v, note: extra.note });
    }
  }
  if (!bad) row(name, `все ${expMap.size + Object.keys(extra.checks ?? {}).length} полей`, '', extra.time ?? '', 'ок');
  return bad;
}

const readOut = (name) => ({
  raw: fs.readFileSync(path.join(OUT, `${name}.out`)),
  out: fs.readFileSync(path.join(OUT, `${name}.out`), 'utf8'),
  err: fs.existsSync(path.join(OUT, `${name}.err`)) ? fs.readFileSync(path.join(OUT, `${name}.err`), 'utf8').trim() : '',
  rc: fs.existsSync(path.join(OUT, `${name}.rc`)) ? fs.readFileSync(path.join(OUT, `${name}.rc`), 'utf8').trim() : '?',
  ms: fs.existsSync(path.join(OUT, `${name}.ms`)) ? fs.readFileSync(path.join(OUT, `${name}.ms`), 'utf8').trim() : '?',
});

const casesDir = path.join(HERE, 'cases');
const caseNames = fs.readdirSync(casesDir).filter((n) => fs.existsSync(path.join(casesDir, n, 'expect.json'))).sort();
const files = (n) => {
  const d = path.join(casesDir, n);
  const prev = path.join(d, 'prev.md');
  const work = path.join(d, '.work', 'draft.md');
  const env = path.join(d, 'env');
  return [path.join(d, 'opis.md'), fs.existsSync(work) ? work : path.join(d, 'draft.md'), fs.existsSync(prev) ? prev : null, fs.existsSync(env) ? env : null];
};
const stats = { 1: [0, 0], 2: [0, 0], 3: [0, 0] }; // [случаев, с расхождением]

// (1) оракул ↔ expect.json
header('ФАЗА 1. ОРАКУЛ против expect.json (синтетика, числа посчитаны руками)');
for (const n of caseNames) {
  const exp = JSON.parse(fs.readFileSync(path.join(casesDir, n, 'expect.json'), 'utf8'));
  const got = analyzeFiles(...files(n));
  const bad = compareCase(1, n, flatten(exp), flatten(got), { note: exp['о чём'] });
  stats[1][0]++;
  if (bad) stats[1][1]++;
}

// (2) скрипт ↔ expect.json
header('ФАЗА 2. СКРИПТ против expect.json (синтетика)');
for (const n of caseNames) {
  const exp = JSON.parse(fs.readFileSync(path.join(casesDir, n, 'expect.json'), 'utf8'));
  const o = readOut(n);
  const parsed = parseOutput(o.out);
  if (exp['пропуски']) {
    parsed.r['пропуски'] = {};
    for (const a of Object.keys(exp['пропуски'])) {
      const id = a === 'без хозяина' ? 'none' : a;
      const file = path.join(OUT, `${n}.list-${id}.md`);
      const list = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      const block = list.split('## пропущено частью — проверь ключ по источнику и допиши карточку и опись\n')[1] ?? '';
      parsed.r['пропуски'][a] = block.split(/\r?\n/).filter((l) => l && !l.startsWith('## '));
    }
  }
  const em = flatten(exp);
  em.set('код выхода', '0');
  em.set('stderr', '(пусто)');
  const gm = flatten(parsed.r);
  gm.set('код выхода', o.rc);
  gm.set('stderr', o.err ? o.err.split('\n')[0] : '(пусто)');
  const bad = compareCase(2, n, em, gm, { note: exp['о чём'], time: `${o.ms} мс`, checks: { 'списки ≤40 и «…и ещё N»': checkLists(parsed), 'вывод: валидный UTF-8': checkUtf8(o.raw), ...(exp['нет в выводе'] ? { 'вывод: запрещённые подстроки': checkAbsent(o.out, exp['нет в выводе']) } : {}), ...(exp['кандидаты'] ? { 'кандидаты: фрагменты 160 байт': checkSnippets(parsed.snippets, files(n)[1], exp['фрагменты']), 'кандидаты: секрет, начало и длина': checkSecretLines(parsed.secretLines, files(n)[1], exp['секрет-строки'], parsed.r['кандидаты']?.['секрет']) } : {}) } });
  stats[2][0]++;
  if (bad) stats[2][1]++;
}

// (3) скрипт ↔ оракул на настоящих файлах
header('ФАЗА 3. СКРИПТ против ОРАКУЛА (настоящие файлы r5/r8)');
const realList = fs.readFileSync(path.join(HERE, 'real-cases.txt'), 'utf8').split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
for (const line of realList) {
  const [name, opis, draft, prev] = line.split('|').map((s) => (s ?? '').trim());
  const got = analyzeFiles(path.join(EVAL, opis), path.join(EVAL, draft), prev ? path.join(EVAL, prev) : null);
  const o = readOut(name);
  const parsed = parseOutput(o.out);
  const em = flatten(got);
  em.set('код выхода', '0');
  const gm = flatten(parsed.r);
  gm.set('код выхода', o.rc);
  const bad = compareCase(3, name, em, gm, { time: `${o.ms} мс`, checks: { 'вывод: валидный UTF-8': checkUtf8(o.raw), 'кандидаты: фрагменты 160 байт': checkSnippets(parsed.snippets, path.join(EVAL, draft)), 'кандидаты: секрет, начало и длина': checkSecretLines(parsed.secretLines, path.join(EVAL, draft), undefined, parsed.r['кандидаты']?.['секрет']) } });
  stats[3][0]++;
  if (bad) stats[3][1]++;
}

// ---------- итог ----------
console.log('\nИТОГ');
console.log(`  фаза 1 (оракул ↔ expect):   случаев ${stats[1][0]}, с расхождением ${stats[1][1]}`);
console.log(`  фаза 2 (скрипт ↔ expect):   случаев ${stats[2][0]}, с расхождением ${stats[2][1]}`);
console.log(`  фаза 3 (скрипт ↔ оракул):   случаев ${stats[3][0]}, с расхождением ${stats[3][1]}`);
console.log(`  всего расхождений (полей): ${rows.length} (фаза 1: ${rows.filter((r) => r.phase === 1).length}, фаза 2: ${rows.filter((r) => r.phase === 2).length}, фаза 3: ${rows.filter((r) => r.phase === 3).length})`);
const bigF = path.join(OUT, '_big.txt');
if (fs.existsSync(bigF)) {
  const [name, bytes, ...ms] = fs.readFileSync(bigF, 'utf8').trim().split('|');
  const sorted = ms.map(Number).sort((a, b) => a - b);
  console.log(`  время на самом крупном (${name}, ${Math.round(+bytes / 1024)} КБ на входе): медиана ${sorted[Math.floor(sorted.length / 2)]} мс (прогоны: ${ms.join(', ')} мс)`);
}
process.exit(rows.length ? 1 : 0);
