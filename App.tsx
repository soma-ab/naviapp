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

const ALL_TYPES = ['drive_food', 'shopping', 'roadside_station', 'scenic', 'park', 'activity'] as const;
type PlaceType = typeof ALL_TYPES[number];

const TYPE_LABEL: Record<string, string> = {
  drive_food: '\u30b0\u30eb\u30e1',
  shopping: '\u8cb7\u3044\u7269',
  roadside_station: '\u9053\u306e\u99c5',
  scenic: '\u7d76\u666f',
  park: '\u516c\u5712',
  activity: '\u4f53\u9a13',
};

const TYPE_COLOR: Record<string, string> = {
  drive_food: '#E53935',
  shopping: '#5C6BC0',
  roadside_station: '#00897B',
  scenic: '#7E57C2',
  park: '#43A047',
  activity: '#FB8C00',
};

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const OVERPASS_QUERY_TIMEOUT_SECONDS = 4;
const OVERPASS_FETCH_TIMEOUT_MS = 2500;
const SEARCH_TIMEOUT_MS = 10000;
const MAX_OVERPASS_RADIUS_M = 80000;
const MIN_RESULTS_FOR_FAST_RETURN = 12;
const DISTANCE_TOLERANCE_KM = 10;
const TIME_TOLERANCE_MINUTES = 30;

interface Place {
  id: string;
  name: string;
  lat: number;
  lon: number;
  type: string;
}

interface PlaceSearchResult {
  places: Place[];
  rawCount: number;
  namedCount: number;
  classifiedCount: number;
  fallbackUsed: boolean;
  errors: string[];
}

interface OverpassResult {
  elements: any[];
  errors: string[];
}

interface UserLocation {
  latitude: number;
  longitude: number;
}

function timeToDistance(minutes: number): number {
  return (minutes / 60) * 60;
}

const DRIVE_FOOD_NAME_PARTS = [
  '\u5c71\u5ca1\u5bb6',
  '\u3055\u308f\u3084\u304b',
  '\u30b9\u30bf\u30fc\u30d0\u30c3\u30af\u30b9',
  '\u30b9\u30bf\u30d0',
  'starbucks',
  '\u30b3\u30e1\u30c0',
  '\u30b3\u30e1\u30c0\u73c8\u7432',
  '\u30e9\u30fc\u30e1\u30f3\u30b7\u30e7\u30c3\u30d7',
  '\u30c9\u30e9\u30a4\u30d6\u30a4\u30f3',
];

const SHOPPING_NAME_PARTS = [
  '\u30a2\u30a6\u30c8\u30ec\u30c3\u30c8',
  'outlet',
  '\u30e2\u30fc\u30eb',
  'mall',
  '\u30a4\u30aa\u30f3\u30e2\u30fc\u30eb',
  '\u30b3\u30b9\u30c8\u30b3',
  'costco',
];

const ROADSIDE_NAME_PARTS = ['\u9053\u306e\u99c5', 'michi-no-eki', 'michi no eki'];

const SCENIC_NAME_PARTS = [
  '\u5c55\u671b',
  '\u5c55\u671b\u53f0',
  '\u30d3\u30e5\u30fc\u30dd\u30a4\u30f3\u30c8',
  '\u5cac',
  '\u706f\u53f0',
  '\u6d77\u5cb8',
  '\u30d3\u30fc\u30c1',
  '\u6e56',
  '\u6e13\u8c37',
  '\u6edd',
  '\u5bcc\u58eb',
  '\u6e29\u6cc9',
  '\u6e2f',
  '\u6d77\u307b\u305f\u308b',
  '\u6e58\u5357',
];

const PARK_NAME_PARTS = [
  '\u6d77\u6d5c\u516c\u5712',
  '\u56fd\u55b6',
  '\u81ea\u7136\u516c\u5712',
  '\u5ead\u5712',
  '\u5927\u516c\u5712',
  '\u516c\u5712',
];

const ACTIVITY_NAME_PARTS = [
  '\u6c34\u65cf\u9928',
  '\u52d5\u7269\u5712',
  '\u7267\u5834',
  '\u30c6\u30fc\u30de\u30d1\u30fc\u30af',
  '\u904a\u5712\u5730',
  '\u30ad\u30e3\u30f3\u30d7',
  '\u30de\u30ea\u30f3\u30d1\u30fc\u30af',
];

const FOOD_AMENITIES = ['restaurant', 'cafe', 'fast_food'];

