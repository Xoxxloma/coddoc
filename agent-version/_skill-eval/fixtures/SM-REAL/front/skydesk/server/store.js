import fs from 'node:fs';

// Хранение — JSON-файл рядом с сервером; базы нет.
const FILE = new URL('./data/store.json', import.meta.url);

export function load() {
  return JSON.parse(fs.readFileSync(FILE, 'utf8'));
}

export function save(state) {
  fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
}

// Наблюдатель не держит больше трёх активных броней в месяц.
export const MAX_RESERVATIONS_PER_MONTH = 3;
