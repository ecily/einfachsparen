import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import * as Clipboard from 'expo-clipboard';
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
  Share,
  StyleSheet,
  StatusBar as NativeStatusBar,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { API_BASE_URL } from './src/config/api';
import ProductSearchScreen from './src/ProductSearchScreen';
import {
  buildCategoryGroups,
  formatCurrency,
  getOfferCategoryLabel,
} from './src/searchHelpers';

const BRAND_NAME = 'kaufklug.at';
const ECILY_URL = 'https://www.ecily.com';
const ALPHA_APK_URL = 'https://stepsmatch.fra1.digitaloceanspaces.com/kaufklug/kaufklug_alpha.apk';
const ALPHA_VERSION_URL = 'https://stepsmatch.fra1.digitaloceanspaces.com/kaufklug/kaufklug_alpha_version.json';
const SHOPPING_LIST_STORAGE_KEY = 'einfachsparen.mobile.shoppingList.v1';
const DISMISSED_UPDATE_BUILD_STORAGE_KEY = 'einfachsparen.mobile.dismissedUpdateBuildNumber.v1';
const DISMISSED_UPDATE_AT_STORAGE_KEY = 'einfachsparen.mobile.dismissedUpdateAt.v1';
const UPDATE_CHECK_TIMEOUT_MS = 8000;
const UPDATE_REMINDER_PAUSE_MS = 24 * 60 * 60 * 1000;

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

async function fetchAlphaVersionInfo() {
  let timeoutHandle;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error('Update-Pruefung hat zu lange gedauert.')), UPDATE_CHECK_TIMEOUT_MS);
  });

  try {
    const response = await Promise.race([
      fetch(ALPHA_VERSION_URL, {
        headers: {
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
        },
      }),
      timeoutPromise,
    ]);

    if (!response?.ok) {
      return null;
    }

    return response.json();
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function toBuildNumber(value) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  if (typeof value === 'string') {
    const trimmedValue = value.trim();
    if (!/^\d+$/.test(trimmedValue)) {
      return null;
    }

    const buildNumber = Number(trimmedValue);
    return Number.isSafeInteger(buildNumber) && buildNumber > 0 ? buildNumber : null;
  }

  return null;
}

function getInstalledBuildNumber() {
  return toBuildNumber(Application.nativeBuildVersion);
}

async function getDismissedUpdateReminder() {
  const storedEntries = await AsyncStorage.multiGet([
    DISMISSED_UPDATE_BUILD_STORAGE_KEY,
    DISMISSED_UPDATE_AT_STORAGE_KEY,
  ]);
  const storedMap = Object.fromEntries(storedEntries);

  return {
    dismissedBuildNumber: toBuildNumber(storedMap[DISMISSED_UPDATE_BUILD_STORAGE_KEY]),
    dismissedAt: toBuildNumber(storedMap[DISMISSED_UPDATE_AT_STORAGE_KEY]) || 0,
  };
}

async function storeDismissedUpdateReminder(buildNumber) {
  const normalizedBuildNumber = toBuildNumber(buildNumber);

  if (!normalizedBuildNumber) {
    return;
  }

  await AsyncStorage.multiSet([
    [DISMISSED_UPDATE_BUILD_STORAGE_KEY, String(normalizedBuildNumber)],
    [DISMISSED_UPDATE_AT_STORAGE_KEY, String(Date.now())],
  ]);
}

async function clearDismissedUpdateReminder() {
  await AsyncStorage.multiRemove([
    DISMISSED_UPDATE_BUILD_STORAGE_KEY,
    DISMISSED_UPDATE_AT_STORAGE_KEY,
  ]);
}

