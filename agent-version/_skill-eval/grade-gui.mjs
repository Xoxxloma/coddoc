#!/usr/bin/env node
// grade-gui.mjs <папка-раунда> — грейдер стенда оркестратора.
//
//   node grade-gui.mjs runs/2026-08-28-gui
//
// Правила стенда, из-за которых он выглядит именно так:
//   * грейдится ФАЙЛ на диске (`answer.md`, `_files.txt`), а не пересказ прогона;
//   * якоря — литеральные строки и литеральные регулярки, не собранные конкатенацией;
//   * прогон без `answer.md` — «не измерено», а не «провалено»: он в знаменатель не идёт.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const round = process.argv[2];
if (!round) { console.error('нужна папка раунда'); process.exit(1); }

const has = (t, s) => t.toLowerCase().includes(s.toLowerCase());
const qCount = (t) => (t.match(/\?/g) || []).length;
// Строки про унаследованный §4.3 — применение правила, а не притягивание: «§4.3 у всех трёх скопирован из эпика» (D16, 2026-10-07).
const noInherited = (t) => t.split('\n').filter((l) => !/§\s?4\.3|скопирован|унаследован/i.test(l)).join('\n');
// Слова до 5.35 (2026-10-06): «слайс» → «часть», «деливербл» → «поставка».
const OLD_TERMS = /слайс|деливерб|\bslices?\b|\bdeliverables?\b/i;

const CUT_CHECKS = [
  // С `analyst-workspace` 1.3.0 готовый документ идёт мимо приёмки — строка справочная, не дефект.
  ['(справочно) приёмка названа', (t) => has(t, 'spec-review')],
  ['§4.5 исполнена: часть «заявка и согласование»', (t) => has(t, 'заявка и согласование') || has(t, 'согласование')],
  ['§4.5 исполнена: часть «журнал доступов»', (t) => has(t, 'журнал доступов') || has(t, 'журнал')],
  ['назван task-decomposition-doc', (t) => has(t, 'task-decomposition-doc')],
  ['предупредил про реальные ключи подзадач', (t) => has(t, 'подзадач') || /[A-Z]{3,}-\d{3,4}/.test(t.replace(/ARS-200/g, ''))],
  // Цитата в «» — пересказ вопроса, который НЕ задаётся («Вопроса «резать или нет?» не будет»), а не вопрос.
  ['разрез заново не переспрошен', (t) => !/(резать|разбива[а-яё]*|разрезать)[^.?!\n]{0,60}\?/i.test(t.replace(/«[^»\n]*»/g, ''))],
  ['документ не переписан (1 файл)', (t, f) => f.length === 1],
];

