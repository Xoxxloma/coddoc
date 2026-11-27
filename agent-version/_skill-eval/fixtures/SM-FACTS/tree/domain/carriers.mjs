import { store } from '../storage/store.mjs';
import { Fault } from '../http/errors.mjs';
export async function list() { return store.listCarriers({ enabled: true, archived: false }); }
export async function register(input) { return store.insertCarrier({ ...input, enabled: false, archived: false }); }
export async function changeState(id, enabled, user) {
  if (!user.roles.includes('SUPPORT')) throw new Fault('FORBIDDEN');
  await store.carrier(id); return store.updateCarrier(id, { enabled });
}
export async function archive(id) {
  await store.carrier(id);
  if (await store.activeAssignments(id)) throw new Fault('ACTIVE_ASSIGNMENTS');
  return store.updateCarrier(id, { archived: true, enabled: false });
}
