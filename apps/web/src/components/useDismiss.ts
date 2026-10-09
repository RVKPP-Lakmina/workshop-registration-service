import { useEffect, type RefObject } from 'react'

/** Calls onClose when the user clicks/taps outside `ref` or presses Escape while `open`. */
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return
    const outside = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', outside)
    document.addEventListener('touchstart', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', outside)
      document.removeEventListener('touchstart', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [ref, open, onClose])
}
