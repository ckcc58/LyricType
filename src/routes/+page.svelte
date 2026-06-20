<script lang="ts">
  import { createInfiniteQuery } from "@tanstack/svelte-query";

  let { data } = $props();

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

  // 譜面 id から決定論的にグラデーション色を選ぶ（YouTubeサムネが無い時のフォールバック）。
  const GRADIENTS: [string, string][] = [
    ["#3b3270", "#1f3b6b"],
    ["#5a2a6e", "#7c2a4d"],
    ["#7a2440", "#5a1530"],
    ["#1a3b5c", "#2a5a7a"],
    ["#4a2a6e", "#2a3b7a"],
    ["#6e2a55", "#3a1a4a"],
    ["#2a4a6e", "#5a3a7a"],
    ["#5c2a3a", "#3a1a2a"],
  ];
  function gradientFor(id: number): string {
    const [c1, c2] = GRADIENTS[Math.abs(id) % GRADIENTS.length];
    return `linear-gradient(135deg, ${c1} 0%, ${c2} 100%)`;
  }
</script>

<div class="home">
  <div class="header">
    <h1>譜面一覧</h1>
  </div>

  <div class="chart-list">
    {#each allCharts as chart (chart.id)}
      <a href="/chart/{chart.id}" class="chart-row">
        <div class="chart-thumb-wrap">
          {#if chart.youtube_video_id}
            <img
              class="chart-thumb"
              src="https://i.ytimg.com/vi/{chart.youtube_video_id}/mqdefault.jpg"
              alt=""
              loading="lazy"
              decoding="async"
              width="320"
              height="180"
            />
          {:else}
            <div
              class="chart-thumb chart-thumb-fallback"
              style:background-image={gradientFor(chart.id)}
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

<style>
  .home {
    padding: 24px;
    max-width: 1080px;
    margin: 0 auto;
    height: 100vh;
    overflow-y: auto;
    box-sizing: border-box;
    background: #15161a;
    color: #d8d8da;
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

  .chart-thumb-wrap {
    flex: 0 0 auto;
    width: 130px;
    aspect-ratio: 16 / 9;
    border-radius: 6px;
    overflow: hidden;
    background: #0e0f12;
    box-shadow: 5px 5px 10px rgba(0, 0, 0, 0.5);
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
    color: #ccc;
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
    color: #888888;
    font-size: 0.72rem;
  }
  .chart-stat-value {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .chart-stat-unit {
    color: #888888;
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
      width: 104px;
    }

    .chart-bottom-row {
      grid-template-columns: 1fr;
    }
  }
</style>
