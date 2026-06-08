// UI 全般 (タブ/ドラッグ&ドロップ/グローバル状態)

class UiState {
  // ファイル処理中フラグ
  isProcessing = $state(false);

  // ドラッグ&ドロップ
  isDragOver = $state(false);
  lastFolderHandle: FileSystemDirectoryHandle | null = $state(null);

  // 修飾キー
  shiftHeld = $state(false);

  // メインタブ
  activeTab: "repl" | "timetag" | "lrc" = $state("timetag");
}

export const ui = new UiState();
