# Интеграция темы kayer.ua с external checkout

## Шаг 1: Подключите единый checkout

В Shopify Admin → Online Store → Themes → Edit code → `theme.liquid`, перед `</body>`:

```liquid
<script src="https://checkout.kayer.ua/kayer-checkout.js" defer></script>
```

## Шаг 2: Замените кнопку Checkout

### Вариант A: cart drawer / cart page

Найдите кнопку оформления заказа и добавьте атрибут:

```html
<button type="button" data-kayer-checkout>
  Оформити замовлення
</button>
```

Скрипт `kayer-checkout.js` автоматически перехватит клики на `[data-kayer-checkout]`.

### Вариант B: программный вызов

```javascript
window.KayerCheckout.redirectToCheckout();
```

## Шаг 3: Настройка (опционально)

Перед загрузкой скрипта можно переопределить конфиг:

```html
<script>
  window.KAYER_CHECKOUT_CONFIG = {
    checkoutApiUrl: 'https://checkout.kayer.ua',
    shopDomain: 'kayer.myshopify.com',
    pricingTokenUrl: '/apps/kayer-checkout-auth',
    customerId: {% if customer %}'{{ customer.id }}'{% else %}''{% endif %},
    customerEmail: {% if customer %}'{{ customer.email | escape }}'{% else %}''{% endif %},
    customerFirstName: {% if customer %}'{{ customer.first_name | escape }}'{% else %}''{% endif %},
    customerLastName: {% if customer %}'{{ customer.last_name | escape }}'{% else %}''{% endif %},
    customerPhone: {% if customer and customer.phone %}'{{ customer.phone | escape }}'{% else %}''{% endif %},
  };
</script>
<script src="https://checkout.kayer.ua/kayer-checkout.js" defer></script>
```

## Как это работает

1. Скрипт читает `/cart.js` на kayer.ua
2. Скрипт добавляет на cart/cart drawer блок “Потрібен рахунок для ФОП або компанії?”
3. Для ФОП/компаний сохраняет `buyer_type`, `payment_preference` и реквизиты в Shopify cart attributes через `/cart/update.js`
4. POST `https://checkout.kayer.ua/api/public/checkout-sessions`
5. Редирект на `/checkout/{token}`

## B2B/FOP flow

Если Shopify Plus не используется, нативный checkout не кастомизируется напрямую. B2B/FOP выбор живёт на cart/cart drawer и в external checkout:

- `buyer_type=individual` — обычный B2C flow с оплатой картой
- `buyer_type=fop_company` + `payment_preference=bank_invoice` — создаётся pending Shopify order, генерируется рахунок, клиент получает email и видит thank-you состояние “очікуємо оплату за рахунком”
- `buyer_type=fop_company` + `payment_preference=card` — данные ФОП сохраняются, заказ помечается как `B2B_FOP_CARD_PAYMENT` / `CARD_PAID_NEEDS_ACCOUNTING_REVIEW`

Cart/order attributes:

- `buyer_type`
- `payment_preference`
- `fop_name`
- `fop_tax_id`
- `fop_legal_address`
- `docs_email` (автоматично береться з контактного email)
- `customer_email`
- `customer_first_name`
- `customer_last_name`
- `customer_phone`
- `accounting_comment`

## Отладка

Откройте DevTools → Network. При клике «Оформити» должен быть запрос к `checkout-sessions` со статусом 200.
