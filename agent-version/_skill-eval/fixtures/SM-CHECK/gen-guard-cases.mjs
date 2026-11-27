// Генерирует случаи cases/guard-* (границы формулы гарда). Файлы карточек собираются циклом,
// а ОЖИДАЕМЫЕ числа записаны литералами руками (из формулы SKILL.md «Гард на утоньшение»),
// а не вычислены — иначе случай проверял бы сам себя.
//   node gen-guard-cases.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const pad = (i) => String(i).padStart(2, '0');
const NATO = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India'];

const contract = (prefix, ids, body = true) =>
  '## Публичный контракт\n\n' + ids.map((i) => `### \`GET ${prefix}/i${pad(i)}\`\nНазначение.\n${body ? `- поле \`f${pad(i)}\`\n` : ''}`).join('\n');
const opisContract = (prefix, ids) => ids.map((i) => `GET ${prefix}/i${pad(i)} — api/items.ts`).join('\n') + '\n';
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, k) => a + k);
const entities = (spec) =>
  '## Владеет данными\n\n' + spec.map(([n, body]) => `### \`${n}\`\nСущность.\n${body ? '- `id`: `string`\n' : '— только строка семантики, не тело\n'}`).join('\n');
const table = (title, head, rows) => `## ${title}\n| ${head.join(' | ')} |\n|${head.map(() => '---').join('|')}|\n` + rows.map((r) => `| ${r.join(' | ')} |`).join('\n') + '\n';
const DR0 = { 'сущности': [0, 0, 0], 'задачи': [0, 0, 0], 'топики': [0, 0, 0], 'бизнес': [0, 0, 0] };

// [имя, о чём, prev, draft, opis, expect(без «о чём»)]
const cases = [];
const contractCase = (name, about, was, keep, guard, fired, route) => {
  cases.push([name, about,
    '# items — backend\n\n' + contract('/v1/items', range(1, was)),
    '# items — backend\n\n' + contract('/v1/items', range(1, keep)),
    opisContract('/v1/items', range(1, keep)),
    { 'черновик': { 'контракт': [keep, keep, 0], ...DR0, 'таблицы': [0, 0, 0, 0] },
      'опись': { 'ключей': keep, 'бизнес': [0, 0, 0], 'без файла': 0, 'итоги': [] },
      'сверка': { 'нет в черновике': 0, 'нет в описи': 0, 'факт, пустой блок': 0, 'по классам': { 'контракт': keep }, 'групп': 1 },
      'гард': { 'контракт': guard }, 'сработал': fired, 'маршрут': route }]);
};
contractCase('guard-3of4', 'исчезло 3 из 4: 3 ≥ 3 и 9 > 4 → _pending', 4, 1, [4, 3, 0, 0], ['контракт'], 'В _pending');
contractCase('guard-3of9', 'исчезло 3 из 9: 9 > 9 ложно (строгое неравенство) → поверх', 9, 6, [9, 3, 0, 0], [], 'ПОВЕРХ');
contractCase('guard-3of10', 'исчезло 3 из 10: 9 > 10 ложно → поверх', 10, 7, [10, 3, 0, 0], [], 'ПОВЕРХ');
contractCase('guard-33of48', 'исчезло 33 из 48: 99 > 48 → _pending; список исчезнувших 33 < 40 — без обрезки', 48, 15, [48, 33, 0, 0], ['контракт'], 'В _pending');
contractCase('guard-1of2', 'исчезло 1 из 2: 1 < 3 → поверх', 2, 1, [2, 1, 0, 0], [], 'ПОВЕРХ');
contractCase('guard-2of89', 'исчезло 2 из 89: 2 < 3 → поверх', 89, 87, [89, 2, 0, 0], [], 'ПОВЕРХ');

cases.push(['guard-rename', 'весь контракт сменил префикс /v1/items → /v2/goods: исчезло 45 = появилось 45 → _pending; списки обрезаны на 40 («…и ещё 5»)',
  '# items — backend\n\n' + contract('/v1/items', range(1, 45)),
  '# items — backend\n\n' + contract('/v2/goods', range(1, 45)),
  opisContract('/v2/goods', range(1, 45)),
  { 'черновик': { 'контракт': [45, 45, 0], ...DR0, 'таблицы': [0, 0, 0, 0] },
    'опись': { 'ключей': 45, 'бизнес': [0, 0, 0], 'без файла': 0, 'итоги': [] },
    'сверка': { 'нет в черновике': 0, 'нет в описи': 0, 'факт, пустой блок': 0, 'по классам': { 'контракт': 45 }, 'групп': 1 },
    'гард': { 'контракт': [45, 45, 45, 0] }, 'сработал': ['контракт'], 'маршрут': 'В _pending' }]);

cases.push(['guard-emptied-3of5', 'опустело 3 из 5 (Echo был пуст и остался пуст — не считается): 9 > 5 → _pending',
  '# e — backend\n\n' + entities([['Alpha', 1], ['Bravo', 1], ['Charlie', 1], ['Delta', 1], ['Echo', 0]]),
  '# e — backend\n\n' + entities([['Alpha', 0], ['Bravo', 0], ['Charlie', 0], ['Delta', 1], ['Echo', 0]]),
  NATO.slice(0, 5).map((n) => `${n} — domain/${n}.kt (@Entity)`).join('\n') + '\n',
  { 'черновик': { 'контракт': [0, 0, 0], ...DR0, 'сущности': [5, 1, 4], 'таблицы': [0, 0, 0, 0] },
    'опись': { 'ключей': 5, 'бизнес': [0, 0, 0], 'без файла': 0, 'итоги': [] },
    'сверка': { 'нет в черновике': 0, 'нет в описи': 0, 'факт, пустой блок': 0, 'по классам': { 'сущности': 5 }, 'групп': 0 },
    'гард': { 'сущности': [5, 0, 0, 3] }, 'сработал': ['сущности'], 'маршрут': 'В _pending' }]);

