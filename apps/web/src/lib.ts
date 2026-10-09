import type { AuditEntry } from './types'

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

/** Short label for what an audit entry is about (title/name/attendee/code, else the entity id). */
export function auditSummary(e: AuditEntry) {
  const after = e.after as Record<string, unknown> | null | undefined
  const label = after && (after.title ?? after.name ?? after.attendeeName ?? after.code)
  return typeof label === 'string' ? label : e.entityId
}

/** "just now", "5 min ago", "3 h ago", "2 d ago", then a short date. */
export function timeAgo(iso: string, now: number = Date.now()) {
  const secs = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (secs < 45) return 'just now'
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days} d ago`
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' })
}
