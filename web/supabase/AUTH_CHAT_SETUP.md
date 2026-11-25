# Supabase: аккаунты и чат

В приложении вход остаётся необязательным для упражнений. Email/password может создать новый аккаунт или перевести текущую анонимную сессию в аккаунт; Google привязывается к анонимной сессии, чтобы сохранить её ID. После входа история синхронизируется только при отдельном включении «Сохранять историю онлайн».

## Настройка авторизации

1. Создайте Supabase project. В **Project Connect** скопируйте Project URL и publishable key (`sb_publishable_...`). В приложении и в Vercel они называются `VITE_SUPABASE_URL` и `VITE_SUPABASE_PUBLISHABLE_KEY`.
2. В **Authentication → Sign In / Providers** включите Anonymous Sign-ins и Email. Подтверждение почты оставьте включённым. Если Supabase не отправляет подтверждения на ваш адрес, для публичной регистрации понадобится настроить SMTP; встроенная отправка ограничена тестом адресами команды и небольшим лимитом.
3. В **Authentication → URL Configuration** поставьте production URL Vercel как Site URL; добавьте production URL и `http://localhost:5173/**` в Redirect URLs.
4. Для Google: в Google Auth Platform создайте OAuth client типа **Web application**. В Authorized JavaScript origins добавьте `http://localhost:5173` и production origin Vercel. В Authorized redirect URIs добавьте callback URL, который Supabase показывает на странице Google provider (обычно `https://<project-ref>.supabase.co/auth/v1/callback`). Внесите Google Client ID и Client Secret только в Google provider Supabase. Если экран согласия Google в режиме Testing, добавьте тестовые аккаунты в Test users.
5. В Supabase включите manual identity linking, чтобы Google можно было привязать к анонимной истории пользователя.
6. В Supabase **SQL Editor** выполните `care-chat.sql`. Если таблица истории ещё не создана, сначала один раз выполните `schema.sql`. Если историю уже настраивали, повторно `schema.sql` не запускайте.
7. Для графика и таблицы врача после `care-chat.sql` выполните `doctor-history.sql`. Пациент управляет доступом внизу раздела истории; по умолчанию врач не видит занятия. Врач может поставить отдельную отметку проверки. Видео на сервер не отправляется.
8. В локальном `web/.env.local` и Vercel → **Settings → Environment Variables** укажите `VITE_SUPABASE_URL` и `VITE_SUPABASE_PUBLISHABLE_KEY`; сохраните и сделайте redeploy. Не добавляйте secret/service-role key в браузер или переменные с префиксом `VITE_`.

Почтовая регистрация при включённом подтверждении отправляет ссылку на почту. Google работает только после настройки OAuth client и redirect URL в Supabase и Google Cloud. Для аккаунтов с существующей анонимной сессией вход Google использует связывание identity.

## Назначение тестового врача

Саморегистрация не даёт роль врача. После создания двух тестовых аккаунтов администратор Supabase может вручную назначить врача и связать его с тестовым пациентом в SQL Editor:

```sql
update public.profiles
set role = 'doctor'
where user_id = (select id from auth.users where email = 'doctor@example.test');

insert into public.care_relationships (patient_id, doctor_id)
values (
  (select id from auth.users where email = 'patient@example.test'),
  (select id from auth.users where email = 'doctor@example.test')
);
```

Приложение даёт отправлять и читать сообщения только участникам назначенной связи; RLS проверяет это на стороне базы. Для прототипа используйте только синтетические аккаунты и сообщения. До внедрения для реальных пациентов нужны одобрение организации, согласие пользователей, правила хранения/удаления переписки и проверка защиты.
