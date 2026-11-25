import { useEffect, useState, type FormEvent } from 'react'
import { loadCareMessages, loadCareThreads, loadDoctorPatientAttempts, saveDoctorReview, sendCareMessage, subscribeToCareMessages, type CareMessage, type CareThread, type DoctorAttempt } from './supabase'

type Props = { language: 'ru' | 'kz'; signedIn: boolean; onLogin: () => void }
type ChatState = { userId: string; role: string; threads: CareThread[]; selectedThreadId: string; messages: CareMessage[] }
type PatientReport = { patientId: string; allowed: boolean; attempts: DoctorAttempt[] }

const words = {
  ru: {
    title: 'Связь с врачом', kicker: 'ВАША КОМАНДА', signIn: 'Войдите в аккаунт, чтобы открыть чат с назначенным врачом.', signInButton: 'Войти или зарегистрироваться',
    noDoctor: 'Врач пока не подключён', noDoctorText: 'Когда клиника назначит врача вашему аккаунту, переписка появится здесь.',
    noPatient: 'Пациенты пока не назначены', noPatientText: 'Администратор должен связать ваш аккаунт врача с аккаунтом пациента.',
    loading: 'Загружаем переписку…', setup: 'Чат пока не настроен. Для него нужно подключить Supabase и применить схему чата.',
    demoSafety: 'В прототипе не отправляйте личные данные, диагнозы, фото или видео. При боли или ухудшении самочувствия остановитесь и обратитесь за медицинской помощью.',
    placeholder: 'Напишите сообщение', send: 'Отправить', you: 'Вы', doctor: 'Врач', patient: 'Пациент',
    error: 'Не удалось загрузить чат или отправить сообщение. Проверьте подключение и настройки Supabase.',
    reportTitle: 'Динамика занятий', reportLoading: 'Загружаем данные занятий…', consentOff: 'Пациент пока не разрешил просмотр истории.', noAttempts: 'Разрешение дано, занятий пока нет.',
    date: 'Дата', exercise: 'Упражнение', result: 'Результат алгоритма', confidence: 'Уверенность модели', visibility: 'Видимость руки', duration: 'Длительность', cycles: 'Циклы', angleTitle: 'Движение предплечья во времени', seconds: 'Время (с)', degrees: 'Угол (°)',
    doctorReview: 'Отметка врача', savedReview: 'Отметка врача сохранена', reviewError: 'Не удалось сохранить отметку врача.',
  },
  kz: {
    title: 'Дәрігермен байланыс', kicker: 'СІЗДІҢ КОМАНДАҢЫЗ', signIn: 'Тағайындалған дәрігермен сөйлесу үшін аккаунтқа кіріңіз.', signInButton: 'Кіру немесе тіркелу',
    noDoctor: 'Дәрігер әлі қосылмаған', noDoctorText: 'Клиника аккаунтыңызға дәрігерді тағайындаған соң, хаттар осында көрсетіледі.',
    noPatient: 'Пациенттер әлі тағайындалмаған', noPatientText: 'Әкімші дәрігер аккаунтын пациент аккаунтымен байланыстыруы керек.',
    loading: 'Хаттар жүктелуде…', setup: 'Чат әлі бапталмаған. Supabase қосып, чат схемасын қолдану қажет.',
    demoSafety: 'Прототипте жеке деректерді, диагноздарды, фото не бейнені жібермеңіз. Ауырсыну не жайсыздық болса, тоқтап, медициналық көмекке жүгініңіз.',
    placeholder: 'Хабарлама жазыңыз', send: 'Жіберу', you: 'Сіз', doctor: 'Дәрігер', patient: 'Пациент',
    error: 'Чат ашылмады немесе хабарлама жіберілмеді. Байланыс пен Supabase баптауларын тексеріңіз.',
    reportTitle: 'Жаттығулар динамикасы', reportLoading: 'Жаттығу деректері жүктелуде…', consentOff: 'Пациент тарихты көруге әлі рұқсат берген жоқ.', noAttempts: 'Рұқсат берілді, әзірге жаттығу жоқ.',
    date: 'Күні', exercise: 'Жаттығу', result: 'Алгоритм нәтижесі', confidence: 'Модель сенімділігі', visibility: 'Қолдың көрінуі', duration: 'Ұзақтығы', cycles: 'Цикл', angleTitle: 'Білек қозғалысының уақыт бойынша өзгеруі', seconds: 'Уақыт (с)', degrees: 'Бұрыш (°)',
    doctorReview: 'Дәрігер белгісі', savedReview: 'Дәрігер белгісі сақталды', reviewError: 'Дәрігер белгісін сақтау мүмкін болмады.',
  },
}

