import { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Linking,
  PanResponder,
  Animated,
  Dimensions,
  Keyboard,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';

const TAB_HEIGHT = 64;
const SCREEN_HEIGHT = Dimensions.get('window').height;
const SHEET_MIN = 80;
const SHEET_MID = Math.round(SCREEN_HEIGHT * 0.38);
const SHEET_MAX = Math.round(SCREEN_HEIGHT * 0.70);

type SearchMode = 'distance' | 'time';
type Tab = 'search' | 'favorites';

const ALL_TYPES = ['attraction', 'viewpoint', 'museum', 'park', 'nature_reserve', 'restaurant', 'cafe'] as const;
type PlaceType = typeof ALL_TYPES[number];

const TYPE_LABEL: Record<string, string> = {
  attraction: '観光',
  viewpoint: '展望台',
  museum: '博物館',
  park: '公園',
  nature_reserve: '自然',
  restaurant: 'レストラン',
  cafe: 'カフェ',
};

const TYPE_COLOR: Record<string, string> = {
  attraction: '#FF7043',
  viewpoint: '#7E57C2',
  museum: '#5C6BC0',
  park: '#43A047',
  nature_reserve: '#00897B',
  restaurant: '#E53935',
  cafe: '#FB8C00',
};

interface Place {
  id: number;
  name: string;
  lat: number;
  lon: number;
  type: string;
}

interface UserLocation {
  latitude: number;
  longitude: number;
}

function timeToDistance(minutes: number): number {
  return (minutes / 60) * 60;
}

async function fetchNearbyPlaces(lat: number, lon: number, radiusKm: number, types: PlaceType[]): Promise<Place[]> {
  const radiusM = Math.min(radiusKm * 1000, 50000);
  const tourismTypes = types.filter(t => ['attraction', 'viewpoint', 'museum'].includes(t));
  const leisureTypes = types.filter(t => ['park', 'nature_reserve'].includes(t));
  const amenityTypes = types.filter(t => ['restaurant', 'cafe'].includes(t));

  const parts: string[] = [];
  if (tourismTypes.length > 0)
    parts.push(`node["tourism"~"${tourismTypes.join('|')}"](around:${radiusM},${lat},${lon});`);
  if (leisureTypes.length > 0)
    parts.push(`node["leisure"~"${leisureTypes.join('|')}"](around:${radiusM},${lat},${lon});`);
  if (amenityTypes.length > 0)
    parts.push(`node["amenity"~"${amenityTypes.join('|')}"](around:${radiusM},${lat},${lon});`);

  if (parts.length === 0) return [];

  const query = `[out:json][timeout:25];\n(\n${parts.join('\n')}\n);\nout body 30;`;
  const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  const json = await res.json();
  return (json.elements as any[])
    .filter((el) => el.tags?.name)
    .map((el) => ({
      id: el.id,
      name: el.tags.name,
      lat: el.lat,
      lon: el.lon,
      type: el.tags.tourism || el.tags.leisure || el.tags.amenity || 'place',
    }));
}

function buildMapHtml(userLat: number, userLon: number, radiusKm: number, places: Place[]): string {
  const placesJson = JSON.stringify(places).replace(/<\//g, '<\\/');
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>html,body,#map{margin:0;padding:0;width:100%;height:100%}</style>
</head>
<body>
<div id="map"></div>
<script>
  var map = L.map('map', {zoomControl: false}).setView([${userLat},${userLon}],13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap'}).addTo(map);
  L.circleMarker([${userLat},${userLon}],{radius:9,color:'#fff',weight:2,fillColor:'#1a73e8',fillOpacity:1}).addTo(map);
  ${radiusKm > 0 ? `L.circle([${userLat},${userLon}],{radius:${radiusKm * 1000},color:'#1a73e8',fillColor:'#1a73e8',fillOpacity:0.06,weight:1}).addTo(map);` : ''}
  var markers = {};
  var places = ${placesJson};
  places.forEach(function(p) {
    var m = L.marker([p.lat, p.lon]).addTo(map);
    markers[p.id] = m;
    m.on('click', function(e) {
      L.DomEvent.stopPropagation(e);
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'pin', id:p.id}));
    });
  });
  if (places.length > 0) {
    var group = L.featureGroup(Object.values(markers));
    map.fitBounds(group.getBounds().pad(0.3), {maxZoom: 14});
  }
  function highlightPin(id) {
    Object.keys(markers).forEach(function(k) {
      markers[k].setOpacity(parseInt(k) === id ? 1.0 : 0.35);
    });
  }
  function clearHighlight() {
    Object.keys(markers).forEach(function(k) { markers[k].setOpacity(1.0); });
  }
  map.on('click', function() {
    window.ReactNativeWebView.postMessage(JSON.stringify({type:'mapTap'}));
  });
</script>
</body>
</html>`;
}

function openAppleMaps(place: Place) {
  const url = `maps://maps.apple.com/?daddr=${place.lat},${place.lon}&dirflg=d`;
  Linking.openURL(url).catch(() =>
    Linking.openURL(`https://maps.apple.com/?daddr=${place.lat},${place.lon}&dirflg=d`)
  );
}

