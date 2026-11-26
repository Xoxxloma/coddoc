#!/usr/bin/env node
// Грейдер «пути пользователя» `interaction-diagram` 5.1.0 (срез 2а, `PLAN-ID-CORE.md` §8.2): блок-схема по §4.1 БТ.
//
//   node grade-uf.mjs <папка-пробы>          — прогоны `run-*` пробы из `PROBES`, строка на прогон и итог
//   node grade-uf.mjs --round <папка-раунда> — сводка по пробам из `PROBES`, пороги — только у прогонов Sonnet
//   node grade-uf.mjs --selftest
//
// Схема разбирается в граф: узлы `start`, `end`, шаги и развилки (текст `FR-N · …`), стрелки с метками. Mermaid —
// блок `flowchart`; PlantUML — activity (`if/else/endif`, `repeat … backward … repeat while`, `while/endwhile`, `stop`,
// `detach`). Описана одна ветка (`if` без `else`) — обхода в графе нет: в Mermaid такой развилке тоже ведёт одна стрелка.
// Истина — `fixtures/ID-BT/truth-*.json`: узлы с FR и основами, стрелки, FR не на схеме, о чём спросить, дыры.
//
// «Схема верна» — У0 (БТ не тронуты), У1 (файл один, имя), У2 (разбор), У3 (узлы = истине, лишних нет), У4 (стрелки =
// истине, у веток развилки метки). Отдельный счёт: В1 (ход 1 — вопросы о порядке, второй ветке, конце ответвления;
// файла нет), Р1 (вход, тип, формат — по одному из папки), Ш1 (фраза о порядке в шапке), Д1 (строка «в источник стоит
// внести»), Сл (слова узлов есть в своём FR или в реплике — диагностика).

import { readFileSync, existsSync, readdirSync, statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, 'fixtures', 'ID-BT');
const PROBES = {
  'bt-uf-mmd': { format: 'mmd', truth: 'truth-s.json', reply: 's-turn2.txt', known: true },
  'bt-uf-puml': { format: 'puml', truth: 'truth-s.json', reply: 's-turn2.txt', known: true },
  'bt-uf-idk': { format: 'mmd', truth: 'truth-idk.json', reply: 'idk-turn2.txt', known: false },
  'bt-uf-y': { format: 'mmd', truth: 'truth-y.json', reply: 'yes-turn2.txt', known: true },
};
const GATE = { core: 4, asked: 5, of: 5 }; // Sonnet, на пробу: схема верна ≥ 4/5, В1 5/5

const norm = (s) => s.replace(/\r/g, '');
const read = (p) => (existsSync(p) ? norm(readFileSync(p, 'utf8')) : null);
const low = (s) => s.toLowerCase().replace(/ё/g, 'е');
const JUNK = /^(answer(-\d+)?\.md|stream(-\d+)?\.jsonl|_seeded\.(txt|sha256)|_stderr\.log|_api-failure(-turn)?\.txt)$/;

// Пути — в NFC: засев песочницы на macOS ложится в NFD («й», «ё» — буква и знак), а фикстура — в NFC.
export function listFiles(dir, base = dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? listFiles(p, base) : [relative(base, p).replace(/\\/g, '/').normalize('NFC')];
  });
}

// ---------- разбор ----------

