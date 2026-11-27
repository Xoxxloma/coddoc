GET /api/v1/messages — app/routers/messages.py
  · только непрочитанные по умолчанию — app/routers/messages.py
POST /api/v1/messages — app/routers/messages.py
  · текст длиннее 2000 символов — 422 — app/schemas.py
DELETE /api/v1/messages/{id} — app/routers/messages.py
  · удалять может только автор — app/services/messages.py
GET /health — app/main.py + app/routers/health.py
  (фактов нет — служебный)
⟹ эндпоинтов 4, из них с фактами 3
