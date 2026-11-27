Маркеры ключей (пометки проверены открытием по одному файлу: `v2/consignment/controller`, `legacy`, `v2/crew/entity`, `v2/dispatcher/job`, `src/main/resources/application.yaml`):

```
контракт :: @(Get|Post|Put|Patch|Delete)Mapping\( :: *.java :: ключ
сущности :: @Entity\b :: *.java :: ключ
задачи :: @Scheduled\( :: *.java :: ключ
топики :: ^\s+- [a-z]+(\.[a-z]+)+\s*$ :: application.yaml :: ключ
топики :: class ExchangeMessageHandler\d+ :: *.java :: ориентир
```
