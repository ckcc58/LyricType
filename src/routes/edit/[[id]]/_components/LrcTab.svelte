<!--
  Lyric Editor タブ: LRC テキスト編集 + 検索/置換 UI
  - tt.lrcText を編集対象とする
  - master 取得済みかつ chart repl が空のときは入力中に自動生成する
-->
<script lang="ts">
  import { tick } from "svelte";
  import { chart } from "../_state/chart.svelte";
  import { tt } from "../_state/timetag.svelte";
  import {
    findMatches,
    replaceAt,
    replaceAll as lrcReplaceAllPure,
  } from "../_lib/lrc/find-replace";
  import { generateChartRepl } from "../_lib/repl/generate";

  type Props = {
    /** LRC をファイル/フォルダに保存するハンドラ (TT 再生成コールバックを内包) */
    downloadLrc: () => void;
  };
  let { downloadLrc }: Props = $props();

  let lrcTextareaEl: HTMLTextAreaElement | undefined = $state();
  let lrcMatchCount = $derived(
    findMatches(tt.lrcText, chart.lrcFindText, chart.lrcFindCase).length,
  );

  function getMatches() {
    return findMatches(tt.lrcText, chart.lrcFindText, chart.lrcFindCase);
  }

  function lrcSeekMatch(idx: number): void {
    const matches = getMatches();
    if (!matches.length) return;
    const m = matches[idx];
    lrcTextareaEl?.focus();
    lrcTextareaEl?.setSelectionRange(m.start, m.end);
  }

  function lrcFindNext(): void {
    const matches = getMatches();
    if (!matches.length) return;
    chart.lrcFindIdx = (chart.lrcFindIdx + 1) % matches.length;
    lrcSeekMatch(chart.lrcFindIdx);
  }

  function lrcFindPrev(): void {
    const matches = getMatches();
    if (!matches.length) return;
    chart.lrcFindIdx =
      (chart.lrcFindIdx - 1 + matches.length) % matches.length;
    lrcSeekMatch(chart.lrcFindIdx);
  }

  async function lrcReplace(): Promise<void> {
    const matches = getMatches();
    if (!matches.length) return;
    const m = matches[chart.lrcFindIdx % matches.length];
    tt.lrcText = replaceAt(tt.lrcText, m, chart.lrcReplaceText);
    chart.lrcContent = tt.lrcText;
    // textarea の DOM 値が更新されてから次マッチ位置を選択 (青ハイライト) する
    await tick();
    // 置換後はマッチ数が変わっている可能性があるので、現在 idx に留まる
    // (進めない: lrcFindNext を呼ぶと次のマッチに進んでしまう)
    const newMatches = getMatches();
    if (!newMatches.length) return;
    const nextIdx = chart.lrcFindIdx % newMatches.length;
    chart.lrcFindIdx = nextIdx;
    lrcSeekMatch(nextIdx);
  }

  function lrcReplaceAll(): void {
    tt.lrcText = lrcReplaceAllPure(
      tt.lrcText,
      chart.lrcFindText,
      chart.lrcReplaceText,
      chart.lrcFindCase,
    );
    chart.lrcContent = tt.lrcText;
  }

  function handleLrcInput(): void {
    chart.lrcContent = tt.lrcText;
    if (
      chart.isMasterLoaded &&
      !chart.chartReplContent.trim() &&
      chart.lrcContent.trim()
    ) {
      const { merged, optimized } = generateChartRepl(
        chart.lrcContent,
        chart.appliedMasterReplContent,
        "",
        chart.ignorePipeSet,
        true,
      );
      chart.lastMergedRepl = merged;
      chart.lastOptimizedRepl = optimized;
      chart.chartReplContent = optimized;
      chart.appliedChartReplContent = optimized;
    }
  }
</script>

