-- Nexa BillSuite cloud database foundation, PostgreSQL/Supabase.
-- Run in Supabase SQL Editor once. No Supabase Auth is used.
create extension if not exists pgcrypto;
create extension if not exists citext;

create table if not exists public.account (
 id uuid primary key default gen_random_uuid(),
 username citext not null unique,
 display_name text not null,
 password_hash text not null,
 role text not null check (role in ('admin','staff','cashier')),
 permissions text[] not null default '{}',
 screens text[] not null default '{}',
 show_cost boolean not null default false,
 active boolean not null default true,
 must_change_password boolean not null default true,
 failed_attempts integer not null default 0,
 locked_until timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.app_session (
 token_hash text primary key,
 account_id uuid not null references public.account(id) on delete cascade,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null
);
create index if not exists app_session_expires_idx on public.app_session(expires_at);

create table if not exists public.app_sequence (kind text primary key, val bigint not null default 0);
insert into public.app_sequence(kind,val) values ('sale',0),('grn',0),('return',0),('document',0)
on conflict do nothing;

create table if not exists public.product (
 id uuid primary key default gen_random_uuid(),
 sku citext not null unique, barcode citext unique,
 name text not null, other_name text not null default '',
 category text not null default 'General', brand text not null default '',
 unit text not null default 'PCS', pack_name text not null default 'Pack',
 pack_factor numeric(16,3) not null default 1 check (pack_factor>=1),
 cost numeric(16,4) not null default 0 check (cost>=0),
 retail numeric(16,2) not null default 0 check (retail>=0),
 wholesale numeric(16,2) not null default 0 check (wholesale>=0),
 qty numeric(16,3) not null default 0 check (qty>=0),
 reorder_qty numeric(16,3) not null default 0 check (reorder_qty>=0),
 taxable boolean not null default false,
 active boolean not null default true,
 details jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table if not exists public.customer (
 id uuid primary key default gen_random_uuid(),name text not null,
 phone text not null default '', address text not null default '',
 tin text not null default '',credit_limit numeric(16,2) not null default 0 check (credit_limit>=0),
 opening numeric(16,2) not null default 0,
 terms integer not null default 30,
 created_at timestamptz not null default now()
);
create table if not exists public.supplier (
 id uuid primary key default gen_random_uuid(),name text not null,
 phone text not null default '',address text not null default '',
 opening numeric(16,2) not null default 0,
 created_at timestamptz not null default now()
);
create table if not exists public.sale (
 id uuid primary key default gen_random_uuid(),no text not null unique,
 customer_id uuid references public.customer(id),cashier_id uuid references public.account(id),
 issued_at timestamptz not null default now(),kind text not null default 'retail',
 subtotal numeric(16,2) not null,total numeric(16,2) not null check(total>=0),
 discount numeric(16,2) not null default 0,tax numeric(16,2) not null default 0,
 paid numeric(16,2) not null default 0 check(paid>=0),
 balance numeric(16,2) not null default 0 check(balance>=0),
 status text not null check (status in ('paid','partial','unpaid')),
 payment_method text not null default 'cash', notes text not null default '',
 idempotency_key uuid not null unique
);
create table if not exists public.sale_line (
 id uuid primary key default gen_random_uuid(),sale_id uuid not null references public.sale(id) on delete restrict,
 product_id uuid not null references public.product(id),
 name text not null,sku text not null,
 qty numeric(16,3) not null check(qty>0),
 price numeric(16,2) not null check(price>=0),
 discount numeric(16,2) not null default 0,
 amount numeric(16,2) not null check(amount>=0),
 cost numeric(16,4) not null default 0
);
create table if not exists public.payment (
 id uuid primary key default gen_random_uuid(),sale_id uuid not null references public.sale(id) on delete restrict,
 amount numeric(16,2) not null check(amount>0),method text not null,
 created_by uuid references public.account(id),at timestamptz not null default now(),
 note text not null default ''
);
create table if not exists public.purchase (
 id uuid primary key default gen_random_uuid(),no text not null unique,
 supplier_id uuid not null references public.supplier(id),
 supplier_invoice text not null default '',issued_at timestamptz not null default now(),
 total numeric(16,2) not null check(total>=0), paid numeric(16,2) not null default 0,
 balance numeric(16,2) not null default 0,
 notes text not null default '',created_by uuid references public.account(id),
 idempotency_key uuid not null unique
);
create table if not exists public.purchase_line (
 id uuid primary key default gen_random_uuid(),purchase_id uuid not null references public.purchase(id) on delete restrict,
 product_id uuid not null references public.product(id),
 qty numeric(16,3) not null check(qty>0),
 free_qty numeric(16,3) not null default 0 check(free_qty>=0),
 cost numeric(16,4) not null check(cost>=0),total numeric(16,2) not null check(total>=0)
);
create table if not exists public.supplier_payment (
 id uuid primary key default gen_random_uuid(),purchase_id uuid not null references public.purchase(id),
 amount numeric(16,2) not null check(amount>0),method text not null,at timestamptz not null default now()
);
create table if not exists public.stock_move (
 id uuid primary key default gen_random_uuid(),product_id uuid not null references public.product(id),
 delta numeric(16,3) not null check(delta<>0),kind text not null,
 reference text not null default '',notes text not null default '',
 at timestamptz not null default now(),created_by uuid references public.account(id)
);
create table if not exists public.sales_return (
 id uuid primary key default gen_random_uuid(),sale_id uuid not null references public.sale(id),
 sale_line_id uuid not null references public.sale_line(id),
 qty numeric(16,3) not null check(qty>0),
 refund numeric(16,2) not null check(refund>=0),
 created_by uuid references public.account(id),
 at timestamptz not null default now(),idempotency_key uuid not null unique
);
create table if not exists public.expense (
 id uuid primary key default gen_random_uuid(),category text not null,
 amount numeric(16,2) not null check(amount>=0),method text not null default 'cash',
 note text not null default '',created_by uuid references public.account(id),
 at timestamptz not null default now()
);
create table if not exists public.document (
 id uuid primary key default gen_random_uuid(),no text not null unique,
 kind text not null check(kind in ('quotation','proforma','custom')),
 title text not null,customer_id uuid references public.customer(id),
 items jsonb not null default '[]'::jsonb,
 total numeric(16,2) not null check(total>=0),
 notes text not null default '',created_by uuid references public.account(id),
 issued_at timestamptz not null default now()
);
create table if not exists public.cash_shift (
 id uuid primary key default gen_random_uuid(),account_id uuid not null references public.account(id),
 opened_at timestamptz not null default now(),opening numeric(16,2) not null default 0,
 closed_at timestamptz,counted numeric(16,2),expected numeric(16,2),variance numeric(16,2)
);
create unique index if not exists cash_shift_one_open on public.cash_shift(account_id) where closed_at is null;
create table if not exists public.account_draft (
 account_id uuid primary key references public.account(id) on delete cascade,
 draft jsonb not null default '{}'::jsonb,updated_at timestamptz not null default now()
);
create table if not exists public.app_settings (
 id integer primary key default 1 check(id=1),data jsonb not null default '{}'::jsonb,
 updated_at timestamptz not null default now()
);
insert into public.app_settings(id,data) values(1,'{}') on conflict do nothing;
create table if not exists public.audit_event (
 id bigserial primary key,account_id uuid references public.account(id),
 action text not null,details jsonb not null default '{}'::jsonb,
 at timestamptz not null default now()
);

-- No client direct table access. Backend connects using SERVER-ONLY DATABASE_URL.
-- Enable RLS AND revoke grants, to deny all requests using the browser publishable key.
do $$ declare t text; begin
 foreach t in array array['account','app_session','app_sequence','product','customer','supplier','sale','sale_line','payment','purchase','purchase_line','supplier_payment','stock_move','sales_return','expense','document','cash_shift','account_draft','app_settings','audit_event'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on table public.%I from anon, authenticated',t);
 end loop;
end $$;
revoke all on all sequences in schema public from anon, authenticated;
