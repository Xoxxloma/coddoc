import { store } from '../storage/store.mjs';
import { requireStatus, requireRetry, requireCarrier } from '../policy/transitions.mjs';
import { shipmentView, historyView, tariffView } from '../http/views.mjs';
import { publishDelivered, publishAssigned } from '../messaging/send.mjs';
import { Fault } from '../http/errors.mjs';
export async function create(input, token) {
  const old = token && await store.byToken(token);
  if (old) return shipmentView(old);
  if (input.weight <= 0) throw new Fault('BAD_WEIGHT');
  return shipmentView(await store.insertShipment({ ...input, status: 'NEW', token, attempts: 0 }));
}
export async function list(query) {
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  return (await store.listShipments({ excludeStatus: 'CANCELLED', order: 'createdAt DESC', limit })).map(shipmentView);
}
export async function detail(id) { return shipmentView(await store.shipment(id)); }
export async function address(id, address) {
  const s = await store.shipment(id); requireStatus(s, ['NEW']);
  return shipmentView(await store.updateShipment(id, { address }));
}
export async function assign(id, carrierId) {
  const s = await store.shipment(id); requireStatus(s, ['NEW']);
  const carrier = await store.carrier(carrierId); requireCarrier(carrier);
  const changed = await store.updateShipment(id, { status: 'ASSIGNED', carrierId });
  await publishAssigned(changed); return shipmentView(changed);
}
export async function dispatch(id) {
  const s = await store.shipment(id); requireStatus(s, ['ASSIGNED']);
  return shipmentView(await store.updateShipment(id, { status: 'IN_TRANSIT', startedAt: new Date() }));
}
export async function deliver(id, notify) {
  const s = await store.shipment(id); requireStatus(s, ['IN_TRANSIT']);
  const changed = await store.updateShipment(id, { status: 'DELIVERED', deliveredAt: new Date() });
  if (notify === true) await publishDelivered(changed);
  return shipmentView(changed);
}
export async function cancel(id) {
  const s = await store.shipment(id); requireStatus(s, ['NEW', 'ASSIGNED']);
  if (s.status === 'ASSIGNED') await store.releaseCarrier(s.carrierId);
  return shipmentView(await store.updateShipment(id, { status: 'CANCELLED', carrierId: null }));
}
export async function retry(id) {
  const s = await store.shipment(id); requireRetry(s);
  return shipmentView(await store.updateShipment(id, { status: 'NEW', attempts: s.attempts + 1 }));
}
export async function history(id) { await store.shipment(id); return (await store.history(id, 'createdAt ASC')).map(historyView); }
export async function attach(id, file) { await store.shipment(id); return store.attach(id, { name: file.originalname, size: file.size }); }
export async function label(id) {
  const s = await store.shipment(id);
  if (!s.labelId) return null;
  return { url: await store.signedLabel(s.labelId, 15 * 60) };
}
export async function tariffs(date) { return (await store.activeTariffs(date || new Date())).map(tariffView); }
export async function bulk(items) {
  if (items.length > 25) throw new Fault('BULK_LIMIT');
  if (new Set(items.map(x => x.externalId)).size !== items.length) throw new Fault('BULK_DUPLICATE');
  return store.transaction(async tx => Promise.all(items.map(x => tx.insertShipment({ ...x, status: 'NEW', attempts: 0 }))));
}
export async function hold(id, reason) {
  const s = await store.shipment(id); requireStatus(s, ['NEW', 'ASSIGNED']);
  if (!reason.trim()) throw new Fault('HOLD_REASON');
  return shipmentView(await store.updateShipment(id, { held: true, holdReason: reason }));
}
export async function release(id) {
  const s = await store.shipment(id);
  if (!s.held) throw new Fault('NOT_HELD');
  return shipmentView(await store.updateShipment(id, { held: false, holdReason: null }));
}
