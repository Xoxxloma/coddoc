import { yardHttp } from './index';

export type Container = { number: string; block: string; row: number; tier: number; reefer: boolean; owner: string; arrivedAt: string };
export type Crane = { id: number; name: string; block: string; busy: boolean };
export type GateEvent = { id: number; at: string; truck: string; container?: string; direction: 'IN' | 'OUT'; flagged: boolean };
export type MovePlan = { id: number; title: string; authorNumber: string; moves: { container: string; toBlock: string }[]; createdAt: string };
export type Me = { employeeNumber: string; fullName: string };

export const yardApi = {
  me: () => yardHttp.get<Me>('/me').then((r) => r.data),
  containers: (block?: string) => yardHttp.get<Container[]>('/containers', { params: { block } }).then((r) => r.data),
  container: (number: string) => yardHttp.get<Container>(`/containers/${number}`).then((r) => r.data),
  cranes: () => yardHttp.get<Crane[]>('/cranes').then((r) => r.data),
  gateEvents: (from: string, to: string) => yardHttp.get<GateEvent[]>('/gates/events', { params: { from, to } }).then((r) => r.data),
  flagGateEvent: (id: number, reason: string) => yardHttp.post(`/gates/events/${id}/flag`, { reason }),
  plans: () => yardHttp.get<MovePlan[]>('/moves/plans').then((r) => r.data),
  savePlan: (plan: Omit<MovePlan, 'id' | 'authorNumber' | 'createdAt'>) => yardHttp.post<MovePlan>('/moves/plans', plan).then((r) => r.data),
  deletePlan: (id: number) => yardHttp.delete(`/moves/plans/${id}`),
  // объявлен для слоя блоков, но слой берётся из assets/blocks.json
  blocksLayer: () => yardHttp.get('/blocks/layer').then((r) => r.data),
};
