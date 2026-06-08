// LRC テキスト処理 (プレーン化、未カバー漢字検出)
import { parseLyric } from "$lib/parseLyric/parse-chart";

/** LRCからタイムタグ・@ディレクティブを除去し、全行のプレーンテキストを返す */
export function extractLrcPlainText(lrcText: string): string {
  return lrcText
    .replace(/^@\w+=.*$/gm, "")
    .replace(/\[\d\d:\d\d:\d\d\]/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l)
    .join(" ");
}

/**
 * 与えられた replText を LRC に適用したとき、まだルビが付かない漢字を抽出。
 * タイムタグなしのLRCにはダミーのタイムタグを付加してパースする。
 */
export function computeMissingKanji(
  lrcText: string,
  replText: string,
): Set<string> {
  let parsed = parseLyric(lrcText, replText);
  if (parsed.length === 0 && lrcText.trim()) {
    const dummyLrc = lrcText
      .split("\n")
      .map((line) => {
        const stripped = line.replace(/\[\d\d:\d\d:\d\d\]/g, "").trim();
        return stripped ? `[00:00:00]${stripped}[00:00:00]` : "";
      })
      .filter((l) => l)
      .join("\n");
    parsed = parseLyric(dummyLrc, replText);
  }
  const kanjiRegex = /[々〆ヵヶ一-鿿]/;
  const missing = new Set<string>();
  parsed.forEach((segment) => {
    segment.segments.forEach((seg) => {
      if (seg.text === seg.reading && kanjiRegex.test(seg.text)) {
        missing.add(seg.text);
      }
    });
  });
  return missing;
}
