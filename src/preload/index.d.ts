import type { MarginaliaApi } from '../shared/types'

declare global {
  interface Window {
    api: MarginaliaApi
  }
}
