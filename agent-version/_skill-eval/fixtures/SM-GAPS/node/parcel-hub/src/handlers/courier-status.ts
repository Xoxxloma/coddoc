import { dataSource } from '../db/data-source';
import { Courier } from '../db/courier.entity';

// Статус курьера (на смене, перерыв, вне смены) — хранится как есть, последним пришедшим.
export async function onCourierStatus(e: { courierId: number; status: 'ON_SHIFT' | 'BREAK' | 'OFF' }) {
  const repo = dataSource.getRepository(Courier);
  await repo.save({ id: e.courierId, status: e.status });
}
