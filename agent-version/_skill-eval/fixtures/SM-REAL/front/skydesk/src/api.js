import axios from 'axios';

// Клиент собственного бэкенда: вызовы, а не ручки.
const api = axios.create({ baseURL: '/api' });

export const listNights = () => api.get('/nights').then((r) => r.data);
export const getNight = (id) => api.get(`/nights/${id}`).then((r) => r.data);
export const reserve = (nightId) => api.post('/reservations', { nightId }).then((r) => r.data);
export const cancelReservation = (id) => api.post(`/reservations/${id}/cancel`).then((r) => r.data);
export const getMe = () => api.get('/observers/me').then((r) => r.data);
