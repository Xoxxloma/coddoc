#!/usr/bin/env node
// Грейдер среза 2б `interaction-diagram` 5.2.0 (`PLAN-ID-CORE.md` §8.3): схема по списку пунктов `*.points.md`.
//
//   node grade-pt.mjs <папка-пробы>          — прогоны `run-*` пробы из `PROBES`, строка на прогон и итог
//   node grade-pt.mjs --round <папка-раунда> — сводка по пробам из `PROBES`, пороги — только у прогонов Sonnet
//   node grade-pt.mjs --selftest
//
// Фикстура `ID-PT`: список встречи (короткая) и выгрузка ноута (путь пользователя); рядом — ноут, спека и старая схема
// по спеке (ловушки). Пробы:
// - `pt-sh-mmd`, `pt-sh-idk` — короткая по списку встречи: ход 1 — вопрос о типе, ход 2 — «Короткую.» и вопросы,
//   ход 3 — реплика и файл;
// - `pt-sh-no` — то же, но на открытый п.5 ответ «не рисовать»: стрелки п.5 нет, в «в источник стоит внести» его нет;
// - `pt-uf-puml`, `pt-uf-idk` — путь пользователя по выгрузке ноута, те же три хода;
// - `pt-raw` — `interaction-diagram` дали ноут вместо списка: отсылка к `собери пункты`, файла нет;
// - `pt-nb` — `analyst-notebook` просят схему, кто кого вызывает: отсылка к `/interaction-diagram`, файла нет.
// Запасной вход (5.3.0, `PLAN-ID-CORE.md` §9), фикстура `ID-TXT`, id `стр.N`:
// - `tx-sh-mmd` — короткая по тексту файлом, с ответами; `tx-sh-idk` — тот же текст в чате, «не знаю», схема `draft.*`;
// - `tx-uf-puml` — путь по тексту процесса; `pt-prose` — `*.points.md` из одной прозы — черновиком;
// - `pt-junk` — список с кривыми строками: схема по нормальным пунктам, кривые названы в списке прочтения (Н1).
// У текста ещё Ч1 (шапка «черновик по тексту»).
//
// «Схема верна»: короткая — К0 (список и соседи не тронуты), К1 (файл один, имя с основой списка), К2 (разбор), К3
// (участники = истине), К4 (стрелки = истине: стороны, вид, id, токен), К5 (порядок стрелок); путь — К0, К1 и У2–У4
// `grade-uf.mjs` с id `п.N`. Отдельно: Т1 (ход 1 — только вопрос о типе: короткая и путь), В1 (ход 2 — вопросы, файла
// нет), Р1 (по файлу из папки), Ш1 (шапка: порядок), Д1 (строка «в источник стоит внести»), М1 (мысль и набросок в
// отчёте — диагностика), Сл (слова узлов пути — из своего пункта или реплики — диагностика). Отсылки — О1.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDiagram } from './grade-id.mjs';
import { gradeGraph, foreignWords, ID_PT, ID_TX, leadTools, listFiles } from './grade-uf.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const fixOf = (p) => join(HERE, 'fixtures', p.fix ?? 'ID-PT');
const FIX = fixOf({});
// Пробы запасного входа (`inputs/text.md`, фикстура `ID-TXT`): `src: 'text'` — вход «текст», id `стр.N`; `chat` — текст в
// промпте, схема `draft.*` в корне; `junk` — кривые строки списка названы в списке прочтения (Н1).
const TXT = { fix: 'ID-TXT', src: 'text', pre: 'стр' };
const PROBES = {
  'pt-sh-mmd': { kind: 'short', format: 'mmd', truth: 'truth-sh-s.json', reply: 'sh-s-turn2.txt' },
  'pt-sh-idk': { kind: 'short', format: 'mmd', truth: 'truth-sh-idk.json', reply: 'idk-turn2.txt' },
  'pt-sh-no': { kind: 'short', format: 'mmd', truth: 'truth-sh-no.json', reply: 'no-turn2.txt' },
  'pt-uf-puml': { kind: 'uf', format: 'puml', truth: 'truth-uf-s.json', reply: 'uf-s-turn2.txt' },
  'pt-uf-idk': { kind: 'uf', format: 'puml', truth: 'truth-uf-idk.json', reply: 'idk-turn2.txt' },
  'pt-raw': { kind: 'route', want: ['собери пункты'] },
  'pt-nb': { kind: 'route', want: ['interaction-diagram', 'собери пункты'] },
  'tx-sh-mmd': { ...TXT, kind: 'short', format: 'mmd', truth: 'truth-tx-s.json', reply: 'tx-s-turn2.txt' },
  'tx-sh-idk': { ...TXT, kind: 'short', format: 'mmd', truth: 'truth-tx-idk.json', reply: 'idk-turn2.txt', chat: true },
  'tx-uf-puml': { ...TXT, kind: 'uf', format: 'puml', truth: 'truth-uf-s.json', reply: 'uf-s-turn2.txt' },
  'pt-junk': { fix: 'ID-TXT', kind: 'short', format: 'mmd', truth: 'truth-junk.json', reply: 'idk-turn2.txt' },
  'pt-prose': { ...TXT, kind: 'short', format: 'mmd', truth: 'truth-prose.json', reply: 'idk-turn2.txt' },
};
const GATE = { core: 4, asked: 5, of: 5 }; // Sonnet, на пробу: схема верна (у отсылки — О1) ≥ 4/5, Т1 и В1 5/5

