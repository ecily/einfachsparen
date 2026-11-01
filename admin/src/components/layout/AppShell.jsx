import './appShell.css'
import { shouldHandleLink } from '../../utils/navigationState'

export function AppShell({ header, footer, children, onNavigateUrl }) {
  function handleLink(event) {
    const anchor = event.target.closest('a[href]')
    if (!shouldHandleLink(event, anchor, window.location.origin)) return
    event.preventDefault()
    onNavigateUrl(anchor.href)
  }

  return (
    <div className="shell app-shell" onClick={handleLink}>
      <a className="app-shell__skip" href="#main-content" onClick={event => {
        event.preventDefault()
        const main = document.getElementById('main-content')
        main?.focus({ preventScroll: true })
        main?.scrollIntoView({ block: 'start', behavior: 'instant' })
      }}>Zum Hauptinhalt</a>
      <header className="app-shell__header">{header}</header>
      <main id="main-content" className="app-shell__main" tabIndex={-1}>
        {children}
      </main>
      <footer className="app-shell__footer">{footer}</footer>
    </div>
  )
}
