import { Component } from 'react'

/* Fängt Fehler ab, die sonst die ganze Oberfläche verschwinden lassen würden.
   Ohne das hier endet ein einzelner Programmfehler in einer weißen Seite,
   ohne jeden Hinweis, was passiert ist. */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Libri ist auf einen Fehler gelaufen:', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="screen">
        <div className="screen-head"><h1 className="wordmark">Libri</h1></div>
        <div className="notice warn">
          <p><b>Da ist etwas schiefgelaufen.</b></p>
          <p>{String(this.state.error?.message || this.state.error)}</p>
        </div>
        <div className="btn-row">
          <button className="btn btn-primary" onClick={() => location.reload()}>
            Neu laden
          </button>
          <button className="btn" onClick={() => this.setState({ error: null })}>
            Weiterklicken
          </button>
        </div>
        <p className="hint" style={{ textAlign: 'left' }}>
          Deine Bücher sind davon nicht betroffen. Wenn du magst, sichere sie
          vorsichtshalber unter Mehr → Sicherung.
        </p>
      </div>
    )
  }
}
