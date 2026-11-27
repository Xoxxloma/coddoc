import React from 'react';
import { observer } from 'mobx-react-lite';
import { CATEGORIES } from '../constants/categories';
import { yardStore } from '../stores/yardStore';
import { PeriodPicker } from './PeriodPicker';

export const LayerPicker = observer(() => (
  <fieldset>
    <legend>Что показать на карте</legend>
    {CATEGORIES.map((c) => (
      <label key={c.id}>
        <input type="checkbox" checked={yardStore.categories.has(c.id)} onChange={() => yardStore.toggleCategory(c.id)} />
        {c.title}
      </label>
    ))}
    {yardStore.categories.has('gates') && <PeriodPicker />}
  </fieldset>
));
