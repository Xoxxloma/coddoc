import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('parcels')
export class Parcel {
  @PrimaryColumn() track!: string;
  @Column({ default: 'CREATED' }) status!: 'CREATED' | 'IN_TRANSIT' | 'DELIVERED' | 'LOST';
  @Column({ nullable: true }) lastPoint?: string;
  @Column({ nullable: true }) courierId?: number;
}
