import React from 'react';
import { observer } from 'mobx-react-lite';
import { yardStore } from '../stores/yardStore';

/** Период въездов и выездов; по умолчанию — вчера и сегодня, не больше 31 дня. */
export const PeriodPicker = observer(() => {
  const change = (from: string, to: string) => {
    const days = (Date.parse(to) - Date.parse(from)) / 86400000;
    if (days < 0 || days > 31) return;
    yardStore.setPeriod(from, to);
  };
  return (
    <div>
      <input type="date" value={yardStore.periodFrom} onChange={(e) => change(e.target.value, yardStore.periodTo)} />
      <input type="date" value={yardStore.periodTo} onChange={(e) => change(yardStore.periodFrom, e.target.value)} />
    </div>
  );
});