/** Mermaid: блок `flowchart`. Узел — `ID`, `ID["…"]`, `ID{"…"}`, `ID(["…"])`, `ID(("…"))`, `ID[…]`; стрелки `-->`, `-- m -->`, `-->|m|`. */
export function parseMermaid(text) {
  const m = (text ?? '').match(/```mermaid\s*\n([\s\S]*?)```/);
  if (!m) return { error: 'нет блока mermaid' };
  const lines = m[1].split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('%%'));
  if (!/^flowchart\s+(TB|TD|BT|LR|RL)\b/.test(lines[0] ?? '')) return { error: 'нет flowchart' };
  const nodes = new Map();
  const edges = [];
  const SHAPES = [
    [/^\(\[\s*"([^"]*)"\s*\]\)/, 'round'], [/^\(\[\s*([^\]]*)\]\)/, 'round'], [/^\(\(\s*"([^"]*)"\s*\)\)/, 'round'],
    [/^\[\s*"([^"]*)"\s*\]/, 'box'], [/^\[([^\]]*)\]/, 'box'], [/^\{\s*"([^"]*)"\s*\}/, 'diamond'], [/^\{([^}]*)\}/, 'diamond'],
    [/^\(\s*"([^"]*)"\s*\)/, 'box'], [/^\(([^)]*)\)/, 'box'],
  ];
  const node = (s) => {
    const id = s.match(/^([A-Za-z_][\w]*)/);
    if (!id) return null;
    let rest = s.slice(id[1].length);
    for (const [re, shape] of SHAPES) {
      const sm = rest.match(re);
      if (sm) {
        nodes.set(id[1], { id: id[1], shape, text: sm[1].replace(/#quot;/g, '"').replace(/#35;/g, '#').replace(/#59;/g, ';').trim() });
        return { id: id[1], rest: rest.slice(sm[0].length) };
      }
    }
    if (!nodes.has(id[1])) nodes.set(id[1], { id: id[1], shape: null, text: null });
    return { id: id[1], rest };
  };
  const EDGE = /^\s*(?:--\s*([^-][^>]*?)\s*-->|-->\s*\|([^|]*)\||-\.->|==>|-->|---)\s*/;
  for (const line of lines.slice(1)) {
    if (/^(classDef|class|style|linkStyle|subgraph|end$|direction)\b/.test(line)) continue;
    let cur = node(line);
    if (!cur) return { error: `не разобрана строка: ${line}` };
    let rest = cur.rest;
    while (rest.trim()) {
      const e = rest.match(EDGE);
      if (!e) {
        if (/^\s*;?\s*$/.test(rest)) break;
        return { error: `не разобрана строка: ${line}` };
      }
      const nxt = node(rest.slice(e[0].length));
      if (!nxt) return { error: `не разобрана строка: ${line}` };
      edges.push({ from: cur.id, to: nxt.id, label: (e[1] ?? e[2] ?? '').trim() });
      cur = nxt;
      rest = nxt.rest;
    }
  }
  const out = { nodes: [], edges: [] };
  const kind = (n) => (n.shape === 'round' && /^начало$/i.test(n.text ?? '') ? 'start' : n.shape === 'round' && /^конец$/i.test(n.text ?? '') ? 'end'
    : n.shape === 'diamond' ? 'decision' : 'step');
  for (const n of nodes.values()) {
    if (n.text == null) return { error: `узел без текста: ${n.id}` };
    out.nodes.push({ id: n.id, kind: kind(n), text: n.text });
  }
  const ids = new Map(out.nodes.map((n) => [n.id, n.kind === 'start' ? 'start' : n.kind === 'end' ? 'end' : n.id]));
  out.edges = edges.map((e) => ({ from: ids.get(e.from), to: ids.get(e.to), label: e.label }));
  out.nodes = out.nodes.filter((n) => n.kind !== 'start' && n.kind !== 'end');
  return out;
}

/** PlantUML activity → граф. Узлы `start`/`end` общие; шаг — `:…;` (в том числе на нескольких строках). */
export function parsePlantuml(text) {
  const src = (text ?? '');
  const a = src.indexOf('@startuml');
  const b = src.indexOf('@enduml');
  if (a < 0 || b < a) return { error: 'нет @startuml … @enduml' };
  const raw = src.slice(a + 9, b).split('\n');
  const nodes = [];
  const edges = [];
  let n = 0;
  let tails = [];
  let pendLabel = null;
  const stack = [];
  const mk = (kind, t) => { const id = `p${++n}`; nodes.push({ id, kind, text: t.trim() }); return id; };
  const link = (to) => { for (const t of tails) edges.push({ from: t.id, to, label: (pendLabel ?? t.label ?? '').trim() }); pendLabel = null; };
  const onNode = (id) => { link(id); tails = [{ id }]; for (const f of stack) if (f.kind === 'repeat' && f.head == null) f.head = id; };
  let started = false;
  for (let i = 0; i < raw.length; i++) {
    let l = raw[i].trim();
    if (!l || l.startsWith("'")) continue;
    if (/^(title|skinparam|caption|header|footer|legend|scale)\b/.test(l)) continue;
    if (/^note\b/.test(l)) { if (!/:/.test(l)) while (i < raw.length && !/^end\s*note/.test(raw[i].trim())) i++; continue; }
    if (l === 'start') { started = true; tails = [{ id: 'start' }]; continue; }
    if (l === 'stop' || l === 'end') { link('end'); tails = []; continue; }
    if (l === 'detach' || l === 'kill') { tails = []; continue; }
    let m;
    if ((m = l.match(/^->\s*(.*?);?$/))) { pendLabel = m[1]; continue; }
    if ((m = l.match(/^repeat\s*:(.*)$/)) || l === 'repeat') {
      const f = { kind: 'repeat', head: null, backward: null };
      stack.push(f);
      if (m) {
        let t = m[1];
        while (!t.trimEnd().endsWith(';') && i + 1 < raw.length) t += '\n' + raw[++i].trim();
        onNode(mk('step', t.trimEnd().replace(/;$/, '')));
      }
      continue;
    }
    if ((m = l.match(/^backward\s*:(.*)$/))) {
      let t = m[1];
      while (!t.trimEnd().endsWith(';') && i + 1 < raw.length) t += '\n' + raw[++i].trim();
      const f = stack.findLast((x) => x.kind === 'repeat');
      if (!f) return { error: 'backward вне repeat' };
      f.backward = mk('step', t.trimEnd().replace(/;$/, ''));
      continue;
    }
    if ((m = l.match(/^repeat\s+while\s*\((.*?)\)\s*(?:is\s*\(([^)]*)\))?\s*(?:not\s*\(([^)]*)\))?\s*$/))) {
      const f = stack.pop();
      if (!f || f.kind !== 'repeat' || f.head == null) return { error: 'repeat while без repeat' };
      const d = mk('decision', m[1]);
      link(d);
      if (f.backward) { edges.push({ from: d, to: f.backward, label: (m[2] ?? '').trim() }); edges.push({ from: f.backward, to: f.head, label: '' }); }
      else edges.push({ from: d, to: f.head, label: (m[2] ?? '').trim() });
      tails = [{ id: d, label: m[3] ?? '' }];
      continue;
    }
    if ((m = l.match(/^while\s*\((.*?)\)\s*(?:is\s*\(([^)]*)\))?\s*$/))) {
      const d = mk('decision', m[1]);
      link(d);
      stack.push({ kind: 'while', d });
      tails = [{ id: d, label: m[2] ?? '' }];
      continue;
    }
    if ((m = l.match(/^endwhile\s*(?:\(([^)]*)\))?\s*$/))) {
      const f = stack.pop();
      if (!f || f.kind !== 'while') return { error: 'endwhile без while' };
      link(f.d);
      tails = [{ id: f.d, label: m[1] ?? '' }];
      continue;
    }
    if ((m = l.match(/^if\s*\((.*)\)\s*then\s*(?:\(([^)]*)\))?\s*$/))) {
      const d = mk('decision', m[1]);
      link(d);
      stack.push({ kind: 'if', d, done: [], hasElse: false });
      tails = [{ id: d, label: m[2] ?? '' }];
      continue;
    }
    if ((m = l.match(/^else\s*(?:\(([^)]*)\))?\s*$/))) {
      const f = stack.at(-1);
      if (!f || f.kind !== 'if') return { error: 'else без if' };
      f.done.push(...tails);
      f.hasElse = true;
      tails = [{ id: f.d, label: m[1] ?? '' }];
      continue;
    }
    if (l === 'endif' || l === 'end if') {
      const f = stack.pop();
      if (!f || f.kind !== 'if') return { error: 'endif без if' };
      tails = [...f.done, ...tails]; // без else обхода нет: в Mermaid у такой развилки тоже одна стрелка
      continue;
    }
    if ((m = l.match(/^:(.*)$/))) {
      let t = m[1];
      while (!t.trimEnd().endsWith(';') && i + 1 < raw.length) t += '\n' + raw[++i].trim();
      onNode(mk('step', t.trimEnd().replace(/;$/, '')));
      continue;
    }
    return { error: `не разобрана строка: ${l}` };
  }
  if (!started) return { error: 'нет start' };
  if (stack.length) return { error: `не закрыт ${stack.at(-1).kind}` };
  return { nodes, edges };
}

