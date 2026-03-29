#!/usr/bin/env node
/**
 * split-seirei-tax.js
 * 政令指定都市の税収を区の人口比で按分する。
 * e-Statでは「仙台市」「大阪市」等で市全体の税収が返るが、
 * 本ゲームでは区別データが必要なため、人口按分で近似する。
 *
 * 使い方:
 *   node scripts/split-seirei-tax.js          # 自動検出して全対応
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// .env.local を読み込む
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const m = line.match(/^(\w+)=(.+)$/);
    if (m) process.env[m[1]] = m[2].trim();
  }
}

const ESTAT_APPID  = process.env.ESTAT_APPID || '';
const TAX_STATS_ID = '0003173281';

// 政令指定都市: コード(3桁) → 市名
const SEIREI_CITIES = {
  '01': { '100': '札幌市' },
  '04': { '100': '仙台市' },
  '11': { '100': 'さいたま市' },
  '12': { '100': '千葉市' },
  '13': { '100': '東京都区部' }, // 23区は特別区だが同じロジックで処理
  '14': { '100': '横浜市', '130': '川崎市', '150': '相模原市' },
  '15': { '100': '新潟市' },
  '22': { '100': '静岡市', '130': '浜松市' },
  '23': { '100': '名古屋市' },
  '26': { '100': '京都市' },
  '27': { '100': '大阪市', '140': '堺市' },
  '28': { '100': '神戸市' },
  '33': { '100': '岡山市' },
  '34': { '100': '広島市' },
  '40': { '100': '北九州市', '130': '福岡市' },
  '43': { '100': '熊本市' },
};

async function fetchCityTax(prefCode, cityCode5) {
  if (!ESTAT_APPID) return 0;

  const url = `https://api.e-stat.go.jp/rest/3.0/app/json/getStatsData` +
    `?appId=${ESTAT_APPID}&statsDataId=${TAX_STATS_ID}` +
    `&cdArea=${cityCode5}&cdCat03=110&metaGetFlg=N&sectionHeaderFlg=1`;

  try {
    const res = await fetch(url);
    if (!res.ok) return 0;
    const json = await res.json();
    const values = json?.GET_STATS_DATA?.STATISTICAL_DATA?.DATA_INF?.VALUE || [];
    for (const v of values) {
      const val = Number(v['$'] || 0);
      if (val > 0) return val * 1000; // 千円→円
    }
  } catch(e) {}
  return 0;
}

async function main() {
  for (const [prefCode, cities] of Object.entries(SEIREI_CITIES)) {
    const muniPath = path.join(__dirname, '..', 'data', prefCode, 'municipalities.json');
    if (!fs.existsSync(muniPath)) continue;

    const munis = JSON.parse(fs.readFileSync(muniPath, 'utf8'));

    for (const [cityPrefix, cityName] of Object.entries(cities)) {
      // 区のリスト: コードが prefCode + cityPrefix で始まるもの
      // 例: 仙台市の区 = 04101, 04102, ... (prefCode=04, cityPrefix=100)
      const wards = munis.filter(m => {
        const sub = m.code.slice(2, 5); // 3桁市区町村コード
        return sub.startsWith(cityPrefix.slice(0, 2)) && m.taxRevenue === 0;
      });

      if (wards.length === 0) continue;

      // 市全体の税収を取得（市コード = prefCode + cityPrefix + "0" の上位）
      // e-Statの市コードは 5桁: prefCode(2) + cityCode(3)
      const cityCode5 = prefCode + cityPrefix.slice(0, 2) + '0';
      console.log(`📊 ${cityName} (${cityCode5}): 税収を取得中...`);

      let cityTax = await fetchCityTax(prefCode, cityCode5);

      if (cityTax === 0) {
        // 別の形式で試す: prefCode + "100"
        cityTax = await fetchCityTax(prefCode, prefCode + cityPrefix);
      }

      if (cityTax === 0) {
        console.log(`  ❌ 市全体の税収が取得できません`);
        continue;
      }

      // 人口按分
      const totalPop = wards.reduce((s, w) => s + w.pop, 0);
      if (totalPop === 0) continue;

      for (const ward of wards) {
        ward.taxRevenue = Math.round(cityTax * ward.pop / totalPop);
      }

      console.log(`  ✅ ${cityName}: ${(cityTax / 1e8).toFixed(0)}億円 → ${wards.length}区に人口按分`);
      await new Promise(r => setTimeout(r, 300));
    }

    // 東京23区の特別処理: 各区が独立した自治体なので、
    // 市全体ではなく各区の税収を個別取得
    if (prefCode === '13') {
      const specialWards = munis.filter(m => {
        const sub = parseInt(m.code.slice(2, 5));
        return sub >= 101 && sub <= 123 && m.taxRevenue === 0;
      });

      if (specialWards.length > 0) {
        console.log(`📊 東京23区: 個別取得中...`);
        for (const ward of specialWards) {
          const tax = await fetchCityTax('13', ward.code);
          if (tax > 0) {
            ward.taxRevenue = tax;
          }
          await new Promise(r => setTimeout(r, 200));
        }
        const matched = specialWards.filter(w => w.taxRevenue > 0).length;
        console.log(`  ✅ ${matched}/${specialWards.length} 区の税収取得完了`);
      }
    }

    fs.writeFileSync(muniPath, JSON.stringify(munis, null, 2), 'utf8');
  }

  // 最終集計
  let total = 0, matched = 0;
  for (let i = 1; i <= 47; i++) {
    const pc = String(i).padStart(2, '0');
    const d = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', pc, 'municipalities.json'), 'utf8'));
    total += d.length;
    matched += d.filter(m => m.taxRevenue > 0).length;
  }
  console.log(`\n📈 最終結果: ${matched}/${total} 市区町村に税収データあり`);
}

main().catch(e => { console.error(e); process.exit(1); });
