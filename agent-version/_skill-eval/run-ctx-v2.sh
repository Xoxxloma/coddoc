#!/usr/bin/env bash
# run-ctx-v2.sh — КОПИЯ 2026-09-23 (собрана make-v2-runners.mjs): пул run-pool-ctx-v2.sh (промпт инлайн),
# засев в /tmp/skill-eval-seedsrc — не соседом снимка скилла: прогон листает родителя пути к снимку.
# run-ctx.sh — пул прогонов одной пробы петли 5.0 через `claude -p` (Haiku).
#
#   ./run-ctx.sh <проба> <папка-раунда> <N> [параллельность]
#
# Заменяет связку `setup-ctx-runs.mjs` + ручной запуск субагентов. Причины ровно две, и обе
# из разбора раундов 2026-08-13/14:
#
# 1. **Снимок скилла обязателен и делается ЗДЕСЬ.** Прежняя раскладка писала в `runs.json` путь
#    к ЖИВОМУ `SKILL.md`; файл правится между раундами и не коммитится, поэтому текст, которым
#    получены числа, переставал существовать в момент следующей правки. Снимок кладётся в
#    `<раунд>/_skills/` ОДИН раз на раунд: повторный запуск той же пробы в том же раунде обязан
#    читать тот же текст, иначе половина пула мерит одно, половина другое.
#
# 2. **`answer.md` берётся из stdout, а не просьбой к прогону.** Раунд 2 просил «обязательно
#    запиши ответ в answer.md» — шесть прогонов `ts-ctx` из десяти положили туда всю спеку и
#    файла спеки не создали (`RUNNER.md`, раздел «Ловушка»). Здесь про запись файлов в промпте
#    не сказано ничего: единственные файлы в песочнице те, которые скилл создал сам.
#
# Раскладка плоская: `<раунд>/<проба>/run-NN/` — она же песочница, `answer.md` рядом.
# `grade-ctx.mjs` читает её напрямую, `grade-ts.mjs` — с 2026-08-14 тоже (обе формы).

set -u

PROBE="${1:-}"
ROUND="${2:-}"
N="${3:-10}"
CONC="${4:-5}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Свой пул, а не корневой `_skill-eval/run-pool.sh`. Причина — в шапке `run-pool-ctx.sh`:
# последняя строка промпта корневого раннера («Твой ответ — то, что ты сказал бы пользователю в
# чат») отменяла запись файла у половины прогонов. Корневой раннер не трогаем: на нём стоят
# другие евалы репы, и менять его надо своим замером, а не заодно.
POOL="$HERE/run-pool-ctx-v2.sh"

