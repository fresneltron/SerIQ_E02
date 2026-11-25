import { createClient } from '@supabase/supabase-js'
import type { User } from '@supabase/supabase-js'
import type { ExerciseId, Prediction } from './vision'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const publicKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined

export const supabaseConfigured = Boolean(url && publicKey)
export const supabase = supabaseConfigured ? createClient(url!, publicKey!, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
}) : null

export type { User }

export async function getSignedInUser() {
  if (!supabase) return null
  const { data, error } = await supabase.auth.getUser()
  if (error) throw error
  return data.user
}

export function subscribeToAuth(callback: (user: User | null) => void) {
  if (!supabase) return () => undefined
  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => callback(session?.user ?? null))
  return () => subscription.unsubscribe()
}

export async function authenticateWithEmail(email: string, password: string, mode: 'login' | 'register') {
  if (!supabase) throw new Error('supabase_not_configured')
  if (mode === 'login') {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    return { user: data.user, confirmationRequired: false }
  }

  const { data: { session } } = await supabase.auth.getSession()
  if (session?.user.is_anonymous) {
    const { data, error } = await supabase.auth.updateUser({ email, password })
    if (error) throw error
    return { user: data.user, confirmationRequired: true }
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: window.location.origin },
  })
  if (error) throw error
  return { user: data.user, confirmationRequired: !data.session }
}

export async function authenticateWithGoogle() {
  if (!supabase) throw new Error('supabase_not_configured')
  const { data: { session } } = await supabase.auth.getSession()
  const options = { redirectTo: window.location.origin }
  const { error } = session?.user.is_anonymous
    ? await supabase.auth.linkIdentity({ provider: 'google', options })
    : await supabase.auth.signInWithOAuth({ provider: 'google', options })
  if (error) throw error
}

export async function signOutUser() {
  if (!supabase) return
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

export type CareMessage = { id: string; relationship_id: string; sender_id: string; body: string; created_at: string }
export type CareThread = { id: string; patient_id: string; doctor_id: string }
export type DoctorAttempt = {
  id: string; exercise_id: ExerciseId; verdict: 'complete' | 'check' | 'quality'; confidence: number
  detected_percent: number; duration_seconds: number; cycle_count: number; created_at: string
  angle_series: Array<{ t: number; angle: number }> | null
  cycle_features: Array<Record<string, number>> | null
  doctor_verdict: 'complete' | 'check' | null; doctor_note: string | null; doctor_reviewed_by: string | null; doctor_reviewed_at: string | null
}

export async function saveDoctorReview(attemptId: string, verdict: 'complete' | 'check') {
  if (!supabase) throw new Error('supabase_not_configured')
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError) throw userError
  if (!user || user.is_anonymous) throw new Error('sign_in_required')
  const { error } = await supabase.from('rehab_attempts').update({
    doctor_verdict: verdict, doctor_reviewed_by: user.id, doctor_reviewed_at: new Date().toISOString(),
  }).eq('id', attemptId)
  if (error) throw error
}

export async function getDoctorHistoryConsent() {
  if (!supabase) return false
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError) throw userError
  if (!user || user.is_anonymous) return false
  const { data, error } = await supabase.from('doctor_history_consents').select('allow_history').eq('patient_id', user.id).maybeSingle()
  if (error) throw error
  return data?.allow_history === true
}

export async function setDoctorHistoryConsent(allowHistory: boolean) {
  if (!supabase) throw new Error('supabase_not_configured')
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError) throw userError
  if (!user || user.is_anonymous) throw new Error('sign_in_required')
  const { error } = await supabase.from('doctor_history_consents').upsert({ patient_id: user.id, allow_history: allowHistory, updated_at: new Date().toISOString() })
  if (error) throw error
}

export async function loadDoctorPatientAttempts(patientId: string) {
  if (!supabase) throw new Error('supabase_not_configured')
  const { data: consent, error: consentError } = await supabase.from('doctor_history_consents')
    .select('allow_history').eq('patient_id', patientId).maybeSingle()
  if (consentError) throw consentError
  if (!consent?.allow_history) return { allowed: false, attempts: [] as DoctorAttempt[] }
  const { data, error } = await supabase.from('rehab_attempts')
    .select('id, exercise_id, verdict, confidence, detected_percent, duration_seconds, cycle_count, created_at, angle_series, cycle_features, doctor_verdict, doctor_note, doctor_reviewed_by, doctor_reviewed_at')
    .eq('user_id', patientId).order('created_at', { ascending: false }).limit(100)
  if (error) throw error
  return { allowed: true, attempts: (data ?? []) as DoctorAttempt[] }
}

