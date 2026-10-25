import Dexie from 'dexie'
import { lookupIsbn, fetchCoverBlob, dominantColor, trimBlackBars, searchBooksByText, throttleStatus } from './metadata.js'
import { loadShop, matchBook, shopKey } from './shopData.js'

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

/* Version 5: Ergänzungen zu den Shop-Büchern (ISBN, Cover, Text …).
   Der Katalog selbst liegt fest in der App; hier steht nur, was Libri
   zusätzlich herausgefunden hat — pro Shop-Buch ein Eintrag. */
db.version(5).stores({
  books: '++id, isbn13, title, status, addedAt, finishedAt, language, rating, year',
  sessions: '++id, bookId, date',
  covers: 'bookId',
  notes: '++id, bookId, createdAt',
  shopMeta: 'key'
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
    audioMinutes: null, // Hörbuch-Laufzeit in Minuten (aus dem Katalog)
    reads: [], // frühere Durchgänge: { startedAt, finishedAt, rating, format, language }
    readLanguage: null, // Sprache des aktuellen Durchgangs, falls anders als die des Buchs
    format: null, // 'print' | 'ebook' | 'audio' — wie gelesen
    ebookPages: null, // Seitenzahl, die der eReader anzeigt
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
    files: [], // Dateien in deinem Drive: { id, name, ext } — nur auf dem Gerät, nie im Repo
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

export async function bulkSetFormat(ids, format) {
  await updateBooks(ids, { format })
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
      await db.sessions.add({ bookId: book.id, date: today.slice(0, 10), at: today, pages: delta, ...(book.format ? { format: book.format } : {}) })
    }
    await db.books.update(book.id, changes)
  })
}

/** Jeden früheren Durchgang (erneutes Lesen/Hören) als eigenes „gelesenes“
    Buch für die Statistik ausrollen. So zählen Bücher, Seiten (je nach
    Format) und Sprachen für jeden Durchgang mit eigenem Datum, ohne dass die
    Bibliothek doppelte Einträge bekommt. Die Einträge teilen sich die id des
    Buchs; `_k` ist ein eindeutiger Listenschlüssel. */
export function expandReads(books, { rereads = true } = {}) {
  const out = []
  const virtual = (b, r, i) => ({
    ...b,
    _k: `${b.id}-r${i}`,
    status: 'read',
    startedAt: r.startedAt || null,
    finishedAt: r.finishedAt || null,
    rating: r.rating || null,
    format: r.format || null,
    language: r.language || b.language,
    readLanguage: null,
    currentPage: b.pages || 0,
    datesConfirmed: r.datesConfirmed !== false,
    readBefore: !!r.readBefore
  })
  for (const b of books) {
    const reads = b.reads || []
    if (!reads.length) { out.push(b); continue }
    if (rereads) {
      out.push(b.readLanguage && b.status === 'read' ? { ...b, language: b.readLanguage } : b)
      reads.forEach((r, i) => out.push(virtual(b, r, i)))
    } else {
      // Nur der erste Durchgang zählt; ein laufender oder späterer Durchgang nicht als eigenes Buch.
      if (b.status !== 'read') out.push(b)
      out.push(virtual(b, reads[0], 0))
    }
  }
  return out
}

export async function markFinished(book, format = null) {
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
    datesConfirmed: hasSessions,
    ...(format ? { format } : {})
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
    notes: await db.notes.toArray(),
    shop: await exportShop()
  }
}

/** Shop-Daten für die Sicherung: ergänzte Angaben samt Cover, Warenkorb und
    bisherige Bestellungen (liegen im Speicher des Browsers). */
async function exportShop() {
  const meta = []
  for (const m of await db.shopMeta.toArray()) {
    const { coverBlob, ...rest } = m
    meta.push({ ...rest, coverData: coverBlob ? await blobToDataUrl(coverBlob) : null })
  }
  const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || '[]') } catch { return [] } }
  return { meta, cart: read('cart2'), orders: read('orders2') }
}

