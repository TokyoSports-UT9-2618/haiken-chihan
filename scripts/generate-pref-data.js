#!/usr/bin/env node
/**
 * generate-pref-data.js
 * 都道府県コードを引数に取り、e-Stat GISシェープファイルから
 * data/{prefCode}/municipalities.json と adjacency.json を生成する。
 *
 * 使い方:
 *   node scripts/generate-pref-data.js 07          # 福島県
 *   node scripts/generate-pref-data.js 04          # 宮城県
 *   node scripts/generate-pref-data.js 07 --skip-tax  # 税収取得をスキップ
 */

'use strict';

const fetch    = require('node-fetch');
const shapefile = require('shapefile');
const JSZip    = require('jszip');
const turf     = require('@turf/turf');
const fs       = require('fs');
const path     = require('path');

// ============================================================
// 設定
// ============================================================
const ESTAT_SURVEY_ID = 'A002005212020'; // 2020年国勢調査 小地域
const ESTAT_APPID     = process.env.ESTAT_APPID || '';

// 税収: 2018年度地方税 statsDataId=0003173281
const TAX_STATS_ID    = '0003173281';

// 隣接判定の許容誤差（度）。県内は精度が高いので小さめ。
const ADJ_TOLERANCE   = 0.0005;
// 共有点が何個以上あれば「隣接」とみなすか
const ADJ_MIN_SHARED  = 2;

// ============================================================
// メイン
// ============================================================
async function main() {
  const args      = process.argv.slice(2);
  const prefCode  = (args.find(a => /^\d{2}$/.test(a)) || '').padStart(2, '0');
  const skipTax   = args.includes('--skip-tax');
  const skipAdj   = args.includes('--skip-adj');

  if (!prefCode) {
    console.error('使い方: node scripts/generate-pref-data.js <2桁都道府県コード>');
    process.exit(1);
  }

  console.log(`\n=== 都道府県 ${prefCode} のデータ生成を開始 ===\n`);

  // 1. e-Stat GIS からシェープファイルをダウンロード
  console.log('📥 e-Stat GIS シェープファイルを取得中...');
  const features = await fetchEstatShapefile(prefCode);
  console.log(`   ${features.length} 小地域フィーチャー取得完了`);

  // 2. 市区町村単位に集約
  console.log('🏙️  市区町村単位に集約中...');
  const muniMap = aggregateByCity(features);
  console.log(`   ${Object.keys(muniMap).length} 市区町村`);

  // 3. 税収データを e-Stat API で取得
  let taxData = {};
  if (!skipTax && ESTAT_APPID) {
    console.log('💰 e-Stat API から税収データを取得中...');
    taxData = await fetchTaxRevenue(prefCode);
    console.log(`   ${Object.keys(taxData).length} 件取得`);
  } else if (!skipTax && !ESTAT_APPID) {
    console.warn('   ⚠️  ESTAT_APPID 未設定のためスキップ（--skip-tax でも抑制可）');
  }

  // 4. municipalities.json を構築
  const municipalities = buildMunicipalitiesJson(muniMap, taxData, prefCode);
  console.log(`✅ municipalities: ${municipalities.length} 件`);

  // 5. 隣接リストを計算
  let adjacencyPairs = [];
  if (!skipAdj) {
    console.log('🔗 隣接リストを計算中（時間がかかる場合があります）...');
    adjacencyPairs = computeAdjacency(muniMap, prefCode);
    console.log(`   ${adjacencyPairs.length} ペア`);
  }

  // 6. 出力
  const outDir = path.join(__dirname, '..', 'data', prefCode);
  fs.mkdirSync(outDir, { recursive: true });

  const muniPath    = path.join(outDir, 'municipalities.json');
  const adjPath     = path.join(outDir, 'adjacency.json');
  const geojsonPath = path.join(outDir, 'boundaries.geojson');

  fs.writeFileSync(muniPath, JSON.stringify(municipalities, null, 2), 'utf8');
  fs.writeFileSync(adjPath,  JSON.stringify(adjacencyPairs, null, 2), 'utf8');

  // GeoJSON: 市区町村ポリゴン（小地域をMultiPolygonに集約）
  console.log('🗺️  GeoJSONポリゴンを生成中...');
  const geojson = buildMuniBoundaryGeoJSON(muniMap, prefCode);
  fs.writeFileSync(geojsonPath, JSON.stringify(geojson), 'utf8');
  console.log(`   ${geojson.features.length} フィーチャー`);

  console.log(`\n📁 出力完了:`);
  console.log(`   ${muniPath}`);
  console.log(`   ${adjPath}`);
  console.log(`   ${geojsonPath}`);

  // 7. マッチング失敗レポート
  const noTax = municipalities.filter(m => m.taxRevenue === 0).map(m => m.name);
  if (noTax.length > 0) {
    console.log(`\n⚠️  税収マッチング失敗 (${noTax.length}件): ${noTax.join(', ')}`);
    console.log('   scripts/name-fixes/{prefCode}.json に補正マッピングを追加できます');
  }
  console.log('\n=== 完了 ===\n');
}

