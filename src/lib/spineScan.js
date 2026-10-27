/* Rücken-Scan: wie bei einer Dokumenten-App. Aus einem Foto-Ausschnitt um den
   Rahmen herum werden die vier Kanten des Buchrückens gesucht, das Bild gerade
   gezogen (Perspektive) und leicht nachgeschärft. Ohne externe Bibliothek.
   Wird nichts Verlässliches gefunden, bleibt der Rahmen des Nutzers gültig. */

const WORK_H = 260 // Höhe des verkleinerten Bildes für die Kantensuche

function toGray(canvas, w, h) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const x = c.getContext('2d', { willReadFrequently: true })
  x.drawImage(canvas, 0, 0, w, h)
  const d = x.getImageData(0, 0, w, h).data
  const g = new Float32Array(w * h)
  for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
  // leichte Glättung gegen Rauschen und Schrift
  const o = Float32Array.from(g)
  for (let y = 1; y < h - 1; y++) {
    for (let xx = 1; xx < w - 1; xx++) {
      const k = y * w + xx
      o[k] = (g[k] * 4 + g[k - 1] + g[k + 1] + g[k - w] + g[k + w]) / 8
    }
  }
  return o
}

/** Kantenstärke quer zur Linie, gemittelt entlang der Linie. */
function sample(arr, w, h, x, y) {
  const xi = Math.max(0, Math.min(w - 2, Math.floor(x)))
  const yi = Math.max(0, Math.min(h - 2, Math.floor(y)))
  const fx = x - xi
  const fy = y - yi
  const k = yi * w + xi
  return arr[k] * (1 - fx) * (1 - fy) + arr[k + 1] * fx * (1 - fy) + arr[k + w] * (1 - fx) * fy + arr[k + w + 1] * fx * fy
}

/** Beste fast senkrechte Linie x(y) = a + (b - a)·t zwischen y0 und y1. */
function bestVertical(g, w, h, y0, y1, aMin, aMax, maxSlant, inward) {
  const rows = []
  for (let y = y0; y <= y1; y += 2) rows.push(y)
  let best = { s: -1 }
  const cands = []
  let sum = 0
  let n = 0
  const step = 2
  for (let a = aMin; a <= aMax; a += step) {
    for (let b = Math.max(aMin, a - maxSlant); b <= Math.min(aMax, a + maxSlant); b += step) {
      let s = 0
      for (let i = 0; i < rows.length; i++) {
        const t = i / (rows.length - 1 || 1)
        const x = a + (b - a) * t
        s += Math.abs(sample(g, w, h, x + 1.5, rows[i]) - sample(g, w, h, x - 1.5, rows[i]))
      }
      s /= rows.length
      sum += s
      n++
      const adj = s * (1 - 0.12 * (Math.abs(b - a) / (maxSlant || 1)))
      cands.push({ s: adj, raw: s, a, b })
      if (adj > best.s) best = { s: adj, raw: s, a, b }
    }
  }
  // Unter fast gleich starken Kanten die innere wählen: lieber knapp im Rücken als Nachbarbuch im Bild.
  const good = cands.filter((q) => q.s >= best.s * 0.93)
  good.sort((p, q) => inward * (q.a + q.b - p.a - p.b))
  const pick = good[0] || best
  return { ...pick, s: pick.raw, mean: n ? sum / n : 0 }
}

/** Beste fast waagerechte Linie y(x) = c + (d - c)·t zwischen x0 und x1. */
function bestHorizontal(g, w, h, x0, x1, cMin, cMax, maxSlant, inward) {
  const cols = []
  for (let x = x0; x <= x1; x += 2) cols.push(x)
  let best = { s: -1 }
  const cands = []
  let sum = 0
  let n = 0
  for (let c = cMin; c <= cMax; c += 2) {
    for (let d = Math.max(cMin, c - maxSlant); d <= Math.min(cMax, c + maxSlant); d += 2) {
      let s = 0
      for (let i = 0; i < cols.length; i++) {
        const t = i / (cols.length - 1 || 1)
        const y = c + (d - c) * t
        s += Math.abs(sample(g, w, h, cols[i], y + 1.5) - sample(g, w, h, cols[i], y - 1.5))
      }
      s /= cols.length
      sum += s
      n++
      const adj = s * (1 - 0.12 * (Math.abs(d - c) / (maxSlant || 1)))
      cands.push({ s: adj, raw: s, c, d })
      if (adj > best.s) best = { s: adj, raw: s, c, d }
    }
  }
  const good = cands.filter((q) => q.s >= best.s * 0.93)
  good.sort((p, q) => inward * (q.c + q.d - p.c - p.d))
  const pick = good[0] || best
  return { ...pick, s: pick.raw, mean: n ? sum / n : 0 }
}

