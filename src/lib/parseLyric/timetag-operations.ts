/**
 * タイムタグエディタのタグ付け操作
 */

import type { TimeTagLine } from "./timetag-parser";

/** カーソル位置 */
export type TtCursor = {
  line: number;
  char: number;
  check: number;
};

/** 直前にタグ付けした文字の位置 */
export type TtLastTagged = {
  line: number;
  char: number;
};

/** 次のチェック位置へ進む */
export function advanceToNextCheck(
  lines: TimeTagLine[],
  cursor: TtCursor,
): TtCursor {
  let { line, char, check } = cursor;
  check++;

  while (line < lines.length) {
    const lineData = lines[line];
    while (char < lineData.chars.length) {
      const ch = lineData.chars[char];
      if (ch.checkCount > 0 && check < ch.checkCount) {
        return { line, char, check };
      }
      char++;
      check = 0;
    }
    line++;
    char = 0;
    check = 0;
  }
  // 末尾に達した場合は元のカーソルを返す
  return cursor;
}

/** 前のチェック位置へ戻る */
export function retreatToPrevCheck(
  lines: TimeTagLine[],
  cursor: TtCursor,
): TtCursor {
  let { line, char, check } = cursor;
  check--;

  while (line >= 0) {
    while (char >= 0) {
      const ch = lines[line]?.chars[char];
      if (ch && ch.checkCount > 0 && check >= 0) {
        return { line, char, check };
      }
      char--;
      if (char >= 0 && lines[line]?.chars[char]) {
        check = lines[line].chars[char].checkCount - 1;
      }
    }
    line--;
    if (line >= 0) {
      char = lines[line].chars.length - 1;
      if (char >= 0) check = lines[line].chars[char].checkCount - 1;
    }
  }
  // 先頭に達した場合は元のカーソルを返す
  return cursor;
}

/** タグ付け: 現在のチェック位置に時刻を設定し、次へ進む */
export function tagCurrentCheck(
  lines: TimeTagLine[],
  cursor: TtCursor,
  time: number,
  offset: number = 0,
): { cursor: TtCursor; lastTagged: TtLastTagged } | null {
  const ch = lines[cursor.line]?.chars[cursor.char];
  if (!ch || ch.checkCount <= 0 || cursor.check >= ch.checkCount) return null;

  const adjustedTime = Math.max(0, time + offset);
  ch.times[cursor.check] = adjustedTime;
  const lastTagged: TtLastTagged = { line: cursor.line, char: cursor.char };
  const newCursor = advanceToNextCheck(lines, cursor);

  return { cursor: newCursor, lastTagged };
}

/** エンドタイム設定（Enter用）: lastTagged から次のcheckableまで走査し、isEndCheck に endTime を設定 */
export function setEndTime(
  lines: TimeTagLine[],
  lastTagged: TtLastTagged,
  time: number,
): { li: number; ci: number; prevEndTime: number | null } | null {
  const ch = lines[lastTagged.line]?.chars[lastTagged.char];
  if (!ch || ch.checkCount <= 0) return null;

  const lineChars = lines[lastTagged.line].chars;
  for (let i = lastTagged.char; i < lineChars.length; i++) {
    if (i > lastTagged.char && lineChars[i].checkCount > 0) break;
    if (lineChars[i].isEndCheck) {
      const prevEndTime = lineChars[i].endTime;
      lineChars[i].endTime = time;
      return { li: lastTagged.line, ci: i, prevEndTime };
    }
  }
  // isEndCheck が見つからない場合、タグ付けした文字自体に設定
  const prevEndTime = ch.endTime;
  ch.endTime = time;
  return { li: lastTagged.line, ci: lastTagged.char, prevEndTime };
}

/** Backspace: 前のチェック位置に戻り、タグを削除 */
export function deleteCurrentTag(
  lines: TimeTagLine[],
  cursor: TtCursor,
): TtCursor {
  const newCursor = retreatToPrevCheck(lines, cursor);
  const ch = lines[newCursor.line]?.chars[newCursor.char];
  if (ch) {
    ch.times[newCursor.check] = null;
  }
  return newCursor;
}

/** Check mode: チェック数を増やす */
export function incrementCheck(lines: TimeTagLine[], cursor: TtCursor): boolean {
  const ch = lines[cursor.line]?.chars[cursor.char];
  if (ch && ch.checkCount < 7) {
    // checkCount は最大 7 (1行目 1〜4 / 2行目 5〜7)
    ch.checkCount++;
    ch.times.push(null);
    return true;
  }
  return false;
}

/** Check mode: チェック数を減らす */
export function decrementCheck(
  lines: TimeTagLine[],
  cursor: TtCursor,
): boolean {
  const ch = lines[cursor.line]?.chars[cursor.char];
  if (ch && ch.checkCount > 0) {
    ch.checkCount--;
    ch.times.pop();
    return true;
  }
  return false;
}

/** Check mode: チェックを全削除 */
export function deleteAllChecks(
  lines: TimeTagLine[],
  cursor: TtCursor,
): boolean {
  const ch = lines[cursor.line]?.chars[cursor.char];
  if (ch && ch.checkCount > 0) {
    ch.checkCount = 0;
    ch.times = [];
    ch.endTime = null;
    return true;
  }
  return false;
}

/** Alt+Arrow: タグ時刻を微調整 */
export function adjustTagTime(
  lines: TimeTagLine[],
  cursor: TtCursor,
  delta: number,
): boolean {
  const ch = lines[cursor.line]?.chars[cursor.char];
  if (ch && ch.times[cursor.check] !== null) {
    ch.times[cursor.check] = Math.max(0, ch.times[cursor.check]! + delta);
    return true;
  }
  return false;
}
