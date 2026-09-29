/* Zurück-Geste und Zurück-Knopf (Android).

   Jede geöffnete Ebene (Tab, Detailansicht, Lesejahr …) meldet sich hier an
   und bekommt genau einen Verlaufseintrag. Zurück schließt immer nur die
   oberste Ebene. Wird eine Ebene mit dem Knopf in der App geschlossen, wird
   ihr Eintrag wieder abgeräumt, damit sich der Verlauf nicht aufstapelt und
   man nicht durch alles wieder „zurückklicken“ muss, was man angetippt hat. */
import { useEffect, useRef } from 'react'

const stack = []
let pendingBack = 0
let scheduled = false
let ignore = 0

function flushBack() {
  scheduled = false
  const n = pendingBack
  pendingBack = 0
  if (n > 0) {
    ignore++ // ein einziges popstate, egal wie viele Einträge
    history.go(-n)
  }
}

function pushLayer(close) {
  const entry = { close }
  stack.push(entry)
  history.pushState({ libriLayer: true }, '')
  return () => {
    const i = stack.indexOf(entry)
    if (i === -1) return // schon per Zurück-Geste geschlossen
    stack.splice(i, 1)
    pendingBack++
    // Sammeln: schließen mehrere Ebenen auf einmal, ist es nur ein Schritt.
    if (!scheduled) {
      scheduled = true
      setTimeout(flushBack, 0)
    }
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    if (ignore > 0) {
      ignore--
      return
    }
    const entry = stack.pop()
    if (entry) entry.close()
  })
}

/** Solange `active` wahr ist, schließt die Zurück-Geste diese Ebene per `onBack`. */
export function useBackLayer(active, onBack) {
  const ref = useRef(onBack)
  ref.current = onBack
  useEffect(() => {
    if (!active) return undefined
    return pushLayer(() => ref.current())
  }, [active])
}
