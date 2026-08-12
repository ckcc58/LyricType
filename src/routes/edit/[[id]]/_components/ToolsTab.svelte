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
    toolRemoveAllChecks as toolRemoveAllChecksCore,
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

  /** 全タイムタグ時間調整の値を delta 秒ずらす (浮動小数の誤差が出ないよう丸める) */
  function stepAdjust(delta: number): void {
    const next = (Number(tt.toolTimeAdjustValue) || 0) + delta;
    tt.toolTimeAdjustValue = Math.round(next * 100) / 100;
    adjustText = fmtAdjust(tt.toolTimeAdjustValue);
  }

  // 表示は小数2桁固定にして桁数で幅が動かないようにする (0.15 / 0.10 / 0.05 / 0.00)。
  // number 入力は書式を指定できないため text 入力にし、表示文字列と値を分けて持つ。
  function fmtAdjust(n: number): string {
    return n.toFixed(2);
  }
  let adjustText = $state(fmtAdjust(tt.toolTimeAdjustValue));

  /** 入力中は自由に打たせ、数値として解釈できたら値へ反映する */
  function onAdjustInput(e: Event): void {
    adjustText = (e.currentTarget as HTMLInputElement).value;
    const n = Number(adjustText);
    tt.toolTimeAdjustValue = Number.isFinite(n) ? n : 0;
  }

  /** フォーカスを外したタイミングで 2 桁表記に整える */
  function onAdjustBlur(): void {
    adjustText = fmtAdjust(tt.toolTimeAdjustValue);
  }

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
  function handleRemoveAllChecks(): void {
    toolRemoveAllChecksCore({ rebuildWaveformTagCache });
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
      <!-- 表示はタグに適用される補正量 (打鍵の遅れ分だけマイナスする) で統一する。
           内部の timeOffset は「打鍵の遅れ量」を正で保持しているため符号を反転して扱う。 -->
      <input
        type="range"
        class="sliderInput"
        min="-1"
        max="1"
        step="0.01"
        value={-$settings.timeOffset}
        oninput={(e) =>
          updateSetting(
            "timeOffset",
            -parseFloat((e.currentTarget as HTMLInputElement).value),
          )}
      />
      <span class="sliderValue"
        >{$settings.timeOffset > 0 ? "-" : $settings.timeOffset < 0 ? "+" : ""}{Math.abs(
          $settings.timeOffset,
        ).toFixed(2)}s</span
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
      <div class="toolTimeField">
        <!-- ブラウザ既定のスピナーは見た目が浮くので隠し、自前の ± ボタンにする -->
        <input
          type="text"
          inputmode="decimal"
          class="toolTimeInput"
          value={adjustText}
          oninput={onAdjustInput}
          onblur={onAdjustBlur}
          placeholder="0.00"
        />
        <div class="toolStepper">
          <button
            type="button"
            class="toolStepBtn"
            onclick={() => stepAdjust(0.05)}
            aria-label="0.05秒増やす">▲</button
          >
          <button
            type="button"
            class="toolStepBtn"
            onclick={() => stepAdjust(-0.05)}
            aria-label="0.05秒減らす">▼</button
          >
        </div>
      </div>
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
      <span class="toolName">全チェック削除</span>
      <span class="toolDesc"
        >全ての文字のチェックを削除します</span
      >
    </div>
    <button
      class="toolBtn danger"
      onclick={handleRemoveAllChecks}
      disabled={!tt.lines.length}>実行</button
    >
  </div>
  <div class="toolItem">
    <div class="toolInfo">
      <span class="toolName">全タイムタグ削除</span>
      <span class="toolDesc"
        >全てのタイムタグを削除します</span
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
    color: #aaa;
    font-size: 11px;
  }
  .toolName {
    color: #ddd;
    font-size: 0.8rem;
    font-weight: 600;
  }
  .toolDesc {
    color: #aaa;
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
    /* 桁が変わっても幅が動かないようにする */
    font-variant-numeric: tabular-nums;
  }
  /* 数値入力 + 自前ステッパー。既定のスピナーはサイトの見た目に合わないため隠す */
  .toolTimeField {
    display: flex;
    align-items: stretch;
    background: #111;
    border: 1px solid #444;
    border-radius: 4px;
    overflow: hidden;
  }
  .toolTimeField:focus-within {
    border-color: #6a6d74;
  }
  .toolTimeInput {
    width: 56px;
    padding: 3px 6px;
    background: transparent;
    color: #ddd;
    border: none;
    font-size: 0.75rem;
    text-align: right;
    /* 桁数が変わっても数字の位置が動かないようにする */
    font-variant-numeric: tabular-nums;
  }
  .toolTimeInput:focus {
    outline: none;
  }
  .toolStepper {
    display: flex;
    flex-direction: column;
    border-left: 1px solid #333;
  }
  .toolStepBtn {
    flex: 1;
    width: 18px;
    padding: 0;
    background: transparent;
    color: #9aa0a8;
    border: none;
    font-size: 7px;
    line-height: 1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.12s ease, color 0.12s ease;
  }
  .toolStepBtn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
  }
  .toolStepBtn + .toolStepBtn {
    border-top: 1px solid #333;
  }
  .toolTimeUnit {
    color: #aaa;
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