/** Gegenstück: Shop-Daten aus einer Sicherung zurückholen, ohne Vorhandenes zu verlieren. */
async function importShop(shop) {
  if (!shop) return
  for (const r of shop.meta || []) {
    const { coverData, ...rest } = r
    const have = await db.shopMeta.get(r.key)
    const m = { ...(have || {}), key: r.key }
    for (const [k, v] of Object.entries(rest)) {
      if (k === 'files') { if (Array.isArray(v) && v.length) m.files = v; continue }
      if (k !== 'key' && v && !m[k]) m[k] = v
    }
    if (!m.coverBlob && coverData) m.coverBlob = await dataUrlToBlob(coverData)
    await db.shopMeta.put(m)
  }
  const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || '[]') } catch { return [] } }
  try {
    const cart = [...new Set([...read('cart2'), ...(shop.cart || [])])]
    localStorage.setItem('cart2', JSON.stringify(cart))
    const orders = read('orders2')
    const seen = new Set(orders.map((o) => o.no))
    for (const o of shop.orders || []) if (o && !seen.has(o.no)) orders.push(o)
    orders.sort((a, b) => String(b.date).localeCompare(String(a.date)))
    localStorage.setItem('orders2', JSON.stringify(orders.slice(0, 40)))
  } catch { /* Speicher gesperrt */ }
}

/* Welche Felder beim Einlesen für schon vorhandene Bücher gelten.
   Angaben zum Buch selbst (Text, Seitenzahl, Verlag …) übernimmt die
   Sicherung, sobald sie etwas Anderes und Nichtleeres enthält. Alles
   Persönliche (Status, Fortschritt, Bewertung, Daten, eigene Schlagworte)
   wird dagegen nur aufgefüllt, wenn es im Buch noch leer ist — sonst würde
   eine ältere Sicherung Lesestand und Bewertung zurücksetzen. */
