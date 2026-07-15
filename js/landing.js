// ============================================================
// landing.js — ランディングページ（都道府県選択）のロジック
// 選択した県だけをプレイエリアとして index.html?prefs=... に渡す。
// 隣接県は「追加可能」としてハイライトされ、クリックで任意追加できる
// （自動参戦はしない。1県だけでも遊べる）
// ============================================================
import { TARGET_POP } from './config.js';
import { isConnected } from './geo.js';

// ---- DATA ---------------------------------------------------
const PRESETS = [
  { name: "東北6県",   prefs: ["02","03","04","05","06","07"], icon: "🌲" },
  { name: "北関東3県", prefs: ["08","09","10"],                icon: "⛰" },
  { name: "南関東4県", prefs: ["11","12","13","14"],           icon: "🏙" },
  { name: "近畿5県",   prefs: ["24","25","26","27","28"],      icon: "🏯" },
  { name: "瀬戸内5県", prefs: ["33","34","35","37","38"],      icon: "⛵" },
  { name: "九州7県",   prefs: ["40","41","42","43","44","45","46"], icon: "🌋" },
  { name: "北陸3県",   prefs: ["15","16","17"],                icon: "🌊" },
  { name: "中部山岳",  prefs: ["15","16","17","18","19","20"], icon: "🏔" },
];

let prefData = []; // from prefectures.json
let selectedCodes = new Set();

// 都道府県コード → 隣接コード配列（geo.isConnected 用）
const prefNeighbors = (code) => {
  const pref = prefData.find(p => p.code === code);
  return (pref && pref.adjacent) || [];
};

// ---- INIT ---------------------------------------------------
async function init() {
  // Load prefectures.json
  prefData = await fetch('data/prefectures.json').then(r => r.json());

  // Load SVG map
  const svgRes = await fetch('data/japan-prefectures.svg');
  const svgText = await svgRes.text();
  document.getElementById('mapContainer').innerHTML = svgText;

  // Setup SVG interactions
  setupMap();
  renderPresets();
  updateUI();
}

// ---- MAP SETUP ----------------------------------------------
function setupMap() {
  const container = document.getElementById('mapContainer');
  const groups = container.querySelectorAll('g[data-code]');

  groups.forEach(g => {
    const code = String(g.dataset.code).padStart(2, '0');
    g.dataset.prefCode = code;
    g.classList.add('state-default');

    g.addEventListener('click', () => handlePrefClick(code));
    g.addEventListener('mouseenter', (e) => showTooltip(e, code));
    g.addEventListener('mousemove', (e) => moveTooltip(e));
    g.addEventListener('mouseleave', hideTooltip);
  });
}

// ---- CLICK HANDLER ------------------------------------------
function handlePrefClick(code) {
  const pref = prefData.find(p => p.code === code);
  if (!pref) return;

  if (selectedCodes.has(code)) {
    // Deselect — but only if it won't break connectivity
    if (selectedCodes.size === 1) return; // Can't remove last one
    const testSet = new Set(selectedCodes);
    testSet.delete(code);
    if (!isConnected(testSet, prefNeighbors)) return; // Would create disconnected selection
    selectedCodes.delete(code);
  } else {
    // Select — 最初の1県は自由、以降は選択済みに隣接する県のみ
    if (selectedCodes.size > 0 && !getAdjacentCodes().has(code)) return;
    selectedCodes.add(code);
  }

  updateUI();
}

// ---- ADJACENCY ----------------------------------------------
function getAdjacentCodes() {
  const adj = new Set();
  for (const code of selectedCodes) {
    const pref = prefData.find(p => p.code === code);
    if (pref && pref.adjacent) {
      pref.adjacent.forEach(a => {
        if (!selectedCodes.has(a)) adj.add(a);
      });
    }
  }
  return adj;
}

// ---- UI UPDATE ----------------------------------------------
function updateUI() {
  updateMapStyles();
  updateSelectedList();
  updateStats();
  updateStartButton();
  updateInstruction();
}

function updateMapStyles() {
  const adjacentCodes = getAdjacentCodes(); // 隣接県 = クリックで追加できる候補

  const groups = document.querySelectorAll('g[data-pref-code]');
  groups.forEach(g => {
    const code = g.dataset.prefCode;
    g.classList.remove('state-default', 'state-selected', 'state-included', 'state-adjacent', 'state-unavailable');

    if (selectedCodes.has(code)) {
      g.classList.add('state-selected');
    } else if (selectedCodes.size === 0) {
      g.classList.add('state-default');
    } else if (adjacentCodes.has(code)) {
      g.classList.add('state-adjacent');
    } else {
      g.classList.add('state-unavailable');
    }
  });
}

