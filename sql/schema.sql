-- Extension untuk gen_random_uuid()
create extension if not exists "pgcrypto";

-- Tabel users
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  name varchar(100) not null,
  email varchar(150) unique not null,
  password_hash text not null,
  role varchar(20) not null default 'customer', -- 'customer' | 'admin'
  created_at timestamp default now()
);

-- Tabel refresh_tokens
create table if not exists refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null,
  is_revoked boolean not null default false,
  expires_at timestamp not null,
  created_at timestamp default now()
);

create index if not exists idx_refresh_tokens_user_id on refresh_tokens(user_id);
create index if not exists idx_refresh_tokens_token_hash on refresh_tokens(token_hash);

-- Tabel categories
create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  name varchar(100) not null unique
);

-- Tabel products
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references categories(id) on delete set null,
  name varchar(150) not null,
  description text,
  price numeric(12,2) not null check (price >= 0),
  stock int not null default 0 check (stock >= 0),
  image_url text,
  created_at timestamp default now()
);

create index if not exists idx_products_category_id on products(category_id);
create index if not exists idx_products_name on products using gin (to_tsvector('simple', name));

-- Tabel cart_items
create table if not exists cart_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  quantity int not null check (quantity > 0),
  created_at timestamp default now(),
  updated_at timestamp default now(),
  unique (user_id, product_id) -- 1 user cuma punya 1 baris per produk, kalau nambah lagi ya quantity-nya yang naik
);

create index if not exists idx_cart_items_user_id on cart_items(user_id);