# проба → фикстура, файл промпта, скилл. `SEED_SUB` — подпапка засева, если он не вся фикстура.
SEED_SUB=""
# Заглушки под-скиллов: имя подпапки внутри фикстуры. Пусто → в песочницу кладётся один скилл,
# как было. Заводится только у проб, которые меряют МАРШРУТ оркестратора, а не содержание.
STUBS_SUB=""
# Файл с репликой аналитика для ВТОРОГО хода (пусто → проба одноходовая, как была). Нужен только
# пробам маршрута: их отказ наступает на стыке «под-скилл кончил ход → проводник продолжает сам»,
# а одним ходом этот стык не воспроизводится.
TURN2_FILE=""
# Реплика ТРЕТЬЕГО хода (пусто → третий и дальше ходы получают реплику TURN2_FILE, как было). Нужна трёхходовым
# пробам `interaction-diagram` 4.3.0: ход 2 — ответ о типе схемы, ход 3 — ответы на вопросы.
TURN3_FILE=""
# Реплика на узел «Что дальше?» (пусто → как было). Только пробам маршрута `rt-*`: пул подставляет её,
# опознав узел в ответе прошлого хода (`RT_NODE_REPLY` в `run-pool-ctx-v2.sh`).
NODE_FILE=""
# Реплика на ВТОРОЙ узел (пусто → как было). Сквозной пробе `rt-e2e`: первый узел — «Проверить», второй —
# «Доработать» (`RT_NODE_REPLY2` в `run-pool-ctx-v2.sh`).
NODE2_FILE=""
# Живые под-скиллы поверх заглушек, по именам через пробел (пусто → как было). См. блок заглушек ниже.
REAL_SUBS=""
# Жёсткий потолок ходов пробы (пусто → как было: внешний RT_MAX_TURNS или 8 в пуле). Нужен двухходовым пробам
# без трассы: пул считает движение по `_trace.log`, без него ход «пустой», и реплика уходит второй раз.
TURNS_CAP=""
# Конец диалога по файлу и порог пустых ходов (пусто → как было: конец по трассе, два пустых хода подряд).
# Нужны многоходовым пробам без заглушек, у которых скилл задаёт вопросы по одному за ход: трассы нет,
# каждый ход «пустой», и пул гасил диалог на втором вопросе. `DONE_RE` — регулярка по путям файлов
# песочницы: нашёлся — диалог кончен. `IDLE_MAX` — сколько пустых ходов подряд терпеть.
DONE_RE=""
IDLE_MAX=""
# Ход 1 у `meeting-intake` — три субагента подряд по расшифровке: 900 с не хватает, а потолок ожидания
# фоновых задач (600 с) рвёт ход посреди субагента. Модель по умолчанию — прод-уровень.
MEET_ENV=""
# Папка скилла (пусто → `agent-version/<скилл>`, как было). Задаётся пробой скилла, который лежит вне набора.
SKILL_DIR=""
# Конец диалога по содержимому `coddoc/` (пусто → как было) и карточка двойника аналитика в фикстуре (пусто → реплики
# из файлов, как было). Пробам `meeting-recall`: протокол создаётся на первом ходу, а ответ зависит от вопроса.
DONE_GREP=""
TWIN_CARD=""
# Промпт двойника (пусто → `twin-analyst.md`, как было). Пробам, где двойник не вспоминает встречу, а отвечает на
# вопросы скилла по карточке и возражает там, где карточка велит: `twin-objector.md`.
TWIN_PROMPT=""
# Вызов скилла словами (пусто → как было): снимок — в `.claude/skills/` песочницы, обёртка не называет ни скилл, ни путь.
AUTO_SKILL=""
# Конец диалога по тексту ответа агента (пусто → как было). Пробам `rehearse`: скилл ничего не пишет, конец — итог в чате.
DONE_ANSWER=""
# Ответ хода — все реплики ведущего, а не финальный `result` (пусто → как было). Пробам `rehearse`: вопрос, напечатанный
# до вызова инструмента, иначе не доходит до двойника.
ANSWER_ALL=""
case "$PROBE" in
  ts-live)   FIXTURE=TS-LIVE;   PROMPT_FILE=spec-prompt.txt;  SKILL=technical-spec-doc ;;
  ts-conv)   FIXTURE=TS-CONV;   PROMPT_FILE=spec-prompt.txt;  SKILL=technical-spec-doc ;;
  ts-conv2)  FIXTURE=TS-CONV2;  PROMPT_FILE=spec-prompt.txt;  SKILL=technical-spec-doc ;;
  # Пробелы контракта (2026-10-01): повтор создания, одновременная правка, частичный сбой с чужим сервисом,
  # переходы статусов, старые строки изменённой таблицы, ограничения полей, риски/не-цели, дата редакции.
  # ts-gaps — запись (ответы на классические гейты, про пробелы ни слова), ts-gaps-q — первый ход, только вопросы.
  # Грейдер grade-gaps.mjs (`--q` для вопросной). Состав и ловушки — fixtures/TS-GAPS/README.md.
  ts-gaps)   FIXTURE=TS-GAPS;   PROMPT_FILE=spec-prompt.txt;  SKILL=technical-spec-doc ;;
  ts-gaps-q) FIXTURE=TS-GAPS;   PROMPT_FILE=q-prompt.txt;     SKILL=technical-spec-doc ;;
  # Полные задачи обычного режима (2026-10-12): все 10 тех-гейтов содержательны, БТ по текущему шаблону,
  # условия по статусу только словами процесса. TS-VAC — отпуск, всё наше, окружения нет; TS-ACC — доступ
  # к системе, чужая система учёток, services/ и context/. Состав и ловушки — README фикстур.
  # ── `meeting-intake`: расшифровка встречи → вход для БТ или спеки (2026-10-13) ──────────────
  # Засев — `seed/`: в фикстуре рядом лежат эталоны (`etalon/`), им в песочнице не место. Реплика одна
  # на все ходы и нейтральная («согласен с рекомендацией»): цель, условные пункты и сводка — каждый вопрос
  # скилла с рекомендацией первой. Диалог кончается, когда во вход записан файл. Грейдер —
  # `grade-meet.mjs --fx VAC|ACC`, ожидания — `fixtures/MEET-*/expected.md`.
  meet-vac)  FIXTURE=MEET-VAC;  PROMPT_FILE=w-prompt.txt; SKILL=meeting-intake; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=20; IDLE_MAX=20; DONE_RE='/coddoc/.*/meeting-[^/]*\.points\.md$'; MEET_ENV=1 ;;
  meet-acc)  FIXTURE=MEET-ACC;  PROMPT_FILE=w-prompt.txt; SKILL=meeting-intake; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=20; IDLE_MAX=20; DONE_RE='/coddoc/.*/meeting-[^/]*\.points\.md$'; MEET_ENV=1 ;;
  # Стык встреча → петля (2026-10-14): скилл петли получает документ задачи и эталонный вход
  # meeting-intake и сообщение «по итогам встречи». Меряется, как он разбирает вход и что спрашивает.
  jm-br-vac)  FIXTURE=JM-BR-VAC;  PROMPT_FILE=w-prompt.txt; SKILL=business-requirements-doc; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=3; MEET_ENV=1 ;;
  jm-br-long) FIXTURE=JM-BR-LONG; PROMPT_FILE=w-prompt.txt; SKILL=business-requirements-doc; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=3; MEET_ENV=1 ;;
  jm-ts-acc)  FIXTURE=JM-TS-ACC;  PROMPT_FILE=w-prompt.txt; SKILL=technical-spec-doc; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=4; IDLE_MAX=4; DONE_RE='/coddoc/.*/technical_specification\.md$'; MEET_ENV=1 ;;
  # Длинная встреча (660 строк, 52 минуты): карта в три окна, тема > 400 строк — разбор кусками.
  meet-long) FIXTURE=MEET-LONG; PROMPT_FILE=w-prompt.txt; SKILL=meeting-intake; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=20; IDLE_MAX=20; DONE_RE='/coddoc/.*/meeting-[^/]*\.points\.md$'; MEET_ENV=1 ;;
  # Фичу обсуждают с нуля: документов задачи нет, ключ только в чате (MEET-NEW, цель — новый БТ).
  # Вторая встреча по готовой спеке (MEET-REW, цель — правки спеки): в папке уже лежит вход прошлой
  # встречи, поэтому конец диалога — по дате этой встречи, а не по любому входу.
  meet-new)  FIXTURE=MEET-NEW;  PROMPT_FILE=w-prompt.txt; SKILL=meeting-intake; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=20; IDLE_MAX=20; DONE_RE='/coddoc/.*/meeting-[^/]*\.points\.md$'; MEET_ENV=1 ;;
  # Правки поверх записанного БТ + последнее слово после итогов внутри чужой темы (MEET-CHG); правка работающего,
  # расшифровка VTT, дата из имени файла (MEET-CR). Ключ у обеих — в строке вызова.
  meet-chg)  FIXTURE=MEET-CHG;  PROMPT_FILE=w-prompt.txt; SKILL=meeting-intake; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=20; IDLE_MAX=20; DONE_RE='/coddoc/.*/meeting-[^/]*\.points\.md$'; MEET_ENV=1 ;;
  meet-cr)   FIXTURE=MEET-CR;   PROMPT_FILE=w-prompt.txt; SKILL=meeting-intake; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=20; IDLE_MAX=20; DONE_RE='/coddoc/.*/meeting-[^/]*\.points\.md$'; MEET_ENV=1 ;;
  meet-rew)  FIXTURE=MEET-REW;  PROMPT_FILE=w-prompt.txt; SKILL=meeting-intake; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=20; IDLE_MAX=20; DONE_RE='/coddoc/.*/meeting-2026-10-14[^/]*\.points\.md$'; MEET_ENV=1 ;;
  # Созвон-расспрос без решений (перенос MI-NB-OUT): ключа нет — список в coddoc/_inbox/; ждём сведения и открытые вопросы.
  meet-out)  FIXTURE=MEET-OUT;  PROMPT_FILE=w-prompt.txt; SKILL=meeting-intake; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=20; IDLE_MAX=20; DONE_RE='/coddoc/.*/meeting-[^/]*\.points\.md$'; MEET_ENV=1 ;;
  # Настоящие созвоны с опубликованной таблицей решений, перевод построчно. Сверка — по expected.md фикстуры, грейдера нет.
  meet-eth204) FIXTURE=MEET-ETH204; PROMPT_FILE=w-prompt.txt; SKILL=meeting-intake; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=20; IDLE_MAX=20; DONE_RE='/coddoc/.*/meeting-[^/]*\.points\.md$'; MEET_ENV=1 ;;
  meet-eth150) FIXTURE=MEET-ETH150; PROMPT_FILE=w-prompt.txt; SKILL=meeting-intake; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=20; IDLE_MAX=20; DONE_RE='/coddoc/.*/meeting-[^/]*\.points\.md$'; MEET_ENV=1 ;;
  # Стык для этих двух: новый БТ только по входу встречи; доработка готовой спеки по входу второй встречи
  # (спека уже лежит — конец диалога по файлу не ловится, только потолок).
  jm-br-new)  FIXTURE=JM-BR-NEW;  PROMPT_FILE=w-prompt.txt; SKILL=business-requirements-doc; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=4; IDLE_MAX=4; DONE_RE='/coddoc/.*/business_requirements\.md$'; MEET_ENV=1 ;;
  jm-ts-rew)  FIXTURE=JM-TS-REW;  PROMPT_FILE=w-prompt.txt; SKILL=technical-spec-doc; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=3; MEET_ENV=1 ;;
  # ── `meeting-recall`: встреча по памяти → протокол (2026-10-14) ───────────────────────────────
  # За аналитика отвечает двойник: `twin-analyst.md` + `twin-card.md` фикстуры. Конец — в протоколе
  # появился раздел «Уточнить у участников». Грейдер `grade-recall.mjs --fx NEW|CHG`.
  # meeting-recall 1.2.0 (разбор темы): раунд длиннее — потолок ходов 30 (был 18), у rec-deep — 34.
  rec-new) FIXTURE=RECALL-NEW; PROMPT_FILE=w-prompt.txt; SKILL=meeting-recall; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=30; IDLE_MAX=30; DONE_RE='/coddoc/(.*/)?meeting-[^/]*\.points\.md$'; DONE_GREP='^# Пункты:'; TWIN_CARD=twin-card.md; MEET_ENV=1 ;;
  rec-chg) FIXTURE=RECALL-CHG; PROMPT_FILE=w-prompt.txt; SKILL=meeting-recall; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=30; IDLE_MAX=30; DONE_RE='/coddoc/(.*/)?meeting-[^/]*\.points\.md$'; DONE_GREP='^# Пункты:'; TWIN_CARD=twin-card.md; MEET_ENV=1 ;;
  # Стык «протокол по памяти → meeting-intake»: засев — зелёный протокол `meeting-recall` (r2-new run-3, r2-chg run-2).
  # Пересказ в строке вызова, ключа нет (протокол — в coddoc/_inbox/), аналитик просит закончить посреди раундов.
  rec-inline) FIXTURE=RECALL-INLINE; PROMPT_FILE=w-prompt.txt; SKILL=meeting-recall; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=30; IDLE_MAX=30; DONE_RE='/coddoc/(.*/)?meeting-[^/]*\.points\.md$'; DONE_GREP='^# Пункты:'; TWIN_CARD=twin-card.md; MEET_ENV=1 ;;
  # Встреча RECALL-NEW и пять фактов, которые двойник называет только на прямой вопрос разбора (свой промпт двойника —
  # общий `twin-analyst.md` не трогаем). Грейдер `grade-recall.mjs --fx DEEP`: скрытое в итоге, ловушки «а если».
  rec-deep) FIXTURE=RECALL-DEEP; PROMPT_FILE=w-prompt.txt; SKILL=meeting-recall; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=34; IDLE_MAX=34; DONE_RE='/coddoc/(.*/)?meeting-[^/]*\.points\.md$'; DONE_GREP='^# Пункты:'; TWIN_CARD=twin-card.md; TWIN_PROMPT=twin-analyst-deep.md; MEET_ENV=1 ;;
  # Та же встреча RECALL-DEEP, двойник отвечает как человек: на сообщение из трёх и больше вопросов — только на первые два
  # (twin-analyst-human.md). Анкета из многих строк не выигрывает за счёт послушного двойника. Грейдер — `--fx DEEP`.
  rec-deep-h) FIXTURE=RECALL-DEEP; PROMPT_FILE=w-prompt.txt; SKILL=meeting-recall; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=34; IDLE_MAX=34; DONE_RE='/coddoc/(.*/)?meeting-[^/]*\.points\.md$'; DONE_GREP='^# Пункты:'; TWIN_CARD=twin-card.md; TWIN_PROMPT=twin-analyst-human.md; MEET_ENV=1 ;;
  # analyst-notebook 1.0.0 и meeting-intake 1.1.0 (план product/plans/notebook.md): запись в ноут, сборка выкладки,
  # ноут на входе и цель «в ноут». Ноут лежит в `notes/` — конец по содержимому смотрит и туда (`RT_DONE_GREP`).
  nb-new)     FIXTURE=NB-NEW;     PROMPT_FILE=w-prompt.txt; SKILL=analyst-notebook; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=5; IDLE_MAX=5; DONE_RE='/notes/[^/]+/notebook\.md$'; MEET_ENV=1 ;;
  nb-thought) FIXTURE=NB-THOUGHT; PROMPT_FILE=w-prompt.txt; SKILL=analyst-notebook; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=5; IDLE_MAX=5; DONE_GREP='^- \[мысль\]'; MEET_ENV=1 ;;
  nb-contra)  FIXTURE=NB-CONTRA;  PROMPT_FILE=w-prompt.txt; SKILL=analyst-notebook; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=5; IDLE_MAX=5; DONE_GREP='вместо:'; MEET_ENV=1 ;;
  nb-noauth)  FIXTURE=NB-NOAUTH;  PROMPT_FILE=w-prompt.txt; SKILL=analyst-notebook; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=5; IDLE_MAX=5; DONE_GREP='^- \[(открыто|решено|сведение)\].*склад'; MEET_ENV=1 ;;
  nb-file)    FIXTURE=NB-FILE;    PROMPT_FILE=w-prompt.txt; SKILL=analyst-notebook; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=5; IDLE_MAX=5; DONE_GREP='reglament\.pdf'; MEET_ENV=1 ;;
  nb-view-api)  FIXTURE=NB-VIEW;  PROMPT_FILE=w-prompt-api.txt;  SKILL=analyst-notebook; SEED_SUB=seed; TURN2_FILE=w-turn2-api.txt;  TURNS_CAP=5; IDLE_MAX=5; DONE_RE='/notes/[^/]+/[^/]*-20[0-9][0-9]-[0-9][0-9]-[0-9][0-9](-2)?\.md$'; MEET_ENV=1 ;;
  nb-view-chat) FIXTURE=NB-VIEW;  PROMPT_FILE=w-prompt-chat.txt; SKILL=analyst-notebook; SEED_SUB=seed; TURN2_FILE=w-turn2-chat.txt; TURNS_CAP=3; IDLE_MAX=3; MEET_ENV=1 ;;
  # analyst-notebook 1.1.0: спор людей, ответ закрывает открытый вопрос, режим «спроси», длинная вставка в sources/,
  # выкладка из части ноута другой формой; meeting-intake 1.1.0: ответ на открытый вопрос в ноуте на входе.
  nb-dispute) FIXTURE=NB-DISPUTE; PROMPT_FILE=w-prompt.txt; SKILL=analyst-notebook; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=5; IDLE_MAX=5; DONE_GREP='[Чч]то верно'; MEET_ENV=1 ;;
  nb-answer)  FIXTURE=NB-ANSWER;  PROMPT_FILE=w-prompt.txt; SKILL=analyst-notebook; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=5; IDLE_MAX=5; DONE_GREP='отвечает на:'; MEET_ENV=1 ;;
  nb-ask)     FIXTURE=NB-ASK;     PROMPT_FILE=w-prompt.txt; SKILL=analyst-notebook; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=2; IDLE_MAX=2; MEET_ENV=1 ;;
  nb-long)    FIXTURE=NB-LONG;    PROMPT_FILE=w-prompt.txt; SKILL=analyst-notebook; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=5; IDLE_MAX=5; DONE_GREP='^> исходник:'; MEET_ENV=1 ;;
  nb-view-part) FIXTURE=NB-VIEW-PART; PROMPT_FILE=w-prompt.txt; SKILL=analyst-notebook; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=5; IDLE_MAX=5; DONE_RE='/notes/[^/]+/[^/]*-20[0-9][0-9]-[0-9][0-9]-[0-9][0-9](-2)?\.md$'; MEET_ENV=1 ;;
  ts-vac)    FIXTURE=TS-VAC;    PROMPT_FILE=spec-prompt.txt;  SKILL=technical-spec-doc ;;
  ts-vac-q)  FIXTURE=TS-VAC;    PROMPT_FILE=q-prompt.txt;     SKILL=technical-spec-doc ;;
  # п.2 PLAN-FROM-POCOCK: копия TS-VAC, у FR-10 критерий с границей по датам → тест-кейс §7 несёт обе даты. grade-ts-lim.mjs
  ts-vac-lim) FIXTURE=TS-VAC-LIM; PROMPT_FILE=spec-prompt.txt; SKILL=technical-spec-doc ;;
  # п.2б PLAN-FROM-POCOCK: путь и модель у 🔵 по источнику; вид «изменение существующего». grade-ts-blue.mjs --case=yes|idk
  ts-blue-yes) FIXTURE=TS-BLUE; PROMPT_FILE=yes-prompt.txt; SKILL=technical-spec-doc ;;
  ts-blue-idk) FIXTURE=TS-BLUE; PROMPT_FILE=idk-prompt.txt; SKILL=technical-spec-doc ;;
  ts-acc)    FIXTURE=TS-ACC;    PROMPT_FILE=spec-prompt.txt;  SKILL=technical-spec-doc ;;
  ts-acc-q)  FIXTURE=TS-ACC;    PROMPT_FILE=q-prompt.txt;     SKILL=technical-spec-doc ;;
  # interaction-diagram: схема по готовой спеке DSP-330; формат назван (mmd/puml) или нет (ask).
  # Состав и ловушки — `fixtures/ID-DIAG/README.md`.
  id-mmd)    FIXTURE=ID-DIAG;   PROMPT_FILE=mmd-prompt.txt;   SKILL=interaction-diagram ;;
  id-puml)   FIXTURE=ID-DIAG;   PROMPT_FILE=puml-prompt.txt;  SKILL=interaction-diagram ;;
  id-ask)    FIXTURE=ID-DIAG;   PROMPT_FILE=ask-prompt.txt;   SKILL=interaction-diagram ;;
  # Сложный граф: кольцо, встречные пары, два имени одного сервиса, карточка без направления.
  ring-mmd)  FIXTURE=ID-RING;   PROMPT_FILE=mmd-prompt.txt;   SKILL=interaction-diagram ;;
  ring-puml) FIXTURE=ID-RING;   PROMPT_FILE=puml-prompt.txt;  SKILL=interaction-diagram ;;
  # Направления `←`/`↔`, событие, «UI (страница …)» = «UI», путь «предположительно» — `fixtures/ID-DIR/README.md`.
  dir-mmd)   FIXTURE=ID-DIR;    PROMPT_FILE=mmd-prompt.txt;   SKILL=interaction-diagram ;;
  dir-puml)  FIXTURE=ID-DIR;    PROMPT_FILE=puml-prompt.txt;  SKILL=interaction-diagram ;;
  # Реалистичная спека repairy REP-214 (полная форма шаблона) — `fixtures/ID-REP/README.md`.
  rep-mmd)   FIXTURE=ID-REP;    PROMPT_FILE=mmd-prompt.txt;   SKILL=interaction-diagram ;;
  rep-puml)  FIXTURE=ID-REP;    PROMPT_FILE=puml-prompt.txt;  SKILL=interaction-diagram ;;
  # Граница-цепочка `A → B → C`, `→` в скобках, кривая скобка — `fixtures/ID-CHAIN/README.md`.
  chain-mmd)  FIXTURE=ID-CHAIN;  PROMPT_FILE=mmd-prompt.txt;   SKILL=interaction-diagram ;;
  chain-puml) FIXTURE=ID-CHAIN;  PROMPT_FILE=puml-prompt.txt;  SKILL=interaction-diagram ;;
  # Подробная схема (тип назван в запросе): триггер, запрос, ответ, ошибки — `fixtures/ID-DET/README.md`.
  det-mmd)   FIXTURE=ID-DET;    PROMPT_FILE=mmd-prompt.txt;   SKILL=interaction-diagram ;;
  det-puml)  FIXTURE=ID-DET;    PROMPT_FILE=puml-prompt.txt;  SKILL=interaction-diagram ;;
  # Подробная на реалистичной спеке REP-214; `-det-` в имени — признак типа для `grade-id.mjs`.
  rep-det-mmd) FIXTURE=ID-REP;  PROMPT_FILE=det-mmd-prompt.txt; SKILL=interaction-diagram ;;
  # Опросник (`PLAN-ID-DETAIL.md` §3): вопросы по поводам П1–П3 без файла схемы, затем схема по реплике аналитика.
  # Реплика — утверждения с номером карточки и именем стороны. `chain-q-idk` — ответ «Не знаю.»: без переспроса.
  # `ring-q-one` / `ring-q-two` — противоположные ответы про «бэкенд возвратов»: склеить с `returns-api` / оставить
  # отдельным. Грейдер — `grade-id.mjs`, таблица QPROBES.
  # Скилл 4.3.0 — три хода у всех проб ниже: ход 1 — только вопрос о типе схемы, ход 2 — ответ о типе (TURN2_FILE,
  # `type-short-turn2.txt` «Короткую.» / `type-scen-turn2.txt` «Сценарную.») и вопросы, ход 3 — прежняя реплика
  # (TURN3_FILE) и файл схемы. Ровно три хода: TURNS_CAP=3.
  chain-q-mmd) FIXTURE=ID-CHAIN; PROMPT_FILE=mmd-prompt.txt;  SKILL=interaction-diagram; TURN2_FILE=type-short-turn2.txt; TURN3_FILE=q-turn2.txt;   TURNS_CAP=3 ;;
  chain-q-idk) FIXTURE=ID-CHAIN; PROMPT_FILE=mmd-prompt.txt;  SKILL=interaction-diagram; TURN2_FILE=type-short-turn2.txt; TURN3_FILE=idk-turn2.txt; TURNS_CAP=3 ;;
  ring-q-one)  FIXTURE=ID-RING;  PROMPT_FILE=puml-prompt.txt; SKILL=interaction-diagram; TURN2_FILE=type-short-turn2.txt; TURN3_FILE=one-turn2.txt; TURNS_CAP=3 ;;
  ring-q-two)  FIXTURE=ID-RING;  PROMPT_FILE=puml-prompt.txt; SKILL=interaction-diagram; TURN2_FILE=type-short-turn2.txt; TURN3_FILE=two-turn2.txt; TURNS_CAP=3 ;;
  rep-q-mmd)   FIXTURE=ID-REP;   PROMPT_FILE=mmd-prompt.txt;  SKILL=interaction-diagram; TURN2_FILE=type-short-turn2.txt; TURN3_FILE=q-turn2.txt;   TURNS_CAP=3 ;;
  # Подробная с поводом П4 (ответ цепочки INT-5): `det-q-mmd` / `det-q-puml` — реплика «от parking-api к parking-web»,
  # `det-q-alt` — противоположная «от billing к parking-api» (читать парой). `id-q-mmd` — П3 «планшет группы».
  # `det-q-*` на тип отвечают «Сценарную.» — ближайшее к «подробной (с ответами и ошибками)» из запроса.
  # `det-short-mmd` — контроль: короткая по ID-DET, поводов нет, файл с первого хода.
  det-q-mmd)   FIXTURE=ID-DET;  PROMPT_FILE=mmd-prompt.txt;  SKILL=interaction-diagram; TURN2_FILE=type-scen-turn2.txt;  TURN3_FILE=q-turn2.txt;     TURNS_CAP=3 ;;
  det-q-puml)  FIXTURE=ID-DET;  PROMPT_FILE=puml-prompt.txt; SKILL=interaction-diagram; TURN2_FILE=type-scen-turn2.txt;  TURN3_FILE=q-turn2.txt;     TURNS_CAP=3 ;;
  det-q-alt)   FIXTURE=ID-DET;  PROMPT_FILE=mmd-prompt.txt;  SKILL=interaction-diagram; TURN2_FILE=type-scen-turn2.txt;  TURN3_FILE=q-alt-turn2.txt; TURNS_CAP=3 ;;
  # ревью покрытия п.2б: подпись у карточки изменения — путь из строки «Существующий стык». grade-id-blue.mjs
  id-blue)     FIXTURE=ID-BLUE; PROMPT_FILE=mmd-prompt.txt;  SKILL=interaction-diagram; TURN2_FILE=type-short-turn2.txt; TURN3_FILE=q-turn2.txt; TURNS_CAP=3; DONE_RE='/coddoc/SHT-410/interaction_diagram\.md$' ;;
  id-q-mmd)    FIXTURE=ID-DIAG; PROMPT_FILE=mmd-prompt.txt;  SKILL=interaction-diagram; TURN2_FILE=type-short-turn2.txt; TURN3_FILE=q-turn2.txt;     TURNS_CAP=3 ;;
  det-short-mmd) FIXTURE=ID-DET; PROMPT_FILE=short-mmd-prompt.txt; SKILL=interaction-diagram ;;
  # Этап К (`PLAN-ID-SCENARIO.md` §8, скилл 4.0.0): короткая схема по времени. Ход вопросов — об участниках и
  # порядке карточек без файла схемы, следующий — схема по реплике. Пробы этапа: `det-o-one`, `det-o-two`, `det-t-short`,
  # `id-q-mmd`, `chain-q-mmd`, `chain-q-idk`, `ring-q-one`, `ring-q-two`, `rep-q-mmd` — шесть последних заведены выше,
  # реплики у них с порядком по времени. `det-o-one` / `det-o-two` — одна спека, разный порядок карточек в реплике
  # (читать парой); они же контроль «лишнего вопроса о карточке нет». `det-t-short` — контроль типа: в запросе
  # «сценарную», ответ «Короткую.», дальше как `det-o-one`; файл — `interaction_diagram.md`. Грейдер — `grade-id.mjs`,
  # таблица STAGE, сводка `--round`.
  det-o-one)   FIXTURE=ID-DET;  PROMPT_FILE=short-mmd-prompt.txt; SKILL=interaction-diagram; TURN2_FILE=type-short-turn2.txt; TURN3_FILE=o-one-turn2.txt; TURNS_CAP=3 ;;
  det-o-two)   FIXTURE=ID-DET;  PROMPT_FILE=short-mmd-prompt.txt; SKILL=interaction-diagram; TURN2_FILE=type-short-turn2.txt; TURN3_FILE=o-two-turn2.txt; TURNS_CAP=3 ;;
  det-t-short) FIXTURE=ID-DET;  PROMPT_FILE=scen-mmd-prompt.txt;  SKILL=interaction-diagram; TURN2_FILE=type-short-turn2.txt; TURN3_FILE=o-one-turn2.txt; TURNS_CAP=3 ;;
  # Этап С (`PLAN-ID-SCENARIO.md` §10, скилл 4.1.0): сценарная схема по PRK-9. Ход вопросов — список карточек с
  # триггерами и вопросы (участники, цепочка INT-5, сценарии, внутренние шаги), следующий — файл
  # `interaction_scenarios.*` по реплике. `det-s-mmd` / `det-s-puml` — реплика А; `det-s-alt` — реплика Б с другим
  # составом и вложенностью сценариев (читать парой с `det-s-mmd`); `det-s-idk` — «Не знаю.». Грейдер — `grade-id.mjs`,
  # таблица SCEN. С 4.3.0 запрос нейтральный (без «сценарную»): тип приходит только ответом «Сценарную.» на ходу 2.
  det-s-mmd)   FIXTURE=ID-DET;  PROMPT_FILE=short-mmd-prompt.txt;  SKILL=interaction-diagram; TURN2_FILE=type-scen-turn2.txt; TURN3_FILE=s-turn2.txt;     TURNS_CAP=3 ;;
  det-s-puml)  FIXTURE=ID-DET;  PROMPT_FILE=short-puml-prompt.txt; SKILL=interaction-diagram; TURN2_FILE=type-scen-turn2.txt; TURN3_FILE=s-turn2.txt;     TURNS_CAP=3 ;;
  det-s-alt)   FIXTURE=ID-DET;  PROMPT_FILE=short-mmd-prompt.txt;  SKILL=interaction-diagram; TURN2_FILE=type-scen-turn2.txt; TURN3_FILE=s-alt-turn2.txt; TURNS_CAP=3 ;;
  det-s-idk)   FIXTURE=ID-DET;  PROMPT_FILE=short-mmd-prompt.txt;  SKILL=interaction-diagram; TURN2_FILE=type-scen-turn2.txt; TURN3_FILE=idk-turn2.txt;   TURNS_CAP=3 ;;
  # Ответ «Да, всё верно.» на ход 3 (`yes-turn2.txt`): схема по гипотезам самой модели. `det-y-short` — короткая, истина —
  # карточки, как их читает скилл (порядок по номерам, INT-5 — два звена). `det-y-scen` — сценарная, истина динамическая:
  # гипотеза сценариев из ответа хода 2. `rep-s-mmd` — сценарная на реалистичной REP-214 с полной репликой (`s-turn2.txt`):
  # склейка имён, направление INT-9, четыре сценария, тела списком. Грейдер — `grade-id.mjs`, таблицы STAGE и SCEN.
  det-y-short) FIXTURE=ID-DET;  PROMPT_FILE=short-mmd-prompt.txt;  SKILL=interaction-diagram; TURN2_FILE=type-short-turn2.txt; TURN3_FILE=yes-turn2.txt; TURNS_CAP=3 ;;
  det-y-scen)  FIXTURE=ID-DET;  PROMPT_FILE=short-mmd-prompt.txt;  SKILL=interaction-diagram; TURN2_FILE=type-scen-turn2.txt;  TURN3_FILE=yes-turn2.txt; TURNS_CAP=3 ;;
  rep-s-mmd)   FIXTURE=ID-REP;  PROMPT_FILE=mmd-prompt.txt;        SKILL=interaction-diagram; TURN2_FILE=type-scen-turn2.txt;  TURN3_FILE=s-turn2.txt;   TURNS_CAP=3 ;;
  # Тела по звеньям цепочки, сценарная по ESS-31 (`fixtures/ID-CHB/README.md`): метод и тело одного вызова — на одном
  # звене; у INT-2 тела без метода и сторон — звено спрашивается. `chb-s-mmd` — реплика называет звено тел INT-2;
  # `chb-s-idk` — на звено тел INT-2 «не знаю», пометок у INT-2 нет (читать парой). Грейдер — `grade-id.mjs`, таблица SCEN.
  chb-s-mmd)   FIXTURE=ID-CHB;  PROMPT_FILE=mmd-prompt.txt;        SKILL=interaction-diagram; TURN2_FILE=type-scen-turn2.txt;  TURN3_FILE=s-turn2.txt;   TURNS_CAP=3 ;;
  chb-s-idk)   FIXTURE=ID-CHB;  PROMPT_FILE=mmd-prompt.txt;        SKILL=interaction-diagram; TURN2_FILE=type-scen-turn2.txt;  TURN3_FILE=idk-turn2.txt; TURNS_CAP=3 ;;
  # Путь пользователя по БТ (скилл 5.1.0, `PLAN-ID-CORE.md` §8.2), фикстура `ID-BT`: тип один, формат назван — ход 1 —
  # список прочтения и вопросы (порядок, вторая ветка, конец ответвления), ход 2 — реплика и файл `user_flow.*`.
  # `bt-uf-idk` — «Не знаю.», `bt-uf-y` — «Да, всё верно.» (гипотезы скилла). Грейдер — `grade-uf.mjs`.
  bt-uf-mmd)   FIXTURE=ID-BT;   PROMPT_FILE=mmd-prompt.txt;        SKILL=interaction-diagram; TURN2_FILE=s-turn2.txt;   TURNS_CAP=2 ;;
  bt-uf-puml)  FIXTURE=ID-BT;   PROMPT_FILE=puml-prompt.txt;       SKILL=interaction-diagram; TURN2_FILE=s-turn2.txt;   TURNS_CAP=2 ;;
  bt-uf-idk)   FIXTURE=ID-BT;   PROMPT_FILE=mmd-prompt.txt;        SKILL=interaction-diagram; TURN2_FILE=idk-turn2.txt; TURNS_CAP=2 ;;
  bt-uf-y)     FIXTURE=ID-BT;   PROMPT_FILE=mmd-prompt.txt;        SKILL=interaction-diagram; TURN2_FILE=yes-turn2.txt; TURNS_CAP=2 ;;
  # Список пунктов (скилл 5.2.0, `PLAN-ID-CORE.md` §8.3), фикстура `ID-PT`: типов два — ход 1 — вопрос о типе, ход 2 — тип
  # (TURN2_FILE) и вопросы, ход 3 — реплика (TURN3_FILE) и файл `<основа списка>.interaction_diagram.md` / `.user_flow.puml`.
  # `pt-raw` — `interaction-diagram` дали ноут вместо списка, `pt-nb` — схему просят у `analyst-notebook`: отсылка одним
  # ходом, файла нет. Грейдер — `grade-pt.mjs`.
  pt-sh-mmd)   FIXTURE=ID-PT;   PROMPT_FILE=sh-mmd-prompt.txt;     SKILL=interaction-diagram; TURN2_FILE=type-short-turn2.txt; TURN3_FILE=sh-s-turn2.txt;  TURNS_CAP=3 ;;
  pt-sh-idk)   FIXTURE=ID-PT;   PROMPT_FILE=sh-mmd-prompt.txt;     SKILL=interaction-diagram; TURN2_FILE=type-short-turn2.txt; TURN3_FILE=idk-turn2.txt;   TURNS_CAP=3 ;;
  pt-sh-no)    FIXTURE=ID-PT;   PROMPT_FILE=sh-mmd-prompt.txt;     SKILL=interaction-diagram; TURN2_FILE=type-short-turn2.txt; TURN3_FILE=no-turn2.txt;    TURNS_CAP=3 ;;
  pt-uf-puml)  FIXTURE=ID-PT;   PROMPT_FILE=uf-puml-prompt.txt;    SKILL=interaction-diagram; TURN2_FILE=type-uf-turn2.txt;    TURN3_FILE=uf-s-turn2.txt;  TURNS_CAP=3 ;;
  pt-uf-idk)   FIXTURE=ID-PT;   PROMPT_FILE=uf-puml-prompt.txt;    SKILL=interaction-diagram; TURN2_FILE=type-uf-turn2.txt;    TURN3_FILE=idk-turn2.txt;   TURNS_CAP=3 ;;
  pt-raw)      FIXTURE=ID-PT;   PROMPT_FILE=raw-prompt.txt;        SKILL=interaction-diagram ;;
  pt-nb)       FIXTURE=ID-PT;   PROMPT_FILE=nb-prompt.txt;         SKILL=analyst-notebook ;;
  # Запасной вход (скилл 5.3.0, `PLAN-ID-CORE.md` §9), фикстура `ID-TXT`: текст файлом, в чате, текст процесса; список
  # с кривыми строками (`pt-junk`) и `*.points.md` из прозы (`pt-prose`). Грейдер — `grade-pt.mjs`.
  tx-sh-mmd)   FIXTURE=ID-TXT;  PROMPT_FILE=tx-file-prompt.txt;    SKILL=interaction-diagram; TURN2_FILE=type-short-turn2.txt; TURN3_FILE=tx-s-turn2.txt;  TURNS_CAP=3 ;;
  tx-sh-idk)   FIXTURE=ID-TXT;  PROMPT_FILE=tx-chat-prompt.txt;    SKILL=interaction-diagram; TURN2_FILE=type-short-turn2.txt; TURN3_FILE=idk-turn2.txt;   TURNS_CAP=3 ;;
  tx-uf-puml)  FIXTURE=ID-TXT;  PROMPT_FILE=tx-uf-prompt.txt;      SKILL=interaction-diagram; TURN2_FILE=type-uf-turn2.txt;    TURN3_FILE=uf-s-turn2.txt;  TURNS_CAP=3 ;;
  pt-junk)     FIXTURE=ID-TXT;  PROMPT_FILE=pt-junk-prompt.txt;    SKILL=interaction-diagram; TURN2_FILE=type-short-turn2.txt; TURN3_FILE=idk-turn2.txt;   TURNS_CAP=3 ;;
  pt-prose)    FIXTURE=ID-TXT;  PROMPT_FILE=pt-prose-prompt.txt;   SKILL=interaction-diagram; TURN2_FILE=type-short-turn2.txt; TURN3_FILE=idk-turn2.txt;   TURNS_CAP=3 ;;
  # ПЕРВЫЙ ХОД на богатом входе: то же БТ и те же карточки сервисов, что у ts-conv, но ответов
  # аналитика в промпте НЕТ — агент обязан спрашивать сам. Заведена 2026-08-26 под жалобу с
  # прода: варианты ответа мудрёные именно на подробном входе, а все существующие плечи спеки
  # либо выдают агенту готовые ответы (ts-live, ts-conv — их промпт начинается словами
  # «это ПРОДОЛЖЕНИЕ, аналитик отвечает»), либо подают тонкий вход. Ни одно из них поэтому не
  # порождает вариантов: за круг из пяти прогонов их выходит 0–4, и на таком числе счётчик
  # сложности вариантов ничего не различает.
  # Мерится grade-options.mjs по тексту ответа; файл при этом писать НЕЛЬЗЯ — на первом ходу
  # действует правило «turn 1 = questions only», и его сторожит grade-ts.mjs.
  ts-opt)    FIXTURE=TS-CONV;   PROMPT_FILE=opt-prompt.txt;   SKILL=technical-spec-doc ;;
  # ДВА НАСТОЯЩИХ ХОДА (аудит, С9): первый — как у ts-opt, агент сам читает карточки и спрашивает;
  # второй — тот же блок ответов аналитика, что в ts-conv, включая «про источник не знаю». У ts-conv
  # первый ход выдуманный, карточки читаются ПОСЛЕ ответов — и 2 из 7 прогонов переспрашивали источник
  # «с новой уликой». Здесь улика известна до вопросов. Гонять с RT_MAX_TURNS=2: трассы у пробы нет,
  # без потолка пул отправит реплику дважды.
  ts-conv-2t) FIXTURE=TS-CONV;  PROMPT_FILE=opt-prompt.txt;   SKILL=technical-spec-doc; TURN2_FILE=conv-turn2.txt ;;
  # `ts-fix` — доработка по находкам проверки готовности (`technical-spec-doc` 1.3.0): спека PSS-2210 и
  # настоящий отчёт `spec-readiness` (29 вопросов). Ход 1 — вопросы аналитику, файл не тронут; ход 2 —
  # ответы по номерам (три «не знаю»); ход 3 — «Да, годится.». Грейд — `grade-fix.mjs`, ключ — `KEY.md`.
  ts-fix)     FIXTURE=TS-FIX;   PROMPT_FILE=fix-prompt.txt;   SKILL=technical-spec-doc; TURN2_FILE=fix-turn2.txt; TURN3_FILE=fix-yes-turn2.txt; TURNS_CAP=3 ;;
  ts-ctx)    FIXTURE=TS-CTX;    PROMPT_FILE=spec-prompt.txt;  SKILL=technical-spec-doc ;;
  # Правка логики внутри бэкенда без нового стыка (2026-10-24, находка №10 ревью): §2 неприменима, §7 → логика §3.1,
  # выдуманной INT быть не должно. Грейдер `grade-beonly.mjs`.
  ts-beonly) FIXTURE=TS-BEONLY; PROMPT_FILE=spec-prompt.txt;  SKILL=technical-spec-doc ;;
  # Спека в режиме мелкой правки (2026-10-24): таймаут (контракт не тронут → §2 неприменима, §5.1 по сути) и новое
  # поле в ответе (контракт тронут → §2 карточка с JSON). Грейдер `grade-cr-spec.mjs --case=timeout|api`.
  ts-cr-timeout) FIXTURE=TS-CR; PROMPT_FILE=timeout-prompt.txt; SKILL=technical-spec-doc ;;
  ts-cr-api)     FIXTURE=TS-CR; PROMPT_FILE=api-prompt.txt;     SKILL=technical-spec-doc ;;
  ts-nodesc) FIXTURE=TS-NODESC; PROMPT_FILE=spec-prompt.txt;  SKILL=technical-spec-doc ;;
  ts-noctx)  FIXTURE=TS-NOCTX;  PROMPT_FILE=spec-prompt.txt;  SKILL=technical-spec-doc ;;
  br-ctx)    FIXTURE=BR-CTX;    PROMPT_FILE=t1-prompt.txt;    SKILL=business-requirements-doc ;;
  # Карточка с «Бизнес-правилами» (шаг 5 плана бизнес-слоя): читает ли БТ-скилл новую секцию.
  # Первый ход, файла нет; анкеры — факты из секции, которых в брифе нет. Грейдер — grade-br-real.mjs.
  br-real)   FIXTURE=BR-REAL;   PROMPT_FILE=t1-prompt.txt;    SKILL=business-requirements-doc ;;
  # BR-REAL + «ограничение» и строка «не определено» в карточке (форма 1.5.0): читает ли потребитель
  # ограничение как риск/критерий и молчит ли про значение без перехода. Грейдер — grade-br-limit.mjs.
  br-limit)  FIXTURE=BR-LIMIT;  PROMPT_FILE=t1-prompt.txt;    SKILL=business-requirements-doc ;;
  # Доработка ГОТОВОГО БТ по находкам приёмки (К5 аудита 2026-09-17): процедуры доработки у писателя
  # нет, а маршрут на неё опирается. Грейдится файл: поправлен на месте, переписан, заведён новый
  # или не тронут. Состав — `fixtures/BR-REWORK/README.md`.
  br-rework) FIXTURE=BR-REWORK; PROMPT_FILE=rework-prompt.txt; SKILL=business-requirements-doc ;;
  # То же, но находки переданы БЕЗ ответов аналитика: верный исход — вопросы только по двум находкам,
  # ключ и закрытые гейты не переспрошены, нового файла нет. Читается по `answer.md` вручную.
  br-rework-q) FIXTURE=BR-REWORK; PROMPT_FILE=rework-q-prompt.txt; SKILL=business-requirements-doc ;;
  sb-ctx)    FIXTURE=SB-CTX;    PROMPT_FILE=stage-prompt.txt; SKILL=stage-breakdown-doc ;;
  # Шаг 5 `service-map` на ВТОРОМ проходе, файлами на диске: зеркала прошлого прохода уже стоят, одно
  # устарело. Ловит выдуманное обратное ребро (К6 аудита 2026-09-17) — на `SM-GRAPH` его не видно,
  # там секции «Кто меня потребляет» пусты. Состав и ожидания — `fixtures/SM-GRAPH2/README.md`.
  sm-graph2) FIXTURE=SM-GRAPH2; PROMPT_FILE=step5-prompt.txt; SKILL=service-map ;;
  # Приёмка ничего не пишет на диск: её артефакт — `answer.md` из stdout, и другого нет.
  rv-conv)   FIXTURE=RV-CONV;   PROMPT_FILE=rv-prompt.txt;    SKILL=spec-review ;;
  # Сторож основного пути: чистый документ и НЕТ папки `context/`. Ловит оба способа, которыми
  # пункт 12 мог полезть не туда, — ложное срабатывание там, где его предмета нет, и уход
  # субагента за пределы артефакта по новому пути к корню репозитория.
  rv-clean)  FIXTURE=RV-CLEAN;  PROMPT_FILE=rv-prompt.txt;    SKILL=spec-review ;;
  # Аудит 2026-09-17, К1–К4 и К8.2: исключения чек-листов. `RV-CLEAN` шаблон обходит (§8 одной
  # строкой, блока «Открытые вопросы» в шапке нет), поэтому ложные срабатывания пунктов 6 и 10 на
  # ней не видны; здесь спеки в форме шаблона, БТ с именами ролей, фронтовая спека без контрактов и
  # индекс этапов «не применимо». Состав и ожидания — `fixtures/RV-AUDIT/README.md`.
  rv-bt-clean)  FIXTURE=RV-AUDIT; PROMPT_FILE=bt-clean-prompt.txt;  SKILL=spec-review ;;
  # Тот же чистый БТ со строками «Редакция» и «Версия скилла»: имя скилла похоже на имя сервиса.
  rv-bt-hdr)    FIXTURE=HDR-RV;   PROMPT_FILE=bt-clean-prompt.txt;  SKILL=spec-review ;;
  rv-bt-dirty)  FIXTURE=RV-AUDIT; PROMPT_FILE=bt-dirty-prompt.txt;  SKILL=spec-review ;;
  # п.2 PLAN-FROM-POCOCK, шаг 4: счётная строка «порог без примера на границе» — не нарушение. grade-rv-lim.mjs --case=…
  rv-lim-clean)   FIXTURE=RV-LIM; PROMPT_FILE=bt-clean-prompt.txt; SKILL=spec-review ;;
  rv-lim-dirty)   FIXTURE=RV-LIM; PROMPT_FILE=bt-dirty-prompt.txt; SKILL=spec-review ;;
  rv-crlim-clean) FIXTURE=RV-LIM; PROMPT_FILE=cr-clean-prompt.txt; SKILL=spec-review ;;
  rv-crlim-dirty) FIXTURE=RV-LIM; PROMPT_FILE=cr-dirty-prompt.txt; SKILL=spec-review ;;
  # шаг 2 п.2б PLAN-FROM-POCOCK: приёмка спеки после 2б — источник у 🔵, «Вид», «Существующий стык», «было» на 🟡-основе. grade-rv-blue.mjs
  rv-blue-yes)   FIXTURE=RV-BLUE; PROMPT_FILE=p410-prompt.txt; SKILL=spec-review ;;
  rv-blue-idk)   FIXTURE=RV-BLUE; PROMPT_FILE=p411-prompt.txt; SKILL=spec-review ;;
  rv-blue-dirty) FIXTURE=RV-BLUE; PROMPT_FILE=p412-prompt.txt; SKILL=spec-review ;;
  rv-blue-was)   FIXTURE=RV-BLUE; PROMPT_FILE=p413-prompt.txt; SKILL=spec-review ;;
  rv-blue-cr)    FIXTURE=RV-BLUE; PROMPT_FILE=p420-prompt.txt; SKILL=spec-review ;;
  # ревью покрытия п.2б: приёмка файла этапа с карточкой изменения без пути. grade-rv-stage-blue.mjs
  rv-stage-blue-idk) FIXTURE=RV-STAGE-BLUE; PROMPT_FILE=idk-prompt.txt; SKILL=spec-review ;;
  rv-stage-blue-cr)  FIXTURE=RV-STAGE-BLUE; PROMPT_FILE=cr-prompt.txt;  SKILL=spec-review ;;
  rv-fe)        FIXTURE=RV-AUDIT; PROMPT_FILE=fe-prompt.txt;        SKILL=spec-review ;;
  rv-tpl-clean) FIXTURE=RV-AUDIT; PROMPT_FILE=tpl-clean-prompt.txt; SKILL=spec-review ;;
  rv-tpl-dirty) FIXTURE=RV-AUDIT; PROMPT_FILE=tpl-dirty-prompt.txt; SKILL=spec-review ;;
  rv-tpl-count) FIXTURE=RV-AUDIT; PROMPT_FILE=tpl-count-prompt.txt; SKILL=spec-review ;;
  rv-stage-na)  FIXTURE=RV-AUDIT; PROMPT_FILE=stage-na-prompt.txt;  SKILL=spec-review ;;
  # П.9 `spec-review` 1.1.0 (PLAN-BR-SECTIONS D11): законные пустые ответы новых разделов БТ → 0; БТ без §4.3 → нарушение.
  rv-bt-empty)  FIXTURE=RV-AUDIT; PROMPT_FILE=bt-empty-prompt.txt;  SKILL=spec-review ;;
  rv-bt-no43)   FIXTURE=RV-AUDIT; PROMPT_FILE=bt-no43-prompt.txt;   SKILL=spec-review ;;
  sb-ctx2)   FIXTURE=SB-CTX2;   PROMPT_FILE=stage-prompt.txt; SKILL=stage-breakdown-doc ;;
  # Узел-фундамент #0 и ребёнок эпика после п.2б (ревью покрытия feat/blue-contract): спека #0 «Вид: новое»; ребёнок —
  # `🔵 depends-on #0`, «Вид: потребление существующего», состав контракта, без источника из списка; приёмка §13/§14;
  # разрез — унаследованный стык извне. Засевы — подпапки FND-EPIC. grade-fnd-epic.mjs --case=zero|kid|rv-kid|rv-dirty|rv-zero|sb-kid
  fnd-zero)     FIXTURE=FND-EPIC; PROMPT_FILE=zero-prompt.txt;     SKILL=technical-spec-doc;  SEED_SUB=seed-zero ;;
  fnd-kid)      FIXTURE=FND-EPIC; PROMPT_FILE=kid-prompt.txt;      SKILL=technical-spec-doc;  SEED_SUB=seed-kid ;;
  fnd-rv-kid)   FIXTURE=FND-EPIC; PROMPT_FILE=rv-kid-prompt.txt;   SKILL=spec-review;         SEED_SUB=seed-done ;;
  fnd-rv-dirty) FIXTURE=FND-EPIC; PROMPT_FILE=rv-dirty-prompt.txt; SKILL=spec-review;         SEED_SUB=seed-done ;;
  fnd-rv-zero)  FIXTURE=FND-EPIC; PROMPT_FILE=rv-zero-prompt.txt;  SKILL=spec-review;         SEED_SUB=seed-done ;;
  fnd-sb-kid)   FIXTURE=FND-EPIC; PROMPT_FILE=sb-kid-prompt.txt;   SKILL=stage-breakdown-doc; SEED_SUB=seed-done; TURN2_FILE=go-turn2.txt; TURNS_CAP=2 ;;
  # Эпик со спекой #0 после очистки контекста: дети-наследники — из «наследуют:» в INT-0 (2026-10-31).
  fnd-resume)   FIXTURE=FND-RESUME; PROMPT_FILE=resume-prompt.txt; SKILL=analyst-workspace; STUBS_SUB=stubs ;;
  # шаг 3 п.2б PLAN-FROM-POCOCK: разрез после 2б — изменение существующего во владении этапа, потребление извне. grade-sb-blue.mjs
  sb-blue-yes) FIXTURE=SB-BLUE; PROMPT_FILE=yes-prompt.txt; SKILL=stage-breakdown-doc; TURN2_FILE=go-turn2.txt; TURNS_CAP=2 ;;
  sb-blue-idk) FIXTURE=SB-BLUE; PROMPT_FILE=idk-prompt.txt; SKILL=stage-breakdown-doc; TURN2_FILE=go-turn2.txt; TURNS_CAP=2 ;;
  sb-blue-cr)  FIXTURE=SB-BLUE; PROMPT_FILE=cr-prompt.txt;  SKILL=stage-breakdown-doc; TURN2_FILE=go-turn2.txt; TURNS_CAP=2 ;;
  sb-blue-new) FIXTURE=SB-BLUE; PROMPT_FILE=new-prompt.txt; SKILL=stage-breakdown-doc; TURN2_FILE=go-turn2.txt; TURNS_CAP=2 ;;
  sb-blue-na)  FIXTURE=SB-BLUE; PROMPT_FILE=na-prompt.txt;  SKILL=stage-breakdown-doc ;;
  # ── `spec-readiness`: достаточно ли спеки, чтобы писать код ────────────────────────────────
  # Как и приёмка, ничего не пишет на диск: артефакт — `answer.md` из stdout. Парное плечо без
  # скилла гоняется отдельным `run-ctl.sh` на той же фикстуре — оно и есть знаменатель.
  # SCX — маршрут мелкой правки после 5.74–5.81: Р9 у запроса на правку, вопросы без порога, стык «по документу сверху»,
  # чужой сервис — потребление; приёмка и разрез на выходе. README фикстур SCX-*; грейдеры grade-scx-cr|ts|down.mjs.
  scx-cr-nob)   FIXTURE=SCX-CR;   PROMPT_FILE=nob-w-prompt.txt;    SKILL=change-request-doc ;;
  scx-cr-own)   FIXTURE=SCX-CR;   PROMPT_FILE=own-w-prompt.txt;    SKILL=change-request-doc ;;
  scx-cr-api-q) FIXTURE=SCX-CR;   PROMPT_FILE=api-q-prompt.txt;    SKILL=change-request-doc ;;
  scx-cr-ver-q) FIXTURE=SCX-CR;   PROMPT_FILE=ver-q-prompt.txt;    SKILL=change-request-doc ;;
  scx-ts-doc)   FIXTURE=SCX-TS;   PROMPT_FILE=doc-prompt.txt;      SKILL=technical-spec-doc ;;
  scx-ts-dep)   FIXTURE=SCX-TS;   PROMPT_FILE=dep-prompt.txt;      SKILL=technical-spec-doc ;;
  scx-ts-fld)   FIXTURE=SCX-TS;   PROMPT_FILE=fld-prompt.txt;      SKILL=technical-spec-doc ;;
  scx-rv-doc)   FIXTURE=SCX-DOWN; PROMPT_FILE=rv-doc-prompt.txt;   SKILL=spec-review ;;
  scx-rv-dep)   FIXTURE=SCX-DOWN; PROMPT_FILE=rv-dep-prompt.txt;   SKILL=spec-review ;;
  scx-rv-dirty) FIXTURE=SCX-DOWN; PROMPT_FILE=rv-dirty-prompt.txt; SKILL=spec-review ;;
  scx-sb-doc)   FIXTURE=SCX-DOWN; PROMPT_FILE=sb-doc-prompt.txt;   SKILL=stage-breakdown-doc; TURN2_FILE=go-turn2.txt; TURNS_CAP=2 ;;
  scx-sb-dep)   FIXTURE=SCX-DOWN; PROMPT_FILE=sb-dep-prompt.txt;   SKILL=stage-breakdown-doc ;;
  sr-gap)    FIXTURE=SR-GAP;    PROMPT_FILE=sr-prompt.txt;   SKILL=spec-readiness ;;
  # шаг 4 п.2б PLAN-FROM-POCOCK: готовность после 2б — изменение существующего наше, строка «Существующий стык» чужая. grade-sr-blue.mjs
  sr-blue-yes) FIXTURE=SR-BLUE; PROMPT_FILE=yes-prompt.txt; SKILL=spec-readiness ;;
  sr-blue-idk) FIXTURE=SR-BLUE; PROMPT_FILE=idk-prompt.txt; SKILL=spec-readiness ;;
  sr-blue-cr)  FIXTURE=SR-BLUE; PROMPT_FILE=cr-prompt.txt;  SKILL=spec-readiness ;;
  # Свод и сверка без субагентов: роли поданы готовыми в `roles-output.md`. Мерит Шаги 3–4 на
  # замороженном входе — см. `fixtures/SR-VERIFY/README.md`. Ключ `KEY.md` в песочницу не едет.
  sr-verify) FIXTURE=SR-VERIFY; PROMPT_FILE=sr-verify-prompt.txt; SKILL=spec-readiness ;;
  # Сторож ложного срабатывания: спека реализуема, законный исход — «блокеров: 0».
  sr-clean)  FIXTURE=SR-CLEAN;  PROMPT_FILE=sr-prompt.txt;   SKILL=spec-readiness ;;
  # Ловушка: `services/itsm.md` набита конкретикой, которой в спеке нет. Ни один её литерал не
  # имеет права попасть в отчёт, и ни одна 🟡-карточка — в блокеры.
  sr-yellow) FIXTURE=SR-YELLOW; PROMPT_FILE=sr-prompt.txt;   SKILL=spec-readiness ;;
  # Спека РЕАЛЬНОГО багфикса: маленькая, вопросов мало. На ней у человека проявился хвост
  # после отчёта — замечание про §8 и перечень закрытых вопросов, которых в форме нет.
  sr-bugfix) FIXTURE=SR-BUGFIX; PROMPT_FILE=sr-prompt.txt;   SKILL=spec-readiness ;;
  # Дифференцирующий тест фикстуры, а не скилла: `SR-GAP` обязана быть чистой ПО ФОРМЕ. Приёмка
  # нашла нарушение — значит фикстура мерит форму, а не реализуемость, и чинить надо её.
  rv-srgap)  FIXTURE=SR-GAP;    PROMPT_FILE=rv-prompt.txt;   SKILL=spec-review ;;
  # У `BR-ROLES` засев лежит подпапкой (`seed/`), а не всей фикстурой: рядом с ним живут второй
  # засев под тех-спеку и четыре промпта разных плеч.
  br-roles-w) FIXTURE=BR-ROLES; PROMPT_FILE=w-prompt.txt; SKILL=business-requirements-doc; SEED_SUB=seed ;;
  br-roles-q) FIXTURE=BR-ROLES; PROMPT_FILE=q-prompt.txt; SKILL=business-requirements-doc; SEED_SUB=seed ;;
  # ── первый ход интервью: ПРЕДМЕТ вопроса, а не его форма ─────────────────────────────────
  # Засев пуст намеренно: ни `services/`, ни `context/`. Правило «сразу за ключом — суть задачи»
  # срабатывает только когда предложить нечего; положи сюда карточку — и проба начнёт мерить то
  # же, что `br-ctx`. Плечи не складываются: у `q` законный исход — вопросы без файла, у `w` —
  # записанный файл с выведенным типом изменения.
  br-open-q)  FIXTURE=BR-OPEN; PROMPT_FILE=q-prompt.txt; SKILL=business-requirements-doc ;;
  br-open-w)  FIXTURE=BR-OPEN; PROMPT_FILE=w-prompt.txt; SKILL=business-requirements-doc ;;
  # Оценка ответа (PLAN-BR-COMB, 2026-10-02). `br-var` — пере-строгость: на ходе 2 закрыто всё, часть
  # коротко → файл, «Готово к оценке». `br-half` — недо-строгость: ход 2 пропускает риски и критерий
  # второго требования → добор, файла нет; ход 3 откладывает риски → файл с TBD в §2.3. Окружение пустое.
  # Потолок ходов обязателен: трассы нет, без него реплика хода 2 ушла бы ещё раз третьим ходом.
  br-var)     FIXTURE=BR-VAR;  PROMPT_FILE=brief-prompt.txt; SKILL=business-requirements-doc; TURN2_FILE=var-turn2.txt; TURNS_CAP=2 ;;
  br-half)    FIXTURE=BR-HALF; PROMPT_FILE=brief-prompt.txt; SKILL=business-requirements-doc; TURN2_FILE=half-turn2.txt; TURN3_FILE=half-t3-turn2.txt; TURNS_CAP=3 ;;
  # Доказательство правок 1.1.1: `br-nocrit` — критерий второго требования не дан ни разу («сформулировать
  # не могу, пиши») → в БТ нет выдуманного критерия; `br-yes` — «да» на гипотезы по ценности/цели/рискам/
  # потребителям/интеграциям закрывает гейты → файл этим ходом (одноходовая, «ПРОДОЛЖЕНИЕ»).
  br-nocrit)  FIXTURE=BR-NOCRIT; PROMPT_FILE=brief-prompt.txt; SKILL=business-requirements-doc; TURN2_FILE=nocrit-turn2.txt; TURN3_FILE=nocrit-t3-turn2.txt; TURNS_CAP=3 ;;
  br-yes)     FIXTURE=BR-YES; PROMPT_FILE=yes-prompt.txt; SKILL=business-requirements-doc ;;
  # п.2 PLAN-FROM-POCOCK: пример на границе в критерии с числом (сумма, срок, количество). grade-br-lim.mjs --case=q|w
  br-lim-q)   FIXTURE=BR-LIM; PROMPT_FILE=q-prompt.txt; SKILL=business-requirements-doc ;;
  br-lim-w)   FIXTURE=BR-LIM; PROMPT_FILE=w-prompt.txt; SKILL=business-requirements-doc ;;
  # Замена терминов 5.35 (2026-10-06): БТ с несколькими частями → таблица §4.5 и вопрос в ответе, без «слайс»/
  # «деливербл». Одноходовая, «ПРОДОЛЖЕНИЕ». Грейдер — `grade-terms.mjs --case=cut`.
  br-cut)     FIXTURE=BR-CUT; PROMPT_FILE=cut-prompt.txt; SKILL=business-requirements-doc ;;
  # То же, что br-nocrit, но стоп после хода 2: прод — это ход 2, ход 3 сам подсказывает исправление (2026-10-03).
  br-nocrit2) FIXTURE=BR-NOCRIT; PROMPT_FILE=brief-prompt.txt; SKILL=business-requirements-doc; TURN2_FILE=nocrit-turn2.txt; TURNS_CAP=2 ;;
  # Та же тема на других входах (2026-10-03), стоп после хода 2. `br-ncl` — отпуска: критерии по номерам у (1) и
  # (3), у (2) «руководитель согласует» нет. `br-ncr` — ремонт: сквозной критерий покрывает (1)–(2), у (3) «отчёт» нет.
  # Грейдер — `grade-br-nocrit.mjs --case=leave|report`.
  br-ncl)     FIXTURE=BR-NC-LEAVE; PROMPT_FILE=brief-prompt.txt; SKILL=business-requirements-doc; TURN2_FILE=leave-turn2.txt; TURNS_CAP=2 ;;
  br-ncr)     FIXTURE=BR-NC-REPORT; PROMPT_FILE=brief-prompt.txt; SKILL=business-requirements-doc; TURN2_FILE=report-turn2.txt; TURNS_CAP=2 ;;
  # Вторая партия (2026-10-03): `br-nclib` — библиотека, сквозной критерий без действия (2) «библиотекарь видит брони»;
  # `br-nccan` — столовая, сквозной называет (1) и (3), среднее звено (2) «сводка повару» — нет; `br-nclap` — КОНТРОЛЬ:
  # сквозной называет оба действия, верно записать без переспроса.
  br-nclib)   FIXTURE=BR-NC-LIB; PROMPT_FILE=brief-prompt.txt; SKILL=business-requirements-doc; TURN2_FILE=lib-turn2.txt; TURNS_CAP=2 ;;
  br-nccan)   FIXTURE=BR-NC-CANTEEN; PROMPT_FILE=brief-prompt.txt; SKILL=business-requirements-doc; TURN2_FILE=canteen-turn2.txt; TURNS_CAP=2 ;;
  br-nclap)   FIXTURE=BR-NC-LAPTOP; PROMPT_FILE=brief-prompt.txt; SKILL=business-requirements-doc; TURN2_FILE=laptop-turn2.txt; TURNS_CAP=2 ;;
  # Новые разделы БТ 1.2.0 (PLAN-BR-SECTIONS, 2026-10-07): §4.3 «Бизнес-данные» (гейт 15), §1.4 «Как сейчас» (16),
  # §3.4 «Внешние зависимости» (17). `br-data-*` — гейт 15: объекты гипотезой, сведения ни вопросом, ни гипотезой;
  # `obj`/`dlt*`/`asis-card` — поверх карточек BR-REAL (`SEED_SUB=seed`), `none`/`asis-new` — без окружения.
  # `br-data-file` — регресс прода: состав данных в файле пользователя, один ход «ПРОДОЛЖЕНИЕ». `br-deps-*` — гейт 17,
  # один ход. Грейдеры — `grade-br-data.mjs`, `grade-br-asis.mjs`, `grade-br-deps.mjs` (`--case=` — хвост имени пробы).
  br-data-obj)  FIXTURE=BR-DATA-CARDS; PROMPT_FILE=obj-prompt.txt;  SKILL=business-requirements-doc; SEED_SUB=seed; TURN2_FILE=obj-turn2.txt;  TURNS_CAP=2 ;;
  br-data-dlt0) FIXTURE=BR-DATA-CARDS; PROMPT_FILE=dlt-prompt.txt;  SKILL=business-requirements-doc; SEED_SUB=seed; TURN2_FILE=dlt0-turn2.txt; TURNS_CAP=2 ;;
  br-data-dlt1) FIXTURE=BR-DATA-CARDS; PROMPT_FILE=dlt-prompt.txt;  SKILL=business-requirements-doc; SEED_SUB=seed; TURN2_FILE=dlt1-turn2.txt; TURNS_CAP=2 ;;
  br-asis-card) FIXTURE=BR-DATA-CARDS; PROMPT_FILE=asis-prompt.txt; SKILL=business-requirements-doc; SEED_SUB=seed; TURN2_FILE=asis-turn2.txt; TURNS_CAP=2 ;;
  br-data-none) FIXTURE=BR-DATA-NONE;  PROMPT_FILE=none-prompt.txt;    SKILL=business-requirements-doc; TURN2_FILE=none-turn2.txt;    TURNS_CAP=2 ;;
  br-asis-new)  FIXTURE=BR-DATA-NONE;  PROMPT_FILE=asisnew-prompt.txt; SKILL=business-requirements-doc; TURN2_FILE=asisnew-turn2.txt; TURNS_CAP=2 ;;
  br-data-file) FIXTURE=BR-DATA-FILE;  PROMPT_FILE=file-prompt.txt;     SKILL=business-requirements-doc; SEED_SUB=seed ;;
  br-deps-yes)  FIXTURE=BR-DEPS;       PROMPT_FILE=deps-yes-prompt.txt; SKILL=business-requirements-doc ;;
  br-deps-no)   FIXTURE=BR-DEPS;       PROMPT_FILE=deps-no-prompt.txt;  SKILL=business-requirements-doc ;;
  # Эпик лежит НЕ в `coddoc/<KEY>/`, а в спек-репе `AI-SDD/coddoc/PSS-40/`; в корне песочницы при этом
  # есть настоящая `coddoc/` с документацией продукта. Меряется якорь пути: дети обязаны лечь ВНУТРЬ
  # папки эпика. Второе плечо — тот же эпик ВСТАВЛЕН ТЕКСТОМ и на диске отсутствует: гейт обязан
  # отказать, а не резать по сообщению. Засевы разные, поэтому `SEED_SUB`.
  td-path-w)  FIXTURE=TD-PATH; PROMPT_FILE=w-prompt.txt;     SKILL=task-decomposition-doc; SEED_SUB=seed ;;
  td-gate)    FIXTURE=TD-PATH; PROMPT_FILE=paste-prompt.txt; SKILL=task-decomposition-doc; SEED_SUB=seed-paste ;;
  # Раскладка, принесённая с живой работы: ключ эпика `T-T-M-1.2` НЕ матчит regex гейта, у детей
  # ключи настоящие (AAA-1..4), а рядом под `coddoc/` лежит обычная задача `OPS-77` — то есть
  # шаблон «ключ задачи → своя папка под coddoc/» прогон видит на диске. Красный исход отсюда и
  # приехал: дети легли СИБЛИНГАМИ папки эпика.
  td-alias)   FIXTURE=TD-PATH; PROMPT_FILE=alias-prompt.txt; SKILL=task-decomposition-doc; SEED_SUB=seed-alias ;;
  # Тот же эпик, что `td-path-w`, но БТ и реплика аналитика — в словах 5.35 («части», не «слайсы»). Меряется
  # §4.5 ребёнка «это часть эпика» и отсутствие старых слов. Грейдеры — `grade-td-path.mjs` + `grade-terms.mjs --case=td`.
  td-ru-w)    FIXTURE=TD-RU;   PROMPT_FILE=w-prompt.txt;     SKILL=task-decomposition-doc; SEED_SUB=seed ;;
  # ── `context-doc`: импорт документа человека в `context/` ─────────────────────────────────
  # Главная проба набора — `cdoc-xlsx`: источник НЕ читается (конвертера в окружении нет), и
  # законный исход — отсутствие файла. Гейт описания в её промпте снят заранее, иначе «файла нет»
  # получалось бы по неверной причине: прогон просто ждёт согласования описания.
  cdoc-xlsx)  FIXTURE=CD-XLSX; PROMPT_FILE=x-prompt.txt; SKILL=context-doc ;;
  # Одна фикстура, два плеча, отличие — один абзац промпта: снят гейт описания или нет. Складывать
  # их числа нельзя, у плеч разные законные исходы (файл против вопроса) — см. `br-roles-w/q`.
  cdoc-txt)   FIXTURE=CD-TXT;  PROMPT_FILE=w-prompt.txt; SKILL=context-doc ;;
  cdoc-txt-q) FIXTURE=CD-TXT;  PROMPT_FILE=q-prompt.txt; SKILL=context-doc ;;
  # Противовес `cdoc-xlsx`: офисный файл, который РЕАЛЬНО распаковывается, — отказ здесь дефект.
  cdoc-docx)  FIXTURE=CD-DOCX; PROMPT_FILE=d-prompt.txt; SKILL=context-doc ;;
  cdoc-fix)   FIXTURE=CD-FIX;  PROMPT_FILE=f-prompt.txt; SKILL=context-doc ;;
  cdoc-dup)   FIXTURE=CD-DUP;  PROMPT_FILE=u-prompt.txt; SKILL=context-doc ;;
  # Вторая вставка из чата на ДРУГУЮ тему (аудит, С33): у любого текста из чата `source` один и тот
  # же, а правило Шага 5 по букве велит перезаписать файл с тем же источником. Цел ли прежний файл.
  cdoc-paste) FIXTURE=CD-PASTE; PROMPT_FILE=paste-prompt.txt; SKILL=context-doc ;;

  # ── `bug-report-doc`: описание дефекта ────────────────────────────────────────────────────
  # Одно дерево, шесть плеч (как `CD-TXT` и `BR-ROLES`). Отличие плеч — только сообщение
  # аналитика; окружение у всех одно, поэтому числа сравнимы между собой.
  #
  # В дереве лежит `coddoc/ARS-102/` — спека вкладки расчёта ГБР на карточке инцидента. Для
  # `bg-role-w` это ЯКОРЬ: ожидаемое поведение там записано (§4.4, §5.3), и скилл обязан
  # сослаться путём и разделом. Для `bg-flick-w` и `bg-form-w` это ЛОВУШКА: их дефекты живут на
  # других экранах, и приписанный им `ARS-102` — нарушение. Одно дерево ловит оба провала.
  #
  # Плечи `-w` дают ответы аналитика заранее («это ПРОДОЛЖЕНИЕ», как у `ts-ctx`) и меряют
  # ЗАПИСАННЫЙ ФАЙЛ. Плечи `-q` дают голое описание и меряют, ЧТО СПРОШЕНО и что файла нет.
  # Складывать их числа нельзя: законные исходы разные.
  bg-flick-w)  FIXTURE=BG-INC; PROMPT_FILE=flick-w-prompt.txt;  SKILL=bug-report-doc ;;
  bg-flick-q)  FIXTURE=BG-INC; PROMPT_FILE=flick-q-prompt.txt;  SKILL=bug-report-doc ;;
  bg-form-w)   FIXTURE=BG-INC; PROMPT_FILE=form-w-prompt.txt;   SKILL=bug-report-doc ;;
  bg-role-w)   FIXTURE=BG-INC; PROMPT_FILE=role-w-prompt.txt;   SKILL=bug-report-doc ;;
  # Ключа в сообщении нет намеренно — Gate 0 обязан заблокировать запись.
  bg-data-q)   FIXTURE=BG-INC; PROMPT_FILE=data-q-prompt.txt;   SKILL=bug-report-doc ;;
  # Негативный случай: новая возможность в жалобной форме, баг-репорта быть не должно.
  bg-notbug-q) FIXTURE=BG-INC; PROMPT_FILE=notbug-q-prompt.txt; SKILL=bug-report-doc ;;
  # Фронтовый баг, правило которого лежит в карточке БЭКЕНДА (аудит, С13): у карточки фронта
  # «Бизнес-правил» нет по форме. Первый ход: ожидаемое пришло гипотезой из правила или вхолодную.
  bg-front-q)  FIXTURE=BG-FRONT; PROMPT_FILE=front-q-prompt.txt; SKILL=bug-report-doc ;;
  # ── `change-request-doc`: запрос на мелкую правку ─────────────────────────────────────────
  # Одно дерево, то же, что у BG-INC (слепок и ARS-102-ловушка). Плечи `-w` дают ответы аналитика
  # заранее и мерят ФАЙЛ; плечи `-q` дают голое описание и мерят СТОРОЖ: разбор по пяти строкам,
  # вердикт и то, что файла нет. `cr-notsmall-q` — мягкий стоп (вопрос «правка или БТ», не отказ),
  # `cr-idea-q` и `cr-bug-q` — жёсткие (файла нет, назван другой маршрут).
  cr-btn-w)      FIXTURE=CR-SMALL; PROMPT_FILE=btn-w-prompt.txt;      SKILL=change-request-doc ;;
  cr-rework-w)   FIXTURE=HDR-CR;   PROMPT_FILE=rework-w-prompt.txt;   SKILL=change-request-doc ;;
  cr-btn-q)      FIXTURE=CR-SMALL; PROMPT_FILE=btn-q-prompt.txt;      SKILL=change-request-doc ;;
  cr-api-w)      FIXTURE=CR-SMALL; PROMPT_FILE=api-w-prompt.txt;      SKILL=change-request-doc ;;
  cr-notsmall-q) FIXTURE=CR-SMALL; PROMPT_FILE=notsmall-q-prompt.txt; SKILL=change-request-doc ;;
  cr-idea-q)     FIXTURE=CR-SMALL; PROMPT_FILE=idea-q-prompt.txt;     SKILL=change-request-doc ;;
  cr-bug-q)      FIXTURE=CR-SMALL; PROMPT_FILE=bug-q-prompt.txt;      SKILL=change-request-doc ;;
  # п.2 PLAN-FROM-POCOCK: лимит фотографий паспорта 10 → 25, пример на границе у «как должно стать». grade-cr-lim.mjs --case=q|w
  cr-lim-q)      FIXTURE=CR-SMALL; PROMPT_FILE=lim-q-prompt.txt;      SKILL=change-request-doc ;;
  cr-lim-w)      FIXTURE=CR-SMALL; PROMPT_FILE=lim-w-prompt.txt;      SKILL=change-request-doc ;;

  # ── спека на багфикс: режим `technical-spec-doc` по баг-репорту ───────────────────────────
  # Флаг багфикса изображён промптом — проводник про багфикс ещё не знает (шаг 8 плана). Дерево
  # своё, а не `BG-INC`: там `bg-flick-w` сама пишет в `coddoc/ARS-312/`, и готовый репорт в
  # песочнице дал бы ей найти собственный выход засеянным.
  bf-spec)     FIXTURE=BF-SPEC; PROMPT_FILE=spec-prompt.txt; SKILL=technical-spec-doc ;;
  # ── BFX: багфикс, починка меняет контракт (вид «изменение существующего»); флаг изображён промптом, как у bf-spec.
  # Два засева: путь в репорте (рукопись) → 🔵 «по документу сверху»; репорт без путей + карточка и «да» → 🔵 «по карточке».
  bfx-doc)  FIXTURE=BFX-SPEC; PROMPT_FILE=doc-prompt.txt;  SKILL=technical-spec-doc; SEED_SUB=seed-doc ;;
  bfx-card) FIXTURE=BFX-SPEC; PROMPT_FILE=card-prompt.txt; SKILL=technical-spec-doc; SEED_SUB=seed-card ;;
  # приёмка и разрез такой спеки (BFX-DOWN, MTR-512 — рукопись до первого зелёного bfx-doc). grade-bfx-rv.mjs, grade-bfx-sb.mjs
  rv-bfx-clean)  FIXTURE=BFX-DOWN; PROMPT_FILE=rv512-prompt.txt; SKILL=spec-review ;;
  rv-bfx-nomark) FIXTURE=BFX-DOWN; PROMPT_FILE=rv514-prompt.txt; SKILL=spec-review ;;
  rv-bfx-was)    FIXTURE=BFX-DOWN; PROMPT_FILE=rv515-prompt.txt; SKILL=spec-review ;;
  rv-bfx-nosrc)  FIXTURE=BFX-DOWN; PROMPT_FILE=rv516-prompt.txt; SKILL=spec-review ;;
  sb-bfx)        FIXTURE=BFX-DOWN; PROMPT_FILE=sb-prompt.txt;    SKILL=stage-breakdown-doc; TURN2_FILE=go-turn2.txt; TURNS_CAP=2 ;;

  # ── лишние тех-гейты у багфикса: BF-GATE, два ВОПРОСНЫХ плеча ─────────────────────────────
  # Ответов аналитика заранее НЕТ — законный исход по скиллу «turn 1 = questions only»: список
  # вопросов и ни одного файла. Грейдится `answer.md`, как у `br-ctx` и `bg-*-q`.
  #
  # `bfg-scroll` — дефект не про доступ/нагрузку/выкат/ошибки: меряется ПЕРЕБОР вопросов.
  # `bfg-role`   — дефект ПРО доступ: сторож обратного отказа. Если правка научит скилл молчать
  #                про роли вообще, покраснеет здесь. Складывать числа плеч нельзя.
  bfg-scroll)  FIXTURE=BF-GATE; PROMPT_FILE=scroll-q-prompt.txt; SKILL=technical-spec-doc ;;
  bfg-role)    FIXTURE=BF-GATE; PROMPT_FILE=role-q-prompt.txt;   SKILL=technical-spec-doc ;;

  # ── МАРШРУТ проводника: под-скиллы заглушены ──────────────────────────────────────────────
  # Меряется только переход по шагам: какой скилл вызван, в каком порядке, что передано, зашёл ли
  # в разрез. Документы не производятся — заглушки кладут предзаписанные из `prebaked/`.
  #
  # Грейдится `_trace.log`, который заглушки пишут на диск, а НЕ формулировка отчёта: агент может
  # рассказать о вызове, не сделав его, и наоборот. То же правило, что «грейдить файл, а не отчёт».
  #
  # `rt-bug` — багфикс мимо БТ и мимо разреза; `rt-feature` — сторож: обычная задача обязана
  # по-прежнему уходить в `business-requirements-doc`, иначе правка входа сломала основной путь.
  rt-bug)      FIXTURE=RT-BUG; PROMPT_FILE=bug-prompt.txt;     SKILL=analyst-workspace; STUBS_SUB=stubs TURN2_FILE=bug-turn2.txt NODE_FILE=node-split-turn2.txt ;;
  rt-feature)  FIXTURE=RT-BUG; PROMPT_FILE=feature-prompt.txt; SKILL=analyst-workspace; STUBS_SUB=stubs TURN2_FILE=feature-turn2.txt NODE_FILE=node-split-turn2.txt ;;
  # `rt-feature-gate` — гейт 2Б после записи БТ: тот же маршрут, но промпт НЕ отвечает заранее про
  # разрез (заглушка БТ пишет §4.5 «не применимо»). На `rt-feature` модель отвечала на вопрос гейта
  # строкой промпта «резать не нужно» — стенд подсказывал ответ. Грейд: `--probe=feature-gate`.
  rt-feature-gate) FIXTURE=RT-BUG; PROMPT_FILE=feature-gate-prompt.txt; SKILL=analyst-workspace; STUBS_SUB=stubs TURN2_FILE=feature-turn2.txt NODE_FILE=node-split-turn2.txt ;;
  # ПОРЯДОК НА ВХОДЕ. Правка 2026-08-18 убрала лишний ход: проводник больше не спрашивает ключ
  # задачи сам — его спрашивает под-скилл своим Gate 0, и порядок теперь «кнопка → меню БТ/баг →
  # под-скилл». Два плеча выше этого НЕ ВИДЯТ: ключ подан в их промптах строкой «Ключ задачи: …»,
  # то есть к моменту развилки он уже есть и спрашивать нечего. Отсюда два плеча ниже.
  #
  # `rt-menu` — Шаг 1Б: кнопка нажата, тип НЕ назван, ключа нет. Верный исход — ход остановлен
  # одним вопросом из двух вариантов, ключ не спрошен, ни один под-скилл не вызван.
  rt-menu)     FIXTURE=RT-BUG; PROMPT_FILE=menu-prompt.txt;    SKILL=analyst-workspace; STUBS_SUB=stubs ;;
  # `rt-nokey` — тот же дефект, что в `rt-bug`, но ключа нет НИГДЕ. Маршрут обязан дойти до
  # `bug-report-doc`, а не встать с требованием назвать ключ. Заглушка при непереданном ключе
  # берёт `ARS-312`, поэтому пути ниже по маршруту те же и числа сопоставимы с `rt-bug` напрямую.
  rt-nokey)    FIXTURE=RT-BUG; PROMPT_FILE=nokey-prompt.txt;   SKILL=analyst-workspace; STUBS_SUB=stubs TURN2_FILE=nokey-turn2.txt NODE_FILE=node-split-turn2.txt ;;
  rt-noreview) FIXTURE=RT-BUG; PROMPT_FILE=noreview-prompt.txt; SKILL=analyst-workspace; STUBS_SUB=stubs TURN2_FILE=bug-turn2.txt NODE_FILE=node-split-turn2.txt ;;
  rt-noreview-bare) FIXTURE=RT-BUG; PROMPT_FILE=noreview-bare-prompt.txt; SKILL=analyst-workspace; STUBS_SUB=stubs TURN2_FILE=bug-turn2.txt NODE_FILE=node-split-turn2.txt ;;
  rt-noreview-ru) FIXTURE=RT-BUG; PROMPT_FILE=noreview-ru-prompt.txt; SKILL=analyst-workspace; STUBS_SUB=stubs TURN2_FILE=bug-turn2.txt NODE_FILE=node-split-turn2.txt ;;
  # УЗЕЛ «ЧТО ДАЛЬШЕ?» (`analyst-workspace` 2.0.0): после спеки один вопрос из четырёх вариантов.
  # `NODE_FILE` — реплика аналитика на узел (раннер подставляет её, опознав узел в ответе прошлого
  # хода); остальные ходы — прежняя нейтральная реплика. Плечи выше идут по ветке «Разбить на этапы».
  # `rt-check` — ветка «Проверить спеку»: `spec-readiness` вызван на путь спеки, узел задан снова тем
  # же ходом, этапы не тронуты. Заменяет `rt-nosplit`: двоичного вопроса про этапы больше нет.
  rt-check)    FIXTURE=RT-BUG; PROMPT_FILE=bug-prompt.txt;     SKILL=analyst-workspace; STUBS_SUB=stubs TURN2_FILE=bug-turn2.txt NODE_FILE=node-check-turn2.txt ;;
  # `rt-fix` — ветка «Доработать спеку»: спека запущена второй раз, после неё приёмка, затем узел снова.
  # Потолок 12: Haiku тратит ход на каждый под-скилл, и в пилоте восьми не хватило дойти до второго узла.
  rt-fix)      FIXTURE=RT-BUG; PROMPT_FILE=bug-prompt.txt;     SKILL=analyst-workspace; STUBS_SUB=stubs TURN2_FILE=bug-turn2.txt NODE_FILE=node-fix-turn2.txt TURNS_CAP=12 ;;
  # `rt-other` — ветка «Начать другую задачу»: после выбора — стартовый вопрос, и ни одного вызова сверх маршрута.
  rt-other)    FIXTURE=RT-BUG; PROMPT_FILE=bug-prompt.txt;     SKILL=analyst-workspace; STUBS_SUB=stubs TURN2_FILE=bug-turn2.txt NODE_FILE=node-other-turn2.txt ;;
  # `rt-open` — тот же маршрут, что `rt-bug`, но спека «Требуются уточнения (2)»: порядок вариантов узла
  # обязан совпасть с `rt-bug` (в 3.2 первый вариант развилки выбирался по статусу). Грейд `--probe=bug`.
  rt-open)     FIXTURE=RT-OPEN; PROMPT_FILE=bug-prompt.txt;    SKILL=analyst-workspace; STUBS_SUB=stubs TURN2_FILE=bug-turn2.txt NODE_FILE=node-split-turn2.txt ;;
  # `rt-epic` — «Продолжить начатое» на эпике с готовыми спеками (#0 + три ребёнка): узел первым ходом,
  # затем «Проверить спеку» — `spec-readiness` на каждую спеку уровня, #0 первой, и узел снова.
  rt-epic)     FIXTURE=RT-EPIC; PROMPT_FILE=epic-prompt.txt;   SKILL=analyst-workspace; STUBS_SUB=stubs TURN2_FILE=epic-turn2.txt NODE_FILE=node-check-turn2.txt ;;
  # `rt-srgap` — ЖИВОЙ `spec-readiness` в треде оркестратора: готовый БТ PSS-2210 → спека (заглушка
  # печатает спеку `SR-GAP` целиком, как живой автор) → узел → «Проверить спеку». Меряется, держит ли
  # проверка свои правила в загрязнённом треде: роли подняты, ведущий спеку не читал. Грейд —
  # `grade-rt-srgap.mjs`. Дорого: четыре субагента на прогон.
  # `rt-e2e` — СКВОЗНОЙ стык «проверка → доработка», оба под-скилла ЖИВЫЕ: готовая спека PSS-2210 (спека `SR-GAP`)
  # подхвачена «Продолжить начатое» → узел → «Проверить спеку» (живой `spec-readiness`) → узел → «Доработать
  # спеку по пунктам 1–3» (живой `technical-spec-doc`, проход доработки) → вопросы гипотезой → ответ
  # «1, 2 — да; 3 — не знаю» → запись → приёмка (заглушка) → узел. Грейд — `grade-rt-e2e.mjs` + дифф глазами.
  rt-e2e)      FIXTURE=RT-E2E; PROMPT_FILE=e2e-prompt.txt; SKILL=analyst-workspace; STUBS_SUB=stubs TURN2_FILE=e2e-turn2.txt NODE_FILE=node-check-turn2.txt NODE2_FILE=node-fix13-turn2.txt REAL_SUBS="spec-readiness technical-spec-doc" TURNS_CAP=10 ;;
  rt-srgap)    FIXTURE=RT-SRGAP; PROMPT_FILE=srgap-prompt.txt; SKILL=analyst-workspace; STUBS_SUB=stubs TURN2_FILE=srgap-turn2.txt NODE_FILE=node-check-turn2.txt REAL_SUBS=spec-readiness ;;
  # Ветка «Продолжить начатое»: на диске лежит ТОЛЬКО баг-репорт, спеки под него нет. Проверяется,
  # опознан ли он сводкой состояния (глоб ветки его раньше не видел вовсе) и уходит ли маршрут в
  # спеку с флагом багфикса, а не по кругу в `bug-report-doc`. Рядом чужая `ARS-102` с полным
  # комплектом — ловушка на подстановку соседнего документа.
  rt-cont)     FIXTURE=RT-CONT; PROMPT_FILE=cont-prompt.txt; SKILL=analyst-workspace; STUBS_SUB=stubs ;;
  # `rt-gate` — гейт Шага 2Б (правка 1.2.0, 2026-09-22): на диске готовый чистый БТ, аналитик приносит
  # его готовым. Верный исход — приёмка, чтение, ход ОСТАНОВЛЕН вопросом «принят — идём дальше?»;
  # `technical-spec-doc` запускается только следующим ходом. Заглушки дают чистый документ нарочно:
  # до правки такой документ уезжал в спеку без остановки.
  # `rt-count-*` — гейт 2Б на ЧИСТОМ документе сверху (нарушений 0, открытых вопросов 0): верно — без «Поправить»
  # (stage-bt.md:67–68, :105–106). Приёмка — заглушка в форме `spec-review` 1.5.0: у БТ счётных строк нет, у запроса
  # одна строка 🔵. Прежние плечи на строках о границе (stubs/count) и контроль bt0/cr0 (stubs/bare) слиты в `stubs`.
  # Конец — запись спеки, потолок 4 хода. Грейд — `grade-rt-count.mjs` (кейс по имени плеча). Состав — fixtures/RT-COUNT/expected.md.
  rt-count-bt)  FIXTURE=RT-COUNT; PROMPT_FILE=bt-prompt.txt; SKILL=analyst-workspace; STUBS_SUB=stubs; TURN2_FILE=count-turn2.txt; TURNS_CAP=4; DONE_RE='/coddoc/[^/]+/technical_specification\.md$' ;;
  rt-count-cr)  FIXTURE=RT-COUNT; PROMPT_FILE=cr-prompt.txt; SKILL=analyst-workspace; STUBS_SUB=stubs; TURN2_FILE=count-turn2.txt; TURNS_CAP=4; DONE_RE='/coddoc/[^/]+/technical_specification\.md$' ;;
  rt-gate)     FIXTURE=RT-GATE; PROMPT_FILE=gate-prompt.txt; SKILL=analyst-workspace; STUBS_SUB=stubs TURN2_FILE=gate-turn2.txt NODE_FILE=node-split-turn2.txt ;;

  # ── приёмка баг-репорта ───────────────────────────────────────────────────────────────────
  # Главное плечо здесь ЧИСТОЕ, а не грязное: у проверяющего инструмента худший отказ — покраснеть
  # на корректном документе. Список, который краснит зря, перестают читать целиком, и вместе с
  # ложными находками теряются настоящие. Та же логика, что у сторожа `rv-clean`.
  #
  # Чистый документ — ЗАМОРОЖЕННЫЙ ВЫХОД ПРОГОНА `bg-flick-w` из круга 2, а не рукопись
  # (происхождение записано в `fixtures/RV-BUG/PROVENANCE.txt`). Так проверка идёт по тому, что
  # скилл реально пишет, а не по идеалу, которого он не производит.
  rv-bug-clean) FIXTURE=RV-BUG; PROMPT_FILE=clean-prompt.txt; SKILL=spec-review ;;
  rv-bug-dirty) FIXTURE=RV-BUG; PROMPT_FILE=dirty-prompt.txt; SKILL=spec-review ;;
  # Доработка ГОТОВОГО баг-репорта по находкам приёмки (К5 аудита 2026-09-17), ответов аналитика нет:
  # верный исход — свой файл правится на месте там, где хватает данных, вопросы только по находкам,
  # ключ не переспрошен, нового файла нет. Читается по файлу и `answer.md` вручную.
  bg-rework-q) FIXTURE=RV-BUG; PROMPT_FILE=rework-q-prompt.txt; SKILL=bug-report-doc ;;
  # Доработка с ответами: файл обязан быть записан, грейдится шапка (`grade-header.mjs`).
  bg-rework-w) FIXTURE=HDR-BUG; PROMPT_FILE=rework-w-prompt.txt; SKILL=bug-report-doc ;;
  # Спека на багфикс рядом с баг-репортом: источником обязан уйти РЕПОРТ, а пункт 3 обязан найти
  # FR-1 в его «Ожидаемом результате» и НЕ покраснеть за «требование без контракта» — §2 у багфикса
  # законно «не применимо». Два разных провала, различимы в одном отчёте: приёмка называет пути
  # вслух, поэтому непереданный источник виден прямо, а ложная находка — это пункт 3.
  rv-bug-spec)  FIXTURE=RV-BUG; PROMPT_FILE=spec-prompt.txt; SKILL=spec-review ;;
  # РАЗЛИЧАЮЩАЯ проба под правило источника. У ARS-314 репорт несёт FR-1, а §7 спеки его не
  # трассирует. Источник передан → пункт 3 обязан назвать «требование без критерия приёмки».
  # Источник НЕ передан → пункт 3 молчит, и «нарушений: 0» получается сам собой. Без этой пробы
  # чистый вердикт на `rv-bug-spec` не отличить от неработающего правила: он выходит в обоих случаях.
  # ── `archive-spec` 2.0: архивация спеки запускает ре-скан, карточки скилл не пишет ─────────
  # Проб `archive-spec` в этом раннере не было вовсе: раунд 2026-07-31 гонял их вручную, и с тех
  # пор менять скилл было нечем. `service-map` в песочницу НЕ ставится намеренно — проба меряет,
  # кого архиватор назовёт в скан и что скажет человеку, а не сам скан (он мерится на SM-REAL).
  arreal)    FIXTURE=AR-REAL;   PROMPT_FILE=ar-prompt.txt;    SKILL=archive-spec; TURN2_FILE=ar-turn2.txt; STUBS_SUB=stubs ;;
  arbasic)   FIXTURE=AR-BASIC;  PROMPT_FILE=ar-prompt.txt;    SKILL=archive-spec; TURN2_FILE=ar-turn2.txt; STUBS_SUB=stubs ;;
  arepic)    FIXTURE=AR-EPIC;   PROMPT_FILE=ar-prompt.txt;    SKILL=archive-spec; TURN2_FILE=ar-turn2.txt; STUBS_SUB=stubs ;;
  arlate)    FIXTURE=AR-LATE;   PROMPT_FILE=ar-prompt.txt;    SKILL=archive-spec; TURN2_FILE=ar-turn2.txt; STUBS_SUB=stubs ;;
  arnocard)  FIXTURE=AR-NOCARD; PROMPT_FILE=ar-prompt.txt;    SKILL=archive-spec; TURN2_FILE=ar-turn2.txt; STUBS_SUB=stubs ;;
  artype)    FIXTURE=AR-TYPE;   PROMPT_FILE=ar-prompt.txt;    SKILL=archive-spec; TURN2_FILE=ar-turn2.txt; STUBS_SUB=stubs ;;
  # Пачка релиза — основной путь архивации: несколько ключей, один скан, история карточек.
  arbatch)   FIXTURE=AR-BATCH;  PROMPT_FILE=ar-prompt.txt;    SKILL=archive-spec; TURN2_FILE=ar-turn2.txt; STUBS_SUB=stubs ;;
  rv-bug-src)   FIXTURE=RV-BUG; PROMPT_FILE=src-prompt.txt;  SKILL=spec-review ;;
  # ── `sdd-quality-audit`: баллы БТ и спек по папке coddoc/ из восьми фич ────────────────────────
  # Хорошая, та же в старом шаблоне, частичная, «протыканная», багфикс, эпик с фундаментом. Отчёт —
  # файл `sdd-quality-report.md` в корне песочницы; грейдер `grade-sq.mjs`, эталон — `fixtures/SQ-AUDIT/README.md`.
  # Скилл живёт вне набора аналитика — в корне репозитория, поэтому путь к нему задан явно.
  sq-audit)  FIXTURE=SQ-AUDIT;  PROMPT_FILE=audit-prompt.txt; SKILL=sdd-quality-audit; SKILL_DIR="$HERE/../../sdd-quality-audit" ;;

  # ── `notes-to-intent` 1.0.0: готовый список пунктов → вход для БТ или спеки (2026-10-15). Засев — документы задачи
  # и список `*.points.md`; реплика одна на все ходы. Грейдер — `grade-ni.mjs --fx <FX>`, ожидания — fixtures/NI-*/README.md.
  ni-vac)     FIXTURE=NI-VAC;     PROMPT_FILE=w-prompt.txt; SKILL=notes-to-intent; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=10; IDLE_MAX=10; DONE_RE='/coddoc/.*/meeting-2026-10-07-(bt|spec)\.md$'; MEET_ENV=1 ;;
  ni-acc)     FIXTURE=NI-ACC;     PROMPT_FILE=w-prompt.txt; SKILL=notes-to-intent; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=10; IDLE_MAX=10; DONE_RE='/coddoc/.*/meeting-2026-10-09-(bt|spec)\.md$'; MEET_ENV=1 ;;
  ni-new)     FIXTURE=NI-NEW;     PROMPT_FILE=w-prompt.txt; SKILL=notes-to-intent; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=10; IDLE_MAX=10; DONE_RE='/coddoc/.*/meeting-2026-10-08-(bt|spec)\.md$'; MEET_ENV=1 ;;
  ni-chg)     FIXTURE=NI-CHG;     PROMPT_FILE=w-prompt.txt; SKILL=notes-to-intent; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=10; IDLE_MAX=10; DONE_RE='/coddoc/.*/meeting-2026-10-15-(bt|spec)\.md$'; MEET_ENV=1 ;;
  ni-cr)      FIXTURE=NI-CR;      PROMPT_FILE=w-prompt.txt; SKILL=notes-to-intent; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=10; IDLE_MAX=10; DONE_RE='/coddoc/.*/meeting-2026-10-16-(bt|spec)\.md$'; MEET_ENV=1 ;;
  ni-rew)     FIXTURE=NI-REW;     PROMPT_FILE=w-prompt.txt; SKILL=notes-to-intent; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=10; IDLE_MAX=10; DONE_RE='/coddoc/.*/meeting-2026-10-14-(bt|spec)\.md$'; MEET_ENV=1 ;;
  ni-mr-new)  FIXTURE=NI-MR-NEW;  PROMPT_FILE=w-prompt.txt; SKILL=notes-to-intent; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=10; IDLE_MAX=10; DONE_RE='/coddoc/.*/meeting-2026-10-14-(bt|spec)\.md$'; MEET_ENV=1 ;;
  ni-mr-chg)  FIXTURE=NI-MR-CHG;  PROMPT_FILE=w-prompt.txt; SKILL=notes-to-intent; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=10; IDLE_MAX=10; DONE_RE='/coddoc/.*/meeting-2026-10-14-(bt|spec)\.md$'; MEET_ENV=1 ;;
  ni-nb-in)   FIXTURE=NI-NB-IN;   PROMPT_FILE=w-prompt.txt; SKILL=notes-to-intent; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=10; IDLE_MAX=10; DONE_RE='/notebook-2026-10-15-(bt|spec)\.md$'; MEET_ENV=1 ;;
  ni-nb-ans)  FIXTURE=NI-NB-ANS;  PROMPT_FILE=w-prompt.txt; SKILL=notes-to-intent; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=10; IDLE_MAX=10; DONE_RE='/notebook-2026-10-15-(bt|spec)\.md$'; MEET_ENV=1 ;;
  ni-nb-pick) FIXTURE=NI-NB-PICK; PROMPT_FILE=w-prompt.txt; SKILL=notes-to-intent; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=10; IDLE_MAX=10; DONE_RE='/notebook-2026-10-15-(bt|spec)\.md$'; MEET_ENV=1 ;;
  # analyst-notebook 1.2.0: список пунктов в ноут, выгрузка `собери пункты`, расшифровка по ссылке — строка. Грейдер grade-nb.mjs.
  nb-pts-in)  FIXTURE=NB-PTS-IN;  PROMPT_FILE=w-prompt.txt; SKILL=analyst-notebook; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=5; IDLE_MAX=5; DONE_GREP='points\.md|^### [0-9]+ .{0,4}(В|в)стреча'; MEET_ENV=1 ;;
  nb-pts-new) FIXTURE=NB-PTS-NEW; PROMPT_FILE=w-prompt.txt; SKILL=analyst-notebook; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=5; IDLE_MAX=5; DONE_RE='/notes/[^/]+/notebook\.md$'; MEET_ENV=1 ;;
  nb-pts-rec) FIXTURE=NB-PTS-REC; PROMPT_FILE=w-prompt.txt; SKILL=analyst-notebook; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=5; IDLE_MAX=5; DONE_GREP='points\.md|^### [0-9]+ .{0,4}(В|в)стреча'; MEET_ENV=1 ;;
  nb-export)  FIXTURE=NB-EXPORT;  PROMPT_FILE=w-prompt.txt; SKILL=analyst-notebook; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=3; IDLE_MAX=3; DONE_RE='/notes/[^/]+/notebook-20[0-9][0-9]-[0-9][0-9]-[0-9][0-9](-2)?\.points\.md$'; MEET_ENV=1 ;;
  nb-export-since) FIXTURE=NB-EXPORT-SINCE; PROMPT_FILE=w-prompt.txt; SKILL=analyst-notebook; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=3; IDLE_MAX=3; DONE_RE='/notes/[^/]+/notebook-20[0-9][0-9]-[0-9][0-9]-[0-9][0-9](-2)?\.points\.md$'; MEET_ENV=1 ;;
  nb-route)   FIXTURE=NB-ROUTE;   PROMPT_FILE=w-prompt.txt; SKILL=analyst-notebook; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=2; IDLE_MAX=2; MEET_ENV=1 ;;
  nb-desc-one) FIXTURE=NB-DESC-ONE; PROMPT_FILE=w-prompt.txt; SKILL=analyst-notebook; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=5; IDLE_MAX=5; DONE_GREP='Кисел'; MEET_ENV=1 ;;
  nb-desc-two) FIXTURE=NB-DESC-TWO; PROMPT_FILE=w-prompt.txt; SKILL=analyst-notebook; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=5; IDLE_MAX=5; DONE_GREP='Кисел'; MEET_ENV=1 ;;
  nb-auto)    FIXTURE=NB-AUTO;    PROMPT_FILE=w-prompt.txt; SKILL=analyst-notebook; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=5; IDLE_MAX=5; DONE_GREP='Кисел'; AUTO_SKILL=1; MEET_ENV=1 ;;
  # ── Срез 1.1 петли (PLAN-LOOP-HARDEN, 2026-10-16): пробы на стыки, ветки исправления, живые входы ───────────────────
  # `twin-objector.md` — двойник, который отвечает по карточке и возражает там, где она велит; `w-turn2.txt` при нём —
  # заглушка: без файла реплики пул не крутит ходы.
  meet-workshop) FIXTURE=MEET-WORKSHOP; PROMPT_FILE=w-prompt.txt; SKILL=meeting-intake; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=20; IDLE_MAX=20; DONE_RE='/coddoc/.*/meeting-[^/]*\.points\.md$'; MEET_ENV=1 ;;
  meet-nonames) FIXTURE=MEET-NONAMES; PROMPT_FILE=w-prompt.txt; SKILL=meeting-intake; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=20; IDLE_MAX=20; DONE_RE='/coddoc/.*/meeting-[^/]*\.points\.md$'; MEET_ENV=1 ;;
  meet-notes) FIXTURE=MEET-NOTES; PROMPT_FILE=w-prompt.txt; SKILL=meeting-intake; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=20; IDLE_MAX=20; DONE_RE='/coddoc/.*/meeting-[^/]*\.points\.md$'; MEET_ENV=1 ;;
  meet-sameday) FIXTURE=MEET-SAMEDAY; PROMPT_FILE=w-prompt.txt; SKILL=meeting-intake; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=20; IDLE_MAX=20; DONE_RE='/coddoc/.*/meeting-2026-10-19-2\.points\.md$'; DONE_GREP='^> Встреча:.*14:[0-5][0-9]'; MEET_ENV=1 ;;
  meet-twin)  FIXTURE=MEET-TWIN;  PROMPT_FILE=w-prompt.txt; SKILL=meeting-intake; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=20; IDLE_MAX=20; DONE_RE='/coddoc/.*/meeting-[^/]*\.points\.md$'; TWIN_CARD=twin-card.md; TWIN_PROMPT=twin-objector.md; MEET_ENV=1 ;;
  rec-finish) FIXTURE=REC-FINISH; PROMPT_FILE=w-prompt.txt; SKILL=meeting-recall; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=30; IDLE_MAX=30; DONE_RE='/coddoc/(.*/)?meeting-[^/]*\.points\.md$'; DONE_GREP='^# Пункты:'; TWIN_CARD=twin-card.md; MEET_ENV=1 ;;
  rec-cont)   FIXTURE=REC-CONT;   PROMPT_FILE=w-prompt.txt; SKILL=meeting-recall; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=24; IDLE_MAX=24; DONE_RE='/coddoc/(.*/)?meeting-[^/]*\.points\.md$'; DONE_GREP='^# Пункты:'; TWIN_CARD=twin-card.md; MEET_ENV=1 ;;
  ni-spec-bt) FIXTURE=NI-SPEC-BT; PROMPT_FILE=w-prompt.txt; SKILL=notes-to-intent; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=10; IDLE_MAX=10; DONE_RE='/coddoc/.*/meeting-2026-10-13-(bt|spec)\.md$'; MEET_ENV=1 ;;
  ni-nb-repeat) FIXTURE=NI-NB-REPEAT; PROMPT_FILE=w-prompt.txt; SKILL=notes-to-intent; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=10; IDLE_MAX=10; DONE_RE='/notebook-2026-10-14-(spec|2-bt|bt-2|2-spec)\.md$'; MEET_ENV=1 ;;
  ni-twin)    FIXTURE=NI-TWIN;    PROMPT_FILE=w-prompt.txt; SKILL=notes-to-intent; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=12; IDLE_MAX=12; DONE_RE='/coddoc/.*/meeting-2026-10-12-(bt|spec)\.md$'; TWIN_CARD=twin-card.md; TWIN_PROMPT=twin-objector.md; MEET_ENV=1 ;;
  # ── Папка задач `coddoc/` (CHANGELOG 5.71): рядом лежит старая `docs/` с чужими задачами — ищут, читают и пишут
  # в `coddoc/`. DONE_RE без папки: вход, записанный в `docs/`, тоже кончает диалог — грейдер `grade-legacy.mjs`.
  cd-legacy-ni) FIXTURE=CD-LEGACY; PROMPT_FILE=ni-prompt.txt; SKILL=notes-to-intent; SEED_SUB=seed; TURN2_FILE=ni-turn2.txt; TURNS_CAP=10; IDLE_MAX=10; DONE_RE='/notebook-2026-10-14-(bt|spec)\.md$'; MEET_ENV=1 ;;
  cd-legacy-br) FIXTURE=CD-LEGACY; PROMPT_FILE=br-prompt.txt; SKILL=business-requirements-doc; SEED_SUB=seed ;;
  nb-big-export) FIXTURE=NB-BIG; PROMPT_FILE=w-prompt-export.txt; SKILL=analyst-notebook; SEED_SUB=seed; TURN2_FILE=w-turn2-export.txt; TURNS_CAP=3; IDLE_MAX=3; DONE_RE='/notes/[^/]+/notebook-20[0-9][0-9]-[0-9][0-9]-[0-9][0-9](-2)?\.points\.md$'; MEET_ENV=1 ;;
  nb-big-view)   FIXTURE=NB-BIG; PROMPT_FILE=w-prompt-view.txt;   SKILL=analyst-notebook; SEED_SUB=seed; TURN2_FILE=w-turn2-view.txt;   TURNS_CAP=5; IDLE_MAX=5; DONE_RE='/notes/[^/]+/[^/]*-20[0-9][0-9]-[0-9][0-9]-[0-9][0-9](-2)?\.md$'; MEET_ENV=1 ;;
  nb-twin)    FIXTURE=NB-TWIN;    PROMPT_FILE=w-prompt.txt; SKILL=analyst-notebook; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=6; IDLE_MAX=6; DONE_GREP='получател'; TWIN_CARD=twin-card.md; TWIN_PROMPT=twin-objector.md; MEET_ENV=1 ;;
  # analyst-notebook 2.0.0 (PLAN-NOTEBOOK-STATE.md): номер у пункта и пометка на старой строке. Конец — пометка на пункте,
  # которого касается правка (в засеве её нет); без скобок с `‖` и кириллицей: grep вне UTF-8 читает скобки побайтно.
  # Оценщик — grade-nbs.mjs --fx <ФИКСТУРА> (у nb-chain-ask — --spec state-ask.json); цепочки — run-chain.sh nb-chain-*.
  nb-ans-repl) FIXTURE=NB-ANS-REPL; PROMPT_FILE=w-prompt.txt; SKILL=analyst-notebook; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=5; IDLE_MAX=5; DONE_GREP='№1\.1 ?‖ ?замен(е|ё)н'; MEET_ENV=1 ;;
  nb-stale)    FIXTURE=NB-STALE;    PROMPT_FILE=w-prompt.txt; SKILL=analyst-notebook; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=5; IDLE_MAX=5; DONE_GREP='№1\.1 ?‖ ?замен(е|ё)н'; MEET_ENV=1 ;;
  nb-prefix)   FIXTURE=NB-PREFIX;   PROMPT_FILE=w-prompt.txt; SKILL=analyst-notebook; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=5; IDLE_MAX=5; DONE_GREP='№1\.3 ?‖ ?замен(е|ё)н|№1\.2 ?‖ ?замен(е|ё)н'; MEET_ENV=1 ;;
  nb-reingest) FIXTURE=NB-REINGEST; PROMPT_FILE=w-prompt.txt; SKILL=analyst-notebook; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=2; IDLE_MAX=2; MEET_ENV=1 ;;
  nb-handedit) FIXTURE=NB-HANDEDIT; PROMPT_FILE=w-prompt.txt; SKILL=analyst-notebook; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=5; IDLE_MAX=5; DONE_GREP='Фомич(е|ё)в Р\. ?‖ ?замен(е|ё)н|вместо: 2026-10-06 №1\.3'; MEET_ENV=1 ;;
  nb-chain-export) FIXTURE=NB-CHAIN-READ; PROMPT_FILE=w-prompt-export.txt; SKILL=analyst-notebook; SEED_SUB=seed; TURN2_FILE=w-turn2-export.txt; TURNS_CAP=3; IDLE_MAX=3; DONE_RE='/notes/[^/]+/notebook-20[0-9][0-9]-[0-9][0-9]-[0-9][0-9](-2)?\.points\.md$'; MEET_ENV=1 ;;
  nb-chain-ask)    FIXTURE=NB-CHAIN-READ; PROMPT_FILE=w-prompt-ask.txt;    SKILL=analyst-notebook; SEED_SUB=seed; TURN2_FILE=w-turn2-ask.txt;    TURNS_CAP=2; IDLE_MAX=2; MEET_ENV=1 ;;
  nb-huge-export)  FIXTURE=NB-HUGE;       PROMPT_FILE=w-prompt.txt;        SKILL=analyst-notebook; SEED_SUB=seed; TURN2_FILE=w-turn2.txt;        TURNS_CAP=3; IDLE_MAX=3; DONE_RE='/notes/[^/]+/notebook-20[0-9][0-9]-[0-9][0-9]-[0-9][0-9](-2)?\.points\.md$'; MEET_ENV=1 ;;
  # Исправление записи (Р3): поправка — новой записью и пометкой на старой строке.
  nb-fix-author)  FIXTURE=NB-FIX-AUTHOR;  PROMPT_FILE=w-prompt.txt; SKILL=analyst-notebook; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=5; IDLE_MAX=5; DONE_GREP='№1\.2 ?‖ ?замен(е|ё)н'; MEET_ENV=1 ;;
  nb-fix-drop)    FIXTURE=NB-FIX-DROP;    PROMPT_FILE=w-prompt.txt; SKILL=analyst-notebook; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=5; IDLE_MAX=5; DONE_GREP='‖ ?снят'; MEET_ENV=1 ;;
  nb-fix-wrong)   FIXTURE=NB-FIX-WRONG;   PROMPT_FILE=w-prompt.txt; SKILL=analyst-notebook; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=5; IDLE_MAX=5; DONE_GREP='№1\.2 ?‖ ?снят'; MEET_ENV=1 ;;
  nb-fix-inplace) FIXTURE=NB-FIX-INPLACE; PROMPT_FILE=w-prompt.txt; SKILL=analyst-notebook; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=5; IDLE_MAX=5; DONE_GREP='№1\.3 ?‖ ?замен(е|ё)н'; MEET_ENV=1 ;;
  nb-fix-noref)   FIXTURE=NB-FIX-NOREF;   PROMPT_FILE=w-prompt.txt; SKILL=analyst-notebook; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=5; IDLE_MAX=5; DONE_GREP='№1\.2 ?‖ ?замен(е|ё)н'; MEET_ENV=1 ;;
  # Р5: список встречи без находок — запись без вопроса (реплика не согласие); со спором — вопрос остаётся.
  nb-pts-plain)   FIXTURE=NB-PTS-PLAIN;   PROMPT_FILE=w-prompt.txt; SKILL=analyst-notebook; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=3; IDLE_MAX=3; DONE_GREP='исходник: coddoc/_inbox/meeting-2026-10-18'; MEET_ENV=1 ;;
  nb-pts-spor)    FIXTURE=NB-PTS-SPOR;    PROMPT_FILE=w-prompt.txt; SKILL=analyst-notebook; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=5; IDLE_MAX=5; DONE_GREP='исходник: coddoc/_inbox/meeting-2026-10-18'; MEET_ENV=1 ;;
  # Ф1–Ф5 (шаг 5): сторона спора, тот же предмет — другой вопрос, обновлённое сведение, ответ с предметом, граница.
  nb-spor-side)   FIXTURE=NB-SPOR-SIDE;   PROMPT_FILE=w-prompt.txt; SKILL=analyst-notebook; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=2; IDLE_MAX=2; MEET_ENV=1 ;;
  nb-same-stem)   FIXTURE=NB-SAME-STEM;   PROMPT_FILE=w-prompt.txt; SKILL=analyst-notebook; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=5; IDLE_MAX=5; DONE_GREP='оплаты на кассе'; MEET_ENV=1 ;;
  nb-fact-upd)    FIXTURE=NB-FACT-UPD;    PROMPT_FILE=w-prompt.txt; SKILL=analyst-notebook; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=5; IDLE_MAX=5; DONE_GREP='№1\.2 ?‖ ?замен(е|ё)н'; MEET_ENV=1 ;;
  nb-ans-subj)    FIXTURE=NB-ANS-SUBJ;    PROMPT_FILE=w-prompt.txt; SKILL=analyst-notebook; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=5; IDLE_MAX=5; DONE_GREP='№1\.4 ?‖ ?закрыт'; MEET_ENV=1 ;;
  nb-scope)       FIXTURE=NB-SCOPE;       PROMPT_FILE=w-prompt.txt; SKILL=analyst-notebook; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=5; IDLE_MAX=5; DONE_GREP='не входит:'; MEET_ENV=1 ;;
  # Р6–Р8 (шаг 6): роли из шапки списка в шапку ноута, старая встреча принята позже, новый ноут без «цель:».
  nb-pts-roles)   FIXTURE=NB-PTS-ROLES;   PROMPT_FILE=w-prompt.txt; SKILL=analyst-notebook; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=3; IDLE_MAX=3; DONE_GREP='исходник: coddoc/_inbox/meeting-2026-10-18'; MEET_ENV=1 ;;
  nb-late-event)  FIXTURE=NB-LATE-EVENT;  PROMPT_FILE=w-prompt.txt; SKILL=analyst-notebook; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=5; IDLE_MAX=5; DONE_GREP='исходник: coddoc/_inbox/meeting-2026-10-12'; MEET_ENV=1 ;;
  nb-no-goal)     FIXTURE=NB-NO-GOAL;     PROMPT_FILE=w-prompt.txt; SKILL=analyst-notebook; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=5; IDLE_MAX=5; DONE_RE='/notes/[^/]+/notebook\.md$'; MEET_ENV=1 ;;
  # ── `rehearse` (PLAN-REHEARSE.md, 2026-11-03): репетиция встречи по документу. Файла нет — конец по итогу в ответе
  # (`DONE_ANSWER`); за аналитика — двойник с карточкой пробы и строгим промптом `twin-rehearse.md` (ответ — один раздел
  # карточки дословно: `twin-objector.md` смешивал разделы и досочинял). Оценщик — grade-reh.mjs, состав — fixtures/REH-SHT/README.md.
  reh-arch) FIXTURE=REH-SHT; PROMPT_FILE=arch-prompt.txt; SKILL=rehearse; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=16; IDLE_MAX=16; DONE_ANSWER='Задано вопросов'; ANSWER_ALL=1; TWIN_CARD=twin-arch.md; TWIN_PROMPT=twin-rehearse.md; MEET_ENV=1 ;;
  reh-sec)  FIXTURE=REH-SHT; PROMPT_FILE=sec-prompt.txt;  SKILL=rehearse; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=16; IDLE_MAX=16; DONE_ANSWER='Задано вопросов'; ANSWER_ALL=1; TWIN_CARD=twin-sec.md;  TWIN_PROMPT=twin-rehearse.md; MEET_ENV=1 ;;
  reh-cust) FIXTURE=REH-SHT; PROMPT_FILE=cust-prompt.txt; SKILL=rehearse; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=16; IDLE_MAX=16; DONE_ANSWER='Задано вопросов'; ANSWER_ALL=1; TWIN_CARD=twin-cust.md; TWIN_PROMPT=twin-rehearse.md; MEET_ENV=1 ;;
  reh-stop) FIXTURE=REH-SHT; PROMPT_FILE=arch-prompt.txt; SKILL=rehearse; SEED_SUB=seed; TURN2_FILE=w-turn2.txt; TURNS_CAP=8;  IDLE_MAX=8;  DONE_ANSWER='Задано вопросов'; ANSWER_ALL=1; TWIN_CARD=twin-stop.md; TWIN_PROMPT=twin-rehearse.md; MEET_ENV=1 ;;
  *) echo "неизвестная проба: '$PROBE'"; echo "есть: bfg-scroll bfg-role ts-live ts-conv ts-conv2 ts-gaps ts-gaps-q ts-vac ts-vac-q ts-vac-lim ts-blue-yes ts-blue-idk ts-acc ts-acc-q id-mmd id-puml id-ask ring-mmd ring-puml dir-mmd dir-puml rep-mmd rep-puml chain-mmd chain-puml det-mmd det-puml rep-det-mmd chain-q-mmd chain-q-idk ring-q-one ring-q-two rep-q-mmd det-q-mmd det-q-puml det-q-alt id-q-mmd id-blue det-short-mmd det-o-one det-o-two det-t-short det-s-mmd det-s-puml det-s-alt det-s-idk det-y-short det-y-scen rep-s-mmd chb-s-mmd chb-s-idk bt-uf-mmd bt-uf-puml bt-uf-idk bt-uf-y pt-sh-mmd pt-sh-idk pt-sh-no pt-uf-puml pt-uf-idk pt-raw pt-nb tx-sh-mmd tx-sh-idk tx-uf-puml pt-junk pt-prose ts-ctx ts-fix ts-nodesc ts-noctx br-ctx br-real br-rework br-rework-q sb-ctx sb-ctx2 sb-blue-yes sb-blue-idk sb-blue-cr sb-blue-new sb-blue-na fnd-zero fnd-kid fnd-rv-kid fnd-rv-dirty fnd-rv-zero fnd-sb-kid fnd-resume sm-graph2 rv-conv rv-clean rv-bt-clean rv-bt-dirty rv-lim-clean rv-lim-dirty rv-crlim-clean rv-crlim-dirty rv-blue-yes rv-blue-idk rv-blue-dirty rv-blue-was rv-blue-cr rv-stage-blue-idk rv-stage-blue-cr rv-fe rv-tpl-clean rv-tpl-dirty rv-tpl-count rv-stage-na rv-bt-empty rv-bt-no43 br-roles-w br-roles-q br-var br-half br-nocrit br-yes br-lim-q br-lim-w br-cut br-data-obj br-data-dlt0 br-data-dlt1 br-asis-card br-data-none br-asis-new br-data-file br-deps-yes br-deps-no td-ru-w cdoc-xlsx cdoc-txt cdoc-txt-q cdoc-docx cdoc-fix cdoc-dup scx-cr-nob scx-cr-own scx-cr-api-q scx-cr-ver-q scx-ts-doc scx-ts-dep scx-ts-fld scx-rv-doc scx-rv-dep scx-rv-dirty scx-sb-doc scx-sb-dep sr-gap sr-blue-yes sr-blue-idk sr-blue-cr sr-verify rv-bug-clean rv-bug-dirty rv-bug-spec rv-bug-src bf-spec bfx-doc bfx-card rv-bfx-clean rv-bfx-nomark rv-bfx-was rv-bfx-nosrc sb-bfx rt-bug rt-feature rt-menu rt-nokey rt-noreview rt-check rt-count-bt rt-count-cr rt-fix rt-other rt-open rt-epic rt-srgap rt-cont bg-flick-w bg-flick-q bg-form-w bg-role-w bg-data-q bg-notbug-q cr-btn-w cr-btn-q cr-api-w cr-notsmall-q cr-idea-q cr-bug-q cr-lim-q cr-lim-w sq-audit meet-vac meet-acc meet-long meet-new meet-rew meet-chg meet-cr jm-br-vac jm-br-long jm-br-new jm-ts-acc jm-ts-rew rec-new rec-chg rec-inline nb-new nb-thought nb-contra nb-noauth nb-file nb-view-api nb-view-chat nb-dispute nb-answer nb-ask nb-long nb-view-part meet-out meet-eth204 meet-eth150 ni-vacni-acc ni-new ni-chg ni-cr ni-rew ni-mr-new ni-mr-chg ni-nb-in ni-nb-ans ni-nb-pick nb-pts-in nb-pts-new nb-pts-rec nb-export nb-export-since nb-route nb-desc-one nb-desc-two nb-auto nb-ans-repl nb-stale nb-prefix nb-reingest nb-handedit nb-chain-export nb-chain-ask nb-huge-export nb-fix-author nb-fix-drop nb-fix-wrong nb-fix-inplace nb-fix-noref nb-pts-plain nb-pts-spor nb-spor-side nb-same-stem nb-fact-upd nb-ans-subj nb-scope nb-pts-roles nb-late-event nb-no-goal reh-arch reh-sec reh-cust reh-stop"; exit 1 ;;
