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
  SafeAreaView,
  Linking,
  Dimensions,
} from 'react-native';

const PANEL_HEIGHT = Dimensions.get('window').height * 0.5;
const LIST_HEIGHT = PANEL_HEIGHT - 200;
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';

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
      type: el.tags.tourism || el.tags.leisure || el.tags.amenity || 'スポット',
    }));
}

function buildMapHtml(userLat: number, userLon: number, radiusKm: number, places: Place[]): string {
  const markers = places
    .map((p) => `L.marker([${p.lat},${p.lon}]).addTo(map).bindPopup("<b>${p.name.replace(/"/g, '&quot;').replace(/</g, '&lt;')}</b>")`)
    .join(';\n');
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
  var map = L.map('map').setView([${userLat},${userLon}],11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap'}).addTo(map);
  L.circleMarker([${userLat},${userLon}],{radius:8,color:'#007AFF',fillColor:'#007AFF',fillOpacity:1}).addTo(map).bindPopup('現在地');
  ${radiusKm > 0 ? `L.circle([${userLat},${userLon}],{radius:${radiusKm * 1000},color:'#007AFF',fillColor:'#007AFF',fillOpacity:0.08}).addTo(map);` : ''}
  ${markers}
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

function PlaceRow({
  place,
  isFavorite,
  onToggleFavorite,
}: {
  place: Place;
  isFavorite: boolean;
  onToggleFavorite: (place: Place) => void;
}) {
  return (
    <View style={{ paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e5e5ea' }}>
      <Text style={{ fontSize: 11, color: '#007AFF', marginBottom: 2 }}>{TYPE_LABEL[place.type] || place.type}</Text>
      <Text style={{ fontSize: 15, color: '#1c1c1e', marginBottom: 8 }} numberOfLines={2}>{place.name}</Text>
      <TouchableOpacity
        onPress={() => openAppleMaps(place)}
        style={{ backgroundColor: '#34C759', borderRadius: 8, paddingVertical: 8, alignItems: 'center', marginBottom: 6 }}
      >
        <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>ナビ開始</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => onToggleFavorite(place)}
        style={{ borderWidth: 1, borderColor: '#007AFF', borderRadius: 8, paddingVertical: 8, alignItems: 'center' }}
      >
        <Text style={{ fontSize: 13, color: '#007AFF' }}>{isFavorite ? '★ 保存済み' : '☆ お気に入り'}</Text>
      </TouchableOpacity>
    </View>
  );
}


export default function App() {
  const [tab, setTab] = useState<Tab>('search');
  const [mode, setMode] = useState<SearchMode>('distance');
  const [inputValue, setInputValue] = useState('');
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [allPlaces, setAllPlaces] = useState<Place[]>([]);
  const [activeFilters, setActiveFilters] = useState<PlaceType[]>([...ALL_TYPES]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [radiusKm, setRadiusKm] = useState(0);
  const [favorites, setFavorites] = useState<Place[]>([]);
  const webViewRef = useRef<WebView>(null);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { Alert.alert('位置情報', '位置情報の許可が必要です'); return; }
      const loc = await Location.getCurrentPositionAsync({});
      setUserLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
    })();
  }, []);

  function toggleFavorite(place: Place) {
    const exists = favorites.some((f) => f.id === place.id);
    if (exists) {
      setFavorites((prev) => prev.filter((f) => f.id !== place.id));
      Alert.alert('削除しました', place.name);
    } else {
      setFavorites((prev) => [...prev, place]);
      Alert.alert('追加しました', place.name);
    }
  }

  function isFavorite(place: Place) {
    return favorites.some((f) => f.id === place.id);
  }

  function toggleFilter(type: PlaceType) {
    setActiveFilters((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  }

  const filteredPlaces = allPlaces.filter((p) => activeFilters.includes(p.type as PlaceType));

  async function handleSearch() {
    if (!userLocation) { Alert.alert('エラー', '現在地を取得中です。しばらくお待ちください。'); return; }
    const val = parseFloat(inputValue);
    if (isNaN(val) || val <= 0) { Alert.alert('エラー', `${mode === 'distance' ? '距離(km)' : '時間(分)'}を正しく入力してください`); return; }
    const km = mode === 'distance' ? val : timeToDistance(val);
    setRadiusKm(km);
    setLoading(true);
    setSearched(false);
    try {
      const results = await fetchNearbyPlaces(userLocation.latitude, userLocation.longitude, km, [...ALL_TYPES]);
      setAllPlaces(results);
      setSearched(true);
    } catch {
      Alert.alert('エラー', '検索に失敗しました。ネットワークを確認してください。');
    } finally {
      setLoading(false);
    }
  }

  const mapHtml = userLocation
    ? buildMapHtml(userLocation.latitude, userLocation.longitude, radiusKm, filteredPlaces)
    : null;

  return (
    <SafeAreaView style={styles.container}>
      {/* 地図 */}
      {mapHtml ? (
        <WebView ref={webViewRef} style={styles.map} source={{ html: mapHtml }} originWhitelist={['*']} />
      ) : (
        <View style={styles.mapPlaceholder}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.mapPlaceholderText}>現在地を取得中...</Text>
        </View>
      )}

      {/* パネル */}
      <View style={styles.panel}>
        {/* タブ */}
        <View style={styles.modeRow}>
          <TouchableOpacity style={[styles.modeBtn, tab === 'search' && styles.modeBtnActive]} onPress={() => setTab('search')}>
            <Text style={[styles.modeBtnText, tab === 'search' && styles.modeBtnTextActive]}>検索</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.modeBtn, tab === 'favorites' && styles.modeBtnActive]} onPress={() => setTab('favorites')}>
            <Text style={[styles.modeBtnText, tab === 'favorites' && styles.modeBtnTextActive]}>お気に入り ★</Text>
          </TouchableOpacity>
        </View>

        {tab === 'search' ? (
          <>
            {/* 距離/時間モード */}
            <View style={styles.subModeRow}>
              <TouchableOpacity style={[styles.subModeBtn, mode === 'distance' && styles.subModeBtnActive]} onPress={() => { setMode('distance'); setInputValue(''); }}>
                <Text style={[styles.subModeBtnText, mode === 'distance' && styles.subModeBtnTextActive]}>距離 (km)</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.subModeBtn, mode === 'time' && styles.subModeBtnActive]} onPress={() => { setMode('time'); setInputValue(''); }}>
                <Text style={[styles.subModeBtnText, mode === 'time' && styles.subModeBtnTextActive]}>時間 (分)</Text>
              </TouchableOpacity>
            </View>

            {/* 入力 */}
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                placeholder={mode === 'distance' ? '例: 30' : '例: 60'}
                keyboardType="numeric"
                value={inputValue}
                onChangeText={setInputValue}
                returnKeyType="search"
                onSubmitEditing={handleSearch}
              />
              <TouchableOpacity style={styles.searchBtn} onPress={handleSearch} disabled={loading}>
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.searchBtnText}>検索</Text>}
              </TouchableOpacity>
            </View>

            {/* フィルター */}
            {searched && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow} contentContainerStyle={{ flexDirection: 'row', gap: 6, paddingVertical: 0 }}>
                {ALL_TYPES.map((type) => (
                  <TouchableOpacity
                    key={type}
                    style={[styles.filterChip, activeFilters.includes(type) && styles.filterChipActive]}
                    onPress={() => toggleFilter(type)}
                  >
                    <Text style={[styles.filterChipText, activeFilters.includes(type) && styles.filterChipTextActive]}>
                      {TYPE_LABEL[type]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            {/* 結果リスト */}
            {searched && (
              <View style={styles.resultContainer}>
                <ScrollView style={styles.list} keyboardShouldPersistTaps="always">
                  {filteredPlaces.map((place) => <PlaceRow key={place.id} place={place} isFavorite={isFavorite(place)} onToggleFavorite={toggleFavorite} />)}
                </ScrollView>
              </View>
            )}
          </>
        ) : (
          <View style={styles.resultContainer}>
            <Text style={styles.resultCount}>
              {favorites.length > 0 ? `${favorites.length}件` : 'お気に入りはまだありません'}
            </Text>
            <ScrollView style={styles.list}>
              {favorites.map((place) => <PlaceRow key={place.id} place={place} isFavorite={isFavorite(place)} onToggleFavorite={toggleFavorite} />)}
            </ScrollView>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f2f2f7' },
  map: { flex: 1 },
  mapPlaceholder: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  mapPlaceholderText: { color: '#8e8e93', fontSize: 15 },
  panel: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 8,
    height: PANEL_HEIGHT,
  },
  modeRow: { flexDirection: 'row', marginBottom: 6, backgroundColor: '#f2f2f7', borderRadius: 10, padding: 4 },
  modeBtn: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
  modeBtnActive: { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4, elevation: 2 },
  modeBtnText: { fontSize: 14, color: '#8e8e93', fontWeight: '600' },
  modeBtnTextActive: { color: '#007AFF' },
  subModeRow: { flexDirection: 'row', marginBottom: 6, gap: 8 },
  subModeBtn: { flex: 1, paddingVertical: 7, alignItems: 'center', borderRadius: 8, borderWidth: 1, borderColor: '#e5e5ea' },
  subModeBtnActive: { borderColor: '#007AFF', backgroundColor: '#e8f0fe' },
  subModeBtnText: { fontSize: 13, color: '#8e8e93', fontWeight: '600' },
  subModeBtnTextActive: { color: '#007AFF' },
  inputRow: { flexDirection: 'row', gap: 10, marginBottom: 6 },
  input: { flex: 1, backgroundColor: '#f2f2f7', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, fontSize: 16 },
  searchBtn: { backgroundColor: '#007AFF', borderRadius: 10, paddingHorizontal: 20, justifyContent: 'center', alignItems: 'center' },
  searchBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  filterRow: { marginBottom: 0, height: 28 },
  filterChip: { height: 28, paddingHorizontal: 10, justifyContent: 'center', alignItems: 'center', borderRadius: 20, borderWidth: 1, borderColor: '#e5e5ea', backgroundColor: '#fff' },
  filterChipActive: { backgroundColor: '#007AFF', borderColor: '#007AFF' },
  filterChipText: { fontSize: 11, color: '#8e8e93' },
  filterChipTextActive: { color: '#fff', fontWeight: '600' },
  resultContainer: { height: LIST_HEIGHT },
  resultCount: { fontSize: 13, color: '#8e8e93', marginBottom: 6 },
  list: { height: LIST_HEIGHT },
  listItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e5e5ea', gap: 8 },
  listItemType: { fontSize: 11, color: '#007AFF', backgroundColor: '#e8f0fe', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
  listItemName: { flex: 1, fontSize: 14, color: '#1c1c1e' },
  iconBtn: { padding: 4 },
  naviBtn: { backgroundColor: '#34C759', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  naviBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
