/* ISBN-Werkzeuge und Metadaten-Abruf.

   Vier Quellen werden gleichzeitig gefragt und feldweise zusammengeführt:
   Google Books (zuverlässig bei Seitenzahl, Sprache, Genre), die beiden
   getrennten Open-Library-Schnittstellen (unterschiedliche Datenbestände,
   CORS-fähige Cover) und Apple Books (deckt Selfpublishing ab).
   Ergebnisse werden zwischengespeichert, damit dasselbe Buch nicht zweimal
   durchs Netz muss. */

import { readCache, writeCache } from './cache'

export function cleanIsbn(input) {
  return String(input || '').replace(/[^0-9Xx]/g, '').toUpperCase()
}

function isbn10Valid(s) {
  if (!/^\d{9}[\dX]$/.test(s)) return false
  let sum = 0
  for (let i = 0; i < 10; i++) {
    const c = s[i]
    sum += (c === 'X' ? 10 : Number(c)) * (10 - i)
  }
  return sum % 11 === 0
}

function isbn13Valid(s) {
  if (!/^\d{13}$/.test(s)) return false
  let sum = 0
  for (let i = 0; i < 13; i++) sum += Number(s[i]) * (i % 2 === 0 ? 1 : 3)
  return sum % 10 === 0
}

export function toIsbn13(input) {
  const s = cleanIsbn(input)
  if (isbn13Valid(s) && /^97[89]/.test(s)) return s
  if (isbn10Valid(s)) {
    const core = '978' + s.slice(0, 9)
    let sum = 0
    for (let i = 0; i < 12; i++) sum += Number(core[i]) * (i % 2 === 0 ? 1 : 3)
    return core + String((10 - (sum % 10)) % 10)
  }
  return null
}

/** Rückrichtung: ISBN-13 mit 978er-Präfix zurück nach ISBN-10.
    Viele Katalogeinträge sind nur unter der alten Form auffindbar, weshalb
    beide Schreibweisen abgefragt werden müssen. */
export function toIsbn10(input) {
  const s = cleanIsbn(input)
  if (isbn10Valid(s)) return s
  if (!isbn13Valid(s) || !s.startsWith('978')) return null
  const core = s.slice(3, 12)
  let sum = 0
  for (let i = 0; i < 9; i++) sum += Number(core[i]) * (10 - i)
  const check = (11 - (sum % 11)) % 11
  return core + (check === 10 ? 'X' : String(check))
}

/** Ist das ein Buch-Barcode? Bücher beginnen mit 978 oder 979. */
export function isBookBarcode(code) {
  const s = cleanIsbn(code)
  return s.length === 13 && /^97[89]/.test(s) && isbn13Valid(s)
}

const LANG_NAMES = {
  de: 'Deutsch', en: 'Englisch', fr: 'Französisch', es: 'Spanisch',
  it: 'Italienisch', nl: 'Niederländisch', sv: 'Schwedisch', da: 'Dänisch',
  no: 'Norwegisch', fi: 'Finnisch', pl: 'Polnisch', pt: 'Portugiesisch',
  ru: 'Russisch', ja: 'Japanisch', tr: 'Türkisch', cs: 'Tschechisch',
  la: 'Latein', el: 'Griechisch', zh: 'Chinesisch', ko: 'Koreanisch'
}

export function languageName(code) {
  if (!code) return ''
  const c = code.slice(0, 2).toLowerCase()
  return LANG_NAMES[c] || code.toUpperCase()
}

const OL_LANG = {
  ger: 'de', eng: 'en', fre: 'fr', spa: 'es', ita: 'it', dut: 'nl',
  swe: 'sv', dan: 'da', nor: 'no', fin: 'fi', pol: 'pl', por: 'pt',
  rus: 'ru', jpn: 'ja', tur: 'tr', cze: 'cs', lat: 'la', gre: 'el',
  chi: 'zh', kor: 'ko'
}

async function fetchJson(url, timeout = 6500) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeout)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

function yearFrom(str) {
  const m = String(str || '').match(/\d{4}/)
  return m ? Number(m[0]) : null
}