cases.push(['guard-emptied-3of9', 'опустело 3 из 9: 9 > 9 ложно → поверх (India был пуст, стал с телом — не опустел)',
  '# e — backend\n\n' + entities(NATO.map((n, i) => [n, i < 8 ? 1 : 0])),
  '# e — backend\n\n' + entities(NATO.map((n, i) => [n, i < 3 ? 0 : 1])),
  NATO.map((n) => `${n} — domain/${n}.kt (@Entity)`).join('\n') + '\n',
  { 'черновик': { 'контракт': [0, 0, 0], ...DR0, 'сущности': [9, 6, 3], 'таблицы': [0, 0, 0, 0] },
    'опись': { 'ключей': 9, 'бизнес': [0, 0, 0], 'без файла': 0, 'итоги': [] },
    'сверка': { 'нет в черновике': 0, 'нет в описи': 0, 'факт, пустой блок': 0, 'по классам': { 'сущности': 9 }, 'групп': 0 },
    'гард': { 'сущности': [9, 0, 0, 3] }, 'сработал': [], 'маршрут': 'ПОВЕРХ' }]);

const API = ['Сервис', 'Вызов', 'Зачем'];
cases.push(['guard-api-same-call', 'потребляемые API: ключ — сервис + вызов. Три сервиса с одинаковым `GET /v1/x` исчезли: 3 из 5 → _pending (по одному вызову было бы 0 из 2 → поверх)',
  '# w — frontend\n\n' + table('Потребляемые API', API, [['`svc-a`', '`GET /v1/x`', 'a'], ['`svc-b`', '`GET /v1/x`', 'b'], ['`svc-c`', '`GET /v1/x`', 'c'], ['`svc-d`', '`GET /v1/x`', 'd'], ['`svc-e`', '`GET /v1/y`', 'e']]),
  '# w — frontend\n\n' + table('Потребляемые API', API, [['`svc-a`', '`GET /v1/x`', 'a'], ['`svc-e`', '`GET /v1/y`', 'e']]),
  'GET /v1/x — src/api.ts\nGET /v1/y — src/api.ts\n',
  { 'черновик': { 'контракт': [0, 0, 0], ...DR0, 'таблицы': [0, 0, 0, 2] },
    'опись': { 'ключей': 2, 'бизнес': [0, 0, 0], 'без файла': 0, 'итоги': [] },
    'сверка': { 'нет в черновике': 0, 'нет в описи': 0, 'факт, пустой блок': 0, 'по классам': { 'потребляет': 2 }, 'групп': 0 },
    'гард': { 'потребляемые API': [5, 3, 0, 0] }, 'сработал': ['потребляемые API'], 'маршрут': 'В _pending' }]);

const ROLE = ['Роль', 'Что может'];
const DEP = ['Сервис или система', 'Зачем'];
cases.push(['guard-mixed', 'табличный класс: роли 3 из 4 → _pending; топики (направление — часть ключа) 1 из 2, задачи переименованы 1/1, зависит от +1 — не срабатывают',
  '# m — backend\n\n## События\n\n### потребляет `a.created`\n- группа `g`\n\n### публикует `a.created`\n- ключ `id`\n\n## Фоновые задачи\n\n### `flush`\n- раз в минуту\n\n'
    + table('Зависит от', DEP, [['`x`', 'x'], ['`y`', 'y']]) + '\n' + table('Роли и доступ', ROLE, [['`OWNER`', 'всё'], ['`ADMIN`', 'а'], ['`AUDITOR`', 'б'], ['`GUEST`', 'в']]),
  '# m — backend\n\n## События\n\n### потребляет `a.created`\n- группа `g`\n\n## Фоновые задачи\n\n### `Queue.flush`\n- раз в минуту\n\n'
    + table('Зависит от', DEP, [['`x`', 'x'], ['`y`', 'y'], ['`z`', 'z']]) + '\n' + table('Роли и доступ', ROLE, [['`OWNER`', 'всё']]),
  'потребляет a.created — src/c.ts\nQueue.flush — src/q.ts\nOWNER — src/roles.ts\n',
  { 'черновик': { 'контракт': [0, 0, 0], 'сущности': [0, 0, 0], 'задачи': [1, 1, 0], 'топики': [1, 1, 0], 'бизнес': [0, 0, 0], 'таблицы': [0, 1, 3, 0] },
    'опись': { 'ключей': 3, 'бизнес': [0, 0, 0], 'без файла': 0, 'итоги': [] },
    'сверка': { 'нет в черновике': 0, 'нет в описи': 0, 'факт, пустой блок': 0, 'по классам': { 'топики': 1, 'задачи': 1, 'роли': 1 }, 'групп': 2 },
    'гард': { 'топики': [2, 1, 0, 0], 'задачи': [1, 1, 1, 0], 'роли': [4, 3, 0, 0], 'зависит от': [2, 0, 1, 0] }, 'сработал': ['роли'], 'маршрут': 'В _pending' }]);

for (const [name, about, prev, draft, opis, expect] of cases) {
  const dir = path.join(HERE, 'cases', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'prev.md'), prev);
  fs.writeFileSync(path.join(dir, 'draft.md'), draft);
  fs.writeFileSync(path.join(dir, 'opis.md'), opis);
  fs.writeFileSync(path.join(dir, 'expect.json'), JSON.stringify({ 'о чём': about, ...expect }, null, 1) + '\n');
}
console.log(`записано случаев: ${cases.length}`);
