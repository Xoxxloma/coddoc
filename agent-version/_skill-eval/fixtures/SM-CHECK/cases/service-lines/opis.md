GET /api/parcels — src/web/Parcels.kt
  · только посылки отправителя — src/web/Parcels.kt
вход: заголовок X-User от шлюза читает фильтр, подпись не проверяется — src/web/HeaderFilter.kt
зависит: tariff-api — расчёт стоимости — src/client/TariffClient.kt
зависит: depot-registry — склады из схемы depot, без вызова — src/db/DepotDao.kt
⟹ эндпоинтов 1, из них с фактами 1
