## Экраны

/ — src/App.tsx
/projects/:id — src/App.tsx
  · чужой проект — переход на список — src/pages/Project.tsx
⟹ экранов 2, из них с фактами 1

## Состояние и данные

refresh-токен — localStorage, stores/auth.store.ts
справочник работ — кэш запросов, 5 мин, hooks/useCatalog.ts
текущий пользователь и его роль — хранилище в памяти, stores/auth.store.ts
⟹ хранилищ 3
