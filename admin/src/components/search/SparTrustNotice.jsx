import {
  SPAR_TRUST_CONCLUSION,
  SPAR_TRUST_INTRO,
  SPAR_TRUST_TITLE,
  shouldShowSparTrustNotice,
} from '../../utils/sparTrustNotice'

export function SparTrustNotice({ retailers = [] }) {
  if (!shouldShowSparTrustNotice(retailers)) return null

  return (
    <aside className="limited-coverage-notice limited-coverage-notice--spar" role="note" aria-label={SPAR_TRUST_TITLE}>
      <strong>{SPAR_TRUST_TITLE}</strong>
      <span>{SPAR_TRUST_INTRO}</span>
      <span>{SPAR_TRUST_CONCLUSION}</span>
    </aside>
  )
}