function isUpdateReminderPaused(latestBuildNumber, dismissedReminder) {
  if (latestBuildNumber !== dismissedReminder.dismissedBuildNumber) {
    return false;
  }

  const dismissedAgeMs = Date.now() - dismissedReminder.dismissedAt;
  return dismissedAgeMs >= 0 && dismissedAgeMs < UPDATE_REMINDER_PAUSE_MS;
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

function getShoppingQuantity(offer) {
  const quantity = Number(offer?.shoppingQuantity);
  return Number.isFinite(quantity) && quantity > 0 ? Math.max(1, Math.round(quantity)) : 1;
}

function getShoppingCurrentTotal(offer) {
  return normalizeAmount(offer?.priceCurrent?.amount) * getShoppingQuantity(offer);
}

function getShoppingSavingsTotal(offer) {
  return getReliableSavingsAmount(offer) * getShoppingQuantity(offer);
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

  const minimumQuantityHint = getMinimumQuantityHint(offer);
  if (minimumQuantityHint) {
    return minimumQuantityHint;
  }

  return '';
}

function buildConditionBadges(offer) {
  const badges = [];

  if (offer?.customerProgramRequired) badges.push('Mit Kundenkarte/App');
  if (offer?.isMultiBuy) badges.push('Mehrkauf-Angebot');
  if (offer?.conditionsText && !badges.includes(offer.conditionsText) && !isDuplicateMinimumCondition(offer.conditionsText, offer)) {
    badges.push(offer.conditionsText);
  }

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

function getCategoryFilterLabels(categoryGroups) {
  return categoryGroups.flatMap((group) => (
    group.subcategories.length > 0 ? group.subcategories : [group.mainCategory]
  ));
}

function getCategorySelectionKey(mainCategory, subcategory) {
  return `${String(mainCategory || '').trim()}::${String(subcategory || mainCategory || '').trim()}`;
}

function getCategoryFilterOptions(categoryGroups) {
  return categoryGroups.flatMap((group) => {
    if (group.subcategories.length === 0) {
      return [{
        key: getCategorySelectionKey(group.mainCategory, group.mainCategory),
        label: group.mainCategory,
        mainCategory: group.mainCategory,
      }];
    }

    return group.subcategories.map((subcategory) => ({
      key: getCategorySelectionKey(group.mainCategory, subcategory),
      label: subcategory,
      mainCategory: group.mainCategory,
    }));
  });
}

function getMinimumQuantityHint(offer) {
  const directQuantity = Number(
    offer?.minimumPurchaseQty ||
      offer?.minimumPurchaseQuantity ||
      offer?.minQuantity ||
      offer?.minimumQuantity ||
      offer?.minimumOrderQuantity ||
      offer?.minimumPurchase?.quantity ||
      offer?.discount?.minimumQuantity
  );

  if (Number.isFinite(directQuantity) && directQuantity > 1) {
    return `Mindestmenge: ${Math.round(directQuantity)} Stück`;
  }

  const conditionText = [
    offer?.conditionsText,
    offer?.conditionLabel,
    offer?.effectiveDiscountType,
    offer?.discountMechanic,
    offer?.discountType,
    offer?.rawFacts,
  ]
    .filter(Boolean)
    .map((value) => Array.isArray(value) ? value.join(' ') : String(value))
    .join(' ')
    .toLowerCase();

  const quantityMatch = conditionText.match(/\bab\s*(\d+)\s*(?:st[üu]ck|stk|packungen?|flaschen?|dosen?|artikel|produkte)?\b/);
  if (quantityMatch) {
    return `Mindestmenge: ${quantityMatch[1]} Stück`;
  }

  const multiBuyMatch = conditionText.match(/\b(\d+)\s*(?:\+|f[üu]r)\s*(\d+)\b/);
  if (multiBuyMatch && Number(multiBuyMatch[1]) > 1) {
    return `Mindestmenge: ${multiBuyMatch[1]} Stück`;
  }

  return '';
}

function isDuplicateMinimumCondition(value, offer) {
  const text = String(value || '').trim().toLowerCase();
  const minimumQuantityHint = getMinimumQuantityHint(offer);
  const minimumQuantity = minimumQuantityHint.match(/\d+/)?.[0];

  if (!text || !minimumQuantity) {
    return false;
  }

  const compactText = text.replace(/\s+/g, ' ');
  const onlyMinimum =
    new RegExp(`^(?:ab|mindestens|min\\.?|mindestmenge:?|mindestkauf:?)\\s*${minimumQuantity}\\s*(?:st[üu]ck|stk|artikel|produkte|packungen?)\\.?$`).test(compactText) ||
    new RegExp(`^${minimumQuantity}\\s*(?:st[üu]ck|stk|artikel|produkte|packungen?)\\s*(?:n[öo]tig|erforderlich)$`).test(compactText);

  return onlyMinimum;
}

function getReadableQuantityText(offer) {
  const rawValue = String(offer?.quantityText || '').trim();

  if (!rawValue) {
    return '';
  }

  const value = rawValue.replace(/^menge:\s*/i, '').trim();

  if (!value || /\bta\./i.test(value)) {
    return '';
  }

  const normalizedValue = value
    .replace(/\s+/g, ' ')
    .replace(/\s*x\s*/gi, ' x ')
    .trim();
  const unitPattern = '(?:kg|g|dag|l|ml|cl|stk|st\\.?|stueck|stuecke|stück|stücke|packung|packungen|flasche|flaschen|dose|dosen|tafel|tafeln)';
  const simpleQuantity = new RegExp(`^\\d+(?:[,.]\\d+)?\\s*${unitPattern}$`, 'i');
  const multiPackQuantity = new RegExp(`^\\d+\\s*(?:x|×)\\s*\\d+(?:[,.]\\d+)?\\s*${unitPattern}$`, 'i');

  if (!simpleQuantity.test(normalizedValue) && !multiPackQuantity.test(normalizedValue)) {
    return '';
  }

  return normalizedValue
    .replace(/\bx\b/g, '×')
    .replace(/\bst\.?$/i, 'Stück')
    .replace(/\bstueck(e)?\b/gi, 'Stück');
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
      savingsTotal: group.offers.reduce((sum, offer) => sum + getShoppingSavingsTotal(offer), 0),
      currentTotal: group.offers.reduce((sum, offer) => sum + getShoppingCurrentTotal(offer), 0),
      actionPriceCount: group.offers.filter((offer) => !hasReliableSavings(offer)).length,
    }))
    .sort((left, right) => left.retailerName.localeCompare(right.retailerName, 'de'));
}

function buildShareQuantityText(offer) {
  const quantity = getShoppingQuantity(offer);
  const baseText = String(offer?.quantityText || '').trim();
  const quantityText = `Menge: ${quantity}`;

  return baseText ? `${baseText} · ${quantityText}` : quantityText;
}

function buildShoppingListShareSnapshot(items = []) {
  return {
    items: (items || []).map((item) => ({
      offerId: item?.offerId || item?.id || '',
      retailerKey: item?.retailerKey || '',
      retailerName: item?.retailerName || '',
      title: item?.title || '',
      categoryLabel: getOfferCategoryLabel(item),
      priceCurrent: item?.priceCurrent || null,
      unit: item?.normalizedUnitPrice?.unit || '',
      quantityText: buildShareQuantityText(item),
      validUntil: item?.validTo || item?.validUntil || '',
      imageUrl: item?.imageUrl || '',
    })),
  };
}

async function createSharedShoppingList(payload) {
  const response = await fetch(`${API_BASE_URL}/shopping-lists/share`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  let result = null;

  try {
    result = await response.json();
  } catch (parseError) {
    result = null;
  }

  if (!response.ok) {
    throw new Error(result?.message || 'Die Einkaufsliste konnte gerade nicht geteilt werden.');
  }

  return result;
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
        Kein Normalpreis im Prospekt angegeben. Wir zeigen deshalb nur den Aktionspreis.
      </Text>
    </View>
  );
}

