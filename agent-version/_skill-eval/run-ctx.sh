#!/usr/bin/env bash
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
POOL="$HERE/run-pool-ctx.sh"

# проба → фикстура, файл промпта, скилл. `SEED_SUB` — подпапка засева, если он не вся фикстура.
SEED_SUB=""
# Заглушки под-скиллов: имя подпапки внутри фикстуры. Пусто → в песочницу кладётся один скилл,
# как было. Заводится только у проб, которые меряют МАРШРУТ оркестратора, а не содержание.
STUBS_SUB=""
# Файл с репликой аналитика для ВТОРОГО хода (пусто → проба одноходовая, как была). Нужен только
# пробам маршрута: их отказ наступает на стыке «под-скилл кончил ход → проводник продолжает сам»,
# а одним ходом этот стык не воспроизводится.
TURN2_FILE=""
case "$PROBE" in
  ts-live)   FIXTURE=TS-LIVE;   PROMPT_FILE=spec-prompt.txt;  SKILL=technical-spec-doc ;;
  ts-conv)   FIXTURE=TS-CONV;   PROMPT_FILE=spec-prompt.txt;  SKILL=technical-spec-doc ;;
  ts-conv2)  FIXTURE=TS-CONV2;  PROMPT_FILE=spec-prompt.txt;  SKILL=technical-spec-doc ;;
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
  ts-ctx)    FIXTURE=TS-CTX;    PROMPT_FILE=spec-prompt.txt;  SKILL=technical-spec-doc ;;
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
  rv-bt-dirty)  FIXTURE=RV-AUDIT; PROMPT_FILE=bt-dirty-prompt.txt;  SKILL=spec-review ;;
  rv-fe)        FIXTURE=RV-AUDIT; PROMPT_FILE=fe-prompt.txt;        SKILL=spec-review ;;
  rv-tpl-clean) FIXTURE=RV-AUDIT; PROMPT_FILE=tpl-clean-prompt.txt; SKILL=spec-review ;;
  rv-tpl-dirty) FIXTURE=RV-AUDIT; PROMPT_FILE=tpl-dirty-prompt.txt; SKILL=spec-review ;;
  rv-tpl-count) FIXTURE=RV-AUDIT; PROMPT_FILE=tpl-count-prompt.txt; SKILL=spec-review ;;
  rv-stage-na)  FIXTURE=RV-AUDIT; PROMPT_FILE=stage-na-prompt.txt;  SKILL=spec-review ;;
  sb-ctx2)   FIXTURE=SB-CTX2;   PROMPT_FILE=stage-prompt.txt; SKILL=stage-breakdown-doc ;;
  # ── `spec-readiness`: достаточно ли спеки, чтобы писать код ────────────────────────────────
  # Как и приёмка, ничего не пишет на диск: артефакт — `answer.md` из stdout. Парное плечо без
  # скилла гоняется отдельным `run-ctl.sh` на той же фикстуре — оно и есть знаменатель.
  sr-gap)    FIXTURE=SR-GAP;    PROMPT_FILE=sr-prompt.txt;   SKILL=spec-readiness ;;
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
  cr-btn-q)      FIXTURE=CR-SMALL; PROMPT_FILE=btn-q-prompt.txt;      SKILL=change-request-doc ;;
  cr-api-w)      FIXTURE=CR-SMALL; PROMPT_FILE=api-w-prompt.txt;      SKILL=change-request-doc ;;
  cr-notsmall-q) FIXTURE=CR-SMALL; PROMPT_FILE=notsmall-q-prompt.txt; SKILL=change-request-doc ;;
  cr-idea-q)     FIXTURE=CR-SMALL; PROMPT_FILE=idea-q-prompt.txt;     SKILL=change-request-doc ;;
  cr-bug-q)      FIXTURE=CR-SMALL; PROMPT_FILE=bug-q-prompt.txt;      SKILL=change-request-doc ;;

  # ── спека на багфикс: режим `technical-spec-doc` по баг-репорту ───────────────────────────
  # Флаг багфикса изображён промптом — проводник про багфикс ещё не знает (шаг 8 плана). Дерево
  # своё, а не `BG-INC`: там `bg-flick-w` сама пишет в `coddoc/ARS-312/`, и готовый репорт в
  # песочнице дал бы ей найти собственный выход засеянным.
  bf-spec)     FIXTURE=BF-SPEC; PROMPT_FILE=spec-prompt.txt; SKILL=technical-spec-doc ;;

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
  rt-bug)      FIXTURE=RT-BUG; PROMPT_FILE=bug-prompt.txt;     SKILL=analyst-workspace; STUBS_SUB=stubs TURN2_FILE=bug-turn2.txt ;;
  rt-feature)  FIXTURE=RT-BUG; PROMPT_FILE=feature-prompt.txt; SKILL=analyst-workspace; STUBS_SUB=stubs TURN2_FILE=feature-turn2.txt ;;
  # `rt-feature-gate` — гейт 2Б после записи БТ: тот же маршрут, но промпт НЕ отвечает заранее про
  # разрез (заглушка БТ пишет §4.5 «не применимо»). На `rt-feature` модель отвечала на вопрос гейта
  # строкой промпта «резать не нужно» — стенд подсказывал ответ. Грейд: `--probe=feature-gate`.
  rt-feature-gate) FIXTURE=RT-BUG; PROMPT_FILE=feature-gate-prompt.txt; SKILL=analyst-workspace; STUBS_SUB=stubs TURN2_FILE=feature-turn2.txt ;;
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
  rt-nokey)    FIXTURE=RT-BUG; PROMPT_FILE=nokey-prompt.txt;   SKILL=analyst-workspace; STUBS_SUB=stubs TURN2_FILE=nokey-turn2.txt ;;
  rt-noreview) FIXTURE=RT-BUG; PROMPT_FILE=noreview-prompt.txt; SKILL=analyst-workspace; STUBS_SUB=stubs TURN2_FILE=bug-turn2.txt ;;
  rt-noreview-bare) FIXTURE=RT-BUG; PROMPT_FILE=noreview-bare-prompt.txt; SKILL=analyst-workspace; STUBS_SUB=stubs TURN2_FILE=bug-turn2.txt ;;
  rt-noreview-ru) FIXTURE=RT-BUG; PROMPT_FILE=noreview-ru-prompt.txt; SKILL=analyst-workspace; STUBS_SUB=stubs TURN2_FILE=bug-turn2.txt ;;
  # `rt-nosplit` снят с `analyst-workspace` 2.0.0: двоичного вопроса про этапы больше нет; узел
  # «Что дальше?» меряют пробы `rt-*` в `run-ctx-v2.sh`.
  # Ветка «Продолжить начатое»: на диске лежит ТОЛЬКО баг-репорт, спеки под него нет. Проверяется,
  # опознан ли он сводкой состояния (глоб ветки его раньше не видел вовсе) и уходит ли маршрут в
  # спеку с флагом багфикса, а не по кругу в `bug-report-doc`. Рядом чужая `ARS-102` с полным
  # комплектом — ловушка на подстановку соседнего документа.
  rt-cont)     FIXTURE=RT-CONT; PROMPT_FILE=cont-prompt.txt; SKILL=analyst-workspace; STUBS_SUB=stubs ;;
  # `rt-gate` — гейт Шага 2Б (правка 1.2.0, 2026-09-22): на диске готовый чистый БТ, аналитик приносит
  # его готовым. Верный исход — приёмка, чтение, ход ОСТАНОВЛЕН вопросом «принят — идём дальше?»;
  # `technical-spec-doc` запускается только следующим ходом. Заглушки дают чистый документ нарочно:
  # до правки такой документ уезжал в спеку без остановки.
  rt-gate)     FIXTURE=RT-GATE; PROMPT_FILE=gate-prompt.txt; SKILL=analyst-workspace; STUBS_SUB=stubs TURN2_FILE=gate-turn2.txt ;;

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

  *) echo "неизвестная проба: '$PROBE'"; echo "есть: bfg-scroll bfg-role ts-live ts-conv ts-conv2 ts-ctx ts-nodesc ts-noctx br-ctx br-real br-rework br-rework-q sb-ctx sb-ctx2 sm-graph2 rv-conv rv-clean rv-bt-clean rv-bt-dirty rv-fe rv-tpl-clean rv-tpl-dirty rv-tpl-count rv-stage-na br-roles-w br-roles-q cdoc-xlsx cdoc-txt cdoc-txt-q cdoc-docx cdoc-fix cdoc-dup sr-gap sr-verify rv-bug-clean rv-bug-dirty rv-bug-spec rv-bug-src bf-spec rt-bug rt-feature rt-menu rt-nokey rt-noreview rt-cont bg-flick-w bg-flick-q bg-form-w bg-role-w bg-data-q bg-notbug-q cr-btn-w cr-btn-q cr-api-w cr-notsmall-q cr-idea-q cr-bug-q"; exit 1 ;;