esac

SKILL_DIR="${SKILL_DIR:-$HERE/../$SKILL}"

# Потолок пробы сильнее внешнего значения: пул — дочерний процесс и читает переменную из окружения.
[ -n "$TURNS_CAP" ] && export RT_MAX_TURNS="$TURNS_CAP"
[ -n "$DONE_RE" ] && export RT_DONE_RE="$DONE_RE"
[ -n "$IDLE_MAX" ] && export RT_IDLE_MAX="$IDLE_MAX"
[ -n "$DONE_GREP" ] && export RT_DONE_GREP="$DONE_GREP"
[ -n "$DONE_ANSWER" ] && export RT_DONE_ANSWER="$DONE_ANSWER"
[ -n "$ANSWER_ALL" ] && export RT_ANSWER_ALL_TEXT=1
if [ -n "$TWIN_CARD" ]; then
  export RT_TWIN="$HERE/fixtures/$FIXTURE/$TWIN_CARD" RT_TWIN_PROMPT="$HERE/${TWIN_PROMPT:-twin-analyst.md}"
fi
if [ -n "$MEET_ENV" ]; then
  export RUN_TIMEOUT="${RUN_TIMEOUT:-3600}" SM_MODEL="${SM_MODEL:-claude-sonnet-5}" CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0