export default function CareChat({ language, signedIn, onLogin }: Props) {
  const t = words[language]
  const [chat, setChat] = useState<ChatState | null>(null)
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState(false)
  const [patientReport, setPatientReport] = useState<PatientReport | null>(null)
  const [reportLoading, setReportLoading] = useState(false)
  const [reviewBusyId, setReviewBusyId] = useState('')
  const [reviewStatus, setReviewStatus] = useState('')

  useEffect(() => {
    let cancelled = false
    if (!signedIn) { setChat(null); return }
    setLoading(true); setError(false)
    void loadCareThreads().then((result) => {
      if (!cancelled && result.user) setChat({ userId: result.user.id, role: result.role ?? 'patient', threads: result.threads, selectedThreadId: result.threads[0]?.id ?? '', messages: [] })
    }).catch(() => { if (!cancelled) setError(true) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [signedIn])

  useEffect(() => {
    if (!chat?.selectedThreadId) return
    return subscribeToCareMessages(chat.selectedThreadId, (message) => setChat((current) => {
      if (!current || current.messages.some((item) => item.id === message.id)) return current
      return { ...current, messages: [...current.messages, message] }
    }))
  }, [chat?.selectedThreadId])

  const selectedThread = chat?.threads.find((thread) => thread.id === chat.selectedThreadId)
  useEffect(() => {
    let cancelled = false
    if (chat?.role !== 'doctor' || !selectedThread) { setPatientReport(null); return }
    setReportLoading(true)
    setPatientReport(null)
    void loadDoctorPatientAttempts(selectedThread.patient_id)
      .then((result) => { if (!cancelled) setPatientReport({ patientId: selectedThread.patient_id, ...result }) })
      .catch(() => { if (!cancelled) setPatientReport({ patientId: selectedThread.patient_id, allowed: false, attempts: [] }) })
      .finally(() => { if (!cancelled) setReportLoading(false) })
    return () => { cancelled = true }
  }, [chat?.role, selectedThread?.patient_id, chat?.selectedThreadId])

  useEffect(() => {
    let cancelled = false
    if (!chat?.selectedThreadId) return
    void loadCareMessages(chat.selectedThreadId).then((messages) => {
      if (!cancelled) setChat((current) => current?.selectedThreadId === chat.selectedThreadId ? { ...current, messages } : current)
    }).catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [chat?.selectedThreadId])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!chat?.selectedThreadId || !draft.trim()) return
    setSending(true); setError(false)
    try {
      const message = await sendCareMessage(chat.selectedThreadId, draft.trim())
      setChat((current) => current && !current.messages.some((item) => item.id === message.id) ? { ...current, messages: [...current.messages, message] } : current)
      setDraft('')
    } catch { setError(true) } finally { setSending(false) }
  }

  const formatTime = (value: string) => new Date(value).toLocaleString(language === 'ru' ? 'ru-RU' : 'kk-KZ', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })
  const formatResult = (value: DoctorAttempt['verdict']) => value === 'complete' ? (language === 'ru' ? 'Выполнено' : 'Орындалды') : (language === 'ru' ? 'Проверьте инструкцию' : 'Нұсқаулықты тексеріңіз')
  const saveReview = async (attempt: DoctorAttempt, verdict: 'complete' | 'check') => {
    setReviewBusyId(attempt.id); setReviewStatus('')
    try {
      await saveDoctorReview(attempt.id, verdict)
      setPatientReport((current) => current ? { ...current, attempts: current.attempts.map((item) => item.id === attempt.id ? { ...item, doctor_verdict: verdict, doctor_reviewed_at: new Date().toISOString() } : item) } : current)
      setReviewStatus(t.savedReview)
    } catch { setReviewStatus(t.reviewError) } finally { setReviewBusyId('') }
  }
  const latestGraph = patientReport?.attempts.find((attempt) => attempt.angle_series?.length)
  const chartPoints = latestGraph?.angle_series ?? []
  const chartAngles = chartPoints.map((point) => point.angle)
  const minAngle = Math.min(0, ...chartAngles)
  const maxAngle = Math.max(90, ...chartAngles)
  const chartPolyline = chartPoints.map((point, index) => `${42 + (chartPoints.length > 1 ? index / (chartPoints.length - 1) : 0) * 550},${184 - ((point.angle - minAngle) / Math.max(1, maxAngle - minAngle)) * 146}`).join(' ')

  return <section className="flow-card care-chat-card">
    <span className="section-kicker">{t.kicker}</span><h1>{t.title}</h1>
    {!signedIn ? <div className="chat-empty"><span className="chat-empty-icon" aria-hidden="true">✉</span><p>{t.signIn}</p><button className="primary-button" type="button" onClick={onLogin}>{t.signInButton}</button></div>
      : loading ? <p className="chat-status" role="status">{t.loading}</p>
      : error && !chat ? <div className="notice notice-warn" role="alert">{t.error} {t.setup}</div>
      : chat?.selectedThreadId ? <>
        {chat.role === 'doctor' && chat.threads.length > 1 && <div className="chat-thread-picker" aria-label={t.patient}>
          {chat.threads.map((thread) => <button type="button" key={thread.id} className={thread.id === chat.selectedThreadId ? 'is-selected' : ''} onClick={() => setChat((current) => current ? { ...current, selectedThreadId: thread.id, messages: [] } : current)}>{t.patient} · {thread.patient_id.slice(-6).toUpperCase()}</button>)}
        </div>}
        {chat.role === 'doctor' && <section className="doctor-report" aria-labelledby="doctor-report-title">
          <h2 id="doctor-report-title">{t.reportTitle} · {selectedThread?.patient_id.slice(-6).toUpperCase()}</h2>
          {reportLoading ? <p className="chat-status">{t.reportLoading}</p>
            : !patientReport?.allowed ? <p className="chat-status">{t.consentOff}</p>
            : patientReport.attempts.length === 0 ? <p className="chat-status">{t.noAttempts}</p>
            : <>
              {latestGraph && <div className="doctor-chart-card">
                <strong>{t.angleTitle}</strong>
                <svg viewBox="0 0 640 230" role="img" aria-label={t.angleTitle}>
                  {[0, 1, 2, 3, 4].map((line) => <line key={line} x1="42" x2="604" y1={38 + line * 36} y2={38 + line * 36} className="doctor-chart-grid" />)}
                  <line x1="42" x2="42" y1="34" y2="184" className="doctor-chart-axis" />
                  <line x1="42" x2="604" y1="184" y2="184" className="doctor-chart-axis" />
                  <polyline points={chartPolyline} className="doctor-chart-line" />
                  <text x="42" y="211">0 {t.seconds}</text><text x="548" y="211">{chartPoints.at(-1)?.t.toFixed(1)} {t.seconds}</text>
                  <text x="8" y="30">{maxAngle.toFixed(0)}°</text><text x="8" y="184">{minAngle.toFixed(0)}°</text>
                </svg>
                <small>{new Date(latestGraph.created_at).toLocaleString(language === 'ru' ? 'ru-RU' : 'kk-KZ')}</small>
              </div>}
              <div className="doctor-table-wrap"><table className="doctor-table"><thead><tr><th>{t.date}</th><th>{t.exercise}</th><th>{t.result}</th><th>{t.confidence}</th><th>{t.visibility}</th><th>{t.duration}</th><th>{t.cycles}</th><th>{t.doctorReview}</th></tr></thead><tbody>
                {patientReport.attempts.map((attempt) => <tr key={attempt.id}><td>{formatTime(attempt.created_at)}</td><td>{attempt.exercise_id}</td><td>{formatResult(attempt.verdict)}</td><td>{Math.round(attempt.confidence * 100)}%</td><td>{Math.round(attempt.detected_percent)}%</td><td>{Math.round(attempt.duration_seconds)} с</td><td>{attempt.cycle_count}</td><td><div className="doctor-review-actions"><button type="button" className={attempt.doctor_verdict === 'complete' ? 'is-selected' : ''} disabled={reviewBusyId === attempt.id} onClick={() => void saveReview(attempt, 'complete')}>{language === 'ru' ? 'Выполнено' : 'Орындалды'}</button><button type="button" className={attempt.doctor_verdict === 'check' ? 'is-selected' : ''} disabled={reviewBusyId === attempt.id} onClick={() => void saveReview(attempt, 'check')}>{language === 'ru' ? 'Проверить' : 'Тексеру'}</button></div></td></tr>)}
              </tbody></table></div>
              {reviewStatus && <p className="doctor-report-note" role="status">{reviewStatus}</p>}
              <small className="doctor-report-note">{language === 'ru' ? 'Результат алгоритма — вспомогательные данные для просмотра специалистом.' : 'Алгоритм нәтижесі — маман қарайтын қосымша дерек.'}</small>
            </>}
        </section>}
        <div className="chat-thread-heading"><span className="chat-presence" /><strong>{chat.role === 'doctor' ? `${t.patient} · ${chat.threads.find((thread) => thread.id === chat.selectedThreadId)?.patient_id.slice(-6).toUpperCase()}` : t.doctor}</strong><small>SerIQ</small></div>
        <div className="chat-messages" aria-live="polite">
          {chat.messages.map((message) => <article className={`chat-message ${message.sender_id === chat.userId ? 'is-mine' : ''}`} key={message.id}>
            <small>{message.sender_id === chat.userId ? t.you : chat.role === 'doctor' ? t.patient : t.doctor}</small>
            <p>{message.body}</p><time>{formatTime(message.created_at)}</time>
          </article>)}
          {!chat.messages.length && <p className="chat-status">{chat.role === 'doctor' ? t.noPatientText : t.noDoctorText}</p>}
        </div>
        <form className="chat-compose" onSubmit={(event) => void submit(event)}>
          <label className="visually-hidden" htmlFor="doctor-chat-message">{t.placeholder}</label>
          <textarea id="doctor-chat-message" rows={2} maxLength={2000} placeholder={t.placeholder} value={draft} onChange={(event) => setDraft(event.target.value)} />
          <button className="primary-button" type="submit" disabled={sending || !draft.trim()}>{sending ? '…' : t.send}</button>
        </form>
        {error && <p className="chat-error" role="alert">{t.error}</p>}
      </>
      : <div className="chat-empty"><span className="chat-empty-icon" aria-hidden="true">✉</span><strong>{chat?.role === 'doctor' ? t.noPatient : t.noDoctor}</strong><p>{chat?.role === 'doctor' ? t.noPatientText : t.noDoctorText}</p></div>}
    <p className="chat-safety">{t.demoSafety}</p>
  </section>
}
