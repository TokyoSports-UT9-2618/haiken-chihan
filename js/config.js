// ============================================================
// config.js — チューニング可能な定数を集約（index / landing 共通）
// ============================================================

// 1藩あたりの目標人口（廃県置藩の基本思想: 商圏エコシステムが回る最小ライン）
export const TARGET_POP = 400000;
export const TARGET_RANGE = [300000, 500000];

// ゲーム実行時設定（initGame が prefectures.json の内容で上書きする）
export const CONFIG = {
  prefecture: "福島県",
  mapCenter: [37.4, 140.2],
  mapZoom: 9,
  targetPop: TARGET_POP,
  targetRange: TARGET_RANGE,
  geoJsonUrl: "https://raw.githubusercontent.com/dataofjapan/land/master/fukushima.geojson",
  geoJsonUrls: [],
};

// 藩の塗り分け12色パレット（彩度高め）
export const HAN_COLORS = [
  "#2E86C1", "#D35400", "#1E8449", "#8E44AD", "#C0392B", "#117A65",
  "#6C3483", "#CA6F1E", "#148F77", "#2471A3", "#B03A2E", "#1F618D"
];
