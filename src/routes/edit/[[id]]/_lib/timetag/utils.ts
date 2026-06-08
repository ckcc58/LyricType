// TimeTag 編集向けの小ユーティリティ群
// - 純関数 (formatTime, ttIsSpace, ttEndCheckActive, ttLineEndActive)
// - state 読み/書きの薄いラッパ (ttIsOnEndCheck, ttEndCheckTime, applyTtCursor, generateTtLrc)
import {
  type TimeTagChar,
  type TimeTagLine,
} from "$lib/parseLyric/timetag-parser";
import { findPrevTaggedChar, generateLrcFromTimeTagData } from "$lib/parseLyric/timetag-generator";
import type { TtCursor } from "$lib/parseLyric/timetag-operations";
import { tt } from "../../_state/timetag.svelte";

/** 秒数を MM:SS:CS 形式に整形 */
export function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.floor((sec % 1) * 100);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}:${String(cs).padStart(2, "0")}`;
}

/** 半角/全角スペース判定 */
export function ttIsSpace(ch: TimeTagChar): boolean {
  return /^[\s　]$/.test(ch.char);
}

/** beforeIdx より前にタグ付き文字があるか */
export function ttEndCheckActive(
  lineChars: TimeTagChar[],
  beforeIdx: number,
): boolean {
  return findPrevTaggedChar(lineChars, beforeIdx) !== null;
}

/** 行末 endTime マーカーをアクティブにすべきか */
export function ttLineEndActive(lineChars: TimeTagChar[]): boolean {
  return findPrevTaggedChar(lineChars, lineChars.length) !== null;
}

/** カーソルがエンドチェック位置にあるか判定 */
export function ttIsOnEndCheck(): boolean {
  const line = tt.lines[tt.cursorLine];
  if (!line) return false;
  const ci = tt.cursorChar;
  if (ci === line.chars.length) return true;
  const ch = line.chars[ci];
  return ch != null && ttIsSpace(ch) && !ch.hideEndMark;
}

/** エンドチェック位置に対応する endTime を取得 */
export function ttEndCheckTime(): number | null {
  const line = tt.lines[tt.cursorLine];
  if (!line) return null;
  return line.chars[tt.cursorChar - 1]?.endTime ?? null;
}

/** カーソル状態を TtCursor から反映する */
export function applyTtCursor(c: TtCursor): void {
  tt.cursorLine = c.line;
  tt.cursorChar = c.char;
  tt.cursorCheck = c.check;
  tt.autoScroll = true;
}

/** tt.lines から LRC を再生成して tt.lrcText に書き戻す */
export function generateTtLrc(): void {
  tt.lrcText = generateLrcFromTimeTagData(tt.lines);
}

// 再エクスポート: 内部実装の都合で隣接するモジュールから使えるように
export type { TimeTagChar, TimeTagLine };