const norm = (s) => s.replace(/\r/g, '');
const read = (p) => (existsSync(p) ? norm(readFileSync(p, 'utf8')) : null);
const low = (s) => (s ?? '').toLowerCase().replace(/ё/g, 'е');
const JUNK = /^(answer(-\d+)?\.md|stream(-\d+)?\.jsonl|_seeded\.(txt|sha256)|_stderr\.log|_api-failure(-turn)?\.txt)$/;
const ptRe = (n, pre = 'п') => new RegExp(`${pre}\\.\\s?${Number(n)}(?!\\d)`, 'i');
const anyId = (pre = 'п') => new RegExp(`${pre}\\.\\s?\\d`, 'i');
const streams = (runDir) => (existsSync(runDir) ? readdirSync(runDir) : []).filter((e) => /^stream(-\d+)?\.jsonl$/.test(e)).map((f) => read(join(runDir, f)));
const wrote = (stream) => leadTools(stream).some((c) => ['Write', 'Edit', 'Bash'].includes(c.name) && /interaction_|user_flow/.test(JSON.stringify(c.input ?? '')));
const flatHead = (text) => low(text).replace(/\s*\n[ \t]*[>']?\s*/g, ' ');
const lastAnswer = (runDir) => { const f = readdirSync(runDir).filter((x) => /^answer-\d+\.md$/.test(x)).sort().at(-1); return read(join(runDir, f ?? 'answer.md')) ?? ''; };

/** Имя файла схемы: основа источника + имя из таблицы типов и форматов; основа — имя без `.points.md` или без расширения;
 *  черновик по тексту (`draft`) — `<основа>.draft.<имя>`, текст в чате (`null`) — `draft-*.<имя>` в корне (дата и `-N`). */
export function diagramFile(src, kind, format, draft = false) {
  const name = `${kind === 'uf' ? 'user_flow' : 'interaction_diagram'}.${format === 'puml' ? 'puml' : 'md'}`;
  if (src == null) return `draft-*.${name}`;
  const base = /\.points\.md$/.test(src) ? src.replace(/\.points\.md$/, '') : src.replace(/\.[^./]+$/, '');
  return `${base}.${draft ? 'draft.' : ''}${name}`;
}

/** Файл `f` — тот, что задаёт `diagramFile`: для чата — `draft-ГГГГ-ММ-ДД[-N].<имя>` в корне. */
export const fits = (want, f) => (want.startsWith('draft-*.') ? /^draft-\d{4}-\d{2}-\d{2}(-\d+)?\./.test(f) && f.endsWith(want.slice('draft-*'.length)) && !f.includes('/') : f === want);

/** Строки текста: номер непустой строки → строка. */
export function textLines(text) {
  const out = {};
  let n = 0;
  for (const l of (text ?? '').split('\n')) if (l.trim()) out[++n] = l.trim();
  return out;
}

/** Пункты списка: номер → текст строки (без `- `). */
export function points(text) {
  const out = {};
  let n = 0;
  for (const l of (text ?? '').split('\n')) if (/^- \[[^\]]+\]/.test(l)) out[++n] = l.slice(2);
  return out;
}

// ---------- короткая ----------

const nameKey = (s) => low(s).replace(/[`"«»]/g, '').replace(/\s+/g, ' ').trim();
const unesc = (s) => s.replace(/#59;/g, ';').replace(/#35;/g, '#').replace(/#quot;/g, '"');

/** Подпись `п.N` или `п.N · <токен>` → { id, token }; иначе null. */
export function parseLabel(label, pre = 'п') {
  const m = unesc(label).trim().match(new RegExp(`^${pre}\\.\\s?(\\d+)\\s*(?:·\\s*(.+))?$`, 'i'));
  return m ? { id: Number(m[1]), token: m[2] ? m[2].replace(/`/g, '').replace(/\s+/g, ' ').trim() : null } : null;
}

