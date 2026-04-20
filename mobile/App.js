import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  SectionList,
  StyleSheet,
  StatusBar as NativeStatusBar,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { API_BASE_URL, APP_NAME } from './src/config/api';
import {
  buildCategoryGroups,
  formatCurrency,
  getOfferCategoryLabel,
} from './src/searchHelpers';

function getOfferImageUrl(offerId) {
  return `${API_BASE_URL.replace(/\/api$/, '')}/api/offers/${offerId}/image`;
}

const RETAILER_COLORS = {
  adeg: '#7d3e2f',
  bipa: '#ec4f86',
  billa: '#d63b2e',
  'billa-plus': '#a51417',
  dm: '#005b8f',
  hofer: '#184a96',
  lidl: '#f2bf00',
  pagro: '#7a177e',
  penny: '#d81920',
  spar: '#19944a',
};

const RETAILER_TEXT_COLORS = {
  lidl: '#173118',
};

function normalizeAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function formatValidityLabel(offer) {
  const hasValidFrom = Boolean(offer?.validFrom);
  const hasValidTo = Boolean(offer?.validTo);

  if (hasValidFrom && hasValidTo) {
    return `Gueltig ${new Date(offer.validFrom).toLocaleDateString('de-AT')} bis ${new Date(offer.validTo).toLocaleDateString('de-AT')}`;
  }

  if (hasValidFrom) {
    return `Gueltig ab ${new Date(offer.validFrom).toLocaleDateString('de-AT')}`;
  }

  if (hasValidTo) {
    return `Gueltig bis ${new Date(offer.validTo).toLocaleDateString('de-AT')}`;
  }

  return 'Aktuell verfuegbar, Enddatum nicht erkannt';
}

function getRetailerColor(retailerKey) {
  const normalizedKey = String(retailerKey || '').toLowerCase().replace(/_/g, '-');
  return RETAILER_COLORS[normalizedKey] || '#31582c';
}

function getRetailerTextColor(retailerKey) {
  const normalizedKey = String(retailerKey || '').toLowerCase().replace(/_/g, '-');
  return RETAILER_TEXT_COLORS[normalizedKey] || '#ffffff';
}

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function buildWildcardRegex(token) {
  const safeToken = String(token || '').replace(/[^a-z0-9]/g, '');
  return safeToken ? new RegExp(safeToken.split('').join('.*')) : null;
}

function offerMatchesSearch(offer, searchTerm) {
  const normalizedTerm = normalizeSearchText(searchTerm);

  if (!normalizedTerm) {
    return true;
  }

  const haystack = normalizeSearchText([
    offer?.title,
    offer?.retailerName,
    getOfferCategoryLabel(offer),
    offer?.categoryPrimary,
    offer?.categorySecondary,
    offer?.quantityText,
    offer?.conditionsText,
    offer?.description,
  ].filter(Boolean).join(' '));

  return normalizedTerm.split(/\s+/).filter(Boolean).every((token) => {
    if (haystack.includes(token)) {
      return true;
    }

    const wildcardRegex = buildWildcardRegex(token);
    return wildcardRegex ? wildcardRegex.test(haystack) : false;
  });
}

function applySearchToRanking(baseRanking, searchTerm) {
  if (!baseRanking) {
    return null;
  }

  const normalizedTerm = normalizeSearchText(searchTerm);

  if (!normalizedTerm) {
    return baseRanking;
  }

  const rankedGroups = (baseRanking.rankedGroups || [])
    .map((group) => ({
      ...group,
      offers: (group.offers || []).filter((offer) => offerMatchesSearch(offer, normalizedTerm)),
    }))
    .filter((group) => group.offers.length > 0);
  const filteredOffers = rankedGroups.flatMap((group) => group.offers || []);
  const firstBestOffer = rankedGroups[0]?.offers?.[0];

  return {
    ...baseRanking,
    rankedGroups,
    summary: {
      ...(baseRanking.summary || {}),
      resultCount: filteredOffers.length,
      displayedCount: filteredOffers.length,
      bestUnitPrice: firstBestOffer?.normalizedUnitPrice
        ? `${firstBestOffer.normalizedUnitPrice.amount}/${firstBestOffer.normalizedUnitPrice.unit}`
        : '-',
    },
  };
}

function groupShoppingListEntries(entries) {
  const grouped = new Map();

  for (const entry of entries) {
    if (!grouped.has(entry.retailerKey)) {
      grouped.set(entry.retailerKey, {
        retailerKey: entry.retailerKey,
        retailerName: entry.retailerName,
        offers: [],
      });
    }

    grouped.get(entry.retailerKey).offers.push(entry);
  }

  return [...grouped.values()]
    .map((group) => ({
      ...group,
      offers: group.offers.sort((left, right) => left.title.localeCompare(right.title, 'de')),
      savingsTotal: group.offers.reduce((sum, offer) => sum + normalizeAmount(offer.savingsAmount), 0),
      currentTotal: group.offers.reduce((sum, offer) => sum + normalizeAmount(offer.priceCurrent?.amount), 0),
    }))
    .sort((left, right) => left.retailerName.localeCompare(right.retailerName, 'de'));
}

function FilterChip({ label, active, partial, onPress, activeBackgroundColor, activeTextColor }) {
  return (
    <Pressable
      style={[
        styles.chip,
        active ? styles.chipActive : null,
        partial ? styles.chipPartial : null,
        active && activeBackgroundColor ? { backgroundColor: activeBackgroundColor } : null,
      ]}
      onPress={onPress}
    >
      <Text style={[styles.chipLabel, active ? styles.chipLabelActive : null, active && activeTextColor ? { color: activeTextColor } : null]}>
        {label}
      </Text>
    </Pressable>
  );
}

