import Dexie from 'dexie'

export const STATUS = {
  wishlist: 'Wunschliste',
  owned: 'Im Regal',
  reading: 'Lese ich',
  read: 'Gelesen',
  dnf: 'Abgebrochen'
}

export const STATUS_ORDER = ['reading', 'owned', 'wishlist', 'read', 'dnf']

export const db = new Dexie('libri')

// Version 1 — Felder für die spätere Regal-Ansicht (shelfRow, shelfIndex,
// spineColor) sind von Anfang an im Datensatz, damit keine Migration nötig wird.
db.version(1).stores({
  books: '++id, isbn13, title, status, addedAt, finishedAt, language, shelfRow',
  sessions: '++id, bookId, date'
})

/* Version 2: Cover wandern in eine eigene Tabelle.
   Vorher lag jedes Bild mitten im Buchdatensatz — jede Abfrage der Bibliothek
   hat damit sämtliche Cover mitgeladen, auch wenn nur Titel und Autor
   gebraucht wurden. Bei größeren Sammlungen ist das der Hauptgrund für
   Trägheit. Jetzt bleibt der Buchdatensatz klein, das Bild wird nur geholt,
   wenn es wirklich angezeigt wird. */
db.version(2)
  .stores({
    books: '++id, isbn13, title, status, addedAt, finishedAt, language, rating, year',
    sessions: '++id, bookId, date',
    covers: 'bookId'
  })
  .upgrade(async (tx) => {
    const books = await tx.table('books').toArray()
    for (const b of books) {
      if (b.coverBlob) {
        await tx.table('covers').put({ bookId: b.id, blob: b.coverBlob })
        const { coverBlob, ...rest } = b
        await tx.table('books').put({ ...rest, hasCover: true })
      }
    }
  })

/* Öffnungszustand der Datenbank.
   Ohne das hier wartet eine Abfrage im Fehlerfall endlos — und der Bildschirm
   bleibt für immer im Ladezustand hängen, ohne dass irgendwo steht, warum. */
export const dbStatus = {
  state: 'opening', // opening | ready | blocked | failed
  error: null,
  listeners: new Set()
}

function setDbState(state, error = null) {
  dbStatus.state = state
  dbStatus.error = error
  dbStatus.listeners.forEach((fn) => fn())
}

export function onDbStatus(fn) {
  dbStatus.listeners.add(fn)
  return () => dbStatus.listeners.delete(fn)
}

// Wird ausgelöst, wenn die Datenbank in einem anderen Tab noch mit einer
// älteren Version offen ist und deshalb nicht aktualisiert werden kann.
db.on('blocked', () => setDbState('blocked'))

db.open()
  .then(() => setDbState('ready'))
  .catch((err) => setDbState('failed', err))

// Notbremse: Sollte das Öffnen aus einem unvorhergesehenen Grund weder
// gelingen noch scheitern, nach 8 Sekunden trotzdem etwas Sichtbares zeigen.
setTimeout(() => {
  if (dbStatus.state === 'opening') setDbState('blocked')
}, 8000)

export function emptyBook(overrides = {}) {
  return {
    isbn13: null,
    title: '',
    subtitle: '',
    authors: [],
    publisher: '',
    year: null,
    pages: null,
    language: '',
    coverUrl: null,
    coverBlob: null,
    spineColor: null,
    status: 'owned',
    currentPage: 0,
    rating: null,
    notes: '',
    tags: [],
    shelfRow: 0,
    shelfIndex: null,
    source: 'manual',
    addedAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    ...overrides
  }
}

export async function addBook(data) {
  const { coverBlob, ...rest } = emptyBook(data)
  const book = rest
  if (book.status === 'reading' && !book.startedAt) book.startedAt = book.addedAt
  book.hasCover = Boolean(coverBlob)
  const id = await db.books.add(book)
  if (coverBlob) await db.covers.put({ bookId: id, blob: coverBlob })
  return id
}

export async function updateBook(id, changes) {
  // Ein mitgeliefertes Bild gehört in die Cover-Tabelle, nicht in den Datensatz.
  if ('coverBlob' in changes) {
    const { coverBlob, ...rest } = changes
    if (coverBlob) {
      await db.covers.put({ bookId: id, blob: coverBlob })
      rest.hasCover = true
    } else {
      await db.covers.delete(id)
      rest.hasCover = false
    }
    invalidateCover(id)
    return db.books.update(id, rest)
  }
  return db.books.update(id, changes)
}

export async function deleteBook(id) {
  await db.sessions.where('bookId').equals(id).delete()
  await db.covers.delete(id)
  invalidateCover(id)
  return db.books.delete(id)
}

