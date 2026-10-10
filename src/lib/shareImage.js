/* Jahresrückblick als Bild (PNG) zum Teilen. Wird direkt auf einer Zeichenfläche
   gemalt, ohne zusätzliche Bibliothek. Immer in der hellen Libri-Palette,
   damit das Bild unabhängig vom eingestellten Modus gleich aussieht. */
import { db } from './db'

const W = 1080
const H = 1350
const C = {
  bg: '#faf3e7', card: '#f2e7d4', ink: '#2c2013', dim: '#7c6a51', lamp: '#b97a1f', line: '#ddccac'
}
const SERIF = "Fraunces, Georgia, 'Times New Roman', serif"
const SANS = "'Instrument Sans', system-ui, -apple-system, 'Segoe UI', sans-serif"

function fit(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text
  let t = text
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1)
  return `${t.trimEnd()}…`
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

async function loadCover(book) {
  try {
    const rec = await db.covers.get(book.id)
    if (!rec?.blob) return null
    return await createImageBitmap(rec.blob)
  } catch {
    return null
  }
}

function drawCover(ctx, img, book, x, y, w, h) {
  ctx.save()
  ctx.shadowColor = 'rgba(90, 68, 38, 0.35)'
  ctx.shadowBlur = 18
  ctx.shadowOffsetY = 8
  roundRect(ctx, x, y, w, h, 8)
  ctx.fillStyle = C.card
  ctx.fill()
  ctx.restore()
  ctx.save()
  roundRect(ctx, x, y, w, h, 8)
  ctx.clip()
  if (img) {
    const s = Math.max(w / img.width, h / img.height)
    const dw = img.width * s
    const dh = img.height * s
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
  } else {
    ctx.fillStyle = C.card
    ctx.fillRect(x, y, w, h)
    ctx.fillStyle = C.dim
    ctx.font = `600 22px ${SERIF}`
    ctx.textAlign = 'center'
    const words = (book.title || '').split(' ')
    let line = ''
    let ly = y + h / 2 - 20
    for (const word of words) {
      const test = line ? `${line} ${word}` : word
      if (ctx.measureText(test).width > w - 24 && line) {
        ctx.fillText(line, x + w / 2, ly)
        line = word
        ly += 28
      } else line = test
    }
    ctx.fillText(line, x + w / 2, ly)
  }
  ctx.restore()
}

function stat(ctx, x, y, w, value, label) {
  roundRect(ctx, x, y, w, 150, 22)
  ctx.fillStyle = C.card
  ctx.fill()
  ctx.textAlign = 'left'
  ctx.fillStyle = C.ink
  // Lange Werte (Autorenname) verkleinern, bis sie in die Kachel passen
  let size = 64
  ctx.font = `600 ${size}px ${SERIF}`
  while (size > 30 && ctx.measureText(value).width > w - 64) {
    size -= 2
    ctx.font = `600 ${size}px ${SERIF}`
  }
  ctx.fillText(fit(ctx, value, w - 64), x + 32, y + 78)
  ctx.fillStyle = C.dim
  ctx.font = `500 26px ${SANS}`
  ctx.fillText(label, x + 32, y + 120)
}

/** stats: { count, pages, avgRating, topAuthor, topMonth, best, thickest, inYear } */
export async function makeYearImage(year, stats) {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')

  // Schriften aus der App abwarten, damit nicht die Ersatzschrift gemalt wird.
  try { await document.fonts?.ready } catch { /* egal */ }

  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, W, H)

  // Kopf
  ctx.textAlign = 'left'
  ctx.fillStyle = C.lamp
  ctx.font = `600 28px ${SANS}`
  ctx.letterSpacing = '6px'
  ctx.fillText('MEIN LESEJAHR', 80, 120)
  ctx.letterSpacing = '0px'
  ctx.fillStyle = C.ink
  ctx.font = `600 190px ${SERIF}`
  ctx.fillText(String(year), 70, 300)

  // Hauptzahl
  ctx.font = `600 120px ${SERIF}`
  ctx.fillText(String(stats.count), 80, 450)
  const numW = ctx.measureText(String(stats.count)).width
  ctx.fillStyle = C.dim
  ctx.font = `500 38px ${SANS}`
  ctx.fillText(stats.count === 1 ? 'Buch gelesen' : 'Bücher gelesen', 80 + numW + 24, 450)

  // Kacheln
  const tiles = []
  if (stats.pages > 0) tiles.push([stats.pages.toLocaleString('de-DE'), 'Seiten'])
  if (stats.avgRating) tiles.push([String(stats.avgRating).replace('.', ','), 'Ø Bewertung'])
  if (stats.topAuthor && stats.topAuthor.count > 1) tiles.push([stats.topAuthor.name, `${stats.topAuthor.count} Bücher von`])
  else if (stats.topMonth) tiles.push([stats.topMonth, 'bester Monat'])
  const n = Math.max(1, tiles.length)
  const gap = 24
  const tw = (W - 160 - gap * (n - 1)) / n
  tiles.forEach(([v, l], i) => {
    stat(ctx, 80 + i * (tw + gap), 500, tw, v, l)
  })

  // Cover-Mosaik: bestbewertete zuerst, höchstens 12 (zwei Reihen à 6)
  const books = [...(stats.inYear || [])]
    .filter((b, i, a) => a.findIndex((x) => x.id === b.id) === i)
    .sort((a, b) => (b.rating || 0) - (a.rating || 0))
    .slice(0, 12)
  const imgs = await Promise.all(books.map(loadCover))
  const cols = 6
  const gapC = 16
  const cw = (W - 160 - gapC * (cols - 1)) / cols
  const ch = cw * 1.5
  const rows = Math.ceil(books.length / cols)
  const blockH = rows * ch + (rows - 1) * 20
  const top = 700 + (480 - blockH) / 2
  books.forEach((b, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    drawCover(ctx, imgs[i], b, 80 + col * (cw + gapC), top + row * (ch + 20), cw, ch)
  })

  // Fuß
  ctx.fillStyle = C.line
  ctx.fillRect(80, H - 130, W - 160, 2)
  ctx.textAlign = 'left'
  ctx.fillStyle = C.ink
  ctx.font = `600 40px ${SERIF}`
  ctx.fillText('Libri', 80, H - 70)
  if (stats.best) {
    ctx.textAlign = 'right'
    ctx.fillStyle = C.dim
    ctx.font = `500 26px ${SANS}`
    ctx.fillText(fit(ctx, `Lieblingsbuch: ${stats.best.title}`, 700), W - 80, H - 70)
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Bild konnte nicht erstellt werden'))), 'image/png')
  })
}

/** Teilen über das System-Menü, sonst als Datei herunterladen. */
export async function shareImage(blob, name) {
  const file = new File([blob], name, { type: 'image/png' })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
      return 'shared'
    } catch (e) {
      if (e?.name === 'AbortError') return 'cancelled'
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
  return 'saved'
}
