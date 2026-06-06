import { CONTACT_EMAIL } from '../../config/constants'
import { LegalPageShell, LegalSection } from './LegalPageShell'

export function ImpressumPage() {
  return (
    <LegalPageShell
      eyebrow="Rechtliches"
      title="Impressum"
      subtitle="Betreiber- und Medieninhaberangaben zu kaufklug.at."
    >
      <LegalSection title="Medieninhaber und Betreiber">
        <p>
          <strong>Mag. Andreas Franz MA</strong>
          <br />
          Brunnenweg 16
          <br />
          8111 Gratwein-Straßengel
          <br />
          Österreich
        </p>
      </LegalSection>

      <LegalSection title="Kontakt">
        <p>
          E-Mail:{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
          <br />
          Telefon:{' '}
          <a href="tel:+436642437638">
            +43 664 2437638
          </a>
        </p>
      </LegalSection>

      <LegalSection title="Projektstatus">
        <p>
          kaufklug.at ist derzeit ein privates, kostenlos nutzbares Projekt. Über diese Website werden derzeit keine
          Waren oder Dienstleistungen verkauft. Die Website dient der unverbindlichen Orientierung über öffentlich
          verfügbare Angebotsinformationen. Ein Einkauf oder Vertrag kommt nicht mit kaufklug.at zustande, sondern
          ausschließlich mit dem jeweiligen Händler.
        </p>
      </LegalSection>

      <LegalSection title="Verantwortlichkeit für Inhalte">
        <p>
          Verantwortlich für die eigenen Inhalte dieser Website ist der oben genannte Medieninhaber und Betreiber.
          Hinweise auf fehlerhafte, veraltete oder missverständliche Inhalte können jederzeit an{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>{' '}
          gesendet werden.
        </p>
      </LegalSection>

      <LegalSection title="Gewerbe-, Firmenbuch- und UID-Angaben">
        <p>
          Es wird derzeit kein über diese Website aktiv ausgeübtes Gewerbe angegeben. Eine Firmenbuchnummer besteht
          nicht. Eine UID-Nummer wird derzeit nicht verwendet.
        </p>
      </LegalSection>

      <LegalSection title="Grundlegende Richtung">
        <p>
          kaufklug.at stellt Informationen rund um Supermarkt-Angebote, Prospekte, Aktionen, Einkauf und Sparen in
          Österreich bereit. Ziel ist eine einfache, kostenlose Orientierungshilfe für den Alltag.
        </p>
      </LegalSection>
    </LegalPageShell>
  )
}

export function PrivacyPage() {
  return (
    <LegalPageShell
      eyebrow="Rechtliches"
      title="Datenschutz"
      subtitle="Hinweise zur Verarbeitung personenbezogener Daten bei der Nutzung von kaufklug.at."
    >
      <LegalSection title="Verantwortlicher">
        <p>
          Mag. Andreas Franz MA
          <br />
          Brunnenweg 16
          <br />
          8111 Gratwein-Straßengel
          <br />
          Österreich
          <br />
          E-Mail:{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
        </p>
      </LegalSection>

      <LegalSection title="Zweck der Website">
        <p>
          kaufklug.at hilft dabei, öffentlich verfügbare Angebotsinformationen übersichtlich darzustellen, Angebote zu
          finden, eine Einkaufsliste lokal zu nutzen und Feedback zur Verbesserung des Beta-Produkts zu senden. Die
          Nutzung ist derzeit kostenlos und ohne Nutzerkonto möglich.
        </p>
      </LegalSection>

      <LegalSection title="Technische Zugriffsdaten">
        <p>
          Beim Aufruf der Website können technisch notwendige Zugriffsdaten verarbeitet werden, etwa IP-Adresse,
          Zeitpunkt des Zugriffs, abgerufene Inhalte, Browserinformationen und technische Statusmeldungen. Diese Daten
          sind für Bereitstellung, Sicherheit, Fehleranalyse und stabilen Betrieb der Website erforderlich. Die
          Verarbeitung erfolgt über die für den Betrieb eingesetzte technische Infrastruktur; eine darüber hinausgehende
          werbliche Auswertung ist nicht Zweck dieser Daten.
        </p>
      </LegalSection>

      <LegalSection title="Feedback und Fehlermeldungen">
        <p>
          Wenn du Feedback sendest oder einen Fehler meldest, werden die eingegebenen Inhalte verarbeitet. Dazu können
          je nach Formular Nachricht, Feedback-Typ, ausgewählte Themen, Wunschmärkte, freiwillig angegebene Kontakt- oder
          Namensdaten und technische Zustellinformationen gehören. Name und E-Mail-Adresse sind freiwillig und werden nur
          für Rückfragen verwendet.
        </p>
        <p>
          Feedback wird genutzt, um Fehler zu prüfen, Angebotsdarstellungen zu verbessern und die Beta-Version von
          kaufklug.at weiterzuentwickeln. Bitte sende keine sensiblen personenbezogenen Daten und keine Informationen,
          die für die Fehlerprüfung oder Produktverbesserung nicht erforderlich sind.
        </p>
      </LegalSection>

      <LegalSection title="Pseudonyme Nutzungsmessung">
        <p>
          kaufklug.at erfasst einfache, pseudonyme Nutzungsereignisse, damit das Projekt sachlich bewertet und verbessert
          werden kann. Dazu zählen zum Beispiel Seitenaufrufe, geöffnete Einkaufsliste, gestartete Angebotssuchen,
          Suchergebnisse und hinzugefügte Angebote. Es werden dabei keine Namen,
          E-Mail-Adressen, vollständigen IP-Adressen, exakten Standortdaten oder Nutzerkonten gespeichert.
        </p>
        <p>
          Zur groben Wiedererkennung einer Sitzung kann lokal im Browser eine zufällig erzeugte Sitzungskennung
          gespeichert werden. Am Server wird daraus nur ein gehashter Wert verarbeitet. Die Auswertung dient
          insbesondere der Produktverbesserung, Stabilitätsprüfung und späteren anonymen KPI-Auswertung.
        </p>
      </LegalSection>

      <LegalSection title="API-Kommunikation">
        <p>
          Die Webanwendung ruft Angebots-, Filter-, Qualitäts-, Status- und Nutzungsdaten von einem Backend ab. Dabei
          können technische Zugriffsdaten an den Server übertragen werden. Es werden derzeit keine Nutzerkonten über
          diese Frontend-Ansicht geführt.
        </p>
      </LegalSection>

      <LegalSection title="Lokale Speicherung">
        <p>
          Die Einkaufsliste, der Speicherhinweis und eine pseudonyme Sitzungskennung für die Nutzungsmessung werden lokal
          im Browser des jeweiligen Geräts gespeichert. Diese Daten werden nicht benötigt, um die Website grundsätzlich
          aufzurufen, erleichtern aber die Nutzung und die Verbesserung des Projekts. Nutzerinnen und Nutzer können die
          Einkaufsliste jederzeit in der Anwendung löschen oder lokale Browserdaten entfernen.
        </p>
      </LegalSection>

      <LegalSection title="Rechtsgrundlagen und Speicherdauer">
        <p>
          Die Verarbeitung technischer Betriebsdaten, pseudonymer Nutzungsereignisse, lokaler Funktionsdaten und
          eingehender Feedbacks erfolgt grundsätzlich auf Basis berechtigter Interessen an Betrieb, Sicherheit,
          Fehlerbehebung und Produktverbesserung. Soweit du freiwillig Kontakt- oder Feedbackdaten übermittelst, werden
          diese zur Bearbeitung deiner Anfrage und zur Verbesserung von kaufklug.at verwendet.
        </p>
        <p>
          Personenbezogene Daten werden nur so lange aufbewahrt, wie es für Betrieb, Fehleranalyse, Bearbeitung von
          Anfragen, Nachvollziehbarkeit berechtigter Interessen oder gesetzliche Pflichten erforderlich ist. Lokale
          Browserdaten kannst du selbst in der Anwendung oder über die Browsereinstellungen löschen.
        </p>
      </LegalSection>

      <LegalSection title="Externe QR-Code-Dienste">
        <p>
          Derzeit wird in der sichtbaren Webanwendung kein QR-Code zur Android-Testversion geladen. Falls später wieder
          ein QR-Code angezeigt wird, kann dabei eine technische Verbindung zu einem externen QR-Code-Dienst entstehen.
        </p>
      </LegalSection>

      <LegalSection title="Kontaktaufnahme">
        <p>
          Wenn du per E-Mail oder über das Feedbackformular Kontakt aufnimmst, werden die von dir übermittelten Daten zur
          Bearbeitung der Anfrage verarbeitet. Eine Weitergabe erfolgt nicht ohne Anlass, außer sie ist zur Bearbeitung,
          Rechtsverfolgung, technischen Zustellung oder Erfüllung gesetzlicher Pflichten erforderlich.
        </p>
      </LegalSection>

      <LegalSection title="Rechte betroffener Personen">
        <p>
          Betroffene Personen können nach Maßgabe der DSGVO insbesondere Auskunft, Berichtigung, Löschung,
          Einschränkung, Datenübertragbarkeit und Widerspruch geltend machen. Zudem besteht das Recht auf Beschwerde bei
          der österreichischen Datenschutzbehörde. Datenschutzanfragen können an{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>{' '}
          gerichtet werden.
        </p>
      </LegalSection>
    </LegalPageShell>
  )
}

export function LiabilityPage() {
  return (
    <LegalPageShell
      eyebrow="Rechtliches"
      title="Nutzungs- und Haftungshinweise"
      subtitle="Wichtige Hinweise zur unverbindlichen Nutzung von kaufklug.at und zu Angebotsinformationen."
    >
      <LegalSection title="Unverbindliche Orientierungshilfe">
        <p>
          kaufklug.at stellt Angebots-, Preis-, Rabatt-, Produkt-, Verfügbarkeits- und Gültigkeitsinformationen
          ausschließlich als unverbindliche Orientierungshilfe bereit. Die dargestellten Informationen können aus
          öffentlich zugänglichen Quellen, Prospekten, Online-Angeboten oder automatisierten Auswertungen abgeleitet sein
          und können unvollständig, veraltet, fehlerhaft oder regional unterschiedlich sein. Das gilt insbesondere für
          Preise, Sorten, Packungsgrößen, Mengen, Aktionszeiträume, Kundenkarten- oder App-Bedingungen und regionale
          Verfügbarkeit.
        </p>
      </LegalSection>

      <LegalSection title="Keine Händlerstellung und keine verbindliche Preiszusage">
        <p>
          kaufklug.at ist kein Händler, verkauft keine Waren und gibt keine verbindlichen Preis-, Rabatt-,
          Verfügbarkeits- oder Produkteigenschaftszusagen ab. Maßgeblich sind ausschließlich die jeweils aktuellen
          Angaben, Preise, Bedingungen und Verfügbarkeiten des jeweiligen Händlers am Verkaufsort, im Online-Shop oder im
          offiziellen Prospekt des Händlers.
        </p>
      </LegalSection>

      <LegalSection title="Keine Gewähr für Angebotsinformationen">
        <p>
          Eine Gewähr für Richtigkeit, Vollständigkeit, Aktualität, Vergleichbarkeit, Verfügbarkeit oder regionale
          Gültigkeit der dargestellten Angebote wird nicht übernommen. Nutzerinnen und Nutzer sind verpflichtet, Preise,
          Bedingungen, Gültigkeit, Sorten, Packungsgrößen, Mengenbeschränkungen, Kundenkarten-/App-Erfordernisse und
          Verfügbarkeit vor dem Kauf selbst beim jeweiligen Händler zu prüfen.
        </p>
      </LegalSection>

      <LegalSection title="Haftungsbeschränkung">
        <p>
          Soweit gesetzlich zulässig, ist eine Haftung von kaufklug.at für Schäden, Nachteile, Mehrkosten, entgangene
          Ersparnisse oder Kaufentscheidungen, die aufgrund angezeigter Angebotsinformationen entstehen, ausgeschlossen.
          Die Haftung für vorsätzlich oder grob fahrlässig verursachte Schäden bleibt unberührt.
        </p>
      </LegalSection>

      <LegalSection title="Marken, Händler und Rechteinhaber">
        <p>
          Alle genannten Marken, Produktnamen, Händlerbezeichnungen und sonstigen Kennzeichen sind Eigentum der
          jeweiligen Rechteinhaber. Die Nennung dient ausschließlich der sachlichen Zuordnung öffentlich zugänglicher
          Angebotsinformationen. kaufklug.at ist ein unabhängiges Projekt und steht in keiner offiziellen Verbindung zu
          den angezeigten Händlern, Marken oder Rechteinhabern, sofern nicht ausdrücklich anders angegeben.
        </p>
      </LegalSection>

      <LegalSection title="Fehler melden und Korrekturen">
        <p>
          Sollten Rechteinhaber, Händler, Nutzerinnen oder Nutzer der Ansicht sein, dass Inhalte fehlerhaft,
          unzutreffend, veraltet oder rechtsverletzend sind, wird um Mitteilung an{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>{' '}
          ersucht. Nutzerinnen und Nutzer können Fehler auch über <a href="/feedback">Feedback senden</a> melden.
          Beanstandete Inhalte werden nach nachvollziehbarer Prüfung korrigiert, ergänzt oder entfernt.
        </p>
      </LegalSection>
    </LegalPageShell>
  )
}

export function CookiesPage() {
  return (
    <LegalPageShell
      eyebrow="Rechtliches"
      title="Cookie- und Speicherhinweis"
      subtitle="Informationen zu Cookies, lokaler Speicherung und technischen Verbindungen."
    >
      <LegalSection title="Keine Marketing-Cookies">
        <p>
          kaufklug.at verwendet derzeit keine Marketing-Cookies in der sichtbaren Webanwendung. Es werden derzeit keine
          Werbeprofile erstellt und keine sichtbaren Tracking-Pixel wie Google Analytics, Meta Pixel oder vergleichbare
          Dienste eingesetzt.
        </p>
        <p>
          Sollte kaufklug.at künftig Analyse-, Marketing- oder andere nicht notwendige Cookies einsetzen, würde dies
          gesondert erklärt und, soweit erforderlich, erst nach einer entsprechenden Einwilligung aktiviert.
        </p>
      </LegalSection>

      <LegalSection title="Lokale Speicherung im Browser">
        <p>
          Für die Einkaufsliste, den Speicherhinweis und eine pseudonyme Sitzungskennung verwendet kaufklug.at lokale
          Speicherung im Browser beziehungsweise auf dem Gerät. Diese Speicherung dient dazu, die Einkaufsliste lokal zu
          erhalten, den Cookie-/Speicherhinweis nicht bei jedem Besuch erneut anzuzeigen und einfache Nutzungskennzahlen
          ohne Nutzerkonto zu erfassen. Diese lokale Speicherung ist funktional beziehungsweise technisch für eine
          sinnvolle Nutzung der Beta-Version vorgesehen und dient nicht der Erstellung von Werbeprofilen.
        </p>
      </LegalSection>

      <LegalSection title="Pseudonyme Nutzungsmessung">
        <p>
          kaufklug.at zählt grundlegende Nutzungsereignisse wie Seitenaufrufe, Angebotssuchen und gespeicherte Angebote.
          Diese Messung erfolgt ohne Marketing-Cookies, ohne Login und ohne Speicherung
          von Namen, E-Mail-Adressen, vollständigen IP-Adressen oder exakten Standortdaten.
        </p>
      </LegalSection>

      <LegalSection title="Externe QR-Code-Dienste">
        <p>
          Derzeit wird in der sichtbaren Webanwendung kein QR-Code zur Android-Testversion geladen. Falls später wieder
          ein QR-Code angezeigt wird, kann dabei eine technische Verbindung zu einem externen QR-Code-Dienst entstehen.
        </p>
      </LegalSection>

      <LegalSection title="Browserdaten löschen">
        <p>
          Lokale Daten können über die Funktionen des Browsers gelöscht werden. Zusätzlich kann die Einkaufsliste direkt
          in der Anwendung geleert werden.
        </p>
      </LegalSection>
    </LegalPageShell>
  )
}
