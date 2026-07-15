// ============================================================
// cost.js — 行政コスト計算（純粋関数のみ・state に依存しない）
// ============================================================

// 福島県のフォールバック用コスト定数（prefectures.json に prefCost が無い場合のみ使用）
export const PREFECTURE_COST = {
  name: "福島県",
  governorAnnual: 18000000 * 2, // 知事+副知事 2人分
  assemblyCount: 58,
  assemblyAnnualPerPerson: 17000000,
  facilityAnnual: 3000000000,
  get governorTotal() { return this.governorAnnual; },
  get assemblyTotal() { return this.assemblyAnnualPerPerson * this.assemblyCount; },
  get total() { return this.governorTotal + this.assemblyTotal + this.facilityAnnual; },
};

// 人口規模別の首長・議員月額報酬テーブル
export const SALARY_TIERS = {
  mayor: [
    { minPop: 200000, monthly: 1000000 },
    { minPop:  50000, monthly:  800000 },
    { minPop:  20000, monthly:  650000 },
    { minPop:   5000, monthly:  500000 },
    { minPop:      0, monthly:  380000 },
  ],
  member: [
    { minPop: 200000, monthly: 570000 },
    { minPop:  50000, monthly: 380000 },
    { minPop:  20000, monthly: 270000 },
    { minPop:      0, monthly: 200000 },
  ],
};

// 市町村単体の年間行政コスト試算
export function calcMunicipalityCost(pop) {
  const mayorTier = SALARY_TIERS.mayor.find(t => pop >= t.minPop);
  const mayorAnnual = mayorTier.monthly * 12 * 1.4;
  const memberCount = Math.max(4, Math.round(pop / 8000));
  const memberTier = SALARY_TIERS.member.find(t => pop >= t.minPop);
  const memberAnnual = memberTier.monthly * 12 * 1.4 * memberCount;
  const facilityAnnual = Math.max(30000000, pop * 10000);
  return { mayorAnnual, memberCount, memberAnnual, facilityAnnual, total: mayorAnnual + memberAnnual + facilityAnnual };
}

/**
 * 藩1つの年間コスト試算。
 * @param {Array} members 構成市町村（m.pop / m.cost 必須）
 */
export function calcHanCost(members, memberReductionRate, facilityClosureRate) {
  const hanPop = members.reduce((s, m) => s + m.pop, 0);
  // 藩主: 知事相当報酬
  const chiefAnnual = 1200000 * 12 * 1.4;
  // 合併前議員数合計 × (1 - 削減率)
  const totalMembersBefore = members.reduce((s, m) => s + m.cost.memberCount, 0);
  const membersAfter = Math.max(4, Math.round(totalMembersBefore * (1 - memberReductionRate)));
  // 議員報酬は藩人口規模で決定
  const memberTier = SALARY_TIERS.member.find(t => hanPop >= t.minPop);
  const memberAnnual = memberTier.monthly * 12 * 1.4 * membersAfter;
  // 施設費: 合併前合計 × (1 - 統廃合率)
  const facilityBefore = members.reduce((s, m) => s + m.cost.facilityAnnual, 0);
  const facilityAnnual = facilityBefore * (1 - facilityClosureRate);
  return { chiefAnnual, membersAfter, memberAnnual, facilityAnnual, total: chiefAnnual + memberAnnual + facilityAnnual };
}

/**
 * 廃県置藩「後」の合計コスト。
 * @param {Array<Array>} hansMembers 確定済み各藩の構成市町村リストの配列
 */
export function calcAfterCost(hansMembers, memberReductionRate, facilityClosureRate) {
  let totalSalary = 0, totalFacility = 0;
  hansMembers.forEach(members => {
    const c = calcHanCost(members, memberReductionRate, facilityClosureRate);
    totalSalary += c.chiefAnnual + c.memberAnnual;
    totalFacility += c.facilityAnnual;
  });
  return { totalSalary, totalFacility, total: totalSalary + totalFacility };
}

// 円 → 億円（小数1桁）表示用
export function formatOku(yen) {
  return (yen / 100000000).toFixed(1);
}