fi
. "$HERE/model-id.sh"
. "$HERE/copy-once.sh"
SM_MODEL="$(model_id "${SM_MODEL:-}" claude-sonnet-5)" || exit 2
RT_TWIN_MODEL="$(model_id "${RT_TWIN_MODEL:-}" claude-sonnet-5-5)" || exit 2
export SM_MODEL RT_TWIN_MODEL

[ -n "$ROUND" ] || { echo "usage: ./run-ctx.sh <проба> <папка-раунда> <N> [параллельность]"; exit 1; }
[ -f "$POOL" ]  || { echo "нет раннера: $POOL"; exit 1; }

FIXTURE_DIR="$HERE/fixtures/$FIXTURE"
PROMPT="$FIXTURE_DIR/$PROMPT_FILE"
[ -f "$PROMPT" ] || { echo "нет промпта: $PROMPT"; exit 1; }

mkdir -p "$ROUND/_skills"
SNAP_KEEP="$ROUND/_skills/$SKILL.SKILL.md"
if [ -f "$SNAP_KEEP" ]; then
  echo "снимок скилла уже есть — прогон читает ЕГО: $SNAP_KEEP"
else
  copy_once "$SKILL_DIR/SKILL.md" "$SNAP_KEEP"
  echo "снимок скилла: $SNAP_KEEP"
