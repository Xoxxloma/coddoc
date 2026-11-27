export default function Login() {
  // Вход делает шлюз; страница только уводит на него.
  return <a href="/gateway/login?return=/reservations">Войти через обсерваторию</a>;
}
