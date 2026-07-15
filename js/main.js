// ============================================================
// main.js — エントリーポイント。データ読み込み・イベント配線・起動
// HTML の inline onclick は使わず、ここで addEventListener する
// ============================================================
import { CONFIG } from './config.js';
import {
  state, MUNICIPALITIES, BEFORE_COST,
  setMunicipalities, setAdjacency, setPrefMeta, setCurrentPrefCodes,
} from './state.js';
import { calcMunicipalityCost, PREFECTURE_COST } from './cost.js';
import { initMap, map, setMuniClickHandler, jumpToMuni, toggleMapTheme, mapTheme } from './map.js';
import {
  updateSidebar, openHelp, closeHelp,
  showSaveModal, closeSaveModal, showLoadModal, closeLoadModal,
  onSliderChange,
} from './ui.js';
import {
  handleMunicipalityClick, createNewHan, confirmHan, submitHanName,
  undoAction, resetGame, renameHan, dissolveHan,
  onTokkuTypeChange, submitTokku,
} from './game.js';
import { generatePDF } from './pdf.js';

// ---- イベント配線 -------------------------------------------
function wireEvents() {
  // Header buttons
  document.getElementById('btnHelp').addEventListener('click', () => openHelp());
  document.getElementById('btnSave').addEventListener('click', () => showSaveModal());
  document.getElementById('btnLoad').addEventListener('click', () => showLoadModal());
  document.getElementById('btnUndo').addEventListener('click', () => undoAction());
  document.getElementById('btnReset').addEventListener('click', () => resetGame());
  const btnTheme = document.getElementById('btnTheme');
  const themeLabel = t => (t === 'night' ? '☀️ 通常' : '🌙 夜景');
  btnTheme.textContent = themeLabel(mapTheme);
  btnTheme.addEventListener('click', () => {
    btnTheme.textContent = themeLabel(toggleMapTheme());
  });

  // Sidebar actions
  document.getElementById('btnNew').addEventListener('click', () => createNewHan());
  document.getElementById('btnConfirm').addEventListener('click', () => confirmHan());

  // Name dialog
  document.getElementById('btnNameSubmit').addEventListener('click', () => submitHanName());
  document.getElementById('nameInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') submitHanName();
  });

  // Tokku dialog
  document.getElementById('tokkuType').addEventListener('change', () => onTokkuTypeChange());
  document.getElementById('btnTokkuSubmit').addEventListener('click', () => submitTokku());

  // Save / Load modals (背景クリックで閉じる)
  document.getElementById('saveOverlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeSaveModal();
  });
  document.getElementById('loadOverlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeLoadModal();
  });
  document.getElementById('btnSaveCancel').addEventListener('click', () => closeSaveModal());
  document.getElementById('btnLoadCancel').addEventListener('click', () => closeLoadModal());

  // Help modal（オーバーレイクリックのみ閉じる仕様は closeHelp 内で判定）
  document.getElementById('helpOverlay').addEventListener('click', e => closeHelp(e));
  document.getElementById('btnHelpClose').addEventListener('click', () => closeHelp());
  document.getElementById('btnHelpStart').addEventListener('click', () => closeHelp());

  // Game clear modal
  document.getElementById('btnReplay').addEventListener('click', () => resetGame());
  document.getElementById('btnPdf').addEventListener('click', e => generatePDF(e.currentTarget));

  // Cost sliders
  document.getElementById('sliderMember').addEventListener('input', () => onSliderChange());
  document.getElementById('sliderFacility').addEventListener('input', () => onSliderChange());

  // 確定藩カードのボタン（innerHTML 再生成されるため委譲で処理）
  document.getElementById('confirmedList').addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'rename') renameHan(btn.dataset.han);
    if (btn.dataset.action === 'dissolve') dissolveHan(btn.dataset.han);
  });

  // 未割り当てリスト → 地図ジャンプ（委譲）
  document.getElementById('unassignedList').addEventListener('click', e => {
    const item = e.target.closest('[data-action="jump"]');
    if (item) jumpToMuni(item.dataset.code);
  });

  // Cmd+Z / Ctrl+Z for undo
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
      e.preventDefault();
      undoAction();
    }
  });

  // 地図クリック → ゲームロジック（循環import回避のため注入）
  setMuniClickHandler(handleMunicipalityClick);
}

