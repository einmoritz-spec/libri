import { db } from './db'

/* Regal-Ansicht: Reihenfolge, Maße und Farbverlauf der Rücken. */

function hashSeed(str) {
  let h = 0
  const s = String(str || '')
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h)
}

/** Fallback-Farbe ohne Cover — aus dem Titel abgeleitet, damit sie stabil bleibt. */
export function colorFromText(str) {
  const hue = hashSeed(str) % 360
  return `hsl(${hue} 38% 33%)`
}

export const SHELF_MODES = ['off', 'gradient', 'cover']
export function getShelfMode() {
  const m = localStorage.getItem('libri:shelfMode')
  return SHELF_MODES.includes(m) ? m : 'off'
}

/* ── Maße ── */

/** Dicke wächst gleichmäßig mit der Seitenzahl: 100 S. ≈ 14 px, 1200 S. ≈ 58 px. */
export function spineWidth(book) {
  const pages = book.pages || book.ebookPages || 350
  return Math.round(Math.min(44, Math.max(12, (10 + pages * 0.04) * 0.74)))
}

export const BINDINGS = [['hard', 'Hardcover'], ['soft', 'Taschenbuch'], ['small', 'Kleinformat']]
const BASE_H = { hard: 158, soft: 142, small: 127 }

/** Höhe: Einband bestimmt die Grundhöhe, der Autor verschiebt sie leicht —
    so sind alle Bände einer Reihe gleich hoch, verschiedene Autoren aber nicht. */
export function spineHeight(book) {
  const b = BASE_H[book.binding] ? book.binding : 'soft'
  const author = (book.authors?.[0] || book.series || book.title || '').split(' ').pop().toLowerCase()
  const off = (hashSeed(author) % 9) - 4
  return BASE_H[b] + off
}

/* ── Reihenfolge ── */

function surname(b) {
  return (b.authors?.[0] || 'zzz').split(' ').pop().toLowerCase()
}

/** Automatische Grundordnung: Reihen alphabetisch, darin nach Band, Einzelbände am Ende. */
export function autoOrder(books) {
  return [...books].sort((a, b) => {
    const as = a.series || ''
    const bs = b.series || ''
    if (as && !bs) return -1
    if (!as && bs) return 1
    if (as !== bs) return as.localeCompare(bs, 'de')
    if (as) {
      return (a.seriesIndex ?? 9999) - (b.seriesIndex ?? 9999) || a.title.localeCompare(b.title, 'de')
    }
    return surname(a).localeCompare(surname(b), 'de') || a.title.localeCompare(b.title, 'de')
  })
}

/** Eigene Reihenfolge (shelfPos) mit automatischer Einsortierung neuer Bücher. */
export function orderBooks(books) {
  const placed = books.filter((b) => Number.isFinite(b.shelfPos)).sort((a, b) => a.shelfPos - b.shelfPos)
  const rest = autoOrder(books.filter((b) => !Number.isFinite(b.shelfPos)))
  if (!placed.length) return rest
  const out = [...placed]
  for (const b of rest) {
    let at = out.length
    if (b.series) {
      for (let i = out.length - 1; i >= 0; i--) {
        if (out[i].series === b.series) { at = i + 1; break }
      }
    }
    out.splice(at, 0, b)
  }
  return out
}

/** Fügt zwischen zwei Reihen (und vor/nach Einzelbänden) eine kleine Lücke ein. */
export function withSeparators(list) {
  const out = []
  let prev = null
  for (const b of list) {
    const key = b.series || null
    if (prev !== undefined && out.length && (key !== prev || !key)) {
      // Lücke nur, wenn sich die Reihe ändert — Einzelbände stehen dicht beieinander
      if (key !== prev) out.push({ sep: true, w: 9, id: `sep-${b.id}` })
    }
    out.push(b)
    prev = key
  }
  return out
}

/** Teilt die Bücher je nach Breite auf Bretter auf. */
export function packRows(items, width, gap = 2) {
  const rows = []
  let cur = []
  let w = 0
  const itemW = (it) => (it.sep || it.gap ? it.w : spineWidth(it))
  for (const it of items) {
    if (it.sep && !cur.length) continue
    const iw = itemW(it)
    if (cur.length && !it.sep && w + iw + gap > width) {
      while (cur.length && cur[cur.length - 1].sep) cur.pop()
      rows.push(cur)
      cur = []
      w = 0
    }
    cur.push(it)
    w += iw + gap
  }
  while (cur.length && cur[cur.length - 1].sep) cur.pop()
  if (cur.length) rows.push(cur)
  return rows
}

