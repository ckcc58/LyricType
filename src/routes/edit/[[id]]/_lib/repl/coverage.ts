// Repl エントリの読み(reading)解析ユーティリティ
// パイプ/+サフィックスの除去・カバレッジ計算

/** 読みパートから +N, +*, + サフィックスを除去 */
export const stripPlusSuffix = (p: string): string =>
  p.replace(/\+(\d+|\*)?$/, "").replace(/\++$/, "");

/**
 * 読みのパイプと +サフィックスから、カバーするキー文字数を返す。
 * - パイプなし → 1 (全体読み)
 * - +* を含む → -1 (可変、チェック不可)
 * - 通常 → 各パイプパートのキー文字数の総和
 */
export function countPipeCoverage(reading: string): number {
  let s = reading
    .replace(/\\\\/g, "\x03")
    .replace(/\\\|/g, "\x04")
    .replace(/\\\+/g, "\x05");

  if (!s.includes("|")) return 1;

  const parts = s.split("|");
  let total = 0;
  for (const part of parts) {
    if (part.endsWith("+*")) return -1;
    const plusNMatch = part.match(/\+(\d+)$/);
    if (plusNMatch) {
      total += 1 + parseInt(plusNMatch[1]);
      continue;
    }
    let p = part;
    let plusCount = 0;
    while (p.endsWith("+")) {
      plusCount++;
      p = p.slice(0, -1);
    }
    total += 1 + plusCount;
  }
  return total;
}

/** 読みからパイプ/+メタ文字を除去して素の読みを返す */
export function getPlainReading(reading: string): string {
  let s = reading
    .replace(/\\\\/g, "\x03")
    .replace(/\\\|/g, "\x04")
    .replace(/\\\+/g, "\x05");
  s = s
    .replace(/\+\d+/g, "")
    .replace(/\+\*/g, "")
    .replace(/\+/g, "")
    .replace(/\|/g, "");
  return s.replace(/\x03/g, "\\").replace(/\x04/g, "|").replace(/\x05/g, "+");
}
