<!--
  ファイル/フォルダドロップ時のオーバーレイ表示
  ui.isDragOver が true のときに半透明のフルスクリーンガイドを出す。
-->
<script lang="ts">
  import { ui } from "../_state/ui.svelte";
</script>

{#if ui.isDragOver}
  <div class="dropOverlay">
    <div class="dropOverlayContent">フォルダをここにドロップ</div>
  </div>
{/if}

<style>
  .dropOverlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 112, 243, 0.15);
    border: 3px dashed #0070f3;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    pointer-events: none;
  }
  .dropOverlayContent {
    background: rgba(0, 0, 0, 0.8);
    color: #0070f3;
    padding: 30px 60px;
    border-radius: 12px;
    font-size: 24px;
    font-weight: bold;
  }
</style>
