import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { server } from './server'
import { tokenStore, setUnauthorizedHandler } from '../api/client'

configure({ asyncUtilTimeout: 5000 })
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => {
  cleanup()
  server.resetHandlers()
  localStorage.clear()
  tokenStore.clear()
  setUnauthorizedHandler(() => {})
})
afterAll(() => server.close())
