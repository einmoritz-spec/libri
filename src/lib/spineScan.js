/* Rückenfoto nachbearbeiten: Helligkeit spreizen und mild nachschärfen. */

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
