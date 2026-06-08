<!--
  レイテンシ測定ダイアログ
  player.showLatencyTest が true のときに表示し、タップ結果から平均遅延を算出する。
-->
<script lang="ts">
  import { player } from "../_state/player.svelte";
  import { applyLatency, closeLatencyTest } from "../_lib/latency/measure";
  import { settings } from "$lib/settings";
</script>

{#if player.showLatencyTest}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="ttOverlay" onclick={closeLatencyTest}>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="latencyPanel" onclick={(e) => e.stopPropagation()}>
      <h3>遅延測定</h3>
      <div class="latencyBeat" class:on={player.latencyBeatOn}>●</div>
      <p class="latencyHint">
        ビートに合わせて Space / V / B / N を押してください（Escで閉じる）
      </p>
      <div class="latencyResults">
        {#if player.latencyTaps.length > 0 && player.latencyTaps.length <= 3}
          <div class="latencyDivider">慣れ期間 ({player.latencyTaps.length}/3)</div>
        {/if}
        {#if player.latencyTaps.length > 3 && player.latencyDisplayStart < 3}
          <div class="latencyDivider">--- 測定中 ---</div>
        {/if}
        {#each player.latencyTaps.slice(Math.max(player.latencyDisplayStart, 3)) as tap, di}
          {@const i = Math.max(player.latencyDisplayStart, 3) + di}
          <div>
            {i + 1}回目: {tap >= 0 ? "+" : ""}{tap.toFixed(3)}s
          </div>
        {/each}
      </div>
      <div class="latencyAvg">
        {player.latencyAvg !== null && !Number.isNaN(player.latencyAvg)
          ? `平均遅延: ${player.latencyAvg >= 0 ? "+" : ""}${player.latencyAvg.toFixed(3)}s`
          : "平均遅延: ---"}
      </div>
      <div class="latencyOffset">
        {player.latencyAvg !== null && !Number.isNaN(player.latencyAvg)
          ? `適用値: ${-player.latencyAvg >= 0 ? "+" : ""}${(-player.latencyAvg).toFixed(2)}s`
          : "適用値: ---"}
      </div>
      <div class="latencyCurrentOffset">
        現在の補正: {$settings.timeOffset >= 0
          ? "+"
          : ""}{$settings.timeOffset.toFixed(2)}s
      </div>
      <div class="latencyActions">
        <button
          class="ttBtn"
          onclick={applyLatency}
          disabled={player.latencyAvg === null}>適用して閉じる</button
        >
      </div>
    </div>
  </div>
{/if}

<style>
  .ttOverlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 500;
  }
  .latencyPanel {
    background: #222;
    border: 1px solid #555;
    border-radius: 8px;
    padding: 24px;
    width: 360px;
    min-height: 380px;
    text-align: center;
    display: flex;
    flex-direction: column;
  }
  .latencyPanel h3 {
    margin: 0 0 12px;
    font-size: 16px;
    color: #eee;
  }
  .latencyBeat {
    font-size: 48px;
    color: #555;
    transition: color 0.05s;
  }
  .latencyBeat.on {
    color: #0f0;
  }
  .latencyHint {
    color: #888;
    font-size: 13px;
    margin: 8px 0;
  }
  .latencyResults {
    font-family: monospace;
    font-size: 12px;
    color: #ccc;
    height: 100px;
    overflow-y: auto;
    margin: 12px 0;
    text-align: left;
    padding: 0 16px;
  }
  .latencyDivider {
    color: #888;
    text-align: center;
    margin: 4px 0;
    font-size: 11px;
  }
  .latencyAvg {
    font-size: 16px;
    font-family: monospace;
    color: #fff;
    margin: 12px 0;
  }
  .latencyOffset {
    font-size: 13px;
    font-family: monospace;
    color: #8cf;
    margin-bottom: 4px;
  }
  .latencyCurrentOffset {
    font-size: 12px;
    font-family: monospace;
    color: #888;
    margin: 8px 0;
  }
  .latencyActions {
    display: flex;
    gap: 8px;
    justify-content: center;
  }
</style>
