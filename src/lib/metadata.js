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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Holt JSON und unterscheidet dabei zwei Dinge, die vorher gleich aussahen:
 * "Die Quelle kennt das Buch nicht" und "Die Anfrage ist schiefgegangen".
 * Letzteres wird wiederholt — vor allem Drosselung (429) und Serverfehler
 * treten sporadisch auf und sorgten sonst dafür, dass dasselbe Buch mal
 * gefunden wurde und mal nicht.
 *
 * ctx.failures zählt endgültig fehlgeschlagene Anfragen. Wichtig: pro Quelle
 * ein eigener Zähler (siehe lookupIsbn) — sonst würde eine einzelne dauerhaft
 * blockierte Quelle jede Abfrage als "fehlgeschlagen" erscheinen lassen.
 */
async function fetchJson(url, ctx = null, { timeout = 6500, attempts = 3 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeout)
    try {
      const res = await fetch(url, { signal: ctrl.signal })
      clearTimeout(t)

      if (res.ok) return await res.json()

      // 404 heißt wirklich "kennt das Buch nicht" — nicht wiederholen.
      if (res.status === 404) return null

      // Drosselung und Serverfehler: kurz warten und nochmal.
      if (res.status === 429 || res.status >= 500) {
        if (attempt < attempts) {
          await sleep(400 * attempt + Math.random() * 200)
          continue
        }
        if (ctx) ctx.failures++
        return null
      }
      return null
    } catch {
      clearTimeout(t)
      if (attempt < attempts) {
        await sleep(300 * attempt)
        continue
      }
      if (ctx) ctx.failures++
      return null
    }
  }
  return null
}

function yearFrom(str) {
  const m = String(str || '').match(/\d{4}/)
  return m ? Number(m[0]) : null
}

/* Google Books und Open Library liefern Genres grundsätzlich auf Englisch.
   Feste Übersetzungstabelle statt Vermutung — was nicht eindeutig übersetzbar
   ist, wird verworfen statt englisch angezeigt. Die Reihenfolge, die geprüft
   wird, geht vom Speziellsten zum Allgemeinsten (siehe translateCategory). */
const CATEGORY_DE = {
  fiction: 'Belletristik', 'non-fiction': 'Sachbuch', nonfiction: 'Sachbuch',
  fantasy: 'Fantasy', 'science fiction': 'Science-Fiction', 'sci-fi': 'Science-Fiction',
  'space opera': 'Space Opera', cyberpunk: 'Cyberpunk', 'cyberpunk fiction': 'Cyberpunk',
  steampunk: 'Steampunk', 'steampunk fiction': 'Steampunk',
  dystopian: 'Dystopie', dystopias: 'Dystopie', 'post-apocalyptic': 'Postapokalyptisch',
  'time travel': 'Zeitreise', 'alternative histories (fiction)': 'Alternativgeschichte',
  'urban fantasy': 'Urban Fantasy', 'paranormal fiction': 'Paranormal', paranormal: 'Paranormal',
  superheroes: 'Superhelden', epic: 'Epos', 'sword and sorcery fiction': 'Sword & Sorcery',
  'fairy tales': 'Märchen', mythology: 'Mythologie',
  mystery: 'Krimi', 'mystery & detective': 'Krimi', detective: 'Krimi', crime: 'Krimi',
  'true crime': 'True Crime', thriller: 'Thriller', suspense: 'Spannung', horror: 'Horror',
  romance: 'Liebesroman', 'historical fiction': 'Historischer Roman', historical: 'Historisch',
  history: 'Geschichte', 'literary fiction': 'Literatur', 'literary criticism': 'Literaturkritik',
  literature: 'Literatur', classics: 'Klassiker',
  'young adult fiction': 'Jugendbuch', 'young adult nonfiction': 'Jugendsachbuch',
  'juvenile fiction': 'Kinderbuch', 'juvenile nonfiction': 'Kindersachbuch',
  "children's fiction": 'Kinderbuch', 'picture books': 'Bilderbuch',
  'biography & autobiography': 'Biografie', biography: 'Biografie', autobiography: 'Autobiografie',
  memoir: 'Memoiren', essays: 'Essays', poetry: 'Lyrik', drama: 'Drama', humor: 'Humor',
  'comics & graphic novels': 'Comic', 'graphic novels': 'Graphic Novel', comics: 'Comic',
  'short stories': 'Kurzgeschichten', anthologies: 'Anthologie',
  western: 'Western', war: 'Krieg', 'war & military fiction': 'Kriegsroman', military: 'Militär',
  'action & adventure': 'Action & Abenteuer', adventure: 'Abenteuer', 'adventure fiction': 'Abenteuer',
  political: 'Politik', 'political science': 'Politikwissenschaft', philosophy: 'Philosophie',
  religion: 'Religion', 'self-help': 'Ratgeber',
  'business & economics': 'Wirtschaft', economics: 'Wirtschaft',
  science: 'Wissenschaft', technology: 'Technik', 'technology & engineering': 'Technik',
  nature: 'Natur', travel: 'Reise', cooking: 'Kochen', art: 'Kunst', music: 'Musik',
  'sports & recreation': 'Sport', 'health & fitness': 'Gesundheit', psychology: 'Psychologie',
  education: 'Bildung', reference: 'Nachschlagewerk',
  'family & relationships': 'Familie & Beziehungen', 'social science': 'Sozialwissenschaft',
  'body, mind & spirit': 'Körper, Geist & Seele', games: 'Spiele', 'games & activities': 'Spiele',
  computers: 'Computer', medical: 'Medizin', law: 'Recht', general: 'Allgemein'
}

