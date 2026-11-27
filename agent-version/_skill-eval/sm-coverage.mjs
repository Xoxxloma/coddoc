// Покрытие карточки service-map от скана к скану: несколько карточек одного сервиса — один эталон.
//
//   node sm-coverage.mjs [--ref=2] <карточка> <карточка> [<карточка> …]
//
// Эталон — элемент, который есть хотя бы в --ref картах (по умолчанию 2; карт нужно не меньше трёх,
// иначе эталон совпадает с пересечением). Печатает по каждой карте:
//   - ключи «Публичного контракта», «Событий», «Фоновых задач», «Владеет данными»: сколько в объединении,
//     по скольким картам, доля эталона в карте;
//   - поля сущностей: доля эталонных полей, сущности с полным перечнем, чаще всего выпадающие поля;
//   - роли: доля эталонных ролей (ключ — первая колонка без бэктиков и без области в скобках);
//   - дубли в карте: один ключ дважды после приведения к ключу шаблона и пары сущностей с почти
//     одинаковым перечнем полей (одна сущность под двумя именами);
//   - плотность: строк `- ` и `— ` на блок по ключам, общим для всех карт.
// Ключ — по шаблону: без бэктиков и хвоста « — …» (кроме «Бизнес-правил»), у REST без строки запроса, у
// query/mutation/subscription/rpc без аргументов, у «Событий» — направление и топик в бэктиках.
// Только чтение, моделей не запускает.
import fs from 'node:fs';

const args = process.argv.slice(2);
const refArg = args.find(a => a.startsWith('--ref='));
const REF = refArg ? Number(refArg.slice(6)) : 2;
const files = args.filter(a => !a.startsWith('--'));
if (files.length < 2) { console.error('нужно не меньше двух карточек'); process.exit(2); }

