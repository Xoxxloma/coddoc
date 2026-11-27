import { db } from './connection.mjs';
import { Fault } from '../http/errors.mjs';
const requireRow = row => { if (!row) throw new Fault('NOT_FOUND'); return row; };
export const store = {
  ping: () => db.ping(),
  byToken: token => db.shipments.findOne({ token }),
  shipment: async id => requireRow(await db.shipments.findOne({ id })),
  carrier: async id => requireRow(await db.carriers.findOne({ id })),
  listShipments: ({ excludeStatus, order, limit }) => db.shipments.find({ status: { ne: excludeStatus } }, { order, limit }),
  insertShipment: row => db.shipments.insert(row),
  updateShipment: (id, patch) => db.shipments.update(id, patch),
  listCarriers: filter => db.carriers.find(filter),
  insertCarrier: async row => {
    try { return await db.carriers.insert(row); }
    catch (e) { if (e.constraint === 'carrier_tax_id_unique') throw new Fault('UNIQUE_TAX_ID'); throw e; }
  },
  updateCarrier: (id, patch) => db.carriers.update(id, patch),
  releaseCarrier: id => db.carriers.update(id, { busy: false }),
  history: (id, order) => db.history.find({ shipmentId: id }, { order }),
  attach: (id, row) => db.attachments.insert({ ...row, shipmentId: id }),
  signedLabel: (id, seconds) => db.signBlob(id, seconds),
  activeTariffs: date => db.tariffs.find({ validFrom: { lte: date }, or: [{ validUntil: null }, { validUntil: { gte: date } }] }),
  activeAssignments: id => db.shipments.count({ carrierId: id, status: { in: ['ASSIGNED', 'IN_TRANSIT'] } }),
  transaction: fn => db.transaction(fn),
  failedCandidates: () => db.shipments.find({ status: 'FAILED', attempts: { lt: 3 } }),
  rotateLabels: () => db.labels.delete({ expiresAt: { lt: new Date() } })
};
