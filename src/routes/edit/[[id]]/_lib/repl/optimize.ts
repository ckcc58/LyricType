// Repl テキストの最適化 (連結/包含/トリム/+suffix の4最適化)
import { tryDecompose, type DecompPart } from "./decompose";
import { countPipeCoverage, getPlainReading, stripPlusSuffix } from "./coverage";
import { replSortFn } from "./parse";

/**
 * Chart Repl テキストを最適化する。
 *
 * 4つの最適化:
 * - Opt 4: 複合エントリの分解 (DP)
 * - Opt 5: 隣接エントリの結合 (LRC上で連続出現する場合)
 * - Opt 2: 長エントリに包含される短エントリの除去
 * - Opt 1 & 3: 共有かなトリミング & 同一キー統合
 *
 * @param replText        最適化対象の repl テキスト
 * @param lrcPlainText    LRC のプレーンテキスト (extractLrcPlainText の結果)
 * @param ignorePipeKeys  パイプ未処理を無視するキーのセット
 */
export function optimizeChartRepl(
  replText: string,
  lrcPlainText: string,
  ignorePipeKeys: Set<string> = new Set(),
): string {
  const kanaCharRegex = /[ぁ-んァ-ヶー]/;
  const toHira = (ch: string) =>
    ch.replace(/[ァ-ヶ]/g, (m) =>
      String.fromCharCode(m.charCodeAt(0) - 0x60),
    );
  const pipePartCoverage = (part: string): number => {
    if (part.endsWith("+*")) return Infinity;
    const plusNMatch = part.match(/\+(\d+)$/);
    if (plusNMatch) return 1 + parseInt(plusNMatch[1], 10);
    let p = part;
    let plusCount = 0;
    while (p.endsWith("+")) {
      plusCount++;
      p = p.slice(0, -1);
    }
    return 1 + plusCount;
  };
  const pipePartsCoverage = (parts: string[]): number =>
    parts.reduce((sum, part) => sum + pipePartCoverage(part), 0);

  // Parse entries
  let entries = replText
    .trim()
    .split("\n")
    .map((e) => e.trim())
    .filter((e) => e)
    .map((line) => {
      const idx = line.indexOf(",");
      if (idx === -1) return null;
      return { key: line.substring(0, idx), value: line.substring(idx + 1) };
    })
    .filter(
      (e): e is { key: string; value: string } =>
        e !== null && e.key !== "" && e.value !== "",
    );

  // === Opt 4: 複合エントリを引き算分解 (chart repl 内のみ) ===
  const kanjiCharRegex = /[々〆ヵヶ一-鿿]/;

  // パイプ値参照マップ: key+"\0"+plainValue → pipeValue
  const plainToPipeMap = new Map<string, string>();
  for (const e of entries) {
    plainToPipeMap.set(e.key + "\0" + getPlainReading(e.value), e.value);
  }
  // 分解処理用にプレーン読みに変換
  let plainEntries = entries.map((e) => ({
    key: e.key,
    value: getPlainReading(e.value),
  }));

  // chart repl エントリのみで prefixMap を構築 (master は使わない)
  const prefixMap = new Map<string, { key: string; value: string }[]>();
  for (const entry of plainEntries) {
    const list = prefixMap.get(entry.key[0]) || [];
    if (!list.some((e) => e.key === entry.key && e.value === entry.value)) {
      list.push({ key: entry.key, value: entry.value });
      prefixMap.set(entry.key[0], list);
    }
  }
  for (const [, list] of prefixMap) {
    list.sort((a, b) => b.key.length - a.key.length);
  }

  // chart repl エントリのみで分解 (少なくとも1つの非推論アンカーが必要)
  const allDecomps: {
    original: { key: string; value: string };
    parts: DecompPart[];
  }[] = [];
  for (const entry of plainEntries) {
    const parts = tryDecompose(
      entry.key,
      entry.value,
      prefixMap,
      kanaCharRegex,
      kanjiCharRegex,
      toHira,
    );
    if (!parts) continue;
    if (parts.every((p) => p.inferred)) continue;
    allDecomps.push({ original: entry, parts });
  }

  // 読み競合チェック: 同じサブキーに異なる読みが提案されたら却下
  const subReadings = new Map<string, Set<string>>();
  for (const d of allDecomps) {
    for (const p of d.parts) {
      const vals = subReadings.get(p.key) || new Set();
      vals.add(p.value);
      subReadings.set(p.key, vals);
    }
  }
  const decompConflictKeys = new Set<string>();
  for (const [k, vals] of subReadings) {
    if (vals.size > 1) decompConflictKeys.add(k);
  }
  // カウントベースの競合解決: 分解サブエントリ vs 既存エントリ
  const subKeyDecompCount = new Map<string, number>();
  for (const d of allDecomps) {
    if (d.parts.some((p) => decompConflictKeys.has(p.key))) continue;
    const uniqueKeys = new Set(d.parts.map((p) => p.key));
    for (const k of uniqueKeys) {
      subKeyDecompCount.set(k, (subKeyDecompCount.get(k) || 0) + 1);
    }
  }
  const blockedSubKeys = new Set<string>();
  for (const subKey of subKeyDecompCount.keys()) {
    const subValue = [...subReadings.get(subKey)!][0];
    // 完全一致エントリとの読み競合
    const existingConflicts = plainEntries.filter(
      (e) => e.key === subKey && e.value !== subValue,
    );
    if (existingConflicts.length > 0) {
      blockedSubKeys.add(subKey);
      continue;
    }
    // パイプ付き長エントリで subKey の暗黙的読みが異なる場合もブロック
    // 例: 魂温泉,たま|おん|せん があるとき subKey=魂,subValue=たましい → たま≠たましい でブロック
    const hasImplicitConflict = entries.some((e) => {
      if (e.key.length <= subKey.length || !e.key.includes(subKey))
        return false;
      if (!e.value.includes("|")) return false;
      const longerParts = e.value.split("|");
      if (longerParts.length !== e.key.length) return false;
      const charStart = e.key.indexOf(subKey);
      if (charStart === -1) return false;
      const subReading = longerParts
        .slice(charStart, charStart + subKey.length)
        .map(stripPlusSuffix)
        .join("");
      return toHira(subReading) !== toHira(subValue);
    });
    if (hasImplicitConflict) {
      blockedSubKeys.add(subKey);
    }
  }
  // 有効な分解を収集
  const validDecomps: {
    original: { key: string; value: string };
    parts: DecompPart[];
  }[] = [];
  for (const d of allDecomps) {
    if (d.parts.some((p) => decompConflictKeys.has(p.key))) continue;
    if (d.parts.some((p) => blockedSubKeys.has(p.key))) continue;
    validDecomps.push(d);
  }

  // 既存エントリのセット (サブエントリが既に存在するか判定用)
  const existingEntrySet = new Set<string>(
    plainEntries.map((e) => e.key + "\0" + e.value),
  );

  // サブエントリの使用回数を集計: 共有されるサブエントリがある分解のみ文字数が減る
  const subEntryUsage = new Map<string, number>();
  for (const d of validDecomps) {
    const seen = new Set<string>();
    for (const p of d.parts) {
      const k = p.key + "\0" + p.value;
      if (!seen.has(k)) {
        seen.add(k);
        subEntryUsage.set(k, (subEntryUsage.get(k) || 0) + 1);
      }
    }
  }
  // 推論パートの採用条件:
  // - 非推論 (chart repl アンカー) → 常にOK
  // - それ以外 → 既存エントリに存在するか、2回以上共有されている場合のみ
  const sharedDecomps = validDecomps.filter((d) => {
    return d.parts.every((p) => {
      if (!p.inferred) return true;
      const k = p.key + "\0" + p.value;
      return existingEntrySet.has(k) || (subEntryUsage.get(k) || 0) >= 2;
    });
  });

  // 文字数比較: 分解前 vs 分解後で総文字数が減る場合のみ採用
  const entryCharCount = (e: { key: string; value: string }) =>
    e.key.length + 1 + e.value.length;
  const beforeCost = sharedDecomps.reduce(
    (sum, d) => sum + entryCharCount(d.original),
    0,
  );
  const uniqueSubEntries = new Map<string, { key: string; value: string }>();
  for (const d of sharedDecomps) {
    for (const p of d.parts) {
      uniqueSubEntries.set(p.key + "\0" + p.value, {
        key: p.key,
        value: p.value,
      });
    }
  }
  // 既存エントリに既にあるサブエントリはコストに含めない (追加不要)
  const afterCost = [...uniqueSubEntries.values()]
    .filter((e) => !existingEntrySet.has(e.key + "\0" + e.value))
    .reduce((sum, e) => sum + entryCharCount(e), 0);

  if (afterCost < beforeCost) {
    // 分解を適用
    const decomposedKeys = new Set<string>();
    for (const d of sharedDecomps) {
      decomposedKeys.add(d.original.key + "\0" + d.original.value);
    }
    // 分解で追加されるサブエントリと競合する既存エントリを除去
    const acceptedSubMap = new Map<string, string>();
    for (const [, sub] of uniqueSubEntries) {
      acceptedSubMap.set(sub.key, sub.value);
    }
    plainEntries = plainEntries.filter((e) => {
      if (decomposedKeys.has(e.key + "\0" + e.value)) return false;
      const subValue = acceptedSubMap.get(e.key);
      if (subValue !== undefined && subValue !== e.value) return false;
      return true;
    });
    for (const [, sub] of uniqueSubEntries) {
      if (
        !plainEntries.some((e) => e.key === sub.key && e.value === sub.value)
      ) {
        plainEntries.push(sub);
      }
    }
  }

  // プレーンからパイプ値に復元
  entries = plainEntries.map((e) => ({
    key: e.key,
    value: plainToPipeMap.get(e.key + "\0" + e.value) || e.value,
  }));

  // === Opt 5: 隣接エントリ結合 ===
  // 2つの repl エントリのキーを結合した文字列が LRC にのみ存在し、
  // 各キーが結合形以外に LRC に出現しない場合、1つのエントリに結合する
  {
    const entryMap = new Map<string, { key: string; value: string }>();
    for (const e of entries) entryMap.set(e.key, e);
    const allKeys = entries.map((e) => e.key);

    // 全ペア(A,B)を試し、A+BがLRCにあるか確認
    type MergeCandidate = { aKey: string; bKey: string; merged: string };
    const candidates: MergeCandidate[] = [];
    for (let i = 0; i < allKeys.length; i++) {
      for (let j = 0; j < allKeys.length; j++) {
        if (i === j) continue;
        const merged = allKeys[i] + allKeys[j];
        // 結合キーが既にエントリとして存在する場合はスキップ
        if (entryMap.has(merged)) continue;
        if (lrcPlainText.includes(merged)) {
          candidates.push({ aKey: allKeys[i], bKey: allKeys[j], merged });
        }
      }
    }

    // 各キーがLRC内で結合形以外に出現しないか確認
    // パイプ分けが完了しているエントリのみ結合対象
    // needsPipeチェック: 未処理エントリが1つでもあれば結合全体をスキップ
    const hasPendingPipe = entries.some((e) => {
      const keyLen = [...e.key].length;
      if (keyLen < 2) return false;
      if (ignorePipeKeys.has(e.key)) return false;
      if (!/[々〆ヵヶ一-鿿]/.test(e.key)) return false;
      const cov = countPipeCoverage(e.value);
      if (cov === -1) return false;
      return cov !== keyLen;
    });
    const validCandidates = candidates.filter((c) => {
      if (hasPendingPipe) return false;
      const stripped = lrcPlainText
        .split(c.merged)
        .join("\0".repeat(c.merged.length));
      if (stripped.includes(c.aKey)) return false;
      if (stripped.includes(c.bKey)) return false;
      return true;
    });

    // 競合チェック: 同じキーが複数の結合候補に使われている場合は全てスキップ
    const keyUsage = new Map<string, number>();
    for (const c of validCandidates) {
      keyUsage.set(c.aKey, (keyUsage.get(c.aKey) || 0) + 1);
      keyUsage.set(c.bKey, (keyUsage.get(c.bKey) || 0) + 1);
    }
    const merges = validCandidates.filter(
      (c) =>
        (keyUsage.get(c.aKey) || 0) <= 1 && (keyUsage.get(c.bKey) || 0) <= 1,
    );

    if (merges.length > 0) {
      const mergedKeys = new Set<string>();
      const newEntries: { key: string; value: string }[] = [];

      for (const m of merges) {
        const a = entryMap.get(m.aKey)!;
        const b = entryMap.get(m.bKey)!;

        // 結合値を生成
        // A側のパイプグループ数とキー文字数の+計算
        const aKeyLen = [...a.key].length;
        const aPipeCov = countPipeCoverage(a.value);
        const bKeyLen = [...b.key].length;
        const bPipeCov = countPipeCoverage(b.value);

        // Aの値: パイプなし(全体読み)でキー2文字以上なら+を付ける
        let aVal = a.value;
        if (aPipeCov === 1 && aKeyLen > 1) {
          // 全体読み → +を付けてグループ化
          aVal = aVal + "+".repeat(aKeyLen - 1);
        }
        // Bの値: 同様
        let bVal = b.value;
        if (bPipeCov === 1 && bKeyLen > 1) {
          bVal = bVal + "+".repeat(bKeyLen - 1);
        }

        const mergedValue = aVal + "|" + bVal;
        newEntries.push({ key: m.merged, value: mergedValue });
        mergedKeys.add(m.aKey);
        mergedKeys.add(m.bKey);
      }

      // 結合元エントリを除去し、結合エントリを追加
      entries = entries.filter((e) => !mergedKeys.has(e.key));
      entries.push(...newEntries);
    }
  }

  // === Opt 2: 長いエントリに包含されるエントリを除去 ===
  // LRC から長いキーを全て除去し、短いキーがまだ残る (= 長いキー以外の場所でも
  // 出現する) 場合のみ保持する。読みが衝突しても、その短いキーが LRC 上で長いキー
  // 以外に一度も出現しないなら不要なので除去する。
  // 例: 歌詞が「日暮れ」のみで repl に 日暮,ひ|ぐ と 暮,く がある場合、
  //     「暮」は「日暮」以外に出ないので 暮,く は除去される。
  entries = entries.filter((entry) => {
    const longerKeys = entries.filter(
      (other) =>
        other.key.length > entry.key.length && other.key.includes(entry.key),
    );
    if (longerKeys.length === 0) return true;

    // LRCから長いキーを除去し、短いキーがまだ存在するか確認
    let remaining = lrcPlainText;
    for (const longer of longerKeys) {
      remaining = remaining
        .split(longer.key)
        .join("\0".repeat(longer.key.length));
    }
    return remaining.includes(entry.key);
  });

  // === Opt 1 & 3: 共有かなトリミング＆同一キー統合 ===
  const trimmed = entries.map((entry) => {
    let tKey = entry.key;
    let tValue = entry.value;

    if (tValue.includes("|")) {
      // パイプ対応トリミング: パイプパート単位で操作
      let keyChars = [...tKey];
      let parts = tValue.split("|");

      // 接尾辞トリミング
      while (keyChars.length > 1) {
        const lastK = keyChars[keyChars.length - 1];
        if (!kanaCharRegex.test(lastK)) break;
        if (parts.length > 0) {
          const lastPart = parts[parts.length - 1];
          const lastCoverage = pipePartCoverage(lastPart);
          const cleaned = stripPlusSuffix(lastPart);
          if (
            lastCoverage === 1 &&
            cleaned.length === 1 &&
            toHira(cleaned) === toHira(lastK) &&
            lastPart === cleaned
          ) {
            keyChars.pop();
            parts.pop();
            continue;
          }
        }
        if (pipePartsCoverage(parts) < keyChars.length) {
          // 読みに明示されていない末尾かな → キーのみ削除
          keyChars.pop();
        } else break;
      }

      // 接頭辞トリミング
      while (keyChars.length > 1 && parts.length > 0) {
        const firstK = keyChars[0];
        if (!kanaCharRegex.test(firstK)) break;
        const firstPart = parts[0];
        const cleaned = stripPlusSuffix(firstPart);
        if (
          cleaned.length === 1 &&
          toHira(cleaned) === toHira(firstK) &&
          firstPart === cleaned
        ) {
          keyChars.shift();
          parts.shift();
        } else break;
      }

      tKey = keyChars.join("");
      tValue = parts.join("|");
    } else {
      // パイプなし (プレーン読み): 従来のトリミング
      // 接尾辞トリミング
      while (tKey.length > 1 && tValue.length > 1) {
        const lastK = tKey[tKey.length - 1];
        const lastV = tValue[tValue.length - 1];
        if (kanaCharRegex.test(lastK) && toHira(lastK) === toHira(lastV)) {
          tKey = tKey.slice(0, -1);
          tValue = tValue.slice(0, -1);
        } else break;
      }

      // 接頭辞トリミング
      while (tKey.length > 1 && tValue.length > 1) {
        const firstK = tKey[0];
        const firstV = tValue[0];
        if (kanaCharRegex.test(firstK) && toHira(firstK) === toHira(firstV)) {
          tKey = tKey.slice(1);
          tValue = tValue.slice(1);
        } else break;
      }
    }

    return {
      originalKey: entry.key,
      originalValue: entry.value,
      trimmedKey: tKey,
      trimmedValue: tValue,
    };
  });

  // トリミング後のキーでグループ化
  const groups = new Map<string, typeof trimmed>();
  for (const entry of trimmed) {
    const group = groups.get(entry.trimmedKey) || [];
    group.push(entry);
    groups.set(entry.trimmedKey, group);
  }

  // 安全性チェック: LRCから全エントリのオリジナルキーを除去し、
  // 短縮キーがカバーされていないテキストにマッチしないか確認
  let maskedLrc = lrcPlainText;
  for (const entry of trimmed) {
    maskedLrc = maskedLrc
      .split(entry.originalKey)
      .join("\0".repeat(entry.originalKey.length));
  }

  const result: string[] = [];
  for (const [tKey, group] of groups) {
    const uniqueValues = new Set(group.map((e) => e.trimmedValue));

    if (uniqueValues.size > 1 || maskedLrc.includes(tKey)) {
      // 読み競合 or 未カバーテキストにマッチ → 元のエントリを維持
      for (const entry of group) {
        result.push(`${entry.originalKey},${entry.originalValue}`);
      }
    } else {
      // 安全: 短縮・統合エントリを使用
      result.push(`${tKey},${group[0].trimmedValue}`);
    }
  }

  result.sort(replSortFn);
  return result.join("\n");
}
