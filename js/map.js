// ============================================================
// map.js — Leaflet 初期化・GeoJSON 描画・スタイル更新・ホバー/クリック
// クリック時の処理は main.js が setMuniClickHandler で注入する
// （game.js との循環importを避けるため）
// ============================================================
import { CONFIG } from './config.js';
import { state, MUNICIPALITIES, getClickableMunicipalities } from './state.js';

export let map = null;
export const municipalityLayers = {};
export let geojsonLoaded = false;
export let geojsonCache = null;

let onMuniClick = () => {};
export function setMuniClickHandler(fn) { onMuniClick = fn; }

// ---- テーマ（paper=従来 / night=夜景グロー） -----------------
// タイルなしの暗色背景 + ポリゴン発光。localStorage に永続化。
export let mapTheme = localStorage.getItem('haiken_theme') || 'paper';
let tilePale = null;
let tileLayerControl = null;

export function toggleMapTheme() {
  setMapTheme(mapTheme === 'night' ? 'paper' : 'night');
  return mapTheme;
}

export function setMapTheme(theme) {
  mapTheme = theme;
  localStorage.setItem('haiken_theme', theme);
  const container = document.getElementById('map');
  container.classList.toggle('night', theme === 'night');
  if (map && tilePale) {
    if (theme === 'night') {
      map.eachLayer(l => { if (l instanceof L.TileLayer) map.removeLayer(l); });
    } else if (!map.hasLayer(tilePale)) {
      tilePale.addTo(map);
    }
  }
  updateAllStyles();
}

// 発光はSVGパスのCSS filterで実現（タイル不要なので軽い）
function setGlow(layer, color) {
  const el = layer._path;
  if (!el) return;
  el.style.filter = color ? `drop-shadow(0 0 6px ${color})` : '';
}

// ---- 初期化 -------------------------------------------------
export function initMap() {
  map = L.map('map', {
    center: CONFIG.mapCenter,
    zoom: CONFIG.mapZoom,
    zoomControl: true,
    attributionControl: true,
  });

  tilePale = L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', {
    attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html">国土地理院</a>',
    maxZoom: 18,
  });
  const tileGsiStd = L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png', {
    attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html">国土地理院</a>',
    maxZoom: 18,
  });
  tilePale.addTo(map);
  tileLayerControl = L.control.layers({ '淡色地図': tilePale, '標準地図': tileGsiStd }, {}, { position: 'topleft' }).addTo(map);

  loadGeoJSON();
  if (mapTheme === 'night') setMapTheme('night');
}

function loadGeoJSON() {
  const urls = CONFIG.geoJsonUrls && CONFIG.geoJsonUrls.length > 0
    ? CONFIG.geoJsonUrls
    : (CONFIG.geoJsonUrl ? [CONFIG.geoJsonUrl] : []);

  if (urls.length === 0) {
    geojsonLoaded = false;
    renderFallbackMarkers();
    return;
  }

  const fetches = urls.map(url => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10000);
    return fetch(url, { signal: controller.signal })
      .then(r => { if (!r.ok) throw new Error('fetch failed'); return r.json(); })
      .catch(() => null);
  });

  Promise.all(fetches).then(results => {
    const validResults = results.filter(Boolean);
    if (validResults.length === 0) {
      geojsonLoaded = false;
      renderFallbackMarkers();
      return;
    }
    // Merge all GeoJSON feature collections into one
    const merged = {
      type: 'FeatureCollection',
      features: validResults.flatMap(d => d.features || []),
    };
    geojsonLoaded = true;
    geojsonCache = merged;
    renderGeoJSON(merged);
  });
}

function renderGeoJSON(data) {
  L.geoJSON(data, {
    style: () => getDefaultStyle(),
    onEachFeature: (feature, layer) => {
      // Support both generated format (name/code) and dataofjapan format (N03_004/N03_007/ward_ja)
      const code = feature.properties.code || feature.properties.N03_007 || '';
      const name = feature.properties.name || feature.properties.ward_ja || feature.properties.N03_004 || '';
      // Name-based match first (GeoJSON codes differ from spec codes in some sources)
      let matched = name ? MUNICIPALITIES.find(m => m.name === name) : null;
      if (!matched) matched = findMuniByCode(code);
      if (!matched) return;
      municipalityLayers[matched.code] = layer;
      layer.bindTooltip(matched.name + '<br>' + formatPop(matched.pop) + '人', {
        className: 'muni-tooltip', sticky: true
      });
      layer.on('click', () => onMuniClick(matched.code));
      layer.on('mouseover', () => highlightLayer(layer, matched.code));
      layer.on('mouseout', () => unhighlightLayer(layer, matched.code));
    }
  }).addTo(map);

  // Check for any municipalities without GeoJSON polygons, add markers as fallback
  MUNICIPALITIES.forEach(m => {
    if (!municipalityLayers[m.code]) {
      addFallbackMarker(m);
    }
  });
}

function findMuniByCode(code) {
  if (!code) return null;
  let c = String(code);
  // dataofjapan uses 6-digit codes (e.g. "072010"); normalize to 5-digit
  if (c.length === 6) c = c.slice(0, 5);
  c = c.padStart(5, '0');
  return MUNICIPALITIES.find(m => m.code === c);
}

