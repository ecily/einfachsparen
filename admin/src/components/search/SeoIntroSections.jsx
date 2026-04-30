import { SectionCard } from '../layout/SectionCard'

export function SeoIntroSections() {
  return (
    <SectionCard style={{ marginBottom: '1rem' }}>
      <div className="selection-block">
        <div className="selection-block__header">
          <p className="eyebrow">So funktioniert kaufklug.at</p>
          <h2>Schnell von der Auswahl zur Einkaufsliste.</h2>
        </div>

        <div className="selection-summary-grid">
          <div className="selection-summary-card">
            <strong>1. Geschäfte wählen</strong>
            <span>Wähle die Supermärkte, die für dich erreichbar sind.</span>
          </div>

          <div className="selection-summary-card">
            <strong>2. Angebote anzeigen</strong>
            <span>Geschäfte reichen aus. Du kannst sofort aktuelle Aktionen laden.</span>
          </div>

          <div className="selection-summary-card">
            <strong>3. Optional eingrenzen</strong>
            <span>Filtere nur dann nach Produkten, wenn du genauer suchen möchtest.</span>
          </div>

          <div className="selection-summary-card">
            <strong>4. Merken</strong>
            <span>Speichere interessante Angebote auf deiner Einkaufsliste fürs Handy.</span>
          </div>
        </div>
      </div>
    </SectionCard>
  )
}
