/* Zwischenspeicher für ISBN-Abfragen. Dasselbe Buch ein zweites Mal zu scannen
   (oder ein abgebrochener und neu gestarteter Scan) soll nicht erneut durchs
   Netz gehen. Nur die Textdaten werden gespeichert, keine Bilder — die liegen
   ohnehin schon im Cover-Cache des Service Workers. */

const PREFIX = 'libri:isbn:'
const MAX_ENTRIES = 300
const MAX_AGE = 1000 * 60 * 60 * 24 * 90 // 90 Tage

export function readCache(isbn) {
  try {
    const raw = localStorage.getItem(PREFIX + isbn)
    if (!raw) return null
    const entry = JSON.parse(raw)
    if (Date.now() - entry.at > MAX_AGE) {
      localStorage.removeItem(PREFIX + isbn)
      return null
    }
    return entry.data
  } catch {
    return null
  }
}

export function writeCache(isbn, data) {
  try {
    localStorage.setItem(PREFIX + isbn, JSON.stringify({ at: Date.now(), data }))
    prune()
  } catch {
    // Speicher voll: ältere Einträge wegräumen und einmal neu versuchen.
    try {
      prune(true)
      localStorage.setItem(PREFIX + isbn, JSON.stringify({ at: Date.now(), data }))
    } catch {
      /* dann eben ohne Zwischenspeicher */
    }
  }
}

function prune(aggressive = false) {
  const keys = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k?.startsWith(PREFIX)) keys.push(k)
  }
  const limit = aggressive ? Math.floor(MAX_ENTRIES / 2) : MAX_ENTRIES
  if (keys.length <= limit) return

  const withAge = keys.map((k) => {
    let at = 0
    try {
      at = JSON.parse(localStorage.getItem(k)).at || 0
    } catch {}
    return { k, at }
  })
  withAge.sort((a, b) => a.at - b.at)
  for (const { k } of withAge.slice(0, keys.length - limit)) {
    localStorage.removeItem(k)
  }
}
