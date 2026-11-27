import React from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../queryClient';
import { loadRuntimeConfig } from '../config/runtimeConfig';
import { ThemeProvider } from '../theme/useTheme';
import { YardPage } from '../pages/YardPage';

type Props = {
  theme: 'light' | 'dark';
  initialBlock?: string;
  onContainerSelect?: (containerNumber: string) => void;
};

void loadRuntimeConfig();

/** Карта площадки для встраивания в хост: тему задаёт хост, выбор контейнера уходит ему колбэком. */
export default function YardMapRemote({ theme, initialBlock, onContainerSelect }: Props) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider forced={theme}>
        <YardPage initialBlock={initialBlock} onContainerSelect={onContainerSelect} />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