/* Merkt sich bereits erzeugte Bild-Adressen, damit dasselbe Cover beim
   Scrollen nicht immer wieder neu aus der Datenbank geholt und aufgebaut
   werden muss. */
const coverUrls = new Map()

export async function getCoverUrl(bookId) {
  if (!bookId) return null
  if (coverUrls.has(bookId)) return coverUrls.get(bookId)
  try {
    const rec = await db.covers.get(bookId)
    const url = rec?.blob ? URL.createObjectURL(rec.blob) : null
    coverUrls.set(bookId, url)
    return url
  } catch {
    return null
  }
}

export function invalidateCover(bookId) {
  const url = coverUrls.get(bookId)
  if (url) URL.revokeObjectURL(url)
  coverUrls.delete(bookId)
}

export async function findByIsbn(isbn13) {
  if (!isbn13) return undefined
  return db.books.where('isbn13').equals(isbn13).first()
}

/** Fortschritt setzen und daraus Status + Lesesitzung ableiten.
    Beide Schreibvorgänge laufen in einer Transaktion — vorher waren es zwei
    getrennte Runden zur Datenbank für einen einzigen Tastendruck. */
export async function setProgress(book, page) {
  const p = Math.max(0, Math.min(page, book.pages || page))
  const changes = { currentPage: p }
  const today = new Date().toISOString()

  if (p > 0 && book.status !== 'reading' && book.status !== 'read') {
    changes.status = 'reading'
    if (!book.startedAt) changes.startedAt = today
  }
  if (book.pages && p >= book.pages) {
    changes.status = 'read'
    changes.finishedAt = today
  }

  const delta = p - (book.currentPage || 0)

  return db.transaction('rw', db.books, db.sessions, async () => {
    if (delta > 0) {
      await db.sessions.add({ bookId: book.id, date: today.slice(0, 10), pages: delta })
    }
    await db.books.update(book.id, changes)
  })
}

export async function markFinished(book) {
  return db.books.update(book.id, {
    status: 'read',
    currentPage: book.pages || book.currentPage,
    finishedAt: new Date().toISOString(),
    startedAt: book.startedAt || new Date().toISOString()
  })
}

/* ---------- Backup ---------- */

async function blobToDataUrl(blob) {
  return new Promise((resolve) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = () => resolve(null)
    r.readAsDataURL(blob)
  })
}

async function dataUrlToBlob(dataUrl) {
  try {
    const res = await fetch(dataUrl)
    return await res.blob()
  } catch {
    return null
  }
}

export async function exportLibrary() {
  const books = await db.books.toArray()
  const sessions = await db.sessions.toArray()
  const serialised = []
  for (const b of books) {
    const { coverBlob, ...rest } = b
    // Cover liegen seit Version 2 in eigener Tabelle; coverBlob nur noch als
    // Rest aus alten Datensätzen berücksichtigt.
    const stored = b.hasCover ? await db.covers.get(b.id) : null
    const blob = stored?.blob || coverBlob || null
    serialised.push({
      ...rest,
      coverData: blob ? await blobToDataUrl(blob) : null
    })
  }
  return {
    format: 'libri-backup',
    version: 2,
    exportedAt: new Date().toISOString(),
    books: serialised,
    sessions
  }
}

export async function importLibrary(payload, { replace = false } = {}) {
  if (!payload || payload.format !== 'libri-backup') {
    throw new Error('Das ist keine Libri-Sicherung.')
  }
  if (replace) {
    await db.books.clear()
    await db.sessions.clear()
    await db.covers.clear()
  }
  let added = 0
  let skipped = 0
  for (const raw of payload.books || []) {
    const { id, coverData, hasCover, ...rest } = raw
    if (rest.isbn13) {
      const existing = await findByIsbn(rest.isbn13)
      if (existing) {
        skipped++
        continue
      }
    }
    const coverBlob = coverData ? await dataUrlToBlob(coverData) : null
    // Über addBook, damit das Bild in der Cover-Tabelle landet.
    await addBook({ ...rest, coverBlob })
    added++
  }
  return { added, skipped }
}

/* ---------- Backup-Erinnerung ---------- */

const LAST_BACKUP_KEY = 'libri:lastBackup'

export function markBackupDone() {
  localStorage.setItem(LAST_BACKUP_KEY, new Date().toISOString())
}

export function daysSinceBackup() {
  const raw = localStorage.getItem(LAST_BACKUP_KEY)
  if (!raw) return null
  return Math.floor((Date.now() - new Date(raw).getTime()) / 86400000)
}
