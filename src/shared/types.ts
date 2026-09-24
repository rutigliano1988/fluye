export type DictationMode = 'clean' | 'literal' | 'message' | 'email'
export type AppStatus = 'idle' | 'recording' | 'processing' | 'success' | 'error'
export type RealtimeDelay = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
export type ShortcutMode = 'hold' | 'toggle'
export type RecordingIntent = 'dictation' | 'edit'
export type TranscriptionProvider = 'openai' | 'local'

export interface PublicSettings {
  shortcut: string
  editShortcut: string
  shortcutMode: ShortcutMode
  onboardingCompleted: boolean
  language: 'auto' | 'es' | 'en' | 'ca' | 'fr' | 'de' | 'it' | 'pt'
  mode: DictationMode
  autoPaste: boolean
  launchAtLogin: boolean
  transcriptionProvider: TranscriptionProvider
  realtimeEnabled: boolean
  realtimeDelay: RealtimeDelay
  transcriptionModel: string
  polishModel: string
  dictionary: string[]
  hasApiKey: boolean
}

export interface SaveSettingsInput extends Omit<PublicSettings, 'hasApiKey'> {
  apiKey?: string
  clearApiKey?: boolean
}

export interface DictationResult {
  id: string
  createdAt: string
  transcript: string
  text: string
  mode: DictationMode
  durationMs: number
  operation?: RecordingIntent
}

export interface RecordingStartPayload {
  intent: RecordingIntent
}

export interface ProcessAudioInput {
  bytes: Uint8Array
  mimeType: string
  durationMs: number
}

export interface StatusPayload {
  status: AppStatus
  message?: string
}

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'up-to-date'
  | 'error'
  | 'unavailable'

export interface UpdateStatus {
  phase: UpdatePhase
  currentVersion: string
  availableVersion?: string
  percent?: number
  transferred?: number
  total?: number
  message?: string
}
