alter table public.transcript_segments
add column if not exists translated_text text;
