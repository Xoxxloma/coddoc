import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { yardApi } from '../api/yardApi';
import { URL_CONFIG } from '../config/runtimeConfig';
import { movePlannerStore } from '../stores/movePlannerStore';
import { yardStore } from '../stores/yardStore';

export function ContainerCard({ number }: { number: string }) {
  const { data } = useQuery({ queryKey: ['container', number], queryFn: () => yardApi.container(number) });
  if (!data) return null;
  return (
    <section className="card">
      <h3>{data.number}</h3>
      <p>Блок {data.block}, ряд {data.row}, ярус {data.tier}</p>
      <p>Владелец: {data.owner}</p>
      <p>На площадке с {new Date(data.arrivedAt).toLocaleDateString('ru-RU')}</p>
      {data.reefer && <p>Рефконтейнер — нужна розетка</p>}
      <button onClick={() => window.open(`${URL_CONFIG.cargoTrackerUrl}${data.number}`, '_blank')}>
        Открыть в системе слежения за грузом
      </button>
      <button onClick={() => movePlannerStore.addMove({ container: data.number, toBlock: '' })}>Добавить в план перестановки</button>
      <button onClick={() => yardStore.select(null)}>Закрыть</button>
    </section>
  );
}
