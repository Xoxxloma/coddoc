#!/usr/bin/env node
// grade-sm-front.mjs <папка раунда> — грейдер плеча `front` SM-REAL (ключ: fixtures/SM-REAL/KEY-FRONT.md).
// Читает карточки песочниц <раунд>/sandbox/front-N/w/AI-SDD/services/ (и _pending/), печатает по прогону
// таблицу сервисов и критерии F1–F3, S1, D1–D3, R1; в конце — итог по критериям.
import fs from 'node:fs';
import path from 'node:path';

const ROUND = process.argv[2];
if (!ROUND) { console.error('нужна папка раунда'); process.exit(2); }
const SB = path.join(ROUND, 'sandbox');
const runs = fs.existsSync(SB) ? fs.readdirSync(SB).filter((d) => /^front-\d+$/.test(d)).sort() : [];
if (!runs.length) { console.error(`нет песочниц front-N в ${SB}`); process.exit(2); }

const rd = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8').replace(/\r/g, '') : null);
const section = (text, name) => {
  const L = text.split('\n'); const i = L.findIndex((l) => l.startsWith('## ' + name));
  if (i < 0) return null; const out = [];
  for (let j = i + 1; j < L.length && !L[j].startsWith('## '); j++) out.push(L[j]);
  return out;
};
const blocks = (sec) => (sec ?? []).filter((l) => l.startsWith('### ')).map((l) => l.slice(4).replace(/`/g, '').replace(/ — .*/, '').trim());
const rows = (sec) => (sec ?? []).filter((l) => /^\|/.test(l) && !/^\|[\s:|-]*$/.test(l))
  .map((l) => l.split('|')[1].replace(/`/g, '').trim()).slice(1).filter((c) => c && c !== '—');
const pathOf = (k) => (k.match(/^(?:GET|POST|PUT|PATCH|DELETE)\s+(\S+)/) ?? [])[1] ?? '';

const SERVICES = ['resonance-web', 'webapp-shop', 'skydesk', 'dome-control', 'resonance-api'];
const CLIENT_OPS = /\/(forecast|cloud-alerts|stations|alerts\/subscriptions)\b/;
const tally = {};
const mark = (id, ok) => { tally[id] ??= [0, 0]; tally[id][1]++; if (ok) tally[id][0]++; return ok ? 'ок' : 'НЕТ'; };

for (const r of runs) {
  const svc = path.join(SB, r, 'w', 'AI-SDD', 'services');
  const log = rd(path.join(SB, r, 'w', 'AI-SDD', 'actions.log')) ?? '';
  const cost = (rd(path.join(SB, r, '_cost.txt')) ?? '').trim();
  console.log(`=== ${r}${cost ? ` (${cost})` : ''}`);
  const S = {};
  for (const s of SERVICES) {
    const okCard = rd(path.join(svc, `${s}.md`)); const pend = rd(path.join(svc, '_pending', `${s}.md`));
    const card = okCard ?? pend ?? '';
    const contract = blocks(section(card, 'Публичный контракт'));
    S[s] = {
      loc: okCard ? 'записана' : pend ? '_pending' : 'нет',
      contract,
      screens: rows(section(card, 'Экраны')),
      deps: rows(section(card, 'Зависит от')),
      text: card,
    };
    console.log(`  ${s.padEnd(14)} ${S[s].loc.padEnd(9)} контракт ${String(contract.length).padStart(3)}  экраны ${String(S[s].screens.length).padStart(3)}`);
  }
  const front = ['resonance-web', 'webapp-shop'];
  console.log(`  F1 фронты записаны: ${mark('F1', front.every((s) => S[s].loc === 'записана'))}`);
  console.log(`  F2 экраны (resonance-web ≥ 7, webapp-shop 3): ${mark('F2', S['resonance-web'].screens.length >= 7 && S['webapp-shop'].screens.length >= 3)}`);
  console.log(`  F3 у фронтов нет контракта: ${mark('F3', front.every((s) => S[s].contract.length === 0))}`);
  const sk = S.skydesk;
  console.log(`  S1 skydesk: записана, ручек 5 под /api, экранов ≥ 4: ${mark('S1', sk.loc === 'записана' && sk.contract.length === 5 && sk.contract.every((k) => pathOf(k).startsWith('/api')) && sk.screens.length >= 4)}`);
  const dc = S['dome-control'];
  console.log(`  D1 dome-control: записана, ручек 4 (/api/domes…): ${mark('D1', dc.loc === 'записана' && dc.contract.length === 4 && dc.contract.every((k) => pathOf(k).startsWith('/api/domes')))}`);
  const contractText = (section(dc.text, 'Публичный контракт') ?? []).join('\n');
  console.log(`  D2 операций спеки соседа в контракте нет: ${mark('D2', !CLIENT_OPS.test(contractText))}`);
  console.log(`  D3 weather-feed в «Зависит от»: ${mark('D3', dc.deps.some((d) => /weather-feed/.test(d)))}`);
  const ra = S['resonance-api'];
  console.log(`  R1 resonance-api: записана, ручек ≥ 28: ${mark('R1', ra.loc === 'записана' && ra.contract.length >= 28)}`);
  const notes = [];
  if (/СПЕКА НЕ РАЗМЕЧЕНА/.test(log)) notes.push('в журнале «СПЕКА НЕ РАЗМЕЧЕНА»');
  if (/НЕ ПРОЙДЕН/.test(log)) notes.push('в журнале «НЕ ПРОЙДЕН»');
  if (/часть 0?1|нарез/i.test(log)) notes.push('в журнале есть нарезка');
  if (notes.length) console.log(`  справочно: ${notes.join('; ')}`);
}
console.log('=== итог по критериям');
for (const id of ['F1', 'F2', 'F3', 'S1', 'D1', 'D2', 'D3', 'R1']) {
  const [ok, n] = tally[id] ?? [0, 0];
  console.log(`  ${id} ${ok}/${n}`);
}
