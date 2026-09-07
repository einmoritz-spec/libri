/* Barcode-Scanner mit zwei Wegen:
   – Chrome/Android: native BarcodeDetector-API, schnell und stromsparend.
   – Safari/iOS und alles andere: ZXing als WebAssembly-Fallback.
   Die Weiche wird zur Laufzeit gestellt, der Aufrufer merkt davon nichts. */

export async function hasNativeDetector() {
  if (!('BarcodeDetector' in window)) return false
  try {
    const formats = await window.BarcodeDetector.getSupportedFormats()
    return formats.includes('ean_13')
  } catch {
    return false
  }
}

export async function openCamera(videoEl) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1280 },
      height: { ideal: 720 }
    },
    audio: false
  })
  videoEl.srcObject = stream
  videoEl.setAttribute('playsinline', 'true')
  await videoEl.play()
  return stream
}

export function stopCamera(stream, videoEl) {
  try {
    stream?.getTracks().forEach((t) => t.stop())
  } catch {}
  if (videoEl) videoEl.srcObject = null
}

/**
 * Startet die Erkennung auf einem bereits laufenden <video>.
 * onResult bekommt den rohen Barcode-String, onEngine den Namen der aktiven Engine.
 * Rückgabe: stop().
 */
export async function startDetection(videoEl, onResult, { force = null, onEngine } = {}) {
  const useNative = force ? force === 'native' : await hasNativeDetector()

  if (useNative) {
    const detector = new window.BarcodeDetector({ formats: ['ean_13'] })
    let running = true
    let fails = 0
    let switched = null

    const tick = async () => {
      if (!running) return
      try {
        const codes = await detector.detect(videoEl)
        fails = 0
        if (codes.length) onResult(codes[0].rawValue)
      } catch {
        // Chrome meldet die API teils als vorhanden, bevor das Play-Services-Modul
        // dahinter geladen ist. Dann scheitert jeder Frame — also umschalten.
        if (++fails >= 5) {
          running = false
          switched = await startDetection(videoEl, onResult, { force: 'zxing', onEngine })
          return
        }
      }
      if (running) setTimeout(tick, 220)
    }

    onEngine?.('nativ')
    tick()
    return () => {
      running = false
      switched?.()
    }
  }

  const [{ BrowserMultiFormatReader }, { DecodeHintType, BarcodeFormat }] =
    await Promise.all([import('@zxing/browser'), import('@zxing/library')])

  const hints = new Map()
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13])
  hints.set(DecodeHintType.TRY_HARDER, true)

  const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 200 })
  const controls = await reader.decodeFromVideoElement(videoEl, (result) => {
    if (result) onResult(result.getText())
  })
  onEngine?.('ZXing')
  return () => {
    try {
      controls.stop()
    } catch {}
  }
}

/** Taschenlampe, falls das Gerät sie über die Kamera anbietet. */
export function torchSupported(stream) {
  const track = stream?.getVideoTracks?.()[0]
  return Boolean(track?.getCapabilities?.().torch)
}

export async function setTorch(stream, on) {
  const track = stream?.getVideoTracks?.()[0]
  if (!track) return false
  try {
    await track.applyConstraints({ advanced: [{ torch: on }] })
    return true
  } catch {
    return false
  }
}
