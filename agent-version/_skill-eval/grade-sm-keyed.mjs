// grade-sm-keyed.mjs — плечо `keyed` SM-REAL: быстрое обновление repairy-api по подсказке hint-patch.md
// поверх патча patch-remind.diff. Те же пять фактов, что считались вручную в 5.2, плюс режим.
//
//   node grade-sm-keyed.mjs <раунд>
//
// Факты патча в карточке: эндпоинт remind, поле lastRemindedAt, вид «напоминание о приёмке» /
// ACCEPTANCE_REMINDER, «раз в сутки», «60 с». Режим: `updated:` в шапке, `scanned` не сдвинут,
// в журнале нет Write карточки и нет ухода на полный путь; нетронутое — доля строк прежней карточки,
// найденных дословно.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const FACTS = [
  ['эндпоинт remind', /acceptances\/[^\s`]*\/remind|\/remind\b/i],
  ['поле lastRemindedAt', /lastRemindedAt/],
  ['вид «напоминание о приёмке»', /ACCEPTANCE_REMINDER|напоминани[а-яё]*\s+о\s+при[её]мк/i],
  ['не чаще раза в сутки', /раз[а]?\s+в\s+сутки|24\s*ч|не чаще/i],
  ['склейка 60 с', /\b60\s*(с|сек)/i],
];
const round = process.argv[2];
if (!round || !existsSync(round)) { console.error('нужна папка раунда'); process.exit(1); }
const sb = join(round, 'sandbox');
const dirs = existsSync(sb) ? readdirSync(sb).filter((d) => /^keyed-/.test(d) && statSync(join(sb, d)).isDirectory()).sort() : [];
console.log(`\nпроба keyed, ${round}`);
console.log('песочница · факты патча /5 · updated · scanned прежний · Write карточки · полный путь · дословно прежнего · опись: справочник/ограничение');
for (const d of dirs) {
  const card = join(sb, d, 'w', 'AI-SDD', 'services', 'repairy-api.md');
  const prev = join(sb, d, '_prev', 'repairy-api.md');
  const log = join(sb, d, 'w', 'AI-SDD', 'actions.log');
  const ans = join(sb, d, 'answer.md');
  if (!existsSync(card)) { console.log(`  ${d}: карточки нет`); continue; }
  const t = readFileSync(card, 'utf8');
  const j = existsSync(log) ? readFileSync(log, 'utf8') : '';
  const a = existsSync(ans) ? readFileSync(ans, 'utf8') : '';
  const facts = FACTS.filter(([, re]) => re.test(t)).map(([n]) => n);
  const updated = /^updated:\s*\d{4}-\d{2}-\d{2}/m.test(t) && !/^updated:\s*2026-06-01/m.test(t);
  const scannedOld = /^scanned:\s*2026-06-01/m.test(t);
  const wrote = j.split('\n').filter((l) => /Write/.test(l) && /(?<!_history\/)repairy-api\.md/.test(l) && !/не Write|not Write/.test(l)).length;
  const fullPath = updated && wrote === 0 ? 'нет (быстрое обновление)' : 'да';
  let verbatim = '—';
  if (existsSync(prev)) {
    const p = readFileSync(prev, 'utf8');
    const rows = p.split('\n').filter((l) => /^[-—]\s/.test(l) && l.length > 20);
    const hit = rows.filter((r) => t.includes(r)).length;
    verbatim = `${Math.round((100 * hit) / rows.length)}%`;
  }
  const inv = (a.match(/справочник:|ограничение:/g) || []).length;
  console.log(`  ${d}: ${facts.length}/5 [${facts.map((f) => f.slice(0, 12)).join(', ')}] · ${updated ? '✅' : '❌'} · ${scannedOld ? '✅' : '❌'} · ${wrote} · ${fullPath} · ${verbatim} · ${inv}`);
}
