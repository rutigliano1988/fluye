import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AppStatus,
  DictationMode,
  DictationResult,
  PublicSettings,
  RecordingIntent,
  SaveSettingsInput,
  UpdateStatus
} from '../../shared/types'
import Onboarding from './Onboarding'

type Tab = 'home' | 'history' | 'settings'

const modeNames: Record<DictationMode, string> = {
  clean: 'Texto limpio',
  literal: 'Literal',
  message: 'Mensaje',
  email: 'Correo'
}

const modeDescriptions: Record<DictationMode, string> = {
  clean: 'Puntuación natural y menos muletillas',
  literal: 'La transcripción tal como la dices',
  message: 'Breve, directo y conversacional',
  email: 'Ordenado, cálido y profesional'
}

const emptyDraft: SaveSettingsInput = {
  shortcut: 'CommandOrControl+Alt+Space',
  editShortcut: 'CommandOrControl+Alt+Shift+Space',
  shortcutMode: 'hold',
  onboardingCompleted: false,
  language: 'auto',
  mode: 'clean',
  autoPaste: true,
  launchAtLogin: false,
  realtimeEnabled: true,
  realtimeDelay: 'low',
  transcriptionModel: 'gpt-transcribe',
  polishModel: 'gpt-6-luna',
  dictionary: []
}

function settingsToDraft(settings: PublicSettings): SaveSettingsInput {
  return {
    shortcut: settings.shortcut,
    editShortcut: settings.editShortcut,
    shortcutMode: settings.shortcutMode,
    onboardingCompleted: settings.onboardingCompleted,
    language: settings.language,
    mode: settings.mode,
    autoPaste: settings.autoPaste,
    launchAtLogin: settings.launchAtLogin,
    realtimeEnabled: settings.realtimeEnabled,
    realtimeDelay: settings.realtimeDelay,
    transcriptionModel: settings.transcriptionModel,
    polishModel: settings.polishModel,
    dictionary: settings.dictionary
  }
}

function MicIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 15.25a4 4 0 0 0 4-4V6a4 4 0 0 0-8 0v5.25a4 4 0 0 0 4 4Z" />
      <path d="M5.75 10.75V12a6.25 6.25 0 0 0 12.5 0v-1.25M12 18.25V22M8.5 22h7" />
    </svg>
  )
}

function cleanError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text
    .replace(/^Error invoking remote method '[^']+': Error: /, '')
    .replace(/^Error: /, '')
}

function resampleToPcm16(input: Float32Array, inputRate: number): Uint8Array {
  const outputRate = 24_000
  const outputLength = Math.max(1, Math.round(input.length * outputRate / inputRate))
  const pcm = new Int16Array(outputLength)

  for (let index = 0; index < outputLength; index += 1) {
    const sourcePosition = index * inputRate / outputRate
    const leftIndex = Math.floor(sourcePosition)
    const rightIndex = Math.min(leftIndex + 1, input.length - 1)
    const mix = sourcePosition - leftIndex
    const sample = input[leftIndex] * (1 - mix) + input[rightIndex] * mix
    const clamped = Math.max(-1, Math.min(1, sample))
    pcm[index] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
  }

  return new Uint8Array(pcm.buffer)
}