const CURATED_DRIVE_PLACES: Place[] = [
  { id: 'curated-kisarazu-outlet', name: '\u4e09\u4e95\u30a2\u30a6\u30c8\u30ec\u30c3\u30c8\u30d1\u30fc\u30af \u6728\u66f4\u6d25', lat: 35.4357, lon: 139.9331, type: 'shopping' },
  { id: 'curated-hitachinaka-seaside', name: '\u56fd\u55b6\u3072\u305f\u3061\u6d77\u6d5c\u516c\u5712', lat: 36.4026, lon: 140.5963, type: 'park' },
  { id: 'curated-shonan-enoshima', name: '\u6e58\u5357\u30fb\u6c5f\u306e\u5cf6', lat: 35.3002, lon: 139.4803, type: 'scenic' },
  { id: 'curated-umihotaru', name: '\u6d77\u307b\u305f\u308bPA', lat: 35.4646, lon: 139.8755, type: 'scenic' },
  { id: 'curated-yokohama-hakkeijima', name: '\u6a2a\u6d5c\u30fb\u516b\u666f\u5cf6\u30b7\u30fc\u30d1\u30e9\u30c0\u30a4\u30b9', lat: 35.3372, lon: 139.6469, type: 'activity' },
  { id: 'curated-kamakura-tsurugaoka', name: '\u938c\u5009\u30fb\u9db4\u5ca1\u516b\u5e61\u5bae', lat: 35.3260, lon: 139.5565, type: 'activity' },
  { id: 'curated-fujikawaguchiko', name: '\u6cb3\u53e3\u6e56', lat: 35.5171, lon: 138.7518, type: 'scenic' },
  { id: 'curated-hakone', name: '\u7bb1\u6839\u30fb\u82a6\u30ce\u6e56', lat: 35.2048, lon: 139.0256, type: 'scenic' },
  { id: 'curated-sawadaira-sawayaka-gotemba', name: '\u3055\u308f\u3084\u304b \u5fa1\u6bbf\u5834\u30a4\u30f3\u30bf\u30fc\u5e97', lat: 35.3009, lon: 138.9344, type: 'drive_food' },
  { id: 'curated-yamaokaya-kashiwa', name: '\u30e9\u30fc\u30e1\u30f3\u5c71\u5ca1\u5bb6 \u67cf\u5e97', lat: 35.8827, lon: 139.9755, type: 'drive_food' },
  { id: 'curated-starbucks-kawagoe', name: '\u30b9\u30bf\u30fc\u30d0\u30c3\u30af\u30b9 \u5ddd\u8d8a\u9418\u3064\u304d\u901a\u308a\u5e97', lat: 35.9227, lon: 139.4834, type: 'drive_food' },
  { id: 'curated-tokyo-tower', name: '\u6771\u4eac\u30bf\u30ef\u30fc', lat: 35.6586, lon: 139.7454, type: 'activity' },
  { id: 'curated-tokyo-skytree', name: '\u6771\u4eac\u30b9\u30ab\u30a4\u30c4\u30ea\u30fc', lat: 35.7101, lon: 139.8107, type: 'activity' },
  { id: 'curated-ueno-park', name: '\u4e0a\u91ce\u6069\u8cdc\u516c\u5712', lat: 35.7156, lon: 139.7745, type: 'park' },
  { id: 'curated-shinjuku-gyoen', name: '\u65b0\u5bbf\u5fa1\u82d1', lat: 35.6852, lon: 139.7100, type: 'park' },
  { id: 'curated-kasai-rinkai', name: '\u845b\u897f\u81e8\u6d77\u516c\u5712', lat: 35.6434, lon: 139.8617, type: 'park' },
  { id: 'curated-odaiba', name: '\u304a\u53f0\u5834\u6d77\u6d5c\u516c\u5712', lat: 35.6298, lon: 139.7775, type: 'scenic' },
  { id: 'curated-toyosu-market', name: '\u8c4a\u6d32\u5e02\u5834', lat: 35.6457, lon: 139.7845, type: 'drive_food' },
  { id: 'curated-tsukiji', name: '\u7bc9\u5730\u5834\u5916\u5e02\u5834', lat: 35.6655, lon: 139.7707, type: 'drive_food' },
  { id: 'curated-minatomirai', name: '\u6a2a\u6d5c\u30fb\u307f\u306a\u3068\u307f\u3089\u3044', lat: 35.4570, lon: 139.6329, type: 'scenic' },
  { id: 'curated-yokohama-redbrick', name: '\u6a2a\u6d5c\u8d64\u30ec\u30f3\u30ac\u5009\u5eab', lat: 35.4526, lon: 139.6428, type: 'shopping' },
  { id: 'curated-yamashita-park', name: '\u5c71\u4e0b\u516c\u5712', lat: 35.4457, lon: 139.6505, type: 'park' },
  { id: 'curated-lalaport-tokyo-bay', name: '\u3089\u3089\u307d\u30fc\u3068TOKYO-BAY', lat: 35.6867, lon: 139.9904, type: 'shopping' },
  { id: 'curated-aeon-laketown', name: '\u30a4\u30aa\u30f3\u30ec\u30a4\u30af\u30bf\u30a6\u30f3', lat: 35.8763, lon: 139.8242, type: 'shopping' },
  { id: 'curated-mitsui-iruma', name: '\u4e09\u4e95\u30a2\u30a6\u30c8\u30ec\u30c3\u30c8\u30d1\u30fc\u30af \u5165\u9593', lat: 35.8127, lon: 139.3790, type: 'shopping' },
  { id: 'curated-showa-kinen', name: '\u56fd\u55b6\u662d\u548c\u8a18\u5ff5\u516c\u5712', lat: 35.7031, lon: 139.3947, type: 'park' },
  { id: 'curated-yomiuriland', name: '\u3088\u307f\u3046\u308a\u30e9\u30f3\u30c9', lat: 35.6249, lon: 139.5170, type: 'activity' },
  { id: 'curated-sanrio-puroland', name: '\u30b5\u30f3\u30ea\u30aa\u30d4\u30e5\u30fc\u30ed\u30e9\u30f3\u30c9', lat: 35.6247, lon: 139.4294, type: 'activity' },
  { id: 'curated-makuhari', name: '\u5e55\u5f35\u30e1\u30c3\u30bb', lat: 35.6474, lon: 140.0353, type: 'activity' },
  { id: 'curated-chiba-port-tower', name: '\u5343\u8449\u30dd\u30fc\u30c8\u30bf\u30ef\u30fc', lat: 35.6004, lon: 140.0963, type: 'scenic' },
  { id: 'curated-costco-kawasaki', name: '\u30b3\u30b9\u30c8\u30b3 \u5ddd\u5d0e\u5009\u5eab\u5e97', lat: 35.5150, lon: 139.7400, type: 'shopping' },
  { id: 'curated-okutama-lake', name: '奥多摩湖', lat: 35.7885, lon: 139.0508, type: 'scenic' },
  { id: 'curated-mt-takao', name: '高尾山', lat: 35.6252, lon: 139.2437, type: 'scenic' },
  { id: 'curated-akigawa-valley', name: '秋川渓谷', lat: 35.7247, lon: 139.2193, type: 'scenic' },
  { id: 'curated-hinohara-tomin-no-mori', name: '東京都檜原都民の森', lat: 35.7383, lon: 139.0269, type: 'park' },
  { id: 'curated-jindai-botanical', name: '神代植物公園', lat: 35.6717, lon: 139.5489, type: 'park' },
  { id: 'curated-owakudani', name: '大涌谷', lat: 35.2441, lon: 139.0189, type: 'scenic' },
  { id: 'curated-hakone-shrine', name: '箱根神社', lat: 35.2047, lon: 139.0258, type: 'activity' },
  { id: 'curated-hakone-sekisho', name: '箱根関所', lat: 35.1924, lon: 139.0265, type: 'activity' },
  { id: 'curated-jogashima-park', name: '城ヶ島公園', lat: 35.1350, lon: 139.6162, type: 'scenic' },
  { id: 'curated-soleil-hill', name: '長井海の手公園 ソレイユの丘', lat: 35.2094, lon: 139.6085, type: 'park' },
  { id: 'curated-miyagase-dam', name: '宮ヶ瀬ダム', lat: 35.5394, lon: 139.2486, type: 'scenic' },
  { id: 'curated-sagamiko-pleasure-forest', name: 'さがみ湖MORI MORI', lat: 35.6031, lon: 139.1918, type: 'activity' },
  { id: 'curated-odawara-castle', name: '小田原城', lat: 35.2509, lon: 139.1535, type: 'activity' },
  { id: 'curated-lake-tanzawa', name: '丹沢湖', lat: 35.4130, lon: 139.0470, type: 'scenic' },
  { id: 'curated-nokogiriyama', name: '鋸山 日本寺', lat: 35.1606, lon: 139.8375, type: 'scenic' },
  { id: 'curated-mother-farm', name: 'マザー牧場', lat: 35.2472, lon: 139.9168, type: 'activity' },
  { id: 'curated-tokyo-german-village', name: '東京ドイツ村', lat: 35.4034, lon: 140.0603, type: 'activity' },
  { id: 'curated-kamogawa-seaworld', name: '鴨川シーワールド', lat: 35.1173, lon: 140.1200, type: 'activity' },
  { id: 'curated-yoro-valley', name: '養老渓谷', lat: 35.2508, lon: 140.1597, type: 'scenic' },
  { id: 'curated-nojimazaki-lighthouse', name: '野島埼灯台', lat: 34.9010, lon: 139.8886, type: 'scenic' },
  { id: 'curated-inubosaki-lighthouse', name: '犬吠埼灯台', lat: 35.7077, lon: 140.8685, type: 'scenic' },
  { id: 'curated-kujukuri-beach', name: '九十九里浜', lat: 35.5310, lon: 140.4510, type: 'scenic' },
  { id: 'curated-michi-tomiura-biwa', name: '道の駅 とみうら枇杷倶楽部', lat: 35.0395, lon: 139.8423, type: 'roadside_station' },
  { id: 'curated-michi-hota-shogakko', name: '道の駅 保田小学校', lat: 35.1137, lon: 139.8388, type: 'roadside_station' },
  { id: 'curated-michi-kisarazu-umakuta', name: '道の駅 木更津うまくたの里', lat: 35.3714, lon: 140.0646, type: 'roadside_station' },
  { id: 'curated-michi-tako', name: '道の駅 多古', lat: 35.7449, lon: 140.4564, type: 'roadside_station' },
  { id: 'curated-michi-shonan-kashiwa', name: '道の駅 しょうなん', lat: 35.8628, lon: 140.0155, type: 'roadside_station' },
  { id: 'curated-nagatoro-iwadatami', name: '長瀞岩畳', lat: 36.0949, lon: 139.1113, type: 'scenic' },
  { id: 'curated-hitsujiyama-park', name: '羊山公園', lat: 35.9907, lon: 139.0829, type: 'park' },
  { id: 'curated-mitsumine-shrine', name: '三峯神社', lat: 35.9257, lon: 138.9306, type: 'activity' },
  { id: 'curated-chichibu-muse-park', name: '秩父ミューズパーク', lat: 35.9900, lon: 139.0550, type: 'park' },
  { id: 'curated-kinchakuda', name: '巾着田曼珠沙華公園', lat: 35.8837, lon: 139.3049, type: 'scenic' },
  { id: 'curated-moominvalley-park', name: 'ムーミンバレーパーク', lat: 35.8717, lon: 139.3270, type: 'activity' },
  { id: 'curated-michi-hanazono', name: '道の駅 はなぞの', lat: 36.1416, lon: 139.2380, type: 'roadside_station' },
  { id: 'curated-oarai-isosaki', name: '大洗磯前神社', lat: 36.3159, lon: 140.5948, type: 'scenic' },
  { id: 'curated-fukuroda-falls', name: '袋田の滝', lat: 36.7630, lon: 140.4070, type: 'scenic' },
  { id: 'curated-ryujin-bridge', name: '竜神大吊橋', lat: 36.7002, lon: 140.4905, type: 'scenic' },
  { id: 'curated-aquaworld-oarai', name: 'アクアワールド茨城県大洗水族館', lat: 36.3336, lon: 140.5905, type: 'activity' },
  { id: 'curated-mt-tsukuba', name: '筑波山', lat: 36.2252, lon: 140.1062, type: 'scenic' },
  { id: 'curated-kasama-inari', name: '笠間稲荷神社', lat: 36.3868, lon: 140.2525, type: 'activity' },
  { id: 'curated-michi-hitachi-osakana', name: '道の駅 日立おさかなセンター', lat: 36.4919, lon: 140.6134, type: 'roadside_station' },
  { id: 'curated-michi-gran-terrace-chikusei', name: '道の駅 グランテラス筑西', lat: 36.3030, lon: 139.9940, type: 'roadside_station' },
  { id: 'curated-nikko-toshogu', name: '日光東照宮', lat: 36.7581, lon: 139.5989, type: 'activity' },
  { id: 'curated-lake-chuzenji', name: '中禅寺湖', lat: 36.7394, lon: 139.4913, type: 'scenic' },
  { id: 'curated-kegon-falls', name: '華厳の滝', lat: 36.7381, lon: 139.5009, type: 'scenic' },
  { id: 'curated-nasu-highland-park', name: '那須ハイランドパーク', lat: 37.0769, lon: 139.9805, type: 'activity' },
  { id: 'curated-nasu-animal-kingdom', name: '那須どうぶつ王国', lat: 37.1284, lon: 140.0148, type: 'activity' },
  { id: 'curated-ashikaga-flower-park', name: 'あしかがフラワーパーク', lat: 36.3140, lon: 139.5222, type: 'park' },
  { id: 'curated-michi-romantic-village', name: '道の駅 うつのみや ろまんちっく村', lat: 36.6199, lon: 139.8410, type: 'roadside_station' },
  { id: 'curated-michi-motegi', name: '道の駅 もてぎ', lat: 36.5322, lon: 140.1843, type: 'roadside_station' },
  { id: 'curated-oya-history-museum', name: '大谷資料館', lat: 36.5969, lon: 139.8213, type: 'activity' },
  { id: 'curated-kusatsu-yubatake', name: '草津温泉 湯畑', lat: 36.6227, lon: 138.5960, type: 'scenic' },
  { id: 'curated-ikaho-steps', name: '伊香保温泉 石段街', lat: 36.4989, lon: 138.9185, type: 'scenic' },
  { id: 'curated-lake-haruna', name: '榛名湖', lat: 36.4761, lon: 138.8745, type: 'scenic' },
  { id: 'curated-tomioka-silk-mill', name: '富岡製糸場', lat: 36.2551, lon: 138.8878, type: 'activity' },
  { id: 'curated-gunma-safari', name: '群馬サファリパーク', lat: 36.2505, lon: 138.8364, type: 'activity' },
  { id: 'curated-michi-kawaba', name: '道の駅 川場田園プラザ', lat: 36.6944, lon: 139.1062, type: 'roadside_station' },
  { id: 'curated-michi-agatsumakyo', name: '道の駅 あがつま峡', lat: 36.5573, lon: 138.7470, type: 'roadside_station' },
  { id: 'curated-akagi-onuma', name: '赤城大沼', lat: 36.5482, lon: 139.1809, type: 'scenic' },
  { id: 'curated-tanigawadake-ropeway', name: '谷川岳ロープウェイ', lat: 36.8379, lon: 138.9686, type: 'activity' },
  { id: 'curated-lake-yamanaka', name: '山中湖', lat: 35.4106, lon: 138.8604, type: 'scenic' },
  { id: 'curated-lake-saiko', name: '西湖', lat: 35.5004, lon: 138.6829, type: 'scenic' },
  { id: 'curated-hottarakashi-onsen', name: 'ほったらかし温泉', lat: 35.7019, lon: 138.6875, type: 'scenic' },
  { id: 'curated-shosenkyo', name: '昇仙峡', lat: 35.7506, lon: 138.5651, type: 'scenic' },
  { id: 'curated-fuji-q', name: '富士急ハイランド', lat: 35.4875, lon: 138.7808, type: 'activity' },
  { id: 'curated-michi-fujiyoshida', name: '道の駅 富士吉田', lat: 35.4710, lon: 138.7860, type: 'roadside_station' },
  { id: 'curated-michi-doshi', name: '道の駅 どうし', lat: 35.5281, lon: 139.0356, type: 'roadside_station' },
  { id: 'curated-michi-narusawa', name: '道の駅 なるさわ', lat: 35.4770, lon: 138.6916, type: 'roadside_station' },
  { id: 'curated-fuefukigawa-fruit-park', name: '笛吹川フルーツ公園', lat: 35.7011, lon: 138.6826, type: 'park' },
  { id: 'curated-oshino-hakkai', name: '忍野八海', lat: 35.4600, lon: 138.8329, type: 'scenic' },
];

