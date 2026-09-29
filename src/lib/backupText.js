/* Liest eine Sicherungsdatei auch dann, wenn beim Übertragen etwas hineingeraten
   ist. Streng nach Norm darf in einem JSON-Text kein rohes Steuerzeichen
   stehen; schon ein einziges — etwa durch einen Editor, eine Mail-App oder
   eine Cloud-Vorschau — lässt sonst den ganzen Import scheitern, obwohl 62
   Bücher davon völlig in Ordnung wären. */

/** Steuerzeichen INNERHALB von Texten reparieren, außerhalb ersatzlos streichen. */
function repairControlChars(text) {
  let out = ''
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    const code = text.charCodeAt(i)
    if (inString) {
      if (escaped) { out += c; escaped = false; continue }
      if (c === '\\') { out += c; escaped = true; continue }
      if (c === '"') { out += c; inString = false; continue }
      if (code < 0x20) {
        // Zeilenumbruch, Wagenrücklauf und Tabulator behalten ihre Bedeutung,
        // alles andere ist Datenmüll ohne Inhalt und fällt weg.
        if (code === 10) out += '\\n'
        else if (code === 13) out += '\\r'
        else if (code === 9) out += '\\t'
        continue
      }
      out += c
    } else {
      if (c === '"') inString = true
      // Zwischen den Strukturzeichen sind nur Leerraum-Zeichen erlaubt.
      if (code < 0x20 && code !== 10 && code !== 13 && code !== 9) continue
      out += c
    }
  }
  return out
}

/**
 * Wie JSON.parse, aber verzeiht ein BOM am Dateianfang und beschädigte
 * Steuerzeichen. Meldet `repaired: true`, wenn etwas repariert werden musste,
 * damit die Oberfläche das ehrlich sagen kann.
 */
export function parseBackupText(rawText) {
  const text = String(rawText).replace(/^\uFEFF/, '')
  try {
    return { data: JSON.parse(text), repaired: text.length !== String(rawText).length }
  } catch (first) {
    let data
    try {
      data = JSON.parse(repairControlChars(text))
    } catch {
      throw new Error(`Die Datei ist beschädigt und ließ sich nicht lesen (${first.message}).`)
    }
    return { data, repaired: true }
  }
}
