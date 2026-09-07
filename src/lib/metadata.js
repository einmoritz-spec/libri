/* ISBN-Werkzeuge und Metadaten-Abruf.
   Zwei Quellen werden parallel gefragt und feldweise zusammengeführt:
   Google Books ist bei Seitenzahl und Sprache zuverlässiger,
   Open Library liefert die besseren Cover. */

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

async function fromGoogle(isbn) {
  const data = await fetchJson(
    `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&maxResults=1`
  )
  const v = data?.items?.[0]?.volumeInfo
  if (!v) return null
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
    source: 'Google Books'
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

/* Apple Books als dritte Quelle. Deckt vor allem Selfpublishing-Titel ab,
   bei denen Open Library und Google oft nichts haben. Die Bilder-URL lässt
   sich von 100px auf 600px hochdrehen. */
async function fromApple({ isbn, title, authors }) {
  let data = await fetchJson(`https://itunes.apple.com/lookup?isbn=${isbn}`)
  if (!data?.results?.length && title) {
    const term = encodeURIComponent(`${title} ${authors?.[0] || ''}`.trim())
    data = await fetchJson(`https://itunes.apple.com/search?term=${term}&entity=ebook&limit=1`)
  }
  const r = data?.results?.[0]
  if (!r) return null
  return {
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

function pick(...vals) {
  for (const v of vals) {
    if (Array.isArray(v) ? v.length : v !== null && v !== undefined && v !== '') return v
  }
  return Array.isArray(vals[0]) ? [] : null
}

/** Fragt beide Quellen und führt sie zusammen. Gibt null zurück, wenn nichts gefunden wurde. */
export async function lookupIsbn(rawIsbn) {
  const isbn = toIsbn13(rawIsbn)
  if (!isbn) throw new Error('Diese ISBN ist ungültig.')

  const [google, ol] = await Promise.all([fromGoogle(isbn), fromOpenLibrary(isbn)])
  if (!google && !ol) return { isbn13: isbn, notFound: true }

  const g = google || {}
  const o = ol || {}
  const sources = [google && 'Google Books', ol && 'Open Library'].filter(Boolean)

  const merged = {
    isbn13: isbn,
    title: pick(g.title, o.title) || '',
    subtitle: pick(g.subtitle, o.subtitle) || '',
    authors: pick(g.authors, o.authors) || [],
    publisher: pick(g.publisher, o.publisher) || '',
    year: pick(g.year, o.year),
    pages: pick(g.pages, o.pages),
    language: pick(g.language, o.language) || '',
    // Open-Library-Cover zuerst: liefert CORS-Header, also offline speicherbar.
    coverUrl: pick(o.coverUrl, g.coverUrl)
  }

  // Zweite Runde nur für das, was noch fehlt — beide Anfragen gleichzeitig,
  // damit die Wartezeit nicht Quelle für Quelle aufsummiert.
  const needsExtra = !merged.pages || !merged.language || !merged.publisher
  const needsCover = !merged.coverUrl

  const [extra, apple] = await Promise.all([
    needsExtra ? byTitle(merged.title, merged.authors[0]) : null,
    needsCover ? fromApple({ isbn, title: merged.title, authors: merged.authors }) : null
  ])

  if (extra) {
    merged.pages = merged.pages || extra.pages
    merged.language = merged.language || extra.language
    merged.publisher = merged.publisher || extra.publisher
    merged.coverUrl = merged.coverUrl || extra.coverUrl
    if (extra.pages || extra.language) sources.push('Titelsuche')
  }
  if (apple?.coverUrl && !merged.coverUrl) {
    merged.coverUrl = apple.coverUrl
    sources.push('Apple Books')
  }

  return {
    ...merged,
    fallbackCoverUrl: `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`,
    source: sources.join(' + ')
  }
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
