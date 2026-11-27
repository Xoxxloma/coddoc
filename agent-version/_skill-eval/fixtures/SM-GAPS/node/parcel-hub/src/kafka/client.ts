import { Kafka } from 'kafkajs';
import config from 'config';

export const kafka = new Kafka({
  clientId: config.get<string>('kafka.clientId'),
  brokers: config.get<string[]>('kafka.brokers'),
});

// Имена топиков — только из конфига: ключ (parcelScanned, …) → имя в шине.
export const topics = config.get<Record<string, string>>('kafka.topics');
