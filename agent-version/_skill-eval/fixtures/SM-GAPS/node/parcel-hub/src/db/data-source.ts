import { DataSource } from 'typeorm';
import config from 'config';
import { Parcel } from './parcel.entity';
import { Courier } from './courier.entity';

export const dataSource = new DataSource({ type: 'postgres', url: config.get<string>('db.url'), entities: [Parcel, Courier] });