function QuantityControl({ quantity, onDecrease, onIncrease }) {
  return (
    <View style={styles.quantityControl}>
      <Text style={styles.quantityLabel}>Menge</Text>
      <View style={styles.quantityStepper}>
        <Pressable
          style={[styles.quantityButton, quantity <= 1 ? styles.quantityButtonDisabled : null]}
          onPress={onDecrease}
          disabled={quantity <= 1}
        >
          <Text style={styles.quantityButtonLabel}>-</Text>
        </Pressable>
        <Text style={styles.quantityValue}>{quantity}</Text>
        <Pressable style={styles.quantityButton} onPress={onIncrease}>
          <Text style={styles.quantityButtonLabel}>+</Text>
        </Pressable>
      </View>
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
  const minimumQuantityHint = getMinimumQuantityHint(offer);

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
              {minimumQuantityHint ? (
                <View style={styles.minimumQuantityChip}>
                  <Text style={styles.minimumQuantityChipLabel}>{minimumQuantityHint}</Text>
                </View>
              ) : null}
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
  const minimumQuantityHint = getMinimumQuantityHint(offer);
  const readableQuantityText = getReadableQuantityText(offer);

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
          </View>
          <Text style={styles.offerCategory}>{getOfferCategoryLabel(offer)}</Text>
          <Text style={styles.offerValidity}>{formatValidityLabel(offer)}</Text>
        </View>

        <Text style={styles.offerTitle}>{offer.title}</Text>

        <View style={styles.offerPriceStack}>
          <View style={styles.offerPriceBox}>
            {minimumQuantityHint ? (
              <View style={styles.minimumQuantityChip}>
                <Text style={styles.minimumQuantityChipLabel}>{minimumQuantityHint}</Text>
              </View>
            ) : null}
            <Text
              style={styles.offerPrice}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.78}
            >
              {formatCurrency(offer.priceCurrent?.amount, offer.priceCurrent?.currency)}
            </Text>
            <View style={styles.offerPriceMetaRow}>
              <Text style={styles.offerMeta}>Aktionspreis</Text>
              {shouldDisplayUnitPrice(offer) ? (
                <Text style={styles.offerMeta} numberOfLines={1}>
                  {formatCurrency(offer.normalizedUnitPrice?.amount, offer.priceCurrent?.currency)}/{offer.normalizedUnitPrice?.unit}
                </Text>
              ) : null}
            </View>
          </View>
          <SavingsMessage offer={offer} compact />
        </View>

        <View style={styles.metaWrap}>
          {readableQuantityText ? (
            <View style={styles.metaPill}>
              <Text style={styles.metaPillLabel}>{readableQuantityText}</Text>
            </View>
          ) : null}
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
            {isSelected ? 'Gemerkt' : 'Merken'}
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
  hasActiveFilters,
  onResetFilters,
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
              Tippe auf Angebote anzeigen. Märkte und Kategorien kannst du optional eingrenzen.
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
              ? 'Keine passenden Angebote gefunden.'
              : 'Aktuell wurden keine passenden Angebote gefunden. Wähle andere Geschäfte oder Kategorien.'}
          </Text>
          {hasActiveFilters ? (
            <Pressable style={styles.secondaryWideButton} onPress={onResetFilters}>
              <Text style={styles.secondaryWideButtonLabel}>Filter zurücksetzen</Text>
            </Pressable>
          ) : null}
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

