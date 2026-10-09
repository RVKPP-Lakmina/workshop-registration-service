import { describe, expect, it } from 'vitest'
import { config, resolveConfig } from './config'

describe('config', () => {
  it('defaults to same-origin /api and the default app name', () => {
    expect(resolveConfig({})).toEqual({ apiBaseUrl: '/api', appName: 'Workshop Registration' })
    expect(resolveConfig({ VITE_API_BASE_URL: '   ', VITE_APP_NAME: '' })).toEqual({
      apiBaseUrl: '/api',
      appName: 'Workshop Registration',
    })
  })

  it('trims trailing slashes from absolute URLs', () => {
    expect(resolveConfig({ VITE_API_BASE_URL: 'https://abc.execute-api.example.com/api///' }).apiBaseUrl).toBe(
      'https://abc.execute-api.example.com/api',
    )
  })

  it('reads the app name', () => {
    expect(resolveConfig({ VITE_APP_NAME: 'Acme' }).appName).toBe('Acme')
  })

  it('exports the resolved build-time config (pinned to /api under test)', () => {
    expect(config.apiBaseUrl).toBe('/api')
  })
})
