// ============================================================
// game.js — 藩の作成・確定・解散・特区・Undo などのゲームロジック
// ============================================================
import { CONFIG, HAN_COLORS } from './config.js';
import {
  state, MUNICIPALITIES, history, saveHistory,
  canAddToHan, canRemoveFromHan, checkIsolatedMunicipalities,
  getHanPopulation,
} from './state.js';
import { updateAllStyles } from './map.js';
import { updateSidebar, showToast, showGameClear } from './ui.js';

// ---- Undo ---------------------------------------------------
export function undoAction() {
  if (history.length === 0) { showToast("これ以上戻れません"); return; }
  const prev = history.pop();
  state.assignments = prev.assignments;
  state.hans = prev.hans;
  state.currentHanId = prev.currentHanId;
  state.phase = prev.phase;
  state.hanCounter = prev.hanCounter;
  state.renamingHanId = prev.renamingHanId;
  ['nameDialog','nameOverlay','tokkuDialog','tokkuOverlay','modalOverlay'].forEach(id => {
    document.getElementById(id).classList.remove('show');
  });
  document.getElementById('btnUndo').disabled = history.length === 0;
  updateAllStyles();
  updateSidebar();
}

// ---- 市町村クリック -----------------------------------------
export function handleMunicipalityClick(code) {
  if (state.phase !== "playing" || !state.currentHanId) {
    if (!state.currentHanId) showToast("まず「新しい藩を作る」を押してください");
    return;
  }

  const currentAssignment = state.assignments[code];
  const currentHan = state.hans.find(h => h.id === state.currentHanId);
  if (!currentHan) return;

  // Belongs to a confirmed han
  if (currentAssignment) {
    const assignedHan = state.hans.find(h => h.id === currentAssignment);
    if (assignedHan && assignedHan.confirmed) {
      showToast("確定済みの藩の市町村は変更できません");
      return;
    }
  }

  if (currentAssignment === state.currentHanId) {
    // Toggle off
    if (!canRemoveFromHan(code, state.currentHanId)) {
      showToast("この市町村を外すと飛び地になります");
      return;
    }
    saveHistory();
    delete state.assignments[code];
  } else if (!currentAssignment) {
    // Add
    if (!canAddToHan(code, state.currentHanId)) {
      showToast("隣接する市町村を先に追加してください");
      return;
    }
    saveHistory();
    state.assignments[code] = state.currentHanId;
  }

  updateAllStyles();
  updateSidebar();
}

// ---- 藩の作成・確定 -----------------------------------------
export function createNewHan() {
  saveHistory();
  if (state.currentHanId) {
    const current = state.hans.find(h => h.id === state.currentHanId);
    if (current && !current.confirmed) {
      const members = Object.values(state.assignments).filter(h => h === state.currentHanId);
      if (members.length > 0) {
        showToast("現在の藩を確定するか、市町村を外してから新しい藩を作ってください");
        return;
      }
      // Remove empty han
      state.hans = state.hans.filter(h => h.id !== state.currentHanId);
    }
  }

  state.hanCounter++;
  const colorIdx = state.hanCounter % HAN_COLORS.length;
  const newHan = {
    id: 'han_' + state.hanCounter,
    name: '藩' + String.fromCharCode(64 + state.hanCounter),
    color: HAN_COLORS[colorIdx],
    confirmed: false,
  };
  state.hans.push(newHan);
  state.currentHanId = newHan.id;

  updateAllStyles();
  updateSidebar();
  showToast("地図上の市町村をクリックして藩に追加してください");
}

export function confirmHan() {
  const currentHan = state.hans.find(h => h.id === state.currentHanId);
  if (!currentHan) return;

  const members = Object.entries(state.assignments)
    .filter(([, h]) => h === state.currentHanId);
  if (members.length === 0) {
    showToast("市町村を1つ以上追加してください");
    return;
  }

  // Show name dialog
  document.getElementById('nameInput').value = currentHan.name;
  document.getElementById('nameDialog').classList.add('show');
  document.getElementById('nameOverlay').classList.add('show');
  document.getElementById('nameInput').focus();
  document.getElementById('nameInput').select();
}

