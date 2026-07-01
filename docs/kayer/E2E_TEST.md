# E2E тест — kayer checkout

## Предусловия

- App установлен на Shopify (`/admin` показывает shop)
- LiqPay sandbox настроен в Admin → Payments
- NP API key + sync справочника выполнен
- `npm run dev` + `npm run worker` (локально) или staging deploy

## Сценарий 1: API (без theme)

```bash
curl -X POST http://localhost:3000/api/public/checkout-sessions \
  -H "Content-Type: application/json" \
  -d '{
    "shopDomain": "YOUR-SHOP.myshopify.com",
    "cartLines": [
      { "variantGid": "gid://shopify/ProductVariant/VARIANT_ID", "quantity": 1 }
    ]
  }'
```

Откройте `checkoutUrl` из ответа.

## Сценарий 2: Через корзину (с theme snippet)

1. Добавьте товар на kayer.ua
2. Нажмите «Оформити замовлення» (`data-kayer-checkout`)
3. Должен открыться `checkout.kayer.ua/checkout/...`

## Сценарий 3: Полный flow

1. Заполните контакты
2. Выберите город и отделение НП
3. Нажмите «Оформити замовлення»
4. Оплатите в LiqPay sandbox
5. Thank-you страница
6. Заказ в Shopify Admin

## Ожидаемые customAttributes в Shopify order

- `np_branch_ref`
- `np_branch_name`
- `payment_provider`: `LIQPAY`
- `checkout_session_id`

## Если callback не приходит

- `APP_URL` должен совпадать с публичным HTTPS URL
- LiqPay `server_url` = `{APP_URL}/api/callbacks/liqpay`
- Worker должен быть запущен (создание заказа в очереди)
