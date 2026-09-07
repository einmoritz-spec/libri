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
  const book = emptyBook(data)
  if (book.status === 'reading' && !book.startedAt) book.startedAt = book.addedAt
  return db.books.add(book)
}

export async function updateBook(id, changes) {
  return db.books.update(id, changes)
}

export async function deleteBook(id) {
  await db.sessions.where('bookId').equals(id).delete()
  return db.books.delete(id)
}

export async function findByIsbn(isbn13) {
  if (!isbn13) return undefined
  return db.books.where('isbn13').equals(isbn13).first()
}

/** Fortschritt setzen und daraus Status + Lesesitzung ableiten. */
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
  if (delta > 0) {
    await db.sessions.add({
      bookId: book.id,
      date: today.slice(0, 10),
      pages: delta
    })
  }
  return db.books.update(book.id, changes)
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
    serialised.push({
      ...rest,
      coverData: coverBlob ? await blobToDataUrl(coverBlob) : null
    })
  }
  return {
    format: 'libri-backup',
    version: 1,
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
  }
  let added = 0
  let skipped = 0
  for (const raw of payload.books || []) {
    const { id, coverData, ...rest } = raw
    if (rest.isbn13) {
      const existing = await findByIsbn(rest.isbn13)
      if (existing) {
        skipped++
        continue
      }
    }
    const coverBlob = coverData ? await dataUrlToBlob(coverData) : null
    await db.books.add(emptyBook({ ...rest, coverBlob }))
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
