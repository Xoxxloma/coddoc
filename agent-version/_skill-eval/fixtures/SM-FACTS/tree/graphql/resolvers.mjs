import { buildMiddleware } from 'fixture-graphql';
import * as shipments from '../domain/shipments.mjs';
export const graphqlMiddleware = buildMiddleware('./graphql/schema.graphql', {
  Query: { shipment: (_, a) => shipments.detail(a.id), shipmentHistory: (_, a) => shipments.history(a.id) },
  Mutation: { holdShipment: (_, a) => shipments.hold(a.id, a.reason), releaseShipment: (_, a) => shipments.release(a.id) }
});
