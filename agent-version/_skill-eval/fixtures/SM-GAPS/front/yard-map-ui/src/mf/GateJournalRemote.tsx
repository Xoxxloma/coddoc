import React from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../queryClient';
import { ThemeProvider } from '../theme/useTheme';
import { GatesPage } from '../pages/GatesPage';

export default function GateJournalRemote({ theme }: { theme: 'light' | 'dark' }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider forced={theme}>
        <GatesPage />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
