<script lang="ts">
  import {
    createInfiniteQuery,
    useQueryClient,
    type InfiniteData,
  } from "@tanstack/svelte-query";
  import { chartThumbnailUrl, chartGradient } from "$lib/chart-thumbnail";
  import { createPreviewState } from "$lib/chart-preview.svelte";
  import ChartPreviewDock from "$lib/components/ChartPreviewDock.svelte";
  import { getDroppedFolder } from "$lib/folder-drop";
  import { pendingChartFolder } from "../store";
  import { goto } from "$app/navigation";

  let { data } = $props();

  // --- 譜面フォルダをドロップ → エディタ / ローカルプレイ を選択 ---
  let isDragOver = $state(false);
  let dropped = $state<{ name: string; files: File[] } | null>(null);
  let choiceIdx = $state(0);
  const CHOICES = [
    { label: "ローカルプレイ", desc: "この譜面をすぐ遊ぶ", href: "/chart/local" },
    { label: "エディタで開く", desc: "タイムタグを編集する", href: "/edit" },
  ];

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    isDragOver = true;
  }
  function handleDragLeave(e: DragEvent) {
    if (
      e.currentTarget === e.target ||
      !(e.currentTarget as Element)?.contains(e.relatedTarget as Node)
    ) {
      isDragOver = false;
    }
  }
  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    isDragOver = false;
    const folder = await getDroppedFolder(e);
    if (!folder) {
      alert("譜面フォルダをドロップしてください");
      return;
    }
    dropped = folder;
    choiceIdx = 0;
  }

  /** 選択した遷移先へフォルダを渡して移動する */
  function goWithFolder(idx: number) {
    const target = CHOICES[idx];
    if (!target || !dropped) return;
    pendingChartFolder.set(dropped);
    dropped = null;
    goto(target.href);
  }

  function handleChoiceKeydown(e: KeyboardEvent) {
    switch (e.code) {
      case "ArrowDown":
      case "KeyK":
      case "ArrowUp":
      case "KeyI":
        e.preventDefault();
        choiceIdx = (choiceIdx + 1) % CHOICES.length;
        return;
      case "Enter":
      case "Space":
        e.preventDefault();
        goWithFolder(choiceIdx);
        return;
      case "Digit1":
      case "Digit2":
        e.preventDefault();
        goWithFolder(Number(e.code.slice(5)) - 1);
        return;
      case "Escape":
        e.preventDefault();
        dropped = null;
        return;
    }
  }

  type CharTypes = {
    kanji: number;
    hiragana: number;
    katakana: number;
    english: number;
    digit: number;
  };

  type Chart = {
    id: number;
    title: string;
    artist: string | null;
    source: string | null;
    tags: string[] | null;
    avg_cpm: number | null;
    median_cpm: number | null;
    peak_cpm: number | null;
    peak_start_line_no: number | null;
    peak_start_line_text: string | null;
    peak_end_line_no: number | null;
    peak_end_line_text: string | null;
    char_types: CharTypes | null;
    youtube_video_id: string | null;
    note_count: number;
    phrase_count: number;
    play_count: number;
    score_count: number;
    duration_seconds: number | null;
    preview_time: number | null;
    created_at: string;
    uploader_id: number;
    users: { name: string } | { name: string }[] | null;
  };

  type PeakRange = {
    sameLine: boolean;
    sNo: number;
    sText: string;
    eNo: number;
    eText: string;
  } | null;
  function peakRange(chart: Chart): PeakRange {
    const sNo = chart.peak_start_line_no;
    const eNo = chart.peak_end_line_no;
    if (sNo == null || eNo == null || sNo < 0) return null;
    return {
      sameLine: sNo === eNo,
      sNo,
      sText: chart.peak_start_line_text ?? "",
      eNo,
      eText: chart.peak_end_line_text ?? "",
    };
  }

  function formatDuration(sec: number | null | undefined): string {
    if (sec == null || sec <= 0) return "";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  // --- サムネイルからのプレビュー再生 (ロジックは $lib/chart-preview で共有) ---
  const preview = createPreviewState();

  /** フォルダドロップの選択中はそちらの Esc を優先し、それ以外は プレビュー停止 */
  function handleGlobalKeydown(e: KeyboardEvent) {
    if (dropped) {
      handleChoiceKeydown(e);
      return;
    }
    preview.handleEscape(e);
  }

  /** 英語譜面の度合い。英字 9 割以上 = "full"、5 割以上 = "half"、それ未満 = null */
  function englishLevel(types: CharTypes | null): "full" | "half" | null {
    if (!types) return null;
    const total =
      types.kanji + types.hiragana + types.katakana + types.english + types.digit;
    if (total === 0) return null;
    const ratio = types.english / total;
    if (ratio >= 0.9) return "full";
    if (ratio >= 0.5) return "half";
    return null;
  }

  function charTypePct(
    types: CharTypes | null,
  ): { label: string; pct: number }[] {
    if (!types) return [];
    const total =
      types.kanji +
      types.hiragana +
      types.katakana +
      types.english +
      types.digit;
    if (total === 0) return [];
    const round = (n: number) => Math.round((n / total) * 100);
    return [
      { label: "漢字", pct: round(types.kanji) },
      { label: "ひらがな", pct: round(types.hiragana) },
      { label: "カタカナ", pct: round(types.katakana) },
      { label: "英字", pct: round(types.english) },
      { label: "数字", pct: round(types.digit) },
    ].filter((x) => x.pct > 0);
  }

  type PageResult = { charts: Chart[]; nextPage: number | null };

  const query = createInfiniteQuery<PageResult, Error>(() => ({
    queryKey: ["charts"],
    queryFn: async ({ pageParam }) => {
      const res = await fetch(`/api/charts?page=${pageParam}`);
      if (!res.ok) throw new Error("fetch failed");
      return res.json() as Promise<PageResult>;
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage: PageResult) => lastPage.nextPage ?? undefined,
    initialData: {
      pages: [
        {
          charts: data.charts as unknown as Chart[],
          nextPage: data.charts.length === 20 ? 1 : null,
        },
      ],
      pageParams: [0],
    },
  }));

  const queryClient = useQueryClient();

  // SPA 遷移のたびに server load が取り直す最新の先頭20件をクエリキャッシュへ反映する。
  // initialData はキャッシュが空の初回しか使われないため、再訪時にこれをやらないと
  // 古いカードが表示され続ける (エディタで譜面更新 → サイドメニューからトップへ、のケース)。
  // 2ページ目以降 (無限スクロール分) は維持する。
  $effect(() => {
    const page0: PageResult = {
      charts: data.charts as unknown as Chart[],
      nextPage: data.charts.length === 20 ? 1 : null,
    };
    queryClient.setQueryData<InfiniteData<PageResult>>(["charts"], (old) =>
      old
        ? { ...old, pages: [page0, ...old.pages.slice(1)] }
        : { pages: [page0], pageParams: [0] },
    );
  });

  let sentinel: HTMLDivElement | undefined = $state();

  $effect(() => {
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries[0].isIntersecting &&
          query.hasNextPage &&
          !query.isFetchingNextPage
        ) {
          query.fetchNextPage();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  });

  const allCharts = $derived(
    (query.data?.pages ?? []).flatMap((p) => p.charts),
  );

  /** 再生中の譜面。読み込み済みの全ページから引く */
  let previewChart = $derived(
    preview.id === null
      ? null
      : (allCharts.find((c) => c.id === preview.id) ?? null),
  );

</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="home"
  class:dragOver={isDragOver}
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
  ondrop={handleDrop}
>
  {#if dropped}
    <div class="drop-choice-overlay" role="dialog">
      <div class="drop-choice">
        <div class="drop-choice-title">{dropped.name}</div>
        {#each CHOICES as c, i}
          <button
            class="drop-choice-btn"
            class:focused={i === choiceIdx}
            onclick={() => goWithFolder(i)}
            onmouseenter={() => (choiceIdx = i)}
          >
            <span class="drop-choice-num">{i + 1}</span>
            <span class="drop-choice-label">{c.label}</span>
            <span class="drop-choice-desc">{c.desc}</span>
          </button>
        {/each}
        <div class="drop-choice-hint">↑↓ で選択 / Enter で決定 / Esc で取消</div>
      </div>
    </div>
  {/if}

  <div class="header">
    <h1>譜面一覧</h1>
  </div>

  <div class="chart-list">
    {#each allCharts as chart (chart.id)}
      {@const enLevel = englishLevel(chart.char_types)}
      <a
        href="/chart/{chart.id}"
        class="chart-row"
        class:english-full={enLevel === "full"}
        class:english-half={enLevel === "half"}
        title={enLevel === "full"
          ? "英字が9割以上の譜面"
          : enLevel === "half"
            ? "英字が5割以上の譜面"
            : undefined}
      >
        <div class="chart-thumb-wrap">
          {#if chart.youtube_video_id}
            <!-- サムネ全体がプレビュー開始のボタン。再生自体は右下のプレイヤーで行う。
                 譜面ページへの遷移は togglePreview 内の preventDefault で抑止する -->
            <button
              type="button"
              class="preview-trigger"
              class:playing={preview.isPlaying(chart.id)}
              onclick={(e) => preview.toggle(e, chart)}
              aria-label="{chart.title} のプレビューを{preview.isPlaying(chart.id)
                ? '止める'
                : '再生'}"
              title={preview.isPlaying(chart.id)
                ? "プレビューを止める (Esc)"
                : "プレビューを再生"}
            >
              <img
                class="chart-thumb"
                src={chartThumbnailUrl(chart.youtube_video_id)}
                alt=""
                loading="lazy"
                decoding="async"
                width="320"
                height="180"
              />
              <span class="preview-btn" aria-hidden="true"
                >{preview.isPlaying(chart.id) ? "■" : "▶"}</span
              >
            </button>
          {:else}
            <div
              class="chart-thumb chart-thumb-fallback"
              style:background-image={chartGradient(chart.id)}
            ></div>
          {/if}
        </div>
        <div class="chart-body">
          <div class="chart-title">{chart.title}</div>
          {#if chart.artist}
            <div class="chart-artist">{chart.artist}</div>
          {/if}
          <div class="chart-bottom-row">
            {#if chart.median_cpm != null}
              <span class="chart-stat">
                <span class="chart-stat-label">中央値</span>
                <span class="chart-stat-value">{chart.median_cpm}</span>
                <span class="chart-stat-unit">CPM</span>
              </span>
            {/if}
            <span class="chart-stat chart-stat-peak">
              <span class="chart-stat-label">最高</span>
              <span class="chart-stat-value">{chart.peak_cpm ?? "--"}</span>
              <span class="chart-stat-unit">CPM</span>
              {#if chart.peak_start_line_no != null && chart.peak_start_line_no >= 0}
                {@const range = peakRange(chart)}
                {#if range}
                  <span class="chart-tooltip chart-tooltip-peak">
                    <span class="peak-tooltip-title">ピーク区間</span>
                    <span class="peak-tooltip-line">
                      <span class="peak-tooltip-line-no">{range.sNo}行目</span>
                      <span class="peak-tooltip-line-text">{range.sText}</span>
                    </span>
                    {#if !range.sameLine}
                      <span class="peak-tooltip-arrow">〜</span>
                      <span class="peak-tooltip-line">
                        <span class="peak-tooltip-line-no">{range.eNo}行目</span
                        >
                        <span class="peak-tooltip-line-text">{range.eText}</span
                        >
                      </span>
                    {/if}
                  </span>
                {/if}
              {/if}
            </span>
            {#if chart.duration_seconds}
              <span class="chart-stat" title="動画時間">
                <svg
                  class="chart-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                <span class="chart-stat-value"
                  >{formatDuration(chart.duration_seconds)}</span
                >
              </span>
            {/if}
            <span class="chart-stat chart-stat-notes">
              <span class="chart-stat-label">文字数</span>
              <span class="chart-stat-value">{chart.note_count}</span>
              {#if chart.char_types}
                <span class="chart-tooltip chart-tooltip-types">
                  {#each charTypePct(chart.char_types) as t}
                    <span class="char-type-row">
                      <span class="char-type-label">{t.label}</span>
                      <span class="char-type-pct">{t.pct}%</span>
                    </span>
                  {/each}
                </span>
              {/if}
            </span>
          </div>
        </div>
      </a>
    {/each}
  </div>

  <div bind:this={sentinel} class="sentinel"></div>

  {#if query.isFetchingNextPage}
    <div class="loading">読み込み中...</div>
  {/if}
</div>

<ChartPreviewDock chart={previewChart} onclose={() => preview.stop()} />

<style>
  /* --- 譜面フォルダのドロップ --- */
  .home.dragOver::after {
    content: "譜面フォルダをドロップ";
    position: fixed;
    inset: 0;
    z-index: 900;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.6);
    border: 3px dashed var(--accent);
    color: var(--text-primary);
    font-size: 1.2rem;
    pointer-events: none;
  }
  .drop-choice-overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.6);
  }
  .drop-choice {
    background: var(--bg-card);
    border-radius: 12px;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 320px;
  }
  .drop-choice-title {
    color: var(--text-primary);
    font-size: 1rem;
    font-weight: bold;
    text-align: center;
    margin-bottom: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .drop-choice-btn {
    display: flex;
    align-items: baseline;
    gap: 8px;
    background: var(--bg-input);
    color: var(--text-primary);
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    padding: 12px 16px;
    font-size: 0.95rem;
    font-family: inherit;
    cursor: pointer;
    text-align: left;
  }
  .drop-choice-btn.focused {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--bg-input), white 6%);
  }
  .drop-choice-num {
    min-width: 14px;
    color: var(--text-muted);
    font-size: 0.75rem;
  }
  .drop-choice-label {
    font-weight: 600;
  }
  .drop-choice-desc {
    color: var(--text-muted);
    font-size: 0.72rem;
  }
  .drop-choice-hint {
    color: var(--text-muted);
    font-size: 0.7rem;
    text-align: center;
  }

  .home {
    /* 背景は全幅に敷き、中身だけ padding で 1080px 相当に中央寄せする
       (max-width だと広い画面で左右に body の地色が露出する) */
    padding: 24px max(24px, calc((100% - 1032px) / 2));
    height: 100vh;
    overflow-y: auto;
    box-sizing: border-box;
    background: var(--bg-page);
    color: var(--text-primary);
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 24px;
    flex-wrap: wrap;
    gap: 12px;
  }

  h1 {
    font-size: 1.5rem;
    color: #ddd;
    margin: 0;
  }

  .chart-list {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
  }

  .chart-row {
    display: flex;
    gap: 14px;
    padding: 12px;
    border-radius: 8px;
    text-decoration: none;
    color: inherit;
    background: #24262b;
    border: 1px solid #2f3137;
    transition:
      background 0.15s ease,
      border-color 0.15s ease;
  }

  .chart-row:hover {
    background: #2b2d33;
    border-color: #3a3c43;
  }

  /* 英語譜面: --accent-english を背景に混ぜて識別する。
     文字のコントラストを保つため、地色に対して薄く乗せるだけにする。
     英字5割以上 = 枠線のみ / 9割以上 = 背景ごと色付け、の2段階 */
  .chart-row.english-half {
    /* 下半分にだけ色が滲むグラデーション (上端は地色のまま) */
    background: linear-gradient(
      to right,
      #24262b 25%,
      color-mix(in srgb, var(--accent-english) 20%, #24262b) 100%
    );
    border-color: color-mix(in srgb, var(--accent-english) 30%, #2f3137);
  }
  .chart-row.english-half:hover {
    background: linear-gradient(
      to right,
      #2b2d33 25%,
      color-mix(in srgb, var(--accent-english) 40%, #2b2d33) 100%
    );
    border-color: color-mix(in srgb, var(--accent-english) 40%, #3a3c43);
  }
  .chart-row.english-full {
    background: color-mix(in srgb, var(--accent-english) 30%, #24262b);
    border-color: color-mix(in srgb, var(--accent-english) 30%, #2f3137);
  }
  .chart-row.english-full:hover {
    background: color-mix(in srgb, var(--accent-english) 40%, #2b2d33);
    border-color: color-mix(in srgb, var(--accent-english) 40%, #3a3c43);
  }

  /* サムネのプレビュー再生 */
  /* サムネ全体を覆うプレビュー起動ボタン */
  .preview-trigger {
    display: block;
    position: absolute;
    inset: 0;
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
  }

  .preview-btn {
    position: absolute;
    inset: 0;
    margin: auto;
    width: 34px;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.5);
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.55);
    color: var(--text-primary);
    font-size: 0.8rem;
    line-height: 1;
    cursor: pointer;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s ease, background 0.15s ease;
  }

  /* ▶ はサムネにポインタ/フォーカスがあるときだけ出す
     (カード全体の hover で出すと、譜面ページを開くつもりの時に紛らわしい)。
     再生中の譜面は「今どれが鳴っているか」が分かるよう常時 ■ を出す */
  .preview-trigger:hover .preview-btn,
  .preview-trigger:focus-visible .preview-btn,
  .preview-trigger.playing .preview-btn {
    opacity: 1;
    background: rgba(0, 0, 0, 0.75);
  }
  .preview-trigger.playing .chart-thumb {
    filter: brightness(0.6);
  }

  .chart-thumb-wrap {
    position: relative;
    flex: 0 0 auto;
    /* 親 .chart-row は align-items 未指定 = stretch。
       stretch は height:auto の要素に効くため、aspect-ratio があっても
       カード高さまで縦に伸ばされて 16:9 が崩れ、サムネの左右が切れる。 */
    align-self: flex-start;
    width: 170px;
    aspect-ratio: 16 / 9;
    border-radius: 6px;
    overflow: hidden;
    background: #0e0f12;
    box-shadow: 5px 5px 20px rgba(0, 0, 0, 0.5);
  }

  .chart-thumb {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .chart-thumb-fallback {
    background-size: cover;
    background-position: center;
  }

  .chart-body {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    /* サムネ (16:9) の高さに揃え、タイトル群と数値行を上下に振り分ける。
       余った縦方向をここで吸収するのでサムネ下に隙間が残らない */
    min-height: calc(170px * 9 / 16);
    justify-content: space-between;
    gap: 4px;
  }

  .chart-title {
    color: #ffffff;
    font-size: 1.05rem;
    font-weight: 700;
    line-height: 1.25;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chart-artist {
    color: rgba(255, 255, 255, 0.7);
    font-size: 0.85rem;
    line-height: 1.25;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chart-bottom-row {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 2px 12px;
    margin-top: auto;
    color: #ccc;
    font-size: 0.82rem;
  }

  .chart-stat {
    display: inline-flex;
    align-items: baseline;
    gap: 4px;
    color: #fff;
    white-space: nowrap;
    min-width: 0;
  }
  .chart-icon {
    width: 13px;
    height: 13px;
    color: #888;
    flex-shrink: 0;
    align-self: center;
  }
  .chart-stat-label {
    color: #dcd6d6;
    font-size: 0.72rem;
  }
  .chart-stat-value {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .chart-stat-unit {
    color: #dcd6d6;
    font-size: 0.72rem;
    margin-left: -1px;
  }

  .chart-stat-peak,
  .chart-stat-notes {
    position: relative;
    cursor: help;
  }
  /* ホバーで詳細が出ることを示す点線下線 */
  .chart-stat-peak .chart-stat-value,
  .chart-stat-notes .chart-stat-value {
    text-decoration: underline dotted rgba(200, 200, 200, 0.35);
    text-underline-offset: 3px;
    transition: text-decoration-color 0.15s ease;
  }
  .chart-stat-peak:hover .chart-stat-value,
  .chart-stat-notes:hover .chart-stat-value,
  .chart-stat-peak:focus-within .chart-stat-value,
  .chart-stat-notes:focus-within .chart-stat-value {
    text-decoration-color: rgba(200, 200, 200, 0.85);
  }

  /* ホバー / フォーカス時に表示されるツールチップ
	   親 (.chart-stat) の右端を起点に左方向へ伸ばす → カードの右側で画面外に出にくい */
  .chart-tooltip {
    position: absolute;
    bottom: calc(100% + 6px);
    right: 0;
    left: auto;
    min-width: max-content;
    max-width: 280px;
    padding: 6px 10px;
    background: #15161a;
    border: 1px solid #3a3c43;
    border-radius: 6px;
    color: #ddd;
    font-size: 0.75rem;
    font-weight: 500;
    white-space: normal;
    text-align: center;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.12s ease;
    z-index: 10;
    box-sizing: border-box;
  }
  /* ピーク区間ツールチップだけは固定 280px (長い歌詞を ellipsis するため) */
  .chart-tooltip-peak {
    width: 280px;
    min-width: 280px;
  }
  .chart-stat-peak:hover .chart-tooltip,
  .chart-stat-notes:hover .chart-tooltip,
  .chart-stat-peak:focus-within .chart-tooltip,
  .chart-stat-notes:focus-within .chart-tooltip {
    opacity: 1;
  }

  .chart-tooltip-peak {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 4px;
    text-align: left;
    padding: 8px 12px;
  }
  .peak-tooltip-title {
    color: #888;
    font-size: 0.68rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding-bottom: 4px;
    border-bottom: 1px solid #2a2c33;
  }
  .peak-tooltip-line {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }
  .peak-tooltip-line-no {
    color: #888;
    font-size: 0.68rem;
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
    min-width: 3em;
  }
  .peak-tooltip-line-text {
    color: #ddd;
    font-size: 0.8rem;
    min-width: 0;
    flex: 1 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .peak-tooltip-arrow {
    color: #555;
    font-size: 0.75rem;
    text-align: center;
    line-height: 1;
  }

  .chart-tooltip-types {
    display: grid;
    grid-template-columns: auto auto;
    gap: 2px 12px;
    text-align: left;
  }
  .char-type-row {
    display: contents;
  }
  .char-type-label {
    color: #888;
  }
  .char-type-pct {
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .sentinel {
    height: 1px;
  }

  .loading {
    text-align: center;
    color: #888;
    padding: 24px;
    font-size: 0.9rem;
  }

  @media (max-width: 760px) {
    .home {
      padding: 16px;
    }

    .chart-list {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 430px) {
    .chart-row {
      gap: 10px;
      padding: 10px;
    }

    .chart-thumb-wrap {
      width: 134px;
    }

    .chart-body {
      min-height: calc(134px * 9 / 16);
    }

    .chart-bottom-row {
      grid-template-columns: 1fr;
    }
  }
</style>
