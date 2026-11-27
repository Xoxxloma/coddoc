import { Database } from 'fixture-database';
export const db = new Database({ url: process.env.DATABASE_URL });
