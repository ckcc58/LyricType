// 長い repl エントリを既存エントリ + かな推論で分解する DP

export type DecompPart = { key: string; value: string; inferred: boolean };

/**
 * key (漢字含む文字列) を value (読み) と整合する形で、
 * prefixMap 内の既存エントリ + かな1〜5文字の漢字残余推論で分解する。
 *
 * 戻り値:
 * - 分解できない場合: null
 * - 分解結果が辞書1個以下の場合: null (分解の意味がない)
 * - それ以外: 連続する推論パートを統合した DecompPart の配列
 */
export function tryDecompose(
  key: string,
  value: string,
  prefixMap: Map<string, { key: string; value: string }[]>,
  kanaCharRegex: RegExp,
  kanjiCharRegex: RegExp,
  toHira: (ch: string) => string,
): DecompPart[] | null {
  const n = key.length;
  const m = value.length;

  type Parent = { pi: number; pj: number; entry: DecompPart | null };
  const dp: boolean[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(false),
  );
  const par: (Parent | null)[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(null),
  );
  dp[0][0] = true;

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      if (!dp[i][j]) continue;

      // 遷移1: master エントリでマッチを試行
      const cands = prefixMap.get(key[i]) || [];
      for (const c of cands) {
        if (c.key.length >= n) continue; // 元のキーより短いもののみ
        const ni = i + c.key.length,
          nj = j + c.value.length;
        if (
          ni <= n &&
          nj <= m &&
          !dp[ni][nj] &&
          key.startsWith(c.key, i) &&
          value.startsWith(c.value, j)
        ) {
          dp[ni][nj] = true;
          par[ni][nj] = {
            pi: i,
            pj: j,
            entry: { key: c.key, value: c.value, inferred: false },
          };
        }
      }

      // 遷移2: かな文字のスキップ (エントリ不要)
      if (
        kanaCharRegex.test(key[i]) &&
        j < m &&
        toHira(key[i]) === toHira(value[j]) &&
        !dp[i + 1][j + 1]
      ) {
        dp[i + 1][j + 1] = true;
        par[i + 1][j + 1] = { pi: i, pj: j, entry: null };
      }

      // 遷移3: 漢字残余推論 (漢字1文字 + かな1〜5文字)
      if (kanjiCharRegex.test(key[i])) {
        const maxRead = Math.min(5, m - j);
        for (let len = 1; len <= maxRead; len++) {
          const ni = i + 1,
            nj = j + len;
          if (nj <= m && !dp[ni][nj]) {
            const inferredReading = value.substring(j, nj);
            if ([...inferredReading].every((ch) => kanaCharRegex.test(ch))) {
              dp[ni][nj] = true;
              par[ni][nj] = {
                pi: i,
                pj: j,
                entry: {
                  key: key[i],
                  value: inferredReading,
                  inferred: true,
                },
              };
            }
          }
        }
      }
    }
  }

  if (!dp[n][m]) return null;

  // backtrack: 使用したエントリを収集
  const parts: DecompPart[] = [];
  let ci = n,
    cj = m;
  while (ci > 0 || cj > 0) {
    const p = par[ci][cj];
    if (!p) return null;
    if (p.entry) parts.push(p.entry);
    ci = p.pi;
    cj = p.pj;
  }

  // 連続する推論エントリを統合 (興,こ + 奮,うふん → 興奮,こうふん)
  const reversed = parts.reverse();
  const merged: DecompPart[] = [];
  for (const p of reversed) {
    const last = merged.length > 0 ? merged[merged.length - 1] : null;
    if (last && last.inferred && p.inferred) {
      last.key += p.key;
      last.value += p.value;
    } else {
      merged.push({ ...p });
    }
  }

  // 辞書エントリ2個以上でないと分解の意味がない
  return merged.length >= 2 ? merged : null;
}
