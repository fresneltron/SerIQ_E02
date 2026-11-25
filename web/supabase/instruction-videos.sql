-- Run this in Supabase SQL Editor to prepare the public demo video bucket.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('instruction-videos', 'instruction-videos', true, 52428800, array['video/mp4'])
on conflict (id) do update set public = true, file_size_limit = 52428800, allowed_mime_types = array['video/mp4'];
