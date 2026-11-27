<!-- service-map: часть 07 2026-10-04 -->
# Опись billing (backend)

## Эндпоинты

GET /v1/invoices — http/InvoiceController.kt
  сущности: → Invoice целиком — domain/Invoice.kt
  · total не считает отменённые — domain/InvoiceRepository.kt
POST /v1/invoices — http/InvoiceController.kt
  сущности: ← CreateInvoiceRequest · → Invoice — domain/Invoice.kt
  · повтор номера даёт 409 — http/ErrorHandler.kt
GET /v1/invoices/:id — http/InvoiceController.kt
  сущности: → Invoice — domain/Invoice.kt
POST /v1/payments/refund — http/PaymentController.kt
  сущности: ← RefundRequest · → Payment — domain/Payment.kt
  · возврат только по проведённому платежу — domain/PaymentService.kt
GET /healthz — http/HealthController.kt
  (фактов нет — служебный)

## Потребляемые топики

потребляет partner.disabled — messaging/PartnerListener.kt
  · группа billing-partner — resources/application.yaml

## Публикуемые топики

публикует invoice.paid — messaging/InvoiceProducer.kt
  · ключ партиции invoiceId — messaging/InvoiceProducer.kt

## Фоновые задачи

closeOverdue — jobs/CloseOverdueJob.kt
  · 0 3 * * * — resources/application.yaml

## Сущности

Invoice — domain/Invoice.kt (@Entity)
  · номер уникален — db/V3__invoice.sql
Payment — domain/Payment.kt (@Entity)

## Роли

ACCOUNTANT — security/Roles.kt
без входа — http/PublicController.kt

## Экраны
(нет — тип backend)

## Бизнес-правила

состояние: Invoice.status DRAFT | ISSUED | PAID — domain/Invoice.kt
состояние: Payment.status NEW | DONE — domain/Payment.kt
справочник: Invoice.currency RUB | USD — domain/Invoice.kt
сообщение: «счёт оплачен» — плательщику, событие invoice.paid — messaging/InvoiceProducer.kt
ограничение: выставление счетов партнёру отключено — переключатель: partner-registry — integration/PartnerGate.kt

## Итоги

⟹ эндпоинтов 5, из них с фактами 3
⟹ топиков 2, из них с фактами 2
⟹ фоновых задач 1, из них с фактами 1
⟹ сущностей 2
⟹ состояний 2 (значений 5), справочников 1, сообщений 1, ограничений 1
