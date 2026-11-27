import React, { useState } from 'react';
import { yardApi } from '../api/yardApi';
import { yardStore } from '../stores/yardStore';

const CONTAINER_NO = /^[A-Z]{4}\d{7}$/;

export function SearchBox() {
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const search = async () => {
    const number = q.trim().toUpperCase();
    if (!CONTAINER_NO.test(number)) {
      setError('Номер контейнера — четыре буквы и семь цифр');
      return;
    }
    try {
      await yardApi.container(number);
      setError('');
      yardStore.select(number);
    } catch {
      setError('Контейнер на площадке не найден');
    }
  };
  return (
    <div>
      <input placeholder="Номер контейнера" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} />
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
