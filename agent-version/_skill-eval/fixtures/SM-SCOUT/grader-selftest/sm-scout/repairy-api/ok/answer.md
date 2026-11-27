NestJS + Prisma. Брокера сообщений в зависимостях нет — строк по топикам нет.

контракт :: @(Get|Post|Put|Patch|Delete)\( :: *.ts :: ключ
сущности :: ^model\s+\w+ :: *.prisma :: ключ
задачи :: @(Cron|Interval|Timeout)\( :: *.ts :: ключ
