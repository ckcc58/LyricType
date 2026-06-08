<!--
  Repl Editor タブ: chart repl の編集 + 未カバー漢字 / Needs Pipe レポート
  - LEFT: chart repl テキストエディタ + 操作ボタン (Update / Master再追加 / Diff / Copy)
  - RIGHT: missingKanji と needsPipe の問題リスト
  - パイプエディタの UI も含む (1件目をインライン編集)
-->
<script lang="ts">
  import { chart } from "../_state/chart.svelte";
  import { parseLyric } from "$lib/parseLyric/parse-chart";
  import { downloadChartRepl } from "../_lib/io/save-files";
  import {
    getPlainReading,
    countPipeCoverage,
  } from "../_lib/repl/coverage";

  type MissingKanjiEntry = {
    lineIndex: number;
    lineText: string;
    missingChar: string;
    startTime: number;
  };
  type NeedsPipeEntry = {
    kanji: string;
    reading: string;
    lineIndex: number;
  };

  type Props = {
    /** master + chart の差分計算結果 (親で計算) */
    optimizeDiff?: { text: string; type: "removed" | "added" | "unchanged" }[];
    /** missingKanji レポート (パイプ編集 fn でも使うため親で計算) */
    missingKanjiReport: MissingKanjiEntry[];
    /** needsPipe レポート (同上) */
    needsPipeReport: NeedsPipeEntry[];
    // ボタンハンドラ
    updateChartReplOnly: () => void;
    mergeFromMaster: () => void;
    generateReplLiteTest: () => void;
    playAudioAt: (time: number) => void;
    startPipeEdit: () => void;
    endPipeEdit: () => void;
  };
  let {
    optimizeDiff = [],
    missingKanjiReport,
    needsPipeReport,
    updateChartReplOnly,
    mergeFromMaster,
    generateReplLiteTest,
    playAudioAt,
    startPipeEdit,
    endPipeEdit,
  }: Props = $props();

  let chartLineCount = $derived(
    chart.chartReplContent.split("\n").filter((e) => e).length,
  );

  // 右カラム (未定義/要パイプ レポート) は常に表示する。
  // 問題が解決した瞬間にカラムごと消えると視線が飛ぶため、常駐させて中身だけ変える。
  const showRight = true;
</script>

<div class="lrcToolbar">
  <button class="ttBtn ttExportBtn" onclick={downloadChartRepl}>
    Replエクスポート
  </button>
