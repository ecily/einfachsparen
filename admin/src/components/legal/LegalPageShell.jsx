import { SectionCard } from '../layout/SectionCard'

export function LegalPageShell({ eyebrow, title, subtitle, children }) {
  return (
    <SectionCard>
      <div className="selection-block">
        <div className="selection-block__header">
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>

        <div style={{ display: 'grid', gap: '1rem' }}>
          {children}
        </div>
      </div>
    </SectionCard>
  )
}

export function LegalSection({ title, children }) {
  return (
    <section>
      <h2>{title}</h2>
      <div style={{ display: 'grid', gap: '0.6rem' }}>
        {children}
      </div>
    </section>
  )
}