/** К2–К5 по тексту файла короткой. */
export function gradeShort(text, truth, pre = 'п') {
  const r = {};
  const d = text == null ? null : parseDiagram(text, 'mmd');
  r['К2 разбор'] = d != null && d.other.length === 0 && d.notes.length === 0 && d.actors.size === 0 && d.parts.size > 0;
  if (!r['К2 разбор']) { r['К3 участники = истине'] = false; r['К4 стрелки = истине'] = false; r['К5 порядок стрелок'] = false; return { r, why: d ? `лишние строки: ${d.other.join(' | ')}` : 'нет блока mermaid' }; }
  const idx = (name) => truth.participants.findIndex((vs) => vs.some((v) => nameKey(v) === nameKey(name)));
  const got = [...d.parts.values()];
  const unknown = got.filter((g) => idx(g) < 0);
  const hit = new Set(got.map(idx).filter((i) => i >= 0));
  r['К3 участники = истине'] = unknown.length === 0 && hit.size === truth.participants.length && got.length === truth.participants.length;
  const who = (alias) => idx(d.parts.get(alias) ?? alias);
  const key = (a) => `${a.from}>${a.to}|${a.kind}|п.${a.id}|${a.token ? nameKey(a.token) : ''}`;
  const mine = d.arrows.map((a) => {
    const l = parseLabel(a.label, pre);
    const kind = a.dashed || a.both || a.cross ? 'bad' : a.async ? 'event' : 'req';
    return { from: who(a.from), to: who(a.to), kind, id: l?.id ?? '?', token: l?.token ?? null };
  });
  const want = truth.arrows.map((a) => ({ ...a, from: idx(a.from), to: idx(a.to) }));
  const gk = mine.map(key);
  const wk = want.map(key);
  const lost = wk.filter((k) => !gk.includes(k));
  const added = gk.filter((k) => !wk.includes(k));
  r['К4 стрелки = истине'] = lost.length === 0 && added.length === 0 && gk.length === wk.length;
  r['К5 порядок стрелок'] = r['К4 стрелки = истине'] && gk.every((k, i) => k === wk[i]);
  const nm = (k) => k.replace(/^(-?\d+)>(-?\d+)/, (_, a, b) => `${truth.participants[a]?.[0] ?? '?'}>${truth.participants[b]?.[0] ?? '?'}`);
  const why = [unknown.length ? `чужие участники: ${unknown.join(', ')}` : '', lost.length ? `нет стрелки: ${lost.map(nm).join('; ')}` : '',
    added.length ? `лишняя стрелка: ${added.map(nm).join('; ')}` : '', r['К4 стрелки = истине'] && !r['К5 порядок стрелок'] ? `порядок: ${mine.map((a) => a.id).join(',')}` : ''].filter(Boolean).join('; ');
  return { r, why };
}

// ---------- ходы ----------

/** Т1 по ходу 1: вопрос о типе — «?», короткая и путь, без «сценар», без строк списка `п.N`, файла нет. Пусто — в порядке. */
export function typeMiss(a1, s1, pre = 'п') {
  if (a1 == null) return ['первого хода нет'];
  return [...(a1.includes('?') ? [] : ['знака «?» нет']), ...(/коротк/i.test(a1) ? [] : ['нет «коротк»']), ...(/пут[ьи]/i.test(a1) ? [] : ['нет «путь»']),
    ...(/сценар/i.test(a1) ? ['есть «сценар»'] : []), ...(anyId(pre).test(a1) ? [`есть ${pre}.N`] : []), ...(wrote(s1) ? ['файл записан ходом 1'] : [])];
}

/** В1 по ходу 2: «?», «поряд», по каждому пункту-дыре строка с `п.N` и «?» (в ней или в следующей), оба имени одной системы. */
export function unasked(a2, s2, truth, pre = 'п') {
  if (a2 == null) return ['второго хода нет'];
  const out = [...(wrote(s2) ? ['файл записан ходом 2'] : []), ...(a2.includes('?') ? [] : ['знака «?» нет'])];
  if (truth.asks.order && !/поряд/i.test(a2)) out.push('порядок');
  const lines = a2.split('\n');
  const about = (n) => lines.some((l, i) => ptRe(n, pre).test(l) && (l.includes('?') || (lines[i + 1] ?? '').includes('?')));
  for (const n of [...(truth.asks.open ?? []), ...(truth.asks.dir ?? []), ...(truth.asks.branch ?? []), ...(truth.asks.end ?? [])]) if (!about(n)) out.push(`${pre}.${n}`);
  for (const nm of truth.asks.same ?? []) if (!low(a2).includes(low(nm))) out.push(`участник ${nm}`);
  return out;
}

