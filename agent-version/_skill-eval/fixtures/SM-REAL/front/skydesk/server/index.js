import express from 'express';
import { router } from './routes.js';

const app = express();
app.use(express.json());
// Все ручки сервиса — под общим префиксом /api.
app.use('/api', router);

const port = Number(process.env.SKYDESK_PORT ?? 4100);
app.listen(port, () => console.log(`skydesk api on ${port}`));
