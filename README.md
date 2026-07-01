# UA Checkout — External Shopify Checkout for Ukraine

Chekly-like external checkout for Shopify stores with Ukrainian payment providers (Monobank, LiqPay), Nova Poshta shipping, Checkbox fiscalization, and Shopify `orderCreate` integration.

## Stack

- **Next.js 16** (App Router) — admin, checkout UI, API
- **PostgreSQL** + **Prisma** — data store
- **Redis** + **BullMQ** — async jobs (payments, orders, fiscal)
- **Shopify Admin API** — OAuth, order creation

## Quick Start

### 1. Prerequisites

- Node.js 20+
- Docker (for Postgres + Redis)
- Shopify Partner account + dev store

### 2. Setup

```bash
cp .env.example .env
# Edit .env with your Shopify API credentials

npm install
npm run docker:up
npm run db:push
npm run dev
```

In a separate terminal:

```bash
npm run worker
```

### 3. Shopify App Configuration

1. Create a custom app in [Shopify Partners](https://partners.shopify.com/)
2. Set **App URL**: `http://localhost:3000`
3. Set **Allowed redirection URL(s)**: `http://localhost:3000/api/auth/shopify/callback`
4. Copy API key and secret to `.env`
5. Install: open `http://localhost:3000/api/auth/shopify/install?shop=YOUR-STORE.myshopify.com`

### 4. Create a checkout session

```bash
curl -X POST http://localhost:3000/api/public/checkout-sessions \
  -H "Content-Type: application/json" \
  -d '{
    "shopDomain": "your-store.myshopify.com",
    "cartLines": [
      { "variantGid": "gid://shopify/ProductVariant/123", "quantity": 1 }
    ]
  }'
```

Open the returned `checkoutUrl` in browser.

## Project Structure

```
app/
  (admin)/admin/     — Merchant admin panel
  (checkout)/checkout/ — Public checkout + thank-you
  api/               — REST API (auth, merchant, public, callbacks, jobs)
lib/
  checkout/          — Session service, pricing, state machine
  payments/          — Monobank, LiqPay adapters
  shipping/          — Nova Poshta integration
  fiscal/            — Checkbox fiscalization
  shopify/           — OAuth, order writer
  queue/             — BullMQ setup
workers/             — Background job processor
```

## API Routes

| Route | Description |
|-------|-------------|
| `POST /api/public/checkout-sessions` | Create checkout session |
| `GET/PATCH /api/public/checkout-sessions/:token` | Read/update session |
| `POST /api/public/checkout-sessions/:token/payments/init` | Initiate payment |
| `POST /api/callbacks/liqpay` | LiqPay webhook |
| `POST /api/callbacks/monobank` | Monobank webhook |
| `POST /api/internal/jobs` | Run reconcile jobs (requires `x-internal-secret` header) |

## Payment Provider Setup

Configure via admin API after install:

```bash
curl -X PATCH http://localhost:3000/api/merchant/payments \
  -H "Content-Type: application/json" \
  -b "checkout_merchant_session=..." \
  -d '{
    "provider": "MONOBANK",
    "isEnabled": true,
    "config": { "token": "your_mono_token" }
  }'
```

## Order Flow

1. Storefront creates checkout session with cart lines
2. Buyer fills contacts, selects Nova Poshta branch, chooses payment
3. Payment provider callback confirms payment (idempotent)
4. BullMQ job creates Shopify order via `orderCreate`
5. Fiscal job creates Checkbox receipt
6. Server-side GA4/Meta purchase event fired

## KAYER B2B/FOP invoice flow

This MVP supports a separate FOP/company path without customizing native Shopify Checkout:

1. `public/kayer-checkout.js` injects the “Покупаєте як ФОП або компанія?” block on cart/cart drawer and stores B2B fields as Shopify cart attributes.
2. External checkout persists those fields in `CheckoutSession.customAttributes`.
3. For `payment_preference=bank_invoice`, the app creates a pending Shopify order, creates one idempotent invoice PDF, stores it in Supabase Storage, sends it with Resend, and tags/metafields the order.
4. `/api/cron/reconcile-bank-payments` fetches bank transactions through the provider interface and matches by invoice number, amount and payer name.
5. After a confirmed bank match, the app tags the order as `PAYMENT_MATCHED` / `BANK_TRANSFER_PAID`, creates a delivery note PDF, emails documents, and marks the internal status `READY_TO_FULFILL_AFTER_BANK_PAYMENT`.

Shopify webhooks:

| Topic | Route |
|-------|-------|
| `orders/create` | `POST /api/shopify/webhooks/orders-create` |
| `orders/paid` | `POST /api/shopify/webhooks/orders-paid` |
| `orders/cancelled` | `POST /api/shopify/webhooks/orders-cancelled` |
| `refunds/create` | `POST /api/shopify/webhooks/refunds-create` |

All B2B webhook routes verify Shopify HMAC, store `processed_webhooks`, and are retry-safe.

Manual CSV reconciliation:

```bash
curl -X POST http://localhost:3000/api/admin/b2b-orders/import-bank-csv \
  -H "x-internal-secret: $INTERNAL_JOBS_SECRET" \
  -H "Content-Type: text/csv" \
  --data-binary @bank-statement.csv
```

Expected CSV headers:

```csv
transaction_id,transaction_date,payer_name,payer_tax_id,amount,currency,payment_description,iban_from,iban_to
```

Important Shopify note: without Shopify Plus, this implementation does not modify native Shopify Checkout. B2B/FOP selection is collected before checkout and persisted through cart/order attributes and order metafields. Automatic “mark paid” is not spoofed; bank-paid orders are made operationally clear through tags and `kayer_b2b` metafields.

## Testing

```bash
npm test
```

## Production Notes

- Use ngrok or a real domain for payment callbacks
- Rotate `SESSION_SECRET` and `ENCRYPTION_KEY`
- Run worker process separately from Next.js
- For Shopify App Store: migrate billing to Shopify App Pricing

## License

Private — all rights reserved.

## KAYER rollout (LiqPay + Nova Poshta)

Документация по внедрению для **kayer.ua**:

| Документ | Описание |
|----------|----------|
| [docs/kayer/CREDENTIALS.md](docs/kayer/CREDENTIALS.md) | Чеклист ключей и доступов |
| [docs/kayer/DEPLOY.md](docs/kayer/DEPLOY.md) | Vercel + Railway (`vercel.json`, `railway.toml`) |
| [docs/kayer/SHOPIFY_SETUP.md](docs/kayer/SHOPIFY_SETUP.md) | OAuth и установка app |
| [docs/kayer/THEME_INTEGRATION.md](docs/kayer/THEME_INTEGRATION.md) | `kayer-checkout.js` + theme snippet |
| [docs/kayer/E2E_TEST.md](docs/kayer/E2E_TEST.md) | Приёмочный тест |
| [docs/kayer/CHECKOUT_AB.md](docs/kayer/CHECKOUT_AB.md) | A/B router Chekly vs custom |
| [docs/kayer/B2B_LAUNCH_RUNBOOK.md](docs/kayer/B2B_LAUNCH_RUNBOOK.md) | B2B/FOP setup: Supabase, Shopify, Resend, bank, DiloShop |
| [docs/kayer/GO_LIVE.md](docs/kayer/GO_LIVE.md) | Production checklist |

Shopify install URL:

```bash
node scripts/print-shopify-install-url.mjs kayer.myshopify.com
```

Health check после deploy: `GET /api/health`
