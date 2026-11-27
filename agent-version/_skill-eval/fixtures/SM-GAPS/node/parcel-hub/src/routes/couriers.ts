import { Router } from 'express';
import { dataSource } from '../db/data-source';
import { Courier } from '../db/courier.entity';

export const couriersRouter = Router();
const couriers = () => dataSource.getRepository(Courier);

couriersRouter.get('/', async (_req, res) => res.json(await couriers().find()));

// Курьер на смене — статус приходит из couriers.status, здесь только чтение.
couriersRouter.get('/:id', async (req, res) => {
  const c = await couriers().findOneBy({ id: Number(req.params.id) });
  if (!c) return res.status(404).end();
  res.json(c);
});