// ============================================================
// e-Stat GIS シェープファイル取得
// ============================================================
async function fetchEstatShapefile(prefCode) {
  const url = `https://www.e-stat.go.jp/gis/statmap-search/data` +
    `?dlserveyId=${ESTAT_SURVEY_ID}&code=${prefCode}&coordSys=1&format=shape&downloadType=5`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`e-Stat GIS fetch failed: ${res.status}`);

  const zipBuf   = await res.buffer();
  const zip      = await JSZip.loadAsync(zipBuf);

  // .shp, .dbf を抽出
  const shpEntry = Object.values(zip.files).find(f => f.name.endsWith('.shp'));
  const dbfEntry = Object.values(zip.files).find(f => f.name.endsWith('.dbf'));
  if (!shpEntry || !dbfEntry) throw new Error('ZIP内にshp/dbfが見つかりません');

  const shpBuf = await shpEntry.async('arraybuffer');
  const dbfBuf = await dbfEntry.async('arraybuffer');

  // shapefile ライブラリで読み込み
  const features = [];
  const source   = await shapefile.open(shpBuf, dbfBuf, { encoding: 'shift_jis' });
  let result;
  while (!(result = await source.read()).done) {
    features.push(result.value);
  }
  return features;
}

// ============================================================
// 市区町村単位に集約
// ============================================================
function aggregateByCity(features) {
  // key: cityCode (3桁、例: "201" = 福島市)
  // 同一cityCodeのフィーチャーをまとめて：
  //   - population を sumMARK
  //   - 重心座標を population 加重平均
  //   - ポリゴンリストを保持（隣接計算用）
  const map = {};

  for (const f of features) {
    const props = f.properties || {};
    const cityCode = String(props.CITY || '').trim().padStart(3, '0');
    const cityName = (props.CITY_NAME || '').trim();
    const pop      = Number(props.JINKO || 0);
    const x        = Number(props.X_CODE || 0);
    const y        = Number(props.Y_CODE || 0);

    if (!cityCode || cityCode === '000') continue;

    if (!map[cityCode]) {
      map[cityCode] = {
        cityCode,
        cityName,
        population: 0,
        weightedLng: 0,
        weightedLat: 0,
        polygons: [],
      };
    }

    map[cityCode].population  += pop;
    map[cityCode].weightedLng += x * pop;
    map[cityCode].weightedLat += y * pop;

    // ポリゴンを収集（nullジオメトリを除外）
    if (f.geometry) {
      map[cityCode].polygons.push(f.geometry);
    }
  }

  // 加重重心を確定
  for (const city of Object.values(map)) {
    if (city.population > 0) {
      city.lat = city.weightedLat / city.population;
      city.lng = city.weightedLng / city.population;
    } else if (city.polygons.length > 0) {
      // 人口ゼロの場合はポリゴン重心
      try {
        const merged = dissolvePolygons(city.polygons);
        const c = turf.centroid(merged);
        city.lng = c.geometry.coordinates[0];
        city.lat = c.geometry.coordinates[1];
      } catch (e) {
        city.lat = 0; city.lng = 0;
      }
    }
  }

  return map;
}

