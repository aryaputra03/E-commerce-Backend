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