<div class="lrcEditorContainer">
  <div class="lrcToolbar">
    <button class="ttBtn ttExportBtn" onclick={downloadLrc}>
      LRCエクスポート
    </button>
    <div class="lrcFindBar">
      <input
        class="lrcFindInput"
        placeholder="検索"
        bind:value={chart.lrcFindText}
        onkeydown={(e) => {
          if (e.key === "Enter") {
            e.shiftKey ? lrcFindPrev() : lrcFindNext();
          }
        }}
        spellcheck="false"
      />
      <input
        class="lrcFindInput"
        placeholder="置換"
        bind:value={chart.lrcReplaceText}
        onkeydown={(e) => {
          if (e.key === "Enter") lrcReplace();
        }}
        spellcheck="false"
      />
      <button
        class="lrcFindOpt"
        class:active={chart.lrcFindCase}
        onclick={() => (chart.lrcFindCase = !chart.lrcFindCase)}
        title="大文字小文字を区別">Aa</button
      >
      <button
        class="lrcFindBtn lrcFindNav"
        onclick={lrcFindPrev}
        disabled={!chart.lrcFindText || lrcMatchCount === 0}
        title="前のマッチへ"
        aria-label="前のマッチへ"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
      <button
        class="lrcFindBtn lrcFindNav"
        onclick={lrcFindNext}
        disabled={!chart.lrcFindText || lrcMatchCount === 0}
        title="次のマッチへ"
        aria-label="次のマッチへ"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
      <span class="lrcFindCount">
        {#if chart.lrcFindText && lrcMatchCount > 0}
          {(chart.lrcFindIdx % lrcMatchCount) + 1}/{lrcMatchCount}
        {:else if chart.lrcFindText}
          0/0
        {/if}
      </span>
      <button
        class="lrcFindBtn"
        onclick={lrcReplace}
        disabled={!chart.lrcFindText}>置換</button
      >
      <button
        class="lrcFindBtn"
        onclick={lrcReplaceAll}
        disabled={!chart.lrcFindText}>全置換</button
      >
    </div>
  </div>
  <textarea
    class="ttTextEditor"
    bind:value={tt.lrcText}
    bind:this={lrcTextareaEl}
    oninput={handleLrcInput}
    spellcheck="false"
    placeholder="LRCテキストをここに貼り付け、またはタイムタグエディタから生成されます"
  ></textarea>
</div>

<style>
  .lrcEditorContainer {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .lrcToolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    background: #1a1a1a;
    border-bottom: 1px solid #333;
    flex-shrink: 0;
    flex-wrap: nowrap;
    overflow-x: auto;
  }
  .lrcFindBar {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 1;
    min-width: 0;
    overflow-x: auto;
  }
  .lrcFindInput {
    background: #111;
    border: 1px solid #333;
    color: #ddd;
    font-family: monospace;
    font-size: 13px;
    padding: 3px 7px;
    outline: none;
    width: 140px;
    flex-shrink: 0;
  }
  .lrcFindInput:focus {
    border-color: #555;
  }
  .lrcFindOpt {
    background: #111;
    border: 1px solid #333;
    color: #888;
    cursor: pointer;
    padding: 3px 7px;
    font-size: 12px;
    font-family: monospace;
    flex-shrink: 0;
  }
  .lrcFindOpt.active {
    background: #2a3a4a;
    border-color: #4a7aaa;
    color: #8af;
  }
  .lrcFindCount {
    font-size: 12px;
    color: #ccc;
    min-width: 32px;
    text-align: center;
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }
  .lrcFindBtn {
    background: #222;
    border: 1px solid #333;
    color: #ccc;
    cursor: pointer;
    padding: 3px 8px;
    font-size: 12px;
    flex-shrink: 0;
  }
  .lrcFindBtn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
  .lrcFindBtn:not(:disabled):hover {
    background: #333;
  }
  /* 矢印ボタン (前/次のマッチ) */
  .lrcFindNav {
    background: transparent;
    border: none;
    padding: 4px 6px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: #aaa;
  }
  .lrcFindNav svg {
    width: 14px;
    height: 14px;
  }
  .lrcFindNav:not(:disabled):hover {
    background: transparent;
    color: #fff;
  }
  .ttTextEditor {
    flex: 1;
    background: #0a0a0a;
    color: #ddd;
    border: none;
    resize: none;
    font-family: monospace;
    font-size: 14px;
    padding: 16px;
    line-height: 1.6;
    outline: none;
  }
  /* 「マッチ移動」で setSelectionRange されたテキストを青で強調 */
  .ttTextEditor::selection {
    background: #1e58c0;
    color: #fff;
  }
  .ttTextEditor::-moz-selection {
    background: #1e58c0;
    color: #fff;
  }
</style>
