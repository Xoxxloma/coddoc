import { Router } from 'express';
import { dataSource } from '../db/data-source';
import { Parcel } from '../db/parcel.entity';
import { publish } from '../kafka/producer';

export const parcelsRouter = Router();
const parcels = () => dataSource.getRepository(Parcel);

// Посылка по трек-номеру; нет такой — 404.
parcelsRouter.get('/:track', async (req, res) => {
  const p = await parcels().findOneBy({ track: req.params.track });
  if (!p) return res.status(404).end();
  res.json(p);
});

// Курьер отмечает вручение: статус DELIVERED, событие о вручении уходит в шину.
parcelsRouter.post('/:track/delivered', async (req, res) => {
  const p = await parcels().findOneByOrFail({ track: req.params.track });
  if (p.status === 'LOST') return res.status(409).json({ error: 'посылка списана как утерянная' });
  p.status = 'DELIVERED';
  await parcels().save(p);
  await publish('parcelDelivered', { track: p.track, at: new Date().toISOString() });
  res.status(204).end();
});

// Списание: посылка без сканов дольше 7 дней отмечается утерянной вручную оператором.
parcelsRouter.post('/:track/lost', async (req, res) => {
  const p = await parcels().findOneByOrFail({ track: req.params.track });
  p.status = 'LOST';
  await parcels().save(p);
  await publish('parcelLost', { track: p.track, reason: req.body?.reason ?? 'нет сканов' });
  res.status(204).end();
});
