import { URL_CONFIG } from '../config/runtimeConfig';

let loading: Promise<void> | null = null;

/** Библиотека карты подгружается скриптом с адреса из конфига. */
export function loadMapLibrary(): Promise<void> {
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = `${URL_CONFIG.mapScriptUrl}?key=${process.env.REACT_APP_MAP_KEY}`;
      s.onload = () => resolve();
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  return loading;
}
