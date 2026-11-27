import { Link } from 'react-router-dom';

export default function Home() {
  return (
    <main>
      <h1>Брони телескопов</h1>
      <Link to="/nights">Свободные ночи</Link> · <Link to="/reservations">Мои брони</Link>
    </main>
  );
}
