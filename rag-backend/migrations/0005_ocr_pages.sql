-- 0005 — how many pages were read via OCR fallback (sidebar indicator)
alter table public.documents add column if not exists ocr_pages integer not null default 0;
