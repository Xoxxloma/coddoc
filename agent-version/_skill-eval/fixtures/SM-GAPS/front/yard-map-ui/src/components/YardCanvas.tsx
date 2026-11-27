import React, { useEffect, useRef } from 'react';
import { loadMapLibrary } from '../map/loadMap';
import { URL_CONFIG } from '../config/runtimeConfig';
import type { Container, Crane, GateEvent } from '../api/yardApi';

type Props = {
  blocks: unknown;
  containers: Container[];
  cranes: Crane[];
  gateEvents: GateEvent[];
  drivers: { id: string; lat: number; lon: number }[];
  onContainerClick: (number: string) => void;
};

declare const VendorMap: any;

export function YardCanvas(props: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let map: any;
    loadMapLibrary().then(() => {
      map = new VendorMap(ref.current, { style: URL_CONFIG.mapTilesStyle, zoom: 17 });
      map.addGeoJson(props.blocks);
      props.containers.forEach((c) => map.addMarker({ id: c.number, kind: c.reefer ? 'reefer' : 'container', onClick: () => props.onContainerClick(c.number) }));
      props.cranes.forEach((k) => map.addMarker({ id: `crane-${k.id}`, kind: k.busy ? 'crane-busy' : 'crane' }));
      props.gateEvents.forEach((g) => map.addMarker({ id: `gate-${g.id}`, kind: g.direction === 'IN' ? 'gate-in' : 'gate-out' }));
      props.drivers.forEach((d) => map.addMarker({ id: d.id, kind: 'driver', lat: d.lat, lon: d.lon }));
    });
    return () => map?.destroy();
  }, [props.containers, props.cranes, props.gateEvents, props.drivers]);
  return <div ref={ref} style={{ height: '100%' }} />;
}
