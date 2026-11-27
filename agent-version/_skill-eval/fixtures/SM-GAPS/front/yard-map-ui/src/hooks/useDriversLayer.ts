import drivers from '../mocks/drivers.json';

// Источник водителей на площадке ещё не готов — слой рисуется по мокам.
export function useDriversLayer(enabled: boolean) {
  return { data: enabled ? drivers : [], isLoading: false };
}
