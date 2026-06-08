// LRC + master + 既存 chartRepl から chartRepl を生成する
import { parseMasterEntries, mergeAndSortRepl } from "./parse";
import { optimizeChartRepl } from "./optimize";
import { extractLrcPlainText } from "./lrc-text";

/**
 * LRC + master + 既存 chartRepl をマージして最適化する。
 *
 * @param lrcText           LRC テキスト
 * @param masterText        Master Repl テキスト
 * @param existingChartRepl 既存の chartRepl テキスト
 * @param ignorePipeKeys    パイプ未処理を無視するキーのセット
 * @param useMaster         master を含めてマージするか (false なら既存 chartRepl のみ最適化)
 * @returns merged          master+chart のマージ結果 (最適化前)
 * @returns optimized       最適化後の chartRepl
 */
export function generateChartRepl(
  lrcText: string,
  masterText: string,
  existingChartRepl: string,
  ignorePipeKeys: Set<string>,
  useMaster: boolean = true,
): { merged: string; optimized: string } {
  const allPhrases = extractLrcPlainText(lrcText);
  let merged: string;
  if (useMaster) {
    const masterEntries = parseMasterEntries(masterText);
    const matches = masterEntries.filter((entry) =>
      allPhrases.includes(entry.key),
    );
    merged = mergeAndSortRepl(existingChartRepl, matches);
  } else {
    merged = existingChartRepl;
  }
  const optimized = optimizeChartRepl(merged, allPhrases, ignorePipeKeys);
  return { merged, optimized };
}
