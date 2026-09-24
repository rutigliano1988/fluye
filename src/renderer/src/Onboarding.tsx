import { useCallback, useEffect, useRef, useState } from 'react'
import type { PublicSettings, SaveSettingsInput } from '../../shared/types'

interface OnboardingProps {
  settings: PublicSettings
  onSave: (changes: Partial<SaveSettingsInput>) => Promise<PublicSettings>
  onFinished: () => void
}

function cleanError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text
    .replace(/^Error invoking remote method '[^']+': Error: /, '')
    .replace(/^Error: /, '')
}

function BrandMark(): React.JSX.Element {
  return <span className="onboarding__mark" aria-hidden="true"><i /><i /><i /><i /><i /></span>
}

function formatShortcut(shortcut: string): string {
  return shortcut.replace('CommandOrControl', 'Ctrl').replaceAll('+', ' + ')
}

export default function Onboarding({ settings, onSave, onFinished }: OnboardingProps): React.JSX.Element {
  const [step, setStep] = useState(0)
  const [apiKey, setApiKey] = useState('')
  const [transcriptionProvider, setTranscriptionProvider] = useState(settings.transcriptionProvider)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [micReady, setMicReady] = useState(false)
  const [micAttempted, setMicAttempted] = useState(false)
  const [micLevel, setMicLevel] = useState(0)
  const streamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const meterFrameRef = useRef<number | null>(null)

  const stopMicTest = useCallback(() => {
    if (meterFrameRef.current !== null) cancelAnimationFrame(meterFrameRef.current)
    meterFrameRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (audioContextRef.current) void audioContextRef.current.close()
    audioContextRef.current = null
    setMicLevel(0)
  }, [])

  useEffect(() => stopMicTest, [stopMicTest])

  const startMicTest = async (): Promise<void> => {
    setError('')
    setMicAttempted(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1
        }
      })
      streamRef.current = stream
      const context = new AudioContext()
      const analyser = context.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.7
      context.createMediaStreamSource(stream).connect(analyser)
      audioContextRef.current = context
      await context.resume()
      setMicReady(true)

      const samples = new Uint8Array(analyser.fftSize)
      const updateLevel = (): void => {
        analyser.getByteTimeDomainData(samples)
        let sum = 0
        for (const sample of samples) {
          const normalized = (sample - 128) / 128
          sum += normalized * normalized
        }
        setMicLevel(Math.min(1, Math.sqrt(sum / samples.length) * 5.5))
        meterFrameRef.current = requestAnimationFrame(updateLevel)
      }
      updateLevel()
    } catch (micError) {
      setMicReady(false)
      setError(
        micError instanceof DOMException && micError.name === 'NotAllowedError'
          ? 'Windows bloqueó el micrófono. Puedes habilitarlo después en Configuración → Privacidad y seguridad → Micrófono.'
          : cleanError(micError)
      )
    }
  }

  const saveConnection = async (): Promise<void> => {
    if (transcriptionProvider === 'openai' && !settings.hasApiKey && !apiKey.trim()) {
      setError('Introduce una clave de API para continuar.')
      return
    }

    setBusy(true)
    setError('')
    try {
      await onSave({
        transcriptionProvider,
        mode: transcriptionProvider === 'local' ? 'literal' : settings.mode,
        realtimeEnabled: transcriptionProvider === 'openai' && settings.realtimeEnabled,
        apiKey: apiKey.trim() || undefined
      })
      setApiKey('')
      setStep(2)
    } catch (saveError) {
      setError(cleanError(saveError))
    } finally {
      setBusy(false)
    }
  }

  const finish = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await onSave({ onboardingCompleted: true })
      onFinished()
    } catch (saveError) {
      setError(cleanError(saveError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="onboarding">
      <section className="onboarding__card">
        <header className="onboarding__header">
          <div className="onboarding__brand"><BrandMark /><strong>Fluye</strong></div>
          <div className="onboarding__progress" aria-label={`Paso ${step + 1} de 4`}>
            {[0, 1, 2, 3].map((item) => <i key={item} className={item <= step ? 'active' : ''} />)}
          </div>
        </header>

        <div className="onboarding__body">
          {step === 0 && (
            <div className="onboarding__step onboarding__welcome">
              <span className="onboarding__eyebrow">BIENVENIDO A FLUYE</span>
              <h1>Tu voz, convertida en texto donde la necesites.</h1>
              <p>En menos de dos minutos elegiremos el motor, comprobaremos el micrófono y te enseñaremos los atajos.</p>
              <div className="onboarding__features">
                <article><span>01</span><strong>Dicta en cualquier aplicación</strong><small>Teams, Outlook, navegador y editores.</small></article>
                <article><span>02</span><strong>Edita texto con la voz</strong><small>Selecciona un fragmento y di cómo cambiarlo.</small></article>
                <article><span>03</span><strong>Tu información permanece bajo control</strong><small>Clave cifrada e historial local.</small></article>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="onboarding__step">
              <span className="onboarding__eyebrow">PASO 1 · CONEXIÓN</span>
              <h1>¿Dónde quieres transcribir?</h1>
              <p>Puedes empezar sin cuenta usando Whisper en este PC, o conectar OpenAI para ver el texto mientras hablas.</p>
              <label className="onboarding__field">
                <span>Motor de transcripción</span>
                <select
                  value={transcriptionProvider}
                  onChange={(event) => setTranscriptionProvider(event.target.value as PublicSettings['transcriptionProvider'])}
                >
                  <option value="local">Local · privado y sin clave API</option>
                  <option value="openai">OpenAI · nube y transcripción en vivo</option>
                </select>
              </label>
              {transcriptionProvider === 'openai' && (
              <label className="onboarding__field">
                <span>Clave de API</span>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={settings.hasApiKey ? '••••••••••••  Ya tienes una clave guardada' : 'sk-…'}
                  autoFocus
                  autoComplete="off"
                  onKeyDown={(event) => { if (event.key === 'Enter') void saveConnection() }}
                />
              </label>
              )}
              <div className="onboarding__notice"><span>⌁</span><p>
                {transcriptionProvider === 'local'
                  ? 'El audio permanece en tu equipo. La primera transcripción puede tardar un poco más mientras se carga el modelo.'
                  : <>La clave se cifra con la protección de Windows. Las transformaciones de texto usan <code>store: false</code>.</>}
              </p></div>
            </div>
          )}

          {step === 2 && (
            <div className="onboarding__step">
              <span className="onboarding__eyebrow">PASO 2 · MICRÓFONO</span>
              <h1>Vamos a comprobar que te escuchamos</h1>
              <p>Windows puede pedirte permiso. Habla unos segundos y comprueba que el indicador reacciona.</p>
              <div className={`mic-test ${micReady ? 'is-ready' : ''}`}>
                <div className="mic-test__orb">
                  <span style={{ transform: `scale(${1 + micLevel * 0.55})`, opacity: 0.25 + micLevel * 0.75 }} />
                  <b>{micReady ? '✓' : '◉'}</b>
                </div>
                <div>
                  <strong>{micReady ? 'Micrófono preparado' : 'Aún no hemos probado el micrófono'}</strong>
                  <small>{micReady ? 'El nivel responde correctamente.' : 'Pulsa el botón y habla con normalidad.'}</small>
                </div>
                <button type="button" onClick={() => streamRef.current ? stopMicTest() : void startMicTest()}>
                  {streamRef.current ? 'Detener prueba' : micAttempted ? 'Probar de nuevo' : 'Probar micrófono'}
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="onboarding__step">
              <span className="onboarding__eyebrow">PASO 3 · TODO LISTO</span>
              <h1>Dos atajos y ninguna interrupción</h1>
              <p>Mantén el atajo mientras hablas y suéltalo al terminar. Puedes cambiarlos en Ajustes cuando quieras.</p>
              <div className="onboarding__shortcuts">
                <article><span>DICTAR TEXTO NUEVO</span><kbd>{formatShortcut(settings.shortcut)}</kbd><p>Coloca el cursor y habla.</p></article>
                <article><span>EDITAR UNA SELECCIÓN</span><kbd>{formatShortcut(settings.editShortcut)}</kbd><p>{settings.hasApiKey ? 'Selecciona texto y di “hazlo más formal”, “resúmelo”…' : 'Función opcional: requiere una clave de OpenAI.'}</p></article>
              </div>
              <div className="onboarding__ready"><span>✓</span><p><strong>Fluye está preparado.</strong> Seguirá disponible desde la bandeja del sistema aunque ocultes la ventana.</p></div>
            </div>
          )}

          {error && <p className="onboarding__error">{error}</p>}
        </div>

        <footer className="onboarding__footer">
          <button className="onboarding__back" type="button" disabled={step === 0 || busy} onClick={() => { setError(''); setStep((value) => value - 1) }}>Atrás</button>
          {step === 0 && <button className="primary-button" type="button" onClick={() => setStep(1)}>Comenzar</button>}
          {step === 1 && <button className="primary-button" type="button" disabled={busy} onClick={() => void saveConnection()}>{busy ? 'Guardando…' : transcriptionProvider === 'local' ? 'Usar transcripción local' : settings.hasApiKey && !apiKey ? 'Continuar' : 'Guardar y continuar'}</button>}
          {step === 2 && <button className="primary-button" type="button" disabled={!micAttempted} onClick={() => { stopMicTest(); setStep(3) }}>{micReady ? 'Continuar' : micAttempted ? 'Continuar de todos modos' : 'Prueba el micrófono para continuar'}</button>}
          {step === 3 && <button className="primary-button" type="button" disabled={busy} onClick={() => void finish()}>{busy ? 'Preparando Fluye…' : 'Empezar a usar Fluye'}</button>}
        </footer>
      </section>
    </main>
  )
}