// ============================================================
// municipalities.json 構築
// ============================================================
function buildMunicipalitiesJson(muniMap, taxData, prefCode) {
  // 名前補正マップを読み込む（あれば）
  const fixesPath = path.join(__dirname, 'name-fixes', `${prefCode}.json`);
  const nameFixes = fs.existsSync(fixesPath) ? JSON.parse(fs.readFileSync(fixesPath, 'utf8')) : {};

  const result = [];

  for (const city of Object.values(muniMap)) {
    // 5桁JISコード: 都道府県2桁 + 市区町村3桁
    const code = prefCode + city.cityCode;
    const name = city.cityName;

    // 税収マッチング（名前 or 補正マップ）
    const taxKey = nameFixes[name] || name;
    const taxRevenue = taxData[taxKey] || taxData[name] || 0;

    result.push({
      code,
      prefCode,
      name,
      pop: city.population,
      taxRevenue,
      lat: Math.round(city.lat * 10000) / 10000,
      lng: Math.round(city.lng * 10000) / 10000,
    });
  }

  // コードでソート
  result.sort((a, b) => a.code.localeCompare(b.code));
  return result;
}

// ============================================================
// 市区町村境界 GeoJSON 生成
// 小地域ポリゴンを dissolve して市区町村単位ポリゴンに統合、座標を間引く
// ============================================================
function buildMuniBoundaryGeoJSON(muniMap, prefCode) {
  const features = [];
  for (const city of Object.values(muniMap)) {
    if (!city.polygons || city.polygons.length === 0) continue;
    const code = prefCode + city.cityCode;

    // 小地域が多い市区町村はdissolveせずMultiPolygonとして収集（turf.unionはO(n²)で詰まる）
    const allRings = [];
    for (const geom of city.polygons) {
      if (geom.type === 'Polygon') allRings.push(geom.coordinates);
      else if (geom.type === 'MultiPolygon') allRings.push(...geom.coordinates);
    }
    if (allRings.length === 0) continue;

    let merged;
    if (city.polygons.length <= 50) {
      // 小規模はdissolveして境界線を統合
      try {
        merged = dissolvePolygons(city.polygons);
      } catch(e) {
        merged = turf.feature(allRings.length === 1
          ? { type: 'Polygon', coordinates: allRings[0] }
          : { type: 'MultiPolygon', coordinates: allRings });
      }
    } else {
      // 大規模（50超）はMultiPolygonのまま
      merged = turf.feature(allRings.length === 1
        ? { type: 'Polygon', coordinates: allRings[0] }
        : { type: 'MultiPolygon', coordinates: allRings });
    }

    // 座標を間引いて軽量化（tolerance=0.0002 ≒ 約20m精度）
    let simplified;
    try {
      simplified = turf.simplify(merged, { tolerance: 0.0002, highQuality: false });
    } catch(e) {
      simplified = merged;
    }

    // 内部リング（穴）を除去 — dissolveで生じた穴がLeafletで虫食い表示になるため
    stripHoles(simplified);

    simplified.properties = { code, name: city.cityName, pop: city.population };
    features.push(simplified);
  }
  return { type: 'FeatureCollection', features };
}

// ============================================================
// 隣接リスト計算
// ============================================================
function computeAdjacency(muniMap, prefCode) {
  // 座標ハッシュマップ方式: O(N×M) — e-StatのGISデータでは隣接する小地域は
  // 境界座標を完全に共有するため、ハッシュで一致を探せる。
  const coordIndex = new Map();

  for (const city of Object.values(muniMap)) {
    for (const geom of city.polygons) {
      const coords = [];
      collectCoords(geom.coordinates, coords);
      for (const [x, y] of coords) {
        // 小数点4桁に丸めてハッシュキーを作成（精度 ≈ 11m）
        const key = `${x.toFixed(4)},${y.toFixed(4)}`;
        if (!coordIndex.has(key)) coordIndex.set(key, new Set());
        coordIndex.get(key).add(city.cityCode);
      }
    }
  }

  // 2つ以上の市区町村が共有する座標点からペアを集計
  const pairCount = new Map();
  for (const cityCodes of coordIndex.values()) {
    if (cityCodes.size < 2) continue;
    const arr = [...cityCodes].sort();
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const key = `${arr[i]}_${arr[j]}`;
        pairCount.set(key, (pairCount.get(key) || 0) + 1);
      }
    }
  }

  // ADJ_MIN_SHARED 点以上共有するペアを隣接とみなす（1点のみは角で接するだけ）
  return [...pairCount.entries()]
    .filter(([, count]) => count >= ADJ_MIN_SHARED)
    .map(([key]) => {
      const [a, b] = key.split('_');
      return `${prefCode}${a.padStart(3,'0')}_${prefCode}${b.padStart(3,'0')}`;
    })
    .sort();
}