esac

[ -n "$ROUND" ] || { echo "usage: ./run-ctx.sh <проба> <папка-раунда> <N> [параллельность]"; exit 1; }
[ -f "$POOL" ]  || { echo "нет раннера: $POOL"; exit 1; }
. "$HERE/model-id.sh"
. "$HERE/copy-once.sh"
SM_MODEL="$(model_id "${SM_MODEL:-}" claude-sonnet-5)" || exit 2
export SM_MODEL

FIXTURE_DIR="$HERE/fixtures/$FIXTURE"
PROMPT="$FIXTURE_DIR/$PROMPT_FILE"
[ -f "$PROMPT" ] || { echo "нет промпта: $PROMPT"; exit 1; }

mkdir -p "$ROUND/_skills"
SNAP_KEEP="$ROUND/_skills/$SKILL.SKILL.md"
if [ -f "$SNAP_KEEP" ]; then
  echo "снимок скилла уже есть — прогон читает ЕГО: $SNAP_KEEP"
else
  copy_once "$HERE/../$SKILL/SKILL.md" "$SNAP_KEEP"
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
# Снимок — свой на каждое плечо (проба и PID в имени): общий на раунд сносился концом соседнего плеча.
# Подробно — у того же места в `run-ctx-v2.sh`.
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
if [ -d "$HERE/../$SKILL/reference" ]; then
  copy_once "$HERE/../$SKILL/reference" "$ROUND/_skills/$SKILL.reference"
  rm -rf "$SNAP_ROOT/$SKILL/reference"
  cp -r "$ROUND/_skills/$SKILL.reference" "$SNAP_ROOT/$SKILL/reference"
