create extension if not exists "pgcrypto";

do $$
begin
  if not exists (select 1 from pg_type where typname = 'MerchantStatus') then
    create type "MerchantStatus" as enum ('ACTIVE', 'SUSPENDED', 'UNINSTALLED');
  end if;
  if not exists (select 1 from pg_type where typname = 'CheckoutStatus') then
    create type "CheckoutStatus" as enum ('DRAFT', 'READY', 'PAYMENT_PENDING', 'PAID', 'COMPLETED', 'ABANDONED');
  end if;
  if not exists (select 1 from pg_type where typname = 'PaymentProvider') then
    create type "PaymentProvider" as enum ('MONOBANK', 'LIQPAY', 'WAYFORPAY', 'COD', 'BANK_INVOICE');
  else
    alter type "PaymentProvider" add value if not exists 'BANK_INVOICE';
  end if;
  if not exists (select 1 from pg_type where typname = 'PaymentStatus') then
    create type "PaymentStatus" as enum ('PENDING', 'PROCESSING', 'PAID', 'FAILED', 'REFUNDED');
  end if;
  if not exists (select 1 from pg_type where typname = 'FiscalStatus') then
    create type "FiscalStatus" as enum ('PENDING', 'PROCESSING', 'DONE', 'FAILED');
  end if;
end;
$$;

create table if not exists "Merchant" (
  "id" text primary key,
  "shopDomain" text not null unique,
  "shopifyShopId" text unique,
  "name" text,
  "status" "MerchantStatus" not null default 'ACTIVE',
  "checkoutBaseUrl" text,
  "defaultCurrency" text not null default 'UAH',
  "defaultLocale" text not null default 'uk',
  "plan" text not null default 'launch',
  "paidOrdersCount" integer not null default 0,
  "themeConfig" jsonb,
  "createdAt" timestamp(3) without time zone not null default current_timestamp,
  "updatedAt" timestamp(3) without time zone not null default current_timestamp
);

create table if not exists "ShopifySession" (
  "id" text primary key,
  "merchantId" text not null unique references "Merchant"("id") on delete cascade on update cascade,
  "accessTokenEncrypted" text not null,
  "scopes" text not null,
  "installedAt" timestamp(3) without time zone not null default current_timestamp
);

create table if not exists "PaymentProviderConfig" (
  "id" text primary key,
  "merchantId" text not null references "Merchant"("id") on delete cascade on update cascade,
  "provider" "PaymentProvider" not null,
  "isEnabled" boolean not null default false,
  "isSandbox" boolean not null default true,
  "config" jsonb not null,
  "createdAt" timestamp(3) without time zone not null default current_timestamp,
  "updatedAt" timestamp(3) without time zone not null default current_timestamp,
  unique ("merchantId", "provider")
);

create table if not exists "ShippingProviderConfig" (
  "id" text primary key,
  "merchantId" text not null references "Merchant"("id") on delete cascade on update cascade,
  "provider" text not null,
  "isEnabled" boolean not null default false,
  "config" jsonb not null,
  "createdAt" timestamp(3) without time zone not null default current_timestamp,
  "updatedAt" timestamp(3) without time zone not null default current_timestamp,
  unique ("merchantId", "provider")
);

create table if not exists "FiscalConfig" (
  "id" text primary key,
  "merchantId" text not null unique references "Merchant"("id") on delete cascade on update cascade,
  "isEnabled" boolean not null default false,
  "licenseKey" text,
  "cashRegister" text,
  "cashierPin" text,
  "fiscalPolicy" jsonb,
  "createdAt" timestamp(3) without time zone not null default current_timestamp,
  "updatedAt" timestamp(3) without time zone not null default current_timestamp
);

create table if not exists "AnalyticsConfig" (
  "id" text primary key,
  "merchantId" text not null unique references "Merchant"("id") on delete cascade on update cascade,
  "ga4MeasurementId" text,
  "metaPixelId" text,
  "metaAccessToken" text,
  "gtmContainerId" text,
  "createdAt" timestamp(3) without time zone not null default current_timestamp,
  "updatedAt" timestamp(3) without time zone not null default current_timestamp
);

create table if not exists "CheckoutSession" (
  "id" text primary key,
  "merchantId" text not null references "Merchant"("id") on delete cascade on update cascade,
  "publicToken" text not null unique,
  "status" "CheckoutStatus" not null default 'DRAFT',
  "currency" text not null default 'UAH',
  "subtotal" integer not null default 0,
  "shippingAmount" integer not null default 0,
  "discountAmount" integer not null default 0,
  "totalAmount" integer not null default 0,
  "buyerEmail" text,
  "buyerPhone" text,
  "buyerFirstName" text,
  "buyerLastName" text,
  "shippingMethodCode" text,
  "shippingProvider" text,
  "shippingPayload" jsonb,
  "billingPayload" jsonb,
  "paymentProvider" "PaymentProvider",
  "customAttributes" jsonb,
  "sourceIdentifier" text unique,
  "abandonedAt" timestamp(3) without time zone,
  "createdAt" timestamp(3) without time zone not null default current_timestamp,
  "updatedAt" timestamp(3) without time zone not null default current_timestamp
);

create index if not exists "CheckoutSession_merchantId_status_idx" on "CheckoutSession"("merchantId", "status");
create index if not exists "CheckoutSession_status_updatedAt_idx" on "CheckoutSession"("status", "updatedAt");

