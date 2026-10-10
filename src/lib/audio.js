/* Hörbuch-Laufzeiten. Echte Werte kommen aus dem Katalog von Audible und
   werden pro Buch gespeichert (audioMinutes). Fehlt ein Wert, wird aus der
   Seitenzahl geschätzt und mit „ca.“ gekennzeichnet. Angezeigt wird das erst,
   wenn ein Buch auf „Hörbuch“ steht. */
import { db, updateBook } from './db'

// Grobe Faustregel für gelesene Hörbücher: etwa 33 Seiten pro Stunde.
const MIN_PER_PAGE = 1.8

export function audioTotal(book) {
  if (book?.audioMinutes > 0) return { min: book.audioMinutes, est: false }
  if (book?.pages > 0) return { min: Math.round(book.pages * MIN_PER_PAGE), est: true }
  return null
}

/** 144 → „2:24“ */
export function fmtHM(min) {
  const t = Math.max(0, Math.round(min))
  const h = Math.floor(t / 60)
  const m = t % 60
  return `${h}:${String(m).padStart(2, '0')}`
}

/** „2:24“, „2.24“ → 144; „90“ → 90 Minuten; sonst NaN */
export function parseHM(str) {
  const s = String(str).trim()
  let m = s.match(/^(\d+)[:.](\d{1,2})$/)
  if (m) return Number(m[1]) * 60 + Number(m[2])
  m = s.match(/^\d+$/)
  return m ? Number(s) : NaN
}

const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

const LANG_NAME = { de: 'german', en: 'english', fr: 'french', es: 'spanish', it: 'italian' }

/** Laufzeit eines Buchs bei Audible suchen.
    → { minutes } | { notFound: true } | { blocked: true } (Abruf nicht möglich) */
export async function fetchRuntime(book, language) {
  const lang = language || book.readLanguage || book.language || 'de'
  const hosts = lang === 'de' ? ['api.audible.de', 'api.audible.com'] : ['api.audible.com', 'api.audible.de']
  const title = norm((book.title || '').split(':')[0])
  const first = book.authors?.[0] || ''
  const surname = norm(first).split(' ').pop()
  if (!title) return { notFound: true }
  let reached = false

  for (const host of hosts) {
    const url = `https://${host}/1.0/catalog/products?title=${encodeURIComponent(book.title || '')}` +
      `&author=${encodeURIComponent(first)}&num_results=10&response_groups=product_attrs,media`
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 10000)
    try {
      const res = await fetch(url, { signal: ctrl.signal })
      reached = true
      if (!res.ok) continue
      const data = await res.json()
      const hit = (data.products || []).find((p) => {
        if (!(p.runtime_length_min > 20)) return false
        const t = norm((p.title || '').split(':')[0])
        if (t !== title && !t.startsWith(title) && !title.startsWith(t)) return false
        const l = (p.language || '').toLowerCase()
        if (LANG_NAME[lang] && l && l !== LANG_NAME[lang]) return false
        if (surname && !(p.authors || []).some((a) => norm(a.name).includes(surname))) return false
        return true
      })
      if (hit) return { minutes: hit.runtime_length_min }
    } catch {
      /* nicht erreichbar oder vom Browser blockiert */
    } finally {
      clearTimeout(timer)
    }
  }
  return reached ? { notFound: true } : { blocked: true }
}

/** Im Hintergrund für alle Bücher ohne Laufzeit nachladen. */
export async function loadRuntimes({ onProgress, shouldStop } = {}) {
  const todo = (await db.books.toArray()).filter((b) => !(b.audioMinutes > 0) && !b.audioTried)
  let filled = 0
  let missing = 0
  let blockedInRow = 0
  let blockedAll = 0
  for (let i = 0; i < todo.length; i++) {
    if (shouldStop?.()) break
    onProgress?.({ done: i, total: todo.length, filled })
    const r = await fetchRuntime(todo[i])
    if (r.blocked) {
      blockedAll++
      if (++blockedInRow >= 3) return { filled, missing, total: todo.length, blocked: true }
    } else {
      blockedInRow = 0
      if (r.minutes) { await updateBook(todo[i].id, { audioMinutes: r.minutes }); filled++ }
      else { await updateBook(todo[i].id, { audioTried: true }); missing++ }
    }
    await new Promise((res) => setTimeout(res, 300))
  }
  return { filled, missing, total: todo.length, blocked: blockedAll > 0 && filled === 0 && missing === 0 }
}
