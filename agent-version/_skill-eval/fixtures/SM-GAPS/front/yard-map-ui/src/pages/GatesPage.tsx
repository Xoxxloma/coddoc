import React, { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import ExcelJS from 'exceljs';
import { yardApi, GateEvent } from '../api/yardApi';
import { yardStore } from '../stores/yardStore';
import { PeriodPicker } from '../components/PeriodPicker';

async function exportJournal(rows: GateEvent[]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Журнал ворот');
  ws.addRow(['Время', 'Тягач', 'Контейнер', 'Направление', 'Отмечено']);
  rows.forEach((r) => ws.addRow([r.at, r.truck, r.container ?? '', r.direction === 'IN' ? 'въезд' : 'выезд', r.flagged ? 'да' : '']));
  const buf = await wb.xlsx.writeBuffer();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([buf]));
  a.download = 'gate-journal.xlsx';
  a.click();
}

export const GatesPage = observer(() => {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const events = useQuery({
    queryKey: ['gates', yardStore.periodFrom, yardStore.periodTo],
    queryFn: () => yardApi.gateEvents(yardStore.periodFrom, yardStore.periodTo),
  });
  const flag = useMutation({
    mutationFn: (id: number) => yardApi.flagGateEvent(id, reason),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['gates'] }),
  });
  return (
    <div>
      <h2>Журнал въездов и выездов</h2>
      <PeriodPicker />
      <button disabled={!events.data?.length} onClick={() => exportJournal(events.data ?? [])}>Выгрузить в Excel</button>
      <input placeholder="Причина отметки" value={reason} onChange={(e) => setReason(e.target.value)} />
      <table>
        <tbody>
          {(events.data ?? []).map((e) => (
            <tr key={e.id}>
              <td>{e.at}</td><td>{e.truck}</td><td>{e.container}</td><td>{e.direction}</td>
              <td>{e.flagged ? 'отмечено' : <button disabled={!reason.trim()} onClick={() => flag.mutate(e.id)}>Отметить</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});
