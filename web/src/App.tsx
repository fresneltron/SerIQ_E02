import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { BrowserLandmarker, drawLandmarks, getModel, scoreSamples, type ExerciseId, type Prediction, type Sample } from './vision'
import { getDoctorHistoryConsent, getInstructionVideoUrl, getSignedInUser, loadCloudAttempts, setDoctorHistoryConsent, subscribeToAuth, supabaseConfigured, syncAttempt, type User } from './supabase'
import './App.css'
import AccountDialog from './AccountDialog'
import CareChat from './CareChat'

type Language = 'ru' | 'kz'
type Screen = 'home' | 'exercise' | 'session' | 'result' | 'chat'
type InputMode = 'camera' | 'upload'
type DemoView = 'video' | 'mannequin'
type NavSection = 'home' | 'exercise' | 'history' | 'chat'
type HistoryItem = { id: string; exercise: ExerciseId; verdict: 'complete' | 'check' | 'quality'; time: string; confidence?: number; detectedPercent?: number; durationSeconds?: number; cycleCount?: number }

const InstructionMannequin = lazy(() => import('./InstructionMannequin'))

const exercises: Array<{ id: ExerciseId; ru: string; kz: string; short: string }> = [
  { id: 'E01', ru: 'Поднять предмет', kz: 'Затты көтеру', short: 'Поднимите лёгкий предмет со стола' },
  { id: 'E02', ru: 'Разогнуть локоть', kz: 'Шынтақты жазу', short: 'Медленно разогните руку в локте' },
  { id: 'E03', ru: 'Поднять кисть', kz: 'Білезікті көтеру', short: 'Поднимите кисть и верните её обратно' },
  { id: 'E04', ru: 'Раскрыть ладонь', kz: 'Алақанды ашу', short: 'Раскройте ладонь, затем расслабьте её' },
]

