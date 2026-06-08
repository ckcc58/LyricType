<!--
  メディアソース選択ダイアログ
  player.showSourceDialog が true のときに表示し、ユーザーがソースを選んだら
  player.pendingSourceCallback を呼び出してダイアログを閉じる。
-->
<script lang="ts">
  import { player, type DialogSource } from "../_state/player.svelte";

  function selectSource(source: DialogSource): void {
    player.showSourceDialog = false;
    if (player.pendingSourceCallback) {
      player.pendingSourceCallback(source);
      player.pendingSourceCallback = null;
    }
  }
</script>

{#if player.showSourceDialog}
  <div class="source-dialog-overlay" role="dialog">
    <div class="source-dialog">
      <div class="source-dialog-title">メディアソースを選択</div>
      {#each player.dialogSources as source}
        <button
          class="source-dialog-btn"
          onclick={() => selectSource(source)}
        >
          <span class="source-type-tag"
            >{source.type === "audio"
              ? "音声"
              : source.type === "video"
                ? "動画"
                : "YouTube"}</span
          >
          {source.label}
        </button>
      {/each}
    </div>
  </div>
{/if}

<style>
  .source-dialog-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }
  .source-dialog {
    background: #2a2a2a;
    border-radius: 12px;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 240px;
  }
  .source-dialog-title {
    color: #eee;
    font-size: 16px;
    font-weight: bold;
    text-align: center;
    margin-bottom: 4px;
  }
  .source-dialog-btn {
    background: #3a3a3a;
    color: #eee;
    border: 1px solid #555;
    border-radius: 8px;
    padding: 12px 16px;
    font-size: 15px;
    cursor: pointer;
    text-align: left;
  }
  .source-dialog-btn:hover {
    background: #4a4a4a;
    border-color: #888;
  }
  .source-type-tag {
    display: inline-block;
    min-width: 48px;
    padding: 1px 6px;
    margin-right: 8px;
    font-size: 11px;
    color: #aaa;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 3px;
    text-align: center;
  }
</style>