fi
# ПРОГОН ЧИТАЕТ КОПИЮ СНИМКА ВНЕ РЕПОЗИТОРИЯ. Единственный путь, который прогон получает внутрь
# репы, — это путь к скиллу; получив его, часть прогонов уходит бродить по соседним папкам и
# пишет результат в фикстуру (2026-08-14: три случая). В папке раунда снимок остаётся для
# журнала, но читается он из /tmp — оттуда идти некуда.
# ПУТЬ К СНИМКУ — В ФОРМЕ, КОТОРУЮ ЧИТАЕТ ИНСТРУМЕНТ `Read`. Поймано 2026-09-22 на `rt-gate`: путь
# `/tmp/…` — это git-bash, а `Read` у прогона виндовый, и на нём он отвечает «File does not exist».
# Прогон либо выкручивался (`find` + `cat`, вывод уезжал в persisted-output — так было во всех
# раундах с 2026-08-14, `rt-feat10` 10/10 прочитали, `rt-base10` 8/10), либо НЕ читал скилл вовсе и
# шёл к заглушкам по смыслу промпта (`rt-gate-pilot2`: 0/2 прочитали). Второй исход — замер без
# измеряемого текста, и он неотличим от «скилл прочитан, правило не сработало». Файлы стадий
# `reference/stage-*.md` через `cat` не открыл ни один прогон.
# `cygpath -m` даёт `C:/Users/…/Temp` — тот же каталог вне репозитория, но в форме, которую `Read`
# принимает. Нет `cygpath` (не Windows) — прежний `/tmp`.
# СНИМОК — СВОЙ НА КАЖДОЕ ПЛЕЧО: проба и PID в имени. Был один на раунд (`<раунд>-skills`), а конец
# плеча его сносит (ниже) — две пробы одного раунда параллельно, и соседняя теряла скилл посреди
# прогонов (2026-10-22: 13 из 30; 2026-10-30 — снова). Теперь каждое плечо сносит только своё.
SEED_TMP="/tmp"
command -v cygpath >/dev/null 2>&1 && SEED_TMP="$(cygpath -m /tmp)"
SNAP_ROOT="${SKILL_EVAL_SEED_ROOT:-$SEED_TMP/skill-eval-seed}/$(basename "$ROUND")-$PROBE-$$-skills"
mkdir -p "$SNAP_ROOT/$SKILL"
SNAP="$SNAP_ROOT/$SKILL/SKILL.md"
cp "$SNAP_KEEP" "$SNAP"
# ПАПКА `reference/` — ЧАСТЬ ИЗМЕРЯЕМОГО ТЕКСТА, И БЕЗ НЕЁ СНИМОК ЛЖЁТ. `spec-review` держит в
# `SKILL.md` только маршрут, а сами правила — в `reference/checklist-*.md`; `technical-spec-doc`
# держит там шаблон спеки. Снимая один `SKILL.md`, раннер отправлял прогон читать ЖИВОЙ чек-лист:
# круги «до правки» и «после» мерились бы на одном и том же тексте, и разница вышла бы нулевой
# по построению. Кладётся рядом со снимком, поэтому относительный путь `reference/…` из скилла
# ведёт в снимок, а не в репозиторий.
if [ -d "$SKILL_DIR/reference" ]; then
  copy_once "$SKILL_DIR/reference" "$ROUND/_skills/$SKILL.reference"
  rm -rf "$SNAP_ROOT/$SKILL/reference"
  cp -r "$ROUND/_skills/$SKILL.reference" "$SNAP_ROOT/$SKILL/reference"