fi
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
  if ! printf '%s\n' "$CURRENT" | diff -q - <(tr -d '\r' < "$MANIFEST") >/dev/null 2>&1; then
    echo "!!! СОСТАВ ФИКСТУРЫ $FIXTURE НЕ СОВПАДАЕТ С МАНИФЕСТОМ — прогон не запускался."
    printf '%s\n' "$CURRENT" | diff - "$MANIFEST" | head -20
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
SEED_ROOT="${SKILL_EVAL_SEED_ROOT:-/tmp/skill-eval-seed}"
SEED="$SEED_ROOT/$(basename "$ROUND")-$PROBE"
SEED_SRC="$FIXTURE_DIR${SEED_SUB:+/$SEED_SUB}"
rm -rf "$SEED"; mkdir -p "$SEED"
# `KEY.md` — ключ пробы `sr-verify`: по каждому вопросу сказано, отвечает ли спека. Засеянный в
# песочницу, он превращает замер в списывание: прогон закроет ровно то, что в ключе, и «закрыто
# 12 из 40» будет означать «прочитал ответы», а не «нашёл их в спеке».
( cd "$SEED_SRC" && tar cf - --exclude=README.md --exclude='*-prompt.txt' --exclude='*-turn2.txt' --exclude=_manifest.txt --exclude=expected.md --exclude=KEY.md --exclude=stubs --exclude=PROVENANCE.txt . ) | ( cd "$SEED" && tar xf - )

echo "проба: $PROBE   фикстура: $FIXTURE   скилл: $SKILL"
STUBS_DIR=""
if [ -n "$STUBS_SUB" ]; then
  STUBS_DIR="$FIXTURE_DIR/$STUBS_SUB"
  [ -d "$STUBS_DIR" ] || { echo "нет папки заглушек: $STUBS_DIR"; exit 1; }
  echo "заглушки: $STUBS_SUB → .claude/skills/ песочницы"
fi

TURN2=""
if [ -n "$TURN2_FILE" ]; then
  TURN2="$FIXTURE_DIR/$TURN2_FILE"
  [ -f "$TURN2" ] || { echo "нет файла второго хода: $TURN2"; exit 1; }
  echo "реплика аналитика: $TURN2_FILE   ходов до 2 подряд без движения, потолок ${RT_MAX_TURNS:-8}"
fi
# НАСТРОЙКИ, КОТОРЫМИ ПОЛУЧЕНЫ ЧИСЛА, ПИШУТСЯ В ПАПКУ РАУНДА. Снимок скилла уже кладётся сюда по
# той же причине: через неделю «прогоняли с эффортом или без» восстанавливается только из файла.
mkdir -p "$ROUND/$PROBE"
{
  echo "проба: $PROBE"
  echo "модель: ${SM_MODEL:-haiku}"
  echo "effort: ${EFFORT:-умолчание CLI}"
  echo "реплика аналитика: ${TURN2_FILE:-нет, стенд одноходовой}"
  echo "потолок ходов: ${RT_MAX_TURNS:-8}"
  echo "прогонов: $N, параллельность: $CONC"
} > "$ROUND/$PROBE/_settings.txt"
echo "effort: ${EFFORT:-умолчание CLI}"
bash "$POOL" "$SNAP" "$PROMPT" "$ROUND/$PROBE" "$N" "$CONC" "$SEED" "$STUBS_DIR" "$TURN2"

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
DIRT="$(diff -rq "$SEED" "$SEED_SRC" 2>/dev/null | grep -v "README.md\|-prompt.txt\|-turn2.txt\|_manifest.txt\|expected.md\|KEY.md\|stubs\|PROVENANCE" || true)"
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

# Цена плеча — этой строкой, не суммой руками (при `--resume` цена накопительная).
bash "$HERE/cost-runs.sh" "$ROUND/$PROBE"