function ShoppingListPage({ shoppingListEntries, onRemove, onBrowse, onClearList, onQuantityChange }) {
  const { width } = useWindowDimensions();
  const isCompact = width < 390;
  const [shareState, setShareState] = useState({ status: 'idle', message: '' });
  const groupedEntries = useMemo(
    () => groupShoppingListEntries(shoppingListEntries),
    [shoppingListEntries]
  );
  const totalSavings = useMemo(
    () => shoppingListEntries.reduce((sum, offer) => sum + getShoppingSavingsTotal(offer), 0),
    [shoppingListEntries]
  );
  const totalCurrent = useMemo(
    () => shoppingListEntries.reduce((sum, offer) => sum + getShoppingCurrentTotal(offer), 0),
    [shoppingListEntries]
  );
  const actionPriceCount = shoppingListEntries.filter((offer) => !hasReliableSavings(offer)).length;

  async function handleShareList() {
    try {
      setShareState({ status: 'loading', message: '' });
      const result = await createSharedShoppingList(buildShoppingListShareSnapshot(shoppingListEntries));
      const shareUrl = result?.url || `https://www.kaufklug.at/liste/${result?.shareId || ''}`;

      if (!result?.shareId || !shareUrl) {
        throw new Error('Die Einkaufsliste konnte gerade nicht geteilt werden.');
      }

      const shareMessage = `Hier ist meine kaufklug Einkaufsliste:\n${shareUrl}`;

      try {
        await Clipboard.setStringAsync(shareUrl);
      } catch (clipboardError) {
        // Clipboard ist Komfort. Das Share Sheet bekommt den Link direkt.
      }

      try {
        await Share.share({
          title: 'kaufklug Einkaufsliste',
          message: shareMessage,
          url: shareUrl,
        });
        setShareState({ status: 'done', message: 'Link zur Einkaufsliste geteilt.' });
      } catch (shareError) {
        await Clipboard.setStringAsync(shareUrl);
        setShareState({ status: 'done', message: 'Link zur Einkaufsliste kopiert.' });
      }
    } catch (shareError) {
      setShareState({
        status: 'error',
        message: 'Die Einkaufsliste konnte gerade nicht geteilt werden.',
      });
    }
  }

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

      <View style={styles.shoppingActions}>
        <Pressable
          style={[styles.fullWidthSearchButton, shareState.status === 'loading' ? styles.disabledButton : null]}
          onPress={handleShareList}
          disabled={shareState.status === 'loading'}
        >
          <Text style={styles.fullWidthSearchButtonLabel}>
            {shareState.status === 'loading' ? 'Teile Liste ...' : 'Liste teilen'}
          </Text>
        </Pressable>
        {shareState.message ? (
          <Text style={[styles.shareFeedback, shareState.status === 'error' ? styles.shareFeedbackError : null]}>
            {shareState.message}
          </Text>
        ) : null}
      </View>

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
              <View style={styles.listItemMain}>
                <OfferImage
                  offer={offer}
                  sizeStyle={[styles.listItemImage, isCompact ? styles.listItemImageCompact : null]}
                  placeholderStyle={[styles.listItemImageFallback, isCompact ? styles.listItemImageFallbackCompact : null]}
                  placeholderTextStyle={styles.listItemImageFallbackText}
                />
                <View style={styles.listItemBody}>
                  <Text style={styles.offerCategory}>{getOfferCategoryLabel(offer)}</Text>
                  <Text style={styles.listItemTitle}>{offer.title}</Text>
                  <Text style={styles.offerPriceSmall}>
                    {formatCurrency(offer.priceCurrent?.amount, offer.priceCurrent?.currency)}
                    {getShoppingQuantity(offer) > 1 ? ` x ${getShoppingQuantity(offer)} = ${formatCurrency(getShoppingCurrentTotal(offer), offer.priceCurrent?.currency)}` : ''}
                  </Text>
                  <SavingsMessage offer={{ ...offer, savingsAmount: getShoppingSavingsTotal(offer) }} compact />
                  <View style={styles.metaWrap}>
                    <View style={styles.metaPill}>
                      <Text style={styles.metaPillLabel}>{formatValidityLabel(offer)}</Text>
                    </View>
                    <View style={styles.metaPill}>
                      <Text style={styles.metaPillLabel}>Packung: {offer.quantityText || 'nicht erkannt'}</Text>
                    </View>
                    {buildConditionBadges(offer).map((badge) => (
                      <View key={badge} style={styles.conditionPill}>
                        <Text style={styles.conditionPillLabel}>{badge}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              </View>
              <View style={[styles.listItemActions, isCompact ? styles.listItemActionsCompact : null]}>
                <Pressable style={styles.removeButton} onPress={() => onRemove(offer.id)}>
                  <Text style={styles.removeButtonLabel}>Entfernen</Text>
                </Pressable>
                <QuantityControl
                  quantity={getShoppingQuantity(offer)}
                  onDecrease={() => onQuantityChange(offer.id, -1)}
                  onIncrease={() => onQuantityChange(offer.id, 1)}
                />
              </View>
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

function UpdateModal({ visible, updateInfo, onUpdate, onLater }) {
  if (!visible) {
    return null;
  }

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onLater}>
      <View style={styles.updateOverlay}>
        <View style={styles.updateCard}>
          <Text style={styles.updateEyebrow}>kaufklug.at Alpha</Text>
          <Text style={styles.updateTitle}>Neue Version verfuegbar</Text>
          <Text style={styles.updateText}>
            Es gibt eine neue APK-Version. Tippe auf Aktualisieren, lade die Datei herunter und bestaetige danach die Installation auf deinem Smartphone.
          </Text>
          {updateInfo?.latestVersion ? (
            <Text style={styles.updateMeta}>Version: {updateInfo.latestVersion}</Text>
          ) : null}
          <Pressable style={styles.updatePrimaryButton} onPress={onUpdate}>
            <Text style={styles.updatePrimaryButtonLabel}>Aktualisieren</Text>
          </Pressable>
          <Pressable style={styles.updateSecondaryButton} onPress={onLater}>
            <Text style={styles.updateSecondaryButtonLabel}>Spaeter</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
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
  const [updateInfo, setUpdateInfo] = useState(null);
  const [expandedCategoryGroups, setExpandedCategoryGroups] = useState({});
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

  async function checkForAlphaUpdate() {
    try {
      const versionInfo = await fetchAlphaVersionInfo();
      const latestBuildNumber = toBuildNumber(versionInfo?.latestBuildNumber || versionInfo?.latestBuild);
      const installedBuildNumber = getInstalledBuildNumber();

      if (!latestBuildNumber || !installedBuildNumber) {
        setUpdateInfo(null);
        return;
      }

      if (latestBuildNumber <= installedBuildNumber) {
        setUpdateInfo(null);
        clearDismissedUpdateReminder().catch(() => {});
        return;
      }

      const dismissedReminder = await getDismissedUpdateReminder();

      if (isUpdateReminderPaused(latestBuildNumber, dismissedReminder)) {
        setUpdateInfo(null);
        return;
      }

      setUpdateInfo({
        ...versionInfo,
        latestBuildNumber,
        apkUrl: versionInfo?.apkUrl || ALPHA_APK_URL,
      });
    } catch (updateError) {
      setUpdateInfo(null);
      console.warn('Update-Pruefung konnte nicht abgeschlossen werden.', updateError);
    }
  }

  async function dismissAlphaUpdateReminder() {
    const latestBuildNumber = toBuildNumber(updateInfo?.latestBuildNumber);
    const installedBuildNumber = getInstalledBuildNumber();
    setUpdateInfo(null);

    try {
      if (latestBuildNumber && installedBuildNumber && latestBuildNumber > installedBuildNumber) {
        await storeDismissedUpdateReminder(latestBuildNumber);
      }
    } catch (storageError) {
      console.warn('Update-Erinnerung konnte nicht gespeichert werden.', storageError);
    }
  }

  async function openAlphaUpdate() {
    try {
      await Linking.openURL(updateInfo?.apkUrl || ALPHA_APK_URL);
    } catch (linkError) {
      setError('Der Download konnte nicht geoeffnet werden. Bitte pruefe die Internetverbindung.');
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
      const nextCategoryGroups = buildCategoryGroups(nextCategories);
      const validKeys = new Set(getCategoryFilterOptions(nextCategoryGroups).map((option) => option.key));

      setCategories(nextCategories);
      setSelectedCategories((current) => {
        return current.filter((key) => validKeys.has(key));
      });
      setExpandedCategoryGroups((current) => {
        const nextExpanded = {};

        for (const group of nextCategoryGroups) {
          if (current[group.mainCategory]) {
            nextExpanded[group.mainCategory] = true;
          }
        }

        return nextExpanded;
      });
      setError('');
    } catch (loadError) {
      setCategories([]);
      setError(loadError.message || 'Kategorien konnten nicht geladen werden.');
    }
  }

  async function loadRanking(isRefresh = false) {
    try {
      if (false && selectedRetailers.length === 0) {
        setRanking(null);
        setError('Wähle zuerst mindestens ein Geschäft aus.');
        return;
      }

      if (false && hasNoActiveCategories) {
        setRanking(null);
        setError('Aktiviere mindestens eine Unterkategorie, damit Angebote gesucht werden kÃ¶nnen.');
        return;
      }

      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      const params = new URLSearchParams();
      if (selectedCategoryLabelsForApi.length > 0 && !hasAllCategoriesSelected) params.set('categories', selectedCategoryLabelsForApi.join(','));
      if (selectedRetailers.length > 0) params.set('retailers', selectedRetailers.join(','));
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
    checkForAlphaUpdate();
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
  const allCategoryOptions = useMemo(() => getCategoryFilterOptions(categoryGroups), [categoryGroups]);
  const categoryLabelByKey = useMemo(() => {
    const nextMap = new Map();

    for (const option of allCategoryOptions) {
      nextMap.set(option.key, option.label);
    }

    return nextMap;
  }, [allCategoryOptions]);
  const shoppingListEntries = useMemo(() => Object.values(shoppingListMap), [shoppingListMap]);
  const selectedRetailerCount = selectedRetailers.length;
  const selectedCategoryCount = selectedCategories.length;
  const hasCategoryFilterOptions = allCategoryOptions.length > 0;
  const hasNoActiveCategories = false;
  const hasAllCategoriesSelected = hasCategoryFilterOptions && selectedCategoryCount === allCategoryOptions.length;
  const hasActiveFilters = selectedRetailerCount > 0 || selectedCategoryCount > 0;
  const selectedCategoryLabelsForApi = useMemo(
    () => selectedCategories.map((key) => categoryLabelByKey.get(key)).filter(Boolean),
    [categoryLabelByKey, selectedCategories]
  );
  const filterStatusLabel = useMemo(() => {
    const retailerPart = selectedRetailerCount > 0
      ? `${selectedRetailerCount} Markt${selectedRetailerCount === 1 ? '' : 'e'}`
      : 'Alle Märkte';
    const categoryPart = selectedCategoryCount > 0
      ? `${selectedCategoryCount} Kategorie${selectedCategoryCount === 1 ? '' : 'n'} ausgewählt`
      : 'Alle Kategorien';

    return `${retailerPart} · ${categoryPart}`;
  }, [selectedCategoryCount, selectedRetailerCount]);
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

  function toggleCategory(categoryKey) {
    setSelectedCategories((current) => (
      current.includes(categoryKey)
        ? current.filter((item) => item !== categoryKey)
        : [...current, categoryKey]
    ));
  }

  function toggleMainCategory(subcategories, fallbackCategory) {
    if (!subcategories.length) {
      toggleCategory(getCategorySelectionKey(fallbackCategory, fallbackCategory));
      return;
    }

    setExpandedCategoryGroups((current) => ({
      ...current,
      [fallbackCategory]: !current[fallbackCategory],
    }));
  }

  function toggleCategoryGroupSelection(subcategories, fallbackCategory) {
    if (!subcategories.length) {
      toggleCategory(getCategorySelectionKey(fallbackCategory, fallbackCategory));
      return;
    }

    setSelectedCategories((current) => {
      const subcategoryKeys = subcategories.map((subcategory) => getCategorySelectionKey(fallbackCategory, subcategory));
      const allSelected = subcategoryKeys.every((subcategoryKey) => current.includes(subcategoryKey));

      if (allSelected) {
        return current.filter((item) => !subcategoryKeys.includes(item));
      }

      return [...new Set([...current, ...subcategoryKeys])];
    });
  }

  function toggleAllCategories() {
    setSelectedCategories(hasAllCategoriesSelected ? [] : allCategoryOptions.map((option) => option.key));
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
        [offer.id]: {
          ...offer,
          shoppingQuantity: getShoppingQuantity(offer),
        },
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

  function updateShoppingListQuantity(offerId, delta) {
    setShoppingListMap((current) => {
      const offer = current[offerId];

      if (!offer) {
        return current;
      }

      return {
        ...current,
        [offerId]: {
          ...offer,
          shoppingQuantity: Math.max(1, getShoppingQuantity(offer) + delta),
        },
      };
    });
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
          title="Märkte eingrenzen"
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
            <Text style={styles.secondaryButtonLabel}>Alle Märkte auswählen</Text>
          </Pressable>
          {selectedRetailerCount > 0 ? (
          <Pressable style={styles.secondaryButton} onPress={resetRetailers}>
            <Text style={styles.secondaryButtonLabel}>Geschäfte zurücksetzen</Text>
          </Pressable>
          ) : null}
        </View>
      </View>

      <View style={styles.flowCard}>
        <StepHeader
          step="2. Produkte wählen"
          title="Produkte eingrenzen"
          text="Tippe eine Kategorie zum Öffnen an. Mit Alle oder Keine steuerst du die ganze Gruppe."
        />
        <Pressable style={styles.secondaryWideButton} onPress={toggleAllCategories}>
          <Text style={styles.secondaryWideButtonLabel}>
            {hasAllCategoriesSelected ? 'Alles deaktivieren' : 'Alles aktivieren'}
          </Text>
        </Pressable>
        <View style={styles.categoryList}>
          {categoryGroups.map((group) => {
            const selectedCount = group.subcategories.filter((item) => selectedCategories.includes(getCategorySelectionKey(group.mainCategory, item))).length;
            const allSelected = selectedCount === group.subcategories.length && group.subcategories.length > 0;
            const partial = selectedCount > 0 && !allSelected;
            const fallbackKey = getCategorySelectionKey(group.mainCategory, group.mainCategory);
            const fallbackSelected = selectedCategories.includes(fallbackKey);
            const expanded = Boolean(expandedCategoryGroups[group.mainCategory]);

            return (
              <View key={group.mainCategory} style={styles.categoryCard}>
                <View
                  style={[
                    styles.mainCategoryButton,
                    allSelected || fallbackSelected ? styles.mainCategoryButtonActive : null,
                    partial ? styles.mainCategoryButtonPartial : null,
                  ]}
                >
                  <Pressable
                    style={styles.mainCategoryOpenArea}
                    onPress={() => toggleMainCategory(group.subcategories, group.mainCategory)}
                  >
                    <View style={styles.mainCategoryTextBox}>
                      <Text style={[styles.mainCategoryLabel, allSelected || fallbackSelected || partial ? styles.mainCategoryLabelActive : null]}>
                        {group.mainCategory}
                      </Text>
                      <Text style={[styles.mainCategoryMeta, allSelected || fallbackSelected || partial ? styles.mainCategoryMetaActive : null]}>
                        {group.subcategories.length > 0
                          ? `${selectedCount}/${group.subcategories.length} aktiv`
                          : fallbackSelected ? 'aktiv' : 'inaktiv'}
                      </Text>
                    </View>
                    <Text style={[styles.mainCategoryChevron, allSelected || fallbackSelected || partial ? styles.mainCategoryChevronActive : null]}>
                      {group.subcategories.length > 0 ? (expanded ? '-' : '+') : fallbackSelected ? '✓' : '+'}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[styles.mainCategoryBulkButton, allSelected || fallbackSelected ? styles.mainCategoryBulkButtonActive : null]}
                    onPress={() => toggleCategoryGroupSelection(group.subcategories, group.mainCategory)}
                  >
                    <Text style={[styles.mainCategoryBulkLabel, allSelected || fallbackSelected ? styles.mainCategoryBulkLabelActive : null]}>
                      {allSelected || fallbackSelected ? 'Keine' : 'Alle'}
                    </Text>
                  </Pressable>
                </View>
                {group.subcategories.length > 0 && expanded ? (
                  <View style={styles.subcategoryWrap}>
                    {group.subcategories.map((subcategory) => (
                      <FilterChip
                        key={getCategorySelectionKey(group.mainCategory, subcategory)}
                        label={subcategory}
                        active={selectedCategories.includes(getCategorySelectionKey(group.mainCategory, subcategory))}
                        onPress={() => toggleCategory(getCategorySelectionKey(group.mainCategory, subcategory))}
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
        <View style={styles.filterStatusCard}>
          <Text style={styles.filterStatusText}>{filterStatusLabel}</Text>
        </View>
        <Pressable
          style={[styles.fullWidthSearchButton, loading ? styles.disabledButton : null]}
          onPress={() => loadRanking(false)}
          disabled={loading}
        >
          <Text style={styles.fullWidthSearchButtonLabel}>
            {loading ? 'Angebote werden geladen …' : 'Angebote anzeigen'}
          </Text>
        </Pressable>
        {hasActiveFilters ? (
        <Pressable style={styles.secondaryWideButton} onPress={resetSelection}>
          <Text style={styles.secondaryWideButtonLabel}>Filter zurücksetzen</Text>
        </Pressable>
        ) : null}
        <View style={styles.quickInfoCard}>
          <Text style={styles.quickInfoTitle}>Deine Auswahl</Text>
          <Text style={styles.quickInfoText}>
            {selectedRetailerCount > 0
              ? `${selectedRetailerCount} Geschäft${selectedRetailerCount === 1 ? '' : 'e'} ausgewählt`
              : 'Alle Märkte'}
            {hasAllCategoriesSelected
              ? ' · alle Kategorien aktiv'
              : selectedCategoryCount > 0
                ? ` · ${selectedCategoryCount} Kategorie${selectedCategoryCount === 1 ? '' : 'n'} aktiv`
                : hasCategoryFilterOptions ? ' · alle Kategorien' : ''}
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
          <Text
            style={[styles.topMenuLabel, activePage === 'offers' ? styles.topMenuLabelActive : null]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.86}
          >
            Angebote
          </Text>
        </Pressable>
        <Pressable
          style={[styles.topMenuButton, activePage === 'product-search' ? styles.topMenuButtonActive : null]}
          onPress={() => setActivePage('product-search')}
        >
          <Text
            style={[styles.topMenuLabel, activePage === 'product-search' ? styles.topMenuLabelActive : null]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.86}
          >
            Suche
          </Text>
        </Pressable>
        <Pressable
          style={[styles.topMenuButton, activePage === 'shopping' ? styles.topMenuButtonActive : null]}
          onPress={() => setActivePage('shopping')}
        >
          <Text
            style={[styles.topMenuLabel, activePage === 'shopping' ? styles.topMenuLabelActive : null]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.82}
          >
            Einkaufsliste
          </Text>
          {shoppingListEntries.length > 0 ? (
            <View style={[styles.topMenuBadge, activePage === 'shopping' ? styles.topMenuBadgeActive : null]}>
              <Text style={[styles.topMenuBadgeLabel, activePage === 'shopping' ? styles.topMenuBadgeLabelActive : null]}>
                {shoppingListEntries.length}
              </Text>
            </View>
          ) : null}
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
            hasActiveFilters={hasActiveFilters}
            onResetFilters={resetSelection}
          />
        ) : activePage === 'product-search' ? (
          <ProductSearchScreen
            fetchJson={fetchJson}
            flattenRankingOffers={flattenRankingOffers}
            OfferCardComponent={OfferCard}
            retailers={retailers}
            shoppingListMap={shoppingListMap}
            onToggleShoppingList={toggleShoppingList}
            onOpenOfferDetail={setSelectedOffer}
          />
        ) : (
          <ShoppingListPage
            shoppingListEntries={shoppingListEntries}
            onRemove={removeFromShoppingList}
            onBrowse={showOffersTab}
            onClearList={clearShoppingList}
            onQuantityChange={updateShoppingListQuantity}
          />
        )}
      </View>

      <FooterLink bottomInset={androidBottomInset} />

      <UpdateModal
        visible={Boolean(updateInfo)}
        updateInfo={updateInfo}
        onUpdate={openAlphaUpdate}
        onLater={dismissAlphaUpdateReminder}
      />

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
    gap: 6,
    paddingHorizontal: 12,
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
    paddingHorizontal: 6,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    position: 'relative',
  },
  topMenuButtonActive: { backgroundColor: '#31582c' },
  topMenuLabel: { color: '#425040', fontWeight: '800', fontSize: 13, textAlign: 'center' },
  topMenuLabelActive: { color: '#f8f5ed' },
  topMenuBadge: {
    position: 'absolute',
    top: 5,
    right: 6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#31582c',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  topMenuBadgeActive: { backgroundColor: '#f8f5ed' },
  topMenuBadgeLabel: { color: '#f8f5ed', fontSize: 11, fontWeight: '900', lineHeight: 14 },
  topMenuBadgeLabelActive: { color: '#31582c' },
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
  fullWidthSearchButton: { backgroundColor: '#12361e', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 16, alignItems: 'center', minHeight: 54, justifyContent: 'center' },
  fullWidthSearchButtonLabel: { color: '#f8f5ed', fontWeight: '900', fontSize: 16, textAlign: 'center' },
  disabledButton: { opacity: 0.45, backgroundColor: '#8a9285' },
  categoryList: { gap: 10 },
  categoryCard: { backgroundColor: '#f8f3e8', borderRadius: 18, padding: 10, gap: 9, borderWidth: 1, borderColor: 'rgba(19, 32, 20, 0.06)' },
  mainCategoryButton: {
    minHeight: 56,
    borderRadius: 16,
    backgroundColor: '#efe6d7',
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(49, 88, 44, 0.12)',
  },
  mainCategoryButtonActive: { backgroundColor: '#31582c', borderColor: '#31582c' },
  mainCategoryButtonPartial: { backgroundColor: '#dce9ca', borderColor: '#9fbd81' },
  mainCategoryOpenArea: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  mainCategoryTextBox: { flex: 1, minWidth: 0, gap: 2 },
  mainCategoryLabel: { color: '#253425', fontSize: 15, lineHeight: 20, fontWeight: '900' },
  mainCategoryLabelActive: { color: '#f8f5ed' },
  mainCategoryMeta: { color: '#62705f', fontSize: 11, lineHeight: 15, fontWeight: '800', textTransform: 'uppercase' },
  mainCategoryMetaActive: { color: '#e8f2df' },
  mainCategoryChevron: { color: '#31582c', fontSize: 22, lineHeight: 24, fontWeight: '900', minWidth: 24, textAlign: 'center' },
  mainCategoryChevronActive: { color: '#f8f5ed' },
  mainCategoryBulkButton: { minWidth: 62, borderRadius: 12, backgroundColor: '#fffaf2', paddingHorizontal: 10, paddingVertical: 9, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(49, 88, 44, 0.18)' },
  mainCategoryBulkButtonActive: { backgroundColor: 'rgba(248, 245, 237, 0.18)', borderColor: 'rgba(248, 245, 237, 0.34)' },
  mainCategoryBulkLabel: { color: '#31582c', fontSize: 12, lineHeight: 16, fontWeight: '900' },
  mainCategoryBulkLabelActive: { color: '#f8f5ed' },
  subcategoryWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, paddingTop: 2 },
  quickInfoCard: { backgroundColor: '#f3eddc', borderRadius: 16, padding: 12, gap: 4 },
  quickInfoTitle: { color: '#31582c', fontSize: 12, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1 },
  quickInfoText: { color: '#4f594e', fontSize: 13, lineHeight: 18 },
  filterStatusCard: { backgroundColor: '#e9f6db', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10 },
  filterStatusText: { color: '#244320', fontSize: 13, lineHeight: 18, fontWeight: '900', textAlign: 'center' },
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
  offerBody: { flex: 1, minWidth: 0, gap: 7 },
  offerTopRow: { gap: 4 },
  offerBadgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  rankBadge: { backgroundColor: '#e3dccd', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  rankBadgeLabel: { color: '#425040', fontSize: 11, fontWeight: '900' },
  retailerBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  retailerBadgeLabel: { color: '#ffffff', fontSize: 11, fontWeight: '900' },
  softBadge: { backgroundColor: '#e7f0da', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  softBadgeLabel: { color: '#31582c', fontSize: 11, fontWeight: '900' },
  offerCategory: { color: '#31582c', fontSize: 12, fontWeight: '800' },
  offerValidity: { color: '#5f6a5d', fontSize: 12, lineHeight: 17, fontWeight: '700' },
  offerTitle: { color: '#152315', fontSize: 16, lineHeight: 22, fontWeight: '800' },
  offerPriceStack: { alignSelf: 'stretch', gap: 8 },
  offerPriceBox: { alignSelf: 'stretch', minWidth: 0, gap: 3 },
  minimumQuantityChip: { alignSelf: 'flex-start', backgroundColor: '#fff0cf', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, marginBottom: 2 },
  minimumQuantityChipLabel: { color: '#80520a', fontSize: 12, lineHeight: 16, fontWeight: '900' },
  offerPriceMetaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  offerPrice: { color: '#173118', fontSize: 24, lineHeight: 30, fontWeight: '900' },
  offerPriceSmall: { color: '#173118', fontSize: 18, fontWeight: '900' },
  offerMeta: { color: '#59635a', fontSize: 13 },
  metaWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  metaPill: { backgroundColor: '#efe8da', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  metaPillWide: { maxWidth: '100%', backgroundColor: '#e7f0da', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  metaPillLabel: { color: '#59635a', fontSize: 12, lineHeight: 16, fontWeight: '700' },
  conditionPill: { backgroundColor: '#fff0cf', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  conditionPillLabel: { color: '#80520a', fontSize: 12, fontWeight: '800' },
  savingsBox: { alignSelf: 'stretch', alignItems: 'flex-start', backgroundColor: '#e9f6db', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 8, maxWidth: '100%', gap: 2 },
  savingsBoxCompact: { maxWidth: '100%', alignSelf: 'stretch' },
  savingsValue: { color: '#173118', fontSize: 14, fontWeight: '900' },
  savingsDescription: { color: '#4d5a4b', fontSize: 11, lineHeight: 15 },
  actionPriceBox: { alignSelf: 'stretch', alignItems: 'flex-start', backgroundColor: '#fff6dd', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 8, maxWidth: '100%', gap: 2, borderWidth: 1, borderColor: '#ead49a' },
  actionPriceTitle: { color: '#80520a', fontSize: 14, fontWeight: '900' },
  actionPriceText: { color: '#80520a', fontSize: 11, lineHeight: 15 },
  shoppingToggle: { marginTop: 4, alignSelf: 'stretch', alignItems: 'center', backgroundColor: '#31582c', paddingHorizontal: 12, paddingVertical: 12, borderRadius: 999, minHeight: 46, justifyContent: 'center' },
  shoppingToggleActive: { backgroundColor: '#e7f0da', borderWidth: 1, borderColor: '#31582c' },
  shoppingToggleLabel: { color: '#f8f5ed', fontSize: 14, fontWeight: '900' },
  shoppingToggleLabelActive: { color: '#31582c' },
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
  listItemCardCompact: { flexDirection: 'column' },
  listItemMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  listItemImage: { width: 72, height: 72, borderRadius: 12, backgroundColor: '#fff' },
  listItemImageCompact: { width: 64, height: 64 },
  listItemImageFallback: { width: 72, height: 72, borderRadius: 12, backgroundColor: '#dfe9d5', alignItems: 'center', justifyContent: 'center', padding: 8 },
  listItemImageFallbackCompact: { width: 64, height: 64 },
  listItemImageFallbackText: { color: '#31582c', fontSize: 11, fontWeight: '900', textAlign: 'center' },
  listItemBody: { flex: 1, gap: 5 },
  listItemTitle: { color: '#152315', fontSize: 15, lineHeight: 20, fontWeight: '800' },
  listItemActions: { width: 98, gap: 8, alignSelf: 'stretch' },
  listItemActionsCompact: { width: '100%', flexDirection: 'row' },
  removeButton: { flex: 1, backgroundColor: '#efe5da', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 10, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  removeButtonLabel: { color: '#7b3535', fontSize: 12, fontWeight: '800', textAlign: 'center' },
  quantityControl: { flex: 1, backgroundColor: '#fffaf2', borderRadius: 12, padding: 8, gap: 6, borderWidth: 1, borderColor: 'rgba(19, 32, 20, 0.08)' },
  quantityLabel: { color: '#31582c', fontSize: 11, lineHeight: 14, fontWeight: '900', textAlign: 'center', textTransform: 'uppercase' },
  quantityStepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  quantityButton: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#31582c' },
  quantityButtonDisabled: { opacity: 0.35 },
  quantityButtonLabel: { color: '#f8f5ed', fontSize: 18, lineHeight: 22, fontWeight: '900' },
  quantityValue: { minWidth: 20, color: '#132014', fontSize: 15, lineHeight: 20, fontWeight: '900', textAlign: 'center' },
  shoppingActions: { gap: 10 },
  shareFeedback: { color: '#244320', backgroundColor: '#e9f6db', borderRadius: 14, padding: 12, fontSize: 13, lineHeight: 18, fontWeight: '800', textAlign: 'center' },
  shareFeedbackError: { color: '#8b2424', backgroundColor: '#fdeeee' },
  resultGroupList: { gap: 16 },
  sectionSpacer: { height: 16 },
  updateOverlay: {
    flex: 1,
    backgroundColor: 'rgba(18, 28, 18, 0.48)',
    justifyContent: 'center',
    padding: 22,
  },
  updateCard: {
    backgroundColor: '#fffaf2',
    borderRadius: 22,
    padding: 18,
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(19, 32, 20, 0.1)',
  },
  updateEyebrow: { color: '#31582c', fontSize: 12, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1 },
  updateTitle: { color: '#132014', fontSize: 22, lineHeight: 28, fontWeight: '900' },
  updateText: { color: '#4f594e', fontSize: 14, lineHeight: 21 },
  updateMeta: { color: '#6a7467', fontSize: 12, lineHeight: 17 },
  updatePrimaryButton: { backgroundColor: '#31582c', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, alignItems: 'center' },
  updatePrimaryButtonLabel: { color: '#f8f5ed', fontSize: 15, fontWeight: '900' },
  updateSecondaryButton: { backgroundColor: '#ece4d7', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 13, alignItems: 'center' },
  updateSecondaryButtonLabel: { color: '#304230', fontSize: 14, fontWeight: '900' },
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