fi
# Скиллы-соседи снимка, по именам через пробел (пусто → как было). `technical-spec-doc` с 1.6.0 читает
# `../deep-search/reference/from-spec.md` от своего SKILL.md — регресс спеки с `deep-search` рядом, как на проде.
for s in ${EXTRA_SKILLS:-}; do
  copy_once "$HERE/../$s" "$ROUND/_skills/$s"
  rm -rf "$SNAP_ROOT/$s"; cp -r "$ROUND/_skills/$s" "$SNAP_ROOT/$s"
  echo "сосед снимка: $s → $SNAP_ROOT/$s"
done
# Отпечаток дерева рядом со снимком: по нему видно, из какого состояния репы взят текст.
if [ ! -f "$ROUND/_commit.txt" ]; then
  { git -C "$HERE" rev-parse HEAD 2>/dev/null || echo "нет git"; } > "$ROUND/_commit.txt"
  if [ -n "$(git -C "$HERE" status --porcelain 2>/dev/null)" ]; then
    echo "рабочее дерево грязное — источник истины это _skills/" >> "$ROUND/_commit.txt"
  fi
fi

# ─── Караул фикстуры ДО прогона ────────────────────────────────────────────────────────────
# Проверка после плеча опоздала дважды. Прогон записывает результат в фикстуру по абсолютному
# пути (2026-08-14: `ts-conv`, потом `ts-live`), и следующее плечо засевается уже с готовым
# документом — то есть проба «написал ли скилл файл» отвечает «да» сама себе. Поймано на
# `runs/2026-08-14-loop-r1b`: все десять песочниц `ts-live` получили спеку засевом.
#
# Поэтому состав фикстуры фиксируется манифестом и сверяется ПЕРЕД засевом. Расхождение —
# остановка, а не предупреждение: испорченное плечо дешевле не запускать, чем потом опознавать.
MANIFEST="$FIXTURE_DIR/_manifest.txt"
CURRENT="$(cd "$FIXTURE_DIR" && find . -type f -not -name '_manifest.txt' | sed 's|^\./||' | sort)"
if [ -f "$MANIFEST" ]; then
  # Манифест сравнивается без CR: репозиторий с `core.autocrlf=true` отдаёт его с CRLF, а `find`
  # печатает LF, и плечо отказывалось стартовать при неизменённой фикстуре (2026-09-22, `rt-feature`).
  # Сверяется набор, а не порядок: переименование `docs/` → `coddoc/` (5.71) правило манифесты на месте, без пересортировки.
  if ! printf '%s\n' "$CURRENT" | diff -q - <(tr -d '\r' < "$MANIFEST" | sort) >/dev/null 2>&1; then
    echo "!!! СОСТАВ ФИКСТУРЫ $FIXTURE НЕ СОВПАДАЕТ С МАНИФЕСТОМ — прогон не запускался."
    printf '%s\n' "$CURRENT" | diff - <(tr -d '\r' < "$MANIFEST" | sort) | head -20
    echo "Разберись, откуда файл: обычно это прогон, записавший результат в фикстуру."
    echo "Манифест обновляется руками, когда фикстуру меняешь осознанно."
    exit 1
  fi
