import config from 'config';
import { kafka, topics } from './client';
import { onParcelScanned } from '../handlers/parcel-scanned';
import { onRouteAssigned } from '../handlers/route-assigned';
import { onCourierStatus } from '../handlers/courier-status';

const handlers: Record<string, (payload: any) => Promise<void>> = {
  [topics.parcelScanned]: onParcelScanned,
  [topics.routeAssigned]: onRouteAssigned,
  [topics.courierStatus]: onCourierStatus,
};

// Одна группа на все входящие топики; сообщение подтверждается после обработки, ошибка — повтор kafkajs (5 попыток).
export async function startConsumers() {
  const consumer = kafka.consumer({ groupId: config.get<string>('kafka.group'), retry: { retries: 5 } });
  await consumer.connect();
  for (const topic of Object.keys(handlers)) await consumer.subscribe({ topic });
  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      await handlers[topic](JSON.parse(message.value!.toString()));
    },
  });
}
