import { useState, type FormEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import { authenticateWithEmail, authenticateWithGoogle, signOutUser, supabaseConfigured } from './supabase'

type Props = { language: 'ru' | 'kz'; user: User | null; onClose: () => void }

const words = {
  ru: {
    title: 'Аккаунт SerIQ', login: 'Войти', register: 'Создать аккаунт', email: 'Электронная почта', password: 'Пароль',
    google: 'Продолжить с Google', submitLogin: 'Войти', submitRegister: 'Зарегистрироваться', close: 'Закрыть', signOut: 'Выйти',
    signedIn: 'Вы вошли как', anonymous: 'Сейчас история хранится анонимно на этом устройстве. Создайте аккаунт, чтобы сохранить доступ.',
    accountCreated: 'Проверьте почту и подтвердите адрес, чтобы завершить регистрацию.', registerHint: 'Придумайте пароль длиной не менее 8 символов.',
    loginHint: 'Введите почту и пароль аккаунта.', unavailable: 'Вход пока не подключён. Сначала настройте Supabase и OAuth/email-провайдеры.',
    privacy: 'Видео упражнений не отправляется в аккаунт. Сохраняются только результаты занятий.', error: 'Не удалось выполнить вход. Проверьте данные и настройки Supabase.',
  },
  kz: {
    title: 'SerIQ аккаунты', login: 'Кіру', register: 'Аккаунт ашу', email: 'Электрондық пошта', password: 'Құпиясөз',
    google: 'Google арқылы жалғастыру', submitLogin: 'Кіру', submitRegister: 'Тіркелу', close: 'Жабу', signOut: 'Шығу',
    signedIn: 'Кірдіңіз', anonymous: 'Қазір тарих осы құрылғыда анонимді түрде сақталады. Қолжетімді сақтау үшін аккаунт ашыңыз.',
    accountCreated: 'Тіркелуді аяқтау үшін поштаңызды тексеріп, мекенжайды растаңыз.', registerHint: 'Кемінде 8 таңбалы құпиясөз ойлап табыңыз.',
    loginHint: 'Аккаунттың поштасы мен құпиясөзін енгізіңіз.', unavailable: 'Кіру әлі қосылмаған. Алдымен Supabase пен OAuth/email провайдерлерін баптаңыз.',
    privacy: 'Жаттығу бейнелері аккаунтқа жіберілмейді. Тек жаттығу нәтижелері сақталады.', error: 'Кіру орындалмады. Деректер мен Supabase баптауларын тексеріңіз.',
  },
}

export default function AccountDialog({ language, user, onClose }: Props) {
  const t = words[language]
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState(false)
  const signedIn = user && !user.is_anonymous

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true); setMessage(''); setError(false)
    try {
      const result = await authenticateWithEmail(email.trim(), password, mode)
      if (result.confirmationRequired) setMessage(t.accountCreated)
      else onClose()
    } catch {
      setMessage(t.error); setError(true)
    } finally { setBusy(false) }
  }

  const google = async () => {
    setBusy(true); setMessage(''); setError(false)
    try { await authenticateWithGoogle() } catch { setMessage(t.error); setError(true); setBusy(false) }
  }

  const logout = async () => {
    setBusy(true)
    try { await signOutUser(); onClose() } catch { setMessage(t.error); setError(true) } finally { setBusy(false) }
  }

  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="account-dialog" role="dialog" aria-modal="true" aria-labelledby="account-title">
      <button className="dialog-close" type="button" onClick={onClose} aria-label={t.close}>×</button>
      <span className="section-kicker">SerIQ</span><h2 id="account-title">{t.title}</h2>
      {!supabaseConfigured ? <p className="auth-note">{t.unavailable}</p> : signedIn ? <>
        <p className="auth-note">{t.signedIn}: <strong>{user.email}</strong></p>
        <p className="auth-note">{t.privacy}</p>
        <button className="secondary-button account-action" type="button" onClick={() => void logout()} disabled={busy}>{t.signOut}</button>
      </> : <>
        {user?.is_anonymous && <p className="auth-note">{t.anonymous}</p>}
        <div className="auth-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'is-selected' : ''} onClick={() => { setMode('login'); setMessage('') }}>{t.login}</button>
          <button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'is-selected' : ''} onClick={() => { setMode('register'); setMessage('') }}>{t.register}</button>
        </div>
        <form className="auth-form" onSubmit={(event) => void submit(event)}>
          <label>{t.email}<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>{t.password}<input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          {mode === 'register' && <small>{t.registerHint}</small>}
          {mode === 'login' && <small>{t.loginHint}</small>}
          <button className="primary-button" type="submit" disabled={busy}>{busy ? '…' : mode === 'login' ? t.submitLogin : t.submitRegister}</button>
        </form>
        <div className="auth-divider"><span>{language === 'ru' ? 'или' : 'немесе'}</span></div>
        <button className="google-button" type="button" onClick={() => void google()} disabled={busy}><b aria-hidden="true">G</b>{t.google}</button>
        {message && <p className={`auth-message ${error ? 'is-error' : ''}`} role="status">{message}</p>}
        <p className="auth-privacy">{t.privacy}</p>
      </>}
    </section>
  </div>
}