</div>
<div class="mainGrid" class:singleCol={!showRight}>
  <!-- LEFT: Generated Chart Repl -->
  <div class="column">
    <div class="previewContainer">
      {#if chart.showOptDiff}
        <div class="diffPanel">
          {#each optimizeDiff as line}
            <div class="diffLine {line.type}">
              <span class="diffPrefix"
                >{line.type === "removed"
                  ? "-"
                  : line.type === "added"
                    ? "+"
                    : " "}</span
              >{line.text}
            </div>
          {/each}
          {#if optimizeDiff.length === 0}
            <div class="diffEmpty">最適化による変更はありません</div>
          {/if}
        </div>
      {:else}
        <textarea
          class="editor replEditor"
          bind:value={chart.chartReplContent}
          spellcheck="false"
        ></textarea>
      {/if}
      <div class="replFloatLabel">
        Repl <span class="badgeNormal">{chartLineCount}</span>
      </div>
      {#if chart.replOptimizeInfo}
        <span class="replFloatInfo replFloatInfoLeft"
          >{chart.replOptimizeInfo}</span
        >
      {/if}
      <div class="floatButtons">
        <button
          class="floatBtn updateBtn"
          onclick={updateChartReplOnly}
          title="現在のreplのみで最適化"
        >
          <svg
            class="icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><polyline points="23 4 23 10 17 10" /><polyline
              points="1 20 1 14 7 14"
            /><path
              d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"
            /></svg
          >
        </button>
        <button
          class="floatBtn masterBtn"
          onclick={mergeFromMaster}
          title="Masterからreplを追加 + 最適化"
        >
          <svg
            class="icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><polyline points="23 4 23 10 17 10" /><polyline
              points="1 20 1 14 7 14"
            /><path
              d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"
            /></svg
          >
          <span class="plusBadge" aria-hidden="true">+</span>
        </button>
        <button
          class="floatBtn diffBtn"
          class:active={chart.showOptDiff}
          onclick={() => (chart.showOptDiff = !chart.showOptDiff)}
          disabled={optimizeDiff.length === 0}
          title="差分表示"
        >
          <svg
            class="icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><line x1="18" y1="20" x2="18" y2="10" /><line
              x1="12"
              y1="20"
              x2="12"
              y2="4"
            /><line x1="6" y1="20" x2="6" y2="14" /></svg
          >
        </button>
        <button
          class="floatBtn copyBtn"
          onclick={() => {
            navigator.clipboard.writeText(chart.chartReplContent);
            alert("コピーしました");
          }}
          title="クリップボードにコピー"
        >
          <svg
            class="icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><rect
              x="9"
              y="9"
              width="13"
              height="13"
              rx="2"
              ry="2"
            /><path
              d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"
            /></svg
          >
        </button>
      </div>
    </div>
  </div>

  <!-- RIGHT: Missing Kanji / Needs Pipe Report (問題がない時は非表示) -->
{#if showRight}
  <div class="column missingColumn">
    <h2 class="missingHeader">
      <span
        class={missingKanjiReport.length > 0 ? "badgeError" : "badgeSuccess"}
      >
        Missing {missingKanjiReport.length}
      </span>
      <span
        class={needsPipeReport.length > 0 ? "badgeWarning" : "badgeSuccess"}
      >
        Pipe {needsPipeReport.length}
      </span>
      {#if chart.ignorePipeSet.size > 0}
        <span class="badgeIgnored">
          Skip {chart.ignorePipeSet.size}
        </span>
      {/if}
      <button
        class="addReadingBtn"
        onclick={generateReplLiteTest}
        disabled={chart.isGeneratingReplLite || !chart.lrcContent.trim() || missingKanjiReport.length === 0}
        title="漢字の読みを生成して追加"
      >
        {chart.isGeneratingReplLite ? "生成中…" : "読み追加"}
      </button>
    </h2>
    <div class="missingList">
      {#if !chart.lrcContent}
        <div class="rightEmpty"></div>
      {:else}
        {#if missingKanjiReport.length > 0}
          <div class="sectionLabel sectionLabelMissing">
            Missing readings
          </div>
          {#each missingKanjiReport as item}
            <div class="missingItem">
              <span
                class="missingChar"
                onclick={() => playAudioAt(item.startTime || 0)}
                role="button"
                tabindex="0"
                title={`Click to play from ${(item.startTime || 0).toFixed(2)}s`}
                onkeydown={(e) => {
                  if (e.key === "Enter") playAudioAt(item.startTime || 0);
                }}>{item.missingChar}</span
              >
              <span
                class="missingLine"
                onclick={() => playAudioAt(item.startTime || 0)}
                role="button"
                tabindex="0"
                onkeydown={(e) => {
                  if (e.key === "Enter") playAudioAt(item.startTime || 0);
                }}>{@html item.lineText}</span
              >
            </div>
          {/each}
        {/if}

        {#if needsPipeReport.length > 0}
          <div class="sectionLabel sectionLabelPipe">
            Pipe split required
            {#if !chart.isPipeEditing}
              <button class="startEditBtn" onclick={startPipeEdit}
                >Start split</button
              >
            {:else}
              <button class="endEditBtn" onclick={endPipeEdit}
                >End (Esc)</button
              >
            {/if}
          </div>
          {#each needsPipeReport as item, i}
            {#if chart.isPipeEditing && i === 0}
              {@const plainChars = [...getPlainReading(item.reading)]}
              <!-- Inline Pipe Editor UI -->
              <div class="pipeEditContainer">
                <div class="peHeader">
                  <span class="peKanji">{item.kanji}</span>
                  <span class="peArrow">&rarr;</span>
                  <span class="peReading">{plainChars.join("")}</span>
                  <span class="peInfo">(残り: {needsPipeReport.length})</span>
                </div>
                <div class="peBox">
                  <div class="peArrowRow">
                    {#each plainChars as char, idx}
                      <span class="peCharGhost">{char}</span>
                      {#if idx < plainChars.length - 1}
                        <div class="peSeparatorGhost">
                          <div
                            class="peArrowSlot"
                            class:visible={chart.peFocus === idx}
                          ></div>
                        </div>
                      {/if}
                    {/each}
                  </div>
                  <div class="peMarkRow">
                    {#each plainChars as char, idx}
                      <span class="peCharText">{char}</span>
                      {#if idx < plainChars.length - 1}
                        <div class="peSeparator">
                          <div
                            class="peMark"
                            class:pipe={chart.peDecisions[idx] === "|"}
                            class:group={chart.peDecisions[idx] === "+"}
                          ></div>
                        </div>
                      {/if}
                    {/each}
                  </div>
                </div>
                <div class="peGuide">
                  Space:分割 / Space(2回):結合 / Enter:確定 / Esc:スキップ / Backspace:削除
                </div>
              </div>
            {:else}
              <!-- Normal Item -->
              <div
                class="missingItem"
                class:dimmed={chart.isPipeEditing}
              >
                <span class="missingChar needsPipeKanji">{item.kanji}</span>
                <span class="missingLine needsPipeReading">{item.reading}</span
                >
              </div>
            {/if}
          {/each}
        {/if}

        {#if chart.ignorePipeSet.size > 0}
          <div class="sectionLabel sectionLabelIgnored">
            Skipped
            <button
              class="clearIgnoredBtn"
              onclick={() => {
                chart.ignorePipeSet = new Set();
              }}>全て戻す</button
            >
          </div>
          {#each [...chart.ignorePipeSet] as kanji}
            <div class="missingItem ignoredPipeItem">
              <span class="missingChar ignoredPipeKanji">{kanji}</span>
              <button
                class="undoIgnoreBtn"
                onclick={() => {
                  const newSet = new Set(chart.ignorePipeSet);
                  newSet.delete(kanji);
                  chart.ignorePipeSet = newSet;
                }}
                title="パイプ分けをやり直す">戻す</button
              >
            </div>
          {/each}
        {/if}
      {/if}
    </div>
  </div>
{/if}
</div>

<style>
  .mainGrid {
    flex: 1;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0;
    overflow: hidden;
  }
  /* 右カラムが無い時は左を全幅に */
  .mainGrid.singleCol {
    grid-template-columns: 1fr;
  }
  .column {
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
    border-right: 1px solid #333;
    background: #161616;
  }
  .column:last-child {
    border-right: none;
  }
  .replFloatLabel {
    position: absolute;
    top: 8px;
    right: 22px;
    background: rgba(0, 0, 0, 0.6);
    padding: 2px 10px;
    border-radius: 4px;
    font-size: 14px;
    color: #ccc;
    z-index: 1;
    pointer-events: none;
  }
  .replFloatInfo {
    position: absolute;
    top: 36px;
    z-index: 1;
    font-size: 12px;
    pointer-events: none;
  }
  .replFloatInfoLeft {
    right: 22px;
  }
  .editor {
    flex: 1;
    background: #000;
    color: #ddd;
    border: none;
    resize: none;
    font-family: monospace;
    font-size: 14px;
    padding: 10px;
    line-height: 1.5;
    outline: none;
    height: 100%;
    box-sizing: border-box;
  }
  .editor:focus {
    border-color: #555;
  }
  .previewContainer {
    flex: 1;
    min-height: 0;
    position: relative;
    background: #000;
    border: 1px solid #333;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .floatButtons {
    position: absolute;
    bottom: 20px;
    right: 20px;
    display: flex;
    gap: 8px;
  }
  .floatBtn {
    position: relative;
    padding: 10px;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  }
  .floatBtn :global(.icon) {
    width: 18px;
    height: 18px;
  }
  .updateBtn {
    background: #0070f3;
  }
  .updateBtn:hover {
    background: #0051a2;
  }
  .masterBtn {
    background: #0070f3;
  }
  .masterBtn:hover {
    background: #0051a2;
  }
  .plusBadge {
    position: absolute;
    top: -5px;
    right: -5px;
    width: 14px;
    height: 14px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: #2a7a2a;
    border: 1px solid #111;
    color: #fff;
    font-size: 12px;
    font-weight: 700;
    line-height: 1;
    pointer-events: none;
  }
  .diffBtn {
    background: #555;
  }
  .diffBtn:hover {
    background: #666;
  }
  .diffBtn.active {
    background: #b08800;
  }
  .diffBtn:disabled {
    background: #333;
    opacity: 0.4;
    cursor: not-allowed;
  }
  .copyBtn {
    background: #0070f3;
  }
  .copyBtn:hover {
    background: #0051a2;
  }
  .missingColumn {
    background: #1a1a1a;
  }
  .missingHeader {
    background: #222;
    margin: 0;
    padding: 5px 20px;
    font-size: 14px;
    display: flex;
    gap: 8px;
    align-items: center;
    flex-shrink: 0;
  }
  .badgeSuccess {
    background: #0a0;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 12px;
  }

  /* Inline Pipe Editor */
  .pipeEditContainer {
    background: #1a1a1a;
    border: 2px solid #0070f3;
    border-radius: 8px;
    padding: 16px;
    margin: 8px 0;
  }
  .peHeader {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 12px;
  }
  .peKanji {
    font-size: 24px;
    font-weight: bold;
    color: #eee;
    letter-spacing: 0.2em;
  }
  .peArrow {
    font-size: 16px;
    color: #666;
  }
  .peReading {
    font-size: 18px;
    color: #aaa;
  }
  .peInfo {
    font-size: 12px;
    color: #888;
    margin-left: auto;
  }
  .peBox {
    background: #111;
    padding: 8px 16px 12px;
    border-radius: 4px;
    overflow-x: auto;
  }
  .peArrowRow {
    display: flex;
    align-items: center;
    height: 14px;
  }
  .peCharGhost {
    font-size: 24px;
    font-family: monospace;
    visibility: hidden;
  }
  .peSeparatorGhost {
    width: 20px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .peArrowSlot {
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .peArrowSlot::after {
    content: "";
    width: 0;
    height: 0;
    border-left: 5px solid transparent;
    border-right: 5px solid transparent;
    border-top: 6px solid transparent;
  }
  .peArrowSlot.visible::after {
    border-top-color: #0070f3;
    filter: drop-shadow(0 0 3px #0070f3);
    animation: blink 1s infinite step-end;
  }
  .peMarkRow {
    display: flex;
    align-items: center;
  }
  .peCharText {
    font-size: 24px;
    line-height: 24px;
    font-family: monospace;
    color: #ddd;
  }
  .peSeparator {
    width: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .peMark {
    width: 2px;
    height: 20px;
    background: transparent;
    border-radius: 1px;
  }
  .peMark.pipe {
    background: #ea0;
    box-shadow: 0 0 4px #ea0;
  }
  .peMark.group {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #555;
  }
  .peGuide {
    margin-top: 8px;
    font-size: 11px;
    color: #666;
    letter-spacing: 0.1em;
  }
  @keyframes blink {
    50% { opacity: 0; }
  }
  .dimmed {
    opacity: 0.3;
    pointer-events: none;
  }

  .startEditBtn,
  .endEditBtn {
    margin-left: auto;
    font-size: 10px;
    padding: 2px 8px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-weight: bold;
    text-transform: none;
    letter-spacing: normal;
  }
  .startEditBtn {
    background: #0070f3;
    color: white;
  }
  .endEditBtn {
    background: #555;
    color: white;
  }

  .addReadingBtn {
    margin-left: auto;
    font-size: 12px;
    padding: 4px 12px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-weight: bold;
    background: #0070f3;
    color: white;
    transition: background 0.15s;
  }
  .addReadingBtn:hover:not(:disabled) {
    background: #0860d0;
  }
  .addReadingBtn:disabled {
    background: #444;
    color: #888;
    cursor: not-allowed;
  }

  .badgeError {
    background: #e00;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 12px;
  }
  .badgeWarning {
    background: #ea0;
    color: #111;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: bold;
  }
  .badgeIgnored {
    background: #555;
    color: #ccc;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 12px;
  }
  .badgeNormal {
    background: #555;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 12px;
  }

  .sectionLabel {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #888;
    margin: 16px 0 8px;
    padding-bottom: 4px;
    border-bottom: 1px solid #333;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .sectionLabelMissing::before {
    content: "●";
    color: #f55;
  }
  .sectionLabelPipe::before {
    content: "●";
    color: #ea0;
  }
  .sectionLabelIgnored::before {
    content: "●";
    color: #888;
  }

  .needsPipeItem:hover {
    background: rgba(238, 170, 0, 0.1);
  }
  .needsPipeKanji {
    color: #ea0 !important;
  }
  .needsPipeReading {
    color: #ccc !important;
  }

  .ignoredPipeItem {
    border-left: 3px solid #555;
    padding-left: 10px;
    background: rgba(128, 128, 128, 0.05);
    opacity: 0.6;
  }
  .ignoredPipeItem:hover {
    opacity: 0.9;
    background: rgba(128, 128, 128, 0.1);
  }
  .ignoredPipeKanji {
    color: #888 !important;
  }
  .undoIgnoreBtn {
    grid-column: 3;
    justify-self: end;
    background: transparent;
    border: 1px solid #555;
    color: #888;
    font-size: 11px;
    padding: 1px 8px;
    border-radius: 3px;
    cursor: pointer;
    width: 40px;
  }
  .undoIgnoreBtn:hover {
    border-color: #ea0;
    color: #ea0;
  }
  .clearIgnoredBtn {
    background: transparent;
    border: 1px solid #555;
    color: #888;
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 3px;
    cursor: pointer;
    margin-left: auto;
  }
  .clearIgnoredBtn:hover {
    border-color: #f55;
    color: #f55;
  }

  .missingList {
    flex: 1;
    overflow-y: auto;
    padding: 10px;
  }
  .missingItem {
    display: grid;
    grid-template-columns: 80px 1fr 36px;
    border-bottom: 1px solid #333;
    padding: 4px 0;
    align-items: center;
    transition: background 0.1s;
  }
  .missingItem:hover {
    background: #252525;
  }
  .missingChar {
    color: #f55;
    font-size: 20px;
    font-weight: bold;
    text-align: center;
    cursor: pointer;
  }
  .missingLine {
    color: #888;
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
  }

  .diffPanel {
    flex: 1;
    overflow-y: auto;
    background: #0a0a0a;
    font-family: monospace;
    font-size: 13px;
    line-height: 1.6;
    padding: 10px;
  }
  .diffLine {
    white-space: pre;
    padding: 1px 4px;
    border-radius: 2px;
  }
  .diffLine.removed {
    background: rgba(255, 0, 0, 0.15);
    color: #f88;
  }
  .diffLine.added {
    background: rgba(0, 255, 0, 0.12);
    color: #8f8;
  }
  .diffLine.unchanged {
    color: #555;
  }
  .diffPrefix {
    display: inline-block;
    width: 16px;
    color: inherit;
    font-weight: bold;
  }
  .diffEmpty {
    padding: 20px;
    color: #666;
    text-align: center;
  }

  .rightEmpty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #555;
    font-size: 13px;
  }

  /* lrcToolbar (.replエクスポート ボタンの帯) - LrcTab と共有なので :global にしておく方が良いが
     ReplTab 内のものは scoped で良い */
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
</style>
