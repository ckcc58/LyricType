<script lang="ts">
  import { ChartGame } from "$lib/chart-game.ts";
  import type { Snippet } from "svelte";

  let {
    resultActions,
    controlBar,
  }: { resultActions: Snippet; controlBar?: Snippet } = $props();

  const {
    renderedLyrics,
    nextLines,
    currentTime,
    duration,
    gamePhase,
    graceProgress,
    score,
    maxBaseScore,
    earnedBaseScore,
    typingSpeed,
    replayMode,
    replayUsername,
    replayFinalScore,
    replayKeyDisplayLog,
  } = ChartGame;

  function formatKeyCode(code: string): string {
    if (code === "Space") return "␣";
    if (code === "Backspace") return "⌫";
    if (code === "Delete") return "Del";
    if (code === "Tab") return "⇥";
    if (code === "Enter") return "⏎";
    if (code === "Escape") return "Esc";
    if (code === "CompositionEnd") return "確定";
    if (code === "NonConvert") return "無変換";
    if (code === "Convert") return "変換";
    if (code === "ArrowLeft") return "←";
    if (code === "ArrowRight") return "→";
    if (code === "ArrowUp") return "↑";
    if (code === "ArrowDown") return "↓";
    if (code === "Home") return "Home";
    if (code === "End") return "End";
    if (code.startsWith("Key")) return code.slice(3);
    if (code.startsWith("Digit")) return code.slice(5);
    if (code.startsWith("Numpad")) return "N" + code.slice(6);
    return code;
  }

  let scrollHintShown = $state(true);

  // Character-level progress using charGroups
  function charGroupPassedChars(
    charGroups: { count: number; startTime: number; endTime?: number }[],
    endTime: number,
    currentTime: number,
  ): number {
    if (!charGroups || charGroups.length === 0) return 0;
    let passedChars = 0;
    for (let i = 0; i < charGroups.length; i++) {
      const group = charGroups[i];
      const groupEnd =
        group.endTime ??
        (i + 1 < charGroups.length ? charGroups[i + 1].startTime : endTime);
      if (currentTime <= group.startTime) break;
      if (currentTime >= groupEnd) {
        passedChars += group.count;
      } else {
        const groupProgress =
          (currentTime - group.startTime) / (groupEnd - group.startTime);
        passedChars += groupProgress * group.count;
        break;
      }
    }
    return passedChars;
  }

  function measurePhraseWidth(node: HTMLElement, cleared: boolean) {
    const phrase = node.querySelector<HTMLElement>(".phrase");
    let observer: ResizeObserver | null = null;

    const measure = () => {
      if (cleared) return;
      const width = Array.from(node.children).reduce((sum, child) => {
        return sum + (child as HTMLElement).getBoundingClientRect().width;
      }, 0);
      if (width > 0) {
        node.style.setProperty("--phrase-width", `${width}px`);
      }
    };

    requestAnimationFrame(measure);
    if (phrase && "ResizeObserver" in window) {
      observer = new ResizeObserver(measure);
      observer.observe(phrase);
    }

    return {
      update(nextCleared: boolean) {
        cleared = nextCleared;
        if (!cleared) requestAnimationFrame(measure);
      },
      destroy() {
        observer?.disconnect();
      },
    };
  }

  function progressPx(node: HTMLElement, passedChars: number) {
    let lastPx = 0;
    let lastSparkTime = 0;
    // 文字幅を最初の 1 回だけ計測してキャッシュ。以降は querySelectorAll や getBoundingClientRect を呼ばない。
    let cachedWidths: { w: number; charCount: number; isSpace: boolean }[] | null = null;
    // 同時生存スパーク数を制限（上限を超えたら spawn しない）
    let aliveSparks = 0;
    const MAX_SPARKS = 12;

    function measureCache(): boolean {
      const parent = node.parentElement;
      if (!parent) return false;
      const spans = parent.querySelectorAll<HTMLElement>(".char-span");
      if (spans.length === 0) return false;
      cachedWidths = [];
      for (const span of spans) {
        const el =
          span.parentElement?.tagName === "RUBY" ? span.parentElement! : span;
        const w = el.getBoundingClientRect().width;
        const charCount = span.textContent?.length ?? 1;
        const isSpace = span.hasAttribute("data-space");
        cachedWidths.push({ w, charCount, isSpace });
      }
      return true;
    }

    function spawnSpark(x: number) {
      if (aliveSparks >= MAX_SPARKS) return;
      aliveSparks++;
      const spark = document.createElement("div");
      spark.className = "spark";
      const angle = (Math.random() - 0.5) * Math.PI * 1.2;
      const speed = 15 + Math.random() * 25;
      const vx = Math.cos(angle) * speed;
      const vy = -Math.abs(Math.sin(angle)) * speed - Math.random() * 10;
      const size = 1.5 + Math.random() * 2;
      spark.style.left = x + "px";
      spark.style.bottom = "0px";
      spark.style.width = size + "px";
      spark.style.height = size + "px";
      node.parentElement!.appendChild(spark);

      const startTime = performance.now();
      const life = 300 + Math.random() * 300;
      const gravity = 60;

      function tick(now: number) {
        const t = now - startTime;
        const progress = t / life;
        if (progress >= 1) {
          spark.remove();
          aliveSparks--;
          return;
        }
        const dt = t / 1000;
        const sx = vx * dt;
        const sy = vy * dt + 0.5 * gravity * dt * dt;
        // transform 1 本にまとめて合成レイヤー上で動かす（layout 不要）
        spark.style.transform = `translate(${sx}px, ${sy}px) scale(${1 - progress * 0.5})`;
        spark.style.opacity = String(1 - progress * progress);
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    }

    function apply(passed: number) {
      if (passed <= 0) {
        if (lastPx !== 0) {
          node.style.width = "0";
          node.style.left = "0";
          node.classList.add("inactive");
          lastPx = 0;
        }
        return;
      }
      if (!cachedWidths && !measureCache()) {
        node.style.width = "0";
        lastPx = 0;
        return;
      }
      const widths = cachedWidths!;

      // 先頭の hs/zs スペースの合計幅をバー開始オフセットとして計算
      let leadingOffset = 0;
      for (const { w, isSpace } of widths) {
        if (isSpace) leadingOffset += w;
        else break;
      }

      let px = 0;
      let remaining = passed;
      let typableFound = false;
      for (let i = 0; i < widths.length; i++) {
        const { w, charCount, isSpace } = widths[i];
        if (isSpace) {
          // 先頭スペースはオフセット分として除外済み。中間スペースは remaining > 0 の間だけバーに含める
          if (typableFound && remaining > 0) px += w;
        } else {
          typableFound = true;
          if (remaining <= 0) break;
          if (remaining >= charCount) {
            px += w;
            remaining -= charCount;
          } else {
            px += w * (remaining / charCount);
            remaining = 0;
          }
        }
      }

      node.style.left = leadingOffset + "px";
      node.style.width = px + "px";
      if (lastPx === 0) node.classList.remove("inactive");

      const now = performance.now();
      if (px > lastPx && px > 2 && now - lastSparkTime > 50) {
        const count = 1 + Math.floor(Math.random() * 2);
        for (let i = 0; i < count; i++) spawnSpark(leadingOffset + px);
        lastSparkTime = now;
      }
      lastPx = px;
    }
    apply(passedChars);
    return {
      update(newPassed: number) {
        apply(newPassed);
      },
    };
  }

  function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  function lyricSlotsFn(rendered: typeof $renderedLyrics) {
    const slots: ((typeof rendered)[number] | null)[] = [];
    const offset = Math.max(0, 5 - rendered.length);
    for (let i = 0; i < 5; i++) slots.push(rendered[i - offset] ?? null);
    return slots;
  }

  export function resetTab() {
    // result tab UI removed; kept as no-op for callers
  }

  function onProgressClick(e: MouseEvent) {
    if ($replayMode) e.preventDefault();
  }

  function onScrollDownClick() {
    const ranking = document.querySelector(".ranking-section");
    if (ranking) {
      ranking.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      const scroller = document.querySelector(".content") as HTMLElement | null;
      scroller?.scrollBy({ top: window.innerHeight, behavior: "smooth" });
    }
    scrollHintShown = false;
  }
</script>

<div id="game-overlay" class:hidden={$gamePhase === "idle"}>
  {#if $gamePhase === "playing" || $gamePhase === "grace"}
    <div id="play-box">
      {#if controlBar}
        <div id="overlay-control">{@render controlBar()}</div>
      {/if}
      <div class="status-main">
        <div class="status-cell">
          <span class="cell-label">Score</span>
          <span class="cell-main-row">
            {#if $replayMode}
              <span class="cell-value">
                {Math.floor($score).toLocaleString()}<span class="replay-final"
                  >/{Math.floor($replayFinalScore).toLocaleString()}</span
                >
              </span>
            {:else}
              <span class="cell-value"
                >{Math.floor($score).toLocaleString()}</span
              >
            {/if}
          </span>
        </div>
        <div class="status-cell">
          <span class="cell-label">Speed</span>
          <span class="cell-main-row">
            <span class="cell-value"
              >{$typingSpeed.toFixed(2)}<span class="cell-unit">cpm</span></span
            >
          </span>
        </div>
      </div>
      <div id="lyrics">
        {#each lyricSlotsFn($renderedLyrics) as line, slotIdx (line?.line ?? -(slotIdx + 1))}
          <div
            class="lyric-line"
            class:empty={!line}
            class:finished={line?.isFinished}
            class:preview={line?.isPreview}
          >
            {#if line}
              {#each line.items as item}
                <div
                  class="lyric-wrapper"
                  class:cleared={item.isCleared}
                  use:measurePhraseWidth={item.isCleared}
                >
                  {#if item.data.phrase.trim() === ""}
                    {#each item.data.phrase as char}
                      {#if char === "　"}<span class="zs"></span>
                      {:else if char === " "}<span class="hs"></span>
                      {/if}
                    {/each}
                  {:else}
                    {@const phraseHasRuby = item.data.segments.some((s) => s.text !== s.reading || s.explicit)}
                    <div
                      class="phrase"
                      class:waiting={$currentTime < item.data.time}
                    >
                      {#each item.data.segments as seg, segIdx}
                        {@const chunks = item.segmentStatuses[segIdx] || []}
                        {@const text = seg.text}
                        {@const reading = seg.reading}
                        {@const is1to1Mode =
                          text.length === reading.length &&
                          !/[一-鿿]/.test(text)}

                        {#if is1to1Mode}
                          {@const normalizedCharStatuses = (() => {
                            const result: {
                              status: "text" | "reading";
                              len: number;
                              committed?: boolean;
                            }[] = [];
                            for (const chunk of chunks) {
                              for (let k = 0; k < chunk.len; k++) {
                                result.push(chunk);
                              }
                            }
                            return result;
                          })()}
                          {@const unTypeReg =
                            /[^0-9０-９a-zA-Zａ-ｚＡ-Ｚぁ-んァ-ヶー々〆一-鿿～〜]/}
                          {@const renderedChars = (() => {
                            const chars: {
                              tChar: string;
                              rChar: string;
                              chunk: {
                                status: "text" | "reading";
                                len: number;
                                committed?: boolean;
                              } | null;
                              needsRuby: boolean;
                            }[] = [];
                            let normIdx = 0;
                            for (let i = 0; i < text.length; i++) {
                              const tChar = text[i];
                              const rChar = reading[i];
                              const isSymbol =
                                tChar.replace(unTypeReg, "") === "";
                              let chunk: {
                                status: "text" | "reading";
                                len: number;
                                committed?: boolean;
                              } | null = null;
                              if (!isSymbol) {
                                if (normIdx < normalizedCharStatuses.length) {
                                  chunk = normalizedCharStatuses[normIdx];
                                  normIdx++;
                                }
                              }
                              chars.push({
                                tChar,
                                rChar,
                                chunk,
                                needsRuby: tChar !== rChar,
                              });
                            }
                            return chars;
                          })()}

                          {#each renderedChars as { tChar, rChar, chunk, needsRuby }, charIdx}{#if needsRuby || (!phraseHasRuby && segIdx === 0 && charIdx === 0)}<ruby
                                class:committed={chunk?.committed}
                                ><span
                                  class="char-span"
                                  class:text-match={chunk?.status === "text"}
                                  class:reading-match={chunk?.status ===
                                    "reading"}
                                  data-space={tChar === ' ' || tChar === '　' ? '' : undefined}>{tChar}</span
                                ><rt
                                  class:text-match={chunk?.status === "text"}
                                  class:reading-match={chunk?.status ===
                                    "reading"}
                                  class:committed={chunk?.committed}
                                  class:hidden-rt={!needsRuby}>{needsRuby ? rChar : tChar}</rt
                                ></ruby
                              >{:else}<span
                                class="char-span"
                                class:text-match={chunk?.status === "text"}
                                class:reading-match={chunk?.status ===
                                  "reading"}
                                class:committed={chunk?.committed}
                                data-space={tChar === ' ' || tChar === '　' ? '' : undefined}>{tChar}</span
                              >{/if}{/each}
                        {:else}<!-- Kanji Mode (Atomic) -->{@const status =
                            chunks.find((s) => s.status === "reading") ||
                            chunks[0] ||
                            null}<ruby
                            ><span
                              class="char-span"
                              class:text-match={status?.status === "text"}
                              class:reading-match={status?.status === "reading"}
                              class:committed={status?.committed}>{text}</span
                            >{#if text !== reading || seg.explicit}<rt
                                class:text-match={status?.status === "text"}
                                class:reading-match={status?.status ===
                                  "reading"}
                                class:committed={status?.committed}
                                >{reading}</rt
                              >{:else if !phraseHasRuby && segIdx === 0}<rt class="hidden-rt">{text}</rt>{/if}</ruby
                          >{/if}
                      {/each}

                      <!-- Progress Bar -->
                      <div
                        class="phrase-progress"
                        class:inactive={$currentTime < item.data.time}
                        class:finished={item.data.endTime <= $currentTime}
                        use:progressPx={charGroupPassedChars(
                          item.data.charGroups,
                          item.data.endTime,
                          $currentTime,
                        )}
                      ></div>
                      {#if $currentTime < item.data.time}
                        <div
                          class="waiting-progress"
                          style="width: {Math.min(
                            100,
                            Math.max(0, (item.data.time - $currentTime) * 100),
                          )}%"
                        ></div>
                      {/if}
                    </div>

                    {#if item.data.phrase.endsWith(" ")}<span class="hs"
                      ></span>{/if}
                    {#if item.data.phrase.endsWith("　")}<span class="zs"
                      ></span>{/if}
                  {/if}
                </div>
              {/each}
            {/if}
          </div>
        {/each}
      </div>
      <div id="input-area" class:replay={$replayMode}>
        <div class="input-wrapper">
          {#if !$replayMode && $renderedLyrics.every( (l) => l.items.every((item) => item.isCleared || item.data.phrase.trim() === ""), ) && ($nextLines.length === 0 || $nextLines[0].startTime - $currentTime > 0.5)}
            <div class="skip-hint" aria-hidden="true">
              <span class="skip-arrow">></span><span class="skip-arrow">></span
              ><span class="skip-arrow">></span><span class="skip-text"
                ><kbd>Shift + Enter</kbd></span
              >
            </div>
          {/if}
          {#if $replayMode}
            <div id="text-input" class="replay-key-stream">
              {#each $replayKeyDisplayLog as ev (ev.t_ms + ":" + ev.code)}
                <span
                  class="key-token"
                  class:ime={ev.ime}
                  class:repeat={ev.repeat}
                >
                  {#if ev.code === "Click"}
                    <svg
                      viewBox="0 0 16 16"
                      width="12"
                      height="12"
                      aria-hidden="true"
                    >
                      <path
                        d="M2 1 L2 12 L5 9 L7 14 L9 13 L7 8 L11 8 Z"
                        fill="currentColor"
                        stroke="currentColor"
                        stroke-width="0.5"
                        stroke-linejoin="round"
                      />
                    </svg>
                  {:else}
                    {formatKeyCode(ev.code)}
                  {/if}
                </span>
              {/each}
            </div>
          {:else}
            <input id="text-input" type="text" />
          {/if}
        </div>
      </div>
      <div class="next-line-info">
        {#if $nextLines.length > 0}
          <span class="next-line-countdown"
            >{Math.max(0, $nextLines[0].startTime - $currentTime).toFixed(
              1,
            )}s</span
          >
          <span class="next-line-text"
            >{$nextLines.map((n) => n.text.trim()).join(" / ")}</span
          >
        {/if}
      </div>
      <div id="progress-wrapper">
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          id="progress-container"
          class:replay-clickable={false}
          onclick={onProgressClick}
          role={undefined}
          tabindex={undefined}
        >
          {#if $gamePhase === "grace"}
            <div
              id="progress-bar"
              class="grace"
              style="width: {$graceProgress * 100}%"
            ></div>
          {:else}
            <div
              id="progress-bar"
              style="width: {$duration > 0
                ? ($currentTime / $duration) * 100
                : 0}%"
            ></div>
          {/if}
        </div>
        <span id="time-display"
          >{formatTime($currentTime)} / {formatTime($duration)}</span
        >
      </div>
    </div>
  {:else if $gamePhase === "waiting"}
    <div class="waiting-text">
      Press <kbd>Enter</kbd> to Start
      {#if $replayMode}
        <span class="waiting-replay-info">Replay by {$replayUsername}</span>
      {/if}
    </div>
    {#if scrollHintShown}
      <button
        class="waiting-scroll-btn"
        onclick={onScrollDownClick}
        aria-label="ランキングを表示"
      >
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
    {/if}
  {:else if $gamePhase === "result"}
    <div id="result-content">
      <div class="result-menu">
        <div class="result-stats">
          <div class="result-stat">
            <span class="result-stat-label">Score</span><span
              class="result-stat-value"
              >{Math.floor($score).toLocaleString()}</span
            >
          </div>
          <div class="result-stat">
            <span class="result-stat-label">Speed</span><span
              class="result-stat-value">{$typingSpeed.toFixed(2)} cpm</span
            >
          </div>
        </div>
        <div class="result-actions">
          {@render resultActions()}
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  /* --- Overlay control bar --- */
  #overlay-control {
    margin: -11px -18px 9px;
    border-radius: 12px 12px 0 0;
    overflow: hidden;
    flex-shrink: 0;
  }

  /* --- Full-screen game overlay --- */
  #game-overlay {
    position: absolute;
    inset: 0;
    z-index: 2;
    background-color: rgba(0, 0, 0, 0.3);
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  #game-overlay.hidden {
    display: none;
  }

  /* --- Play box (lyrics + input + progress) --- */
  #play-box {
    width: min(55%, calc(100% - 36px));
    min-width: min(660px, calc(100% - 36px));
    backdrop-filter: brightness(0.3);
    -webkit-backdrop-filter: brightness(0.4) blur(4px);
    border-radius: 12px;
    padding: 11px 18px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    margin: auto;
    /* 独自の合成レイヤーに分離（iframe レイヤーとの順序を安定化） */
    isolation: isolate;
    position: relative;
    z-index: 5;
  }

  /* --- Status (integrated) --- */
  .status-main {
    display: flex;
    justify-content: center;
    gap: 46px;
    padding-bottom: 2px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
    font-size: 0.88rem;
  }
  .status-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 9.35rem;
  }
  .cell-main-row {
    display: flex;
    align-items: baseline;
    justify-content: center;
    position: relative;
    width: 100%;
  }
  .cell-label {
    color: #aaa;
    font-size: 0.715rem;
  }
  .cell-value {
    display: inline-block;
    min-width: 6.05rem;
    text-align: center;
    font-weight: bold;
    font-size: 1.21rem;
    color: #ddd;
    font-variant-numeric: tabular-nums;
    font-feature-settings: "tnum";
  }
  .cell-unit {
    font-size: 0.715rem;
    color: #aaa;
    margin-left: 2px;
    font-weight: normal;
  }

  /* --- Lyrics --- */
  #lyrics {
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: flex-start;
    overflow: hidden;
    pointer-events: none;
    margin-bottom: 9px;
  }

  .lyric-line {
    display: flex;
    align-items: baseline;
    color: white;
    white-space: nowrap;
    font-size: 1.54rem;
    margin-bottom: 4px;
    padding-left: 11px;
    max-width: 100%;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
  }

  .lyric-line.empty {
    visibility: hidden;
  }
  .lyric-line {
    min-height: 2.97rem;
  }
  .lyric-line.preview {
    opacity: 0.6;
  }

  span.text-match {
    color: #4dd0e1;
    text-shadow:
      0 0 2px #00bcd4,
      0 0 2px #00bcd4;
  }

  span.reading-match {
    color: #b2ebf2;
    opacity: 0.7;
  }
  .phrase ruby rt.text-match {
    color: #4dd0e1;
  }
  .phrase ruby rt.reading-match {
    color: #b2ebf2;
    opacity: 0.7;
  }
  .phrase ruby rt.committed {
    filter: blur(1px) grayscale(100%);
    opacity: 0.6;
  }
  .committed {
    filter: blur(1px) grayscale(100%);
    opacity: 0.6;
  }

  #input-area {
    width: 100%;
    margin-bottom: 7px;
  }

  .input-wrapper {
    position: relative;
    width: 100%;
  }

  .skip-hint {
    position: absolute;
    left: 11px;
    top: 50%;
    transform: translateY(-50%);
    pointer-events: none;
    z-index: 1;
    display: flex;
    align-items: center;
    font-size: 1.54rem;
    color: rgba(255, 255, 255, 0.55);
    font-family: monospace;
    user-select: none;
  }

  .skip-text {
    padding-left: 0.33rem;
    padding-bottom: 5px;
    color: rgba(255, 255, 255, 0.4);
    font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
    white-space: nowrap;
  }

  /* .skip-text kbd のスタイルは +layout.svelte の :global() に置いた */

  /* 3ステップ: >点灯 → >>点灯 → >>>点灯 */
  @keyframes skip-arrow-a {
    0%,
    100% {
      opacity: 1;
    }
  }
  @keyframes skip-arrow-b {
    0%,
    33% {
      opacity: 0.1;
    }
    34%,
    100% {
      opacity: 1;
    }
  }
  @keyframes skip-arrow-c {
    0%,
    66% {
      opacity: 0.1;
    }
    67%,
    100% {
      opacity: 1;
    }
  }

  .skip-arrow:nth-child(1) {
    animation: skip-arrow-a 1.6s linear infinite;
  }
  .skip-arrow:nth-child(2) {
    animation: skip-arrow-b 1.6s linear infinite;
  }
  .skip-arrow:nth-child(3) {
    animation: skip-arrow-c 1.6s linear infinite;
  }

  .next-line-info {
    display: flex;
    align-items: baseline;
    gap: 9px;
    height: 1.76rem;
    overflow: hidden;
    padding: 0 11px;
  }
  .next-line-countdown {
    font-size: 1.1rem;
    color: rgba(255, 255, 255, 0.5);
    font-variant-numeric: tabular-nums;
  }
  .next-line-text {
    font-size: 1.32rem;
    color: rgba(255, 255, 255, 0.4);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  #text-input {
    width: 100%;
    height: 44px;
    font-size: 1.54rem;
    color: white;
    background-color: rgba(0, 0, 0, 0.3);
    outline: none;
    border: none;
    border-width: 1px 0;
    border-style: solid;
    padding: 0 11px;
    box-sizing: border-box;
  }

  #input-area.replay #text-input.replay-key-stream {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-direction: row;
    flex-wrap: nowrap;
    overflow: hidden;
    justify-content: flex-end;
    font-size: 0.95rem;
    font-family: "Segoe UI", Tahoma, monospace;
    color: rgba(255, 255, 255, 0.85);
    background-color: rgba(30, 30, 30, 0.45);
    border-top: 1px solid rgba(160, 160, 160, 0.22);
    border-bottom: 1px solid rgba(160, 160, 160, 0.22);
  }
  #input-area.replay .key-token {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    padding: 1px 5px;
    background-color: rgba(255, 255, 255, 0.07);
    border: 1px solid rgba(255, 255, 255, 0.13);
    border-radius: 3px;
    font-size: 0.85rem;
    white-space: nowrap;
    flex-shrink: 0;
    color: #bbb;
  }
  #input-area.replay .key-token.ime {
    background-color: rgba(255, 255, 255, 0.09);
    border-color: rgba(255, 255, 255, 0.16);
    color: #bbb;
  }
  #input-area.replay .key-token.repeat {
    opacity: 0.55;
  }

  .replay-meta {
    color: #4dd0e1;
    font-size: 0.65rem;
    font-weight: 500;
    letter-spacing: 0.04em;
  }
  .replay-final {
    color: rgba(255, 255, 255, 0.5);
    font-size: 0.85rem;
    font-weight: normal;
    margin-left: 2px;
  }

  #progress-wrapper {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
  }

  #progress-container {
    flex: 1;
    height: 4px;
    background-color: rgba(255, 255, 255, 0.1);
    border-radius: 2px;
    overflow: hidden;
  }
  #progress-container.replay-clickable {
    cursor: pointer;
    height: 6px;
    transition:
      height 0.15s ease,
      background-color 0.15s ease;
  }
  #progress-container.replay-clickable:hover {
    background-color: rgba(255, 255, 255, 0.18);
  }

  #time-display {
    color: white;
    white-space: nowrap;
    min-width: fit-content;
  }

  #progress-bar {
    height: 100%;
    background: linear-gradient(to right, #00c6ff, #0072ff);
    box-shadow: 0 0 8px rgba(0, 114, 255, 0.6);
    width: 0%;
  }

  #progress-bar.grace {
    background: linear-gradient(to right, #ff9800, #ff5722);
    box-shadow: 0 0 8px rgba(255, 87, 34, 0.6);
  }

  .waiting-progress {
    position: absolute;
    bottom: 0;
    left: 0;
    height: 2px;
    background-color: #666;
  }

  .phrase-progress {
    position: absolute;
    bottom: 0;
    left: 0;
    height: 2px;
    background-color: #ffd700;
    box-shadow:
      0 0 6px #ffd700,
      0 0 2px #ffaa00;
    z-index: 2;
    /* width 更新が頻繁なので独自レイヤーに分離してリペイント範囲を限定 */
    will-change: width;
    contain: layout paint;
    transition:
      background-color 0.3s,
      box-shadow 0.3s,
      opacity 0.3s;
  }

  .phrase-progress::after {
    content: "";
    position: absolute;
    right: -1px;
    top: 50%;
    transform: translateY(-50%);
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background: #fff;
    box-shadow:
      0 0 2px 1px #ffd700,
      0 0 5px 2px rgba(255, 215, 0, 0.5);
    animation: sparkle 0.5s ease-in-out infinite alternate;
  }

  @keyframes sparkle {
    0% {
      opacity: 0.6;
      transform: translateY(-50%) scale(0.8);
    }
    100% {
      opacity: 1;
      transform: translateY(-50%) scale(1.2);
    }
  }

  .phrase-progress.inactive {
    background-color: transparent;
    box-shadow: none;
  }

  .phrase-progress.inactive::after {
    display: none;
  }

  .phrase-progress.finished {
    background-color: #888;
    box-shadow: none;
    opacity: 0.5;
  }

  .phrase-progress.finished::after {
    display: none;
  }

  :global(.spark) {
    position: absolute;
    border-radius: 50%;
    background: #ffd700;
    box-shadow:
      0 0 3px #ffd700,
      0 0 6px rgba(255, 165, 0, 0.5);
    pointer-events: none;
    z-index: 3;
    /* transform/opacity だけアニメーションするので GPU 合成だけで完結する */
    will-change: transform, opacity;
  }

  .lyric-wrapper.cleared {
    width: 0;
    opacity: 0;
    margin: 0;
    padding: 0;
    overflow: hidden;
  }

  .lyric-wrapper {
    display: inline-flex;
    width: var(--phrase-width, auto);
    opacity: 1;
    overflow: visible;
    transition:
      width 0.1s ease-out,
      opacity 0.1s ease-out,
      margin 0.1s ease-out,
      padding 0.1s ease-out;
    vertical-align: bottom;
  }

  .phrase {
    display: inline-block;
    white-space: nowrap;
    margin-top: 5px;
    background-clip: content-box;
    box-sizing: border-box;
    position: relative;
    transform-origin: right center;
    transition: transform 0.3s ease-out;
    vertical-align: bottom;
  }

  .lyric-wrapper.cleared .phrase {
    transform: scaleX(0);
  }

  /* ruby の無い phrase で、先頭文字の rt にこのクラスが付く。
     実際の文字を入れることで annotation 行の高さは正しく確保され、
     visibility: hidden で見た目だけ隠す (レイアウトには影響しない) */
  .phrase ruby rt.hidden-rt {
    visibility: hidden;
    pointer-events: none;
  }

  .phrase.waiting {
    color: gray;
    opacity: 0.8;
  }
  .hs {
    width: 0.33rem;
    display: inline-block;
    pointer-events: none;
  }
  .zs {
    width: 1rem;
    display: inline-block;
    pointer-events: none;
  }

  /* --- Waiting --- */
  .waiting-text {
    position: absolute;
    left: 50%;
    bottom: 30vh;
    transform: translateX(-50%);
  }
  .waiting-scroll-btn {
    position: absolute;
    left: 50%;
    bottom: 10vh;
    transform: translateX(-50%);
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background-color: rgba(0, 0, 0, 0.6);
    border: 1px solid rgba(255, 255, 255, 0.2);
    color: rgba(255, 255, 255, 0.85);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    backdrop-filter: blur(2px);
    transition:
      background-color 0.15s ease,
      border-color 0.15s ease,
      color 0.15s ease;
  }
  .waiting-scroll-btn:hover {
    background-color: rgba(0, 0, 0, 0.8);
    border-color: rgba(255, 255, 255, 0.45);
    color: #fff;
  }

  .waiting-text {
    color: #fff;
    font-size: 1.8rem;
    font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
    text-shadow: 0 2px 8px rgba(0, 0, 0, 0.6);
    background-color: rgba(0, 0, 0, 0.7);
    border-radius: 12px;
    padding: 32px 48px;
    text-align: center;
  }

  .waiting-replay-info {
    display: block;
    margin-top: 12px;
    color: #ccc;
    font-size: 1rem;
    font-weight: 500;
  }

  .waiting-text kbd {
    display: inline-block;
    padding: 4px 12px;
    font-size: 1.2rem;
    font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
    color: #fff;
    background: rgba(255, 255, 255, 0.12);
    border: 1px solid rgba(255, 255, 255, 0.35);
    border-radius: 6px;
    box-shadow: 0 1px 0 rgba(255, 255, 255, 0.15);
    margin: 0 4px;
  }

  /* --- Result --- */
  #result-content {
    width: 600px;
    max-height: 55%;
    background-color: rgba(0, 0, 0, 0.6);
    border-radius: 20px;
    padding: 18px 24px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    align-items: center;
    color: white;
    font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
    margin: auto;
  }

  .result-menu {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    flex: 1;
  }
  .result-stats {
    display: flex;
    gap: 16px;
    justify-content: center;
    flex-wrap: wrap;
  }
  .result-stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }
  .result-stat-label {
    font-size: 0.65rem;
    color: #888;
    text-transform: uppercase;
  }
  .result-stat-value {
    font-size: 1.1rem;
    color: #fff;
    font-weight: 600;
  }

  .result-actions {
    display: flex;
    gap: 12px;
  }

  :global(.result-btn) {
    padding: 6px 20px;
    border: 1px solid rgba(255, 255, 255, 0.3);
    border-radius: 8px;
    background-color: rgba(255, 255, 255, 0.1);
    color: white;
    font-size: 0.85rem;
    cursor: pointer;
    transition: background-color 0.15s;
    text-decoration: none;
  }
  :global(.result-btn:hover) {
    background-color: rgba(255, 255, 255, 0.2);
  }
</style>
