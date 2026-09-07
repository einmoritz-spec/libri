import React from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import './styles.css'

// Prüft beim Start und danach alle 60s, ob eine neue Version bereitsteht,
// und übernimmt sie sofort. So bleibt die installierte App nie länger als
// eine Minute auf einem veralteten Stand hängen — der Fall, der als
// "Klicks tun nichts" oder "lädt ewig" auffällt.
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    updateSW(true)
  }
})
setInterval(() => updateSW(), 60_000)

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
