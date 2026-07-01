create extension if not exists "pgcrypto";

do $$
begin
  if exists (select 1 from pg_type where typname = 'PaymentProvider') then
    alter type "PaymentProvider" add value if not exists 'BANK_INVOICE';
  end if;
end;
$$;

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists b2b_orders (
  id uuid primary key default gen_random_uuid(),
  shopify_order_id text unique not null,
  shopify_order_name text,
  shop_domain text,
  buyer_type text,
  payment_preference text,
  fop_name text,
  fop_tax_id text,
  fop_legal_address text,
  docs_email text,
  docs_phone text,
  accounting_comment text,
  order_total_amount numeric(12, 2),
  order_currency text,
  status text not null default 'CREATED' check (
    status in (
      'CREATED',
      'INVOICE_SENT',
      'WAITING_BANK_PAYMENT',
      'PAYMENT_MATCHED',
      'PAYMENT_CONFIRMED',
      'DOCS_SENT',
      'READY_TO_FULFILL_AFTER_BANK_PAYMENT',
      'NEEDS_REVIEW',
      'CANCELLED',
      'ERROR'
    )
  ),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index if not exists b2b_orders_status_updated_at_idx
  on b2b_orders (status, updated_at);

drop trigger if exists b2b_orders_set_updated_at on b2b_orders;
create trigger b2b_orders_set_updated_at
before update on b2b_orders
for each row execute function set_updated_at();

create table if not exists b2b_documents (
  id uuid primary key default gen_random_uuid(),
  shopify_order_id text not null,
  type text not null check (type in ('invoice', 'delivery_note', 'fiscal_receipt', 'correction')),
  number text,
  status text not null,
  pdf_url text,
  external_id text,
  metadata jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (shopify_order_id, type, number)
);

create index if not exists b2b_documents_shopify_order_type_idx
  on b2b_documents (shopify_order_id, type);

drop trigger if exists b2b_documents_set_updated_at on b2b_documents;
create trigger b2b_documents_set_updated_at
before update on b2b_documents
for each row execute function set_updated_at();

create table if not exists bank_payments (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  bank_account_iban text,
  transaction_id text unique not null,
  transaction_date timestamp with time zone not null,
  payer_name text,
  payer_tax_id text,
  amount numeric(12, 2) not null,
  currency text not null,
  payment_description text,
  matched_shopify_order_id text,
  match_confidence numeric(4, 2),
  status text not null default 'NEW' check (status in ('NEW', 'MATCHED', 'NEEDS_REVIEW', 'IGNORED')),
  raw_payload jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index if not exists bank_payments_status_date_idx
  on bank_payments (status, transaction_date);

create index if not exists bank_payments_matched_order_idx
  on bank_payments (matched_shopify_order_id);

drop trigger if exists bank_payments_set_updated_at on bank_payments;
create trigger bank_payments_set_updated_at
before update on bank_payments
for each row execute function set_updated_at();

create table if not exists automation_logs (
  id uuid primary key default gen_random_uuid(),
  shopify_order_id text,
  event_type text,
  step text,
  status text not null,
  message text,
  error_message text,
  metadata jsonb,
  created_at timestamp with time zone not null default now()
);

create index if not exists automation_logs_order_created_at_idx
  on automation_logs (shopify_order_id, created_at);

create index if not exists automation_logs_event_created_at_idx
  on automation_logs (event_type, created_at);

create table if not exists processed_webhooks (
  id uuid primary key default gen_random_uuid(),
  webhook_id text unique not null,
  topic text not null,
  shop_domain text,
  processed_at timestamp with time zone not null default now(),
  payload_hash text
);

create index if not exists processed_webhooks_topic_processed_at_idx
  on processed_webhooks (topic, processed_at);
