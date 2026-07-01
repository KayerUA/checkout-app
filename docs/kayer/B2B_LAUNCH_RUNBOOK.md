# KAYER B2B/FOP Checkout — инструкция запуска

Цель: Shopify остаётся витриной, этот app становится checkout/B2B middleware, Supabase хранит состояние и PDF, Resend отправляет рахунки, банк/CSV делает сверку оплат, Нова Пошта и ДілоShop/Діловод подключаются как downstream-сервисы.

## 0. Как это должно работать

```
kayer.ua cart/drawer
  ↓ checkout-ab-intercept.js
Shopify App Proxy /apps/checkout-ab
  ↓
Custom checkout на checkout.kayer.ua
  ↓
Shopify order + Supabase b2b_orders
  ↓
PDF рахунок + email клиенту
  ↓
Bank statement / CSV reconciliation
  ↓
Shopify tags/metafields + docs + ready to fulfill
  ↓
Nova Poshta / DiloShop / Dilovod integration
```

Не кастомизируем native Shopify Checkout без Shopify Plus. Выбор ФОП/компания и реквизиты собираются до checkout: cart/drawer + external checkout.

## 1. Supabase

Создать проект Supabase.

### Database

Supabase → Project Settings → Database → Connection string → URI.

В Vercel/локальный `.env`:

```env
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@YOUR_HOST:5432/postgres
```

Для первого запуска схемы:

```bash
npm run db:generate
npx prisma db push
```

Альтернатива: открыть Supabase SQL Editor и выполнить:

```text
supabase/migrations/202607010001_b2b_fop_workflow.sql
```

Рекомендуемый путь — `prisma db push`, потому что проект уже работает через Prisma.

### Storage

Supabase → Storage → Create bucket:

```text
b2b-documents
```

Bucket должен быть private.

Supabase → Project Settings → API:

```env
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=service_role_key
SUPABASE_ANON_KEY=anon_key
SUPABASE_DOCUMENTS_BUCKET=b2b-documents
```

`SERVICE_ROLE_KEY` вводить только в backend env. Не вставлять в Shopify theme.

## 2. Shopify app keys

Shopify Admin → Apps → Develop apps → создать custom app.

Нужные Admin API scopes:

```text
read_products
read_orders
write_orders
read_inventory
read_customers
write_draft_orders
read_locations
```

Если Shopify попросит отдельные права для metafields, добавить order metafields write/read permissions.

После установки app взять Admin API access token:

```env
SHOPIFY_SHOP_DOMAIN=kayer.myshopify.com
SHOPIFY_ADMIN_ACCESS_TOKEN=shpat_xxx
SHOPIFY_API_VERSION=2026-01
```

Если используете OAuth app из Partner dashboard:

```env
SHOPIFY_API_KEY=client_id
SHOPIFY_API_SECRET=client_secret
SHOPIFY_WEBHOOK_SECRET=webhook_secret_or_client_secret
SHOPIFY_SCOPES=read_products,read_orders,write_orders,read_inventory,read_customers,write_draft_orders,read_locations
```

`SHOPIFY_API_SECRET` также используется для App Proxy signature. Если отдельного webhook secret нет, можно временно поставить то же значение в `SHOPIFY_WEBHOOK_SECRET`.

## 3. Shopify App Proxy

Shopify Partner Dashboard или custom app setup → App proxy:

| Поле | Значение |
|---|---|
| Subpath prefix | `apps` |
| Subpath | `checkout-ab` |
| Proxy URL | `https://checkout.kayer.ua/apps/checkout-ab` |

Проверка:

```text
https://kayer.ua/apps/checkout-ab?force_checkout=custom
```

## 4. Shopify webhooks

Shopify Admin → Settings → Notifications → Webhooks или app webhooks:

| Topic | URL |
|---|---|
| Order creation | `https://checkout.kayer.ua/api/shopify/webhooks/orders-create` |
| Order payment | `https://checkout.kayer.ua/api/shopify/webhooks/orders-paid` |
| Order cancellation | `https://checkout.kayer.ua/api/shopify/webhooks/orders-cancelled` |
| Refund creation | `https://checkout.kayer.ua/api/shopify/webhooks/refunds-create` |

Все routes проверяют HMAC и записывают `processed_webhooks`.

## 5. Vercel env

Vercel → Project → Settings → Environment Variables.

Минимальный production набор:

