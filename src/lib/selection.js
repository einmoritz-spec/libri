import { createContext } from 'react'

/** Menge der Bücher, die gerade ausgewählt sind. Die Karten lesen daraus, ob
    sie markiert dargestellt werden. */
export const SelectionContext = createContext(new Set())
