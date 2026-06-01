import { useState } from 'react'
import { saveBetaFeedback } from '../../api'

const FEEDBACK_TYPES = [
  ['idea', 'Idee'],
  ['market_request', 'Neuer Markt / Haendler'],
  ['shopping_list', 'Einkaufsliste'],
  ['route_optimization', 'App / Route'],
  ['price_quality', 'Preise oder Angebotsqualitaet'],
  ['other', 'Sonstiges'],
]

const FEATURE_OPTIONS = [
  ['new_markets', 'Neue Maerkte integrieren'],
  ['hardware_stores', 'Baumaerkte'],
  ['furniture_stores', 'Moebelhaeuser'],
  ['favorite_items_alert', 'Lieblingsartikel beobachten'],
  ['shopping_list_alerts', 'Automatische Angebots-Benachrichtigung'],
  ['optimal_shopping_route', 'Optimale Einkaufsroute'],
  ['fewer_store_stops', 'Weniger Stopps beim Einkauf'],
  ['cheapest_alternatives', 'Guenstigere Alternativen finden'],
  ['app', 'App-Funktionen'],
]

const initialForm = {
  name: '',
  email: '',
  feedbackType: 'other',
  featureInterests: [],
  requestedMarkets: '',
  message: '',
  website: '',
}

export function FeedbackPage() {
  const [form, setForm] = useState(initialForm)
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')

  function updateField(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }))
    setError('')
  }

  function toggleFeature(value) {
    setForm((current) => {
      const selected = current.featureInterests.includes(value)
      return {
        ...current,
        featureInterests: selected
          ? current.featureInterests.filter((item) => item !== value)
          : [...current.featureInterests, value],
      }
    })
    setError('')
  }

  async function handleSubmit(event) {
    event.preventDefault()

    try {
      setStatus('sending')
      setError('')
      await saveBetaFeedback({
        name: form.name,
        email: form.email,
        feedbackType: form.feedbackType,
        featureInterests: form.featureInterests,
        requestedMarkets: form.requestedMarkets,
        message: form.message,
        website: form.website,
      })
      setForm(initialForm)
      setStatus('sent')
    } catch {
      setStatus('failed')
      setError('Das Feedback konnte gerade nicht gesendet werden. Bitte versuche es spaeter erneut.')
    }
  }

  return (
    <section className="feedback-page" aria-labelledby="feedback-title">
      <div className="feedback-page__intro">
        <p className="eyebrow">Beta-Feedback</p>
        <h1 id="feedback-title">Feedback senden</h1>
        <p>
          kaufklug ist gerade in der Beta. Wir freuen uns ueber Ideen, Wuensche und Hinweise,
          damit wir besser verstehen, was dir beim Einkaufen wirklich helfen wuerde.
        </p>
      </div>

      <div className="feedback-page__grid">
        <aside className="feedback-page__questions" aria-label="Leitfragen">
          <h2>Was uns interessiert</h2>
          <ul>
            <li>Welche Maerkte sollen wir als Naechstes integrieren?</li>
            <li>Waeren Baumaerkte, Moebelhaeuser oder weitere Drogerie- und Supermarktketten interessant?</li>
            <li>Wuerdest du eine Einkaufsliste nutzen, die dich bei Angeboten fuer Lieblingsartikel informiert?</li>
            <li>Soll die App eine optimale Einkaufsroute berechnen?</li>
            <li>Soll kaufklug pruefen, ob du deinen Einkauf mit weniger Stopps erledigen kannst?</li>
            <li>Soll kaufklug guenstigere Alternativen zu Artikeln auf deiner Einkaufsliste vorschlagen?</li>
          </ul>
        </aside>

        <form className="feedback-page__form" onSubmit={handleSubmit}>
          <div className="feedback-page__honeypot" aria-hidden="true">
            <label>
              Website
              <input
                type="text"
                value={form.website}
                onChange={(event) => updateField('website', event.target.value)}
                tabIndex="-1"
                autoComplete="off"
              />
            </label>
          </div>

          <label className="feedback-page__field">
            Name <span>optional</span>
            <input
              type="text"
              value={form.name}
              maxLength="120"
              autoComplete="name"
              onChange={(event) => updateField('name', event.target.value)}
            />
          </label>

          <label className="feedback-page__field">
            E-Mail <span>optional</span>
            <input
              type="email"
              value={form.email}
              maxLength="254"
              autoComplete="email"
              onChange={(event) => updateField('email', event.target.value)}
            />
          </label>

          <label className="feedback-page__field feedback-page__field--wide">
            Feedback-Typ <span>optional</span>
            <select
              value={form.feedbackType}
              onChange={(event) => updateField('feedbackType', event.target.value)}
            >
              {FEEDBACK_TYPES.map(([value, label]) => (
                <option value={value} key={value}>{label}</option>
              ))}
            </select>
          </label>

          <fieldset className="feedback-page__fieldset">
            <legend>Feature-Wuensche <span>optional</span></legend>
            <div className="feedback-page__checks">
              {FEATURE_OPTIONS.map(([value, label]) => (
                <label key={value} className="feedback-page__check">
                  <input
                    type="checkbox"
                    checked={form.featureInterests.includes(value)}
                    onChange={() => toggleFeature(value)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className="feedback-page__field feedback-page__field--wide">
            Wunschmaerkte / Haendler <span>optional</span>
            <input
              type="text"
              value={form.requestedMarkets}
              maxLength="500"
              placeholder="z. B. Unimarkt, Bauhaus, IKEA ..."
              onChange={(event) => updateField('requestedMarkets', event.target.value)}
            />
          </label>

          <label className="feedback-page__field feedback-page__field--wide">
            Nachricht <strong>erforderlich</strong>
            <textarea
              value={form.message}
              required
              minLength="20"
              maxLength="3000"
              rows="7"
              onChange={(event) => updateField('message', event.target.value)}
            />
          </label>

          <p className="feedback-page__privacy">
            Bitte sende keine sensiblen persoenlichen Daten. Name und E-Mail sind optional und werden nur verwendet,
            falls wir Rueckfragen haben.
          </p>

          {status === 'sent' ? (
            <p className="feedback-page__status feedback-page__status--success" role="status">
              Danke. Dein Feedback wurde gesendet und hilft uns, kaufklug gezielt zu verbessern.
            </p>
          ) : null}
          {error ? (
            <p className="feedback-page__status feedback-page__status--error" role="alert">
              {error}
            </p>
          ) : null}

          <div className="feedback-page__actions">
            <button type="submit" className="crawl-button" disabled={status === 'sending'}>
              {status === 'sending' ? 'Feedback wird gesendet ...' : 'Feedback senden'}
            </button>
          </div>
        </form>
      </div>
    </section>
  )
}
