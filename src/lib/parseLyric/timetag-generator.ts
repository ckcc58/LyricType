/**
 * タイムタグデータ（TimeTagLine[]）からLRCテキストを生成する
 */

import { timeToTimeTag } from "./parse-chart";
import type { TimeTagChar, TimeTagLine } from "./timetag-parser";

/** charのtimes配列から最後の非null時刻を返す */
export function getLastTaggedTime(ch: TimeTagChar): number | null {
  for (let i = ch.times.length - 1; i >= 0; i--) {
    if (ch.times[i] !== null) return ch.times[i];
  }
  return null;
}

/** 指定位置より前で、タグ付き（times に非null がある）checkable 文字を探す */
export function findPrevTaggedChar(
  lineChars: TimeTagChar[],
  beforeIdx: number,
): TimeTagChar | null {
  for (let i = beforeIdx - 1; i >= 0; i--) {
    if (
      lineChars[i].checkCount > 0 &&
      getLastTaggedTime(lineChars[i]) !== null
    ) {
      return lineChars[i];
    }
  }
  return null;
}

/** TimeTagLine[] からLRCテキストを生成する */
export function generateLrcFromTimeTagData(lines: TimeTagLine[]): string {
  let result = "";
  lines.forEach(line => {
    line.chars.forEach(charData => {
      let startTt = Number.isFinite(charData.blockTime as number)
        ? timeToTimeTag(charData.blockTime!)
        : Number.isFinite(charData.times[0] as number) ? timeToTimeTag(charData.times[0]!) : "";
      let endTt = Number.isFinite(charData.endTime as number) ? timeToTimeTag(charData.endTime!) : "";
      result += startTt + charData.char + endTt;
    })
    result += "\n";
  })
  return result
};
