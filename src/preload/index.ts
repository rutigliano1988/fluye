import { contextBridge, ipcRenderer } from 'electron'
import type {
  DictationResult,
  ProcessAudioInput,
  PublicSettings,
  RecordingStartPayload,
  SaveSettingsInput,
  StatusPayload,
  UpdateStatus
} from '../shared/types'

const api = {
  getSettings: (): Promise<PublicSettings> => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: SaveSettingsInput): Promise<PublicSettings> =>
    ipcRenderer.invoke('settings:save', settings),
  getHistory: (): Promise<DictationResult[]> => ipcRenderer.invoke('history:get'),
  clearHistory: (): Promise<void> => ipcRenderer.invoke('history:clear'),
  processAudio: (input: ProcessAudioInput): Promise<DictationResult> =>
    ipcRenderer.invoke('audio:process', input),
  startRealtime: (): Promise<void> => ipcRenderer.invoke('realtime:start'),
  appendRealtimeAudio: (bytes: Uint8Array): void => ipcRenderer.send('realtime:append', bytes),
  finishRealtime: (durationMs: number): Promise<DictationResult> =>
    ipcRenderer.invoke('realtime:finish', durationMs),
  cancelRealtime: (): Promise<void> => ipcRenderer.invoke('realtime:cancel'),
  setShortcutCapture: (capturing: boolean): Promise<void> =>
    ipcRenderer.invoke('shortcut:capture', capturing),
  setStatus: (payload: StatusPayload): void => ipcRenderer.send('status:set', payload),
  getUpdateStatus: (): Promise<UpdateStatus> => ipcRenderer.invoke('updates:status'),
  checkForUpdates: (): Promise<UpdateStatus> => ipcRenderer.invoke('updates:check'),
  downloadUpdate: (): Promise<UpdateStatus> => ipcRenderer.invoke('updates:download'),
  installUpdate: (): Promise<void> => ipcRenderer.invoke('updates:install'),
  hideWindow: (): void => ipcRenderer.send('window:hide'),
  onToggleRecording: (callback: (payload: RecordingStartPayload) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: RecordingStartPayload): void => callback(payload)
    ipcRenderer.on('recording:toggle', listener)
    return () => ipcRenderer.removeListener('recording:toggle', listener)
  },
  onStartRecording: (callback: (payload: RecordingStartPayload) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: RecordingStartPayload): void => callback(payload)
    ipcRenderer.on('recording:start', listener)
    return () => ipcRenderer.removeListener('recording:start', listener)
  },
  onStopRecording: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('recording:stop', listener)
    return () => ipcRenderer.removeListener('recording:stop', listener)
  },
  onRecordingError: (callback: (message: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, message: string): void => callback(message)
    ipcRenderer.on('recording:error', listener)
    return () => ipcRenderer.removeListener('recording:error', listener)
  },
  onStatusUpdate: (callback: (payload: StatusPayload) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: StatusPayload): void => callback(payload)
    ipcRenderer.on('status:update', listener)
    return () => ipcRenderer.removeListener('status:update', listener)
  },
  onTranscriptionPartial: (callback: (text: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, text: string): void => callback(text)
    ipcRenderer.on('transcription:partial', listener)
    return () => ipcRenderer.removeListener('transcription:partial', listener)
  },
  onUpdateStatus: (callback: (status: UpdateStatus) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: UpdateStatus): void => callback(status)
    ipcRenderer.on('updates:status', listener)
    return () => ipcRenderer.removeListener('updates:status', listener)
  }
}

contextBridge.exposeInMainWorld('fluye', api)

export type FluyeApi = typeof api
