import { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

const SEARCH_LIMIT = 60;

export default function ProductSearchScreen({
  fetchJson,
  flattenRankingOffers,
  OfferCardComponent,
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
  const inputRef = useRef(null);
  const requestIdRef = useRef(0);

  const offers = useMemo(() => {
    try {
      return flattenRankingOffers(ranking);
    } catch (parseError) {
      return [];
    }
  }, [flattenRankingOffers, ranking]);

  async function runSearch() {
    if (loading) {
      return;
    }

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

  const header = (
    <View style={styles.header}>
        <Text style={styles.title}>Produktsuche</Text>
        <Text style={styles.subtitle}>Suche nach Produkten, Marken oder Kategorien – über alle Händler.</Text>

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
            blurOnSubmit={false}
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

        {loading ? (
          <View style={styles.statusBox}>
            <ActivityIndicator color="#31582c" />
            <Text style={styles.statusText}>Suche aktuelle Angebote …</Text>
          </View>
        ) : null}

        {!loading && error ? <Text style={styles.errorBox}>{error}</Text> : null}

        {!loading && !error && submittedQuery ? (
          <View style={styles.resultsIntro}>
            <Text style={styles.resultsTitle}>Suchergebnisse für „{submittedQuery}“</Text>
            <Text style={styles.resultsCount}>{offers.length} aktuelle Angebote gefunden</Text>
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
        data={loading ? [] : offers}
        keyExtractor={(item) => item.id}
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
          !loading && !error && submittedQuery && offers.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>Keine aktuellen Angebote gefunden.</Text>
              <Text style={styles.emptyText}>
                Tipp: Suche allgemeiner, z. B. „Kaffee“ statt „Jacobs Crema“.
              </Text>
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
    backgroundColor: '#31582c',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  searchButtonDisabled: {
    opacity: 0.65,
  },
  searchButtonLabel: {
    color: '#f8f5ed',
    fontSize: 16,
    fontWeight: '900',
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
