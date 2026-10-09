import { http, HttpResponse } from 'msw'
import { admin, makeAudit, makeReg, makeWorkshop } from './fixtures'

/**
 * Default happy-path handlers. Individual tests override with server.use(...).
 * Paths are relative: jsdom's origin (http://localhost:3000) is used by msw.
 */
export const handlers = [
  http.get('/api/auth/me', () => HttpResponse.json(admin)),
  http.get('/api/workshops', () => HttpResponse.json([makeWorkshop()])),
  http.get('/api/workshops/:id', ({ params }) => HttpResponse.json(makeWorkshop({ id: String(params.id) }))),
  http.get('/api/workshops/:id/registrations', () => HttpResponse.json([makeReg()])),
  http.get('/api/users', () => HttpResponse.json([admin])),
  http.get('/api/audit', () => HttpResponse.json({ items: [makeAudit()], total: 1, page: 1, pageSize: 25 })),
]
