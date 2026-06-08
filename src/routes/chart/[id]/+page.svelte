<script lang="ts">
    import { onMount, tick } from "svelte";
    import type { ParsedChart, MediaSource } from "$lib/parseLyric/parse-chart.ts";
    import { ChartGame, YTMediaProxy } from "$lib/chart-game.ts";
    import GameOverlay from "$lib/components/GameOverlay.svelte";
    import { addKeyHandler, removeKeyHandler } from "$lib/hotkeys.ts";
    import { volume, imageURL, media } from "../../../store.ts";
    import { updateSetting } from "$lib/settings";
    import { chartFromJSON, type ChartDataJSON } from "$lib/chart-serialization";
    import { get } from "svelte/store";
    import { page } from "$app/stores";
    import { invalidateAll } from "$app/navigation";
    import { createQuery, useQueryClient } from "@tanstack/svelte-query";

    const queryClient = useQueryClient();

    let { data } = $props();

    // 譜面本体は SSR HTML から外して、クライアントから別 API で取得する。
    // queryKey に updated_at を含めるので、譜面が更新されたら自動的に別キー扱いとなり再取得される。
    const chartVersion = data.chart.updated_at ?? data.chart.created_at;
    const chartDataQuery = createQuery<{ chart_data: ChartDataJSON; version: string }>(() => ({
        queryKey: ['chart-data', data.chart.id, chartVersion],
        queryFn: async () => {
            const res = await fetch(`/api/chart/${data.chart.id}/data`);
            if (!res.ok) throw new Error('failed to load chart');
            return res.json();
        },
        staleTime: Infinity,
        gcTime: Infinity,
    }));

    // ランキングも SSR から外してクライアントで取得（HTML を更に軽量化）
    type RankingEntry = {
        id: number;
        user_id: number;
        score: number;
        typing_speed: number;
        backspace_count: number;
        created_at: string;
        name: string;
    };
    const rankingsQuery = createQuery<{ rankings: RankingEntry[] }>(() => ({
        queryKey: ['chart-rankings', data.chart.id],
        queryFn: async () => {
            const res = await fetch(`/api/chart/${data.chart.id}/rankings`);
            if (!res.ok) throw new Error('failed to load rankings');
            return res.json();
        },
        staleTime: 60_000, // 1分間は再fetchしない
    }));

    // その他の譜面（最新の譜面一覧から、現在の譜面を除く）
    type OtherChart = {
        id: number;
        title: string;
        artist: string | null;
        avg_cpm: number | null;
        peak_cpm: number | null;
        youtube_video_id: string | null;
    };
    const otherChartsQuery = createQuery<{ charts: OtherChart[] }>(() => ({
        queryKey: ['other-charts'],
        queryFn: async () => {
            const res = await fetch(`/api/charts?page=0`);
            if (!res.ok) throw new Error('failed to load other charts');
            return res.json();
        },
        staleTime: 5 * 60_000, // 5分キャッシュ
    }));

    // スコア送信状態
    let scoreSubmitStatus: 'idle' | 'sending' | 'sent' | 'error' = $state('idle');
    let scoreSubmitError = $state('');

    // リプレイ再生中のデータ（null なら通常プレイモード）
    type ReplayData = {
        result_id: number;
        final_score: number;
        name: string;
        lyric_data: unknown;
        key_events: unknown;
        commit_events: unknown;
        phrase_results: unknown;
    };
    let currentReplay: ReplayData | null = $state(null);
    let replayLoading = $state(false);
    let replayError = $state('');

    async function startReplayFor(resultId: number) {
        if (replayLoading) return;
        replayLoading = true;
        replayError = '';
        try {
            const res = await fetch(`/api/chart/${data.chart.id}/replay/${resultId}`);
            if (!res.ok) throw new Error('failed');
            currentReplay = (await res.json()) as ReplayData;
        } catch {
            replayError = 'リプレイの読み込みに失敗しました';
        } finally {
            replayLoading = false;
        }
    }

    function exitReplay() {
        currentReplay = null;
    }

    $effect(() => {
        ChartGame.disallowInputWhenPaused = true;
        ChartGame.disallowRewind = true;
        return () => {
            ChartGame.disallowInputWhenPaused = false;
            ChartGame.disallowRewind = false;
        };
    });

    function openYouTube() {
        const id = data.chart.youtube_video_id;
        if (!id) return;
        window.open(`https://www.youtube.com/watch?v=${id}`, '_blank', 'noopener,noreferrer');
    }

    // inputフォーカス状態（UI隠蔽用）
    let inputFocused = $state(false);
    let hoverTop = $state(false);
    let hoverLeft = $state(false);

    // ゲーム内スライダー操作時に volume + settings 両方更新
    function onGameVolumeChange(e: Event) {
        const v = +(e.currentTarget as HTMLInputElement).value;
        volume.set(v);
        updateSetting('volume', v);
    }

    // Store references (page-specific)
    const { score, maxBaseScore, earnedBaseScore, perfectCount, readingMatchCount, lostCount, totalPhrases, typingSpeed, gamePhase, replayMode } = ChartGame;

    let overlayRef: GameOverlay;

    function hashLyric(lyric: unknown): string {
        const s = JSON.stringify(lyric);
        let h = 5381;
        for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
        return (h >>> 0).toString(16);
    }

    async function submitScore() {
        if (scoreSubmitStatus !== 'idle') return;
        if (currentReplay) return; // リプレイモードでは送信しない
        const profile = get(page).data?.profile;
        if (!profile) return;

        scoreSubmitStatus = 'sending';
        try {
            // chart.lyric の matchRegExp は JSON シリアライズで失われるため、source を明示的に保存する
            const sourceLyric = ChartGame.chart?.lyric ?? [];
            const lyric = sourceLyric.map((item) => ({
                ...item,
                matchRegExpSource: item.matchRegExp?.source ?? '',
            }));
            const res = await fetch('/api/result', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chart_id:            data.chart.id,
                    lyric_data:          lyric,
                    chart_hash:          hashLyric(lyric),
                    score:               $score,
                    perfect_count:       $perfectCount,
                    reading_match_count: $readingMatchCount,
                    lost_count:          $lostCount,
                    typing_speed:        $typingSpeed,
                    total_phrases:       $totalPhrases,
                    ...ChartGame.serializeReplayForSubmit(),
                })
            });
            if (res.ok) {
                scoreSubmitStatus = 'sent';
                // ランキングを再取得（自分のスコアが反映される）
                queryClient.invalidateQueries({ queryKey: ['chart-rankings', data.chart.id] });
                try { await invalidateAll(); } catch {}
            } else {
                const body = await res.json();
                scoreSubmitError = body.error || '送信失敗';
                scoreSubmitStatus = 'error';
            }
        } catch {
            scoreSubmitError = 'ネットワークエラー';
            scoreSubmitStatus = 'error';
        }
    }

    async function retryGame() {
        scoreSubmitStatus = 'idle';
        scoreSubmitError = '';
        overlayRef?.resetTab();
        await ChartGame.retry();
    }

    // ロード済みセッションキー（chart_id + replay_id の組み合わせ）。
    // currentReplay が変わったら再初期化したいので id 単位で判定する。
    let lastInitKey: string | null = null;

    // chart_data が届いた時 + リプレイ切替時に ChartGame を初期化/再初期化
    $effect(() => {
        const d = chartDataQuery.data;
        if (!d) return;
        const initKey = `${data.chart.id}:${currentReplay?.result_id ?? 'live'}`;
        if (initKey === lastInitKey) return;
        lastInitKey = initKey;
        const isReplay = !!currentReplay;
        // 既存セッションを破棄してから再ロード
        ChartGame.stop();
        ChartGame.init();
        loadServerChart(d.chart_data).then(() => {
            // リプレイ時は waiting を経由せず自動でゲーム開始する
            if (isReplay) autoStartReplayWhenReady();
        });
    });

    /** YouTube ロードが onReady で非同期完結する都合上、gamePhase が 'waiting' になるのを待ってから start() を呼ぶ */
    function autoStartReplayWhenReady() {
        const startedKey = lastInitKey;
        const unsub = gamePhase.subscribe((phase) => {
            if (phase === 'waiting' && startedKey === lastInitKey) {
                unsub();
                ChartGame.start();
            }
        });
        // 念のため失敗時の解放（10秒以内に waiting に到達しなければ諦める）
        setTimeout(() => unsub(), 10000);
    }

    // DB から Chart を構築して自動ロード（chart_data は引数で受け取る）
    async function loadServerChart(chartData: ChartDataJSON) {
        const chart = chartFromJSON({
            title: data.chart.title,
            artist: data.chart.artist,
            youtube_video_id: data.chart.youtube_video_id,
            chart_data: chartData,
        });

        if (currentReplay) {
            // リプレイ: 録画時の lyric_data でフレーズ配列を再構築（phrase_index の整合性を保つため）
            const items = (currentReplay.lyric_data as any[]) ?? [];
            chart.lyric = items.map((item) => ({
                ...item,
                matchRegExp: item.matchRegExpSource ? new RegExp(item.matchRegExpSource) : new RegExp(''),
            }));
        }

        if (chart.media.type === "youtube" && chart.media.videoId) {
            await loadYTAndPlay(chart, chart.media.videoId);
        } else {
            ChartGame.load(chart);
        }

        if (currentReplay) {
            ChartGame.startReplay({
                key_events: currentReplay.key_events as any,
                commit_events: currentReplay.commit_events as any,
                phrase_results: currentReplay.phrase_results as any,
                name: currentReplay.name,
                final_score: currentReplay.final_score,
            });
        }
    }

    async function loadYTAndPlay(chart: ParsedChart, videoId: string) {
        media.set(chart.media);
        imageURL.set(chart.imageURL);
        await tick();

        const existing = document.getElementById("yt-api-script");
        if (existing && (window as any).YT?.Player) {
            createGameYTPlayer(videoId, chart);
        } else if (!existing) {
            (window as any).onYouTubeIframeAPIReady = () => {
                createGameYTPlayer(videoId, chart);
            };
            const script = document.createElement("script");
            script.id = "yt-api-script";
            script.src = "https://www.youtube.com/iframe_api";
            document.head.appendChild(script);
        } else {
            (window as any).onYouTubeIframeAPIReady = () => {
                createGameYTPlayer(videoId, chart);
            };
        }
    }

    function createGameYTPlayer(videoId: string, chart: ParsedChart) {
        const container = document.getElementById("yt-player-game");
        if (!container) return;
        if ((window as any).__ytPlayerGame) {
            (window as any).__ytPlayerGame.destroy();
        }
        (window as any).__ytPlayerGame = new YT.Player("yt-player-game", {
            videoId,
            playerVars: { rel: 0, modestbranding: 1, controls: 0, cc_load_policy: 0, iv_load_policy: 3 },
            events: {
                onReady: () => {
                    ChartGame.load(chart);
                },
            },
        });
    }

    async function handleStartKey(e: KeyboardEvent) {
        const phase = get(gamePhase);

        // リプレイ中: 左右矢印で 5 秒シーク
        if (e.key === 'Enter' && phase === 'waiting') {
            e.preventDefault();
            ChartGame.start();
            await tick();
            document.getElementById('text-input')?.focus();
        } else if (e.key === 'Escape' && (phase === 'playing' || phase === 'grace')) {
            e.preventDefault();
            const audio = ChartGame.audio;
            if (!audio) return;
            if (audio.paused) {
                audio.play();
                inputFocused = true;
                document.getElementById('text-input')?.focus();
            } else {
                audio.pause();
                inputFocused = false;
            }
        } else if (e.key === 'F4' && (phase === 'playing' || phase === 'grace' || phase === 'result')) {
            e.preventDefault();
            await retryGame();
            ChartGame.start();
            await tick();
            document.getElementById('text-input')?.focus();
        }
    }

    onMount(() => {
        addKeyHandler();
        document.addEventListener('keydown', handleStartKey);

        // inputフォーカス検知
        const onFocusIn = (e: FocusEvent) => {
            if ((e.target as HTMLElement)?.id === 'text-input') inputFocused = true;
        };
        const onFocusOut = (e: FocusEvent) => {
            if ((e.target as HTMLElement)?.id === 'text-input') inputFocused = false;
        };
        document.addEventListener('focusin', onFocusIn);
        document.addEventListener('focusout', onFocusOut);

        // マウスホバーでUI表示
        const HOVER_TOP_THRESHOLD = 60;
        const HOVER_LEFT_THRESHOLD = 60;
        const onMouseMove = (e: MouseEvent) => {
            hoverTop = e.clientY < HOVER_TOP_THRESHOLD;
            hoverLeft = e.clientX < HOVER_LEFT_THRESHOLD;
            if (get(gamePhase) === 'result' && (hoverTop || hoverLeft)) {
                inputFocused = false;
            }
        };
        const onMouseLeave = () => {
            hoverTop = false;
            hoverLeft = false;
        };
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseleave', onMouseLeave);

        return () => {
            ChartGame.stop();
            ChartGame.init();
            document.removeEventListener('keydown', handleStartKey);
            document.removeEventListener('focusin', onFocusIn);
            document.removeEventListener('focusout', onFocusOut);
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseleave', onMouseLeave);
        };
    });
