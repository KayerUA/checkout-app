# KAYER — чеклист credentials

Отметьте каждый пункт перед go-live.

## Shopify

- [ ] Partner account: https://partners.shopify.com
- [ ] Custom app создан (не public App Store)
- [ ] `SHOPIFY_API_KEY` и `SHOPIFY_API_SECRET` скопированы в `.env`
- [ ] App URL: `https://checkout.kayer.ua` (или ваш staging URL)
- [ ] Allowed redirect: `https://checkout.kayer.ua/api/auth/shopify/callback`
- [ ] Реальный shop domain: `____________.myshopify.com`

## LiqPay

- [ ] Sandbox keys для теста: `public_key` + `private_key`
- [ ] Production keys (для go-live)
- [ ] В кабинете LiqPay `server_url`: `https://checkout.kayer.ua/api/callbacks/liqpay`
- [ ] Ключи внесены в Admin → Payments

## Нова Пошта

- [ ] API key из https://novaposhta.ua/for-business/cooperation/integration/
- [ ] Ключ в `.env` как `NOVA_POSHTA_API_KEY` или через Admin → Shipping
- [ ] Запущен sync справочника (кнопка в Admin → Shipping)
- [ ] Flat rate доставки согласован (по умолчанию 90 грн)

## Инфраструктура

- [ ] Домен `checkout.kayer.ua` (или `pay.kayer.ua`) с HTTPS
- [ ] `APP_URL` указывает на этот домен
- [ ] PostgreSQL (Railway/Render)
- [ ] Redis (Railway/Render)
- [ ] Worker процесс запущен (`npm run worker`)
- [ ] `SESSION_SECRET`, `ENCRYPTION_KEY`, `INTERNAL_JOBS_SECRET` — уникальные prod-значения

## Dev (локально)

Для теста LiqPay callback на localhost используйте ngrok:

```bash
ngrok http 3000
# APP_URL=https://xxxx.ngrok-free.app
```
