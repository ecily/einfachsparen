import {
  TRUST_PAGE_H1,
  TRUST_PAGE_INTRO,
  TRUST_PAGE_LINKS,
  TRUST_PAGE_SECTIONS,
} from '../../config/trustPage'
import { LegalPageShell, LegalSection } from '../legal/LegalPageShell'

export function TrustPage() {
  return (
    <LegalPageShell eyebrow="Über kaufklug" title={TRUST_PAGE_H1} subtitle={TRUST_PAGE_INTRO}>
      {TRUST_PAGE_SECTIONS.map((section) => (
        <LegalSection title={section.title} key={section.title}>
          {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        </LegalSection>
      ))}

      <nav aria-label="Mehr über kaufklug">
        <h2>Weitere Informationen</h2>
        <ul>
          {TRUST_PAGE_LINKS.map((link) => (
            <li key={link.path}><a href={link.path}>{link.label}</a></li>
          ))}
        </ul>
      </nav>
    </LegalPageShell>
  )
}
