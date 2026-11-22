# Фикстура SB-SET-T — SB-SET со §3.2 спеки в табличной форме (5.133)

Копия `SB-SET`: в `coddoc/SHT-410/technical_specification.md` §3.2 переписан по шаблону 5.133 — сущность пунктом
с пометкой, поля таблицей «Поле | Тип | Описание»; у изменённой `Trip` — только `bikeRack` и строка «Остальные поля
не меняются». Содержание то же. Проба: `sb-set-t`; оценка — `grade-sections.mjs --case=sb-set` и
`grade-ent.mjs --case=sb` (поле `bikeRack` с типом `boolean` дошло до этапа).