```env
APP_URL=https://checkout.kayer.ua
NODE_ENV=production

DATABASE_URL=
REDIS_URL=

SESSION_SECRET=random_32_plus_chars
ENCRYPTION_KEY=64_hex_chars
INTERNAL_JOBS_SECRET=random_16_plus_chars
CRON_SECRET=random_16_plus_chars

SHOPIFY_API_KEY=
SHOPIFY_API_SECRET=
SHOPIFY_SHOP_DOMAIN=kayer.myshopify.com
SHOPIFY_ADMIN_ACCESS_TOKEN=
SHOPIFY_WEBHOOK_SECRET=
SHOPIFY_API_VERSION=2026-01

SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_ANON_KEY=
SUPABASE_DOCUMENTS_BUCKET=b2b-documents

RESEND_API_KEY=
DOCUMENTS_FROM_EMAIL=docs@kayer.ua

SELLER_NAME=ФОП Стаднік Людмила Миколаївна
SELLER_TAX_ID=2341822588
SELLER_IBAN=UA273052990000026005035040022
SELLER_BANK_NAME=АТ КБ "ПРИВАТБАНК", м.Київ
SELLER_LEGAL_ADDRESS=04074, м. Київ, вул Автозаводська 7, кв 5
SELLER_PHONE=
SELLER_SIGNATURE_NAME=Стаднік Л.М.

BANK_PROVIDER=mock
BANK_ACCOUNT_IBAN=UA273052990000026005035040022

NOVA_POSHTA_API_KEY=
FISCALIZATION_PROVIDER=noop
```

## 6. Resend

Resend → API Keys → Create API key:

```env
RESEND_API_KEY=re_xxx
DOCUMENTS_FROM_EMAIL=docs@kayer.ua
```

Домен `kayer.ua` или поддомен должен быть verified в Resend, иначе production email может не отправляться.

## 7. Theme snippet: кому показывать checkout

В Shopify theme перед `</body>` подключить только router script:

```liquid
<script>
  window.KAYER_CHECKOUT_AB_CONFIG = {
    routerUrl: "/apps/checkout-ab",
    fallbackUrl: "/checkout",
    audienceMode: "customer_tags",
    allowedCustomerTags: ["custom_checkout_beta"],
    customerTags: [{% if customer %}{% for tag in customer.tags %}"{{ tag | escape }}"{% unless forloop.last %},{% endunless %}{% endfor %}{% endif %}],
    customerEmail: {% if customer %}"{{ customer.email | escape }}"{% else %}""{% endif %},
    showB2BBlock: true
  };
</script>
<script src="https://checkout.kayer.ua/checkout-ab-intercept.js" defer></script>
```

Потом в Shopify Admin → Customers добавить тестовым клиентам tag:

```text
custom_checkout_beta
```

### Варианты audienceMode

| Mode | Что делает |
|---|---|
| `all` | Все идут через router |
| `disabled` | Никого не трогать |
| `customer_tags` | Только клиенты с тегами |
| `customer_emails` | Только emails из списка |
| `customer_tags_or_emails` | Тег или email |
| `query_param` | Только если в URL `?custom_checkout=1` |

QA override:

```text
https://kayer.ua/cart?custom_checkout=1
https://kayer.ua/cart?force_checkout=custom
https://kayer.ua/cart?force_checkout=chekly
```

## 8. A/B rollout env

Если аудитория уже выбрана theme snippet, внутри неё можно включить 100% custom:

```env
CUSTOM_CHECKOUT_ENABLED=true
CUSTOM_WEIGHT=100
CHEKLY_WEIGHT=0
CHEKLY_CHECKOUT_URL=/checkout
KAYER_SHOP_DOMAIN=kayer.myshopify.com
```

Для осторожного rollout:

```env
CUSTOM_WEIGHT=5
CHEKLY_WEIGHT=95
```

Kill switch:

```env
CUSTOM_CHECKOUT_ENABLED=false
```

или в theme:

```js
audienceMode: "disabled"
```

## 9. Банк и сверка оплат

На MVP:

```env
BANK_PROVIDER=mock
BANK_ACCOUNT_IBAN=UA273052990000026005035040022
```

CSV import:

```bash
curl -X POST https://checkout.kayer.ua/api/admin/b2b-orders/import-bank-csv \
  -H "x-internal-secret: YOUR_INTERNAL_JOBS_SECRET" \
  -H "Content-Type: text/csv" \
  --data-binary @bank-statement.csv
```

CSV headers:

```csv
transaction_id,transaction_date,payer_name,payer_tax_id,amount,currency,payment_description,iban_from,iban_to
```

Назначение платежа должно содержать номер заказа:

```text
Оплата замовлення № 60037
```

Система также умеет матчить по invoice number `KAYER-UA-YYYY-NNNNNN`.

Cron:

```text
GET https://checkout.kayer.ua/api/cron/reconcile-bank-payments?secret=YOUR_CRON_SECRET
```

Поставить раз в 15-30 минут через Vercel Cron, cron-job.org или Railway Cron.

## 10. Нова Пошта

API key:

```env
NOVA_POSHTA_API_KEY=
```

В admin:

```text
https://checkout.kayer.ua/admin/shipping
```

Синхронизировать справочник городов/отделений.

Если ДілоShop уже создаёт ТТН, лучше не дублировать создание ТТН в этом app. Тогда этот app должен только передавать order/payment status в ДілоShop, а ТТН остаётся там.

## 11. ДілоShop / Діловод

У вас уже есть отдельный репозиторий:

```text
/Users/imac/Desktop/Скрипитович/diloshop
```

В нём есть готовый Python/Fly сервис:

```text
dilovod_sync/
Dockerfile.dilovod
fly.toml
DILOSHOP.md / README.md
SHOPIFY_DILOVOD_UA_INTEGRATION.md
RUNBOOK_FLY_SYNC.md
```

Его не надо переписывать в Next.js. Правильная схема — оставить `diloshop` отдельным worker/service, а этот checkout app будет отправлять ему событие, когда B2B bank payment подтверждён.

Правильная роль:

| Система | Роль |
|---|---|
| Shopify | Витрина, товары, заказ |
| Custom checkout app | B2B flow, рахунок, payment reconciliation, статус |
| Supabase | Состояние автоматизации и PDF |
| ДілоShop/Діловод | Бухгалтерия, склад, документы, возможно ТТН |
| Нова Пошта | Доставка/ТТН, если не делает ДілоShop |

### Как связать этот checkout app с diloshop

`diloshop` принимает Shopify-compatible webhooks:

```text
POST https://diloshop.fly.dev/webhooks/shopify/orders-dilovod
```

После bank reconciliation этот checkout app отправит туда `orders/paid` payload с:

```text
financial_status=paid
tags=B2B_FOP,BANK_TRANSFER_PAID,PAYMENT_CONFIRMED,diloshop_ready
note_attributes:
  kayer_b2b_bank_transaction_id
  kayer_b2b_payment_status=BANK_TRANSFER_PAID
```

Это не меняет financial status в Shopify. Это только webhook-сигнал для `diloshop`, чтобы его worker с `DILOVOD_ORDER_WORKER_REQUIRE_PAID=1` создал `documents.saleOrder` после реальной банковской сверки.

### Env в checkout app

Vercel env для этого проекта:

```env
ACCOUNTING_PROVIDER=diloshop
DILOSHOP_API_URL=https://diloshop.fly.dev
DILOSHOP_WEBHOOK_URL=https://diloshop.fly.dev/webhooks/shopify/orders-dilovod
DILOSHOP_WEBHOOK_SECRET=same_secret_as_SHOPIFY_WEBHOOK_SECRET_UA_in_diloshop
```

`DILOSHOP_WEBHOOK_SECRET` должен совпадать с `SHOPIFY_WEBHOOK_SECRET_UA` в Fly secrets у `diloshop`.

### Fly secrets в diloshop

В каталоге `/Users/imac/Desktop/Скрипитович/diloshop`:

```bash
fly secrets set -a diloshop \
  DILOVOD_API_KEY="..." \
  SHOPIFY_SHOP_DOMAIN_UA="kayer.myshopify.com" \
  SHOPIFY_ADMIN_TOKEN_UA="shpat_..." \
  SHOPIFY_API_VERSION_UA="2026-01" \
  SHOPIFY_WEBHOOK_SECRET_UA="same_secret_as_DILOSHOP_WEBHOOK_SECRET" \
  DILOVOD_DEFAULT_FIRM_ID="..." \
  DILOVOD_DEFAULT_PERSON_ID="..." \
  DILOVOD_ORDER_WORKER_REQUIRE_PAID="1" \
  DILOVOD_ORDER_WORKER_FINANCIAL_ALLOW="paid,partially_paid" \
  DILOVOD_ORDER_WORKER_POST_SALE_ORDER="1" \
  DILOVOD_SALEORDER_USE_PRODUCT_NUM_FALLBACK="1"
```

Если `diloshop` создаёт ТТН через Нова Пошта, туда же:

```bash
fly secrets set -a diloshop \
  NP_API_KEY="..." \
  NP_SENDER_REF="..." \
  NP_CONTACT_SENDER_REF="..." \
  NP_CONTACT_PHONE="..." \
  NP_SENDER_ADDRESS_REF="..."
```

### Что должно быть включено в diloshop

1. `https://diloshop.fly.dev/health` возвращает `{"ok":true}`.
2. Worker запущен в контейнере.
3. `DILOVOD_ORDER_WORKER_REQUIRE_PAID=1` оставляем включённым.
4. Для товаров есть mapping SKU ↔ Dilovod productNum/good:

```bash
python -m dilovod_sync.mapping_cli link-bulk-productnum --relax-filters
```

или через `/ops/` panel в `diloshop`.

### Прямые Shopify webhooks в diloshop

