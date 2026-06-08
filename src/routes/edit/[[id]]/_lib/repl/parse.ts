// Repl テキストのパース・ソート・マージ

/** Repl 行のソート関数。漢字長(降順) → かな長(降順) → ja-locale 順 */
export function replSortFn(a: string, b: string): number {
  const kanjiA = a.split(",")[0] || "";
  const kanjiB = b.split(",")[0] || "";
  const kanaA = a.split(",")[1] || "";
  const kanaB = b.split(",")[1] || "";

  if (kanjiA.length !== kanjiB.length) return kanjiB.length - kanjiA.length;
  if (kanaA.length !== kanaB.length) return kanaB.length - kanaA.length;
  const kanjiCmp = kanjiA.localeCompare(kanjiB, "ja");
  if (kanjiCmp !== 0) return kanjiCmp;
  return kanaA.localeCompare(kanaB, "ja");
}

export type ReplEntry = { key: string; original: string };

/** Repl テキストを { key, original } の配列にパース */
export function parseMasterEntries(text: string): ReplEntry[] {
  return text
    .trim()
    .split("\n")
    .map((e) => e.trim())
    .filter((e) => e)
    .map((line) => {
      const parts = line.split(",");
      return { key: parts[0], original: line };
    });
}

/**
 * 既存 repl テキストに新しいエントリを追加して並び替える。
 * 既存キーがあるエントリは追加しない (既存の読み選択を尊重)。
 */
export function mergeAndSortRepl(
  currentText: string,
  newEntries: ReplEntry[],
): string {
  const lines = currentText
    .trim()
    .split("\n")
    .map((e) => e.trim())
    .filter((e) => e);

  const existingKeys = new Set(lines.map((l) => l.split(",")[0]));

  const newLines = newEntries
    .filter((e) => !existingKeys.has(e.key))
    .map((e) => e.original);

  const combined = Array.from(new Set([...lines, ...newLines]));

  combined.sort(replSortFn);

  return combined.join("\n");
}
