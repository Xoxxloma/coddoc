#!/usr/bin/env node
// grade-meet.mjs — пробы meeting-intake: вход и разбор встречи против расшифровки и засева.
//
//   node grade-meet.mjs <каталог с песочницами> --fx VAC|ACC|LONG|NEW|REW|CHG|CR             вход (1.x)
//   node grade-meet.mjs <каталог с песочницами> --points --fx VAC|ACC|LONG|NEW|REW|CHG|CR|OUT|SAMEDAY|TWIN  список (2.0)
//   node grade-meet.mjs --selftest            самопроверка режима входа
//   node grade-meet.mjs --selftest --points   самопроверка режима списка
//
// Грейдится ФАЙЛ в песочнице, а не отчёт: вход (`meeting-<дата>-bt|spec.md`) — по анкерам
// fixtures/MEET-*/expected.md; разбор (`meeting-<дата>.razbor.md`) — каждая цитата сверяется со
// строкой расшифровки ±2. Документ задачи из засева должен остаться нетронутым.
// Режим списка (`--points`, meeting-intake 2.0.0): вместо входа — список `meeting-<дата>.points.md` по форме
// meeting-intake/reference/output.md; ожидания входа перенесены на виды пунктов (см. раздел «список пунктов»).

import { resolve as pathResolve } from 'node:path'
import { readdirSync, readFileSync, existsSync, statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { groundCheck, fmtMissing, stemOf, latinOf } from './ground-check.mjs'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const lf = (s) => s.replace(/\r\n/g, '\n')
const read = (p) => lf(readFileSync(p, 'utf8'))
const RE_API_FAILURE = /API Error|Request not allowed|Please run \/login|Credit balance|rate limit|session limit|usage limit/i
// «Не измерено» — только отказ API: маркер пула или текст отказа в ответе. Пустой ответ без маркера — прогон измерен.
const apiFailed = (dir, ans) => existsSync(join(dir, '_api-failure.txt')) || existsSync(join(dir, '_api-failure-turn.txt')) || RE_API_FAILURE.test(String(ans).slice(0, 300))
// Граница слова для кириллицы: `\b` в JS — только ASCII.
const w = (stem, flags = 'i') => new RegExp('(^|[^а-яёa-z])' + stem, flags)

export const FX = {
  VAC: {
    key: 'EMP-1207',
    kind: 'bt',
    transcript: 'fixtures/MEET-VAC/seed/meeting-2026-10-07.txt',
    // Первым — документ задачи: самопроверка берёт по нему папку входа. Расшифровка — чтобы правку засева
    // в песочнице было видно.
    seed: {
      'coddoc/EMP-1207/business_requirements.md': 'fixtures/MEET-VAC/seed/coddoc/EMP-1207/business_requirements.md',
      'meeting-2026-10-07.txt': 'fixtures/MEET-VAC/seed/meeting-2026-10-07.txt',
    },
    etalon: { input: 'fixtures/MEET-VAC/etalon/meeting-2026-10-07-bt.md', razbor: 'fixtures/MEET-VAC/etalon/meeting-2026-10-07.razbor.md' },
    must: [
      // Номер FR не обязателен: Шаг 8 велит писать код словами, если его нет в сути записи.
      { id: 'fr10', d: 'FR-10: отмена в день начала', sec: ['Решено', 'Открыто'], re: [/(FR-10|отмен)/i, /(день|дат[аеуы])\s+(его\s+|её\s+)?начал|первый день|наступ\S*\s+дат|до\s+начала/i] },
      { id: 'directors', d: 'директора → генеральный', sec: ['Решено', 'Открыто'], re: [/директор/i, /генеральн|гендир/i] },
      { id: 'minTerm', d: 'минимальный срок ежегодного — открыт', sec: ['Открыто'], re: [/ежегодн/i, /(3|тр[её]х|три)\s+(календарн|рабоч|дн)|минимальн\S*\s+срок|за сколько дн|сколько\s+дн|срок\S*\s+подач/i] },
      { id: 'loader', d: 'кто грузит изменения списка — открыт', sec: ['Открыто'], re: [/(изменени|обновлени)/i, /(загруж|грузит|залива|загрузк|внос|обновл)/i] },
      { id: 'list20', d: 'список до 20 октября', sec: null, re: [/(20|двадцат\S*)(-го)?\s+октябр|20\.10/i] },
    ],
    mustNot: [
      // «бумажные» тоже; «на бумаге … не будут / не принимают» — это и есть решение, не переигранное.
      { id: 'paper', d: '«директора на бумаге» (переиграно)', sec: null, re: [/директор/i, /бума[гж]/i], not: /не\s+будут|не\s+принима|нельзя|с\s+февраля|больше\s+не|вместо|а не/i },
      { id: 'hrPending', d: '«кадровик видит на согласовании» (переиграно)', sec: null, re: [/кадровик[^.]{0,80}(видит|видят|видны)[^.]{0,40}(^|[^а-яё])(и|также|тоже)([^а-яё]|$)[^.]{0,30}на согласовании/i], not: /только\s+согласованн|не\s+вид/i },
      // L125: «Это вот в БТ не надо. Это в спеку.» — проверка руководителя на момент нажатия.
      { id: 'impl', d: 'реализация во входе БТ', sec: null, re: [/(^|[^а-яё])(бэк(?!лог)|бэкенд|фронт|сокет|опраш|опрос|сервер|скрипт|ютиси)|UTC|храни(т|тся)\s+в\s+заявк|момент нажат/i] },
      { id: 'noise', d: 'шум', sec: null, re: [/(^|[^а-яё])(ифт|ноут|школ|суточн|винд)/i] },
      { id: 'asr', d: 'форма на слух', sec: null, re: [/эф\s*эр|тысяч[аи]\s+двести|(^|[^а-яё])(три\s+два|один\s+два)([^а-яё]|$)/i] },
    ],
    razborMust: [
      // «Не потеряно» — есть запись в любой форме: цитатой, сутью или строкой-ссылкой (круг 5: «при
      // внутреннем «согласовано»» без слова «статус»). Поэтому анкеры — по смыслу, с синонимами.
      { id: 'nowCheck', d: 'проверка руководителя на момент нажатия', re: /момент нажат|при нажати|на момент согласован|руководител[^\n]{0,80}(провер|ошибк)/i },
      { id: 'onLoad', d: 'счётчик при загрузке', re: /при загрузк|при открыти\S*\s+страниц|без (живого|веб\s*сокет)/i },
      { id: 'daysStored', d: 'число дней хранится', re: /хран\S*[^\n]{0,30}(в заявке|на бэке|на сервере)|бэк хранит|на бэке/i },
      { id: 'paperKept', level: 'warn', d: 'переигранная «бумага» не потеряна', re: /бумаг/i },
      { id: 'drafts', level: 'warn', d: 'удаление черновиков', re: /удал\S*[^\n]{0,20}черновик|черновик\S*[^\n]{0,30}удал/i },
    ],
    // «Кто грузит изменения списка» — операционная загрузка: слой двоякий (expected.md, правка 2026-10-13).
    altOther: { loader: /открытый вопрос[\s\S]{0,400}?(грузит|загруж|залива)/i },
  },
  ACC: {
    key: 'ACS-208',
    kind: 'spec',
    transcript: 'fixtures/MEET-ACC/seed/meeting-2026-10-09.txt',
    seed: {
      'coddoc/ACS-208/business_requirements.md': 'fixtures/MEET-ACC/seed/coddoc/ACS-208/business_requirements.md',
      'meeting-2026-10-09.txt': 'fixtures/MEET-ACC/seed/meeting-2026-10-09.txt',
    },
    etalon: { input: 'fixtures/MEET-ACC/etalon/meeting-2026-10-09-spec.md', razbor: 'fixtures/MEET-ACC/etalon/meeting-2026-10-09.razbor.md' },
    must: [
      { id: 'async', d: 'заведение фоном с повтором', sec: ['Решено'], re: [/(^|[^а-яё])фон|асинхрон|отдельн/i, /повтор/i] },
      // У предложения нет явного принятия → Шаг 6; «в открытые вопросы» — законный ответ.
      { id: 'alert', d: 'оповещение дежурному портала', sec: ['Решено', 'Сведения', 'Открыто'], re: [/(оповещ|алерт|уведом|тревог|сигнал)/i, /дежурн/i] },
      { id: 'dup', d: 'повторное заведение → идентификатор, выдан', sec: ['Решено'], re: [/(E_ACC_DUP|409|уже есть|уже существует|уже завед|повторн\S*\s+завед|существующ)/i, /(идентификатор|номер|айди|(^|[^a-z])id([^a-z]|$)|существующ\S*\s+(учётк\S*\s+)?из\s+отве|учётк\S*\s+из\s+(тела\s+)?ответа|из\s+ответа)/i, /выда(н|л|ч)/i] },
      { id: 'login', d: 'логин хранится', sec: ['Решено'], re: [/логин/i, /(хран|сохран)/i] },
      // «при открытии заявки запрашиваем данные учётки» — L123 «при открытии заявки дёргал гет аккаунт» (круг 3).
      { id: 'stateOnOpen', d: 'состояние при открытии заявки', sec: ['Решено'], re: [/(при открыт|открыва|открыти)/i, /(состояни|активн|данн\S*\s+учётк)/i] },
      { id: 'hideRevoke', d: 'при сбое кнопка «Отозвать доступ» скрыта', sec: ['Решено'], re: [/(отозвать доступ|отзыв\S*\s+доступ|кнопк\S*\s+отзыв)/i, /(скры|прячем|прячет|не показыва|нет|не вид)/i] },
      { id: 'syncRevoke', d: 'отзыв синхронный', sec: ['Решено'], re: [/(^|[^а-яё])синхронн/i, /(блокир|отзыв)/i] },
      { id: 'state422', d: 'повторная блокировка → запрос состояния', sec: ['Решено'], re: [/(E_ACC_STATE|422|повторн\S*\s+блокир|уже заблокир|неверн\S*\s+состояни|блокировк\S*[^.]{0,40}отве[тч]|отве[тч][^.]{0,40}блокир)/i, /(состояни|читаем|запрашива|провер)/i] },
      { id: 'codeFlag', d: 'код системы вместо признака', sec: ['Решено'], re: [/(^|[^а-яё])код/i, /признак|флаг/i] },
      // «служба информационной безопасности» из БТ — такая же опора, как «ИБ» встречи.
      { id: 'midStatus', d: 'промежуточный статус — к ИБ', sec: ['Расходится с БТ', 'Открыто'], re: [/статус/i, /(^|[^А-ЯЁа-яё])ИБ([^А-ЯЁа-яё]|$)|безопасност/] },
      { id: 'blocked', d: 'повторная заявка при заблокированной учётке — два варианта', sec: ['Расходится с БТ', 'Открыто'], re: [/заблокир/i, /очеред|обращени|заявк\S*\s+в\s+команд/i, /разблокир|снят\S*\s+блокир/i] },
    ],
    mustNot: [
      // `not` — законное противопоставление («фоном, а не синхронно»): пункт с ним не нарушение.
      { id: 'syncCreate', d: 'синхронное заведение решением', sec: ['Решено'], re: [/(завод|заведени|созда)[^.;,]{0,60}(^|[^а-яё])синхронн|(^|[^а-яё])синхронн[^.;,]{0,60}(завод|заведени|созда)|в том же запросе/i], not: /(^|[^а-яё])не\s+(синхронн|в том же запросе)/i },
      // Отрицание и довод («скрытого статуса нет», «подписку не делаем», «понадобился бы») — не решение.
      { id: 'hiddenStatus', d: 'скрытый внутренний статус решением', sec: ['Решено'], re: [/внутренн\S*\s+статус/i], not: /(^|[^а-яё])(нет|без|не\s+дела|не\s+нуж|не\s+ввод)([^а-яё]|$)/i },
      { id: 'asyncRevoke', d: 'блокировка фоном решением', sec: ['Решено'], re: [/(блокир|отзыв)[^.;,]{0,60}((^|[^а-яё])фон|асинхрон)|((^|[^а-яё])фон|асинхрон)[^.;,]{0,60}(блокир|отзыв)/i], not: /(^|[^а-яё])не\s+фон|отверг|отклон|не\s+дела|не\s+бер[её]|(^|[^а-яё])бы([^а-яё]|$)|(^|[^а-яё])без([^а-яё]|$)/i }, // «Блокировку фоновой задачей не берём» — nb-r6-reg run-1
      { id: 'busSub', d: 'подписка на увольнения решением', sec: ['Решено'], re: [/подпис[^.]{0,60}(увольн|событи|шин)/i], not: /не\s+дела|не\s+бер|не\s+нуж|(^|[^а-яё])без([^а-яё]|$)|не входит/i },
      // Упоминание отвергнутого варианта как довода («фоном не делаем, чтобы не вводить второй промежуточный
      // статус») — не решение.
      { id: 'midDecided', d: 'промежуточный статус решением', sec: ['Решено'], re: [/промежуточн/i], not: /отверг|отклон|не вводить|чтобы не|(^|[^а-яё])без([^а-яё]|$)|(^|[^а-яё])нет([^а-яё]|$)|(^|[^а-яё])бы([^а-яё]|$)/i },
      // `/api/v2` без `/accounts` — ссылка на доку ошибок, набранная в чате (L79), это опора.
      { id: 'leak', d: 'токен карточки idm без опоры', sec: null, re: [/\/api\/v2\/accounts|E_SYS_UNKNOWN|E_ACC_NOT_FOUND|idm\.client|employeeLogin|lockedAt|ENABLED|LOCKED|TERMINATED|targetSystemCode|hr\.employee\.dismissed|X-Idm-Client-Token|accountId|wiremock|(^|[^A-Za-z])(POST|GET)([^A-Za-z]|$)/i] },
      { id: 'asr', d: 'форма на слух', sec: null, re: [/(^|[^а-яё])е\s*акк|эй\s*си\s*эс|ай\s*ди\s*эм|вайр\s*мок|пост\s+аккаунт|гет\s+аккаунт|терминейтед|анлок|бэк\s*оф|таргет|аккаунт\s*айди|(^|[^а-яё])лок([^а-яё]|$)/i] },
      { id: 'noise', d: 'шум', sec: null, re: [/гитлаб|линтер|пайплайн|ремонт|электричк|тоннел|(^|[^а-яё])ретро/i] },
    ],
    razborMust: [
      { id: 'syncKept', level: 'warn', d: 'синхронное заведение не потеряно', re: /в том же запросе|синхронно, в общем|(^|[^а-яё])синхронн\S*[^\n]{0,40}(завед|заводи|запрос)|(завед|заводи)\S*[^\n]{0,40}(^|[^а-яё])синхронн/i },
      { id: 'hiddenKept', level: 'warn', d: 'внутренний статус не потерян', re: /внутренн|внутри согласован/i },
      { id: 'token', level: 'warn', d: 'поручение по токену', re: /подаём сегодня|Глеб, сделаешь|(подаёт|подать|подаём)[^\n]{0,40}токен/i },
      { id: 'mock', d: 'заглушка для тестов', re: /(^|[^а-яё])мок|заглушк|макет|имитац|эмулят/i },
    ],
  },
  // Длинная встреча (660 строк, 3 окна карты, тема > 400 строк): см. fixtures/MEET-LONG/expected.md.
  LONG: {
    key: 'PSS-2210',
    kind: 'bt',
    transcript: 'fixtures/MEET-LONG/seed/meeting-2026-10-12.txt',
    seed: {
      'coddoc/PSS-2210/business_requirements.md': 'fixtures/MEET-LONG/seed/coddoc/PSS-2210/business_requirements.md',
      'meeting-2026-10-12.txt': 'fixtures/MEET-LONG/seed/meeting-2026-10-12.txt',
    },
    etalon: { input: 'fixtures/MEET-LONG/etalon/meeting-2026-10-12-bt.md', razbor: 'fixtures/MEET-LONG/etalon/meeting-2026-10-12.razbor.md' },
    must: [
      { id: 'deadline', d: 'срок подачи — до 18:00 рабочего дня перед визитом', sec: ['Решено'], re: [/(18|восемнадцат)/i, /(накануне|перед визит)/i] },
      { id: 'deputy', d: 'передача заместителю после 16:00', sec: ['Решено', 'Открыто'], re: [/заместител/i, /(16|шестнадцат)/i] },
      { id: 'notifyApplicant', d: 'уведомление заявителю при решении', sec: ['Решено'], re: [/заявител/i, /уведомл|оповещ|сообщени|письм/i, /(решени|согласова|отклон)/i] },
      { id: 'notifyContent', d: 'в уведомлении дата, время, ссылка', sec: ['Решено'], re: [/уведомл|оповещ|сообщени|письм/i, /(дата|время)/i, /ссылк/i] },
      { id: 'docOnlyBureau', d: 'номер документа видит только бюро', sec: ['Решено'], re: [/номер\S*\s+(документ|паспорт)/i, /только/i, /бюро/i] },
      { id: 'docType', d: 'паспорт РФ или иностранный, гражданство', sec: ['Решено'], re: [/иностран/i, /гражданств/i] },
      { id: 'purpose', d: 'цель визита из списка', sec: ['Решено'], re: [/цел\S*\s+визит/i, /(переговор|собеседовани|подрядчик|доставк)/i] },
      { id: 'hours', d: 'время визита — часы с 8 до 18', sec: ['Решено'], re: [/(час|время)/i, /(^|[^0-9])8([^0-9]|$)|восьми/i, /(18|восемнадцат)/i] },
      { id: 'rejectComment', d: 'комментарий при отклонении обязателен и виден заявителю', sec: ['Решено'], re: [/коммент/i, /обязател/i, /заявител/i] },
      { id: 'retention', d: 'хранение номера документа — к юристам', sec: ['Открыто'], re: [/(хран|сколько)/i, /юрист/i] },
      { id: 'urgent', d: 'срочный пропуск — вне проекта', sec: ['Не входит', 'Сведения', 'Решено'], re: [/срочн/i, /(вне проекта|не входит|пост|как сейчас|не через портал)/i] },
      { id: 'report', d: 'отчёт по визитам — в бэклог', sec: ['Не входит', 'Открыто'], re: [/отч[её]т/i, /визит/i] },
    ],
    mustNot: [
      { id: 'groups', d: 'групповые заявки решением (переиграно)', sec: ['Решено'], re: [/группов/i], not: /вне проекта|не входит|не делаем|отдельн|отлож|кейс/i },
      { id: 'passNumber', d: 'номер пропуска в уведомлении (не принято)', sec: ['Решено'], re: [/номер\S*\s+пропуск/i], not: /без номера|не видим|(^|[^а-яё])нет([^а-яё]|$)/i },
      { id: 'impl', d: 'реализация во входе БТ', sec: null, re: [/(^|[^а-яё])(кеш|кэш|таблиц|транзакц|мессенджер|маск|настройк)|(^|[^а-яё])(почт(а|ой|у|е|ы)?|бот(а|ом|у|е|ы)?)([^а-яё]|$)|десять цифр|производственн\S*\s+календар|справочник\S*\s+праздник/i] },
      { id: 'otherTopic', d: 'чужая тема во входе', sec: null, re: [/CSV|бухгалтер|командировк|обратн\S*\s+связ|капч|сертификат|(^|[^а-яё])релиз/i] },
      { id: 'noise', d: 'шум', sec: null, re: [/(^|[^а-яё])(ифт|столов|ёлкин|елкин|планёрк)/i] },
      { id: 'asr', d: 'форма на слух', sec: null, re: [/пэ\s*эс\s*эс|двадцать\s+два\s+десять|эф\s*эр/i] },
    ],
    razborMust: [
      { id: 'groupsKept', level: 'warn', d: 'переигранные групповые не потеряны', re: /до пяти|группов/i },
      { id: 'cache', d: 'кеш руководителя — для спеки', re: /кеш|кэш/i },
      { id: 'tx', d: 'транзакция — для спеки', re: /транзакц/i },
      { id: 'passNumberKept', level: 'warn', d: 'номер пропуска — не принято', re: /номер\S*\s+пропуск/i },
    ],
  },
  // Фичу обсуждают с нуля: документов задачи нет, ключ только в чате. См. fixtures/MEET-NEW/expected.md.
  NEW: {
    key: 'HRS-311',
    kind: 'bt',
    // Документа задачи нет — папку входа самопроверка берёт отсюда, а не из засева.
    folder: 'coddoc/HRS-311',
    transcript: 'fixtures/MEET-NEW/seed/meeting-2026-10-08.txt',
    seed: { 'meeting-2026-10-08.txt': 'fixtures/MEET-NEW/seed/meeting-2026-10-08.txt' },
    etalon: { input: 'fixtures/MEET-NEW/etalon/meeting-2026-10-08-bt.md', razbor: 'fixtures/MEET-NEW/etalon/meeting-2026-10-08.razbor.md' },
    must: [
      { id: 'kinds', d: 'виды: с места работы и копия трудовой', sec: ['Решено'], re: [/с места работы/i, /трудов/i] },
      { id: 'format', d: 'формат на выбор: электронная или бумажная', sec: ['Решено'], re: [/электрон/i, /бумажн/i, /(выбор|выбира|(^|[^а-яё])сам)/i] },
      { id: 'term', d: 'срок 3 рабочих дня', sec: ['Решено'], re: [/(3|тр[её]х|три)\s+рабоч/i] },
      { id: 'executor', d: 'видят все специалисты, кто взял — исполнитель', sec: ['Решено'], re: [/специалист/i, /(взял|взят|исполнител)/i] },
      { id: 'notify', d: 'уведомление на портале', sec: ['Решено'], re: [/уведомл/i, /портал/i] },
      { id: 'cancel', d: 'отмена, пока не взяли в работу', sec: ['Решено'], re: [/отмен/i, /(не взял|не взят|в работу|возьм)/i] },
      { id: 'self', d: 'только для себя', sec: ['Решено'], re: [/(для себя|за другого|только себе)/i] },
      { id: 'sign', d: 'подпись — к юристам', sec: ['Открыто'], re: [/подпис/i, /юрист/i] },
      { id: 'salary', d: 'справка с зарплатой — к главному бухгалтеру', sec: ['Открыто'], re: [/(зарплат|заработн)/i, /(бухгалтер|главбух)/i] },
      // «2-НДФЛ в портал не берут» в «Решено» — то же решение (пилот 2026-10-14).
      // В «Не входит» — любое упоминание; в «Решено» — с отрицанием (два решения в одном пункте законны — Шаг 8).
      { id: 'ndfl', d: '2-НДФЛ не входит', sec: ['Не входит'], re: [/НДФЛ/i], alt: [{ sec: ['Решено'], re: [/НДФЛ/i, /(не входит|(^|[^а-яё])вне\s|не\s+бер|не\s+дела|не\s+тащ|как сейчас|бухгалтери)/i] }] },
      { id: 'former', d: 'бывшие сотрудники не входят', sec: ['Не входит'], re: [/(бывш|уволен)/i], alt: [{ sec: ['Решено'], re: [/(бывш|уволен)/i, /(как сейчас|письм|не входит|(^|[^а-яё])вне\s|нельзя|не\s+мог)/i] }] },
      { id: 'courier', d: 'курьер не входит', sec: ['Не входит'], re: [/курьер/i], alt: [{ sec: ['Решено'], re: [/курьер/i, /(не\s|(^|[^а-яё])вне\s|не входит|(^|[^а-яё])без\s)/i] }] },
    ],
    mustNot: [
      // Пункт «формат на выбор: электронная или бумажная» законно называет электронную.
      { id: 'onlyElectronic', d: '«только электронные» решением (переиграно после «итого»)', sec: ['Решено'], re: [/только\s+электрон/i], not: /бумажн/i },
      { id: 'fiveDays', d: '«пять рабочих дней» (переиграно)', sec: null, re: [/(5|пят\S*)\s+рабоч/i] },
      { id: 'ndflDecided', d: '2-НДФЛ видом справки в «Решено»', sec: ['Решено'], re: [/НДФЛ/i], not: /(^|[^а-яё])(не|без|кроме)\s|через бухгалтер/i },
      { id: 'impl', d: 'реализация во входе БТ', sec: null, re: [/(^|[^а-яё])(бэк(?!лог)|бэкенд|хранилищ|интеграц|зуп)|1С|S3/i] },
      { id: 'asr', d: 'форма на слух', sec: null, re: [/эйч\s*ар|эн\s*д[эе]\s*эф|пэ\s*д[эе]\s*эф/i] },
      { id: 'noise', d: 'шум', sec: null, re: [/собак|кофемашин|(^|[^а-яё])демо/i] },
    ],
    razborMust: [
      // «Генерим на бэке… я так, для себя» — ни решения, ни сведения: «Отброшено» законно (пилот 2026-10-14).
      { id: 'tpl', level: 'warn', d: 'формирование справки на бэке — для спеки', re: /генерим|по шаблону на бэке|файлов\S*\s+хранилищ/i },
      { id: 'zup', d: 'данные о сотруднике из кадровой системы — для спеки', re: /зуп|кадров\S*\s+систем|должность и дата при[её]ма/i },
      { id: 'electronicKept', level: 'warn', d: 'переигранное «только электронные» не потеряно', re: /только электронн/i },
      { id: 'fiveKept', level: 'warn', d: 'переигранные «пять дней» не потеряны', re: /пять (рабочих )?дн|(^|[^0-9])5 рабоч/i },
    ],
  },
  // Вторая встреча по готовой спеке: закрывают её открытые вопросы. См. fixtures/MEET-REW/expected.md.
  REW: {
    key: 'ACS-208',
    kind: 'spec',
    transcript: 'fixtures/MEET-REW/seed/meeting-2026-10-14.txt',
    seed: {
      'coddoc/ACS-208/technical_specification.md': 'fixtures/MEET-REW/seed/coddoc/ACS-208/technical_specification.md',
      'coddoc/ACS-208/business_requirements.md': 'fixtures/MEET-REW/seed/coddoc/ACS-208/business_requirements.md',
      // Вход прошлой встречи лежит в папке: он не новый вход и не лишний файл.
      'coddoc/ACS-208/meeting-2026-10-09-spec.md': 'fixtures/MEET-REW/seed/coddoc/ACS-208/meeting-2026-10-09-spec.md',
      'meeting-2026-10-14.txt': 'fixtures/MEET-REW/seed/meeting-2026-10-14.txt',
    },
    etalon: { input: 'fixtures/MEET-REW/etalon/meeting-2026-10-14-spec.md', razbor: 'fixtures/MEET-REW/etalon/meeting-2026-10-14.razbor.md' },
    must: [
      { id: 'retry', d: 'повторы: 5 минут, вдвое, не больше 6 часов, сутки', sec: ['Решено'], re: [/(5|пят\S*)\s*мин/i, /(вдвое|удва|удво|в два раза)/i, /(6|шест\S*)\s*(час|ч([^а-яё]|$))/i, /сут(о?к|ки)/i] }, // «в течение суток» — 2026-10-14, nb-r3-reg run-1
      { id: 'alert', d: 'алерт в канал дежурной смены', sec: ['Решено'], re: [/portal-duty|дежурн/i, /(алерт|оповещ|канал)/i] },
      // Итог L73 «три, пятнадцать, тридцать» подталкивает к сжатой записи: «состояния — 3, блокировка — 15,
      // заведение — 30 секунд», «3 с / 15 с / 30 с». Единица — где угодно в пункте, число — рядом со словом.
      { id: 'tState', d: 'таймаут запроса состояния — 3 секунды', sec: ['Решено'], re: [/секунд|сек|\d\s*с([^а-яё]|$)/i, /состояни[^;.]{0,50}((^|[^0-9])3|тр[её]х|три)([^0-9]|$)|((^|[^0-9])3|тр[её]х|три)\s*(с|сек\S*|секунд\S*)[^;.]{0,50}состояни/i] },
      { id: 'tBlock', d: 'таймаут блокировки — 15 секунд', sec: ['Решено'], re: [/секунд|сек|\d\s*с([^а-яё]|$)/i, /(блокир|отзыв)[^;.]{0,50}(15|пятнадцат)|(15|пятнадцат\S*)\s*(с|сек\S*|секунд\S*)[^;.]{0,50}(блокир|отзыв)/i] },
      { id: 'tCreate', d: 'таймаут заведения — 30 секунд', sec: ['Решено'], re: [/секунд|сек|\d\s*с([^а-яё]|$)/i, /завед[^;.]{0,50}(30|тридцат)|(30|тридцат\S*)\s*(с|сек\S*|секунд\S*)[^;.]{0,50}завед/i] },
      { id: 'cache', d: 'кэш состояния — одна минута', sec: ['Решено'], re: [/к[эе]ш/i, /((^|[^0-9])1|одн\S*)\s+минут|минуту|60\s*(с|сек)/i] },
      { id: 'flag', d: 'флаг на подачу, выключен до заполнения', sec: ['Решено'], re: [/флаг/i, /(выключ|не включ|до заполн|пока)/i] },
      { id: 'domainLogin', d: 'при заведении — доменный логин и код системы', sec: ['Сведения', 'Решено'], re: [/доменн/i, /код\S*\s+систем/i] },
    ],
    mustNot: [
      { id: 'tabel', d: 'табельный номер (переиграно после «итого»)', sec: null, re: [/табельн/i], not: /(^|[^а-яё])(не\s+нужен|не\s+переда|не\s+использ|больше\s+не|вместо|а не|был\s+в\s+старой|не\s+хран)/i },
      // Отвергнутый вариант как довод («десять минут отклонили») — не решение.
      { id: 'tenMin', d: '«каждые десять минут» решением', sec: ['Решено'], re: [/(^|[^0-9])(10|десят\S*)\s+минут/i], not: /отклон|отверг|вместо|а не|не\s+кажд/i },
      // «до 8–10 секунд по понедельникам» — сведение, а не таймаут.
      { id: 'tenSec', d: '«десять секунд на всё» решением', sec: ['Решено'], re: [/(^|[^0-9–-])(10|десят\S*)\s+секунд/i], not: /8\s*[–-]\s*10|восьми|отклон|отверг|вместо|а не/i },
      { id: 'cache5', d: 'кэш на пять минут решением', sec: ['Решено'], re: [/к[эе]ш/i, /(^|[^0-9])(5|пят\S*)\s+минут/i], not: /отклон|отверг|вместо|а не|не\s+пят/i },
      { id: 'messenger', d: 'уведомление в мессенджер решением', sec: ['Решено'], re: [/мессенджер/i], not: /(^|[^а-яё])(не|вне)([^а-яё]|$)/i },
      { id: 'leak', d: 'токен карточки idm без опоры', sec: null, re: [/\/api\/v2\/accounts|E_SYS_UNKNOWN|E_ACC_NOT_FOUND|idm\.client|employeeLogin|lockedAt|targetSystemCode|X-Idm-Client-Token/] },
      { id: 'asr', d: 'форма на слух', sec: null, re: [/эй\s*си\s*эс|е\s*акк|портал\s*дьюти|(^|[^а-яё])тбд/i] },
      { id: 'noise', d: 'шум', sec: null, re: [/переезд|принтер|(^|[^а-яё])этаж|(^|[^а-яё])демо/i] },
    ],
    razborMust: [
      { id: 'tabelKept', level: 'warn', d: 'переигранный табельный номер не потерян', re: /табельн/i },
      { id: 'tenMinKept', level: 'warn', d: '«каждые десять минут» не потеряно', re: /десят\S*\s+минут|10 минут/i },
      { id: 'cache5Kept', level: 'warn', d: 'кэш на пять минут не потерян', re: /пять минут|5 минут/i },
    ],
  },
  // Вторая встреча по отпускам: меняет записанное, последнее слово — после итогов внутри чужой темы.
  // См. fixtures/MEET-CHG/expected.md.
  CHG: {
    key: 'EMP-1207',
    kind: 'bt',
    transcript: 'fixtures/MEET-CHG/seed/meeting-2026-10-15.txt',
    seed: {
      'coddoc/EMP-1207/business_requirements.md': 'fixtures/MEET-CHG/seed/coddoc/EMP-1207/business_requirements.md',
      'meeting-2026-10-15.txt': 'fixtures/MEET-CHG/seed/meeting-2026-10-15.txt',
    },
    etalon: { input: 'fixtures/MEET-CHG/etalon/meeting-2026-10-15-bt.md', razbor: 'fixtures/MEET-CHG/etalon/meeting-2026-10-15.razbor.md' },
    headerMust: [['цель в шапке — правки БТ', /цель:\W*правки БТ/i]],
    must: [
      // Три календарных дня — именно у ежегодного (перепутанные виды отпуска — дефект).
      { id: 'fr3', d: 'ежегодный — за три календарных дня (изменение FR-3)', sec: ['Решено'], re: [/ежегодн[^.;]{0,120}((^|[^0-9])3|тр[её]х|три)\s+календарн/i] },
      { id: 'fr9', d: 'кадровик видит и отменённые (изменение FR-9)', sec: ['Решено'], re: [/отмен/i, /(кадр|согласованн|FR-9)/i] },
      { id: 'retention3', d: 'отклонённые и отозванные хранятся три года', sec: ['Решено'], re: [/(хран|удал|срок)/i, /((^|[^0-9])3|тр[её]х|три)\s+(год|лет)|тр[её]хлетн/i] },
    ],
    mustNot: [
      // «год» отдельным словом при хранении; «три года, а не год» — законно, «год, … три года» — нет.
      { id: 'retention1', d: 'хранение «год» (переиграно после итогов)', sec: null, re: [/хран/i, /(^|[^а-яё0-9])(1\s+)?год([^а-яё]|$)|один год/i], not: /(а не|вместо|не)\s+(1\s+|один\s+)?год([^а-яё]|$)/i },
      { id: 'fr9Inverted', d: 'отменённые в список не попадают (обратное решению)', sec: ['Решено'], re: [/отмен[^.;]{0,60}не\s+(попада|показыва|вид|вход)/i] },
      { id: 'otherTopic', d: 'чужая тема (командировки)', sec: null, re: [/суточн|командировк|бухгалтер/i] },
      { id: 'impl', d: 'реализация во входе БТ', sec: null, re: [/(^|[^а-яё])(бэк(?!лог)|джоб|сервер|крон)|раз в сутки/i] },
      { id: 'asr', d: 'форма на слух', sec: null, re: [/эф\s*эр|тысяч\S*\s+двести/i] },
      { id: 'noise', d: 'шум', sec: null, re: [/переговорк|кондиционер/i] },
    ],
    razborMust: [
      { id: 'cleanup', level: 'warn', d: 'очистка «джобой раз в сутки» — для спеки', re: /джоб|раз в сутки|чищу/i },
      { id: 'yearKept', level: 'warn', d: 'переигранный «год» не потерян', re: /хранятся год|год, наверное/i },
    ],
  },
  // Правка работающей функции, расшифровка в VTT, документов нет. См. fixtures/MEET-CR/expected.md.
  CR: {
    key: 'SUP-412',
    kind: 'bt',
    folder: 'coddoc/SUP-412',
    transcript: 'fixtures/MEET-CR/seed/support-sync-2026-10-16.vtt',
    seed: { 'support-sync-2026-10-16.vtt': 'fixtures/MEET-CR/seed/support-sync-2026-10-16.vtt' },
    etalon: { input: 'fixtures/MEET-CR/etalon/meeting-2026-10-16-bt.md', razbor: 'fixtures/MEET-CR/etalon/meeting-2026-10-16.razbor.md' },
    // Даты в расшифровке нет — имена файлов по дате из имени расшифровки (Шаг 3).
    fileDate: '2026-10-16',
    // Короткая встреча: законный минимальный разбор — около 9 цитат (проверка пробы 2026-10-14).
    minQuotes: 7,
    headerMust: [['цель в шапке — правка работающего', /цель:\W*правк\S*\s+работающ/i]],
    must: [
      // Правка работающего — «как сейчас → как должно стать» (output.md): обе стороны.
      { id: 'sevenDays', d: 'автозакрытие — семь рабочих дней вместо трёх календарных', sec: ['Решено'], re: [/(7|сем\S*)\s+рабоч/i, /(3|тр[её]х|три)\s+календарн/i] },
      { id: 'reminder', d: 'письмо пользователю за рабочий день до закрытия', sec: ['Решено'], re: [/(письм|напомин|уведомл|сообщени|почт)/i, /(за\s+(1\s+|один\s+|одн\S*\s+)?рабоч\S*\s+д|(предыдущ|последн)\S*\s+рабоч)/i] },
    ],
    mustNot: [
      { id: 'fiveDays', d: '«пять рабочих дней» (переиграно)', sec: null, re: [/(^|[^0-9])(5|пят\S*)\s+рабоч/i], not: /а не|вместо|предлага|предлож|мало|отверг|не\s+пят|не\s+принят/i },
      { id: 'bugDecided', d: 'ошибка «Переоткрыть» решением', sec: ['Решено'], re: [/переоткр/i], not: /не в эту задачу|не входит|(^|[^а-яё])вне\s|отдельн/i },
      { id: 'impl', d: 'реализация во входе', sec: null, re: [/производственн\S*\s+календар|(^|[^а-яё])(сервис|крон|бэк(?!лог))/i] },
      { id: 'asr', d: 'форма на слух', sec: null, re: [/эс\s*ю\s*пи|четыреста\s+двенадцат/i] },
    ],
    razborMust: [
      { id: 'calendar', level: 'warn', d: 'производственный календарь — для спеки', re: /производственн\S*\s+календар/i },
      { id: 'fiveKept', level: 'warn', d: 'переигранные «пять рабочих» не потеряны', re: /пять рабочих/i },
    ],
  },
}

// ---------- вход ----------

function sections (text) {
  const out = {}
  let cur = null
  for (const line of text.split('\n')) {
    const m = line.match(/^##\s+(.+?)\s*$/)
    if (m) { cur = m[1]; out[cur] = []; continue }
    if (cur) out[cur].push(line)
  }
  return out
}

// Пункт — строка «- …», «* …», «N. …» или «N) …» со строками-продолжениями. Подпункт с отступом — часть
// своего пункта: «1. Ежегодный (FR-3):⏎   - не раньше чем за три дня» — одно решение (проверка пробы 2026-10-14).
function items (lines) {
  const out = []
  const MARK = /^\s*(-|\*|\d+[.)])\s+/
  for (const l of lines) {
    if (/^ ?(-|\*|\d+[.)])\s+/.test(l)) out.push(l.replace(MARK, ''))
    else if (l.trim() && out.length) out[out.length - 1] += ' ' + l.trim().replace(MARK, '')
  }
  return out
}

