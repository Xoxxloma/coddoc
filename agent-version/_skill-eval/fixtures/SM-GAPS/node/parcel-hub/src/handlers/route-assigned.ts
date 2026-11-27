import { dataSource } from '../db/data-source';
import { Parcel } from '../db/parcel.entity';

// Маршрут назначен: посылке ставится курьер; посылка уже вручена — событие пропускается.
export async function onRouteAssigned(e: { track: string; courierId: number }) {
  const repo = dataSource.getRepository(Parcel);
  const p = await repo.findOneBy({ track: e.track });
  if (!p || p.status === 'DELIVERED') return;
  p.courierId = e.courierId;
  await repo.save(p);
}
