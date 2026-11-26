// Пробы этапа 2 deep-search: глубокий поиск из интервью technical-spec-doc, фикстура TS-DEEP поверх DS-BASE.
//
//   node agent-version/_skill-eval/run-spec-deep.mjs <раунд> [прогонов на пробу] [модель] [пробы через запятую]
//   node agent-version/_skill-eval/run-spec-deep.mjs --selftest        // оценщик на заведомо известных потоках
//   node agent-version/_skill-eval/run-spec-deep.mjs --regrade <раунд>  // перегрейд снятых потоков, без прогонов
//
// Снимки обоих скиллов — один раз на раунд, в `runs/<раунд>/_skills/`: все прогоны раунда читают один текст.
// Песочница — во временной папке ОС: `DS-BASE/ws/` + `TS-DEEP/overlay/`, `.git` дописывает раннер (git их в
// фикстуру не пускает), скиллы — рядом друг с другом в `AI-SDD/.claude/skills/` и `AI-SDD/.gigacode/skills/`,
// как на проде; прогон идёт из `AI-SDD`. Ходы — в одну сессию (`--resume`), реплики — `TS-DEEP/replies.md`.
// Оценка — только после того, как закончились ВСЕ прогоны. Копия спеки и итог ходов (`turns.json`) лежат в
// папке прогона: перегрейду песочница не нужна.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { modelId } from './model-id.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SKILLS = ['technical-spec-doc', 'deep-search'];
const fixtureWs = join(here, 'fixtures', 'DS-BASE', 'ws');
const fixture = join(here, 'fixtures', 'TS-DEEP');
const REPOS = ['tool-rental', 'deposit-service', 'tool-catalog', 'repairy'];
// Проба `deep-repairy` — настоящая монорепа (fixtures/DS-REPAIRY/README.md): её код копируется по списку из REPAIRY_SRC.
const repairySrc = process.env.REPAIRY_SRC ?? 'C:/Users/Konstantin/projects/repairy';
const SECRETS = ['rental-local-7731', 'Kx-local-Rent4l-2291'];
const MAX_TURNS = 6;
// п.2б (P2B=1): признак «поля события из кода в спеке». Самопроверка — на прежних образцах, флаг на неё не распространяется.
let P2B_ON = process.env.P2B === '1';

// ---------------------------------------------------------------- пробы (fixtures/TS-DEEP/README.md)

/** Блоки `## ход N` и `## дальше` из файла реплик пробы (по умолчанию replies.md). */
function replies(file = 'replies.md') {
  const text = readFileSync(join(fixture, file), 'utf8').replace(/\r/g, '');
  const out = {};
  for (const m of text.matchAll(/^## (ход \d+|дальше)\n([\s\S]*?)(?=^## |(?![\s\S]))/gm)) out[m[1]] = m[2].trim();
  return out;
}

const PROBES = [
  { id: 'deep', spec: 'AI-SDD/coddoc/RNT-41/technical_specification.md',
    turns: (r) => [r['ход 1'], r['ход 2'], r['ход 3']], next: (r) => r['дальше'] },
  { id: 'bugfix', spec: 'AI-SDD/coddoc/RNT-52/technical_specification.md',
    turns: () => ['Это багфикс. Документ сверху — баг-репорт coddoc/RNT-52/bug_report.md, бизнес-требований у задачи нет и не заводится. Работай в режиме багфикса.'] },
  // Края находок ревью 2026-10-25: аналитик поправил находку разведчика; разведчик не нашёл (событие только в карточке).
  { id: 'deep-otherwise', spec: 'AI-SDD/coddoc/RNT-41/technical_specification.md', replies: 'replies-otherwise.md',
    turns: (r) => [r['ход 1'], r['ход 2'], r['ход 3']], next: (r) => r['дальше'] },
  { id: 'deep-notfound', spec: 'AI-SDD/coddoc/RNT-43/technical_specification.md', replies: 'replies-nf.md', overlays: ['overlay', 'overlay-nf'],
    turns: (r) => [r['ход 1'], r['ход 2'], r['ход 3']], next: (r) => r['дальше'] },
  // Карточка repairy-api: «изменена смета» — только при изменении стоимости; в коде — при любой правке работы.
  { id: 'deep-repairy', spec: 'AI-SDD/coddoc/RPR-7/technical_specification.md', replies: 'replies-r.md', base: 'repairy', overlays: ['overlay-r'],
    turns: (r) => [r['ход 1'], r['ход 2'], r['ход 3']], next: (r) => r['дальше'] },
  // Только ход 1 той же пробы: открыт ли from-spec.md и дан ли вариант — дешёвый замер на другой модели.
  { id: 'deep-repairy-t1', spec: 'AI-SDD/coddoc/RPR-7/technical_specification.md', replies: 'replies-r.md', base: 'repairy', overlays: ['overlay-r'],
    turns: (r) => [r['ход 1']] },
];

const wrap = (cwd, msg) => `Твоя рабочая директория — ${cwd}. Ничего за её пределами не создавай и не изменяй.

Прочитай целиком файл ${cwd}/.claude/skills/technical-spec-doc/SKILL.md — это скилл. Дальше действуй строго по нему, как если бы он был загружен командой /skill.

Интерактивного инструмента вопросов (AskUserQuestion) в этом окружении нет. Если по скиллу нужно задать вопросы — задавай их обычным текстом.

Сообщение пользователя:
<<<
${msg}
>>>
Отработай по скиллу.`;

// ---------------------------------------------------------------- песочница

function seed(sb, overlays = ['overlay'], base = null) {
  const ws = join(sb, 'ws');
  cpSync(base === 'repairy' ? join(here, 'fixtures', 'DS-REPAIRY', 'ws') : fixtureWs, ws, { recursive: true });
  for (const o of overlays) cpSync(join(fixture, o), ws, { recursive: true, force: true });
  const put = (rel, body) => { const p = join(ws, ...rel.split('/')); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, body); };
  put('AI-SDD/.git/HEAD', 'ref: refs/heads/main\n');
  if (base === 'repairy') {
    for (const rel of readFileSync(join(here, 'fixtures', 'DS-REPAIRY', 'repairy-files.txt'), 'utf8').split(/\r?\n/).filter(Boolean)) {
      const src = join(repairySrc, ...rel.split('/'));
      if (!existsSync(src)) throw new Error(`нет файла repairy: ${src}`);
      mkdirSync(dirname(join(ws, 'repairy', ...rel.split('/'))), { recursive: true });
      cpSync(src, join(ws, 'repairy', ...rel.split('/')));
    }
    put('repairy/.git/HEAD', 'ref: refs/heads/master\n');
    return ws;
  }
  put('tool-rental/.git/HEAD', 'ref: refs/heads/develop\n');
  put('deposit-service/.git/HEAD', 'ref: refs/heads/main\n');
  put('tool-catalog/.git', 'gitdir: /srv/git/tool-catalog/worktrees/main\n');
  return ws;
}

/** Снимок дерева: путь → хэш; `.claude`, `.gigacode` и `.git` не считаются. */
function snapshot(dir, base = dir, out = {}) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (['.claude', '.gigacode', '.git'].includes(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) snapshot(p, base, out);
    else out[relative(base, p).replace(/\\/g, '/')] = createHash('sha1').update(readFileSync(p)).digest('hex');
  }
  return out;
}
const diffSnap = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]);

