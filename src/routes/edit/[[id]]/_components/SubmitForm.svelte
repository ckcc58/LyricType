<!--
  Settings panel の「情報&投稿」タブ
  - フォルダオープンボタン (隠し input fallback 含む)
  - YouTube Video ID 入力 + 自動入力ボタン
  - 曲名 / アーティスト / ソース / コメント
  - タグ入力 (presets + AI suggest)
  - 投稿ボタン + チェックボタン + 譜面ページへのリンク
-->
<script lang="ts">
  import { page } from "$app/stores";
  import { chart } from "../_state/chart.svelte";
  import { submit } from "../_state/submit.svelte";
  import { extractYouTubeId } from "../_lib/submit/youtube-url";
  import {
    addTag,
    removeTag,
    submitChart,
  } from "../_lib/submit/submit-chart";

  type TtRegenCallbacks = {
    syncLrcToTimeTagLines: () => void;
    generateTtLrc: () => void;
  };

  type Props = {
    /** YouTube Video ID から動画読み込み + 自動入力 */
    loadYouTubeFromSubmitId: () => void;
    /** TT 再生成コールバック (submitChart に渡す) */
    ttRegenCb: TtRegenCallbacks;
  };
  let {
    loadYouTubeFromSubmitId,
    ttRegenCb,
  }: Props = $props();

  let isOwner = $derived(
    submit.editingChartId !== null &&
      $page.data.profile &&
      ($page.data.canEditChart === true || submit.editingUploaderId === $page.data.profile?.id),
  );
  let canSubmit = $derived(
    submit.editingChartId === null ? !!$page.data.profile : isOwner,
  );

  // 投稿ボタンが押せない理由（disabled の無言化を防ぐ）
  let disabledReason = $derived.by(() => {
    if (submit.editingChartId === null && !$page.data.profile)
      return "投稿するにはログインが必要です";
    if (submit.editingChartId !== null && !isOwner)
      return "譜面は投稿者本人のみ更新できます";
    if (!chart.lrcContent.trim()) return "歌詞（LRC）が必要です";
    if (!/^[A-Za-z0-9_-]{11}$/.test(submit.ytVideoId))
      return "YouTube Video ID を入力してください";
    if (!submit.title.trim()) return "曲名を入力してください";
    if (!submit.artist.trim()) return "アーティスト名を入力してください";
    return "";
  });
  let submitStatusMessage = $derived(
    submit.submitError ||
      (!submit.isSubmitting && !submit.justSubmitted ? disabledReason : ""),
  );
</script>

<!-- フォルダを開くボタンは +page.svelte の tabBar に移動済み -->

