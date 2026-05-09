import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

const SEARCH_LIMIT = 250;
const MARKET_CHECK_HINT = 'Preise, Verfügbarkeit und Bedingungen bitte im Markt prüfen.';

const SORT_OPTIONS = {
  best: 'best',
  retailer: 'retailer',
  savings: 'savings',
};

const SORT_LABELS = {
  [SORT_OPTIONS.best]: 'Empfohlen',
  [SORT_OPTIONS.retailer]: 'Märkte',
  [SORT_OPTIONS.savings]: 'Größte Ersparnis',
};

const INITIAL_MESSAGE = 'Suche ein Produkt und merke passende Angebote für deinen Einkauf.';
const RETAILER_ORDER = ['billa', 'billa-plus', 'bipa', 'dm', 'hofer', 'lidl', 'pagro', 'penny', 'spar'];

function normalizeKey(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getRetailerLabel(retailer) {
  return String(
    retailer?.label ||
      retailer?.name ||
      retailer?.retailerLabel ||
      retailer?.retailerName ||
      retailer?.retailerKey ||
      retailer?.key ||
      ''
  ).trim();
}

function getRetailerKey(retailer) {
  const directKey = retailer?.retailerKey || retailer?.key;
  if (directKey) return normalizeKey(directKey);

  return normalizeKey(getRetailerLabel(retailer));
}

function getOfferRetailerLabel(offer) {
  const retailerObject = typeof offer?.retailer === 'object' ? offer.retailer : null;
  const providerObject = typeof offer?.provider === 'object' ? offer.provider : null;
  const marketObject = typeof offer?.market === 'object' ? offer.market : null;
  const shopObject = typeof offer?.shop === 'object' ? offer.shop : null;

  return String(
    offer?.retailerLabel ||
      offer?.retailerName ||
      offer?.providerLabel ||
      offer?.marketLabel ||
      offer?.shopLabel ||
      retailerObject?.label ||
      retailerObject?.name ||
      providerObject?.label ||
      providerObject?.name ||
      marketObject?.label ||
      marketObject?.name ||
      shopObject?.label ||
      shopObject?.name ||
      (typeof offer?.retailer === 'string' ? offer.retailer : '') ||
      (typeof offer?.provider === 'string' ? offer.provider : '') ||
      (typeof offer?.market === 'string' ? offer.market : '') ||
      (typeof offer?.shop === 'string' ? offer.shop : '') ||
      ''
  ).trim();
}

function getOfferRetailerKey(offer) {
  const retailerObject = typeof offer?.retailer === 'object' ? offer.retailer : null;
  const providerObject = typeof offer?.provider === 'object' ? offer.provider : null;
  const marketObject = typeof offer?.market === 'object' ? offer.market : null;
  const shopObject = typeof offer?.shop === 'object' ? offer.shop : null;
  const directKey =
    offer?.retailerKey ||
    offer?.providerKey ||
    offer?.marketKey ||
    offer?.shopKey ||
    retailerObject?.retailerKey ||
    retailerObject?.key ||
    providerObject?.retailerKey ||
    providerObject?.key ||
    marketObject?.retailerKey ||
    marketObject?.key ||
    shopObject?.retailerKey ||
    shopObject?.key;

  if (directKey) return normalizeKey(directKey);

  return normalizeKey(getOfferRetailerLabel(offer));
}

function getNumericCandidate(value) {
  if (value && typeof value === 'object') {
    return getNumericCandidate(value.amount ?? value.value ?? value.eur ?? value.price);
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== 'string') return null;

  const normalized = value
    .replace(/\s/g, '')
    .replace(/%/g, '')
    .replace(/€/g, '')
    .replace(',', '.')
    .replace(/[^0-9.-]/g, '');
  const numeric = Number(normalized);

  return Number.isFinite(numeric) ? numeric : null;
}

function firstPositiveNumber(candidates) {
  for (const candidate of candidates) {
    const numeric = getNumericCandidate(candidate);
    if (numeric !== null && numeric > 0) return numeric;
  }

  return 0;
}

function getOfferSavingsScore(offer) {
  const directSavings = firstPositiveNumber([
    offer?.savingsAmount,
    offer?.savingAmount,
    offer?.savingsAbsolute,
    offer?.discountAmount,
    offer?.savings?.amount,
    offer?.discount?.amount,
    offer?.priceSavings?.amount,
  ]);

  if (directSavings > 0) return directSavings;

  const currentPrice = firstPositiveNumber([
    offer?.price,
    offer?.priceCurrent,
    offer?.currentPrice,
    offer?.offerPrice,
  ]);
  const oldPrice = firstPositiveNumber([
    offer?.oldPrice,
    offer?.regularPrice,
    offer?.previousPrice,
    offer?.priceBefore,
    offer?.priceOriginal,
    offer?.priceRegular,
  ]);

  if (oldPrice > currentPrice && currentPrice > 0) {
    return oldPrice - currentPrice;
  }

  return 0;
}

function buildAvailableRetailers(retailers) {
  const seen = new Set();

  return (retailers || [])
    .map((retailer) => {
      const key = getRetailerKey(retailer);
      const label = getRetailerLabel(retailer);

      return { key, label: label || key };
    })
    .filter((retailer) => {
      if (!retailer.key || seen.has(retailer.key)) return false;
      seen.add(retailer.key);
      return true;
    })
    .sort((left, right) => {
      const leftOrder = RETAILER_ORDER.indexOf(left.key);
      const rightOrder = RETAILER_ORDER.indexOf(right.key);

      if (leftOrder !== -1 || rightOrder !== -1) {
        if (leftOrder === -1) return 1;
        if (rightOrder === -1) return -1;
        if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      }

      return left.label.localeCompare(right.label, 'de-AT');
    });
}

export default function ProductSearchScreen({
  fetchJson,
  flattenRankingOffers,
  OfferCardComponent,
  retailers = [],
  shoppingListMap = {},
  onToggleShoppingList,
  onOpenOfferDetail,
}) {
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [ranking, setRanking] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState(INITIAL_MESSAGE);
  const [marketFilterEnabled, setMarketFilterEnabled] = useState(false);
  const [selectedRetailerKeys, setSelectedRetailerKeys] = useState([]);
  const [sortMode, setSortMode] = useState(SORT_OPTIONS.best);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const requestIdRef = useRef(0);
  const resultsAnchorYRef = useRef(0);
  const shouldScrollToResultsRef = useRef(false);

  const offers = useMemo(() => {
    try {
      const nextOffers = flattenRankingOffers(ranking);
      return Array.isArray(nextOffers) ? nextOffers : [];
    } catch (parseError) {
      return [];
    }
  }, [flattenRankingOffers, ranking]);

  const availableRetailers = useMemo(() => buildAvailableRetailers(retailers), [retailers]);

  const visibleOffers = useMemo(() => {
    if (marketFilterEnabled && selectedRetailerKeys.length === 0) return [];

    const selectedRetailers = new Set(selectedRetailerKeys);

    return (Array.isArray(offers) ? offers : [])
      .filter((offer) => offer && typeof offer === 'object')
      .map((offer, index) => ({
        offer,
        index,
        retailerKey: getOfferRetailerKey(offer),
        retailerLabel: getOfferRetailerLabel(offer),
        savingsScore: getOfferSavingsScore(offer),
      }))
      .filter((item) => {
        if (!marketFilterEnabled) return true;
        return selectedRetailers.has(item.retailerKey);
      })
      .sort((left, right) => {
        if (sortMode === SORT_OPTIONS.retailer) {
          const retailerSort = left.retailerLabel.localeCompare(right.retailerLabel, 'de-AT');
          if (retailerSort !== 0) return retailerSort;
        }

        if (sortMode === SORT_OPTIONS.savings) {
          const savingsSort = right.savingsScore - left.savingsScore;
          if (savingsSort !== 0) return savingsSort;
        }

        return left.index - right.index;
      })
      .map((item) => item.offer);
  }, [marketFilterEnabled, offers, selectedRetailerKeys, sortMode]);

  const needsMarketSelection = marketFilterEnabled && selectedRetailerKeys.length === 0;
  const hasActiveMarketFilter = marketFilterEnabled && selectedRetailerKeys.length > 0;

  useEffect(() => {
    if (!shouldScrollToResultsRef.current || (!loading && !submittedQuery && !error)) {
      return;
    }

    const scrollHandle = setTimeout(() => {
      listRef.current?.scrollToOffset({
        offset: Math.max(resultsAnchorYRef.current - 8, 0),
        animated: true,
      });

      if (!loading) {
        shouldScrollToResultsRef.current = false;
      }
    }, 140);

    return () => clearTimeout(scrollHandle);
  }, [error, loading, submittedQuery]);

  async function runSearch() {
    if (loading) {
      return;
    }

    Keyboard.dismiss();
    inputRef.current?.blur();

    const trimmedQuery = query.trim();

    setError('');
    setSubmittedQuery('');

    if (trimmedQuery.length === 0) {
      setRanking(null);
      setMessage(INITIAL_MESSAGE);
      return;
    }

    if (trimmedQuery.length < 2) {
      setRanking(null);
      setMessage('Bitte gib mindestens zwei Zeichen ein.');
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    shouldScrollToResultsRef.current = true;
    setLoading(true);
    setMessage('');

    try {
      const params = new URLSearchParams();
      params.set('q', trimmedQuery);
      params.set('limit', String(SEARCH_LIMIT));
      if (marketFilterEnabled && selectedRetailerKeys.length > 0) {
        params.set('retailers', selectedRetailerKeys.join(','));
        params.set('programRetailers', selectedRetailerKeys.join(','));
      }

      const nextRanking = await fetchJson(`/offers/ranking?${params.toString()}`);

      if (requestIdRef.current !== requestId) {
        return;
      }

      setRanking(nextRanking || null);
      setSubmittedQuery(trimmedQuery);
    } catch (searchError) {
      if (requestIdRef.current !== requestId) {
        return;
      }

      setRanking(null);
      setError('Die Angebote konnten gerade nicht geladen werden.');
    } finally {
      if (requestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }

  function handleQueryChange(value) {
    setQuery(value);
    setError('');

    if (value.trim().length === 0 && !loading) {
      setRanking(null);
      setSubmittedQuery('');
      setMessage(INITIAL_MESSAGE);
    }
  }

  function clearQuery() {
    handleQueryChange('');
    inputRef.current?.focus();
  }

  function toggleRetailer(retailerKey) {
    setSelectedRetailerKeys((current) =>
      current.includes(retailerKey)
        ? current.filter((key) => key !== retailerKey)
        : [...current, retailerKey]
    );
  }

  function toggleMarketFilter() {
    setMarketFilterEnabled((current) => {
      if (current) {
        setSelectedRetailerKeys([]);
      }

      return !current;
    });
  }

  function resetMarketSelection() {
    setSelectedRetailerKeys([]);
  }

  function focusSearchInput() {
    inputRef.current?.focus();
  }

  const header = (
    <View style={styles.header}>
      <View style={styles.hero}>
        <Text style={styles.title}>Was möchtest du günstiger kaufen?</Text>
        <Text style={styles.subtitle}>Suche aktuelle Angebote und merke sie dir für deinen Einkauf.</Text>
      </View>

      <View style={styles.searchBox}>
        <View style={styles.inputWrap}>
          <TextInput
            ref={inputRef}
            value={query}
            onChangeText={handleQueryChange}
            placeholder="z. B. Milch, Kaffee, Butter ..."
            placeholderTextColor="#7b8476"
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
            clearButtonMode="never"
            onSubmitEditing={runSearch}
            blurOnSubmit
            style={styles.input}
          />
          {query.length > 0 ? (
            <Pressable
              style={styles.clearButton}
              onPress={clearQuery}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Suchtext löschen"
            >
              <Text style={styles.clearButtonLabel}>×</Text>
            </Pressable>
          ) : null}
        </View>
        <Pressable
          style={[styles.searchButton, loading ? styles.searchButtonDisabled : null]}
          onPress={runSearch}
          disabled={loading}
        >
          <Text style={styles.searchButtonLabel}>Angebote suchen</Text>
        </Pressable>
      </View>

      <View style={styles.filterPanel}>
        <View style={styles.filterIntro}>
          <Text style={styles.filterTitle}>Optional eingrenzen</Text>
          <Text style={styles.filterText}>
            Du kannst direkt suchen oder vorher bestimmte Märkte auswählen. Produktbereiche findest du unter Stöbern.
          </Text>
        </View>
        <Pressable
          style={[styles.filterToggle, marketFilterEnabled ? styles.filterToggleActive : null]}
          onPress={toggleMarketFilter}
        >
          <Text style={[styles.filterToggleLabel, marketFilterEnabled ? styles.filterToggleLabelActive : null]}>
            Märkte wählen
          </Text>
        </Pressable>

        {marketFilterEnabled ? (
          <View style={styles.marketBlock}>
            {selectedRetailerKeys.length > 0 ? (
              <View style={styles.marketSummaryRow}>
                <Text style={styles.marketSummaryText}>
                  {selectedRetailerKeys.length === 1
                    ? 'Ein Markt ausgewählt'
                    : `${selectedRetailerKeys.length} Märkte ausgewählt`}
                </Text>
                <Pressable style={styles.textAction} onPress={resetMarketSelection}>
                  <Text style={styles.textActionLabel}>Auswahl zurücksetzen</Text>
                </Pressable>
              </View>
            ) : null}
            <View style={styles.chipWrap}>
              {availableRetailers.map((retailer) => {
                const selected = selectedRetailerKeys.includes(retailer.key);

                return (
                  <Pressable
                    key={retailer.key}
                    style={[styles.chip, selected ? styles.chipActive : null]}
                    onPress={() => toggleRetailer(retailer.key)}
                  >
                    <Text style={[styles.chipLabel, selected ? styles.chipLabelActive : null]}>
                      {retailer.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {needsMarketSelection ? (
              <Text style={styles.filterHint}>
                Wähle mindestens einen Markt oder deaktiviere die Eingrenzung.
              </Text>
            ) : null}
          </View>
        ) : null}

        {submittedQuery ? (
          <View style={styles.sortBlock}>
            <Text style={styles.filterLabel}>Sortieren</Text>
            <View style={styles.chipWrap}>
              {Object.values(SORT_OPTIONS).map((option) => {
                const selected = sortMode === option;

                return (
                  <Pressable
                    key={option}
                    style={[styles.chip, selected ? styles.chipActive : null]}
                    onPress={() => setSortMode(option)}
                  >
                    <Text style={[styles.chipLabel, selected ? styles.chipLabelActive : null]}>
                      {SORT_LABELS[option]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}
      </View>

      <View
        collapsable={false}
        onLayout={(event) => {
          resultsAnchorYRef.current = event.nativeEvent.layout.y;
        }}
        style={styles.resultsAnchor}
      >
        {loading ? (
          <View style={styles.statusBox}>
            <ActivityIndicator color="#31582c" />
            <Text style={styles.statusText}>Angebote werden gesucht ...</Text>
          </View>
        ) : null}

        {!loading && error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorTitle}>{error}</Text>
            <Text style={styles.errorText}>Bitte prüfe deine Verbindung und versuche es erneut.</Text>
            <Pressable style={styles.secondaryButton} onPress={runSearch}>
              <Text style={styles.secondaryButtonLabel}>Erneut versuchen</Text>
            </Pressable>
          </View>
        ) : null}

        {!loading && !error && submittedQuery ? (
          <View style={styles.resultsIntro}>
            <Text style={styles.resultsTitle}>Angebote für „{submittedQuery}“</Text>
            <Text style={styles.resultsCount}>
              {visibleOffers.length} aktuelle Angebote gefunden
              {hasActiveMarketFilter ? ' · gefiltert nach ausgewählten Märkten' : ''}
            </Text>
            <Text style={styles.resultsHint}>{MARKET_CHECK_HINT}</Text>
          </View>
        ) : null}

        {!loading && !error && message ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>{message}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <FlatList
        ref={listRef}
        data={loading ? [] : visibleOffers}
        keyExtractor={(item, index) => String(item?.id || item?._id || item?.offerKey || item?.dedupeKey || `offer-${index}`)}
        renderItem={({ item, index }) => (
          <OfferCardComponent
            offer={item}
            rank={index}
            isSelected={Boolean(item?.id && shoppingListMap?.[item.id])}
            onToggleShoppingList={onToggleShoppingList}
            onOpenDetail={onOpenOfferDetail}
          />
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={
          !loading && !error && submittedQuery && visibleOffers.length === 0 ? (
            <View style={styles.emptyState}>
              {needsMarketSelection ? (
                <>
                  <Text style={styles.emptyTitle}>Kein Markt ausgewählt</Text>
                  <Text style={styles.emptyText}>
                    Wähle mindestens einen Markt oder deaktiviere die Eingrenzung.
                  </Text>
                </>
              ) : (
                <>
                  <Text style={styles.emptyTitle}>Keine Angebote gefunden.</Text>
                  <Text style={styles.emptyText}>
                    Für deine Suche haben wir gerade kein passendes Angebot gefunden.
                  </Text>
                  <View style={styles.hintList}>
                    <Text style={styles.hintItem}>Versuche einen allgemeineren Begriff.</Text>
                    <Text style={styles.hintItem}>Prüfe die Schreibweise.</Text>
                    <Text style={styles.hintItem}>Entferne ausgewählte Märkte.</Text>
                  </View>
                </>
              )}
              <View style={styles.emptyActions}>
                <Pressable style={styles.secondaryButton} onPress={focusSearchInput}>
                  <Text style={styles.secondaryButtonLabel}>Suche ändern</Text>
                </Pressable>
                {marketFilterEnabled ? (
                  <Pressable style={styles.textAction} onPress={resetMarketSelection}>
                    <Text style={styles.textActionLabel}>Märkte zurücksetzen</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          ) : null
        }
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={10}
        maxToRenderPerBatch={12}
        windowSize={8}
        removeClippedSubviews={Platform.OS === 'android'}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 18, gap: 12, paddingBottom: 32 },
  header: { gap: 12 },
  hero: {
    gap: 8,
    paddingTop: 4,
  },
  title: {
    color: '#17251a',
    fontSize: 29,
    lineHeight: 35,
    fontWeight: '900',
  },
  subtitle: {
    color: '#4e5b4b',
    fontSize: 15,
    lineHeight: 22,
  },
  searchBox: {
    backgroundColor: '#fffaf1',
    borderRadius: 16,
    padding: 10,
    gap: 9,
    borderWidth: 1,
    borderColor: 'rgba(49, 88, 44, 0.14)',
  },
  inputWrap: {
    position: 'relative',
    justifyContent: 'center',
  },
  input: {
    minHeight: 56,
    borderRadius: 14,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: 'rgba(49, 88, 44, 0.18)',
    paddingLeft: 14,
    paddingRight: 52,
    color: '#17251a',
    fontSize: 16,
  },
  clearButton: {
    position: 'absolute',
    right: 6,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearButtonLabel: {
    color: '#4e5b4b',
    fontSize: 28,
    lineHeight: 30,
    fontWeight: '700',
  },
  searchButton: {
    minHeight: 56,
    borderRadius: 14,
    backgroundColor: '#12361e',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  searchButtonDisabled: {
    opacity: 0.65,
    backgroundColor: '#8a9285',
  },
  searchButtonLabel: {
    color: '#f8f5ed',
    fontSize: 16,
    fontWeight: '900',
  },
  filterPanel: {
    backgroundColor: '#fffaf1',
    borderRadius: 16,
    padding: 12,
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(49, 88, 44, 0.14)',
  },
  filterIntro: { gap: 3 },
  filterTitle: {
    color: '#17251a',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '900',
  },
  filterText: {
    color: '#59635a',
    fontSize: 13,
    lineHeight: 18,
  },
  filterToggle: {
    alignSelf: 'flex-start',
    minHeight: 46,
    borderRadius: 14,
    backgroundColor: '#efe9dc',
    paddingHorizontal: 16,
    paddingVertical: 12,
    justifyContent: 'center',
  },
  filterToggleActive: { backgroundColor: '#31582c' },
  filterToggleLabel: {
    color: '#475246',
    fontSize: 13,
    fontWeight: '900',
  },
  filterToggleLabelActive: { color: '#f8f5ed' },
  sortBlock: { gap: 8 },
  marketBlock: { gap: 8 },
  filterLabel: {
    color: '#4e5b4b',
    fontSize: 13,
    fontWeight: '900',
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    minHeight: 44,
    borderRadius: 999,
    backgroundColor: '#efe9dc',
    paddingHorizontal: 13,
    paddingVertical: 10,
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: '#31582c' },
  chipLabel: {
    color: '#475246',
    fontSize: 13,
    fontWeight: '800',
  },
  chipLabelActive: { color: '#f8f5ed' },
  filterHint: {
    color: '#7c520c',
    backgroundColor: '#fff6dd',
    borderRadius: 12,
    padding: 11,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  marketSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  marketSummaryText: {
    color: '#4e5b4b',
    fontSize: 13,
    fontWeight: '800',
  },
  textAction: {
    alignSelf: 'flex-start',
    minHeight: 36,
    justifyContent: 'center',
    paddingVertical: 6,
  },
  textActionLabel: {
    color: '#31582c',
    fontSize: 13,
    fontWeight: '900',
  },
  resultsAnchor: { gap: 12 },
  statusBox: {
    backgroundColor: '#fffaf1',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  statusText: {
    color: '#425040',
    fontWeight: '800',
  },
  resultsIntro: {
    backgroundColor: '#fffaf1',
    borderRadius: 18,
    padding: 16,
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(49, 88, 44, 0.12)',
  },
  resultsTitle: {
    color: '#17251a',
    fontSize: 19,
    fontWeight: '900',
  },
  resultsCount: {
    color: '#4e5b4b',
    fontSize: 14,
    fontWeight: '700',
  },
  resultsHint: {
    color: '#6a5b36',
    fontSize: 13,
    lineHeight: 18,
  },
  emptyState: {
    backgroundColor: '#fffaf1',
    borderRadius: 18,
    padding: 18,
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(49, 88, 44, 0.12)',
  },
  emptyTitle: {
    color: '#17251a',
    fontSize: 18,
    fontWeight: '900',
  },
  emptyText: {
    color: '#4e5b4b',
    fontSize: 15,
    lineHeight: 22,
  },
  errorBox: {
    backgroundColor: '#fce8e4',
    borderRadius: 14,
    padding: 16,
    gap: 10,
  },
  errorTitle: {
    color: '#8e2c1f',
    fontSize: 16,
    fontWeight: '800',
  },
  errorText: {
    color: '#713125',
    fontSize: 14,
    lineHeight: 20,
  },
  hintList: {
    gap: 4,
  },
  hintItem: {
    color: '#4e5b4b',
    fontSize: 14,
    lineHeight: 20,
  },
  emptyActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
    marginTop: 4,
  },
  secondaryButton: {
    alignSelf: 'flex-start',
    minHeight: 42,
    borderRadius: 13,
    backgroundColor: '#31582c',
    paddingHorizontal: 14,
    paddingVertical: 10,
    justifyContent: 'center',
  },
  secondaryButtonLabel: {
    color: '#f8f5ed',
    fontSize: 13,
    fontWeight: '900',
  },
});
