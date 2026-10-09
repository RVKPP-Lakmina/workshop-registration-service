import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'

const base = 'rounded-lg px-4 py-2.5 text-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
const variants = {
  primary: 'bg-indigo-700 text-white hover:bg-indigo-800',
  secondary: 'bg-white text-slate-800 border border-slate-300 hover:bg-slate-100',
  danger: 'bg-red-700 text-white hover:bg-red-800',
}

export function Button({
  variant = 'primary',
  className = '',
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants }) {
  return <button {...p} className={`${base} ${variants[variant]} ${className}`} />
}

const field = 'w-full rounded-lg border border-slate-400 bg-white px-3 py-2.5 text-lg focus:outline-none focus:ring-2 focus:ring-indigo-500'

export function Input(p: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={`${field} ${p.className ?? ''}`} />
}
export function Select(p: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={`${field} ${p.className ?? ''}`} />
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-base font-semibold text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-sm text-slate-500">{hint}</span>}
    </label>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>{children}</div>
}

const tones: Record<string, string> = {
  green: 'bg-emerald-100 text-emerald-900',
  amber: 'bg-amber-100 text-amber-900',
  red: 'bg-red-100 text-red-900',
  gray: 'bg-slate-200 text-slate-800',
  blue: 'bg-sky-100 text-sky-900',
}
export function Badge({ tone = 'gray', children }: { tone?: keyof typeof tones; children: ReactNode }) {
  return <span className={`inline-block rounded-full px-3 py-1 text-base font-semibold ${tones[tone]}`}>{children}</span>
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null
  return (
    <p className="rounded-lg bg-red-100 px-4 py-3 text-lg text-red-900" role="alert">
      {error instanceof Error ? error.message : 'Something went wrong.'}
    </p>
  )
}
