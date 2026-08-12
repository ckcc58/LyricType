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
  /** プレビュー開始位置 (秒)。空文字なら「最初のタイムタグ時刻を自動採用」 */
  previewTime = $state("");
  tags: string[] = $state([]);
  tagInput = $state("");
  /**
   * 歌詞から自動判定した言語タグ (英語 / 英語&日本語)。未判定・該当なしは null。
   * 「判定結果が変わったときだけ付け替える」ための前回値で、
   * これが変わらない限りユーザーの手動での付け外しには手を出さない。
   */
  lastLanguageTag: string | null = $state(null);

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
