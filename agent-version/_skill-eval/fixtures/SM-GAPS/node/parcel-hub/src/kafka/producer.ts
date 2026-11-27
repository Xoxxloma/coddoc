import { kafka, topics } from './client';

const producer = kafka.producer({ idempotent: true });
let ready: Promise<void> | null = null;

// Ключ сообщения — трек-номер, чтобы события одной посылки шли по порядку.
export async function publish(key: 'parcelDelivered' | 'parcelLost', body: { track: string; [k: string]: unknown }) {
  ready ??= producer.connect();
  await ready;
  await producer.send({ topic: topics[key], messages: [{ key: body.track, value: JSON.stringify(body) }] });
}
