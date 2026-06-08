// TimeTag のアトミック編集操作 + Undo/Redo (behavior: tt state mutation あり)
// 波形キャッシュの再構築は呼び出し側がコールバックで提供する。
import { tt } from "../../_state/timetag.svelte";
import type { UndoOp, UndoItem } from "../../_state/timetag.svelte";
import { generateTtLrc } from "./utils";

/** 編集操作を undoStack に記録 (redoStack はクリア)。最大1万件。 */
export function ttRecordOp(op: UndoOp): void {
  tt.undoStack.push(op);
  if (tt.undoStack.length > 10000) tt.undoStack.shift();
  tt.redoStack = [];
}

/** UndoOp を tt.lines に対して適用する (undo/redo どちら方向にも対応) */
export function applyOp(op: UndoOp, dir: "undo" | "redo"): void {
  const ch = tt.lines[op.li]?.chars[op.ci];
  if (!ch) return;
  if (op.type === "setTime") {
    ch.times[op.ki] = dir === "undo" ? op.prev : op.next;
  } else if (op.type === "setEndTime") {
    ch.endTime = dir === "undo" ? op.prev : op.next;
  } else {
    ch.checkCount = dir === "undo" ? op.prevCount : op.nextCount;
    ch.times = [...(dir === "undo" ? op.prevTimes : op.nextTimes)];
    ch.endTime = dir === "undo" ? op.prevEndTime : op.nextEndTime;
  }
}

/** Undo: undoStack 末尾を取り出して逆方向に適用 */
export function ttUndo(rebuildWaveformTagCache: () => void): void {
  const item = tt.undoStack[tt.undoStack.length - 1];
  if (!item) return;
  tt.undoStack = tt.undoStack.slice(0, -1);
  if (item.type === "snapshot") {
    const snap: UndoItem = {
      type: "snapshot",
      data: JSON.stringify(tt.lines),
    };
    tt.redoStack = [...tt.redoStack, snap].slice(-10000);
    tt.lines = JSON.parse(item.data);
  } else {
    tt.redoStack = [...tt.redoStack, item].slice(-10000);
    applyOp(item, "undo");
  }
  rebuildWaveformTagCache();
  generateTtLrc();
}

/** Redo: redoStack 末尾を取り出して順方向に適用 */
export function ttRedo(rebuildWaveformTagCache: () => void): void {
  const item = tt.redoStack[tt.redoStack.length - 1];
  if (!item) return;
  tt.redoStack = tt.redoStack.slice(0, -1);
  if (item.type === "snapshot") {
    const snap: UndoItem = {
      type: "snapshot",
      data: JSON.stringify(tt.lines),
    };
    tt.undoStack = [...tt.undoStack, snap].slice(-10000);
    tt.lines = JSON.parse(item.data);
  } else {
    tt.undoStack = [...tt.undoStack, item].slice(-10000);
    applyOp(item, "redo");
  }
  rebuildWaveformTagCache();
  generateTtLrc();
}
