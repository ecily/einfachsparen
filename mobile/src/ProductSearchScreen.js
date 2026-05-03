import { useMemo, useRef, useState } from 'react';
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

const SORT_OPTIONS = {
  best: 'best',
  retailer: 'retailer',
  savings: 'savings',
};

const SORT_LABELS = {
  [SORT_OPTIONS.best]: 'Beste Treffer',
  [SORT_OPTIONS.retailer]: 'Märkte',
  [SORT_OPTIONS.savings]: 'Größte Ersparnis',
};

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

  return firstPositiveNumber([offer?.savingsPercent, offer?.discountPercent, offer?.discount?.percent]);
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
    .sort((left, right) => left.label.localeCompare(right.label, 'de-AT'));
}

export default function ProductSearchScreen({
  fetchJson,
  flattenRankingOffers,
  OfferCardComponent,
  retailers = [],
  shoppingListMap,
  onToggleShoppingList,
  onOpenOfferDetail,
}) {
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [ranking, setRanking] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('Gib ein Produkt, eine Marke oder Kategorie ein.');
  const [marketFilterEnabled, setMarketFilterEnabled] = useState(false);
  const [selectedRetailerKeys, setSelectedRetailerKeys] = useState([]);
  const [sortMode, setSortMode] = useState(SORT_OPTIONS.best);
  const inputRef = useRef(null);
  const requestIdRef = useRef(0);

  const offers = useMemo(() => {
    try {
      return flattenRankingOffers(ranking);
    } catch (parseError) {
      return [];
    }
  }, [flattenRankingOffers, ranking]);

  const availableRetailers = useMemo(() => buildAvailableRetailers(retailers), [retailers]);

  const visibleOffers = useMemo(() => {
    if (marketFilterEnabled && selectedRetailerKeys.length === 0) return [];

    const selectedRetailers = new Set(selectedRetailerKeys);

    return offers
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
      setMessage('Gib ein Produkt, eine Marke oder Kategorie ein.');
      return;
    }

    if (trimmedQuery.length < 2) {
      setRanking(null);
      setMessage('Bitte mindestens 2 Zeichen eingeben.');
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setMessage('');

    try {
      const params = new URLSearchParams();
      params.set('q', trimmedQuery);
      params.set('limit', String(SEARCH_LIMIT));

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
      setError('Die Suche konnte nicht geladen werden.');
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
      setMessage('Gib ein Produkt, eine Marke oder Kategorie ein.');
    }
  }

  function toggleRetailer(retailerKey) {
    setSelectedRetailerKeys((current) =>
      current.includes(retailerKey)
        ? current.filter((key) => key !== retailerKey)
        : [...current, retailerKey]
    );
  }

  const header = (
    <View style={styles.header}>
      <Text style={styles.title}>Produktsuche</Text>
      <Text style={styles.subtitle}>Suche nach Produkten, Marken oder Kategorien - über alle Händler.</Text>

      <View style={styles.searchBox}>
        <TextInput
          ref={inputRef}
          value={query}
          onChangeText={handleQueryChange}
          placeholder="z. B. Butter, Kaffee, Waschmittel"
          placeholderTextColor="#7b8476"
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
          onSubmitEditing={runSearch}
          blurOnSubmit
          style={styles.input}
        />
        <Pressable
          style={[styles.searchButton, loading ? styles.searchButtonDisabled : null]}
          onPress={runSearch}
          disabled={loading}
        >
          <Text style={styles.searchButtonLabel}>Suchen</Text>
        </Pressable>
      </View>

      <View style={styles.filterPanel}>
        <Pressable
          style={[styles.filterToggle, marketFilterEnabled ? styles.filterToggleActive : null]}
          onPress={() => setMarketFilterEnabled((current) => !current)}
        >
          <Text style={[styles.filterToggleLabel, marketFilterEnabled ? styles.filterToggleLabelActive : null]}>
            Nur bestimmte Märkte
          </Text>
        </Pressable>

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

        {marketFilterEnabled ? (
          <View style={styles.marketBlock}>
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
                Wähle mindestens einen Markt aus oder deaktiviere den Marktfilter.
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>

      {loading ? (
        <View style={styles.statusBox}>
          <ActivityIndicator color="#31582c" />
          <Text style={styles.statusText}>Suche aktuelle Angebote ...</Text>
        </View>
      ) : null}

      {!loading && error ? <Text style={styles.errorBox}>{error}</Text> : null}

      {!loading && !error && submittedQuery ? (
        <View style={styles.resultsIntro}>
          <Text style={styles.resultsTitle}>Suchergebnisse für „{submittedQuery}“</Text>
          <Text style={styles.resultsCount}>
            {visibleOffers.length} aktuelle Angebote gefunden
            {marketFilterEnabled && selectedRetailerKeys.length > 0 ? ' · gefiltert nach ausgewählten Märkten' : ''}
          </Text>
        </View>
      ) : null}

      {!loading && !error && message ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>{message}</Text>
        </View>
      ) : null}
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <FlatList
        data={loading ? [] : visibleOffers}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item, index }) => (
          <OfferCardComponent
            offer={item}
            rank={index}
            isSelected={Boolean(shoppingListMap[item.id])}
            onToggleShoppingList={onToggleShoppingList}
            onOpenDetail={onOpenOfferDetail}
          />
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={
          !loading && !error && submittedQuery && visibleOffers.length === 0 ? (
            <View style={styles.emptyState}>
              {needsMarketSelection ? (
                <Text style={styles.emptyText}>
                  Wähle mindestens einen Markt aus oder deaktiviere den Marktfilter.
                </Text>
              ) : (
                <>
                  <Text style={styles.emptyTitle}>Keine Treffer für „{submittedQuery}“.</Text>
                  <Text style={styles.emptyText}>
                    Tipp: Suche allgemeiner, z. B. „Kaffee“ statt „Jacobs Crema“.
                  </Text>
                </>
              )}
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
  content: { padding: 18, gap: 14, paddingBottom: 32 },
  header: { gap: 14 },
  title: {
    color: '#17251a',
    fontSize: 30,
    fontWeight: '900',
  },
  subtitle: {
    color: '#4e5b4b',
    fontSize: 15,
    lineHeight: 22,
  },
  searchBox: {
    backgroundColor: '#fffaf1',
    borderRadius: 18,
    padding: 12,
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(49, 88, 44, 0.14)',
  },
  input: {
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: 'rgba(49, 88, 44, 0.18)',
    paddingHorizontal: 14,
    color: '#17251a',
    fontSize: 16,
  },
  searchButton: {
    minHeight: 52,
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
    borderRadius: 18,
    padding: 12,
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(49, 88, 44, 0.14)',
  },
  filterToggle: {
    alignSelf: 'flex-start',
    minHeight: 42,
    borderRadius: 999,
    backgroundColor: '#efe9dc',
    paddingHorizontal: 14,
    paddingVertical: 10,
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
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    minHeight: 40,
    borderRadius: 999,
    backgroundColor: '#efe9dc',
    paddingHorizontal: 13,
    paddingVertical: 9,
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
    color: '#8e2c1f',
    borderRadius: 14,
    padding: 14,
    fontWeight: '800',
  },
});
