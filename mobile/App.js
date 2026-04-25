import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
  Text,
  useWindowDimensions,
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

const SHOPPING_LIST_STORAGE_KEY = 'einfachsparen.mobile.shoppingList.v1';
const RETAILER_PROGRAMS_STORAGE_KEY = 'einfachsparen.mobile.retailerPrograms.v1';

function normalizeAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function getReliableSavingsAmount(offer) {
  const directSavings = Number(offer?.savingsAmount);

  if (Number.isFinite(directSavings) && directSavings > 0) {
    return Number(directSavings.toFixed(2));
  }

  const currentAmount = Number(offer?.priceCurrent?.amount);
  const referenceAmount = Number(offer?.priceReference?.amount);

  if (Number.isFinite(currentAmount) && Number.isFinite(referenceAmount) && referenceAmount > currentAmount) {
    return Number((referenceAmount - currentAmount).toFixed(2));
  }

  return 0;
}

function normalizeRetailerKey(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function extractArrayPayload(payload, preferredKeys = []) {
  if (Array.isArray(payload)) {
    return payload;
  }

  for (const key of preferredKeys) {
    if (Array.isArray(payload?.[key])) {
      return payload[key];
    }
  }

  for (const key of ['items', 'results', 'data', 'docs']) {
    if (Array.isArray(payload?.[key])) {
      return payload[key];
    }
  }

  return [];
}

function isOfferDirectlyComparable(offer) {
  return Boolean(offer?.quality?.comparisonSafe && offer?.comparisonGroup && offer?.normalizedUnitPrice?.amount);
}

function getOfferKindLabel(offer) {
  return isOfferDirectlyComparable(offer) ? 'Direkt vergleichbar' : 'Ähnliches Angebot';
}

function getOfferStatusLabel(offer) {
  if (offer?.status === 'active' && offer?.isActiveNow) return 'Aktuell gültig';
  if (offer?.status === 'upcoming') return 'Bald gültig';
  if (offer?.status === 'expired') return 'Nicht mehr gültig';
  if (offer?.isActiveToday) return 'Heute relevant';
  return 'Status unklar';
}

function shouldDisplayUnitPrice(offer) {
  const amount = Number(offer?.normalizedUnitPrice?.amount);
  const unit = String(offer?.normalizedUnitPrice?.unit || offer?.comparableUnit || '');
  const packageType = String(offer?.packageType || '').toLowerCase();
  const packCount = Number(offer?.packCount || 0);
  const unitType = String(offer?.unitType || '');

  if (!Number.isFinite(amount) || !unit) {
    return false;
  }

  if (unit === 'Stk' && packCount > 1 && (packageType === 'pack' || packageType === 'box' || packageType === 'blister' || unitType === 'Stk')) {
    return false;
  }

  return true;
}

function getConditionsSummary(offer) {
  if (offer?.conditionsText) {
    return offer.conditionsText;
  }

  if (offer?.customerProgramRequired) {
    return 'Mit Kundenkarte/App';
  }

  if (offer?.isMultiBuy) {
    return 'Mehrkauf-Angebot';
  }

  const minimumPurchaseQty = Number(offer?.minimumPurchaseQty || offer?.minimumPurchaseQuantity || 1);
  if (minimumPurchaseQty > 1) {
    return `Mindestmenge: ${minimumPurchaseQty}`;
  }

  return '';
}

function buildOfferBadges(offer) {
  const badges = [getOfferKindLabel(offer), getOfferStatusLabel(offer)];

  if (offer?.customerProgramRequired) badges.push('Mit Kundenkarte/App');
  if (offer?.isMultiBuy) badges.push('Mehrkauf-Angebot');
  if (Number(offer?.minimumPurchaseQty || offer?.minimumPurchaseQuantity || 1) > 1) badges.push('Mindestmenge nötig');

  return badges;
}

function formatValidityLabel(offer) {
  const hasValidFrom = Boolean(offer?.validFrom);
  const hasValidTo = Boolean(offer?.validTo);

  if (hasValidFrom && hasValidTo) {
    return `Gültig ${new Date(offer.validFrom).toLocaleDateString('de-AT')} bis ${new Date(offer.validTo).toLocaleDateString('de-AT')}`;
  }

  if (hasValidFrom) {
    return `Gültig ab ${new Date(offer.validFrom).toLocaleDateString('de-AT')}`;
  }

  if (hasValidTo) {
    return `Gültig bis ${new Date(offer.validTo).toLocaleDateString('de-AT')}`;
  }

  return 'Aktuell verfügbar, Enddatum nicht erkannt';
}

function getRetailerColor(retailerKey) {
  const normalizedKey = String(retailerKey || '').toLowerCase().replace(/_/g, '-');
  return RETAILER_COLORS[normalizedKey] || '#31582c';
}

function getRetailerTextColor(retailerKey) {
  const normalizedKey = String(retailerKey || '').toLowerCase().replace(/_/g, '-');
  return RETAILER_TEXT_COLORS[normalizedKey] || '#ffffff';
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
      savingsTotal: group.offers.reduce((sum, offer) => sum + getReliableSavingsAmount(offer), 0),
      currentTotal: group.offers.reduce((sum, offer) => sum + normalizeAmount(offer.priceCurrent?.amount), 0),
    }))
    .sort((left, right) => left.retailerName.localeCompare(right.retailerName, 'de'));
}