/** Р1: вход (`points.md` или `text.md`), тип и формат — по одному файлу из папки, других из этих папок нет. */
export function readRefs(runDir, kind, format, src = 'points') {
  const want = [`reference/inputs/${src}.md`, `reference/kinds/${kind === 'uf' ? 'user-flow' : 'short'}.md`, `reference/notation/${format === 'puml' ? 'plantuml' : 'mermaid'}.md`];
  const got = streams(runDir).flatMap((s) => leadTools(s).filter((c) => c.name === 'Read' && typeof c.input?.file_path === 'string')
    .map((c) => c.input.file_path.replace(/\\/g, '/'))).filter((p) => /reference\/(inputs|kinds|notation)\//.test(p));
  return want.every((w) => got.some((p) => p.endsWith(w))) && got.every((p) => want.some((w) => p.endsWith(w)));
}

/** Ш1: шапка говорит, откуда порядок. */
export function headOrder(text, kind, known, word = 'пунктов') {
  const h = flatHead(text);
  if (kind === 'uf') return known ? h.includes('по порядку со слов аналитика') : h.includes(`по номерам ${word}`) && !h.includes('со слов аналитика');
  return known ? h.includes('по времени, со слов аналитика') : h.includes(`по номерам ${word}, не по времени`);
}

/** Н1: каждая кривая строка списка названа в ходе 2 — в списке прочтения: строка-не-пункт — по началу текста, пункт с
 *  незнакомым видом (`{id, word}`) — строкой с его `п.N` и словом вида. */
export const junkNamed = (a2, junk) => (junk ?? []).every((j) => (typeof j === 'string' ? nameKey(a2 ?? '').includes(nameKey(j))
  : (a2 ?? '').split('\n').some((l) => ptRe(j.id).test(l) && low(l).includes(low(j.word)))));

/** Д1: строка «в источник стоит внести» называет каждый `п.N` из `holes` (и склейку участников), ни одного из `notHoles`; дыр нет — без `п.N`. */
export function sourceLine(answer, truth, pre = 'п') {
  const l = (answer ?? '').split('\n').find((x) => /^[\s>*_•-]*в источник стоит внести/i.test(x));
  if (!l) return false;
  const glue = truth.glued ? /участник/i.test(l) : true;
  return (truth.holes.length ? truth.holes.every((n) => ptRe(n, pre).test(l)) : !anyId(pre).test(l)) && glue
    && (truth.notHoles ?? []).every((n) => !ptRe(n, pre).test(l));
}

/** М1: в отчёте строка с «мысли» и их числом (`interaction-diagram` после слияния видов ноута: «мысли: <N>»). */
export const thoughtsLine = (answer, n) => (answer ?? '').split('\n').some((l) => /мысл/i.test(l) && new RegExp(`(^|\\D)${Number(n)}(\\D|$)`).test(l));

// ---------- прогон ----------

export function gradeRun(runDir, probe) {
  const p = PROBES[probe];
  const fix = fixOf(p);
  const pre = p.pre ?? 'п';
  const fixFiles = new Set(listFiles(fix));
  const made = listFiles(runDir).filter((f) => !fixFiles.has(f) && !JUNK.test(f.split('/').pop()));
  const kept = [...fixFiles].filter((f) => /^(coddoc|notes)\//.test(f)).every((f) => read(join(runDir, f)) === read(join(fix, f)));
  const r = {};
  if (p.kind === 'route') {
    const a = lastAnswer(runDir) ?? '';
    const miss = p.want.filter((w) => !low(a).includes(w));
    r['О1 отсылка, файла нет'] = kept && made.length === 0 && miss.length === 0;
    return { r, why: [made.length ? `файлы: ${made.join(', ')}` : '', miss.length ? `нет: ${miss.join(', ')}` : ''].filter(Boolean).join('; '), miss: [], words: [], made };
  }
  const truth = JSON.parse(read(join(fix, p.truth)));
  const src = p.chat ? null : truth.source !== undefined ? truth.source : truth.list;
  const want = diagramFile(src, p.kind, p.format, p.src === 'text');
  const file = made.find((f) => fits(want, f));
  r['К0 список и соседи не тронуты'] = kept;
  r['К1 файл один, имя'] = made.length === 1 && file != null;
  const text = file ? read(join(runDir, file)) : null;
  const g = p.kind === 'uf' ? gradeGraph(text, p.format, truth, pre === 'стр' ? ID_TX : ID_PT) : gradeShort(text, truth, pre);
  Object.assign(r, g.r);
  const a2 = read(join(runDir, 'answer-02.md'));
  if (truth.junk) r['Н1 кривые строки названы'] = junkNamed(a2, truth.junk);
  const miss = [...typeMiss(read(join(runDir, 'answer-01.md')), read(join(runDir, 'stream.jsonl')), pre).map((x) => `Т1: ${x}`),
    ...unasked(a2, read(join(runDir, 'stream-02.jsonl')), truth, pre)];
  r['Т1 вопрос о типе'] = !miss.some((x) => x.startsWith('Т1'));
  r['В1 спросил'] = !miss.some((x) => !x.startsWith('Т1'));
  r['Р1 прочитан reference'] = readRefs(runDir, p.kind, p.format, p.src ?? 'points');
  const known = p.kind === 'uf' ? truth.asks.order && p.reply !== 'idk-turn2.txt' : truth.ordered;
  r['Ш1 шапка: порядок'] = headOrder(text, p.kind, known, pre === 'стр' ? 'строк' : 'пунктов');
  if (p.src === 'text') r['Ч1 шапка: черновик по тексту'] = flatHead(text).includes('черновик по тексту');
  const last = lastAnswer(runDir);
  r['Д1 в источник стоит внести'] = sourceLine(last, truth, pre);
  let words = [];
  if (p.kind === 'uf') {
    if (p.src !== 'text' && truth.thoughts != null) r['М1 мысль и набросок в отчёте'] = thoughtsLine(last, truth.thoughts);
    const items = pre === 'стр' ? textLines(read(join(fix, src))) : points(read(join(fix, src)));
    words = g.graph ? foreignWords(g.graph, items, read(join(fix, p.reply)), pre === 'стр' ? ID_TX : ID_PT) : ['нет графа'];
    r['Сл слова источника'] = words.length === 0;
  }
  return { r, why: g.why, miss, words, made };
}

const CORE = ['К0', 'К1', 'К2', 'К3', 'К4', 'К5', 'У2', 'У3', 'У4', 'О1', 'Н1'];
const isCore = (k) => CORE.some((c) => k.startsWith(`${c} `));
const failed = (runDir) => existsSync(runDir) && readdirSync(runDir).some((f) => /^_api-failure/.test(f));
const modelOf = (probeDir) => (read(join(probeDir, '_settings.txt')) ?? '').match(/модель:\s*(\S+)/)?.[1] ?? '?';

export function gradePool(probeDir, probe) {
  const runs = (existsSync(probeDir) ? readdirSync(probeDir) : []).filter((e) => /^run-\d+$/.test(e)).sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)));
  const out = [];
  const tally = {};
  let core = 0; let asked = 0; let n = 0; const fails = [];
  for (const run of runs) {
    const dir = join(probeDir, run);
    if (failed(dir)) { fails.push(run); continue; }
    const g = gradeRun(dir, probe);
    n++;
    const reds = Object.entries(g.r).filter(([, v]) => !v).map(([k]) => k.split(' ')[0]);
    if (Object.entries(g.r).filter(([k]) => isCore(k)).every(([, v]) => v)) core++;
    if (PROBES[probe].kind === 'route' || (g.r['Т1 вопрос о типе'] && g.r['В1 спросил'])) asked++;
    for (const [k, v] of Object.entries(g.r)) { tally[k] ??= 0; if (v) tally[k]++; }
    out.push(`${run}: ${reds.length ? `красный ${reds.join(',')}` : 'зелёный'}${g.why ? `  ${g.why}` : ''}${g.miss.length ? `  вопросы: ${g.miss.join(', ')}` : ''}${g.words.length && !reds.includes('У2') ? `  Сл: ${g.words.slice(0, 4).join(' ')}` : ''}`);
  }
  out.push('---', ...Object.entries(tally).map(([k, v]) => `${k}: ${v}/${n}`), `схема верна: ${core}/${n}`, `сбой API: ${fails.length}${fails.length ? ` (${fails.join(', ')})` : ''}`);
  return { out, core, asked, n, model: modelOf(probeDir) };
}

