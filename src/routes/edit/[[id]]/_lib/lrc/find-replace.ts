// LRC テキストの検索/置換ロジック (純関数)
// 単純なリテラル文字列検索/置換のみ。メタ文字は全て文字通り扱う。

export type Match = { start: number; end: number };

/** リテラル検索: 全マッチ位置を返す */
export function findMatches(
  text: string,
  findText: string,
  caseSensitive: boolean,
): Match[] {
  if (!findText) return [];
  const results: Match[] = [];
  const hay = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? findText : findText.toLowerCase();
  let from = 0;
  while (true) {
    const idx = hay.indexOf(needle, from);
    if (idx === -1) break;
    results.push({ start: idx, end: idx + needle.length });
    from = idx + Math.max(1, needle.length);
  }
  return results;
}

/** 指定範囲を置換文字列で置き換えた新しいテキストを返す */
export function replaceAt(
  text: string,
  match: Match,
  replacement: string,
): string {
  return text.slice(0, match.start) + replacement + text.slice(match.end);
}

/** テキスト全体の全マッチを置換する */
export function replaceAll(
  text: string,
  findText: string,
  replacement: string,
  caseSensitive: boolean,
): string {
  if (!findText) return text;
  const matches = findMatches(text, findText, caseSensitive);
  if (matches.length === 0) return text;
  // 後ろから処理してインデックスズレを回避
  let result = text;
  for (let i = matches.length - 1; i >= 0; i--) {
    result = replaceAt(result, matches[i], replacement);
  }
  return result;
}
