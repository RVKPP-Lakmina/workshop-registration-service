import { render, screen } from '@testing-library/react'
import { fmtDate, range, toLocalInput } from './lib'
import { SeatsBadge } from './pages/Workshops'
import { makeWorkshop } from './test/fixtures'

describe('range (date presets)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2030, 4, 15, 14, 30)) // Wed 15 May 2030, local time
  })
  afterEach(() => vi.useRealTimers())

  it('all has no bounds', () => {
    expect(range('all', '', '')).toEqual({})
  })

  it('today spans local midnight to 23:59:59.999', () => {
    const r = range('today', '', '')
    expect(new Date(r.from!)).toEqual(new Date(2030, 4, 15, 0, 0))
    expect(new Date(r.to!).getTime()).toBe(new Date(2030, 4, 16, 0, 0).getTime() - 1)
  })

  it('week starts on Monday', () => {
    const r = range('week', '', '')
    expect(new Date(r.from!)).toEqual(new Date(2030, 4, 13, 0, 0))
    expect(new Date(r.from!).getDay()).toBe(1)
    expect(new Date(r.to!).getTime()).toBe(new Date(2030, 4, 20, 0, 0).getTime() - 1)
  })

  it('a Sunday still belongs to the week that started the Monday before', () => {
    vi.setSystemTime(new Date(2030, 4, 19, 9, 0))
    expect(new Date(range('week', '', '').from!)).toEqual(new Date(2030, 4, 13, 0, 0))
  })

  it('next7 runs from now for exactly 7 days', () => {
    const r = range('next7', '', '')
    expect(new Date(r.from!).getTime()).toBe(Date.now())
    expect(new Date(r.to!).getTime() - Date.now()).toBe(7 * 24 * 3600 * 1000)
  })

  it('custom covers whole days and tolerates missing ends', () => {
    const r = range('custom', '2030-06-01', '2030-06-03')
    expect(new Date(r.from!)).toEqual(new Date(2030, 5, 1, 0, 0, 0, 0))
    expect(new Date(r.to!)).toEqual(new Date(2030, 5, 3, 23, 59, 59, 999))
    expect(range('custom', '', '')).toEqual({ from: undefined, to: undefined })
    expect(range('custom', '2030-06-01', '').to).toBeUndefined()
  })
})

describe('date formatting', () => {
  it('fmtDate handles empty and valid input', () => {
    expect(fmtDate(undefined)).toBe('')
    expect(fmtDate(null)).toBe('')
    expect(fmtDate(new Date(2030, 4, 1, 10, 0).toISOString())).toMatch(/2030/)
  })

  it('toLocalInput produces a datetime-local value in local time', () => {
    expect(toLocalInput(new Date(2030, 0, 5, 9, 7).toISOString())).toBe('2030-01-05T09:07')
    expect(toLocalInput(undefined)).toBe('')
  })
})

describe('SeatsBadge (seats-left formatting)', () => {
  it.each([
    [{ seatsLeft: 6 }, '6 seats left'],
    [{ seatsLeft: 3 }, '3 seats left'],
    [{ seatsLeft: 0, activeCount: 10 }, 'Full'],
    [{ seatsLeft: -1 }, 'Full'],
    [{ status: 'CANCELLED' as const }, 'Cancelled'],
    [{ status: 'COMPLETED' as const }, 'Finished'],
  ])('%j shows %s', (over, text) => {
    render(<SeatsBadge w={makeWorkshop(over)} />)
    expect(screen.getByText(text)).toBeInTheDocument()
  })

  it('is amber at 3 or fewer seats and green above', () => {
    const { rerender } = render(<SeatsBadge w={makeWorkshop({ seatsLeft: 3 })} />)
    expect(screen.getByText('3 seats left')).toHaveClass('bg-amber-100')
    rerender(<SeatsBadge w={makeWorkshop({ seatsLeft: 4 })} />)
    expect(screen.getByText('4 seats left')).toHaveClass('bg-emerald-100')
  })
})
