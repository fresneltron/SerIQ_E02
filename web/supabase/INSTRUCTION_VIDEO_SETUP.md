# Публикация демонстрационного видео E02

Видео уже включено в веб-сборку по пути `/instructions/video2.mp4` и будет работать на Vercel.

Чтобы приложение брало его из Supabase Storage:

1. В Supabase Dashboard откройте **SQL Editor** и выполните `instruction-videos.sql`.
2. Откройте **Storage → instruction-videos** и загрузите `public/instructions/video2.mp4` с именем объекта `video2.mp4` в корень bucket.
3. Укажите `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY` в окружении Vercel и пересоберите приложение.

Приложение проверит облачный ролик и возьмёт его при наличии. Если Supabase не настроен или объект ещё не загружен, будет показан включённый в сборку файл. Видео доступно публично как демонстрационный клип; не загружайте в этот bucket личные записи пациентов.
