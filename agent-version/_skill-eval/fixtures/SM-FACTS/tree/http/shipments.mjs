import { Router } from 'express';
import * as shipments from '../domain/shipments.mjs';
import { upload } from './upload.mjs';
const router = Router();
const reply = fn => async (req, res, next) => {
  try { res.json(await fn(req)); } catch (error) { next(error); }
};
router.post('/shipments', reply(r => shipments.create(r.body, r.headers['idempotency-key'])));
router.get('/shipments', reply(r => shipments.list(r.query)));
router.get('/shipments/:id', reply(r => shipments.detail(r.params.id)));
router.patch('/shipments/:id/address', reply(r => shipments.address(r.params.id, r.body.address)));
router.post('/shipments/:id/assign', reply(r => shipments.assign(r.params.id, r.body.carrierId)));
router.post('/shipments/:id/dispatch', reply(r => shipments.dispatch(r.params.id)));
router.post('/shipments/:id/deliver', reply(r => shipments.deliver(r.params.id, r.body.notify)));
router.post('/shipments/:id/cancel', reply(r => shipments.cancel(r.params.id)));
router.post('/shipments/:id/retry', reply(r => shipments.retry(r.params.id)));
router.get('/shipments/:id/history', reply(r => shipments.history(r.params.id)));
router.post('/shipments/:id/attachments', upload, reply(r => shipments.attach(r.params.id, r.file)));
router.get('/shipments/:id/label', reply(r => shipments.label(r.params.id)));
router.get('/tariffs', reply(r => shipments.tariffs(r.query.date)));
router.post('/shipments/bulk', reply(r => shipments.bulk(r.body.items)));
export { router as shipmentRoutes };
