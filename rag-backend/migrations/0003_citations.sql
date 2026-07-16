-- 0003 — store citation metadata alongside each AI message
alter table public.chat_history add column if not exists citations jsonb;