// ---------------------------------------------------------------- оценщик

const norm = (p) => String(p ?? '').replace(/\\/g, '/');
const inRepo = (p) => REPOS.some((r) => new RegExp(`/ws/${r}(/|$)`).test(norm(p))) && !/\/\.git(\/|$)/.test(norm(p));
const isFromSpec = (u) => u.name === 'Read' && /deep-search\/reference\/from-spec\.md$/.test(norm(u.input?.file_path));
const isBrief = (u) => u.name === 'Read' && /deep-search\/reference\/brief\.md$/.test(norm(u.input?.file_path));
// Сверка — Read с offset и limit; ссылка с диапазоном законно даёт limit больше пяти строк.
const isVerify = (u) => u.name === 'Read' && inRepo(u.input?.file_path) && u.input?.offset != null && Number(u.input?.limit) > 0 && Number(u.input?.limit) <= 30;
// Glob ведущего по папке репы — проверка «код рядом» (from-spec.md §1), не чтение кода.
const mainCode = (t) => t.main.filter((u) => (u.name === 'Read' && inRepo(u.input?.file_path) && !isVerify(u))
  || (u.name === 'Grep' && inRepo(u.input?.path)));
// Строки, где утверждение не снято отрицанием и не отнесено к карточке.
const linesWithout = (re, ok) => (a) => !a.split('\n').some((l) => re.test(l) && !ok.test(l));
// Утверждение карточки — про транзакцию ВОЗВРАТА; «транзакция откатывается» нашей собственной обработки — 🟢-дизайн
// (итоговый пул 2026-10-24).
const cardClaim = linesWithout(/внутри\s+(той\s+же\s+)?транзакци[а-яё]*\s+возврат|возврат[а-яё]*\s+(не\s+)?откатыва|откатыва[а-яё]*\s+(и\s+)?возврат/i,
  /карточк|не\s+внутри|вне\s+транзакц|после\s+(коммит|фиксац)|не\s+откатыва|без\s+отката|откат[а-яё]*\s+нет(?![а-яё])/i);
const SERVICE = /tool-rental|deposit-service|customer-notify|repairy-api|repairy-web/g;
/** Значения секретов из файлов окружения repairy — читаются из REPAIRY_SRC, сами значения в раннер не пишутся. */
function repairySecrets() {
  const out = [];
  for (const rel of ['.env.prod.example', 'apps/api/.env.example', 'apps/api/.env.test', 'apps/telegram/.env.example', 'apps/web/.env.example', 'apps/web/.env.test']) {
    const p = join(repairySrc, ...rel.split('/'));
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]*(?:SECRET|TOKEN|KEY|PASSWORD|DATABASE_URL)[A-Z0-9_]*)\s*=\s*"?([^"\s#]+)"?/);
      if (m && m[2].length >= 12 && !/change|your|example|xxx|<|placeholder/i.test(m[2])) out.push(m[2]);
    }
  }
  return out;
}

/** Вариант «Глубокий поиск» → сервис, о котором он: первое имя после него в том же предложении («поиск по коду X»),
 *  иначе последнее до него в том же предложении («код X лежит рядом, по нему доступен поиск»), иначе последнее в
 *  шести строках над ним (вариант списком под вопросом). Прозой без инструмента вопросов вариант идёт фразой (пилот 2026-10-24). */