// ---------- сверка с истиной ----------

// id пункта в начале текста узла: у БТ — `FR-N ·`, у списка пунктов (срез 2б) — `п.N ·`. Номер пункта в истине — поле `fr`.
export const ID_FR = /^\s*FR-(\d+)\s*·/;
export const ID_PT = /^\s*[пП]\.\s?(\d+)\s*·/;
export const ID_TX = /^\s*[сС][тТ][рР]\.\s?(\d+)\s*·/;
const frOf = (t, idRe = ID_FR) => { const m = (t ?? '').match(idRe); return m ? Number(m[1]) : null; };

/** Узлы истины ↔ узлы схемы: тот же номер пункта в начале текста, тот же вид, все основы. Возвращает карту id схемы → id истины. */
export function matchNodes(graph, truth, idRe = ID_FR) {
  const map = new Map();
  const free = new Set(graph.nodes.map((n) => n.id));
  const miss = [];
  for (const t of truth.nodes) {
    const c = graph.nodes.find((g) => free.has(g.id) && frOf(g.text, idRe) === t.fr && (g.kind === 'decision') === (t.kind === 'decision')
      && t.stems.every((s) => low(g.text).includes(low(s))));
    if (c) { map.set(c.id, t.id); free.delete(c.id); } else miss.push(t.id);
  }
  return { map, miss, extra: [...free] };
}

const key = (a, b) => `${a}>${b}`;

