import React from 'react';
import { useRoutes } from 'react-router-dom';
import { YardPage } from '../pages/YardPage';
import { MovesPage } from '../pages/MovesPage';
import { GatesPage } from '../pages/GatesPage';
import { DrawSandboxPage } from '../pages/DrawSandboxPage';

export const routesList = [
  { path: '/yard', element: <YardPage /> },
  { path: '/moves', element: <MovesPage /> },
  { path: '/gates', element: <GatesPage /> },
  { path: '/sandbox/draw', element: <DrawSandboxPage /> },
  { path: '*', element: <div>Страница не найдена</div> },
];

export const AppRoutes = () => useRoutes(routesList);
