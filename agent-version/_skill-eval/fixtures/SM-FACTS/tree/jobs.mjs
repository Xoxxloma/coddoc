import cron from 'node-cron';
import { config } from './config.mjs';
import { store } from './storage/store.mjs';
import { retry } from './domain/shipments.mjs';
async function retryFailedShipments() { for (const s of await store.failedCandidates()) await retry(s.id); }
async function rotateLabels() { await store.rotateLabels(); }
cron.schedule(config.retrySchedule, retryFailedShipments);
cron.schedule(config.labelSchedule, rotateLabels, { timezone: config.timezone });
