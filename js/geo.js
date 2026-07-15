// ============================================================
// geo.js — 純粋な地理アルゴリズム（index / landing 共通・依存なし）
// ============================================================

/**
 * BFS による連結判定。
 * @param {Iterable<string>} codes 判定対象コードの集合
 * @param {(code: string) => string[]} getNeighbors 隣接コードを返す関数
 * @returns {boolean} 全コードがひと続きに繋がっていれば true
 */
export function isConnected(codes, getNeighbors) {
  const list = [...codes];
  if (list.length <= 1) return true;
  const codeSet = new Set(list);
  const visited = new Set();
  const queue = [list[0]];
  visited.add(list[0]);
  while (queue.length > 0) {
    const current = queue.shift();
    for (const neighbor of (getNeighbors(current) || [])) {
      if (codeSet.has(neighbor) && !visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return visited.size === codeSet.size;
}
