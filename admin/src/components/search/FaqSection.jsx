import { SectionCard } from '../layout/SectionCard'

export function FaqSection() {
  const faqs = [
    {
      question: 'Was ist kaufklug.at?',
      answer:
        'kaufklug.at ist eine kostenlose Orientierungshilfe für aktuelle Supermarkt-Angebote, Prospekte und Aktionen in Österreich. Die Seite hilft dir, Angebote einfacher zu finden, nach Geschäften und Kategorien zu filtern und interessante Aktionen auf deine Einkaufsliste zu setzen.',
    },
    {
      question: 'Ist kaufklug.at kostenlos?',
      answer:
        'Ja. kaufklug.at ist derzeit kostenlos nutzbar, weil das Projekt unabhängig aufgebaut wird.',
    },
    {
      question: 'Für wen ist kaufklug.at gedacht?',
      answer:
        'Für alle, die beim täglichen Einkauf sparen möchten oder sparen müssen: Familien, Pensionisten, Studenten, Alleinerziehende und alle preisbewussten Haushalte in Österreich.',
    },
    {
      question: 'Sind die angezeigten Angebote garantiert richtig?',
      answer:
        'Nein. kaufklug.at zeigt Angebotsinformationen als unverbindliche Orientierungshilfe. Preise, Verfügbarkeit, Bedingungen und regionale Gültigkeit können abweichen. Bitte prüfe vor dem Kauf immer die aktuellen Angaben des jeweiligen Händlers.',
    },
    {
      question: 'Warum sehe ich manchmal keine genaue Ersparnis?',
      answer:
        'Manche Prospekte nennen nur den Aktionspreis, aber keinen Normalpreis. In solchen Fällen zeigt kaufklug.at den Aktionspreis, aber keine konkrete Euro-Ersparnis.',
    },
    {
      question: 'Funktioniert kaufklug.at besser am Smartphone?',
      answer:
        'Ja. Die Website bleibt nutzbar, aber kaufklug.at ist vor allem für das Smartphone gedacht. So kannst du Angebote direkt beim Einkaufen nutzen und interessante Aktionen auf deiner Einkaufsliste speichern.',
    },
  ]

  return (
    <SectionCard style={{ marginTop: '1rem' }}>
      <div className="selection-block">
        <div className="selection-block__header">
          <p className="eyebrow">Häufige Fragen</p>
          <h2>Kurz erklärt.</h2>
          <p>Die wichtigsten Antworten zu kaufklug.at, Angeboten, Kosten und Nutzung.</p>
        </div>

        <div style={{ display: 'grid', gap: '0.85rem' }}>
          {faqs.map((item) => (
            <article key={item.question} className="selection-summary-card">
              <strong>{item.question}</strong>
              <span>{item.answer}</span>
            </article>
          ))}
        </div>
      </div>
    </SectionCard>
  )
}