// ---- ゲーム初期化（データ読み込み） -------------------------
async function initGame() {
  const params = new URLSearchParams(location.search);
  // Support ?prefs=04,07 (multi-pref) and ?pref=07 (legacy single)
  const prefsParam = params.get('prefs') || params.get('pref') || '07';
  const prefCodes = [...new Set(prefsParam.split(',').map(c => c.trim().padStart(2, '0')))];
  setCurrentPrefCodes(prefCodes);

  // Load prefectures.json + all pref data in parallel
  const prefMetaFetch = fetch('data/prefectures.json').then(r => r.json()).catch(() => []);
  const muniAndAdjFetches = prefCodes.flatMap(pc => [
    fetch(`data/${pc}/municipalities.json`).then(r => r.json()).catch(() => []),
    fetch(`data/${pc}/adjacency.json`).then(r => r.json()).catch(() => []),
  ]);
  const [prefMetaAll, ...muniAndAdj] = await Promise.all([prefMetaFetch, ...muniAndAdjFetches]);
  setPrefMeta(prefMetaAll);

  // Merge municipalities and intra-pref adjacency pairs
  let allMunis = [];
  let allAdjPairs = [];
  for (let i = 0; i < prefCodes.length; i++) {
    allMunis = allMunis.concat(muniAndAdj[i * 2] || []);
    allAdjPairs = allAdjPairs.concat(muniAndAdj[i * 2 + 1] || []);
  }

  // Load cross-border adjacency for all pref pairs
  const crossPairs = [];
  for (let i = 0; i < prefCodes.length; i++) {
    for (let j = i + 1; j < prefCodes.length; j++) {
      const a = prefCodes[i] < prefCodes[j] ? prefCodes[i] : prefCodes[j];
      const b = prefCodes[i] < prefCodes[j] ? prefCodes[j] : prefCodes[i];
      crossPairs.push(fetch(`data/cross/${a}_${b}.json`).then(r => r.json()).catch(() => []));
    }
  }
  if (crossPairs.length > 0) {
    const crossResults = await Promise.all(crossPairs);
    crossResults.forEach(pairs => { allAdjPairs = allAdjPairs.concat(pairs); });
  }

  // Populate MUNICIPALITIES
  setMunicipalities(allMunis);
  MUNICIPALITIES.forEach(m => { m.cost = calcMunicipalityCost(m.pop); });

  // Build ADJACENCY lookup
  const adjacency = {};
  allAdjPairs.forEach(pair => {
    const [a, b] = pair.split('_');
    (adjacency[a] = adjacency[a] || []).push(b);
    (adjacency[b] = adjacency[b] || []).push(a);
  });
  setAdjacency(adjacency);

  // Update CONFIG from selected pref metadata
  const selectedPrefs = prefMetaAll.filter(p => prefCodes.includes(p.code));
  if (selectedPrefs.length > 0) {
    const avgLat = selectedPrefs.reduce((s, p) => s + p.mapCenter[0], 0) / selectedPrefs.length;
    const avgLng = selectedPrefs.reduce((s, p) => s + p.mapCenter[1], 0) / selectedPrefs.length;
    CONFIG.mapCenter = [avgLat, avgLng];
    CONFIG.mapZoom = prefCodes.length > 1 ? 7 : (selectedPrefs[0].mapZoom || 9);
    CONFIG.prefecture = selectedPrefs.map(p => p.name).join('・');
    CONFIG.geoJsonUrls = selectedPrefs.map(p => p.geojsonUrl).filter(Boolean);
    CONFIG.geoJsonUrl = CONFIG.geoJsonUrls[0] || '';
  }

  // Compute BEFORE_COST (sum across all selected prefectures)
  BEFORE_COST.prefGovSalary = 0;
  BEFORE_COST.prefFacility = 0;
  if (selectedPrefs.length > 0) {
    selectedPrefs.forEach(p => {
      if (p.prefCost) {
        BEFORE_COST.prefGovSalary += p.prefCost.governorAnnual + p.prefCost.assemblyAnnualPerPerson * p.prefCost.assemblyCount;
        BEFORE_COST.prefFacility += p.prefCost.facilityAnnual;
      }
    });
  } else {
    // Fallback to hardcoded constants
    BEFORE_COST.prefGovSalary = PREFECTURE_COST.governorTotal + PREFECTURE_COST.assemblyTotal;
    BEFORE_COST.prefFacility  = PREFECTURE_COST.facilityAnnual;
  }
  BEFORE_COST.muniSalary    = MUNICIPALITIES.reduce((s, m) => s + m.cost.mayorAnnual + m.cost.memberAnnual, 0);
  BEFORE_COST.muniFacility  = MUNICIPALITIES.reduce((s, m) => s + m.cost.facilityAnnual, 0);
  BEFORE_COST.totalSalary   = BEFORE_COST.prefGovSalary + BEFORE_COST.muniSalary;
  BEFORE_COST.totalFacility = BEFORE_COST.prefFacility  + BEFORE_COST.muniFacility;
  BEFORE_COST.total         = BEFORE_COST.totalSalary   + BEFORE_COST.totalFacility;

  // Update dynamic text based on selected prefectures
  const muniCount = MUNICIPALITIES.length;
  const prefName = CONFIG.prefecture;
  document.getElementById('headerSubtitle').textContent = `${prefName} ${muniCount}市町村 → 新しい藩へ`;
  document.getElementById('helpDescription').innerHTML = `${prefName}${muniCount}市町村を「藩」に再編成するシミュレーターです。<br>江戸時代の廃藩置県を逆転させ、藩＝スマートシュリンクシティのシミュレーションを体感しましょう。`;
  document.getElementById('helpGoalTitle').textContent = `全${muniCount}市町村を割り当ててゴール！`;
  document.getElementById('beforeCostTitle').textContent = `【廃県置藩 前】${prefName} + ${muniCount}市町村`;

  initMap();
  updateSidebar();
  setTimeout(() => map.invalidateSize(), 100);
  setTimeout(() => openHelp(), 600);
}

// ---- 起動 ---------------------------------------------------
wireEvents();
initGame();