function itemsOf (secs, names) {
  const pick = names ? names : Object.keys(secs)
  return pick.flatMap((n) => (secs[n] ? items(secs[n]).map((t) => ({ sec: n, t })) : []))
}

export function gradeInput (text, fx) {
  const secs = sections(text)
  const r = { must: {}, mustNot: {} }
  // `alt` — тот же пункт законно лежит в другом разделе, но там нужны свои признаки (в «Решено» — отрицание).
  const hit = (c) => itemsOf(secs, c.sec).some(({ t }) => c.re.every((re) => re.test(t)))
  for (const m of fx.must) r.must[m.id] = hit(m) || (m.alt || []).some(hit)
  // Запреты и якоря — только по пунктам разделов: шапка законно несёт роли («бэкенд — …») и время встречи.
  const all = itemsOf(secs, null).map(({ t }) => t)
  for (const m of fx.mustNot) {
    const pool = m.sec ? itemsOf(secs, m.sec).map(({ t }) => t) : all
    r.mustNot[m.id] = pool.some((t) => m.re.every((re) => re.test(t)) && !(m.not && m.not.test(t)))
  }
  r.anchors = all.some((t) => /(^|[^A-Za-z])L\d+([^0-9]|$)|\d\d:\d\d:\d\d/.test(t))
  r.missing = fx.must.filter((m) => !r.must[m.id]).map((m) => m.d)
  // Шапка входа (цель Шага 5) — не пункт раздела, проверяется по всему тексту.
  for (const [d, re] of fx.headerMust || []) if (!re.test(text)) r.missing.push(d)
  r.violations = fx.mustNot.filter((m) => r.mustNot[m.id]).map((m) => m.d)
  if (r.anchors) r.violations.push('якоря или время во входе')
  r.pass = !r.missing.length && !r.violations.length
  return r
}

// ---------- разбор ----------

const norm = (s) => s.toLowerCase().replace(/ё/g, 'е').replace(/[«»"“”]/g, '').replace(/\s+/g, ' ').trim()

function transcriptTexts (raw) {
  return lf(raw).replace(/^\uFEFF/, '').split('\n').map((l) => {
    const m = l.match(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d - .+?: (.*)$/)
    return norm(m ? m[1] : l)
  })
}

// Опечатка в 1–2 символа («руководитель» вместо «руководителя») — не выдумка: сверка ловит выдуманную
// цитату, а не описку. Допуск — 5% длины, не меньше 1 символа; перестановка слов в допуск не влезает.
function near (win, p) {
  if (win.includes(p)) return true
  const k = Math.max(1, Math.floor(p.length * 0.05))
  if (p.length < 8) return false
  let prev = new Array(p.length + 1)
  let cur = new Array(p.length + 1)
  // Расстояние до лучшей подстроки окна (Селлерс): начало подстроки бесплатное.
  for (let j = 0; j <= p.length; j++) prev[j] = j
  for (let i = 1; i <= win.length; i++) {
    cur[0] = 0
    for (let j = 1; j <= p.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (win[i - 1] === p[j - 1] ? 0 : 1))
    }
    if (cur[p.length] <= k) return true;
    [prev, cur] = [cur, prev]
  }
  return false
}

// ДВА УРОВНЯ (2026-10-13, после кругов 1–9). Красный — то, что уходит дальше по пайплайну или делает
// разбор недостоверным: выдуманная цитата (её нет нигде в расшифровке), потеря записи для второго прогона.
// Предупреждение — точность журнала: цитата дословная, но с чужим номером строки; в журнале нет
// переигранного или поручения. Все-или-ничего по сотне цитат красило почти каждый круг при верном входе.
export function gradeRazbor (text, fx, tLines) {
  const r = { quotes: 0, bad: [], moved: [] }
  const full = tLines.join(' ')
  // Цитата — на ОДНОЙ строке записи: `[ \t]`, а не `\s`, иначе «итог: L201⏎ опора: «…»» читается цитатой.
  // Диапазон `L54–L57` — реплика на несколько строк (formats.md): окно от начала−2 до конца+2.
  // Время — любое: `11:07:01`, VTT `00:00:54.600`, диапазон `… --> …`, в скобках `[00:00:54]` (проверка пробы CR).
  // `L7: «…»` (конспект без времени и говорящего, пилот 2026-10-16 NOTES run-3) — та же цитата: двоеточие после номера допустимо.
  const re = /L(\d+)(?:[–-]L?(\d+))?:?[ \t]+(?:\[?[\d:.,]+\]?(?:[ \t]*-->[ \t]*[\d:.,]+)?[ \t]+)?(?:[^:«»\n]{1,60}:[ \t]*)?«([^»]+)»/g
  for (const m of text.matchAll(re)) {
    const n = Number(m[1])
    const end = m[2] ? Math.max(n, Number(m[2])) : n
    const win = tLines.slice(Math.max(0, n - 3), end + 2).join(' ')
    // Точка или запятая в конце обрезанного куска — не выдумка: сверяется текст без хвостовой пунктуации.
    // Порог 2 символа: короткое принятие «Да.», «Ок.» — законная цитата.
    const parts = m[3].split(/…|\.\.\./).map(norm).map((p) => p.replace(/[.,;:!?]+$/, '').trim()).filter((p) => p.length >= 2)
    // Цитата без букв и цифр («?», «…») — не выдумка (ревью 1.1.0): сырой текст есть в окне — цитата сошлась; нет —
    // это не цитата, в счёт не идёт.
    if (!parts.length) {
      if (norm(m[3]) && win.includes(norm(m[3]))) r.quotes++
      continue
    }
    r.quotes++
    if (parts.every((p) => near(win, p))) continue
    if (parts.every((p) => near(full, p))) r.moved.push(`L${n} «${m[3].slice(0, 40)}»`)
    else r.bad.push(`L${n} «${m[3].slice(0, 50)}»`)
  }
  r.lost = fx.razborMust.filter((m) => m.level !== 'warn' && !m.re.test(text)).map((m) => m.d)
  r.lostWarn = fx.razborMust.filter((m) => m.level === 'warn' && !m.re.test(text)).map((m) => m.d)
  // Раздел «Во вход» третьим уровнем под своим оглавлением, записи — отдельным разделом (meet-new r1 run-4):
  // содержание и разделы на месте — раскладка журнала, предупреждение. Красный — когда раздела нет вовсе.
  r.heading = /^#{2,3} Во вход /m.test(text)
  r.layout = /^## Во вход /m.test(text)
  r.minQuotes = fx.minQuotes || 10
  r.pass = r.quotes >= r.minQuotes && !r.bad.length && !r.lost.length && r.heading
  return r
}

// ---------- песочница ----------

function listFiles (dir, base = dir) {
  const out = []
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...listFiles(p, base))
    else out.push(relative(base, p).split('\\').join('/'))
  }
  return out
}