</script>

<div id="game" class:input-focused={inputFocused} class:hover-top={hoverTop} class:hover-left={hoverLeft}>
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div id="content">
        <div id="frame">
            {#if $media.url || $media.type === "youtube"}
                <div id="yt-player-game" style="width:100%;height:100%;" style:display={$media.type === "youtube" ? "block" : "none"}></div>
                {#if $media.type !== "youtube"}
                    {#if $media.type === "video"}
                        <video src={$media.url}></video>
                    {:else if $media.type === "audio"}
                        <img
                            src={$imageURL}
                            alt="Selected Media"
                        />
                    {/if}
                {/if}

                <GameOverlay bind:this={overlayRef}>
                    {#snippet controlBar()}
                        <div id="control">
                            {#if currentReplay}
                                <span class="replay-indicator" title={`リプレイ: ${currentReplay.name}`}>
                                    リプレイ: {currentReplay.name}
                                </span>
                                <button type="button" class="exit-replay-btn" onclick={exitReplay} title="通常プレイに戻る">×</button>
                            {/if}
                            <a href="/edit/{data.chart.id}" class="chart-action-btn" title="エディタで開く">Edit</a>
                            {#if data.chart.youtube_video_id}
                                <button type="button" class="chart-action-btn" onclick={openYouTube}>YouTube</button>
                            {/if}
                            {#if $gamePhase !== 'waiting'}
                                <div id="volume-controler">
                                    <input
                                        type="range"
                                        style="flex-grow: 1;"
                                        min="0"
                                        max="100"
                                        step="1"
                                        value={$volume}
                                        oninput={onGameVolumeChange}
                                    />
                                    <span id="volume">{$volume}</span>
                                </div>
                            {/if}
                        </div>
                    {/snippet}
                    {#snippet resultActions()}
                        {#if currentReplay}
                            <button class="result-btn ranking-btn" onclick={exitReplay}>通常プレイに戻る</button>
                        {:else if !data.profile}
                            <a href="/auth/login" class="result-btn ranking-btn">ログインして登録</a>
                        {:else}
                            {#if scoreSubmitStatus === 'idle'}
                                <button class="result-btn ranking-btn" onclick={() => submitScore()}>ランキング登録</button>
                            {:else if scoreSubmitStatus === 'sending'}
                                <button class="result-btn ranking-btn" disabled>送信中...</button>
                            {:else if scoreSubmitStatus === 'sent'}
                                <button class="result-btn ranking-btn sent" disabled>登録済み</button>
                            {:else if scoreSubmitStatus === 'error'}
                                <button class="result-btn ranking-btn error" onclick={() => { scoreSubmitStatus = 'idle'; }}>{scoreSubmitError} (再試行)</button>
                            {/if}
                        {/if}
                        <button class="result-btn retry-btn" onclick={() => retryGame()}>Retry</button>
                        <a href="/" class="result-btn select-btn">譜面一覧へ</a>
                    {/snippet}
                </GameOverlay>
            {:else}
                <div id="empty-frame">
                    {#if chartDataQuery.isError}
                        <div style="color: #ff8888; font-size: 1.1rem;">譜面の読み込みに失敗しました</div>
                    {:else}
                        <div style="color: #ccc; font-size: 1.1rem;">読み込み中...</div>
                    {/if}
                </div>
            {/if}
        </div>
    </div>

    <div class="bottom-section">
    <div class="ranking-section">
        <h3 class="ranking-title">ランキング</h3>
        <div class="ranking-scroll">
        {#if rankingsQuery.isPending}
            <p class="ranking-empty">読み込み中...</p>
        {:else if rankingsQuery.isError}
            <p class="ranking-empty">ランキング取得に失敗しました</p>
        {:else if rankingsQuery.data && rankingsQuery.data.rankings.length > 0}
            <table class="ranking-table">
                <thead>
                    <tr>
                        <th class="rank-col">#</th>
                        <th class="user-col">ユーザー</th>
                        <th class="score-col">スコア</th>
                        <th class="speed-col">速度</th>
                        <th class="backspace-col">Backspace</th>
                        <th class="replay-col"></th>
                    </tr>
                </thead>
                <tbody>
                    {#each rankingsQuery.data.rankings as entry, i}
                        <tr class:my-score={entry.user_id === data.currentUserId}>
                            <td class="rank-col">{i + 1}</td>
                            <td class="user-col">
                                <span class="user-name">{entry.name}</span>
                            </td>
                            <td class="score-col">{Math.floor(entry.score).toLocaleString()}</td>
                            <td class="speed-col">{entry.typing_speed.toFixed(2)}<span class="unit">cpm</span></td>
                            <td class="backspace-col">{entry.backspace_count}</td>
                            <td class="replay-col">
                                <button
                                    class="replay-btn"
                                    type="button"
                                    onclick={() => startReplayFor(entry.id)}
                                    disabled={replayLoading}
                                    title="リプレイ再生"
                                    aria-label="リプレイ再生"
                                >
                                    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                                        <path d="M3 2 L13 8 L3 14 Z" fill="currentColor" />
                                    </svg>
                                </button>
                            </td>
                        </tr>
                    {/each}
                </tbody>
            </table>
        {:else}
            <p class="ranking-empty">まだスコアがありません</p>
        {/if}
        </div>
    </div>

    <aside class="other-charts-section">
        <h3 class="ranking-title">その他の譜面</h3>
        <div class="other-charts-scroll">
        {#if otherChartsQuery.isPending}
            <p class="ranking-empty">読み込み中...</p>
        {:else if otherChartsQuery.isError}
            <p class="ranking-empty">取得に失敗しました</p>
        {:else if otherChartsQuery.data}
            <ul class="other-charts-list">
                {#each otherChartsQuery.data.charts.filter((c) => c.id !== data.chart.id) as c (c.id)}
                    <li>
                        <a href="/chart/{c.id}" class="other-chart-row">
                            {#if c.youtube_video_id}
                                <img
                                    class="other-chart-thumb"
                                    src="https://img.youtube.com/vi/{c.youtube_video_id}/default.jpg"
                                    alt=""
                                    loading="lazy"
                                />
                            {:else}
                                <div class="other-chart-thumb other-chart-thumb-placeholder"></div>
                            {/if}
                            <div class="other-chart-text">
                                <div class="other-chart-title">{c.title}</div>
                                {#if c.artist}
                                    <div class="other-chart-artist">{c.artist}</div>
                                {/if}
                                <div class="other-chart-meta">
                                    <span>平均 {c.avg_cpm ?? '--'} CPM</span>
                                    <span class="other-chart-meta-sep">·</span>
                                    <span>最高 {c.peak_cpm ?? '--'}</span>
                                </div>
                            </div>
                        </a>
                    </li>
                {/each}
            </ul>
        {/if}
        </div>
    </aside>
    </div>
</div>

<style>
    :global(body) {
        background-color: #000;
    }

    #game {
        display: flex;
        flex-direction: column;
        align-items: center;
        font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
    }

    #control {
        width: 100%;
        height: 32px;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0 12px;
        box-sizing: border-box;
    }
    .chart-action-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 58px;
        height: 22px;
        box-sizing: border-box;
        color: #aaa;
        font-family: inherit;
        font-size: 0.65rem;
        font-weight: 400;
        line-height: 1;
        text-decoration: none;
        padding: 0;
        border: 1px solid #444;
        border-radius: 4px;
        white-space: nowrap;
        background: #151515;
        cursor: pointer;
    }
    .chart-action-btn:hover {
        color: #ddd;
        border-color: #888;
        background: #202020;
    }

    .replay-indicator {
        color: #4dd0e1;
        font-size: 0.65rem;
        padding: 1px 6px;
        border: 1px solid #4dd0e1;
        border-radius: 3px;
        white-space: nowrap;
    }

    .exit-replay-btn {
        background: transparent;
        color: #888;
        border: 1px solid #555;
        border-radius: 3px;
        width: 18px;
        height: 18px;
        font-size: 0.75rem;
        line-height: 1;
        cursor: pointer;
        padding: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
    }
    .exit-replay-btn:hover {
        color: #ddd;
        border-color: #888;
    }

    #volume-controler {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 150px;
        margin-left: auto;
    }
    #volume-controler input[type="range"] {
        height: 4px;
        accent-color: #777;
        cursor: pointer;
    }

    #volume {
        width: 24px;
        color: #aaa;
        text-align: right;
        background: transparent;
        border: none;
        font-size: 11px;
    }

    #content {
        width: 100%;
        height: 100vh;
        overflow: hidden;
        position: relative;
    }

    #frame {
        width: 100%;
        height: 100%;
        position: relative;
        background-color: #111;
    }



    #empty-frame {
        display: flex;
        width: 100%;
        height: 100%;
        position: relative;
        background-color: #111;
        flex-direction: column;
        justify-content: center;
        align-items: center;
    }

    #frame img,
    #frame video {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .retry-btn {
        border-color: #4dd0e1;
        color: #4dd0e1;
    }
    .retry-btn:hover {
        background-color: rgba(77, 208, 225, 0.15);
    }
    .select-btn {
        border-color: #aaa;
    }
    .ranking-btn {
        border-color: #ffd54f;
        color: #ffd54f;
    }
    .ranking-btn:hover:not(:disabled) {
        background-color: rgba(255, 213, 79, 0.15);
    }
    .ranking-btn:disabled {
        opacity: 0.5;
        cursor: default;
    }
    .ranking-btn.sent {
        border-color: #81c784;
        color: #81c784;
    }
    .ranking-btn.error {
        border-color: #ef5350;
        color: #ef5350;
    }

    .bottom-section {
        width: 100%;
        margin: 0 auto;
        padding: 28px max(16px, calc((100vw - 1080px) / 2 + 16px)) 40px;
        box-sizing: border-box;
        display: grid;
        grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
        gap: 32px;
        background: linear-gradient(to bottom, #111 0%, #0a0a0a 100%);
        border-top: 1px solid rgba(255, 255, 255, 0.06);
        font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
        transition: transform 0.3s ease, opacity 0.3s ease;
    }

    @media (max-width: 560px) {
        .bottom-section {
            grid-template-columns: 1fr;
            gap: 24px;
        }
    }

    .ranking-section,
    .other-charts-section {
        min-width: 0;
    }

    /* ランキングは ヘッダ ~30px + 行 ~38px × 3 ≈ 144px */
    .ranking-scroll {
        max-height: 156px;
        overflow-y: auto;
        padding-right: 4px;
    }
    /* その他の譜面は 1行 ~62px (thumb 45px + padding 8px*2) + gap 6px ≈ 200px / 3行 */
    .other-charts-scroll {
        max-height: 204px;
        overflow-y: auto;
        padding-right: 4px;
    }
    /* スクロールバー控えめ */
    .ranking-scroll::-webkit-scrollbar,
    .other-charts-scroll::-webkit-scrollbar {
        width: 6px;
    }
    .ranking-scroll::-webkit-scrollbar-thumb,
    .other-charts-scroll::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.12);
        border-radius: 3px;
    }
    .ranking-scroll::-webkit-scrollbar-thumb:hover,
    .other-charts-scroll::-webkit-scrollbar-thumb:hover {
        background: rgba(255, 255, 255, 0.2);
    }
    /* ranking thead は sticky で見える状態を保つ */
    .ranking-scroll .ranking-table thead th {
        position: sticky;
        top: 0;
        background: #080808;
        z-index: 1;
    }
    :global(body:has(#game.input-focused) .sidebar) {
        margin-left: -48px;
        opacity: 0;
    }
    :global(body:has(#game.input-focused.hover-left) .sidebar) {
        margin-left: 0;
        opacity: 1;
    }

    .ranking-title {
        color: #777;
        font-size: 0.68rem;
        margin: 0 0 8px 0;
        font-weight: 500;
        letter-spacing: 0.12em;
        text-transform: uppercase;
    }

    .ranking-table {
        width: 100%;
        table-layout: fixed;
        border-collapse: collapse;
        border-spacing: 0;
        color: #b8b8b8;
        font-size: 0.76rem;
        background: #050505;
        border: 1px solid #242424;
    }

    .ranking-table thead th {
        color: #7a7a7a;
        font-weight: 400;
        padding: 3px 6px;
        text-align: left;
        font-size: 0.7rem;
        letter-spacing: 0;
        text-transform: none;
        white-space: nowrap;
        border-bottom: 1px solid #2b2b2b;
        background: #050505;
    }

    .ranking-table tbody td {
        padding: 6px;
        border-bottom: 1px solid #202020;
        vertical-align: middle;
        white-space: nowrap;
        height: 26px;
    }

    .ranking-table tbody tr:last-child td {
        border-bottom: none;
    }

    .ranking-table tbody tr {
        background: #090909;
    }
    .ranking-table tbody tr:hover {
        background-color: #111;
    }

    .ranking-table tr.my-score td {
        background-color: inherit;
        color: inherit;
    }

    .rank-col {
        width: 28px;
        text-align: center;
        color: #9a9a9a;
        font-variant-numeric: tabular-nums;
    }

    .user-col {
        width: auto;
        min-width: 0;
    }
    .user-name {
        color: #d0d0d0;
        font-weight: 400;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        display: inline-block;
        max-width: 100%;
    }
    .my-score .user-name { color: #47d7e8; }

    .score-col {
        width: 76px;
        text-align: right;
        font-weight: 500;
        font-variant-numeric: tabular-nums;
        font-size: 0.82rem;
        color: #d6d6d6;
    }
    .speed-col {
        width: 66px;
        text-align: right;
        color: #a8a8a8;
        font-variant-numeric: tabular-nums;
    }
    .speed-col .unit { color: #666; font-size: 0.58rem; margin-left: 2px; font-weight: normal; }
    .backspace-col {
        width: 72px;
        text-align: right;
        color: #a0a0a0;
        font-variant-numeric: tabular-nums;
    }
    .replay-col { width: 28px; text-align: center; }
    .ranking-table thead .rank-col {
        text-align: center;
    }
    .ranking-table thead .user-col {
        text-align: left;
    }
    .ranking-table thead .score-col,
    .ranking-table thead .speed-col,
    .ranking-table thead .backspace-col {
        text-align: right;
    }
    .replay-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        color: #777;
        text-decoration: none;
        background: transparent;
        border: 1px solid #2a2a2a;
        border-radius: 2px;
        cursor: pointer;
        padding: 0;
        transition: color 0.15s ease, border-color 0.15s ease, background-color 0.15s ease;
    }
    .replay-btn:hover:not(:disabled) {
        color: #bdbdbd;
        border-color: #555;
        background-color: #161616;
    }
    .replay-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }

    .ranking-empty {
        color: #666;
        font-size: 0.8rem;
        text-align: center;
        padding: 16px 0;
        margin: 0;
    }

    .other-charts-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .other-chart-row {
        display: flex;
        gap: 10px;
        padding: 8px;
        border-radius: 6px;
        text-decoration: none;
        color: inherit;
        background: rgba(255, 255, 255, 0.02);
        border: 1px solid rgba(255, 255, 255, 0.05);
        transition: background-color 0.12s ease, border-color 0.12s ease;
    }
    .other-chart-row:hover {
        background: rgba(255, 255, 255, 0.05);
        border-color: rgba(255, 255, 255, 0.12);
    }
    .other-chart-thumb {
        flex: 0 0 auto;
        width: 80px;
        aspect-ratio: 16 / 9;
        object-fit: cover;
        border-radius: 4px;
        background: #0e0f12;
        display: block;
    }
    .other-chart-thumb-placeholder {
        background: linear-gradient(135deg, #2a2a30, #1a1a20);
    }
    .other-chart-text {
        flex: 1 1 auto;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
        justify-content: center;
    }
    .other-chart-title {
        color: #ddd;
        font-size: 0.85rem;
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .other-chart-artist {
        color: #888;
        font-size: 0.72rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .other-chart-meta {
        color: #666;
        font-size: 0.68rem;
        font-variant-numeric: tabular-nums;
        margin-top: 2px;
    }
    .other-chart-meta-sep {
        margin: 0 4px;
        color: #444;
    }

</style>
