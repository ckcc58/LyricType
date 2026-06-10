<!--
  Time Tag Editor タブ: タイムタグ可視化 + カラオケ表示
  - 文字単位で startTime / endTime のチェックマークを表示
  - 行単位の時間タグを kbd 操作で打つ (キー処理は親側 handleTtKeydown が担当)
  - oncopy ハンドラで選択範囲を行ごとにテキスト化してコピー
-->
<script lang="ts">
  import { tt } from "../_state/timetag.svelte";
  import { ui } from "../_state/ui.svelte";
  import { player } from "../_state/player.svelte";
  import {
    formatTime,
    ttIsSpace,
    ttEndCheckActive,
    ttLineEndActive,
    ttIsOnEndCheck,
    ttEndCheckTime,
  } from "../_lib/timetag/utils";
  import {
    buildKaraokeUnits,
    ttCharProgress,
    ttRubyProgress,
  } from "../_lib/timetag/karaoke";
  import { openRubyEdit } from "../_lib/timetag/ruby-edit";

  type Props = {
    /** LRC 保存ハンドラ (ttRegenCb 注入済み) */
    downloadLrc: () => void;
    /** 指定秒へシーク (ダブルクリックでジャンプ) */
    playerSeek: (time: number) => void;
    /** スクロール用 DOM ref を親に export (handleTtKeydown の scrollCursorToCenter で使う) */
    editorAreaEl?: HTMLElement | null;
  };
  let {
    downloadLrc,
    playerSeek,
    editorAreaEl = $bindable<HTMLElement | null>(null),
  }: Props = $props();

  let ttTotalChecks = $derived(
    tt.lines.reduce(
      (sum, l) =>
        sum + l.chars.reduce((s, c) => s + (c.checkCount > 0 ? 1 : 0), 0),
      0,
    ),
  );
  let ttTaggedCount = $derived(
    tt.lines.reduce(
      (sum, l) =>
        sum +
        l.chars.reduce(
          (s, c) =>
            s +
            (c.checkCount > 0 && c.times[0] !== null ? 1 : 0),
          0,
        ),
      0,
    ),
  );

  function handleAreaCopy(e: ClipboardEvent): void {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const anchor = range.commonAncestorContainer;
    const editorEl = (
      anchor instanceof Element ? anchor : anchor.parentElement
    )?.closest(".ttEditorArea");
    if (!editorEl) return;

    const lines: string[] = [];
    let currentLine: Element | null = null;
    let buf = "";
    for (const span of editorEl.querySelectorAll<HTMLElement>(".ttCharText")) {
      if (!sel.containsNode(span, true)) continue;
      const lineEl = span.closest(".ttLine");
      if (lineEl !== currentLine) {
        if (currentLine !== null) lines.push(buf);
        currentLine = lineEl;
        buf = "";
      }
      buf += span.textContent ?? "";
    }
    if (currentLine !== null) lines.push(buf);

    const text = lines.join("\n");
    if (!text.trim()) return;
    e.clipboardData?.setData("text/plain", text);
    e.preventDefault();
  }

  function isRubyContinuation(line: { chars: typeof tt.lines[number]["chars"] }, ci: number): boolean {
    for (let i = ci - 1; i >= 0; i--) {
      const span = line.chars[i]?.rubySpan ?? 1;
      if (span > 1 && ci < i + span) return true;
      if (span > 1 || line.chars[i]?.reading) return false;
    }
    return false;
  }

  function rubyGroupStyle(reading: string, span: number): string {
    const readingChars = [...reading].length;
    return `--tt-ruby-width: max(${span * 1.25}rem, ${readingChars * 0.68}em)`;
  }
</script>

