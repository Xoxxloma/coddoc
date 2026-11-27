export function shipmentView(s) {
  const { internalNotes, token, ...publicFields } = s;
  return { ...publicFields, deliveredAt: s.deliveredAt || null };
}
export function historyView(h) { const { actorEmail, ...publicFields } = h; return publicFields; }
export function tariffView(t) { return { zone: t.zone, price: t.price, validUntil: t.validUntil || null }; }
