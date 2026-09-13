import { useRef } from 'react'

/**
 * Unterscheidet drei Gesten auf einer Buchkarte: kurzes Tippen (öffnen),
 * langes Drücken (Schnellbearbeitung), und Wischen (scrollen — tut nichts).
 * An einer Stelle gebaut, weil dieselbe Logik im Raster, in der Liste und
 * in den waagerechten Regal-Reihen gebraucht wird.
 */
export function useTapHold(onTap, onHold, { delay = 450, threshold = 10 } = {}) {
  const timer = useRef(null)
  const start = useRef(null)
  const fired = useRef(false)
  const moved = useRef(false)

  function clear() {
    clearTimeout(timer.current)
    timer.current = null
  }

  function onPointerDown(e) {
    fired.current = false
    moved.current = false
    start.current = { x: e.clientX, y: e.clientY }
    timer.current = setTimeout(() => {
      fired.current = true
      navigator.vibrate?.(20)
      onHold()
    }, delay)
  }

  function onPointerMove(e) {
    if (!start.current) return
    if (Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > threshold) {
      moved.current = true
      clear()
    }
  }

  function onPointerUp() {
    const wasLong = fired.current
    const wasScroll = moved.current
    clear()
    if (!wasLong && !wasScroll) onTap()
  }

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: clear,
    onPointerLeave: clear,
    onContextMenu: (e) => e.preventDefault()
  }
}
