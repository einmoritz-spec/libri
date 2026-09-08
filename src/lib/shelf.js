import { db } from './db'

/** Einfacher, stabiler Hash — dieselbe Eingabe ergibt immer denselben Wert. */
function hashSeed(str) {
  let h = 0
  const s = String(str || '')
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h)
}

/** Fallback-Farbe, wenn weder Cover noch daraus berechnete Farbe vorliegt —
    aus dem Titel abgeleitet, damit dasselbe Buch immer dieselbe Farbe hat. */
export function colorFromText(str) {
  const hue = hashSeed(str) % 360
  return `hsl(${hue} 38% 33%)`
}

const MIN_W = 17
const MAX_W = 46
const MIN_H = 148
const MAX_H = 192

/** Dicke aus der Seitenzahl — ohne Angabe ein plausibler Mittelwert. */
export function spineWidth(book) {
  const pages = book.pages || 260
  return Math.round(Math.min(MAX_W, Math.max(MIN_W, 16 + pages / 16)))
}

/** Höhe gibt es in keiner Buchdatenbank — leicht aus dem Titel gestreut,
    damit das Regal nicht wie eine Reihe identischer Klötze aussieht. */
export function spineHeight(book) {
  const spread = hashSeed(book.isbn13 || book.title) % (MAX_H - MIN_H)
  return MIN_H + spread
}

/** Bücher nach Regalbrett gruppiert, jedes Brett nach Position sortiert.
    Am Ende steht immer ein leeres Brett, auf das sich ein neues ablegen lässt. */
export function groupByShelf(books) {
  const rows = new Map()
  const sorted = [...books].sort((a, b) => {
    const ai = a.shelfIndex ?? Infinity
    const bi = b.shelfIndex ?? Infinity
    if (ai !== bi) return ai - bi
    return (a.addedAt || '').localeCompare(b.addedAt || '')
  })
  for (const b of sorted) {
    const row = b.shelfRow || 0
    if (!rows.has(row)) rows.set(row, [])
    rows.get(row).push(b)
  }
  const maxRow = rows.size ? Math.max(...rows.keys()) : -1
  if (!rows.has(maxRow + 1)) rows.set(maxRow + 1, [])
  return [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([row, list]) => ({ row, books: list }))
}

/** Verschiebt ein Buch an eine neue Position und nummeriert beide betroffenen
    Bretter danach sauber neu durch — alles in einer Transaktion. */
export async function moveBook(bookId, targetRow, targetIndex, rowsSnapshot) {
  await db.transaction('rw', db.books, async () => {
    const working = rowsSnapshot.map((r) => ({ row: r.row, books: [...r.books] }))
    let moving = null
    for (const r of working) {
      const idx = r.books.findIndex((b) => b.id === bookId)
      if (idx !== -1) {
        moving = r.books.splice(idx, 1)[0]
        break
      }
    }
    if (!moving) return

    let target = working.find((r) => r.row === targetRow)
    if (!target) {
      target = { row: targetRow, books: [] }
      working.push(target)
    }
    target.books.splice(Math.min(targetIndex, target.books.length), 0, moving)

    for (const r of working) {
      for (let i = 0; i < r.books.length; i++) {
        const b = r.books[i]
        if (b.shelfRow !== r.row || b.shelfIndex !== i) {
          await db.books.update(b.id, { shelfRow: r.row, shelfIndex: i })
        }
      }
    }
  })
}
