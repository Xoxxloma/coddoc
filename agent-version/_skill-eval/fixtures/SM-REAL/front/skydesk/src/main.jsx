import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import Home from './pages/Home.jsx';
import Nights from './pages/Nights.jsx';
import NightCard from './pages/NightCard.jsx';
import MyReservations from './pages/MyReservations.jsx';
import Login from './pages/Login.jsx';

const router = createBrowserRouter([
  { path: '/', element: <Home /> },
  { path: '/nights', element: <Nights /> },
  { path: '/nights/:id', element: <NightCard /> },
  { path: '/reservations', element: <MyReservations /> },
  { path: '/login', element: <Login /> },
]);

ReactDOM.createRoot(document.getElementById('root')).render(<RouterProvider router={router} />);