function updateSelectedList() {
  const list = document.getElementById('selectedList');
  if (selectedCodes.size === 0) {
    list.innerHTML = '<li class="empty-msg">未選択</li>';
    return;
  }

  list.innerHTML = [...selectedCodes].map(code => {
    const pref = prefData.find(p => p.code === code);
    if (!pref) return '';
    const pop = (pref.totalPopulation / 10000).toFixed(0);
    return `<li class="selected-item">
      <span class="name">${pref.name}</span>
      <span class="pop">${Number(pop).toLocaleString()}万人 / ${pref.municipalityCount}市町村</span>
      <button class="remove" data-code="${code}" title="除外">✕</button>
    </li>`;
  }).join('');
}

function getGameCodes() {
  // 選択した県だけがゲームに含まれる（隣接県の自動参戦は廃止）
  return new Set(selectedCodes);
}

function updateStats() {
  const gameCodes = getGameCodes();
  let totalMuni = 0, totalPop = 0;
  for (const code of gameCodes) {
    const pref = prefData.find(p => p.code === code);
    if (pref) {
      totalMuni += pref.municipalityCount;
      totalPop += pref.totalPopulation;
    }
  }
  const hanCount = Math.max(0, Math.round(totalPop / TARGET_POP));
  const popMan = (totalPop / 10000).toFixed(0);

  document.getElementById('statMuni').textContent = totalMuni;
  document.getElementById('statPop').textContent = Number(popMan).toLocaleString();
  document.getElementById('statHan').textContent = hanCount;
  document.getElementById('statPref').textContent = gameCodes.size;
}

function updateStartButton() {
  const btn = document.getElementById('startBtn');
  btn.disabled = selectedCodes.size === 0;
}

function updateInstruction() {
  const el = document.getElementById('mapInstruction');
  if (selectedCodes.size === 0) {
    el.textContent = '地図から最初の都道府県を選んでください';
  } else {
    const adj = getAdjacentCodes();
    if (adj.size > 0) {
      el.textContent = 'このまま出陣するか、緑の隣接県をクリックして追加できます';
    } else {
      el.textContent = '出陣の準備が整いました';
    }
  }
}

// ---- TOOLTIP ------------------------------------------------
function showTooltip(e, code) {
  const pref = prefData.find(p => p.code === code);
  if (!pref) return;
  const tt = document.getElementById('tooltip');
  tt.querySelector('.tt-name').textContent = pref.name;
  const pop = (pref.totalPopulation / 10000).toFixed(0);
  tt.querySelector('.tt-pop').textContent = `${Number(pop).toLocaleString()}万人 ／ ${pref.municipalityCount}市区町村`;
  tt.style.display = 'block';
  moveTooltip(e);
}

function moveTooltip(e) {
  const tt = document.getElementById('tooltip');
  const x = Math.min(e.clientX + 16, window.innerWidth - 200);
  const y = Math.max(e.clientY - 10, 10);
  tt.style.left = x + 'px';
  tt.style.top = y + 'px';
}

function hideTooltip() {
  document.getElementById('tooltip').style.display = 'none';
}

// ---- PRESETS ------------------------------------------------
function renderPresets() {
  const grid = document.getElementById('presetGrid');
  grid.innerHTML = PRESETS.map((p, i) => `
    <button class="preset-btn" data-preset="${i}">
      <span class="icon">${p.icon}</span>${p.name}
    </button>
  `).join('');
}

function applyPreset(index) {
  const preset = PRESETS[index];
  selectedCodes.clear();
  preset.prefs.forEach(c => selectedCodes.add(c));
  updateUI();
}

// ---- イベント委譲（innerHTML 再生成されるボタン） -------------
document.getElementById('selectedList').addEventListener('click', e => {
  const btn = e.target.closest('button.remove[data-code]');
  if (btn) handlePrefClick(btn.dataset.code);
});

document.getElementById('presetGrid').addEventListener('click', e => {
  const btn = e.target.closest('button[data-preset]');
  if (btn) applyPreset(parseInt(btn.dataset.preset, 10));
});

// ---- START GAME ---------------------------------------------
document.getElementById('startBtn').addEventListener('click', () => {
  if (selectedCodes.size === 0) return;
  const prefs = [...selectedCodes].sort().join(',');
  window.location.href = `index.html?prefs=${prefs}`;
});

// ---- BOOT ---------------------------------------------------
init();