export default function App(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('home')
  const [settings, setSettings] = useState<PublicSettings | null>(null)
  const [draft, setDraft] = useState<SaveSettingsInput>(emptyDraft)
  const [apiKey, setApiKey] = useState('')
  const [dictionaryText, setDictionaryText] = useState('')
  const [history, setHistory] = useState<DictationResult[]>([])
  const [status, setStatus] = useState<AppStatus>('idle')
  const [message, setMessage] = useState('')
  const [lastResult, setLastResult] = useState<DictationResult | null>(null)
  const [partialTranscript, setPartialTranscript] = useState('')
  const [micLevel, setMicLevel] = useState(0)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [capturingShortcut, setCapturingShortcut] = useState<RecordingIntent | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ phase: 'idle', currentVersion: '' })
  const [updateBusy, setUpdateBusy] = useState(false)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const startedAtRef = useRef(0)
  const statusRef = useRef<AppStatus>('idle')
  const audioContextRef = useRef<AudioContext | null>(null)
  const meterFrameRef = useRef<number | null>(null)
  const realtimeAudioRef = useRef<{
    context: AudioContext
    source: MediaStreamAudioSourceNode
    processor: ScriptProcessorNode
    silentGain: GainNode
  } | null>(null)
  const realtimeReadyRef = useRef(false)
  const realtimeStartRef = useRef<Promise<boolean> | null>(null)
  const realtimeQueueRef = useRef<Uint8Array[]>([])
  const startingRecordingRef = useRef(false)
  const stopAfterStartRef = useRef(false)
  const discardRecordingRef = useRef(false)

  const setAppStatus = useCallback((next: AppStatus, detail = '') => {
    statusRef.current = next
    setStatus(next)
    setMessage(detail)
    window.fluye.setStatus({ status: next, message: detail })
  }, [])

  useEffect(() => {
    Promise.all([window.fluye.getSettings(), window.fluye.getHistory(), window.fluye.getUpdateStatus()])
      .then(([loadedSettings, loadedHistory, loadedUpdateStatus]) => {
        setSettings(loadedSettings)
        setDraft(settingsToDraft(loadedSettings))
        setShowOnboarding(!loadedSettings.onboardingCompleted)
        setDictionaryText(loadedSettings.dictionary.join('\n'))
        setHistory(loadedHistory)
        setUpdateStatus(loadedUpdateStatus)
      })
      .catch((error) => setMessage(cleanError(error)))
  }, [])

  useEffect(() => window.fluye.onTranscriptionPartial(setPartialTranscript), [])
  useEffect(() => window.fluye.onUpdateStatus(setUpdateStatus), [])

  const stopLevelMeter = useCallback(() => {
    if (meterFrameRef.current !== null) cancelAnimationFrame(meterFrameRef.current)
    meterFrameRef.current = null
    if (audioContextRef.current) void audioContextRef.current.close()
    audioContextRef.current = null
    setMicLevel(0)
  }, [])

  const startLevelMeter = useCallback((stream: MediaStream) => {
    const audioContext = new AudioContext()
    const analyser = audioContext.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.72
    audioContext.createMediaStreamSource(stream).connect(analyser)
    audioContextRef.current = audioContext
    void audioContext.resume()

    const samples = new Uint8Array(analyser.fftSize)
    let lastUpdate = 0
    const readLevel = (timestamp: number): void => {
      analyser.getByteTimeDomainData(samples)
      if (timestamp - lastUpdate > 45) {
        let sum = 0
        for (const sample of samples) {
          const normalized = (sample - 128) / 128
          sum += normalized * normalized
        }
        const level = Math.min(1, Math.sqrt(sum / samples.length) * 5.2)
        setMicLevel((previous) => previous * 0.58 + level * 0.42)
        lastUpdate = timestamp
      }
      meterFrameRef.current = requestAnimationFrame(readLevel)
    }
    meterFrameRef.current = requestAnimationFrame(readLevel)
  }, [])

  const stopRealtimeCapture = useCallback(() => {
    const capture = realtimeAudioRef.current
    if (!capture) return
    capture.processor.onaudioprocess = null
    capture.source.disconnect()
    capture.processor.disconnect()
    capture.silentGain.disconnect()
    void capture.context.close()
    realtimeAudioRef.current = null
  }, [])

  const startRealtimeCapture = useCallback((stream: MediaStream) => {
    const context = new AudioContext()
    const source = context.createMediaStreamSource(stream)
    const processor = context.createScriptProcessor(4096, 1, 1)
    const silentGain = context.createGain()
    silentGain.gain.value = 0

    processor.onaudioprocess = (event) => {
      const bytes = resampleToPcm16(event.inputBuffer.getChannelData(0), context.sampleRate)
      if (realtimeReadyRef.current) {
        window.fluye.appendRealtimeAudio(bytes)
      } else if (realtimeQueueRef.current.length < 160) {
        realtimeQueueRef.current.push(bytes)
      }
    }

    source.connect(processor)
    processor.connect(silentGain)
    silentGain.connect(context.destination)
    realtimeAudioRef.current = { context, source, processor, silentGain }
    void context.resume()
  }, [])

  const finishRecording = useCallback(() => {
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') recorder.stop()
  }, [])

  const startRecording = useCallback(async (intent: RecordingIntent = 'dictation') => {
    if (statusRef.current !== 'idle' && statusRef.current !== 'success' && statusRef.current !== 'error') return
    if (!settings?.hasApiKey) {
      setTab('settings')
      setAppStatus('error', 'Configura tu clave de API')
      return
    }

    startingRecordingRef.current = true
    stopAfterStartRef.current = false
    discardRecordingRef.current = false
    try {
      setPartialTranscript('')
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1
        }
      })
      streamRef.current = stream
      startLevelMeter(stream)
      chunksRef.current = []
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm'
      const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64000 })
      recorderRef.current = recorder
      startedAtRef.current = Date.now()

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }

      recorder.onstop = async () => {
        stopRealtimeCapture()
        streamRef.current?.getTracks().forEach((track) => track.stop())
        streamRef.current = null
        stopLevelMeter()
        const durationMs = Date.now() - startedAtRef.current
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType })
        chunksRef.current = []
        recorderRef.current = null

        if (discardRecordingRef.current) {
          discardRecordingRef.current = false
          realtimeReadyRef.current = false
          realtimeStartRef.current = null
          realtimeQueueRef.current = []
          void window.fluye.cancelRealtime()
          return
        }

        setAppStatus('processing', 'Finalizando la transcripción…')

        try {
          const realtimeAvailable = await (realtimeStartRef.current ?? Promise.resolve(false))
          let result: DictationResult

          if (realtimeAvailable) {
            try {
              result = await window.fluye.finishRealtime(durationMs)
            } catch {
              const bytes = new Uint8Array(await blob.arrayBuffer())
              result = await window.fluye.processAudio({ bytes, mimeType: recorder.mimeType, durationMs })
            }
          } else {
            const bytes = new Uint8Array(await blob.arrayBuffer())
            result = await window.fluye.processAudio({ bytes, mimeType: recorder.mimeType, durationMs })
          }

          setLastResult(result)
          setPartialTranscript('')
          setHistory((items) => [result, ...items].slice(0, 50))
          setAppStatus(
            'success',
            result.operation === 'edit'
              ? 'Texto seleccionado actualizado'
              : settings.autoPaste
                ? 'Insertado en la ventana de origen'
                : 'Copiado al portapapeles'
          )
          window.setTimeout(() => setAppStatus('idle'), 1600)
        } catch (error) {
          setAppStatus('error', cleanError(error))
        } finally {
          realtimeReadyRef.current = false
          realtimeStartRef.current = null
          realtimeQueueRef.current = []
        }
      }

      recorder.start(250)
      setAppStatus(
        'recording',
        intent === 'edit' ? 'Dime cómo quieres cambiar el texto seleccionado' : ''
      )

      realtimeReadyRef.current = false
      realtimeQueueRef.current = []
      if (settings.realtimeEnabled) {
        startRealtimeCapture(stream)
        realtimeStartRef.current = window.fluye.startRealtime()
          .then(() => {
            realtimeReadyRef.current = true
            for (const bytes of realtimeQueueRef.current) window.fluye.appendRealtimeAudio(bytes)
            realtimeQueueRef.current = []
            if (statusRef.current === 'recording') {
              setMessage('Transcribiendo en vivo')
              window.fluye.setStatus({ status: 'recording', message: 'Transcribiendo en vivo' })
            }
            return true
          })
          .catch(() => {
            realtimeReadyRef.current = false
            realtimeQueueRef.current = []
            stopRealtimeCapture()
            void window.fluye.cancelRealtime()
            if (statusRef.current === 'recording') {
              const fallbackMessage = 'Modo seguro activo: transcribiré al terminar'
              setMessage(fallbackMessage)
              window.fluye.setStatus({ status: 'recording', message: fallbackMessage })
            }
            return false
          })
      } else {
        realtimeStartRef.current = Promise.resolve(false)
      }
      startingRecordingRef.current = false
      if (stopAfterStartRef.current) {
        stopAfterStartRef.current = false
        recorder.stop()
      }
    } catch (error) {
      startingRecordingRef.current = false
      stopAfterStartRef.current = false
      stopRealtimeCapture()
      void window.fluye.cancelRealtime()
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      stopLevelMeter()
      setAppStatus(
        'error',
        error instanceof DOMException && error.name === 'NotAllowedError'
          ? 'Permite el acceso al micrófono en Windows'
          : cleanError(error)
      )
    }
  }, [setAppStatus, settings, startLevelMeter, startRealtimeCapture, stopLevelMeter, stopRealtimeCapture])

  const requestStartRecording = useCallback((intent: RecordingIntent = 'dictation') => {
    if (startingRecordingRef.current || statusRef.current === 'recording' || statusRef.current === 'processing') return
    stopAfterStartRef.current = false
    void startRecording(intent)
  }, [startRecording])

  const requestStopRecording = useCallback(() => {
    if (startingRecordingRef.current) {
      stopAfterStartRef.current = true
      return
    }
    if (statusRef.current === 'recording') finishRecording()
  }, [finishRecording])

  const toggleRecording = useCallback((intent: RecordingIntent = 'dictation') => {
    if (startingRecordingRef.current || statusRef.current === 'recording') requestStopRecording()
    else requestStartRecording(intent)
  }, [requestStartRecording, requestStopRecording])

  const handleRecordingError = useCallback((detail: string) => {
    discardRecordingRef.current = true
    if (startingRecordingRef.current) stopAfterStartRef.current = true
    else finishRecording()
    setAppStatus('error', detail)
  }, [finishRecording, setAppStatus])

  useEffect(() => {
    const removeToggle = window.fluye.onToggleRecording(({ intent }) => toggleRecording(intent))
    const removeStart = window.fluye.onStartRecording(({ intent }) => requestStartRecording(intent))
    const removeStop = window.fluye.onStopRecording(requestStopRecording)
    const removeError = window.fluye.onRecordingError(handleRecordingError)
    return () => {
      removeToggle()
      removeStart()
      removeStop()
      removeError()
    }
  }, [handleRecordingError, requestStartRecording, requestStopRecording, toggleRecording])

  const finishShortcutCapture = useCallback(() => {
    setCapturingShortcut(null)
    void window.fluye.setShortcutCapture(false)
  }, [])

  const beginShortcutCapture = useCallback(async (intent: RecordingIntent) => {
    setMessage('')
    await window.fluye.setShortcutCapture(true)
    setCapturingShortcut(intent)
  }, [])

  useEffect(() => {
    if (!capturingShortcut) return

    const onKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      if (event.repeat) return
      if (event.key === 'Escape') {
        finishShortcutCapture()
        return
      }
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return

      const modifiers: string[] = []
      if (event.ctrlKey) modifiers.push('CommandOrControl')
      if (event.altKey) modifiers.push('Alt')
      if (event.shiftKey) modifiers.push('Shift')
      if (event.metaKey) modifiers.push('Super')

      const key =
        event.code === 'Space'
          ? 'Space'
          : event.code.startsWith('Key')
            ? event.code.slice(3)
            : event.code.startsWith('Digit')
              ? event.code.slice(5)
              : event.key.length === 1
                ? event.key.toUpperCase()
                : event.key

      if (modifiers.length === 0 && !/^F(?:[1-9]|1\d|2[0-4])$/.test(key)) {
        setMessage('El atajo necesita Ctrl, Alt, Shift o la tecla Windows.')
        return
      }

      const shortcut = [...modifiers, key].join('+')
      setDraft((value) => ({
        ...value,
        [capturingShortcut === 'edit' ? 'editShortcut' : 'shortcut']: shortcut
      }))
      finishShortcutCapture()
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [capturingShortcut, finishShortcutCapture])

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop())
      stopLevelMeter()
      stopRealtimeCapture()
      void window.fluye.cancelRealtime()
      void window.fluye.setShortcutCapture(false)
    }
  }, [stopLevelMeter, stopRealtimeCapture])

  const saveSettings = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (capturingShortcut) finishShortcutCapture()
    setSaveState('saving')
    setMessage('')
    try {
      const updated = await window.fluye.saveSettings({
        ...draft,
        apiKey: apiKey.trim() || undefined,
        dictionary: dictionaryText
          .split(/[\n,]/)
          .map((item) => item.trim())
          .filter(Boolean)
      })
      setSettings(updated)
      setDraft(settingsToDraft(updated))
      setDictionaryText(updated.dictionary.join('\n'))
      setApiKey('')
      setSaveState('saved')
      window.setTimeout(() => setSaveState('idle'), 1600)
    } catch (error) {
      setMessage(cleanError(error))
      setSaveState('idle')
    }
  }

  const clearApiKey = async (): Promise<void> => {
    if (!settings) return
    try {
      const updated = await window.fluye.saveSettings({ ...draft, clearApiKey: true })
      setSettings(updated)
      setApiKey('')
    } catch (error) {
      setMessage(cleanError(error))
    }
  }

  const clearHistory = async (): Promise<void> => {
    await window.fluye.clearHistory()
    setHistory([])
    setLastResult(null)
  }

  const checkUpdates = async (): Promise<void> => {
    setUpdateBusy(true)
    try {
      setUpdateStatus(await window.fluye.checkForUpdates())
    } catch (error) {
      setUpdateStatus((current) => ({ ...current, phase: 'error', message: cleanError(error) }))
    } finally {
      setUpdateBusy(false)
    }
  }

  const downloadUpdate = async (): Promise<void> => {
    setUpdateBusy(true)
    try {
      setUpdateStatus(await window.fluye.downloadUpdate())
    } catch (error) {
      setUpdateStatus((current) => ({ ...current, phase: 'error', message: cleanError(error) }))
    } finally {
      setUpdateBusy(false)
    }
  }

  const installUpdate = async (): Promise<void> => {
    setUpdateBusy(true)
    try {
      await window.fluye.installUpdate()
    } catch (error) {
      setUpdateBusy(false)
      setUpdateStatus((current) => ({ ...current, phase: 'error', message: cleanError(error) }))
    }
  }

  const shortcutLabel = useMemo(
    () =>
      (settings?.shortcut ?? emptyDraft.shortcut)
        .replace('CommandOrControl', 'Ctrl')
        .split('+'),
    [settings]
  )
  const editShortcutLabel = useMemo(
    () => (settings?.editShortcut ?? emptyDraft.editShortcut).replace('CommandOrControl', 'Ctrl').replaceAll('+', ' + '),
    [settings]
  )

  const isBusy = status === 'processing'

  const saveOnboardingChanges = async (
    changes: Partial<SaveSettingsInput>
  ): Promise<PublicSettings> => {
    const updated = await window.fluye.saveSettings({ ...draft, ...changes })
    setSettings(updated)
    setDraft(settingsToDraft(updated))
    setDictionaryText(updated.dictionary.join('\n'))
    return updated
  }

  if (settings && showOnboarding) {
    return (
      <Onboarding
        settings={settings}
        onSave={saveOnboardingChanges}
        onFinished={() => setShowOnboarding(false)}
      />
    )
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand__icon"><i /><i /><i /><i /><i /></span>
          <span>Fluye</span>
        </div>
        <nav className="nav" aria-label="Navegación principal">
          <button className={tab === 'home' ? 'active' : ''} onClick={() => setTab('home')}>
            <span>⌂</span> Inicio
          </button>
          <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>
            <span>↶</span> Historial
          </button>
          <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>
            <span>⚙</span> Ajustes
          </button>
        </nav>
        <div className="sidebar__foot">
          <span className={`connection-dot ${settings?.hasApiKey ? 'ready' : ''}`} />
          {settings?.hasApiKey ? 'Listo para dictar' : 'Falta configurar la API'}
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">DICTADO INTELIGENTE PARA WINDOWS</span>
            <h1>{tab === 'home' ? 'Habla. El texto fluye.' : tab === 'history' ? 'Tus últimos dictados' : 'Ajusta Fluye a tu voz'}</h1>
          </div>
          <button className="window-hide" onClick={() => window.fluye.hideWindow()} title="Ocultar en la bandeja">—</button>
        </header>

        {tab === 'home' && (
          <section className="home-grid">
            <article className={`dictation-card status-${status}`}>
              <div className="dictation-card__halo" />
              <div className="mic-visual">
                {status === 'recording' && (
                  <span
                    className="mic-level-ring"
                    style={{ '--mic-level': micLevel } as React.CSSProperties}
                  />
                )}
                <button
                  className="mic-button"
                  onClick={() => toggleRecording('dictation')}
                  disabled={isBusy}
                  aria-label={status === 'recording' ? 'Detener dictado' : 'Comenzar dictado'}
                >
                  {status === 'processing' ? <span className="large-spinner" /> : <MicIcon />}
                </button>
              </div>
              <h2>
                {status === 'recording'
                  ? 'Te escucho…'
                  : status === 'processing'
                    ? 'Dándole forma…'
                    : status === 'success'
                      ? 'Ya está'
                      : status === 'error'
                        ? 'Revisemos esto'
                        : 'Pulsa para hablar'}
              </h2>
              <p className={status === 'error' ? 'error-text' : ''}>
                {message || (status === 'recording'
                  ? settings?.shortcutMode === 'hold'
                    ? 'Suelta el atajo para terminar'
                    : 'Vuelve a pulsar para terminar'
                  : settings?.shortcutMode === 'hold'
                    ? 'Mantén el atajo pulsado para hablar'
                    : 'También puedes usar el atajo desde cualquier aplicación')}
              </p>
              <div className="shortcut" aria-label="Atajo de teclado">
                {shortcutLabel.map((key) => <kbd key={key}>{key}</kbd>)}
              </div>
              <span className="edit-shortcut-hint">
                Selecciona texto y usa {editShortcutLabel} para editarlo con la voz
              </span>
              {status === 'recording' && (
                <>
                  <span className="mic-level-label">Nivel {Math.round(micLevel * 100)}%</span>
                  <div className="recording-wave" aria-hidden="true">
                    {Array.from({ length: 22 }, (_, index) => (
                      <i
                        key={index}
                        style={{ height: `${7 + micLevel * (11 + (index % 5) * 5)}px` }}
                      />
                    ))}
                  </div>
                </>
              )}
            </article>

            <aside className="right-stack">
              <article className="panel mode-panel">
                <span className="panel-label">MODO ACTUAL</span>
                <h3>{modeNames[settings?.mode ?? 'clean']}</h3>
                <p>{modeDescriptions[settings?.mode ?? 'clean']}</p>
                <div className="mode-pills">
                  {(Object.keys(modeNames) as DictationMode[]).map((mode) => (
                    <button
                      key={mode}
                      className={(settings?.mode ?? 'clean') === mode ? 'selected' : ''}
                      onClick={async () => {
                        if (!settings) return
                        const updated = await window.fluye.saveSettings({ ...draft, mode })
                        setSettings(updated)
                        setDraft((value) => ({ ...value, mode }))
                      }}
                    >
                      {modeNames[mode]}
                    </button>
                  ))}
                </div>
              </article>

              <article className="panel last-panel">
                <div className="panel-heading">
                  <span className="panel-label">
                    {status === 'recording' && partialTranscript
                      ? 'TRANSCRIPCIÓN EN VIVO'
                      : status === 'processing' && partialTranscript
                        ? 'FINALIZANDO TRANSCRIPCIÓN'
                        : 'ÚLTIMO RESULTADO'}
                  </span>
                  {lastResult && (
                    <button className="text-action" onClick={() => navigator.clipboard.writeText(lastResult.text)}>Copiar</button>
                  )}
                </div>
                {(status === 'recording' || status === 'processing') && partialTranscript ? (
                  <p className="last-result last-result--partial">{partialTranscript}<span className="typing-cursor" /></p>
                ) : lastResult ? (
                  <p className="last-result">{lastResult.text}</p>
                ) : (
                  <div className="empty-result">
                    <span>✦</span>
                    <p>Tu último dictado aparecerá aquí.</p>
                  </div>
                )}
              </article>
            </aside>
          </section>
        )}

        {tab === 'history' && (
          <section className="history-view">
            <div className="section-toolbar">
              <p>Los últimos 50 dictados se guardan localmente en este equipo.</p>
              {history.length > 0 && <button className="secondary-button" onClick={clearHistory}>Borrar historial</button>}
            </div>
            {history.length === 0 ? (
              <div className="empty-page"><span>↶</span><h2>Aún no hay dictados</h2><p>Cuando uses Fluye, aparecerán aquí.</p></div>
            ) : (
              <div className="history-list">
                {history.map((item) => (
                  <article className="history-item" key={item.id}>
                    <div className="history-item__meta">
                      <span>{item.operation === 'edit' ? 'Edición por voz' : modeNames[item.mode]}</span>
                      <time>{new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.createdAt))}</time>
                    </div>
                    <p>{item.text}</p>
                    <button className="text-action" onClick={() => navigator.clipboard.writeText(item.text)}>Copiar</button>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        {tab === 'settings' && (
          <form className="settings-view" onSubmit={saveSettings}>
            <section className="settings-section">
              <div className="settings-section__intro">
                <span className="section-number">01</span>
                <div><h2>Conexión</h2><p>La clave se cifra con la protección de Windows y nunca se muestra de nuevo.</p></div>
              </div>
              <div className="form-card">
                <label className="field">
                  <span>Clave de API de OpenAI</span>
                  <div className="input-with-badge">
                    <input
                      type="password"
                      value={apiKey}
                      onChange={(event) => setApiKey(event.target.value)}
                      placeholder={settings?.hasApiKey ? '••••••••••••••••  Guardada' : 'sk-…'}
                      autoComplete="off"
                    />
                    <span className={settings?.hasApiKey ? 'badge badge--ok' : 'badge'}>{settings?.hasApiKey ? 'Protegida' : 'Pendiente'}</span>
                  </div>
                </label>
                {settings?.hasApiKey && <button type="button" className="danger-link" onClick={clearApiKey}>Eliminar clave guardada</button>}
                <button type="button" className="onboarding-again" onClick={() => setShowOnboarding(true)}>Volver a abrir el asistente inicial</button>
              </div>
            </section>

            <section className="settings-section">
              <div className="settings-section__intro">
                <span className="section-number">02</span>
                <div><h2>Dictado</h2><p>Elige cómo activar, transcribir y entregar el texto.</p></div>
              </div>
              <div className="form-card form-grid">
                <label className="field">
                  <span>Atajo de dictado</span>
                  <div className={`shortcut-capture ${capturingShortcut === 'dictation' ? 'is-capturing' : ''}`}>
                    <input value={capturingShortcut === 'dictation' ? 'Pulsa la combinación…' : draft.shortcut} readOnly />
                    <button
                      type="button"
                      onClick={() => capturingShortcut === 'dictation' ? finishShortcutCapture() : void beginShortcutCapture('dictation')}
                    >
                      {capturingShortcut === 'dictation' ? 'Cancelar' : 'Cambiar'}
                    </button>
                  </div>
                  <small>{capturingShortcut === 'dictation' ? 'Pulsa Esc para cancelar.' : 'Dicta texto nuevo en cualquier aplicación.'}</small>
                </label>
                <label className="field">
                  <span>Atajo para editar una selección</span>
                  <div className={`shortcut-capture ${capturingShortcut === 'edit' ? 'is-capturing' : ''}`}>
                    <input value={capturingShortcut === 'edit' ? 'Pulsa la combinación…' : draft.editShortcut} readOnly />
                    <button
                      type="button"
                      onClick={() => capturingShortcut === 'edit' ? finishShortcutCapture() : void beginShortcutCapture('edit')}
                    >
                      {capturingShortcut === 'edit' ? 'Cancelar' : 'Cambiar'}
                    </button>
                  </div>
                  <small>{capturingShortcut === 'edit' ? 'Pulsa Esc para cancelar.' : 'Selecciona texto y di cómo quieres cambiarlo.'}</small>
                </label>
                <label className="field">
                  <span>Activación del atajo</span>
                  <select value={draft.shortcutMode} onChange={(event) => setDraft({ ...draft, shortcutMode: event.target.value as PublicSettings['shortcutMode'] })}>
                    <option value="hold">Mantener pulsado para hablar</option>
                    <option value="toggle">Pulsar para iniciar y terminar</option>
                  </select>
                  <small>En el modo mantener pulsado, el dictado termina al soltar las teclas.</small>
                </label>
                <label className="field">
                  <span>Idioma</span>
                  <select value={draft.language} onChange={(event) => setDraft({ ...draft, language: event.target.value as PublicSettings['language'] })}>
                    <option value="auto">Detectar automáticamente</option>
                    <option value="es">Español</option><option value="en">Inglés</option><option value="ca">Catalán</option>
                    <option value="fr">Francés</option><option value="de">Alemán</option><option value="it">Italiano</option><option value="pt">Portugués</option>
                  </select>
                </label>
                <label className="field">
                  <span>Modo predeterminado</span>
                  <select value={draft.mode} onChange={(event) => setDraft({ ...draft, mode: event.target.value as DictationMode })}>
                    {(Object.keys(modeNames) as DictationMode[]).map((mode) => <option key={mode} value={mode}>{modeNames[mode]}</option>)}
                  </select>
                </label>
                <div className="toggle-stack">
                  <label className="toggle-row"><span><strong>Transcripción en tiempo real</strong><small>Muestra el texto mientras estás hablando</small></span><input type="checkbox" checked={draft.realtimeEnabled} onChange={(event) => setDraft({ ...draft, realtimeEnabled: event.target.checked })} /></label>
                  <label className="toggle-row"><span><strong>Pegar automáticamente</strong><small>Inserta el texto en la ventana activa</small></span><input type="checkbox" checked={draft.autoPaste} onChange={(event) => setDraft({ ...draft, autoPaste: event.target.checked })} /></label>
                  <label className="toggle-row"><span><strong>Iniciar con Windows</strong><small>Deja Fluye preparado en la bandeja</small></span><input type="checkbox" checked={draft.launchAtLogin} onChange={(event) => setDraft({ ...draft, launchAtLogin: event.target.checked })} /></label>
                </div>
              </div>
            </section>

            <section className="settings-section">
              <div className="settings-section__intro">
                <span className="section-number">03</span>
                <div><h2>Tu vocabulario</h2><p>Añade nombres, marcas o correcciones que Fluye debe recordar.</p></div>
              </div>
              <div className="form-card">
                <label className="field">
                  <span>Una palabra o corrección por línea</span>
                  <textarea
                    rows={6}
                    value={dictionaryText}
                    onChange={(event) => setDictionaryText(event.target.value)}
                    placeholder={'Fluye\nAcme Studio\nuisper flow → Wispr Flow'}
                  />
                  <small>Para enseñar una corrección usa: forma detectada → forma correcta</small>
                </label>
                <details className="advanced">
                  <summary>Configuración avanzada de modelos</summary>
                  <div className="form-grid advanced-grid">
                    <label className="field"><span>Transcripción</span><input value={draft.transcriptionModel} onChange={(event) => setDraft({ ...draft, transcriptionModel: event.target.value })} /></label>
                    <label className="field"><span>Pulido</span><input value={draft.polishModel} onChange={(event) => setDraft({ ...draft, polishModel: event.target.value })} /></label>
                    <label className="field">
                      <span>Latencia en vivo</span>
                      <select value={draft.realtimeDelay} onChange={(event) => setDraft({ ...draft, realtimeDelay: event.target.value as PublicSettings['realtimeDelay'] })}>
                        <option value="minimal">Mínima</option>
                        <option value="low">Baja</option>
                        <option value="medium">Equilibrada</option>
                        <option value="high">Alta precisión</option>
                        <option value="xhigh">Máxima precisión</option>
                      </select>
                    </label>
                  </div>
                </details>
              </div>
            </section>

            <section className="settings-section">
              <div className="settings-section__intro">
                <span className="section-number">04</span>
                <div><h2>Actualizaciones</h2><p>Fluye consulta las versiones publicadas en GitHub Releases.</p></div>
              </div>
              <div className="form-card update-card">
                <div className="update-card__header">
                  <div>
                    <strong>Fluye {updateStatus.currentVersion || '—'}</strong>
                    <small>Canal estable · GitHub público</small>
                  </div>
                  <span className={`update-state update-state--${updateStatus.phase}`}>
                    {updateStatus.phase === 'ready'
                      ? 'Lista'
                      : updateStatus.phase === 'available'
                        ? 'Disponible'
                        : updateStatus.phase === 'downloading'
                          ? 'Descargando'
                          : updateStatus.phase === 'up-to-date'
                            ? 'Al día'
                            : updateStatus.phase === 'error'
                              ? 'Revisar'
                              : updateStatus.phase === 'checking'
                                ? 'Buscando'
                                : 'Beta'}
                  </span>
                </div>
                <p className={updateStatus.phase === 'error' ? 'update-card__message is-error' : 'update-card__message'}>
                  {updateStatus.message || 'Puedes buscar una versión nueva cuando quieras.'}
                </p>
                {updateStatus.phase === 'downloading' && (
                  <div className="update-progress" aria-label={`Descarga ${Math.round(updateStatus.percent ?? 0)} %`}>
                    <span style={{ width: `${updateStatus.percent ?? 0}%` }} />
                  </div>
                )}
                <div className="update-card__actions">
                  {updateStatus.phase === 'available' ? (
                    <button type="button" className="primary-button" onClick={() => void downloadUpdate()} disabled={updateBusy}>
                      Descargar {updateStatus.availableVersion ? `v${updateStatus.availableVersion}` : 'actualización'}
                    </button>
                  ) : updateStatus.phase === 'ready' ? (
                    <button type="button" className="primary-button" onClick={() => void installUpdate()} disabled={updateBusy}>
                      Reiniciar e instalar
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => void checkUpdates()}
                      disabled={updateBusy || updateStatus.phase === 'checking' || updateStatus.phase === 'downloading' || updateStatus.phase === 'unavailable'}
                    >
                      {updateStatus.phase === 'checking' ? 'Buscando…' : updateStatus.phase === 'downloading' ? `Descargando ${Math.round(updateStatus.percent ?? 0)} %` : 'Buscar actualizaciones'}
                    </button>
                  )}
                </div>
                <small className="update-card__note">Las versiones beta todavía no están firmadas digitalmente.</small>
              </div>
            </section>

            {message && <p className="form-error">{message}</p>}
            <div className="settings-actions">
              <button className="primary-button" type="submit" disabled={saveState === 'saving'}>
                {saveState === 'saving' ? 'Guardando…' : saveState === 'saved' ? 'Guardado ✓' : 'Guardar ajustes'}
              </button>
            </div>
          </form>
        )}
      </main>
    </div>
  )
}