function hasNamePart(name: string, parts: string[]): boolean {
  const normalized = name.toLowerCase();
  return parts.some(part => normalized.includes(part.toLowerCase()));
}

function buildNameRegex(parts: string[]): string {
  return parts.join('|');
}

function addNwrQuery(parts: string[], selector: string, radiusM: number, lat: number, lon: number) {
  parts.push(`node${selector}(around:${radiusM},${lat},${lon});`);
  parts.push(`way${selector}(around:${radiusM},${lat},${lon});`);
  parts.push(`relation${selector}(around:${radiusM},${lat},${lon});`);
}

function addNodeQuery(parts: string[], selector: string, radiusM: number, lat: number, lon: number) {
  parts.push(`node${selector}(around:${radiusM},${lat},${lon});`);
}

async function fetchJsonWithTimeout(url: string, init?: RequestInit): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OVERPASS_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) throw new Error(String(res.status));
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchOverpassEndpoint(endpoint: string, query: string): Promise<OverpassResult> {
  const host = endpoint.replace('https://', '').split('/')[0];
  const errors: string[] = [];
  try {
    const json = await fetchJsonWithTimeout(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: `data=${encodeURIComponent(query)}`,
    });
    if (Array.isArray(json.elements)) {
      return json.elements.length > 0
        ? { elements: json.elements, errors: [] }
        : { elements: [], errors: [`${host} POST 0`] };
    }
    errors.push(`${host} POST invalid`);
  } catch (e: any) {
    errors.push(`${host} POST ${e?.name === 'AbortError' ? 'timeout' : e?.message || 'failed'}`);
  }

  try {
    const json = await fetchJsonWithTimeout(`${endpoint}?data=${encodeURIComponent(query)}`);
    if (Array.isArray(json.elements)) {
      return json.elements.length > 0
        ? { elements: json.elements, errors }
        : { elements: [], errors: [...errors, `${host} GET 0`] };
    }
    return { elements: [], errors: [...errors, `${host} GET invalid`] };
  } catch (e: any) {
    return { elements: [], errors: [...errors, `${host} GET ${e?.name === 'AbortError' ? 'timeout' : e?.message || 'failed'}`] };
  }
}

