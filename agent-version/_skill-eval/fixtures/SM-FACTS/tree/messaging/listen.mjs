import { broker } from './transport.mjs';
import { store } from '../storage/store.mjs';
import { config } from '../config.mjs';
broker.subscribe('carrier.disabled', { group: config.consumerGroup }, async (event, commit) => {
  await store.updateCarrier(event.carrierId, { enabled: false });
  await commit();
});