else
  printf '%s\n' "$CURRENT" > "$MANIFEST"
  echo "манифест фикстуры заведён: $MANIFEST"
fi

# Засев: фикстура без материала стенда. README, промпты и `expected.md` в песочницу не едут —
# прогон, прочитавший их, узнал бы ожидаемый исход и проба стала бы вакуумной.
#
# `expected.md` добавлен в список 2026-08-18, после того как он приехал в песочницу пилота
# `bg-flick-w` целиком — со списком анкеров и перечнем красных исходов. Раньше не срабатывало
# только потому, что фикстуры с таким именем (`RS-*`) гоняются другим раннером: список исключений
# перечислял конкретные имена, а не описывал класс «материал стенда». Пилот из-за этого выброшен
# и переснят.
# ЗАСЕВ ЛЕЖИТ ВНЕ РЕПОЗИТОРИЯ, И ЭТО НЕ ГИГИЕНА, А ИЗОЛЯЦИЯ.
#
# Пока засев лежал в папке раунда (`<раунд>/_seed/<проба>`), он был соседом песочниц и выглядел
# как ещё один рабочий репозиторий: та же `coddoc/<KEY>/business_requirements.md`, тот же
# `context/`. Прогон, промахнувшийся мимо своей директории, писал спеку туда — и ВСЕ последующие
# прогоны плеча копировали её себе засевом. Проба «записал ли скилл файл» отвечала «да» сама
# себе; поймано 2026-08-14 на `_pilot-wrapper` и `loop-r1c/ts-live` — там спека стоит в
# `_seeded.txt` у всех десяти песочниц.
SEED_ROOT="${SKILL_EVAL_SEED_ROOT:-/tmp/skill-eval-seedsrc}"
SEED="$SEED_ROOT/$(basename "$ROUND")-$PROBE"
SEED_SRC="$FIXTURE_DIR${SEED_SUB:+/$SEED_SUB}"
rm -rf "$SEED"; mkdir -p "$SEED"
# `KEY.md` — ключ пробы `sr-verify`: по каждому вопросу сказано, отвечает ли спека. Засеянный в
# песочницу, он превращает замер в списывание: прогон закроет ровно то, что в ключе, и «закрыто
# 12 из 40» будет означать «прочитал ответы», а не «нашёл их в спеке».
( cd "$SEED_SRC" && tar cf - --exclude=README.md --exclude='*-prompt.txt' --exclude='*-turn2.txt' --exclude=_manifest.txt --exclude=expected.md --exclude=KEY.md --exclude=stubs --exclude=PROVENANCE.txt --exclude='truth-*.json' . ) | ( cd "$SEED" && tar xf - )