const copy = {
  ru: {
    title: 'SerIQ', subtitle: '', language: 'Қазақша',
    heroKicker: 'Помощник для домашних упражнений', exerciseSection: 'Выберите упражнение', timeEstimate: 'Около 1 минуты',
    safetyTitle: 'Занимайтесь в комфортном темпе', historyKicker: 'ВАША ИСТОРИЯ', chooseMethod: 'Как вам удобнее?', chooseMethodHint: 'Можно включить камеру или выбрать готовый ролик.',
    liveCamera: 'КАМЕРА', liveVideo: 'ВИДЕО',
    durationPick: 'Длительность занятия', seconds: 'сек.', minute: '1 мин', minutes: '2 мин', durationMin: '1 минута', durationMax: '10 минут',
    clipTitle: 'Запись занятия', clipPrivacy: 'Клип хранится только в памяти этого устройства и никуда не отправляется.',
    cameraPrivacy: 'Видео временно останется на устройстве и удалится при выходе из занятия.',
    choose: 'Какое упражнение будем делать?', intro: 'Выберите упражнение. Мы покажем инструкцию и поможем проверить движение.',
    safety: 'Это вспомогательный инструмент. Он не заменяет врача и не ставит диагноз. Если появилась боль или стало плохо, остановитесь и обратитесь за медицинской помощью.',
    emergency: 'Экстренная помощь: 103', ready: 'Модель готова', preparing: 'Модель готовится',
    details: 'Об упражнении', instruction: 'Демонстрация упражнения', stepsTitle: 'Шаги выполнения', verifiedClip: 'Видео упражнения', mannequinLoading: 'Загружаем 3D-демонстрацию…', demoVideo: 'Видео', demoMannequin: '3D‑манекен',
    back: 'Назад', camera: 'Включить камеру', upload: 'Загрузить видео', cameraMode: 'Камера телефона', uploadMode: 'Видео с телефона',
    allowCamera: 'Разрешите доступ к камере. Поставьте телефон так, чтобы рука была полностью видна.',
    start: 'Начать упражнение', done: 'Готово', analyze: 'Проверить видео', changeFile: 'Выбрать другое видео',
    hold: 'Камера включена. Когда будете готовы, нажмите «Начать упражнение».', recording: 'Осталось до автоматического завершения:',
    selected: 'Выбрано видео', privacy: 'Видео анализируется на этом телефоне и не отправляется на сервер.',
    processing: 'Проверяем движение…', results: 'Результат занятия', complete: 'Выполнено', check: 'Проверьте инструкцию',
    quality: 'Проверьте инструкцию и попробуйте записать упражнение ещё раз.',
    confidence: 'Уверенность', visibility: 'Видимость руки', duration: 'Длительность', cycles: 'Циклов', videoAttempt: 'Ролик',
    newTry: 'Повторить упражнение', home: 'К упражнениям', history: 'Последние занятия', empty: 'Результаты занятий появятся здесь.',
    historyComplete: 'Выполнено', historyCheck: 'Проверьте инструкцию', historyQuality: 'Проверьте инструкцию', historyNoMetric: 'Нет данных',
    status: 'Состояние', modelMissing: 'Для этого упражнения модель ещё обучается. Выберите E02, чтобы попробовать камеру и обработку видео.',
    cameraError: 'Не удалось открыть камеру. Проверьте разрешение камеры в Safari или загрузите видео.',
    cameraSecureError: 'Камера работает только на защищённом HTTPS-сайте. Откройте опубликованную ссылку SerIQ.', cameraUnsupportedError: 'Этот режим не предоставляет камеру. Откройте сайт в Safari или загрузите видео.', cameraPermissionError: 'Доступ к камере не выдан. В Safari проверьте настройки сайта: Камера → Разрешить. В PWA iPhone может снова запросить доступ при новом запуске.', cameraBusyError: 'Камера занята другим приложением. Закройте его и попробуйте снова.', cameraNotFoundError: 'Не удалось найти камеру. Проверьте её в настройках iPhone или загрузите видео.', cameraRetry: 'Попробовать включить камеру снова', cameraPreviewHelp: 'Камера разрешена, но iPhone не показывает поток. Нажмите кнопку для повторного запуска или откройте SerIQ в Safari.', cameraPreviewRetry: 'Показать камеру', openSafari: 'Открыть SerIQ в Safari',
    modelError: 'Не удалось загрузить модель анализа. Проверьте интернет и попробуйте снова.', fileError: 'Не удалось прочитать видео. Попробуйте MP4/MOV длительностью до 45 секунд.',
    prepareVideo: 'Подготавливаем видео…', scanningVideo: 'Идёт последовательная проверка видео', finalizingVideo: 'Завершаем анализ…', videoStalled: 'Воспроизведение остановилось. Повторите проверку или выберите другой MP4/MOV.',
    durationTip: 'Запишите одно-два спокойных повторения, затем нажмите «Готово».',
    disclaimer: 'Результат помогает следить за занятиями и не заменяет консультацию врача.',
    langName: 'Русский',
    cloudTitle: 'Сохранять историю онлайн',
    cloudDescription: 'Синхронизируются только результаты занятий. Видео и личные данные не отправляются.',
    cloudDone: 'Числовой результат синхронизирован.',
    cloudUnavailable: 'Не удалось синхронизировать. Результат остался на этом телефоне.',
    doctorConsentTitle: 'Разрешить врачу смотреть историю занятий', doctorConsentDescription: 'Врач, связанный с вашим аккаунтом, увидит таблицу результатов и график движения E02. Видео не отправляется.', doctorConsentError: 'Не удалось сохранить разрешение. Проверьте подключение.',
    listenInstruction: 'Прослушать инструкцию', listenResult: 'Прослушать результат',
    modelLoading: 'Загружаем анализ…',
    loadingModelMessage: 'Загружаем модель движения. Видео остаётся на этом телефоне.',
  },
  kz: {
    title: 'SerIQ', subtitle: '', language: 'Русский',
    heroKicker: 'Үйдегі жаттығуларға арналған көмекші', exerciseSection: 'Жаттығуды таңдаңыз', timeEstimate: 'Шамамен 1 минут',
    safetyTitle: 'Өзіңізге ыңғайлы қарқынмен жаттығыңыз', historyKicker: 'СІЗДІҢ ТАРИХЫҢЫЗ', chooseMethod: 'Қай тәсіл ыңғайлы?', chooseMethodHint: 'Камераны қосыңыз немесе дайын бейнені таңдаңыз.',
    liveCamera: 'КАМЕРА', liveVideo: 'БЕЙНЕ',
    durationPick: 'Жаттығу ұзақтығы', seconds: 'сек.', minute: '1 мин', minutes: '2 мин', durationMin: '1 минут', durationMax: '10 минут',
    clipTitle: 'Жаттығу жазбасы', clipPrivacy: 'Бейне тек осы құрылғының жадында сақталады және ешқайда жіберілмейді.',
    cameraPrivacy: 'Бейне құрылғыда уақытша сақталып, жаттығудан шыққанда жойылады.',
    choose: 'Қай жаттығуды орындаймыз?', intro: 'Жаттығуды таңдаңыз. Нұсқаулықты көрсетіп, қозғалысты бағалауға көмектесеміз.',
    safety: 'Бұл көмекші құрал. Ол дәрігерді алмастырмайды және диагноз қоймайды. Ауырсыну немесе жайсыздық болса, тоқтап, медициналық көмекке жүгініңіз.',
    emergency: 'Жедел жәрдем: 103', ready: 'Модель дайын', preparing: 'Модель дайындалуда',
    details: 'Жаттығу туралы', instruction: 'Жаттығу көрсетілімі', stepsTitle: 'Орындау қадамдары', verifiedClip: 'Жаттығу бейнесі', mannequinLoading: '3D көрсетілімі жүктелуде…', demoVideo: 'Бейне', demoMannequin: '3D манекен',
    back: 'Артқа', camera: 'Камераны қосу', upload: 'Бейне жүктеу', cameraMode: 'Телефон камерасы', uploadMode: 'Телефоннан бейне',
    allowCamera: 'Камераға рұқсат беріңіз. Қол толық көрінетіндей телефонды орналастырыңыз.',
    start: 'Жаттығуды бастау', done: 'Дайын', analyze: 'Бейнені тексеру', changeFile: 'Басқа бейнені таңдау',
    hold: 'Камера қосылды. Дайын болғанда «Жаттығуды бастау» батырмасын басыңыз.', recording: 'Автоматты аяқталуына қалды:',
    selected: 'Таңдалған бейне', privacy: 'Бейне осы телефонда талданады және серверге жіберілмейді.',
    processing: 'Қозғалыс тексерілуде…', results: 'Жаттығу нәтижесі', complete: 'Орындалды', check: 'Нұсқаулықты тексеріңіз',
    quality: 'Нұсқаулықты тексеріп, жаттығуды қайта жазып көріңіз.',
    confidence: 'Сенімділік', visibility: 'Қолдың көрінуі', duration: 'Ұзақтығы', cycles: 'Цикл саны', videoAttempt: 'Бейне',
    newTry: 'Жаттығуды қайталау', home: 'Жаттығуларға оралу', history: 'Соңғы жаттығулар', empty: 'Жаттығу нәтижелері осында көрсетіледі.',
    historyComplete: 'Орындалды', historyCheck: 'Нұсқаулықты тексеріңіз', historyQuality: 'Нұсқаулықты тексеріңіз', historyNoMetric: 'Дерек жоқ',
    status: 'Күйі', modelMissing: 'Бұл жаттығудың моделі әлі дайын емес. Камера мен бейне өңдеуді көру үшін E02 таңдаңыз.',
    cameraError: 'Камера ашылмады. Safari баптауынан рұқсат беріңіз немесе бейне жүктеңіз.',
    cameraSecureError: 'Камера тек қорғалған HTTPS сайтында жұмыс істейді. SerIQ жарияланған сілтемесін ашыңыз.', cameraUnsupportedError: 'Бұл режим камераға қол жеткізе алмайды. Safari браузерінде ашыңыз немесе бейне жүктеңіз.', cameraPermissionError: 'Камераға рұқсат берілмеді. Safari сайт баптауынан Камера → Рұқсат ету таңдаңыз. iPhone PWA жаңа іске қосылғанда рұқсатты қайта сұрауы мүмкін.', cameraBusyError: 'Камераны басқа қолданба пайдаланып тұр. Оны жауып, қайта көріңіз.', cameraNotFoundError: 'Камера табылмады. iPhone баптауын тексеріңіз немесе бейне жүктеңіз.', cameraRetry: 'Камераны қайта қосу', cameraPreviewHelp: 'Камераға рұқсат бар, бірақ iPhone бейнені көрсетпеді. Қайта іске қосыңыз немесе SerIQ-ті Safari-де ашыңыз.', cameraPreviewRetry: 'Камераны көрсету', openSafari: 'SerIQ-ті Safari-де ашу',
    modelError: 'Қозғалыс моделін жүктеу мүмкін болмады. Интернетті тексеріп, қайта көріңіз.', fileError: 'Бейнені оқу мүмкін болмады. Ұзақтығы 45 секундқа дейінгі MP4/MOV қолданып көріңіз.',
    prepareVideo: 'Бейне дайындалуда…', scanningVideo: 'Бейне ретімен тексерілуде', finalizingVideo: 'Талдау аяқталуда…', videoStalled: 'Бейне тоқтап қалды. Қайта тексеріңіз немесе басқа MP4/MOV таңдаңыз.',
    durationTip: 'Бір-екі рет асықпай қайталап, «Дайын» батырмасын басыңыз.',
    disclaimer: 'Нәтиже жаттығуларды бақылауға көмектеседі, бірақ дәрігер кеңесін алмастырмайды.',
    langName: 'Қазақша',
    cloudTitle: 'Нәтижелерді онлайн сақтау',
    cloudDescription: 'Тек жаттығу нәтижелері синхрондалады. Бейне мен жеке деректер жіберілмейді.',
    cloudDone: 'Сандық нәтиже синхрондалды.',
    cloudUnavailable: 'Синхрондау орындалмады. Нәтиже осы телефонда қалды.',
    doctorConsentTitle: 'Дәрігерге жаттығулар тарихын көруге рұқсат беру', doctorConsentDescription: 'Аккаунтыңызға байланыстырылған дәрігер нәтижелер кестесі мен E02 қозғалыс графигін көреді. Бейне жіберілмейді.', doctorConsentError: 'Рұқсат сақталмады. Байланысты тексеріңіз.',
    listenInstruction: 'Нұсқаулықты тыңдау', listenResult: 'Нәтижені тыңдау',
    modelLoading: 'Талдау жүктелуде…',
    loadingModelMessage: 'Қозғалыс моделі жүктелуде. Бейне осы телефонда қалады.',
  },
}