async function fetchOverpassElements(parts: string[], limit = 40): Promise<OverpassResult> {
  if (parts.length === 0) return { elements: [], errors: [] };
  const query = `[out:json][timeout:${OVERPASS_QUERY_TIMEOUT_SECONDS}];\n(\n${parts.join('\n')}\n);\nout center ${limit};`;
  const results = await Promise.all(OVERPASS_ENDPOINTS.map(endpoint => fetchOverpassEndpoint(endpoint, query)));
  const seen = new Set<string>();
  const elements = results
    .flatMap(result => result.elements)
    .filter(el => {
      const key = `${el.type || 'element'}:${el.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return { elements, errors: results.flatMap(result => result.errors) };
}

function getElementCenter(el: any): { lat: number; lon: number } | null {
  if (typeof el.lat === 'number' && typeof el.lon === 'number') return { lat: el.lat, lon: el.lon };
  if (typeof el.center?.lat === 'number' && typeof el.center?.lon === 'number') return { lat: el.center.lat, lon: el.center.lon };
  return null;
}

function getElementName(tags: Record<string, any> | undefined): string | null {
  if (!tags) return null;
  return tags.name || tags['name:ja'] || tags['name:en'] || tags.brand || tags['brand:ja'] || null;
}

function classifyDrivePlace(tags: Record<string, any>, name: string): PlaceType | null {
  if (hasNamePart(name, DRIVE_FOOD_NAME_PARTS)) return 'drive_food';
  if (FOOD_AMENITIES.includes(tags.amenity) && name.length >= 3) return 'drive_food';
  if (hasNamePart(name, SHOPPING_NAME_PARTS) || ['mall', 'department_store'].includes(tags.shop)) return 'shopping';
  if (hasNamePart(name, ROADSIDE_NAME_PARTS)) return 'roadside_station';
  if (
    tags.tourism === 'viewpoint' ||
    tags.natural === 'beach' ||
    tags.natural === 'cape' ||
    tags.natural === 'peak' ||
    tags.natural === 'hot_spring' ||
    hasNamePart(name, SCENIC_NAME_PARTS)
  ) return 'scenic';
  if (
    tags.leisure === 'park' ||
    tags.leisure === 'nature_reserve' ||
    tags.leisure === 'garden' ||
    tags.boundary === 'national_park' ||
    hasNamePart(name, PARK_NAME_PARTS)
  ) return 'park';
  if (
    ['theme_park', 'zoo', 'aquarium', 'attraction', 'museum'].includes(tags.tourism) ||
    ['water_park', 'marina'].includes(tags.leisure) ||
    hasNamePart(name, ACTIVITY_NAME_PARTS)
  ) return 'activity';
  return null;
}

function classifyFallbackPlace(tags: Record<string, any>, name: string): PlaceType | null {
  const strictType = classifyDrivePlace(tags, name);
  if (strictType) return strictType;
  if (tags.tourism === 'viewpoint' || ['beach', 'cape', 'peak', 'hot_spring'].includes(tags.natural)) return 'scenic';
  if (['park', 'nature_reserve', 'garden'].includes(tags.leisure) || tags.boundary === 'national_park') return 'park';
  if (['theme_park', 'zoo', 'aquarium', 'attraction', 'museum'].includes(tags.tourism)) return 'activity';
  if (['mall', 'department_store'].includes(tags.shop)) return 'shopping';
  if (FOOD_AMENITIES.includes(tags.amenity) && name.length >= 3) return 'drive_food';
  return null;
}

function drivePlaceScore(place: Place): number {
  const name = place.name;
  if (place.type === 'drive_food' && hasNamePart(name, DRIVE_FOOD_NAME_PARTS)) return 100;
  if (place.type === 'shopping' && hasNamePart(name, SHOPPING_NAME_PARTS)) return 95;
  if (place.type === 'roadside_station') return 92;
  if (place.type === 'scenic' && hasNamePart(name, SCENIC_NAME_PARTS)) return 88;
  if (place.type === 'park' && hasNamePart(name, ['\u6d77\u6d5c\u516c\u5712', '\u56fd\u55b6', '\u81ea\u7136\u516c\u5712'])) return 86;
  if (place.type === 'activity') return 84;
  return 70;
}

function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRad = (deg: number) => deg * Math.PI / 180;
  const earthKm = 6371;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return earthKm * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function curatedPlacesInRadius(lat: number, lon: number, radiusKm: number, types: PlaceType[]): Place[] {
  return CURATED_DRIVE_PLACES
    .filter(place => types.includes(place.type as PlaceType))
    .filter(place => distanceKm(lat, lon, place.lat, place.lon) <= radiusKm)
    .sort((a, b) => distanceKm(lat, lon, a.lat, a.lon) - distanceKm(lat, lon, b.lat, b.lon))
    .slice(0, 30);
}

function placesInTargetBand(places: Place[], lat: number, lon: number, targetKm: number, toleranceKm: number): Place[] {
  const minKm = Math.max(0, targetKm - toleranceKm);
  const maxKm = targetKm + toleranceKm;
  const filtered = places.filter(place => {
    const km = distanceKm(lat, lon, place.lat, place.lon);
    return km >= minKm && km <= maxKm;
  });
  return filtered.length > 0 ? filtered : places;
}

function elementsToPlaces(elements: any[], types: PlaceType[], fallback: boolean, seen = new Set<string>()): PlaceSearchResult {
  let namedCount = 0;
  let classifiedCount = 0;
  const places = elements
    .map((el): Place | null => {
      const name = getElementName(el.tags);
      const center = getElementCenter(el);
      if (!name || !center) return null;
      namedCount += 1;
      const type = fallback ? classifyFallbackPlace(el.tags, name) : classifyDrivePlace(el.tags, name);
      if (!type || !types.includes(type)) return null;
      classifiedCount += 1;
      const key = `${name}:${center.lat.toFixed(4)}:${center.lon.toFixed(4)}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return {
        id: `${el.type}-${el.id}`,
        name,
        lat: center.lat,
        lon: center.lon,
        type,
      };
    })
    .filter((place): place is Place => place !== null)
    .sort((a, b) => drivePlaceScore(b) - drivePlaceScore(a))
    .slice(0, 80);

  return {
    places,
    rawCount: elements.length,
    namedCount,
    classifiedCount,
    fallbackUsed: fallback,
    errors: [],
  };
}

