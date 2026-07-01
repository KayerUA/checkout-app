# Подключение Shopify магазина KAYER

## 1. Создайте Custom App

1. https://partners.shopify.com → Apps → Create app → Custom app
2. App URL: `https://checkout.kayer.ua`
3. Allowed redirection URL: `https://checkout.kayer.ua/api/auth/shopify/callback`
4. Scopes (Admin API):
   - `read_products`, `read_orders`, `write_orders`
   - `read_inventory`, `read_customers`
   - `write_draft_orders`, `read_locations`

## 2. Установите app на магазин

Замените `YOUR-SHOP` на реальный myshopify domain:

```
https://checkout.kayer.ua/api/auth/shopify/install?shop=YOUR-SHOP.myshopify.com
```

После OAuth вы попадёте в `/admin` — merchant создан в БД.

## 3. Webhooks (опционально)

В Partner dashboard добавьте webhook:

- URL: `https://checkout.kayer.ua/api/callbacks/shopify/webhooks`
- Topic: `app/uninstalled`

## 4. Проверка

- Admin Dashboard показывает shop domain
- `GET /api/health` → `{ "status": "ok", "service": "kayer-checkout" }`
- Install URL: `node scripts/print-shopify-install-url.mjs YOUR-SHOP.myshopify.com`
- Тестовый checkout session создаётся через API или корзину
