// 譜面投稿フォームの中央ストア

class SubmitState {
  // 編集モード判定
  editingChartId: number | null = $state(null);
  editingUploaderId: number | null = $state(null);

  // ロード時のメタデータ (フォーム自動入力に使う)
  loadedTitle = $state("");

  // 設定タブ内のサブタブ
  settingsTab: "submit" | "tools" = $state("submit");

  // ダイアログ表示
  showSubmitDialog = $state(false);

  // フォーム入力
  title = $state("");
  artist = $state("");
  description = $state("");
  ytVideoId = $state("");
  source = $state("");
  tags: string[] = $state([]);
  tagInput = $state("");

  // 送信状態
  isSubmitting = $state(false);
  submitError = $state("");
  submittedChartId: number | null = $state(null);
  /** 投稿/更新成功直後に true → 2 秒後に false (成功メッセージ表示用) */
  justSubmitted = $state(false);
  /** 「保存済み」状態のスナップショット。未保存変更検知用 */
  lastSavedSnapshot: string | null = $state(null);

  // YouTube メタデータ自動入力
  isAutoFilling = $state(false);
  autoFillError = $state("");
  suggestedTags: string[] = $state([]);
  lastAutoFilledId = $state("");
}

export const submit = new SubmitState();