{#if !player.videoSrc && !player.imageSrc && !player.ytVideoId && !player.audioSrc}
  <div class="ttContainer ttEmptyContainer">
    <div class="ttEmpty"></div>
  </div>
{:else}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="ttContainer">
    <!-- Time Tag Toolbar -->
    <div class="ttToolbar">
      <div class="ttControls">
        <button class="ttBtn ttExportBtn" onclick={downloadLrc}>
          LRCエクスポート
        </button>
        <span class="ttInfo"
          >[{ttIsOnEndCheck()
            ? ttEndCheckTime() != null
              ? formatTime(ttEndCheckTime()!)
              : "--:--:--"
            : tt.lines[tt.cursorLine]?.chars[tt.cursorChar]?.times?.[0] != null
              ? formatTime(
                  tt.lines[tt.cursorLine].chars[tt.cursorChar].times[0]!,
                )
              : "--:--:--"}]</span
        >
        <span class="ttInfoSep">|</span>
        <span class="ttInfo"
          >[{formatTime(tt.displayTime)}]/[{formatTime(player.audioDuration)}]</span
        >
        <span class="ttInfoSep">|</span>
        <span class="ttInfo">{ttTaggedCount}/{ttTotalChecks}</span>
        <button
          class="ttBtn shortcutHelpBtn"
          onclick={() => (tt.showShortcuts = !tt.showShortcuts)}
          title="ショートカット一覧">?</button
        >
      </div>
    </div>

    <div
      class="ttEditorArea"
      bind:this={editorAreaEl}
      oncopy={handleAreaCopy}
    >
      {#if tt.lines.length === 0}
        <div class="ttEmpty">Lyric Editorで歌詞を入力してください</div>
      {:else}
        {#each tt.lines as line, li}
          {@const karaokeUnits = buildKaraokeUnits(line)}
          <div class="ttLine" class:ttLineCurrent={li === tt.cursorLine}>
            <span class="ttLineNum">{li + 1}</span>
            <div class="ttChars">
              {#each line.chars as ch, ci}
                {#if ttIsSpace(ch)}
                  <!-- Space character -->
                  <div
                    class="ttCharCol"
                    onclick={() => {
                      tt.cursorLine = li;
                      tt.cursorChar = ci;
                      tt.cursorCheck = 0;
                    }}
                    role="button"
                    tabindex="-1"
                  >
                    <span class="ttRuby"></span>
                    <span class="ttCharText ttSpaceChar"
                      >{ch.char === "　" ? "　" : " "}</span
                    >
                    <div class="ttCheckRows">
                      {#if li === tt.cursorLine && ci === tt.cursorChar}
                        <span class="ttCursorArrow"></span>
                      {/if}
                      {#if !ch.hideEndMark}
                        {@const endActive = ttEndCheckActive(line.chars, ci)}
                        <!-- 1行目: endCheck 四角 (通常文字と同じ width18 座標系) -->
                        <svg
                          class="ttCheckSvg"
                          width="18"
                          height="6"
                          viewBox="0 0 18 6"
                          shape-rendering="crispEdges"
                          aria-hidden="true"
                        >
                          <rect
                            x="0"
                            y="0"
                            width="6"
                            height="6"
                            fill={endActive ? "#888" : "#444"}
                          />
                        </svg>
                        <!-- 2行目: タグ付け済みなら灰色三角 (通常文字の灰色三角と同一) -->
                        <svg
                          class="ttCheckSvg"
                          width="18"
                          height="6"
                          viewBox="0 0 18 6"
                          shape-rendering="crispEdges"
                          aria-hidden="true"
                        >
                          <polygon
                            points="0,0 0,6 6,6"
                            fill={endActive
                              ? "#555"
                              : "transparent"}
                          />
                        </svg>
                      {/if}
                    </div>
                  </div>
                {:else}
                  {#if isRubyContinuation(line, ci)}
                    <!-- rendered by rubySpan group start -->
                  {:else if (ch.rubySpan ?? 1) > 1 && ch.reading !== ch.char && ch.reading}
                    {@const rubySpan = Math.min(
                      ch.rubySpan ?? 1,
                      line.chars.length - ci,
                    )}
                    {@const groupProgress = ttRubyProgress(
                      line,
                      ci,
                      tt.displayTime,
                    )}
                    <div
                      class="ttRubyGroup"
                      style={rubyGroupStyle(ch.reading, rubySpan)}
                    >
                      <span class="ttRuby ttRubyGroupLabel"
                        ><span class="ttRubyText ttRubyTextGroup"
                          >{ch.reading}</span
                        ></span
                      >
                      <div class="ttRubyGroupBase">
                        {#each Array(rubySpan) as _, offset}
                          {@const subCi = ci + offset}
                          {@const subCh = line.chars[subCi]}
                          {@const karaokeProgress = ttCharProgress(
                            karaokeUnits,
                            subCi,
                            tt.displayTime,
                          )}
                          {@const isCursorChar =
                            li === tt.cursorLine && subCi === tt.cursorChar}
                          {@const taggingNext = isCursorChar && player.isPlaying}
                          {@const row1Count = Math.min(subCh.checkCount, 4)}
                          {@const row2Count = Math.max(
                            0,
                            Math.min(subCh.checkCount, 7) - 4,
                          )}
                          <div
                            class="ttCharCol ttCharInRubyGroup"
                            class:ttCharNoCheck={subCh.checkCount === 0}
                            class:ttCharClickable={subCh.times[0] !== null}
                            onclick={(ev) => {
                              tt.cursorLine = li;
                              tt.cursorChar = subCi;
                              tt.cursorCheck = 0;
                              if (ev.ctrlKey) openRubyEdit(li, subCi);
                            }}
                            ondblclick={() => {
                              if (subCh.times[0] !== null) {
                                playerSeek(subCh.times[0]!);
                              }
                            }}
                            role="button"
                            tabindex="-1"
                          >
                            <span class="ttCharTextWrap">
                              <span class="ttCharText">{subCh.char}</span>
                            </span>
                            <div class="ttCheckRows">
                              {#if isCursorChar}
                                <span class="ttCursorArrow"></span>
                              {/if}
                              <svg
                                class="ttCheckSvg"
                                width="18"
                                height="6"
                                viewBox="0 0 18 6"
                                shape-rendering="crispEdges"
                                aria-hidden="true"
                              >
                                {#each Array(row1Count) as _, i}
                                  {@const fill =
                                    taggingNext && i === tt.cursorCheck
                                      ? "#ff7878"
                                      : "#fff"}
                                  {#if i === 0}
                                    <polygon points="0,0 0,6 6,6" {fill} />
                                  {:else}
                                    <rect x={4 + 3 * i} y="0" width="2" height="6" {fill} />
                                  {/if}
                                {/each}
                              </svg>
                              <svg
                                class="ttCheckSvg"
                                width="18"
                                height="6"
                                viewBox="0 0 18 6"
                                shape-rendering="crispEdges"
                                aria-hidden="true"
                              >
                                <polygon
                                  points="0,0 0,6 6,6"
                                  fill={subCh.times[0] != null
                                    ? "#555"
                                    : "transparent"}
                                />
                                {#each Array(row2Count) as _, i}
                                  {@const fill =
                                    taggingNext && i + 4 === tt.cursorCheck
                                      ? "#ff7878"
                                      : "#fff"}
                                  <rect x={7 + 3 * i} y="0" width="2" height="6" {fill} />
                                {/each}
                              </svg>
                            </div>
                          </div>
                        {/each}
                      </div>
                      {#if groupProgress > 0}
                        <div
                          class="ttRubyGroupKaraoke"
                          style="clip-path: inset(-4px {(1 - groupProgress) *
                            100}% -4px 0)"
                          aria-hidden="true"
                        >
                          <span class="ttRuby ttRubyGroupLabel"
                            ><span class="ttRubyText ttRubyTextGroup"
                              >{ch.reading}</span
                            ></span
                          >
                          <div class="ttRubyGroupBase ttRubyGroupBaseKaraoke">
                            {#each Array(rubySpan) as _, offset}
                              {@const subCh = line.chars[ci + offset]}
                              <span
                                class="ttCharCol ttCharInRubyGroup ttCharKaraokeClone"
                              >
                                <span class="ttCharTextWrap">
                                  <span class="ttCharText">{subCh.char}</span>
                                </span>
                              </span>
                            {/each}
                          </div>
                        </div>
                      {/if}
                    </div>
                  {:else}
                  {@const karaokeProgress = ttCharProgress(
                    karaokeUnits,
                    ci,
                    tt.displayTime,
                  )}
                  {@const isCursorChar =
                    li === tt.cursorLine && ci === tt.cursorChar}
                  {@const taggingNext = isCursorChar && player.isPlaying}
                  {@const row1Count = Math.min(ch.checkCount, 4)}
                  {@const row2Count = Math.max(
                    0,
                    Math.min(ch.checkCount, 7) - 4,
                  )}
                  {@const rubySpan = ch.rubySpan ?? 1}
                  <!-- Normal character -->
                  <div
                    class="ttCharCol"
                    class:ttCharNoCheck={ch.checkCount === 0}
                    class:ttCharClickable={ch.times[0] !== null}
                    onclick={(ev) => {
                      tt.cursorLine = li;
                      tt.cursorChar = ci;
                      tt.cursorCheck = 0;
                      if (ev.ctrlKey) openRubyEdit(li, ci);
                    }}
                    ondblclick={() => {
                      if (ch.times[0] !== null) {
                        playerSeek(ch.times[0]!);
                      }
                    }}
                    role="button"
                    tabindex="-1"
                  >
                    <span
                      class="ttRuby"
                      style={rubySpan > 1
                        ? `--tt-ruby-width: ${rubySpan}rem`
                        : undefined}
                      >{#if ch.reading !== ch.char && ch.reading}<span
                          class="ttRubyText"
                          class:ttRubyTextGroup={rubySpan > 1}>{ch.reading}</span
                        >{/if}</span
                    >
                    <span class="ttCharTextWrap">
                      <span class="ttCharText">{ch.char}</span>
                    </span>
                    {#if karaokeProgress > 0}
                      <span
                        class="ttCharColKaraoke"
                        style="clip-path: inset(-4px {(1 - karaokeProgress) *
                          100}% -4px 0)"
                        aria-hidden="true"
                      >
                        <span
                          class="ttRuby"
                          style={rubySpan > 1
                            ? `--tt-ruby-width: ${rubySpan}rem`
                            : undefined}
                          >{#if ch.reading !== ch.char && ch.reading}<span
                              class="ttRubyText"
                              class:ttRubyTextGroup={rubySpan > 1}
                              >{ch.reading}</span
                            >{/if}</span
                        >
                        <span class="ttCharTextWrap">
                          <span class="ttCharText">{ch.char}</span>
                        </span>
                      </span>
                    {/if}
                    <div class="ttCheckRows">
                      {#if isCursorChar}
                        <span class="ttCursorArrow"></span>
                      {/if}
                      <!-- 1 行目: 1〜4 個目 (1個目=直角三角形[直角下] / 2個目以降=長方形)。
                           SVG で底辺・サイズを正確に揃える。セル幅6px・高さ6px。 -->
                      <svg
                        class="ttCheckSvg"
                        width="18"
                        height="6"
                        viewBox="0 0 18 6"
                        shape-rendering="crispEdges"
                        aria-hidden="true"
                      >
                        {#each Array(row1Count) as _, i}
                          {@const fill =
                            taggingNext && i === tt.cursorCheck
                              ? "#ff7878"
                              : "#fff"}
                          {#if i === 0}
                            <!-- 1個目: 直角二等辺三角形 (6×6, 直角が下) -->
                            <polygon points="0,0 0,6 6,6" {fill} />
                          {:else}
                            <!-- 2個目以降: 長方形 (幅2)。隙間 gap=1 で一定 -->
                            <rect x={4 + 3 * i} y="0" width="2" height="6" {fill} />
                          {/if}
                        {/each}
                      </svg>
                      <!-- 2 行目: 左端に灰色三角スロット (タグ付け済み判別) + 5〜7 個目 -->
                      <svg
                        class="ttCheckSvg"
                        width="18"
                        height="6"
                        viewBox="0 0 18 6"
                        shape-rendering="crispEdges"
                        aria-hidden="true"
                      >
                        <polygon
                          points="0,0 0,6 6,6"
                          fill={ch.times[0] != null
                            ? "#555"
                            : "transparent"}
                        />
                        {#each Array(row2Count) as _, i}
                          {@const fill =
                            taggingNext && i + 4 === tt.cursorCheck
                              ? "#ff7878"
                              : "#fff"}
                          <rect x={7 + 3 * i} y="0" width="2" height="6" {fill} />
                        {/each}
                      </svg>
                    </div>
                  </div>
                  {/if}
                {/if}
              {/each}
              <!-- □ endTime marker at line end -->
              <div class="ttCharCol">
                <span class="ttRuby"></span>
                <span class="ttCharText"></span>
                <div class="ttCheckRows">
                  {#if li === tt.cursorLine && tt.cursorChar === line.chars.length}
                    <span class="ttCursorArrow"></span>
                  {/if}
                  <!-- 1行目: endCheck 四角 (通常文字と同じ width18 座標系) -->
                  <svg
                    class="ttCheckSvg"
                    width="18"
                    height="6"
                    viewBox="0 0 18 6"
                    shape-rendering="crispEdges"
                    aria-hidden="true"
                  >
                    <rect
                      x="0"
                      y="0"
                      width="6"
                      height="6"
                      fill={ttLineEndActive(line.chars)
                        ? "#888"
                        : "#444"}
                    />
                  </svg>
                  <!-- 2行目: タグ付け済みなら灰色三角 (通常文字の灰色三角と同一) -->
                  <svg
                    class="ttCheckSvg"
                    width="18"
                    height="6"
                    viewBox="0 0 18 6"
                    shape-rendering="crispEdges"
                    aria-hidden="true"
                  >
                    <polygon
                      points="0,0 0,6 6,6"
                      fill={ttLineEndActive(line.chars)
                        ? "#555"
                        : "transparent"}
                    />
                  </svg>
                </div>
              </div>
            </div>
          </div>
        {/each}
      {/if}
    </div>
  </div>
{/if}

<style>
  .ttContainer {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    outline: none;
  }
  .ttEmptyContainer {
    align-items: center;
    justify-content: center;
    background: #111;
  }
  .ttToolbar {
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
  .ttControls {
    display: flex;
    gap: 6px;
    align-items: center;
    flex: 1;
    min-width: 0;
  }
  .ttInfo {
    color: #aaa;
    font-size: 13px;
    font-family: monospace;
  }
  .ttInfoSep {
    color: #555;
    font-size: 13px;
  }
  .shortcutHelpBtn {
    margin-left: auto;
  }

  /* Editor Area */
  .ttEditorArea {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    background: #0a0a1a;
  }
  .ttEmpty {
    color: #555;
    text-align: center;
    padding: 40px;
    font-size: 16px;
  }
  .ttLine {
    display: flex;
    align-items: flex-start;
    border-bottom: 1px solid #1a1a2a;
  }
  .ttLineCurrent {
    background: rgba(0, 112, 243, 0.05);
  }
  .ttLineNum {
    color: #555;
    font-size: 12px;
    font-family: monospace;
    flex-shrink: 0;
    width: 15px;
    text-align: right;
    user-select: none;
    margin-right: 12px;
    padding-top: 16px;
  }
  .ttChars {
    display: flex;
    flex-wrap: wrap;
    align-items: stretch;
    gap: 0;
  }
  .ttCharCol {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 1rem;
    padding: 2px 0;
    border-radius: 3px;
    transition: background 0.1s;
  }
  .ttCharCol:focus,
  .ttCharCol:focus-visible {
    outline: none;
  }
  .ttCursorArrow {
    position: absolute;
    top: 0;
    left: -5px;
    width: 6px;
    height: 16px;
    overflow: hidden;
  }
  .ttCursorArrow::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    width: 5px;
    height: 9px;
    background: #0f0;
    clip-path: polygon(0% 100%, 100% 0%, 100% 100%);
  }
  .ttCursorArrow::after {
    content: "";
    position: absolute;
    top: 8px;
    left: 3px;
    width: 2px;
    height: 7px;
    background: #0f0;
  }
  .ttCharClickable {
    cursor: pointer;
  }
  .ttCharClickable:hover {
    background: rgba(0, 112, 243, 0.15);
  }
  .ttRuby {
    font-size: 10px;
    color: #eee;
    min-height: 6px;
    line-height: 6px;
    position: relative;
    user-select: none;
    min-width: 1rem;
    text-align: center;
  }
  .ttRubyGroup {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    align-self: flex-start;
    width: var(--tt-ruby-width);
    min-width: var(--tt-ruby-width);
    padding: 2px 0;
    border-radius: 3px;
    transition: background 0.1s;
  }
  .ttRubyGroupLabel {
    width: 100%;
    min-width: 100%;
  }
  .ttRubyGroupBase {
    display: flex;
    justify-content: center;
    width: 100%;
  }
  .ttRubyGroupKaraoke {
    position: absolute;
    top: 2px;
    left: 0;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    width: 100%;
    height: calc(100% - 4px);
    color: #f80;
    pointer-events: none;
    user-select: none;
  }
  .ttRubyGroupKaraoke .ttRuby,
  .ttRubyGroupKaraoke .ttCharText,
  .ttCharColKaraoke .ttRuby,
  .ttCharColKaraoke .ttCharText {
    color: #f80;
  }
  .ttRubyGroupBaseKaraoke {
    pointer-events: none;
  }
  .ttCharInRubyGroup {
    flex: 1 1 1rem;
    min-width: 1rem;
    padding: 0;
  }
  .ttCharKaraokeClone {
    pointer-events: none;
  }
  .ttRubyText {
    display: inline-block;
    width: 100%;
    text-align: center;
    white-space: nowrap;
  }
  .ttRubyTextGroup {
    position: absolute;
    top: 0;
    left: 0;
    width: var(--tt-ruby-width);
    text-align: center;
  }
  .ttRubyGroup .ttRubyTextGroup,
  .ttRubyGroupKaraoke .ttRubyTextGroup {
    position: static;
    display: inline-block;
    width: 100%;
  }
  .ttCharTextWrap {
    position: relative;
  }
  .ttCharText {
    font-size: 18px;
    color: #eee;
    line-height: 1.3;
    min-height: 1.3em;
  }
  .ttCharColKaraoke {
    position: absolute;
    top: 2px;
    left: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
    pointer-events: none;
    user-select: none;
  }
  .ttCheckRows {
    position: relative;
    display: flex;
    flex-direction: column;
    align-self: flex-start;
    /* ruby/文字の高さ差に関わらずチェックを常に最下部に揃える
       (これが無いと行末・読み有無でチェックの上下位置がずれる) */
    margin-top: auto;
    gap: 1px;
    /* チェックの有無・数に関わらず高さを一定に保つ (2 行分 = 三角6px×2 + gap1px) */
    height: 13px;
  }
  /* チェック表示 (1行ぶんの三角/長方形/四角をまとめた SVG) */
  .ttCheckSvg {
    display: block;
    overflow: visible;
  }
  .ttSpaceChar {
    white-space: pre;
  }
</style>
