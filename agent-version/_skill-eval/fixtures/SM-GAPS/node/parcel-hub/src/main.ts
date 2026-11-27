import express from 'express';
import config from 'config';
import { parcelsRouter } from './routes/parcels';
import { couriersRouter } from './routes/couriers';
import { startConsumers } from './kafka/consumers';
import { dataSource } from './db/data-source';

async function main() {
  await dataSource.initialize();
  const app = express();
  app.use(express.json());
  app.use('/parcels', parcelsRouter);
  app.use('/couriers', couriersRouter);
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  await startConsumers();
  app.listen(config.get<number>('http.port'));
}

main();
