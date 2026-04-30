
import { SectionCard } from '../layout/SectionCard'

export function FaqSection() {
  const faqs = [
    {
      question: 'Was ist kaufklug.at?',
      answer:
        'kaufklug.at ist eine kostenlose Orientierungshilfe für aktuelle Supermarkt-Angebote, Prospekte und Aktionen in Österreich. Die Seite hilft dir, Angebote einfacher zu finden, Geschäfte zu vergleichen, Produkte zu suchen und interessante Aktionen auf deine Einkaufsliste zu setzen.',
    },
    {
      question: 'Wie funktioniert die Produktsuche?',
      answer:
        'Mit der Produktsuche kannst du nach Produkten, Marken oder Kategorien suchen, zum Beispiel nach Butter, Kaffee, Waschmittel oder Milka. kaufklug.at durchsucht die aktuell gefundenen Angebote über alle Händler hinweg und zeigt passende Treffer gesammelt an.',
    },
    {
      question: 'Muss ich zuerst ein Geschäft auswählen?',
      answer:
        'Nein. Die Produktsuche funktioniert unabhängig von deiner Händler- oder Kategorieauswahl. Wenn du gezielt Angebote bestimmter Geschäfte ansehen möchtest, kannst du weiterhin den normalen Angebotsbereich verwenden.',
    },
    {
      question: 'Was bringt mir die Einkaufsliste?',
      answer:
        'Du kannst interessante Angebote mit „Merken“ auf deine Einkaufsliste setzen. So sammelst du Aktionen, die du beim nächsten Einkauf schnell wiederfindest – besonders praktisch am Smartphone.',
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
      question: 'Was bedeuten Kundenkarte, App oder Bedingungen?',
      answer:
        'Manche Angebote gelten nur mit Kundenkarte, Händler-App, Rabattmarkerl, Mehrkauf oder anderen Bedingungen. kaufklug.at zeigt solche Hinweise, soweit sie aus den Angebotsdaten erkannt wurden. Bitte prüfe die Details zusätzlich beim jeweiligen Händler.',
    },
    {
      question: 'Funktioniert kaufklug.at besser am Smartphone?',
      answer:
        'Ja. Die Website bleibt auch am Desktop nutzbar, aber kaufklug.at ist besonders für das Smartphone gedacht. So kannst du Angebote direkt beim Einkaufen suchen, prüfen und auf deiner Einkaufsliste speichern.',
    },
  ]

  return (
    <SectionCard style={{ marginTop: '1rem' }}>
      <div className="selection-block">
        <div className="selection-block__header">
          <p className="eyebrow">Häufige Fragen</p>
          <h2>Kurz erklärt.</h2>
          <p>Die wichtigsten Antworten zu kaufklug.at, Produktsuche, Angeboten, Einkaufsliste und Nutzung.</p>
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