async function fromGoogle(isbn, isbn10) {
  // Google indexiert manche Ausgaben nur unter einer der beiden Schreibweisen,
  // und der Markt-Parameter ändert die Trefferlage für deutsche Titel spürbar.
  const tries = [
    `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&country=DE&maxResults=1`,
    isbn10 && `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn10}&country=DE&maxResults=1`,
    `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&maxResults=1`
  ].filter(Boolean)

  for (const url of tries) {
    const data = await fetchJson(url)
    const v = data?.items?.[0]?.volumeInfo
    if (!v) continue
    const img = v.imageLinks || {}
    const cover =
      img.extraLarge || img.large || img.medium || img.thumbnail || img.smallThumbnail
    return {
      title: v.title || '',
      subtitle: v.subtitle || '',
      authors: v.authors || [],
      publisher: v.publisher || '',
      year: yearFrom(v.publishedDate),
      pages: v.pageCount || null,
      language: v.language || '',
      coverUrl: cover ? cover.replace(/^http:/, 'https:').replace('&edge=curl', '') : null,
      categories: (v.categories || []).slice(0, 2).map((c) => c.split('/').pop().trim()),
      source: 'Google Books'
    }
  }
  return null
}

/* Dritter Open-Library-Weg: der Ausgaben-Datensatz. Wieder ein anderer
   Bestand als die beiden übrigen — manche Bücher stehen nur hier. */
async function fromOpenLibraryEdition(isbn) {
  const data = await fetchJson(`https://openlibrary.org/isbn/${isbn}.json`)
  if (!data?.title) return null
  return {
    title: data.title || '',
    subtitle: data.subtitle || '',
    publisher: (data.publishers || [])[0] || '',
    year: yearFrom(data.publish_date),
    pages: data.number_of_pages || null,
    language: OL_LANG[(data.languages?.[0]?.key || '').split('/').pop()] || '',
    coverUrl: data.covers?.[0]
      ? `https://covers.openlibrary.org/b/id/${data.covers[0]}-L.jpg`
      : null,
    source: 'Open Library'
  }
}

async function fromOpenLibrary(isbn) {
  const data = await fetchJson(
    `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`
  )
  const v = data?.[`ISBN:${isbn}`]
  if (!v) return null
  return {
    title: v.title || '',
    subtitle: v.subtitle || '',
    authors: (v.authors || []).map((a) => a.name).filter(Boolean),
    publisher: (v.publishers || []).map((p) => p.name).filter(Boolean)[0] || '',
    year: yearFrom(v.publish_date),
    pages: v.number_of_pages || null,
    language: OL_LANG[(v.languages?.[0]?.key || '').split('/').pop()] || '',
    coverUrl: v.cover?.large || v.cover?.medium || null,
    source: 'Open Library'
  }
}

/* Open Library hat zwei getrennte Schnittstellen mit unterschiedlichem
   Datenbestand. Diese hier kennt oft eine Seitenzahl, wenn die andere nichts
   weiß, und liefert zusätzlich Genre-Angaben. */
async function fromOpenLibrarySearch(isbn) {
  const data = await fetchJson(
    `https://openlibrary.org/search.json?isbn=${isbn}&limit=1&fields=title,author_name,first_publish_year,number_of_pages_median,language,publisher,subject,cover_i`
  )
  const d = data?.docs?.[0]
  if (!d) return null
  return {
    title: d.title || '',
    authors: d.author_name || [],
    publisher: (d.publisher || [])[0] || '',
    year: d.first_publish_year || null,
    pages: d.number_of_pages_median || null,
    language: OL_LANG[(d.language || [])[0]] || '',
    coverUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : null,
    categories: (d.subject || []).slice(0, 2),
    source: 'Open Library'
  }
}

/* Apple Books als dritte Quelle. Deckt vor allem Selfpublishing-Titel ab,
   bei denen Open Library und Google oft nichts haben. Die Bilder-URL lässt
   sich von 100px auf 600px hochdrehen. */
async function fromApple({ isbn, title, authors }) {
  let data = isbn ? await fetchJson(`https://itunes.apple.com/lookup?isbn=${isbn}`) : null
  // Titelsuche nur, wenn ein Titel bekannt ist — beim ersten Durchgang ist er
  // das noch nicht, dann bleibt es bei der ISBN-Abfrage.
  if (!data?.results?.length && title) {
    const term = encodeURIComponent(`${title} ${authors?.[0] || ''}`.trim())
    data = await fetchJson(`https://itunes.apple.com/search?term=${term}&entity=ebook&limit=1`)
  }
  const r = data?.results?.[0]
  if (!r) return null
  return {
    title: r.trackName || '',
    coverUrl: r.artworkUrl100
      ? r.artworkUrl100.replace(/\/\d+x\d+bb\./, '/600x600bb.')
      : null,
    year: yearFrom(r.releaseDate),
    authors: r.artistName ? [r.artistName] : []
  }
}

