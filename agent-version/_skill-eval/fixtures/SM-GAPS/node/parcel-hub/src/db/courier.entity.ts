import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('couriers')
export class Courier {
  @PrimaryColumn() id!: number;
  @Column({ default: 'OFF' }) status!: 'ON_SHIFT' | 'BREAK' | 'OFF';
}
