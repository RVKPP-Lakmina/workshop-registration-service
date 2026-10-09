const sources = import.meta.glob(['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}', '!../test/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

describe('no browser storage', () => {
  it('scans some source files', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(10)
  })

  it('no web source file touches localStorage, sessionStorage, indexedDB or document.cookie', () => {
    const offenders = Object.entries(sources)
      .filter(([, text]) => /localStorage|sessionStorage|indexedDB|document\.cookie/.test(text))
      .map(([file]) => file)
    expect(offenders).toEqual([])
  })
})