Можно оставить Shopify → diloshop webhooks для обычных card-paid заказов:

```text
orders/create
orders/updated
orders/paid
orders/cancelled
→ https://diloshop.fly.dev/webhooks/shopify/orders-dilovod
```

Но для B2B bank invoice ключевое событие должно идти из этого checkout app после `BANK_TRANSFER_PAID`, потому что Shopify order может оставаться `financial_status=pending`.

### Что ещё нужно получить/проверить по Діловод

Если чего-то нет в Fly secrets, взять из Діловод:

```text
1. `DILOVOD_API_KEY`
2. `DILOVOD_DEFAULT_FIRM_ID`
3. `DILOVOD_DEFAULT_PERSON_ID`
4. `DILOVOD_SALEORDER_STORAGE_ID`
5. `DILOVOD_SALEORDER_CURRENCY_ID`
6. `DILOVOD_SALEORDER_PAYMENT_FORM_ID`
7. `DILOVOD_SALEORDER_PRICE_TYPE_ID`
8. `DILOVOD_BALANCE_STORAGE_ID`
9. `DILOVOD_BALANCE_ACCOUNT_CODE=281` или точный account id
10. Кто создаёт ТТН: `diloshop` или этот checkout app. Рекомендуется один владелец, не оба.
```

После этого можно заполнить env placeholders:

```env
ACCOUNTING_PROVIDER=diloshop
DILOSHOP_API_URL=https://diloshop.fly.dev
DILOSHOP_WEBHOOK_URL=https://diloshop.fly.dev/webhooks/shopify/orders-dilovod
DILOSHOP_WEBHOOK_SECRET=
```

Не подключайте одновременно создание ТТН в двух местах. Если `diloshop` уже делает Нова Пошта, этот checkout app должен только передавать статус оплаты/заказа.

## 12. Проверка end-to-end

1. Клиенту в Shopify поставить tag `custom_checkout_beta`.
2. Зайти на kayer.ua под этим клиентом.
3. Добавить товар в cart.
4. Увидеть блок “Покупаєте як ФОП або компанія?”
5. Выбрать `ФОП / компанія`.
6. Ввести:

```text
Назва: ТОВ Тест
ЄДРПОУ/ІПН: 12345678
Email: test@example.com
Телефон: +380...
```

7. Выбрать `Оплата за рахунком`.
8. Завершить checkout.
9. Проверить:

```text
Supabase b2b_orders
Supabase b2b_documents
Shopify order tags: B2B_FOP, INVOICE_SENT, WAITING_IBAN_PAYMENT
Email с рахунком
Admin /admin/b2b-orders
```

10. Импортировать CSV с платежом:

```csv
transaction_id,transaction_date,payer_name,payer_tax_id,amount,currency,payment_description,iban_from,iban_to
test-1,2026-07-01T12:00:00Z,ТОВ Тест,12345678,2110.00,UAH,Оплата замовлення № 60037,UA000,UA273052990000026005035040022
```

11. Проверить:

```text
bank_payments.status = MATCHED
b2b_orders.status = READY_TO_FULFILL_AFTER_BANK_PAYMENT
Shopify tags: PAYMENT_MATCHED, BANK_TRANSFER_PAID, DOCS_SENT
```

## 13. Где что смотреть

| Что | Где |
|---|---|
| Checkout UI | `https://checkout.kayer.ua/checkout/{token}` |
| B2B admin | `https://checkout.kayer.ua/admin/b2b-orders` |
| A/B metrics | `https://checkout.kayer.ua/admin/ab-test` |
| Orders | `https://checkout.kayer.ua/admin/orders` |
| Shipping | `https://checkout.kayer.ua/admin/shipping` |
| Health | `https://checkout.kayer.ua/api/health` |
| Logs | Vercel logs + Supabase tables `automation_logs`, `processed_webhooks` |

## 14. Частые ошибки

### PDF не загрузился

Проверить:

```env
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_DOCUMENTS_BUCKET=b2b-documents
```

Bucket должен существовать.

### Email не ушёл

Проверить:

```env
RESEND_API_KEY
DOCUMENTS_FROM_EMAIL
```

И verify domain в Resend.

### Shopify tags/metafields не обновились

Проверить:

```env
SHOPIFY_ADMIN_ACCESS_TOKEN
SHOPIFY_SHOP_DOMAIN
```

И scopes app.

### Заказ не пошёл в custom checkout

Проверить:

```text
theme snippet
customer tag
App Proxy /apps/checkout-ab
CUSTOM_CHECKOUT_ENABLED
CUSTOM_WEIGHT
```

Для QA открыть:

```text
/cart?force_checkout=custom
```

### Сверка оплаты не сработала

Проверить назначение платежа:

```text
Оплата замовлення № {номер заказа}
```

И сумму до копейки.
