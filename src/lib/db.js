import Dexie from 'dexie'
import { lookupIsbn, fetchCoverBlob, dominantColor } from './metadata.js'

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

/* Version 3: Notizen und Zitate bekommen eine eigene Tabelle.
   Bisher gab es ein einzelnes Freitextfeld am Buch — damit ließ sich weder
   mehreres festhalten noch eine Seitenzahl zuordnen. Vorhandener Text wandert
   automatisch als erste Notiz herüber, damit nichts verlorengeht. */
db.version(3)
  .stores({
    books: '++id, isbn13, title, status, addedAt, finishedAt, language, rating, year',
    sessions: '++id, bookId, date',
    covers: 'bookId',
    notes: '++id, bookId, createdAt'
  })
  .upgrade(async (tx) => {
    const books = await tx.table('books').toArray()
    for (const b of books) {
      const text = (b.notes || '').trim()
      if (!text) continue
      await tx.table('notes').add({
        bookId: b.id,
        type: 'note',
        text,
        page: null,
        createdAt: b.addedAt || new Date().toISOString()
      })
      await tx.table('books').put({ ...b, notes: '' })
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
    series: '',
    seriesIndex: null,
    // Nur bestätigte Daten zählen für die Statistik. "Fertig gelesen" und das
    // Erreichen der letzten Seite setzen automatisch das heutige Datum — beim
    // einzelnen Buch in Echtzeit korrekt, aber wenn viele alte Bücher auf
    // einmal nachgetragen werden, würde das die Statistik auf einen einzigen
    // Tag zusammenstauchen. Erst ein bestätigtes oder von Hand gesetztes
    // Datum fließt in Diagramme und Lesetempo ein.
    datesConfirmed: false,
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
  await db.notes.where('bookId').equals(id).delete()
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
    changes.datesConfirmed = false // automatisch gesetzt — zählt erst nach Bestätigung
  }

  const delta = p - (book.currentPage || 0)

  return db.transaction('rw', db.books, db.sessions, async () => {
    if (delta > 0) {
      await db.sessions.add({ bookId: book.id, date: today.slice(0, 10), at: today, pages: delta })
    }
    await db.books.update(book.id, changes)
  })
}

export async function markFinished(book) {
  return db.books.update(book.id, {
    status: 'read',
    currentPage: book.pages || book.currentPage,
    finishedAt: new Date().toISOString(),
    startedAt: book.startedAt || new Date().toISOString(),
    datesConfirmed: false // automatisch gesetzt — zählt erst nach Bestätigung
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
    version: 3,
    exportedAt: new Date().toISOString(),
    books: serialised,
    sessions,
    notes: await db.notes.toArray()
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
    await db.notes.clear()
  }
  let added = 0
  let skipped = 0
  // Beim Einfügen bekommt jedes Buch eine neue Nummer. Notizen verweisen aber
  // auf die alte — deshalb die Zuordnung mitführen und am Ende umschreiben.
  const idMap = new Map()

  for (const raw of payload.books || []) {
    const { id, coverData, hasCover, ...rest } = raw
    if (rest.isbn13) {
      const existing = await findByIsbn(rest.isbn13)
      if (existing) {
        skipped++
        if (id != null) idMap.set(id, existing.id)
        continue
      }
    }
    const coverBlob = coverData ? await dataUrlToBlob(coverData) : null
    // Über addBook, damit das Bild in der Cover-Tabelle landet.
    const newId = await addBook({ ...rest, coverBlob })
    if (id != null) idMap.set(id, newId)
    added++
  }

  let notesAdded = 0
  for (const n of payload.notes || []) {
    const bookId = idMap.get(n.bookId)
    if (!bookId) continue // Buch nicht übernommen, Notiz wäre verwaist
    const { id, ...rest } = n
    await db.notes.add({ ...rest, bookId })
    notesAdded++
  }

  return { added, skipped, notesAdded }
}

/** Ergänzt fehlende Angaben für die ganze Bibliothek: Cover, Seitenzahl,
    Verlag, Jahr. Wird pro Buch über dessen eigene ISBN nachgeschlagen, damit
    die Werte zur tatsächlichen Ausgabe passen und nicht zu irgendeiner.
    Läuft bewusst langsam, damit die Quellen nicht drosseln. */
export async function backfillCovers({ onProgress, shouldStop } = {}) {
  const all = await db.books.toArray()
  // Alles, wo etwas Wesentliches fehlt — nicht nur Bücher ohne Cover.
  const missing = all.filter(
    (b) => b.isbn13 && (!b.hasCover || !b.pages || !b.publisher || !b.year)
  )

  let filled = 0
  let failed = 0

  for (let i = 0; i < missing.length; i++) {
    if (shouldStop?.()) break
    const book = missing[i]
    onProgress?.({ done: i, total: missing.length, title: book.title, filled })

    try {
      const meta = await lookupIsbn(book.isbn13)
      if (meta.notFound) {
        failed++
      } else {
        const changes = {}

        // Cover nur holen, wenn wirklich keins da ist.
        if (!book.hasCover) {
          let blob = await fetchCoverBlob(meta.coverUrl)
          if (!blob) blob = await fetchCoverBlob(meta.fallbackCoverUrl)
          if (blob) {
            changes.coverBlob = blob
            const spineColor = await dominantColor(blob)
            if (spineColor) changes.spineColor = spineColor
          }
        }

        if (!book.pages && meta.pages) changes.pages = meta.pages
        if (!book.publisher && meta.publisher) changes.publisher = meta.publisher
        if (!book.year && meta.year) changes.year = meta.year
        if (!book.language && meta.language) changes.language = meta.language

        if (Object.keys(changes).length) {
          await updateBook(book.id, changes)
          filled++
        } else {
          failed++
        }
      }
    } catch {
      failed++
    }

    // Kurze Pause zwischen den Büchern — verhindert, dass die Quellen wegen
    // zu vieler Anfragen dichtmachen.
    await new Promise((r) => setTimeout(r, 350))
  }

  onProgress?.({ done: missing.length, total: missing.length, filled })
  return { filled, failed, total: missing.length }
}

/* ---------- Notizen und Zitate ---------- */

export const NOTE_TYPES = { quote: 'Zitat', note: 'Notiz' }

export function notesFor(bookId) {
  return db.notes.where('bookId').equals(bookId).toArray()
}

export async function addNote({ bookId, type, text, page }) {
  return db.notes.add({
    bookId,
    type: type === 'quote' ? 'quote' : 'note',
    text: String(text || '').trim(),
    page: page ? Number(page) : null,
    createdAt: new Date().toISOString()
  })
}

export async function updateNote(id, changes) {
  const clean = { ...changes }
  if ('text' in clean) clean.text = String(clean.text || '').trim()
  if ('page' in clean) clean.page = clean.page ? Number(clean.page) : null
  return db.notes.update(id, clean)
}

export async function deleteNote(id) {
  return db.notes.delete(id)
}

/* ---------- Einzelne Lesesitzungen ---------- */

/** Sitzungen eines Buchs, neueste zuerst — zum Nachtragen und Korrigieren.
    Bewusst getrennt von der aktuellen Seite des Buchs: eine Sitzung zu
    bearbeiten verschiebt nicht, wo du gerade liest, sondern nur, wofür der
    Tag in der Statistik gutgeschrieben wird. */
export async function sessionsFor(bookId) {
  const rows = await db.sessions.where('bookId').equals(bookId).toArray()
  return rows.sort((a, b) => b.date.localeCompare(a.date) || (b.at || '').localeCompare(a.at || ''))
}

export async function addSession({ bookId, date, pages }) {
  return db.sessions.add({
    bookId,
    date,
    at: `${date}T12:00:00.000Z`, // keine Uhrzeit abgefragt, Mittag als neutraler Platzhalter
    pages: Math.max(0, Math.round(Number(pages) || 0))
  })
}

export async function updateSession(id, changes) {
  const clean = { ...changes }
  if ('date' in clean) clean.at = `${clean.date}T12:00:00.000Z`
  if ('pages' in clean) clean.pages = Math.max(0, Math.round(Number(clean.pages) || 0))
  return db.sessions.update(id, clean)
}

export async function deleteSession(id) {
  return db.sessions.delete(id)
}

/* ---------- Leseverlauf ---------- */

/**
 * Wertet die beim Fortschritt-Eintragen aufgezeichneten Sitzungen aus:
 * Seiten je Tag über die letzten Tage, Schnitt, und daraus eine Schätzung,
 * wann das Buch durch ist. Diese Daten lagen bisher ungenutzt in der
 * Datenbank.
 */
export async function readingHistory(book, days = 30) {
  const rows = await db.sessions.where('bookId').equals(book.id).toArray()
  if (!rows.length) return null

  const perDay = new Map()
  for (const r of rows) perDay.set(r.date, (perDay.get(r.date) || 0) + (r.pages || 0))

  const today = new Date()
  const series = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    series.push({ date: key, pages: perDay.get(key) || 0 })
  }

  const activeDays = [...perDay.values()].filter((p) => p > 0)
  const perActiveDay = activeDays.length
    ? Math.round(activeDays.reduce((a, b) => a + b, 0) / activeDays.length)
    : 0

  const left = book.pages ? Math.max(0, book.pages - (book.currentPage || 0)) : null
  const daysLeft = left && perActiveDay > 0 ? Math.ceil(left / perActiveDay) : null

  return {
    series,
    perActiveDay,
    left,
    daysLeft,
    totalLogged: [...perDay.values()].reduce((a, b) => a + b, 0),
    sessionCount: rows.length
  }
}

/* ---------- Backup-Erinnerung ---------- */

const LAST_BACKUP_KEY = 'libri:lastBackup'
const AUTO_BACKUP_INTERVAL_DAYS = 7

export function markBackupDone() {
  localStorage.setItem(LAST_BACKUP_KEY, new Date().toISOString())
}

export function daysSinceBackup() {
  const raw = localStorage.getItem(LAST_BACKUP_KEY)
  if (!raw) return null
  return Math.floor((Date.now() - new Date(raw).getTime()) / 86400000)
}

/** True, wenn eine automatische Sicherung fällig ist. Erst ab dem ersten
    Buch — eine leere Bibliothek muss nicht gesichert werden. */
export async function isAutoBackupDue() {
  const days = daysSinceBackup()
  if (days !== null && days < AUTO_BACKUP_INTERVAL_DAYS) return false
  const count = await db.books.count()
  return count > 0
}