export function gradeGraph(text, format, truth, idRe = ID_FR) {
  const r = {};
  const g = format === 'puml' ? parsePlantuml(text) : parseMermaid(text);
  r['У2 разбор'] = !g.error;
  if (g.error) { r['У3 узлы = истине'] = false; r['У4 стрелки = истине'] = false; return { r, why: g.error }; }
  const { map, miss, extra } = matchNodes(g, truth, idRe);
  r['У3 узлы = истине'] = miss.length === 0 && extra.length === 0;
  const id = (x) => (x === 'start' || x === 'end' ? x : map.get(x) ?? `?${x}`);
  const got = new Set(g.edges.map((e) => key(id(e.from), id(e.to))));
  const want = new Set(truth.edges.map(([a, b]) => key(a, b)));
  const lost = [...want].filter((k) => !got.has(k));
  const added = [...got].filter((k) => !want.has(k));
  const decIds = new Set(g.nodes.filter((n) => n.kind === 'decision').map((n) => n.id));
  const unlabeled = g.edges.filter((e) => decIds.has(e.from) && !e.label).map((e) => key(id(e.from), id(e.to)));
  r['У4 стрелки = истине'] = r['У3 узлы = истине'] && lost.length === 0 && added.length === 0 && unlabeled.length === 0;
  const why = [miss.length ? `нет узла: ${miss.join(', ')}` : '', extra.length ? `лишний узел: ${extra.map((x) => `«${g.nodes.find((n) => n.id === x).text}»`).join(', ')}` : '',
    lost.length ? `нет стрелки: ${lost.join(', ')}` : '', added.length ? `лишняя стрелка: ${added.join(', ')}` : '', unlabeled.length ? `ветка без метки: ${unlabeled.join(', ')}` : ''].filter(Boolean).join('; ');
  return { r, why, graph: g, map };
}

/** Тексты FR §4.1: номер → текст абзаца. */
export function frTexts(bt) {
  const s = (bt ?? '').split(/^### 4\.1\b.*$/m)[1]?.split(/^### /m)[0] ?? '';
  const out = {};
  for (const part of s.split(/(?=\*\*FR-\d+)/)) { const m = part.match(/^\*\*FR-(\d+)/); if (m) out[m[1]] = part; }
  return out;
}

/** Сл: слова узла (≥ 5 букв, основа — первые 5) есть в тексте его FR или в реплике аналитика. Пусто — в порядке. */
export function foreignWords(graph, frs, reply, idRe = ID_FR) {
  const bad = [];
  for (const n of graph.nodes) {
    const fr = frOf(n.text, idRe);
    const pool = low(`${frs[fr] ?? ''}\n${reply ?? ''}`);
    const words = low(n.text.replace(idRe, '')).match(/[а-я]{5,}/g) ?? [];
    for (const w of words) if (!pool.includes(w.slice(0, 5))) bad.push(`${n.id}:${w}`);
  }
  return bad;
}

// ---------- прогон ----------

export function leadTools(stream) {
  const out = [];
  for (const line of (stream ?? '').split('\n')) {
    let ev = null;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev?.type !== 'assistant' || ev.parent_tool_use_id != null || !Array.isArray(ev.message?.content)) continue;
    out.push(...ev.message.content.filter((c) => c?.type === 'tool_use'));
  }
  return out;
}
const streams = (runDir) => (existsSync(runDir) ? readdirSync(runDir) : []).filter((e) => /^stream(-\d+)?\.jsonl$/.test(e)).map((f) => read(join(runDir, f)));

