# A/B Checkout Router — Chekly vs Custom

## Архитектура

```
kayer.ua cart / drawer
        ↓ checkout-ab-intercept.js
/apps/checkout-ab  (Shopify App Proxy)
        ↓ sticky assignment + bridge HTML
   cart/update.js (ab_test, ab_variant, ab_visitor_id)
        ↓
A: Chekly URL          B: custom checkout session
```

## Shopify App Proxy

Partner Dashboard → App setup → App proxy:

| Поле | Значение |
|------|----------|
| Subpath prefix | `apps` |
| Subpath | `checkout-ab` |
| Proxy URL | `https://checkout.kayer.ua/apps/checkout-ab` |

## Theme

В `theme.liquid` перед `</body>`:

```liquid
<script src="https://checkout.kayer.ua/checkout-ab-intercept.js" defer></script>
```

Уберите прямой `kayer-checkout.js`, если используете router.

## Показ только определенным клиентам

По умолчанию `audienceMode: "all"` — скрипт перехватывает checkout у всех и дальше router делит трафик по `CHEKLY_WEIGHT` / `CUSTOM_WEIGHT`.

Для закрытого запуска добавьте перед script Liquid-конфиг. Например, только клиентам с Shopify customer tag `custom_checkout_beta`:

```liquid
<script>
  window.KAYER_CHECKOUT_AB_CONFIG = {
    routerUrl: "/apps/checkout-ab",
    fallbackUrl: "/checkout",
    audienceMode: "customer_tags",
    allowedCustomerTags: ["custom_checkout_beta"],
    customerTags: [{% if customer %}{% for tag in customer.tags %}"{{ tag | escape }}"{% unless forloop.last %},{% endunless %}{% endfor %}{% endif %}],
    customerEmail: {% if customer %}"{{ customer.email | escape }}"{% else %}""{% endif %},
    customerFirstName: {% if customer %}"{{ customer.first_name | escape }}"{% else %}""{% endif %},
    customerLastName: {% if customer %}"{{ customer.last_name | escape }}"{% else %}""{% endif %},
    customerPhone: {% if customer and customer.phone %}"{{ customer.phone | escape }}"{% else %}""{% endif %},
    showB2BBlock: true
  };
</script>
<script src="https://checkout.kayer.ua/checkout-ab-intercept.js" defer></script>
```

Варианты `audienceMode`:

| Mode | Что делает |
|------|------------|
| `all` | Все клиенты попадают в router |
| `disabled` | Никого не перехватывать, работает текущий checkout |
| `customer_tags` | Только клиенты с тегами из `allowedCustomerTags` |
| `customer_emails` | Только emails из `allowedCustomerEmails` |
| `customer_tags_or_emails` | Тег или email |
| `query_param` | Только если в URL есть `?custom_checkout=1` |

Для QA:

```text
https://kayer.ua/cart?custom_checkout=1
https://kayer.ua/cart?force_checkout=custom
https://kayer.ua/cart?force_checkout=chekly
```

`force_checkout` всегда перебивает audience rules.

## Env

```env
CHECKOUT_AB_EXPERIMENT_ID=checkout_router_2026_06
CHEKLY_WEIGHT=95
CUSTOM_WEIGHT=5
CUSTOM_CHECKOUT_ENABLED=true
CHEKLY_CHECKOUT_URL=/checkout
KAYER_SHOP_DOMAIN=kayer.myshopify.com
```

## Rollout (безопасно)

| Дни | Chekly | Custom |
|-----|--------|--------|
| 1–2 | 95% | 5% |
| 3–4 | 90% | 10% |
| 5–7 | 75% | 25% |
| Потом | 50% | 50% |

Меняйте `CHEKLY_WEIGHT` / `CUSTOM_WEIGHT` на Vercel.

## Smoke test

```
https://kayer.ua/apps/checkout-ab?force_checkout=chekly
https://kayer.ua/apps/checkout-ab?force_checkout=custom
```

Или с витрины: `?force_checkout=custom` в URL страницы.

## Kill switch

`CUSTOM_CHECKOUT_ENABLED=false` — все идут в Chekly.

Дополнительный storefront kill switch:

```liquid
window.KAYER_CHECKOUT_AB_CONFIG = { audienceMode: "disabled" };
```

## Метрики

Admin → **A/B Checkout** или `GET /api/merchant/checkout-ab/metrics`

Главная метрика:

```
conversion_to_paid_order = payment_success / checkout_click
revenue_per_checkout_click = paid_revenue / checkout_clicks
```

## Shopify order attribution

Custom checkout пишет в order:

**tags:** `ab_checkout_router_2026_06`, `ab_variant_custom`, `checkout_custom_v1`

**note_attributes:** `ab_test`, `ab_variant`, `ab_visitor_id`

Для Chekly проверьте на 3–5 тестовых заказах, пробрасывает ли он cart attributes.

## Stop conditions

- error rate custom > Chekly + 2–3 п.п. → стоп
- payment callback / order creation падает → стоп
- revenue_per_checkout_click ниже на 10–15% → откат

## Fallback

Любая ошибка router/bridge → редирект в Chekly (`CHEKLY_CHECKOUT_URL`).