function mergePlaces(lat: number, lon: number, targetKm: number, toleranceKm: number, ...placeLists: Place[][]): Place[] {
  const seen = new Set<string>();
  const merged = placeLists
    .flat()
    .filter(place => {
      const key = `${place.name}:${place.lat.toFixed(4)}:${place.lon.toFixed(4)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const aDelta = Math.abs(distanceKm(lat, lon, a.lat, a.lon) - targetKm);
      const bDelta = Math.abs(distanceKm(lat, lon, b.lat, b.lon) - targetKm);
      if (aDelta !== bDelta) return aDelta - bDelta;
      return drivePlaceScore(b) - drivePlaceScore(a);
    })
    .slice(0, 30);
  return placesInTargetBand(merged, lat, lon, targetKm, toleranceKm).slice(0, 30);
}

function timeoutResult(lat: number, lon: number, targetKm: number, toleranceKm: number, types: PlaceType[]): PlaceSearchResult {
  const curatedPlaces = curatedPlacesInRadius(lat, lon, targetKm + toleranceKm, types);
  return {
    places: mergePlaces(lat, lon, targetKm, toleranceKm, curatedPlaces),
    rawCount: 0,
    namedCount: curatedPlaces.length,
    classifiedCount: curatedPlaces.length,
    fallbackUsed: true,
    errors: ['search timeout'],
  };
}

async function fetchNearbyPlaces(lat: number, lon: number, targetKm: number, toleranceKm: number, types: PlaceType[]): Promise<PlaceSearchResult> {
  const searchRadiusKm = targetKm + toleranceKm;
  const radiusM = Math.min(searchRadiusKm * 1000, MAX_OVERPASS_RADIUS_M);
  const queryGroups: string[][] = [];
  if (types.includes('drive_food')) {
    const parts: string[] = [];
    addNwrQuery(parts, `["amenity"~"restaurant|cafe"]["name"~"${buildNameRegex(DRIVE_FOOD_NAME_PARTS)}",i]`, radiusM, lat, lon);
    addNwrQuery(parts, `["brand"~"${buildNameRegex(DRIVE_FOOD_NAME_PARTS)}",i]`, radiusM, lat, lon);
    addNodeQuery(parts, `["amenity"~"${FOOD_AMENITIES.join('|')}"]["name"]`, radiusM, lat, lon);
    queryGroups.push(parts);
  }
  if (types.includes('shopping')) {
    const parts: string[] = [];
    addNwrQuery(parts, `["shop"~"mall|department_store"]`, radiusM, lat, lon);
    addNwrQuery(parts, `["name"~"${buildNameRegex(SHOPPING_NAME_PARTS)}",i]`, radiusM, lat, lon);
    queryGroups.push(parts);
  }
  if (types.includes('roadside_station')) {
    const parts: string[] = [];
    addNwrQuery(parts, `["name"~"${buildNameRegex(ROADSIDE_NAME_PARTS)}",i]`, radiusM, lat, lon);
    queryGroups.push(parts);
  }
  if (types.includes('scenic')) {
    const parts: string[] = [];
    addNwrQuery(parts, `["tourism"="viewpoint"]`, radiusM, lat, lon);
    addNwrQuery(parts, `["natural"~"beach|cape|peak"]`, radiusM, lat, lon);
    addNwrQuery(parts, `["name"~"${buildNameRegex(SCENIC_NAME_PARTS)}",i]`, radiusM, lat, lon);
    queryGroups.push(parts);
  }
  if (types.includes('park')) {
    const parts: string[] = [];
    addNwrQuery(parts, `["leisure"~"park|nature_reserve|garden"]`, radiusM, lat, lon);
    addNwrQuery(parts, `["boundary"="national_park"]`, radiusM, lat, lon);
    addNwrQuery(parts, `["name"~"${buildNameRegex(PARK_NAME_PARTS)}",i]`, radiusM, lat, lon);
    queryGroups.push(parts);
  }
  if (types.includes('activity')) {
    const parts: string[] = [];
    addNwrQuery(parts, `["tourism"~"theme_park|zoo|aquarium|attraction|museum"]`, radiusM, lat, lon);
    addNwrQuery(parts, `["leisure"~"water_park|marina"]`, radiusM, lat, lon);
    addNwrQuery(parts, `["name"~"${buildNameRegex(ACTIVITY_NAME_PARTS)}",i]`, radiusM, lat, lon);
    queryGroups.push(parts);
  }

  if (queryGroups.length === 0) {
    return { places: [], rawCount: 0, namedCount: 0, classifiedCount: 0, fallbackUsed: false, errors: [] };
  }

  const elementsByGroup = await Promise.all(queryGroups.map(parts => fetchOverpassElements(parts)));
  const overpassErrors = elementsByGroup.flatMap(result => result.errors);
  const primaryElements = elementsByGroup.flatMap(result => result.elements);
  const primary = elementsToPlaces(primaryElements, types, false);
  primary.errors = overpassErrors;
  const curatedPlaces = curatedPlacesInRadius(lat, lon, searchRadiusKm, types);
  return {
    ...primary,
    places: mergePlaces(lat, lon, targetKm, toleranceKm, primary.places, curatedPlaces),
    namedCount: primary.namedCount + curatedPlaces.length,
    classifiedCount: primary.classifiedCount + curatedPlaces.length,
  };
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
      markers[k].setOpacity(String(k) === String(id) ? 1.0 : 0.35);
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

function openGoogleMaps(place: Place) {
  const url = `comgooglemaps://?daddr=${place.lat},${place.lon}&directionsmode=driving`;
  Linking.openURL(url).catch(() =>
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lon}&travelmode=driving`)
  );
}

type SearchProvider = 'google' | 'instagram' | 'tiktok';

function buildHashtagQuery(name: string): string {
  return name.replace(/[\s\u3000]+/g, '').replace(/[^\p{L}\p{N}_]/gu, '');
}

function openPlaceSearch(provider: SearchProvider, place: Place) {
  const query = encodeURIComponent(place.name);
  const hashtagQuery = encodeURIComponent(buildHashtagQuery(place.name) || place.name);
  const urls: Record<SearchProvider, string> = {
    google: `https://www.google.com/search?q=${query}`,
    instagram: `https://www.instagram.com/explore/tags/${hashtagQuery}/`,
    tiktok: `https://www.tiktok.com/tag/${hashtagQuery}`,
  };

  Linking.openURL(urls[provider]).catch(() => {
    Alert.alert('検索を開けませんでした', '時間をおいてもう一度お試しください。');
  });
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

function PlaceSearchLinks({ place }: { place: Place }) {
  return (
    <View style={styles.searchLinks}>
      <TouchableOpacity onPress={() => openPlaceSearch('google', place)} style={styles.searchLinkBtn} activeOpacity={0.8}>
        <Text style={styles.searchLinkText}>Google</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => openPlaceSearch('instagram', place)} style={styles.searchLinkBtn} activeOpacity={0.8}>
        <Text style={styles.searchLinkText}>Instagram</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => openPlaceSearch('tiktok', place)} style={styles.searchLinkBtn} activeOpacity={0.8}>
        <Text style={styles.searchLinkText}>TikTok</Text>
      </TouchableOpacity>
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
          <TouchableOpacity onPress={() => openGoogleMaps(place)} style={styles.actionBtnPrimary} activeOpacity={0.8}>
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
          <PlaceSearchLinks place={place} />
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
  const [searchDebug, setSearchDebug] = useState('');
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
    setSearchDebug('');
    setAllPlaces([]);
    setSelectedPlace(null);
  }

  const validActiveFilters = activeFilters.filter((type): type is PlaceType => (ALL_TYPES as readonly string[]).includes(type));
  const displayFilters = validActiveFilters.length > 0 ? validActiveFilters : [...ALL_TYPES];
  const filteredPlaces = allPlaces.filter(p => displayFilters.includes(p.type as PlaceType));

  async function handleSearch() {
    if (!userLocation) { Alert.alert('現在地を取得中です', 'しばらくお待ちください。'); return; }
    const val = parseFloat(inputValue);
    if (isNaN(val) || val <= 0) {
      Alert.alert('入力エラー', `${mode === 'distance' ? '距離（km）' : '時間（分）'}を正しく入力してください。`);
      return;
    }
    const km = mode === 'distance' ? val : timeToDistance(val);
    const toleranceKm = mode === 'distance' ? DISTANCE_TOLERANCE_KM : timeToDistance(TIME_TOLERANCE_MINUTES);
    setRadiusKm(km);
    setLoading(true);
    setSearched(false);
    setHasError(false);
    setSearchDebug('');
    setSelectedPlace(null);
    setActiveFilters([...ALL_TYPES]);
    Keyboard.dismiss();
    try {
      const result = await Promise.race([
        fetchNearbyPlaces(userLocation.latitude, userLocation.longitude, km, toleranceKm, [...ALL_TYPES]),
        new Promise<PlaceSearchResult>(resolve => {
          setTimeout(() => resolve(timeoutResult(userLocation.latitude, userLocation.longitude, km, toleranceKm, [...ALL_TYPES])), SEARCH_TIMEOUT_MS);
        }),
      ]);
      setAllPlaces(result.places);
      setSearchDebug(
        `debug: raw ${result.rawCount} / named ${result.namedCount} / matched ${result.classifiedCount}` +
        `${result.fallbackUsed ? ' / fallback' : ''}` +
        ` / loc ${userLocation.latitude.toFixed(4)},${userLocation.longitude.toFixed(4)}` +
        `${result.errors.length > 0 ? ` / ${result.errors.slice(0, 2).join(' / ')}` : ''}`
      );
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
          webViewRef.current?.injectJavaScript(`highlightPin(${JSON.stringify(place.id)}); true;`);
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
            {!loading && searched && tab === 'search' && searchDebug.length > 0 && (
              <Text style={styles.resultDebug}>{searchDebug}</Text>
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
                : <EmptyState message="スポットが見つかりませんでした" sub={searchDebug || "検索範囲を広げるか、フィルターを変更してください"} />
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
              <TouchableOpacity onPress={() => openGoogleMaps(selectedPlace)} style={styles.pinBtnPrimary} activeOpacity={0.8}>
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
            <PlaceSearchLinks place={selectedPlace} />
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
  resultDebug: { fontSize: 10, color: '#9aa0a6', textAlign: 'center', paddingHorizontal: 16 },

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
  searchLinks: { flexDirection: 'row', gap: 8, marginTop: 2 },
  searchLinkBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#dadce0',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  searchLinkText: { color: '#3c4043', fontSize: 13, fontWeight: '600' },

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