create table if not exists "CheckoutLine" (
  "id" text primary key,
  "checkoutSessionId" text not null references "CheckoutSession"("id") on delete cascade on update cascade,
  "variantGid" text not null,
  "productGid" text,
  "sku" text,
  "title" text not null,
  "quantity" integer not null,
  "unitPrice" integer not null,
  "compareAtPrice" integer,
  "lineDiscountAmount" integer not null default 0,
  "metadata" jsonb
);

create table if not exists "PaymentAttempt" (
  "id" text primary key,
  "checkoutSessionId" text not null references "CheckoutSession"("id") on delete cascade on update cascade,
  "provider" "PaymentProvider" not null,
  "status" "PaymentStatus" not null default 'PENDING',
  "providerReference" text,
  "amount" integer not null,
  "requestPayload" jsonb,
  "callbackPayload" jsonb,
  "verifiedAt" timestamp(3) without time zone,
  "modifiedAtProvider" timestamp(3) without time zone,
  "createdAt" timestamp(3) without time zone not null default current_timestamp,
  "updatedAt" timestamp(3) without time zone not null default current_timestamp,
  unique ("provider", "providerReference")
);

create table if not exists "OrderLink" (
  "id" text primary key,
  "checkoutSessionId" text not null unique references "CheckoutSession"("id") on delete cascade on update cascade,
  "shopifyOrderGid" text unique,
  "shopifyOrderName" text,
  "sourceIdentifier" text unique,
  "orderStatus" text,
  "createdAt" timestamp(3) without time zone not null default current_timestamp,
  "updatedAt" timestamp(3) without time zone not null default current_timestamp
);

create table if not exists "FiscalReceipt" (
  "id" text primary key,
  "orderLinkId" text not null unique references "OrderLink"("id") on delete cascade on update cascade,
  "provider" text not null default 'checkbox',
  "status" "FiscalStatus" not null default 'PENDING',
  "relationId" text,
  "receiptId" text,
  "fiscalNumber" text,
  "receiptUrl" text,
  "payload" jsonb,
  "createdAt" timestamp(3) without time zone not null default current_timestamp,
  "updatedAt" timestamp(3) without time zone not null default current_timestamp
);

create table if not exists "WebhookDelivery" (
  "id" text primary key,
  "merchantId" text references "Merchant"("id") on delete set null on update cascade,
  "source" text not null,
  "deliveryId" text not null,
  "eventId" text,
  "verified" boolean not null default false,
  "payload" jsonb not null,
  "processedAt" timestamp(3) without time zone,
  "createdAt" timestamp(3) without time zone not null default current_timestamp,
  unique ("source", "deliveryId")
);

create table if not exists "IdempotencyKey" (
  "id" text primary key,
  "scope" text not null,
  "key" text not null,
  "requestHash" text,
  "responseSnapshot" jsonb,
  "createdAt" timestamp(3) without time zone not null default current_timestamp,
  "expiresAt" timestamp(3) without time zone,
  unique ("scope", "key")
);

create table if not exists "AuditLog" (
  "id" text primary key,
  "merchantId" text not null references "Merchant"("id") on delete cascade on update cascade,
  "action" text not null,
  "entityType" text,
  "entityId" text,
  "metadata" jsonb,
  "createdAt" timestamp(3) without time zone not null default current_timestamp
);

create index if not exists "AuditLog_merchantId_createdAt_idx" on "AuditLog"("merchantId", "createdAt");

create table if not exists "NovaPoshtaCity" (
  "id" text primary key,
  "ref" text not null unique,
  "name" text not null,
  "nameRu" text,
  "area" text,
  "updatedAt" timestamp(3) without time zone not null default current_timestamp
);

create index if not exists "NovaPoshtaCity_name_idx" on "NovaPoshtaCity"("name");

create table if not exists "NovaPoshtaBranch" (
  "id" text primary key,
  "ref" text not null unique,
  "cityRef" text not null,
  "number" text not null,
  "shortAddress" text not null,
  "type" text not null default 'branch',
  "cityName" text,
  "weightLimit" double precision,
  "codAllowed" boolean not null default true,
  "updatedAt" timestamp(3) without time zone not null default current_timestamp
);

create index if not exists "NovaPoshtaBranch_cityRef_idx" on "NovaPoshtaBranch"("cityRef");
create index if not exists "NovaPoshtaBranch_number_idx" on "NovaPoshtaBranch"("number");
create index if not exists "NovaPoshtaBranch_shortAddress_idx" on "NovaPoshtaBranch"("shortAddress");

create table if not exists checkout_ab_assignments (
  id uuid primary key default gen_random_uuid(),
  "experimentId" text not null,
  "visitorId" text not null,
  variant text not null,
  "firstAssignedAt" timestamp(3) without time zone not null default current_timestamp,
  unique ("experimentId", "visitorId")
);

create index if not exists checkout_ab_assignments_experiment_variant_idx
  on checkout_ab_assignments ("experimentId", variant);

create table if not exists checkout_ab_events (
  id uuid primary key default gen_random_uuid(),
  "experimentId" text not null,
  "visitorId" text not null,
  variant text not null,
  "eventName" text not null,
  "cartToken" text,
  "checkoutSessionId" text,
  "shopifyOrderId" text,
  "emailHash" text,
  "phoneHash" text,
  revenue numeric(12, 2),
  currency text not null default 'UAH',
  payload jsonb,
  "createdAt" timestamp(3) without time zone not null default current_timestamp
);

create index if not exists checkout_ab_events_experiment_event_created_idx
  on checkout_ab_events ("experimentId", "eventName", "createdAt");
create index if not exists checkout_ab_events_visitor_experiment_idx
  on checkout_ab_events ("visitorId", "experimentId");
