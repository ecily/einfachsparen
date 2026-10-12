const guides = {
  billa: ['BILLA und BILLA Plus sinnvoll vergleichen', [
    'Diese Seite bündelt BILLA und BILLA Plus. Prüfe beim einzelnen Angebot, welcher Markt genannt ist; die gemeinsame Seite bedeutet nicht, dass jeder Preis in beiden Märkten gilt.',
    'Vergleiche gleiche Produktformen über den Preis pro kg, Liter oder Stück. Ein günstigerer Packungspreis kann eine kleinere Menge enthalten.',
    'Beachte Kundenkarten- oder App-Bedingungen und benötigte Kaufmengen. Für einen Händlervergleich nutze die verlinkten Produktseiten, nicht nur die BILLA-Auswahl.',
  ]],
  lidl: ['Lidl-Aktionen nach Menge und Bedingungen prüfen', [
    'Prüfe zuerst Packungsgröße und Gültigkeit. Vergleiche den Einheitspreis nur zwischen passenden Produktformen.',
    'Ein öffentliches Angebot und ein Preis mit App- oder Kundenkartenbedingung sind unterschiedliche Kaufbedingungen. Die erkannte Bedingung steht am Angebot.',
    'Diese Auswahl ist kein vollständiger Lidl-Prospekt. Über die Produktseiten unten kannst du passende Angebote anderer Händler vergleichen.',
  ]],
  hofer: ['HOFER-Aktionen für deinen Einkauf einordnen', [
    'Für Aktionen heute sind der erkannte Gültigkeitszeitraum und der genannte Markt entscheidend. Verfügbarkeit bitte vor Ort prüfen.',
    'Nutze Packungsgröße und sicheren Preis pro kg, Liter oder Stück, statt unterschiedliche Packungen allein über den Verkaufspreis zu vergleichen.',
    'Die Auswahl erkannter HOFER-Angebote ersetzt kein vollständiges Flugblatt. Über die verwandten Produkt- und Händlerseiten kannst du Alternativen prüfen.',
  ]],
  bipa: ['BIPA-Angebote fair vergleichen', [
    'Bei flüssigen Pflegeprodukten hilft der Literpreis; Stückpreise sind nur bei gleichartigen Produkten und vergleichbarer Packung sinnvoll.',
    'Bei Mengenaktionen zählt die tatsächlich benötigte Kaufmenge. Berücksichtige zusätzlich erkannte Kundenkarten- und App-Bedingungen.',
    'Für Alternativen anderer Drogerien nutze die verlinkten Produkt- und Drogerieseiten. Unterschiedliche Produktarten werden nicht als gleichwertig behauptet.',
  ]],
  penny: ['PENNY-Aktionen mit Kaufmenge vergleichen', [
    'Prüfe, ob ein Aktionspreis für ein Stück oder erst beim Kauf mehrerer Packungen gilt. Entscheidend sind Gesamtmenge und benötigter Einkauf.',
    'Vergleiche passende Produkte über sichere Einheitspreise und beachte erkannte Kundenkarten- oder App-Bedingungen.',
    'Die Auswahl ist kein vollständiger PENNY-Prospekt. Die verwandten Produktseiten helfen dir, Angebote anderer Händler einzuordnen.',
  ]],
  supermarkt: ['Supermarkt-Angebote mit gleichem Maßstab vergleichen', [
    'Diese Übersicht zeigt eine Auswahl von BILLA/BILLA Plus, Lidl und PENNY. Sie ist keine vollständige Liste aller Supermarkt-Angebote.',
    'Für einen konkreten Preisvergleich wechsle zur passenden Produktseite. Vergleiche nur kompatible Produktformen über kg, Liter oder Stück.',
    'Packungsgröße, Gültigkeit und Bedingungen gehören zum Preisvergleich. Ein Mengenrabatt lohnt sich nur, wenn du die erforderliche Menge kaufen möchtest.',
  ]],
  bier: ['Bier: Literpreis, Gebinde und Kaufmenge', [
    'Vergleiche Bierpreise pro Liter bei passenden Produkten. Eine einzelne Dose, ein Multipack und eine Kiste haben unterschiedliche Gesamtmengen.',
    'Beachte Mengen- und Aktionsbedingungen sowie die tatsächlich benötigte Kaufmenge. Ein niedriger Literpreis ist keine Aussage über den günstigsten Gesamteinkauf.',
    'Pfand und Marktverfügbarkeit bitte zusätzlich prüfen. Ein ausgewiesener Literpreis allein belegt nicht, ob Pfand im Verkaufspreis enthalten ist.',
  ]],
  kaffee: ['Kaffee nur innerhalb passender Produktformen vergleichen', [
    'Vergleiche Bohnen und gemahlenen Kaffee anhand der Packungsmenge und des sicheren kg-Preises. Kapseln, Pads und fertige Kaffeegetränke sind eigene Produktformen.',
    'Ein Stückpreis für Kapseln oder Pads ist nicht direkt mit einem kg-Preis für Bohnen vergleichbar. Auch €/kg und €/l werden getrennt betrachtet.',
    'Prüfe erforderliche Kaufmengen und Kundenkarten- oder App-Bedingungen. Fehlende oder unklare Vergleichsdaten begründen keinen Bestpreis.',
  ]],
  schokolade: ['Schokolade: Gewicht und Mengenaktion beachten', [
    'Eine Tafel, eine Pralinenpackung und ein Multipack können unterschiedliche Gewichte enthalten. Vergleiche passende Schokoladenprodukte über einen sicher erkannten kg-Preis.',
    'Bei Mehrfachkäufen zählt die Gesamtmenge, die du kaufen musst. Ein niedriger Packungspreis oder eine Prozentangabe allein reicht für einen fairen Vergleich nicht aus.',
    'Beachte Zutaten, Produktform und erkannte Karten- oder App-Bedingungen. Wenn Gewicht oder Einheitspreis fehlen, wird daraus kein sicherer Preisvergleich abgeleitet.',
  ]],
}

export function getSeoComparisonGuide(page) {
  const guide = guides[page?.key]
  return guide ? { title: guide[0], paragraphs: guide[1] } : null
}