function collectCoords(arr, out) {
  if (!Array.isArray(arr) || arr.length === 0) return;
  if (typeof arr[0] === 'number') { out.push(arr); return; }
  for (const item of arr) collectCoords(item, out);
}

// ============================================================
// 隣接判定（座標共有チェック）
// ============================================================
function areAdjacent(featureA, featureB) {
  // まず turf.booleanTouches を試みる
  try {
    if (turf.booleanTouches(featureA, featureB)) return true;
  } catch(e) { /* fallthrough to coordinate check */ }

  // フォールバック: 共有座標点の数をカウント
  const coordsA = getAllCoordinates(featureA);
  const coordsB = getAllCoordinates(featureB);

  let sharedCount = 0;
  for (const [ax, ay] of coordsA) {
    for (const [bx, by] of coordsB) {
      if (Math.abs(ax - bx) < ADJ_TOLERANCE && Math.abs(ay - by) < ADJ_TOLERANCE) {
        sharedCount++;
        if (sharedCount >= ADJ_MIN_SHARED) return true;
      }
    }
  }
  return false;
}

function getAllCoordinates(feature) {
  const coords = [];
  const collect = (arr) => {
    if (!Array.isArray(arr)) return;
    if (typeof arr[0] === 'number') { coords.push(arr); return; }
    arr.forEach(collect);
  };
  collect(feature.geometry?.coordinates || []);
  return coords;
}

// ============================================================
// 内部リング（穴）除去 — dissolveで生じた穴を取り除く
// ============================================================
function stripHoles(feature) {
  const geom = feature.geometry;
  if (!geom) return;
  if (geom.type === 'Polygon') {
    geom.coordinates = [geom.coordinates[0]];
  } else if (geom.type === 'MultiPolygon') {
    geom.coordinates = geom.coordinates.map(poly => [poly[0]]);
  }
}

// ============================================================
// ポリゴン結合（小地域→市区町村）
// ============================================================
function dissolvePolygons(geometries) {
  // geometries: GeoJSON Geometry (Polygon or MultiPolygon) の配列
  if (geometries.length === 0) throw new Error('No geometries');
  if (geometries.length === 1) {
    return { type: 'Feature', geometry: geometries[0], properties: {} };
  }

  // turf.union を使って結合
  let merged = turf.feature(geometries[0]);
  for (let i = 1; i < geometries.length; i++) {
    try {
      merged = turf.union(merged, turf.feature(geometries[i]));
    } catch (e) {
      // union失敗時は最初のポリゴンのままにする
    }
  }
  return merged;
}

// ============================================================
// e-Stat API 税収データ取得
// ============================================================
async function fetchTaxRevenue(prefCode) {
  if (!ESTAT_APPID) return {};

  // statsDataId=0003173281: 2018年度地方税（市区町村財政状況）
  const url = `https://api.e-stat.go.jp/rest/3.0/app/json/getStatsData` +
    `?appId=${ESTAT_APPID}&statsDataId=${TAX_STATS_ID}` +
    `&cdArea=${prefCode}&cdCat03=110&metaGetFlg=N&sectionHeaderFlg=1`;

  const res = await fetch(url);
  if (!res.ok) return {};

  const json = await res.json();
  const values = json?.GET_STATS_DATA?.STATISTICAL_DATA?.DATA_INF?.VALUE || [];
  const result = {};

  for (const v of values) {
    const name = v['@area_name'] || v['@name'] || '';
    const val  = Number(v['$'] || 0);
    if (name && val) result[name] = val * 1000; // 千円 → 円
  }
  return result;
}

// ============================================================
main().catch(e => { console.error(e); process.exit(1); });
