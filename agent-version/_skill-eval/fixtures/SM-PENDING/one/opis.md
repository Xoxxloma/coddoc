operator — internal/http/router.go
вход: токен из заголовка проверяет промежуточный обработчик — internal/http/auth.go

GET /api/domes/{id} — internal/http/router.go
  сущности: ← domeId · → Dome целиком — internal/dome/dome.go
  доступ: без проверки — internal/http/router.go
  меняет: нет
  шлёт: нет
  · открыт или закрыт и когда менялся — internal/dome/service.go
POST /api/domes/{id}/open — internal/http/router.go
  сущности: ← domeId · → Dome целиком — internal/dome/dome.go
  доступ: operator — internal/http/router.go
  меняет: Dome.state CLOSED → OPEN — если ветер ниже порога — internal/dome/service.go
  шлёт: нет
  · ветер выше порога — отказ 409 — internal/dome/service.go
closeOnRain — internal/jobs/close_on_rain.go
  меняет: Dome.state OPEN → CLOSED — дождь по датчику — internal/jobs/close_on_rain.go
  шлёт: нет
  · каждые 5 минут — internal/jobs/close_on_rain.go
Dome — internal/dome/dome.go (gorm)
состояние: Dome.state OPEN | CLOSED — internal/dome/dome.go
  · OPEN — оператором, если ветер ниже порога — internal/dome/service.go
  · CLOSED — оператором или задачей при дожде — internal/jobs/close_on_rain.go
зависит: weather — прогноз ветра перед открытием — internal/weather/client.go

⟹ эндпоинтов 2, из них с фактами 2
⟹ фоновых задач 1, из них с фактами 1
⟹ сущностей 1
⟹ состояний 1 (значений 2), справочников 0, сообщений 0