function intersect(vert, horz) {
  // vert: x = a + (b - a)·(y - yA)/(yB - yA); horz: y = c + (d - c)·(x - xA)/(xB - xA)
  // Iterativ (Linien sind fast senkrecht/waagerecht): reicht in 3 Schritten.
  let x = vert.xAt((horz.c + horz.d) / 2)
  let y = horz.yAt(x)
  for (let i = 0; i < 3; i++) {
    x = vert.xAt(y)
    y = horz.yAt(x)
  }
  return { x, y }
}

/** Sucht die vier Ecken. Koordinaten in Pixeln des übergebenen Canvas.
    inner = Rahmen des Nutzers in Canvas-Koordinaten. */
export function detectQuad(canvas, inner) {
  const k = WORK_H / canvas.height
  const w = Math.round(canvas.width * k)
  const h = WORK_H
  const g = toGray(canvas, w, h)
  const fx = inner.x * k
  const fy = inner.y * k
  const fw = inner.w * k
  const fh = inner.h * k
  const mx = Math.max(6, fw * 0.45)
  const my = Math.max(6, fh * 0.1)
  const y0 = Math.round(fy + fh * 0.12)
  const y1 = Math.round(fy + fh * 0.88)
  const slant = Math.max(4, fh * 0.1)

  const L = bestVertical(g, w, h, y0, y1, Math.max(1, Math.round(fx - mx)), Math.round(fx + mx), slant, 1)
  const R = bestVertical(g, w, h, y0, y1, Math.round(fx + fw - mx), Math.min(w - 2, Math.round(fx + fw + mx)), slant, -1)

  const trusted = (r) => r.s > 0 && r.s > r.mean * 1.6
  const defL = { a: fx, b: fx }
  const defR = { a: fx + fw, b: fx + fw }
  let left = trusted(L) ? L : { ...defL, s: 0 }
  let right = trusted(R) ? R : { ...defR, s: 0 }
  // Sinnvoll? Rücken muss mindestens halb so breit wie der Rahmen sein.
  if (Math.min(right.a, right.b) - Math.max(left.a, left.b) < fw * 0.5) {
    left = { ...defL, s: 0 }
    right = { ...defR, s: 0 }
  }

  const xs0 = Math.round(Math.max(left.a, left.b) + 2)
  const xs1 = Math.round(Math.min(right.a, right.b) - 2)
  const T = bestHorizontal(g, w, h, xs0, xs1, Math.max(1, Math.round(fy - my)), Math.round(fy + my), Math.max(3, fw * 0.12), 1)
  const B = bestHorizontal(g, w, h, xs0, xs1, Math.round(fy + fh - my), Math.min(h - 2, Math.round(fy + fh + my)), Math.max(3, fw * 0.12), -1)
  const top = T.s > T.mean * 1.6 ? T : { c: fy, d: fy, s: 0 }
  const bottom = B.s > B.mean * 1.6 ? B : { c: fy + fh, d: fy + fh, s: 0 }

  const vL = { xAt: (y) => left.a + (left.b - left.a) * ((y - y0) / (y1 - y0)) }
  const vR = { xAt: (y) => right.a + (right.b - right.a) * ((y - y0) / (y1 - y0)) }
  const xA = (left.a + left.b) / 2
  const xB = (right.a + right.b) / 2
  const hT = { c: top.c, d: top.d, yAt: (x) => top.c + (top.d - top.c) * ((x - xA) / (xB - xA || 1)) }
  const hB = { c: bottom.c, d: bottom.d, yAt: (x) => bottom.c + (bottom.d - bottom.c) * ((x - xA) / (xB - xA || 1)) }

  const q = [intersect(vL, hT), intersect(vR, hT), intersect(vR, hB), intersect(vL, hB)].map((p) => ({ x: p.x / k, y: p.y / k }))
  const found = [left.s, right.s, top.s, bottom.s].filter((s) => s > 0).length
  return { quad: q, found }
}

/* ── Perspektive ── */

