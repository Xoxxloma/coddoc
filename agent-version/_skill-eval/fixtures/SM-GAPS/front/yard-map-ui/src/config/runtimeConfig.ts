import bundled from './urls.json';

export type UrlConfig = typeof bundled;

// Значения из сборки — запасные: на стенде их перекрывает файл, который раздаёт оболочка portal-shell.
export let URL_CONFIG: UrlConfig = { ...bundled };

const RUNTIME_CONFIG_PATH = '/portal/yard/config/urls.json';

export async function loadRuntimeConfig(): Promise<void> {
  try {
    const res = await fetch(RUNTIME_CONFIG_PATH, { cache: 'no-store' });
    if (res.ok) {
      URL_CONFIG = { ...bundled, ...(await res.json()) };
    }
  } catch {
    // файл не загрузился — остаются значения из сборки
  }
}
