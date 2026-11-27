import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listNights } from '../api.js';

export default function Nights() {
  const [nights, setNights] = useState([]);
  useEffect(() => { listNights().then(setNights); }, []);
  // Фаза Луны больше 0.8 — ночь подсвечена как неудобная для слабых объектов.
  return (
    <ul>
      {nights.map((n) => (
        <li key={n.id} className={n.moonPhase > 0.8 ? 'bright' : ''}>
          <Link to={`/nights/${n.id}`}>{n.date}</Link>
        </li>
      ))}
    </ul>
  );
}