/** Übersetzt eine einzelne Kategorie. Google liefert Hierarchien mit "/"
    getrennt (spezifisch am Ende), Open Library oft mit Komma oder "--".
    Von speziell nach allgemein geprüft, erster Treffer gewinnt; nichts
    Passendes gefunden heißt: verwerfen statt englisch anzeigen. */
function translateCategory(raw) {
  const parts = String(raw || '')
    .split(/\/|--|,/)
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean)
    .reverse()
  for (const p of parts) {
    if (CATEGORY_DE[p]) return CATEGORY_DE[p]
  }
  return null
}

/** Wandelt eine Liste roher Kategorie-Strings in deutsche Schlagwörter um,
    ohne Duplikate und ohne unübersetzten englischen Text. */
function translateCategories(raw, max = 2) {
  const out = []
  for (const r of raw || []) {
    const de = translateCategory(r)
    if (de && !out.includes(de)) out.push(de)
    if (out.length >= max) break
  }
  return out
}

async function fromGoogle(isbn, isbn10, ctx) {
  // Drei Anläufe: beide ISBN-Schreibweisen gezielt, dann die ISBN als
  // Freitext. Letzteres findet Ausgaben, die zwar erfasst sind, deren ISBN
  // aber nicht im dafür vorgesehenen Feld steht — gar nicht so selten.
  const tries = [
    `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&maxResults=1`,
    isbn10 && `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn10}&maxResults=1`,
    `https://www.googleapis.com/books/v1/volumes?q=${isbn}&maxResults=3`
  ].filter(Boolean)

  for (const url of tries) {
    const data = await fetchJson(url, ctx)
    const items = data?.items || []
    if (!items.length) continue

    // Bei der Freitextsuche können mehrere Bücher zurückkommen. Denjenigen
    // Eintrag nehmen, der die gesuchte ISBN wirklich führt; sonst den ersten.
    const matching = items.find((it) =>
      (it.volumeInfo?.industryIdentifiers || []).some(
        (i) => i.identifier === isbn || i.identifier === isbn10
      )
    )
    const v = (matching || items[0]).volumeInfo
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
      categories: translateCategories(v.categories),
      source: 'Google Books'
    }
  }
  return null
}

/* Dritter Open-Library-Weg: der Ausgaben-Datensatz. Wieder ein anderer
   Bestand als die beiden übrigen — manche Bücher stehen nur hier. */
/** Open Library trägt Reihen uneinheitlich ein — "Mistborn -- bk. 3",
    "Mistborn ; 3", "Stormlight Archive #3". Nur übernehmen, wenn sich Name
    und Bandnummer eindeutig trennen lassen; bei Unsicherheit lieber leer
    lassen, als etwas Falsches einzutragen. */
