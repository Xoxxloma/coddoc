GET /v1/orders — api/OrderController.java
  · постранично — api/OrderController.java
POST /v1/orders — OrderController.java
  · без позиций отказ — domain/Order.java
GET /v1/pay — src/api/PayController.java
POST /v1/pay — api/PayController.java + domain/Pay.java
GET /v1/pay/{id} — api/PayController.java
DELETE /v1/pay/{id} — api/PayController.java
GET /v1/pay/{id}/receipt — api/PayController.java
Order — domain/Order.java (@Entity)
