<!--
  Settings panel の「ツール」タブ
  - タイムタグ補正 (timeOffset スライダー + 遅延測定起動)
  - 全タイムタグ時間調整 (秒数シフト)
  - 全タイムタグ削除
-->
<script lang="ts">
  import { tt } from "../_state/timetag.svelte";
  import { player } from "../_state/player.svelte";
  import { settings, updateSetting } from "$lib/settings";
  import {
    resetLatencyOffset,
    startLatencyTest,
  } from "../_lib/latency/measure";
  import {
    toolRemoveAllTimeTags as toolRemoveAllTimeTagsCore,
    toolAdjustAllTimeTags as toolAdjustAllTimeTagsCore,
  } from "../_lib/timetag/tools";

  type Props = {
    /** 波形タグキャッシュ再構築 (時間調整後に呼ばれる) */
    rebuildWaveformTagCache: () => void;
    /** 波形再描画 (全削除後に呼ばれる) */
    drawWaveform: () => void;
    /** 波形タグキャッシュ全クリア */
    clearWaveformCaches: () => void;
  };
  let {
    rebuildWaveformTagCache,
    drawWaveform,
    clearWaveformCaches,
  }: Props = $props();

  function handleAdjust(): void {
    toolAdjustAllTimeTagsCore({ rebuildWaveformTagCache });
  }
  function handleRemoveAll(): void {
    toolRemoveAllTimeTagsCore({
      rebuildWaveformTagCache,
      drawWaveform,
      clearWaveformCaches,
    });
  }
</script>

<div class="toolsPanel">
  <!-- タイムタグ補正 -->
  <div class="toolItem">
    <div
      class="toolInfo"
      style:flex-direction="row"
      style:align-items="center"
    >
      <span class="toolName">タイムタグ補正</span>
      <button
        class="toolBtn"
        style:margin-left="auto"
        onclick={resetLatencyOffset}>リセット</button
      >
      <button
        class="toolBtn"
        onclick={() => {
          player.showLatencyTest = true;
          startLatencyTest();
        }}>測定</button
      >
    </div>
    <div class="sliderRow">
      <input
        type="range"
        class="sliderInput"
        min="-1"
        max="1"
        step="0.01"
        value={$settings.timeOffset}
        oninput={(e) =>
          updateSetting(
            "timeOffset",
            parseFloat((e.currentTarget as HTMLInputElement).value),
          )}
      />
      <span class="sliderValue"
        >{$settings.timeOffset >= 0
          ? "+"
          : ""}{$settings.timeOffset.toFixed(2)}s</span
      >
    </div>
  </div>
  <div class="toolItem">
    <div
      class="toolInfo"
      style:flex-direction="row"
      style:align-items="center"
    >
      <span class="toolName">全タイムタグ時間調整</span>
      <span class="toolInlineDesc">すべてのタイムタグをシフト</span>
    </div>
    <div class="toolAction">
      <input
        type="number"
        class="toolTimeInput"
        step="0.1"
        bind:value={tt.toolTimeAdjustValue}
        placeholder="秒"
      />
      <span class="toolTimeUnit">秒</span>
      <button
        class="toolBtn"
        onclick={handleAdjust}
        disabled={!tt.lines.length || tt.toolTimeAdjustValue === 0}>実行</button
      >
    </div>
  </div>
  <div class="toolItem">
    <div class="toolInfo">
      <span class="toolName">全タイムタグ削除</span>
      <span class="toolDesc"
        >すべての文字からタイミング情報を削除します</span
      >
    </div>
    <button
      class="toolBtn danger"
      onclick={handleRemoveAll}
      disabled={!tt.lines.length}>実行</button
    >
  </div>
</div>

<style>
  .toolsPanel {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 4px 0;
  }
  .toolItem {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 12px;
    background: #1f2024;
    border-radius: 6px;
    border: 1px solid #2c2d31;
    flex-wrap: wrap;
  }
  .toolItem:hover {
    border-color: #3a3b3f;
  }
  .toolInfo {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1 1 auto;
  }
  .toolInlineDesc {
    margin-left: 8px;
    color: #666;
    font-size: 11px;
  }
  .toolName {
    color: #ddd;
    font-size: 0.8rem;
    font-weight: 600;
  }
  .toolDesc {
    color: #777;
    font-size: 0.65rem;
    line-height: 1.3;
  }
  .toolAction {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    flex-wrap: wrap;
  }
  .sliderRow {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    flex-basis: 100%;
  }
  .sliderInput {
    flex: 1 1 auto;
    min-width: 0;
  }
  .sliderValue {
    color: #aaa;
    font-size: 0.75rem;
    min-width: 48px;
    text-align: right;
    flex-shrink: 0;
  }
  .toolTimeInput {
    width: 64px;
    padding: 3px 6px;
    background: #111;
    color: #ddd;
    border: 1px solid #444;
    border-radius: 4px;
    font-size: 0.75rem;
    text-align: right;
  }
  .toolTimeInput:focus {
    outline: none;
    border-color: #4a9eff;
  }
  .toolTimeUnit {
    color: #777;
    font-size: 0.7rem;
  }
  .toolBtn {
    flex-shrink: 0;
    padding: 5px 14px;
    background: transparent;
    color: #d0d0d0;
    border: 1px solid #4a4d54;
    border-radius: 4px;
    font-size: 0.72rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
  }
  .toolBtn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.05);
    border-color: #6a6d74;
    color: #fff;
  }
  .toolBtn.danger {
    border-color: #6b3a3a;
    color: #c97676;
  }
  .toolBtn.danger:hover:not(:disabled) {
    background: rgba(193, 88, 88, 0.08);
    border-color: #934747;
    color: #d88a8a;
  }
  .toolBtn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
</style>
