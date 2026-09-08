import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, addBook, emptyBook } from './lib/db'
import Library from './components/Library'
import Scan from './components/Scan'
// Erst laden, wenn der Tab wirklich geöffnet wird — verkleinert das, was beim
// Start heruntergeladen und ausgeführt werden muss.
const Stats = lazy(() => import('./components/Stats'))
const Settings = lazy(() => import('./components/Settings'))
import BookDetail from './components/BookDetail'
import BookForm from './components/BookForm'
import { Icon, Toast } from './components/ui'
import DbGate, { useDbStatus } from './components/DbGate'

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
  const [toast, setToast] = useState(null)

  const openBook = useLiveQuery(
    () => (openId ? db.books.get(openId) : undefined),
    [openId],
    undefined
  )

  // Stabile Funktion: würde sie bei jedem Rendern neu entstehen, gälte für
  // die gemerkten Buchkarten jedes Mal alles als verändert und memo liefe leer.
  const openBookById = useCallback((b) => setOpenId(b.id), [])

  const notify = useCallback((message) => {
    setToast(message)
    setTimeout(() => setToast((t) => (t === message ? null : t)), 2600)
  }, [])

  // Zurück-Taste schließt erst die Detailansicht, nicht die App.
  useEffect(() => {
    if (!openId && !draft) return
    history.pushState({ sheet: true }, '')
    let poppedByUser = false
    const onPop = () => {
      poppedByUser = true
      setOpenId(null)
      setDraft(null)
    }
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      // Per Knopf geschlossen: den eigenen History-Eintrag wieder abräumen.
      if (!poppedByUser && history.state?.sheet) history.back()
    }
  }, [openId, draft])

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
          onScan={() => setTab('scan')}
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
          onFound={(book, unknown, pending) => {
            setDraftUnknown(unknown)
            setDraftPending(pending || null)
            setDraft(book)
          }}
          onExisting={(book) => {
            notify(`„${book.title}“ steht schon im Regal`)
            setOpenId(book.id)
          }}
          onManual={() => {
            setDraftUnknown(false)
            setDraftPending(null)
            setDraft(emptyBook())
          }}
        />
      )}

      <Suspense fallback={
        <div className="screen"><p className="hint"><span className="spinner" /> Einen Moment…</p></div>
      }>
        {tab === 'stats' && <Stats />}
        {tab === 'settings' && <Settings notify={notify} />}
      </Suspense>

      {draft && (
        <BookForm
          draft={draft}
          title={draftUnknown ? 'Nichts gefunden — bitte selbst ausfüllen' : 'Stimmt das so?'}
          pending={draftPending}
          submitLabel="Ins Regal"
          onCancel={() => setDraft(null)}
          onSave={(data) => {
            // Sofort schließen und bestätigen; das Schreiben läuft nebenher.
            setDraft(null)
            notify(`„${data.title}“ steht im Regal`)
            addBook(data).catch(() => notify('Speichern hat nicht geklappt.'))
          }}
        />
      )}

      {openBook && (
        <BookDetail book={openBook} onClose={closeSheets} notify={notify} />
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
