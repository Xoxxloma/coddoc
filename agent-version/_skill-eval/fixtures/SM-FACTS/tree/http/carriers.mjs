import { Router } from 'express';
import * as carriers from '../domain/carriers.mjs';
export const carrierRoutes = Router();
const reply = fn => async (req, res, next) => {
  try { res.json(await fn(req)); } catch (error) { next(error); }
};
carrierRoutes.get('/carriers', reply(() => carriers.list()));
carrierRoutes.post('/carriers', reply(r => carriers.register(r.body)));
carrierRoutes.patch('/carriers/:id/state', reply(r => carriers.changeState(r.params.id, r.body.enabled, r.user)));
carrierRoutes.delete('/carriers/:id', reply(r => carriers.archive(r.params.id)));
