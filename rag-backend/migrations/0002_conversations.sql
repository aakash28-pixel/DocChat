-- 0002 — conversations (persistent multi-turn chat) + link from chat_history

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  doc_id text,                                   -- filename scope; null = all documents
  title text not null default 'New conversation',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.conversations enable row level security;
drop policy if exists "Users manage own conversations select" on public.conversations;
drop policy if exists "Users manage own conversations insert" on public.conversations;
drop policy if exists "Users manage own conversations update" on public.conversations;
drop policy if exists "Users manage own conversations delete" on public.conversations;
create policy "Users manage own conversations select"
  on public.conversations for select using (auth.uid() = user_id);
create policy "Users manage own conversations insert"
  on public.conversations for insert with check (auth.uid() = user_id);
create policy "Users manage own conversations update"
  on public.conversations for update using (auth.uid() = user_id);
create policy "Users manage own conversations delete"
  on public.conversations for delete using (auth.uid() = user_id);

alter table public.chat_history
  add column if not exists conversation_id uuid
  references public.conversations(id) on delete cascade;

create index if not exists chat_history_conversation_idx
  on public.chat_history (conversation_id);
create index if not exists conversations_user_idx
  on public.conversations (user_id, updated_at desc);
