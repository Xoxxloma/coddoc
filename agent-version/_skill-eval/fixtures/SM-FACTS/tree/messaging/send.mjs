import { broker } from './transport.mjs';
export const publishAssigned = s => broker.publish('route.assigned', { carrierId: s.carrierId, shipmentId: s.id }, { key: s.carrierId });
export const publishDelivered = s => broker.publish('shipment.delivered', { shipmentId: s.id, deliveredAt: s.deliveredAt }, { key: s.id });
