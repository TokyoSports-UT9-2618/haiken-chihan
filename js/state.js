// ============================================================
// state.js — ゲーム状態・Undo履歴・localStorage セーブ/ロード
// 状態はすべてこのモジュールに集約する（可変・共有）
// ============================================================
import { isConnected } from './geo.js';

// ---- ゲーム状態 --------------------------------------------
export const state = {
  assignments: {},   // { muniCode: hanId }
  hans: [],          // { id, name, color, confirmed, tokku? }
  currentHanId: null,
  phase: "playing",  // "playing" | "completed"
  hanCounter: 0,
  renamingHanId: null,
  sliders: { memberReductionRate: 0.5, facilityClosureRate: 0.4 },
};

// ---- ロード済みデータ（initGame が設定する） ----------------
export let MUNICIPALITIES = [];
export let ADJACENCY = {};
export let BEFORE_COST = {};
export let PREF_META = [];          // prefectures.json の全件
export let CURRENT_PREF_CODES = ['07'];

export function setMunicipalities(v) { MUNICIPALITIES = v; }
export function setAdjacency(v) { ADJACENCY = v; }
export function setPrefMeta(v) { PREF_META = v; }
export function setCurrentPrefCodes(v) { CURRENT_PREF_CODES = v; }

// ---- 状態の読み取りヘルパー ---------------------------------
export function getHanPopulation(hanId) {
  return Object.entries(state.assignments)
    .filter(([, h]) => h === hanId)
    .reduce((sum, [code]) => {
      const m = MUNICIPALITIES.find(mu => mu.code === code);
      return sum + (m ? m.pop : 0);
    }, 0);
}

export function getHanMembers(hanId) {
  return Object.entries(state.assignments)
    .filter(([, h]) => h === hanId)
    .map(([code]) => MUNICIPALITIES.find(m => m.code === code))
    .filter(Boolean);
}

// ---- 隣接・連結クエリ（state + ADJACENCY を読むだけ） --------
// map.js と game.js の両方が使うため、循環importを避けてここに置く

export function canAddToHan(code, hanId) {
  const hanMembers = Object.entries(state.assignments)
    .filter(([, h]) => h === hanId)
    .map(([c]) => c);
  if (hanMembers.length === 0) return true;
  const neighbors = ADJACENCY[code] || [];
  return hanMembers.some(member => neighbors.includes(member));
}

export function canRemoveFromHan(code, hanId) {
  const remaining = Object.entries(state.assignments)
    .filter(([c, h]) => h === hanId && c !== code)
    .map(([c]) => c);
  if (remaining.length === 0) return true;
  return isConnected(remaining, c => ADJACENCY[c] || []);
}

export function getClickableMunicipalities(hanId) {
  const hanMembers = Object.entries(state.assignments)
    .filter(([, h]) => h === hanId)
    .map(([c]) => c);
  if (hanMembers.length === 0) {
    return MUNICIPALITIES.filter(m => !state.assignments[m.code]).map(m => m.code);
  }
  const clickable = new Set();
  for (const member of hanMembers) {
    for (const neighbor of (ADJACENCY[member] || [])) {
      if (!state.assignments[neighbor]) {
        clickable.add(neighbor);
      }
    }
  }
  return [...clickable];
}

export function checkIsolatedMunicipalities() {
  const unassigned = MUNICIPALITIES.filter(m => !state.assignments[m.code]).map(m => m.code);
  return unassigned.filter(code => {
    const neighbors = ADJACENCY[code] || [];
    return neighbors.every(n => state.assignments[n]);
  });
}

// スコア計算（state のみに依存する純粋ロジック）
export function calculateScore() {
  let score = 1000;
  const confirmedHans = state.hans.filter(h => h.confirmed);

  confirmedHans.forEach(han => {
    const pop = getHanPopulation(han.id);
    if (pop >= 300000 && pop <= 500000) {
      score += 100;
    } else if ((pop >= 250000 && pop < 300000) || (pop > 500000 && pop <= 550000)) {
      score -= han.tokku ? 25 : 50;
    } else {
      score -= han.tokku ? 100 : 200;
    }
  });

  const hanCount = confirmedHans.length;
  if (hanCount === 5) score += 300;
  else if (hanCount === 4 || hanCount === 6) score += 200;

  return Math.max(0, score);
}

// ---- Undo 履歴 ----------------------------------------------
export const history = [];

export function saveHistory() {
  history.push(JSON.parse(JSON.stringify({
    assignments: state.assignments,
    hans: state.hans,
    currentHanId: state.currentHanId,
    phase: state.phase,
    hanCounter: state.hanCounter,
    renamingHanId: state.renamingHanId,
  })));
  if (history.length > 80) history.shift();
  document.getElementById('btnUndo').disabled = false;
  autoSave();
}

// ---- セーブ / ロード（localStorage） ------------------------
export const SAVE_KEY = 'haiken_saves';
export const AUTOSAVE_KEY = 'haiken_autosave';
export const MAX_SLOTS = 4; // slots 1-4 (slot 0 = autosave)
// セーブ形式バージョン。互換性のない変更をしたらここを上げる。
// 旧データ（version: 3、schemaVersion なし）も有効として扱う。
export const SCHEMA_VERSION = 3;

export function buildSavePayload(name) {
  return {
    version: SCHEMA_VERSION,
    schemaVersion: SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    name: name || '',
    prefCodes: CURRENT_PREF_CODES,
    gameState: {
      hans:         JSON.parse(JSON.stringify(state.hans)),
      assignments:  JSON.parse(JSON.stringify(state.assignments)),
      hanCounter:   state.hanCounter,
      currentHanId: state.currentHanId,
      phase:        state.phase,
    },
  };
}

// schemaVersion（旧形式は version）が一致しないデータは破棄する
export function isValidSave(s) {
  if (!s || !s.gameState) return false;
  return (s.schemaVersion ?? s.version) === SCHEMA_VERSION;
}

export function autoSave() {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(buildSavePayload('自動保存')));
  } catch(e) { /* storage full */ }
}

export function getSlots() {
  try {
    const slots = JSON.parse(localStorage.getItem(SAVE_KEY) || '[]');
    return slots.map(s => (isValidSave(s) ? s : null));
  } catch(e) { return []; }
}

export function setSlots(slots) {
  localStorage.setItem(SAVE_KEY, JSON.stringify(slots));
}

export function getAutosave() {
  try {
    const s = JSON.parse(localStorage.getItem(AUTOSAVE_KEY));
    return isValidSave(s) ? s : null;
  } catch(e) { return null; }
}