function solve8(A, b) {
  const n = 8
  for (let i = 0; i < n; i++) {
    let p = i
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r
    ;[A[i], A[p]] = [A[p], A[i]]
    ;[b[i], b[p]] = [b[p], b[i]]
    for (let r = i + 1; r < n; r++) {
      const f = A[r][i] / A[i][i]
      for (let c = i; c < n; c++) A[r][c] -= f * A[i][c]
      b[r] -= f * b[i]
    }
  }
  const x = new Array(n)
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i]
    for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c]
    x[i] = s / A[i][i]
  }
  return x
}

/** Homographie von Zielrechteck (u,v) auf Quelle (x,y). */
function homography(dst, src) {
  const A = []
  const b = []
  for (let i = 0; i < 4; i++) {
    const { x: u, y: v } = dst[i]
    const { x, y } = src[i]
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); b.push(x)
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); b.push(y)
  }
  return solve8(A, b)
}

/** Zieht das Viereck gerade. Gibt einen neuen Canvas zurück. */
export function warpQuad(canvas, quad, outH) {
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
  const wTop = d(quad[0], quad[1])
  const wBot = d(quad[3], quad[2])
  const hL = d(quad[0], quad[3])
  const hR = d(quad[1], quad[2])
  const srcW = (wTop + wBot) / 2
  const srcH = (hL + hR) / 2
  const H = Math.round(Math.min(outH, srcH))
  const W = Math.max(8, Math.round(H * (srcW / srcH)))
  const m = homography([{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], quad)
  const sc = canvas.getContext('2d', { willReadFrequently: true })
  const sd = sc.getImageData(0, 0, canvas.width, canvas.height)
  const sw = canvas.width
  const sh = canvas.height
  const out = document.createElement('canvas')
  out.width = W
  out.height = H
  const oc = out.getContext('2d')
  const od = oc.createImageData(W, H)
  for (let v = 0; v < H; v++) {
    for (let u = 0; u < W; u++) {
      const z = m[6] * (u + 0.5) + m[7] * (v + 0.5) + 1
      const x = (m[0] * (u + 0.5) + m[1] * (v + 0.5) + m[2]) / z - 0.5
      const y = (m[3] * (u + 0.5) + m[4] * (v + 0.5) + m[5]) / z - 0.5
      const x0 = Math.max(0, Math.min(sw - 2, Math.floor(x)))
      const y0 = Math.max(0, Math.min(sh - 2, Math.floor(y)))
      const fx = Math.max(0, Math.min(1, x - x0))
      const fy = Math.max(0, Math.min(1, y - y0))
      const i00 = (y0 * sw + x0) * 4
      const i10 = i00 + 4
      const i01 = i00 + sw * 4
      const i11 = i01 + 4
      const o = (v * W + u) * 4
      for (let c = 0; c < 3; c++) {
        od.data[o + c] = sd.data[i00 + c] * (1 - fx) * (1 - fy) + sd.data[i10 + c] * fx * (1 - fy) + sd.data[i01 + c] * (1 - fx) * fy + sd.data[i11 + c] * fx * fy
      }
      od.data[o + 3] = 255
    }
  }
  oc.putImageData(od, 0, 0)
  return out
}

/** Helligkeit spreizen (1 %–99 %) und mild nachschärfen. */
export function enhance(canvas) {
  const w = canvas.width
  const h = canvas.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  const hist = new Uint32Array(256)
  for (let i = 0; i < d.length; i += 4) hist[Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])]++
  const total = w * h
  let acc = 0
  let lo = 0
  let hi = 255
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * 0.01) { lo = v; break } }
  acc = 0
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= total * 0.01) { hi = v; break } }
  if (hi - lo < 40) { lo = Math.max(0, lo - 10); hi = Math.min(255, hi + 10) }
  const scale = 255 / Math.max(1, hi - lo)
  for (let i = 0; i < d.length; i += 4) {
    for (let c = 0; c < 3; c++) d[i + c] = Math.max(0, Math.min(255, (d[i + c] - lo) * scale))
  }
  // Unscharf maskieren: Original + 0,7 · (Original − Weichzeichnung)
  const src = new Uint8ClampedArray(d)
  const amt = 0.7
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4
      for (let c = 0; c < 3; c++) {
        const blur = (src[i + c] * 4 + src[i + c - 4] + src[i + c + 4] + src[i + c - w * 4] + src[i + c + w * 4]) / 8
        d[i + c] = Math.max(0, Math.min(255, src[i + c] + amt * (src[i + c] - blur)))
      }
    }
  }
  ctx.putImageData(img, 0, 0)
  return canvas
}

export function canvasToBlob(canvas, quality = 0.88) {
  return new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality))
}
