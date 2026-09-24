import type { FluyeApi } from '../../preload'

declare global {
  interface Window {
    fluye: FluyeApi
  }
}

export {}
