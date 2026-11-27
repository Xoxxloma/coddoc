import React from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../queryClient';
import { MovesPage } from '../pages/MovesPage';
import type { MovePlan } from '../api/yardApi';

type Props = {
  terminalId: string;
  onPlanSaved?: (plan: MovePlan) => void;
};

export default function MovePlannerRemote({ terminalId, onPlanSaved }: Props) {
  return (
    <QueryClientProvider client={queryClient}>
      <MovesPage terminalId={terminalId} onPlanSaved={onPlanSaved} />
    </QueryClientProvider>
  );
}