function deepTargets(text) {
  const out = [];
  for (const m of text.matchAll(/глубокий\s+поиск/gi)) {
    const head = text.slice(0, m.index);
    const tail = text.slice(m.index + m[0].length).split(/[.!?](?=\s|$)|\n/)[0];
    // «…поиск недоступен / не используется / не предлагаю» — упоминание, не вариант (батч 5, 2026-10-24).
    if (/недоступ|не\s+(использ|предлага|будет|предусмотр)|нет(?![а-яё])/i.test(tail)) continue;
    const after = tail.match(SERVICE);
    const before = head.slice(head.search(/[^.!?\n]*$/)).match(SERVICE);
    const above = head.split('\n').slice(-7).join(' ').match(SERVICE);
    out.push(after ? after[0] : before ? before.at(-1) : above ? above.at(-1) : '?');
  }
  return out;
}

const parse = (lines) => lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

function turnInfo(lines) {
  const ev = parse(lines);
  const uses = (pred) => ev.filter((e) => e.type === 'assistant' && pred(e)).flatMap((e) => (e.message?.content ?? []).filter((c) => c.type === 'tool_use'));
  const main = uses((e) => !e.parent_tool_use_id);
  const sub = uses((e) => !!e.parent_tool_use_id);
  // Последний result: разведчик в фоне даёт ведущему ещё ход, первый result — «жду ответа».
  const result = ev.filter((e) => e.type === 'result').at(-1) ?? {};
  const asks = main.filter((u) => u.name === 'AskUserQuestion').map((u) => JSON.stringify(u.input ?? {})).join('\n');
  const agents = main.filter((u) => ['Agent', 'Task'].includes(u.name));
  const agentIds = new Set(agents.map((u) => u.id));
  const agentResults = ev.filter((e) => e.type === 'user').flatMap((e) => (e.message?.content ?? []))
    .filter((c) => c.type === 'tool_result' && agentIds.has(c.tool_use_id))
    .map((c) => (Array.isArray(c.content) ? c.content.map((x) => x.text ?? '').join('\n') : String(c.content ?? '')));
  return { main, sub, all: [...main, ...sub], result, answer: String(result.result ?? ''), asks, agents, agentResults,
    cost: Number(result.total_cost_usd ?? 0), ok: !!result.type && !result.is_error && String(result.result ?? '').length > 0 };
}

