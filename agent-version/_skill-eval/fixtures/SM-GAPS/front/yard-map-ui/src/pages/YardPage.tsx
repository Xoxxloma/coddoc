import React, { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { useQuery } from '@tanstack/react-query';
import { yardApi } from '../api/yardApi';
import { yardStore } from '../stores/yardStore';
import { LayerPicker } from '../components/LayerPicker';
import { SearchBox } from '../components/SearchBox';
import { ContainerCard } from '../components/ContainerCard';
import { YardCanvas } from '../components/YardCanvas';
import { useDriversLayer } from '../hooks/useDriversLayer';
import blocks from '../assets/blocks.json';

export const YardPage = observer(({ initialBlock, onContainerSelect }: { initialBlock?: string; onContainerSelect?: (n: string) => void }) => {
  const showContainers = yardStore.categories.has('containers') || yardStore.categories.has('reefers');
  const containers = useQuery({ queryKey: ['containers', initialBlock], queryFn: () => yardApi.containers(initialBlock), enabled: showContainers });
  const cranes = useQuery({ queryKey: ['cranes'], queryFn: yardApi.cranes, enabled: yardStore.categories.has('cranes') });
  const gates = useQuery({
    queryKey: ['gates', yardStore.periodFrom, yardStore.periodTo],
    queryFn: () => yardApi.gateEvents(yardStore.periodFrom, yardStore.periodTo),
    enabled: yardStore.categories.has('gates'),
  });
  const drivers = useDriversLayer(yardStore.categories.has('drivers'));

  useEffect(() => () => yardStore.reset(), []);

  const visible = (containers.data ?? []).filter((c) =>
    (yardStore.categories.has('containers') && !c.reefer) || (yardStore.categories.has('reefers') && c.reefer));

  return (
    <div className="yard">
      <aside>
        <SearchBox />
        <LayerPicker />
      </aside>
      <YardCanvas
        blocks={blocks}
        containers={visible}
        cranes={cranes.data ?? []}
        gateEvents={gates.data ?? []}
        drivers={drivers.data}
        onContainerClick={(n) => {
          yardStore.select(n);
          onContainerSelect?.(n);
        }}
      />
      {yardStore.selectedContainer && <ContainerCard number={yardStore.selectedContainer} />}
    </div>
  );
});