export function gradeRound(roundDir) {
  const out = [];
  let green = true;
  for (const probe of Object.keys(PROBES)) {
    const dir = join(roundDir, probe);
    if (!existsSync(dir)) { out.push(`${probe}: прогонов нет`); continue; }
    const g = gradePool(dir, probe);
    const gate = /sonnet/i.test(g.model);
    const pass = !gate || (g.n > 0 && g.core >= GATE.core * g.n / GATE.of && g.asked >= GATE.asked * g.n / GATE.of);
    if (!pass) green = false;
    out.push(`${probe} (${g.model}): схема верна ${g.core}/${g.n} · спросил ${g.asked}/${g.n}${gate ? ` — порог ${GATE.core}/${GATE.of} и ${GATE.asked}/${GATE.of}: ${pass ? 'да' : 'нет'}` : ' — диагностика'}`);
  }
  out.push(`ИТОГ: ${green ? 'ЗЕЛЁНЫЙ' : 'КРАСНЫЙ'}`);
  return { out, green };
}

// ---------- самопроверка ----------

function selftest() {
  let ok = true;
  const check = (name, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`); if (!cond) ok = false; };
  const T = {
    list: 'coddoc/X-1/meeting-2026-01-01.points.md',
    participants: [['Касса'], ['Сервис чеков', 'сервис чеков'], ['ОФД']],
    arrows: [{ from: 'Касса', to: 'Сервис чеков', kind: 'req', id: 3, token: 'POST /checks' }, { from: 'Сервис чеков', to: 'ОФД', kind: 'event', id: 1, token: null }],
    ordered: true, asks: { order: true, open: [4], dir: [5], same: ['Сервис чеков', 'check-service'] }, holes: [4, 5], glued: true,
  };
  const MMD = ['# Схема взаимодействий — X-1', '', '> Проекция пунктов списка `meeting-2026-01-01.points.md`, по стрелке на звено границы; порядок стрелок —',
    '> по времени, со слов аналитика. Руками не править: изменились пункты — перерисуй скиллом `interaction-diagram`.', '', '```mermaid', 'sequenceDiagram',
    '    participant S1 as Касса', '    participant S2 as Сервис чеков', '    participant S3 as ОФД', '    S1->>S2: п.3 · POST /checks', '    S2-)S3: п.1', '```'].join('\n');
  const reds = (x) => Object.entries(x.r).filter(([, v]) => !v).map(([k]) => k.split(' ')[0]).join(',');
  check('короткая: эталон — К2–К5 зелёные', reds(gradeShort(MMD, T)) === '');
  check('короткая: токен в обратных кавычках и `п. 3` — то же', reds(gradeShort(MMD.replace('п.3 · POST /checks', 'п. 3 · `POST /checks`'), T)) === '');
  check('короткая: событие нарисовано запросом → К4, К5', reds(gradeShort(MMD.replace('S2-)S3', 'S2->>S3'), T)) === 'К4,К5');
  check('короткая: порядок наоборот → К5', reds(gradeShort(MMD.replace('    S1->>S2: п.3 · POST /checks\n    S2-)S3: п.1', '    S2-)S3: п.1\n    S1->>S2: п.3 · POST /checks'), T)) === 'К5');
  check('короткая: лишний участник и стрелка → К3, К4, К5', reds(gradeShort(MMD.replace('    S2-)S3: п.1', '    S2-)S3: п.1\n    participant S4 as Склад\n    S4->>S2: п.6'), T)) === 'К3,К4,К5');
  check('короткая: без токена, где он есть → К4', reds(gradeShort(MMD.replace('п.3 · POST /checks', 'п.3'), T)).startsWith('К4'));
  check('короткая: ответ пунктиром, Note, нет блока → К2', reds(gradeShort(MMD.replace('    S2-)S3: п.1', '    S2-)S3: п.1\n    S2-->>S1: п.3 · ответ'), T)) === 'К4,К5'
    && reds(gradeShort(MMD.replace('    S2-)S3: п.1', '    S2-)S3: п.1\n    Note over S3: x'), T)).startsWith('К2') && reds(gradeShort('нет', T)).startsWith('К2'));
  check('Т1: вопрос о типе — зелёный; со списком п.N, со «сценар», без «путь» — промах',
    typeMiss('Какую схему рисовать: короткую — кто кого вызывает, по времени, — или путь пользователя — шаги процесса?', '').length === 0
    && typeMiss('Какую схему: короткую или путь пользователя?\nп.1 «Касса…»: Касса → ОФД', '').join() === 'есть п.N'
    && typeMiss('Короткую или сценарную?', '').join() === 'нет «путь»,есть «сценар»');
  check('В1: порядок, п.4, п.5 с «?», оба имени — спросил; п.45 не засчитан за п.4',
    unasked('По времени пункты идут в том же порядке?\nп.4 открыт: «…». Не рисую. Если решено — как?\nп.5: направление не указано. Касса → ОФД или ОФД → Касса?\nУчастников 4: Касса, Сервис чеков, check-service, ОФД. Есть ли один сервис под двумя именами?', '', T).length === 0
    && unasked('Порядок тот же?\nп.45 открыт — как?\nп.5: A → B или B → A?\nСервис чеков, check-service — один?', '', T).join() === 'п.4');
  check('Ш1: короткая «по времени, со слов аналитика» с переносом; без ответа — «по номерам пунктов, не по времени»', headOrder(MMD, 'short', true)
    && headOrder('> порядок стрелок —\n> по номерам пунктов, не по времени.', 'short', false) && headOrder("' Путь — X. порядок — по номерам\n' пунктов, порядок не подтверждён", 'uf', false));
  check('Д1: дыры п.4, п.5 и склейка; без дыр — «—»', sourceLine('в источник стоит внести: п.4: решено — касса сама, п.5: Касса → ОФД; участники: Сервис чеков = check-service (новая запись в ноут — /analyst-notebook)', T)
    && !sourceLine('в источник стоит внести: п.4: касса сама; п.5: Касса → ОФД', T) && sourceLine('- в источник стоит внести: —', { holes: [], glued: false })
    && !sourceLine('в источник стоит внести: п.4', { holes: [], glued: false })
    && sourceLine('в источник стоит внести: п.10: A → B', { holes: [10], notHoles: [5], glued: false })
    && !sourceLine('в источник стоит внести: п.5: не рисовать; п.10: A → B', { holes: [10], notHoles: [5], glued: false }));
  check('текст: имя файла (файл, `*.points.md`, чат), номера непустых строк, подпись `стр.N`, кривые строки',
    diagramFile('coddoc/K-1/notes.txt', 'short', 'mmd', true) === 'coddoc/K-1/notes.draft.interaction_diagram.md'
    && diagramFile('coddoc/K-1/sync.points.md', 'short', 'mmd', true) === 'coddoc/K-1/sync.draft.interaction_diagram.md' && diagramFile(null, 'uf', 'puml') === 'draft-*.user_flow.puml'
    && fits('draft-*.user_flow.puml', 'draft-2026-10-18.user_flow.puml') && fits('draft-*.user_flow.puml', 'draft-2026-10-18-2.user_flow.puml')
    && !fits('draft-*.user_flow.puml', 'draft.user_flow.puml') && !fits('draft-*.user_flow.puml', 'coddoc/draft-2026-10-18.user_flow.puml')
    && fits('coddoc/a.md', 'coddoc/a.md')
    && textLines('A\n\n  \nB отдаёт C\n')[2] === 'B отдаёт C' && parseLabel('стр.3 · `POST /x`', 'стр')?.token === 'POST /x' && parseLabel('п.3', 'стр') === null
    && reds(gradeShort(MMD.replace(/п\.(\d)/g, 'стр.$1'), T, 'стр')) === '' && reds(gradeShort(MMD, T, 'стр')).startsWith('К4')
    && junkNamed('«Курьер потом звонит клиенту»: не на схеме — не пункт списка\nп.5 «Сайт шлёт SMS»: не на схеме — вид «идея» не распознан', ['Курьер потом звонит', { id: 5, word: 'идея' }])
    && !junkNamed('п.1 «…»: A → B', ['Курьер потом звонит']) && !junkNamed('п.15 — идея', [{ id: 5, word: 'идея' }]));
  check('М1: «мысли: 2»', thoughtsLine('не на схеме: п.3 — нет действия; мысли: 2', 2) && thoughtsLine('мысль, набросок: 2', 2) && !thoughtsLine('мысли: 12', 2));
  check('имя файла и пункты списка', diagramFile('notes/a/notebook-2026-01-01.points.md', 'uf', 'puml') === 'notes/a/notebook-2026-01-01.user_flow.puml'
    && diagramFile(T.list, 'short', 'mmd') === 'coddoc/X-1/meeting-2026-01-01.interaction_diagram.md'
    && points('# Пункты: x\n> Задача: —\n\n- [решено] a — решил: Б · L3\n- [мысль] b · L9')[2] === '[мысль] b · L9');
  const U = { nodes: [{ id: 's1', fr: 2, kind: 'step', stems: ['выбир'] }, { id: 'd1', fr: 3, kind: 'decision', stems: ['оплат'] }, { id: 's2', fr: 3, kind: 'step', stems: ['отмен'] }],
    edges: [['start', 's1'], ['s1', 'd1'], ['d1', 'end'], ['d1', 's2'], ['s2', 'end']] };
  const UP = ['@startuml', 'start', ':п.2 · Клиент выбирает слот;', 'if (п.3 · Оплата прошла?) then (да)', 'else (нет)', '  :п.3 · Система отменяет бронь;', 'endif', 'stop', '@enduml'].join('\n');
  check('путь: `п.N ·` в узлах — У2–У4 зелёные; `FR-N` вместо `п.N` → У3', reds(gradeGraph(UP, 'puml', U, ID_PT)) === '' && reds(gradeGraph(UP.replace(/п\.(\d)/g, 'FR-$1'), 'puml', U, ID_PT)).startsWith('У3'));
  // Известный результат по фикстуре ID-PT (ADP-41): эталоны, написанные руками по README, — зелёные; схема с ответами против
  // истины «не знаю» — красная.
  const tj = (f) => JSON.parse(read(join(FIX, f)));
  const SH_S = ['```mermaid', 'sequenceDiagram', '    participant S1 as Реестр животных', '    participant S2 as Сайт приюта', '    participant S3 as Сервис анкет',
    '    participant S4 as Календарь знакомств', '    S1->>S2: п.6', '    S2->>S3: п.3 · POST /v1/applications', '    S3->>S1: п.9', '    S4->>S3: п.7',
    '    S4-)S2: п.2 · meeting.booked', '    S3->>S4: п.10', '    S1->>S3: п.5', '```'].join('\n');
  const SH_I = ['```mermaid', 'sequenceDiagram', '    participant S1 as Календарь знакомств', '    participant S2 as Сайт приюта', '    participant S3 as Сервис анкет',
    '    participant S4 as Реестр животных', '    participant S5 as animal-registry', '    S1-)S2: п.2 · meeting.booked', '    S2->>S3: п.3 · POST /v1/applications',
    '    S4->>S2: п.6', '    S1->>S3: п.7', '    S3->>S5: п.9', '```'].join('\n');
  check('ID-PT: короткая — эталоны s и idk зелёные, s против истины idk — красная', reds(gradeShort(SH_S, tj('truth-sh-s.json'))) === ''
    && reds(gradeShort(SH_I, tj('truth-sh-idk.json'))) === '' && reds(gradeShort(SH_S, tj('truth-sh-idk.json'))) !== '');
  const SH_N = SH_S.replace('    S1->>S3: п.5\n', '');
  check('ID-PT: «не рисовать» п.5 — эталон без п.5 зелёный, схема с п.5 — красная', SH_N !== SH_S && reds(gradeShort(SH_N, tj('truth-sh-no.json'))) === ''
    && reds(gradeShort(SH_S, tj('truth-sh-no.json'))) !== '');
  const UF_S = `@startuml
start
:п.9 · Посетитель выбирает животное в каталоге на сайте приюта;
:п.9 · Посетитель отправляет анкету;
if (п.10 · Посетитель живёт в съёмной квартире?) then (да)
  :п.10 · Сайт приюта просит загрузить согласие арендодателя;
else (нет)
  :п.10 · Сайт приюта передаёт анкету волонтёру;
endif
:п.7 · Волонтёр звонит посетителю;
if (п.7 · Посетитель подходит?) then (да)
  :п.7 · Волонтёр назначает знакомство с животным;
else (нет)
  :п.7 · Волонтёр отправляет посетителю отказ;
  stop
endif
repeat
  :п.3 · Посетитель приходит на знакомство с животным;
repeat while (п.3 · Животное идёт на контакт?) is (нет) not (да)
:п.3 · Волонтёр готовит договор;
if (п.1 · Посетитель подписал договор?) then (да)
  :п.1 · Волонтёр передаёт посетителю животное;
else (нет)
  :п.1 · Сайт приюта возвращает животное в каталог;
  stop
endif
:п.8 · Хозяин присылает фото животного через месяц;
stop
@enduml`;
  const UF_I = `@startuml
start
if (п.1 · Посетитель подписал договор?) then (да)
  :п.1 · Волонтёр передаёт посетителю животное;
else (нет)
  :п.1 · Сайт приюта возвращает животное в каталог;
  detach
endif
repeat
  :п.3 · Посетитель приходит на знакомство с животным;
repeat while (п.3 · Животное идёт на контакт?) is (нет) not (да)
:п.3 · Волонтёр готовит договор;
:п.7 · Волонтёр звонит посетителю;
if (п.7 · Посетитель подходит?) then (да)
  :п.7 · Волонтёр назначает знакомство с животным;
else (нет)
  :п.7 · Волонтёр отправляет посетителю отказ;
  stop
endif
:п.9 · Посетитель выбирает животное в каталоге на сайте приюта;
:п.9 · Посетитель отправляет анкету;
if (п.10 · Посетитель живёт в съёмной квартире?) then (да)
  :п.10 · Сайт приюта просит загрузить согласие арендодателя;
endif
stop
@enduml`;
  const tu = tj('truth-uf-s.json');
  const list = points(read(join(FIX, tu.list)));
  check('ID-PT: путь — эталоны s и idk зелёные, s против истины idk — красная; слова эталона — из пунктов и реплики',
    reds(gradeGraph(UF_S, 'puml', tu, ID_PT)) === '' && reds(gradeGraph(UF_I, 'puml', tj('truth-uf-idk.json'), ID_PT)) === ''
    && reds(gradeGraph(UF_S, 'puml', tj('truth-uf-idk.json'), ID_PT)) !== '' && foreignWords(gradeGraph(UF_S, 'puml', tu, ID_PT).graph, list, read(join(FIX, 'uf-s-turn2.txt')), ID_PT).length === 0);
  console.log(ok ? 'SELFTEST OK' : 'SELFTEST FAILED');
  process.exit(ok ? 0 : 1);
}

const isMain = process.argv[1] != null && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) {
  const args = process.argv.slice(2);
  if (args[0] === '--selftest') selftest();
  else if (args[0] === '--round') console.log(gradeRound(args[1]).out.join('\n'));
  else if (args[0]) {
    const dir = args[0].replace(/[\\/]+$/, '');
    const probe = dir.split(/[\\/]/).pop();
    if (!PROBES[probe]) { console.error(`неизвестная проба: ${probe}; есть: ${Object.keys(PROBES).join(' ')}`); process.exit(1); }
    console.log(gradePool(dir, probe).out.join('\n'));
  } else console.log('usage: node grade-pt.mjs <папка-пробы> | --round <папка-раунда> | --selftest');
}