function renderFallbackMarkers() {
  MUNICIPALITIES.forEach(m => addFallbackMarker(m));
}

function addFallbackMarker(m) {
  const radius = Math.max(Math.sqrt(m.pop) / 25, 8);
  const marker = L.circleMarker([m.lat, m.lng], {
    radius: radius,
    ...getDefaultStyle(),
  }).addTo(map);
  municipalityLayers[m.code] = marker;
  marker.bindTooltip(m.name + '<br>' + formatPop(m.pop) + '人', {
    className: 'muni-tooltip', sticky: true
  });
  marker.on('click', () => onMuniClick(m.code));
  marker.on('mouseover', () => highlightLayer(marker, m.code));
  marker.on('mouseout', () => unhighlightLayer(marker, m.code));
}

function getDefaultStyle() {
  if (mapTheme === 'night') {
    return { fillColor: '#1c2536', color: '#3d4a66', weight: 1, fillOpacity: 0.9, opacity: 0.9, fillRule: 'nonzero' };
  }
  return { fillColor: '#f5f0e6', color: '#aaa', weight: 1, fillOpacity: 0.2, opacity: 0.8, fillRule: 'nonzero' };
}

// ---- スタイル更新 -------------------------------------------
export function updateAllStyles() {
  const clickable = state.currentHanId ? new Set(getClickableMunicipalities(state.currentHanId)) : new Set();
  const night = mapTheme === 'night';

  MUNICIPALITIES.forEach(m => {
    const layer = municipalityLayers[m.code];
    if (!layer) return;

    const assignment = state.assignments[m.code];
    const han = assignment ? state.hans.find(h => h.id === assignment) : null;

    if (han && han.confirmed) {
      // Confirmed han
      if (night) {
        layer.setStyle({ fillColor: han.color, color: '#0a0e17', weight: 1.5, fillOpacity: 0.95, opacity: 1, dashArray: null, fillRule: 'nonzero' });
        setGlow(layer, han.color);
      } else {
        layer.setStyle({ fillColor: han.color, color: '#333', weight: 2, fillOpacity: 0.7, opacity: 1, dashArray: null, fillRule: 'nonzero' });
        setGlow(layer, null);
      }
    } else if (assignment === state.currentHanId) {
      // In current editing han
      if (night) {
        layer.setStyle({ fillColor: '#f5c542', color: '#ffe9a8', weight: 1.5, fillOpacity: 0.95, opacity: 1, dashArray: null, fillRule: 'nonzero' });
        setGlow(layer, '#f5c542');
      } else {
        layer.setStyle({ fillColor: '#FFD700', color: '#b8860b', weight: 2.5, fillOpacity: 0.65, opacity: 1, dashArray: null, fillRule: 'nonzero' });
        setGlow(layer, null);
      }
    } else if (!assignment && state.currentHanId) {
      if (clickable.has(m.code)) {
        // Clickable (adjacent) — dashed hint
        if (night) {
          layer.setStyle({ fillColor: '#2b3550', color: '#c9a84c', weight: 1.5, fillOpacity: 0.9, opacity: 1, dashArray: '5,4', fillRule: 'nonzero' });
        } else {
          layer.setStyle({ fillColor: '#fefcf0', color: '#DAA520', weight: 2, fillOpacity: 0.45, opacity: 1, dashArray: '5,4', fillRule: 'nonzero' });
        }
        setGlow(layer, null);
      } else {
        // Not clickable (not adjacent)
        if (night) {
          layer.setStyle({ fillColor: '#131a29', color: '#252e42', weight: 0.5, fillOpacity: 0.9, opacity: 0.8, dashArray: null, fillRule: 'nonzero' });
        } else {
          layer.setStyle({ fillColor: '#e8e8e8', color: '#ccc', weight: 0.5, fillOpacity: 0.15, opacity: 0.5, dashArray: null, fillRule: 'nonzero' });
        }
        setGlow(layer, null);
      }
    } else {
      // Default unassigned, no current han
      layer.setStyle(getDefaultStyle());
      setGlow(layer, null);
    }
  });
}

function highlightLayer(layer, code) {
  const assignment = state.assignments[code];
  const han = assignment ? state.hans.find(h => h.id === assignment) : null;
  if (han && han.confirmed) return;

  if (!assignment && state.currentHanId) {
    const clickable = new Set(getClickableMunicipalities(state.currentHanId));
    if (!clickable.has(code)) return;
  }

  if (mapTheme === 'night') {
    layer.setStyle({ fillColor: '#f5c542', fillOpacity: 0.9 });
    setGlow(layer, '#f5c542');
  } else {
    layer.setStyle({ fillColor: '#b5451b', fillOpacity: 0.75 });
  }
  if (layer.bringToFront) layer.bringToFront();
}

function unhighlightLayer(layer, code) {
  updateAllStyles();
}

// ---- ユーティリティ -----------------------------------------
export function jumpToMuni(code) {
  const m = MUNICIPALITIES.find(mu => mu.code === code);
  if (!m) return;
  map.setView([m.lat, m.lng], 12, { animate: true });
  const layer = municipalityLayers[code];
  if (layer) {
    layer.setStyle({ fillOpacity: 0.9, weight: 3 });
    setTimeout(() => updateAllStyles(), 1200);
  }
}

export function formatPop(pop) {
  return pop.toLocaleString();
}
