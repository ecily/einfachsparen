import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
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
import { API_BASE_URL } from './src/config/api';
import {
  buildCategoryGroups,
  formatCurrency,
  getOfferCategoryLabel,
} from './src/searchHelpers';

const BRAND_NAME = 'kaufklug.at';
const ECILY_URL = 'https://www.ecily.com';
const SHOPPING_LIST_STORAGE_KEY = 'einfachsparen.mobile.shoppingList.v1';

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

function getOfferImageUrl(offerId) {
  return `${API_BASE_URL.replace(/\/api$/, '')}/api/offers/${offerId}/image`;
}

function normalizeAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
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

function hasReliableSavings(offer) {
  return getReliableSavingsAmount(offer) > 0;
}

function getOfferStatusLabel(offer) {
  if (offer?.status === 'active' && offer?.isActiveNow) return 'Aktuell gültig';
  if (offer?.status === 'upcoming') return 'Bald gültig';
  if (offer?.status === 'expired') return 'Nicht mehr gültig';
  if (offer?.isActiveToday) return 'Heute relevant';
  return 'Aktuelles Angebot';
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

function buildConditionBadges(offer) {
  const badges = [];

  if (offer?.customerProgramRequired) badges.push('Mit Kundenkarte/App');
  if (offer?.isMultiBuy) badges.push('Mehrkauf-Angebot');
  if (Number(offer?.minimumPurchaseQty || offer?.minimumPurchaseQuantity || 1) > 1) badges.push('Mindestmenge nötig');
  if (offer?.conditionsText && !badges.includes(offer.conditionsText)) badges.push(offer.conditionsText);

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

function flattenRankingOffers(ranking) {
  return (ranking?.rankedGroups || []).flatMap((group) => group.offers || []);
}

function buildOfferSections(offers) {
  const withSavings = offers.filter(hasReliableSavings);
  const actionPrices = offers.filter((offer) => !hasReliableSavings(offer));
  const sections = [];

  if (withSavings.length > 0) {
    sections.push({
      key: 'with-savings',
      title: 'Angebote mit Euro-Ersparnis',
      subtitle: 'Bei diesen Angeboten ist im Prospekt ein Normalpreis angegeben.',
      data: withSavings,
    });
  }

  if (actionPrices.length > 0) {
    sections.push({
      key: 'action-prices',
      title: 'Weitere aktuelle Aktionen',
      subtitle: 'Diese Produkte sind aktuelle Aktionen. Der Normalpreis ist im Prospekt nicht angegeben.',
      data: actionPrices,
    });
  }

  return sections;
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
      actionPriceCount: group.offers.filter((offer) => !hasReliableSavings(offer)).length,
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

function SummaryCard({ label, value, hint, accent = false }) {
  return (
    <View style={[styles.summaryCard, accent ? styles.summaryCardAccent : null]}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
      {hint ? <Text style={styles.summaryHint}>{hint}</Text> : null}
    </View>
  );
}

function StepHeader({ step, title, text }) {
  return (
    <View style={styles.stepHeader}>
      <Text style={styles.stepNumber}>{step}</Text>
      <View style={styles.stepTextBox}>
        <Text style={styles.stepTitle}>{title}</Text>
        <Text style={styles.stepText}>{text}</Text>
      </View>
    </View>
  );
}

function PriceTrustNote({ compact = false }) {
  return (
    <View style={[styles.noteBox, compact ? styles.noteBoxCompact : null]}>
      <Text style={styles.noteTitle}>Hinweis zu Prospekten und Normalpreisen</Text>
      <Text style={styles.noteText}>
        kaufklug zeigt aktuelle Angebote aus Prospekten und Aktionen. Manche Prospekte nennen nur den Aktionspreis,
        aber keinen Normalpreis. In diesem Fall zeigen wir den Aktionspreis, aber keine Euro-Ersparnis.
      </Text>
    </View>
  );
}

function SavingsMessage({ offer, compact = false }) {
  const savingsAmount = getReliableSavingsAmount(offer);

  if (savingsAmount > 0) {
    return (
      <View style={[styles.savingsBox, compact ? styles.savingsBoxCompact : null]}>
        <Text style={styles.savingsValue}>Spart ca. {formatCurrency(savingsAmount, offer.priceCurrent?.currency)}</Text>
        <Text style={styles.savingsDescription}>Ersparnis mit angegebenem Normalpreis.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.actionPriceBox, compact ? styles.savingsBoxCompact : null]}>
      <Text style={styles.actionPriceTitle}>Aktionspreis!</Text>
      <Text style={styles.actionPriceText}>
        Im Prospekt ist kein Normalpreis angegeben. Das ist oft bei kurzen oder saisonalen Aktionen der Fall.
      </Text>
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
  const normalizedUnitPrice = shouldDisplayUnitPrice(offer)
    ? `${formatCurrency(offer.normalizedUnitPrice?.amount, offer.priceCurrent?.currency)}/${offer.normalizedUnitPrice?.unit}`
    : '';
  const referenceAmount = Number(offer?.priceReference?.amount);
  const referencePrice = Number.isFinite(referenceAmount)
    ? formatCurrency(referenceAmount, offer.priceCurrent?.currency)
    : '';

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
                <View style={styles.softBadge}>
                  <Text style={styles.softBadgeLabel}>{getOfferStatusLabel(offer)}</Text>
                </View>
              </View>
              <Text style={styles.detailTitle}>{offer.title}</Text>
              <Text style={styles.offerCategory}>{getOfferCategoryLabel(offer)}</Text>
            </View>

            <SavingsMessage offer={offer} />

            <View style={styles.detailSection}>
              <Text style={styles.detailSectionTitle}>Preis</Text>
              <DetailRow label="Aktionspreis" value={formatCurrency(offer.priceCurrent?.amount, offer.priceCurrent?.currency)} strong />
              <DetailRow label="Normalpreis im Prospekt" value={referencePrice} />
              <DetailRow
                label="Euro-Ersparnis"
                value={reliableSavingsAmount > 0 ? formatCurrency(reliableSavingsAmount, offer.priceCurrent?.currency) : 'nicht angegeben'}
              />
              <DetailRow label="Einheitspreis" value={normalizedUnitPrice} />
              <DetailRow label="Menge" value={offer.quantityText || 'nicht erkannt'} />
            </View>

            <View style={styles.detailSection}>
              <Text style={styles.detailSectionTitle}>Bedingungen</Text>
              <DetailRow label="Zeitraum" value={formatValidityLabel(offer)} />
              <DetailRow label="Kundenkarte/App" value={offer.customerProgramRequired ? 'erforderlich' : 'nicht erforderlich'} />
              <DetailRow label="Mehrkauf" value={offer.isMultiBuy ? 'ja' : 'nein'} />
              <DetailRow
                label="Mindestmenge"
                value={Number(offer?.minimumPurchaseQty || offer?.minimumPurchaseQuantity || 1) > 1
                  ? String(offer.minimumPurchaseQty || offer.minimumPurchaseQuantity)
                  : 'keine'}
              />
              <DetailRow label="Weitere Hinweise" value={offer.conditionsText || ''} />
            </View>
          </ScrollView>

          <View style={[styles.detailFooter, { paddingBottom: Math.max(18, bottomInset + 14) }]}>
            <Pressable
              style={[styles.detailPrimaryButton, isSelected ? styles.detailMutedButton : null]}
              onPress={() => onToggleShoppingList(offer)}
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
  const conditionBadges = buildConditionBadges(offer);

  return (
    <Pressable
      style={[styles.offerCard, isCompact ? styles.offerCardCompact : null]}
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
            <View style={[styles.retailerBadge, { backgroundColor: getRetailerColor(offer.retailerKey) }]}>
              <Text style={[styles.retailerBadgeLabel, { color: getRetailerTextColor(offer.retailerKey) }]}>{offer.retailerName}</Text>
            </View>
            {hasReliableSavings(offer) ? (
              <View style={styles.softBadge}>
                <Text style={styles.softBadgeLabel}>Mit Vergleichspreis</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.offerCategory}>{getOfferCategoryLabel(offer)}</Text>
        </View>

        <Text style={styles.offerTitle}>{offer.title}</Text>

        <View style={[styles.offerPriceRow, isCompact ? styles.offerPriceRowCompact : null]}>
          <View style={styles.offerPriceBox}>
            <Text style={styles.offerPrice}>{formatCurrency(offer.priceCurrent?.amount, offer.priceCurrent?.currency)}</Text>
            <Text style={styles.offerMeta}>Aktionspreis</Text>
            {shouldDisplayUnitPrice(offer) ? (
              <Text style={styles.offerMeta}>
                {formatCurrency(offer.normalizedUnitPrice?.amount, offer.priceCurrent?.currency)}/{offer.normalizedUnitPrice?.unit}
              </Text>
            ) : null}
          </View>
          <SavingsMessage offer={offer} compact={isCompact} />
        </View>

        <View style={styles.metaWrap}>
          <View style={styles.metaPill}>
            <Text style={styles.metaPillLabel}>Menge: {offer.quantityText || 'nicht erkannt'}</Text>
          </View>
          <View style={styles.metaPillWide}>
            <Text style={styles.metaPillLabel}>{formatValidityLabel(offer)}</Text>
          </View>
          {conditionBadges.map((badge) => (
            <View key={badge} style={styles.conditionPill}>
              <Text style={styles.conditionPillLabel}>{badge}</Text>
            </View>
          ))}
        </View>

        <Pressable
          style={[styles.shoppingToggle, isSelected ? styles.shoppingToggleActive : null]}
          onPress={() => onToggleShoppingList(offer)}
        >
          <Text style={[styles.shoppingToggleLabel, isSelected ? styles.shoppingToggleLabelActive : null]}>
            {isSelected ? 'Bereits auf Liste' : 'Auf die Einkaufsliste'}
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
  scrollToResultsKey,
  hero,
  selectedRetailerCount,
}) {
  const listRef = useRef(null);
  const offers = useMemo(() => flattenRankingOffers(ranking), [ranking]);
  const sections = useMemo(() => buildOfferSections(offers), [offers]);
  const offersWithSavingsCount = offers.filter(hasReliableSavings).length;
  const actionPriceCount = offers.length - offersWithSavingsCount;

  useEffect(() => {
    if (!scrollToResultsKey || !hasSearched) {
      return;
    }

    const timeout = setTimeout(() => {
      if (sections.length > 0) {
        listRef.current?.scrollToLocation({
          sectionIndex: 0,
          itemIndex: 0,
          animated: true,
          viewOffset: 16,
        });
        return;
      }

      listRef.current?.scrollToEnd({ animated: true });
    }, 180);

    return () => clearTimeout(timeout);
  }, [hasSearched, scrollToResultsKey, sections.length]);

  if (loading) {
    return (
      <SectionList
        ref={listRef}
        sections={[]}
        keyExtractor={(item) => item.id}
        renderItem={null}
        ListHeaderComponent={hero}
        ListEmptyComponent={
          <View style={styles.loadingBox}>
            <ActivityIndicator color="#31582c" />
            <Text style={styles.loadingText}>Angebote werden geladen …</Text>
          </View>
        }
        contentContainerStyle={styles.content}
        stickySectionHeadersEnabled={false}
      />
    );
  }

  if (!hasSearched) {
    return (
      <SectionList
        ref={listRef}
        sections={[]}
        keyExtractor={(item) => item.id}
        renderItem={null}
        ListHeaderComponent={hero}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>Noch keine Suche gestartet</Text>
            <Text style={styles.emptyText}>
              Wähle zuerst mindestens ein Geschäft aus. Danach kannst du passende Angebote anzeigen.
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
      ref={listRef}
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
        <View style={styles.resultSectionHeader}>
          <Text style={styles.resultSectionTitle}>{section.title}</Text>
          <Text style={styles.resultSectionSubtitle}>{section.subtitle}</Text>
        </View>
      )}
      ListHeaderComponent={
        <>
          {hero}
          <View style={styles.resultsIntro}>
            <Text style={styles.resultsTitle}>Deine Angebote</Text>
            <Text style={styles.resultsText}>
              Alle Treffer sind aktuelle Angebote. Euro-Ersparnis zeigen wir nur dort, wo im Prospekt ein Normalpreis angegeben ist.
            </Text>
            <View style={styles.resultSummaryBox}>
              <Text style={styles.resultSummaryText}>{offers.length} aktuelle Angebote gefunden.</Text>
              <Text style={styles.resultSummaryText}>
                {offersWithSavingsCount} mit angegebener Euro-Ersparnis, {actionPriceCount} weitere Aktionspreise.
              </Text>
            </View>
            <PriceTrustNote compact />
          </View>
        </>
      }
      ListEmptyComponent={
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>Keine passenden Angebote gefunden</Text>
          <Text style={styles.emptyText}>
            {selectedRetailerCount === 0
              ? 'Wähle zuerst mindestens ein Geschäft aus.'
              : 'Aktuell wurden keine passenden Angebote gefunden. Wähle andere Geschäfte oder Kategorien.'}
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

function ShoppingListPage({ shoppingListEntries, onRemove, onBrowse, onClearList }) {
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
  const actionPriceCount = shoppingListEntries.filter((offer) => !hasReliableSavings(offer)).length;

  if (groupedEntries.length === 0) {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>Deine Einkaufsliste ist noch leer.</Text>
          <Text style={styles.emptyText}>
            Füge Angebote hinzu, die du beim Einkauf nutzen möchtest. Sie werden lokal auf diesem Gerät gespeichert.
          </Text>
          <Pressable style={styles.fullWidthSearchButton} onPress={onBrowse}>
            <Text style={styles.fullWidthSearchButtonLabel}>Angebote ansehen</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.shoppingHero}>
        <Text style={styles.shoppingHeroTitle}>Deine Einkaufsliste</Text>
        <Text style={styles.shoppingHeroText}>
          Deine gespeicherten Angebote sind nach Geschäft sortiert. So kannst du deinen Einkauf einfacher planen.
        </Text>
      </View>

      <View style={styles.summaryRow}>
        <SummaryCard label="Du bezahlst laut Angebot" value={formatCurrency(totalCurrent)} accent />
        <SummaryCard label="Ersparnis mit angegebenem Normalpreis" value={formatCurrency(totalSavings)} />
        <SummaryCard label="Aktionspreise ohne Normalpreis" value={actionPriceCount} />
      </View>

      {actionPriceCount > 0 ? (
        <Text style={styles.shoppingHint}>{actionPriceCount} weitere Angebote sind aktuelle Aktionen ohne angegebenen Normalpreis.</Text>
      ) : null}

      <PriceTrustNote compact />

      {groupedEntries.map((group) => (
        <View key={group.retailerKey} style={styles.groupCard}>
          <View style={styles.groupHeader}>
            <View style={styles.groupHeaderText}>
              <Text style={styles.groupTitle}>{group.retailerName}</Text>
              <Text style={styles.groupSubtitle}>
                {group.offers.length} Produkt{group.offers.length === 1 ? '' : 'e'} · Angebotspreis {formatCurrency(group.currentTotal)}
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
                <Text style={styles.offerCategory}>{getOfferCategoryLabel(offer)}</Text>
                <Text style={styles.listItemTitle}>{offer.title}</Text>
                <Text style={styles.offerPriceSmall}>{formatCurrency(offer.priceCurrent?.amount, offer.priceCurrent?.currency)}</Text>
                <SavingsMessage offer={offer} compact />
                <View style={styles.metaWrap}>
                  <View style={styles.metaPill}>
                    <Text style={styles.metaPillLabel}>{formatValidityLabel(offer)}</Text>
                  </View>
                  <View style={styles.metaPill}>
                    <Text style={styles.metaPillLabel}>Menge: {offer.quantityText || 'nicht erkannt'}</Text>
                  </View>
                  {buildConditionBadges(offer).map((badge) => (
                    <View key={badge} style={styles.conditionPill}>
                      <Text style={styles.conditionPillLabel}>{badge}</Text>
                    </View>
                  ))}
                </View>
              </View>
              <Pressable style={styles.removeButton} onPress={() => onRemove(offer.id)}>
                <Text style={styles.removeButtonLabel}>Entfernen</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ))}

      <View style={styles.shoppingActions}>
        <Pressable style={styles.fullWidthSearchButton} onPress={onBrowse}>
          <Text style={styles.fullWidthSearchButtonLabel}>Weitere Angebote suchen</Text>
        </Pressable>
        <Pressable style={styles.secondaryWideButton} onPress={onClearList}>
          <Text style={styles.secondaryWideButtonLabel}>Liste leeren</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function FooterLink({ bottomInset }) {
  const safeBottom = Math.max(34, bottomInset + 18);

  return (
    <Pressable
      style={[styles.footerLine, { paddingBottom: safeBottom }]}
      onPress={() => Linking.openURL(ECILY_URL)}
    >
      <Text style={styles.footerLink}>© 2026 ecily/webdevelopment</Text>
    </Pressable>
  );
}

export default function App() {
  const [activePage, setActivePage] = useState('offers');
  const [health, setHealth] = useState({ ok: false, environment: '', region: '' });
  const [retailers, setRetailers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [ranking, setRanking] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [selectedRetailers, setSelectedRetailers] = useState([]);
  const [shoppingListMap, setShoppingListMap] = useState({});
  const [shoppingListHydrated, setShoppingListHydrated] = useState(false);
  const [hasTriggeredSearch, setHasTriggeredSearch] = useState(false);
  const [selectedOffer, setSelectedOffer] = useState(null);
  const [scrollToResultsKey, setScrollToResultsKey] = useState(0);
  const androidTopInset = Platform.OS === 'android' ? (NativeStatusBar.currentHeight || 0) : 0;
  const androidBottomInset = Platform.OS === 'android' ? 48 : 0;

  async function fetchJson(path, options) {
    const response = await fetch(`${API_BASE_URL}${path}`, options);
    let payload = null;

    try {
      payload = await response.json();
    } catch (parseError) {
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
      if (selectedRetailers.length === 0) {
        setRanking(null);
        setError('Wähle zuerst mindestens ein Geschäft aus.');
        return;
      }

      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      const params = new URLSearchParams();
      if (selectedCategories.length > 0) params.set('categories', selectedCategories.join(','));
      params.set('retailers', selectedRetailers.join(','));
      params.set('limit', 'all');

      const rankingData = await fetchJson(`/offers/ranking?${params.toString()}`);
      setRanking(rankingData || null);
      setHasTriggeredSearch(true);
      if (!isRefresh) {
        setScrollToResultsKey((current) => current + 1);
      }
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
    loadCategories(selectedRetailers);
  }, [selectedRetailers]);

  const categoryGroups = useMemo(() => buildCategoryGroups(categories || []), [categories]);
  const shoppingListEntries = useMemo(() => Object.values(shoppingListMap), [shoppingListMap]);
  const selectedRetailerCount = selectedRetailers.length;
  const selectedCategoryCount = selectedCategories.length;
  const offers = useMemo(() => flattenRankingOffers(ranking), [ranking]);
  const resultCount = offers.length;
  const offersWithSavingsCount = offers.filter(hasReliableSavings).length;
  const actionPriceCount = resultCount - offersWithSavingsCount;
  const strongestSaving = useMemo(
    () => offers.reduce((max, offer) => Math.max(max, getReliableSavingsAmount(offer)), 0),
    [offers]
  );

  function toggleRetailer(retailerKey) {
    setSelectedRetailers((current) => (
      current.includes(retailerKey)
        ? current.filter((item) => item !== retailerKey)
        : [...current, retailerKey]
    ));
  }

  function selectAllRetailers() {
    setSelectedRetailers((retailers || []).map((retailer) => retailer.retailerKey).filter(Boolean));
  }

  function resetRetailers() {
    setSelectedRetailers([]);
    setSelectedCategories([]);
    setRanking(null);
    setHasTriggeredSearch(false);
    setError('');
  }

  function toggleCategory(category) {
    setSelectedCategories((current) => (
      current.includes(category)
        ? current.filter((item) => item !== category)
        : [...current, category]
    ));
  }

  function toggleMainCategory(subcategories, fallbackCategory) {
    if (!subcategories.length) {
      toggleCategory(fallbackCategory);
      return;
    }

    setSelectedCategories((current) => {
      const allSelected = subcategories.every((subcategory) => current.includes(subcategory));
      if (allSelected) {
        return current.filter((item) => !subcategories.includes(item));
      }
      return [...new Set([...current, ...subcategories])];
    });
  }

  function resetCategories() {
    setSelectedCategories([]);
  }

  function resetSelection() {
    setSelectedRetailers([]);
    setSelectedCategories([]);
    setRanking(null);
    setHasTriggeredSearch(false);
    setError('');
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

  function clearShoppingList() {
    setShoppingListMap({});
  }

  function showOffersTab() {
    setActivePage('offers');
  }

  const searchHeader = (
    <>
      <View style={styles.heroCard}>
        <Text style={styles.eyebrow}>{BRAND_NAME}</Text>
        <Text style={styles.title}>Einfach klug einkaufen.</Text>
        <Text style={styles.subtitle}>
          Wähle deine Geschäfte und was du einkaufen möchtest. kaufklug zeigt dir aktuelle Angebote aus Prospekten
          und Aktionen - einfach, verständlich und ohne Prospekt-Chaos.
        </Text>
        <View style={styles.benefitGrid}>
          {['Aktuelle Aktionen', 'Einfach auswählen', 'Einkaufsliste', 'Ehrliche Ersparnis'].map((item) => (
            <View key={item} style={styles.benefitPill}>
              <Text style={styles.benefitPillText}>{item}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.flowCard}>
        <StepHeader
          step="1. Geschäfte wählen"
          title="Wo kaufst du ein?"
          text="Wähle die Geschäfte aus, die für dich erreichbar sind."
        />
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
          <Pressable style={styles.secondaryButton} onPress={selectAllRetailers}>
            <Text style={styles.secondaryButtonLabel}>Alle auswählen</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={resetRetailers}>
            <Text style={styles.secondaryButtonLabel}>Geschäfte zurücksetzen</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.flowCard}>
        <StepHeader
          step="2. Produkte wählen"
          title="Was brauchst du heute?"
          text="Wähle eine Kategorie oder genauer eine Unterkategorie. Du kannst diesen Schritt auch überspringen."
        />
        <Pressable style={styles.secondaryWideButton} onPress={resetCategories}>
          <Text style={styles.secondaryWideButtonLabel}>Alle Kategorien anzeigen</Text>
        </Pressable>
        <View style={styles.categoryList}>
          {categoryGroups.map((group) => {
            const selectedCount = group.subcategories.filter((item) => selectedCategories.includes(item)).length;
            const allSelected = selectedCount === group.subcategories.length && group.subcategories.length > 0;
            const partial = selectedCount > 0 && !allSelected;
            const fallbackSelected = selectedCategories.includes(group.mainCategory);

            return (
              <View key={group.mainCategory} style={styles.categoryCard}>
                <FilterChip
                  label={`${group.mainCategory}${group.subcategories.length ? ` (${group.subcategories.length})` : ''}`}
                  active={allSelected || fallbackSelected}
                  partial={partial}
                  onPress={() => toggleMainCategory(group.subcategories, group.mainCategory)}
                />
                {group.subcategories.length > 0 ? (
                  <View style={styles.subcategoryWrap}>
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
      </View>

      <View style={styles.flowCard}>
        <StepHeader
          step="3. Angebote ansehen"
          title="Deine Auswahl ist bereit."
          text="Tippe auf „Angebote anzeigen“. Danach kannst du passende Produkte auf deine Einkaufsliste setzen."
        />
        <Pressable
          style={[styles.fullWidthSearchButton, selectedRetailerCount === 0 || loading ? styles.disabledButton : null]}
          onPress={() => loadRanking(false)}
          disabled={selectedRetailerCount === 0 || loading}
        >
          <Text style={styles.fullWidthSearchButtonLabel}>
            {loading ? 'Angebote werden geladen …' : 'Angebote anzeigen'}
          </Text>
        </Pressable>
        <Pressable style={styles.secondaryWideButton} onPress={resetSelection}>
          <Text style={styles.secondaryWideButtonLabel}>Auswahl zurücksetzen</Text>
        </Pressable>
        <View style={styles.quickInfoCard}>
          <Text style={styles.quickInfoTitle}>Deine Auswahl</Text>
          <Text style={styles.quickInfoText}>
            {selectedRetailerCount > 0
              ? `${selectedRetailerCount} Geschäft${selectedRetailerCount === 1 ? '' : 'e'} ausgewählt`
              : 'Noch kein Geschäft ausgewählt'}
            {selectedCategoryCount > 0 ? ` · ${selectedCategoryCount} Kategorie${selectedCategoryCount === 1 ? '' : 'n'}` : ''}
          </Text>
        </View>
      </View>

      {hasTriggeredSearch ? (
        <View style={styles.summaryRow}>
          <SummaryCard label="Aktuelle Angebote" value={resultCount} accent />
          <SummaryCard label="Mit Euro-Ersparnis" value={offersWithSavingsCount} />
          <SummaryCard label="Weitere Aktionspreise" value={actionPriceCount} />
          <SummaryCard label="Größte Ersparnis" value={formatCurrency(strongestSaving)} />
        </View>
      ) : null}

      {error ? <Text style={styles.errorBox}>{error}</Text> : null}
    </>
  );

  return (
    <SafeAreaView style={[styles.screen, { paddingTop: androidTopInset }]}>
      <StatusBar style="dark" />
      <View style={styles.topMenu}>
        <Pressable
          style={[styles.topMenuButton, activePage === 'offers' ? styles.topMenuButtonActive : null]}
          onPress={() => setActivePage('offers')}
        >
          <Text style={[styles.topMenuLabel, activePage === 'offers' ? styles.topMenuLabelActive : null]}>
            Angebote
          </Text>
        </Pressable>
        <Pressable
          style={[styles.topMenuButton, activePage === 'shopping' ? styles.topMenuButtonActive : null]}
          onPress={() => setActivePage('shopping')}
        >
          <Text style={[styles.topMenuLabel, activePage === 'shopping' ? styles.topMenuLabelActive : null]}>
            Einkaufsliste{shoppingListEntries.length > 0 ? ` (${shoppingListEntries.length})` : ''}
          </Text>
        </Pressable>
      </View>

      <View style={styles.mainArea}>
        {activePage === 'offers' ? (
          <SearchResultsList
            ranking={ranking}
            loading={loading}
            hasSearched={hasTriggeredSearch}
            refreshing={refreshing}
            onRefresh={() => hasTriggeredSearch ? loadRanking(true) : null}
            shoppingListMap={shoppingListMap}
            onToggleShoppingList={toggleShoppingList}
            onOpenOfferDetail={setSelectedOffer}
            scrollToResultsKey={scrollToResultsKey}
            hero={searchHeader}
            selectedRetailerCount={selectedRetailerCount}
          />
        ) : (
          <ShoppingListPage
            shoppingListEntries={shoppingListEntries}
            onRemove={removeFromShoppingList}
            onBrowse={showOffersTab}
            onClearList={clearShoppingList}
          />
        )}
      </View>

      <FooterLink bottomInset={androidBottomInset} />

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
  mainArea: { flex: 1 },
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
  topMenuLabel: { color: '#425040', fontWeight: '800', fontSize: 14, textAlign: 'center' },
  topMenuLabelActive: { color: '#f8f5ed' },
  content: { padding: 18, gap: 16, paddingBottom: 32 },
  heroCard: {
    backgroundColor: '#12361e',
    borderRadius: 24,
    padding: 18,
    gap: 12,
    shadowColor: '#12361e',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  eyebrow: { color: '#a7c88f', textTransform: 'uppercase', letterSpacing: 1.5, fontSize: 12, fontWeight: '800' },
  title: { color: '#f8f5ed', fontSize: 30, lineHeight: 36, fontWeight: '900' },
  subtitle: { color: '#d7e5d6', fontSize: 15, lineHeight: 22 },
  benefitGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  benefitPill: { backgroundColor: 'rgba(248, 245, 237, 0.14)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 },
  benefitPillText: { color: '#f8f5ed', fontSize: 12, fontWeight: '800' },
  flowCard: { backgroundColor: '#fffaf2', borderRadius: 22, padding: 16, gap: 12, borderWidth: 1, borderColor: 'rgba(19, 32, 20, 0.08)' },
  stepHeader: { gap: 6 },
  stepNumber: { color: '#31582c', fontSize: 12, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1 },
  stepTextBox: { gap: 4 },
  stepTitle: { color: '#132014', fontSize: 20, lineHeight: 25, fontWeight: '900' },
  stepText: { color: '#5d695a', fontSize: 14, lineHeight: 20 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 13, paddingVertical: 10, borderRadius: 999, backgroundColor: '#efe9dc', minHeight: 42, justifyContent: 'center' },
  chipActive: { backgroundColor: '#31582c' },
  chipPartial: { backgroundColor: '#dce9ca' },
  chipLabel: { color: '#475246', fontSize: 13, fontWeight: '800' },
  chipLabelActive: { color: '#f8f5ed' },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  secondaryButton: { flexGrow: 1, backgroundColor: '#ece4d7', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, alignItems: 'center' },
  secondaryButtonLabel: { color: '#304230', fontWeight: '800', textAlign: 'center' },
  secondaryWideButton: { backgroundColor: '#ece4d7', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, alignItems: 'center' },
  secondaryWideButtonLabel: { color: '#304230', fontWeight: '800', textAlign: 'center' },
  fullWidthSearchButton: { backgroundColor: '#12361e', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 15, alignItems: 'center' },
  fullWidthSearchButtonLabel: { color: '#f8f5ed', fontWeight: '900', fontSize: 15, textAlign: 'center' },
  disabledButton: { opacity: 0.45 },
  categoryList: { gap: 10 },
  categoryCard: { backgroundColor: '#f8f3e8', borderRadius: 18, padding: 10, gap: 8 },
  subcategoryWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  quickInfoCard: { backgroundColor: '#f3eddc', borderRadius: 16, padding: 12, gap: 4 },
  quickInfoTitle: { color: '#31582c', fontSize: 12, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1 },
  quickInfoText: { color: '#4f594e', fontSize: 13, lineHeight: 18 },
  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  summaryCard: { minWidth: 132, flexGrow: 1, backgroundColor: '#fffaf2', borderRadius: 18, padding: 14, gap: 4, borderWidth: 1, borderColor: 'rgba(19, 32, 20, 0.08)' },
  summaryCardAccent: { backgroundColor: '#e9f6db' },
  summaryLabel: { color: '#61705f', fontSize: 11, lineHeight: 15, fontWeight: '800', textTransform: 'uppercase' },
  summaryValue: { color: '#19301a', fontSize: 20, fontWeight: '900' },
  summaryHint: { color: '#667064', fontSize: 12, lineHeight: 16 },
  errorBox: { color: '#8b2424', backgroundColor: '#fdeeee', borderRadius: 16, padding: 14, fontSize: 14 },
  loadingBox: { alignItems: 'center', gap: 10, paddingVertical: 32 },
  loadingText: { color: '#5e685d' },
  emptyState: { backgroundColor: '#fffaf2', borderRadius: 22, padding: 20, gap: 10, borderWidth: 1, borderColor: 'rgba(19, 32, 20, 0.08)' },
  emptyTitle: { color: '#152315', fontSize: 19, lineHeight: 24, fontWeight: '900' },
  emptyText: { color: '#59635a', fontSize: 14, lineHeight: 20 },
  resultsIntro: { gap: 12 },
  resultsTitle: { color: '#132014', fontSize: 24, lineHeight: 30, fontWeight: '900' },
  resultsText: { color: '#5d695a', fontSize: 14, lineHeight: 20 },
  resultSummaryBox: { backgroundColor: '#e9f6db', borderRadius: 16, padding: 12, gap: 4 },
  resultSummaryText: { color: '#244320', fontSize: 14, lineHeight: 20, fontWeight: '800' },
  noteBox: { backgroundColor: '#fff6dd', borderRadius: 16, padding: 13, gap: 5, borderWidth: 1, borderColor: '#ead49a' },
  noteBoxCompact: { padding: 12 },
  noteTitle: { color: '#7c520c', fontSize: 13, fontWeight: '900' },
  noteText: { color: '#7c520c', fontSize: 13, lineHeight: 19 },
  resultSectionHeader: { backgroundColor: '#f4efe5', paddingTop: 6, paddingBottom: 4, gap: 3 },
  resultSectionTitle: { color: '#132014', fontSize: 18, lineHeight: 24, fontWeight: '900' },
  resultSectionSubtitle: { color: '#5e685d', fontSize: 13, lineHeight: 18 },
  offerCard: { flexDirection: 'row', gap: 10, backgroundColor: '#fffaf2', borderRadius: 20, padding: 12, borderWidth: 1, borderColor: 'rgba(19, 32, 20, 0.08)' },
  offerCardCompact: { flexDirection: 'column' },
  offerImage: { width: 82, height: 82, borderRadius: 14, backgroundColor: '#fff' },
  offerImageCompact: { width: '100%', height: 136 },
  offerImageFallback: { width: 82, height: 82, borderRadius: 14, backgroundColor: '#dfe9d5', alignItems: 'center', justifyContent: 'center', padding: 8 },
  offerImageFallbackCompact: { width: '100%', height: 136 },
  offerImageFallbackText: { color: '#31582c', fontSize: 12, fontWeight: '900', textAlign: 'center' },
  offerBody: { flex: 1, gap: 7 },
  offerTopRow: { gap: 4 },
  offerBadgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  rankBadge: { backgroundColor: '#e3dccd', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  rankBadgeLabel: { color: '#425040', fontSize: 11, fontWeight: '900' },
  retailerBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  retailerBadgeLabel: { color: '#ffffff', fontSize: 11, fontWeight: '900' },
  softBadge: { backgroundColor: '#e7f0da', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  softBadgeLabel: { color: '#31582c', fontSize: 11, fontWeight: '900' },
  offerCategory: { color: '#31582c', fontSize: 12, fontWeight: '800' },
  offerTitle: { color: '#152315', fontSize: 16, lineHeight: 22, fontWeight: '800' },
  offerPriceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  offerPriceRowCompact: { flexWrap: 'wrap' },
  offerPriceBox: { gap: 2, flexShrink: 1 },
  offerPrice: { color: '#173118', fontSize: 22, fontWeight: '900' },
  offerPriceSmall: { color: '#173118', fontSize: 18, fontWeight: '900' },
  offerMeta: { color: '#59635a', fontSize: 13 },
  metaWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  metaPill: { backgroundColor: '#efe8da', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  metaPillWide: { backgroundColor: '#e7f0da', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  metaPillLabel: { color: '#59635a', fontSize: 12, fontWeight: '700' },
  conditionPill: { backgroundColor: '#fff0cf', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  conditionPillLabel: { color: '#80520a', fontSize: 12, fontWeight: '800' },
  savingsBox: { alignItems: 'flex-start', backgroundColor: '#e9f6db', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 8, maxWidth: 190, gap: 2 },
  savingsBoxCompact: { maxWidth: '100%', alignSelf: 'stretch' },
  savingsValue: { color: '#173118', fontSize: 14, fontWeight: '900' },
  savingsDescription: { color: '#4d5a4b', fontSize: 11, lineHeight: 15 },
  actionPriceBox: { alignItems: 'flex-start', backgroundColor: '#fff6dd', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 8, maxWidth: 210, gap: 2, borderWidth: 1, borderColor: '#ead49a' },
  actionPriceTitle: { color: '#80520a', fontSize: 14, fontWeight: '900' },
  actionPriceText: { color: '#80520a', fontSize: 11, lineHeight: 15 },
  shoppingToggle: { marginTop: 4, alignSelf: 'flex-start', backgroundColor: '#ece4d7', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 999 },
  shoppingToggleActive: { backgroundColor: '#31582c' },
  shoppingToggleLabel: { color: '#304230', fontSize: 13, fontWeight: '800' },
  shoppingToggleLabelActive: { color: '#f8f5ed' },
  detailOverlay: { flex: 1, backgroundColor: 'rgba(18, 28, 18, 0.45)', justifyContent: 'flex-end' },
  detailSheet: { maxHeight: '88%', backgroundColor: '#f4efe5', borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden' },
  detailContent: { padding: 18, gap: 14, paddingBottom: 18 },
  detailImage: { width: '100%', height: 180, borderRadius: 18, backgroundColor: '#fff' },
  detailImageFallback: { width: '100%', height: 180, borderRadius: 18, backgroundColor: '#dfe9d5', alignItems: 'center', justifyContent: 'center', padding: 12 },
  detailHeader: { gap: 8 },
  detailTitle: { color: '#132014', fontSize: 22, lineHeight: 28, fontWeight: '900' },
  detailSection: { backgroundColor: '#fffaf2', borderRadius: 18, padding: 14, gap: 10, borderWidth: 1, borderColor: 'rgba(19, 32, 20, 0.08)' },
  detailSectionTitle: { color: '#31582c', fontSize: 15, fontWeight: '900' },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 14, alignItems: 'flex-start' },
  detailLabel: { flex: 1, color: '#657063', fontSize: 13, fontWeight: '800' },
  detailValue: { flex: 1.35, color: '#182518', fontSize: 14, lineHeight: 20, textAlign: 'right' },
  detailValueStrong: { fontSize: 18, lineHeight: 24, fontWeight: '900', color: '#173118' },
  detailFooter: { flexDirection: 'row', gap: 10, padding: 18, paddingTop: 12, backgroundColor: '#f4efe5', borderTopWidth: 1, borderTopColor: 'rgba(19, 32, 20, 0.08)' },
  detailPrimaryButton: { flex: 1.5, backgroundColor: '#31582c', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 14, alignItems: 'center' },
  detailMutedButton: { backgroundColor: '#7b3535' },
  detailPrimaryButtonLabel: { color: '#f8f5ed', fontWeight: '900', textAlign: 'center' },
  detailSecondaryButton: { flex: 1, backgroundColor: '#ece4d7', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 14, alignItems: 'center' },
  detailSecondaryButtonLabel: { color: '#304230', fontWeight: '900', textAlign: 'center' },
  shoppingHero: { backgroundColor: '#fffaf2', borderRadius: 22, padding: 16, gap: 6, borderWidth: 1, borderColor: 'rgba(19, 32, 20, 0.08)' },
  shoppingHeroTitle: { color: '#132014', fontSize: 22, lineHeight: 28, fontWeight: '900' },
  shoppingHeroText: { color: '#5f685e', fontSize: 14, lineHeight: 20 },
  shoppingHint: { color: '#7c520c', backgroundColor: '#fff6dd', borderRadius: 14, padding: 12, fontSize: 13, lineHeight: 18, fontWeight: '800' },
  groupCard: { backgroundColor: '#fffaf2', borderRadius: 20, padding: 14, gap: 12, borderWidth: 1, borderColor: 'rgba(19, 32, 20, 0.08)' },
  groupHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  groupHeaderText: { flex: 1, gap: 2 },
  groupTitle: { color: '#132014', fontSize: 18, fontWeight: '900' },
  groupSubtitle: { color: '#5e685d', fontSize: 13, marginTop: 3 },
  groupCount: { minWidth: 36, textAlign: 'center', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 999, backgroundColor: '#e1edd3', color: '#244320', fontWeight: '900' },
  listItemCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: '#f8f3e8', borderRadius: 18, padding: 12 },
  listItemCardCompact: { flexWrap: 'wrap' },
  listItemImage: { width: 72, height: 72, borderRadius: 12, backgroundColor: '#fff' },
  listItemImageCompact: { width: 64, height: 64 },
  listItemImageFallback: { width: 72, height: 72, borderRadius: 12, backgroundColor: '#dfe9d5', alignItems: 'center', justifyContent: 'center', padding: 8 },
  listItemImageFallbackCompact: { width: 64, height: 64 },
  listItemImageFallbackText: { color: '#31582c', fontSize: 11, fontWeight: '900', textAlign: 'center' },
  listItemBody: { flex: 1, gap: 5 },
  listItemTitle: { color: '#152315', fontSize: 15, lineHeight: 20, fontWeight: '800' },
  removeButton: { backgroundColor: '#efe5da', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 10, alignSelf: 'flex-start' },
  removeButtonLabel: { color: '#7b3535', fontSize: 12, fontWeight: '800', textAlign: 'center' },
  shoppingActions: { gap: 10 },
  resultGroupList: { gap: 16 },
  sectionSpacer: { height: 16 },
  footerLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fffaf2',
    borderTopWidth: 1,
    borderTopColor: 'rgba(19, 32, 20, 0.08)',
    paddingTop: 8,
    paddingHorizontal: 12,
  },
  footerText: { color: '#6a7467', fontSize: 11, lineHeight: 16 },
  footerLink: { color: '#31582c', fontSize: 11, lineHeight: 16, fontWeight: '900', textDecorationLine: 'underline' },
});