function snapToPoint(value: number, vy: number): number {
  if (vy < -0.6) return SHEET_MAX;
  if (vy > 0.6) return SHEET_MIN;
  const points = [SHEET_MIN, SHEET_MID, SHEET_MAX];
  return points.reduce((a, b) => Math.abs(b - value) < Math.abs(a - value) ? b : a);
}

function TypeBadge({ type, small }: { type: string; small?: boolean }) {
  const color = TYPE_COLOR[type] || '#9aa0a6';
  return (
    <View style={{ backgroundColor: color + '20', borderRadius: 6, paddingHorizontal: small ? 6 : 8, paddingVertical: small ? 2 : 3, alignSelf: 'flex-start' }}>
      <Text style={{ fontSize: small ? 10 : 11, color, fontWeight: '700' }}>{TYPE_LABEL[type] || type}</Text>
    </View>
  );
}

function PlaceRow({ place, isFavorite, onToggleFavorite }: { place: Place; isFavorite: boolean; onToggleFavorite: (p: Place) => void }) {
  const [expanded, setExpanded] = useState(false);
  const color = TYPE_COLOR[place.type] || '#dadce0';
  return (
    <View style={[styles.placeCard, { borderLeftColor: color }]}>
      <TouchableOpacity onPress={() => setExpanded(e => !e)} style={styles.placeCardHeader} activeOpacity={0.7}>
        <View style={{ flex: 1, gap: 4 }}>
          <TypeBadge type={place.type} small />
          <Text style={styles.placeName} numberOfLines={expanded ? undefined : 1}>{place.name}</Text>
        </View>
        <Text style={styles.chevron}>{expanded ? '▲' : '▼'}</Text>
      </TouchableOpacity>
      {expanded && (
        <View style={styles.placeCardActions}>
          <TouchableOpacity onPress={() => openAppleMaps(place)} style={styles.actionBtnPrimary} activeOpacity={0.8}>
            <Text style={styles.actionBtnPrimaryText}>ナビ開始</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => onToggleFavorite(place)}
            style={[styles.actionBtnOutline, isFavorite && styles.actionBtnOutlineActive]}
            activeOpacity={0.8}
          >
            <Text style={[styles.actionBtnOutlineText, isFavorite && { color: '#1a73e8' }]}>
              {isFavorite ? '★ 保存済み' : '☆ 保存'}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function EmptyState({ message, sub, onRetry }: { message: string; sub?: string; onRetry?: () => void }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyStateIcon}>{onRetry ? '!' : '○'}</Text>
      <Text style={styles.emptyStateText}>{message}</Text>
      {sub && <Text style={styles.emptyStateSub}>{sub}</Text>}
      {onRetry && (
        <TouchableOpacity onPress={onRetry} style={styles.retryBtn} activeOpacity={0.8}>
          <Text style={styles.retryBtnText}>再試行</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function AppContent() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('search');
  const [mode, setMode] = useState<SearchMode>('distance');
  const [inputValue, setInputValue] = useState('');
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [allPlaces, setAllPlaces] = useState<Place[]>([]);
  const [activeFilters, setActiveFilters] = useState<PlaceType[]>([...ALL_TYPES]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [radiusKm, setRadiusKm] = useState(0);
  const [favorites, setFavorites] = useState<Place[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
  const webViewRef = useRef<WebView>(null);
  const allPlacesRef = useRef<Place[]>([]);
  const sheetHeight = useRef(new Animated.Value(SHEET_MID)).current;
  const lastHeight = useRef(SHEET_MID);

  // お気に入り永続化：読み込み
  useEffect(() => {
    AsyncStorage.getItem('favorites').then(data => {
      if (data) setFavorites(JSON.parse(data));
    }).catch(() => {});
  }, []);

  // お気に入り永続化：書き込み
  useEffect(() => {
    AsyncStorage.setItem('favorites', JSON.stringify(favorites)).catch(() => {});
  }, [favorites]);

  useEffect(() => { allPlacesRef.current = allPlaces; }, [allPlaces]);

  const showBottomSheet = (tab === 'favorites' || searched || loading || hasError) && !selectedPlace;

  useEffect(() => {
    if (showBottomSheet) {
      sheetHeight.setValue(SHEET_MID);
      lastHeight.current = SHEET_MID;
    }
  }, [showBottomSheet]);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { Alert.alert('位置情報が必要です', '設定から位置情報を許可してください。'); return; }
      const loc = await Location.getCurrentPositionAsync({});
      setUserLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
    })();
  }, []);

  const sheetPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, { dy }) => Math.abs(dy) > 4,
      onPanResponderMove: (_, { dy }) => {
        const next = Math.max(SHEET_MIN, Math.min(SHEET_MAX, lastHeight.current - dy));
        sheetHeight.setValue(next);
      },
      onPanResponderRelease: (_, { dy, vy }) => {
        const isTap = Math.abs(dy) < 5;
        if (isTap && lastHeight.current <= SHEET_MIN) {
          lastHeight.current = SHEET_MID;
          Animated.spring(sheetHeight, { toValue: SHEET_MID, useNativeDriver: false, bounciness: 4 }).start();
          return;
        }
        const next = Math.max(SHEET_MIN, Math.min(SHEET_MAX, lastHeight.current - dy));
        const snap = snapToPoint(next, vy);
        lastHeight.current = snap;
        Animated.spring(sheetHeight, { toValue: snap, useNativeDriver: false, bounciness: 4 }).start();
      },
    })
  ).current;

  const pinPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, { dy }) => dy > 8,
      onPanResponderRelease: (_, { dy, vy }) => {
        if (dy > 60 || vy > 0.6) dismissSelectedPlace();
      },
    })
  ).current;

  function dismissSelectedPlace() {
    setSelectedPlace(null);
    webViewRef.current?.injectJavaScript('clearHighlight(); true;');
  }

  function toggleFavorite(place: Place) {
    setFavorites(prev =>
      prev.some(f => f.id === place.id)
        ? prev.filter(f => f.id !== place.id)
        : [...prev, place]
    );
  }

  function isFavorite(place: Place) {
    return favorites.some(f => f.id === place.id);
  }

  function toggleFilter(type: PlaceType) {
    setActiveFilters(prev => {
      if (prev.includes(type) && prev.length === 1) return prev;
      return prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type];
    });
  }

  function clearSearch() {
    setSearched(false);
    setHasError(false);
    setAllPlaces([]);
    setSelectedPlace(null);
  }

  const filteredPlaces = allPlaces.filter(p => activeFilters.includes(p.type as PlaceType));

  async function handleSearch() {
    if (!userLocation) { Alert.alert('現在地を取得中です', 'しばらくお待ちください。'); return; }
    const val = parseFloat(inputValue);
    if (isNaN(val) || val <= 0) {
      Alert.alert('入力エラー', `${mode === 'distance' ? '距離（km）' : '時間（分）'}を正しく入力してください。`);
      return;
    }
    const km = mode === 'distance' ? val : timeToDistance(val);
    setRadiusKm(km);
    setLoading(true);
    setSearched(false);
    setHasError(false);
    setSelectedPlace(null);
    Keyboard.dismiss();
    try {
      const results = await fetchNearbyPlaces(userLocation.latitude, userLocation.longitude, km, [...ALL_TYPES]);
      setAllPlaces(results);
      setSearched(true);
    } catch {
      setHasError(true);
    } finally {
      setLoading(false);
    }
  }

  function handleWebViewMessage(event: any) {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === 'pin') {
        const place = allPlacesRef.current.find(p => p.id === msg.id);
        if (place) {
          setSelectedPlace(place);
          webViewRef.current?.injectJavaScript(`highlightPin(${place.id}); true;`);
        }
      } else if (msg.type === 'mapTap') {
        dismissSelectedPlace();
        Keyboard.dismiss();
      }
    } catch {}
  }

  const mapHtml = userLocation
    ? buildMapHtml(userLocation.latitude, userLocation.longitude, radiusKm, filteredPlaces)
    : null;

  const bottomBase = TAB_HEIGHT + insets.bottom;

  return (
    <View style={styles.container}>
      {/* 全画面マップ */}
      <View style={StyleSheet.absoluteFillObject}>
        {mapHtml ? (
          <WebView
            ref={webViewRef}
            style={{ flex: 1 }}
            source={{ html: mapHtml }}
            originWhitelist={['*']}
            onMessage={handleWebViewMessage}
          />
        ) : (
          <View style={styles.mapPlaceholder}>
            <ActivityIndicator size="large" color="#1a73e8" />
            <Text style={styles.mapPlaceholderText}>現在地を取得中...</Text>
          </View>
        )}
      </View>

      {/* 上部オーバーレイ */}
      <View style={[styles.topOverlay, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <View style={styles.searchBar} pointerEvents="auto">
          <TouchableOpacity
            style={styles.modeToggle}
            onPress={() => { setMode(m => m === 'distance' ? 'time' : 'distance'); setInputValue(''); clearSearch(); }}
            activeOpacity={0.7}
          >
            <Text style={styles.modeToggleText}>{mode === 'distance' ? 'km' : '分'}</Text>
          </TouchableOpacity>
          <View style={styles.modeDivider} />
          <TextInput
            style={styles.searchInput}
            placeholder={mode === 'distance' ? '半径 km を入力' : '移動時間 分 を入力'}
            placeholderTextColor="#9aa0a6"
            keyboardType="numeric"
            returnKeyType="search"
            autoCorrect={false}
            value={inputValue}
            onChangeText={setInputValue}
            onSubmitEditing={handleSearch}
          />
          {inputValue.length > 0 && (
            <TouchableOpacity onPress={() => { setInputValue(''); clearSearch(); }} style={styles.clearBtn} activeOpacity={0.7}>
              <Text style={styles.clearBtnText}>✕</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.searchBtn} onPress={handleSearch} disabled={loading} activeOpacity={0.8}>
            {loading
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={styles.searchBtnText}>検索</Text>}
          </TouchableOpacity>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} pointerEvents="auto" contentContainerStyle={styles.chipsContent}>
          {ALL_TYPES.map((type) => {
            const active = activeFilters.includes(type);
            const color = TYPE_COLOR[type] || '#9aa0a6';
            const isLast = active && activeFilters.length === 1;
            return (
              <TouchableOpacity
                key={type}
                style={[styles.chip, active && { backgroundColor: color, borderColor: color }, isLast && styles.chipLocked]}
                onPress={() => toggleFilter(type)}
                activeOpacity={isLast ? 1 : 0.8}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{TYPE_LABEL[type]}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* 検索結果ボトムシート */}
      {showBottomSheet && (
        <Animated.View style={[styles.bottomSheet, { bottom: bottomBase, height: sheetHeight }]}>
          <View style={styles.handleArea} {...sheetPanResponder.panHandlers}>
            <View style={styles.handle} />
            {!loading && searched && tab === 'search' && (
              <Text style={styles.resultCount}>{filteredPlaces.length}件見つかりました</Text>
            )}
            {!loading && tab === 'favorites' && (
              <Text style={styles.resultCount}>保存済みスポット {favorites.length}件</Text>
            )}
          </View>
          <ScrollView
            keyboardShouldPersistTaps="always"
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}
          >
            {loading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#1a73e8" />
                <Text style={styles.loadingText}>スポットを検索中...</Text>
              </View>
            ) : hasError ? (
              <EmptyState
                message="通信エラーが発生しました"
                sub="ネットワーク接続を確認してください"
                onRetry={handleSearch}
              />
            ) : tab === 'search' ? (
              filteredPlaces.length > 0
                ? filteredPlaces.map(place => (
                    <PlaceRow key={place.id} place={place} isFavorite={isFavorite(place)} onToggleFavorite={toggleFavorite} />
                  ))
                : <EmptyState message="スポットが見つかりませんでした" sub="検索範囲を広げるか、フィルターを変更してください" />
            ) : (
              favorites.length > 0
                ? favorites.map(place => (
                    <PlaceRow key={place.id} place={place} isFavorite={isFavorite(place)} onToggleFavorite={toggleFavorite} />
                  ))
                : <EmptyState message="保存済みスポットはありません" sub='スポットの「保存」ボタンで追加できます' />
            )}
          </ScrollView>
        </Animated.View>
      )}

      {/* ピン選択カード（下スワイプで閉じる） */}
      {selectedPlace && (
        <View style={[styles.pinCard, { bottom: bottomBase }]}>
          <View {...pinPanResponder.panHandlers}>
            <View style={styles.handle} />
          </View>
          <TouchableOpacity style={styles.pinCardClose} onPress={dismissSelectedPlace} activeOpacity={0.7} hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}>
            <View style={styles.pinCardCloseIcon}>
              <Text style={{ fontSize: 13, color: '#5f6368', fontWeight: '600' }}>✕</Text>
            </View>
          </TouchableOpacity>
          <View style={{ paddingHorizontal: 20, paddingBottom: 20 }}>
            <TypeBadge type={selectedPlace.type} />
            <Text style={styles.pinCardName} numberOfLines={2}>{selectedPlace.name}</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity onPress={() => openAppleMaps(selectedPlace)} style={styles.pinBtnPrimary} activeOpacity={0.8}>
                <Text style={styles.pinBtnPrimaryText}>ナビ開始</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => toggleFavorite(selectedPlace)}
                style={[styles.pinBtnSecondary, isFavorite(selectedPlace) && styles.pinBtnSecondaryActive]}
                activeOpacity={0.8}
              >
                <Text style={[styles.pinBtnSecondaryText, isFavorite(selectedPlace) && { color: '#1a73e8' }]}>
                  {isFavorite(selectedPlace) ? '★ 保存済み' : '☆ 保存'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* ボトムタブバー */}
      <View style={[styles.tabBar, { height: TAB_HEIGHT + insets.bottom, paddingBottom: insets.bottom }]}>
        {(['search', 'favorites'] as Tab[]).map(t => (
          <TouchableOpacity
            key={t}
            style={styles.tabItem}
            onPress={() => { setTab(t); setSelectedPlace(null); webViewRef.current?.injectJavaScript('clearHighlight(); true;'); }}
            activeOpacity={0.8}
          >
            <View style={[styles.tabIconWrap, tab === t && styles.tabIconWrapActive]}>
              <Text style={[styles.tabIcon, tab === t && styles.tabIconActive]}>
                {t === 'search' ? '◎' : '★'}
              </Text>
            </View>
            <Text style={[styles.tabLabel, tab === t && styles.tabLabelActive]}>
              {t === 'search' ? 'スポット' : '保存済み'}
              {t === 'favorites' && favorites.length > 0 ? `  ${favorites.length}` : ''}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#e8eaed' },
  mapPlaceholder: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, backgroundColor: '#e8eaed' },
  mapPlaceholderText: { color: '#5f6368', fontSize: 15 },

  topOverlay: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 12, paddingTop: 8, gap: 8 },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderRadius: 28, paddingLeft: 14, paddingRight: 6, paddingVertical: 6,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 8, elevation: 5, gap: 8,
  },
  modeToggle: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: '#e8f0fe' },
  modeToggleText: { fontSize: 13, fontWeight: '700', color: '#1a73e8' },
  modeDivider: { width: 1, height: 20, backgroundColor: '#e8eaed' },
  searchInput: { flex: 1, fontSize: 15, color: '#1c1c1e', paddingVertical: 6 },
  clearBtn: { padding: 6, justifyContent: 'center', alignItems: 'center' },
  clearBtnText: { fontSize: 13, color: '#9aa0a6', fontWeight: '600' },
  searchBtn: { backgroundColor: '#1a73e8', borderRadius: 22, paddingHorizontal: 18, paddingVertical: 9 },
  searchBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  chipsContent: { flexDirection: 'row', gap: 8, paddingVertical: 2 },
  chip: {
    backgroundColor: '#fff', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1, borderColor: 'transparent',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.10, shadowRadius: 3, elevation: 2,
  },
  chipLocked: { opacity: 0.75 },
  chipText: { fontSize: 13, color: '#3c4043', fontWeight: '500' },
  chipTextActive: { color: '#fff', fontWeight: '700' },

  bottomSheet: {
    position: 'absolute', left: 0, right: 0, backgroundColor: '#fff',
    borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: -3 }, shadowOpacity: 0.10, shadowRadius: 10, elevation: 8,
  },
  handleArea: { paddingTop: 10, paddingBottom: 6, paddingHorizontal: 16, alignItems: 'center', gap: 6 },
  handle: { width: 36, height: 4, backgroundColor: '#dadce0', borderRadius: 2, alignSelf: 'center', marginVertical: 4 },
  resultCount: { fontSize: 12, color: '#5f6368', fontWeight: '500' },

  loadingContainer: { paddingVertical: 40, alignItems: 'center', gap: 12 },
  loadingText: { fontSize: 14, color: '#5f6368' },

  emptyState: { paddingVertical: 40, alignItems: 'center', gap: 8 },
  emptyStateIcon: { fontSize: 32, color: '#dadce0' },
  emptyStateText: { fontSize: 15, color: '#3c4043', fontWeight: '600' },
  emptyStateSub: { fontSize: 13, color: '#9aa0a6', textAlign: 'center', paddingHorizontal: 20 },
  retryBtn: { marginTop: 8, backgroundColor: '#1a73e8', borderRadius: 20, paddingHorizontal: 24, paddingVertical: 10 },
  retryBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  placeCard: {
    borderLeftWidth: 3, borderLeftColor: '#dadce0', paddingLeft: 12, marginBottom: 4,
    backgroundColor: '#fff', borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#f1f3f4', overflow: 'hidden',
  },
  placeCardHeader: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingRight: 12, gap: 8 },
  placeName: { fontSize: 14, color: '#1c1c1e', fontWeight: '500', lineHeight: 20 },
  chevron: { fontSize: 11, color: '#9aa0a6' },
  placeCardActions: { paddingBottom: 12, paddingRight: 12, gap: 8 },
  actionBtnPrimary: { backgroundColor: '#1a73e8', borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  actionBtnPrimaryText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  actionBtnOutline: { borderWidth: 1, borderColor: '#dadce0', borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  actionBtnOutlineActive: { borderColor: '#1a73e8', backgroundColor: '#e8f0fe' },
  actionBtnOutlineText: { color: '#3c4043', fontSize: 14 },

  pinCard: {
    position: 'absolute', left: 0, right: 0, backgroundColor: '#fff',
    borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.12, shadowRadius: 12, elevation: 12,
  },
  pinCardClose: { position: 'absolute', top: 16, right: 16, zIndex: 1 },
  pinCardCloseIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#f1f3f4', justifyContent: 'center', alignItems: 'center' },
  pinCardName: { fontSize: 18, fontWeight: '600', color: '#1c1c1e', marginTop: 8, marginBottom: 16, paddingRight: 36 },
  pinBtnPrimary: { flex: 1, backgroundColor: '#1a73e8', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  pinBtnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  pinBtnSecondary: { flex: 1, borderWidth: 1, borderColor: '#dadce0', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  pinBtnSecondaryActive: { borderColor: '#1a73e8', backgroundColor: '#e8f0fe' },
  pinBtnSecondaryText: { color: '#3c4043', fontSize: 14 },

  tabBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row',
    backgroundColor: '#fff', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e8eaed', paddingTop: 6,
  },
  tabItem: { flex: 1, alignItems: 'center', gap: 2 },
  tabIconWrap: { width: 48, height: 28, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  tabIconWrapActive: { backgroundColor: '#e8f0fe' },
  tabIcon: { fontSize: 18, color: '#9aa0a6' },
  tabIconActive: { color: '#1a73e8' },
  tabLabel: { fontSize: 11, color: '#9aa0a6' },
  tabLabelActive: { color: '#1a73e8', fontWeight: '600' },
});