const section = (L, name) => { const s = L.indexOf('## ' + name); const out = []; if (s < 0) return out; for (let i = s + 1; i < L.length && !L[i].startsWith('## '); i++) out.push(L[i]); return out; };
const blocks = lines => { const m = new Map(); let k = null; for (const l of lines) { if (l.startsWith('### ')) { k = l.slice(4); m.set(k, []); } else if (k) m.get(k).push(l); } return m; };
function key(sec, h) {
  const tick = h.match(/`([^`]+)`/);
  let k = h.replace(/`/g, '').replace(/\s+—\s.*$/, '').replace(/\s+/g, ' ').trim();
  if (sec === 'Публичный контракт') {
    if (/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) /i.test(k)) k = k.replace(/\?.*$/, '').replace(/^\w+/, m => m.toUpperCase());
    else if (/^(query|mutation|subscription|rpc) /.test(k)) k = k.replace(/\s*\(.*\)$/, '');
  }
  if (sec === 'События') { const d = k.split(' ')[0]; if (/^(публикует|потребляет)$/.test(d) && tick) k = d + ' ' + tick[1]; else k = k.replace(/\s*\([^)]*\)$/, ''); }
  return k;
}
function fieldNames(l) {
  let s = l.replace(/^-\s*/, '');
  const p = Math.min(...[s.indexOf(':'), s.indexOf(' — ')].filter(x => x >= 0), s.length);
  const items = s.slice(0, p).split(/[,\/]/).map(t => t.trim().replace(/\s*\([^)]*\)$/, '').replace(/`/g, '').replace(/\?$/, ''));
  return items.every(t => /^[A-Za-z_]\w*$/.test(t)) ? items : [];
}
const pct = (a, b) => (b ? Math.round((100 * a) / b) + '%' : '—');
const cards = files.map(f => fs.readFileSync(f, 'utf8').split(/\r?\n/));
const names = files.map((f, i) => `${i + 1}`);
console.log(`карт ${files.length}, эталон — есть хотя бы в ${REF}: ` + files.map((f, i) => `${i + 1}=${f.split('/').pop()}`).join(', '));

console.log('\n== Ключи');
for (const sec of ['Публичный контракт', 'События', 'Фоновые задачи', 'Владеет данными']) {
  const sets = cards.map(L => new Set([...blocks(section(L, sec)).keys()].map(h => key(sec, h))));
  const cnt = new Map(); sets.forEach(s => s.forEach(k => cnt.set(k, (cnt.get(k) || 0) + 1)));
  const ref = [...cnt].filter(([, c]) => c >= REF).map(([k]) => k);
  const byN = files.map((_, i) => [...cnt.values()].filter(c => c === i + 1).length);
  console.log(`${sec}: в объединении ${cnt.size}, по числу карт ${byN.join('/')}; эталон ${ref.length}, покрытие ${sets.map(s => pct(ref.filter(k => s.has(k)).length, ref.length)).join(' / ')}`);
  sets.forEach((s, i) => { const miss = ref.filter(k => !s.has(k)); if (miss.length && miss.length <= 12) console.log(`  нет в ${names[i]}: ${miss.join('; ')}`); });
}

console.log('\n== Поля сущностей');
const F = cards.map(L => { const m = new Map(); for (const [h, b] of blocks(section(L, 'Владеет данными'))) { const e = key('Владеет данными', h); const set = m.get(e) || new Set(); b.filter(l => l.startsWith('- ')).forEach(l => fieldNames(l).forEach(n => set.add(n))); m.set(e, set); } return m; });
const ents = [...new Set(F.flatMap(m => [...m.keys()]))].filter(e => F.filter(m => m.has(e)).length >= REF);
const got = files.map(() => 0), full = files.map(() => 0), missCnt = new Map(); let refFields = 0; const worst = [];
for (const e of ents) {
  const c = new Map(); F.forEach(m => (m.get(e) || new Set()).forEach(n => c.set(n, (c.get(n) || 0) + 1)));
  const R = [...c].filter(([, n]) => n >= REF).map(([n]) => n); refFields += R.length;
  let min = 1;
  F.forEach((m, i) => { const s = m.get(e) || new Set(); const have = R.filter(n => s.has(n)).length; got[i] += have; if (have === R.length) full[i]++; R.filter(n => !s.has(n)).forEach(n => missCnt.set(n, (missCnt.get(n) || 0) + 1)); if (R.length) min = Math.min(min, have / R.length); });
  worst.push([e, R.length, min]);
}
console.log(`сущностей ${ents.length}, эталонных полей ${refFields}; покрытие ${got.map(g => pct(g, refFields)).join(' / ')}; с полным перечнем ${full.join(' / ')} из ${ents.length}`);
console.log('чаще выпадают: ' + [...missCnt].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([n, c]) => `${n}×${c}`).join(', '));
console.log('хуже всего: ' + worst.sort((a, b) => a[2] - b[2]).slice(0, 6).map(([e, n, m]) => `${e} ${Math.round(m * 100)}% из ${n}`).join('; '));

console.log('\n== Роли');
// Ключ роли: без бэктиков и области в скобках, без префикса `ROLE_` (Spring пишет роль и так, и так), без
// учёта регистра; склеенная ячейка («A / B», «A, B») — две роли; строка «не определено: …» — не роль.
const roleKeys = r => r.replace(/`/g, '').split(/\s*[\/,]\s*/).map(x => x.replace(/\s*\(.*$/, '').trim().replace(/^ROLE_/i, '').toUpperCase()).filter(x => x && x !== '—' && !/^НЕ ОПРЕДЕЛЕНО/.test(x));
const R = cards.map(L => new Set(section(L, 'Роли и доступ').filter(l => /^\|/.test(l) && !/^\|[\s:|-]*$/.test(l)).slice(1).flatMap(l => roleKeys(l.split('|')[1] || ''))));
const rc = new Map(); R.forEach(s => s.forEach(k => rc.set(k, (rc.get(k) || 0) + 1)));
const rref = [...rc].filter(([, c]) => c >= REF).map(([k]) => k);
console.log(`в объединении ${rc.size}, эталон ${rref.length}; покрытие ${R.map(s => pct(rref.filter(k => s.has(k)).length, rref.length)).join(' / ')}; строк в карте ${R.map(s => s.size).join(' / ')}`);

// Пара сущностей с почти одинаковым перечнем полей, которая стоит во всех картах, — скорее два разных
// класса (соседи по модели); подозрительна пара, которой нет хотя бы в одной карте.
console.log('\n== Дубли в карте');
const P = F.map(m => { const list = [...m].filter(([, s]) => s.size >= 3); const pairs = new Set();
  for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
    const [ea, sa] = list[a], [eb, sb] = list[b]; const inter = [...sa].filter(n => sb.has(n)).length;
    if (inter / (sa.size + sb.size - inter) >= 0.8) pairs.add([ea, eb].sort().join(' ~ '));
  } return pairs; });
const everywhere = [...P[0]].filter(p => P.every(s => s.has(p)));
if (everywhere.length) console.log(`пары с близкими полями во всех картах (вероятно, разные классы): ${everywhere.join('; ')}`);
cards.forEach((L, i) => {
  const out = [];
  for (const sec of ['Публичный контракт', 'События', 'Фоновые задачи', 'Владеет данными']) {
    const ks = [...blocks(section(L, sec)).keys()].map(h => key(sec, h));
    const d = [...new Set(ks.filter((k, j) => ks.indexOf(k) !== j))];
    if (d.length) out.push(`${sec}: ${d.join('; ')}`);
  }
  const odd = [...P[i]].filter(p => !everywhere.includes(p));
  if (odd.length) out.push(`похоже на одну сущность под двумя именами: ${odd.join('; ')}`);
  console.log(`${names[i]}: ${out.length ? out.join(' | ') : 'нет'}`);
});

console.log('\n== Плотность по общим ключам (строк «- » и «— » на блок)');
for (const sec of ['Публичный контракт', 'События', 'Фоновые задачи', 'Владеет данными']) {
  const B = cards.map(L => { const m = new Map(); for (const [h, b] of blocks(section(L, sec))) m.set(key(sec, h), b.filter(l => /^[-—] /.test(l) && !/^- сущности:/.test(l)).length); return m; });
  const common = [...B[0].keys()].filter(k => B.every(b => b.has(k)));
  console.log(`${sec}: общих ${common.length}; ${B.map(b => (common.reduce((a, k) => a + b.get(k), 0) / Math.max(common.length, 1)).toFixed(1)).join(' / ')}; пустых ${B.map(b => common.filter(k => b.get(k) === 0).length).join(' / ')}`);
}
