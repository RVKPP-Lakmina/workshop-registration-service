export function fmtDate(iso?: string | null) {
  if (!iso) return ''
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function toLocalInput(iso?: string) {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export type Preset = 'all' | 'today' | 'week' | 'next7' | 'custom'

export function range(preset: Preset, cFrom: string, cTo: string): { from?: string; to?: string } {
  const now = new Date()
  const sod = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const day = 24 * 60 * 60 * 1000
  switch (preset) {
    case 'today':
      return { from: sod.toISOString(), to: new Date(sod.getTime() + day - 1).toISOString() }
    case 'week': {
      const dow = (sod.getDay() + 6) % 7 // Monday = 0
      const mon = new Date(sod.getTime() - dow * day)
      return { from: mon.toISOString(), to: new Date(mon.getTime() + 7 * day - 1).toISOString() }
    }
    case 'next7':
      return { from: now.toISOString(), to: new Date(now.getTime() + 7 * day).toISOString() }
    case 'custom':
      return {
        from: cFrom ? new Date(`${cFrom}T00:00:00`).toISOString() : undefined,
        to: cTo ? new Date(`${cTo}T23:59:59.999`).toISOString() : undefined,
      }
    default:
      return {}
  }
}
