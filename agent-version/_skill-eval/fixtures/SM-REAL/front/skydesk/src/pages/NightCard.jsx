import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getNight, reserve } from '../api.js';

export default function NightCard() {
  const { id } = useParams();
  const [night, setNight] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { getNight(id).then(setNight); }, [id]);
  if (!night) return null;
  const book = () => reserve(night.id).catch((e) => setError(e.response?.data?.error ?? 'не удалось'));
  return (
    <section>
      <h2>Ночь {night.date}</h2>
      <button onClick={book}>Забронировать</button>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
