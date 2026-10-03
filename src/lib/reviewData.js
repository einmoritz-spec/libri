/* Berechnungen für die Detailansichten des Lesejahrs. Bewusst ohne React und
   ohne Datenbank, damit sie sich einzeln prüfen lassen. */

export const MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'
]

// Erdige Töne, die zum warmen Braun/Bernstein der App passen und auf hellem
// wie dunklem Hintergrund lesbar bleiben.
export const PALETTE = [
  '#c9862b', '#b5533c', '#5d8850', '#3f7c85', '#7a5a8c',
  '#a89031', '#8a6f4d', '#c9705f', '#4f6d9a', '#7d9a57',
  '#9b4f6a', '#d4a14a', '#5a7b6b', '#b88a6a', '#6d6f9c'
]
export const OTHER_COLOR = '#9a8b78'

/** Anteil als Prozentzahl in deutscher Schreibweise. Kleine Anteile bekommen
    eine Nachkommastelle, sonst stünde bei vielen Büchern überall "0 %". */
export function formatPct(share) {
  const v = share * 100
  return v < 10 ? v.toFixed(1).replace('.', ',') : String(Math.round(v))
}

/**
 * Seiten je Buch für den Donut. Bis maxSingle Bücher bekommt jedes ein
 * eigenes Stück; bei mehr werden die kleinsten zu "Weitere" zusammengefasst,
 * sonst ließe sich der Ring nicht mehr lesen. Bücher ohne Seitenzahl können
 * darin nicht vorkommen und werden nur gezählt.
 */
export function pageSegments(books, maxSingle = 10) {
  const withPages = books.filter((b) => b.pages > 0).sort((a, b) => b.pages - a.pages)
  const total = withPages.reduce((s, b) => s + b.pages, 0)
  const missing = books.length - withPages.length

  const foldRest = withPages.length > maxSingle
  const singles = foldRest ? withPages.slice(0, maxSingle - 1) : withPages
  const rest = foldRest ? withPages.slice(maxSingle - 1) : []

  const segments = singles.map((b, i) => ({
    key: String(b.id),
    label: b.title,
    value: b.pages,
    color: PALETTE[i % PALETTE.length]
  }))
  if (rest.length) {
    segments.push({
      key: 'rest',
      label: `${rest.length} weitere Bücher`,
      value: rest.reduce((s, b) => s + b.pages, 0),
      color: OTHER_COLOR
    })
  }
  for (const s of segments) s.share = total ? s.value / total : 0

  const rows = withPages.map((b, i) => ({
    book: b,
    segKey: i < singles.length ? String(b.id) : 'rest',
    color: i < singles.length ? PALETTE[i % PALETTE.length] : OTHER_COLOR,
    share: total ? b.pages / total : 0
  }))
  return { segments, rows, total, missing }
}

/** Seiten je Autor — dieselbe Form wie pageSegments, nur nach Autoren
    zusammengefasst. Bei mehreren Autoren eines Buchs werden die Seiten
    gleichmäßig verteilt, damit die Summe stimmt. */
export function authorSegments(books, { alwaysShown = 15, minShare = 0.01 } = {}) {
  const withPages = books.filter((b) => b.pages > 0)
  const total = withPages.reduce((s, b) => s + b.pages, 0)
  const missing = books.length - withPages.length

  const map = new Map()
  for (const b of withPages) {
    const names = b.authors?.length ? b.authors : ['Unbekannt']
    for (const name of names) {
      if (!map.has(name)) map.set(name, { name, pages: 0, count: 0 })
      const e = map.get(name)
      e.pages += b.pages / names.length
      e.count += 1
    }
  }
  const list = [...map.values()]
    .map((e) => ({ ...e, pages: Math.round(e.pages) }))
    .sort((a, b) => b.pages - a.pages || a.name.localeCompare(b.name, 'de'))

  // Die ersten 15 bekommen immer ein eigenes Stück. Danach nur noch, wer
  // mindestens ein Prozent hat; der Rest wird zu einem grauen Stück gebündelt.
  const sumAll = list.reduce((s, e) => s + e.pages, 0)
  const singles = list.filter((e, i) => i < alwaysShown || (sumAll && e.pages / sumAll >= minShare))
  const rest = list.slice(singles.length)

  const segments = singles.map((e, i) => ({
    key: e.name, label: e.name, value: e.pages, color: PALETTE[i % PALETTE.length]
  }))
  if (rest.length) {
    segments.push({
      key: 'rest',
      label: `${rest.length} weitere ${rest.length === 1 ? 'Autor' : 'Autoren'}`,
      value: rest.reduce((s, e) => s + e.pages, 0),
      color: OTHER_COLOR
    })
  }
  const sum = segments.reduce((s, x) => s + x.value, 0)
  for (const s of segments) s.share = sum ? s.value / sum : 0

  const rows = list.map((e, i) => ({
    ...e,
    segKey: i < singles.length ? e.name : 'rest',
    color: i < singles.length ? PALETTE[i % PALETTE.length] : OTHER_COLOR,
    share: sum ? e.pages / sum : 0
  }))
  return { segments, rows, total, missing }
}

/** Strichlängen und Startpunkte für einen Ring aus Kreisbögen. Zwischen den
    Stücken bleibt eine kleine Lücke, außer der Ring besteht nur aus einem. */
export function donutArcs(segments, radius) {
  const C = 2 * Math.PI * radius
  const gap = segments.length > 1 ? 1.6 : 0
  let cum = 0
  return segments.map((s) => {
    const len = s.share * C
    const visible = Math.max(0, len - gap)
    const arc = { dash: `${visible} ${C - visible}`, offset: -cum, length: len }
    cum += len
    return arc
  })
}

/** Wie oft welche Bewertung von 1 bis max vergeben wurde. */
export function ratingDistribution(books, max = 10) {
  const counts = Array(max).fill(0)
  for (const b of books) {
    if (!b.rating) continue
    const r = Math.min(max, Math.max(1, Math.round(b.rating)))
    counts[r - 1]++
  }
  return counts
}

/** Bücher nach Abschlussmonat, Januar bis Dezember. */
export function booksByMonth(books) {
  const months = Array.from({ length: 12 }, () => [])
  for (const b of books) {
    if (!b.finishedAt) continue
    months[Number(b.finishedAt.slice(5, 7)) - 1].push(b)
  }
  for (const m of months) m.sort((a, b) => a.finishedAt.localeCompare(b.finishedAt))
  return months
}

/** Autoren nach Anzahl gelesener Bücher. Ein Buch mit mehreren Autoren zählt
    bei jedem von ihnen. */
export function authorsRanking(books) {
  const map = new Map()
  for (const b of books) {
    for (const name of b.authors?.length ? b.authors : ['Unbekannt']) {
      if (!map.has(name)) map.set(name, { name, books: [], pages: 0 })
      const e = map.get(name)
      e.books.push(b)
      e.pages += b.pages || 0
    }
  }
  const list = [...map.values()]
  for (const e of list) e.books.sort((a, b) => a.finishedAt.localeCompare(b.finishedAt))
  return list.sort(
    (a, b) => b.books.length - a.books.length || b.pages - a.pages || a.name.localeCompare(b.name, 'de')
  )
}
