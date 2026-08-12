<!--
  メディアソース選択ダイアログ
  player.showSourceDialog が true のときに表示し、ユーザーがソースを選んだら
  player.pendingSourceCallback を呼び出してダイアログを閉じる。
-->
<script lang="ts">
  import { player, type DialogSource } from "../_state/player.svelte";

  // キーボード操作用のフォーカス位置
  let focusIdx = $state(0);
  let btnEls: (HTMLButtonElement | undefined)[] = $state([]);

  // ダイアログを開くたびに先頭を選択し直し、実 DOM にもフォーカスを移す
  $effect(() => {
    if (player.showSourceDialog) {
      focusIdx = 0;
      btnEls[0]?.focus();
    }
  });

  function selectSource(source: DialogSource): void {
    player.showSourceDialog = false;
    if (player.pendingSourceCallback) {
      player.pendingSourceCallback(source);
      player.pendingSourceCallback = null;
    }
  }

  function move(delta: number): void {
    const n = player.dialogSources.length;
    if (n === 0) return;
    focusIdx = (focusIdx + delta + n) % n; // 端で反対側へ回り込む
    btnEls[focusIdx]?.focus();
  }

  function handleKeydown(e: KeyboardEvent): void {
    switch (e.code) {
      case "ArrowDown":
      case "KeyK":
      case "Tab":
        if (e.code === "Tab" && e.shiftKey) {
          e.preventDefault();
          move(-1);
          return;
        }
        e.preventDefault();
        move(1);
        return;
      case "ArrowUp":
      case "KeyI":
        e.preventDefault();
        move(-1);
        return;
      case "Enter":
      case "Space":
        // ボタンにフォーカスがある場合はブラウザ既定のクリックに任せる
        if (document.activeElement?.tagName === "BUTTON") return;
        e.preventDefault();
        {
          const src = player.dialogSources[focusIdx];
          if (src) selectSource(src);
        }
        return;
      case "Digit1":
      case "Digit2":
      case "Digit3": {
        // 数字キーで直接選択
        e.preventDefault();
        const idx = Number(e.code.slice(5)) - 1;
        const src = player.dialogSources[idx];
        if (src) selectSource(src);
        return;
      }
    }
  }
</script>

<svelte:window onkeydown={player.showSourceDialog ? handleKeydown : undefined} />

{#if player.showSourceDialog}
  <div class="source-dialog-overlay" role="dialog">
    <div class="source-dialog">
      <div class="source-dialog-title">メディアソースを選択</div>
      {#each player.dialogSources as source, i}
        <button
          class="source-dialog-btn"
          class:focused={i === focusIdx}
          bind:this={btnEls[i]}
          onclick={() => selectSource(source)}
          onfocus={() => (focusIdx = i)}
        >
          <span class="source-num">{i + 1}</span>
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
      <div class="source-dialog-hint">↑↓ で選択 / Enter で決定 / 数字キーで直接選択</div>
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
  /* キーボードで選択中の項目 (フォーカスリングだけだと見えにくいため明示) */
  .source-dialog-btn.focused {
    background: #4a4a4a;
    border-color: #4a9eff;
    outline: none;
  }
  .source-num {
    display: inline-block;
    min-width: 16px;
    margin-right: 6px;
    color: #aaa;
    font-size: 12px;
    text-align: right;
  }
  .source-dialog-hint {
    margin-top: 4px;
    color: #aaa;
    font-size: 11px;
    text-align: center;
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