/** turns — потоки ходов (массивы строк), specAfter — была ли спека после каждого хода, changed — изменённое в ws. */
function grade(probe, turns, spec, specAfter, changed) {
  const t = turns.map(turnInfo);
  const all = t.flatMap((x) => x.all);
  const cmds = all.filter((u) => ['Bash', 'PowerShell'].includes(u.name)).map((u) => String(u.input?.command ?? ''));
  const marks = {};
  const t1 = t[0] ?? turnInfo([]);
  marks['ход 1: прогон состоялся'] = t1.ok;
  marks['ход 1: спеки нет'] = specAfter[0] === false;
  marks['ход 1: разведчик не запускался'] = t1.agents.length === 0;
  marks['git не запускал'] = !cmds.some((c) => /(^|[\s;&|(])git\s/.test(c));
  marks['в репах и вне спеки ничего не изменено'] = changed.every((f) => f === probe.spec);
  if (probe.id === 'bugfix') {
    marks['from-spec.md не открыт'] = !all.some(isFromSpec);
    marks['варианта «Глубокий поиск» нет'] = deepTargets(t1.answer + '\n' + t1.asks).length === 0;
    return { marks, t, spec };
  }
  const v1 = deepTargets(t1.answer + '\n' + t1.asks);
  marks['ход 1: from-spec.md прочитан'] = t1.main.some(isFromSpec);
  if (probe.id === 'deep-repairy-t1') {
    marks['ход 1: вариант у repairy-api'] = v1.includes('repairy-api');
    return { marks, t, spec };
  }
  if (probe.id === 'deep-repairy') {
    const t2r = t[1] ?? turnInfo([]);
    const promptsR = t2r.agents.map((u) => String(u.input?.prompt ?? ''));
    // Сверка на большой репе — окно с offset любой длины: несколько ссылок файла ведущий сверяет одним окном.
    const verify = (u) => u.name === 'Read' && inRepo(u.input?.file_path) && u.input?.offset != null;
    const secrets = repairySecrets();
    const statusR = /Статус готовности:\*\*\s*(Готово к разработке|Требуются уточнения \(\d+\))/.test(spec) && !/ПРОСТАВЛЯЕТСЯ/.test(spec);
    marks['ход 1: вариант у repairy-api'] = v1.includes('repairy-api');
    marks['ход 2: разведчик с Утверждение и Сервис repairy-api'] = promptsR.some((p) => /Утверждение:/.test(p) && /Сервис:\s*`?repairy-api/.test(p));
    marks['ход 2: бриф прочитан разведчиком'] = t2r.sub.some(isBrief);
    marks['ход 2: ссылки сверены ведущим'] = t2r.main.some(verify);
    marks['ход 2: ведущий код не читал'] = !t2r.main.some((u) => (u.name === 'Read' && inRepo(u.input?.file_path) && !verify(u)) || (u.name === 'Grep' && inRepo(u.input?.path)));
    marks['ход 2: пункты со ссылкой на код'] = /\.tsx?:\d+/.test(t2r.answer);
    marks['ход 2: вопрос «беру?»'] = /беру/i.test(t2r.answer + t2r.asks);
    marks['ход 2: спеки нет'] = specAfter[1] === false;
    marks['ход 2: секретов нет'] = ![t2r.answer, ...t2r.agentResults].some((x) => secrets.some((v) => x.includes(v)));
    marks['спека записана'] = spec.length > 0;
    marks['метка «по коду repairy-api»'] = /по\s+коду\s+`?repairy-api/i.test(spec);
    marks['ветка master в метке'] = /по\s+коду[^\n)]{0,60}master/i.test(spec);
    marks['нет ссылок файл:строка'] = !/[\w./-]+\.(tsx?|js|prisma|ya?ml|json):\d+/.test(spec);
    // Имена из карточки (WorkItem, NotificationQueue, ESTIMATE_CHANGED) законны; запрещены те, что есть только в коде.
    marks['нет имён из кода'] = !/works\.service|notifyProjectParticipants|logChange|isZero|\$transaction|serializeWork|loadWork|\.tsx?\b/.test(spec);
    marks['статус проставлен'] = statusR;
    return { marks, t, spec };
  }
  marks['ход 1: вариант у tool-rental'] = v1.includes('tool-rental');
  marks['ход 1: у customer-notify варианта нет'] = !v1.includes('customer-notify');
  const t2 = t[1] ?? turnInfo([]);
  const prompts = t2.agents.map((u) => String(u.input?.prompt ?? ''));
  marks['ход 2: разведчик с Утверждение и Сервис tool-rental'] = prompts.some((p) => /Утверждение:/.test(p) && /Сервис:\s*`?tool-rental/.test(p));
  marks['ход 2: бриф прочитан разведчиком'] = t2.sub.some(isBrief);
  const status = /Статус готовности:\*\*\s*(Готово к разработке|Требуются уточнения \(\d+\))/.test(spec) && !/ПРОСТАВЛЯЕТСЯ/.test(spec);
  // Края ревью 2026-10-25: «по коду» — только у принятого из кода; поправка аналитика и «не нашёл» — «не по коду».
  if (probe.id === 'deep-notfound') {
    marks['ход 2: аналитику сказано «не нашёл»'] = /не\s+нашёл|не\s+найден|в коде[^\n]{0,60}нет|нет[^\n]{0,30}в коде/i.test(t2.answer);
    marks['ход 2: спеки нет'] = specAfter[1] === false;
    marks['спека записана'] = spec.length > 0;
    marks['нет метки «по коду»'] = !/по\s+коду\s+`?tool-rental/i.test(spec);
    marks['статус проставлен'] = status;
    return { marks, t, spec };
  }
  if (probe.id === 'deep-otherwise') {
    marks['ход 2: вопрос «беру?»'] = /беру/i.test(t2.answer + t2.asks);
    marks['спека записана'] = spec.length > 0;
    marks['нет метки «по коду»'] = !/по\s+коду\s+`?tool-rental/i.test(spec);
    marks['слова аналитика в спеке'] = /раз\s+в\s+минуту|пачк/i.test(spec);
    marks['нет ссылок файл:строка'] = !/[\w./-]+\.(kt|kts|py|java|ya?ml):\d+/.test(spec);
    marks['статус проставлен'] = status;
    return { marks, t, spec };
  }
  marks['ход 2: ссылки сверены ведущим'] = t2.main.some(isVerify);
  marks['ход 2: ведущий код не читал'] = mainCode(t2).length === 0;
  marks['ход 2: пункты со ссылкой на код'] = /\.(kt|kts|py|ya?ml):\d+/.test(t2.answer);
  marks['ход 2: вопрос «беру?»'] = /беру/i.test(t2.answer + t2.asks);
  marks['ход 2: карточковое «внутри транзакции» текущим не названо'] = cardClaim(t2.answer);
  marks['ход 2: спеки нет'] = specAfter[1] === false;
  marks['ход 2: секретов нет'] = ![t2.answer, ...t2.agentResults].some((s) => SECRETS.some((x) => s.includes(x)));
  marks['спека записана'] = spec.length > 0;
  marks['метка «по коду tool-rental»'] = /по\s+коду\s+`?tool-rental/i.test(spec);
  marks['ветка develop в метке'] = /по\s+коду[^\n)]{0,60}develop/i.test(spec);
  marks['нет ссылок файл:строка'] = !/[\w./-]+\.(kt|kts|py|java|ya?ml):\d+/.test(spec);
  marks['нет имён из кода'] = !/RentalEventsPublisher|RentalReturned|RentalService|KafkaTemplate|AFTER_COMMIT|RENTAL_EVENTS_TOPIC|rental\.events-topic|application\.yml|\.kt\b/.test(spec);
  // п.2б PLAN-FROM-POCOCK (P2B=1): после «беру как в коде» поля события — контракт, они идут в спеку под 🔵 «по коду»;
  // имена реализации (классы, переменные окружения, ключи настроек) — по-прежнему нет (строка выше).
  if (P2B_ON) marks['п.2б: поля события из кода в спеке'] = ['rentalId', 'toolId', 'customerId', 'returnedAt', 'damaged', 'depositAmount'].filter((x) => spec.includes(x)).length >= 3;
  marks['«внутри транзакции» фактом нет'] = cardClaim(spec);
  marks['статус проставлен'] = /Статус готовности:\*\*\s*(Готово к разработке|Требуются уточнения \(\d+\))/.test(spec) && !/ПРОСТАВЛЯЕТСЯ/.test(spec);
  return { marks, t, spec };
}

// Оценщик на известных потоках: хороший проходит всё, плохой валится ровно там, где сломан.
function selftest() {
  const on = P2B_ON; P2B_ON = false;
  try { return selftestBody(); } finally { P2B_ON = on; }
}

function selftestBody() {
  const ev = (o) => JSON.stringify(o);
  const tool = (name, input, parent = null, id = 't' + Math.random()) => ev({ type: 'assistant', parent_tool_use_id: parent, message: { content: [{ type: 'tool_use', id, name, input }] } });
  const res = (text) => ev({ type: 'result', result: text, total_cost_usd: 0.05, num_turns: 6 });
  const fromSpec = tool('Read', { file_path: 'C:/t/ws/AI-SDD/.claude/skills/deep-search/reference/from-spec.md' });
  const pub = 'C:/t/ws/tool-rental/src/main/kotlin/ru/toolhire/rental/events/RentalEventsPublisher.kt';
  const [deep, bug] = PROBES;
  const q1 = ['Вопросы по тех-гейтам:', '3. Предполагаю: tool-rental публикует событие о возврате внутри транзакции возврата, ключ — rentalId. Верно?',
    '   - Да, так и есть', '   - Иначе — поправлю', '   - Не знаю, оставим к валидации', '   - Глубокий поиск — посмотреть в коде',
    '4. customer-notify уже отправляет push по идентификатору клиента — верно?', '   - Да, так и есть', '   - Не знаю, оставим к валидации'].join('\n');
  const a2 = ['- [в коде] событие уходит после коммита транзакции возврата — tool-rental/src/main/kotlin/ru/toolhire/rental/events/RentalEventsPublisher.kt:17',
    '- [в коде] ошибка отправки только пишется в лог — tool-rental/src/main/kotlin/ru/toolhire/rental/events/RentalEventsPublisher.kt:21',
    'Читал: tool-rental, ветка develop — локальная копия, могла отстать от удалённой.',
    'В карточке — внутри транзакции с откатом; в коде tool-rental иначе: после коммита, сбой отправки не досылается. Беру как в коде?'].join('\n');
  const specGood = ['> **Статус готовности:** Требуются уточнения (1)', '### INT-1. Сообщение о возврате → customer-notify — 🔵',
    '- **Происхождение:** 🔵 подтверждено аналитиком (по коду tool-rental, ветка develop; валидировать при интеграции)',
    'Сообщение о возврате уходит после фиксации возврата; сбой отправки не досылается — push не уйдёт.',
    'Сбой хранилища при обработке: транзакция откатывается, сообщение читается повторно.'].join('\n');
  const good = [
    [fromSpec, tool('Glob', { pattern: '*', path: 'C:/t/ws/tool-rental' }), res(q1)],
    [tool('Agent', { prompt: 'Ты — разведчик скилла deep-search.\nУтверждение: событие внутри транзакции\nКорень: C:/t/ws/AI-SDD\nСервис: tool-rental' }, null, 'A1'),
      tool('Read', { file_path: 'C:/t/ws/AI-SDD/.claude/skills/deep-search/reference/brief.md' }, 'A1'),
      tool('Read', { file_path: pub }, 'A1'),
      tool('Read', { file_path: pub, offset: 15, limit: 5 }), res(a2)],
    [res('Пишу спеку.')]];
  let fails = 0;
  const g = grade(deep, good, specGood, [false, false, true], [deep.spec]);
  for (const [k, v] of Object.entries(g.marks)) if (!v) { fails++; console.log('  ✗ хороший поток deep провалил: ' + k); }
  const q1bad = q1.replace('   - Глубокий поиск — посмотреть в коде\n', '') + '\n   - Глубокий поиск — посмотреть в коде customer-notify';
  const specBad = ['> **Статус готовности:** <ПРОСТАВЛЯЕТСЯ ПОСЛЕ ЗАПИСИ>',
    '- **Происхождение:** 🔵 подтверждено аналитиком (не по коду; валидировать при интеграции)',
    'RentalEventsPublisher шлёт событие (AFTER_COMMIT) — tool-rental/src/main/kotlin/ru/toolhire/rental/events/RentalEventsPublisher.kt:17',
    'Событие уходит внутри транзакции возврата: не ушло — возврат откатывается.'].join('\n');
  const bad = [
    [tool('Agent', { prompt: 'Вопрос: как уходит событие' }, null, 'A2'), res(q1bad)],
    [tool('Read', { file_path: pub }), tool('Grep', { pattern: 'kafka', path: 'C:/t/ws/tool-rental' }), tool('Bash', { command: 'git -C ../tool-rental log -1' }),
      res('Событие шлётся внутри транзакции, при ошибке возврат откатывается. Пароль Kx-local-Rent4l-2291.')],
    [res('Записал спеку.')]];
  const b = grade(deep, bad, specBad, [true, true, true], [deep.spec, 'tool-rental/build.gradle.kts']);
  const expectBad = ['ход 1: спеки нет', 'ход 1: разведчик не запускался', 'git не запускал', 'в репах и вне спеки ничего не изменено',
    'ход 1: from-spec.md прочитан', 'ход 1: вариант у tool-rental', 'ход 1: у customer-notify варианта нет',
    'ход 2: разведчик с Утверждение и Сервис tool-rental', 'ход 2: бриф прочитан разведчиком', 'ход 2: ссылки сверены ведущим',
    'ход 2: ведущий код не читал', 'ход 2: пункты со ссылкой на код', 'ход 2: вопрос «беру?»',
    'ход 2: карточковое «внутри транзакции» текущим не названо', 'ход 2: спеки нет', 'ход 2: секретов нет',
    'метка «по коду tool-rental»', 'ветка develop в метке', 'нет ссылок файл:строка', 'нет имён из кода',
    '«внутри транзакции» фактом нет', 'статус проставлен'];
  for (const k of expectBad) if (b.marks[k] !== false) { fails++; console.log('  ✗ плохой поток deep не пойман: ' + k); }
  const empty = grade(deep, good, '', [false, false, false], []);
  if (empty.marks['спека записана'] !== false) { fails++; console.log('  ✗ отсутствие спеки не поймано'); }
  const bg = grade(bug, [[tool('Read', { file_path: 'C:/t/ws/AI-SDD/coddoc/RNT-52/bug_report.md' }),
    res('Вопросы: испорчены ли записи залогов? Что рядом должно остаться прежним? Глубокого поиска в режиме нет.')]], '', [false], []);
  for (const [k, v] of Object.entries(bg.marks)) if (!v) { fails++; console.log('  ✗ хороший поток bugfix провалил: ' + k); }
  const bb = grade(bug, [[fromSpec, tool('Agent', { prompt: 'разведчик' }, null, 'A3'),
    res('2. Залог освобождается в deposit-service — верно?\n   - Да\n   - Глубокий поиск — посмотреть в коде deposit-service')]], 'x', [true], [bug.spec]);
  for (const k of ['ход 1: спеки нет', 'ход 1: разведчик не запускался', 'from-spec.md не открыт', 'варианта «Глубокий поиск» нет'])
    if (bb.marks[k] !== false) { fails++; console.log('  ✗ плохой поток bugfix не пойман: ' + k); }
  const prose = ['Рядом лежит код `tool-rental`, поэтому по нему доступен «глубокий поиск». Кода `customer-notify` рядом нет.',
    'Подтверждаете? Ещё вариант — «Глубокий поиск» по коду `tool-rental`: тогда пометка будет «по коду». По `customer-notify` кода рядом нет.'].join('\n');
  if (deepTargets(prose).join() !== 'tool-rental,tool-rental') { fails++; console.log('  ✗ вариант прозой отнесён не к тому сервису: ' + deepTargets(prose)); }
  if (deepTargets('Есть «Глубокий поиск» по коду customer-notify.').join() !== 'customer-notify') { fails++; console.log('  ✗ вариант у customer-notify прозой не пойман'); }
  const mentions = ['`customer-notify` — ваш сервис. Его репозитория рядом нет, поэтому глубокий поиск по нему недоступен.',
    'Глубокий поиск в багфиксе не используется.', 'Кода рядом нет, поэтому варианта «Глубокий поиск» не будет.'].join('\n');
  if (deepTargets(mentions).length !== 0) { fails++; console.log('  ✗ упоминание без варианта принято за вариант: ' + deepTargets(mentions)); }
  const r = replies();
  for (const f of ['replies.md', 'replies-otherwise.md', 'replies-nf.md', 'replies-r.md'])
    for (const k of ['ход 1', 'ход 2', 'ход 3', 'дальше']) if (!replies(f)[k]) { fails++; console.log(`  ✗ в ${f} нет блока «${k}»`); }
  const [, , ow, nf] = PROBES;
  const owBad = grade(ow, good, '> **Статус готовности:** Готово к разработке\n🔵 подтверждено аналитиком (по коду tool-rental, ветка develop)', [false, false, true], [ow.spec]);
  if (owBad.marks['нет метки «по коду»'] !== false || owBad.marks['слова аналитика в спеке'] !== false) { fails++; console.log('  ✗ поправка с меткой «по коду» не поймана'); }
  const owOk = grade(ow, good, '> **Статус готовности:** Готово к разработке\n🔵 подтверждено аналитиком (не по коду): сообщение уходит пачкой раз в минуту', [false, false, true], [ow.spec]);
  if (owOk.marks['нет метки «по коду»'] !== true || owOk.marks['слова аналитика в спеке'] !== true) { fails++; console.log('  ✗ верная поправка не засчитана'); }
  const nfT2 = [tool('Agent', { prompt: 'Утверждение: событие продления\nСервис: tool-rental' }, null, 'A9'),
    tool('Read', { file_path: 'C:/t/ws/AI-SDD/.claude/skills/deep-search/reference/brief.md' }, 'A9'), res('В коде tool-rental ответа не нашёл: события продления в коде нет.')];
  const nfOk = grade(nf, [good[0], nfT2, [res('Пишу спеку.')]], '> **Статус готовности:** Требуются уточнения (1)\n🔵 подтверждено аналитиком (не по коду)', [false, false, true], [nf.spec]);
  for (const [k, v] of Object.entries(nfOk.marks)) if (!v) { fails++; console.log('  ✗ хороший поток deep-notfound провалил: ' + k); }
  const rp = PROBES.find((p) => p.id === 'deep-repairy');
  const wsvc = 'C:/t/ws/repairy/apps/api/src/works/works.service.ts';
  const rGood = [
    [fromSpec, res('2. Предполагаю: «Изменена смета» уходит только при изменении стоимости (по карточке repairy-api). Верно?\n   - Да\n   - Иначе\n   - Не знаю\n   - Глубокий поиск — посмотреть в коде repairy-api')],
    [tool('Agent', { prompt: 'Утверждение: смета только при изменении стоимости\nСервис: repairy-api' }, null, 'R1'),
      tool('Read', { file_path: 'C:/t/ws/AI-SDD/.claude/skills/deep-search/reference/brief.md' }, 'R1'), tool('Read', { file_path: wsvc }, 'R1'),
      tool('Read', { file_path: wsvc, offset: 120, limit: 40 }), res('- [в коде] уведомление уходит при любой правке работы — apps/api/src/works/works.service.ts:143\nБеру как в коде?')],
    [res('Пишу спеку.')]];
  const rSpecGood = '> **Статус готовности:** Требуются уточнения (1)\n🔵 подтверждено аналитиком (по коду repairy-api, ветка master; валидировать при интеграции): сейчас уведомление уходит при любой правке работы (WorkItem).';
  const rg = grade(rp, rGood, rSpecGood, [false, false, true], [rp.spec]);
  for (const [k, v] of Object.entries(rg.marks)) if (!v) { fails++; console.log('  ✗ хороший поток deep-repairy провалил: ' + k); }
  const rt = PROBES.find((p) => p.id === 'deep-repairy-t1');
  const r1 = grade(rt, [rGood[0]], '', [false], []);
  for (const [k, v] of Object.entries(r1.marks)) if (!v) { fails++; console.log('  ✗ хороший ход 1 deep-repairy-t1 провалил: ' + k); }
  const r1b = grade(rt, [[res('Вопросы: карточка верна?\n   - Да\n   - Не знаю')]], '', [false], []);
  for (const k of ['ход 1: from-spec.md прочитан', 'ход 1: вариант у repairy-api'])
    if (r1b.marks[k] !== false) { fails++; console.log('  ✗ плохой ход 1 deep-repairy-t1 не пойман: ' + k); }
  const rb = grade(rp, [rGood[0], [tool('Read', { file_path: wsvc }), res('Смета уходит при любой правке.')], [res('ок')]],
    '> **Статус готовности:** <ПРОСТАВЛЯЕТСЯ>\n🔵 (не по коду): notifyProjectParticipants в works.service.ts:143', [false, true, true], [rp.spec]);
  for (const k of ['ход 2: разведчик с Утверждение и Сервис repairy-api', 'ход 2: ведущий код не читал', 'ход 2: ссылки сверены ведущим', 'ход 2: вопрос «беру?»',
    'ход 2: спеки нет', 'метка «по коду repairy-api»', 'ветка master в метке', 'нет ссылок файл:строка', 'нет имён из кода', 'статус проставлен'])
    if (rb.marks[k] !== false) { fails++; console.log('  ✗ плохой поток deep-repairy не пойман: ' + k); }
  console.log(fails ? `оценщик: провалов ${fails}` : 'оценщик: хорошие потоки — всё ✓, плохие — пойманы по каждой поломке');
  return fails;
}

// ---------------------------------------------------------------- прогоны

/** Один ход. `sid` — продолжение сессии прошлого хода (`--resume`); поток — в `out/<file>`. */
function runClaude(cwd, prompt, model, out, file, sid = null) {
  return new Promise((done) => {
    // MSYS_NO_PATHCONV: Git Bash переписывает аргумент, начатый с «/», в путь Windows.
    const resume = sid ? ' --resume "$PROBE_SID"' : '';
    const p = spawn('bash', ['-c', `claude -p "$PROBE_PROMPT"${resume} --model "$PROBE_MODEL" --permission-mode bypassPermissions --output-format stream-json --verbose`],
      { cwd, env: { ...process.env, PROBE_PROMPT: prompt, PROBE_MODEL: model, PROBE_SID: sid ?? '', MSYS_NO_PATHCONV: '1', MSYS2_ARG_CONV_EXCL: '*' },
        stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => p.kill(), 1_200_000);
    p.on('close', (code) => { clearTimeout(timer); writeFileSync(join(out, file), stdout); writeFileSync(join(out, `_stderr-${file}.log`), stderr); done(code); });
  });
}

const sessionId = (path) => readFileSync(path, 'utf8').split(/\r?\n/)
  .map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((e) => e?.session_id)?.session_id ?? null;
const streamName = (k) => `stream-${String(k).padStart(2, '0')}.jsonl`;

async function main() {
  if (process.argv[2] === '--selftest') process.exit(selftest() ? 1 : 0);
  if (process.argv[2] === '--regrade') return regrade(process.argv[3]);
  const round = process.argv[2];
  const n = Number(process.argv[3] ?? 1);
  const model = modelId(process.argv[4] ?? 'claude-sonnet-5');
  const only = process.argv[5] ? process.argv[5].split(',') : null;
  if (!round) throw new Error('нужно имя раунда');
  if (selftest()) throw new Error('оценщик не прошёл самопроверку — прогоны не запускаю');

  const roundDir = join(here, 'runs', round);
  for (const s of SKILLS) {
    const snap = join(roundDir, '_skills', s);
    if (!existsSync(snap)) cpSync(resolve(here, '..', s), snap, { recursive: true });
  }
  const boxRoot = join(tmpdir(), 'spec-deep-probes', round);
  rmSync(boxRoot, { recursive: true, force: true });
  const probes = PROBES.filter((p) => !only || only.includes(p.id));
  const jobs = [];
  for (const probe of probes) for (let i = 1; i <= n; i++) jobs.push({ probe, i });
  const queue = [...jobs];
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const tag = `${job.probe.id}/run-${String(job.i).padStart(2, '0')}`;
      const out = join(roundDir, tag);
      mkdirSync(out, { recursive: true });
      const ws = seed(join(boxRoot, tag), job.probe.overlays, job.probe.base);
      const r = replies(job.probe.replies);
      const cwd = join(ws, 'AI-SDD');
      for (const s of SKILLS) for (const where of ['.claude/skills', '.gigacode/skills']) cpSync(join(roundDir, '_skills', s), join(cwd, ...where.split('/'), s), { recursive: true });
      const before = snapshot(ws);
      const t0 = Date.now();
      const msgs = job.probe.turns(r);
      const specAfter = [];
      let sid = null, code = null;
      for (let k = 1; k <= (job.probe.next ? MAX_TURNS : msgs.length); k++) {
        const msg = k === 1 ? wrap(norm(cwd), msgs[0]) : (msgs[k - 1] ?? job.probe.next(r));
        code = await runClaude(cwd, msg, model, out, streamName(k), sid);
        sid = sid ?? sessionId(join(out, streamName(k)));
        specAfter.push(existsSync(join(ws, job.probe.spec)));
        if (code !== 0 || !sid || (k >= msgs.length && specAfter.at(-1))) break;
      }
      const changed = diffSnap(before, snapshot(ws));
      if (existsSync(join(ws, job.probe.spec))) cpSync(join(ws, job.probe.spec), join(out, 'spec.md'));
      job.ms = Date.now() - t0;
      writeFileSync(join(out, 'turns.json'), JSON.stringify({ specAfter, changed, code, ms: job.ms }, null, 2));
      console.log(`прогон ${tag}: код ${code}, ходов ${specAfter.length}, ${Math.round(job.ms / 1000)} с`);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  writeReport(roundDir, `раунд ${round} · модель ${model} · прогонов на пробу ${n}`, probes);
}

function regrade(round) {
  if (selftest()) throw new Error('оценщик не прошёл самопроверку');
  const roundDir = join(here, 'runs', round);
  writeReport(roundDir, `раунд ${round} · перегрейд`, PROBES.filter((p) => existsSync(join(roundDir, p.id))));
}

/** Отчёт по папкам прогонов раунда: потоки ходов, `turns.json`, `spec.md`. */
function writeReport(roundDir, head, probes) {
  const report = [`${head} · ${new Date().toISOString()}`, ''];
  let cost = 0;
  for (const probe of probes) {
    report.push(`## ${probe.id}`);
    const pdir = join(roundDir, probe.id);
    for (const run of readdirSync(pdir).filter((d) => /^run-\d+$/.test(d)).sort()) {
      const out = join(pdir, run);
      const meta = JSON.parse(readFileSync(join(out, 'turns.json'), 'utf8'));
      const turns = meta.specAfter.map((_, k) => {
        const f = join(out, streamName(k + 1));
        return existsSync(f) ? readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean) : [];
      });
      const spec = existsSync(join(out, 'spec.md')) ? readFileSync(join(out, 'spec.md'), 'utf8') : '';
      const g = grade(probe, turns, spec, meta.specAfter, meta.changed);
      // Ходы идут `--resume`, `total_cost_usd` накопительный: цена прогона — максимум, не сумма ходов.
      const c = Math.max(0, ...g.t.map((x) => x.cost));
      cost += c;
      const bad = Object.entries(g.marks).filter(([, v]) => !v).map(([k]) => k);
      report.push(`${run}: ${bad.length ? '✗ ' + bad.join(', ') : '✓ всё'} · $${c.toFixed(3)} · ходов ${turns.length} · разведчиков ${g.t.reduce((s, x) => s + x.agents.length, 0)} · ${Math.round(meta.ms / 1000)} с`);
      if (meta.changed.length) report.push(`  изменено: ${meta.changed.join(', ')}`);
      g.t.forEach((x, k) => {
        writeFileSync(join(out, `answer-${String(k + 1).padStart(2, '0')}.md`), x.answer);
        report.push(`  ход ${k + 1}: ${x.answer.replace(/\s+/g, ' ').slice(0, 600)}`);
      });
      for (const l of spec.split('\n').filter((l) => /🔵|по коду|Статус готовности/.test(l)).slice(0, 12)) report.push(`  спека: ${l.slice(0, 300)}`);
    }
    report.push('');
  }
  report.push(`итого: $${cost.toFixed(2)}`);
  writeFileSync(join(roundDir, 'GRADE-REPORT.txt'), report.join('\n') + '\n');
  console.log('\n' + report.join('\n'));
}

main().catch((e) => { console.error(e); process.exit(1); });
