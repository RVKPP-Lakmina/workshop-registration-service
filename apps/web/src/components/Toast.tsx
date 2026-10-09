import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

interface T {
  id: number
  kind: 'ok' | 'err'
  text: string
}
const Ctx = createContext<(kind: 'ok' | 'err', text: string) => void>(() => {})

let n = 0
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<T[]>([])
  const push = useCallback((kind: 'ok' | 'err', text: string) => {
    const id = ++n
    setToasts((t) => [...t, { id, kind, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000)
  }, [])
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2" role="status">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`rounded-lg px-4 py-3 text-lg font-medium text-white shadow-lg ${t.kind === 'ok' ? 'bg-emerald-700' : 'bg-red-700'}`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useToast = () => useContext(Ctx)