function SummaryCard({ label, value, accent = false }) {
  return (
    <View style={[styles.summaryCard, accent ? styles.summaryCardAccent : null]}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

function OfferImage({ offer, sizeStyle, placeholderStyle, placeholderTextStyle }) {
  const proxyUrl = getOfferImageUrl(offer.id);
  const fallbackUrl = offer.imageUrl || null;
  const [imageMode, setImageMode] = useState(proxyUrl ? 'proxy' : fallbackUrl ? 'fallback' : 'none');

  useEffect(() => {
    setImageMode(proxyUrl ? 'proxy' : fallbackUrl ? 'fallback' : 'none');
  }, [proxyUrl, fallbackUrl, offer.id]);

  const source =
    imageMode === 'proxy'
      ? { uri: proxyUrl }
      : imageMode === 'fallback' && fallbackUrl
        ? { uri: fallbackUrl }
        : null;

  if (!source) {
    return (
      <View style={[sizeStyle, placeholderStyle]}>
        <Text style={placeholderTextStyle}>{offer.retailerName}</Text>
      </View>
    );
  }

  return (
    <Image
      source={source}
      style={sizeStyle}
      resizeMode="contain"
      onError={() => {
        if (imageMode === 'proxy' && fallbackUrl) {
          setImageMode('fallback');
          return;
        }
        setImageMode('none');
      }}
    />
  );
}

function OfferCard({ offer, rank, isSelected, onToggleShoppingList }) {
  const savingsText = normalizeAmount(offer.savingsAmount) > 0
    ? formatCurrency(offer.savingsAmount, offer.priceCurrent?.currency)
    : '-';
  const retailerColor = getRetailerColor(offer.retailerKey);
  const retailerTextColor = getRetailerTextColor(offer.retailerKey);

  return (
    <View style={[styles.offerCard, rank === 0 ? styles.offerCardBest : null]}>
      <OfferImage
        offer={offer}
        sizeStyle={styles.offerImage}
        placeholderStyle={styles.offerImageFallback}
        placeholderTextStyle={styles.offerImageFallbackText}
      />
      <View style={styles.offerBody}>
        <View style={styles.offerTopRow}>
          <View style={styles.offerBadgeRow}>
            <View style={styles.rankBadge}>
              <Text style={styles.rankBadgeLabel}>#{rank + 1}</Text>
            </View>
            <View style={[styles.retailerBadge, { backgroundColor: retailerColor }]}>
              <Text style={[styles.retailerBadgeLabel, { color: retailerTextColor }]}>{offer.retailerName}</Text>
            </View>
          </View>
          <Text style={styles.offerCategory}>{getOfferCategoryLabel(offer)}</Text>
        </View>
        <Text style={styles.offerTitle}>{offer.title}</Text>
        {offer.conditionsText ? <Text style={styles.offerCondition}>{offer.conditionsText}</Text> : null}
        <View style={styles.offerPriceRow}>
          <View style={styles.offerPriceBox}>
            <Text style={styles.offerPrice}>{formatCurrency(offer.priceCurrent?.amount, offer.priceCurrent?.currency)}</Text>
            <Text style={styles.offerMeta}>{offer.normalizedUnitPrice?.amount}/{offer.normalizedUnitPrice?.unit}</Text>
          </View>
          <View style={styles.savingsBox}>
            <Text style={styles.savingsLabel}>Ersparnis</Text>
            <Text style={styles.savingsValue}>{savingsText}</Text>
          </View>
        </View>
        <View style={styles.metaWrap}>
          <View style={styles.metaPill}>
            <Text style={styles.metaPillLabel}>Menge: {offer.quantityText || 'nicht erkannt'}</Text>
          </View>
          <View style={styles.metaPillWide}>
            <Text style={styles.metaPillLabel}>{formatValidityLabel(offer)}</Text>
          </View>
          <View style={styles.metaPill}>
            <Text style={styles.metaPillLabel}>
              App/Karte: {offer.customerProgramRequired ? 'Ja' : 'Nein'}
            </Text>
          </View>
        </View>
        <Pressable
          style={[styles.shoppingToggle, isSelected ? styles.shoppingToggleActive : null]}
          onPress={() => onToggleShoppingList(offer)}
        >
          <Text style={[styles.shoppingToggleLabel, isSelected ? styles.shoppingToggleLabelActive : null]}>
            {isSelected ? 'Auf der Einkaufsliste' : 'Auf die Einkaufsliste'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function SearchResultsList({
  ranking,
  loading,
  hasSearched,
  refreshing,
  onRefresh,
  shoppingListMap,
  onToggleShoppingList,
  hero,
}) {
  const sections = useMemo(
    () => (ranking?.rankedGroups || []).map((group) => ({
      title: `${group.unit} direkt vergleichbar`,
      subtitle: 'Faire Vergleiche innerhalb derselben Einheit.',
      data: group.offers || [],
      unit: group.unit,
    })),
    [ranking]
  );

  if (loading) {
    return (
      <View style={styles.loadingBox}>
        <ActivityIndicator color="#31582c" />
        <Text style={styles.loadingText}>Angebote werden geladen...</Text>
      </View>
    );
  }

  if (!hasSearched) {
    return (
      <SectionList
        sections={[]}
        keyExtractor={(item) => item.id}
        renderItem={null}
        ListHeaderComponent={hero}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>Noch keine Suche gestartet</Text>
            <Text style={styles.emptyText}>
              Tippe auf "Los" oder bestaetige deine Auswahl mit "Fertig" in "Filter anpassen".
            </Text>
          </View>
        }
        contentContainerStyle={styles.content}
        stickySectionHeadersEnabled={false}
      />
    );
  }

  return (
    <SectionList
      sections={sections}
      keyExtractor={(item) => item.id}
      renderItem={({ item, index }) => (
        <OfferCard
          offer={item}
          rank={index}
          isSelected={Boolean(shoppingListMap[item.id])}
          onToggleShoppingList={onToggleShoppingList}
        />
      )}
      renderSectionHeader={({ section }) => (
        <View style={styles.groupHeader}>
          <View style={styles.groupHeaderText}>
            <Text style={styles.groupTitle}>{section.title}</Text>
            <Text style={styles.groupSubtitle}>{section.subtitle}</Text>
          </View>
          <Text style={styles.groupCount}>{section.data.length}</Text>
        </View>
      )}
      ListHeaderComponent={hero}
      ListEmptyComponent={
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>Keine passenden Angebote gefunden</Text>
          <Text style={styles.emptyText}>Passe Suche, Anbieter oder Kategorien an, um mehr Ergebnisse zu sehen.</Text>
        </View>
      }
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#31582c" />}
      stickySectionHeadersEnabled={false}
      initialNumToRender={10}
      maxToRenderPerBatch={12}
      windowSize={8}
      removeClippedSubviews={Platform.OS === 'android'}
      SectionSeparatorComponent={() => <View style={styles.sectionSpacer} />}
    />
  );
}

function ShoppingListPage({ shoppingListEntries, onRemove }) {
  const groupedEntries = useMemo(
    () => groupShoppingListEntries(shoppingListEntries),
    [shoppingListEntries]
  );
  const totalSavings = useMemo(
    () => shoppingListEntries.reduce((sum, offer) => sum + normalizeAmount(offer.savingsAmount), 0),
    [shoppingListEntries]
  );
  const totalCurrent = useMemo(
    () => shoppingListEntries.reduce((sum, offer) => sum + normalizeAmount(offer.priceCurrent?.amount), 0),
    [shoppingListEntries]
  );

  if (groupedEntries.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyTitle}>Deine Einkaufsliste ist noch leer</Text>
        <Text style={styles.emptyText}>Markiere Angebote in der Suche mit "Auf die Einkaufsliste".</Text>
      </View>
    );
  }

  return (
    <View style={styles.resultGroupList}>
      <View style={styles.shoppingHero}>
        <Text style={styles.shoppingHeroTitle}>Deine Einkaufsliste</Text>
        <Text style={styles.shoppingHeroText}>
          Die Produkte sind nach Anbieter gruppiert, damit du deine Einkaeufe schnell nacheinander erledigen kannst.
        </Text>
      </View>

      {groupedEntries.map((group) => (
        <View key={group.retailerKey} style={styles.groupCard}>
          <View style={styles.groupHeader}>
            <View style={styles.groupHeaderText}>
              <Text style={styles.groupTitle}>{group.retailerName}</Text>
              <Text style={styles.groupSubtitle}>
                {group.offers.length} Produkt{group.offers.length === 1 ? '' : 'e'} | Ersparnis {formatCurrency(group.savingsTotal)}
              </Text>
            </View>
            <Text style={styles.groupCount}>{group.offers.length}</Text>
          </View>

          {group.offers.map((offer) => (
            <View key={offer.id} style={styles.listItemCard}>
              <OfferImage
                offer={offer}
                sizeStyle={styles.listItemImage}
                placeholderStyle={styles.listItemImageFallback}
                placeholderTextStyle={styles.listItemImageFallbackText}
              />
              <View style={styles.listItemBody}>
                <Text style={styles.listItemTitle}>{offer.title}</Text>
                {offer.conditionsText ? <Text style={styles.offerCondition}>{offer.conditionsText}</Text> : null}
                <Text style={styles.offerMeta}>{formatCurrency(offer.priceCurrent?.amount, offer.priceCurrent?.currency)}</Text>
                <Text style={styles.offerMeta}>
                  Ersparnis: {normalizeAmount(offer.savingsAmount) > 0 ? formatCurrency(offer.savingsAmount) : '-'}
                </Text>
              </View>
              <Pressable style={styles.removeButton} onPress={() => onRemove(offer.id)}>
                <Text style={styles.removeButtonLabel}>Entfernen</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ))}

      <View style={styles.totalSavingsCard}>
        <Text style={styles.totalSavingsLabel}>Gesamte Ersparnis</Text>
        <Text style={styles.totalSavingsValue}>{formatCurrency(totalSavings)}</Text>
        <Text style={styles.totalSavingsHint}>Aktueller Einkaufswert: {formatCurrency(totalCurrent)}</Text>
      </View>
    </View>
  );
}

export default function App() {
  const [activePage, setActivePage] = useState('search');
  const [health, setHealth] = useState({ ok: false, environment: '', region: '' });
  const [ranking, setRanking] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [selectedRetailers, setSelectedRetailers] = useState([]);
  const [retailerPrograms, setRetailerPrograms] = useState({});
  const [filterOpen, setFilterOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState({});
  const [shoppingListMap, setShoppingListMap] = useState({});
  const [prioritizeRelevantOffers, setPrioritizeRelevantOffers] = useState(true);
  const [hasTriggeredSearch, setHasTriggeredSearch] = useState(false);
  const androidTopInset = Platform.OS === 'android' ? (NativeStatusBar.currentHeight || 0) : 0;
  const androidBottomInset = Platform.OS === 'android' ? 18 : 0;

  async function fetchJson(path, options) {
    const response = await fetch(`${API_BASE_URL}${path}`, options);
    if (!response.ok) {
      throw new Error(`API-Fehler ${response.status}`);
    }
    return response.json();
  }

  async function loadBootstrap() {
    try {
      const [healthData, prefData, rankingData] = await Promise.all([
        fetchJson('/health'),
        fetchJson('/user-preferences/current'),
        fetchJson('/offers/ranking?limit=5'),
      ]);
      setHealth({
        ok: Boolean(healthData?.ok),
        environment: healthData?.environment || '',
        region: healthData?.region || '',
      });
      setRetailerPrograms(prefData?.retailerPrograms || {});
      setRanking(rankingData);
    } catch (loadError) {
      setError(loadError.message || 'App konnte nicht initialisiert werden.');
    }
  }

  async function loadRanking(isRefresh = false) {
    try {
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      const params = new URLSearchParams();
      if (selectedCategories.length > 0) params.set('categories', selectedCategories.join(','));
      if (selectedRetailers.length > 0) params.set('retailers', selectedRetailers.join(','));
      const programRetailers = Object.entries(retailerPrograms).filter(([, value]) => value).map(([key]) => key);
      if (programRetailers.length > 0) params.set('programRetailers', programRetailers.join(','));
      params.set('limit', prioritizeRelevantOffers ? '60' : 'all');

      const rankingData = await fetchJson(`/offers/ranking?${params.toString()}`);
      setRanking(rankingData);
      setError('');
    } catch (loadError) {
      setError(loadError.message || 'Angebote konnten nicht geladen werden.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadBootstrap();
  }, []);

  useEffect(() => {
    if (!hasTriggeredSearch) {
      return;
    }
    loadRanking(false);
  }, [hasTriggeredSearch, selectedCategories, selectedRetailers, retailerPrograms, prioritizeRelevantOffers]);

  const categoryGroups = useMemo(() => buildCategoryGroups(ranking?.categories || []), [ranking?.categories]);
  const visibleRanking = useMemo(() => applySearchToRanking(ranking, searchTerm), [ranking, searchTerm]);
  const summary = visibleRanking?.summary || ranking?.summary || {};

  async function savePrograms(nextPrograms) {
    setRetailerPrograms(nextPrograms);
    try {
      await fetchJson('/user-preferences/current', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ retailerPrograms: nextPrograms }),
      });
    } catch (saveError) {
      setError(saveError.message || 'Kundenkarten-Einstellung konnte nicht gespeichert werden.');
    }
  }

  function submitSearch() {
    setHasTriggeredSearch(true);
    setSearchTerm(searchInput.trim());
  }

  function applyFiltersAndSearch() {
    setHasTriggeredSearch(true);
    setSearchTerm(searchInput.trim());
    setFilterOpen(false);
  }

  function clearAllSearchFilters() {
    setSelectedRetailers([]);
    setSelectedCategories([]);
    setExpandedGroups({});
    setSearchInput('');
    setSearchTerm('');
    setPrioritizeRelevantOffers(true);
    setHasTriggeredSearch(false);
    setLoading(false);
    setRefreshing(false);
    savePrograms({});
    loadBootstrap();
  }

  function toggleRetailer(retailerKey) {
    setSelectedRetailers((current) => (
      current.includes(retailerKey)
        ? current.filter((item) => item !== retailerKey)
        : [...current, retailerKey]
    ));
  }

  function toggleCategory(category) {
    setSelectedCategories((current) => (
      current.includes(category)
        ? current.filter((item) => item !== category)
        : [...current, category]
    ));
  }

  function toggleMainCategory(subcategories) {
    setSelectedCategories((current) => {
      const allSelected = subcategories.every((subcategory) => current.includes(subcategory));
      if (allSelected) {
        return current.filter((item) => !subcategories.includes(item));
      }
      return [...new Set([...current, ...subcategories])];
    });
  }

  function toggleShoppingList(offer) {
    setShoppingListMap((current) => {
      if (current[offer.id]) {
        const next = { ...current };
        delete next[offer.id];
        return next;
      }

      return {
        ...current,
        [offer.id]: offer,
      };
    });
  }

  function removeFromShoppingList(offerId) {
    setShoppingListMap((current) => {
      const next = { ...current };
      delete next[offerId];
      return next;
    });
  }

  const shoppingListEntries = useMemo(() => Object.values(shoppingListMap), [shoppingListMap]);
  const strongestSaving = useMemo(() => {
    const offers = (visibleRanking?.rankedGroups || []).flatMap((group) => group.offers || []);
    return offers.reduce((max, offer) => Math.max(max, normalizeAmount(offer.savingsAmount)), 0);
  }, [visibleRanking]);
  const activeProgramCount = Object.values(retailerPrograms).filter(Boolean).length;
  const activeFilterCount = selectedRetailers.length + selectedCategories.length + activeProgramCount + (searchTerm ? 1 : 0);
  const resultCount = summary.resultCount || 0;
  const displayedCount = summary.displayedCount || 0;
  const allRelevantVisible = Boolean(summary.completeResultSetVisible) || displayedCount === resultCount;
  const quickFilterSummary = [
    selectedRetailers.length ? `${selectedRetailers.length} Anbieter` : null,
    selectedCategories.length ? `${selectedCategories.length} Kategorien` : null,
    activeProgramCount ? `${activeProgramCount} Karten/App` : null,
    searchTerm ? `"${searchTerm}"` : null,
  ].filter(Boolean).join(' | ');
  const searchHeader = (
    <>
      <View style={styles.heroCard}>
        <Text style={styles.eyebrow}>kaufgut.at app</Text>
        <Text style={styles.title}>{APP_NAME}</Text>
        <Text style={styles.subtitle}>
          Finde die besten aktuellen Angebote schneller, vergleiche fair und sammle Produkte direkt fuer deinen Einkauf.
        </Text>

        <View style={styles.heroFooter}>
          <View style={[styles.livePill, health.ok ? styles.livePillActive : null]}>
            <Text style={[styles.livePillLabel, health.ok ? styles.livePillLabelActive : null]}>
              {health.ok ? `Live | ${health.region || 'Region aktiv'}` : 'Verbindung pruefen'}
            </Text>
          </View>
          <Text style={styles.heroHint}>Stand: {health.environment || 'mobile preview'}</Text>
        </View>
      </View>

      <View style={styles.searchCard}>
        <Text style={styles.searchSectionTitle}>Welche Maerkte moechtest du?</Text>
        <View style={styles.chipWrap}>
          {(ranking?.retailers || []).map((retailer) => (
            <FilterChip
              key={retailer.retailerKey}
              label={retailer.retailerName}
              active={selectedRetailers.includes(retailer.retailerKey)}
              activeBackgroundColor={getRetailerColor(retailer.retailerKey)}
              activeTextColor={getRetailerTextColor(retailer.retailerKey)}
              onPress={() => toggleRetailer(retailer.retailerKey)}
            />
          ))}
        </View>

        <Text style={styles.searchCardTitle}>Wonach suchst du heute?</Text>
        <View style={styles.searchInputRow}>
          <TextInput
            style={styles.searchInput}
            value={searchInput}
            onChangeText={setSearchInput}
            onSubmitEditing={submitSearch}
            placeholder="Suche nach Wein, Kaese, Mineralwasser ..."
            placeholderTextColor="#747b73"
            returnKeyType="search"
          />
          <Pressable style={styles.searchSubmitButton} onPress={submitSearch}>
            <Text style={styles.searchSubmitButtonLabel}>Los</Text>
          </Pressable>
        </View>

        <View style={styles.actionRow}>
          <Pressable style={styles.primaryButton} onPress={() => setFilterOpen(true)}>
            <Text style={styles.primaryButtonLabel}>Filter anpassen</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={clearAllSearchFilters}>
            <Text style={styles.secondaryButtonLabel}>Alles loeschen</Text>
          </Pressable>
        </View>

        <View style={styles.quickInfoCard}>
          <Text style={styles.quickInfoTitle}>Suchstatus</Text>
          <Text style={styles.quickInfoText}>
            {hasTriggeredSearch
              ? `${resultCount} passende Angebote${allRelevantVisible ? ' | vollstaendig sichtbar' : ` | ${displayedCount} aktuell sichtbar`}`
              : 'Noch keine Suche gestartet'}
          </Text>
          {quickFilterSummary ? <Text style={styles.quickInfoText}>Aktive Filter: {quickFilterSummary}</Text> : null}
        </View>
      </View>

      <View style={styles.summaryRow}>
        <SummaryCard label="Passende Angebote" value={hasTriggeredSearch ? resultCount : '-'} accent />
        <SummaryCard label="Aktuell sichtbar" value={hasTriggeredSearch ? displayedCount : '-'} />
        <SummaryCard label="Groesste Ersparnis" value={hasTriggeredSearch ? formatCurrency(strongestSaving) : '-'} />
        <SummaryCard label="Merkliste" value={shoppingListEntries.length} />
      </View>

      {error ? <Text style={styles.errorBox}>{error}</Text> : null}
    </>
  );

  return (
    <SafeAreaView style={[styles.screen, { paddingTop: androidTopInset, paddingBottom: androidBottomInset }]}>
      <StatusBar style="dark" />
      <View style={styles.topMenu}>
        <Pressable
          style={[styles.topMenuButton, activePage === 'search' ? styles.topMenuButtonActive : null]}
          onPress={() => setActivePage('search')}
        >
          <Text style={[styles.topMenuLabel, activePage === 'search' ? styles.topMenuLabelActive : null]}>
            Suche
          </Text>
        </Pressable>
        <Pressable
          style={[styles.topMenuButton, activePage === 'shopping' ? styles.topMenuButtonActive : null]}
          onPress={() => setActivePage('shopping')}
        >
          <Text style={[styles.topMenuLabel, activePage === 'shopping' ? styles.topMenuLabelActive : null]}>
            Einkaufsliste
          </Text>
        </Pressable>
      </View>
      {activePage === 'search' ? (
        <SearchResultsList
          ranking={visibleRanking}
          loading={loading}
          hasSearched={hasTriggeredSearch}
          refreshing={refreshing}
          onRefresh={() => hasTriggeredSearch ? loadRanking(true) : null}
          shoppingListMap={shoppingListMap}
          onToggleShoppingList={toggleShoppingList}
          hero={searchHeader}
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadRanking(true)} tintColor="#31582c" />}
        >
          <View style={styles.heroCard}>
            <Text style={styles.eyebrow}>kaufgut.at app</Text>
            <Text style={styles.title}>{APP_NAME}</Text>
            <Text style={styles.subtitle}>
              Finde die besten aktuellen Angebote schneller, vergleiche fair und sammle Produkte direkt fuer deinen Einkauf.
            </Text>
          </View>
          <ShoppingListPage
            shoppingListEntries={shoppingListEntries}
            onRemove={removeFromShoppingList}
          />
        </ScrollView>
      )}

      <Modal visible={filterOpen} animationType="slide" onRequestClose={() => setFilterOpen(false)}>
        <SafeAreaView style={[styles.modalScreen, { paddingTop: androidTopInset, paddingBottom: androidBottomInset }]}>
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalTitle}>Filter</Text>
              <Text style={styles.modalSubtitle}>So wenig wie moeglich, so klar wie noetig: Kategorien und Kartenvorteile.</Text>
            </View>
            <Pressable style={styles.resetButton} onPress={applyFiltersAndSearch}>
              <Text style={styles.resetButtonLabel}>Fertig</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.modalContent}>
            <View style={styles.sectionCard}>
              <View style={styles.sectionTop}>
                <Text style={styles.sectionTitle}>Schnellzugriff</Text>
                <Pressable style={styles.resetButton} onPress={clearAllSearchFilters}>
                  <Text style={styles.resetButtonLabel}>Alles loeschen</Text>
                </Pressable>
              </View>
              <Text style={styles.quickPanelText}>
                Aktuell: {quickFilterSummary || 'Keine aktiven Filter'}.
              </Text>
              <View style={styles.displayRow}>
                <View style={styles.displayTextBox}>
                  <Text style={styles.displayTitle}>Alle relevanten Angebote</Text>
                  <Text style={styles.displaySubtitle}>
                    Wenn aktiviert, zeigen wir dir die besten 60 Angebote die wir gefunden haben. Wenn du ein paar Sekunden mehr Geduld hast, schalte das hier ab und wir zeigen dir alles was wir gefunden haben. So findest du immer die wirklich besten Angebote.
                  </Text>
                </View>
                <Switch
                  value={prioritizeRelevantOffers}
                  onValueChange={setPrioritizeRelevantOffers}
                  trackColor={{ false: '#d8d0c3', true: '#96b767' }}
                  thumbColor={prioritizeRelevantOffers ? '#244320' : '#f8f5ed'}
                />
              </View>
            </View>

            {selectedRetailers.length > 0 ? (
              <View style={styles.sectionCard}>
                <View style={styles.sectionTop}>
                  <Text style={styles.sectionTitle}>Kundenkarte / App</Text>
                  <Pressable style={styles.resetButton} onPress={() => savePrograms({})}>
                    <Text style={styles.resetButtonLabel}>Reset</Text>
                  </Pressable>
                </View>
                {(ranking?.retailers || [])
                  .filter((retailer) => selectedRetailers.includes(retailer.retailerKey))
                  .map((retailer) => (
                    <View key={retailer.retailerKey} style={styles.switchRow}>
                      <View style={styles.switchTextBox}>
                        <Text style={styles.switchTitle}>{retailer.retailerName}</Text>
                        <Text style={styles.switchSubtitle}>Kundenkarte oder App vorhanden</Text>
                      </View>
                      <Switch
                        value={Boolean(retailerPrograms[retailer.retailerKey])}
                        onValueChange={(value) => savePrograms({ ...retailerPrograms, [retailer.retailerKey]: value })}
                        trackColor={{ false: '#d8d0c3', true: '#96b767' }}
                        thumbColor={Boolean(retailerPrograms[retailer.retailerKey]) ? '#244320' : '#f8f5ed'}
                      />
                    </View>
                  ))}
              </View>
            ) : null}

            <View style={styles.sectionCard}>
              <View style={styles.sectionTop}>
                <Text style={styles.sectionTitle}>Kategorien</Text>
                <Pressable style={styles.resetButton} onPress={() => setSelectedCategories([])}>
                  <Text style={styles.resetButtonLabel}>Reset</Text>
                </Pressable>
              </View>
              {categoryGroups.map((group) => {
                const selectedCount = group.subcategories.filter((item) => selectedCategories.includes(item)).length;
                const allSelected = selectedCount === group.subcategories.length && group.subcategories.length > 0;
                const partial = selectedCount > 0 && !allSelected;
                const expanded = Boolean(expandedGroups[group.mainCategory]) || selectedCount > 0;

                return (
                  <View key={group.mainCategory} style={styles.categoryCard}>
                    <View style={styles.sectionTop}>
                      <FilterChip
                        label={`${group.mainCategory} (${group.subcategories.length})`}
                        active={allSelected}
                        partial={partial}
                        onPress={() => toggleMainCategory(group.subcategories)}
                      />
                      <Pressable
                        style={styles.linkButton}
                        onPress={() => setExpandedGroups((current) => ({ ...current, [group.mainCategory]: !current[group.mainCategory] }))}
                      >
                        <Text style={styles.linkButtonLabel}>{expanded ? 'Weniger' : 'Mehr'}</Text>
                      </Pressable>
                    </View>
                    {expanded ? (
                      <View style={styles.chipWrap}>
                        {group.subcategories.map((subcategory) => (
                          <FilterChip
                            key={subcategory}
                            label={subcategory}
                            active={selectedCategories.includes(subcategory)}
                            onPress={() => toggleCategory(subcategory)}
                          />
                        ))}
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          </ScrollView>

          <View style={styles.modalFooter}>
            <Pressable style={styles.primaryButton} onPress={applyFiltersAndSearch}>
              <Text style={styles.primaryButtonLabel}>Fertig</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4efe5' },
  topMenu: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 8,
    backgroundColor: '#f4efe5',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(19, 32, 20, 0.08)',
  },
  topMenuButton: {
    flex: 1,
    backgroundColor: '#eae2d4',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 16,
    alignItems: 'center',
  },
  topMenuButtonActive: { backgroundColor: '#31582c' },
  topMenuLabel: { color: '#425040', fontWeight: '700', fontSize: 14 },
  topMenuLabelActive: { color: '#f8f5ed' },
  content: { padding: 18, gap: 16, paddingBottom: 40 },
  heroCard: {
    backgroundColor: '#12361e',
    borderRadius: 28,
    padding: 18,
    gap: 10,
    shadowColor: '#12361e',
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  eyebrow: { color: '#a7c88f', textTransform: 'uppercase', letterSpacing: 2, fontSize: 12, fontWeight: '700' },
  title: { color: '#f8f5ed', fontSize: 32, fontWeight: '800' },
  subtitle: { color: '#d7e5d6', fontSize: 15, lineHeight: 22 },
  heroFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  livePill: { backgroundColor: 'rgba(248, 245, 237, 0.14)', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 },
  livePillActive: { backgroundColor: '#d7efb2' },
  livePillLabel: { color: '#f8f5ed', fontSize: 12, fontWeight: '700' },
  livePillLabelActive: { color: '#173118' },
  heroHint: { color: '#c8d5c7', fontSize: 12, fontWeight: '600' },
  searchCard: { backgroundColor: '#fffaf2', borderRadius: 24, padding: 16, gap: 12, borderWidth: 1, borderColor: 'rgba(19, 32, 20, 0.08)' },
  searchCardTitle: { color: '#132014', fontSize: 18, fontWeight: '800' },
  searchInputRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  searchInput: { flex: 1, backgroundColor: '#f4eee2', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: '#1b241b' },
  searchSubmitButton: { backgroundColor: '#12361e', borderRadius: 16, paddingHorizontal: 18, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  searchSubmitButtonLabel: { color: '#f8f5ed', fontWeight: '800', fontSize: 15 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  primaryButton: { backgroundColor: '#31582c', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12 },
  primaryButtonLabel: { color: '#f8f5ed', fontWeight: '700' },
  secondaryButton: { backgroundColor: '#ece4d7', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12 },
  secondaryButtonLabel: { color: '#304230', fontWeight: '700' },
  displayRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, backgroundColor: '#f3eddc', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 10 },
  displayTextBox: { flex: 1, gap: 2 },
  displayTitle: { color: '#173118', fontSize: 14, fontWeight: '800' },
  displaySubtitle: { color: '#5d695a', fontSize: 12, lineHeight: 18 },
  quickInfoCard: { backgroundColor: '#f3eddc', borderRadius: 16, padding: 12, gap: 4 },
  quickInfoTitle: { color: '#31582c', fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1 },
  quickInfoText: { color: '#4f594e', fontSize: 13, lineHeight: 18 },
  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  summaryCard: { minWidth: 100, flexGrow: 1, backgroundColor: '#fffaf2', borderRadius: 18, padding: 14, gap: 4, borderWidth: 1, borderColor: 'rgba(19, 32, 20, 0.08)' },
  summaryCardAccent: { backgroundColor: '#e9f6db' },
  summaryLabel: { color: '#61705f', fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  summaryValue: { color: '#19301a', fontSize: 20, fontWeight: '800' },
  errorBox: { color: '#8b2424', backgroundColor: '#fdeeee', borderRadius: 16, padding: 14, fontSize: 14 },
  loadingBox: { alignItems: 'center', gap: 10, paddingVertical: 32 },
  loadingText: { color: '#5e685d' },
  groupHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  groupHeaderText: { flex: 1, gap: 2 },
  groupTitle: { color: '#132014', fontSize: 18, fontWeight: '800' },
  groupSubtitle: { color: '#5e685d', fontSize: 13, marginTop: 3 },
  groupCount: { minWidth: 36, textAlign: 'center', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 999, backgroundColor: '#e1edd3', color: '#244320', fontWeight: '800' },
  offerCard: { flexDirection: 'row', gap: 10, backgroundColor: '#fffaf2', borderRadius: 20, padding: 12, borderWidth: 1, borderColor: 'rgba(19, 32, 20, 0.08)' },
  offerCardBest: { backgroundColor: '#edf7df' },
  offerImage: { width: 80, height: 80, borderRadius: 14, backgroundColor: '#fff' },
  offerImageFallback: { width: 80, height: 80, borderRadius: 14, backgroundColor: '#dfe9d5', alignItems: 'center', justifyContent: 'center', padding: 8 },
  offerImageFallbackText: { color: '#31582c', fontSize: 12, fontWeight: '800', textAlign: 'center' },
  offerBody: { flex: 1, gap: 6 },
  offerTopRow: { gap: 3 },
  offerBadgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  rankBadge: { backgroundColor: '#e3dccd', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  rankBadgeLabel: { color: '#425040', fontSize: 11, fontWeight: '800' },
  retailerBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  retailerBadgeLabel: { color: '#ffffff', fontSize: 11, fontWeight: '800' },
  offerEyebrow: { color: '#5d695a', fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  offerCategory: { color: '#31582c', fontSize: 12, fontWeight: '700' },
  offerTitle: { color: '#152315', fontSize: 16, lineHeight: 22, fontWeight: '700' },
  offerCondition: { color: '#98620a', fontSize: 13, fontWeight: '700' },
  offerPriceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  offerPriceBox: { gap: 2 },
  offerPrice: { color: '#173118', fontSize: 20, fontWeight: '800' },
  offerMeta: { color: '#59635a', fontSize: 13 },
  metaWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  metaPill: { backgroundColor: '#efe8da', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  metaPillWide: { backgroundColor: '#e7f0da', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  metaPillLabel: { color: '#59635a', fontSize: 12, fontWeight: '600' },
  savingsBox: { alignItems: 'flex-end', backgroundColor: '#fffaf2', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 8, minWidth: 94 },
  savingsLabel: { color: '#5d695a', fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  savingsValue: { color: '#173118', fontSize: 15, fontWeight: '800' },
  shoppingToggle: { marginTop: 4, alignSelf: 'flex-start', backgroundColor: '#ece4d7', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 999 },
  shoppingToggleActive: { backgroundColor: '#31582c' },
  shoppingToggleLabel: { color: '#304230', fontSize: 13, fontWeight: '700' },
  shoppingToggleLabelActive: { color: '#f8f5ed' },
  shoppingHero: { backgroundColor: '#fffaf2', borderRadius: 24, padding: 16, gap: 6, borderWidth: 1, borderColor: 'rgba(19, 32, 20, 0.08)' },
  shoppingHeroTitle: { color: '#132014', fontSize: 20, fontWeight: '800' },
  shoppingHeroText: { color: '#5f685e', fontSize: 14, lineHeight: 20 },
  modalScreen: { flex: 1, backgroundColor: '#f4efe5' },
  modalHeader: { paddingHorizontal: 18, paddingVertical: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  modalHeaderText: { flex: 1 },
  modalTitle: { color: '#132014', fontSize: 24, fontWeight: '800' },
  modalSubtitle: { color: '#5e685d', fontSize: 13, lineHeight: 18, marginTop: 4 },
  modalContent: { paddingHorizontal: 18, paddingBottom: 32, gap: 14 },
  modalFooter: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 18, borderTopWidth: 1, borderTopColor: 'rgba(19, 32, 20, 0.08)', backgroundColor: '#f4efe5' },
  sectionCard: { backgroundColor: '#fffaf2', borderRadius: 22, padding: 14, gap: 12, borderWidth: 1, borderColor: 'rgba(19, 32, 20, 0.08)' },
  sectionTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, alignItems: 'center' },
  sectionTitle: { color: '#142214', fontSize: 18, fontWeight: '800' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 999, backgroundColor: '#efe9dc' },
  chipActive: { backgroundColor: '#31582c' },
  chipPartial: { backgroundColor: '#dce9ca' },
  chipLabel: { color: '#475246', fontSize: 13, fontWeight: '700' },
  chipLabelActive: { color: '#f8f5ed' },
  quickPanelText: { color: '#4f594e', fontSize: 14, lineHeight: 20 },
  resetButton: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: '#f1ebdf' },
  resetButtonLabel: { color: '#31582c', fontSize: 13, fontWeight: '700' },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  switchTextBox: { flex: 1, gap: 2 },
  switchTitle: { color: '#142214', fontSize: 15, fontWeight: '700' },
  switchSubtitle: { color: '#5f685e', fontSize: 12 },
  categoryCard: { backgroundColor: '#f8f3e8', borderRadius: 18, padding: 10, gap: 8 },
  linkButton: { paddingHorizontal: 6, paddingVertical: 4 },
  linkButtonLabel: { color: '#31582c', fontSize: 13, fontWeight: '700' },
  listItemCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#f8f3e8', borderRadius: 18, padding: 12 },
  listItemImage: { width: 72, height: 72, borderRadius: 12, backgroundColor: '#fff' },
  listItemImageFallback: { width: 72, height: 72, borderRadius: 12, backgroundColor: '#dfe9d5', alignItems: 'center', justifyContent: 'center', padding: 8 },
  listItemImageFallbackText: { color: '#31582c', fontSize: 11, fontWeight: '800', textAlign: 'center' },
  listItemBody: { flex: 1, gap: 4 },
  listItemTitle: { color: '#152315', fontSize: 15, lineHeight: 20, fontWeight: '700' },
  removeButton: { backgroundColor: '#efe5da', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 10 },
  removeButtonLabel: { color: '#7b3535', fontSize: 12, fontWeight: '700' },
  totalSavingsCard: { backgroundColor: '#12361e', borderRadius: 24, padding: 18, gap: 6 },
  totalSavingsLabel: { color: '#c1dfaf', textTransform: 'uppercase', letterSpacing: 1.5, fontSize: 12, fontWeight: '700' },
  totalSavingsValue: { color: '#f8f5ed', fontSize: 30, fontWeight: '800' },
  totalSavingsHint: { color: '#d7e5d6', fontSize: 14 },
  resultGroupList: { gap: 16 },
  sectionSpacer: { height: 16 },
  emptyState: { backgroundColor: '#fffaf2', borderRadius: 24, padding: 22, gap: 8, borderWidth: 1, borderColor: 'rgba(19, 32, 20, 0.08)' },
  emptyTitle: { color: '#152315', fontSize: 18, fontWeight: '800' },
  emptyText: { color: '#59635a', fontSize: 14, lineHeight: 20 },
});