echo "проба: $PROBE   фикстура: $FIXTURE   скилл: $SKILL"
STUBS_DIR=""
if [ -n "$STUBS_SUB" ]; then
  STUBS_DIR="$FIXTURE_DIR/$STUBS_SUB"
  [ -d "$STUBS_DIR" ] || { echo "нет папки заглушек: $STUBS_DIR"; exit 1; }
  echo "заглушки: $STUBS_SUB → .claude/skills/ песочницы"
fi
# ЖИВЫЕ ПОД-СКИЛЛЫ ПОВЕРХ ЗАГЛУШЕК (`REAL_SUBS`, пусто → как было). Нужно пробе, которая меряет живой
# под-скилл в треде оркестратора (`rt-srgap`: `spec-readiness`). Набор собирается один раз на раунд в
# его папке: заглушки фикстуры плюс снимок скилла из репозитория вместе с `reference/`; снимок остаётся
# в раунде для журнала, и повторный запуск раунда читает его, а не живой текст.
if [ -n "${REAL_SUBS:-}" ] && [ -n "$STUBS_DIR" ]; then
  MIX="$ROUND/_stubs-$PROBE"
  if [ ! -d "$MIX" ]; then
    mkdir -p "$MIX" && cp -r "$STUBS_DIR"/. "$MIX"/
    for s in $REAL_SUBS; do cp -r "$HERE/../$s" "$MIX/"; done
  fi
  STUBS_DIR="$(cd "$MIX" && pwd)"
  echo "живые под-скиллы поверх заглушек: $REAL_SUBS → $MIX"
fi
# Вызов скилла словами (`nb-auto`): снимок с reference/ — набором `.claude/skills/<скилл>/` песочницы, обёртка пула
# не называет ни скилл, ни путь к нему. Набор — в папке раунда: тот же текст, что `_skills/`, и журнал прогона.
if [ -n "$AUTO_SKILL" ]; then
  AUTO="$ROUND/_auto-$PROBE"
  [ -d "$AUTO/$SKILL" ] || { mkdir -p "$AUTO" && cp -r "$SNAP_ROOT/$SKILL" "$AUTO/"; }
  STUBS_DIR="$(cd "$AUTO" && pwd)"
  export RT_NO_SKILL_PATH=1
  echo "вызов словами: снимок скилла → .claude/skills/$SKILL песочницы, путь в обёртке не называется"
fi

TURN2=""
if [ -n "$TURN2_FILE" ]; then
  TURN2="$FIXTURE_DIR/$TURN2_FILE"
  [ -f "$TURN2" ] || { echo "нет файла второго хода: $TURN2"; exit 1; }
  echo "реплика аналитика: $TURN2_FILE   ходов до 2 подряд без движения, потолок ${RT_MAX_TURNS:-8}"
fi
TURN3=""
if [ -n "$TURN3_FILE" ]; then
  TURN3="$FIXTURE_DIR/$TURN3_FILE"
  [ -f "$TURN3" ] || { echo "нет файла третьего хода: $TURN3"; exit 1; }
  echo "реплика хода 3: $TURN3_FILE"
fi
if [ -n "$NODE_FILE" ]; then
  [ -f "$FIXTURE_DIR/$NODE_FILE" ] || { echo "нет файла реплики на узел: $FIXTURE_DIR/$NODE_FILE"; exit 1; }
  export RT_NODE_REPLY="$FIXTURE_DIR/$NODE_FILE"
  echo "реплика на узел «Что дальше?»: $NODE_FILE"
fi
if [ -n "$NODE2_FILE" ]; then
  [ -f "$FIXTURE_DIR/$NODE2_FILE" ] || { echo "нет файла реплики на второй узел: $FIXTURE_DIR/$NODE2_FILE"; exit 1; }
  export RT_NODE_REPLY2="$FIXTURE_DIR/$NODE2_FILE"
  echo "реплика на второй узел: $NODE2_FILE"
fi
# НАСТРОЙКИ, КОТОРЫМИ ПОЛУЧЕНЫ ЧИСЛА, ПИШУТСЯ В ПАПКУ РАУНДА. Снимок скилла уже кладётся сюда по
# той же причине: через неделю «прогоняли с эффортом или без» восстанавливается только из файла.
mkdir -p "$ROUND/$PROBE"
{
  echo "проба: $PROBE"
  echo "модель: ${SM_MODEL:-haiku}"
  echo "effort: ${EFFORT:-умолчание CLI}"
  echo "реплика аналитика: ${TURN2_FILE:-нет, стенд одноходовой}"
  [ -n "$TURN3_FILE" ] && echo "реплика хода 3: $TURN3_FILE"
  [ -n "$NODE_FILE" ] && echo "реплика на узел: $NODE_FILE"
  [ -n "$NODE2_FILE" ] && echo "реплика на второй узел: $NODE2_FILE"
  [ -n "$REAL_SUBS" ] && echo "живые под-скиллы: $REAL_SUBS"
  [ -n "$AUTO_SKILL" ] && echo "вызов словами: скилл в .claude/skills/, путь не назван"
  echo "потолок ходов: ${RT_MAX_TURNS:-8}"
  [ -n "$DONE_RE" ] && echo "конец диалога по файлу: $DONE_RE"
  [ -n "$IDLE_MAX" ] && echo "пустых ходов подряд: $IDLE_MAX"
  [ -n "$DONE_GREP" ] && echo "конец диалога по содержимому coddoc/: $DONE_GREP"
  [ -n "$TWIN_CARD" ] && echo "двойник аналитика: $TWIN_CARD, промпт ${TWIN_PROMPT:-twin-analyst.md}, модель ${RT_TWIN_MODEL:-sonnet}"
  echo "прогонов: $N, параллельность: $CONC"
} > "$ROUND/$PROBE/_settings.txt"
echo "effort: ${EFFORT:-умолчание CLI}"
bash "$POOL" "$SNAP" "$PROMPT" "$ROUND/$PROBE" "$N" "$CONC" "$SEED" "$STUBS_DIR" "$TURN2" ${TURN3:+"$TURN3"}

# ─── Караул фикстуры ────────────────────────────────────────────────────────────────────────
# Запрет в промпте изоляцией НЕ является. Замер 2026-08-14, плечо `ts-conv`: прогон получил
# песочницу рабочей директорией — и записал спеку по АБСОЛЮТНОМУ пути в саму фикстуру
# (`fixtures/TS-CONV/coddoc/ARS-201/technical_specification.md`). Инцидент того же класса, что
# описан в `PROBES.md` правилом №2, и цена та же: следующий прогон засеялся бы уже готовой
# спекой, а «написал сам» стало бы неотличимо от «прочитал написанное».
#
# Караул не мешает прогону — он ловит след. Молча чинить нельзя: испорченное плечо надо
# перегнать, а не подчистить.
#
# Сверяется фикстура с ЗАСЕВОМ, снятым с неё в начале плеча, а не с git: половина фикстур
# не закоммичена, и `git status` показывал бы их целиком как новые — караул, кричащий всегда,
# не караул.
# ВНИМАНИЕ: список материала стенда выписан ДВАЖДЫ — здесь и в исключениях `tar` при засеве выше.
# Добавляешь имя — добавляй в оба места. 2026-08-18: `expected.md` добавили только в засев, и
# караул тут же дал ложную тревогу «фикстура изменилась» на файле, который просто перестал ездить.
DIRT="$(diff -rq "$SEED" "$SEED_SRC" 2>/dev/null | grep -v "README.md\|-prompt.txt\|-turn2.txt\|_manifest.txt\|expected.md\|KEY.md\|stubs\|PROVENANCE\|truth-" || true)"
if [ -n "$DIRT" ]; then
  echo ""
  echo "!!! ФИКСТУРА ИЗМЕНИЛАСЬ ВО ВРЕМЯ ПРОГОНА — плечо недостоверно, перегнать после чистки:"
  echo "$DIRT"
fi

# ─── Снимок из /tmp сносится ПОСЛЕ плеча ───────────────────────────────────────────────────
#
# Комментарий у `SNAP_ROOT` выше обещает: прогон читает копию вне репозитория, «оттуда идти
# некуда». Идти есть куда — к соседям. `/tmp/skill-eval-seed/` копил снимки всех раундов подряд,
# и к 2026-08-21 там лежало под две сотни каталогов, включая `SKILL.md` пятидневной давности.
#
# Разбор журналов 2026-08-21: из тридцати прогонов девятнадцать листали этот каталог (в листинге
# соседи видны все разом, это ещё не беда), а ОДИН — `r23-before/run-10` — сделал `cat` чужого
# `spec-readiness/SKILL.md` из раунда 17 августа: 24 926 байт против измеряемых 28 870. Прогон дал
# 5 из 6, верх плеча, и попал в знаменатель. То есть замер сравнивал правку не с тем текстом.
#
# Снимок нужен только на время плеча: журнальная копия остаётся в `<раунд>/_skills/`, и именно она
# объявлена источником истины. Поэтому по завершении плеча каталог сносится целиком — соседних
# снимков, к которым можно уйти, у следующего раунда просто не будет.
if [ -n "${SNAP_ROOT:-}" ] && [ -d "$SNAP_ROOT" ]; then
  rm -rf "$SNAP_ROOT"
  echo "снимок из /tmp снесён: $SNAP_ROOT (журнальная копия осталась в $ROUND/_skills/)"
fi

# Цена плеча — этой строкой, не суммой руками: при `--resume` `total_cost_usd` накопительный, и
# сложенные ходы завышали цену в 3.5–5 раз (2026-10-15, повторилось 2026-10-18).
bash "$HERE/cost-runs.sh" "$ROUND/$PROBE"
