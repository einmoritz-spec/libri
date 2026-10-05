import Dexie from 'dexie'
import { lookupIsbn, fetchCoverBlob, dominantColor, trimBlackBars } from './metadata.js'

export const STATUS = {
  wishlist: 'Wunschliste',
  owned: 'Ungelesen',
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

/* Version 4: rückwirkende Korrektur der Statistik-Bestätigung. Bisher wurde
   jedes automatisch auf "Gelesen" gesetzte Buch als unbestätigt markiert,
   auch wenn echte Lesesitzungen dazu vorlagen. Jetzt gilt: Sitzungen
   vorhanden → vertrauenswürdig, zählt automatisch. Nur ganz ohne jede
   Sitzung direkt auf "Fertig gelesen" gedrückt bleibt unbestätigt, weil
   genau das für ein nachträglich (und vermutlich falsch datiert) erfasstes
   Buch spricht. */
db.version(4)
  .stores({
    books: '++id, isbn13, title, status, addedAt, finishedAt, language, rating, year',
    sessions: '++id, bookId, date',
    covers: 'bookId',
    notes: '++id, bookId, createdAt'
  })
  .upgrade(async (tx) => {
    const sessions = await tx.table('sessions').toArray()
    const hasSessions = new Set(sessions.map((s) => s.bookId))
    const books = await tx.table('books').toArray()
    for (const b of books) {
      if (b.status === 'read' && !b.datesConfirmed && hasSessions.has(b.id)) {
        await tx.table('books').update(b.id, { datesConfirmed: true })
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
    description: '',
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
    subseries: '',
    subseriesIndex: null,
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

/* ---------- Mehrfachauswahl: eine Änderung für viele Bücher ---------- */

/** Wendet für jedes Buch `changes` an — ein Objekt oder eine Funktion (Buch → Objekt). */
export async function updateBooks(ids, changes) {
  await db.transaction('rw', db.books, async () => {
    for (const id of ids) {
      const c = typeof changes === 'function' ? changes(await db.books.get(id)) : changes
      if (c) await db.books.update(id, c)
    }
  })
}

export async function deleteBooks(ids) {
  for (const id of ids) await deleteBook(id)
}

/** Status für viele Bücher setzen — mit denselben Begleitangaben wie im Buch. */
export async function bulkSetStatus(ids, status) {
  const now = new Date().toISOString()
  await updateBooks(ids, (b) => {
    if (!b) return null
    if (status === 'reading') return { status, startedAt: b.startedAt || now }
    if (status === 'read') {
      // Ohne Sitzungen ist das Lesedatum unbekannt — deshalb nicht bestätigt,
      // das Buch zählt dann noch nicht im Jahresverlauf.
      return {
        status,
        currentPage: b.pages || b.currentPage,
        startedAt: b.startedAt || now,
        finishedAt: b.finishedAt || now,
        datesConfirmed: Boolean(b.datesConfirmed)
      }
    }
    return { status }
  })
}

export async function bulkSetAuthors(ids, authors) {
  await updateBooks(ids, { authors })
}

/** Reihe für viele Bücher. Mit `startIndex` werden die Bände in der
    übergebenen Reihenfolge fortlaufend durchnummeriert. */
export async function bulkSetSeries(ids, series, startIndex = null) {
  const order = new Map(ids.map((id, i) => [id, i]))
  await updateBooks(ids, (b) => {
    if (!b) return null
    if (!series) return { series: '', subseries: '', subseriesIndex: null, seriesIndex: null }
    return startIndex == null
      ? { series }
      : { series, seriesIndex: startIndex + order.get(b.id) }
  })
}

/** Unterreihe (z. B. „Witches“ innerhalb von „Discworld“). Leer entfernt sie.
    Mit `renumber` bekommen danach alle Bücher dieser Unterreihe ihren Band
    in der Unterreihe: in der Reihenfolge der Hauptreihe, das Buch mit der
    niedrigsten Zahl dort ist Band 1. Gezählt werden auch Bücher, die schon
    vorher in der Unterreihe waren. */
export async function bulkSetSubseries(ids, subseries, renumber = true) {
  await updateBooks(ids, subseries ? { subseries } : { subseries: '', subseriesIndex: null })
  if (!subseries || !renumber) return
  const chosen = (await db.books.bulkGet(ids)).filter(Boolean)
  const seriesNames = new Set(chosen.map((b) => b.series || ''))
  const all = await db.books.toArray()
  for (const name of seriesNames) {
    const members = all
      .filter((b) => (b.series || '') === name && b.subseries === subseries)
      .sort((a, b) =>
        (a.seriesIndex ?? 9999) - (b.seriesIndex ?? 9999) || a.title.localeCompare(b.title, 'de')
      )
    for (let i = 0; i < members.length; i++) {
      await db.books.update(members[i].id, { subseriesIndex: i + 1 })
    }
  }
}

export async function bulkTags(ids, tag, remove = false) {
  await updateBooks(ids, (b) => {
    if (!b) return null
    const tags = new Set(b.tags || [])
    if (remove) tags.delete(tag)
    else tags.add(tag)
    return { tags: [...tags] }
  })
}

export async function bulkSetLanguage(ids, language) {
  await updateBooks(ids, { language })
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

/** Für Bücher ohne ISBN gibt es sonst nichts, woran sich ein Doppeltes
    erkennen ließe: Titel und erster Autor, ohne Groß-/Kleinschreibung und
    Satzzeichen. Wird nur beim Einlesen einer Sicherung benutzt. */
const normText = (s) =>
  String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

export async function findByTitleAuthor(title, author) {
  const t = normText(title)
  if (!t) return undefined
  const a = normText(author)
  const all = await db.books.toArray()
  return all.find((b) => normText(b.title) === t && normText(b.authors?.[0]) === a)
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
    // Über den Regler/das Eingabefeld erreicht — das ist aktives Tracking,
    // im Unterschied zum direkten Antippen von "Fertig gelesen" ganz ohne
    // je eine Seite eingetragen zu haben. Zählt deshalb sofort.
    changes.datesConfirmed = true
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
  // Wurde zwischendurch mindestens einmal Fortschritt getrackt, ist das
  // Datum vertrauenswürdig und zählt automatisch in der Statistik. Ganz ohne
  // jede Sitzung direkt auf "Fertig gelesen" zu drücken, ist dagegen genau
  // das Muster für ein nachträglich und vermutlich zu einem falschen Datum
  // eingetragenes Buch — das braucht weiterhin eine Bestätigung.
  const hasSessions = (await db.sessions.where('bookId').equals(book.id).count()) > 0
  return db.books.update(book.id, {
    status: 'read',
    currentPage: book.pages || book.currentPage,
    finishedAt: new Date().toISOString(),
    startedAt: book.startedAt || new Date().toISOString(),
    datesConfirmed: hasSessions
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

/* Welche Felder beim Einlesen für schon vorhandene Bücher gelten.
   Angaben zum Buch selbst (Text, Seitenzahl, Verlag …) übernimmt die
   Sicherung, sobald sie etwas Anderes und Nichtleeres enthält. Alles
   Persönliche (Status, Fortschritt, Bewertung, Daten, eigene Schlagworte)
   wird dagegen nur aufgefüllt, wenn es im Buch noch leer ist — sonst würde
   eine ältere Sicherung Lesestand und Bewertung zurücksetzen. */
const IMPORT_OVERWRITE = [
  'title', 'subtitle', 'authors', 'publisher', 'year', 'pages', 'language',
  'description', 'series', 'subseries', 'subseriesIndex', 'seriesIndex', 'coverUrl', 'source'
]
const IMPORT_FILL_ONLY = [
  'status', 'currentPage', 'rating', 'notes', 'tags', 'startedAt', 'finishedAt',
  'addedAt', 'datesConfirmed', 'readBefore', 'shelfRow', 'shelfIndex', 'spineColor'
]

function hasValue(v) {
  if (v === null || v === undefined || v === '') return false
  if (Array.isArray(v)) return v.length > 0
  return true
}

function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Vergleicht ein vorhandenes Buch mit dem Eintrag aus der Sicherung und
    gibt zurück, was geändert werden muss (leer, wenn nichts). */
async function diffForImport(existing, incoming, coverData) {
  const changes = {}
  for (const k of IMPORT_OVERWRITE) {
    // "wird ergänzt…" ist nur ein Platzhalter beim Scannen, kein echter Wert.
    if (k === 'source' && incoming[k] === 'wird ergänzt…') continue
    if (hasValue(incoming[k]) && !sameValue(existing[k], incoming[k])) changes[k] = incoming[k]
  }
  for (const k of IMPORT_FILL_ONLY) {
    if (hasValue(incoming[k]) && !hasValue(existing[k])) changes[k] = incoming[k]
  }
  // Ein Text aus der Sicherung macht den Vermerk "wurde schon versucht" hinfällig.
  if (changes.description) {
    changes.descriptionTried = false
  }
  if (coverData) {
    const blob = await trimBlackBars(await dataUrlToBlob(coverData))
    const stored = existing.hasCover ? await db.covers.get(existing.id) : null
    // Bild ersetzen, wenn keins da ist oder es sich erkennbar unterscheidet.
    if (blob && (!stored?.blob || stored.blob.size !== blob.size)) changes.coverBlob = blob
  }
  return changes
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
  let updated = 0
  // Beim Einfügen bekommt jedes Buch eine neue Nummer. Notizen verweisen aber
  // auf die alte — deshalb die Zuordnung mitführen und am Ende umschreiben.
  const idMap = new Map()

  for (const raw of payload.books || []) {
    const { id, coverData, hasCover, ...rest } = raw
    // Mit ISBN darüber erkennen, ohne ISBN über Titel und Autor — sonst würde
    // jedes ISBN-lose Buch bei jedem erneuten Einlesen ein weiteres Mal
    // angelegt.
    const existing = rest.isbn13
      ? await findByIsbn(rest.isbn13)
      : await findByTitleAuthor(rest.title, rest.authors?.[0])
    if (existing) {
      if (id != null) idMap.set(id, existing.id)
      // Schon vorhanden: nicht neu anlegen, aber Neuerungen aus der Datei übernehmen.
      const changes = await diffForImport(existing, rest, coverData)
      if (Object.keys(changes).length) {
        await updateBook(existing.id, changes)
        updated++
      } else {
        skipped++
      }
      continue
    }
    const coverBlob = coverData ? await trimBlackBars(await dataUrlToBlob(coverData)) : null
    // Über addBook, damit das Bild in der Cover-Tabelle landet.
    const newId = await addBook({ ...rest, coverBlob })
    if (id != null) idMap.set(id, newId)
    added++
  }

  // Notizen und Sitzungen: nur hinzufügen, was es beim Buch noch nicht gibt.
  // Sonst würde jedes erneute Einlesen dieselben Einträge verdoppeln.
  let notesAdded = 0
  for (const n of payload.notes || []) {
    const bookId = idMap.get(n.bookId)
    if (!bookId) continue // Buch nicht übernommen, Notiz wäre verwaist
    const { id, ...rest } = n
    const have = await db.notes.where('bookId').equals(bookId).toArray()
    if (have.some((x) => x.createdAt === rest.createdAt && x.text === rest.text)) continue
    await db.notes.add({ ...rest, bookId })
    notesAdded++
  }

  // War bisher der eigentliche Fehler: exportLibrary schrieb die Sitzungen
  // korrekt in die Sicherung, aber importLibrary hat sie nie zurückgeholt —
  // eine Sicherung wiedereinzulesen hat den Leseverlauf stillschweigend
  // verworfen.
  let sessionsAdded = 0
  for (const s of payload.sessions || []) {
    const bookId = idMap.get(s.bookId)
    if (!bookId) continue // Buch nicht übernommen, Sitzung wäre verwaist
    const { id, ...rest } = s
    const have = await db.sessions.where('bookId').equals(bookId).toArray()
    if (have.some((x) => x.date === rest.date && x.at === rest.at && x.pages === rest.pages)) continue
    await db.sessions.add({ ...rest, bookId })
    sessionsAdded++
  }

  return { added, updated, skipped, notesAdded, sessionsAdded }
}

/** Entfernt doppelte Lesesitzungen und Notizen, wie sie durch mehrfaches
    Einlesen einer Sicherung in älteren Versionen entstanden sind. Als
    doppelt gilt, was bei demselben Buch in Datum, Zeitstempel und Seiten
    (bzw. Zeitstempel und Text) genau übereinstimmt; der älteste Eintrag
    bleibt. */
export async function removeDuplicateEntries() {
  let sessions = 0
  let notes = 0
  const seenS = new Set()
  for (const x of await db.sessions.orderBy('id').toArray()) {
    const key = [x.bookId, x.date, x.at || '', x.pages ?? ''].join('|')
    if (seenS.has(key)) { await db.sessions.delete(x.id); sessions++ } else seenS.add(key)
  }
  const seenN = new Set()
  for (const x of await db.notes.orderBy('id').toArray()) {
    const key = [x.bookId, x.createdAt || '', x.text || ''].join('|')
    if (seenN.has(key)) { await db.notes.delete(x.id); notes++ } else seenN.add(key)
  }
  return { sessions, notes }
}

/** Geht alle gespeicherten Cover durch und schneidet schwarze Ränder ab
    (siehe trimBlackBars). Gibt zurück, wie viele Cover geändert wurden. */
export async function trimAllCovers(onProgress) {
  const ids = await db.covers.toCollection().primaryKeys()
  let changed = 0
  for (let i = 0; i < ids.length; i++) {
    const rec = await db.covers.get(ids[i])
    if (rec?.blob) {
      const next = await trimBlackBars(rec.blob)
      if (next !== rec.blob) {
        await db.covers.put({ bookId: ids[i], blob: next })
        invalidateCover(ids[i])
        changed++
      }
    }
    onProgress?.(i + 1, ids.length)
    // Zwischendurch Luft lassen, damit die Oberfläche flüssig bleibt.
    if (i % 5 === 4) await new Promise((r) => setTimeout(r, 0))
  }
  return { changed, total: ids.length }
}

/** Fehlt bei diesem Buch noch etwas, das die Ergänzung liefern könnte? */
function isIncomplete(b) {
  return (
    !b.hasCover || !b.pages || !b.publisher || !b.year ||
    // descriptionTried: eine Quelle wurde schon gefragt und hatte nichts.
    (!b.description && !b.descriptionTried)
  )
}

/** Hebt den Vermerk "schon versucht" für alle Bücher auf, damit die
    Ergänzung sie beim nächsten Mal wieder anfragt. */
export async function resetEnrichTried() {
  const n = await db.books.filter((b) => b.enrichTried !== undefined).count()
  await db.books.toCollection().modify((b) => { delete b.enrichTried; delete b.descriptionTried })
  return n
}

/** Ergänzt fehlende Angaben für die ganze Bibliothek: Cover, Seitenzahl,
    Verlag, Jahr. Wird pro Buch über dessen eigene ISBN nachgeschlagen, damit
    die Werte zur tatsächlichen Ausgabe passen und nicht zu irgendeiner.
    Läuft bewusst langsam, damit die Quellen nicht drosseln. */
export async function backfillCovers({ onProgress, shouldStop, ids = null } = {}) {
  // Mit `ids` (Auswahl): nur diese Bücher, und auch solche, bei denen es früher
  // schon erfolglos war — wer gezielt auswählt, will es ausdrücklich noch einmal.
  const all = (await db.books.toArray()).filter((b) => !ids || ids.includes(b.id))
  // Alles, wo etwas Wesentliches fehlt — nicht nur Bücher ohne Cover.
  const incomplete = all.filter((b) => b.isbn13 && isIncomplete(b))
  // enrichTried merkt sich die ISBN, für die die Quellen schon einmal
  // verlässlich geantwortet haben, ohne alles liefern zu können. Solche
  // Bücher werden nicht bei jedem Durchlauf erneut gefragt. Ändert sich die
  // ISBN, gilt der Vermerk nicht mehr und das Buch kommt wieder dran.
  const missing = incomplete.filter((b) => ids || b.enrichTried !== b.isbn13)
  const skipped = incomplete.length - missing.length

  let filled = 0
  let failed = 0

  for (let i = 0; i < missing.length; i++) {
    if (shouldStop?.()) break
    const book = missing[i]
    onProgress?.({ done: i, total: missing.length, title: book.title, filled })

    try {
      const meta = await lookupIsbn(book.isbn13)
      if (meta.notFound) {
        // Nur merken, wenn wirklich ein Katalog geantwortet hat — bei
        // Drosselung oder ohne Netz soll es später nochmal versucht werden.
        if (!meta.unreliable) await updateBook(book.id, { enrichTried: book.isbn13 })
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

        if (!book.description) {
          if (meta.description) changes.description = meta.description
          else changes.descriptionTried = true
        }
        if (!book.pages && meta.pages) changes.pages = meta.pages
        if (!book.publisher && meta.publisher) changes.publisher = meta.publisher
        if (!book.year && meta.year) changes.year = meta.year
        if (!book.language && meta.language) changes.language = meta.language

        // Bleibt nach diesem Durchlauf noch etwas offen, haben die Quellen
        // (verlässlich geantwortet) es nicht — beim nächsten Mal überspringen.
        const after = { ...book, ...changes, hasCover: book.hasCover || 'coverBlob' in changes }
        if (isIncomplete(after) && !meta.unreliable) changes.enrichTried = book.isbn13

        if (Object.keys(changes).length) {
          await updateBook(book.id, changes)
          if (Object.keys(changes).some((k) => k !== 'enrichTried' && k !== 'descriptionTried')) filled++
          else failed++
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
  return { filled, failed, skipped, total: missing.length }
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

/* Tageszeiten wie in der Statistik. Beim Nachtragen wird keine genaue
   Uhrzeit abgefragt, sondern nur die Tageszeit; gespeichert wird eine
   Uhrzeit mitten in diesem Abschnitt, damit die Auswertung sie richtig
   zuordnet. */
export const PERIODS = [
  { key: 'morning', label: 'Morgens', hours: '5–11 Uhr', hour: 8 },
  { key: 'noon', label: 'Mittags', hours: '11–14 Uhr', hour: 12 },
  { key: 'afternoon', label: 'Nachmittags', hours: '14–18 Uhr', hour: 16 },
  { key: 'evening', label: 'Abends', hours: '18–22 Uhr', hour: 20 },
  { key: 'night', label: 'Nachts', hours: '22–5 Uhr', hour: 23 }
]

/** Platzhalter für „Tageszeit unbekannt“ (Mittag UTC am Tag selbst). */
function placeholderAt(date) {
  return `${date}T12:00:00.000Z`
}

/** Hat die Sitzung eine echte Uhrzeit? Der Platzhalter zählt nicht. */
export function hasRealTime(s) {
  return Boolean(s?.at) && s.at !== placeholderAt(s.date)
}

/** Uhrzeit (ISO) für ein Datum und eine Tageszeit; ohne Tageszeit der Platzhalter. */
export function atFor(date, period) {
  const p = PERIODS.find((x) => x.key === period)
  if (!p) return placeholderAt(date)
  return new Date(`${date}T${String(p.hour).padStart(2, '0')}:30:00`).toISOString()
}

/** Tageszeit einer Sitzung, oder null, wenn sie nicht bekannt ist. */
export function periodOf(s) {
  if (!hasRealTime(s)) return null
  const h = new Date(s.at).getHours()
  if (h >= 5 && h < 11) return 'morning'
  if (h >= 11 && h < 14) return 'noon'
  if (h >= 14 && h < 18) return 'afternoon'
  if (h >= 18 && h < 22) return 'evening'
  return 'night'
}

export async function addSession({ bookId, date, pages, period = null }) {
  return db.sessions.add({
    bookId,
    date,
    at: atFor(date, period),
    pages: Math.max(0, Math.round(Number(pages) || 0))
  })
}

export async function updateSession(id, changes) {
  const clean = { ...changes }
  if ('date' in clean || 'period' in clean) {
    const cur = await db.sessions.get(id)
    const date = clean.date ?? cur.date
    // Ohne neue Angabe bleibt die bisherige Tageszeit erhalten.
    const period = 'period' in clean ? clean.period : periodOf(cur)
    clean.at = atFor(date, period)
  }
  delete clean.period
  if ('pages' in clean) clean.pages = Math.max(0, Math.round(Number(clean.pages) || 0))
  return db.sessions.update(id, clean)
}

export async function deleteSession(id) {
  return db.sessions.delete(id)
}

/* ---------- Bücher ohne Lesedatum ---------- */

/** Gelesen, aber ohne bestätigtes Datum und nicht als „vor dem Tracking
    gelesen“ vermerkt — um diese geht es in der Statistik-Meldung. */
export function isUndated(b) {
  return b.status === 'read' && !(b.finishedAt && b.datesConfirmed) && !b.readBefore
}

/** Vermerkt, dass die Bücher schon vor der Nutzung der App gelesen wurden.
    Sie zählen als gelesen, tauchen aber in keinem Jahresverlauf auf. */
export async function markReadBefore(ids) {
  await updateBooks(ids, { readBefore: true })
}

/** Trägt für ein Buch das Datum ein, an dem es beendet wurde. */
export async function setFinishedOn(id, dateStr) {
  // Mittags ansetzen, damit Zeitzonen das Datum nicht verschieben.
  const finishedAt = new Date(`${dateStr}T12:00:00`).toISOString()
  await db.books.update(id, { finishedAt, datesConfirmed: true, readBefore: false })
}

/* ---------- Gelesene Seiten (Statistik) ---------- */

/** Gelesene Seiten insgesamt. Zählt auch angefangene und abgebrochene Bücher
    mit ihrem Stand — nicht erst, wenn ein Buch fertig ist. */
export function pagesReadTotal(books) {
  let total = 0
  for (const b of books) {
    if (b.status === 'read') total += b.pages || 0
    else if (b.status === 'reading' || b.status === 'dnf') total += b.currentPage || 0
  }
  return total
}

/** Gelesene Seiten je Monat eines Jahres. Grundlage sind die eingetragenen
    Lesesitzungen (mit ihrem Datum), sodass auch ein noch nicht beendetes Buch
    sofort mitzählt. Bei fertigen Büchern wird, was nicht als Sitzung
    eingetragen wurde, in den Monat des bestätigten Lesedatums gelegt. */
export function pagesByMonth(books, sessions, year) {
  const months = Array(12).fill(0)
  const byId = new Map(books.map((b) => [b.id, b]))
  const logged = new Map()
  for (const s of sessions) {
    const book = byId.get(s.bookId)
    if (!book || !s.date) continue
    logged.set(s.bookId, (logged.get(s.bookId) || 0) + (s.pages || 0))
    if (Number(s.date.slice(0, 4)) === year) months[Number(s.date.slice(5, 7)) - 1] += s.pages || 0
  }
  for (const b of books) {
    if (b.status !== 'read' || !b.pages || !b.finishedAt || !b.datesConfirmed) continue
    if (Number(b.finishedAt.slice(0, 4)) !== year) continue
    const rest = Math.max(0, b.pages - (logged.get(b.id) || 0))
    months[Number(b.finishedAt.slice(5, 7)) - 1] += rest
  }
  return months
}

/* ---------- Lesetempo ---------- */

const dayKey = (d) => d.toISOString().slice(0, 10)

/** Wie schnell du gerade liest, aus allen Sitzungen der letzten 30 Tage
    (über alle Bücher, nicht je Buch). Gerechnet wird in Seiten pro
    Kalendertag, also mit den Tagen ohne Lesen — nur so ergibt sich eine
    brauchbare Schätzung, wann ein Buch fertig wird.

    Der heutige Tag zählt nicht in den Schnitt, weil er noch nicht vorbei ist;
    sonst würde ein früher Nachmittag das Tempo drücken. Stattdessen steht
    todayPages getrennt zur Verfügung: was heute schon gelesen ist, verbraucht
    einen Teil des Tagesbudgets (siehe estimateFinish).

    Weicht das Tempo der letzten sieben Tage stark vom Monatsschnitt ab
    (um mehr als ein Drittel), zählt das jüngste Tempo stärker. */
export async function readingPace(now = new Date()) {
  const rows = await db.sessions.toArray()
  const dated = rows.filter((r) => r.date)
  if (!dated.length) return null

  const today = dayKey(now)
  const daysAgo = (n) => {
    const d = new Date(now)
    d.setDate(d.getDate() - n)
    return dayKey(d)
  }
  const yesterday = daysAgo(1)
  const first = dated.reduce((m, r) => (r.date < m ? r.date : m), today)
  // Vollständige Tage seit der ersten Sitzung, höchstens 30
  const spanDays = Math.min(30, Math.round((new Date(yesterday) - new Date(first)) / 86400000) + 1)
  // Weniger als drei vollständige Tage sind zu wenig für eine Aussage.
  if (spanDays < 3) return null

  const sum = (list) => list.reduce((a, r) => a + (r.pages || 0), 0)
  const from30 = daysAgo(30)
  const from7 = daysAgo(7)
  const done = dated.filter((r) => r.date >= from30 && r.date <= yesterday)
  const monthPages = sum(done)
  if (monthPages <= 0) return null
  const monthPace = monthPages / spanDays

  const recentDays = Math.min(7, spanDays)
  const recentPace = sum(done.filter((r) => r.date >= from7)) / recentDays

  // Der Vergleich lohnt erst, wenn es mehr als eine Woche Vorlauf gibt.
  let pace = monthPace
  let trend = null
  if (spanDays >= 14) {
    const deviation = (recentPace - monthPace) / monthPace
    if (Math.abs(deviation) > 0.34) {
      trend = deviation > 0 ? 'faster' : 'slower'
      pace = recentPace > 0 ? 0.4 * monthPace + 0.6 * recentPace : monthPace * 0.4
    }
  }

  // Seiten je Tag für die kleine Grafik (mit heute)
  const inWindow = dated.filter((r) => r.date >= daysAgo(29) && r.date <= today)
  const perDay = new Map()
  for (const r of inWindow) perDay.set(r.date, (perDay.get(r.date) || 0) + (r.pages || 0))
  const series = []
  for (let i = 29; i >= 0; i--) {
    const k = daysAgo(i)
    series.push({ date: k, pages: perDay.get(k) || 0 })
  }

  return {
    pace,                       // Seiten pro Tag, ggf. angepasst
    monthPace, recentPace,
    trend,                      // 'faster' | 'slower' | null
    spanDays,
    todayPages: perDay.get(today) || 0,
    activeDays: perDay.size,
    series
  }
}

/** Schätzung für ein Buch aus dem Tempo und dem, was heute schon gelesen ist.

    Heute bleibt vom Tagesschnitt nur der Rest übrig (Tempo minus heute schon
    gelesen), jeder weitere Tag bringt ein volles Tempo. Fehlen am Ende eines
    Tages nur noch höchstens 10 % des Buchs, wird es voraussichtlich noch am
    selben Tag zu Ende gelesen, statt die letzten Seiten liegen zu lassen.
    Andernfalls ist der nächste Tag dran. */
export function estimateFinish(book, pace, now = new Date()) {
  if (!pace || !book.pages) return null
  const left = Math.max(0, book.pages - (book.currentPage || 0))
  if (!left) return null
  const p = pace.pace
  const todayLeft = Math.max(0, p - (pace.todayPages || 0))
  const tolerance = 0.1 * book.pages

  let days = 400
  for (let n = 0; n < 400; n++) {
    if (todayLeft + n * p + tolerance >= left) { days = n; break }
  }
  const date = new Date(now)
  date.setDate(date.getDate() + days)
  return { left, todayLeft: Math.round(todayLeft), days, date }
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