const PROBES = {
  'GS-START': [
    ['вариант «идея → БТ / баг → репорт»', (t) => has(t, 'баг-репорт')],
    ['вариант «спека по готовому документу»', (t) => has(t, 'готового документа') || has(t, 'спецификаци')],
    ['вариант «продолжить начатое»', (t) => has(t, 'продолжить начатое')],
    ['вариант «обновить описание сервисов»', (t) => has(t, 'описание сервисов') || has(t, 'обновить сервис')],
    ['ключ задачи НЕ спрошен', (t) => !has(t, 'ключ задачи') && !has(t, 'smsec-') && !/\bJira\b/i.test(t)],
    ['ход кончился вопросом', (t) => qCount(t) >= 1],
    ['файлов не писал', (t, f) => f.length === 0],
  ],
  'GS-RESUME': [
    ['сводка: готовые дети названы', (t) => has(t, 'ARS-101') && has(t, 'ARS-102')],
    ['сводка: оставшийся ребёнок назван', (t) => has(t, 'ARS-103')],
    ['вопрос «продолжаем с ARS-103?»', (t) => /ARS-103/.test(t) && qCount(t) >= 1],
    ['вопрос ОДИН (не больше двух «?»)', (t) => qCount(t) >= 1 && qCount(t) <= 2],
    ['слепка нет — сказано строкой', (t) => has(t, 'service-map') || has(t, 'слепк')],
    ['фикстуру не переписал (7 файлов)', (t, f) => f.length === 7],
  ],
  'GS-FND2': [
    ['общий источник назван', (t) => has(t, 'справочник')],
    ['узел #0 предложен', (t) => has(t, '#0') || has(t, 'фундамент')],
    ['сказано: своего БТ у #0 не будет', (t) => has(t, 'своего БТ') || has(t, 'слой реализации') || has(t, 'БТ у #0') || has(t, 'без своего БТ')],
    ['пара #0 названа верно (701 и 702)', (t) => has(t, 'ARS-701') && has(t, 'ARS-702')],
    ['третий ребёнок назван', (t) => has(t, 'ARS-703')],
    ['третий ребёнок НЕ притянут в #0', (t) => { const u = noInherited(t); return !has(u, 'все три') && !has(u, 'все трое') && !has(u, 'всех трёх') && !has(u, 'всех трех'); }],
    ['ход кончился вопросом', (t) => qCount(t) >= 1],
    ['файлов не писал (5 файлов)', (t, f) => f.length === 5],
  ],
  'GS-GATE': [
    ['статус «Требуются уточнения» пойман', (t) => has(t, 'требуются уточнения') || has(t, 'открыт')],
    ['назван открытый пункт про отпуск/заместителя', (t) => has(t, 'отпуск') || has(t, 'заместит') || has(t, 'очеред')],
    ['назван открытый пункт про срок хранения', (t) => has(t, 'хранени')],
    ['задан вопрос гейта', (t) => qCount(t) >= 1],
    ['предложены оба исхода', (t) => (has(t, 'как есть') || has(t, 'идти дальше') || has(t, 'дальше как')) && (has(t, 'поправить') || has(t, 'доработать') || has(t, 'вернёмся'))],
    ['под-скилл не запущен до ответа', (t) => !has(t, 'запускаю')],
    ['документ не переписан (1 файл)', (t, f) => f.length === 1],
  ],
  'GS-BUG': [
    ['назван technical-spec-doc', (t) => has(t, 'technical-spec-doc')],
    ['назван флаг багфикса', (t) => has(t, 'багфикс') || has(t, 'bugfix')],
    ['передан путь к репорту', (t) => has(t, 'bug_report.md')],
    ['разрез не обсуждается', (t) => !has(t, 'слайс') && !has(t, 'деливербл') && !has(t, 'поставк') && !has(t, 'разрез') && !has(t, 'разбива')],
    ['task-decomposition-doc не назван', (t) => !has(t, 'task-decomposition-doc')],
    ['документ не переписан (1 файл)', (t, f) => f.length === 1],
  ],
  'GS-NOCUT': [
    ['числа названы: FR и поставки', (t) => (has(t, '5 FR') || has(t, 'пять FR') || has(t, '5FR') || has(t, '5 функциональн') || /FR[*:\s]{1,6}5(?!\d)/.test(t)) && (has(t, 'поставк') || has(t, 'деливербл') || has(t, 'фич'))],
    ['вывод «эпик» сделан', (t) => has(t, 'эпик')],
    ['эпик НЕ схлопнут рационализацией', (t) => !/одна фича|резать не нужно|резать нечего|разрезать нечего|не нужно разбивать|разбиение не требуется/i.test(t)],
    ['назван task-decomposition-doc', (t) => has(t, 'task-decomposition-doc')],
    ['предупредил про реальные ключи подзадач', (t) => has(t, 'подзадач')],
    ['ход кончился вопросом', (t) => qCount(t) >= 1],
    ['файлов не писал (1 файл)', (t, f) => f.length === 1],
    ['старых слов нет (слайс/деливербл)', (t) => !OLD_TERMS.test(t)],
  ],
  'GS-FND': [
    ['общий источник назван', (t) => has(t, 'справочник')],
    ['узел #0 предложен', (t) => has(t, '#0') || has(t, 'фундамент')],
    ['сказано: своего БТ у #0 не будет', (t) => has(t, 'своего БТ') || has(t, 'слой реализации') || has(t, 'БТ у #0') || has(t, 'без своего БТ')],
    ['третий ребёнок не притянут в #0', (t) => { const u = noInherited(t); return has(t, 'ARS-503') && !has(u, 'все трое') && !has(u, 'все три ') && !has(u, 'всех трёх') && !has(u, 'всех трех'); }],
    ['ход кончился вопросом', (t) => qCount(t) >= 1],
    ['файлов не писал (5 файлов)', (t, f) => f.length === 5],
  ],
  'GS-REWORK': [
    ['приёмка названа', (t) => has(t, 'spec-review')],
    ['названа переписанная спека', (t) => has(t, 'technical_specification')],
    ['приёмка раньше разбиения на этапы', (t) => { const a = t.indexOf('spec-review'), b = t.indexOf('stage-breakdown-doc'); return a >= 0 && (b < 0 || a < b); }],
    ['файлов не писал (2 файла)', (t, f) => f.length === 2],
  ],
  // БТ во фикстуре со «слайсами» (до 5.35) — старые слова в ответе здесь не дефект, а цитата входа.
  'GS-CUT': CUT_CHECKS,
  // Тот же БТ на словах 5.35.
  'GS-CUT2': [...CUT_CHECKS, ['старых слов нет (слайс/деливербл)', (t) => !OLD_TERMS.test(t)]],
};

const arms = readdirSync(round, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('_') && d.name !== 'after-pilot')
  .map((d) => d.name);

for (const arm of arms) {
  console.log(`\n===== плечо: ${arm} =====`);
  for (const [probe, checks] of Object.entries(PROBES)) {
    const dir = join(round, arm, probe);
    if (!existsSync(dir)) continue;
    const runs = readdirSync(dir).filter((r) => r.startsWith('run-')).sort();
    const measured = [];
    for (const r of runs) {
      const a = join(dir, r, 'answer.md');
      if (!existsSync(a)) continue;
      const t = readFileSync(a, 'utf8');
      if (!t.trim()) continue;
      const fl = existsSync(join(dir, r, '_files.txt'))
        ? readFileSync(join(dir, r, '_files.txt'), 'utf8').split('\n').filter((x) => x.trim())
        : [];
      measured.push({ r, t, fl });
    }
    console.log(`\n-- ${probe}: измерено ${measured.length} из ${runs.length}`);
    for (const [name, fn] of checks) {
      const ok = measured.filter((m) => { try { return fn(m.t, m.fl); } catch { return false; } });
      const bad = measured.filter((m) => !ok.includes(m)).map((m) => m.r).join(' ');
      console.log(`   ${ok.length}/${measured.length}  ${name}${bad ? '   ✗ ' + bad : ''}`);
    }
  }
}
