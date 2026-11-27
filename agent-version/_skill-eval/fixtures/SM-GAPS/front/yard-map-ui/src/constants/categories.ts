export type CategoryId = 'containers' | 'reefers' | 'cranes' | 'gates' | 'drivers';

export const CATEGORIES: { id: CategoryId; title: string }[] = [
  { id: 'containers', title: 'Контейнеры' },
  { id: 'reefers', title: 'Рефконтейнеры' },
  { id: 'cranes', title: 'Краны' },
  { id: 'gates', title: 'Въезды и выезды' },
  // { id: 'drivers', title: 'Водители на площадке' }, — скрыто до релиза, точки пока из моков
];
