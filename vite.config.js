import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Relative Pfade: die App läuft damit unter jedem Repo-Namen und auch
// auf einer eigenen Domain, ohne dass hier etwas angepasst werden muss.
export default defineConfig({
  base: './',
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString())
  },
  build: {
    // "Deploy from a branch" braucht das fertige Ergebnis direkt im Repo,
    // nicht nur in der Action. docs/ lässt sich in GitHub Pages als Quelle
    // auswählen (Branch: main, Ordner: /docs).
    outDir: 'docs',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // ZXing bekommt einen festen Namen, damit die Ausnahme beim Vorabladen
        // im Service Worker zuverlässig greift.
        manualChunks(id) {
          if (id.includes('@zxing')) return 'zxing'
        },
        chunkFileNames(info) {
          return info.name === 'zxing'
            ? 'assets/zxing-[hash].js'
            : 'assets/[name]-[hash].js'
        }
      }
    }
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // injectRegister bewusst NICHT auf false setzen: nur im Standardmodus
      // ('auto') aktiviert die Bibliothek automatisch skipWaiting/clientsClaim,
      // also dass eine neue Version auch wirklich sofort übernommen wird statt
      // nur unbenutzt im Hintergrund zu warten.
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable.png'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Der ZXing-Fallback wiegt gut 400 KB und wird nur auf Geräten ohne
        // native Barcode-Erkennung gebraucht — also nicht auf Android. Deshalb
        // nicht vorab mitladen, sondern erst bei Bedarf holen und dann behalten.
        globIgnores: ['**/zxing*.js'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        // API-Antworten und Cover offline vorhalten
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/covers\.openlibrary\.org\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'cover-cache',
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'font-cache',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] }
            }
          }
        ]
      },
      manifest: {
        name: 'Libri — Lesetracker',
        short_name: 'Libri',
        description: 'Deine Bibliothek: scannen, sortieren, lesen.',
        lang: 'de',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#171b21',
        theme_color: '#171b21',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      }
    })
  ]
})