function readHistory(): HistoryItem[] {
  try { return JSON.parse(localStorage.getItem('seriq-history') || '[]') as HistoryItem[] } catch { return [] }
}

function App() {
  const [language, setLanguage] = useState<Language>('ru')
  const [screen, setScreen] = useState<Screen>('home')
  const [exerciseId, setExerciseId] = useState<ExerciseId>('E02')
  const [readyModels, setReadyModels] = useState<Set<ExerciseId>>(new Set())
  const [inputMode, setInputMode] = useState<InputMode>('camera')
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [cameraReady, setCameraReady] = useState(false)
  const [cameraAspect, setCameraAspect] = useState(4 / 3)
  const [selectedDuration, setSelectedDuration] = useState(60)
  const [file, setFile] = useState<File | null>(null)
  const [fileUrl, setFileUrl] = useState('')
  const [landmarker, setLandmarker] = useState<BrowserLandmarker | null>(null)
  const [recording, setRecording] = useState(false)
  const [recordedClipUrl, setRecordedClipUrl] = useState('')
  const [processing, setProcessing] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [progress, setProgress] = useState(0)
  const [analysisStage, setAnalysisStage] = useState<'preparing' | 'scanning' | 'finalizing'>('preparing')
  const [cameraPreviewBlocked, setCameraPreviewBlocked] = useState(false)
  const [error, setError] = useState('')
  const [prediction, setPrediction] = useState<Prediction | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>(readHistory)
  const [authUser, setAuthUser] = useState<User | null>(null)
  const [showAccount, setShowAccount] = useState(false)
  const [cloudConsent, setCloudConsent] = useState(localStorage.getItem('seriq-cloud-consent') === 'true')
  const [doctorHistoryConsent, setDoctorHistoryConsentState] = useState(false)
  const [doctorConsentStatus, setDoctorConsentStatus] = useState('')
  const [cloudStatus, setCloudStatus] = useState('')
  const [modelLoading, setModelLoading] = useState(false)
  const [instructionVideoReady, setInstructionVideoReady] = useState(false)
  const [instructionVideoSrc, setInstructionVideoSrc] = useState('')
  const [demoView, setDemoView] = useState<DemoView>('mannequin')
  const [activeNav, setActiveNav] = useState<NavSection>('home')
  const cameraRef = useRef<HTMLVideoElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const fileVideoRef = useRef<HTMLVideoElement>(null)
  const audioPlaybackRef = useRef<HTMLAudioElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const landmarkerRef = useRef<BrowserLandmarker | null>(null)
  const fileUrlRef = useRef('')
  const recordingRef = useRef(false)
  const lastShownSecondRef = useRef(0)
  const samplesRef = useRef<Sample[]>([])
  const rafRef = useRef<number | null>(null)
  const lastSampleRef = useRef(0)
  const startTimeRef = useRef(0)
  const selectedDurationRef = useRef(60)
  const finishAndScoreRef = useRef<(() => Promise<void>) | null>(null)
  const sessionTimerRef = useRef<number | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordingChunksRef = useRef<BlobPart[]>([])
  const recorderDoneRef = useRef<Promise<Blob | null> | null>(null)
  const keepClipRef = useRef(false)
  const recordedClipUrlRef = useRef('')
  const t = copy[language]
  const exercise = exercises.find((item) => item.id === exerciseId) ?? exercises[1]
  const exerciseSteps = language === 'ru' ? {
    E01: ['Сядьте близко к столу', 'Возьмите лёгкий предмет', 'Плавно приподнимите его и верните на стол'],
    E02: ['Оставьте плечо расслабленным', 'Медленно разогните предплечье в локте', 'Спокойно согните руку обратно'],
    E03: ['Положите предплечье на опору', 'Плавно поднимите кисть вверх', 'Верните кисть в исходное положение'],
    E04: ['Расслабьте ладонь', 'Медленно раскройте пальцы', 'Мягко расслабьте кисть'],
  }[exerciseId] : {
    E01: ['Үстелге жақын отырыңыз', 'Жеңіл затты ұстаңыз', 'Затты баяу көтеріп, үстелге қойыңыз'],
    E02: ['Иықты бос ұстаңыз', 'Білекті шынтақтан баяу жазыңыз', 'Қолды жайлап қайта бүгіңіз'],
    E03: ['Білекті тірекке қойыңыз', 'Білезікті баяу жоғары көтеріңіз', 'Білезікті бастапқы қалыпқа түсіріңіз'],
    E04: ['Алақанды бос ұстаңыз', 'Саусақтарды баяу ашыңыз', 'Білезікті жайлап босатыңыз'],
  }[exerciseId]
  const formatClock = (seconds: number) => `${Math.floor(Math.max(0, seconds) / 60).toString().padStart(2, '0')}:${(Math.max(0, seconds) % 60).toString().padStart(2, '0')}`

  const playAudioSequence = async (paths: string[]) => {
    audioPlaybackRef.current?.pause()
    audioPlaybackRef.current = null
    for (const path of paths) {
      const player = new Audio(path)
      player.preload = 'auto'
      audioPlaybackRef.current = player
      await new Promise<void>((resolve) => {
        player.onended = () => resolve()
        player.onerror = () => resolve()
        void player.play().catch(() => resolve())
      })
    }
  }

  const playExerciseInstruction = () => {
    const suffix = language === 'ru' ? 'rus' : 'kaz'
    const languageCode = language === 'ru' ? 'ru' : 'kz'
    return playAudioSequence([`/audio/number${Number(exerciseId.slice(1))}${suffix}.wav`, `/audio/instr_${languageCode}.mp3`])
  }

  const playResultAudio = () => playAudioSequence([`/audio/${prediction?.verdict === 'complete' ? 'ok' : 'check'}_${language === 'ru' ? 'ru' : 'kz'}.mp3`])

  useEffect(() => {
    let cancelled = false
    Promise.all(exercises.map(async (item) => {
      try {
        const model = await getModel(item.id)
        return model.status === 'ready' ? item.id : null
      } catch { return null }
    })).then((items) => { if (!cancelled) setReadyModels(new Set(items.filter((id): id is ExerciseId => id !== null))) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!supabaseConfigured) return
    void getSignedInUser().then(setAuthUser).catch(() => setAuthUser(null))
    return subscribeToAuth(setAuthUser)
  }, [])

  useEffect(() => {
    let cancelled = false
    setDoctorHistoryConsentState(false)
    if (!authUser || authUser.is_anonymous || !supabaseConfigured) return
    void getDoctorHistoryConsent().then((allowed) => { if (!cancelled) setDoctorHistoryConsentState(allowed) }).catch((cause) => console.error(cause))
    return () => { cancelled = true }
  }, [authUser?.id, authUser?.is_anonymous])

  useEffect(() => { document.documentElement.lang = language === 'ru' ? 'ru' : 'kk' }, [language])

  useEffect(() => {
    if (screen === 'result' && prediction) void playResultAudio()
  }, [screen, prediction, language])

  useEffect(() => {
    let cancelled = false
    setInstructionVideoReady(false)
    setInstructionVideoSrc('')
    setDemoView('mannequin')
    const localPath = exerciseId === 'E02' ? '/instructions/video2.mp4' : `/instructions/${exerciseId}.mp4`
    const cloudPath = exerciseId === 'E02' ? getInstructionVideoUrl('video2.mp4') : null
    const isPlayableVideo = async (path: string) => {
      try {
        const response = await fetch(path, { method: 'HEAD' })
        return response.ok && (response.headers.get('content-type')?.toLowerCase().startsWith('video/') ?? false)
      } catch { return false }
    }
    void (async () => {
      const cloudReady = cloudPath ? await isPlayableVideo(cloudPath) : false
      const localReady = await isPlayableVideo(localPath)
      if (!cancelled) {
        setInstructionVideoReady(cloudReady || localReady)
        if (cloudReady || localReady) {
          setInstructionVideoSrc(cloudReady ? cloudPath! : localPath)
          setDemoView('video')
        }
      }
    })()
    return () => { cancelled = true }
  }, [exerciseId])

  useEffect(() => {
    if ((!cloudConsent && !doctorHistoryConsent) || !supabaseConfigured) return
    let cancelled = false
    void loadCloudAttempts().then((remote) => {
      if (cancelled || !remote.length) return
      setHistory((local) => {
        const merged = [...remote, ...local.filter((item) => !remote.some((saved) => saved.id === item.id))].slice(0, 20)
        localStorage.setItem('seriq-history', JSON.stringify(merged))
        return merged
      })
    }).catch((cause) => console.error(cause))
    return () => { cancelled = true }
  }, [cloudConsent, doctorHistoryConsent, authUser?.id])

  useEffect(() => {
    if (stream && cameraRef.current) {
      const video = cameraRef.current
      video.srcObject = stream
      video.muted = true
      video.playsInline = true
      void video.play().then(() => setCameraPreviewBlocked(false)).catch((cause) => {
        console.warn('Camera stream is active, but the preview could not start.', cause)
        setCameraPreviewBlocked(true)
      })
    }
  }, [stream, screen])

  useEffect(() => {
    if (!stream || screen !== 'session' || inputMode !== 'camera') return
    const timeout = window.setTimeout(() => {
      const video = cameraRef.current
      // Live camera streams commonly keep currentTime at 0 in Safari/iOS.
      // Check decoded dimensions/readiness only; currentTime is not a live-preview signal.
      if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) setCameraPreviewBlocked(true)
    }, 8000)
    return () => window.clearTimeout(timeout)
  }, [stream, screen, inputMode, cameraReady])

  useEffect(() => {
    if (screen !== 'session' || inputMode !== 'camera' || !cameraReady || !landmarker) return
    rafRef.current = requestAnimationFrame((now) => sampleCamera(now))
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current) }
  }, [screen, inputMode, cameraReady, landmarker])

  useEffect(() => { landmarkerRef.current = landmarker }, [landmarker])
  useEffect(() => { streamRef.current = stream }, [stream])
  useEffect(() => { fileUrlRef.current = fileUrl }, [fileUrl])
  useEffect(() => { recordedClipUrlRef.current = recordedClipUrl }, [recordedClipUrl])
  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    audioPlaybackRef.current?.pause()
    streamRef.current?.getTracks().forEach((track) => track.stop())
    landmarkerRef.current?.close()
    if (fileUrlRef.current) URL.revokeObjectURL(fileUrlRef.current)
    if (recordedClipUrlRef.current) URL.revokeObjectURL(recordedClipUrlRef.current)
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop()
    if (sessionTimerRef.current !== null) window.clearInterval(sessionTimerRef.current)
  }, [])

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setCameraReady(false)
    setStream(null)
  }, [])

  const retryCameraPreview = async () => {
    const video = cameraRef.current
    if (!video || !streamRef.current) return
    video.srcObject = streamRef.current
    video.muted = true
    video.playsInline = true
    try {
      await video.play()
      setCameraPreviewBlocked(false)
    } catch (cause) {
      console.warn('Manual camera preview retry failed.', cause)
      setCameraPreviewBlocked(true)
    }
  }

  const prepareExercise = async (id: ExerciseId) => {
    setActiveNav('exercise')
    setExerciseId(id)
    setError('')
    setPrediction(null)
    setFile(null)
    keepClipRef.current = false
    if (recordedClipUrl) URL.revokeObjectURL(recordedClipUrl)
    recordedClipUrlRef.current = ''
    setRecordedClipUrl('')
    if (fileUrl) URL.revokeObjectURL(fileUrl)
    fileUrlRef.current = ''
    setFileUrl('')
    setScreen('exercise')
  }

  const chooseMode = async (mode: InputMode) => {
    setError('')
    setInputMode(mode)
    setCameraReady(false)
    setCameraPreviewBlocked(false)
    if (!readyModels.has(exerciseId)) { setError('model_missing'); return }
    if (mode === 'upload') {
      stopCamera()
      const input = document.getElementById('video-file') as HTMLInputElement | null
      if (input) input.value = ''
      document.getElementById('video-file')?.click()
      return
    }
    if (!window.isSecureContext) { setError('camera_secure_error'); return }
    if (!navigator.mediaDevices?.getUserMedia) { setError('camera_unsupported'); return }
    setModelLoading(true)
    let nextStream: MediaStream
    try {
      try {
        nextStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 640 }, height: { ideal: 480 } },
        })
      } catch (cause) {
        const name = cause instanceof DOMException ? cause.name : ''
        if (name !== 'OverconstrainedError' && name !== 'ConstraintNotSatisfiedError') throw cause
        nextStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true })
      }
    } catch (cause) {
      console.error(cause)
      const name = cause instanceof DOMException ? cause.name : ''
      setError(name === 'NotAllowedError' || name === 'SecurityError' ? 'camera_permission'
        : name === 'NotFoundError' ? 'camera_missing'
          : name === 'NotReadableError' || name === 'AbortError' ? 'camera_busy'
            : 'camera_error')
      setModelLoading(false)
      return
    }

    streamRef.current = nextStream
    setStream(nextStream)
    setFile(null)
    setScreen('session')
    try {
      const runtime = await BrowserLandmarker.create(exerciseId)
      setLandmarker((previous) => { previous?.close(); return runtime })
      landmarkerRef.current = runtime
    } catch (cause) {
      console.error(cause)
      setError('model_error')
      landmarkerRef.current?.close()
      landmarkerRef.current = null
      setLandmarker(null)
    } finally { setModelLoading(false) }
  }

  const onFile = (selected: File | undefined) => {
    if (!selected) return
    if (fileUrl) URL.revokeObjectURL(fileUrl)
    fileUrlRef.current = ''
    setFile(selected)
    const nextUrl = URL.createObjectURL(selected)
    fileUrlRef.current = nextUrl
    setFileUrl(nextUrl)
    setScreen('session')
    setError('')
    if (readyModels.has(exerciseId)) {
      setModelLoading(true)
      void BrowserLandmarker.create(exerciseId, true).then((runtime) => {
        setLandmarker((previous) => { previous?.close(); return runtime })
        landmarkerRef.current = runtime
      }).catch((cause) => {
        console.error(cause)
        setError('model_error')
      }).finally(() => setModelLoading(false))
    }
  }

  const sampleCamera = (now: number) => {
    if (screen !== 'session' || inputMode !== 'camera' || !landmarkerRef.current || !cameraRef.current) return
    if (now - lastSampleRef.current >= 100) {
      const tSeconds = (now - startTimeRef.current) / 1000
      const sample = landmarkerRef.current.detect(cameraRef.current, now, tSeconds)
      if (overlayRef.current) drawLandmarks(overlayRef.current, cameraRef.current, sample)
      if (recordingRef.current) samplesRef.current.push(sample)
      lastSampleRef.current = now
    }
    rafRef.current = requestAnimationFrame(sampleCamera)
  }

  const startExercise = () => {
    samplesRef.current = []
    startTimeRef.current = performance.now()
    lastSampleRef.current = 0
    lastShownSecondRef.current = 0
    recordingRef.current = true
    setElapsed(0)
    setProgress(0)
    setRecording(true)
    lastSampleRef.current = 0
    if (sessionTimerRef.current !== null) window.clearInterval(sessionTimerRef.current)
    sessionTimerRef.current = window.setInterval(() => {
      const elapsedSeconds = (performance.now() - startTimeRef.current) / 1000
      const wholeSeconds = Math.floor(elapsedSeconds)
      if (wholeSeconds !== lastShownSecondRef.current) {
        lastShownSecondRef.current = wholeSeconds
        setElapsed(elapsedSeconds)
      }
      if (elapsedSeconds >= selectedDurationRef.current && recordingRef.current) {
        recordingRef.current = false
        setRecording(false)
        void finishAndScoreRef.current?.()
      }
    }, 200)
    keepClipRef.current = true
    recordingChunksRef.current = []
    const streamForClip = streamRef.current
    if (streamForClip && typeof MediaRecorder !== 'undefined') {
      try {
        const mimeType = ['video/mp4', 'video/webm;codecs=vp8', 'video/webm'].find((candidate) => MediaRecorder.isTypeSupported(candidate))
        const recorder = new MediaRecorder(streamForClip, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 700_000 })
        recorderDoneRef.current = new Promise<Blob | null>((resolve) => {
          recorder.ondataavailable = (event) => { if (event.data.size) recordingChunksRef.current.push(event.data) }
          recorder.onstop = () => {
            const chunks = recordingChunksRef.current
            const clip = chunks.length ? new Blob(chunks, { type: recorder.mimeType || mimeType || 'video/webm' }) : null
            recordingChunksRef.current = []
            if (clip && keepClipRef.current) {
              const nextUrl = URL.createObjectURL(clip)
              if (recordedClipUrlRef.current) URL.revokeObjectURL(recordedClipUrlRef.current)
              recordedClipUrlRef.current = nextUrl
              setRecordedClipUrl(nextUrl)
            }
            resolve(clip)
            recorderDoneRef.current = null
          }
          recorder.onerror = () => { resolve(null); recorderDoneRef.current = null }
        })
        mediaRecorderRef.current = recorder
        recorder.start(500)
      } catch (cause) {
        console.warn('Device video recording is unavailable; continuing with live analysis.', cause)
        recorderDoneRef.current = null
        mediaRecorderRef.current = null
      }
    }
  }

  const persistAttempt = async (result: Prediction) => {
    const item: HistoryItem = {
      id: crypto.randomUUID(), exercise: exerciseId,
      verdict: result.verdict, time: new Date().toLocaleString(language === 'ru' ? 'ru-RU' : 'kk-KZ', { dateStyle: 'short', timeStyle: 'short' }),
      confidence: result.confidence, detectedPercent: result.detectedPercent,
      durationSeconds: result.durationSeconds, cycleCount: result.cycleCount,
    }
    const next = [item, ...readHistory()].slice(0, 20)
    localStorage.setItem('seriq-history', JSON.stringify(next))
    setHistory(next)
    if ((cloudConsent || doctorHistoryConsent) && supabaseConfigured) {
      try {
        await syncAttempt(exerciseId, result)
        setCloudStatus('saved')
      } catch (cause) {
        console.error(cause)
        setCloudStatus('failed')
      }
    }
  }

  const finishAndScore = async (samples = samplesRef.current, preserveProgress = false) => {
    setRecording(false)
    recordingRef.current = false
    if (sessionTimerRef.current !== null) window.clearInterval(sessionTimerRef.current)
    sessionTimerRef.current = null
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    const recorder = mediaRecorderRef.current
    if (recorder?.state === 'recording') recorder.stop()
    if (recorderDoneRef.current) await recorderDoneRef.current
    mediaRecorderRef.current = null
    stopCamera()
    setProcessing(true)
    if (!preserveProgress) setProgress(0)
    setAnalysisStage('finalizing')
    setError('')
    try {
      const result = await scoreSamples(exerciseId, samples)
      setPrediction(result)
      setScreen('result')
      void persistAttempt(result)
    } catch (cause) {
      console.error(cause)
      setError(cause instanceof Error && cause.message === 'model_missing' ? 'model_missing' : 'file_error')
      setScreen('session')
    } finally {
      setProcessing(false)
      landmarkerRef.current?.close()
      landmarkerRef.current = null
      setLandmarker(null)
    }
  }
  finishAndScoreRef.current = finishAndScore

  const chooseDuration = (seconds: number) => {
    selectedDurationRef.current = seconds
    setSelectedDuration(seconds)
  }

  const analyzeUpload = async () => {
    const video = fileVideoRef.current
    if (!video || !landmarker) return
    setProcessing(true)
    setProgress(0)
    setAnalysisStage('preparing')
    setError('')
    try {
      const waitForMedia = (eventName: 'loadedmetadata' | 'loadeddata' | 'seeked', ready: () => boolean, timeoutText: string) => new Promise<void>((resolve, reject) => {
        if (ready()) { resolve(); return }
        const timeout = window.setTimeout(() => finish(new Error(timeoutText)), 12000)
        const finish = (cause?: Error) => {
          window.clearTimeout(timeout)
          video.removeEventListener(eventName, onReady)
          video.removeEventListener('error', onError)
          cause ? reject(cause) : resolve()
        }
        const onReady = () => finish()
        const onError = () => finish(new Error('video decode failed'))
        video.addEventListener(eventName, onReady, { once: true })
        video.addEventListener('error', onError, { once: true })
      })
      if (video.readyState < 1) await new Promise<void>((resolve, reject) => {
        void waitForMedia('loadedmetadata', () => video.readyState >= 1, 'video metadata timeout').then(resolve, reject)
        video.load()
      })
      if (video.readyState < 2) await waitForMedia('loadeddata', () => video.readyState >= 2, 'video frame timeout')
      if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error('invalid video duration')
      const duration = Math.min(video.duration, 45)
      const samples: Sample[] = []
      video.pause()
      if (video.currentTime > 0.05) {
        const seeked = waitForMedia('seeked', () => video.currentTime < 0.05, 'video rewind timeout')
        video.currentTime = 0
        await seeked
      }
      video.muted = true
      video.playsInline = true
      await video.play()
      setAnalysisStage('scanning')
      let lastSampleTime = -1
      let lastVideoTime = video.currentTime
      let lastAdvanceAt = performance.now()
      // Inference is CPU-heavy on older phones. ~2.5 samples/sec is enough
      // for this cycle classifier and avoids locking up Safari's main thread.
      const sampleInterval = 0.4
      while (video.currentTime < duration && !video.ended) {
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
        const time = video.currentTime
        if (time > lastVideoTime + 0.01) {
          lastVideoTime = time
          lastAdvanceAt = performance.now()
        } else if (performance.now() - lastAdvanceAt > 12000) {
          throw new Error('video playback stalled')
        }
        if (video.readyState >= 2 && time < duration && time - lastSampleTime >= sampleInterval) {
          samples.push(landmarker.detect(video, Math.max(samples.length + 1, Math.round(time * 1000)), time))
          lastSampleTime = time
          setProgress(Math.max(1, Math.min(95, Math.floor(time / duration * 95))))
        }
      }
      video.pause()
      if (!samples.length) throw new Error('video had no decodable frames')
      setProgress(100)
      setAnalysisStage('finalizing')
      await finishAndScore(samples, true)
    } catch (cause) {
      console.error(cause)
      setError(cause instanceof Error && cause.message.includes('stalled') ? 'video_stalled' : 'file_error')
      video.pause()
    } finally { setProcessing(false) }
  }

  const returnHome = () => {
    if (sessionTimerRef.current !== null) window.clearInterval(sessionTimerRef.current)
    sessionTimerRef.current = null
    keepClipRef.current = false
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop()
    mediaRecorderRef.current = null
    recorderDoneRef.current = null
    if (recordedClipUrlRef.current) URL.revokeObjectURL(recordedClipUrlRef.current)
    recordedClipUrlRef.current = ''
    setRecordedClipUrl('')
    stopCamera()
    landmarker?.close()
    setLandmarker(null)
    setFile(null)
    setFileUrl('')
    setError('')
    setPrediction(null)
    setRecording(false)
    recordingRef.current = false
    setActiveNav('home')
    setScreen('home')
  }

  const navigate = (section: NavSection) => {
    returnHome()
    if (section === 'chat') {
      setActiveNav('chat')
      setScreen('chat')
      return
    }
    setActiveNav(section)
    if (section === 'home') { window.scrollTo({ top: 0, behavior: 'smooth' }); return }
    window.setTimeout(() => document.getElementById(section === 'exercise' ? 'exercise-section' : 'history-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  const cameraErrors: Record<string, string> = {
    camera_error: t.cameraError, camera_secure_error: t.cameraSecureError,
    camera_unsupported: t.cameraUnsupportedError, camera_permission: t.cameraPermissionError,
    camera_busy: t.cameraBusyError, camera_missing: t.cameraNotFoundError,
  }
  const errorText = error === 'model_missing' ? t.modelMissing : error === 'model_error' ? t.modelError
    : error === 'video_stalled' ? t.videoStalled : cameraErrors[error] ?? (error ? t.fileError : '')

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={returnHome} aria-label="SerIQ — на главную">
          <span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>
          <span><strong>{t.title}</strong></span>
        </button>
        <div className="language-switch" role="group" aria-label="Язык / Тіл">
          <button className={language === 'ru' ? 'is-active' : ''} aria-pressed={language === 'ru'} onClick={() => setLanguage('ru')}>Рус</button>
          <button className={language === 'kz' ? 'is-active' : ''} aria-pressed={language === 'kz'} onClick={() => setLanguage('kz')}>Қаз</button>
        </div>
        <div className="topbar-actions">
          <button className="account-button" type="button" onClick={() => setShowAccount(true)}><svg className="account-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="3.4"/><path d="M5.5 20c.5-3.7 2.7-5.6 6.5-5.6s6 1.9 6.5 5.6"/></svg>{language === 'ru' ? authUser && !authUser.is_anonymous ? 'Аккаунт' : 'Войти' : authUser && !authUser.is_anonymous ? 'Аккаунт' : 'Кіру'}</button>
        </div>
      </header>

      {screen === 'home' && <>
        <section className="welcome-card">
          <div className="welcome-copy">
          <div className="eyebrow">{t.heroKicker}</div>
            <h1>{t.choose}</h1>
            <p>{t.intro}</p>
          </div>
        </section>

        <section id="exercise-section" className="exercise-section" aria-labelledby="exercise-heading">
          <div className="section-title"><div><span className="section-kicker">1 / 2</span><h2 id="exercise-heading">{t.exerciseSection}</h2></div><span className="duration-pill">{t.timeEstimate}</span></div>
          <div className="exercise-grid">
            {exercises.map((item, index) => {
              const ready = readyModels.has(item.id)
              return <button className={`exercise-card ${ready ? '' : 'exercise-card-pending'}`} key={item.id} onClick={() => void prepareExercise(item.id)} aria-disabled={!ready}>
                <span className={`exercise-number exercise-number-${index + 1}`}>{String(index + 1).padStart(2, '0')}</span>
                <span className="exercise-card-text"><span className="exercise-name">{language === 'ru' ? item.ru : item.kz}</span><span className="exercise-desc">{language === 'ru' ? item.short : ['Үстелден жеңіл затты көтеріңіз', 'Қолыңызды шынтақтан баяу жазыңыз', 'Білезігіңізді көтеріп, бастапқы қалпына қайтарыңыз', 'Алақаныңызды ашыңыз, содан кейін босаңсытыңыз'][index]}</span></span>
                <span className={`model-badge ${ready ? 'is-ready' : ''}`}><i />{ready ? t.ready : t.preparing}</span>
                <span className="card-arrow" aria-hidden="true">→</span>
              </button>
            })}
          </div>
        </section>

        <section className="safety-card"><span className="safety-icon" aria-hidden="true">♡</span><div><strong>{t.safetyTitle}</strong><p>{t.safety}</p><a href="tel:103">{t.emergency}</a></div></section>

        <section id="history-section" className="history-section"><div className="section-title history-title"><div><span className="section-kicker">{t.historyKicker}</span><h2>{t.history}</h2></div></div>
          {history.length ? <div className="history-list">{history.slice(0, 3).map((item) => {
            const verdictText = item.verdict === 'complete' ? t.historyComplete : item.verdict === 'quality' ? t.historyQuality : t.historyCheck
            return <div className="history-entry" key={item.id}>
              <div className="history-row">
                <span className={`history-dot ${item.verdict === 'check' ? 'history-dot-check' : item.verdict === 'quality' ? 'history-dot-quality' : ''}`} />
                <span className="history-exercise">{item.exercise} · {exercises.find((e) => e.id === item.exercise)?.[language]}<small className="history-verdict">{verdictText}</small></span>
                <time>{item.time}</time>
              </div>
            </div>
          })}</div> : <p className="history-empty">{t.empty}</p>}
          {supabaseConfigured && <label className="cloud-consent"><input type="checkbox" checked={cloudConsent} onChange={(event) => { setCloudConsent(event.target.checked); localStorage.setItem('seriq-cloud-consent', String(event.target.checked)); setCloudStatus('') }} /><span><strong>{t.cloudTitle}</strong><small>{t.cloudDescription}</small></span></label>}
          {supabaseConfigured && <label className="cloud-consent doctor-consent"><input type="checkbox" checked={doctorHistoryConsent} disabled={!authUser || authUser.is_anonymous} onChange={(event) => {
            const allowed = event.target.checked
            setDoctorConsentStatus('')
            void setDoctorHistoryConsent(allowed).then(() => { setDoctorHistoryConsentState(allowed); setDoctorConsentStatus('saved') }).catch((cause) => { console.error(cause); setDoctorConsentStatus('failed') })
          }} /><span><strong>{t.doctorConsentTitle}</strong><small>{authUser && !authUser.is_anonymous ? t.doctorConsentDescription : language === 'ru' ? 'Войдите в аккаунт, чтобы управлять доступом врача.' : 'Дәрігерге рұқсатты басқару үшін аккаунтқа кіріңіз.'}</small>{doctorConsentStatus === 'failed' && <small role="alert">{t.doctorConsentError}</small>}</span></label>}
        </section>
      </>}

      {screen === 'exercise' && <section className="flow-card">
        <button className="back-button" onClick={returnHome}>← {t.back}</button>
        <div className="flow-heading"><span className="exercise-number exercise-number-2">{exerciseId.slice(1)}</span><div><span className="section-kicker">{exerciseId}</span><h1>{exercise[language]}</h1></div></div>
        <div className="instruction-card">
          <div className="instruction-copy"><div className="instruction-demo-heading"><h2>{t.instruction}</h2>
            {instructionVideoReady && <div className="demo-switch" role="group" aria-label={t.instruction}>
              <button type="button" className={demoView === 'video' ? 'is-selected' : ''} onClick={() => setDemoView('video')}>{t.demoVideo}</button>
              <button type="button" className={demoView === 'mannequin' ? 'is-selected' : ''} onClick={() => setDemoView('mannequin')}>{t.demoMannequin}</button>
            </div>}
          </div>
            {demoView === 'video' && instructionVideoReady
              ? <><h3>{t.verifiedClip}</h3><video className="instruction-video" controls playsInline preload="metadata" src={instructionVideoSrc} /></>
              : <Suspense fallback={<div className="mannequin-loading" role="status">{t.mannequinLoading}</div>}><InstructionMannequin exerciseId={exerciseId} language={language} /></Suspense>}
            <h3>{t.stepsTitle}</h3><ol className="instruction-steps">{exerciseSteps.map((step, index) => <li key={step}><span>{index + 1}</span><strong>{step}</strong></li>)}</ol><p className="instruction-note">{language === 'ru' ? 'Выполняйте медленно. При боли или дискомфорте остановитесь.' : 'Асықпай орындаңыз. Ауырсыну не жайсыздық сезілсе, тоқтаңыз.'}</p>
            <button className="secondary-button audio-instruction-button" type="button" onClick={() => void playExerciseInstruction()}><span aria-hidden="true">🔊</span>{t.listenInstruction}</button>
          </div>
        </div>
        <div className="mode-heading"><span className="section-kicker">2 / 2</span><h2>{t.chooseMethod}</h2><p>{t.chooseMethodHint}</p></div>
        <div className="mode-grid">
          <button className="mode-card" disabled={modelLoading || !readyModels.has(exerciseId)} onClick={() => void chooseMode('camera')}>
            <span className="mode-icon camera-icon" aria-hidden="true">◎</span><strong>{t.camera}</strong><small>{t.cameraMode} · {t.privacy}</small>
          </button>
          <button className="mode-card" disabled={modelLoading || !readyModels.has(exerciseId)} onClick={() => void chooseMode('upload')}>
            <span className="mode-icon upload-icon" aria-hidden="true">↑</span><strong>{t.upload}</strong><small>{t.uploadMode} · MP4, MOV</small>
          </button>
        </div>
        <input id="video-file" className="visually-hidden" type="file" accept="video/*,.mp4,.mov,.m4v,.avi" onChange={(event) => onFile(event.target.files?.[0])} />
        {!readyModels.has(exerciseId) && <div className="notice notice-info" role="status">{t.modelMissing}</div>}
        {modelLoading && <div className="notice notice-info" role="status">{t.loadingModelMessage}</div>}
        {errorText && <div className="notice notice-warn" role="alert">{errorText}</div>}
        {error.startsWith('camera_') && <button className="secondary-button camera-retry-button" type="button" onClick={() => void chooseMode('camera')}>{t.cameraRetry}</button>}
      </section>}

      {screen === 'session' && <section className="flow-card session-card">
        <button className="back-button" onClick={returnHome}>← {t.back}</button>
        <div className="session-title"><div><span className="section-kicker">{exerciseId} · {inputMode === 'camera' ? t.cameraMode : t.uploadMode}</span><h1>{exercise[language]}</h1></div><span className="live-badge"><i />{inputMode === 'camera' ? t.liveCamera : t.liveVideo}</span></div>
        <div className={`preview-frame ${inputMode === 'camera' ? 'preview-camera' : ''}`} style={inputMode === 'camera' ? { aspectRatio: String(cameraAspect) } : undefined}>
          {inputMode === 'camera' && <video ref={cameraRef} className="preview-video" autoPlay playsInline muted onLoadedMetadata={(event) => { const video = event.currentTarget; const { videoWidth, videoHeight } = video; if (videoWidth && videoHeight) setCameraAspect(videoWidth / videoHeight); void video.play().catch((cause) => { console.warn('Camera autoplay blocked.', cause); setCameraPreviewBlocked(true) }) }} onCanPlay={() => { setCameraReady(true); setCameraPreviewBlocked(false) }} aria-label="Предпросмотр камеры" />}
          {inputMode === 'camera' && <canvas ref={overlayRef} className="landmark-overlay" aria-hidden="true" />}
          {inputMode === 'upload' && <video ref={fileVideoRef} className="preview-video" src={fileUrl || undefined} controls playsInline muted preload="metadata" aria-label="Предпросмотр загруженного видео" />}
          {inputMode === 'camera' && <div className="camera-guide"><span className="guide-corner top-left" /><span className="guide-corner top-right" /><span className="guide-corner bottom-left" /><span className="guide-corner bottom-right" /><span className="guide-copy">Рука должна быть видна целиком</span></div>}
          {inputMode === 'camera' && cameraPreviewBlocked && <div className="camera-preview-help" role="status"><strong>{t.cameraPreviewHelp}</strong><button className="secondary-button" type="button" onClick={() => void retryCameraPreview()}>{t.cameraPreviewRetry}</button><a href={window.location.href} target="_blank" rel="noreferrer">{t.openSafari}</a></div>}
          {processing && <div className="processing-overlay"><div className="spinner" /><strong>{t.processing}</strong><small>{analysisStage === 'preparing' ? t.prepareVideo : analysisStage === 'scanning' ? t.scanningVideo : t.finalizingVideo}</small><div className="progress-track"><i style={{ width: `${progress}%` }} /></div><span>{progress}%</span></div>}
        </div>
        <p className="privacy-line"><span aria-hidden="true">🔒</span>{inputMode === 'camera' ? `${t.hold} ${t.cameraPrivacy}` : `${t.selected}: ${file?.name || ''}. ${t.privacy}`}</p>
        {inputMode === 'camera' ? <>
        {inputMode === 'camera' && !recording && !processing && <fieldset className="duration-control">
          <legend>{t.durationPick}</legend>
          <output className="duration-value" htmlFor="exercise-duration">{Math.floor(selectedDuration / 60)} {language === 'ru' ? 'мин' : 'мин'}</output>
          <input id="exercise-duration" className="duration-slider" type="range" min="60" max="600" step="60" value={selectedDuration} onChange={(event) => chooseDuration(Number(event.currentTarget.value))} aria-valuetext={`${Math.floor(selectedDuration / 60)} ${language === 'ru' ? 'минут' : 'минут'}`} />
          <div className="duration-range-labels"><span>{t.durationMin}</span><span>{t.durationMax}</span></div>
        </fieldset>}
        <p className="duration-tip">{recording ? <><span>{t.recording}</span><strong className="session-clock">{formatClock(selectedDuration - Math.floor(elapsed))}</strong><small className="session-elapsed">{formatClock(Math.floor(elapsed))} / {formatClock(selectedDuration)}</small></> : t.durationTip}</p>
          {!recording ? <button className="primary-button" onClick={startExercise} disabled={!landmarker || !cameraReady || cameraPreviewBlocked}>{modelLoading ? t.modelLoading : t.start}<span aria-hidden="true">→</span></button> : <button className="primary-button button-done" onClick={() => void finishAndScore()}>{t.done}<span aria-hidden="true">✓</span></button>}
        </> : <>
          <div className="session-actions"><button className="primary-button" onClick={() => void analyzeUpload()} disabled={!landmarker || !file || processing}>{processing ? t.processing : t.analyze}<span aria-hidden="true">→</span></button><button className="secondary-button" onClick={() => document.getElementById('video-file')?.click()}>{t.changeFile}</button></div>
        </>}
        {errorText && <div className="notice notice-warn" role="alert">{errorText}</div>}
        {modelLoading && <div className="notice notice-info" role="status">{t.loadingModelMessage}</div>}
      </section>}

      {screen === 'result' && prediction && <section className="flow-card result-card">
        <div className={`result-symbol ${prediction.verdict === 'complete' ? 'result-good' : 'result-check'}`} aria-hidden="true">{prediction.verdict === 'complete' ? '✓' : '↻'}</div>
        <span className="section-kicker">{t.results}</span>
        <h1>{prediction.verdict === 'quality' ? t.quality : prediction.verdict === 'complete' ? t.complete : t.check}</h1>
        <p className="result-description">{t.disclaimer}</p>
        <button className="secondary-button audio-result-button" type="button" onClick={() => void playResultAudio()}><span aria-hidden="true">🔊</span>{t.listenResult}</button>
        {recordedClipUrl && <div className="recorded-clip-card"><strong>{t.clipTitle}</strong><video src={recordedClipUrl} controls playsInline preload="metadata" /><small>{t.clipPrivacy}</small></div>}
        <button className="primary-button" onClick={() => void prepareExercise(exerciseId)}>{t.newTry}<span aria-hidden="true">↻</span></button>
        {cloudStatus && <div className={`notice ${cloudStatus === 'saved' ? 'notice-info' : 'notice-warn'}`} role="status">{cloudStatus === 'saved' ? t.cloudDone : t.cloudUnavailable}</div>}
        <button className="text-button" onClick={returnHome}>{t.home}</button>
      </section>}

      {screen === 'chat' && <CareChat language={language} signedIn={Boolean(authUser && !authUser.is_anonymous)} onLogin={() => setShowAccount(true)} />}

      <nav className="primary-nav" aria-label={language === 'ru' ? 'Основная навигация' : 'Негізгі навигация'}>
        <button className={activeNav === 'home' ? 'is-active' : ''} onClick={() => navigate('home')}><span aria-hidden="true">⌂</span>{language === 'ru' ? 'Главная' : 'Басты бет'}</button>
        <button className={activeNav === 'exercise' ? 'is-active' : ''} onClick={() => navigate('exercise')}><span aria-hidden="true">＋</span>{language === 'ru' ? 'Упражнения' : 'Жаттығулар'}</button>
        <button className={activeNav === 'history' ? 'is-active' : ''} onClick={() => navigate('history')}><span aria-hidden="true">◷</span>{language === 'ru' ? 'История' : 'Тарих'}</button>
        <button className={activeNav === 'chat' ? 'is-active' : ''} onClick={() => navigate('chat')}><span aria-hidden="true">✉</span>{language === 'ru' ? 'Врач' : 'Дәрігер'}</button>
      </nav>
      {showAccount && <AccountDialog language={language} user={authUser} onClose={() => setShowAccount(false)} />}
      <footer className="app-footer"><span>SerIQ · AI-Sana Shakarim</span><span> {t.disclaimer}</span></footer>
    </main>
  )
}

export default App