function parseSeries(raw) {
  const s = String(raw?.[0] || '').trim()
  if (!s) return null
  const m = s.match(/^(.+?)\s*(?:--|;|,|#)\s*(?:bk\.?|book|vol\.?|volume|band|#)?\s*(\d+(?:\.\d+)?)\s*$/i)
  if (!m) return null
  const name = m[1].trim()
  const index = Number(m[2])
  if (!name || Number.isNaN(index)) return null
  return { series: name, seriesIndex: index }
}

async function fromOpenLibraryEdition(isbn, isbn10, ctx) {
  // Viele Datensätze sind dort nur unter der zehnstelligen Form abgelegt.
  let data = await fetchJson(`https://openlibrary.org/isbn/${isbn}.json`, ctx)
  if (!data?.title && isbn10) {
    data = await fetchJson(`https://openlibrary.org/isbn/${isbn10}.json`, ctx)
  }
  if (!data?.title) return null
  const series = parseSeries(data.series)
  return {
    title: data.title || '',
    subtitle: data.subtitle || '',
    publisher: (data.publishers || [])[0] || '',
    year: yearFrom(data.publish_date),
    pages: data.number_of_pages || null,
    language: OL_LANG[(data.languages?.[0]?.key || '').split('/').pop()] || '',
    series: series?.series || '',
    seriesIndex: series?.seriesIndex ?? null,
    coverUrl: data.covers?.[0]
      ? `https://covers.openlibrary.org/b/id/${data.covers[0]}-L.jpg`
      : null,
    source: 'Open Library'
  }
}

async function fromOpenLibrary(isbn, isbn10, ctx) {
  // Beide Schreibweisen in einer Anfrage — die Schnittstelle nimmt mehrere.
  const keys = [`ISBN:${isbn}`, isbn10 && `ISBN:${isbn10}`].filter(Boolean)
  const data = await fetchJson(
    `https://openlibrary.org/api/books?bibkeys=${keys.join(',')}&format=json&jscmd=data`,
    ctx
  )
  const v = data?.[`ISBN:${isbn}`] || (isbn10 && data?.[`ISBN:${isbn10}`])
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
async function fromOpenLibrarySearch(isbn, isbn10, ctx) {
  const fields = 'title,author_name,first_publish_year,number_of_pages_median,language,publisher,subject,cover_i'
  // Das isbn-Feld nimmt genau einen Wert — eine ODER-Verknüpfung würde
  // wörtlich als Suchbegriff gelesen und fände nie etwas. Daher nacheinander.
  const forms = [isbn, isbn10].filter(Boolean)
  let d = null
  for (const form of forms) {
    const data = await fetchJson(
      `https://openlibrary.org/search.json?isbn=${form}&limit=1&fields=${fields}`,
      ctx
    )
    d = data?.docs?.[0]
    if (d) break
  }
  if (!d) return null
  return {
    title: d.title || '',
    authors: d.author_name || [],
    publisher: (d.publisher || [])[0] || '',
    year: d.first_publish_year || null,
    pages: d.number_of_pages_median || null,
    language: OL_LANG[(d.language || [])[0]] || '',
    coverUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : null,
    categories: translateCategories(d.subject),
    source: 'Open Library'
  }
}

/* Apple Books als dritte Quelle. Deckt vor allem Selfpublishing-Titel ab,
   bei denen Open Library und Google oft nichts haben. Die Bilder-URL lässt
   sich von 100px auf 600px hochdrehen. */
async function fromApple({ isbn, title, authors }, ctx) {
  // Achtung: E-Book-Ausgaben tragen meist eine andere ISBN als die gedruckte,
  // die gezielte Abfrage greift deshalb oft nicht. Die Freitextsuche mit der
  // ISBN als Suchbegriff findet trotzdem manches.
  let data = isbn ? await fetchJson(`https://itunes.apple.com/lookup?isbn=${isbn}`, ctx) : null
  if (!data?.results?.length && isbn) {
    data = await fetchJson(`https://itunes.apple.com/search?term=${isbn}&entity=ebook&limit=1`, ctx)
  }
  if (!data?.results?.length && title) {
    const term = encodeURIComponent(`${title} ${authors?.[0] || ''}`.trim())
    data = await fetchJson(`https://itunes.apple.com/search?term=${term}&entity=ebook&limit=1`, ctx)
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
async function byTitle(title, author, ctx) {
  if (!title) return null
  const q = encodeURIComponent(`intitle:${title}${author ? ` inauthor:${author}` : ''}`)
  const data = await fetchJson(`https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=3`, ctx)
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

/** Suche nach Titel/Autor statt ISBN — für Bücher ohne Barcode zur Hand. */
export async function searchBooksByText(query) {
  const q = query.trim()
  if (!q) return []

  const ctx = { failures: 0 }
  const base = 'https://www.googleapis.com/books/v1/volumes'

  // Erst normal suchen. Bleibt das dünn, gezielt als Autorenname versuchen —
  // bei einer reinen Nachnamen-Eingabe wie "Sanderson" bringt das deutlich
  // mehr und passendere Treffer.
  let data = await fetchJson(
    `${base}?q=${encodeURIComponent(q)}&maxResults=20&printType=books&orderBy=relevance`,
    ctx
  )
  let items = data?.items || []

  if (items.length < 5) {
    const asAuthor = await fetchJson(
      `${base}?q=${encodeURIComponent(`inauthor:${q}`)}&maxResults=20&printType=books`,
      ctx
    )
    const extra = asAuthor?.items || []
    const seen = new Set(items.map((i) => i.id))
    items = [...items, ...extra.filter((i) => !seen.has(i.id))]
  }

  // Nichts gefunden UND unterwegs ist etwas schiefgegangen: dann ist "keine
  // Treffer" nicht vertrauenswürdig, sondern schlicht ein Fehlschlag.
  if (!items.length && ctx.failures > 0) {
    throw new Error('Die Suche war nicht erreichbar. Nochmal versuchen?')
  }

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
        categories: translateCategories(v.categories),
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
    categories: pick(g.categories, os.categories) || [],
    series: oe.series || '',
    seriesIndex: oe.seriesIndex ?? null
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

  /* Ein eigener Zähler pro Quelle. Apple Books zum Beispiel lässt Zugriffe
     aus dem Browser oft gar nicht zu — dann scheitert diese eine Quelle bei
     jedem Scan, ohne dass das irgendetwas über das Buch aussagt. Mit einem
     gemeinsamen Zähler galt deshalb bisher jede Abfrage als fehlgeschlagen. */
  const ctxs = {
    google: { failures: 0 },
    olBooks: { failures: 0 },
    olSearch: { failures: 0 },
    olEdition: { failures: 0 },
    apple: { failures: 0 }
  }
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
    track('google', fromGoogle(isbn, isbn10, ctxs.google)),
    track('olBooks', fromOpenLibrary(isbn, isbn10, ctxs.olBooks)),
    track('olSearch', fromOpenLibrarySearch(isbn, isbn10, ctxs.olSearch)),
    track('olEdition', fromOpenLibraryEdition(isbn, isbn10, ctxs.olEdition)),
    track('apple', fromApple({ isbn }, ctxs.apple))
  ])

  /* Nur die tragenden Kataloge entscheiden, ob "nicht gefunden" glaubwürdig
     ist. Apple ist ein Zusatz — fällt nur der aus, ist das kein Grund, das
     Ergebnis anzuzweifeln. Unglaubwürdig ist es erst, wenn Google UND alle
     Open-Library-Wege scheiterten, also gar kein Katalog geantwortet hat. */
  const googleFailed = ctxs.google.failures > 0
  const olFailed =
    ctxs.olBooks.failures > 0 && ctxs.olSearch.failures > 0 && ctxs.olEdition.failures > 0
  const allPrimaryFailed = googleFailed && olFailed

  const merged = mergeSources(results)

  if (!merged.title) {
    // Wichtig: Wenn Anfragen fehlgeschlagen sind, ist "nicht gefunden" nicht
    // vertrauenswürdig — dann als Fehler melden statt fälschlich zu behaupten,
    // das Buch sei unbekannt. Und auf keinen Fall zwischenspeichern.
    return { isbn13: isbn, notFound: true, unreliable: allPrimaryFailed }
  }

  const sources = []
  if (found.google) sources.push('Google Books')
  if (found.olBooks || found.olSearch || found.olEdition) sources.push('Open Library')
  if (found.apple) sources.push('Apple Books')

  // Letzter Ausweg, nur wenn wirklich noch etwas Wesentliches fehlt: dieselbe
  // Ausgabe ist unter einer anderen ISBN oft vollständiger erfasst.
  if (!merged.pages || !merged.coverUrl) {
    const extra = await byTitle(merged.title, merged.authors[0], ctxs.google)
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
  // Zwischenspeichern, sobald die tragenden Kataloge sauber geantwortet
  // haben. Ein Ausfall der Zusatzquelle darf das nicht verhindern — sonst
  // würde der Zwischenspeicher praktisch nie gefüllt.
  if (!googleFailed && !olFailed) writeCache(isbn, final)
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
