// Фикстуры to-html: генерируются, а не лежат в git — CRLF, BOM, cp1251 и картинки нормализация git
// портит, а большие файлы (журнал на мегабайты, папка на 2100 файлов) в репозитории не нужны.
//
//   import { makeFixtures } from './to-html-fixtures.mjs';
//   makeFixtures(dir)  // → TH-DOCS, TH-VAULT, TH-NB, TH-EDGE, TH-ONE, TH-IMG, TH-TASK внутри dir
//
// Самотест упаковщика (selftest-to-html-pack.mjs) и e2e страницы берут фикстуры отсюда; самотест полноты
// «Обзора» (to-html-e2e/overview-coverage.mjs) — задачу TH-TASK (makeTaskFixture).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { deflateSync } from 'node:zlib';

function crc32(buf) {
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    let c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

// Настоящий PNG градиентом; seed меняет цвет, чтобы картинки различались байтами.
export function png(w, h, seed = 0) {
  const row = w * 3 + 1;
  const raw = Buffer.alloc(row * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = y * row + 1 + x * 3;
      raw[o] = (59 + seed * 37 + Math.round((x / w) * 120)) & 0xff;
      raw[o + 1] = (91 + Math.round((y / h) * 100)) & 0xff;
      raw[o + 2] = 219;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

function put(root, rel, body) {
  const p = join(root, ...rel.split('/'));
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, typeof body === 'string' ? Buffer.from(body, 'utf8') : body);
}

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60"><rect width="120" height="60" rx="8" fill="#3b5bdb"/><text x="16" y="36" fill="#fff" font-size="16">стенд</text></svg>\n';

// Журнал заметок: дни месяцами, ссылки [[…]], вставки ![[…]], плашки. size — примерный размер в байтах.
export function journal(size) {
  const parts = ['---\nсоздан: 2025-01-03\nтеги: журнал, дом\n---\n# Журнал\n'];
  let bytes = 0;
  const d = new Date(Date.UTC(2026, 9, 20));
  let month = -1;
  while (bytes < size) {
    if (d.getUTCMonth() !== month) {
      month = d.getUTCMonth();
      parts.push(`\n## ${d.toISOString().slice(0, 7)}\n`);
    }
    const day = `\n### ${d.toISOString().slice(0, 10)}\n` +
      '- Созвонились с бригадой по [[Ремонт кухни]]: начинают 3 ноября, сначала электрика.\n' +
      '- Бюджет — в [[Ремонт кухни#Бюджет|смете ремонта]], билеты — в [[Поездка в Казань]].\n' +
      '- Бригадир прислал разметку розеток:\n\n![[разметка-розеток.jpg]]\n\n' +
      '> [!warning] Важно\n> Перед началом работ снять показания счётчиков.\n';
    parts.push(day);
    bytes += Buffer.byteLength(day);
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return parts.join('');
}

export function makeFixtures(dir) {
  // ---- TH-DOCS: произвольная документация
  const docs = join(dir, 'TH-DOCS');
  put(docs, 'README.md', '# Справочник команды\n\nКак устроен сервис — [архитектура](architecture.md), ' +
    'релиз — [Релиз](%D0%BF%D1%80%D0%BE%D1%86%D0%B5%D1%81%D1%81%D1%8B/release.md), дежурства — [[Дежурства]].\n' +
    'Стенд — [infra](../infra/README.md).\n');
  put(docs, 'architecture.md', '# Как устроен сервис заказов\n\n> [!note]\n> Документ живой.\n\n## 1. Коротко\n\n' +
    'См. [словарь](glossary.md#заказ).\n\n## 2. Как идёт заказ\n\n```mermaid\nsequenceDiagram\n  web->>orders-api: POST /orders\n```\n\n' +
    '## 3. API\n\n| Поле | Тип |\n|---|---|\n| items | array |\n\n```json\n{ "items": [{ "sku": "A-1042", "qty": 2 }] }\n```\n\n![стенд](img/стенд.png)\n');
  put(docs, 'glossary.md', '# Словарь\n\n## Заказ\n\nТовары, окно доставки и цена.\n');
  put(docs, 'deploy.puml', '@startuml\nnode web\nnode api\nweb --> api\n@enduml\n');
  put(docs, 'схемы.md', '# Схемы\n\n## Рабочая\n\n```mermaid\nflowchart LR\n  A[Заказ] --> B{Есть на складе?}\n  B -->|да| C[Собрать]\n  B -->|нет| D[Отказ]\n```\n\n' +
    '## Сломанная\n\n```mermaid\nflowchart LR\n  A[Заказ] --> -->\n```\n\nТекст после сломанной схемы.\n');
  put(docs, 'поток.mmd', 'sequenceDiagram\n  participant W as web\n  participant A as orders-api\n  W->>A: GET /orders/1\n  A-->>W: 200\n');
  put(docs, 'процессы/release.md', '# Релиз\n\n1. Собрать.\n2. Выкатить.\n');
  put(docs, 'процессы/Дежурства.md', '# Дежурства\n\nГрафик — в [регламенте](../регламент-дежурств.pdf).\n');
  put(docs, '_foundation/context.md', '# Контекст\n');
  put(docs, 'img/стенд.png', png(160, 80, 1));
  put(docs, 'img/схема.svg', SVG);
  put(docs, 'регламент-дежурств.pdf', Buffer.from('%PDF-1.4\n% to-html fixture\n'));
  put(docs, '.hidden/secret.md', '# не показывать\n');
  put(docs, 'node_modules/pkg/readme.md', '# не показывать\n');

  // ---- TH-VAULT: заметки в духе Obsidian
  const vault = join(dir, 'TH-VAULT');
  put(vault, 'Журнал.md', journal(200 * 1024));
  put(vault, 'Проекты/Ремонт кухни.md', '# Ремонт кухни\n\n## Бюджет\n\nСмета — ![[смета.xlsx]].\n');
  put(vault, 'Проекты/Поездка в Казань.md', '# Поездка в Казань\n\n## Билеты\n\nВ среду дешевле. Гостиница — [[Нет такой заметки]].\n');
  put(vault, 'вложения/разметка-розеток.jpg', png(240, 120, 2));
  put(vault, 'вложения/план кухни.png', png(200, 140, 3));
  put(vault, 'вложения/смета.xlsx', Buffer.from('PK\x03\x04 to-html fixture'));
  put(vault, '.obsidian/workspace.json', '{"не":"показывать"}\n');

  // ---- TH-NB: ноут аналитика
  const nb = join(dir, 'TH-NB', 'notes', 'выдача-лодок');
  put(nb, 'notebook.md', '---\nтема: выдача лодок\nключ: —\nо чём: выдача лодок по брони\nроли: —\n---\n# Ноут: выдача лодок\n\n' +
    '## 2026-10-14\n\n### 1 · чат с Лавровой Е.\n- [решено] Лодку выдаёт смотритель причала — решил: Лаврова Е. · 2026-10-14 №1.1\n' +
    '- [открыто] Нужна ли отметка об инструктаже · 2026-10-14 №1.2 ‖ закрыт: 2026-10-16 №1.1\n\n' +
    '## 2026-10-16\n\n### 1 · письмо Шубина Д.\n- [решено] Отметка не нужна; отвечает на: 2026-10-14 №1.2 · 2026-10-16 №1.1\n' +
    '> исходник: sources/2026-10-16-1.md\n');
  put(nb, 'sources/2026-10-16-1.md', 'Здравствуйте! Отметка об инструктаже не нужна.\n');
  put(nb, 'notebook-2026-10-17.points.md', '# Пункты\n\n- [решено] Лодку выдаёт смотритель · 2026-10-14 №1.1\n');
  put(nb, 'сводка-решений-2026-10-17.md', '# Сводка\n\n- смотритель выдаёт лодку · 2026-10-14 №1.1\n');

  // ---- TH-EDGE: байты, которые легко испортить
  const edge = join(dir, 'TH-EDGE');
  put(edge, 'crlf.md', Buffer.from('# CRLF\r\n\r\nстрока\r\n', 'utf8'));
  put(edge, 'bom.md', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('# BOM\n', 'utf8')]));
  put(edge, 'cp1251.md', Buffer.from([0x23, 0x20, 0xcb, 0xee, 0xe4, 0xea, 0xe0, 0x0a])); // «# Лодка» в cp1251
  put(edge, 'пустой.md', Buffer.alloc(0));
  put(edge, 'html.md', '# HTML\n\n<details><summary>ещё</summary>\n\n*внутри*\n\n</details>\n<script>alert(1)</script>\n\n' +
    'Строка с <img src="нет" onerror="alert(2)"> внутри.\n');
  put(edge, 'шапка.md', '---\nтема: проба\nключ: X-1\n---\n# Заголовок\n');
  put(edge, 'имя с пробелом.md', '# пробел\n');
  put(edge, 'решётка#и%процент.md', '# решётка\n');
  put(edge, 'Заглавные.MD', '# заглавные буквы в расширении\n');
  put(edge, 'big.md', Buffer.alloc(5 * 1024 * 1024 + 1, 0x61)); // больше предела текста — без содержимого
  put(edge, 'огромная.png', Buffer.concat([png(4, 4, 4), Buffer.alloc(15 * 1024 * 1024 + 1)])); // больше предела картинки
  put(edge, 'малая.png', png(8, 8, 5));

  // ---- TH-ONE: файл в папке больше предела → режим «файл и его ссылки»
  const one = join(dir, 'TH-ONE', 'проект');
  put(one, 'заметка.md', '# Заметка\n\n[связанный](a/связанный.md), [[второй]], [внешний](https://example.com), ' +
    '[якорь](#x), [нет](нет.md), [с пробелом](<a/с пробелом.md>)\n');
  put(one, 'a/связанный.md', '# Связанный\n\n[третий](../b/третий.md)\n');
  put(one, 'a/с пробелом.md', '# с пробелом\n');
  put(one, 'b/третий.md', '# Третий\n\n[четвёртый](../c/четвёртый.md)\n');
  put(one, 'c/четвёртый.md', '# Четвёртый — уже не попадает\n');
  put(one, 'd/e/второй.md', '# Второй\n');
  for (let i = 0; i < 2100; i++) put(one, `мусор/${String(i).padStart(4, '0')}.txt`, `файл ${i}\n`);

  // ---- TH-IMG: папка без текстовых файлов
  put(join(dir, 'TH-IMG'), 'только.png', png(10, 10, 6));

  makeTaskFixture(dir);
}

// ---- TH-TASK: задача coddoc/PRK-31 — БТ и спека со схемами, картинками и ссылками. Пути картинок и ссылок
// считаются от документа, а не от страницы. БТ: §1.1 — и в «Обзоре», и на слайде «Проблема»; §6 — в «Обзоре»
// обычной карточкой, слайда нет. Спека: схема в «Поведении» INT-1 — в «Обзоре» и на слайде INT-1; картинка
// и ссылка — в тексте над INT.
export function makeTaskFixture(dir) {
  const task = join(dir, 'TH-TASK', 'coddoc', 'PRK-31');
  put(task, 'business_requirements.md', [
    '# Бизнес-требования: фото машины в заявке на парковку',
    '',
    '> **Статус готовности:** Готово к оценке',
    '> **Задача:** PRK-31',
    '',
    '## 1. Введение и контекст',
    '',
    '### 1.0. Тип изменения',
    'Новое поле в существующей форме заявки на пропуск.',
    '',
    '### 1.1. Описание проблемы (Problem Statement)',
    'Охрана сверяет машину на въезде с описанием в заявке, а описание бывает неточным. Как идёт заявка сейчас:',
    '',
    '```mermaid',
    'flowchart LR',
    '  req[Заявка на пропуск] --> guard{Охрана сверяет}',
    '  guard -->|похоже| gate[Шлагбаум открыт]',
    '  guard -->|не похоже| call[Звонок владельцу]',
    '```',
    '',
    'Стоянка утром — ![стоянка утром](img/parking-lot.png). Как это решается — в [спецификации](technical_specification.md).',
    'Разметка мест:',
    '',
    '![[разметка-мест.png]]',
    '',
    'Правила въезда — на [портале охраны](https://example.com/guard/rules).',
    '',
    '### 1.2. Конечные потребители (End Users)',
    'Сотрудники с машиной и охрана на въезде.',
    '',
    '### 1.3. Заказчик и стейкхолдеры (Stakeholder / Sponsor)',
    'Заказчик — служба безопасности.',
    '',
    '## 2. Бизнес-требования (цели и ценность)',
    '',
    '### 2.1. Бизнес-цель',
    'Я как охранник хочу видеть фото машины в заявке, чтобы не звонить владельцу на каждом въезде.',
    '',
    '### 2.2. Ценность для бизнеса',
    'Очередь на въезде утром короче на пять минут.',
    '',
    '## 3. Объём проекта (Scope)',
    '',
    '### 3.1. Входит в проект (In-scope)',
    'Фото машины в заявке и на экране охраны.',
    '',
    '### 3.2. Не входит в проект (Out-of-scope)',
    'Распознавание номеров.',
    '',
    '## 4. Функциональные требования',
    '',
    '### 4.1. Описание функционала / бизнес-процесса',
    '- **FR-1.** К заявке на пропуск можно приложить фото машины, охрана видит его на экране въезда.',
    '',
    '### 4.2. Критерии приёмки (Acceptance Criteria)',
    '- **[FR-1]** Дано: заявка с фото машины. Когда: машина подъезжает к въезду. Тогда: охрана видит фото на экране.',
    '',
    '## 5. Ограничения и атрибуты качества',
    '',
    '### 5.1. Приоритет',
    'Средний.',
    '',
    '## 6. Приложения (опционально)',
    'Стоянка по зонам:',
    '',
    '```mermaid',
    'flowchart TB',
    '  staff[Зона А — сотрудники] --- guests[Зона Б — гости]',
    '```',
    '',
    'Въезд — ![въезд](img/entrance.png); разметка — ![[разметка-мест.png]]. Контракт загрузки — в [спецификации](technical_specification.md),',
    'регламент пропусков — [на сайте](https://example.com/parking/policy).',
    '',
  ].join('\n'));
  put(task, 'technical_specification.md', [
    '# Техническая спецификация: фото машины в заявке на парковку',
    '',
    '> **Статус готовности:** Готово к разработке',
    '> **Задача:** PRK-31',
    '',
    '## 1. Обзор изменения',
    '',
    '### 1.1. Тип и стороны',
    'Fullstack. `parking-web` даёт приложить фото к заявке, `parking-api` хранит его рядом с заявкой.',
    '',
    '### 1.2. Затронутые сервисы и владельцы',
    '',
    '| Сервис | Роль в задаче | Владелец/команда | Происхождение |',
    '|---|---|---|---|',
    '| `parking-api` | приём и выдача фото | Парковка | 🟢 |',
    '| `parking-web` | форма заявки и экран охраны | Фронт | 🟢 |',
    '',
    '## 2. Взаимодействия (ядро)',
    '',
    'Зачем фото охране — в [бизнес-требованиях](business_requirements.md). Экран охраны:',
    '',
    '![экран охраны](img/guard-screen.png)',
    '',
    '### INT-1. Загрузка фото машины — 🟢',
    '- **Граница/направление:** FE → BE',
    '- **Триггер:** сотрудник прикладывает фото в форме заявки',
    '- **Контракт (запрос):** `POST /v1/passes/{id}/photo`, тело — `image/jpeg` до 5 МБ',
    '- **Контракт (ответ):** `201`, `photoId: string`',
    '- **Поведение:** фото хранится рядом с заявкой, охрана видит его на экране въезда.',
    '  ```mermaid',
    '  sequenceDiagram',
    '    participant W as parking-web',
    '    participant A as parking-api',
    '    W->>A: POST /v1/passes/42/photo',
    '    A-->>W: 201 photoId',
    '  ```',
    '- **Ошибки:** `413` — файл больше 5 МБ; `415` — не jpeg',
    '- **Авторизация:** автор заявки',
    '- **Происхождение:** 🟢',
    '- **Трассировка:** FR-1',
    '',
    '## 7. Трассировка',
    '',
    '| FR | Взаимодействия | Тест |',
    '|---|---|---|',
    '| FR-1 | INT-1 | Дано: заявка без фото, когда: сотрудник прикладывает фото, тогда: охрана видит фото на экране въезда |',
    '',
  ].join('\n'));
  put(task, 'img/parking-lot.png', png(160, 90, 7));
  put(task, 'img/entrance.png', png(120, 80, 8));
  put(task, 'img/разметка-мест.png', png(140, 70, 9));
  put(task, 'img/guard-screen.png', png(180, 100, 10));
}