const IMPORT_OVERWRITE = [
  'title', 'subtitle', 'authors', 'publisher', 'year', 'pages', 'language',
  'description', 'audioMinutes', 'series', 'subseries', 'subseriesIndex', 'seriesIndex', 'coverUrl', 'source', 'files'
]
const IMPORT_FILL_ONLY = [
  'status', 'currentPage', 'rating', 'notes', 'tags', 'startedAt', 'finishedAt',
  'format', 'ebookPages', 'reads', 'readLanguage', 'addedAt', 'datesConfirmed', 'readBefore', 'shelfRow', 'shelfIndex', 'spineColor'
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

/** Nur Drive-Verknüpfungen einlesen („libri-links“): legt keine Bücher an, ändert keinen Status
    und bringt keine Warenkorb-/Bestellangaben mit. Bücher werden nur ergänzt, wenn es sie schon gibt. */
export async function importLinks(payload) {
  let linked = 0
  let missing = 0
  for (const raw of payload.books || []) {
    const hasFiles = Array.isArray(raw.files) && raw.files.length
    if (!hasFiles && !(raw.audioMinutes > 0)) continue
    const existing = raw.isbn13
      ? await findByIsbn(raw.isbn13)
      : await findByTitleAuthor(raw.title, raw.authors?.[0])
    if (!existing) { missing++; continue }
    await updateBook(existing.id, {
      ...(hasFiles ? { files: raw.files } : {}),
      ...(raw.audioMinutes > 0 && !(existing.audioMinutes > 0) ? { audioMinutes: raw.audioMinutes } : {})
    })
    linked++
  }
  let shopLinked = 0
  for (const r of payload.shop?.meta || []) {
    if (!r.key || !Array.isArray(r.files) || !r.files.length) continue
    const have = await db.shopMeta.get(r.key)
    await db.shopMeta.put({ ...(have || {}), key: r.key, files: r.files })
    shopLinked++
  }
  return { linked, missing, shopLinked }
}

/** Sicherung der aktuellen Bibliothek als Datei, bevor etwas eingelesen wird. Leere Bibliothek: nichts zu sichern. */
export async function autoBackupBeforeImport() {
  const n = (await db.books.count()) + (await db.shopMeta.count())
  if (!n) return false
  const data = await exportLibrary()
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const d = new Date()
  const pad = (x) => String(x).padStart(2, '0')
  a.href = url
  a.download = `libri-vor-import-${d.toISOString().slice(0, 10)}-${pad(d.getHours())}${pad(d.getMinutes())}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
  return true
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
    await db.shopMeta.clear()
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

  await importShop(payload.shop)

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
  await db.books.toCollection().modify((b) => { delete b.enrichTried; delete b.descriptionTried; delete b.audioTried })
  return n
}

/** Ergänzt fehlende Angaben für die ganze Bibliothek: Cover, Seitenzahl,
    Verlag, Jahr. Wird pro Buch über dessen eigene ISBN nachgeschlagen, damit
    die Werte zur tatsächlichen Ausgabe passen und nicht zu irgendeiner.
    Läuft bewusst langsam, damit die Quellen nicht drosseln. */
export async function backfillCovers({ onProgress, shouldStop, ids = null } = {}) {
  // Mit `ids` (Auswahl): nur diese Bücher, und auch solche, bei denen es früher
  // schon erfolglos war — wer gezielt auswählt, will es ausdrücklich noch einmal.
  // Zuerst aus dem Shop: Cover, Text, Seiten, Verlag, Jahr — auch ohne ISBN.
  let shopFilled = 0
  try {
    const shop = await loadShop()
    const pool = (await db.books.toArray()).filter((b) => (!ids || ids.includes(b.id)) && b.status !== 'wishlist')
    for (let i = 0; i < pool.length; i++) {
      if (shouldStop?.()) break
      const b = pool[i]
      if (!isIncomplete(b) && b.isbn13) continue
      const p = matchBook(shop, b)
      if (!p) continue
      const ch = {}
      if (!b.hasCover && p.img) {
        const blob = await dataUrlToBlob(p.img)
        if (blob) {
          ch.coverBlob = blob
          const sc = await dominantColor(blob)
          if (sc) ch.spineColor = sc
        }
      }
      if (!b.description && p.ds) ch.description = p.ds
      if (!b.pages && p.pg) ch.pages = p.pg
      if (!b.publisher && p.pub) ch.publisher = p.pub
      if (!b.year && p.y) ch.year = p.y
      if (!b.language && p.l) ch.language = p.l
      if (!b.isbn13 && p.isbn) ch.isbn13 = p.isbn
      if (Object.keys(ch).length) { await updateBook(b.id, ch); shopFilled++ }
      if (i % 20 === 19) {
        onProgress?.({ done: 0, total: pool.length, title: 'Shop', filled: shopFilled })
        await new Promise((r) => setTimeout(r, 0))
      }
    }
  } catch { /* ohne Shop-Daten geht es mit den Online-Katalogen weiter */ }

  const all = (await db.books.toArray()).filter((b) => !ids || ids.includes(b.id))
  // Alles, wo etwas Wesentliches fehlt — nicht nur Bücher ohne Cover.
  const incomplete = all.filter((b) => b.isbn13 && isIncomplete(b))
  // enrichTried merkt sich die ISBN, für die die Quellen schon einmal
  // verlässlich geantwortet haben, ohne alles liefern zu können. Solche
  // Bücher werden nicht bei jedem Durchlauf erneut gefragt. Ändert sich die
  // ISBN, gilt der Vermerk nicht mehr und das Buch kommt wieder dran.
  const missing = incomplete.filter((b) => ids || b.enrichTried !== b.isbn13)
  const skipped = incomplete.length - missing.length

  let filled = shopFilled
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
  return {
    filled, failed, skipped,
    total: missing.length, shopFilled
  }
}


/* ---------- Shop-Bücher ergänzen ---------- */

const shopTitle = (t) => String(t || '').split(/\s[-–:]\s/)[0]

/** Ergänzt die Bücher des Shops: erst aus der eigenen Bibliothek (gleicher
    Titel und Autor), dann über die Online-Kataloge per Titel und Autor.
    Gefundene ISBN, Cover, Text, Seiten, Verlag und Jahr landen in shopMeta. */
export async function enrichShopItems({ onProgress, shouldStop, retry = false, online = false } = {}) {
  const shop = await loadShop()
  const metas = new Map((await db.shopMeta.toArray()).map((m) => [m.key, m]))
  const books = (await db.books.toArray()).filter((b) => b.status !== 'wishlist')
  const items = shop.list.filter((p) => !p.c)
  let filled = 0
  let failStreak = 0 // Fehlschläge in Folge ohne Drosselung (= kein Netz): Online-Teil auslassen
  let waits = 0
  const stats = { online: 0, found: 0, errors: 0, waited: 0 }

  for (let i = 0; i < items.length; i++) {
    if (shouldStop?.()) break
    const p = items[i]
    const key = shopKey(p)
    const m = { ...(metas.get(key) || { key }) }
    const need = () =>
      (!p.img && !m.coverBlob) || (!p.ds && !m.description) || (!p.pg && !m.pages) ||
      (!p.pub && !m.publisher) || (!p.y && !m.year) || (!p.isbn && !m.isbn13)
    if (!need()) continue
    const before = JSON.stringify([m.isbn13, m.description, m.pages, m.publisher, m.year, Boolean(m.coverBlob)])

    // 1. Eigene Bibliothek
    const tk = shop.titleKey(p.t)
    const sn = shop.surname(p.a)
    const lb = books.find((b) => shop.titleKey(b.title) === tk && (!sn || shop.surname(b.authors?.[0]) === sn))
    if (lb) {
      if (!m.isbn13 && lb.isbn13) m.isbn13 = lb.isbn13
      if (!m.description && lb.description) m.description = lb.description
      if (!m.pages && lb.pages) m.pages = lb.pages
      if (!m.publisher && lb.publisher) m.publisher = lb.publisher
      if (!m.year && lb.year) m.year = lb.year
      if (!m.coverBlob && !p.img && lb.hasCover) m.coverBlob = (await db.covers.get(lb.id))?.blob || null
    }

    // 2. Online per Titel und Autor
    if (online && need() && (retry || m.tried !== 2) && failStreak < 3 && waits <= 8) {
      stats.online++
      try {
        const tAuthor = (h) => !h.authors?.length || h.authors.some((x) => shop.surname(x) === sn)
        const tTitle = (h) => {
          const hk = shop.titleKey(h.title)
          return hk === tk || (Math.min(hk.length, tk.length) >= 6 && (hk.includes(tk) || tk.includes(hk)))
        }
        const q = shopTitle(p.t)
        let good = []
        for (const attempt of [
          [`${q} ${p.a}`, p.l],
          [`${q} ${p.a}`, null],
          [`intitle:${q} inauthor:${sn}`, null]
        ]) {
          const hits = await searchBooksByText(attempt[0], { lang: attempt[1], max: 20 })
          good = hits.filter((h) => tTitle(h) && tAuthor(h))
          if (good.length) break
          await new Promise((r) => setTimeout(r, 300))
        }
        const hit = good.find((h) => h.isbn13 && h.pages) || good.find((h) => h.isbn13) || good[0]
        if (hit) {
          stats.found++
          let meta = hit
          if (hit.isbn13) {
            try { meta = { ...hit, ...Object.fromEntries(Object.entries(await lookupIsbn(hit.isbn13)).filter(([, v]) => v)) } } catch { /* Treffer reicht */ }
          }
          if (!m.isbn13 && hit.isbn13) m.isbn13 = hit.isbn13
          if (!m.description && meta.description) m.description = meta.description
          if (!m.pages && meta.pages) m.pages = meta.pages
          if (!m.publisher && meta.publisher) m.publisher = meta.publisher
          if (!m.year && meta.year) m.year = meta.year
          if (!m.coverBlob && !p.img) {
            const blob = (await fetchCoverBlob(meta.coverUrl)) || (await fetchCoverBlob(meta.fallbackCoverUrl)) || (await fetchCoverBlob(hit.thumb))
            if (blob) m.coverBlob = blob
          }
        }
        m.tried = 2
        failStreak = 0
      } catch {
        stats.errors++
        const left = Math.max(0, ...Object.values(throttleStatus()))
        if (left > 0) {
          // Gedrosselt: warten, bis die Sperre vorbei ist, und dasselbe Buch nochmal.
          waits++
          stats.waited++
          onProgress?.({ done: i, total: items.length, title: 'Shop (Pause wegen Drosselung)', filled })
          await new Promise((r) => setTimeout(r, Math.min(left, 95) * 1000 + 500))
          i--
          continue
        }
        failStreak++ // kein Netz — nach drei Fehlschlägen in Folge Online-Teil auslassen
      }
      await new Promise((r) => setTimeout(r, 900))
    }

    const after = JSON.stringify([m.isbn13, m.description, m.pages, m.publisher, m.year, Boolean(m.coverBlob)])
    if (after !== before || m.tried !== metas.get(key)?.tried) await db.shopMeta.put(m)
    if (after !== before) filled++
    if (i % 25 === 0) onProgress?.({ done: i, total: items.length, title: 'Shop', filled })
  }
  return { filled, total: items.length, stats }
}

/** Alles, was Libri zu den Shop-Büchern weiß — so, wie der Shop es einliest. */
export async function getShopMetaItems() {
  const out = []
  for (const m of await db.shopMeta.toArray()) {
    out.push({
      key: m.key,
      isbn: m.isbn13 || '',
      ds: m.description || '',
      pg: m.pages || 0,
      y: m.year || 0,
      pub: m.publisher || '',
      fl: m.files || [],
      img: m.coverBlob ? await blobToDataUrl(m.coverBlob) : ''
    })
  }
  return out
}

/** Hebt „schon versucht“ bei den Shop-Büchern auf. */
export async function resetShopTried() {
  await db.shopMeta.toCollection().modify((m) => { delete m.tried })
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
    if (b.format === 'audio') continue // Hörbücher zählen nicht als gelesene Seiten
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
    if (!book || !s.date || s.format === 'audio') continue
    logged.set(s.bookId, (logged.get(s.bookId) || 0) + (s.pages || 0))
    if (Number(s.date.slice(0, 4)) === year) months[Number(s.date.slice(5, 7)) - 1] += s.pages || 0
  }
  for (const b of books) {
    if (b.status !== 'read' || b.format === 'audio' || !b.pages || !b.finishedAt || !b.datesConfirmed) continue
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
  const rows = (await db.sessions.toArray()).filter((r) => r.format !== 'audio')
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
  const rows = (await db.sessions.where('bookId').equals(book.id).toArray()).filter((r) => r.format !== 'audio')
  if (!rows.length) return null

  const perDay = new Map()
  for (const r of rows) perDay.set(r.date, (perDay.get(r.date) || 0) + (r.pages || 0))

  const today = new Date()
  // Immer ein gleitendes Fenster: die letzten `days` Tage. Mit jedem neuen
  // Tag fällt der älteste weg — nichts wird zurückgesetzt.
  const series = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    series.push({ date: key, pages: perDay.get(key) || 0 })
  }

  const activeDays = series.map((d) => d.pages).filter((p) => p > 0)
  const perActiveDay = activeDays.length
    ? Math.round(activeDays.reduce((a, b) => a + b, 0) / activeDays.length)
    : 0

  const left = book.pages ? Math.max(0, book.pages - (book.currentPage || 0)) : null
  const daysLeft = left && perActiveDay > 0 ? Math.ceil(left / perActiveDay) : null

  return {
    series,
    perActiveDay,
    activeDays: activeDays.length,
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


/* ---------- Shop ⇄ Bibliothek ---------- */

const STATUS_RANK = { read: 5, reading: 4, owned: 3, dnf: 2, wishlist: 1 }

/** Welches Shop-Buch ist wie in der Bibliothek? Schlüssel (shopKey) → Status.
    Gemeint ist der „beste“ Status, falls ein Titel mehrfach vorkommt. */
export async function getShopLibraryStatus() {
  const shop = await loadShop()
  const out = {}
  for (const b of await db.books.toArray()) {
    const p = (b.shopKey && shop.byKey.get(b.shopKey)) || matchBook(shop, b)
    if (!p) continue
    const k = shopKey(p)
    if (!out[k] || (STATUS_RANK[b.status] || 0) > (STATUS_RANK[out[k]] || 0)) out[k] = b.status
  }
  return out
}

/** Steht ein Buch von Sarah J. Maas in der Bibliothek (nicht nur auf der Wunschliste)?
    Nur dann zeigt der Shop seine versteckten Einträge. */
export async function maasBooks() {
  const rx = /\bmaas\b/i
  const nz = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '')
  let titles = new Set()
  try {
    const shop = await loadShop()
    titles = new Set(shop.list.filter((p) => rx.test(p.a)).map((p) => nz(p.t)).filter((t) => t.length > 5))
  } catch { /* ohne Katalog nur nach Autorenfeld */ }
  return (await db.books.toArray()).filter((b) => {
    if ((b.authors || []).some((x) => rx.test(x)) || rx.test(String(b.author || ''))) return true
    const t = nz(String(b.title || '').replace(/\(.*?\)/g, ''))
    return !!t && (titles.has(t) || [...titles].some((x) => t.startsWith(x) || x.startsWith(t) && t.length > 8))
  })
}

export async function hasMaasBook() {
  return (await maasBooks()).some((b) => b.status !== 'wishlist')
}

/** Kleine Selbstauskunft für die Einstellungen: Sind Drive-Verknüpfungen da, wird der Maas-Schalter erkannt? */
export async function getDiag() {
  const books = await db.books.toArray()
  const metas = await db.shopMeta.toArray()
  const maas = await maasBooks()
  let flag = '?'
  const on = maas.some((b) => b.status !== 'wishlist')
  try { localStorage.setItem('libri:shopUnlock', on ? '1' : '0') } catch { /* egal */ }
  flag = on ? 'an' : 'aus'
  return {
    books: books.length,
    bookFiles: books.filter((b) => b.files?.length).length,
    metaFiles: metas.filter((m) => m.files?.length).length,
    maas: maas.length,
    maasOwned: maas.filter((b) => b.status !== 'wishlist').length,
    flag
  }
}

const WISH_QUEUE = 'libri:wishQ'

function splitAuthors(a) {
  return String(a || '').split(/\s+&\s+|,\s+|\s+und\s+/).map((x) => x.trim()).filter(Boolean)
}

const serPart = (g, lang) => {
  const a = String(g || '').split(' / ')
  return a.length > 1 ? (lang === 'de' ? a[0] : a[1]) : String(g || '')
}

/** Aus einem Shop-Buch ein Libri-Buch (Wunschliste) machen — mit allen Angaben. */
async function wishBookFromShop(shop, p, meta, medium, orderNo, status = 'wishlist') {
  const m = meta || {}
  const img = p.img || m.coverBlob || null
  let coverBlob = null
  if (m.coverBlob instanceof Blob) coverBlob = m.coverBlob
  else if (img) coverBlob = await dataUrlToBlob(img)
  if (!coverBlob) {
    // Cover, die der Shop schon online gefunden hat.
    try {
      const cc = JSON.parse(localStorage.getItem('covc1') || '{}')[shopKey(p)]
      const url = typeof cc === 'string' && cc ? cc : (p.iu || [])[0]
      if (url) coverBlob = await fetchCoverBlob(url)
    } catch { /* ohne Cover geht es auch */ }
  }
  const isSer = p.k === 'reihe'
  let seriesIndex = null
  let subseries = ''
  let subseriesIndex = null
  const num = parseFloat(String(p.n || '').replace('–', '-'))
  if (isSer && !p.c) {
    if (p.s) {
      subseries = serPart(p.s, p.l)
      if (Number.isFinite(num)) subseriesIndex = num
      const peers = shop.list.filter((x) => x.g === p.g && x.l === p.l && !x.c)
      const pos = peers.findIndex((x) => x === p)
      if (pos >= 0) seriesIndex = pos + 1
    } else if (Number.isFinite(num)) seriesIndex = num
  }
  const isbn = String(p.isbn || m.isbn13 || '').replace(/[^0-9X]/gi, '')
  const book = {
    title: p.t,
    authors: splitAuthors(p.a),
    series: isSer ? serPart(p.g, p.l) : '',
    seriesIndex,
    subseries,
    subseriesIndex,
    language: p.l || '',
    isbn13: isbn.length === 13 ? isbn : null,
    description: p.ds || m.description || '',
    pages: p.pg || m.pages || null,
    publisher: p.pub || m.publisher || '',
    year: p.y || m.year || null,
    tags: [...new Set([p.ge, ...(p.gx || []), p.c ? 'Sammelband' : ''].filter(Boolean))],
    format: medium === 'b' ? 'print' : 'ebook',
    status,
    source: 'shop',
    shopKey: shopKey(p),
    notes: orderNo ? `Aus Shop-Bestellung ${orderNo} (${medium === 'b' ? 'Buch' : 'eBook'})` : '',
    coverBlob
  }
  if (coverBlob) {
    const sc = await dominantColor(coverBlob)
    if (sc) book.spineColor = sc
  }
  return book
}

let flushing = null

/** Legt alles, was im Shop bestellt wurde, auf die Wunschliste. Der Shop merkt
    sich seine Bestellungen in einer Warteschlange (localStorage), damit nichts
    verloren geht, auch wenn Libri gerade nicht offen war. Was schon in der
    Bibliothek steht — egal mit welchem Status — wird nicht noch einmal angelegt. */
export function flushShopOrders() {
  if (flushing) return flushing
  flushing = (async () => {
    let queue = []
    try { queue = JSON.parse(localStorage.getItem(WISH_QUEUE) || '[]') } catch { queue = [] }
    if (!Array.isArray(queue) || !queue.length) return { added: 0, skipped: 0 }
    try { localStorage.removeItem(WISH_QUEUE) } catch { /* egal */ }
    const rest = []
    const shelfIds = []
    let added = 0
    let skipped = 0
    try {
      const shop = await loadShop()
      const have = await getShopLibraryStatus()
      const done = new Set()
      for (const q of queue) {
        const p = shop.byKey.get(q.k)
        if (!p) continue
        const st = q.st === 'owned' ? 'owned' : 'wishlist'
        // Schon im Regal, oder auf der Wunschliste und nur Wunschliste verlangt: nichts zu tun.
        if (done.has(q.k) || (have[q.k] && !(st === 'owned' && have[q.k] === 'wishlist'))) { skipped++; continue }
        done.add(q.k)
        try {
          if (have[q.k] === 'wishlist') {
            // Von der Wunschliste ins Regal.
            const ids = (await db.books.toArray())
              .filter((b) => b.status === 'wishlist' && ((b.shopKey && b.shopKey === q.k) || matchBook(shop, b) === p))
              .map((b) => b.id)
            for (const id of ids) await db.books.update(id, { status: 'owned' })
            shelfIds.push(...ids)
            added += ids.length ? 1 : 0
            continue
          }
          const meta = await db.shopMeta.get(q.k)
          const nid = await addBook(await wishBookFromShop(shop, p, meta, q.m, q.no, st))
          if (st === 'owned') shelfIds.push(nid)
          added++
        } catch { rest.push(q) }
      }
    } catch {
      rest.push(...queue)
    }
    if (rest.length) {
      try {
        const cur = JSON.parse(localStorage.getItem(WISH_QUEUE) || '[]')
        localStorage.setItem(WISH_QUEUE, JSON.stringify([...rest, ...cur].slice(0, 300)))
      } catch { /* egal */ }
    }
    // Fürs Regal: fehlende Angaben (Seiten, Verlag, Text, Cover …) im Hintergrund suchen.
    if (shelfIds.length) setTimeout(() => { enrichShelfBooks(shelfIds).catch(() => {}) }, 0)
    return { added, skipped }
  })().finally(() => { flushing = null })
  return flushing
}


/** Fehlende Angaben für einzelne Bücher suchen — wie „Angaben ergänzen“ in den
    Einstellungen: erst Shop-Daten und ISBN-Kataloge, dann bei fehlender ISBN
    per Titel und Autor online. */
export async function enrichShelfBooks(ids) {
  try { await backfillCovers({ ids }) } catch { /* weiter mit der Titelsuche */ }
  const shop = await loadShop().catch(() => null)
  for (const id of ids) {
    let b = await db.books.get(id)
    if (!b || !isIncomplete(b)) continue
    try {
      const au = String(b.authors?.[0] || '')
      const sn = shop ? shop.surname(au) : au.split(' ').pop().toLowerCase()
      const tk = shop ? shop.titleKey(b.title) : b.title.toLowerCase()
      const q = shopTitle(b.title)
      let good = []
      for (const [text, lang] of [[`${q} ${au}`, b.language], [`${q} ${au}`, null], [`intitle:${q} inauthor:${sn}`, null]]) {
        const hits = await searchBooksByText(text, { lang: lang || null, max: 20 })
        good = hits.filter((h) => {
          const hk = shop ? shop.titleKey(h.title) : String(h.title).toLowerCase()
          const titleOk = hk === tk || (Math.min(hk.length, tk.length) >= 6 && (hk.includes(tk) || tk.includes(hk)))
          const authOk = !h.authors?.length || h.authors.some((x) => (shop ? shop.surname(x) : x.split(' ').pop().toLowerCase()) === sn)
          return titleOk && authOk
        })
        if (good.length) break
        await new Promise((r) => setTimeout(r, 300))
      }
      const hit = good.find((h) => h.isbn13 && h.pages) || good.find((h) => h.isbn13) || good[0]
      if (!hit) continue
      let meta = hit
      if (hit.isbn13) {
        try { meta = { ...hit, ...Object.fromEntries(Object.entries(await lookupIsbn(hit.isbn13)).filter(([, v]) => v)) } } catch { /* Treffer reicht */ }
      }
      const ch = {}
      if (!b.isbn13 && hit.isbn13) ch.isbn13 = hit.isbn13
      if (!b.description && meta.description) ch.description = meta.description
      if (!b.pages && meta.pages) ch.pages = meta.pages
      if (!b.publisher && meta.publisher) ch.publisher = meta.publisher
      if (!b.year && meta.year) ch.year = meta.year
      if (!b.hasCover) {
        const blob = (await fetchCoverBlob(meta.coverUrl)) || (await fetchCoverBlob(meta.fallbackCoverUrl)) || (await fetchCoverBlob(hit.thumb))
        if (blob) {
          ch.coverBlob = blob
          const sc = await dominantColor(blob)
          if (sc) ch.spineColor = sc
        }
      }
      if (Object.keys(ch).length) await updateBook(id, ch)
    } catch { /* nächstes Buch */ }
    await new Promise((r) => setTimeout(r, 350))
  }
}
