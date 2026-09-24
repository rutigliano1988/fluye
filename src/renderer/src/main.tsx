import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import Overlay from './Overlay'
import './styles.css'

const isOverlay = new URLSearchParams(window.location.search).has('overlay')
const bridgeAvailable = typeof window.fluye !== 'undefined'

function BridgeError(): React.JSX.Element {
  return (
    <main className="startup-error">
      <article>
        <span className="startup-error__mark">!</span>
        <h1>No se pudo iniciar Fluye</h1>
        <p>El puente seguro de Electron no está disponible. Cierra esta ventana y vuelve a ejecutar:</p>
        <code>npm run dev</code>
        <p className="startup-error__detail">Si el problema continúa, ejecuta antes <strong>npm run build</strong>.</p>
      </article>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {!bridgeAvailable ? <BridgeError /> : isOverlay ? <Overlay /> : <App />}
  </StrictMode>
)