// Файлы стенда в корне песочницы: их пишет пул, а не скилл.
const STAND = /^(answer(-\d+)?\.md|stream(-\d+)?\.jsonl|_[^/]*)$/
// Чтение `services/` и `context/` — нарушение правила 1 скилла, даже если ни один токен не утёк.
const RE_FORBIDDEN_READ = /(^|[\s/\\"'=])(services|context)[/\\]/
// Исключение в `find` (`-not -path "./services/*"`) — не чтение.
const RE_EXCLUDE_ARG = /(-not|!)\s+-(i?path|name)\s+(["'])[^"']*\3/g

function toolUses (dir) {
  const out = []
  if (!existsSync(dir)) return out
  for (const f of readdirSync(dir).filter((n) => /^stream(-\d+)?\.jsonl$/.test(n)).sort()) {
    for (const line of read(join(dir, f)).split('\n')) {
      let e; try { e = JSON.parse(line) } catch { continue }
      const content = e && e.message && Array.isArray(e.message.content) ? e.message.content : []
      // События субагентов идут в потоке ведущего с `parent_tool_use_id`.
      for (const c of content) if (c && c.type === 'tool_use') out.push({ name: c.name, input: c.input || {}, sub: !!e.parent_tool_use_id })
    }
  }
  return out
}

export function gradeRun (dir, fx) {
  const r = {}
  const seeded = existsSync(join(dir, '_seeded.txt')) ? new Set(read(join(dir, '_seeded.txt')).split('\n').filter(Boolean)) : new Set()
  const files = listFiles(dir)
  const want = new RegExp(`^coddoc/(.+/)?${fx.key}/meeting-[^/]+-${fx.kind}\\.md$`)
  const razborRe = new RegExp(`^coddoc/(.+/)?${fx.key}/meeting-[^/]+\\.razbor\\.md$`)
  // Вход и разбор прошлой встречи из засева — не результат прогона.
  const inputs = files.filter((f) => want.test(f) && !(f in fx.seed))
  const razbors = files.filter((f) => razborRe.test(f) && !(f in fx.seed))
  r.extra = files.filter((f) => !inputs.includes(f) && !razbors.includes(f) && !seeded.has(f) && !(f in fx.seed) && !(!f.includes('/') && STAND.test(f)))
  r.touched = Object.entries(fx.seed).filter(([rel, src]) => !existsSync(join(dir, rel)) || read(join(dir, rel)) !== read(join(HERE, src))).map(([rel]) => rel)
  r.inputPath = inputs[0] || null
  r.razborPath = razbors[0] || null
  r.input = inputs.length === 1 ? gradeInput(read(join(dir, inputs[0])), fx) : null
  r.razbor = razbors.length === 1 ? gradeRazbor(read(join(dir, razbors[0])), fx, transcriptTexts(readFileSync(join(HERE, fx.transcript), 'utf8'))) : null
  // Анкер с двояким слоем (expected.md): законно и во входе, и в разделе разбора «Для другого документа».
  if (r.input && r.razbor && fx.altOther) {
    const other = (read(join(dir, razbors[0])).split(/^## Для другого документа[^\n]*$/m)[1] || '').split(/^## /m)[0]
    for (const [id, re] of Object.entries(fx.altOther)) {
      if (!r.input.must[id] && re.test(other)) {
        r.input.must[id] = true
        r.input.missing = r.input.missing.filter((d) => d !== fx.must.find((m) => m.id === id).d)
        r.input.pass = !r.input.missing.length && !r.input.violations.length
      }
    }
  }
  const uses = toolUses(dir)
  r.forbiddenReads = uses.filter((u) => ['Read', 'Grep', 'Glob', 'Bash'].includes(u.name) && RE_FORBIDDEN_READ.test(Object.values(u.input).filter((v) => typeof v === 'string').join(' ').replace(RE_EXCLUDE_ARG, '')))
    .map((u) => `${u.sub ? 'субагент' : 'ведущий'} ${u.name} ${JSON.stringify(u.input).slice(0, 90)}`)
  r.agents = uses.filter((u) => !u.sub && (u.name === 'Agent' || u.name === 'Task')).length
  // Дата в именах файлов, когда её нет в расшифровке, — из имени расшифровки (CR).
  r.dateOk = !fx.fileDate || (!!r.inputPath && r.inputPath.endsWith(`/meeting-${fx.fileDate}-${fx.kind}.md`) && !!r.razborPath && r.razborPath.endsWith(`/meeting-${fx.fileDate}.razbor.md`))
  r.pass = inputs.length === 1 && razbors.length === 1 && !r.extra.length && !r.touched.length && !r.forbiddenReads.length && r.input.pass && r.razbor.pass && r.dateOk
  return r
}

// ---------- список пунктов (meeting-intake 2.0.0, режим --points) ----------
//
// 2.0.0 пишет вместо входа список `meeting-<дата>.points.md` (reference/output.md). Ожидания входа переносятся на
// виды пунктов: «Решено» → `[решено]`, «Открыто» → `[открыто]`, «Сведения» → `[сведение]`, «Не входит» →
// `[решено] не входит:` (или `[открыто] не входит ли …` — так output.md велит писать вне рамок, когда вынесший не
// назван). Слоя больше нет — список держит и требования, и реализацию: запрет слоя (`impl`) снят, анкеры разбора
// «для спеки» стали пунктами списка (вид любой: без явного принятия решение идёт через вопрос Шага 5). Запреты на
// переигранное и не принятое остаются; отменённое, которое раньше ловил только запрет слоя, получило свой запрет.
// Цели в 2.0.0 нет — проверка цели в шапке (`headerMust`) снята; сравнения с документом нет — `altOther` снят.

// Сторона решения (ревью оценщиков 2026-10-16). Отрицание у запрета засчитывается, только если стоит в 0–2 словах от
// ключа (`near`): до ключа — «не», «без», «вместо», «кроме», «отклонили»; после — «не нужен», «не будем», «нет»,
// «отклонили». Граница — запятая, точка с запятой, точка, скобка: «опрашиваем раз в минуту, не при загрузке» — не
// отрицание опроса. Раньше любое «не» в пункте делало запрет законным.
// «бы» — довод, не решение: «понадобился бы промежуточный статус».
const NEG_BEFORE = /(^|[^а-яё])(не|ни|нет|без|бы|вместо|кроме|отклон\S*|отверг\S*|отказал\S*)([^а-яё]|$)/i
const NEG_AFTER = /(^|[^а-яё])(нет|нельзя|бы|отклон\S*|отверг\S*|не\s+(нуж|надо|буд|дела|бер|ввод|использ|принят|прин|шл|отправл|трога|стал|вход|подход|годи)\S*)([^а-яё]|$)/i
export function negNear (t, key) {
  const g = new RegExp(key.source, key.flags.replace(/g/g, '') + 'g')
  for (const m of String(t).matchAll(g)) {
    if (!m[0]) continue
    // «не чаще», «не позже», «не больше» — граница, а не отрицание: «не чаще 2 раз в год» — это «2 раза».
    const bound = (s) => s.replace(/(^|[^а-яё])не\s+(чаще|реже|больше|более|меньше|менее|позже|раньше|дольше)(?![а-яё])/gi, '$1')
    const pre = bound(t.slice(0, m.index)).split(/[,;.!?()]/).pop().trim().split(/\s+/).filter(Boolean).slice(-3).join(' ')
    const post = bound(t.slice(m.index + m[0].length).replace(/^\S*/, '')).split(/[,;.!?()]/)[0].trim().split(/\s+/).filter(Boolean).slice(0, 3).join(' ')
    if (NEG_BEFORE.test(pre) || NEG_AFTER.test(post)) return true
  }
  return false
}
// Запрет с `near` — отрицание только у ключа; без `near` — прежний `not` по всему пункту (законное противопоставление).
const legit = (m, t) => (m.near ? negNear(t, m.near) : false) || !!(m.not && m.not.test(t))

// «Расходится с БТ» в ACC — два открытых вопроса к ИБ (эталон разбора): в списке это `[открыто]`.
const KIND_OF = { 'Решено': 'решено', 'Открыто': 'открыто', 'Сведения': 'сведение', 'Не входит': 'не входит', 'Расходится с БТ': 'открыто' }
const RE_NOT_IN = /^не\s+входит/i

// Настройки режима списка по фикстурам. `toList` — анкеры разбора, которые теперь должны стоять в списке (уровень
// анкера сохраняется: красный остаётся красным, предупреждение — предупреждением); `dropNot` — снятые запреты;
// `patch` — анкер с другими признаками; `must`/`mustNot`/`warn` — новые. OUT — фикстура только режима списка.
const PT = {
  VAC: {
    etalon: { points: 'fixtures/MEET-VAC/etalon-2/meeting-2026-10-07.points.md', razbor: 'fixtures/MEET-VAC/etalon-2/meeting-2026-10-07.razbor.md' },
    dropNot: ['impl'],
    // Проверка руководителя на момент нажатия (L124) — два прочтения (слепое чтение 2026-10-16): решение-реализация с
    // косвенным принятием (L125, L130) или проговорённое «просто» (L126). Пункт любого вида или его нет — не красный.
    toList: ['onLoad', 'daysStored'],
    dropRazbor: ['nowCheck'],
    // Побочные темы (решение 2026-10-15: что относится к теме, решает человек на сводке Шага 6): пункт такой темы
    // в списке — красный, только если его нет в строке «Похоже, не про …» ответов. Шум без решений и сведений — красный.
    patch: { noise: { d: 'шум (ноут, винда, школа)', re: [/(^|[^а-яё])(ноут|школ|винд)/i] } },
    side: [
      // «тестовый стенд не работает» (r7 run-1), «недоступный стенд», «стенд сейчас лежит» — тот же ИФТ; «на стенде
      // скриптом» (L128) — проверка задачи, не побочное.
      { id: 'ift', d: 'стенд ИФТ (L184, L231)', re: /(^|[^а-яё])ифт|стенд\S*[^.;]{0,30}(не\s+работ|лежит|недоступ)|(недоступ|лежит)\S*[^.;]{0,30}стенд/i },
      { id: 'perDiem', d: 'баг с суточными (L19)', re: /суточн/i },
    ],
    mustNot: [
      // Не принято L139–L141 и переиграно L148: раньше их ловил запрет слоя («опрос», «фронт»).
      { id: 'poll', d: '«опрашивать раз в минуту» решением (не принято L139–L141)', sec: ['Решено'], re: [/раз в минуту|опраш|(^|[^а-яё])опрос/i], near: /раз в минуту|опраш\S*|опрос\S*/i },
      // Пара к якорю `fr10` (он ищет тему «отмена + день начала», а не сторону): L179 «Наступила дата нельзя».
      { id: 'fr10Inv', d: 'кадровик может отменить отпуск в день начала (обратное FR-10, L179)', sec: ['Решено'], re: [/отмен|отозв/i, /(^|[^а-яё])в\s+(сам\S*\s+)?(день|дат\S*)\s+(его\s+|её\s+)?начал|в\s+первый\s+день/i], not: /уже\s+не|не\s+(может|мож|отмен|вправе|разреш)|нельзя|запрещ/i },
      { id: 'frontCount', d: '«число дней считает фронт» решением (переиграно L148)', sec: ['Решено'], re: [/(фронт|экран)[^.;]{0,30}счита|счита\S*[^.;]{0,30}(фронт|экран)/i], not: /а не|не на|вместо|бэк/i },
      { id: 'asrPt', d: 'форма на слух («ютиси»)', sec: null, re: [/ютиси/i], not: /на\s+слух/i },
    ],
    // Аудит круга 1 (2026-10-15): L174–L177 — следствие правила дня начала. Предупреждение, не красный: прозвучало
    // возражением Литвинова, подтверждено одним «Да», в итог L217–L227 не вошло, решения за ним нет.
    warn: [
      { id: 'firstDay', d: 'в первый день отказа заявка в портале остаётся «согласована» (L174–L177)', sec: null, re: [/согласован/i, /перв\S*\s+д(ень|ня)|день\s+начала|начал\S*\s+отпуск|не\s+пойд|не\s+выйд|отказ|откаж/i, /виси|висе|оста|в\s+портале|статус/i] },
      { id: 'nowCheck', d: 'проверка руководителя на момент нажатия (L124, два прочтения)', sec: null, re: [/момент нажат|при нажати|на момент согласован|руководител[^\n]{0,80}(провер|ошибк)/i] },
    ],
  },
  ACC: {
    etalon: { points: 'fixtures/MEET-ACC/etalon-2/meeting-2026-10-09.points.md', razbor: 'fixtures/MEET-ACC/etalon-2/meeting-2026-10-09.razbor.md' },
    // Заглушка для тестов (L183–L186, L204): анкер разбора искал слово, которое в цитатах есть всегда, — в списке.
    toList: ['mock'],
    // Побочные темы (решение 2026-10-15: что относится к теме, решает человек на сводке Шага 6): пункт такой темы
    // в списке — красный, только если его нет в строке «Похоже, не про …» ответов. Шум без решений и сведений — красный.
    // `midStatus`: «ИБ» — без учёта регистра и на слух («ибэ», L60, L94, L197); `midDecided`: отрицание — у ключа.
    patch: {
      noise: { d: 'шум (электричка, тоннель, ремонт)', re: [/ремонт|электричк|тоннел/i] },
      midStatus: { re: [/статус/i, /(^|[^а-яё])(иб|ибэ|и\s+бэ)([^а-яё]|$)|безопасност/i] },
      midDecided: { near: /промежуточн\S*/i, not: null },
    },
    side: [
      // «упала проверка в общей сборке» (r7 run-3) — пересказ L11–L12; слова «сборк» в расшифровке нет.
      { id: 'ci', d: 'красный пайплайн, линтер (L11–L12)', re: /гитлаб|линтер|пайплайн|сборк/i },
      { id: 'retro', d: 'перенос ретро (L188)', re: /(^|[^а-яё])ретро/i },
    ],
    // Аудит круга 1: «нам подписка не нужна» — «вычёркиваю» (L174–L175), в итогах дважды «шину не берём» (L205–L206).
    // extract.md: сказали, чего не делаем, — запись «вне рамок» → `[решено] не входит:` (или `[открыто] не входит ли`).
    must: [
      { id: 'busOut', d: '«шину не берём»: подписка на увольнения — не входит (L174–L175, L205–L206)', sec: ['Не входит'], re: [/(^|[^а-яё])шин|подпис|увольн/i] },
    ],
    // Пара к якорю `login` («логин» + «хран» — тема, а не сторона): L114–L120 логин хранится в портале.
    mustNot: [
      { id: 'loginInv', d: 'логин учётки в портале не хранится (обратное решению L114)', sec: ['Решено'], re: [/логин/i, /не\s+(хран|сохран)/i] },
    ],
  },
  LONG: {
    etalon: { points: 'fixtures/MEET-LONG/etalon-2/meeting-2026-10-12.points.md', razbor: 'fixtures/MEET-LONG/etalon-2/meeting-2026-10-12.razbor.md' },
    // Кеш руководителя на сутки (L322–L327) — два прочтения (слепое чтение 2026-10-16): решение «в спеку» или
    // «просто проговариваю» (L326). Пункт любого вида или его нет — не красный. Таблица и транзакция (L328–L330) — решение.
    toList: ['tx'],
    dropRazbor: ['cache'],
    // Побочные темы (решение 2026-10-15: что относится к теме, решает человек на сводке Шага 6): пункт такой темы
    // в списке — красный, только если его нет в строке «Похоже, не про …» ответов. Шум без решений и сведений — красный.
    dropNot: ['impl', 'otherTopic'],
    patch: { noise: { d: 'шум (столовая)', re: [/(^|[^а-яё])столов/i] } },
    side: [
      { id: 'trips', d: 'отчёт по командировкам (L1–L165)', re: /CSV|бухгалтер|командиров/i },
      // «Кнопка справа» (L138–L142), «Тема формы текстом» (L542–L545) — та же форма обратной связи (r7 run-1).
      { id: 'feedback', d: 'форма обратной связи (L1–L165, L541–L546)', re: /обратн\S*\s+связ|капч|справа|тем\S*\s+форм/i },
      { id: 'cert', d: 'сертификат стенда', re: /сертификат/i },
      // «Следующая встреча по пропускам… четверг не подошёл из-за релиза» (r3 run-1) — основная тема, релиз мимоходом.
      { id: 'release', d: 'процесс релиза', re: /(^|[^а-яё])релиз/i, not: /пропуск/i },
      { id: 'ift', d: 'стенд ИФТ (L58–L59)', re: /(^|[^а-яё])ифт|стенд\S*[^.;]{0,30}(не\s+работ|лежит|недоступ)|(недоступ|лежит)\S*[^.;]{0,30}стенд/i },
      { id: 'regress', d: 'регресс по прошлому релизу (L103, L164)', re: /регресс/i },
      // Следующая встреча по этой задаче (L642): без пометки — не красный (r4), с пометкой — не ложная (r7 run-1).
      { id: 'nextMeet', either: true, d: 'следующая встреча (L642)', re: /следующ\S*\s+встреч/i },
      { id: 'search', d: 'поиск по справочнику, баг «Ёлкин» (L1–L165, L487)', re: /(^|[^а-яё])(поиск|ёлкин|елкин)/i },
      // «Следующая встреча по пропускам в пятницу в 11:00 (в 10:00 у Мельникова планёрка)» (r4 run-1) — встреча по
      // основной теме, планёрка мимоходом; как «…из-за релиза» у `release`.
      { id: 'plan', d: 'планёрка (L648)', re: /планёрк/i, not: /пропуск/i },
    ],
    mustNot: [
      // Не принято L311–L313; раньше ловил запрет слоя.
      { id: 'messenger', d: 'уведомление в мессенджер или ботом решением (не принято L311–L313)', sec: ['Решено'], re: [/мессенджер|(^|[^а-яё])бот(а|ом|у|е|ы)?([^а-яё]|$)/i], near: /мессенджер\S*|(^|[^а-яё])бот(а|ом|у|е|ы)?(?![а-яё])/i },
      // Слепое чтение 2026-10-16: L258 «до шестнадцати ноль ноль НАКАНУНЕ» — «рабочего дня» для 16:00 не сказано.
      { id: 'deputyWorkday', d: '16:00 «последнего рабочего дня» (на встрече — «накануне», L258)', sec: null, re: [/(16|шестнадцат\S*)[^.;]{0,25}последн\S*\s+рабоч|последн\S*\s+рабоч\S*\s+дн\S*[^.;]{0,10}(16|шестнадцат)/i] },
      // L205–L206 — сведение Сафиной («справочник праздников, его кадры ведут»), «Хорошо» Гаврилова L208; второе прочтение —
      // неявное решение Гаврилова. Сафина решившей — нет.
      { id: 'holidaysSafina', d: 'справочник праздников «решил: Сафина» (L205–L206 — сведение)', sec: null, re: [/праздник/i, /решил[аи]?:[^·]*Сафин/i] },
      // Пара к якорю `rejectComment` («обязател» — тема, а не сторона), в пределах одной части пункта.
      { id: 'rejectInv', d: 'комментарий при отклонении необязателен (обратное решению L592)', sec: ['Решено'], re: [/отклон[^,;.]*(не\s*обязател|необязател|по\s+желани)|(не\s*обязател|необязател|по\s+желани)[^,;.]*отклон/i] },
    ],
    // Почта (L314–L317): предложила Сафина, приняла Орлова (L315–L316) — решившая Орлова; Сафина — предупреждение.
    notice: [
      { d: 'почта «решил: Сафина» — приняла Орлова (L315–L316)', sec: null, re: [/почт/i, /решил[аи]?:[^·]*Сафин/i] },
    ],
    warn: [
      { id: 'cache', d: 'кеш руководителя на сутки (L322, два прочтения)', sec: null, re: [/кеш|кэш/i] },
    ],
  },
  NEW: {
    etalon: { points: 'fixtures/MEET-NEW/etalon-2/meeting-2026-10-08.points.md', razbor: 'fixtures/MEET-NEW/etalon-2/meeting-2026-10-08.razbor.md' },
    dropNot: ['impl'],
    toList: ['tpl'],
    // Побочные темы (решение 2026-10-15: что относится к теме, решает человек на сводке Шага 6): пункт такой темы
    // в списке — красный, только если его нет в строке «Похоже, не про …» ответов. Шум без решений и сведений — красный.
    patch: { noise: { d: 'шум (собака, кофемашина)', re: [/собак|кофемашин/i] } },
    side: [
      { id: 'demo', d: 'перенос демо (L116)', re: /(^|[^а-яё])демо/i },
    ],
    must: [
      // Анкер разбора `zup` искал слова цитат («должность и дата приёма у нас в зупе»); в пункте — пересказ.
      // «…уже есть в системе, из которой предлагают их брать» (r1 run-2) — факт на месте: «зуп» без опоры словами
      // «кадровая» назвать не обязательно, предмет держит первый признак.
      { id: 'zup', d: 'данные о сотруднике (должность, дата приёма) — в кадровой системе', sec: null, re: [/должност|дат\S*\s+при[её]м|данн\S*\s+(о\s+)?сотрудник/i, /кадров|зуп|систем/i] },
      // Аудит круга 1: L85–L86 «На почту дублировать?» — «Нет, только на портале. Почту мы не трогаем.» — прямой ответ.
      // В пункте об уведомлении «только на портале» или отдельным «не входит» (extract.md: сказали, чего не делаем).
      // «не входит: бывшие сотрудники — пишут на почту» — не про канал уведомлений (проверка на прогонах круга 1).
      { id: 'mailOut', d: '«только на портале, почту не трогаем» (L85–L86)', sec: ['Не входит'], re: [/почт/i, /уведомл|оповещ|дублир|не\s+трога/i], alt: [{ sec: ['Решено'], re: [/уведомл/i, /только\s+(на\s+)?портал|не\s+дублир|без\s+(дублир\S*\s+)?(на\s+)?почт|почт\S*[^.;]{0,30}не\s+(трога|дублир|шл|отправл)|не\s+(на\s+)?почт/i] }] },
    ],
    dropRazbor: ['zup'],
    mustNot: [
      // «Зуп» — форма на слух (expected.md); раньше его ловил запрет слоя.
      { id: 'asrPt', d: 'форма на слух («зуп»)', sec: null, re: [/(^|[^а-яё])зуп/i], not: /на\s+слух/i },
      // Пары к якорям `self` и `cancel`: они ищут тему («за другого», «в работу»), а не сторону решения.
      { id: 'selfInv', d: 'заказ справки за другого сотрудника разрешён (обратное решению L104)', sec: ['Решено'], re: [/(^|[^а-яё])(за|для)\s+(друг\S*|коллег\S*|подчин\S*)/i], not: /только\s+(для\s+)?себ|(^|[^а-яё])нельзя|не\s+мож|не\s+(за|для)\s+(друг|коллег|подчин)/i },
      { id: 'cancelInv', d: 'отмена и после взятия в работу (обратное решению L90)', sec: ['Решено'], re: [/отмен/i, /(после|когда)\s+(\S+\s+){0,3}(взял|взят|в\s+работ)|в\s+любой\s+момент|(^|[^а-яё])в\s+работе/i], not: /нельзя|не\s+мож|не\s+отмен|запрещ|только\s+пока|пока\s+(её\s+|ее\s+)?не/i },
    ],
  },
  REW: {
    etalon: { points: 'fixtures/MEET-REW/etalon-2/meeting-2026-10-14.points.md', razbor: 'fixtures/MEET-REW/etalon-2/meeting-2026-10-14.razbor.md' },
    // Побочные темы (решение 2026-10-15: что относится к теме, решает человек на сводке Шага 6): пункт такой темы
    // в списке — красный, только если его нет в строке «Похоже, не про …» ответов. Шум без решений и сведений — красный.
    // Шума без сведений в REW нет: переезд, этаж, принтер — сведения об офисе (L7–L8), демо — расписание (L70).
    dropNot: ['noise'],
    // `messenger`: отрицание — у ключа («мессенджер о новой заявке, не на почту» — решение мессенджером).
    patch: { messenger: { near: /мессенджер\S*/i, not: null } },
    side: [
      { id: 'move', d: 'переезд на шестой этаж, принтер (L7–L8)', re: /переезд|(^|[^а-яё])этаж|принтер/i },
      { id: 'demo', d: 'демо в четыре (L70)', re: /(^|[^а-яё])демо/i },
    ],
  },
  CHG: {
    etalon: { points: 'fixtures/MEET-CHG/etalon-2/meeting-2026-10-15.points.md', razbor: 'fixtures/MEET-CHG/etalon-2/meeting-2026-10-15.razbor.md' },
    // Побочные темы (решение 2026-10-15: что относится к теме, решает человек на сводке Шага 6): пункт такой темы
    // в списке — красный, только если его нет в строке «Похоже, не про …» ответов. Шум без решений и сведений — красный.
    dropNot: ['impl', 'otherTopic'],
    side: [
      { id: 'trips', d: 'суточные в командировках, EMP-1190 (L39–L46, L50–L52)', re: /суточн|командиров|бухгалтер/i },
    ],
    toList: ['cleanup'],
  },
  CR: {
    etalon: { points: 'fixtures/MEET-CR/etalon-2/meeting-2026-10-16.points.md', razbor: 'fixtures/MEET-CR/etalon-2/meeting-2026-10-16.razbor.md' },
    dropNot: ['impl'],
    toList: ['calendar'],
    // L70 «кнопка «Переоткрыть» в мобильной версии не нажимается» — чужая ошибка, «не в эту задачу» (expected.md).
    side: [
      { id: 'reopen', d: 'ошибка кнопки «Переоткрыть» (L70)', re: /переоткр|кнопк|ошибк/i }, // «Ильин заведёт эту ошибку отдельно» — r9 run-3
    ],
    // «Как сейчас → как должно стать» было правилом цели «правка работающего» (output.md 1.x); в 2.0.0 «как сейчас» —
    // своё `[сведение]`, поэтому три календарных дня ждём в любом пункте, семь рабочих — в `[решено]`.
    patch: { sevenDays: { d: 'автозакрытие — семь рабочих дней', re: [/(7|сем\S*)\s+рабоч/i] } },
    must: [
      { id: 'nowThree', d: 'как сейчас — три календарных дня', sec: null, re: [/(3|тр[её]х|три)\s+календарн/i] },
    ],
    // L64–L67 «В работе» не трогаем, там автозакрытия нет: обратное — красный.
    mustNot: [
      { id: 'inWork', d: 'автозакрытие в статусе «В работе» (обратное решению L67)', sec: ['Решено'], re: [/(^|[^а-яё])в\s+работе/i, /автозакр|закрыва\S*\s+автомат|автомат\S*\s+закр/i], not: /не\s+(трога|закрыва|меня|ввод)|(^|[^а-яё])нет([^а-яё]|$)/i },
    ],
  },
  // Созвон-расспрос без решений: fixtures/MEET-OUT/expected.md (перенос MI-NB-OUT на 2.0.0).
  OUT: {
    key: null,
    folder: 'coddoc/_inbox',
    transcript: 'fixtures/MEET-OUT/seed/calls/2026-10-10-pvz-kak-seychas.txt',
    seed: { 'calls/2026-10-10-pvz-kak-seychas.txt': 'fixtures/MEET-OUT/seed/calls/2026-10-10-pvz-kak-seychas.txt' },
    etalon: { points: 'fixtures/MEET-OUT/etalon-2/meeting-2026-10-10.points.md', razbor: 'fixtures/MEET-OUT/etalon-2/meeting-2026-10-10.razbor.md' },
    minQuotes: 5,
    keyAsk: true,
    bareRed: true,
    stopCheck: true,
    must: [],
    count: [
      { d: '[сведение] … — со слов <кто>', min: 3, test: (it) => it.kind === 'сведение' && /[—–-]\s*со\s+слов\s+\S/i.test(it.t) },
      { d: '[открыто] … — ждёт: <названный человек или служба>', min: 1, test: (it) => it.kind === 'открыто' && /жд[её]т:\s*[^\s—–-]/i.test(it.t) },
    ],
    mustNot: [
      { id: 'decided', d: '[решено] в списке (решений на встрече нет)', sec: ['[решено]'], re: [/[\s\S]/] },
    ],
    warn: [
      { id: 'place', d: 'открытый вопрос про место под посылки', sec: ['Открыто'], re: [/мест/i, /посыл/i] },
      { id: 'sticker', d: 'открытый вопрос про наклейку крупнее', sec: ['Открыто'], re: [/наклейк/i, /крупн|больш|коробк/i] },
    ],
    // Полнота сведений (аудит круга 1: r1 meet-out run-1 выкинул L7–L16 и L50–L64, из 16 сведений осталось 8, оценщик
    // был зелёным). Перечень выведен из расшифровки до правки оценщика — 17 фактов расспроса «как сейчас»; пункт любого
    // вида, числа — цифрами или словами. Порог — 14 из 17 (80%): пункт может слить два факта или опустить мелочь, а
    // потеря целого куска созвона — это 5+ фактов. Критичные — красный и при пороге: на них держится вопрос созвона
    // (как принимать посылки на точке): люди, часы работы, пик, объём возвратов, лента принтера (L38 набрана в чате;
    // от неё зависит открытый вопрос о наклейке), место, передача водителю.
    factsMin: 14,
    facts: [
      // «один человек», «с 9 утра до 9 вечера», «от 20 до 30» — те же факты другими словами (ревью оценщиков 2026-10-16).
      { id: 'staff', critical: true, d: 'в смене один оператор, в пятницу и выходные двое (L8)', re: [/оператор|человек|сотрудник|(^|[^а-яё])(один|одна|двое|двоих|1|2)([^а-яё0-9]|$)/i, /пятниц|выходн/i] },
      { id: 'hours', critical: true, d: 'смена 12 часов, с 9 до 21 (L10)', re: [/(^|\D)12\s*час|двенадцат\S*\s+час|(^|\D)9\s*(:00)?\s*(утра\s*)?(до|[–—-])\s*(21|9\s*вечера)|девят\S*\s+(утра\s+)?до\s+(девят|21)/i] },
      { id: 'noDayOff', d: 'без выходных, закрыты только 1 января (L12)', re: [/без\s+выходн|1\s+января|перв\S*\s+января|ежедневн|каждый\s+день/i] },
      { id: 'peak', critical: true, d: 'пик вечером 18–21, очередь до 10, обычно 3–4 (L14, L16)', re: [/очеред|(^|[^а-яё])пик|загружен|наплыв/i, /вечер|(^|\D)18|шест\S*\s+до/i] },
      { id: 'checks', d: 'что проверяют при приёме: код, товар целый, бирки (L20–L22)', re: [/бирк|ношен|товар\S*[^.;]{0,40}(цел|осмотр|провер|смотр)|(осматрив|осмотр|провер|смотр)\S*[^.;]{0,30}товар/i] },
      { id: 'duration', d: 'приём возврата в среднем 3–5 минут (L24–L26)', re: [/минут/i, /(^|\D)[35](\D|$)|тр(и|ёх|ех)|пят/i] },
      { id: 'volume', critical: true, d: '20–30 возвратов в день на точку (L28–L29)', re: [/(^|\D)20\s*([–—-]|до|или)\s*30|двадцат\S*\s*([–—-]|до|или)?\s*тридцат/i] },
      { id: 'scanner', d: 'сканируют планшетом с камерой, ручной сканер — для выдачи (L31)', re: [/планшет|камер/i] },
      { id: 'noCode', d: 'без кода возврат не принимают (L33)', re: [/без\s+кода|код\S*[^.;]{0,40}не\s+приним|не\s+приним\S*[^.;]{0,40}без\s+код/i] },
      { id: 'tape', critical: true, d: 'термопринтер, лента 58 мм (L35–L39)', re: [/(^|\D)58(\D|$)|пятьдесят\s+восем/i] },
      { id: 'shelf', critical: true, d: 'стеллаж под возвраты в подсобке, наполовину пуст (L43–L44)', re: [/стеллаж|подсобк/i] },
      { id: 'seal', critical: true, d: 'мешок пломбируют, акт водителю, два экземпляра, месяц (L51–L52)', re: [/пломб|(^|[^а-яё])акт(а|е|ом|ы)?([^а-яё]|$)/i] },
      { id: 'noDriver', d: 'водитель не приезжает 1–2 раза в месяц, мешок лежит до следующего дня (L54–L55)', re: [/не\s+приезжа|не\s+при(ехал|едет)|раз\S*\s+в\s+месяц|до\s+следующего\s+дня/i] },
      { id: 'sortCenter', d: 'мешок — на региональный сортировочный центр, сортируют ночью (L57)', re: [/сортировоч|сортиру/i] },
      { id: 'delivery', d: 'по городу — на следующий день, межгород 2–4 дня, Дальний Восток до 10 (L59–L60)', re: [/межгород|дальн\S*\s+восток|по\s+городу/i] },
      { id: 'seller', d: 'возвраты едут на склад продавца (L62)', re: [/продавц/i] },
      { id: 'training', d: 'обучение: курс около часа, неделя со старшим (L64)', re: [/курс|обуч|новичок|новеньк|со\s+старш/i] },
    ],
    razborMust: [],
    // L61–L62 «Это по заказам, да? Не по возвратам.» — «По заказам.»: пометка сроков доставки — законна (r7 run-3).
    side: [
      { id: 'delivery', either: true, d: 'сроки доставки заказов (L59–L62)', re: /доставк|по\s+заказам/i }, // «Это сроки по заказам, не по возвратам» — r8 run-1
    ],
  },
  // Вторая встреча за день (Н4, баг 5): в coddoc/_inbox/ уже лежат список и разбор другой встречи той же даты (ломбард).
  // fixtures/MEET-SAMEDAY/expected.md. Эталон — синтетический прогон selftest/loop/meet-synth/SAMEDAY/.
  SAMEDAY: {
    key: null,
    folder: 'coddoc/_inbox',
    transcript: 'fixtures/MEET-SAMEDAY/seed/vstrecha-2026-10-19.txt',
    seed: {
      'vstrecha-2026-10-19.txt': 'fixtures/MEET-SAMEDAY/seed/vstrecha-2026-10-19.txt',
      'coddoc/_inbox/meeting-2026-10-19.points.md': 'fixtures/MEET-SAMEDAY/seed/coddoc/_inbox/meeting-2026-10-19.points.md',
      'coddoc/_inbox/meeting-2026-10-19.razbor.md': 'fixtures/MEET-SAMEDAY/seed/coddoc/_inbox/meeting-2026-10-19.razbor.md',
    },
    // Засев — байт в байт (sha256 из expected.md): перезапись, дописывание, правка `> Список:` — красный на любой версии.
    seedSha: {
      'coddoc/_inbox/meeting-2026-10-19.points.md': '39a419d09f485e3782c5d06a040a6c221cf7f19017d0bc5942b60d5c040f02bc',
      'coddoc/_inbox/meeting-2026-10-19.razbor.md': 'e9931728607a392540c361dfcaaf87857dad7a03c55d812bd9cd0083c041bf64',
    },
    etalon: { points: 'selftest/loop/meet-synth/SAMEDAY/meeting-2026-10-19-2.points.md', razbor: 'selftest/loop/meet-synth/SAMEDAY/meeting-2026-10-19-2.razbor.md' },
    // Место `-2` — по правке E5; на 2.0.0 `.points-2.md`, `.points.md-2` — проявление бага 5, не ложь.
    anyDash: true,
    keyAsk: true,
    byEdit: { id: 'по правке E5 (баг 5)', list: 'meeting-2026-10-19-2.points.md', razbor: 'meeting-2026-10-19-2.razbor.md' },
    must: [
      // Таблица и «на две недели вперёд» — одним пунктом или двумя (пилот 2026-10-16: L42 и L45 отдельными решениями).
      { id: 'table', d: 'расписание на сайте таблицей (L42–L47)', sec: ['Решено'], re: [/таблиц/i] },
      { id: 'twoWeeks', d: 'расписание на две недели вперёд (L43–L47)', sec: ['Решено'], re: [/(^|\D)2\s*недел|две\s+недел|двух\s+недел/i] },
      { id: 'fills', d: 'таблицу заполняет старший администратор (L50–L56)', sec: ['Решено'], re: [/заполня|внос|вед[её]т/i, /администратор|Пестов/i] },
      { id: 'cancelShown', d: 'отменённый сеанс — зачёркнутым и с причиной (L63–L67)', sec: ['Решено'], re: [/отмен/i, /зач[её]ркн/i, /причин/i] },
      { id: 'weekBefore', d: 'отмену из-за турнира вносят не позже чем за неделю (L77–L81)', sec: ['Решено'], re: [/турнир/i, /недел/i] },
      // L87–L89 «полтора часа» переиграно частично после итога (L117–L120): запись делится — будни и выходные.
      { id: 'durWeekday', d: 'сеанс в будни — полтора часа (L119–L120)', sec: ['Решено'], re: [/будн/i, /полтора|1[,.]5\s*час|90\s*мин/i] },
      { id: 'durWeekend', d: 'сеанс в выходные — час (L118–L120)', sec: ['Решено'], re: [/выходн/i, /(^|[^а-яё0-9,.])(час|1\s*ч\S*|одн\S*\s+час|60\s*мин)([^а-яё]|$)|по\s+часу/i] },
      { id: 'hockeyOut', d: 'не входит: хоккейное расписание на сайте (L100–L103)', sec: ['Не входит'], re: [/хоккей/i], alt: [{ sec: ['Решено'], re: [/хоккей/i, /(^|[^а-яё])не\s+(бер|показыва)|не входит/i] }] },
      { id: 'subsOut', d: 'не входит: абонементы — следующей итерацией (L104–L107)', sec: ['Не входит'], re: [/абонемент/i], alt: [{ sec: ['Решено', 'Открыто'], re: [/абонемент/i, /следующ|не\s+сейчас|не входит|позже|потом/i] }] },
      { id: 'tickets', d: 'продажа билетов через сайт и свободные места — открыто (L93–L99)', sec: ['Открыто'], re: [/билет|продаж/i] },
    ],
    mustNot: [
      // Ловушка 3: чужая встреча (засев) в новом списке.
      { id: 'foreign', d: 'встреча о залоге в списке встречи о катке (засев)', sec: null, re: [/залог|ломбард|товаровед|(^|[^а-яё])камн|издели|страхов|Каргин|Шамсутдинов/i] },
      { id: 'allOneAndHalf', d: '«полтора часа» решением для всех сеансов (переиграно L117–L120)', sec: ['Решено'], re: [/полтора|1[,.]5\s*час|90\s*мин/i], not: /будн|выходн/i },
      { id: 'weekendOneAndHalf', d: '«полтора часа» в выходные (переиграно L117–L120)', sec: ['Решено'], re: [/в\s+выходн[а-яё]*\s*(?:[—–:-]\s*)?(?:сеанс[а-яё]*\s+)?(?:тоже\s+)?(?:[—–:-]\s*)?(?:полтора|1[,.]5)|(?:полтора|1[,.]5)\s+час[а-яё]*\s+(?:в\s+)?выходн/i] },
      // Утверждение «в выходные (сеанс) полтора часа» — не довод «при пяти сеансах в выходные по полтора часа … не
      // влезают» (пилот 2026-10-16): «по полтора» в шаблон не входит.
      { id: 'noise', d: 'шум (машина по льду, туннель, ноутбук)', sec: null, re: [/по\s+льду\s+езд|машин\S*\s+по\s+льду|туннел|ноутбук|зарядк/i] },
    ],
    factsMin: 3,
    facts: [
      { id: 'friday', d: 'расписание по пятницам на неделю, картинкой (L12–L14)', re: [/пятниц/i, /картинк|недел/i] },
      { id: 'sessions', d: 'в будни 3 сеанса, в выходные 5 (L18)', re: [/(^|\D)3(\D|$)|три|тр[её]х/i, /(^|\D)5(\D|$)|пят[ьи]/i, /сеанс/i] },
      { id: 'flood', d: 'заливка 15 минут между сеансами (L20)', re: [/залив/i, /(^|\D)15(\D|$)|пятнадцат/i] },
      { id: 'calls', d: 'звонков про расписание около 60 в день (L23)', re: [/звон/i, /(^|\D)60(\D|$)|шестьдесят/i] },
      { id: 'hockeyHours', d: 'хоккейная школа: будни 7–9 и 16–18, турнир в субботу (L33–L35)', re: [/хоккей|школ/i, /(^|\D)7(\D|$)|сем[иь]/i, /(^|\D)16(\D|$)|шестнадцат/i] },
      { id: 'calendar', d: 'календарь турниров — примерно за месяц (L37)', re: [/календар|турнир/i, /месяц/i] },
      { id: 'capacity', d: 'на льду не больше 150 человек (L92)', re: [/(^|\D)150(\D|$)|ста\s+пятидесят|сто\s+пятьдесят/i] },
    ],
    razborMust: [],
    side: [],
  },
  // Аналитик возражает (Н5): «Поправить» предмет, предоплата «в открытые», «Записать без этих K». За аналитика — двойник
  // (twin-objector.md + fixtures/MEET-TWIN/twin-card.md), его реплики — `_twin/reply-*.txt`: опора «со слов аналитика».
  // fixtures/MEET-TWIN/expected.md. Эталон — синтетический прогон selftest/loop/meet-synth/TWIN/.
  TWIN: {
    key: null,
    folder: 'coddoc/_inbox',
    transcript: 'fixtures/MEET-TWIN/seed/vstrecha-2026-10-20.txt',
    seed: { 'vstrecha-2026-10-20.txt': 'fixtures/MEET-TWIN/seed/vstrecha-2026-10-20.txt' },
    etalon: {
      points: 'selftest/loop/meet-synth/TWIN/meeting-2026-10-20.points.md',
      razbor: 'selftest/loop/meet-synth/TWIN/meeting-2026-10-20.razbor.md',
      // Диалог прогона: ходы агента и реплики двойника (номера ходов — не 01–02: самотест пишет свои answer-01/02).
      files: {
        'answer-21.md': 'selftest/loop/meet-synth/TWIN/answer-21.md',
        'answer-22.md': 'selftest/loop/meet-synth/TWIN/answer-22.md',
        'answer-23.md': 'selftest/loop/meet-synth/TWIN/answer-23.md',
        'answer-24.md': 'selftest/loop/meet-synth/TWIN/answer-24.md',
        'answer-25.md': 'selftest/loop/meet-synth/TWIN/answer-25.md',
        '_twin/reply-22.txt': 'selftest/loop/meet-synth/TWIN/reply-22.txt',
        '_twin/reply-23.txt': 'selftest/loop/meet-synth/TWIN/reply-23.txt',
        '_twin/reply-24.txt': 'selftest/loop/meet-synth/TWIN/reply-24.txt',
        '_twin/reply-25.txt': 'selftest/loop/meet-synth/TWIN/reply-25.txt',
      },
    },
    // Ветка 1: предмет — ответ аналитика «онлайн-запись на сезонную переобувку»; склад (L8) он отверг.
    title: { d: 'склад хранения — предмет, который аналитик отверг («Поправить»)', re: [/запис/i, /переобув/i], not: /склад|хранени/i },
    // Ветка 3: показано «Похоже, не про …», аналитик «Записать без этих K», а пункт в списке — красный.
    sideDrop: true,
    keyAsk: true,
    side: [
      // L25–L26 (весенний наплыв) читается двояко — склад или пик переобувки: не грейдится.
      { id: 'storage', d: 'склад хранения колёс (L8–L29)', re: /склад|хранени|бирк|однофамил|Заводск/i, not: /апрел|весн|(^|\D)100(\D|$)|сто\s+(человек|за\s+день)|до\s+ворот/i },
      { id: 'discount', d: 'скидочные карты (L76–L78)', re: /скидк|скидочн/i },
    ],
    must: [
      { id: 'online', d: 'онлайн-запись: клиент сам выбирает точку, день и время (L43–L44)', sec: ['Решено'], re: [/запис/i, /точк/i, /врем/i] },
      { id: 'durations', d: 'легковая — 40 минут, кроссовер и внедорожник — час (L46–L51)', sec: ['Решено'], re: [/легков/i, /(^|\D)40(\D|$)|сорок/i, /внедорожн|кроссовер/i] },
      { id: 'posts', d: 'один пост — живая очередь, три — под запись (L52–L53)', sec: ['Решено'], re: [/пост/i, /жив\S*\s+очеред/i] },
      { id: 'fields', d: 'имя, телефон, марка и номер машины (L54–L58)', sec: ['Решено'], re: [/имя|имени/i, /телефон/i, /марк/i, /номер/i] },
      { id: 'cancel', d: 'отмена по ссылке не позже чем за два часа (L69–L72)', sec: ['Решено'], re: [/отмен/i, /(^|\D)2\s*час|два\s+час|двух\s+час/i] },
      { id: 'twoWeeks', d: 'запись на две недели вперёд (L94–L96)', sec: ['Решено'], re: [/(^|\D)2\s*недел|две\s+недел|двух\s+недел/i] },
      { id: 'trucks', d: 'не входит: грузовые онлайн (L61–L63)', sec: ['Не входит'], re: [/грузов|газел/i], alt: [{ sec: ['Решено'], re: [/грузов|газел/i, /(^|[^а-яё])не\s+(бер|принима|дела)|только\s+по\s+телефон|не входит/i] }] },
      { id: 'reminder', d: 'напоминание за день — смс или мессенджер: открыто (L88–L93)', sec: ['Открыто'], re: [/напом(ин|н)/i, /смс|sms/i, /мессенджер/i] },
    ],
    mustNot: [
      // Ветка 2: предоплата условна (L83 «если бухгалтерия согласует»), аналитик — «В открытые вопросы».
      { id: 'prepayDecided', d: 'предоплата в [решено] (условное, L81–L87; ответ аналитика — в открытые)', sec: ['[решено]'], re: [/предоплат/i] },
      { id: 'noNumber', d: '«без номера машины» (переиграно L56–L58)', sec: ['Решено'], re: [/без\s+номер|номер\S*(\s+машины)?\s+не\s+(нужен|надо|указыва|спрашива)/i] },
      { id: 'threeWeeks', d: '«три недели» (переиграно в той же реплике L95)', sec: ['Решено'], re: [/(^|\D)3\s*недел|три\s+недел|тр[её]х\s+недел/i], near: /(^|\D)3\s*недел\S*|три\s+недел\S*|тр[её]х\s+недел\S*/i,
        // Как действующее окно; «сначала названы три недели, … поправлено на две» — не оно (пилот 2026-10-16).
        not: /сначала|поправ|вместо|(^|[^а-яё])был[аио]?([^а-яё]|$)|переигр|(^|[^а-яё])а\s+не([^а-яё]|$)/i },
      { id: 'noise', d: 'шум (гайковёрт, в машине, второй телефон, связь)', sec: null, re: [/гайков|второй\s+телефон|загоня|связь\s+пропада|(^|[^а-яё])я\s+в\s+машине/i] },
    ],
    warn: [
      { id: 'prepayOpen', d: 'открытая предоплата или открытый вопрос о кассе (L81–L87)', sec: ['Открыто'], re: [/предоплат|касс/i] },
    ],
    factsMin: 3,
    facts: [
      { id: 'phoneTable', d: 'сейчас — по телефону в общую таблицу (L31–L33)', re: [/телефон/i, /таблиц/i] },
      { id: 'peakCalls', d: 'в пик до 200 звонков в день (L34–L35)', re: [/(^|\D)200(\D|$)|двухсот|двести/i] },
      { id: 'points', d: 'три точки по четыре поста (L38)', re: [/точ/i, /(^|\D)4(\D|$)|четыр/i, /пост/i] },
      { id: 'hours', d: 'в пик с 8 до 22, иначе до 20 (L40)', re: [/(^|\D)8(\D|$)|восьм/i, /(^|\D)(10|22)(\D|$)|десят/i] },
      { id: 'noShow', d: 'каждый пятый не приезжает (L80)', re: [/пят|(^|\D)20\s*%/i, /не\s+приезжа|неявк|не\s+при(ехал|едет)/i] },
    ],
    razborMust: [
      { id: 'prepayAnswer', level: 'warn', d: 'у записи о предоплате — «решение аналитика: В открытые вопросы» (SKILL.md:157)', re: /решение аналитика:\s*[«"]?\s*в открытые/i },
    ],
  },
  // Дискавери-воркшоп без итога (Н1): лишние [решено] — спор без выбора, «угу» / «ну можно», «как сейчас».
  // fixtures/MEET-WORKSHOP/expected.md. Эталон — синтетический прогон selftest/loop/meet-synth/WORKSHOP/.
  WORKSHOP: {
    key: null,
    folder: 'coddoc/_inbox',
    transcript: 'fixtures/MEET-WORKSHOP/seed/calls/2026-10-05-priyom-maketov.txt',
    seed: { 'calls/2026-10-05-priyom-maketov.txt': 'fixtures/MEET-WORKSHOP/seed/calls/2026-10-05-priyom-maketov.txt' },
    etalon: { points: 'selftest/loop/meet-synth/WORKSHOP/meeting-2026-10-05.points.md', razbor: 'selftest/loop/meet-synth/WORKSHOP/meeting-2026-10-05.razbor.md' },
    keyAsk: true,
    // [решено] ⊆ {только PDF и его «не входит»; письмо клиенту (стык); прошедшее Шаг 5 с «Оставляем» (стык)}; галочка — никогда.
    decided: {
      // «пдф» — та же тема (форму на слух ловит свой запрет `asr`).
      allow: [/(^|[^a-z])pdf([^a-z]|$)|(^|[^а-яё])пдф/i, /письм/i],
      never: [{ d: 'галочка «претензий не имею» — «Но я ещё подумаю» (L166), открытый вопрос', re: /галочк|претензий\s+не\s+имею/i }],
    },
    // `решил:` — общее правило: принявший или предложивший; непричастный — красный.
    deciders: [
      { d: 'только PDF: предложил Шарапов, приняли Ясинская, Пахомова, Гончарук (L89–L94)', re: [/(^|[^a-z])pdf([^a-z]|$)|(^|[^а-яё])пдф/i], allow: ['Шарапов', 'Ясинская', 'Пахомова', 'Гончарук'] },
      { d: 'письмо клиенту: предложила Пахомова, «угу» Ясинской (L139–L140)', re: [/письм/i], allow: ['Ясинская', 'Пахомова'] },
    ],
    must: [
      { id: 'pdf', d: 'на сайте принимают только PDF (L89–L94)', sec: ['[решено]'], re: [/(^|[^a-z])pdf([^a-z]|$)/i] },
      // Споры — [открыто] с вариантами; [решено] варианта законен только после «Оставляем» на Шаге 5 (его ловит `decided`).
      { id: 'block', d: 'ошибка проверки: не пускать / пускать с предупреждением — открыто (L97–L111)', sec: null, re: [/не\s+пуска|блокир|не\s+загруж|запрет/i, /предупрежд/i] },
      { id: 'proof', d: 'цветопроба: лично / фото в кабинете — открыто (L122–L133)', sec: null, re: [/цветопроб/i, /лично|живь[её]м|курьер|представител|приезжа/i, /фото/i] },
      { id: 'storage', d: 'сколько хранить макеты — уточнит у Ларионовой (L149–L154)', sec: ['Открыто'], re: [/хран/i] },
      { id: 'cabinet', d: 'приём — в личном кабинете или отдельно (L12, L188)', sec: ['Открыто'], re: [/кабинет/i, /отдельн/i] },
    ],
    mustNot: [
      { id: 'asr', d: 'форма на слух («эр же бэ», «смык», «пдф»)', sec: null, re: [/эр\s*же\s*бэ|(^|[^а-яё])смык|(^|[^а-яё])пдф/i] },
      { id: 'noise', d: 'шум (связь, резак, экран, звонок, «до часа»)', sec: null, re: [/резак|экран\S*\s+завис|связь\s+моргн|до\s+часа|(^|[^а-яё])гудит/i] },
      // Доли рядом (L31, L35, L127, L150): переставленная — ложь, хотя оба числа есть в расшифровке.
      { id: 'shareSwap', d: 'доля возвратов не «каждый третий» (L31)', sec: null, re: [/возвра\S*[^.;]{0,40}((^|[^а-яё])(две|двух|2)\s+трет|половин|кажд\S*\s+пят)|((^|[^а-яё])(две|двух|2)\s+трет|половин)[^.;]{0,40}возвра/i] },
      { id: 'bleed', d: 'вылеты 2 мм как требование (надо 3 мм, L40–L43)', sec: ['[решено]'], re: [/вылет\S*[^.;]{0,20}((^|\D)2\s*мм|два\s+мм)/i] },
    ],
    factsWarn: true,
    factsMin: 10,
    facts: [
      { id: 'mail', d: 'заказ по телефону или формой, макет на почту, большой — ссылкой (L19–L20)', re: [/почт/i, /телефон|форм|ссылк/i] },
      { id: 'forward', d: 'менеджер пересылает в препресс с номером заказа в теме (L22)', re: [/препресс/i, /номер\S*\s+заказ|тем\S*\s+письм/i] },
      { id: 'orders', d: 'около 40 заказов в день, до 70 в ноябре–декабре (L27, L29)', re: [/(^|\D)40(\D|$)|сорок/i, /заказ/i] },
      { id: 'returns', d: 'возвращают каждый третий, в основном частным (L31, L33)', re: [/возвра/i, /трет|(^|\D)1[35](\D|$)/i] },
      { id: 'private', d: 'частных клиентов около двух третей (L35)', re: [/частн/i, /(две|двух|2)\s+трет/i] },
      { id: 'reasons', d: 'причины возврата: вылеты, RGB, разрешение, шрифты (L37–L38)', re: [/вылет/i, /RGB|разрешени|шрифт/i] },
      { id: 'reqs', d: 'требования: PDF/X-1a, CMYK, 300 dpi, вылеты 3 мм (L40, L43)', re: [/PDF\/X-1a|300\s*dpi|(^|\D)3\s*мм/i] },
      { id: 'wide', d: 'широкий формат: 100–150 точек, баннер 1,5–2 ГБ (L46–L47)', re: [/широк|баннер/i, /гигабайт|ГБ|точек|150/i] },
      { id: 'check', d: 'проверка 10–15 минут; в препрессе двое, лицензия одна (L50–L51, L74)', re: [/минут|двое|лиценз/i, /провер|препресс/i] },
      { id: 'calls', d: 'клиент не видит этап; звонков про макеты около 10 в день (L62, L64)', re: [/звон/i, /(^|\D)10(\D|$)|десят/i] },
      { id: 'versions', d: 'возврат через менеджера, версии путаются; 2–3 круга (L66–L72)', re: [/верси|финал|не\s+тот|круг/i] },
      { id: 'links', d: 'ссылки агентств перестают открываться; повторяют каждый пятый (L82–L83, L150)', re: [/ссылк|повтор/i, /недел|открыва|пят/i] },
      { id: 'proofFacts', d: 'цветопроба от 1000 штук, в цене заказа (L118–L121)', re: [/цветопроб/i, /1\s*000|тысяч|в\s+цен/i] },
      { id: 'cabinetFacts', d: 'в кабинете есть проверка PDF, менеджер, оплата; около 800 (L95, L142, L183, L186)', re: [/кабинет/i, /(^|\D)800(\D|$)|восьмисот|оплат|провер/i] },
      { id: 'hours', d: 'препресс с 9 до 18, срок печати 3 рабочих дня от утверждённого макета (L168–L172)', re: [/(^|\D)9(\D|$)|девят|рабоч/i, /(^|\D)18(\D|$)|шест|утвержд/i] },
      { id: 'payment', d: 'печать после оплаты: частные 100% вперёд, агентства с отсрочкой (L181–L182)', re: [/оплат/i, /(^|\D)100|вперёд|вперед|отсрочк/i] },
    ],
    side: [],
    razborMust: [],
  },
  // SRT без говорящих (Н2): выдуманный `решил:`. fixtures/MEET-NONAMES/expected.md. Окно опоры — ±3 блока SRT.
  // Эталон — синтетический прогон selftest/loop/meet-synth/NONAMES/.
  NONAMES: {
    key: null,
    folder: 'coddoc/_inbox',
    transcript: 'fixtures/MEET-NONAMES/seed/2026-10-06-moyka-onlain-zapis.srt',
    seed: { '2026-10-06-moyka-onlain-zapis.srt': 'fixtures/MEET-NONAMES/seed/2026-10-06-moyka-onlain-zapis.srt' },
    etalon: { points: 'selftest/loop/meet-synth/NONAMES/meeting-2026-10-06.points.md', razbor: 'selftest/loop/meet-synth/NONAMES/meeting-2026-10-06.razbor.md' },
    // Даты в тексте нет — из имени файла (SKILL.md:114–115).
    fileDate: '2026-10-06',
    keyAsk: true,
    // `решил: —` / «не назван» — стык (решающего в SRT не видно), не ложь.
    deciderDash: true,
    noSurnames: true,
    roleSyn: { владел: 'хозяйк' },
    absent: [{ d: 'Зульфия — на встрече её нет (L509)', re: /Зульфи/i }, { d: 'мойщики — не участники встречи', re: /мойщик/i }],
    // Причастный виден только из обращений и самоназваний (таблица expected.md). Порядок важен: первое совпадение.
    deciders: [
      { d: 'мойщикам не надо — Айдар назван в третьем лице («им Айдар скажет», L491)', re: [/мойщик/i], allow: [] },
      { d: 'время на машину — обращение к Айдару (L243)', re: [/минут/i, /экспресс|комплекс|кроссовер|минивэн|двадцат|сорок|(^|\D)(20|40)(\D|$)/i], allow: ['Айдар'] },
      { d: 'услуги на сайте — обращение к Изольде Марковне (L215)', re: [/экспресс|комплекс/i], allow: ['Изольда', 'Марковна'] },
      { d: 'двигатель и полировка — обращение к Изольде Марковне (L215)', re: [/двигател|полиров/i], allow: ['Изольда', 'Марковна'] },
      { d: 'посты — «как Изольда Марковна скажет» (L277, L285, L293)', re: [/пост/i], allow: ['Изольда', 'Марковна'] },
      { d: 'планшет — обращения к Айдару и Стасу (L454, L463)', re: [/планшет|ресепш|браузер/i], allow: ['Айдар', 'Стас'] },
    ],
    // Остальные решения (поля, две недели, напоминание, отмена, предоплата, оплата на месте, сообщения) — имени нет.
    deciderDefault: [],
    must: [
      { id: 'services', d: 'на сайт — только экспресс и комплекс (L215–L231)', sec: ['Решено'], re: [/экспресс/i, /комплекс/i] },
      { id: 'time', d: 'экспресс 20 минут, комплекс 40, кроссовер и минивэн плюс 10 (L248–L257)', sec: ['Решено'], re: [/(^|\D)20(\D|$)|двадцат/i, /(^|\D)40(\D|$)|сорок/i, /(^|\D)10(\D|$)|десят/i] },
      { id: 'posts', d: 'два поста под запись, третий — живая очередь (L281–L293)', sec: ['Решено'], re: [/пост/i, /(^|[^а-яё])(два|2|двух)([^а-яё]|$)/i, /жив\S*\s+очеред|трет/i] },
      { id: 'fields', d: 'клиент вводит телефон, номер машины и марку (L314–L322)', sec: ['Решено'], re: [/телефон/i, /номер/i, /марк/i] },
      { id: 'twoWeeks', d: 'запись на две недели вперёд (L335–L344)', sec: ['Решено'], re: [/(две|двух|2)\s+недел/i] },
      { id: 'reminder', d: 'напоминание за час, сообщением на телефон (L352–L361)', sec: ['Решено'], re: [/напомин|сообщени/i, /за\s+(один\s+|1\s+)?час([^а-яё]|$)/i] },
      { id: 'cancel', d: 'отмена не позже чем за два часа (L379–L383)', sec: ['Решено'], re: [/отмен/i, /(два|двух|2)\s+час/i] },
      { id: 'tablet', d: 'записи с сайта — на планшете на ресепшене (L463–L475)', sec: ['Решено'], re: [/планшет/i] },
      { id: 'prepay', d: 'предоплата через сайт — не входит (L404, L539)', sec: ['Не входит'], re: [/предоплат|оплат/i] },
      { id: 'noShow', d: 'что делать с неявками — открыто (L414–L441)', sec: ['Открыто'], re: [/неяв|не\s+при(ех|езжа|шед|ед)/i] },
      { id: 'discount', d: 'скидка по карте при записи — открыто, ждёт Зульфию (L495–L509)', sec: ['Открыто'], re: [/скидк/i] },
    ],
    mustNot: [
      // Числа рядом (ловушка 3): напоминание за час / отмена за два часа / неделя как сейчас / опоздавший — как сейчас.
      { id: 'reminder2h', d: 'напоминание за два часа (за час, L352)', sec: ['Решено'], re: [/напомин\S*[^.;]{0,40}(два|двух|2)\s+час|(два|двух|2)\s+час\S*[^.;]{0,20}напомин/i] },
      { id: 'cancel1h', d: 'отмена за час (за два часа, L379)', sec: ['Решено'], re: [/отмен\S*[^.;]{0,40}за\s+(один\s+|1\s+)?час([^а-яё]|$)/i] },
      { id: 'oneWeek', d: 'запись на неделю (неделя — как сейчас, L121, L331)', sec: ['Решено'], re: [/на\s+(одну\s+|1\s+)?неделю/i], near: /на\s+(одну\s+|1\s+)?неделю/i },
      { id: 'lateRule', d: 'ожидание опоздавшего решением (так сейчас, L551–L559)', sec: ['Решено'], re: [/опозда/i] },
      { id: 'noShowDecided', d: 'неявки или штраф решением (без выбора, L414–L441)', sec: ['Решено'], re: [/неяв|не\s+при(ех|езжа|шед|ед)|штраф/i] },
      { id: 'anytime', d: 'отмена «в любой момент» (отвергнуто L374)', sec: ['Решено'], re: [/в\s+любой\s+момент/i], near: /в\s+любой\s+момент/i },
      { id: 'zulfiya', d: 'Зульфия в «со слов» или «решил:» — на встрече её нет', sec: null, re: [/со\s+слов[^·;]*Зульфи|реш(ил|ила|или):[^·]*Зульфи/i] },
      { id: 'noise', d: 'шум («запись пошла», связь, машина подъехала, «Продолжение следует»)', sec: null, re: [/запись\s+пошла|связ[ьи]|не\s+слышно|подъехал|продолжение\s+следует/i] },
    ],
    factsWarn: true,
    factsMin: 9,
    facts: [
      { id: 'notebook', d: 'запись по телефону в тетрадь по постам (L84–L88)', re: [/тетрад/i] },
      { id: 'hours', d: 'три поста, с 8 до 22 без выходных (L96–L97)', re: [/пост|выходн/i, /(^|\D)(8|22)(\D|$)|восьм|десят/i] },
      { id: 'cars', d: 'в будни 40–50 машин, в субботу до 80 (L105, L113)', re: [/(^|\D)40(\D|$)|сорок/i, /(^|\D)80(\D|$)|восьмидесят/i] },
      { id: 'week', d: 'сейчас — максимум на неделю вперёд (L121)', re: [/недел/i, /сейчас|максимум/i] },
      { id: 'tenth', d: 'не приезжает каждый десятый (L133–L138)', re: [/десят/i, /не\s+при(ех|езжа)|пуст/i] },
      { id: 'queue', d: 'очередь утром до 10 и вечером после 18 (L154–L159)', re: [/очеред/i, /утр|вечер/i] },
      { id: 'site', d: 'сайт — визитка, записи нет, два года (L167–L172)', re: [/визитк|(два|2)\s+года/i] },
      { id: 'regulars', d: 'постоянных больше половины (L188–L189)', re: [/постоянн/i, /половин/i] },
      { id: 'prices', d: 'экспресс 500, комплекс 1200, полировка от 5000 (L197–L211)', re: [/(^|\D)500(\D|$)|пятьсот/i, /1\s*200|тысяча\s+двести/i] },
      { id: 'sms', d: 'сообщения — копейки, договор с рассылкой (L391–L392)', re: [/рассылк|копейк/i] },
      { id: 'washers', d: 'мойщиков шесть, по двое на пост (L483)', re: [/мойщик/i, /(^|\D)6(\D|$)|шест/i] },
      { id: 'card', d: 'карта постоянного клиента, скидка 10% на кассе (L495, L521–L522)', re: [/карт/i, /(^|\D)10\s*(%|процент)|десят\S*\s+процент/i] },
      { id: 'late', d: 'опоздавшего ждут 10 минут — так сейчас (L551–L559)', re: [/опозда/i] },
      { id: 'terms', d: 'запись на сайте — около трёх недель работы (L534–L535)', re: [/(три|тр[её]х|3)\s+недел/i] },
    ],
    side: [],
    razborMust: [],
  },
  // Конспект с кодами, набранными руками (Н3, баг 12). fixtures/MEET-NOTES/expected.md. Коды по правке E10 —
  // отдельной строкой «по правке». Эталон — синтетический прогон selftest/loop/meet-synth/NOTES/.
  NOTES: {
    key: null,
    folder: 'coddoc/_inbox',
    transcript: 'fixtures/MEET-NOTES/seed/konspekt-zamorozka.txt',
    seed: { 'konspekt-zamorozka.txt': 'fixtures/MEET-NOTES/seed/konspekt-zamorozka.txt' },
    etalon: { points: 'selftest/loop/meet-synth/NOTES/meeting-2026-10-02.points.md', razbor: 'selftest/loop/meet-synth/NOTES/meeting-2026-10-02.razbor.md' },
    keyAsk: true,
    // FRZ-14 / FRZ-30 похожи на ключ (map.md:15): `> Задача: FRZ-14` и папка coddoc/FRZ-14/ — стык, не красное.
    altKeys: ['FRZ-14', 'FRZ-30'],
    // «Решили:» без имени (L27): `решил: —` — стык, не ложь.
    deciderDash: true,
    absent: [{ d: 'Шевелёва — договорной отдел, на встрече её не было (L58)', re: /Шевел/i }],
    deciders: [
      { d: 'за 1 день до начала, задним числом не морозим — «Решили:» без имени (L27)', re: [/задним\s+числом|за\s+(1\s+|один\s+)?день\s+до/i], allow: [] },
      { d: 'тарифы — предложила Ведерникова, согласовал Пименов (L17–L24)', re: [/(^|\D)(500|900)(\D|$)/], allow: ['Пименов', 'Ведерникова'] },
      { d: 'выручка отдельной строкой (L25)', re: [/выручк/i], allow: ['Ведерникова', 'Пименов'] },
      { d: 'минимальный срок 7 дней (L26)', re: [/(^|\D)7\s*дн|сем[ьи]\s+дн/i], allow: ['Пименов', 'Ведерникова'] },
      { d: 'раз в год (L30–L32)', re: [/в\s+год/i], allow: ['Ведерникова', 'Лаврентьева', 'Пименов'] },
      { d: 'приложение — следующим этапом (L61–L63)', re: [/приложени/i], allow: ['Лаврентьева', 'Ведерникова'] },
      { d: 'статус, турникет, ACTIVE, freeze_days (L35–L46)', re: [/ON_HOLD|статус|турникет|ACTIVE|freeze_days|фактическ|остат|остал/i], allow: ['Квашнин', 'Ведерникова'] },
    ],
    must: [
      { id: 'tariffs', d: 'две опции: 14 дней — 500 ₽, 30 дней — 900 ₽ (L17–L24)', sec: ['Решено'], re: [/(^|\D)500(\D|$)/, /(^|\D)900(\D|$)/] },
      { id: 'revenue', d: 'выручка с заморозок — отдельной строкой (L25)', sec: ['Решено'], re: [/выручк/i, /отдельн/i] },
      { id: 'minTerm', d: 'минимальный срок — 7 дней (L26)', sec: ['Решено'], re: [/(^|\D)7\s*дн|сем[ьи]\s+дн/i] },
      { id: 'deadline', d: 'оформляют не позже чем за 1 день до начала (L27)', sec: ['Решено', 'Не входит'], re: [/за\s+(1\s+|один\s+)?день\s+до|задним\s+числом/i] },
      // «1 раз в год», «раз в год», «одна заморозка в год» (пилот 2026-10-16 run-2); «2 раза» ловит запрет `twice`.
      { id: 'onceYear', d: 'не чаще 1 раза в год (L30–L32)', sec: ['Решено'], re: [/в\s+год/i, /(^|[^а-яё0-9])(1|один|одна|одну|одного|раз)([^а-яё0-9]|$)/i] },
      { id: 'status', d: 'статус заморозки — ON_HOLD (L37)', sec: ['Решено'], re: [/ON_HOLD|отдельн\S*\s+статус|статус\S*\s+(заморозк|приостан)/i] },
      { id: 'turnstile', d: 'в заморозке турникет не пускает (L38)', sec: ['Решено'], re: [/турникет/i, /не\s+пуска/i] },
      { id: 'backActive', d: 'по окончании статус сам возвращается в ACTIVE (L39)', sec: ['Решено'], re: [/окончан|конец|конц|конч|заканч|истек/i, /возвраща|ACTIVE|активн/i] },
      { id: 'field', d: 'поле остатка дней заморозки в текущем году (L42–L43)', sec: ['Решено'], re: [/freeze_days|пол[еяю]/i, /остал|остат/i] },
      { id: 'actual', d: 'списываются фактические дни, а не весь срок опции (L44–L46)', sec: ['Решено'], re: [/фактическ/i] },
      { id: 'appOut', d: 'не входит: заморозка через приложение — следующим этапом (L61–L63)', sec: ['Не входит'], re: [/приложени/i], alt: [{ sec: ['Решено'], re: [/приложени/i, /следующ|не\s+в\s+этот|потом/i] }] },
      { id: 'illness', d: 'по болезни: FRZ-30 с ценой 0 или FRZ-MED — открыто (L48–L52)', sec: ['Открыто'], re: [/болезн|справк/i] },
      { id: 'refund', d: 'возвращать ли разницу при досрочном выходе — открыто (L56–L58)', sec: ['Открыто'], re: [/разниц|верн|возвра/i] },
      { id: 'showRest', d: 'показывать ли остаток в приложении — открыто (L64)', sec: ['Открыто'], re: [/приложени/i, /остат|остал|freeze_days/i] },
    ],
    mustNot: [
      { id: 'paused', d: 'статус заморозки PAUSED (отвергнут L35–L36)', sec: ['Решено'], re: [/PAUSED/], near: /PAUSED/ },
      { id: 'illnessDecided', d: 'по болезни решением (не договорились, L52)', sec: ['Решено'], re: [/болезн|справк|FRZ-MED/i] },
      { id: 'twice', d: '«2 раза в год» (переиграно L31–L32)', sec: ['Решено'], re: [/(2|два|дважды)\s*(раза?\s+)?в\s+год/i], near: /(2|два|дважды)\s*(раза?\s+)?в\s+год/i },
      { id: 'wholeTerm', d: 'списывается весь срок опции (фактические дни, L45)', sec: ['Решено'], re: [/списыва\S*\s+(сразу|весь)|(весь|сразу)\s+(срок|14)/i], near: /списыва\S*\s+(сразу|весь)|(весь|сразу)\s+(срок|14)/i },
      { id: 'priceSwap', d: 'переставленные цены (FRZ-14 — 500, FRZ-30 — 900, конкуренты — 1000)', sec: null, re: [/FRZ-30\s*[—–:-]?\s*(до\s+30\s+дней,?\s*)?(1\s*000|500)|FRZ-14\s*[—–:-]?\s*(до\s+14\s+дней,?\s*)?(900|1\s*000)/i] },
      { id: 'tenDays', d: '«через 10 дней» как правило (пример, L57)', sec: ['Решено'], re: [/(^|\D)10\s*дн|десят\S*\s+дн/i] },
      { id: 'noise', d: 'шум (парковка)', sec: null, re: [/парковк/i] },
    ],
    // По правке E10: код из конспекта в своём пункте — кодом, не словами.
    byEditCodes: [
      { d: 'FRZ-14 и FRZ-30 в пункте о тарифах', kind: 'решено', re: [/(^|\D)(500|900)(\D|$)/], need: /FRZ-14[\s\S]*FRZ-30|FRZ-30[\s\S]*FRZ-14/ },
      { d: 'ON_HOLD в пунктах о статусе и турникете', kind: 'решено', re: [/статус|турникет/i, /заморозк|не\s+пуска/i], need: /ON_HOLD/ },
      { d: 'freeze_days в пункте о поле остатка', kind: 'решено', re: [/остал|остат/i, /пол[еяю]|freeze_days/i], need: /freeze_days/ },
      { d: 'ACTIVE в пункте о конце заморозки', kind: 'решено', re: [/окончан|конец|заканч/i], need: /ACTIVE/, warn: true },
      { d: 'FRZ-MED в открытом по болезни', kind: 'открыто', re: [/болезн|справк/i], need: /FRZ-MED/, warn: true },
      { d: 'PAUSED в сведении об автоплатеже', kind: 'сведение', re: [/автоплат/i], need: /PAUSED/, warn: true },
    ],
    factsWarn: true,
    factsMin: 7,
    facts: [
      { id: 'paper', d: 'бумажное заявление на ресепшене, дату переносят в CRM руками (L7–L8)', re: [/заявлени/i, /бумаг|ресепшен|руками/i] },
      { id: 'noStatus', d: 'статуса заморозки нет, турникет пускает (L9–L10)', re: [/ACTIVE|статус/i, /турникет|ходит/i, /нет|пуска/i] },
      { id: 'count', d: 'около 25 заявлений в месяц, летом до 60 (L11–L12)', re: [/(^|\D)25(\D|$)|двадцать\s+пять/i, /(^|\D)60(\D|$)|шестьдесят/i] },
      { id: 'turnstile15', d: 'турникет берёт статус из CRM раз в 15 минут (L13)', re: [/турникет/i, /(^|\D)15(\D|$)|пятнадцат/i] },
      { id: 'active1800', d: 'активных абонементов около 1800 (L14)', re: [/1\s*800|тысяча\s+восемьсот/i] },
      { id: 'january', d: 'в январе всплеск (L15)', re: [/январ/i] },
      { id: 'catalog', d: 'в CRM есть справочник доп. услуг (L22)', re: [/справочник/i] },
      { id: 'competitors', d: 'у конкурентов 30 дней — 1000 ₽ (L23)', re: [/конкурент/i, /1\s*000|тысяч/i] },
      { id: 'pausedExists', d: 'PAUSED уже есть — пауза автоплатежа (L36)', re: [/автоплат/i] },
      { id: 'launch', d: 'запустить до 1 декабря; около двух недель в CRM (L67–L68)', re: [/декабр|недел/i, /запуст|CRM|работ/i] },
    ],
    side: [],
    razborMust: [],
  },
}

// Вопрос о выборе темы (Шаг 2 после круга 1: «тему не спрашиваешь», созвон — одна тема). Красный во всех пробах.
// Формы из ответов круга 1: «Какую тему берём?», «На встрече две темы. Какую разбираем?», «Разбираем тему 1?»,
// «Выберите, какую из них разбирать», «…со всеми тремя темами вместе, одним списком?» + варианты «Только тема 2».
// Не вопрос темы: «Тема одна…», «…в выбор не идёт», «Как назвать тему записи?», «какая тема стояла в приглашении?».
const RE_THEME_WORD = /(^|[^а-яё])(тем(а|у|ы|е|ой|ам|ами|ах)|предмет\S*)([^а-яё]|$)/i
const RE_THEME_CHOICE = /(^|[^а-яё])(как|котор)(ую|ой|ие|их|ых|ые)\s+(из\s+(них|тем)|(\S+\s+)?(тем|предмет))|тем(у|ы)\s+\d|(^|[^а-яё])(все|всеми|обе|обеими|тремя|двумя|одну|только|вместе)([^а-яё]|$)|разбира|бер[её]м|возьм|выбира/i
// Без слова между: «Какую цель берём?» (вопрос цели 1.x) — не тема; проверено на 1078 ответах 1.x.
const RE_WHICH_BARE = /^[\s*_]*(как|котор)(ую|ой)\s+(разбира|бер|возьм|выбира)|(как|котор)(ую|ой)\s+из\s+них/i
// «Какую из тем …?» — «тем» без окончания (родительный падеж), признак слова RE_THEME_WORD его не берёт.
const RE_WHICH_OF_THEMES = /(как|котор)(ую|ой|ие|их)\s+из\s+тем([^а-яё]|$)/i
const RE_THEME_PICK = /выбер(и|ите)[^.!?\n]{0,40}(тем(а|у|ы)|предмет|какую|котор)|выбрать\s+нужно\s+одну|выбор\s+(\S+\s+)?тем/i
const RE_THEME_OPTION = /^\s*([-*•]|\d+[.)])\s*(\*\*)?\s*(только\s+)?тем(а|у)\s+\d/im
// Сводка Шага 6: «Похоже, не про <главная тема> (K): 1. <суть> (<предмет побочной темы>) …» и варианты «Записать N
// пунктов», «Записать без этих K», «Поправить». Блок — строка «Похоже, не про» и следующие строки до вариантов,
// заголовка или абзаца не-списка. Возвращает номера строк блока.
const RE_SIDE_HEAD = /Похоже,?\s+не\s+про/i
const RE_SIDE_STOP = /^\s*(\d+[.)]\s*)?[*_]*\s*(Вариант|Что делаем|Записать\s+(\d|все|без)|Поправить|Сначала разобрать|«Записать)/i
const RE_LIST_LINE = /^\s*(\d+[.)]|[-*•])\s/
function sideBlockLines (lines) {
  const out = new Set()
  for (let i = 0; i < lines.length; i++) {
    if (!RE_SIDE_HEAD.test(lines[i])) continue
    out.add(i)
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j]
      if (RE_SIDE_STOP.test(l) || RE_SIDE_HEAD.test(l) || /^\s*(#{1,6}\s|\*\*[^*\n]+\*\*\s*$)/.test(l)) break
      if (!l.trim()) {
        const next = lines.slice(j + 1).find((x) => x.trim())
        if (next && RE_LIST_LINE.test(next) && !RE_SIDE_STOP.test(next)) continue
        break
      }
      out.add(j)
    }
  }
  return out
}
// Текст блоков «Похоже, не про …» всех ходов: что скилл показал человеку как побочное.
export function sideShown (text) {
  const lines = lf(text).split('\n')
  return [...sideBlockLines(lines)].sort((a, b) => a - b).map((i) => lines[i]).join('\n')
}
// Раздел «Не вносим» разбора: туда уходят побочные, которые человек не взял.
const notInSection = (razbor) => ((razbor || '').split(/^## «?Не вносим»?[^\n]*$/m)[1] || '').split(/^## /m)[0]

// Побочные темы: пункт в списке без показа в «Похоже, не про …» — красный (агент сам решил, что это про тему);
// показан — решил человек, зелёный в обе стороны; показан, но нет ни в списке, ни в «Не вносим» — предупреждение.
export function sideCheck (items, fx, shown, razbor) {
  const r = { red: [], warn: [], shown: [], falseMark: [] }
  const notIn = notInSection(razbor)
  const isSide = (t) => (fx.side || []).some((s) => s.re.test(t))
  for (const s of fx.side || []) {
    // «не входит: <чужое>» — граница этой задачи, пометка не обязательна (r6 meet-cr: «ошибку с кнопкой ведут отдельно»).
    const inList = items.filter((it) => s.re.test(it.t) && !(s.not && s.not.test(it.t)) && !/^\s*не\s+входит/i.test(it.t))
    const isShown = !!shown && s.re.test(shown)
    if (isShown) r.shown.push(s.id)
    if (inList.length && !isShown && !s.either) r.red.push(`${s.d} — в списке без строки «Похоже, не про …»: «${inList[0].t.slice(0, 60)}»`)
    if (isShown && !inList.length && !s.re.test(notIn)) r.warn.push(`${s.d} — показана в «Похоже, не про …», но нет ни в списке, ни в «Не вносим»`)
  }
  // Ложная пометка (круг 6: «число дней», «место под посылки» в «не про тему»): пункт строки «Похоже, не про …»,
  // не похожий ни на одну побочную тему и не шум, — пункт самой задачи; «Записать без этих K» его потеряет.
  const noise = (fx.mustNot || []).filter((m) => m.id === 'noise').flatMap((m) => m.re)
  const shownItems = new Set(lf(shown || '').split(/\n\s*[-*•]\s+|(?:^|[\s;:])\d+[.)]\s+/).slice(1).map((x) => x.trim()).filter(Boolean))
  for (const t of shownItems) if (!isSide(t) && !noise.some((re) => re.test(t))) r.falseMark.push(t.slice(0, 60))
  return r
}

export function themeQuestion (text0) {
  // Строка «Похоже, не про …» и вариант «Записать без этих K» — вопрос о побочных пунктах, не выбор темы.
  const lines0 = lf(text0).split('\n')
  const block = sideBlockLines(lines0)
  const text = lines0.filter((l, i) => !block.has(i) && !/без\s+эт(их|ого|ой)/i.test(l)).join('\n')
  const qs = text.match(/[^.!?\n]*\?/g) || []
  const hasTheme = RE_THEME_WORD.test(text)
  const q = qs.find((s) => (RE_THEME_WORD.test(s) && RE_THEME_CHOICE.test(s)) || RE_WHICH_OF_THEMES.test(s) || (hasTheme && RE_WHICH_BARE.test(s)))
  if (q) return q.trim()
  const m = text.match(RE_THEME_PICK) || text.match(RE_THEME_OPTION)
  return m ? m[0].trim() : null
}

// Фикстура режима списка: настройки PT поверх FX.
export function ptFx (name) {
  const p = PT[name]
  if (!p) return null
  const b = FX[name] || {}
  const patch = (m) => ({ ...m, ...((p.patch || {})[m.id] || {}) })
  const toList = (b.razborMust || []).filter((m) => (p.toList || []).includes(m.id))
  return {
    name,
    key: 'key' in p ? p.key : b.key,
    folder: p.folder || b.folder,
    transcript: p.transcript || b.transcript,
    seed: p.seed || b.seed,
    fileDate: p.fileDate || b.fileDate,
    minQuotes: p.minQuotes || b.minQuotes,
    etalon: p.etalon,
    must: [...(b.must || []).map(patch), ...toList.filter((m) => m.level !== 'warn').map((m) => ({ id: m.id, d: m.d, sec: null, re: [m.re] })), ...(p.must || [])],
    mustNot: [...(b.mustNot || []).filter((m) => !(p.dropNot || []).includes(m.id)).map(patch), ...(p.mustNot || [])],
    warn: [...toList.filter((m) => m.level === 'warn').map((m) => ({ id: m.id, d: m.d, sec: null, re: [m.re] })), ...(p.warn || [])],
    count: p.count || [],
    notice: p.notice || [],
    facts: p.facts || [],
    factsMin: p.factsMin || 0,
    razborMust: p.razborMust || (b.razborMust || []).filter((m) => !(p.toList || []).includes(m.id) && !(p.dropRazbor || []).includes(m.id)),
    keyAsk: !!p.keyAsk,
    bareRed: !!p.bareRed,
    stopCheck: !!p.stopCheck,
    side: p.side || [],
    title: p.title || null,
    anyDash: !!p.anyDash,
    seedSha: p.seedSha || null,
    byEdit: p.byEdit || null,
    sideDrop: !!p.sideDrop,
    deciders: p.deciders || null,
    deciderDefault: p.deciderDefault || null,
    deciderDash: !!p.deciderDash,
    decided: p.decided || null,
    factsWarn: !!p.factsWarn,
    absent: p.absent || [],
    noSurnames: !!p.noSurnames,
    roleSyn: p.roleSyn || null,
    altKeys: p.altKeys || null,
    byEditCodes: p.byEditCodes || null,
  }
}

// Пункт — строка `- [вид] <текст> · L<n>`. Строка-пункт другой формы (без хвоста, с другим маркером) — в `bad`.
const RE_ITEM_START = /^\s*([-*•]|\d+[.)])\s/
// Диапазон или список строк и точка после `L<n>` — пункт читается, но хвост не по форме: предупреждение.
const RE_ITEM = /^- \[([^\]\n]+)\]\s+(.+?)\s*·\s*L(\d+)((?:\s*[–,-]\s*L?\d+)*)\s*([.;]?)\s*$/
const KINDS3 = ['решено', 'открыто', 'сведение']

export function parsePoints (text) {
  const lines = lf(text).replace(/^\uFEFF/, '').split('\n')
  const r = { title: lines[0] || '', head: [], items: [], bad: [], other: [] }
  let seenItem = false
  lines.forEach((l, i) => {
    if (i === 0 || !l.trim()) return
    if (RE_ITEM_START.test(l)) {
      seenItem = true
      const m = l.match(RE_ITEM)
      if (m) r.items.push({ kind: m[1].trim().toLowerCase(), t: m[2], L: Number(m[3]), extraL: !!m[4] || !!m[5], raw: l })
      else r.bad.push(l)
      return
    }
    if (/^>/.test(l) && !seenItem) r.head.push(l)
    else r.other.push(l)
  })
  return r
}

// `sec` — разделы входа (через KIND_OF) или вид пункта как есть в скобках: `[решено]` — любой `[решено]`, и «не входит» тоже.
const kindIs = (it, k) => {
  if (/^\[.+\]$/.test(k)) return it.kind === k.slice(1, -1)
  // `[открыто] кто принял: <суть>` — решение, принявший не назван (output.md 2.0.1, как «не входит ли» у вне рамок).
  if (k === 'решено') return (it.kind === 'решено' && !RE_NOT_IN.test(it.t)) || (it.kind === 'открыто' && /^кто\s+принял\s*:/i.test(it.t))
  if (k === 'не входит') return (it.kind === 'решено' && RE_NOT_IN.test(it.t)) || (it.kind === 'открыто' && /^не\s+входит\s+ли/i.test(it.t))
  return it.kind === k
}
const poolOf = (items, secs) => (secs ? items.filter((it) => secs.some((s) => kindIs(it, KIND_OF[s] || s))) : items)

// Латиница и коды — только с опорой (правило 5 скилла): токен с цифрой, `_ . / :`, дефисом или camelCase — код;
// его нет в расшифровке, документах задачи из засева и ключе — красный. Простое латинское слово без опоры
// («PDF», «ID») — предупреждение: жаргон понятен принимающему скиллу (решение 2026-10-13 в MEET-ACC/expected.md).
const RE_LAT_TOKEN = /[A-Za-z0-9][A-Za-z0-9_./:-]*[A-Za-z0-9]|[A-Za-z]/g
const isCode = (tok) => /[0-9_./:]/.test(tok) || /[a-z][A-Z]/.test(tok) || /[A-Za-z]-[A-Za-z0-9]/.test(tok)
// Токен в опоре — целым словом: «FR-1» не опирается на «FR-10». Поиск по строке, без сборки регулярки из токена.
function hasToken (corpusLower, tok) {
  const t = tok.toLowerCase()
  for (let i = corpusLower.indexOf(t); i >= 0; i = corpusLower.indexOf(t, i + 1)) {
    const before = i ? corpusLower[i - 1] : ''
    const after = corpusLower[i + t.length] || ''
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true
  }
  return false
}
// Утверждение о несказанном (output.md: «месяц не назвали», «сроков не обсуждали» — в списке нет) — ПРЕДУПРЕЖДЕНИЕ.
// Оценщик 1.x это правило не мерил; на 268 входах прошлых прогонов оно сработало бы в 11 пунктах из 4488, и красный
// перекрасил бы круги, зелёные по прежней мерке (строгость пробы ≠ дефект скилла). Поле `ждёт: [ответственный]
// не назван` — то же, что `ждёт: —`, не утверждение о встрече (без этого исключения срабатываний было 28).
// Только прошедшее время и краткие причастия: «статус не называть «Отказ»» — не о встрече.
const RE_UNSAID = /(^|[^а-яё])(не|ни)\s+(был[оаи]?\s+)?(назвал|назван|обсуждал|обсудил|оговорил|оговаривал|прозвучал|упоминал|упомянул|озвучил|озвучен|говорил|сказал)/i
const RE_ANCHOR_TEXT = /(^|[^A-Za-z])L\d+([^0-9]|$)|\d\d:\d\d:\d\d/
const RE_LINK = /(^|[^а-яё])вместо:|отвечает\s+на:/i
const RE_DECIDER = /[—–-]\s*реш(ил|ила|или):\s*[^\s—–-]/i
// `ждёт: [ответственный] не назван` — то же, что `ждёт: —` (см. RE_UNSAID): не человек и не утверждение.
const RE_WAIT_NONE = /жд[её]т:[^;.()·]*?не\s+назван\S*/gi
// `решил: участники встречи` / `не назван` — решающий не назван (стык NONAMES, NOTES), не имя.
const RE_DECIDER_NONE = /(реш(?:ил|ила|или):\s*)(?:все\s+)?(?:участники(?:\s+встречи)?|(?:вся\s+)?встреча|все|не\s+назван\S*)(?![а-яё])/gi
// Поля людей, которые сверяются по всей расшифровке: `ждёт: …` (до `;`) и `со слов …` (до конца пункта).
const RE_PEOPLE_FIELD = /жд[её]т:\s*[^;·]*|со\s+слов\s+[^·;]*/gi
// Строка тела списка, похожая на пункт, но не `- [`: «[решено] … · L5» без маркера, «… · L12» — следующий скилл её
// пунктом не прочтёт (б). Прочие строки вне формы («## Решено») — предупреждение, как было.
const RE_ITEM_LIKE = /^\s*\[(решено|открыто|сведение)\]|·\s*L\d+\s*\.?\s*$/i

// ---------- опора пункта и шапки (ground-check.mjs, план PLAN-LOOP-HARDEN 1.1) ----------
//
// Опора пункта — строки расшифровки L−2…L+2 вокруг каждой строки цитат, оговорки, итога и опоры записей разбора с
// `в список: п.<N>` этого пункта и вокруг `· L<n>` самого пункта, плюс документы задачи из засева, плюс ответы
// аналитика в диалоге («со слов аналитика»). Каждое число и человек в `решил:` / `ждёт:` / `со слов` должны там
// найтись, иначе — красный «без опоры». Латиница пункта сверяется по-прежнему по всей расшифровке и документам
// (код — красный, простое слово — предупреждение: решение 2026-10-13 в MEET-ACC/expected.md).

// Текст строки расшифровки для опоры: говорящий и реплика, без даты, времени и строк-таймкодов — иначе «11:17:21»
// заземлял бы любое 11, 17 или 21.
function speechOf (l) {
  if (/-->/.test(l) || /^\s*(WEBVTT|NOTE)(\s|$)/.test(l) || /^\s*\d+\s*$/.test(l)) return ''
  let m = l.match(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d - (.+?): (.*)$/)
  if (m) return `${m[1]}: ${m[2]}`
  m = l.match(/^\s*<v\s+([^>]+)>(.*)$/)
  if (m) return `${m[1]}: ${m[2].replace(/<\/v>\s*$/, '')}`
  // «Имя Фамилия  0:14» — строка говорящего, время не реплика.
  m = l.match(/^([А-ЯЁA-Z][^\s:,.;]*(\s+[А-ЯЁA-Z][^\s:,.;]*){0,3})\s+\d{1,2}:\d\d(:\d\d)?\s*$/)
  if (m) return m[1]
  return l
}
function speakerOf (l) {
  const m = l.match(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d - (.+?): /) || l.match(/^\s*<v\s+([^>]+)>/)
  return m ? m[1].replace(/\s*(\[[^\]]*\]|\([^)]*\))/g, '').trim() : null
}
const lowYo = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е')
const tokensOf = (s) => lowYo(s).split(/[^а-яa-z0-9]+/).filter(Boolean)
// Слово роли в токенах: основа (слово без двух последних букв, не короче 4) и длина не больше слова + 2 —
// «архитектор» не опирается на «Архитектурные», «автор» — на «авторизованных».
function wordIn (tokens, word) {
  const w = lowYo(word)
  const st = w.length > 5 ? w.slice(0, -2) : w.slice(0, 4)
  return tokens.some((t) => t.startsWith(st) && t.length <= w.length + 2)
}
const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' }
const translit = (s) => [...lowYo(s)].map((c) => (c in TR ? TR[c] : c)).join('')

// Записи разбора: вид, номера строк (цитаты, оговорка, итог, опора; диапазон — целиком) и пункты `в список: п.N`.
export function razborRecords (text) {
  const out = []
  let cur = null
  for (const l of lf(text || '').split('\n')) {
    const h = l.match(/^#(\d+)\s+(.+?)\s+·/)
    if (h) { cur = { n: Number(h[1]), kind: h[2].trim().toLowerCase(), lines: new Set(), items: [] }; out.push(cur); continue }
    if (/^#{1,6}\s/.test(l)) { cur = null; continue }
    if (!cur) continue
    if (/^\s*(цитаты|оговорка|итог|опора):/.test(l)) {
      for (const m of l.matchAll(/(^|[^A-Za-z])L(\d+)(?:\s*[–—-]\s*L?(\d+))?/g)) {
        const a = Number(m[2]); const b = m[3] ? Math.max(a, Number(m[3])) : a
        for (let x = a; x <= Math.min(b, a + 50); x++) cur.lines.add(x)
      }
    }
    const sp = l.match(/^\s*в\s+список:\s*(.*)$/)
    if (sp) for (const m of sp[1].matchAll(/п\.\s*(\d+)/g)) cur.items.push(Number(m[1]))
    const ans = l.match(/^\s*решение аналитика:\s*(.*)$/)
    if (ans) cur.answer = ans[1]
  }
  return out
}

// Записи пункта: с пометкой `в список: п.N` или с его `L<n>` среди своих строк (пометки сдвинуты — запись найдётся по строке).
const recsOf = (it, n, ctx) => (ctx.records || []).filter((rec) => rec.items.includes(n) || rec.lines.has(it.L))

// Блоки SRT: номер блока, таймкод `00:01:02,000 --> …`, текст до пустой строки. У SRT говорящего в строке нет, обращение
// к человеку («Ольга, решаем?») стоит в соседних блоках за 4–12 строк — окно опоры там ±3 блока, а не ±2 строки.
export function srtBlocks (tRaw) {
  const blockOf = new Array(tRaw.length).fill(-1)
  let b = -1
  for (let i = 0; i < tRaw.length; i++) {
    if (/^\s*\d+\s*$/.test(tRaw[i]) && /-->/.test(tRaw[i + 1] || '') && /\d,\d{3}/.test(tRaw[i + 1] || '')) b++
    if (b >= 0 && tRaw[i].trim()) blockOf[i] = b
  }
  return b >= 2 ? blockOf : null
}

function itemSource (it, n, ctx) {
  const Ls = new Set([it.L])
  for (const rec of recsOf(it, n, ctx)) for (const x of rec.lines) Ls.add(x)
  const win = new Set()
  const max = ctx.tSpeech.length
  for (const L of Ls) {
    for (let x = L - 2; x <= L + 2; x++) if (x >= 1 && x <= max) win.add(x)
    const b = ctx.blocks ? ctx.blocks[L - 1] : -1
    if (b >= 0) ctx.blocks.forEach((bb, i) => { if (bb >= b - 3 && bb <= b + 3) win.add(i + 1) })
    // Конспект: окно — раздел (строки подряд до пустой), если он не длиннее 15 строк: «цена в 900 ₽ ниже» (L23)
    // опирается на «FRZ-30 — 900 ₽» (L20) того же раздела (пилот 2026-10-16).
    const s = ctx.sections ? ctx.sections[L - 1] : -1
    if (s >= 0 && ctx.sections.filter((x) => x === s).length <= 15) ctx.sections.forEach((ss, i) => { if (ss === s) win.add(i + 1) })
  }
  const text = [...win].sort((a, b) => a - b).map((x) => ctx.tSpeech[x - 1]).join('\n')
  // Конспект: «Ведерникова Инга (…)» в строке участников, дальше — «Инга: да». Имя в окне даёт опору и фамилии.
  const toks = tokensOf(text)
  const seen = (w) => { const x = lowYo(w); const st = x.slice(0, Math.max(3, x.length - 1)); return toks.some((tk) => tk.startsWith(st) && tk.length <= x.length + 2) }
  // Только пары шапки конспекта: у чата фамилия и так в строке говорящего, а упоминание имени («Виктор уточняет»)
  // опорой решившего не делает.
  const alias = (ctx.noteAliases || []).filter(([a, b]) => seen(a) || seen(b)).map(([a, b]) => a + ' ' + b).join('\n')
  // Собирательные числа («нас трое» — три менеджера, WORKSHOP L191) ground-check не считает: копия окна с количественными.
  const coll = text.replace(RE_COLLECTIVE, (x, pre, w) => pre + COLLECTIVE[lowYo(w)])
  return [text, coll === text ? '' : coll, alias, ...(ctx.docs || []), ctx.analyst || '']
}
// Номер раздела конспекта у каждой строки (пустая строка — -1).
function sectionsOf (tRaw) {
  let s = 0
  return tRaw.map((l, i) => {
    if (l.trim()) return s
    if (i && tRaw[i - 1].trim()) s++
    return -1
  })
}
const COLLECTIVE = { двое: 'два', трое: 'три', четверо: 'четыре', пятеро: 'пять', шестеро: 'шесть', семеро: 'семь', восьмеро: 'восемь' }
const RE_COLLECTIVE = /(^|[^А-ЯЁа-яё])(двое|трое|четверо|пятеро|шестеро|семеро|восьмеро)(?![А-ЯЁа-яё])/gi

// Роль в шапке — парой «роль — Фамилия»: все слова роли — в одном окне ±1 строка вокруг строки, где этот человек
// говорит или назван (фамилией или именем), или в строке документа задачи с его фамилией (или логином латиницей).
// Слова роли где-то в расшифровке мало: «архитектор» нашёлся бы в «Архитектурные изменения» БТ.
// Сегменты «участники: роль — Фамилия И. О.; Фамилия И. О.; …»: роль (или '') и фамилии.
function headerSegs (line) {
  const m = String(line).match(/(участники|решали):\s*(.*)$/i)
  if (!m) return []
  return m[2].split(';').map((seg) => {
    const parts = seg.split(/\s[—–]\s|\s-\s/)
    const role = parts.length > 1 ? parts[0].trim() : ''
    const names = parts.length > 1 ? parts.slice(1).join(' ') : parts[0]
    return { role, people: names.split(',').map((x) => (x.trim().match(/^[А-ЯЁ][а-яё-]{2,}/) || [])[0]).filter(Boolean) }
  })
}

// Участник шапки — говорил на встрече (фамилия или имя совпадает с говорящим). Проверка — когда говорящих видно
// (чат, VTT): у SRT и конспекта говорящих нет. «Нина Аркадьевна» (о ней говорили, на встрече её не было) — красный.
function absentPeople (line, ctx) {
  if (!ctx.speakers || ctx.speakers.length < 2) return []
  const parts = ctx.speakers.map((s) => s.split(/\s+/).map(lowYo))
  return headerSegs(line).flatMap((s) => s.people).filter((who) => {
    const st = stemOf(who)
    return !parts.some((ws) => ws.some((w) => w.startsWith(st)))
  })
}

function roleCheck (line, ctx, fx = {}) {
  const out = []
  for (const { role, people } of headerSegs(line)) {
    if (!role) continue
    // `[B]` — внешний участник, это не роль (formats.md:8).
    if (/\[B\]/i.test(role)) { out.push(`метка формата «[B]» вместо роли у ${people.join(', ')} (formats.md:8)`); continue }
    for (const who of people) {
      const st = stemOf(who)
      const firsts = new Set()
      for (const s of ctx.speakers || []) { const [sur, first] = s.split(/\s+/); if (sur && first && lowYo(sur).startsWith(st)) firsts.add(lowYo(first)) }
      const isWho = (toks) => toks.some((t) => t.startsWith(st) && t.length <= lowYo(who).length + 3) ||
        [...firsts].some((f) => { const fs = f.slice(0, Math.max(3, f.length - 1)); return toks.some((t) => t.startsWith(fs) && t.length <= f.length + 2) })
      const wins = []
      const T = ctx.tSpeech.map(tokensOf)
      T.forEach((toks, i) => {
        if (!isWho(toks)) return
        // Строка со многими «Фамилия Имя (роль)» (шапка конспекта) — роль человека только в его скобках.
        const lw = lowYo(ctx.tSpeech[i])
        const at = lw.indexOf(st)
        if ((lw.match(/\(/g) || []).length >= 2 && at >= 0 && lw.indexOf('(', at) > at && lw.indexOf(')', at) > lw.indexOf('(', at)) {
          wins.push(tokensOf(lw.slice(at, lw.indexOf(')', at) + 1)))
          return
        }
        wins.push([...(T[i - 1] || []), ...toks, ...(T[i + 1] || [])])
      })
      const tr = translit(who)
      for (const doc of ctx.docs || []) for (const dl of doc.split('\n')) { const toks = tokensOf(dl); if (isWho(toks) || lowYo(dl).includes(tr)) wins.push(toks) }
      for (const phrase of role.split(',')) {
        const words = phrase.split(/[^А-ЯЁа-яёA-Za-z]+/).filter((x) => x.length >= 3 && !/^(для|при|над|под)$/i.test(x))
        if (!words.length) continue
        const alts = (w) => [w, ...Object.entries(fx.roleSyn || {}).filter(([k]) => lowYo(w).startsWith(k)).map(([, v]) => v)]
        if (!wins.some((toks) => words.every((w) => alts(w).some((a) => wordIn(toks, a))))) out.push(`роль «${phrase.trim()}» у ${who} не названа ни на встрече, ни в документах задачи`)
      }
    }
  }
  return out
}

// ctx: { tRaw — строки расшифровки как есть, tSpeech — они же без времени (опора), speakers, docs — документы задачи,
// analyst — ответы аналитика, records — записи разбора (razborRecords), corpus — опора для латиницы в нижнем
// регистре, quoteLines — номера строк цитат разбора (Set) или null }.
export function gradePoints (text, fx, ctx) {
  const p = parsePoints(text)
  const r = { items: p.items, form: [], warn: [], must: {}, mustNot: {}, missing: [], violations: [] }
  const short = (s) => `«${s.slice(0, 60)}»`
  if (!/^# Пункты:\s*\S/.test(p.title)) r.form.push('первая строка не «# Пункты: …»')
  for (const h of ['Источник', 'Задача', 'Встреча']) if (!p.head.some((l) => l.startsWith(`> ${h}:`))) r.form.push(`в шапке нет «> ${h}:»`)
  if (!p.items.length) r.form.push('пунктов «- [вид] … · L<n>» нет')
  if (p.bad.length) r.form.push(`пункт не по форме «- [вид] … · L<n>» (${p.bad.length}): ${short(p.bad[0])}`)
  const itemLike = p.other.filter((l) => RE_ITEM_LIKE.test(l))
  if (itemLike.length) r.form.push(`пункт не строкой «- [» (${itemLike.length}): ${short(itemLike[0])}`)
  const otherRest = p.other.filter((l) => !RE_ITEM_LIKE.test(l))
  if (otherRest.length) r.warn.push(`строки вне формы списка (${otherRest.length}): ${short(otherRest[0])}`)
  // Ключ — целым токеном: «EMP-12070» — не «EMP-1207»; ключа нет — «—».
  const zadacha = p.head.find((l) => l.startsWith('> Задача:'))
  if (zadacha) {
    const val = zadacha.replace(/^> Задача:\s*/, '').replace(/[`*_]/g, '').trim()
    const keys = val.match(/[A-Za-z][A-Za-z0-9]*-\d+/g) || []
    const ok = fx.key ? keys.length === 1 && keys[0] === fx.key : /^[—–-]$/.test(val) || (keys.length === 1 && (fx.altKeys || []).includes(keys[0]))
    if (!ok) r.form.push(`ключ в шапке ${short(zadacha)}, ждали ${fx.key || '—'}`)
  }
  // Шапка «> Встреча:»: имена и роли — с опорой (ground-check), роль — парой с человеком.
  const meet = p.head.find((l) => l.startsWith('> Встреча:'))
  if (meet && ctx.tSpeech) {
    // Время встречи «чч:мм–чч:мм» — из меток расшифровки (ground-check метки с секундами опорой не считает).
    // Синоним роли (`roleSyn`, «владелица» = «хозяйка») опору проверяет пара роли ниже, не поиск слова.
    const synSkip = (meet.match(/[А-ЯЁа-яё]+/g) || []).filter((w) => Object.keys(fx.roleSyn || {}).some((k) => lowYo(w).startsWith(k)))
    const g = groundCheck(meet, [ctx.tSpeech.join('\n'), ctx.tTimes || '', ...(ctx.docs || [])], { header: true, skip: synSkip })
    // Опора только в другом файле папки задачи (шапка входа прошлой встречи) — не ложь, а не та опора: предупреждение.
    const loose = { ...ctx, docs: ctx.seedDocs || ctx.docs }
    const gLoose = g.ok ? g : groundCheck(meet, [ctx.tSpeech.join('\n'), ctx.tTimes || '', ...(loose.docs || [])], { header: true, skip: synSkip })
    if (!g.ok) (gLoose.ok ? r.warn : r.form).push(`в шапке «> Встреча:» без опоры${gLoose.ok ? ' (есть в другом файле папки задачи)' : ''}: ${fmtMissing(g)}`)
    const rolesLoose = new Set(roleCheck(meet, loose, fx))
    for (const e of roleCheck(meet, ctx, fx)) (rolesLoose.has(e) ? r.form : r.warn).push(rolesLoose.has(e) ? e : `${e} (есть в другом файле папки задачи)`)
    for (const who of absentPeople(meet, ctx)) r.form.push(`в участниках ${who} — на встрече не говорил`)
    const people = (meet.match(/(участники|решали):\s*(.*)$/i) || [])[2] || ''
    for (const a of fx.absent || []) if (a.re.test(people)) r.form.push(`в участниках — ${a.d}`)
    // Фамилий в расшифровке нет (MEET-NONAMES): инициалы после имени — выдуманная фамилия.
    if (fx.noSurnames && /[А-ЯЁ][а-яё]+\s+[А-ЯЁ]\.(\s|;|,|$)/.test(people)) r.form.push(`в участниках инициалы фамилии, которых в расшифровке нет: ${short(people)}`)
    // SRT: время в шапке — только таймкоды записи («10:00–10:15» — часы, которых в файле нет).
    if (ctx.srtTimes) for (const tm of (meet.replace(/\d{4}-\d\d-\d\d/g, ' ').match(/\d{1,2}:\d\d/g) || [])) {
      const [h, m] = tm.split(':').map(Number)
      if (!ctx.srtTimes.has(h * 60 + m)) r.form.push(`время «${tm}» в шапке — не таймкод записи`)
    }
  }
  // `> Источник:` — путь к этой расшифровке (output.md). Назван другой файл — красный (MEET-SAMEDAY: расшифровка чужой
  // встречи той же даты); файла не видно — предупреждение.
  const src = p.head.find((l) => l.startsWith('> Источник:'))
  if (src && ctx.srcName) {
    const files = src.match(/[^\s/\\`«»"]+\.(txt|vtt|srt|md|docx|pdf)\b/gi) || []
    if (files.length && !files.some((f) => f.toLowerCase() === ctx.srcName.toLowerCase())) r.form.push(`в шапке ${short(src)} — не эта расшифровка (${ctx.srcName})`)
    else if (!files.length && !/сообщени/i.test(src)) r.warn.push(`в шапке ${short(src)} — файла расшифровки не видно`)
  }
  // Предмет списка (`# Пункты:`) — ответ аналитика на вопрос Шага 2 (MEET-TWIN: «Поправить: …»).
  if (fx.title) {
    const t = p.title.replace(/^# Пункты:\s*/, '')
    const hits = fx.title.re.filter((re) => re.test(t)).length
    if (fx.title.not && fx.title.not.test(t)) r.form.push(`предмет списка ${short(p.title)} — ${fx.title.d}`)
    else if (!hits) r.form.push(`предмет списка ${short(p.title)} — не ответ аналитика`)
    else if (hits < fx.title.re.length) r.warn.push(`предмет списка ${short(p.title)} — не все основы ответа аналитика`)
  }
  p.items.forEach((it, idx) => {
    const n = idx + 1
    if (!KINDS3.includes(it.kind)) r.form.push(`вид не из трёх (решено, открыто, сведение): ${short(it.raw)}`)
    if (ctx.tSpeech) {
      // `;` внутри скобок («решил: Инга (предложил Роберт; Милана согласна)») — запятая: иначе ground-check обрывает поле
      // на `;` до закрывающей скобки и читает «предложил» человеком (пилот 2026-10-16 NOTES run-3).
      const body0 = it.t.replace(/\(([^()]*)\)/g, (m) => m.replace(/;/g, ',')).replace(RE_WAIT_NONE, 'ждёт: —').replace(RE_DECIDER_NONE, '$1—')
      // `ждёт:` и `со слов` — человек сверяется по всей расшифровке: участник встречи там — не ложь, красное — имени нет
      // в расшифровке совсем (пилот 2026-10-16, NONAMES expected:146–148). `решил:` и числа — по окну записи.
      const people = (body0.match(RE_PEOPLE_FIELD) || []).join('; ')
      const body = body0.replace(RE_PEOPLE_FIELD, ' ')
      const g = groundCheck(body, itemSource(it, n, ctx), { skip: latinOf(body) })
      const g2 = people ? groundCheck(people, [ctx.tSpeech.join('\n'), ...(ctx.docs || []), ctx.analyst || ''], { skip: latinOf(people) }) : { missing: [] }
      const miss = [...g.missing, ...g2.missing]
      if (miss.length) r.form.push(`без опоры (нет в строках цитат ±2, документах задачи и ответах аналитика; ждёт / со слов — во всей расшифровке): ${fmtMissing({ missing: miss })}: ${short(it.raw)}`)
      // Открытый вопрос разбора записан решённым: все записи пункта — «открытый вопрос», а пункт — `[решено]`.
      const recs = recsOf(it, n, ctx)
      if (it.kind === 'решено' && recs.length && recs.every((rec) => /^открыт/.test(rec.kind))) r.form.push(`открытый вопрос разбора записан решённым: ${short(it.raw)}`)
    }
    if (it.kind === 'решено' && !(fx.deciderDash ? /[—–-]\s*реш(ил|ила|или):\s*\S/i : RE_DECIDER).test(it.t)) r.form.push(`у [решено] нет «— решил: <кто>»: ${short(it.raw)}`)
    // Решивший — причастный к этому решению (общее правило «решил:» MEET-WORKSHOP / NONAMES / NOTES): правило темы даёт
    // допустимых; темы нет — `deciderDefault` (NONAMES: имени при решении нет — любое имя ложь).
    if (it.kind === 'решено' && (fx.deciders || fx.deciderDefault)) {
      const val = (it.t.match(/реш(?:ил|ила|или):\s*(.*)$/i) || [])[1] || ''
      const names = (val.match(/[А-ЯЁ][а-яё]+/g) || []).filter((w) => !/^(Не|Никто|Все|Участники|Неизвестно|Решили)$/.test(w))
      const rule = (fx.deciders || []).find((d) => d.re.every((re) => re.test(it.t)))
      const allow0 = rule ? rule.allow : fx.deciderDefault
      // Любая форма имени участника: фамилия, имя, отчество (пары из говорящих и строки участников конспекта, пилот
      // 2026-10-16: «решил: Роберт» = Пименов Роберт).
      const same = (a, b) => lowYo(a).startsWith(stemOf(b)) || lowYo(b).startsWith(stemOf(a))
      const allow = allow0 && [...new Set([...allow0, ...allow0.flatMap((a) => (ctx.aliases || []).flatMap(([x, y]) => (same(a, x) ? [y] : same(a, y) ? [x] : [])))])]
      if (allow) {
        const ok = (nm) => allow.some((a) => lowYo(nm).startsWith(stemOf(a)) || lowYo(a).startsWith(stemOf(nm)))
        const bad = names.filter((nm) => !ok(nm))
        if (bad.length) r.form.push(`решил: ${bad.join(' ')} — к этому решению по расшифровке не причастен (${rule ? rule.d : 'имени при решении нет'}): ${short(it.raw)}`)
      }
    }
    // Лишнее [решено] (MEET-WORKSHOP): решением может быть только названное в `decided.allow` или прошедшее Шаг 5 с ответом
    // «Оставляем»; `decided.never` — красный всегда.
    if (it.kind === 'решено' && fx.decided) {
      const never = fx.decided.never.find((x) => x.re.test(it.t))
      const step5 = recsOf(it, idx + 1, ctx).some((rec) => /оставля/i.test(rec.answer || ''))
      if (never) r.form.push(`[решено] — ${never.d}: ${short(it.raw)}`)
      else if (!fx.decided.allow.some((re) => re.test(it.t)) && !step5) r.form.push(`[решено] там, где решения не было (спор, «угу», «как сейчас»): ${short(it.raw)}`)
    }
    const line = ctx.tRaw[it.L - 1]
    if (it.L < 1 || line === undefined || !line.trim()) r.form.push(`ссылка на несуществующую строку расшифровки L${it.L}`)
    else if (ctx.quoteLines && !ctx.quoteLines.has(it.L)) r.warn.push(`L${it.L} — не строка цитат разбора`)
    if (it.extraL) r.warn.push(`хвост пункта не «· L<n>»: ${short(it.raw.slice(-30))}`)
    if (RE_ANCHOR_TEXT.test(it.t)) r.form.push(`номер строки или время в тексте пункта: ${short(it.raw)}`)
    if (RE_LINK.test(it.t)) r.form.push(`«вместо:» или «отвечает на:» в пункте: ${short(it.raw)}`)
    if (RE_UNSAID.test(it.t.replace(RE_WAIT_NONE, 'ждёт: —'))) r.warn.push(`утверждение о несказанном: ${short(it.raw)}`)
    if (it.kind === 'открыто' && !/жд[её]т:/i.test(it.t)) r.warn.push(`у [открыто] нет «ждёт:»: ${short(it.raw)}`)
    if (it.kind === 'сведение' && !/со\s+слов/i.test(it.t)) r.warn.push(`у [сведение] нет «со слов»: ${short(it.raw)}`)
    // `L<n>` в тексте — якорь, его ловит своя проверка выше.
    for (const tok of new Set((it.t.match(RE_LAT_TOKEN) || []).filter((x) => /[A-Za-z]/.test(x) && !/^L\d+$/.test(x)))) {
      if (hasToken(ctx.corpus, tok)) continue
      if (isCode(tok)) r.form.push(`код без опоры (нет в расшифровке и документах задачи): ${tok}`)
      else r.warn.push(`латиница без опоры: ${tok}`)
    }
  })
  const hit = (c) => poolOf(p.items, c.sec).some((it) => c.re.every((re) => re.test(it.t)))
  for (const m of fx.must) r.must[m.id] = hit(m) || (m.alt || []).some(hit)
  for (const m of fx.mustNot) r.mustNot[m.id] = poolOf(p.items, m.sec).some((it) => m.re.every((re) => re.test(it.t)) && !legit(m, it.t))
  r.missing = fx.must.filter((m) => !r.must[m.id]).map((m) => m.d)
  for (const c of fx.count) { const n = p.items.filter(c.test).length; if (n < c.min) r.missing.push(`${c.d}: ${n}, нужно ≥${c.min}`) }
  r.violations = fx.mustNot.filter((m) => r.mustNot[m.id]).map((m) => m.d)
  for (const m of fx.warn) if (!hit(m)) r.warn.push('в списке нет: ' + m.d)
  for (const m of fx.notice || []) if (hit(m)) r.warn.push(m.d)
  // Полнота сведений: факт покрыт, если хоть один пункт (любого вида) несёт все его признаки.
  r.facts = { covered: [], lost: [] }
  for (const f of fx.facts) (p.items.some((it) => f.re.every((re) => re.test(it.t))) ? r.facts.covered : r.facts.lost).push(f)
  if (fx.facts.length) {
    // `factsWarn` — полнота сведений проба не мерит (MEET-WORKSHOP / NONAMES / NOTES): нехватка — предупреждение.
    const sink = fx.factsWarn ? r.warn : r.missing
    const crit = r.facts.lost.filter((f) => f.critical)
    if (crit.length) sink.push('критичные сведения: ' + crit.map((f) => f.d).join('; '))
    if (r.facts.covered.length < fx.factsMin) sink.push(`сведений расшифровки в списке ${r.facts.covered.length} из ${fx.facts.length}, нужно ≥${fx.factsMin}`)
    const minor = r.facts.lost.filter((f) => !f.critical)
    if (minor.length) r.warn.push('нет сведений: ' + minor.map((f) => f.d).join('; '))
  }
  r.pass = !r.form.length && !r.missing.length && !r.violations.length
  return r
}

// Строки `цитаты:` с номерами строк, но без текста в «…» (Шаг 7: номер без текста — Read и текст дословно).
const bareQuoteLines = (text) => text.split('\n').filter((l) => /^\s*цитаты:/.test(l) && /L\d+/.test(l) && !/«[^»]+»/.test(l))

export function gradeRazborPt (text, fx, tLines, nItems) {
  const r = gradeRazbor(text, fx, tLines)
  // Список у разбора один: имя файла в заголовке раздела не обязательно (пилот 2026-10-15: «## В список» без имени).
  r.heading = /^#{2,3} В список(\s|$)/m.test(text)
  r.layout = /^## В список(\s|$)/m.test(text)
  const marks = new Set([...text.matchAll(/в\s+список:\s*п\.\s*(\d+)/g)].map((m) => Number(m[1])))
  r.unmarked = []
  for (let i = 1; i <= nItems; i++) if (!marks.has(i)) r.unmarked.push(i)
  r.strayMarks = [...marks].filter((n) => n < 1 || n > nItems)
  r.bare = bareQuoteLines(text)
  // Номера строк цитат записей — с ними сверяется `L<n>` пункта (output.md: первая строка цитат записи).
  r.quoteLines = new Set()
  for (const l of text.split('\n')) if (/^\s*цитаты:/.test(l)) for (const m of l.matchAll(/(^|[^A-Za-z])L(\d+)/g)) r.quoteLines.add(Number(m[2]))
  r.pass = r.quotes >= r.minQuotes && !r.bad.length && !r.lost.length && r.heading && !(fx.bareRed && r.bare.length)
  return r
}

// Ходы прогона: `answer-NN.md`; ходов нет — `answer.md`.
function turnsOf (dir) {
  const names = existsSync(dir) ? readdirSync(dir).filter((f) => /^answer-\d+\.md$/.test(f)).sort() : []
  if (names.length) return names.map((f) => ({ n: Number(f.match(/\d+/)[0]), text: read(join(dir, f)) }))
  return existsSync(join(dir, 'answer.md')) ? [{ n: 1, text: read(join(dir, 'answer.md')) }] : []
}

// Писал ли ход список: Write/Edit по пути `*.points.md` в потоке хода. Потока хода нет — `null`.
function wroteList (dir, n) {
  const names = (n === 1 ? ['stream.jsonl', 'stream-01.jsonl'] : [`stream-${String(n).padStart(2, '0')}.jsonl`]).filter((f) => existsSync(join(dir, f)))
  if (!names.length) return null
  for (const f of names) {
    for (const line of read(join(dir, f)).split('\n')) {
      let e; try { e = JSON.parse(line) } catch { continue }
      const content = e && e.message && Array.isArray(e.message.content) ? e.message.content : []
      for (const c of content) {
        if (!c || c.type !== 'tool_use' || !c.input) continue
        if (['Write', 'Edit', 'MultiEdit'].includes(c.name) && /\.points\.md$/.test(String(c.input.file_path || ''))) return true
        if (c.name === 'Bash' && /\.points\.md/.test(String(c.input.command || '')) && /(>>|>\s*\S*\.points\.md|tee\s)/.test(String(c.input.command || ''))) return true
      }
    }
  }
  return false
}

// Вопрос о ключе (из grade-minb.mjs, MI-NB-OUT): Шаг 2 2.0.0 — «ключ не нашёлся — `—`, не спрашиваешь».
const RE_KEY_ASK = /ключ\S*\s+задач\S*\s*\?|как(ой|ов)\s+(у\s+(неё|задачи)\s+)?ключ|если\s+(его\s+)?(ещё\s+)?нет\s*[—–-]+\s*так\s+и\s+напишите|назов\S*\s+ключ|укаж\S*\s+ключ/i
// Ход-стоп: хвост ответа — «решений нет» или стоп Шага 2 «нет ни решений, ни сведений», вопроса нет, список в ходе не
// писан. Со сведениями это ошибка; реплика стенда доводит диалог до записи и прячет стоп (MI-NB-OUT, ревью 1.1.0).
const RE_STOP_TAIL = /нет\s+ни\s+решений|решени\S*[^.!?\n]{0,30}?\s(нет|не\s+было)([^а-яё]|$)/i
const RE_ASKS = /\?|вариант\S*\s*:|ответьте|выберите/i

function stopTurns (dir) {
  const turns = turnsOf(dir)
  const last = turns.length ? turns[turns.length - 1].n : 0
  return turns.filter((t) => {
    if (!RE_STOP_TAIL.test(t.text.trim().slice(-200)) || RE_ASKS.test(t.text)) return false
    const wrote = wroteList(dir, t.n)
    return wrote === null ? t.n !== last : !wrote
  }).map((t) => t.n)
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&')

// Документы задачи — те, что скилл ищет (SKILL.md Шаг 2): БТ, спека, запрос на правку. Вход прошлой встречи из засева
// (REW) документом задачи не считается и опорой пункта и роли не служит.
const TASK_DOC = /(^|\/)(business_requirements|technical_specification|change_request)\.md$/
// Ответы аналитика стенда: первая реплика и реплика на ходы фикстуры (`w-prompt.txt`, `w-turn2.txt`).
function fixtureReplies (fx) {
  const dir = (fx.transcript.match(/^(fixtures\/[^/]+)\//) || [])[1]
  if (!dir) return ''
  return ['w-prompt.txt', 'w-turn2.txt'].map((f) => join(HERE, dir, f)).filter((p) => existsSync(p)).map((p) => read(p)).join('\n')
}
// Реплики двойника аналитика в песочнице прогона (`_twin/reply-NN.txt`), если пул их писал.
function runReplies (dir) {
  const td = join(dir, '_twin')
  if (!existsSync(td)) return ''
  return readdirSync(td).filter((f) => /^reply-\d+\.txt$/.test(f)).sort().map((f) => read(join(td, f))).join('\n')
}

function ptCtx (fx) {
  const raw = readFileSync(join(HERE, fx.transcript), 'utf8')
  const docs = Object.entries(fx.seed).filter(([rel]) => rel.startsWith('coddoc/')).map(([, src]) => read(join(HERE, src)))
  const tRaw = lf(raw).replace(/^\uFEFF/, '').split('\n')
  return {
    tRaw,
    tLines: transcriptTexts(raw),
    tSpeech: tRaw.map(speechOf),
    blocks: srtBlocks(tRaw),
    srtTimes: srtBlocks(tRaw) ? new Set(tRaw.flatMap((l) => (/-->/.test(l) ? [...l.matchAll(/(\d\d):(\d\d):\d\d/g)].map((m) => Number(m[1]) * 60 + Number(m[2])) : []))) : null,
    // Формы имени одного участника: [фамилия, имя] / [фамилия, отчество] — из говорящих, у конспекта — из шапки.
    noteAliases: tRaw.map(speakerOf).filter(Boolean).length < 2 ? tRaw.slice(0, 5).flatMap((l) => [...l.matchAll(/([А-ЯЁ][а-яё]+)\s+([А-ЯЁ][а-яё]+)/g)].map((m) => [m[1], m[2]])) : [],
    aliases: [
      ...(tRaw.map(speakerOf).filter(Boolean).length < 2 ? tRaw.slice(0, 5).flatMap((l) => [...l.matchAll(/([А-ЯЁ][а-яё]+)\s+([А-ЯЁ][а-яё]+)/g)].map((m) => [m[1], m[2]])) : []),
      ...[...new Set(tRaw.map(speakerOf).filter(Boolean))].flatMap((s) => { const w = s.split(/\s+/); return w.slice(1).map((x) => [w[0], x]) }),
    ],
    // Разделы конспекта (строки подряд до пустой) — у чата и SRT нет.
    sections: !srtBlocks(tRaw) && tRaw.map(speakerOf).filter(Boolean).length < 2 ? sectionsOf(tRaw) : null,
    srcName: fx.transcript.split('/').pop(),
    // Время встречи в шапке: метки чата «чч:мм», у SRT — таймкоды записи (от её начала).
    // Метки SRT/VTT: «чч:мм» каждой; у первой и последней ещё «мм:сс» и минута с округлением вверх («00:02:27» →
    // «02:27», «00:03») — шапка «00:00–02:27 (от начала записи)» берёт начало и конец записи.
    tTimes: (() => {
      const chat = tRaw.map((l) => (l.match(/^\d{4}-\d\d-\d\d (\d\d:\d\d):\d\d/) || [])[1]).filter(Boolean)
      const cues = tRaw.filter((l) => /-->/.test(l)).flatMap((l) => [...l.matchAll(/(\d\d):(\d\d):(\d\d)[.,]\d+/g)])
      const ends = cues.length ? [cues[0], cues[cues.length - 1]] : []
      return [...chat, ...cues.map((m) => `${m[1]}:${m[2]}`),
        ...ends.flatMap((m) => [`${m[2]}:${m[3]}`, `${m[1]}:${String(Number(m[2]) + 1).padStart(2, '0')}`])].join(' ')
    })(),
    speakers: [...new Set(tRaw.map(speakerOf).filter(Boolean))],
    docs: Object.entries(fx.seed).filter(([rel]) => rel.startsWith('coddoc/') && TASK_DOC.test(rel)).map(([, src]) => read(join(HERE, src))),
    // Все файлы папки задачи из засева (с входом прошлой встречи) — для шапки: роль оттуда не ложь, предупреждение.
    seedDocs: Object.entries(fx.seed).filter(([rel]) => rel.startsWith('coddoc/')).map(([, src]) => read(join(HERE, src))),
    analyst: fixtureReplies(fx),
    corpus: [lf(raw), ...docs, fx.key || ''].join('\n').toLowerCase(),
  }
}

export function gradeRunPt (dir, fx) {
  const r = {}
  const seeded = existsSync(join(dir, '_seeded.txt')) ? new Set(read(join(dir, '_seeded.txt')).split('\n').filter(Boolean)) : new Set()
  const files = listFiles(dir)
  const where = fx.key ? `^coddoc/(.+/)?${esc(fx.key)}/` : fx.altKeys ? `^(${esc(fx.folder)}|coddoc/(.+/)?(${fx.altKeys.map(esc).join('|')}))/` : `^${esc(fx.folder)}/`
  // `anyDash` (MEET-SAMEDAY): `-2` в любом месте имени — тоже список и разбор (баг 5 текущей версии — не ложь); место
  // `-2` по правке E5 сверяется отдельной строкой «по правке».
  const listRe = new RegExp(where + (fx.anyDash ? 'meeting-[^/]*\\.points[^/]*$' : 'meeting-[^/]+\\.points\\.md$'))
  const razborRe = new RegExp(where + (fx.anyDash ? 'meeting-[^/]*\\.razbor[^/]*$' : 'meeting-[^/]+\\.razbor\\.md$'))
  const lists = files.filter((f) => listRe.test(f) && !(f in fx.seed))
  const razbors = files.filter((f) => razborRe.test(f) && !(f in fx.seed))
  // `_twin/` — реплики двойника аналитика, пишет пул.
  r.extra = files.filter((f) => !lists.includes(f) && !razbors.includes(f) && !seeded.has(f) && !(f in fx.seed) && !(!f.includes('/') && STAND.test(f)) && !f.startsWith('_twin/'))
  // Засев с sha256 из expected.md (MEET-SAMEDAY) — сверка байт в байт; без него — с файлом фикстуры.
  const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')
  r.touched = Object.entries(fx.seed).filter(([rel, src]) => !existsSync(join(dir, rel)) ||
    (fx.seedSha && fx.seedSha[rel] ? sha(join(dir, rel)) !== fx.seedSha[rel] : read(join(dir, rel)) !== read(join(HERE, src)))).map(([rel]) => rel)
  r.listPath = lists[0] || null
  r.razborPath = razbors[0] || null
  // По правке (черновик runs/2026-10-16-harden-edits.md): ожидание, которого текущий текст скилла не даёт однозначно, —
  // отдельной строкой, в исход не входит.
  r.byEdit = []
  if (fx.byEdit) {
    const base = (p) => (p ? p.split('/').pop() : '—')
    if (r.listPath && base(r.listPath) !== fx.byEdit.list) r.byEdit.push(`${fx.byEdit.id}: список «${base(r.listPath)}», по правке «${fx.byEdit.list}»`)
    if (r.razborPath && base(r.razborPath) !== fx.byEdit.razbor) r.byEdit.push(`${fx.byEdit.id}: разбор «${base(r.razborPath)}», по правке «${fx.byEdit.razbor}»`)
  }
  const ctx = ptCtx(fx)
  const listText = lists.length === 1 ? read(join(dir, lists[0])) : null
  const razborText = razbors.length === 1 ? read(join(dir, razbors[0])) : ''
  r.razbor = razbors.length === 1 ? gradeRazborPt(razborText, fx, ctx.tLines, listText ? parsePoints(listText).items.length : 0) : null
  r.list = listText !== null ? gradePoints(listText, fx, { ...ctx, analyst: [ctx.analyst, runReplies(dir)].join('\n'), records: razborRecords(razborText), quoteLines: r.razbor ? r.razbor.quoteLines : null }) : null
  const uses = toolUses(dir)
  r.forbiddenReads = uses.filter((u) => ['Read', 'Grep', 'Glob', 'Bash'].includes(u.name) && RE_FORBIDDEN_READ.test(Object.values(u.input).filter((v) => typeof v === 'string').join(' ').replace(RE_EXCLUDE_ARG, '')))
    .map((u) => `${u.sub ? 'субагент' : 'ведущий'} ${u.name} ${JSON.stringify(u.input).slice(0, 90)}`)
  r.agents = uses.filter((u) => !u.sub && (u.name === 'Agent' || u.name === 'Task')).length
  r.dateOk = !fx.fileDate || (!!r.listPath && r.listPath.endsWith(`/meeting-${fx.fileDate}.points.md`) && !!r.razborPath && r.razborPath.endsWith(`/meeting-${fx.fileDate}.razbor.md`))
  r.sameBase = !r.listPath || !r.razborPath || r.listPath.replace(/\.points\.md$/, '') === r.razborPath.replace(/\.razbor\.md$/, '')
  const turns = turnsOf(dir)
  const dialog = turns.map((t) => t.text).join('\n')
  r.keyAsked = fx.keyAsk && RE_KEY_ASK.test(dialog)
  r.stops = fx.stopCheck ? stopTurns(dir) : []
  // Вопрос темы — по ходам: «темы» в одном ходе и «Какую разбираем?» в другом не складываются.
  r.themeAsked = turns.map((t) => ({ n: t.n, q: themeQuestion(t.text) })).filter((x) => x.q)
  const shown = sideShown(dialog)
  r.side = sideCheck(r.list ? r.list.items : [], fx, shown, razborText)
  // Ссылки разбора на список. Список из засева (другая встреча, MEET-SAMEDAY) в `> Список:` или `## В список …` —
  // красный: разбор объявляет своим чужой список. Не тот, что записан, — предупреждение.
  r.refs = { red: [], warn: [] }
  if (razborText) {
    const refLines = razborText.split('\n').filter((l) => /^> Список:|^#{2,3} В список/.test(l))
    for (const s of Object.keys(fx.seed).filter((k) => /\.points\.md$/.test(k)).map((k) => k.split('/').pop())) {
      const bad = refLines.find((l) => l.split(/[\s/\\`«»]+/).includes(s))
      if (bad) r.refs.red.push(`разбор ссылается на список засева (другая встреча): «${bad.slice(0, 80)}»`)
    }
    const mine = r.listPath ? r.listPath.split('/').pop() : null
    const head = refLines.find((l) => /^> Список:/.test(l))
    if (mine && head && !r.refs.red.length && !head.split(/[\s/\\`«»]+/).includes(mine)) r.refs.warn.push(`«> Список:» разбора — не записанный список ${mine}: «${head.slice(0, 80)}»`)
  }
  // «Записать без этих K» (MEET-TWIN): пункт побочной темы показан строкой «Похоже, не про …», аналитик его снял, а он
  // в списке — красный (против ответа аналитика). Не показан — общий случай побочного, строка отчёта.
  r.sideDropped = []
  const replies = runReplies(dir)
  if (fx.sideDrop && r.list && /без\s+эт(их|ого|ой)/i.test(replies)) {
    for (const s of fx.side) {
      if (!s.re.test(shown)) continue
      const it = r.list.items.find((x) => s.re.test(x.t) && !(s.not && s.not.test(x.t)) && !/^\s*не\s+входит/i.test(x.t))
      if (it) r.sideDropped.push(`${s.d}: «${it.t.slice(0, 60)}»`)
    }
  }
  // Предмет в заголовке разбора — тот же ответ аналитика (output.md:46): отвергнутый предмет — красный, без основ — предупреждение.
  r.razborTitle = null
  if (fx.title && razborText) {
    const t0 = (razborText.split('\n')[0] || '').replace(/^#\s*Разбор встречи[^:]*:\s*/, '')
    r.razborTitle = { red: !!(fx.title.not && fx.title.not.test(t0)), warn: !fx.title.re.some((re) => re.test(t0)), t: t0.slice(0, 70) }
  }
  // SRT (MEET-NONAMES): говорящих в файле нет; говорящий у цитаты разбора — только при самоназвании в этом блоке
  // («Я Кира»). Обращение («Изольда Марковна, …») говорящим не делает — красный.
  r.srtSpeakers = []
  if (ctx.blocks && razborText) {
    for (const m of razborText.matchAll(/L(\d+)(?:[–-]L?\d+)?:?[ \t]+(?:\[?[\d:.,]+\]?(?:[ \t]*-->[ \t]*[\d:.,]+)?[ \t]+)?([^:«»\n|]{1,60}):[ \t]*«/g)) {
      const name = (m[2].match(/[А-ЯЁ][а-яё]+/) || [])[0]
      if (!name) continue
      const b = ctx.blocks[Number(m[1]) - 1]
      const toks = tokensOf(ctx.tSpeech.filter((_, i) => b >= 0 && ctx.blocks[i] === b).join(' '))
      const st = stemOf(name)
      const self = toks.some((tk, i) => /^(я|это|меня)$/.test(tk) && (toks[i + 1] || '').startsWith(st))
      if (!self) r.srtSpeakers.push(`L${m[1]} «${m[2].trim()}» — в SRT говорящего нет, самоназвания в блоке нет`)
    }
  }
  // По правке E10 (MEET-NOTES): строка конспекта — опора; код словами в своём пункте и вердикт «без опоры» у кода
  // конспекта — дефект по правке, на текущей версии (баг 12) — отдельная строка, не исход.
  if (fx.byEditCodes && r.list) {
    for (const c of fx.byEditCodes) {
      const its = r.list.items.filter((it) => (!c.kind || it.kind === c.kind) && c.re.every((re) => re.test(it.t)))
      if (its.length && !its.some((it) => c.need.test(it.t))) r.byEdit.push(`по правке E10: код словами${c.warn ? ' (предупреждение)' : ''} — ${c.d}`)
    }
    const verdicts = razborText.split('\n').filter((l) => /без\s+опоры/i.test(l) && /FRZ-|ON_HOLD|freeze_days|ACTIVE|PAUSED|CRM/.test(l))
    if (verdicts.length) r.byEdit.push(`по правке E10: вердикт «без опоры» у кода конспекта (${verdicts.length}): «${verdicts[0].trim().slice(0, 70)}»`)
  }
  // Сводка и отчёт называют путь нового списка (SKILL.md:162, 186) — предупреждение.
  r.listNotNamed = !!(fx.byEdit && r.listPath && dialog.trim() && !dialog.includes(r.listPath.split('/').pop()))
  // Побочное без строки «Похоже, не про …» и ложная пометка «не про тему» — не ложь и не поломка основного пути
  // (ревью оценщиков 2026-10-16): отдельная строка отчёта, в исход прогона не входят.
  r.pass = lists.length === 1 && razbors.length === 1 && !r.extra.length && !r.touched.length && !r.forbiddenReads.length &&
    r.list.pass && r.razbor.pass && r.dateOk && !r.keyAsked && !r.stops.length && !r.themeAsked.length &&
    !r.refs.red.length && !r.sideDropped.length && !(r.razborTitle && r.razborTitle.red) && !r.srtSpeakers.length
  r.lists = lists.length
  r.razbors = razbors.length
  return r
}

// ---------- самопроверка ----------

function selftest () {
  let bad = 0
  const ck = (n, got, want) => { const ok = got === want; if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${n}: ${got} (ожидалось ${want})`) }
  for (const [name, fx] of Object.entries(FX)) {
    console.log(`\n${name}`)
    const inp = read(join(HERE, fx.etalon.input))
    const raz = read(join(HERE, fx.etalon.razbor))
    const tl = transcriptTexts(readFileSync(join(HERE, fx.transcript), 'utf8'))
    const gi = gradeInput(inp, fx)
    ck('эталон входа — зелёный', gi.pass, true)
    if (!gi.pass) console.log('     ', gi.missing, gi.violations)
    const gr = gradeRazbor(raz, fx, tl)
    ck('эталон разбора — зелёный', gr.pass, true)
    if (!gr.pass) console.log('     ', gr.quotes, gr.bad, gr.lost)
    // Подменяется цитата со строкой, а не первая «ёлочка» файла: в `суть` бывают названия в кавычках (CR).
    ck('выдуманная цитата — поймана', gradeRazbor(raz.replace(/(L\d+ [\d:]+ [^:«\n]+: «)[^»]{20,}»/, '$1Это мы точно решили, записываю»'), fx, tl).bad.length, 1)
    const shifted = gradeRazbor(raz.replace(/L(\d+)( [\d:]+ [^:«\n]+: «)/, (_, n, rest) => `L${Number(n) + 40}${rest}`), fx, tl)
    ck('верная цитата на чужой строке — предупреждение, не красный', `${shifted.moved.length}/${shifted.bad.length}/${shifted.pass}`, '1/0/true')
    console.log(`      цитат в эталоне разбора: ${gr.quotes}`)
    const q1 = raz.match(/«([^»]{30,})»/)[1]
    const typo = q1.slice(0, 10) + (q1[10] === 'а' ? 'о' : 'а') + q1.slice(11)
    ck('опечатка в 1 букву — не выдумка', gradeRazbor(raz.replace(`«${q1}»`, `«${typo}»`), fx, tl).bad.length, 0)
    // Перестановка двух соседних длинных слов — как в круге 2 («сказать сейчас» вместо «сейчас сказать»).
    const words = q1.split(' ')
    const at = words.findIndex((w, i) => i + 1 < words.length && w.length >= 6 && words[i + 1].length >= 6)
    const swapped = at >= 0 ? [...words.slice(0, at), words[at + 1], words[at], ...words.slice(at + 2)].join(' ') : q1 + ' совершенно выдуманное продолжение'
    ck('перестановка длинных слов — поймана', gradeRazbor(raz.replace(`«${q1}»`, `«${swapped}»`), fx, tl).bad.length, 1)
    ck('якорь во входе — красный', gradeInput(inp.replace('## Решено\n', '## Решено\n0. L72 решили.\n'), fx).pass, false)
    ck('нет раздела «Во вход» — красный', gradeRazbor(raz.replace(/^## Во вход .*$/m, '## Разное'), fx, tl).pass, false)
    const sub = gradeRazbor(raz.replace(/^## Во вход /m, '### Во вход '), fx, tl)
    ck('«Во вход» подразделом — зелёный с предупреждением', `${sub.pass}/${sub.layout}`, 'true/false')

    const sandbox = mkdtempSync(join(tmpdir(), 'grade-meet-'))
    try {
      for (const [rel, src] of Object.entries(fx.seed)) { mkdirSync(join(sandbox, rel, '..'), { recursive: true }); writeFileSync(join(sandbox, rel), read(join(HERE, src))) }
      const folder = fx.folder || Object.keys(fx.seed)[0].replace(/\/[^/]+$/, '')
      mkdirSync(join(sandbox, folder), { recursive: true })
      writeFileSync(join(sandbox, folder, fx.etalon.input.split('/').pop()), inp)
      writeFileSync(join(sandbox, folder, fx.etalon.razbor.split('/').pop()), raz)
      ck('песочница с эталоном — зелёная', gradeRun(sandbox, fx).pass, true)
      const seedRel = Object.keys(fx.seed)[0]
      writeFileSync(join(sandbox, seedRel), read(join(sandbox, seedRel)) + '\nправка\n')
      ck('документ задачи тронут — красный', gradeRun(sandbox, fx).pass, false)
      writeFileSync(join(sandbox, seedRel), read(join(HERE, fx.seed[seedRel])))
      writeFileSync(join(sandbox, folder, 'business_requirements_v2.md'), 'x')
      ck('лишний файл — красный', gradeRun(sandbox, fx).extra.length, 1)
      rmSync(join(sandbox, folder, 'business_requirements_v2.md'))
      writeFileSync(join(sandbox, 'answer.md'), 'отчёт'); writeFileSync(join(sandbox, '_seeded.txt'), Object.keys(fx.seed).join('\n'))
      ck('файлы стенда в корне — не лишние', gradeRun(sandbox, fx).pass, true)
      writeFileSync(join(sandbox, 'notes.md'), 'x')
      ck('лишний файл в корне — пойман', gradeRun(sandbox, fx).extra.includes('notes.md'), true)
      rmSync(join(sandbox, 'notes.md'))
      const ev = (input, sub) => JSON.stringify({ type: 'assistant', parent_tool_use_id: sub ? 'toolu_1' : null, message: { content: [{ type: 'tool_use', id: 'x', name: 'Read', input }] } })
      writeFileSync(join(sandbox, 'stream.jsonl'), ev({ file_path: 'C:/sb/coddoc/' + fx.key + '/business_requirements.md' }, false) + '\n')
      ck('чтение документа задачи — законно', gradeRun(sandbox, fx).forbiddenReads.length, 0)
      writeFileSync(join(sandbox, 'stream-02.jsonl'), ev({ file_path: 'C:\\sb\\services\\idm.md' }, true) + '\n')
      ck('субагент читал services/ — пойман', gradeRun(sandbox, fx).forbiddenReads.length, 1)
      const bash = (command) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'y', name: 'Bash', input: { command } }] } })
      writeFileSync(join(sandbox, 'stream-02.jsonl'), bash('find . -name "*.md" -not -path "./services/*"') + '\n')
      ck('исключение services/ в find — не чтение', gradeRun(sandbox, fx).forbiddenReads.length, 0)
      writeFileSync(join(sandbox, 'stream-02.jsonl'), bash('cat services/idm.md') + '\n')
      ck('cat services/ относительным путём — пойман', gradeRun(sandbox, fx).forbiddenReads.length, 1)
    } finally { rmSync(sandbox, { recursive: true, force: true }) }

    const add = (line) => inp.replace('## Решено\n', `## Решено\n0. ${line}\n`)
    const drop = (re) => inp.split('\n').filter((l) => !re.test(l)).join('\n')
    ck('шапка с ролью «бэкенд» и временем с секундами — законна', gradeInput(inp.replace(/^> Встреча: .*$/m, '> Встреча: 2026-10-07 11:02:41–11:21:31 · решали: бэкенд — Иванов И. И.'), fx).pass, true)
    const RANGE = { VAC: [54, 57, 'А, да. Мы его собираем.… Человек 40 без руководителя получается.'], ACC: [29, 32, 'Ну как сказать.… Массовые заведения после кадровых приказов'], LONG: [279, 283, 'Я.… Я спрошу, но думаю, это нормально.'], NEW: [28, 30, 'Вот по два эн дэ эф эл я сразу скажу.… Я бы её в портал не тащил.'], REW: [78, 79, 'Стоп, подождите.… Доменный логин и код системы.'], CHG: [47, 48, 'Кстати, простите, по отпускам ещё.… Отклонённые и отозванные заявки, три года.'], CR: [91, 94, 'Итого. Первое.… За один рабочий день до закрытия письмо пользователю.'] }[name]
    ck('цитата-диапазон на несколько строк — сходится', gradeRazbor(raz.replace(/^## Отброшено/m, `#99 сведение · БТ · проба\n   цитаты: L${RANGE[0]}–L${RANGE[1]} 00:00:00 Кто: «${RANGE[2]}»\n\n## Отброшено`), fx, tl).bad.length, 0)
    ck('поле на следующей строке не читается цитатой', gradeRazbor(raz.replace(/^## Отброшено/m, '#98 сведение · БТ · проба\n   итог: L201\n   опора: «как прозвучало» → X\n\n## Отброшено'), fx, tl).bad.length, 0)
    // Ревью 1.1.0: цитата без букв — сырой текст против окна; нет в окне — не цитата и не выдумка.
    const lq = (q) => { const x = gradeRazbor(raz.replace(/^## Отброшено/m, `#97 сведение · БТ · проба\n   оговорка: ${q}\n\n## Отброшено`), fx, tl); return `${x.quotes - gr.quotes}/${x.bad.length}` }
    ck('цитата «?» не на своей строке — не выдумка и не в счёт', lq('L9000 «?»'), '0/0')
    ck('цитата «…» — не выдумка и не в счёт', lq('L1 «…»'), '0/0')
    const qLine = tl.findIndex((l) => l.includes('?')) + 1
    ck(`цитата «?» на строке с «?» (L${qLine}) — сошлась`, lq(`L${qLine} «?»`), '1/0')
    if (name === 'VAC') {
      ck('«директора на бумаге» — пойман', gradeInput(add('Директора пишут заявление на бумаге, как раньше.'), fx).mustNot.paper, true)
      ck('реализация во входе БТ — поймана', gradeInput(add('Число дней считает бэк и хранит в заявке.'), fx).mustNot.impl, true)
      ck('«кадровик видит и на согласовании» — пойман', gradeInput(add('Кадровик видит и заявки на согласовании.'), fx).mustNot.hrPending, true)
      ck('форма на слух — поймана', gradeInput(add('Эф эр 3 не меняется.'), fx).mustNot.asr, true)
      ck('шум — пойман', gradeInput(add('ИФТ лежит до обеда.'), fx).mustNot.noise, true)
      ck('нет FR-10 — красный', gradeInput(drop(/FR-10/), fx).must.fr10, false)
      ck('срок ежегодного решением, а не открытым — красный', gradeInput(drop(/ежегодн/).replace('## Решено\n', '## Решено\n0. Ежегодный отпуск — не раньше чем за 3 календарных дня.\n'), fx).must.minTerm, false)
      ck('«вопрос» не считается «опросом»', gradeInput(inp + '\n## Открыто\n- Вопрос о сроке.\n', fx).mustNot.impl, false)
      ck('«в день его начала» — засчитано (круг 3)', gradeInput(drop(/FR-10/).replace('## Решено\n', '## Решено\n0. Кадровик не может отменить согласованный отпуск в день его начала: считается дата, без времени суток.\n'), fx).must.fr10, true)
      ck('«бумажные заявления» директоров — пойманы', gradeInput(add('Директора и замы, как раньше, подают бумажные заявления.'), fx).mustNot.paper, true)
      ck('«на бумаге директора не будут» — законно', gradeInput(add('Писать заявления на бумаге директора не будут.'), fx).mustNot.paper, false)
      ck('«кадровик видит только согласованные» — законно', gradeInput(add('Кадровик видит только согласованные отпуска, заявки на согласовании ему не видны.'), fx).mustNot.hrPending, false)
      ck('«на момент нажатия» во входе БТ — пойман', gradeInput(add('При согласовании проверяется, что нажавший — руководитель на момент нажатия.'), fx).mustNot.impl, true)
      ck('«обновления списка» — засчитаны', gradeInput(drop(/груз|загруж|залива/).replace('## Открыто\n', '## Открыто\n- Кто вносит обновления списка руководителей — ждёт: отдел кадров.\n'), fx).must.loader, true)
    } else if (name === 'LONG') {
      ck('групповые решением — пойманы', gradeInput(add('Групповые заявки — до пяти посетителей, одно решение на заявку.'), fx).mustNot.groups, true)
      ck('групповые «вне проекта» в Решено — законно', gradeInput(add('Групповые заявки остаются вне проекта, отдельной задачей.'), fx).mustNot.groups, false)
      ck('номер пропуска в уведомлении — пойман', gradeInput(add('В уведомлении — номер пропуска.'), fx).mustNot.passNumber, true)
      ck('«без номера пропуска» — законно', gradeInput(add('Уведомление без номера пропуска.'), fx).mustNot.passNumber, false)
      ck('«номера пропуска в уведомлении нет» — законно', gradeInput(add('Номера пропуска в уведомлении нет.'), fx).mustNot.passNumber, false)
      ck('кеш во входе БТ — пойман', gradeInput(add('Руководителя кешируем на сутки.'), fx).mustNot.impl, true)
      ck('чужая тема (CSV) — поймана', gradeInput(add('Выгрузка в CSV через точку с запятой.'), fx).mustNot.otherTopic, true)
      ck('форма на слух — поймана', gradeInput(add('Задача пэ эс эс двадцать два десять.'), fx).mustNot.asr, true)
      ck('шум — пойман', gradeInput(add('Столовая работает на втором этаже.'), fx).mustNot.noise, true)
      ck('срок подачи потерян — красный', gradeInput(drop(/накануне|перед визит/), fx).must.deadline, false)
      ck('хранение — решением, а не открытым — красный', gradeInput(drop(/юрист/).replace('## Решено\n', '## Решено\n0. Номер документа храним год — решили юристы.\n'), fx).must.retention, false)
      ck('«ботинок» и «почти» не считаются реализацией', gradeInput(add('Посетитель без ботинок почти не проходит.'), fx).mustNot.impl, false)
      ck('«почтой» и «бот» — реализация', gradeInput(add('Уведомление почтой, а не через бот.'), fx).mustNot.impl, true)
    } else if (name === 'NEW') {
      ck('«только электронные» решением — пойман', gradeInput(drop(/бумажн/).replace('## Решено\n', '## Решено\n0. Справки только электронные.\n'), fx).mustNot.onlyElectronic, true)
      ck('нет бумажной на выбор — красный', gradeInput(drop(/бумажн/), fx).must.format, false)
      ck('«пять рабочих дней» — пойман', gradeInput(add('Срок — пять рабочих дней.'), fx).mustNot.fiveDays, true)
      ck('2-НДФЛ видом справки — пойман', gradeInput(add('Виды справок: с места работы, копия трудовой и 2-НДФЛ.'), fx).mustNot.ndflDecided, true)
      ck('«кроме 2-НДФЛ» в Решено — законно', gradeInput(add('Виды справок — все, кроме 2-НДФЛ.'), fx).mustNot.ndflDecided, false)
      ck('реализация во входе БТ — поймана', gradeInput(add('Файл формируется на бэке и лежит в файловом хранилище.'), fx).mustNot.impl, true)
      ck('форма на слух — поймана', gradeInput(add('Два эн дэ эф эл не делаем.'), fx).mustNot.asr, true)
      ck('шум — пойман', gradeInput(add('Собака передаёт привет.'), fx).mustNot.noise, true)
      ck('подпись решением, а не открытым — красный', gradeInput(drop(/юрист/), fx).must.sign, false)
      ck('«2-НДФЛ — вне проекта» в «Не входит» — засчитано', gradeInput(drop(/НДФЛ/).replace('## Не входит\n', '## Не входит\n- 2-НДФЛ — вне проекта.\n'), fx).must.ndfl, true)
      ck('бывшие в «Решено» с «как сейчас» — засчитано', gradeInput(drop(/бывш/).replace('## Решено\n', '## Решено\n0. Только для себя; бывшие сотрудники — как сейчас, письмом.\n'), fx).must.former, true)
      ck('«доставка курьером» в «Решено» без отрицания — красный', gradeInput(drop(/курьер/).replace('## Решено\n', '## Решено\n0. Бумажную справку привозит курьер.\n'), fx).must.courier, false)
    } else if (name === 'CHG') {
      ck('хранение «год» — поймано', gradeInput(inp.replace(/хранятся три года/, 'хранятся год'), fx).mustNot.retention1, true)
      ck('«три года, а не год» — законно', gradeInput(add('Хранение — три года, а не год.'), fx).mustNot.retention1, false)
      ck('нет трёх лет — красный', gradeInput(inp.replace(/хранятся три года/, 'хранятся год'), fx).must.retention3, false)
      ck('изменение FR-3 потеряно — красный', gradeInput(drop(/ежегодн/), fx).must.fr3, false)
      ck('чужая тема — поймана', gradeInput(add('Суточные считаем по календарным дням командировки.'), fx).mustNot.otherTopic, true)
      ck('джоба во входе БТ — поймана', gradeInput(add('Удаляет джоба раз в сутки.'), fx).mustNot.impl, true)
      ck('перепутанные виды отпуска — красный', gradeInput(drop(/ежегодн/).replace('## Решено\n', '## Решено\n0. Ежегодный — со следующего дня; без сохранения зарплаты — за три календарных дня.\n'), fx).must.fr3, false)
      ck('«отменённые не попадают» — поймано', gradeInput(add('Отменённые отпуска в список кадровика не попадают.'), fx).mustNot.fr9Inverted, true)
      ck('«год, … три года» — поймано', gradeInput(add('Отклонённые хранятся год, отозванные — три года.'), fx).mustNot.retention1, true)
      ck('«удаляются через три года» — засчитано', gradeInput(inp.replace(/хранятся три года, потом удаляются/, 'удаляются через три года'), fx).must.retention3, true)
      ck('подпункты одного решения — засчитаны', gradeInput(drop(/ежегодн/).replace('## Решено\n', '## Решено\n0. Минимальный срок подачи (FR-3):\n   - ежегодный — не раньше чем через три календарных дня;\n   - без сохранения — со следующего дня.\n'), fx).must.fr3, true)
      ck('цель «новый БТ» — красный', gradeInput(inp.replace('цель: правки БТ', 'цель: новый БТ'), fx).pass, false)
    } else if (name === 'CR') {
      ck('цель «новый БТ» — красный', gradeInput(inp.replace('цель: правка работающего', 'цель: новый БТ'), fx).pass, false)
      ck('«пять рабочих дней» — пойман', gradeInput(add('Автозакрытие — пять рабочих дней.'), fx).mustNot.fiveDays, true)
      ck('ошибка «Переоткрыть» решением — поймана', gradeInput(add('Кнопку «Переоткрыть» в мобильной версии чиним.'), fx).mustNot.bugDecided, true)
      ck('производственный календарь — пойман', gradeInput(add('Рабочие дни — по производственному календарю.'), fx).mustNot.impl, true)
      ck('нет напоминания — красный', gradeInput(drop(/напомин/i), fx).must.reminder, false)
      ck('«**цель:** правка работающей функции» — засчитано', gradeInput(inp.replace('цель: правка работающего', '**цель:** правка работающей функции'), fx).pass, true)
      ck('«пять рабочих предлагали — мало» — законно', gradeInput(add('Семь рабочих дней вместо трёх календарных (пять рабочих предлагали — мало).'), fx).mustNot.fiveDays, false)
      ck('«предложение про пять рабочих не принято» — законно (круг 2 run-4)', gradeInput(add('Семь рабочих дней вместо трёх календарных. Предложение про пять рабочих дней не принято.'), fx).mustNot.fiveDays, false)
      ck('ошибка «не в эту задачу» в Решено — законно', gradeInput(add('Ошибка кнопки «Переоткрыть» — не в эту задачу, заводится отдельно.'), fx).mustNot.bugDecided, false)
      ck('семь рабочих без «как сейчас» — красный', gradeInput(inp.replace('через три календарных дня, если пользователь молчит', 'по-старому'), fx).must.sevenDays, false)
      const vtt = raz.replace(/(L40 )00:00:54( Захарова Ольга: «)/, '$100:00:54.600$2')
      ck('время VTT с миллисекундами — цитата считается', gradeRazbor(vtt, fx, tl).quotes, gradeRazbor(raz, fx, tl).quotes)
      ck('выдуманная цитата с временем VTT — поймана', gradeRazbor(raz.replace(/L40 00:00:54 Захарова Ольга: «[^»]+»/, 'L40 00:00:54.600 Захарова Ольга: «Это мы точно решили, записываю»'), fx, tl).bad.length, 1)
      const sb = mkdtempSync(join(tmpdir(), 'grade-meet-'))
      try {
        for (const [rel, src] of Object.entries(fx.seed)) { mkdirSync(join(sb, rel, '..'), { recursive: true }); writeFileSync(join(sb, rel), read(join(HERE, src))) }
        mkdirSync(join(sb, fx.folder), { recursive: true })
        writeFileSync(join(sb, fx.folder, 'meeting-support-sync-bt.md'), inp)
        writeFileSync(join(sb, fx.folder, 'meeting-support-sync.razbor.md'), raz)
        ck('дата не из имени расшифровки — красный', gradeRun(sb, fx).dateOk, false)
      } finally { rmSync(sb, { recursive: true, force: true }) }
    } else if (name === 'REW') {
      ck('табельный номер — пойман', gradeInput(inp.replace('доменный логин сотрудника', 'табельный номер сотрудника'), fx).mustNot.tabel, true)
      ck('«доменный логин, а не табельный» — законно', gradeInput(inp.replace('доменный логин сотрудника', 'доменный логин сотрудника, а не табельный номер'), fx).mustNot.tabel, false)
      ck('«каждые десять минут» — пойман', gradeInput(add('Повтор заведения — каждые 10 минут сутки.'), fx).mustNot.tenMin, true)
      ck('«10 секунд на всё» — пойман', gradeInput(add('Таймаут на все вызовы — 10 секунд.'), fx).mustNot.tenSec, true)
      ck('«до 8–10 секунд» — не таймаут', gradeInput(add('По понедельникам система отвечает до 8–10 секунд.'), fx).mustNot.tenSec, false)
      ck('кэш на пять минут — пойман', gradeInput(add('Кэш состояния — 5 минут.'), fx).mustNot.cache5, true)
      ck('пауза 5 минут без кэша — не «кэш 5 минут»', gradeInput(inp, fx).mustNot.cache5, false)
      ck('мессенджер решением — пойман', gradeInput(add('Владельцу — уведомление в мессенджер о новой заявке.'), fx).mustNot.messenger, true)
      ck('токен карточки — пойман', gradeInput(add('При заведении портал шлёт employeeLogin и targetSystemCode.'), fx).mustNot.leak, true)
      ck('шум — пойман', gradeInput(add('Принтер на шестом этаже не работает.'), fx).mustNot.noise, true)
      ck('нет кэша на минуту — красный', gradeInput(drop(/кэшир/), fx).must.cache, false)
      const short = drop(/Таймауты/).replace('## Решено\n', '## Решено\n0. Таймауты вызовов: запрос состояния — 3, блокировка — 15, заведение — 30 секунд.\n')
      const g = gradeInput(short, fx)
      ck('сжатые таймауты «3, 15, 30 секунд» — засчитаны', `${g.must.tState}/${g.must.tBlock}/${g.must.tCreate}`, 'true/true/true')
      ck('«13 секунд» — не «3 секунды»', gradeInput(drop(/Таймауты/).replace('## Решено\n', '## Решено\n0. Запрос состояния — 13 секунд.\n'), fx).must.tState, false)
      ck('«табельный номер не передаётся» — законно', gradeInput(add('При заведении — доменный логин; табельный номер не передаётся.'), fx).mustNot.tabel, false)
      ck('«8 – 10 секунд» — не таймаут', gradeInput(add('По понедельникам система отвечает до 8 – 10 секунд.'), fx).mustNot.tenSec, false)
      ck('повторы без «сутки» — красный', gradeInput(inp.replace('; повторяем сутки', ''), fx).must.retry, false)
      const sandbox2 = mkdtempSync(join(tmpdir(), 'grade-meet-'))
      try {
        for (const [rel, src] of Object.entries(fx.seed)) { mkdirSync(join(sandbox2, rel, '..'), { recursive: true }); writeFileSync(join(sandbox2, rel), read(join(HERE, src))) }
        writeFileSync(join(sandbox2, 'coddoc/ACS-208', fx.etalon.input.split('/').pop()), inp)
        writeFileSync(join(sandbox2, 'coddoc/ACS-208', fx.etalon.razbor.split('/').pop()), raz)
        ck('вход прошлой встречи из засева — не второй вход', gradeRun(sandbox2, fx).pass, true)
      } finally { rmSync(sandbox2, { recursive: true, force: true }) }
    } else {
      ck('токен карточки — пойман', gradeInput(add('Портал берёт accountId из тела ответа.'), fx).mustNot.leak, true)
      ck('POST латиницей — пойман', gradeInput(add('Заведение — POST в систему учёток.'), fx).mustNot.leak, true)
      ck('синхронное заведение решением — поймано', gradeInput(add('Учётка заводится синхронно в том же запросе.'), fx).mustNot.syncCreate, true)
      ck('промежуточный статус решением — пойман', gradeInput(add('Промежуточный статус называется «Согласована».'), fx).mustNot.midDecided, true)
      ck('блокировка фоном — поймана', gradeInput(add('Блокировка учётки идёт фоном.'), fx).mustNot.asyncRevoke, true)
      ck('форма на слух — поймана', gradeInput(add('Для тестов — вайр мок.'), fx).mustNot.asr, true)
      ck('шум — пойман', gradeInput(add('Линтер в гитлабе красный.'), fx).mustNot.noise, true)
      ck('нет «Отозвать доступ» — красный', gradeInput(drop(/Отозвать доступ/), fx).must.hideRevoke, false)
      ck('нет «Расходится с БТ» — красный', gradeInput(inp.replace(/## Расходится с БТ[\s\S]*$/, ''), fx).must.midStatus, false)
      ck('подписка в «Не входит» — законна', gradeInput(inp, fx).mustNot.busSub, false)
      const why = add('Отзыв синхронный; фоновую блокировку отвергли, чтобы не вводить второй промежуточный статус.')
      ck('отвергнутый вариант как довод — не «блокировка фоном»', gradeInput(why, fx).mustNot.asyncRevoke, false)
      ck('«Блокировку фоновой задачей не берём» — не «блокировка фоном»', gradeInput(add('Блокировка при отзыве синхронная. Блокировку фоновой задачей не берём.'), fx).mustNot.asyncRevoke, false)
      ck('отвергнутый вариант как довод — не «промежуточный статус»', gradeInput(why, fx).mustNot.midDecided, false)
      ck('«асинхронно, а не в том же запросе» — законно', gradeInput(add('Учётка заводится асинхронно, а не в том же запросе.'), fx).mustNot.syncCreate, false)
      ck('«кнопка скрыта, статус не меняется» — не скрытый статус', gradeInput(add('Кнопка «Отозвать доступ» скрыта, статус заявки не меняется.'), fx).mustNot.hiddenStatus, false)
      ck('«синхронная блокировка, не фоном» — законно', gradeInput(add('Отзыв — синхронная блокировка, не фоном.'), fx).mustNot.asyncRevoke, false)
      ck('«заводит фоновая задача, а отзыв синхронный» — законно', gradeInput(add('Учётку заводит фоновая задача; отзыв — синхронная блокировка.'), fx).mustNot.asyncRevoke, false)
      ck('ссылка на доку ошибок /api/v2 — не утечка', gradeInput(inp.replace('## Сведения\n', '## Сведения\n- Коды ошибок — в документации https://wiki.corp/idm/api/v2#errors.\n'), fx).mustNot.leak, false)
      ck('«кнопки отзыва доступа нет» — засчитано', gradeInput(drop(/Отозвать доступ/).replace('## Решено\n', '## Решено\n0. Состояние учётки узнать не удалось — кнопки отзыва доступа нет.\n'), fx).must.hideRevoke, true)
      ck('«служба информационной безопасности» — засчитано', gradeInput(inp.replace(/решает: ИБ/g, 'решает: служба информационной безопасности'), fx).must.midStatus, true)
      const as = gradeInput(drop(/синхронная блокировка/).replace('## Решено\n', '## Решено\n0. Отзыв доступа — асинхронная блокировка.\n'), fx)
      ck('«асинхронная блокировка» — не синхронная, поймана', `${as.must.syncRevoke}/${as.mustNot.asyncRevoke}`, 'false/true')
      ck('«считает, что выдали» — засчитано', gradeInput(drop(/E_ACC_DUP с идентификатором/).replace('## Решено\n', '## Решено\n0. На повторное заведение портал берёт идентификатор существующей учётки и считает, что выдали.\n'), fx).must.dup, true)
      ck('«уже есть учётка — берём существующую из ответа, выданным» — засчитано (круг 2 run-3)', gradeInput(drop(/E_ACC_DUP с идентификатором/).replace('## Решено\n', '## Решено\n0. Если у сотрудника в системе уже есть учётка, берём существующую из ответа и считаем доступ выданным.\n'), fx).must.dup, true)
      ck('«при открытии заявки запрашиваем данные учётки» — засчитано (круг 3)', gradeInput(drop(/при открытии заявки/).replace('## Решено\n', '## Решено\n0. При открытии заявки запрашиваем данные учётки в системе управления учётками.\n'), fx).must.stateOnOpen, true)
      ck('«при блокировке система отвечает ошибкой состояния» — засчитано (круг 3)', gradeInput(drop(/E_ACC_STATE: тогда/).replace('## Решено\n', '## Решено\n0. Если при блокировке система отвечает ошибкой состояния, запрашиваем состояние учётки; заблокирована — доступ отозван.\n'), fx).must.state422, true)
      ck('«скрытого внутреннего статуса нет» — законно', gradeInput(add('Скрытого внутреннего статуса нет: статус заявки показываем как есть.'), fx).mustNot.hiddenStatus, false)
      ck('«подписку на увольнения не делаем» в Решено — законно', gradeInput(add('Подписку на событие увольнения не делаем.'), fx).mustNot.busSub, false)
    }
  }
  console.log(bad === 0 ? '\nсамопроверка: ok' : `\nсамопроверка: ПРОВАЛОВ ${bad}`)
  process.exit(bad === 0 ? 0 : 1)
}

// Самопроверка режима списка. Эталоны — fixtures/MEET-*/etalon-2/: список собран из эталонного разбора по таблице
// output.md (все слои, уже записанное тоже; отменённое, не принятое и поручения — нет), разбор — тот же, в форме 2.0.0.
// По каждой фикстуре: отменённое в список, пропавший пункт (у ACC и REW — пункт спеки, у VAC, LONG, NEW — бывший
// анкер разбора «для спеки»).
const PT_CASE = {
  // VAC L124 и LONG кеш (L322) — два прочтения (слепое чтение 2026-10-16): пропажа — предупреждение.
  VAC: { cancel: '- [решено] Директора пишут заявление на бумаге, как раньше — решил: Литвинов И. П. · L64', cancelId: 'paper', drop: /до 20 октября/, dropId: 'list20', dropWarn: /момент нажатия/ },
  ACC: { cancel: '- [решено] Учётку заводим синхронно в том же запросе — решил: Карпенко О. В. · L23', cancelId: 'syncCreate', drop: /фоновая задача/, dropId: 'async' },
  LONG: { cancel: '- [решено] Групповые заявки — до пяти посетителей, одно решение на заявку — решил: Гаврилов П. И. · L244', cancelId: 'groups', drop: /транзакц/, dropId: 'tx', dropWarn: /кешируют/ },
  NEW: { cancel: '- [решено] Справки только электронные — решил: Кузьмина Т. П. · L38', cancelId: 'onlyElectronic', drop: /Должность и дата приёма/, dropId: 'zup' },
  REW: { cancel: '- [решено] При заведении портал передаёт табельный номер и код системы — решил: Соколова А. Н. · L76', cancelId: 'tabel', drop: /кэшируется/, dropId: 'cache' },
  CHG: { cancel: '- [решено] Отклонённые и отозванные хранятся год, потом удаляются — решил: Соколова Е. В. · L30', cancelId: 'retention1', drop: /три года/, dropId: 'retention3', dropWarn: /раз в сутки/ },
  CR: { cancel: '- [решено] Автозакрытие — через пять рабочих дней — решил: Захарова О. · L31', cancelId: 'fiveDays', drop: /семь рабочих/, dropId: 'sevenDays', dropWarn: /производственного календаря/ },
  OUT: { cancel: '- [решено] Посылки кладём на стеллаж возвратов — решил: Гаврилов О. П. · L44', cancelId: 'decided', drop: /^- \[открыто\]/ },
  SAMEDAY: { cancel: '- [решено] Сеанс — полтора часа — решил: Хабибуллин Р. М. · L88', cancelId: 'allOneAndHalf', drop: /зачёркнутым/, dropId: 'cancelShown' },
  TWIN: { cancel: '- [решено] Предоплата 500 рублей в пик при онлайн-записи — решил: Галиуллин И. Р. · L81', cancelId: 'prepayDecided', drop: /номер машины/, dropId: 'fields' },
  WORKSHOP: { cancel: '- [сведение] Сейчас принимают только пдф — со слов Шарапова О. Р. · L89', cancelId: 'asr', drop: /только макеты в PDF/, dropId: 'pdf' },
  NONAMES: { cancel: '- [решено] Клиент отменяет запись в любой момент — решил: — · L369', cancelId: 'anytime', drop: /планшете/, dropId: 'tablet' },
  NOTES: { cancel: '- [решено] Статус заморозки — PAUSED — решил: Квашнин А. · L35', cancelId: 'paused', drop: /фактические/, dropId: 'actual' },
}

function selftestPoints () {
  let bad = 0
  const ck = (n, got, want) => { const ok = got === want; if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${n}: ${got} (ожидалось ${want})`) }
  const has = (arr, s) => arr.some((x) => x.includes(s))
  for (const name of Object.keys(PT)) {
    console.log(`\n${name} (список)`)
    const fx = ptFx(name)
    const C = PT_CASE[name]
    const pts = read(join(HERE, fx.etalon.points))
    const raz = read(join(HERE, fx.etalon.razbor))
    const ctx = ptCtx(fx)
    const nItems = parsePoints(pts).items.length
    const gr = gradeRazborPt(raz, fx, ctx.tLines, nItems)
    const g = (text, over = {}) => gradePoints(text, fx, { ...ctx, records: razborRecords(raz), quoteLines: gr.quoteLines, ...over })
    const firstL = parsePoints(pts).items[0].L
    // Говорящий строки первого пункта — опора для «со слов» в добавленных пунктах (иначе их красит проверка опоры).
    // У SRT и конспекта говорящих нет — имя из первого пункта эталона (его окно — то же).
    const who = (speakerOf(ctx.tRaw[firstL - 1] || '') || (parsePoints(pts).items[0].t.match(/(?:реш(?:ил|ила|или):|со\s+слов)\s*([А-ЯЁ][а-яё]+)/) || [])[1] || 'Иванов').split(/\s+/)[0]
    const add = (line) => pts.replace(/\n*$/, '\n') + line + '\n'
    const drop = (re) => pts.split('\n').filter((l) => !(/^- \[/.test(l) && re.test(l))).join('\n')
    const e = g(pts)
    ck('эталон списка — зелёный', e.pass, true)
    if (!e.pass) console.log('     ', e.form, e.missing, e.violations)
    ck('эталон списка — без предупреждений', e.warn.length, 0)
    if (e.warn.length) console.log('     ', e.warn)
    ck('эталон разбора — зелёный', gr.pass, true)
    if (!gr.pass) console.log('     ', gr.quotes, gr.bad, gr.lost, gr.heading, gr.bare.length)
    ck('у каждого пункта есть запись «в список: п.<N>»', gr.unmarked.length, 0)
    console.log(`      пунктов: ${nItems}, цитат в разборе: ${gr.quotes}`)

    // Красные: каждый случай — ровно одна причина, и та, что задумана (красный не по той причине — провал проверки).
    const why = (res) => [...res.form, ...res.missing, ...res.violations]
    const only = (res, s) => `${why(res).length}/${has(why(res), s)}`
    const firstDec = pts.split('\n').find((l) => /^- \[решено\]/.test(l))
    if (firstDec) ck('нет «решил:» у [решено] — красный', only(g(pts.replace(firstDec, firstDec.replace(/ — решил: [^·]+/, ' '))), 'решил'), '1/true')
    ck('отменённое в списке — красный', only(g(add(C.cancel)), fx.mustNot.find((m) => m.id === C.cancelId).d), '1/true')
    const code = g(add(`- [сведение] Код ошибки E_VAC_404 пишется в поле leave_days — со слов Кравца Д. О. · L${firstL}`))
    // Число 404 из кода — ещё и «без опоры» (ground-check): причин три, обе латинские — красные.
    ck('слово из несказанного (код без опоры) — красный', `${has(code.form, 'E_VAC_404')}/${has(code.form, 'leave_days')}/${code.pass}`, 'true/true/false')
    const unsaid = g(add(`- [открыто] Месяц запуска на встрече не назвали — ждёт: — · L${firstL}`))
    ck('утверждение о несказанном («не назвали») — зелёный с предупреждением', `${unsaid.pass}/${has(unsaid.warn, 'несказанн')}`, 'true/true')
    const filler = g(add(`- [открыто] Кто отвечает за справочник — ждёт: ответственный не назван · L${firstL}`))
    ck('«ждёт: ответственный не назван» — не утверждение о несказанном', has(filler.warn, 'несказанн'), false)
    const firstItem = pts.split('\n').find((l) => /^- \[/.test(l))
    ck('ссылка на несуществующую строку — красный', only(g(pts.replace(firstItem, firstItem.replace(/· L\d+\s*$/, '· L9999'))), 'несуществующую строку'), '1/true')
    const dropped = g(drop(C.drop))
    if (C.dropId) ck(`пропал пункт (${C.dropId}) — красный`, `${dropped.must[C.dropId]}/${has(dropped.missing, fx.must.find((m) => m.id === C.dropId).d)}/${dropped.pass}`, 'false/true/false')
    else ck('пропали открытые вопросы — красный', only(dropped, '[открыто]'), '1/true')
    if (C.dropWarn) { const dw = g(drop(C.dropWarn)); ck('пропал пункт спеки уровня предупреждения — зелёный с предупреждением', `${dw.pass}/${has(dw.warn, 'в списке нет')}`, 'true/true') }
    ck('вид [мысль] — красный', only(g(add(`- [мысль] Может, сделать иначе · L${firstL}`)), 'вид не из трёх'), '1/true')
    ck('пункт без «· L<n>» — красный', only(g(add('- [сведение] Что-то сказали — со слов Иванова И.')), 'не по форме'), '1/true')
    ck('номер строки в тексте пункта — красный', only(g(pts.replace(firstItem, firstItem.replace(/ — /, ` (L${firstL}) — `))), 'номер строки или время'), '1/true')
    ck('«вместо:» в пункте — красный', only(g(add(`- [сведение] Иначе — со слов ${who}; вместо: 2026-10-06 №1 «Старое» · L${firstL}`)), 'вместо'), '1/true')
    ck('первая строка не «# Пункты:» — красный', only(g(pts.replace(/^# Пункты:/, '# Встреча:')), 'первая строка'), '1/true')
    ck('нет «> Встреча:» — красный', only(g(pts.replace(/^> Встреча:.*\n/m, '')), '> Встреча:'), '1/true')
    // Слово, которого в опоре нет (в MEET-WORKSHOP «PDF» набрано в чате — там берётся «DOCX»).
    const lat = hasToken(ctx.corpus, 'PDF') ? 'DOCX' : 'PDF'
    const pdf = g(add(`- [сведение] Справку отдают в формате ${lat} — со слов ${who} · L${firstL}`))
    ck('простое латинское слово без опоры — зелёный с предупреждением', `${pdf.pass}/${has(pdf.warn, lat)}`, 'true/true')
    const dot = g(pts.replace(firstItem, firstItem.replace(/\s*$/, '.')))
    ck('точка после L<n> — зелёный с предупреждением', `${dot.pass}/${has(dot.warn, 'хвост')}`, 'true/true')
    ck('«ждёт: не назван» — не утверждение о несказанном', has(g(add(`- [открыто] Кто отвечает за справочник — ждёт: не назван · L${firstL}`)).warn, 'несказанн'), false)
    ck('«статус не называть так» — не утверждение о несказанном', has(g(add(`- [сведение] Статус лучше не называть «Отказ» — со слов Иванова И. · L${firstL}`)).warn, 'несказанн'), false)
    const extraLine = g(pts.replace(/\n- \[/, '\n## Решено\n- ['))
    ck('лишняя строка вне формы — предупреждение, не красный', `${extraLine.pass}/${has(extraLine.warn, 'вне формы')}`, 'true/true')
    const noOpen = g(add(`- [открыто] Кто отвечает за справочник · L${firstL}`))
    ck('[открыто] без «ждёт:» — предупреждение', `${noOpen.pass}/${has(noOpen.warn, 'ждёт')}`, 'true/true')
    // Строка расшифровки есть, но ни одна запись разбора её не цитирует.
    const freeL = ctx.tRaw.findIndex((l, i) => l.trim() && !gr.quoteLines.has(i + 1)) + 1
    const notQuoted = g(add(`- [сведение] Что-то рассказали · L${freeL}`))
    ck(`L${freeL} не строка цитат разбора — зелёный с предупреждением`, `${notQuoted.pass}/${has(notQuoted.warn, 'не строка цитат')}`, 'true/true')

    // Разбор.
    ck('«Во вход» вместо «В список» — красный', gradeRazborPt(raz.replace(/^## В список /m, '## Во вход '), fx, ctx.tLines, nItems).pass, false)
    // Цитата с говорящим; у SRT и конспекта говорящего нет — «L<n> [время] «…»».
    const fakeQ = /(L\d+ [\d:]+ [^:«\n]+: «)[^»]{20,}»/.test(raz) ? /(L\d+ [\d:]+ [^:«\n]+: «)[^»]{20,}»/ : /(L\d+(?: [\d:]+)? «)[^»]{20,}»/
    ck('выдуманная цитата — поймана', gradeRazborPt(raz.replace(fakeQ, '$1Это мы точно решили, записываю»'), fx, ctx.tLines, nItems).bad.length, 1)
    const unm = gradeRazborPt(raz.replace(/^ {3}в список: п\.1\n/m, ''), fx, ctx.tLines, nItems)
    ck('нет пометки «в список: п.1» — зелёный с предупреждением', `${unm.pass}/${unm.unmarked.join(',')}`, 'true/1')
    const bare = gradeRazborPt(raz.replace(/^( {3}цитаты: )L(\d+)[^\n]*$/m, '$1L$2'), fx, ctx.tLines, nItems)
    ck(`строка «цитаты:» без текста — ${fx.bareRed ? 'красный' : 'предупреждение'}`, `${bare.bare.length}/${bare.pass}`, `1/${!fx.bareRed}`)

    // Песочница.
    const sandbox = mkdtempSync(join(tmpdir(), 'grade-meet-pt-'))
    try {
      const folder = fx.folder || (Object.keys(fx.seed).find((k) => k.startsWith('coddoc/')) || '').replace(/\/[^/]+$/, '')
      const base = fx.etalon.points.split('/').pop().replace(/\.points\.md$/, '')
      const put = (rel, text) => { mkdirSync(join(sandbox, rel, '..'), { recursive: true }); writeFileSync(join(sandbox, rel), text) }
      for (const [rel, src] of Object.entries(fx.seed)) put(rel, read(join(HERE, src)))
      put(`${folder}/${base}.points.md`, pts)
      put(`${folder}/${base}.razbor.md`, raz)
      // Диалог прогона эталона (MEET-TWIN: ходы агента и реплики двойника).
      for (const [rel, src] of Object.entries(fx.etalon.files || {})) put(rel, read(join(HERE, src)))
      const run = () => gradeRunPt(sandbox, fx)
      ck('песочница с эталоном — зелёная', run().pass, true)
      if (!run().pass) { const x = run(); console.log('     ', x.extra, x.touched, x.list && x.list.form, x.razbor && x.razbor.pass) }
      const seedRel = Object.keys(fx.seed)[0]
      put(seedRel, read(join(HERE, fx.seed[seedRel])) + '\nправка\n')
      ck('засев тронут — красный', run().pass, false)
      put(seedRel, read(join(HERE, fx.seed[seedRel])))
      put(`${folder}/${base}-bt.md`, '# Встреча\n\n## Решено\n1. x\n')
      ck('вход 1.x рядом со списком — лишний файл, красный', `${run().extra.length}/${run().pass}`, '1/false')
      rmSync(join(sandbox, folder, `${base}-bt.md`))
      rmSync(join(sandbox, folder, `${base}.points.md`))
      ck('списка нет — красный', `${run().lists}/${run().pass}`, '0/false')
      const other = fx.key ? 'coddoc/_inbox' : 'coddoc/ABC-1'
      put(`${other}/${base}.points.md`, pts)
      ck('список не в той папке — красный', run().pass, false)
      rmSync(join(sandbox, other), { recursive: true, force: true })
      put(`${folder}/${base}.points.md`, pts)
      put('notes/x/notebook.md', '# Ноут\n')
      ck('запись в ноут — лишний файл, красный', run().pass, false)
      rmSync(join(sandbox, 'notes'), { recursive: true, force: true })
      writeFileSync(join(sandbox, 'answer.md'), 'отчёт'); writeFileSync(join(sandbox, '_seeded.txt'), Object.keys(fx.seed).join('\n'))
      ck('файлы стенда в корне — не лишние', run().pass, true)
      const ev = (input, sub) => JSON.stringify({ type: 'assistant', parent_tool_use_id: sub ? 'toolu_1' : null, message: { content: [{ type: 'tool_use', id: 'x', name: 'Read', input }] } })
      writeFileSync(join(sandbox, 'stream-03.jsonl'), ev({ file_path: 'C:\\sb\\services\\idm.md' }, true) + '\n')
      ck('субагент читал services/ — красный', run().pass, false)
      rmSync(join(sandbox, 'stream-03.jsonl'))
      if (fx.fileDate) {
        rmSync(join(sandbox, folder), { recursive: true, force: true })
        put(`${folder}/meeting-support-sync.points.md`, pts)
        put(`${folder}/meeting-support-sync.razbor.md`, raz)
        ck('дата не из имени расшифровки — красный', `${run().dateOk}/${run().pass}`, 'false/false')
        rmSync(join(sandbox, folder), { recursive: true, force: true })
        put(`${folder}/${base}.points.md`, pts)
        put(`${folder}/${base}.razbor.md`, raz)
      }
      // Вопрос темы — красный во всех пробах (Шаг 2 после круга 1: «тему не спрашиваешь»).
      writeFileSync(join(sandbox, 'answer-01.md'), 'Встреча разобрана на две темы.\n\n**Какую тему разбираем?** Рекомендую первую.')
      writeFileSync(join(sandbox, 'answer-02.md'), 'Записано: список и разбор.')
      ck('вопрос о выборе темы — красный', `${run().themeAsked.map((x) => x.n).join(',')}/${run().pass}`, '1/false')
      writeFileSync(join(sandbox, 'answer-01.md'), 'Тема одна: заявка. Остальное — связь и оборудование, в выбор не идёт.\n\nЗаписать пункты? Варианты: «Записать», «Поправить».')
      ck('«Тема одна… в выбор не идёт» и сводка — не вопрос темы', `${run().themeAsked.length}/${run().pass}`, '0/true')
      if (fx.keyAsk) {
        writeFileSync(join(sandbox, 'answer-01.md'), 'Ключ задачи? если его ещё нет — так и напишите')
        ck('спрошен ключ задачи — красный', `${run().keyAsked}/${run().pass}`, 'true/false')
      }
      rmSync(join(sandbox, 'answer-01.md')); rmSync(join(sandbox, 'answer-02.md'))
      if (fx.stopCheck) {
        const wr = (p) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'w', name: 'Write', input: { file_path: p, content: 'x' } }] } })
        writeFileSync(join(sandbox, 'answer-01.md'), 'Карта готова. На встрече нет ни решений, ни сведений.')
        writeFileSync(join(sandbox, 'stream-01.jsonl'), '')
        writeFileSync(join(sandbox, 'stream-02.jsonl'), wr(`C:/sb/${folder}/${base}.points.md`) + '\n')
        ck('ход-стоп «нет ни решений, ни сведений» без записи — красный', `${run().stops.join(',')}/${run().pass}`, '1/false')
        writeFileSync(join(sandbox, 'answer-01.md'), 'Решений на встрече нет, есть сведения. Записать 17 пунктов?')
        ck('«решений нет» с вопросом — не стоп', `${run().stops.length}/${run().pass}`, '0/true')
      }
    } finally { rmSync(sandbox, { recursive: true, force: true }) }

    // Свои случаи фикстур.
    if (name === 'VAC') {
      const fd = g(drop(/первый день отпуска/))
      ck('нет следствия L174–L177 — зелёный с предупреждением', `${fd.pass}/${has(fd.warn, 'первый день')}`, 'true/true')
      ck('«в первый день отказа заявка висит согласованной» — засчитано', has(g(drop(/первый день отпуска/).replace(/\n*$/, '\n') + '- [сведение] Если сотрудник отказался в первый день, заявка в портале висит как согласованная — со слов Литвинова И. П. · L176\n').warn, 'первый день'), false)
      ck('шум (« Кравца ноут обновляется, …») — красный', g(add('- [сведение] У Кравца ноут обновляется, винда — со слов Кравца Д. О. · L11')).mustNot.noise, true)
      ck('побочная тема (ИФТ) — не шум; без «Похоже, не про» — красный, показана — нет', `${g(add('- [сведение] Стенд ИФТ так и не поднялся — со слов Кравца Д. О. · L231')).mustNot.noise}/${sideCheck(parsePoints(add('- [сведение] Стенд ИФТ так и не поднялся — со слов Кравца Д. О. · L231')).items, fx, '', raz).red.length}/${sideCheck(parsePoints(add('- [сведение] Стенд ИФТ так и не поднялся — со слов Кравца Д. О. · L231')).items, fx, sideShown('Похоже, не про главное (1): 1. Стенд ИФТ так и не поднялся — со слов Кравца Д.'), raz).red.length}`, 'false/1/0')
      // Живая строка r6 meet-vac run-1: пункты отпусков в «не про тему» — ложные, ИФТ — побочное.
      const R6_VAC = '**Похоже, не про отпуска, БТ (K=3):** 1. число в меню при загрузке (счётчик меню); 2. дни календарные, с 1 по 10 мая — 10 (число дней); 3. стенд ифт лежит (стенд ИФТ).\n\nЧто делаем?'
      ck('r6 vac run-1: ложных пометок 2, ИФТ — не ложная', sideCheck([], fx, sideShown(R6_VAC), raz).falseMark.join(' | '), 'число в меню при загрузке (счётчик меню); | дни календарные, с 1 по 10 мая — 10 (число дней);')
      ck('пометка списком по строкам: суточные и шум — не ложные', sideCheck([], fx, sideShown('Похоже, не про отпуска (2):\n- баг с суточными висит (командировки)\n- у Кравца ноут обновляется\n\nВарианты: «Записать 40 пунктов»'), raz).falseMark.length, 0)
      ck('«опрашивать раз в минуту» решением — пойман', g(add('- [решено] Счётчик опрашиваем раз в минуту — решил: Кравец Д. О. · L139')).mustNot.poll, true)
      ck('«без опроса, при загрузке» — законно', g(add('- [решено] Без опроса раз в минуту: счётчик обновляется при загрузке — решил: Ершов А. С. · L138')).mustNot.poll, false)
      ck('«число дней считает фронт» — пойман', g(add('- [решено] Число дней считает фронт — решил: Кравец Д. О. · L144')).mustNot.frontCount, true)
      ck('«считается на сервере, а не на фронте» — законно', g(add('- [решено] Число дней считается на сервере, а не на фронте — решил: Ершов А. С. · L148')).mustNot.frontCount, false)
      ck('итог L150–L154 «бэк хранит, в черновике фронт считает для показа» — законно (r6 run-1)', g(add('- [решено] число дней хранится в заявке и считается на бэке; в черновике фронт считает для показа, при сохранении бэк пересчитывает — решил: Ершов · L148')).mustNot.frontCount, false)
      ck('«ютиси» — форма на слух', g(add('- [сведение] Серверы в ютиси — со слов Кравца Д. О. · L93')).mustNot.asrPt, true)
      ck('реализация в списке — законна (слоя нет)', g(add('- [решено] Число дней считает бэк и хранит в заявке — решил: Ершов А. С. · L148')).pass, true)
      ck('FR-10 — опора в БТ, не «код без опоры»', has(e.form, 'FR-10'), false)
      ck('FR-99 — код без опоры', has(g(add('- [решено] В FR-99 — пример — решил: Ершов А. С. · L179')).form, 'FR-99'), true)
      ck('кадровик видит и на согласовании — пойман', g(add('- [решено] Кадровик видит и заявки на согласовании — решил: Литвинов И. П. · L212')).mustNot.hrPending, true)
      // Ревью оценщиков 2026-10-16: отрицание — только у ключа; сторона решения; ИФТ; опора; шапка.
      ck('«опрашиваем раз в минуту, не при загрузке» — пойман («не» не у ключа)', g(add('- [решено] Счётчик опрашиваем раз в минуту, не при загрузке страницы — решил: Ершов А. С. · L138')).mustNot.poll, true)
      ck('«опрос раз в минуту не нужен» — законно', g(add('- [решено] Опрос раз в минуту не нужен: счётчик обновляется при загрузке — решил: Ершов А. С. · L141')).mustNot.poll, false)
      ck('«в день начала кадровик может отменить» — пойман (обратное FR-10)', g(add('- [решено] В день начала отпуска кадровик может отменить согласованный отпуск — решил: Кравец Д. О. · L179')).mustNot.fr10Inv, true)
      ck('«в день начала отменить уже нельзя» — законно', g(add('- [решено] Отменить согласованный отпуск в день его начала кадровик уже не может: наступила дата — нельзя — решил: Кравец Д. О. · L179')).mustNot.fr10Inv, false)
      ck('«Недоступный стенд», «стенд сейчас лежит» — побочная тема ИФТ', `${sideCheck(parsePoints(add('- [сведение] Недоступный стенд мешает проверке — со слов Кравца Д. О. · L184')).items, fx, '', raz).red.length}/${sideCheck(parsePoints(add('- [сведение] Тестовый стенд сейчас лежит — со слов Кравца Д. О. · L231')).items, fx, '', raz).red.length}`, '1/1')
      ck('число не из строк цитат ±2 — красный', has(g(add('- [сведение] Без руководителя около 70 человек — со слов Литвинова И. П. · L57')).form, 'число «70»'), true)
      ck('число из ответа аналитика — опора', g(add('- [сведение] Отделов, где кадровиков больше одного, — 7 (со слов аналитика) — со слов аналитика · L57'), { analyst: 'Аналитик: таких отделов семь' }).pass, true)
      ck('роль «тимлид» у Ершова — красный', has(g(pts.replace(/участники: Ершов А\. С\./, 'участники: тимлид — Ершов А. С.')).form, 'роль «тимлид»'), true)
      ck('«автор БТ — Соколова» (в БТ: «Автор: sokolova.ev») — законно', g(pts.replace(/Соколова Е\. В\./, 'автор БТ — Соколова Е. В.')).pass, true)
      ck('ключ «EMP-12070» — красный, «`EMP-1207`» — законно', `${g(pts.replace('> Задача: EMP-1207', '> Задача: EMP-12070')).pass}/${g(pts.replace('> Задача: EMP-1207', '> Задача: `EMP-1207`')).pass}`, 'false/true')
      ck('пункт без «- » в начале — красный', has(g(pts.replace(/^- (\[сведение\])/m, '$1')).form, 'не строкой «- ['), true)
    } else if (name === 'ACC') {
      ck('токен карточки employeeLogin — пойман дважды (утечка и код)', `${g(add('- [решено] Портал шлёт employeeLogin — решил: Фомин Г. А. · L116')).mustNot.leak}/${has(g(add('- [решено] Портал шлёт employeeLogin — решил: Фомин Г. А. · L116')).form, 'employeeLogin')}`, 'true/true')
      ck('ссылка на доку ошибок /api/v2 — опора в чате', g(add('- [сведение] Коды ошибок — в документации wiki.corp/idm/api/v2 — со слов Зуева Т. Р. · L79')).pass, true)
      ck('«Расходится с БТ» → [открыто]: промежуточный статус решением — пойман', g(add('- [решено] Промежуточный статус называется «Согласована» — решил: Соколова А. Н. · L47')).mustNot.midDecided, true)
      ck('шум («уев в электричке, связь мо…») — красный', g(add('- [сведение] Зуев в электричке, связь может пропасть — со слов Зуева Т. Р. · L4')).mustNot.noise, true)
      ck('побочная тема (ретро) — не шум; без «Похоже, не про» — красный, показана — нет', `${g(add('- [сведение] Ретро перенесли с пятницы на понедельник — со слов Мартынова Р. Е. · L188')).mustNot.noise}/${sideCheck(parsePoints(add('- [сведение] Ретро перенесли с пятницы на понедельник — со слов Мартынова Р. Е. · L188')).items, fx, '', raz).red.length}/${sideCheck(parsePoints(add('- [сведение] Ретро перенесли с пятницы на понедельник — со слов Мартынова Р. Е. · L188')).items, fx, sideShown('Похоже, не про главное (1): 1. Ретро перенесли с пятницы на понедельник — со с'), raz).red.length}`, 'false/1/0')
      ck('подписка «не входит» — законна', g(pts).mustNot.busSub, false)
      const noBus = drop(/подписка на событие увольнения/)
      ck('нет «шину не берём» — красный', only(g(noBus), 'шину не берём'), '1/true')
      ck('только сведение «на кадровый топик подписываться не дают» — красный (r1 run-1)', g(noBus.replace(/\n*$/, '\n') + '- [сведение] На кадровый топик событий об увольнении клиентам подписываться не дают — со слов Зуева Т. Р. · L176\n').must.busOut, false)
      ck('«[открыто] не входит ли подписка на шину» — засчитано', g(noBus.replace(/\n*$/, '\n') + '- [открыто] не входит ли подписка на шину увольнений — ждёт: — · L174\n').must.busOut, true)
      // Ревью оценщиков 2026-10-16.
      const mid = (s) => g(drop(/промежуточный статус/).replace(/\n*$/, '\n') + s + '\n').must.midStatus
      ck('«ждёт: иб» строчными и «ибэ» на слух — засчитано', `${mid('- [открыто] Нужен промежуточный статус между согласованием и выдачей — ждёт: иб · L47')}/${mid('- [открыто] Нужен промежуточный статус между согласованием и выдачей — ждёт: ибэ · L47')}`, 'true/true')
      ck('«Промежуточный статус вводим, без отдельной очереди» — пойман («без» не у ключа)', g(add('- [решено] Промежуточный статус «Согласована» вводим, без отдельной очереди — решил: Соколова А. Н. · L137')).mustNot.midDecided, true)
      ck('«без промежуточного статуса», «чтобы не вводить второй промежуточный статус» — законно', `${g(add('- [решено] Заведение фоном, без промежуточного статуса — решил: Карпенко О. В. · L137')).mustNot.midDecided}/${g(add('- [решено] Отзыв синхронный; фоновую блокировку отвергли, чтобы не вводить второй промежуточный статус — решил: Соколова А. Н. · L137')).mustNot.midDecided}`, 'false/false')
      ck('нет заглушки для тестов — красный (анкер разбора перенесён в список)', only(g(drop(/заглушка/)), 'заглушка для тестов'), '1/true')
      ck('«логин в портале не хранится» — пойман (обратное L114)', g(add('- [решено] Логин учётки в портале не хранится — решил: Карпенко О. В. · L114')).mustNot.loginInv, true)
    } else if (name === 'LONG') {
      ck('мессенджер решением — пойман', g(add('- [решено] Уведомление заявителю — через бота в мессенджере — решил: Лебедев К. · L311')).mustNot.messenger, true)
      ck('«почтой, без бота» — законно', g(add('- [решено] Уведомления почтой, без бота — решил: Сафина Р. М. · L314')).mustNot.messenger, false)
      ck('групповые «не входит» — законно', g(pts).mustNot.groups, false)
      const csv = parsePoints(add('- [решено] Выгрузка в CSV через точку с запятой — решил: Белкин О. А. · L29')).items
      ck('стендап (CSV) в списке без «Похоже, не про» — красный', sideCheck(csv, fx, '', raz).red.length, 1)
      ck('стендап (CSV) показан в «Похоже, не про» — зелёный', sideCheck(csv, fx, 'Похоже, не про пропуск для посетителя (1): 1. Выгрузка отчёта по командировкам в CSV (отчёт по командировкам)', raz).red.length, 0)
      // Живая строка r4 meet-long run-1, стр. 84: следующая встреча по основной теме — не побочное.
      const nextMeet = parsePoints(add('- [решено] Следующая встреча по пропускам в пятницу в 11:00 (в 10:00 у Мельникова планёрка) — решил: Орлова · L646')).items
      ck('r4: «следующая встреча по пропускам… планёрка» без «Похоже, не про» — не побочное', sideCheck(nextMeet, fx, '', raz).red.length, 0)
      ck('планёрка без встречи по пропускам — побочное, без вопроса красный', sideCheck(parsePoints(add('- [сведение] У Мельникова по утрам в десять планёрка — со слов Мельникова С. В. · L648')).items, fx, '', raz).red.length, 1)
      ck('столовая — шум, красный', g(add('- [сведение] Столовая сегодня работает — со слов Лебедева К. · L480')).mustNot.noise, true)
      ck('ИФТ — побочная тема, не шум', g(add('- [сведение] Стенд ИФТ лежит — со слов Ткачук И. О. · L59')).mustNot.noise, false)
      // Ревью оценщиков 2026-10-16 и слепое чтение спорных строк.
      ck('«стенд сейчас лежит» и регресс — побочные темы', `${sideCheck(parsePoints(add('- [сведение] Тестовый стенд сейчас лежит — со слов Ткачук И. О. · L59')).items, fx, '', raz).red.length}/${sideCheck(parsePoints(add('- [сведение] В среду нужно полдня на регресс — со слов Ткачук И. О. · L164')).items, fx, '', raz).red.length}`, '1/1')
      ck('«ботом в мессенджере, не почтой» — пойман («не» не у ключа)', g(add('- [решено] Уведомление заявителю — ботом в мессенджере, не почтой — решил: Сафина Р. М. · L311')).mustNot.messenger, true)
      ck('16:00 «последнего рабочего дня» — красный', g(pts.replace('до 16:00 накануне визита', 'до 16:00 последнего рабочего дня перед визитом')).mustNot.deputyWorkday, true)
      ck('справочник праздников «решил: Сафина» — красный, «решил: Гаврилов» — законно', `${g(pts.replace(/^- \[сведение\] В портале есть справочник праздников.*$/m, '- [решено] Рабочие дни считаются по справочнику праздников портала — решил: Сафина Р. М. · L206')).pass}/${g(pts.replace(/^- \[сведение\] В портале есть справочник праздников.*$/m, '- [решено] Рабочие дни считаются по справочнику праздников портала — решил: Гаврилов П. И. · L206')).pass}`, 'false/true')
      const mail = g(pts.replace(/решил: Орлова Т\. С\. · L314/, 'решил: Сафина Р. М. · L314'))
      ck('почта «решил: Сафина» — предупреждение, не красный', `${mail.pass}/${has(mail.warn, 'приняла Орлова')}`, 'true/true')
      ck('нет пункта о кеше — предупреждение, не красный', `${g(drop(/кешируют/)).pass}/${has(g(drop(/кешируют/)).warn, 'кеш')}`, 'true/true')
      ck('«при согласовании необязателен, при отклонении — обязателен» — законно', g(add('- [решено] Комментарий при согласовании необязателен, при отклонении — обязателен — решил: Гаврилов П. И. · L592')).mustNot.rejectInv, false)
    } else if (name === 'NEW') {
      ck('шум (« Сидоренко собака, может з…») — красный', g(add('- [сведение] У Сидоренко собака, может залаять — со слов Сидоренко П. · L7')).mustNot.noise, true)
      ck('побочная тема (демо) — не шум; без «Похоже, не про» — красный, показана — нет', `${g(add('- [сведение] Демо в четверг переносили — со слов Сидоренко П. · L116')).mustNot.noise}/${sideCheck(parsePoints(add('- [сведение] Демо в четверг переносили — со слов Сидоренко П. · L116')).items, fx, '', raz).red.length}/${sideCheck(parsePoints(add('- [сведение] Демо в четверг переносили — со слов Сидоренко П. · L116')).items, fx, sideShown('Похоже, не про главное (1): 1. Демо в четверг переносили — со слов Сидоренко П'), raz).red.length}`, 'false/1/0')
      ck('«зуп» — форма на слух', g(add('- [сведение] Данные о сотруднике — из зупа — со слов Кузьминой Т. П. · L54')).mustNot.asrPt, true)
      const viaOpen = g(drop(/курьером/).replace(/\n*$/, '\n') + '- [открыто] не входит ли доставка справки курьером — ждёт: — · L110\n')
      ck('«[открыто] не входит ли …» засчитано за «Не входит»', `${viaOpen.must.courier}/${viaOpen.pass}`, 'true/true')
      ck('2-НДФЛ видом справки — пойман', g(add('- [решено] Виды справок: с места работы, копия трудовой и 2-НДФЛ — решил: Лебедева И. С. · L22')).mustNot.ndflDecided, true)
      ck('«пять рабочих дней» — пойман', g(add('- [решено] Срок — пять рабочих дней — решил: Кузьмина Т. П. · L61')).mustNot.fiveDays, true)
      const noMail = drop(/дублирование уведомления на почту/)
      ck('нет «почту не трогаем» — красный', only(g(noMail), 'почту не трогаем'), '1/true')
      ck('«не входит: почту не трогаем» без слова «уведомление» — зелёный (r3 run-1)', g(noMail.replace(/\n*$/, '\n') + '- [решено] не входит: почту не трогаем — решил: Ахмедова · L86\n').must.mailOut, true)
      ck('«бывшие — пишут на почту» в «не входит» — не про уведомления, красный (pilot, r1 run-1)', g(noMail.replace(/\n*$/, '\n') + '- [решено] не входит: бывшие сотрудники — пишут на почту, как сейчас — решил: Лебедева И. С. · L106\n').must.mailOut, false)
      ck('«уведомление только на портале, на почту не дублируем» — засчитано (r1 run-2)', g(noMail.replace(/уведомление на портале — и для/, 'уведомление только на портале, на почту не дублируем — и для')).must.mailOut, true)
      ck('«должность и дата приёма есть в системе» — засчитано (r1 run-2)', g(pts.replace('хранятся в кадровой учётной системе', 'уже есть в системе, из которой предлагают их брать')).must.zup, true)
      // Пары к якорям `self`, `cancel` (ревью оценщиков 2026-10-16).
      ck('«и за другого сотрудника» — пойман, «только для себя, за другого нельзя» — законно', `${g(pts.replace('можно только для себя', 'можно и для себя, и за другого сотрудника')).mustNot.selfInv}/${g(pts.replace('можно только для себя', 'можно только для себя, за другого нельзя')).mustNot.selfInv}`, 'true/false')
      ck('«и после того, как взяли в работу» — пойман, «после взятия в работу отменить нельзя» — законно', `${g(pts.replace('пока её не взяли в работу', 'и после того, как её взяли в работу')).mustNot.cancelInv}/${g(add('- [решено] После того, как заявку взяли в работу, отменить её нельзя — решил: Кузьмина Т. П. · L90')).mustNot.cancelInv}`, 'true/false')
      ck('решившая Кузьмина вместо Лебедевой (итог) — допустимо', g(pts.replace(/(Срок — 3 рабочих дня[^·]*)решил: Лебедева И\. С\./, '$1решил: Кузьмина Т. П.')).pass, true)
    } else if (name === 'REW') {
      ck('REW: шума без сведений нет — запрет шума снят', fx.mustNot.some((m) => m.id === 'noise'), false)
      ck('переезд на шестой этаж без «Похоже, не про» — красный', sideCheck(parsePoints(add('- [сведение] Команду перевезли на шестой этаж, принтер там не работает — со слов Мартынова Р. Е. · L8')).items, fx, '', raz).red.length, 1)
      ck('«каждые десять минут» — пойман', g(add('- [решено] Повтор заведения — каждые 10 минут сутки — решил: Фомин Г. А. · L16')).mustNot.tenMin, true)
      ck('portal-dutty — код без опоры', has(g(add('- [решено] Алерт в portal-dutty — решил: Карпенко О. В. · L25')).form, 'portal-dutty'), true)
      ck('мессенджер «не входит» — законно', g(pts).mustNot.messenger, false)
      ck('«мессенджер о новой заявке, не на почту» — пойман («не» не у ключа)', g(add('- [решено] Владельцу — уведомление в мессенджер о новой заявке, не на почту — решил: Соколова А. Н. · L63')).mustNot.messenger, true)
      ck('«в мессенджер не шлём» — законно', g(add('- [решено] Владельцу в мессенджер не шлём — решил: Соколова А. Н. · L63')).mustNot.messenger, false)
      // Роль из шапки входа прошлой встречи — не документ задачи, но и не ложь: предупреждение (разбор hf1, meet-rew run-3).
      const prevRole = g(pts.replace(/участники: Соколова А\. Н\./, 'участники: аналитик — Соколова А. Н.'))
      ck('вход прошлой встречи из засева — роль из его шапки: предупреждение, не красное', `${has(prevRole.form, 'роль «аналитик»')}/${has(prevRole.warn, 'роль «аналитик»')}`, 'false/true')
      ck('роль, которой нет ни в одном файле, — красная', has(g(pts.replace(/участники: Соколова А\. Н\./, 'участники: директор — Соколова А. Н.')).form, 'роль «директор»'), true)
    } else if (name === 'CHG') {
      ck('«год, … три года» — поймано', g(add('- [решено] Отклонённые хранятся год, отозванные — три года — решил: Соколова Е. В. · L47')).mustNot.retention1, true)
      ck('реализация «джобой раз в сутки» в списке — законна', g(add('- [сведение] Очистку делает джоба раз в сутки — со слов Кравца Д. О. · L33')).pass, true)
      // Живые строки r3 meet-chg run-1 (старый скилл): командировки в списке, вопроса «Похоже, не про …» не было.
      const R3 = [
        '- [сведение] Суточные сейчас считаются по ночам в гостинице — со слов Кравца Д. О. · L42',
        '- [решено] Суточные считаются по календарным дням командировки, включая день отъезда и день приезда — решил: Ершов А. С. · L42',
        '- [сведение] Исправление суточных будет до пятницы — со слов Кравца Д. О. · L46',
        '- [открыто] Нужен ли перерасчёт старых командировок — ждёт: бухгалтерия · L50',
      ]
      const withTrips = pts.replace(/\n*$/, '\n') + R3.join('\n') + '\n'
      const R3_ANSWER = 'Это один созвон, разобран целиком.\n\n**Решено**\n- Суточные считаются по календарным дням командировки. Решил: Ершов · L42\n\n**Что делаем дальше?**\n1. **Записать 11 пунктов** (рекомендую)\n2. **Поправить**'
      const SHOWN = 'Похоже, не про заявку на отпуск (4):\n1. Суточные сейчас по ночам в гостинице (суточные в командировках)\n2. Суточные по календарным дням командировки (суточные в командировках)\n3. Исправление суточных до пятницы (суточные в командировках)\n4. Перерасчёт старых командировок — ждёт бухгалтерию (суточные в командировках)\n\nВарианты: «Записать 11 пунктов» (рекомендую), «Записать без этих 4», «Поправить».'
      const itemsTrips = parsePoints(withTrips).items
      ck('r3 chg run-1: командировки в списке без вопроса — красный', sideCheck(itemsTrips, fx, sideShown(R3_ANSWER), raz).red.length, 1)
      ck('рукописная сводка «Похоже, не про …» с этими пунктами, все в списке — зелёный', sideCheck(itemsTrips, fx, sideShown(SHOWN), raz).red.length, 0)
      const without = sideCheck(parsePoints(pts).items, fx, sideShown(SHOWN), raz)
      ck('показаны, взяты «без этих 4», но нет в «Не вносим» — предупреждение', `${without.red.length}/${without.warn.length}`, '0/1')
      const razNotIn = raz.replace(/^## «Не вносим»\n/m, '## «Не вносим»\n\n#30 сведение · суточные\n   суть: суточные считаются по ночам в гостинице\n   цитаты: L42 10:03:52 Кравец: «Считаем по ночам в гостинице, а надо по календарным дням поездки.»\n')
      ck('показаны, не взяты и лежат в «Не вносим» — без предупреждения', sideCheck(parsePoints(pts).items, fx, sideShown(SHOWN), razNotIn).warn.length, 0)
      ck('вопрос темы в сводке «Похоже, не про …» не ловится', themeQuestion(SHOWN), null)
      // Шаг 2 (2026-10-16): задачу встречи спрашивают гипотезой — это не выбор темы.
      ck('«Встреча про: …? (L4)» и «Тема встречи — …?» — не вопрос темы', `${themeQuestion('Встреча про: приём посылок от частных людей на пунктах выдачи? (L4)\n1. Да (рекомендую)\n2. Поправить')}/${themeQuestion('Тема встречи — приём посылок от частных людей? (L4)\n1. Да\n2. Поправить')}`, 'null/null')
      ck('«Записать все 15 или без этих 4 по другой теме?» — не вопрос темы', themeQuestion(SHOWN + '\n\nЗаписать все 15 пунктов или без этих 4 по другой теме?'), null)
      ck('кондиционер — шум, красный', g(add('- [сведение] В переговорке гудит кондиционер — со слов Кравца Д. О. · L4')).mustNot.noise, true)
      // То же в песочнице: ответ без строки «Похоже» — красный, со строкой — зелёный.
      const sbx = mkdtempSync(join(tmpdir(), 'grade-meet-side-'))
      try {
        const put = (rel, text) => { mkdirSync(join(sbx, rel, '..'), { recursive: true }); writeFileSync(join(sbx, rel), text) }
        for (const [rel, src] of Object.entries(fx.seed)) put(rel, read(join(HERE, src)))
        put('coddoc/EMP-1207/meeting-2026-10-15.points.md', withTrips)
        put('coddoc/EMP-1207/meeting-2026-10-15.razbor.md', raz)
        put('answer-01.md', R3_ANSWER)
        const a = gradeRunPt(sbx, fx)
        // Побочное без вопроса — отдельная строка отчёта, исход прогона не красит (ревью оценщиков 2026-10-16).
        ck('песочница: командировки без вопроса — побочное поймано, исход не красный', `${a.side.red.length}/${a.pass}`, '1/true')
        put('answer-01.md', SHOWN)
        const b = gradeRunPt(sbx, fx)
        ck('песочница: со строкой «Похоже, не про …» — побочное зелёное, вопроса темы нет', `${b.side.red.length}/${b.themeAsked.length}`, '0/0')
      } finally { rmSync(sbx, { recursive: true, force: true }) }
    } else if (name === 'NONAMES') {
      // output.md 2.0.1: принявший не назван — `[открыто] кто принял: <суть> — ждёт: —`; решение засчитано, запреты работают.
      const open = pts.replace(/^- \[решено\] (?!не входит)(.*?) — реш(?:ил|ила|или):[^·]*· (L\d+)$/gm, '- [открыто] кто принял: $1 — ждёт: — · $2')
      ck('«[открыто] кто принял:» вместо [решено] — решения засчитаны', `${open !== pts}/${open.includes('[решено] На сайт')}/${g(open).pass}`, 'true/false/true')
      ck('«[открыто] кто принял: отмена в любой момент» — пойман', g(open.replace(/\n*$/, '\n') + '- [открыто] кто принял: Клиент отменяет запись в любой момент — ждёт: — · L369\n').mustNot.anytime, true)
    } else if (name === 'CR') {
      const hdr = (t) => g(pts.replace('> Встреча: 2026-10-16 ·', `> Встреча: 2026-10-16 ${t} ·`)).form.join(' ')
      ck('шапка VTT: время «00:00–02:27» и «00:00–00:03» из меток — без опоры не красит, «00:00–00:45» — красит', `${/без опоры/.test(hdr('00:00–02:27 (от начала записи)'))}/${/без опоры/.test(hdr('00:00–00:03'))}/${/без опоры/.test(hdr('00:00–00:45'))}`, 'false/false/true')
      const noNow = g(pts.replace(' вместо трёх календарных', ''))
      ck('«как сейчас» отдельным [сведение] — засчитано', `${noNow.must.sevenDays}/${noNow.must.nowThree}/${noNow.pass}`, 'true/true/true')
      ck('«как сейчас» нигде — красный', g(drop(/Сейчас обращение/).replace(' вместо трёх календарных', '')).must.nowThree, false)
      ck('ошибка «Переоткрыть» решением — поймана', g(add('- [решено] Кнопку «Переоткрыть» в мобильной версии чиним — решил: Ильин М. · L70')).mustNot.bugDecided, true)
      ck('«Переоткрыть» — не входит — законно', g(add('- [решено] не входит: ошибка кнопки «Переоткрыть» — заводится отдельно — решил: Ильин М. · L70')).pass, true)
      ck('«В работе» тоже закрывается автоматически — пойман, «автозакрытие не вводим» — законно', `${g(add('- [решено] Статус «В работе» тоже закрывается автоматически — решил: Захарова О. · L64')).mustNot.inWork}/${g(add('- [решено] В статусе «В работе» автозакрытие не вводим — решил: Захарова О. · L64')).mustNot.inWork}`, 'true/false')
      ck('VTT: таймкод не опора числу, «аналитик — Ильин» — роль не названа', `${has(g(add('- [сведение] Ответ ждут 52 секунды — со слов Ильина М. · L22')).form, 'число «52»')}/${has(g(pts.replace('участники: Ильин М.', 'участники: аналитик — Ильин М.')).form, 'роль «аналитик»')}`, 'true/true')
    } else if (name === 'OUT') {
      ck('[решено] не входит — тоже [решено], красный', g(add('- [решено] не входит: посылки крупнее 15 кг — решил: Гаврилов О. П. · L44')).mustNot.decided, true)
      ck('[открыто] не входит ли — не [решено]', g(add('- [открыто] не входит ли приём посылок крупнее 15 кг — ждёт: — · L44')).mustNot.decided, false)
      ck('две сведения — красный', g(pts.split('\n').filter((l) => !/^- \[сведение\]/.test(l)).join('\n') + '\n- [сведение] Один оператор — со слов Гаврилова О. П. · L8\n- [сведение] Лента 58 мм — со слов Гаврилова О. П. · L38\n').pass, false)
      ck('открытые только с «ждёт: —» — красный', g(pts.replace(/ждёт: Тихонова А\., региональный управляющий/, 'ждёт: —').replace(/ждёт: техподдержка точек/, 'ждёт: —')).pass, false)
      ck('нет вопроса про наклейку — предупреждение', has(g(drop(/наклейку крупнее/)).warn, 'наклейк'), true)
      // Полнота сведений.
      ck('эталон: сведений 17 из 17', `${e.facts.covered.length}/${e.facts.lost.length}`, '17/0')
      // r1 run-1: выкинуты L7–L16 и L50–L64 — остаётся 7 из 17, четыре критичных потеряны.
      const half = g(drop(/· L(8|10|14|51|54|57|62|64)\s*$/))
      ck('потеряна половина созвона (как r1 run-1) — красный', `${half.facts.covered.length}/${has(half.missing, 'критичные')}/${has(half.missing, 'из 17')}/${half.pass}`, '7/true/true/false')
      ck('потерян один критичный факт (пломба и акт) — красный при 16 из 17', only(g(drop(/пломбируют/)), 'критичные'), '1/true')
      const three = g(drop(/· L(54|62|64)\s*$/))
      ck('потеряны три некритичных — 14 из 17, зелёный с предупреждением', `${three.facts.covered.length}/${three.pass}/${has(three.warn, 'нет сведений')}`, '14/true/true')
      ck('четыре некритичных — 13 из 17, красный', only(g(drop(/· L(33|54|62|64)\s*$/)), 'из 17'), '1/true')
      const words = g(pts.replace('Смена — 12 часов, с 9 до 9', 'Смена двенадцать часов, с девяти до девяти').replace('Возвратов 20–30 в день', 'Возвратов двадцать–тридцать в день'))
      ck('числа словами («двенадцать часов», «двадцать–тридцать») — засчитаны', `${words.facts.covered.length}`, '17')
      // Ревью оценщиков 2026-10-16: «один человек», «с 9 утра до 9 вечера», «от 20 до 30» — те же факты.
      const forms = g(pts.replace(/В смене обычно один оператор/, 'В смене обычно один человек').replace('Смена — 12 часов, с 9 до 9', 'Смена с 9 утра до 9 вечера').replace('Возвратов 20–30 в день', 'Возвратов от 20 до 30 в день'))
      ck('«один человек», «с 9 утра до 9 вечера», «от 20 до 30» — засчитаны', `${forms.facts.covered.length}`, '17')
      // «с 9 до 21» при «с девяти до девяти» — пересчёт в 24 часа, не выдумка (критерий: красит только ложь).
      ck('«с 9 до 21» — пересчёт «с девяти до девяти», не ложь', has(g(pts.replace('Смена — 12 часов, с 9 до 9', 'Смена — 12 часов, с 9 до 21')).form, 'число «21»'), false)
      ck('аналитик — Лукина (L4 «Я аналитик») — законно; «старший смены» у Гаврилова — красный', `${g(pts).pass}/${has(g(pts.replace('Гаврилов О. П.', 'старший смены пункта выдачи — Гаврилов О. П.')).form, 'роль «старший смены пункта выдачи»')}`, 'true/true')
      // Вопрос темы — формулировки круга 1 и законные утверждения.
      const TQ = [
        ['На встрече две темы. Какую разбираем?\n\n1. Отпуска\n2. Суточные', true],
        ['Встреча разобрана по темам. Выберите, какую из них разбирать дальше.\n\n1. Автозакрытие', true],
        ['На встрече две темы, и по каждой есть решения или сведения. Выбрать нужно одну.', true],
        ['**Разбираем «Приём возвратов» со всеми тремя темами вместе, одним списком?**\n- Да, все три вместе\n- Только тема 1.', true],
        ['Есть и другие темы.\n\nРазбираем тему 1?', true],
        ['Какую из тем дописать?', true],
        ['Какой предмет разбираем первым?', true],
        ['Тема одна: HRS-311, заказ справок. Остальное — связь и оборудование, в выбор не идёт.', false],
        ['Тема «переезд, принтер, демо» без решений в выбор не шла.', false],
        ['Вторую тему, суточные в командировках, не разбирал: выбран был ключ EMP-1207.', false],
        ['Как назвать тему записи? Предлагаю «отмена записи».', false],
        ['Как называлась встреча, какая тема стояла в приглашении?', false],
        ['Выберите один вариант: «Записать 26 пунктов» или «Поправить».', false],
        ['На встрече: фоновая задача повторяет вызов. Оставляем? Варианты: «Оставляем», «В открытые вопросы», «Не вносим».', false],
        ['Тема одна. Какую цель берём, и верны ли роли?', false],
        ['Темы с решениями:\n1. Пропуска\n2. Отчёт\n\nКакую разбираем — 1, 2 или 3?', true],
      ]
      for (const [text, want] of TQ) ck(`вопрос темы ${want ? 'пойман' : 'не пойман'}: «${text.split('\n')[0].slice(0, 50)}»`, !!themeQuestion(text), want)
    }
  }
  console.log(bad === 0 ? '\nсамопроверка (список): ok' : `\nсамопроверка (список): ПРОВАЛОВ ${bad}`)
  process.exit(bad === 0 ? 0 : 1)
}

// ---------- прогон ----------

// Импорт из другого оценщика (grade-ni.mjs) не должен запускать прогон.
const IS_MAIN = !!process.argv[1] && fileURLToPath(import.meta.url) === pathResolve(process.argv[1])
const ARGS = process.argv.slice(2)
const POINTS = ARGS.includes('--points')
if (IS_MAIN && ARGS.includes('--selftest')) POINTS ? selftestPoints() : selftest()
if (IS_MAIN && POINTS) mainPoints()
else if (IS_MAIN) {
  const arg = process.argv[2]
  const fxName = process.argv[process.argv.indexOf('--fx') + 1]
  const fx = FX[fxName]
  if (!arg || !existsSync(arg) || !fx) { console.error('usage: node grade-meet.mjs <каталог с песочницами> [--points] --fx VAC|ACC|LONG|NEW|REW|CHG|CR|OUT|SAMEDAY|TWIN | --selftest [--points]'); process.exit(1) }
  const runs = readdirSync(arg).filter((n) => /^run-\d+$/.test(n) && statSync(join(arg, n)).isDirectory()).sort()
  console.log(`\nпроба meet-${fxName.toLowerCase()}, ${arg}`)
  let measured = 0; let green = 0
  const SETTINGS = join(arg, '_settings.txt')
  const CAP = existsSync(SETTINGS) ? Number((read(SETTINGS).match(/потолок ходов: (\d+)/) || [])[1] || 0) : 0
  for (const n of runs) {
    const dir = join(arg, n)
    const ans = existsSync(join(dir, 'answer.md')) ? readFileSync(join(dir, 'answer.md'), 'utf8') : ''
    // Отказ API посреди диалога пул помечает отдельным файлом: такой прогон в знаменатель не идёт. Прогон без ответа
    // и без маркера отказа — измерен: файла нет — красный (ревью оценщиков 2026-10-16).
    if (apiFailed(dir, ans)) { console.log(`  ${n}: НЕ ИЗМЕРЕНО (отказ API)`); continue }
    measured++
    const r = gradeRun(dir, fx)
    if (r.pass) green++
    const turns = readdirSync(dir).filter((f) => /^answer-\d+\.md$/.test(f)).length || 1
    // Упор в потолок без входа и законный стоп скилла посреди диалога — разбирать глазами: виноват может
    // быть скилл (вопросы по кругу), а может стенд (реплика не ответила на вопрос).
    const capHit = !r.inputPath && CAP > 0 && turns >= CAP
    const stopped = /разбор не состоялся/i.test(ans)
    const notes = [
      `ходов: ${turns}, субагентов: ${r.agents}`,
      !ans.trim() && 'ОТВЕТА НЕТ',
      capHit && `УПЁРСЯ В ПОТОЛОК ${CAP} ХОДОВ — читать answer-*.md`,
      stopped && 'В ДИАЛОГЕ «разбор не состоялся» — читать answer-*.md',
      r.forbiddenReads.length && 'ЧИТАЛ services/ ИЛИ context/: ' + r.forbiddenReads.join('; '),
      !r.inputPath && `входа -${fx.kind} нет — файл не записан`,
      !r.razborPath && 'разбора нет',
      r.extra.length && 'ЛИШНИЕ ФАЙЛЫ: ' + r.extra.join(', '),
      r.touched.length && 'ДОКУМЕНТ ЗАДАЧИ ТРОНУТ: ' + r.touched.join(', '),
      r.input && r.input.missing.length && 'нет: ' + r.input.missing.join('; '),
      r.input && r.input.violations.length && 'НАРУШЕНО: ' + r.input.violations.join('; '),
      r.razbor && r.razbor.bad.length && 'ВЫДУМАННЫЕ ЦИТАТЫ: ' + r.razbor.bad.join('; '),
      r.razbor && r.razbor.lost.length && 'в разборе потеряно для второго прогона: ' + r.razbor.lost.join('; '),
      r.razbor && `цитат: ${r.razbor.quotes}`,
      r.razbor && r.razbor.quotes < r.razbor.minQuotes && `В РАЗБОРЕ МЕНЬШЕ ${r.razbor.minQuotes} ЦИТАТ`,
      !r.dateOk && `ДАТА В ИМЕНАХ ФАЙЛОВ НЕ ${fx.fileDate}: ${r.inputPath || '—'}`,
      r.razbor && !r.razbor.heading && 'В РАЗБОРЕ НЕТ РАЗДЕЛА «Во вход»',
    ].filter(Boolean)
    const warns = [
      r.razbor && r.razbor.heading && !r.razbor.layout && 'разбор не по форме output.md: «Во вход» — подраздел, записи отдельно',
      r.razbor && r.razbor.moved.length && `номер строки не тот у ${r.razbor.moved.length}: ${r.razbor.moved.join('; ')}`,
      r.razbor && r.razbor.lostWarn.length && 'в журнале нет: ' + r.razbor.lostWarn.join('; '),
    ].filter(Boolean)
    console.log(`  ${n}: ${r.pass ? 'зелёный' : 'красный'}  · ${notes.join(' · ')}${warns.length ? '\n         предупреждения: ' + warns.join(' · ') : ''}`)
  }
  console.log(`\n  ${green}/${measured}\tзелёных — вход по анкерам expected.md, цитаты разбора сходятся, документ задачи не тронут  ← КРИТЕРИЙ\n`)
}

function mainPoints () {
  const fxName = ARGS[ARGS.indexOf('--fx') + 1]
  const arg = ARGS.find((a, i) => !a.startsWith('--') && ARGS[i - 1] !== '--fx')
  const fx = ptFx(fxName)
  if (!arg || !existsSync(arg) || !fx) { console.error('usage: node grade-meet.mjs <каталог с песочницами> --points --fx VAC|ACC|LONG|NEW|REW|CHG|CR|OUT|SAMEDAY|TWIN'); process.exit(1) }
  const runs = readdirSync(arg).filter((n) => /^run-\d+$/.test(n) && statSync(join(arg, n)).isDirectory()).sort()
  console.log(`\nпроба meet-${fxName.toLowerCase()} (список), ${arg}`)
  let measured = 0; let green = 0
  const SETTINGS = join(arg, '_settings.txt')
  const CAP = existsSync(SETTINGS) ? Number((read(SETTINGS).match(/потолок ходов: (\d+)/) || [])[1] || 0) : 0
  for (const n of runs) {
    const dir = join(arg, n)
    const ans = existsSync(join(dir, 'answer.md')) ? readFileSync(join(dir, 'answer.md'), 'utf8') : ''
    if (apiFailed(dir, ans)) { console.log(`  ${n}: НЕ ИЗМЕРЕНО (отказ API)`); continue }
    measured++
    const r = gradeRunPt(dir, fx)
    if (r.pass) green++
    const turns = readdirSync(dir).filter((f) => /^answer-\d+\.md$/.test(f)).length || 1
    const capHit = !r.listPath && CAP > 0 && turns >= CAP
    const stopped = /разбор не состоялся/i.test(ans)
    const L = r.list
    const R = r.razbor
    const notes = [
      `ходов: ${turns}, субагентов: ${r.agents}`,
      !ans.trim() && 'ОТВЕТА НЕТ',
      capHit && `УПЁРСЯ В ПОТОЛОК ${CAP} ХОДОВ — читать answer-*.md`,
      stopped && 'В ДИАЛОГЕ «разбор не состоялся» — читать answer-*.md',
      r.forbiddenReads.length && 'ЧИТАЛ services/ ИЛИ context/: ' + r.forbiddenReads.join('; '),
      r.lists !== 1 && (r.lists ? `СПИСКОВ ${r.lists}` : 'списка нет — файл не записан'),
      r.razbors !== 1 && (r.razbors ? `РАЗБОРОВ ${r.razbors}` : 'разбора нет'),
      r.extra.length && 'ЛИШНИЕ ФАЙЛЫ: ' + r.extra.join(', '),
      r.touched.length && 'ЗАСЕВ ТРОНУТ: ' + r.touched.join(', '),
      L && `пунктов: ${L.items.length}`,
      L && L.form.length && 'ФОРМА: ' + L.form.join('; '),
      L && L.missing.length && 'нет: ' + L.missing.join('; '),
      L && L.violations.length && 'НАРУШЕНО: ' + L.violations.join('; '),
      R && R.bad.length && 'ВЫДУМАННЫЕ ЦИТАТЫ: ' + R.bad.join('; '),
      R && R.lost.length && 'в разборе потеряно: ' + R.lost.join('; '),
      R && `цитат: ${R.quotes}`,
      R && R.quotes < R.minQuotes && `В РАЗБОРЕ МЕНЬШЕ ${R.minQuotes} ЦИТАТ`,
      R && !R.heading && 'В РАЗБОРЕ НЕТ РАЗДЕЛА «В список»',
      R && fx.bareRed && R.bare.length && `строк «цитаты:» без текста: ${R.bare.length}`,
      !r.dateOk && `ДАТА В ИМЕНАХ ФАЙЛОВ НЕ ${fx.fileDate}: ${r.listPath || '—'}`,
      r.keyAsked && 'СПРОШЕН КЛЮЧ ЗАДАЧИ',
      r.themeAsked.length && 'СПРОШЕНА ТЕМА: ' + r.themeAsked.map((x) => `ход ${x.n} «${x.q.slice(0, 70)}»`).join('; '),
      L && fx.facts.length && `сведений: ${L.facts.covered.length}/${fx.facts.length}`,
      r.stops.length && `ход ${r.stops.join(', ')}: стоп на «решений нет» без записи и без вопроса`,
      r.refs.red.length && 'РАЗБОР: ' + r.refs.red.join('; '),
      r.sideDropped.length && '«БЕЗ ЭТИХ K» НЕ ИСПОЛНЕНО: ' + r.sideDropped.join('; '),
      r.razborTitle && r.razborTitle.red && `ПРЕДМЕТ РАЗБОРА — ОТВЕРГНУТЫЙ: «${r.razborTitle.t}»`,
      r.srtSpeakers.length && 'ГОВОРЯЩИЙ У ЦИТАТЫ SRT: ' + r.srtSpeakers.join('; '),
    ].filter(Boolean)
    // По правке — ожидание черновика правок, на текущей версии скилла не красит: базовый замер его показывает отдельно.
    const byEdit = r.byEdit.length ? '\n         по правке (не в исходе): ' + r.byEdit.join(' · ') : ''
    // Побочные темы — отдельной строкой, в исход прогона не входят.
    const side = [
      r.side.red.length && 'побочное без вопроса: ' + r.side.red.join('; '),
      r.side.falseMark.length && `ложная пометка «не про тему» (${r.side.falseMark.length}): ` + r.side.falseMark.map((t) => `«${t}»`).join('; '),
      r.side.shown.length && `показано «Похоже, не про …»: ${r.side.shown.join(', ')}`,
    ].filter(Boolean)
    const warns = [
      ...(L ? L.warn : []),
      R && R.heading && !R.layout && 'разбор не по форме output.md: «В список» — подраздел',
      R && R.unmarked.length && `пунктов без записи «в список: п.<N>»: ${R.unmarked.join(', ')}`,
      R && R.strayMarks.length && `пометки на несуществующие пункты: ${R.strayMarks.join(', ')}`,
      R && !fx.bareRed && R.bare.length && `строк «цитаты:» без текста: ${R.bare.length}`,
      R && R.moved.length && `номер строки не тот у ${R.moved.length}: ${R.moved.join('; ')}`,
      R && R.lostWarn.length && 'в журнале нет: ' + R.lostWarn.join('; '),
      ...r.side.warn,
      !r.sameBase && `имена списка и разбора разные: ${r.listPath} / ${r.razborPath}`,
      ...r.refs.warn,
      r.razborTitle && !r.razborTitle.red && r.razborTitle.warn && `предмет разбора без основ ответа аналитика: «${r.razborTitle.t}»`,
      r.listNotNamed && 'в ответах нет пути нового списка',
    ].filter(Boolean)
    console.log(`  ${n}: ${r.pass ? 'зелёный' : 'красный'}  · ${notes.join(' · ')}${warns.length ? '\n         предупреждения: ' + warns.join(' · ') : ''}${side.length ? '\n         побочные темы (не в исходе): ' + side.join(' · ') : ''}${byEdit}`)
  }
  console.log(`\n  ${green}/${measured}\tзелёных — список по форме и анкерам expected.md, цитаты разбора сходятся, засев не тронут  ← КРИТЕРИЙ\n`)
}
