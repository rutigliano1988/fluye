import { useEffect, useRef, useState } from 'react'
import type { StatusPayload } from '../../shared/types'

const labels = {
  idle: 'Listo',
  recording: 'Fluye está escuchando',
  processing: 'Preparando el texto final',
  success: 'Texto insertado en el destino',
  error: 'Fluye necesita atención'
}

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0')
  const remainder = (seconds % 60).toString().padStart(2, '0')
  return `${minutes}:${remainder}`
}

function FluyeMark(): React.JSX.Element {
  return (
    <span className="overlay__brand" aria-hidden="true">
      <i /><i /><i /><i /><i />
    </span>
  )
}

export default function Overlay(): React.JSX.Element {
  const [payload, setPayload] = useState<StatusPayload>({ status: 'idle' })
  const [elapsed, setElapsed] = useState(0)
  const startedAtRef = useRef(0)

  useEffect(() => window.fluye.onStatusUpdate(setPayload), [])
  useEffect(() => {
    if (payload.status !== 'recording') {
      startedAtRef.current = 0
      setElapsed(0)
      return
    }

    if (!startedAtRef.current) startedAtRef.current = Date.now()
    const updateElapsed = (): void => {
      setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000))
    }
    updateElapsed()
    const timer = window.setInterval(updateElapsed, 500)
    return () => window.clearInterval(timer)
  }, [payload.status])

  const detail = payload.message || (
    payload.status === 'recording'
      ? 'Habla con normalidad. El texto aparecerá aquí.'
      : payload.status === 'processing'
        ? 'Aplicando puntuación y el modo seleccionado…'
        : ''
  )

  return (
    <main className={`overlay overlay--${payload.status}`} aria-live="polite">
      <div className="overlay__mark">
        {payload.status === 'processing' ? (
          <span className="overlay__spinner" />
        ) : payload.status === 'success' ? (
          <span className="overlay__check">✓</span>
        ) : payload.status === 'error' ? (
          <span className="overlay__error">!</span>
        ) : (
          <FluyeMark />
        )}
      </div>
      <div className="overlay__copy">
        <div className="overlay__title">
          <strong>{labels[payload.status]}</strong>
          {payload.status === 'recording' && <time>{formatElapsed(elapsed)}</time>}
        </div>
        {detail && <span className="overlay__transcript">{detail}</span>}
      </div>
      {payload.status === 'recording' && (
        <div className="wave" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((bar) => (
            <i key={bar} style={{ animationDelay: `${bar * 90}ms` }} />
          ))}
        </div>
      )}
    </main>
  )
}
