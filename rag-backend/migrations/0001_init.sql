-- 0001 — documents + chat_history with Row Level Security
-- Idempotent: safe to run on an existing DB or a fresh staging project.

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  filename text not null,
  chunks integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.documents enable row level security;
drop policy if exists "Users can view own documents" on public.documents;
drop policy if exists "Users can insert own documents" on public.documents;
drop policy if exists "Users can delete own documents" on public.documents;
create policy "Users can view own documents"
  on public.documents for select using (auth.uid() = user_id);
create policy "Users can insert own documents"
  on public.documents for insert with check (auth.uid() = user_id);
create policy "Users can delete own documents"
  on public.documents for delete using (auth.uid() = user_id);

create table if not exists public.chat_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'ai')),
  content text not null,
  created_at timestamptz not null default now()
);

alter table public.chat_history enable row level security;
drop policy if exists "Users can view own chat history" on public.chat_history;
drop policy if exists "Users can insert own chat history" on public.chat_history;
drop policy if exists "Users can delete own chat history" on public.chat_history;
create policy "Users can view own chat history"
  on public.chat_history for select using (auth.uid() = user_id);
create policy "Users can insert own chat history"
  on public.chat_history for insert with check (auth.uid() = user_id);
create policy "Users can delete own chat history"
  on public.chat_history for delete using (auth.uid() = user_id);
