Стек: Spring + Netflix DGS, REST меньшинством, Kafka через reactor-kafka (аннотаций слушателей нет, топики в конфиге).

контракт :: @(Get|Post|Put|Patch|Delete)Mapping\( :: *.java :: ключ
контракт :: @Dgs(Query|Mutation|Subscription)\b :: *.java :: ключ
контракт :: @DgsData\(parentType\s*=\s*"(Query|Mutation|Subscription)" :: *.java :: ключ
сущности :: @Entity\b :: *.java :: ключ
задачи :: @Scheduled\( :: *.java :: ключ
топики :: kontrol\.[a-z]+\.[a-z]+\.v1 :: application.yaml :: ключ
топики :: class \w+EventProcessor\b :: *.java :: ориентир