export function submitHanName() {
  const name = document.getElementById('nameInput').value.trim();
  if (!name) return;

  saveHistory();
  document.getElementById('nameDialog').classList.remove('show');
  document.getElementById('nameOverlay').classList.remove('show');

  // Rename mode: just update the name, no further flow
  if (state.renamingHanId) {
    const han = state.hans.find(h => h.id === state.renamingHanId);
    if (han) han.name = name;
    state.renamingHanId = null;
    updateSidebar();
    return;
  }

  // Confirm mode: save name, then check population for tokku
  const currentHan = state.hans.find(h => h.id === state.currentHanId);
  if (!currentHan) return;
  currentHan.name = name;

  const pop = getHanPopulation(state.currentHanId);
  if (pop < CONFIG.targetRange[0]) {
    document.getElementById('tokkuPopMsg').textContent =
      `この藩の人口は ${(pop / 10000).toFixed(1)}万人です。`;
    document.getElementById('tokkuType').value = '';
    document.getElementById('tokkuCustom').style.display = 'none';
    document.getElementById('tokkuCustom').value = '';
    document.getElementById('tokkuDialog').classList.add('show');
    document.getElementById('tokkuOverlay').classList.add('show');
    return;
  }

  finalizeHan(null);
}

export function dissolveHan(hanId) {
  saveHistory();
  // Remove all assignments for this han
  Object.keys(state.assignments).forEach(code => {
    if (state.assignments[code] === hanId) delete state.assignments[code];
  });
  // Remove the han
  state.hans = state.hans.filter(h => h.id !== hanId);
  if (state.currentHanId === hanId) state.currentHanId = null;
  updateAllStyles();
  updateSidebar();
  showToast('藩を解散しました（Cmd+Zで戻せます）');
}

function finalizeHan(tokkuData) {
  const currentHan = state.hans.find(h => h.id === state.currentHanId);
  if (!currentHan) return;

  currentHan.confirmed = true;
  currentHan.tokku = tokkuData;
  state.currentHanId = null;

  // Check for isolated municipalities
  const isolated = checkIsolatedMunicipalities();
  if (isolated.length > 0) {
    const names = isolated.map(c => MUNICIPALITIES.find(m => m.code === c)?.name).filter(Boolean);
    if (names.length <= 3) {
      showToast("注意: " + names.join("、") + " が孤立しています", 4000);
    } else {
      showToast("注意: " + names.length + "個の市町村が孤立しています", 4000);
    }
  }

  // Check game completion
  const assignedCount = Object.keys(state.assignments).length;
  if (assignedCount === MUNICIPALITIES.length) {
    state.phase = "completed";
    showGameClear();
  }

  updateAllStyles();
  updateSidebar();
}

export function renameHan(hanId) {
  const han = state.hans.find(h => h.id === hanId);
  if (!han) return;
  state.renamingHanId = hanId;
  document.getElementById('nameInput').value = han.name;
  document.getElementById('nameDialog').classList.add('show');
  document.getElementById('nameOverlay').classList.add('show');
  document.getElementById('nameInput').focus();
  document.getElementById('nameInput').select();
}

// ---- 特区（人口不足時の救済設定） ---------------------------
export function onTokkuTypeChange() {
  const type = document.getElementById('tokkuType').value;
  document.getElementById('tokkuCustom').style.display = type === 'custom' ? 'block' : 'none';
}

export function submitTokku() {
  const type = document.getElementById('tokkuType').value;
  const customText = document.getElementById('tokkuCustom').value.trim();
  const TOKKU_LABELS = {
    water: '水源・自然保護特区', agri: '農業・食料生産特区',
    fish: '漁業・水産特区', tourism: '観光・文化特区',
    nuclear: '原子力復興特区', border: '国境・防衛特区',
    custom: customText || '特区',
  };
  const tokkuData = type ? { type, label: TOKKU_LABELS[type] } : null;
  document.getElementById('tokkuDialog').classList.remove('show');
  document.getElementById('tokkuOverlay').classList.remove('show');
  finalizeHan(tokkuData);
}

// ---- リセット -----------------------------------------------
export function resetGame() {
  state.assignments = {};
  state.hans = [];
  state.currentHanId = null;
  state.phase = "playing";
  state.hanCounter = 0;
  state.renamingHanId = null;
  state.sliders = { memberReductionRate: 0.5, facilityClosureRate: 0.4 };
  history.length = 0;
  document.getElementById('btnUndo').disabled = true;

  document.getElementById('sliderMember').value = 50;
  document.getElementById('sliderMemberVal').textContent = '50%';
  document.getElementById('sliderFacility').value = 40;
  document.getElementById('sliderFacilityVal').textContent = '40%';
  document.getElementById('modalOverlay').classList.remove('show');
  document.getElementById('nameDialog').classList.remove('show');
  document.getElementById('nameOverlay').classList.remove('show');
  document.getElementById('tokkuDialog').classList.remove('show');
  document.getElementById('tokkuOverlay').classList.remove('show');

  updateAllStyles();
  updateSidebar();
}
