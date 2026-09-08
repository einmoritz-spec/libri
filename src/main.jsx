import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

// Die Update-Übernahme selbst (skipWaiting/clientsClaim + Reload) läuft über
// die automatisch eingebundene Registrierung — die einzige Variante, bei der
// eine neue Version zuverlässig sofort aktiv wird statt nur im Hintergrund zu
// warten. Hier nur zusätzlich: alle 60s aktiv nachfragen, ob es was Neues
// gibt, statt auf den viel selteneren Standardrhythmus des Browsers zu warten.
// Steuert den kbd-nav-Zustand für die Fokus-Umrandung in styles.css: nur
// echte Tab-Navigation setzt sie, jede Berührung/Klick nimmt sie wieder weg.
window.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') document.body.classList.add('kbd-nav')
})
window.addEventListener('pointerdown', () => {
  document.body.classList.remove('kbd-nav')
})

if ('serviceWorker' in navigator) {
  setInterval(() => {
    navigator.serviceWorker.getRegistration().then((reg) => reg?.update())
  }, 60_000)
}

// Ein Klick, der eine abgelehnte Promise auslöst, sah bisher aus wie "nichts
// passiert". Ab jetzt eine sichtbare Meldung statt Stille — unabhängig von
// React, damit sie auch greift, wenn React selbst betroffen ist.
window.addEventListener('unhandledrejection', (e) => {
  console.error('Unbehandelter Fehler:', e.reason)
  const bar = document.createElement('div')
  bar.textContent = 'Da ist etwas schiefgelaufen. Nochmal versuchen.'
  bar.style.cssText =
    'position:fixed;left:50%;bottom:90px;transform:translateX(-50%);' +
    'background:#262e38;border:1px solid #2e3742;color:#e9e4da;' +
    'padding:9px 18px;border-radius:999px;font:14px system-ui;z-index:999;' +
    'box-shadow:0 8px 22px rgba(0,0,0,.5)'
  document.body.appendChild(bar)
  setTimeout(() => bar.remove(), 3200)
})

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
