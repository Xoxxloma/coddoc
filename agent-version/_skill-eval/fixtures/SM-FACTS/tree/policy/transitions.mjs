import { Fault } from '../http/errors.mjs';
export function requireStatus(s, statuses) { if (!statuses.includes(s.status)) throw new Fault('STATUS_CONFLICT'); }
export function requireCarrier(c) { if (!c.enabled || c.archived) throw new Fault('CARRIER_DISABLED'); }
export function requireRetry(s) {
  requireStatus(s, ['FAILED']);
  if (s.attempts >= 3) throw new Fault('RETRY_LIMIT');
}