/** Schilder für ein Brett: je Reihe Name und Lage (Start, Breite) in Pixeln. */
export function rowPlates(row, gap = 2, pad = 0) {
  const plates = []
  let x = pad
  let cur = null
  for (const it of row) {
    const iw = it.sep || it.gap ? it.w : spineWidth(it)
    const name = !it.sep && !it.gap ? it.series || null : null
    if (name && (!cur || cur.name !== name)) {
      if (cur) plates.push(cur)
      cur = { name, x, w: 0 }
    } else if (!name && cur && !it.gap) {
      plates.push(cur)
      cur = null
    }
    if (cur) cur.w = x + iw - cur.x
    x += iw + gap
  }
  if (cur) plates.push(cur)
  return plates
}

/** Speichert die komplette Reihenfolge — eine Transaktion, nur geänderte Bücher. */
export async function saveOrder(list) {
  await db.transaction('rw', db.books, async () => {
    for (let i = 0; i < list.length; i++) {
      if (list[i].shelfPos !== i) await db.books.update(list[i].id, { shelfPos: i })
    }
  })
}

export async function resetOrder(books) {
  await db.transaction('rw', db.books, async () => {
    for (const b of books) {
      if (b.shelfPos !== undefined && b.shelfPos !== null) await db.books.update(b.id, { shelfPos: null })
    }
  })
}

export async function bulkSetBinding(ids, binding) {
  await db.transaction('rw', db.books, async () => {
    for (const id of ids) await db.books.update(id, { binding: binding || null })
  })
}

/* ── Farbverlauf aus dem Cover ── */

const STOPS = 24

function gaussian(arr, r) {
  const k = []
  let t = 0
  for (let i = -r; i <= r; i++) {
    const w = Math.exp(-(i * i) / (2 * (r / 2) * (r / 2)))
    k.push(w)
    t += w
  }
  return arr.map((_, i) => {
    const c = [0, 0, 0]
    k.forEach((w, j) => {
      const q = arr[Math.max(0, Math.min(arr.length - 1, i + j - r))]
      c[0] += q[0] * w; c[1] += q[1] * w; c[2] += q[2] * w
    })
    return c.map((v) => v / t)
  })
}

const hex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')

/** Zeile für Zeile gemittelte Farben des Covers, weich geglättet — als Hex-Liste. */
export function gradientFromImage(img) {
  try {
    const W = 24
    const H = 90
    const cv = document.createElement('canvas')
    cv.width = W
    cv.height = H
    const x = cv.getContext('2d', { willReadFrequently: true })
    x.drawImage(img, 0, 0, W, H)
    const d = x.getImageData(0, 0, W, H).data
    const rows = []
    for (let y = 0; y < H; y++) {
      let r = 0, g = 0, b = 0
      for (let xx = 0; xx < W; xx++) {
        const i = (y * W + xx) * 4
        r += d[i]; g += d[i + 1]; b += d[i + 2]
      }
      rows.push([r / W, g / W, b / W])
    }
    const sm = gaussian(rows, 7)
    const out = []
    for (let i = 0; i < STOPS; i++) out.push(hex(sm[Math.round((i / (STOPS - 1)) * (H - 1))]))
    return out
  } catch {
    return null
  }
}

export function gradientCss(stops) {
  return `linear-gradient(180deg,${stops.map((c, i) => `${c} ${((i / (stops.length - 1)) * 100).toFixed(1)}%`).join(',')})`
}

export function fallbackGradient(book) {
  const c = book.spineColor || colorFromText(book.title)
  return `linear-gradient(180deg, color-mix(in srgb, ${c} 80%, white), ${c} 45%, color-mix(in srgb, ${c} 70%, black))`
}

/* Berechnete Verläufe werden gesammelt und gebündelt gespeichert — ein
   Schreibvorgang statt Hunderter, sonst baut sich die Liste ständig neu auf. */
const pending = new Map()
let timer = null
export function queueSpineGrad(id, stops) {
  pending.set(id, stops)
  clearTimeout(timer)
  timer = setTimeout(async () => {
    const batch = [...pending]
    pending.clear()
    try {
      await db.transaction('rw', db.books, async () => {
        for (const [bid, st] of batch) await db.books.update(bid, { spineGrad: st })
      })
    } catch { /* wird beim nächsten Öffnen neu berechnet */ }
  }, 2500)
}
