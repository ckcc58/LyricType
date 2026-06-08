// TimeTag エディタの中央ストア
import type { TimeTagLine } from "$lib/parseLyric/timetag-parser";

export type UndoOp =
  | { type: "setTime"; li: number; ci: number; ki: number; prev: number | null; next: number | null }
  | { type: "setEndTime"; li: number; ci: number; prev: number | null; next: number | null }
  | {
      type: "setCheck";
      li: number;
      ci: number;
      prevCount: number;
      prevTimes: (number | null)[];
      nextCount: number;
      nextTimes: (number | null)[];
      prevEndTime: number | null;
      nextEndTime: number | null;
    };
export type UndoItem = UndoOp | { type: "snapshot"; data: string };

class TimeTagState {
  lines: TimeTagLine[] = $state([]);
  cursorLine = $state(0);
  cursorChar = $state(0);
  cursorCheck = $state(0); // within-char check index for tagging
  pendingEndCheckKey: string | null = $state(null);
  pendingEndCheckLine = $state(0);
  pendingEndCheckChar = $state(0);
  editorMode: "timetag" | "text" = $state("timetag");
  autoScroll = $state(false);
  playbackRate = $state(1.0);
  showShortcuts = $state(false);
  showModeMenu = $state(false);
  undoStack: UndoItem[] = $state([]);
  redoStack: UndoItem[] = $state([]);
  lrcText = $state(""); // for text editor mode
  displayTime = $state(0);
  lastReplKey = $state(""); // repl content at last buildTimeTagLines
  lastTaggedLine = $state(-1); // 直前にタグ付けした文字の行
  lastTaggedChar = $state(-1); // 直前にタグ付けした文字の位置

  // ルビ編集ポップアップ
  rubyEditLine = $state(-1);
  rubyEditChar = $state(-1);
  rubyEditValue = $state("");
  rubyEditKey = $state("");
  rubyEditOrigKey = $state("");

  // ツール: 全タイムタグ調整
  toolTimeAdjustValue = $state(0);
}

export const tt = new TimeTagState();
