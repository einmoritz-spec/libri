import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, addBook, emptyBook, isAutoBackupDue, exportLibrary, markBackupDone, trimAllCovers } from './lib/db'
import Library from './components/Library'
import Scan from './components/Scan'
// Erst laden, wenn der Tab wirklich geöffnet wird — verkleinert das, was beim
// Start heruntergeladen und ausgeführt werden muss.
const Stats = lazy(() => import('./components/Stats'))
const Settings = lazy(() => import('./components/Settings'))
const QuickEdit = lazy(() => import('./components/QuickEdit'))
import BookDetail from './components/BookDetail'
import AuthorView from './components/AuthorView'
import BookForm from './components/BookForm'
import { Icon, Toast } from './components/ui'
import DbGate, { useDbStatus } from './components/DbGate'
import { useBackLayer } from './lib/backStack'

const TABS = [
  { id: 'library', label: 'Bibliothek', icon: 'shelf' },
  { id: 'scan', label: 'Scannen', icon: 'scan' },
  { id: 'stats', label: 'Statistik', icon: 'stats' },
  { id: 'settings', label: 'Mehr', icon: 'gear' }
]

export default function App() {
  const dbState = useDbStatus()
  const [tab, setTab] = useState('library')
  const [openId, setOpenId] = useState(null)
  const [draft, setDraft] = useState(null)
  const [draftUnknown, setDraftUnknown] = useState(false)
  const [draftPending, setDraftPending] = useState(null)
  const [scanWish, setScanWish] = useState(false)
  const [authorName, setAuthorName] = useState(null)
  const [quickId, setQuickId] = useState(null)
  const [toast, setToast] = useState(null)

  const openBook = useLiveQuery(
    () => (openId ? db.books.get(openId) : undefined),
    [openId],
    undefined
  )

  const quickBook = useLiveQuery(
    () => (quickId ? db.books.get(quickId) : undefined),
    [quickId],
    undefined
  )

  // Stabile Funktion: würde sie bei jedem Rendern neu entstehen, gälte für
  // die gemerkten Buchkarten jedes Mal alles als verändert und memo liefe leer.
  const openBookById = useCallback((b) => setOpenId(b.id), [])
  const quickEditBook = useCallback((b) => setQuickId(b.id), [])

  const notify = useCallback((message) => {
    setToast(message)
    setTimeout(() => setToast((t) => (t === message ? null : t)), 2600)
  }, [])

  // Automatische Sicherung: einmal pro Woche im Hintergrund als Datei
  // ablegen, ohne dass dafür extra der Einstellungen-Screen besucht werden
  // muss. Läuft nur, wenn die Datenbank offen ist und mindestens ein Buch da
  // ist — eine leere Bibliothek muss niemand sichern.
  useEffect(() => {
    if (dbState !== 'ready') return
    let cancelled = false

    // Bewusst verzögert: die Sicherung liest sämtliche Cover aus der Datenbank.
    // Liefe sie sofort beim Start, konkurriert sie genau mit dem Aufbau der
    // Bibliothek — also erst, wenn die Oberfläche längst steht.
    const timer = setTimeout(() => {
      isAutoBackupDue().then(async (due) => {
        if (!due || cancelled) return
        try {
          const data = await exportLibrary()
          if (cancelled) return
          const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `libri-${new Date().toISOString().slice(0, 10)}.json`
          a.click()
          URL.revokeObjectURL(url)
          markBackupDone()
          notify('Automatische Sicherung gespeichert')
        } catch {
          // Kein Alarm, wenn's diesmal nicht klappt — die Erinnerung in den
          // Einstellungen greift als Auffangnetz.
        }
      })
    }, 8000)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbState])

  useEffect(() => {
    if (tab !== 'scan') setScanWish(false)
  }, [tab])

  // Einmalig im Hintergrund: schwarze Ränder von schon gespeicherten Covern
  // abschneiden. Später ist das über „Mehr“ jederzeit von Hand möglich.
  useEffect(() => {
    if (localStorage.getItem('libri:coversTrimmed1')) return undefined
    const timer = setTimeout(async () => {
      try {
        await trimAllCovers()
        localStorage.setItem('libri:coversTrimmed1', '1')
      } catch { /* beim nächsten Start erneut */ }
    }, 8000)
    return () => clearTimeout(timer)
  }, [])

  // Zurück-Geste: immer nur die oberste Ebene schließen. Ein anderer Tab als
  // die Bibliothek zählt als eine Ebene und führt zurück zum Start.
  useBackLayer(tab !== 'library', () => {
    localStorage.setItem('libri:libview', 'home')
    setTab('library')
  })
  useBackLayer(Boolean(quickId), () => setQuickId(null))
  useBackLayer(Boolean(authorName), () => setAuthorName(null))
  useBackLayer(Boolean(draft), () => setDraft(null))
  useBackLayer(Boolean(openId), () => setOpenId(null))

  function closeSheets() {
    setOpenId(null)
    setDraft(null)
  }

  // Solange die Datenbank nicht offen ist, hat die Oberfläche keine Grundlage.
  // Der Gate zeigt in diesem Fall einen erklärten Zustand statt eines
  // Ladekreises, der sich sonst endlos weiterdrehen würde.
  if (dbState !== 'ready') return <DbGate state={dbState} />

  return (
    <div className="app">
      {tab === 'library' && (
        <Library
          onOpen={openBookById}
          onLongPress={quickEditBook}
          onScan={() => setTab('scan')}
          notify={notify}
          onAddWish={() => { setScanWish(true); setTab('scan') }}
          onManual={() => {
            setDraftUnknown(false)
            setDraftPending(null)
            setDraft(emptyBook())
          }}
        />
      )}

      {tab === 'scan' && (
        <Scan
          notify={notify}
          wishMode={scanWish}
          onWishMode={setScanWish}
          onFound={(book, unknown, pending) => {
            setDraftUnknown(unknown)
            setDraftPending(pending || null)
            setDraft(scanWish ? { ...book, status: 'wishlist' } : book)
          }}
          onExisting={(book) => {
            notify(`„${book.title}“ steht schon im Regal`)
            setOpenId(book.id)
          }}
          onManual={() => {
            setDraftUnknown(false)
            setDraftPending(null)
            setDraft(scanWish ? emptyBook({ status: 'wishlist' }) : emptyBook())
          }}
        />
      )}

      <Suspense fallback={
        <div className="screen"><p className="hint"><span className="spinner" /> Einen Moment…</p></div>
      }>
        {tab === 'stats' && <Stats onOpenBook={openBookById} notify={notify} />}
        {tab === 'settings' && <Settings notify={notify} />}
      </Suspense>

      {quickBook && (
        <Suspense fallback={null}>
          <QuickEdit book={quickBook} onClose={() => setQuickId(null)} notify={notify} />
        </Suspense>
      )}

      {draft && (
        <BookForm
          draft={draft}
          title={draftUnknown ? 'Nichts gefunden — bitte selbst ausfüllen' : 'Stimmt das so?'}
          pending={draftPending}
          submitLabel={draft.status === 'wishlist' ? 'Auf die Wunschliste' : 'Ins Regal'}
          onCancel={() => setDraft(null)}
          onSave={(data) => {
            // Sofort schließen und bestätigen; das Schreiben läuft nebenher.
            setDraft(null)
            notify(data.status === 'wishlist' ? `„${data.title}“ steht auf der Wunschliste` : `„${data.title}“ steht im Regal`)
            addBook(data).catch(() => notify('Speichern hat nicht geklappt.'))
          }}
        />
      )}

      {/* Vor der Detailansicht eingeordnet: ein von hier geöffnetes Buch liegt darüber. */}
      {authorName && (
        <AuthorView name={authorName} onClose={() => setAuthorName(null)} onOpen={(b) => setOpenId(b.id)} />
      )}

      {openBook && (
        <BookDetail
          book={openBook} onClose={closeSheets} notify={notify}
          onAuthor={(name) => { setOpenId(null); setAuthorName(name) }}
        />
      )}

      <Toast message={toast} />

      <nav className="nav">
        {TABS.map((t) => (
          <button
            key={t.id}
            aria-current={tab === t.id}
            onClick={() => {
              closeSheets()
              setTab(t.id)
            }}
          >
            <Icon name={t.icon} />
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  )
}