/* Wenn die ISBN-Suche Lücken lässt, nochmal über Titel und Autor suchen —
   oft ist dieselbe Ausgabe unter einer anderen ISBN vollständiger erfasst. */
async function byTitle(title, author) {
  if (!title) return null
  const q = encodeURIComponent(`intitle:${title}${author ? ` inauthor:${author}` : ''}`)
  const data = await fetchJson(`https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=3`)
  const hit = (data?.items || [])
    .map((i) => i.volumeInfo)
    .find((v) => v?.pageCount || v?.language)
  if (!hit) return null
  const img = hit.imageLinks || {}
  return {
    pages: hit.pageCount || null,
    language: hit.language || '',
    publisher: hit.publisher || '',
    coverUrl: (img.large || img.medium || img.thumbnail || '')
      .replace(/^http:/, 'https:')
      .replace('&edge=curl', '') || null
  }
}

/** Wie fetchJson, meldet Fehler aber statt sie zu verschlucken — für Abfragen,
    bei denen "nichts gefunden" und "Anfrage fehlgeschlagen" nicht dasselbe sein dürfen. */
async function fetchJsonStrict(url, timeout = 8000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeout)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`Antwort ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(t)
  }
}

/** Suche nach Titel/Autor statt ISBN — für Bücher ohne Barcode zur Hand. */
export async function searchBooksByText(query) {
  const q = query.trim()
  if (!q) return []

  let data
  try {
    data = await fetchJsonStrict(
      `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=12&printType=books`
    )
  } catch {
    throw new Error('Die Suche war nicht erreichbar. Nochmal versuchen?')
  }

  const items = data?.items || []
  const mapped = items
    .map((it) => {
      const v = it.volumeInfo || {}
      const ids = v.industryIdentifiers || []
      const rawIsbn =
        ids.find((i) => i.type === 'ISBN_13')?.identifier ||
        ids.find((i) => i.type === 'ISBN_10')?.identifier
      const img = v.imageLinks || {}
      const cover = img.thumbnail || img.smallThumbnail || null
      return {
        key: it.id,
        isbn13: rawIsbn ? toIsbn13(rawIsbn) : null,
        title: v.title || '',
        subtitle: v.subtitle || '',
        authors: v.authors || [],
        year: yearFrom(v.publishedDate),
        pages: v.pageCount || null,
        language: v.language || '',
        publisher: v.publisher || '',
        categories: (v.categories || []).slice(0, 2).map((c) => c.split('/').pop().trim()),
        thumb: cover ? cover.replace(/^http:/, 'https:') : null,
        coverUrl: (img.large || img.medium || img.thumbnail || '')
          .replace(/^http:/, 'https:')
          .replace('&edge=curl', '') || null
      }
    })
    .filter((b) => b.title)

  // Dieselbe Ausgabe taucht oft mehrfach auf. Pro Titel+Autor nur den
  // vollständigsten Treffer behalten.
  const best = new Map()
  const score = (b) =>
    (b.thumb ? 4 : 0) + (b.pages ? 3 : 0) + (b.isbn13 ? 2 : 0) + (b.year ? 1 : 0)

  for (const b of mapped) {
    const id = `${b.title.toLowerCase()}|${(b.authors[0] || '').toLowerCase()}`
    const prev = best.get(id)
    if (!prev || score(b) > score(prev)) best.set(id, b)
  }

  // Vollständige Treffer zuerst — mit Cover und Seitenzahl sind sie sofort
  // brauchbar, ohne dass etwas nachgetragen werden muss.
  return [...best.values()].sort((a, b) => score(b) - score(a))
}

function pick(...vals) {
  for (const v of vals) {
    if (Array.isArray(v) ? v.length : v !== null && v !== undefined && v !== '') return v
  }
  return Array.isArray(vals[0]) ? [] : null
}

/** Führt mehrere Quellergebnisse feldweise zusammen, in Reihenfolge ihrer
    Verlässlichkeit für das jeweilige Feld. */
function mergeSources({ google, olBooks, olSearch, olEdition, apple }) {
  const g = google || {}
  const ob = olBooks || {}
  const os = olSearch || {}
  const oe = olEdition || {}
  const a = apple || {}

  return {
    title: pick(g.title, ob.title, oe.title, os.title, a.title) || '',
    subtitle: pick(g.subtitle, ob.subtitle, oe.subtitle) || '',
    authors: pick(g.authors, ob.authors, os.authors, a.authors) || [],
    publisher: pick(g.publisher, ob.publisher, oe.publisher, os.publisher) || '',
    year: pick(g.year, ob.year, oe.year, os.year, a.year),
    // Seitenzahl: Google zuerst, dann alle drei Open-Library-Wege
    pages: pick(g.pages, ob.pages, oe.pages, os.pages),
    language: pick(g.language, ob.language, oe.language, os.language) || '',
    // Cover: Open Library zuerst, weil nur die CORS-Header liefert und sich
    // damit als Datei für die Offline-Nutzung speichern lässt.
    coverUrl: pick(ob.coverUrl, oe.coverUrl, os.coverUrl, g.coverUrl, a.coverUrl),
    categories: pick(g.categories, os.categories) || []
  }
}

/**
 * Fragt alle Quellen gleichzeitig ab.
 * onPartial wird aufgerufen, sobald die erste Quelle einen Titel liefert —
 * damit sich das Formular schon öffnen kann, während der Rest noch läuft.
 */
export async function lookupIsbn(rawIsbn, { onPartial } = {}) {
  const isbn = toIsbn13(rawIsbn)
  if (!isbn) throw new Error('Diese ISBN ist ungültig.')

  const cached = readCache(isbn)
  if (cached) return { ...cached, fromCache: true }

  const isbn10 = toIsbn10(isbn)
  const results = { google: null, olBooks: null, olSearch: null, olEdition: null, apple: null }
  const found = { google: false, olBooks: false, olSearch: false, olEdition: false, apple: false }
  let announced = false

  // Sobald irgendeine Quelle einen Titel hat, Zwischenstand melden.
  const announce = () => {
    if (announced || !onPartial) return
    const partial = mergeSources(results)
    if (!partial.title) return
    announced = true
    onPartial({ ...partial, isbn13: isbn })
  }

  const track = (key, promise) =>
    promise.then((r) => {
      results[key] = r
      found[key] = Boolean(r)
      announce()
      return r
    })

  // Alle gleichzeitig — keine zweite Runde mehr, dadurch bestimmt die
  // langsamste Quelle die Gesamtdauer statt der Summe aller Quellen.
  await Promise.all([
    track('google', fromGoogle(isbn, isbn10)),
    track('olBooks', fromOpenLibrary(isbn)),
    track('olSearch', fromOpenLibrarySearch(isbn)),
    track('olEdition', fromOpenLibraryEdition(isbn)),
    track('apple', fromApple({ isbn }))
  ])

  const merged = mergeSources(results)
  if (!merged.title) return { isbn13: isbn, notFound: true }

  const sources = []
  if (found.google) sources.push('Google Books')
  if (found.olBooks || found.olSearch || found.olEdition) sources.push('Open Library')
  if (found.apple) sources.push('Apple Books')

  // Letzter Ausweg, nur wenn wirklich noch etwas Wesentliches fehlt: dieselbe
  // Ausgabe ist unter einer anderen ISBN oft vollständiger erfasst.
  if (!merged.pages || !merged.coverUrl) {
    const extra = await byTitle(merged.title, merged.authors[0])
    if (extra) {
      merged.pages = merged.pages || extra.pages
      merged.language = merged.language || extra.language
      merged.publisher = merged.publisher || extra.publisher
      merged.coverUrl = merged.coverUrl || extra.coverUrl
      if (extra.pages) sources.push('Titelsuche')
    }
  }

  const final = {
    ...merged,
    isbn13: isbn,
    fallbackCoverUrl: `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`,
    source: sources.join(' + ')
  }
  writeCache(isbn, final)
  return final
}

/** Lädt das Cover herunter, damit es offline verfügbar ist. Scheitert still. */
export async function fetchCoverBlob(url) {
  if (!url) return null
  try {
    const res = await fetch(url, { mode: 'cors' })
    if (!res.ok) return null
    const blob = await res.blob()
    if (!blob.type.startsWith('image/') || blob.size < 800) return null
    return blob
  } catch {
    return null
  }
}

/** Mittlere Farbe des Covers — später die Farbe des Buchrückens im Regal. */
export async function dominantColor(blob) {
  if (!blob) return null
  try {
    const bitmap = await createImageBitmap(blob)
    const size = 12
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(bitmap, 0, 0, size, size)
    const { data } = ctx.getImageData(0, 0, size, size)
    let r = 0, g = 0, b = 0, n = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++
    }
    if (!n) return null
    const hex = (x) => Math.round(x / n).toString(16).padStart(2, '0')
    bitmap.close?.()
    return `#${hex(r)}${hex(g)}${hex(b)}`
  } catch {
    return null
  }
}
