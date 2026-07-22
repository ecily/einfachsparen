import {
  SPAR_TRUST_DETAIL,
  SPAR_TRUST_SUMMARY,
  SPAR_TRUST_TITLE,
  shouldShowSparTrustNotice,
} from '../../utils/sparTrustNotice'

export function SparTrustNotice({ retailers = [] }) {
  if (!shouldShowSparTrustNotice(retailers)) return null

  return (
    <aside className="limited-coverage-notice limited-coverage-notice--spar" role="note" aria-label={SPAR_TRUST_TITLE}>
      <strong>{SPAR_TRUST_TITLE}</strong>
      <span>{SPAR_TRUST_SUMMARY}</span>
      <details className="limited-coverage-notice__details">
        <summary>Mehr erfahren</summary>
        <p>{SPAR_TRUST_DETAIL}</p>
      </details>
    </aside>
  )
}