export async function loadCareThreads() {
  if (!supabase) throw new Error('supabase_not_configured')
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError) throw userError
  if (!user || user.is_anonymous) return { user: null, role: null, thread: null, messages: [] as CareMessage[] }

  const { data: profile, error: profileError } = await supabase.from('profiles')
    .select('role').eq('user_id', user.id).maybeSingle()
  if (profileError) throw profileError

  const { data: threads, error: threadError } = await supabase.from('care_relationships')
    .select('id, patient_id, doctor_id')
    .or(`patient_id.eq.${user.id},doctor_id.eq.${user.id}`)
    .order('created_at', { ascending: false }).limit(100)
  if (threadError) throw threadError
  return { user, role: profile?.role ?? 'patient', threads: (threads ?? []) as CareThread[] }
}

export async function loadCareMessages(threadId: string) {
  if (!supabase) throw new Error('supabase_not_configured')
  const { data, error } = await supabase.from('doctor_messages')
    .select('id, relationship_id, sender_id, body, created_at')
    .eq('relationship_id', threadId).order('created_at', { ascending: true }).limit(100)
  if (error) throw error
  return (data ?? []) as CareMessage[]
}

export async function sendCareMessage(threadId: string, body: string) {
  if (!supabase) throw new Error('supabase_not_configured')
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError) throw userError
  if (!user || user.is_anonymous) throw new Error('sign_in_required')
  const { data, error } = await supabase.from('doctor_messages').insert({ relationship_id: threadId, sender_id: user.id, body: body.trim() })
    .select('id, relationship_id, sender_id, body, created_at').single()
  if (error) throw error
  return data as CareMessage
}

export function subscribeToCareMessages(threadId: string, callback: (message: CareMessage) => void) {
  if (!supabase) return () => undefined
  const channel = supabase.channel(`care-chat-${threadId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'doctor_messages', filter: `relationship_id=eq.${threadId}` }, (payload) => callback(payload.new as CareMessage))
    .subscribe()
  return () => { void supabase.removeChannel(channel) }
}

export function getInstructionVideoUrl(path: string) {
  if (!supabase) return null
  return supabase.storage.from('instruction-videos').getPublicUrl(path).data.publicUrl
}

export async function syncAttempt(exerciseId: ExerciseId, result: Prediction) {
  if (!supabase) throw new Error('supabase_not_configured')
  let { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    const response = await supabase.auth.signInAnonymously()
    if (response.error) throw response.error
    session = response.data.session
  }
  if (!session?.user.id) throw new Error('anonymous_session_missing')
  const { error } = await supabase.from('rehab_attempts').insert({
    user_id: session.user.id,
    exercise_id: exerciseId,
    verdict: result.verdict,
    probability: result.probability,
    confidence: result.confidence,
    detected_percent: result.detectedPercent,
    duration_seconds: result.durationSeconds,
    cycle_count: result.cycleCount,
    angle_series: result.angleSeries ?? null,
    cycle_features: result.cycleFeatures ?? null,
  })
  if (error) throw error
}

export async function loadCloudAttempts() {
  if (!supabase) return []
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return []
  const { data, error } = await supabase.from('rehab_attempts')
    .select('id, exercise_id, verdict, confidence, detected_percent, duration_seconds, cycle_count, created_at, angle_series, cycle_features')
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) throw error
  return (data ?? []).map((row) => ({
    id: row.id,
    exercise: row.exercise_id as ExerciseId,
    verdict: row.verdict as 'complete' | 'check' | 'quality',
    time: new Date(row.created_at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }),
    confidence: row.confidence,
    detectedPercent: row.detected_percent,
    durationSeconds: row.duration_seconds,
    cycleCount: row.cycle_count,
    angleSeries: row.angle_series,
    cycleFeatures: row.cycle_features,
  }))
}