/** Р1: вход `bt.md`, тип `user-flow.md`, формат — по одному файлу из папки, других из этих папок нет. */
export function readRefs(runDir, format) {
  const want = ['reference/inputs/bt.md', 'reference/kinds/user-flow.md', `reference/notation/${format === 'puml' ? 'plantuml' : 'mermaid'}.md`];
  const got = streams(runDir).flatMap((s) => leadTools(s).filter((c) => c.name === 'Read' && typeof c.input?.file_path === 'string')
    .map((c) => c.input.file_path.replace(/\\/g, '/'))).filter((p) => /reference\/(inputs|kinds|notation)\//.test(p));
  return want.every((w) => got.some((p) => p.endsWith(w))) && got.every((p) => want.some((w) => p.endsWith(w)));
}

const wrote = (stream) => leadTools(stream).some((c) => ['Write', 'Edit', 'Bash'].includes(c.name) && /user_flow/.test(JSON.stringify(c.input ?? '')));

/** В1 по ходу 1: знак `?`; о порядке — корень «поряд»; по каждой дыре — строка с `FR-N` и `?` (в ней или в следующей). Пусто — спросил. */
export function unasked(a1, truth) {
  const out = [];
  const text = a1 ?? '';
  if (!text.includes('?')) out.push('знака «?» нет');
  if (truth.asks.order && !/поряд/i.test(text)) out.push('порядок');
  const lines = text.split('\n');
  const askedAbout = (n) => lines.some((l, i) => (l.match(/FR-\d+/g) ?? []).includes(`FR-${n}`) && (l.includes('?') || (lines[i + 1] ?? '').includes('?')));
  for (const n of [...truth.asks.branch, ...truth.asks.end]) if (!askedAbout(n)) out.push(`FR-${n}`);
  return out;
}

const flatHead = (text) => low(text ?? '').replace(/\s*\n[ \t]*[>']?\s*/g, ' ');
export const headOrder = (text, known) => (known ? flatHead(text).includes('по порядку со слов аналитика')
  : flatHead(text).includes('по номерам требований') && !flatHead(text).includes('со слов аналитика'));

/** Д1: строка «в источник стоит внести» называет каждый FR из `holes`; дыр нет — строка с «—» или без FR. */
export function sourceLine(answer, holes) {
  const l = (answer ?? '').split('\n').find((x) => /^[\s>*_•-]*в источник стоит внести/i.test(x));
  if (!l) return false;
  return holes.length ? holes.every((n) => (l.match(/FR-\d+/g) ?? []).includes(`FR-${n}`)) : !/FR-\d+/.test(l);
}

export function gradeRun(runDir, probe) {
  const p = PROBES[probe];
  const truth = JSON.parse(read(join(FIX, p.truth)));
  const btRel = `coddoc/${truth.key}/business_requirements.md`;
  const want = `coddoc/${truth.key}/user_flow.${p.format === 'puml' ? 'puml' : 'md'}`;
  const fixFiles = new Set(listFiles(FIX));
  const made = listFiles(runDir).filter((f) => !fixFiles.has(f) && !JUNK.test(f.split('/').pop()));
  const r = {};
  r['У0 БТ не тронуты'] = read(join(runDir, btRel)) === read(join(FIX, btRel));
  r['У1 файл один, имя'] = made.length === 1 && made[0] === want;
  const text = read(join(runDir, want));
  const g = gradeGraph(text, p.format, truth);
  Object.assign(r, g.r);
  const a1 = read(join(runDir, 'answer-01.md'));
  const s1 = read(join(runDir, 'stream.jsonl'));
  const miss = a1 == null ? ['первого хода нет'] : [...(wrote(s1) ? ['файл записан ходом 1'] : []), ...unasked(a1, truth)];
  r['В1 спросил'] = miss.length === 0;
  r['Р1 прочитан reference'] = readRefs(runDir, p.format);
  r['Ш1 шапка: порядок'] = headOrder(text, p.known);
  const last = readdirSync(runDir).filter((f) => /^answer-\d+\.md$/.test(f)).sort().at(-1);
  r['Д1 в источник стоит внести'] = sourceLine(last ? read(join(runDir, last)) : '', truth.holes);
  const words = g.graph ? foreignWords(g.graph, frTexts(read(join(FIX, btRel))), read(join(FIX, p.reply))) : ['нет графа'];
  r['Сл слова источника'] = words.length === 0;
  return { r, why: g.why, miss, words, made };
}

const CORE = ['У0', 'У1', 'У2', 'У3', 'У4'];
const isCore = (k) => CORE.some((c) => k.startsWith(`${c} `));
const failed = (runDir) => existsSync(runDir) && readdirSync(runDir).some((f) => /^_api-failure/.test(f));
const modelOf = (probeDir) => (read(join(probeDir, '_settings.txt')) ?? '').match(/модель:\s*(\S+)/)?.[1] ?? '?';

export function gradePool(probeDir, probe) {
  const runs = (existsSync(probeDir) ? readdirSync(probeDir) : []).filter((e) => /^run-\d+$/.test(e)).sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)));
  const out = [];
  const tally = {};
  let core = 0; let n = 0; const fails = [];
  for (const run of runs) {
    const dir = join(probeDir, run);
    if (failed(dir)) { fails.push(run); continue; }
    const g = gradeRun(dir, probe);
    n++;
    const reds = Object.entries(g.r).filter(([, v]) => !v).map(([k]) => k.split(' ')[0]);
    const ok = Object.entries(g.r).filter(([k]) => isCore(k)).every(([, v]) => v);
    if (ok) core++;
    for (const [k, v] of Object.entries(g.r)) { tally[k] ??= 0; if (v) tally[k]++; }
    out.push(`${run}: ${reds.length ? `красный ${reds.join(',')}` : 'зелёный'}${g.why ? `  ${g.why}` : ''}${g.miss.length ? `  В1: ${g.miss.join(', ')}` : ''}${g.words.length && !reds.includes('У2') ? `  Сл: ${g.words.slice(0, 4).join(' ')}` : ''}`);
  }
  out.push('---', ...Object.entries(tally).map(([k, v]) => `${k}: ${v}/${n}`), `схема верна (У0–У4): ${core}/${n}`, `сбой API: ${fails.length}${fails.length ? ` (${fails.join(', ')})` : ''}`);
  return { out, core, n, asked: tally['В1 спросил'] ?? 0, model: modelOf(probeDir) };
}

