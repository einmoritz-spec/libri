/* Text aus einem Foto lesen (Zitate). Die Erkennung läuft komplett auf dem
   Gerät (Tesseract als WebAssembly), das Foto verlässt das Handy nicht. Die
   nötigen Dateien liegen unter ocr/ mitten in der App und werden beim ersten
   Gebrauch geladen und danach für den Offline-Betrieb aufgehoben. */

const BASE = () => new URL('ocr/', document.baseURI).href

/** Buchsprache → Erkennungssprache. Unbekannt: beides zusammen. */
export function ocrLanguages(language) {
  const l = String(language || '').toLowerCase().slice(0, 2)
  if (l === 'de') return ['deu']
  if (l === 'en') return ['eng']
  return ['deu', 'eng']
}

/** Verkleinert große Kamerafotos, macht sie grau und etwas kontrastreicher.
    Das beschleunigt die Erkennung deutlich und verbessert sie meist. */
async function prepare(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const longEdge = Math.max(bitmap.width, bitmap.height)
  const scale = longEdge > 2400 ? 2400 / longEdge : longEdge < 1200 ? 1600 / longEdge : 1
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')
  ctx.filter = 'grayscale(1) contrast(1.2)'
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close?.()
  return await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.95))
}

/** Macht aus dem Rohtext lesbaren Fließtext: Silbentrennung am Zeilenende
    auflösen, Zeilenumbrüche innerhalb eines Absatzes entfernen. */
export function tidyOcrText(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/(\p{L})-\n(?=\p{Ll})/gu, '$1')
    .replace(/\n(?!\n)/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n{2,} ?/g, '\n\n')
    .trim()
}

/** Liest den Text aus einem Foto. onProgress bekommt Werte von 0 bis 1. */
export async function recognizeText(file, { language, onProgress } = {}) {
  const mod = await import('tesseract.js')
  const createWorker = mod.createWorker || mod.default?.createWorker
  const base = BASE()
  const langs = ocrLanguages(language)
  const worker = await createWorker(langs, 1, {
    workerPath: `${base}worker.min.js`,
    corePath: base.replace(/\/$/, ''),
    langPath: base.replace(/\/$/, ''),
    gzip: true,
    cacheMethod: 'none', // die Dateien liegen ohnehin lokal (und im Service-Worker-Cache)
    logger: (m) => {
      if (m.status === 'recognizing text') onProgress?.(m.progress)
    }
  })
  try {
    const image = await prepare(file)
    const { data } = await worker.recognize(image)
    return tidyOcrText(data.text)
  } finally {
    await worker.terminate()
  }
}
