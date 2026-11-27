# SM-APOLLO — ключ ответов (в песочницу не едет)

Настоящий код вместо синтетики: на фикстурах SM-GAPS обе версии service-map и все модели (Sonnet, Haiku,
DeepSeek) выходят почти на 100 %, а на проде — нет. Источник — Apollo (`apolloconfig/apollo`, Apache 2.0),
клон в `projects/apollo`, коммит `fd33f8dfbae3a459a79a270114a55951f0783073` (2026-10-24). Песочница копирует
репу целиком без `.git`; цель скана — `apollo-portal`, соседи в манифесте — `apollo-adminservice` и
`apollo-configservice`.

## Инвентарь `apollo-portal` (backend)

| Класс | Сколько | Чем считано |
|---|---|---|
| внутренние ручки (интерфейс портала) | **137** | `portal-rest.tsv` — префикс `@RequestMapping` класса + маппинг метода, 28 контроллеров; 71 GET, 35 POST, 19 DELETE, 11 PUT, 1 без глагола |
| внешний OpenAPI v1 | **153** | `openapi-ops.tsv` — операции спецификации `apollo-openapi` v0.3.12. Спецификация лежит в ДРУГОЙ репе (`apollo.openapi.spec.url` в `apollo-portal/pom.xml`), интерфейсы генерируются в `target/`; в исходниках — 15 контроллеров `openapi/v1/controller` с `@Override` без аннотаций маршрута. Реализованы все 153: объявленных без реализации нет |
| сущности | **14** | `@Entity`: Consumer, ConsumerAudit, ConsumerRole, ConsumerToken (openapi/entity); Authority, Favorite, Permission, Role, RolePermission, ServerConfig, UserPO, UserRole, UserToken, UserTokenAudit (portal/entity/po) |
| фоновые задачи | **3** | `@Scheduled` нет ни одного — потоки `ScheduledExecutorService`: обновление адресов adminservice (`AdminServiceAddressLocator`), проверка здоровья сред (`PortalSettings`, раз в 10 с), обновление адресов мета-сервера (`PortalMetaDomainService`) |
| топики брокера | **0** | брокера нет; `MQService` по умолчанию — заглушка |

Пути внешнего API читающий взять неоткуда: спецификации в репе нет. Путь в карточке, которого нет ни в
`openapi-ops.tsv`, ни в `portal-rest.tsv`, — выдумка (грейдер считает их).

## Опорные факты — проверены по коду

| № | Факт | Где | Что должно быть в карточке |
|---|---|---|---|
| A1 | портал ходит в adminservice каждой среды по HTTP (`AdminServiceAPI`, повтор по адресам) | `portal/api/AdminServiceAPI.java`, `component/RetryableRestTemplate.java` | `apollo-adminservice` в «Зависит от» |
| A2 | адреса adminservice берутся у мета-сервера среды: `GET {meta}/services/admin`; мета-сервер — часть `apollo-configservice` | `component/AdminServiceAddressLocator.java`, `environment/PortalMetaDomainService.java` | `apollo-configservice` (мета-сервер) в «Зависит от» |
| A3 | после релиза — POST истории релиза на вебхуки из настройки `config.release.webhook.service.url` | `component/ConfigReleaseWebhookNotifier.java`, `listener/ConfigPublishListener.java` | вебхуки — строка в «Зависит от» (внешние, вне манифеста) |
| A4 | письма через SMTP из настроек `email.config.host/user/password`, только при `email.enabled` | `spi/defaultimpl/DefaultEmailService.java` | почтовый сервер в «Зависит от» |
| A5 | вход через LDAP или OIDC — по профилю Spring `ldap` / `oidc` | `spi/configuration/AuthConfiguration.java` | LDAP / OIDC-провайдер в «Зависит от» |
| A6 | профиль по умолчанию (не `auth`, `ldap`, `oidc`): входа нет, каждый запрос — от вшитого пользователя `apollo` | `spi/defaultimpl/DefaultUserInfoHolder.java`, `AuthConfiguration.DefaultWebSecurityConfig` | в «Ролях и доступе» — вход по умолчанию без проверки, пользователь `apollo` |
| A7 | режимы входа выбираются профилем: `auth` (пользователи в своей БД), `ldap`, `oidc` | `AuthConfiguration` | в «Ролях и доступе» — режимы входа |
| A8 | внешний API — по токену потребителя в заголовке `Authorization`; без токена — 401; у токена лимит запросов — сверх него 429 | `openapi/filter/ConsumerAuthenticationFilter.java` | токен потребителя, 401, лимит и 429 |
| A9 | отправка в очередь после релиза (`MQService`) по умолчанию ничего не делает | `spi/defaultimpl/DefaultMQService.java` | «заглушка / не работает / ничего не делает» |
| A10 | суперадмины — список из настройки `superAdmin` | `component/config/PortalConfig.java` | суперадмин из настройки |
| A11 | экстренный релиз без ревью — только в средах из `emergencyPublish.supported.envs` | `PortalConfig` | правило экстренного релиза |
| A12 | в средах из `configView.memberOnly.envs` конфиг видят только участники приложения | `PortalConfig` | правило «только участникам» |
| A13 | проверка здоровья сред раз в 10 с; после 2 неудач подряд среда считается упавшей | `component/PortalSettings.java` | частота и порог |
| A14 | адреса adminservice обновляются с двумя интервалами — обычным и «офлайн» (после неудачи) из настроек | `AdminServiceAddressLocator` | два интервала |

«Что умеет» — справочно: число строк и склеенные строки.