export function gradeRound(roundDir) {
  const out = [];
  let green = true;
  for (const probe of Object.keys(PROBES)) {
    const dir = join(roundDir, probe);
    if (!existsSync(dir)) { out.push(`${probe}: прогонов нет`); green = false; continue; }
    const g = gradePool(dir, probe);
    const gate = /sonnet/i.test(g.model);
    const pass = !gate || (g.core >= GATE.core * g.n / GATE.of && g.asked >= GATE.asked * g.n / GATE.of && g.n > 0);
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
    key: 'X-1',
    nodes: [{ id: 's1', fr: 1, kind: 'step', stems: ['выбир'] }, { id: 's2', fr: 1, kind: 'step', stems: ['указ'] },
      { id: 'd1', fr: 2, kind: 'decision', stems: ['свобод'] }, { id: 's3', fr: 2, kind: 'step', stems: ['бронир'] },
      { id: 's4', fr: 3, kind: 'step', stems: ['вводит'] }, { id: 'd2', fr: 3, kind: 'decision', stems: ['подход'] },
      { id: 's5', fr: 3, kind: 'step', stems: ['сообщ'] }, { id: 's6', fr: 4, kind: 'step', stems: ['получ'] }],
    edges: [['start', 's1'], ['s1', 's2'], ['s2', 'd1'], ['d1', 's3'], ['d1', 'end'], ['s3', 's4'], ['s4', 'd2'], ['d2', 's5'], ['s5', 's4'], ['d2', 's6'], ['s6', 'end']],
    back: [['s5', 's4']], off: [5], asks: { order: true, branch: [2], end: [] }, holes: [2],
  };
  const MMD = ['# Путь пользователя — X-1', '', '> Проекция требований §4.1 `business_requirements.md`; порядок — по порядку со слов аналитика. Руками не править:',
    '> изменились требования — перерисуй скиллом `interaction-diagram`.', '', '```mermaid', 'flowchart TB',
    '    N0(["Начало"])', '    N1["FR-1 · Гость выбирает дату"]', '    N2["FR-1 · Гость указывает число мест"]', '    N3{"FR-2 · Стол свободен?"}',
    '    N4["FR-2 · Система бронирует стол"]', '    N5["FR-3 · Гость вводит код"]', '    N6{"FR-3 · Код подходит?"}', '    N7["FR-3 · Система сообщает об ошибке"]',
    '    N8["FR-4 · Гость получает подтверждение"]', '    NE(["Конец"])',
    '    N0 --> N1', '    N1 --> N2', '    N2 --> N3', '    N3 -- да --> N4', '    N3 -- нет --> NE', '    N4 --> N5', '    N5 --> N6',
    '    N6 -- нет --> N7', '    N7 --> N5', '    N6 -- да --> N8', '    N8 --> NE', '```'].join('\n');
  const PUML = ['@startuml', "' Путь пользователя — X-1. Проекция требований §4.1 business_requirements.md; порядок — по порядку со слов аналитика. Руками не править.",
    'start', ':FR-1 · Гость выбирает дату;', ':FR-1 · Гость указывает', 'число мест;', 'if (FR-2 · Стол свободен?) then (да)', '  :FR-2 · Система бронирует стол;',
    'else (нет)', '  stop', 'endif', 'repeat', '  :FR-3 · Гость вводит код;', 'backward:FR-3 · Система сообщает об ошибке;',
    'repeat while (FR-3 · Код подходит?) is (нет) not (да)', ':FR-4 · Гость получает подтверждение;', 'stop', '@enduml'].join('\n');
  const reds = (x) => Object.entries(x.r).filter(([, v]) => !v).map(([k]) => k.split(' ')[0]).join(',');
  check('Mermaid: эталон — У2–У4 зелёные', reds(gradeGraph(MMD, 'mmd', T)) === '');
  check('PlantUML: эталон с repeat/backward и шагом на двух строках — У2–У4 зелёные', reds(gradeGraph(PUML, 'puml', T)) === '');
  check('Mermaid: стрелка `-->|да|` и узлы, объявленные в стрелке, — то же', reds(gradeGraph(MMD.replace('    N3 -- да --> N4', '    N3 -->|да| N4["FR-2 · Система бронирует стол"]')
    .replace('    N4["FR-2 · Система бронирует стол"]\n', ''), 'mmd', T)) === '');
  check('лишний шаг от себя → У3, У4', reds(gradeGraph(MMD.replace('    N8 --> NE', '    N8 --> N9\n    N9["FR-4 · Система сохраняет заказ"]\n    N9 --> NE'), 'mmd', T)) === 'У3,У4');
  check('шаг с чужим FR → У3', reds(gradeGraph(MMD.replace('FR-1 · Гость указывает', 'FR-2 · Гость указывает'), 'mmd', T)).startsWith('У3'));
  check('нет стрелки возврата → У4', reds(gradeGraph(MMD.replace('    N7 --> N5\n', ''), 'mmd', T)) === 'У4');
  check('ветка развилки без метки → У4', reds(gradeGraph(MMD.replace('N3 -- нет --> NE', 'N3 --> NE'), 'mmd', T)) === 'У4');
  check('PlantUML: if без else — обхода нет; without stop в else — лишняя стрелка d1 → s4', (() => {
    const g = parsePlantuml(PUML.replace("else (нет)\n  stop\n", ''));
    return !g.error && !g.edges.some((e) => e.from === 'p3' && e.to === 'p5') ; })()
    && reds(gradeGraph(PUML.replace('  stop\nendif', 'endif'), 'puml', T)) === 'У4');
  check('PlantUML: незакрытый if, нет start, мусорная строка → У2', reds(gradeGraph(PUML.replace('endif\n', ''), 'puml', T)).startsWith('У2')
    && reds(gradeGraph(PUML.replace('start\n', ''), 'puml', T)).startsWith('У2') && reds(gradeGraph(PUML.replace('stop\n@enduml', 'stop\nfoo bar\n@enduml'), 'puml', T)).startsWith('У2'));
  check('Mermaid: нет блока, не flowchart → У2', reds(gradeGraph('нет схемы', 'mmd', T)).startsWith('У2') && reds(gradeGraph(MMD.replace('flowchart TB', 'sequenceDiagram'), 'mmd', T)).startsWith('У2'));
  check('В1: вопросы о порядке и FR-2 → спросил; без FR-2 → промах; «?» в следующей строке — засчитан',
    unasked('FR-1 «Бронь»: …\nПо пути требования идут в том же порядке, что в списке?\nFR-2 «Стол свободен?»: что при «нет», не описано — рисую без этой ветки. Верно?', T).length === 0
    && unasked('По пути требования идут в том же порядке?', T).join() === 'FR-2'
    && unasked('Порядок тот же?\nFR-2: что при «нет», не описано —\nрисую без неё. Верно?', T).length === 0);
  check('Ш1: «по порядку со слов аналитика» / «по номерам требований» с переносом строки', headOrder(MMD, true) && !headOrder(MMD, false)
    && headOrder('> порядок — по номерам\n> требований, порядок не подтверждён', false));
  check('Д1: дыры FR-2 → строка называет FR-2; дыр нет → «—»', sourceLine('в источник стоит внести: FR-2: при «нет» — конец (доработка БТ)', [2])
    && !sourceLine('в источник стоит внести: —', [2]) && sourceLine('- в источник стоит внести: —', []) && !sourceLine('схема записана', []));
  const frs = { 1: 'Гость выбирает дату и указывает число мест.', 2: 'Если стол свободен, система бронирует стол; иначе процесс завершается.',
    3: 'Гость вводит код. Если код не подходит, система сообщает об ошибке, и гость вводит код снова.', 4: 'Гость получает подтверждение.' };
  const gm = gradeGraph(MMD, 'mmd', T);
  check('Сл: слова узлов эталона — из FR; «Система сохраняет заказ» в FR-4 — три чужих слова; слово из реплики — своё', foreignWords(gm.graph, frs, '').length === 0
    && foreignWords({ nodes: [{ id: 'x', text: 'FR-4 · Система сохраняет заказ' }] }, frs, '').length === 3
    && foreignWords({ nodes: [{ id: 'x', text: 'FR-4 · Гость сохраняет заказ' }] }, frs, 'FR-4: гость сохраняет заказ').length === 0);
  // Известный результат по фикстуре ID-BT (LND-47): эталоны, написанные руками по README, — зелёные; схема с ответами на
  // дыры против истины «не знаю» — красная по лишнему шагу и стрелкам.
  const ts = JSON.parse(read(join(FIX, "truth-s.json")));
  const ti = JSON.parse(read(join(FIX, "truth-idk.json")));
  const MMD_S = `\`\`\`mermaid
flowchart TB
    N0(["Начало"])
    N1["FR-1 · Клиент сканирует QR-код на стиральной машине"]
    N2["FR-1 · Клиент выбирает программу стирки"]
    N3["FR-2 · Система запрашивает у машины её состояние"]
    N4{"FR-2 · Машина свободна?"}
    N5["FR-2 · Система показывает стоимость выбранной программы"]
    N6["FR-2 · Система сообщает, что машина занята"]
    N7{"FR-3 · На балансе клиента хватает денег?"}
    N8["FR-3 · Система списывает стоимость программы с баланса"]
    N9["FR-3 · Клиент оплачивает стирку банковской картой"]
    N10["FR-4 · Клиент вводит в приложении код с дисплея машины"]
    N11{"FR-4 · Код совпадает?"}
    N12["FR-4 · Система запускает стирку"]
    N13["FR-4 · Система выводит сообщение «Неверный код»"]
    N14{"FR-5 · Стирка прошла без ошибок?"}
    N15["FR-5 · Система присылает клиенту уведомление «Стирка готова»"]
    N16["FR-5 · Система отмечает машину свободной"]
    N17["FR-5 · Система вызывает администратора прачечной"]
    NE(["Конец"])
    N0 --> N1
    N1 --> N2
    N2 --> N3
    N3 --> N4
    N4 -- да --> N5
    N4 -- нет --> N6
    N6 --> NE
    N5 --> N7
    N7 -- да --> N8
    N7 -- нет --> N9
    N8 --> N10
    N9 --> N10
    N10 --> N11
    N11 -- да --> N12
    N11 -- нет --> N13
    N13 --> N10
    N12 --> N14
    N14 -- да --> N15
    N14 -- нет --> N17
    N15 --> N16
    N16 --> NE
    N17 --> NE
\`\`\``;
  const MMD_I = MMD_S.replace('    N9["FR-3 · Клиент оплачивает стирку банковской картой"]\n', '').replace('    N7 -- нет --> N9\n', '').replace('    N9 --> N10\n', '').replace('    N17 --> NE\n', '');
  const PUML_S = `@startuml
start
:FR-1 · Клиент сканирует QR-код на стиральной машине;
:FR-1 · Клиент выбирает программу стирки;
:FR-2 · Система запрашивает у машины её состояние;
if (FR-2 · Машина свободна?) then (да)
  :FR-2 · Система показывает стоимость выбранной программы;
else (нет)
  :FR-2 · Система сообщает, что машина занята;
  stop
endif
if (FR-3 · На балансе клиента хватает денег?) then (да)
  :FR-3 · Система списывает стоимость программы с баланса;
else (нет)
  :FR-3 · Клиент оплачивает стирку банковской картой;
endif
repeat
  :FR-4 · Клиент вводит в приложении код с дисплея машины;
backward:FR-4 · Система выводит сообщение «Неверный код»;
repeat while (FR-4 · Код совпадает?) is (нет) not (да)
:FR-4 · Система запускает стирку;
if (FR-5 · Стирка прошла без ошибок?) then (да)
  :FR-5 · Система присылает клиенту уведомление «Стирка готова»;
  :FR-5 · Система отмечает машину свободной;
else (нет)
  :FR-5 · Система вызывает администратора прачечной;
  stop
endif
stop
@enduml`;
  const PUML_I = PUML_S.replace("else (нет)\n  :FR-3 · Клиент оплачивает стирку банковской картой;\n", '').replace("  :FR-5 · Система вызывает администратора прачечной;\n  stop\n", "  :FR-5 · Система вызывает администратора прачечной;\n  detach\n");
  check("ID-BT: эталоны Mermaid и PlantUML по truth-s и truth-idk — У2–У4 зелёные", [[MMD_S, "mmd", ts], [PUML_S, "puml", ts], [MMD_I, "mmd", ti], [PUML_I, "puml", ti]]
    .every(([t, f, tr]) => reds(gradeGraph(t, f, tr)) === ""));
  check("ID-BT: схема с ответами против истины «не знаю» → У3, У4; слова эталона — из FR и реплики", reds(gradeGraph(MMD_S, "mmd", ti)) === "У3,У4"
    && foreignWords(gradeGraph(MMD_S, "mmd", ts).graph, frTexts(read(join(FIX, "coddoc/LND-47/business_requirements.md"))), read(join(FIX, "s-turn2.txt"))).length === 0);
  // Р1 и прогон целиком — на песочнице с фикстурой-заглушкой не собираются: проверяются на пилоте (`--round`).
  console.log(ok ? 'SELFTEST OK' : 'SELFTEST FAILED');
  process.exit(ok ? 0 : 1);
}

// CLI — только при запуске этого файла, не при импорте из другого грейдера (`grade-pt.mjs`).
const isMain = process.argv[1] != null && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) {
const args = process.argv.slice(2);
if (args[0] === '--selftest') selftest();
else if (args[0] === '--round') { const g = gradeRound(args[1]); console.log(g.out.join('\n')); }
else if (args[0]) {
  const dir = args[0].replace(/[\\/]+$/, '');
  const probe = dir.split(/[\\/]/).pop();
  if (!PROBES[probe]) { console.error(`неизвестная проба: ${probe}; есть: ${Object.keys(PROBES).join(' ')}`); process.exit(1); }
  console.log(gradePool(dir, probe).out.join('\n'));
} else console.log('usage: node grade-uf.mjs <папка-пробы> | --round <папка-раунда> | --selftest');
}
