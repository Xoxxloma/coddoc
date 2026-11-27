import { useEffect, useState } from 'react';
import { getMe, cancelReservation } from '../api.js';

export default function MyReservations() {
  const [me, setMe] = useState(null);
  useEffect(() => { getMe().then(setMe); }, []);
  // Список броней хранится в профиле на сервере; здесь — только отмена.
  const cancel = (id) => cancelReservation(id).then(() => getMe().then(setMe));
  if (!me) return <p>Войдите, чтобы увидеть брони</p>;
  return (
    <section>
      <h2>Брони: {me.name}</h2>
      <button onClick={() => cancel(prompt('Номер брони'))}>Отменить бронь</button>
    </section>
  );
}
