import React, { useState } from 'react';

/** Песочница компонента рисования зоны — для разработки, в меню её нет. */
export function DrawSandboxPage() {
  const [points, setPoints] = useState<[number, number][]>([]);
  return (
    <div>
      <h2>Рисование зоны</h2>
      <svg width={600} height={400} onClick={(e) => setPoints([...points, [e.nativeEvent.offsetX, e.nativeEvent.offsetY]])}>
        <polygon points={points.map((p) => p.join(',')).join(' ')} fill="rgba(0,120,255,.2)" stroke="#0078ff" />
      </svg>
      <button onClick={() => setPoints([])}>Очистить</button>
    </div>
  );
}
