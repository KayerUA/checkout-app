create extension if not exists "pgcrypto";

alter table "CheckoutSession"
  add column if not exists "shopifyCustomerGid" text,
  add column if not exists "legalEntityId" uuid,
  add column if not exists "legalEntitySnapshot" jsonb;

create table if not exists customer_legal_entities (
  id uuid primary key default gen_random_uuid(),
  "merchantId" text not null references "Merchant"("id") on delete cascade on update cascade,
  "shopifyCustomerGid" text not null,
  "entityType" text not null check ("entityType" in ('FOP', 'LEGAL_PERSON')),
  "legalName" text not null,
  "shortName" text,
  "normalizedTaxId" text not null,
  "taxId" text not null,
  "vatNumber" text,
  "legalAddress" text not null,
  "actualAddress" text,
  "contactName" text,
  "contactPhone" text,
  "contactEmail" text,
  iban text,
  "isDefault" boolean not null default false,
  "deletedAt" timestamp(3) without time zone,
  "createdAt" timestamp(3) without time zone not null default current_timestamp,
  "updatedAt" timestamp(3) without time zone not null default current_timestamp
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'CheckoutSession_legalEntityId_fkey'
  ) then
    alter table "CheckoutSession"
      add constraint "CheckoutSession_legalEntityId_fkey"
      foreign key ("legalEntityId") references customer_legal_entities(id)
      on delete set null on update cascade;
  end if;
end;
$$;

create index if not exists "CheckoutSession_merchantId_shopifyCustomerGid_idx"
  on "CheckoutSession" ("merchantId", "shopifyCustomerGid");
create index if not exists "CheckoutSession_legalEntityId_idx"
  on "CheckoutSession" ("legalEntityId");
create index if not exists customer_legal_entities_owner_idx
  on customer_legal_entities ("merchantId", "shopifyCustomerGid", "deletedAt");

create unique index if not exists customer_legal_entities_active_tax_unique
  on customer_legal_entities ("merchantId", "shopifyCustomerGid", "normalizedTaxId")
  where "deletedAt" is null;

create unique index if not exists customer_legal_entities_one_default
  on customer_legal_entities ("merchantId", "shopifyCustomerGid")
  where "deletedAt" is null and "isDefault" = true;

drop trigger if exists customer_legal_entities_set_updated_at on customer_legal_entities;
create trigger customer_legal_entities_set_updated_at
before update on customer_legal_entities
for each row execute function set_updated_at();

alter table b2b_orders
  add column if not exists legal_entity_id uuid,
  add column if not exists legal_entity_snapshot jsonb;

alter table processed_webhooks
  add column if not exists status text not null default 'COMPLETED',
  add column if not exists attempts integer not null default 1,
  add column if not exists last_error text,
  add column if not exists lease_expires_at timestamp with time zone,
  add column if not exists updated_at timestamp with time zone not null default now();

create index if not exists processed_webhooks_status_lease_idx
  on processed_webhooks (status, lease_expires_at);

drop trigger if exists processed_webhooks_set_updated_at on processed_webhooks;
create trigger processed_webhooks_set_updated_at
before update on processed_webhooks
for each row execute function set_updated_at();

create table if not exists accounting_dispatches (
  id uuid primary key default gen_random_uuid(),
  shopify_order_id text not null,
  transaction_id text not null,
  dispatch_key text unique not null,
  event_type text not null,
  state text not null default 'PENDING' check (
    state in ('PENDING', 'DISPATCHING', 'DELIVERED', 'FAILED_RETRYABLE')
  ),
  attempts integer not null default 0,
  next_attempt_at timestamp with time zone not null default now(),
  lease_expires_at timestamp with time zone,
  last_error text,
  delivered_at timestamp with time zone,
  payload jsonb not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index if not exists accounting_dispatches_state_next_attempt_idx
  on accounting_dispatches (state, next_attempt_at);
create index if not exists accounting_dispatches_order_created_idx
  on accounting_dispatches (shopify_order_id, created_at);

drop trigger if exists accounting_dispatches_set_updated_at on accounting_dispatches;
create trigger accounting_dispatches_set_updated_at
before update on accounting_dispatches
for each row execute function set_updated_at();
