-- Tabela de usuários premium do SonorHub.
-- Cole isso no SQL Editor do painel do Supabase (Project → SQL Editor → New query → Run).

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  premium boolean not null default false,
  premium_expires_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.users enable row level security;

-- Cada usuário só consegue ler a própria linha (comparando com o e-mail do token de login).
create policy "users can read own row"
  on public.users
  for select
  using (auth.jwt() ->> 'email' = email);

-- Não existe policy de insert/update/delete pra anon/authenticated de propósito:
-- só a service_role key (usada só no servidor, nunca no navegador) pode escrever
-- aqui — isso vai ser feito pela Edge Function que recebe o webhook do Mercado Pago.

-- "premium = true" não expira automaticamente: o app (ou a Edge Function que checa
-- o status) precisa comparar premium_expires_at com now() pra saber se ainda vale.
-- Essa view já faz essa conta, então dá pra consultar ela em vez de calcular na mão.
create or replace view public.users_premium_status as
select
  id,
  email,
  premium and (premium_expires_at is null or premium_expires_at > now()) as is_premium_active,
  premium_expires_at
from public.users;