function applyCustomerProgramFilter(baseRanking, retailerProgramMap) {
  if (!baseRanking) {
    return null;
  }

  const rankedGroups = (baseRanking.rankedGroups || [])
    .map((group) => ({
      ...group,
      offers: (group.offers || []).filter((offer) => (
        !offer?.customerProgramRequired || Boolean(retailerProgramMap?.[offer.retailerKey])
      )),
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
      completeResultSetVisible: true,
      bestUnitPrice: firstBestOffer?.normalizedUnitPrice
        ? `${firstBestOffer.normalizedUnitPrice.amount}/${firstBestOffer.normalizedUnitPrice.unit}`
        : '-',
    },
  };
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

function DetailRow({ label, value, strong = false }) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, strong ? styles.detailValueStrong : null]}>{value}</Text>
    </View>
  );
}

function OfferDetailModal({ offer, visible, isSelected, bottomInset = 0, onClose, onToggleShoppingList }) {
  if (!offer) {
    return null;
  }

  const reliableSavingsAmount = getReliableSavingsAmount(offer);
  const conditionsSummary = getConditionsSummary(offer);
  const comparisonSafe = Boolean(offer?.quality?.comparisonSafe);
  const normalizedUnitPrice = shouldDisplayUnitPrice(offer)
    ? `${formatCurrency(offer.normalizedUnitPrice?.amount, offer.priceCurrent?.currency)}/${offer.normalizedUnitPrice?.unit}`
    : '';
  const referenceAmount = Number(offer?.priceReference?.amount);
  const referencePrice = Number.isFinite(referenceAmount)
    ? formatCurrency(referenceAmount, offer.priceCurrent?.currency)
    : '';

  function handleShoppingListPress() {
    onToggleShoppingList(offer);
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.detailOverlay}>
        <View style={styles.detailSheet}>
          <ScrollView contentContainerStyle={styles.detailContent}>
            <OfferImage
              offer={offer}
              sizeStyle={styles.detailImage}
              placeholderStyle={styles.detailImageFallback}
              placeholderTextStyle={styles.offerImageFallbackText}
            />

            <View style={styles.detailHeader}>
              <View style={styles.offerBadgeRow}>
                <View style={[styles.retailerBadge, { backgroundColor: getRetailerColor(offer.retailerKey) }]}>
                  <Text style={[styles.retailerBadgeLabel, { color: getRetailerTextColor(offer.retailerKey) }]}>{offer.retailerName}</Text>
                </View>
                <View style={styles.metaPill}>
                  <Text style={styles.metaPillLabel}>{getOfferStatusLabel(offer)}</Text>
                </View>
              </View>
              <Text style={styles.detailTitle}>{offer.title}</Text>
              <Text style={styles.offerCategory}>{getOfferCategoryLabel(offer)}</Text>
            </View>

            {conditionsSummary ? (
              <View style={styles.detailNotice}>
                <Text style={styles.detailNoticeText}>{conditionsSummary}</Text>
              </View>
            ) : null}

            <View style={styles.detailSection}>
              <Text style={styles.detailSectionTitle}>Preis</Text>
              <DetailRow label="Aktionspreis" value={formatCurrency(offer.priceCurrent?.amount, offer.priceCurrent?.currency)} strong />
              <DetailRow label="Vergleichspreis" value={referencePrice} />
              <DetailRow
                label="Ersparnis"
                value={reliableSavingsAmount > 0 ? formatCurrency(reliableSavingsAmount, offer.priceCurrent?.currency) : '-'}
              />
              <DetailRow label="Einheitspreis" value={normalizedUnitPrice} />
              <DetailRow label="Menge" value={offer.quantityText || 'nicht erkannt'} />
            </View>

            <View style={styles.detailSection}>
              <Text style={styles.detailSectionTitle}>Gültigkeit & Bedingungen</Text>
              <DetailRow label="Zeitraum" value={formatValidityLabel(offer)} />
              <DetailRow label="Kundenkarte/App" value={offer.customerProgramRequired ? 'erforderlich' : 'nicht erforderlich'} />
              <DetailRow label="Mehrkauf" value={offer.isMultiBuy ? 'ja' : 'nein'} />
              <DetailRow
                label="Mindestmenge"
                value={Number(offer?.minimumPurchaseQty || offer?.minimumPurchaseQuantity || 1) > 1
                  ? String(offer.minimumPurchaseQty || offer.minimumPurchaseQuantity)
                  : 'keine'}
              />
            </View>

            <View style={styles.detailSection}>
              <Text style={styles.detailSectionTitle}>Vergleichbarkeit</Text>
              <DetailRow label="Einordnung" value={getOfferKindLabel(offer)} />
              <DetailRow label="Sicher vergleichbar" value={comparisonSafe ? 'ja' : 'nein'} />
              <DetailRow label="Vergleichsgruppe" value={offer.comparisonGroup || ''} />
            </View>
          </ScrollView>

          <View style={[styles.detailFooter, { paddingBottom: Math.max(18, bottomInset + 14) }]}>
            <Pressable
              style={[styles.detailPrimaryButton, isSelected ? styles.detailDangerButton : null]}
              onPress={handleShoppingListPress}
            >
              <Text style={styles.detailPrimaryButtonLabel}>
                {isSelected ? 'Von Einkaufsliste entfernen' : 'Auf die Einkaufsliste'}
              </Text>
            </Pressable>
            <Pressable style={styles.detailSecondaryButton} onPress={onClose}>
              <Text style={styles.detailSecondaryButtonLabel}>Zurück</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function OfferCard({ offer, rank, isSelected, onToggleShoppingList, onOpenDetail }) {
  const { width } = useWindowDimensions();
  const isCompact = width < 390;
  const reliableSavingsAmount = getReliableSavingsAmount(offer);
  const savingsText = reliableSavingsAmount > 0
    ? formatCurrency(reliableSavingsAmount, offer.priceCurrent?.currency)
    : '-';
  const retailerColor = getRetailerColor(offer.retailerKey);
  const retailerTextColor = getRetailerTextColor(offer.retailerKey);
  const badges = buildOfferBadges(offer);
  const conditionsSummary = getConditionsSummary(offer);

  return (
    <Pressable
      style={[styles.offerCard, isCompact ? styles.offerCardCompact : null, rank === 0 ? styles.offerCardBest : null]}
      onPress={() => onOpenDetail(offer)}
    >
      <OfferImage
        offer={offer}
        sizeStyle={[styles.offerImage, isCompact ? styles.offerImageCompact : null]}
        placeholderStyle={[styles.offerImageFallback, isCompact ? styles.offerImageFallbackCompact : null]}
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
            {badges.map((badge) => (
              <View key={badge} style={styles.metaPill}>
                <Text style={styles.metaPillLabel}>{badge}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.offerCategory}>{getOfferCategoryLabel(offer)}</Text>
        </View>
        <Text style={styles.offerTitle}>{offer.title}</Text>
        {conditionsSummary ? <Text style={styles.offerCondition}>{conditionsSummary}</Text> : null}
        <View style={[styles.offerPriceRow, isCompact ? styles.offerPriceRowCompact : null]}>
          <View style={styles.offerPriceBox}>
            <Text style={styles.offerPrice}>{formatCurrency(offer.priceCurrent?.amount, offer.priceCurrent?.currency)}</Text>
            {shouldDisplayUnitPrice(offer) ? (
              <Text style={styles.offerMeta}>
                {formatCurrency(offer.normalizedUnitPrice?.amount, offer.priceCurrent?.currency)}/{offer.normalizedUnitPrice?.unit}
              </Text>
            ) : null}
          </View>
          <View style={[styles.savingsBox, isCompact ? styles.savingsBoxCompact : null]}>
            <Text style={styles.savingsLabel}>Ersparnis heute</Text>
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
    </Pressable>
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
  onOpenOfferDetail,
  hero,
  selectedRetailerCount,
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
              Wähle zuerst Händler aus und starte dann deine Suche mit "Los".
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
          onOpenDetail={onOpenOfferDetail}
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
          <Text style={styles.emptyText}>
            {selectedRetailerCount === 0
              ? 'Wähle zuerst mindestens einen Händler aus.'
              : 'Aktuell wurden keine passenden Angebote gefunden. Wähle andere Händler oder erweitere die Kategorien.'}
          </Text>
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
  const { width } = useWindowDimensions();
  const isCompact = width < 390;
  const groupedEntries = useMemo(
    () => groupShoppingListEntries(shoppingListEntries),
    [shoppingListEntries]
  );
  const totalSavings = useMemo(
    () => shoppingListEntries.reduce((sum, offer) => sum + getReliableSavingsAmount(offer), 0),
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
          Die Produkte sind nach Anbieter gruppiert, damit du deine Einkäufe schnell nacheinander erledigen kannst.
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
            <View key={offer.id} style={[styles.listItemCard, isCompact ? styles.listItemCardCompact : null]}>
              <OfferImage
                offer={offer}
                sizeStyle={[styles.listItemImage, isCompact ? styles.listItemImageCompact : null]}
                placeholderStyle={[styles.listItemImageFallback, isCompact ? styles.listItemImageFallbackCompact : null]}
                placeholderTextStyle={styles.listItemImageFallbackText}
              />
              <View style={styles.listItemBody}>
                <Text style={styles.listItemTitle}>{offer.title}</Text>
                {offer.conditionsText ? <Text style={styles.offerCondition}>{offer.conditionsText}</Text> : null}
                <Text style={styles.offerMeta}>{formatCurrency(offer.priceCurrent?.amount, offer.priceCurrent?.currency)}</Text>
                <Text style={styles.offerMeta}>
                  Ersparnis: {getReliableSavingsAmount(offer) > 0 ? formatCurrency(getReliableSavingsAmount(offer), offer.priceCurrent?.currency) : '-'}
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
  const [retailers, setRetailers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [ranking, setRanking] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [selectedRetailers, setSelectedRetailers] = useState([]);
  const [expandedGroups, setExpandedGroups] = useState({});
  const [shoppingListMap, setShoppingListMap] = useState({});
  const [shoppingListHydrated, setShoppingListHydrated] = useState(false);
  const [retailerProgramMap, setRetailerProgramMap] = useState({});
  const [retailerProgramsHydrated, setRetailerProgramsHydrated] = useState(false);
  const [hasTriggeredSearch, setHasTriggeredSearch] = useState(false);
  const [selectedOffer, setSelectedOffer] = useState(null);
  const androidTopInset = Platform.OS === 'android' ? (NativeStatusBar.currentHeight || 0) : 0;
  const androidBottomInset = Platform.OS === 'android' ? 18 : 0;

  async function fetchJson(path, options) {
    const response = await fetch(`${API_BASE_URL}${path}`, options);
    let payload = null;

    try {
      payload = await response.json();
    } catch (error) {
      payload = null;
    }

    if (!response.ok) {
      throw new Error(payload?.message || `API-Fehler ${response.status}`);
    }

    return payload;
  }

  async function loadBootstrap() {
    try {
      const [healthData, retailerPayload] = await Promise.all([
        fetchJson('/health'),
        fetchJson('/filters/retailers'),
      ]);
      setHealth({
        ok: Boolean(healthData?.ok),
        environment: healthData?.environment || '',
        region: healthData?.region || '',
      });
      setRetailers(extractArrayPayload(retailerPayload, ['retailers']));
      setCategories([]);
      setRanking(null);
      setError('');
    } catch (loadError) {
      setError(loadError.message || 'App konnte nicht initialisiert werden.');
    }
  }

  async function loadCategories(retailerKeys = []) {
    try {
      const params = new URLSearchParams();

      if (retailerKeys.length > 0) {
        params.set('retailers', retailerKeys.join(','));
      }

      const suffix = params.toString() ? `?${params.toString()}` : '';
      const categoryPayload = await fetchJson(`/filters/categories${suffix}`);
      const nextCategories = extractArrayPayload(categoryPayload, ['categories']);

      setCategories(nextCategories);
      setSelectedCategories((current) => {
        const validLabels = new Set();

        for (const category of nextCategories) {
          if ((category?.subcategories || []).length > 0) {
            for (const subcategory of category.subcategories || []) {
              if (subcategory?.subcategoryLabel) {
                validLabels.add(subcategory.subcategoryLabel);
              }
            }
          } else if (category?.mainCategoryLabel) {
            validLabels.add(category.mainCategoryLabel);
          }
        }

        return current.filter((label) => validLabels.has(label));
      });
      setError('');
    } catch (loadError) {
      setCategories([]);
      setError(loadError.message || 'Kategorien konnten nicht geladen werden.');
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
      params.set('limit', 'all');

      if (selectedRetailers.length === 0) {
        setRanking(null);
        setError('');
        return;
      }

      const rankingData = await fetchJson(`/offers/ranking?${params.toString()}`);
      setRanking(rankingData || null);
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
    let cancelled = false;

    async function loadStoredShoppingList() {
      try {
        const storedValue = await AsyncStorage.getItem(SHOPPING_LIST_STORAGE_KEY);
        if (!storedValue || cancelled) {
          return;
        }

        const parsed = JSON.parse(storedValue);
        const entries = Array.isArray(parsed) ? parsed : Object.values(parsed || {});
        const nextMap = {};

        for (const offer of entries) {
          if (offer?.id) {
            nextMap[offer.id] = offer;
          }
        }

        setShoppingListMap(nextMap);
      } catch (storageError) {
        console.warn('Einkaufsliste konnte nicht geladen werden.', storageError);
      } finally {
        if (!cancelled) {
          setShoppingListHydrated(true);
        }
      }
    }

    loadStoredShoppingList();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!shoppingListHydrated) {
      return;
    }

    AsyncStorage.setItem(
      SHOPPING_LIST_STORAGE_KEY,
      JSON.stringify(Object.values(shoppingListMap))
    ).catch((storageError) => {
      console.warn('Einkaufsliste konnte nicht gespeichert werden.', storageError);
    });
  }, [shoppingListHydrated, shoppingListMap]);

  useEffect(() => {
    let cancelled = false;

    async function loadStoredRetailerPrograms() {
      try {
        const storedValue = await AsyncStorage.getItem(RETAILER_PROGRAMS_STORAGE_KEY);
        if (!storedValue || cancelled) {
          return;
        }

        const parsed = JSON.parse(storedValue);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          setRetailerProgramMap(parsed);
        }
      } catch (storageError) {
        console.warn('Kundenkarten-Auswahl konnte nicht geladen werden.', storageError);
      } finally {
        if (!cancelled) {
          setRetailerProgramsHydrated(true);
        }
      }
    }

    loadStoredRetailerPrograms();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!retailerProgramsHydrated) {
      return;
    }

    AsyncStorage.setItem(
      RETAILER_PROGRAMS_STORAGE_KEY,
      JSON.stringify(retailerProgramMap)
    ).catch((storageError) => {
      console.warn('Kundenkarten-Auswahl konnte nicht gespeichert werden.', storageError);
    });
  }, [retailerProgramsHydrated, retailerProgramMap]);

  useEffect(() => {
    loadCategories(selectedRetailers);
  }, [selectedRetailers]);

  const categoryGroups = useMemo(() => buildCategoryGroups(categories || []), [categories]);
  const visibleRanking = useMemo(
    () => applyCustomerProgramFilter(ranking, retailerProgramMap),
    [ranking, retailerProgramMap]
  );
  const summary = visibleRanking?.summary || ranking?.summary || {};
  const selectedRetailerDetails = useMemo(
    () => selectedRetailers
      .map((retailerKey) => (
        retailers.find((retailer) => retailer.retailerKey === retailerKey)
        || { retailerKey, retailerName: retailerKey }
      )),
    [retailers, selectedRetailers]
  );

  function startSearch() {
    setHasTriggeredSearch(true);
    loadRanking(false);
  }

  function clearFilters() {
    setSelectedRetailers([]);
    setSelectedCategories([]);
    setExpandedGroups({});
    setHasTriggeredSearch(false);
    setRanking(null);
    setError('');
    setLoading(false);
    setRefreshing(false);
  }

  function toggleRetailer(retailerKey) {
    setSelectedRetailers((current) => (
      current.includes(retailerKey)
        ? current.filter((item) => item !== retailerKey)
        : [...current, retailerKey]
    ));
  }

  function toggleRetailerProgram(retailerKey) {
    setRetailerProgramMap((current) => ({
      ...current,
      [retailerKey]: !current[retailerKey],
    }));
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
      if (subcategories.length === 0) {
        return current;
      }

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
    return offers.reduce((max, offer) => Math.max(max, getReliableSavingsAmount(offer)), 0);
  }, [visibleRanking]);
  const resultCount = summary.resultCount || 0;
  const displayedCount = summary.displayedCount || 0;
  const activeProgramCount = selectedRetailerDetails.filter((retailer) => retailerProgramMap[retailer.retailerKey]).length;
  const quickFilterSummary = [
    selectedRetailers.length ? `${selectedRetailers.length} Anbieter` : null,
    selectedCategories.length ? `${selectedCategories.length} Kategorien` : null,
    activeProgramCount ? `${activeProgramCount} App/Karte` : null,
  ].filter(Boolean).join(' | ');
  const searchHeader = (
    <>
      <View style={styles.heroCard}>
        <Text style={styles.eyebrow}>kaufgut.at app</Text>
        <Text style={styles.title}>{APP_NAME}</Text>
        <Text style={styles.subtitle}>
          Finde die besten aktuellen Angebote schneller, vergleiche fair und sammle Produkte direkt für deinen Einkauf.
        </Text>

        <View style={styles.heroFooter}>
          <View style={[styles.livePill, health.ok ? styles.livePillActive : null]}>
            <Text style={[styles.livePillLabel, health.ok ? styles.livePillLabelActive : null]}>
              {health.ok ? `Live | ${health.region || 'Region aktiv'}` : 'Verbindung prüfen'}
            </Text>
          </View>
          <Text style={styles.heroHint}>Stand: {health.environment || 'mobile preview'}</Text>
        </View>
      </View>

      <View style={styles.searchCard}>
        <Text style={styles.searchSectionTitle}>Welche Händler möchtest du berücksichtigen?</Text>
        <View style={styles.chipWrap}>
          {(retailers || []).map((retailer) => (
            <FilterChip
              key={retailer.retailerKey}
              label={`${retailer.retailerName}${Number(retailer.activeOfferCount || 0) > 0 ? ` (${retailer.activeOfferCount})` : ''}`}
              active={selectedRetailers.includes(retailer.retailerKey)}
              activeBackgroundColor={getRetailerColor(retailer.retailerKey)}
              activeTextColor={getRetailerTextColor(retailer.retailerKey)}
              onPress={() => toggleRetailer(retailer.retailerKey)}
            />
          ))}
        </View>

        <View style={styles.actionRow}>
          <Pressable style={styles.primaryButton} onPress={clearFilters}>
            <Text style={styles.primaryButtonLabel}>Filter löschen</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={startSearch}>
            <Text style={styles.secondaryButtonLabel}>Los</Text>
          </Pressable>
        </View>

        {selectedRetailerDetails.length > 0 ? (
          <View style={styles.programPanel}>
            <Text style={styles.programTitle}>Kundenkarte/App je Anbieter</Text>
            <Text style={styles.programHint}>
              Angebote mit App- oder Kartenvorteil zeigen wir nur, wenn du den Vorteil beim Anbieter aktiviert hast.
            </Text>
            <View style={styles.programList}>
              {selectedRetailerDetails.map((retailer) => {
                const active = Boolean(retailerProgramMap[retailer.retailerKey]);

                return (
                  <View key={retailer.retailerKey} style={styles.programRow}>
                    <View style={[styles.retailerBadge, { backgroundColor: getRetailerColor(retailer.retailerKey) }]}>
                      <Text style={[styles.retailerBadgeLabel, { color: getRetailerTextColor(retailer.retailerKey) }]}>
                        {retailer.retailerName}
                      </Text>
                    </View>
                    <Pressable
                      style={[styles.programToggle, active ? styles.programToggleActive : null]}
                      onPress={() => toggleRetailerProgram(retailer.retailerKey)}
                    >
                      <Text style={[styles.programToggleLabel, active ? styles.programToggleLabelActive : null]}>
                        {active ? 'App/Karte vorhanden' : 'Keine App/Karte'}
                      </Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          </View>
        ) : null}

        <View style={styles.inlineFilterSection}>
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
                    active={allSelected || (group.subcategories.length === 0 && selectedCategories.includes(group.mainCategory))}
                    partial={partial}
                    onPress={() => (
                      group.subcategories.length > 0
                        ? toggleMainCategory(group.subcategories)
                        : toggleCategory(group.mainCategory)
                    )}
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
          <Pressable style={styles.fullWidthSearchButton} onPress={startSearch}>
            <Text style={styles.fullWidthSearchButtonLabel}>Los</Text>
          </Pressable>
        </View>

        <View style={styles.quickInfoCard}>
          <Text style={styles.quickInfoTitle}>Suchstatus</Text>
          <Text style={styles.quickInfoText}>
            {hasTriggeredSearch
              ? `${resultCount} passende Angebote | ${displayedCount} aktuell sichtbar`
              : 'Noch keine Suche gestartet | standardmäßig sind keine Händler aktiv'}
          </Text>
          {quickFilterSummary ? <Text style={styles.quickInfoText}>Aktive Filter: {quickFilterSummary}</Text> : null}
        </View>
      </View>

      <View style={styles.summaryRow}>
        <SummaryCard label="Passende Angebote" value={hasTriggeredSearch ? resultCount : '-'} accent />
        <SummaryCard label="Aktuell sichtbar" value={hasTriggeredSearch ? displayedCount : '-'} />
        <SummaryCard label="Größte Ersparnis" value={hasTriggeredSearch ? formatCurrency(strongestSaving) : '-'} />
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
          onOpenOfferDetail={setSelectedOffer}
          hero={searchHeader}
          selectedRetailerCount={selectedRetailers.length}
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
              Finde die besten aktuellen Angebote schneller, vergleiche fair und sammle Produkte direkt für deinen Einkauf.
            </Text>
          </View>
          <ShoppingListPage
            shoppingListEntries={shoppingListEntries}
            onRemove={removeFromShoppingList}
          />
        </ScrollView>
      )}

      <OfferDetailModal
        offer={selectedOffer}
        visible={Boolean(selectedOffer)}
        isSelected={Boolean(selectedOffer?.id && shoppingListMap[selectedOffer.id])}
        bottomInset={androidBottomInset}
        onClose={() => setSelectedOffer(null)}
        onToggleShoppingList={toggleShoppingList}
      />
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
  searchSectionTitle: { color: '#31582c', fontSize: 16, fontWeight: '800' },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 },
  primaryButton: { flexGrow: 1, backgroundColor: '#31582c', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center' },
  primaryButtonLabel: { color: '#f8f5ed', fontWeight: '700', textAlign: 'center' },
  secondaryButton: { flexGrow: 1, backgroundColor: '#ece4d7', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center' },
  secondaryButtonLabel: { color: '#304230', fontWeight: '700', textAlign: 'center' },
  programPanel: { backgroundColor: '#f3eddc', borderRadius: 16, padding: 12, gap: 8 },
  programTitle: { color: '#31582c', fontSize: 13, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1 },
  programHint: { color: '#566253', fontSize: 12, lineHeight: 17 },
  programList: { gap: 8 },
  programRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' },
  programToggle: { flexGrow: 1, alignItems: 'center', backgroundColor: '#efe8da', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  programToggleActive: { backgroundColor: '#31582c' },
  programToggleLabel: { color: '#4b5849', fontSize: 12, fontWeight: '800' },
  programToggleLabelActive: { color: '#f8f5ed' },
  inlineFilterSection: { gap: 10 },
  fullWidthSearchButton: { backgroundColor: '#12361e', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, alignItems: 'center' },
  fullWidthSearchButtonLabel: { color: '#f8f5ed', fontWeight: '800', fontSize: 15 },
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
  offerCardCompact: { flexDirection: 'column' },
  offerCardBest: { backgroundColor: '#edf7df' },
  offerImage: { width: 80, height: 80, borderRadius: 14, backgroundColor: '#fff' },
  offerImageCompact: { width: '100%', height: 132 },
  offerImageFallback: { width: 80, height: 80, borderRadius: 14, backgroundColor: '#dfe9d5', alignItems: 'center', justifyContent: 'center', padding: 8 },
  offerImageFallbackCompact: { width: '100%', height: 132 },
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
  offerPriceRowCompact: { alignItems: 'stretch', flexWrap: 'wrap' },
  offerPriceBox: { gap: 2 },
  offerPrice: { color: '#173118', fontSize: 20, fontWeight: '800' },
  offerMeta: { color: '#59635a', fontSize: 13 },
  metaWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  metaPill: { backgroundColor: '#efe8da', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  metaPillWide: { backgroundColor: '#e7f0da', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  metaPillLabel: { color: '#59635a', fontSize: 12, fontWeight: '600' },
  savingsBox: { alignItems: 'flex-end', backgroundColor: '#fffaf2', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 8, minWidth: 94 },
  savingsBoxCompact: { alignItems: 'flex-start', minWidth: 140 },
  savingsLabel: { color: '#5d695a', fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  savingsValue: { color: '#173118', fontSize: 15, fontWeight: '800' },
  shoppingToggle: { marginTop: 4, alignSelf: 'flex-start', backgroundColor: '#ece4d7', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 999 },
  shoppingToggleActive: { backgroundColor: '#31582c' },
  shoppingToggleLabel: { color: '#304230', fontSize: 13, fontWeight: '700' },
  shoppingToggleLabelActive: { color: '#f8f5ed' },
  detailOverlay: { flex: 1, backgroundColor: 'rgba(18, 28, 18, 0.45)', justifyContent: 'flex-end' },
  detailSheet: { maxHeight: '88%', backgroundColor: '#f4efe5', borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden' },
  detailContent: { padding: 18, gap: 14, paddingBottom: 18 },
  detailImage: { width: '100%', height: 180, borderRadius: 18, backgroundColor: '#fff' },
  detailImageFallback: { width: '100%', height: 180, borderRadius: 18, backgroundColor: '#dfe9d5', alignItems: 'center', justifyContent: 'center', padding: 12 },
  detailHeader: { gap: 8 },
  detailTitle: { color: '#132014', fontSize: 22, lineHeight: 28, fontWeight: '800' },
  detailNotice: { backgroundColor: '#fff6dd', borderRadius: 16, padding: 12, borderWidth: 1, borderColor: '#ead49a' },
  detailNoticeText: { color: '#80520a', fontSize: 14, lineHeight: 20, fontWeight: '700' },
  detailSection: { backgroundColor: '#fffaf2', borderRadius: 18, padding: 14, gap: 10, borderWidth: 1, borderColor: 'rgba(19, 32, 20, 0.08)' },
  detailSectionTitle: { color: '#31582c', fontSize: 15, fontWeight: '800' },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 14, alignItems: 'flex-start' },
  detailLabel: { flex: 1, color: '#657063', fontSize: 13, fontWeight: '700' },
  detailValue: { flex: 1.35, color: '#182518', fontSize: 14, lineHeight: 20, textAlign: 'right' },
  detailValueStrong: { fontSize: 18, lineHeight: 24, fontWeight: '800', color: '#173118' },
  detailFooter: { flexDirection: 'row', gap: 10, padding: 18, paddingTop: 12, backgroundColor: '#f4efe5', borderTopWidth: 1, borderTopColor: 'rgba(19, 32, 20, 0.08)' },
  detailPrimaryButton: { flex: 1.5, backgroundColor: '#31582c', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 14, alignItems: 'center' },
  detailDangerButton: { backgroundColor: '#7b3535' },
  detailPrimaryButtonLabel: { color: '#f8f5ed', fontWeight: '800', textAlign: 'center' },
  detailSecondaryButton: { flex: 1, backgroundColor: '#ece4d7', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 14, alignItems: 'center' },
  detailSecondaryButtonLabel: { color: '#304230', fontWeight: '800', textAlign: 'center' },
  shoppingHero: { backgroundColor: '#fffaf2', borderRadius: 24, padding: 16, gap: 6, borderWidth: 1, borderColor: 'rgba(19, 32, 20, 0.08)' },
  shoppingHeroTitle: { color: '#132014', fontSize: 20, fontWeight: '800' },
  shoppingHeroText: { color: '#5f685e', fontSize: 14, lineHeight: 20 },
  sectionTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, alignItems: 'center' },
  sectionTitle: { color: '#142214', fontSize: 18, fontWeight: '800' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 999, backgroundColor: '#efe9dc' },
  chipActive: { backgroundColor: '#31582c' },
  chipPartial: { backgroundColor: '#dce9ca' },
  chipLabel: { color: '#475246', fontSize: 13, fontWeight: '700' },
  chipLabelActive: { color: '#f8f5ed' },
  resetButton: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: '#f1ebdf' },
  resetButtonLabel: { color: '#31582c', fontSize: 13, fontWeight: '700' },
  categoryCard: { backgroundColor: '#f8f3e8', borderRadius: 18, padding: 10, gap: 8 },
  linkButton: { paddingHorizontal: 6, paddingVertical: 4 },
  linkButtonLabel: { color: '#31582c', fontSize: 13, fontWeight: '700' },
  listItemCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#f8f3e8', borderRadius: 18, padding: 12 },
  listItemCardCompact: { flexWrap: 'wrap', alignItems: 'flex-start' },
  listItemImage: { width: 72, height: 72, borderRadius: 12, backgroundColor: '#fff' },
  listItemImageCompact: { width: 64, height: 64 },
  listItemImageFallback: { width: 72, height: 72, borderRadius: 12, backgroundColor: '#dfe9d5', alignItems: 'center', justifyContent: 'center', padding: 8 },
  listItemImageFallbackCompact: { width: 64, height: 64 },
  listItemImageFallbackText: { color: '#31582c', fontSize: 11, fontWeight: '800', textAlign: 'center' },
  listItemBody: { flex: 1, gap: 4 },
  listItemTitle: { color: '#152315', fontSize: 15, lineHeight: 20, fontWeight: '700' },
  removeButton: { backgroundColor: '#efe5da', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 10, alignSelf: 'flex-start' },
  removeButtonLabel: { color: '#7b3535', fontSize: 12, fontWeight: '700', textAlign: 'center' },
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
