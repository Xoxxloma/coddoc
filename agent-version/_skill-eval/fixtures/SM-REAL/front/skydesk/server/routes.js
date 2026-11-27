import express from 'express';
import { load, save, MAX_RESERVATIONS_PER_MONTH } from './store.js';

export const router = express.Router();

// Наблюдатель — из заголовка, который ставит шлюз; без него — 401.
function observerId(req, res) {
  const id = req.get('X-Observer-Id');
  if (!id) res.status(401).json({ error: 'нужен вход' });
  return id;
}

router.get('/nights', (req, res) => {
  const { nights } = load();
  // Закрытые по погоде ночи в календарь не попадают.
  res.json(nights.filter((n) => n.status === 'open'));
});

router.get('/nights/:id', (req, res) => {
  const night = load().nights.find((n) => n.id === req.params.id);
  if (!night) return res.status(404).json({ error: 'ночь не найдена' });
  res.json(night);
});

router.post('/reservations', (req, res) => {
  const who = observerId(req, res);
  if (!who) return;
  const state = load();
  const night = state.nights.find((n) => n.id === req.body.nightId);
  if (!night || night.status !== 'open') return res.status(409).json({ error: 'ночь закрыта' });
  const month = night.date.slice(0, 7);
  const mine = state.reservations.filter(
    (r) => r.observerId === who && r.status === 'confirmed' && state.nights.find((n) => n.id === r.nightId)?.date.startsWith(month),
  );
  if (mine.length >= MAX_RESERVATIONS_PER_MONTH) return res.status(409).json({ error: 'лимит броней на месяц' });
  const reservation = { id: `r-${Date.now()}`, nightId: night.id, observerId: who, status: 'confirmed' };
  state.reservations.push(reservation);
  save(state);
  res.status(201).json(reservation);
});

router.post('/reservations/:id/cancel', (req, res) => {
  const who = observerId(req, res);
  if (!who) return;
  const state = load();
  const r = state.reservations.find((x) => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: 'бронь не найдена' });
  if (r.observerId !== who) return res.status(403).json({ error: 'чужая бронь' });
  if (r.status === 'cancelled') return res.json(r); // повтор безопасен
  r.status = 'cancelled';
  save(state);
  res.json(r);
});

router.get('/observers/me', (req, res) => {
  const who = observerId(req, res);
  if (!who) return;
  const me = load().observers.find((o) => o.id === who);
  if (!me) return res.status(404).json({ error: 'наблюдатель не найден' });
  res.json({ id: me.id, name: me.name });
});
