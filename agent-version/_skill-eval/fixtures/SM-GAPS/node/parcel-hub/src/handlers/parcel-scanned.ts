import { dataSource } from '../db/data-source';
import { Parcel } from '../db/parcel.entity';

// Скан на сортировке: создаёт посылку при первом скане, дальше обновляет последний пункт; статус IN_TRANSIT.
export async function onParcelScanned(e: { track: string; point: string }) {
  const repo = dataSource.getRepository(Parcel);
  const p = (await repo.findOneBy({ track: e.track })) ?? repo.create({ track: e.track });
  p.lastPoint = e.point;
  if (p.status !== 'DELIVERED') p.status = 'IN_TRANSIT';
  await repo.save(p);
}
