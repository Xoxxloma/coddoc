import React from 'react';
import { observer } from 'mobx-react-lite';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { yardApi, MovePlan } from '../api/yardApi';
import { movePlannerStore } from '../stores/movePlannerStore';

export const MovesPage = observer(({ terminalId, onPlanSaved }: { terminalId?: string; onPlanSaved?: (p: MovePlan) => void }) => {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: yardApi.me });
  const plans = useQuery({ queryKey: ['plans', terminalId], queryFn: yardApi.plans });
  const save = useMutation({
    mutationFn: () => yardApi.savePlan({ title: movePlannerStore.title, moves: movePlannerStore.moves }),
    onSuccess: (p) => {
      movePlannerStore.clear();
      qc.invalidateQueries({ queryKey: ['plans'] });
      onPlanSaved?.(p);
    },
  });
  const remove = useMutation({ mutationFn: (id: number) => yardApi.deletePlan(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['plans'] }) });
  const compared = (plans.data ?? []).filter((p) => movePlannerStore.compareIds.includes(p.id));
  const canSave = movePlannerStore.title.trim() !== '' && movePlannerStore.moves.length > 0 && movePlannerStore.moves.every((m) => m.toBlock !== '');

  return (
    <div>
      <h2>План перестановок</h2>
      <input placeholder="Название плана" value={movePlannerStore.title} onChange={(e) => (movePlannerStore.title = e.target.value)} />
      <ul>
        {movePlannerStore.moves.map((m) => (
          <li key={m.container}>
            {m.container} →
            <input value={m.toBlock} onChange={(e) => (m.toBlock = e.target.value.toUpperCase())} placeholder="Блок" />
            <button onClick={() => movePlannerStore.removeMove(m.container)}>Убрать</button>
          </li>
        ))}
      </ul>
      <button disabled={!canSave} onClick={() => save.mutate()}>Сохранить план</button>

      <h3>Сохранённые планы</h3>
      {(plans.data ?? []).map((p) => (
        <div key={p.id}>
          <label>
            <input type="checkbox" checked={movePlannerStore.compareIds.includes(p.id)} onChange={() => movePlannerStore.toggleCompare(p.id)} />
            {p.title} — перестановок {p.moves.length}
          </label>
          {me.data?.employeeNumber === p.authorNumber && <button onClick={() => remove.mutate(p.id)}>Удалить</button>}
        </div>
      ))}
      {compared.length === 2 && (
        <table>
          <thead><tr><th /><th>{compared[0].title}</th><th>{compared[1].title}</th></tr></thead>
          <tbody>
            <tr><td>Перестановок</td><td>{compared[0].moves.length}</td><td>{compared[1].moves.length}</td></tr>
            <tr><td>Затронуто блоков</td><td>{new Set(compared[0].moves.map((m) => m.toBlock)).size}</td><td>{new Set(compared[1].moves.map((m) => m.toBlock)).size}</td></tr>
          </tbody>
        </table>
      )}
    </div>
  );
});
