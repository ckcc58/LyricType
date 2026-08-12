// TimeTag 一括ツール (全削除 / 時間シフト)
import { tt } from "../../_state/timetag.svelte";
import { generateTtLrc } from "./utils";

type ToolCallbacks = {
  rebuildWaveformTagCache: () => void;
  drawWaveform: () => void;
  clearWaveformCaches: () => void; // primary/secondary/end の各キャッシュ配列をクリア
};

/** 全タイムタグ削除: すべての文字からタイミング情報を除去 (確認ダイアログあり / Undo 可能) */
export function toolRemoveAllTimeTags(cb: ToolCallbacks): void {
  if (!tt.lines.length) return;
  if (!confirm("すべてのタイムタグを削除します。よろしいですか？")) return;

  // 削除前の状態を snapshot として undoStack に積む (全削除も Undo/Redo 可能にする)
  tt.undoStack.push({ type: "snapshot", data: JSON.stringify(tt.lines) });
  if (tt.undoStack.length > 10000) tt.undoStack.shift();
  tt.redoStack = [];

  for (const line of tt.lines) {
    for (const ch of line.chars) {
      ch.times = Array(ch.checkCount).fill(null);
      ch.endTime = null;
      // checkCount=0 でタグを持つ文字 (blockTime) も消さないと削除漏れになる
      ch.blockTime = undefined;
    }
  }
  tt.lines = [...tt.lines]; // reactivity trigger
  tt.cursorLine = 0;
  tt.cursorChar = 0;
  tt.cursorCheck = 0;
  tt.lastTaggedLine = -1;
  tt.lastTaggedChar = -1;
  generateTtLrc();
  cb.clearWaveformCaches();
  cb.drawWaveform();
}

/**
 * 全チェック削除: 全文字のチェック (打鍵対象) を外す。タイムタグは削除しない。
 * 打ってあった先頭タグ (times の最初の非null) は blockTime に退避し、LRC 上の
 * タイムタグとして保持する (checkCount=0 + blockTime は既存の位置マーカー機構)。
 * ※ 漢字2音目以降のタグ (times[1..]) は LRC に表現できないため保持できない
 *   (LRC 往復と同じ挙動)。endTime はそのまま保持する。
 */
export function toolRemoveAllChecks(
  cb: Pick<ToolCallbacks, "rebuildWaveformTagCache">,
): void {
  if (!tt.lines.length) return;
  if (!confirm("すべてのチェックを削除します (タイムタグは保持されます)。よろしいですか？")) return;

  // Undo 用 snapshot (1回の Ctrl+Z で全て戻る)
  tt.undoStack.push({ type: "snapshot", data: JSON.stringify(tt.lines) });
  if (tt.undoStack.length > 10000) tt.undoStack.shift();
  tt.redoStack = [];

  for (const line of tt.lines) {
    for (const ch of line.chars) {
      if (ch.checkCount === 0) continue;
      const firstTag = ch.times.find((t) => t !== null);
      if (firstTag !== undefined && firstTag !== null) {
        ch.blockTime = firstTag;
      }
      ch.checkCount = 0;
      ch.times = [];
    }
  }
  tt.lines = [...tt.lines]; // reactivity trigger
  tt.cursorCheck = 0;
  tt.lastTaggedLine = -1;
  tt.lastTaggedChar = -1;
  generateTtLrc();
  cb.rebuildWaveformTagCache();
}

/** 全タイムタグ時間調整: tt.toolTimeAdjustValue 秒分すべてシフトする */
export function toolAdjustAllTimeTags(
  cb: Pick<ToolCallbacks, "rebuildWaveformTagCache">,
): void {
  if (!tt.lines.length || tt.toolTimeAdjustValue === 0) return;

  const offset = tt.toolTimeAdjustValue;
  for (const line of tt.lines) {
    for (const ch of line.chars) {
      for (let i = 0; i < ch.times.length; i++) {
        if (ch.times[i] != null && Number.isFinite(ch.times[i])) {
          ch.times[i] = Math.max(0, ch.times[i]! + offset);
        }
      }
      if (ch.endTime != null && Number.isFinite(ch.endTime)) {
        ch.endTime = Math.max(0, ch.endTime + offset);
      }
    }
  }

  tt.lines = [...tt.lines]; // reactivity trigger
  generateTtLrc();
  cb.rebuildWaveformTagCache();
}