<!-- YouTube Video ID -->
<label class="submitField">
  <span class="submitLabel"
    >YouTube Video ID <span class="required">*</span>
    {#if submit.isAutoFilling}<span class="autoFillStatus fetching"
        >取得中...</span
      >
    {:else if submit.autoFillError}<span class="autoFillStatus err">!</span
      >
    {/if}
  </span>
  <div class="ytIdRow">
    <input
      type="text"
      bind:value={submit.ytVideoId}
      maxlength="100"
      placeholder="動画IDまたはURL"
      oninput={(e) => {
        const val = (e.target as HTMLInputElement).value;
        if (val.includes("youtube") || val.includes("youtu.be")) {
          const extracted = extractYouTubeId(val);
          if (extracted) submit.ytVideoId = extracted;
        }
        submit.autoFillError = "";
        submit.lastAutoFilledId = "";
        submit.suggestedTags = [];
      }}
    />
    <button
      class="loadYtBtn"
      onclick={loadYouTubeFromSubmitId}
      title="YouTube動画を読み込む">読み込み</button
    >
  </div>
  {#if submit.autoFillError}
    <span class="submitHint error">{submit.autoFillError}</span>
  {/if}
  {#if submit.ytVideoId && !/^[A-Za-z0-9_-]{11}$/.test(submit.ytVideoId)}
    <span class="submitHint warn">11文字の動画IDを入力してください</span>
  {/if}
</label>

<!-- 曲名 / アーティスト -->
<div class="submitRow">
  <label class="submitField">
    <span class="submitLabel">曲名 <span class="required">*</span></span>
    <input
      type="text"
      bind:value={submit.title}
      maxlength="200"
      placeholder="曲名"
    />
  </label>
  <label class="submitField">
    <span class="submitLabel"
      >アーティスト <span class="required">*</span></span
    >
    <input
      type="text"
      bind:value={submit.artist}
      maxlength="200"
      placeholder="アーティスト名"
    />
  </label>
</div>

<!-- ソース / コメント -->
<div class="submitRow">
  <label class="submitField">
    <span class="submitLabel">ソース</span>
    <input
      type="text"
      bind:value={submit.source}
      maxlength="200"
      placeholder="アニメ・ゲーム名など"
    />
  </label>
  <label class="submitField">
    <span class="submitLabel">コメント</span>
    <input type="text" bind:value={submit.description} maxlength="2000" />
  </label>
</div>

<!-- タグ -->
<div class="submitField">
  <span class="submitLabel">タグ</span>
  <div class="tagInputArea">
    {#each submit.tags as tag}
      <span class="tagBadge"
        >{tag}<button
          type="button"
          class="tagRemove"
          onclick={() => removeTag(tag)}>×</button
        ></span
      >
    {/each}
    <input
      class="tagInlineInput"
      type="text"
      bind:value={submit.tagInput}
      maxlength="50"
      placeholder="タグを追加 {submit.tags.length} / 10"
      disabled={submit.tags.length >= 10}
      onkeydown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          addTag(submit.tagInput);
        }
      }}
    />
  </div>
  <div class="submitValidationSlot" class:hasMessage={!!submitStatusMessage}>
    {submitStatusMessage}
  </div>
</div>

<div class="submitActions">
  <button
    class="submitPanelBtn primary"
    onclick={() => submitChart(ttRegenCb)}
    disabled={submit.isSubmitting ||
      submit.justSubmitted ||
      !canSubmit ||
      !submit.title.trim() ||
      !submit.artist.trim() ||
      !chart.lrcContent.trim() ||
      !/^[A-Za-z0-9_-]{11}$/.test(submit.ytVideoId)}
  >
    {#if submit.isSubmitting}
      {submit.editingChartId !== null ? "更新中..." : "投稿中..."}
    {:else if submit.justSubmitted}
      {submit.editingChartId !== null ? "更新しました" : "投稿しました"}
    {:else}
      {submit.editingChartId !== null ? "更新する" : "投稿する"}
    {/if}
  </button>
  {#if submit.submittedChartId !== null || submit.editingChartId !== null}
    <a
      href="/chart/{submit.submittedChartId ?? submit.editingChartId}"
      class="submitPanelBtn goToChartBtn"
    >
      譜面ページへ
    </a>
  {/if}
</div>

<style>
  .settingsRow {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .ytIdRow {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .ytIdRow input {
    flex: 1;
    min-width: 0;
  }
  .loadYtBtn {
    background: #c00;
    color: #fff;
    border: none;
    border-radius: 4px;
    padding: 4px 8px;
    cursor: pointer;
    font: inherit;
    font-size: 12px;
    white-space: nowrap;
  }
  .loadYtBtn:hover {
    background: #e00;
  }
  /* 投稿フォーム */
  .submitField {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .submitField span {
    color: #aaa;
    font-size: 0.75rem;
  }
  .submitField .required {
    color: #ff6b6b;
  }
  .submitField input {
    padding: 6px 8px;
    border-radius: 5px;
    border: 1px solid #444;
    background: #2a2a2a;
    color: #ddd;
    font-size: 0.8rem;
  }
  .submitHint {
    font-size: 0.75rem;
    color: #888;
    padding: 4px 0;
  }
  .submitHint.warn {
    color: #ffa726;
  }
  .submitHint.error {
    color: #ff6b6b;
  }
  .submitHint.disabledReason {
    color: #888;
    text-align: center;
  }
  .submitPanelBtn {
    display: block;
    box-sizing: border-box;
    width: 100%;
    padding: 8px;
    border-radius: 6px;
    border: none;
    cursor: pointer;
    font-size: 0.85rem;
    font-family: inherit;
    line-height: 1.2;
    text-align: center;
    text-decoration: none;
    background: #333;
    color: #ccc;
    margin-top: 8px;
  }
  .submitPanelBtn:hover {
    background: #444;
  }
  .submitPanelBtn.primary {
    background: #4a9eff;
    color: #fff;
  }
  .submitPanelBtn.primary:hover:not(:disabled) {
    background: #3a8eef;
  }
  .submitPanelBtn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  /* 投稿ボタン + 譜面ページへリンクを横並び 2 列。
     投稿前から半分サイズで、右半分は譜面ページボタンが出るまで空欄 */
  .submitActions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-top: 8px;
  }
  .submitActions .submitPanelBtn {
    width: auto;
    margin-top: 0;
  }
  /* 投稿後に出現する「譜面ページへ」ボタン */
  .goToChartBtn {
    background: #2a7a2a !important;
    color: #fff !important;
    font-weight: 600;
  }
  .goToChartBtn:hover {
    background: #1e5e1e !important;
  }
  .submitLabel {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #aaa;
    font-size: 0.75rem;
  }
  .autoFillStatus {
    font-size: 0.68rem;
    font-weight: normal;
  }
  .autoFillStatus.fetching {
    color: #888;
  }
  .autoFillStatus.err {
    color: #ef5350;
  }
  .submitRow {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 8px;
    margin-bottom: 0;
  }
  .submitRow .submitField {
    margin-bottom: 0;
  }
  .tagInputArea {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    padding: 5px 7px;
    border: 1px solid #444;
    border-radius: 5px;
    background: #2a2a2a;
    min-height: 32px;
    cursor: text;
  }
  .tagInlineInput {
    flex: 1;
    min-width: 80px;
    background: transparent;
    border: none;
    outline: none;
    color: #ddd;
    font-size: 0.8rem;
    padding: 0;
  }
  .tagInlineInput:disabled {
    cursor: not-allowed;
    opacity: 0.4;
  }
  .tagBadge {
    background: #1e3a4a;
    color: #8ab4d4;
    font-size: 0.72rem;
    padding: 2px 6px;
    border-radius: 4px;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    white-space: nowrap;
  }
  .tagRemove {
    background: none;
    border: none;
    color: #8ab4d4;
    cursor: pointer;
    padding: 0;
    font-size: 0.75rem;
    line-height: 1;
    opacity: 0.7;
  }
  .tagRemove:hover {
    opacity: 1;
  }
  .submitValidationSlot {
    min-height: 28px;
    margin-top: 6px;
    padding: 4px 0;
    box-sizing: border-box;
    color: #ff6b6b;
    font-size: 0.75rem;
    line-height: 1.35;
  }
  .submitValidationSlot:not(.hasMessage) {
    visibility: hidden;
  }
</style>
