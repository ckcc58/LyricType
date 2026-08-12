<script lang="ts">
    import { onMount, tick } from "svelte";
    import type { ParsedChart, MediaSource } from "$lib/parseLyric/parse-chart.ts";
    import { ChartGame, YTMediaProxy } from "$lib/chart-game.ts";
    import GameOverlay from "$lib/components/GameOverlay.svelte";
    import { addKeyHandler, removeKeyHandler } from "$lib/hotkeys.ts";
    import { volume, imageURL, media } from "../../../store.ts";
    import { updateSetting } from "$lib/settings";
    import { chartFromJSON, type ChartDataJSON } from "$lib/chart-serialization";
    import { createPreviewState } from "$lib/chart-preview.svelte";
    import { ensureYouTubeIframeApi } from "$lib/youtube-iframe-api";
    import ChartPreviewDock from "$lib/components/ChartPreviewDock.svelte";
    import { get } from "svelte/store";
    import { page } from "$app/stores";
    import { invalidateAll } from "$app/navigation";
    import { createQuery, useQueryClient } from "@tanstack/svelte-query";

    const queryClient = useQueryClient();

    let { data } = $props();

    // 譜面本体は SSR HTML から外して、クライアントから別 API で取得する。
    // queryKey に updated_at を含めるので、譜面が更新されたら自動的に別キー扱いとなり再取得される。
    // ?v= 付き URL はサーバー側で immutable キャッシュされる(更新で URL ごと変わる)。
    // ※ chart/[id] は同一ルート遷移でコンポーネントが再利用される(onMount は再実行されない)ため、
    //   const で固定すると譜面切替後も前の URL を fetch してしまう。$derived で data に追従させる。
    const chartVersion = $derived(data.chart.updated_at ?? data.chart.created_at);
    const chartDataUrl = $derived(`/api/chart/${data.chart.id}/data?v=${encodeURIComponent(chartVersion)}`);
    const chartDataQuery = createQuery<{ chart_data: ChartDataJSON; version: string }>(() => ({
        queryKey: ['chart-data', data.chart.id, chartVersion],
        queryFn: async () => {
            const res = await fetch(chartDataUrl);
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
        staleTime: 0, // ページに来るたびに再取得して常に最新を表示
    }));

    // その他の譜面（最新の譜面一覧から、現在の譜面を除く）
    type OtherChart = {
        id: number;
        title: string;
        artist: string | null;
        avg_cpm: number | null;
        median_cpm: number | null;
        peak_cpm: number | null;
        youtube_video_id: string | null;
        preview_time: number | null;
    };
    const otherChartsQuery = createQuery<{ charts: OtherChart[] }>(() => ({
        queryKey: ['other-charts'],
        queryFn: async () => {
            const res = await fetch(`/api/charts?page=0`);
            if (!res.ok) throw new Error('failed to load other charts');
            return res.json();
        },
        // ページに来るたびに再検証する。サーバ側が ETag を返すので
        // 内容が変わっていなければ 304 (本文なし) で実質タダ
        staleTime: 0,
    }));

    // --- その他の譜面のプレビュー再生 (ロジックは $lib/chart-preview で共有) ---
    const preview = createPreviewState();
    let previewChart = $derived(
        preview.id === null
            ? null
            : (otherChartsQuery.data?.charts.find((c) => c.id === preview.id) ?? null),
    );

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

    async function submitScore() {
        if (scoreSubmitStatus !== 'idle') return;
        if (currentReplay) return; // リプレイモードでは送信しない
        const profile = get(page).data?.profile;
        if (!profile) return;

        scoreSubmitStatus = 'sending';
        try {
            // lyric_data / chart_hash はサーバが charts.chart_data から組むため送らない。
            // 代わりにプレイ開始時の版 (updated_at) を送り、版ズレ検出に使う。
            const res = await fetch('/api/result', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chart_id:            data.chart.id,
                    client_version:      String(data.chart.updated_at ?? data.chart.created_at ?? ''),
                    score:               $score,
                    typing_speed:        $typingSpeed,
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
        if (currentReplay) {
            // リプレイからの Retry は画面遷移なしで同じリプレイを 0 秒から再生し直す
            await ChartGame.restartReplay();
            return;
        }
        await ChartGame.retry();
    }

    // ロード済みセッションキー（chart_id + replay_id の組み合わせ）。
    // currentReplay が変わったら再初期化したいので id 単位で判定する。
    let lastInitKey: string | null = null;


    // 譜面切替(同一ルート遷移)時に前の譜面の残留状態をリセットする。
    // コンポーネントが再利用され onMount が再実行されないため、明示的にクリアが必要。
    let lastResetId: number | null = null;
    $effect(() => {
        const id = data.chart.id;
        if (lastResetId === id) return;
        lastResetId = id;
        currentReplay = null;
        scoreSubmitStatus = 'idle';
        scoreSubmitError = '';
        // 譜面→譜面の同一ルート遷移ではコンポーネントが再マウントされないため、
        // グローバルキーの「その他の譜面」を明示的に再検証する (ETag で 304 なら実質タダ)
        queryClient.invalidateQueries({ queryKey: ['other-charts'] });
    });

    // chart_data が届いた時 + リプレイ切替時に ChartGame を初期化/再初期化
    $effect(() => {
        const d = chartDataQuery.data;
        if (!d) return;
        const initKey = `${data.chart.id}:${currentReplay?.result_id ?? 'live'}`;
        if (initKey === lastInitKey) return;
        lastInitKey = initKey;
        const isReplay = !!currentReplay;
        // 統計: ライブプレイのみ記録（リプレイ再生は記録しない）
        ChartGame.statsContext = isReplay
            ? null
            : { chartId: data.chart.id, source: 'chart' };
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
                preview.stop(); // ゲーム音とプレビューが二重に鳴らないよう止める
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
        // onMount で先行生成済みならここでは待つだけ(iframe 起動と譜面データ取得が並列になる)
        await prepareGameYTPlayer(videoId);
        // プレイヤー再利用時(リプレイ切替等)に前回の再生位置が残っていたら頭出しする
        const player = (window as any).__ytPlayerGame as YT.Player | undefined;
        if (player && typeof player.getCurrentTime === "function" && player.getCurrentTime() > 0.5) {
            player.seekTo(0, true);
            player.pauseVideo();
        }
        ChartGame.load(chart);
    }

    // 生成済み/生成中プレイヤーの管理。videoId が同じなら同一の準備 Promise を共有する
    let ytPlayerPrep: { videoId: string; promise: Promise<void> } | null = null;

    function prepareGameYTPlayer(videoId: string): Promise<void> {
        if (ytPlayerPrep?.videoId === videoId) return ytPlayerPrep.promise;
        const promise = (async () => {
            // コンテナ(#yt-player-game)を描画させるため、譜面データ到着前でも media を youtube にしておく
            if (get(media).type !== "youtube") {
                media.set({ url: "", type: "youtube", videoId });
            }
            await tick();
            await ensureYouTubeIframeApi();
            const container = document.getElementById("yt-player-game");
            if (!container) return;
            if ((window as any).__ytPlayerGame) {
                (window as any).__ytPlayerGame.destroy();
            }
            await new Promise<void>((resolve) => {
                (window as any).__ytPlayerGame = new YT.Player("yt-player-game", {
                    videoId,
                    playerVars: { rel: 0, modestbranding: 1, controls: 0, cc_load_policy: 0, iv_load_policy: 3 },
                    events: {
                        onReady: () => resolve(),
                        // 字幕の強制オフ。cc_load_policy:0 は「視聴者のYouTube設定に従う」なので、
                        // 字幕モジュールがロードされた通知 (onApiChange) の時点で表示トラックを
                        // 空にする。unloadModule は現行プレイヤーでは無効化されており使えない。
                        onApiChange: (e: { target: YT.Player }) => {
                            try {
                                const p = e.target as any;
                                if (p.getOptions?.()?.includes?.('captions')) {
                                    p.setOption('captions', 'track', {});
                                }
                            } catch { /* API 変更時も字幕が出るだけに留める */ }
                        },
                    },
                });
            });
        })();
        ytPlayerPrep = { videoId, promise };
        return promise;
    }

    async function handleStartKey(e: KeyboardEvent) {
        const phase = get(gamePhase);

        // プレビュー再生中の Esc はプレビュー停止を優先する
        // (ゲーム中の一時停止より、今出ているプレイヤーを閉じる方が自然)
        if (preview.handleEscape(e)) return;

        // リプレイ中: 左右矢印で 5 秒シーク
        if (e.key === 'Enter' && phase === 'waiting') {
            e.preventDefault();
            preview.stop(); // ゲーム音とプレビューが二重に鳴らないよう止める
            ChartGame.start();
            await tick();
            document.getElementById('text-input')?.focus();
        } else if (e.key === 'Escape' && phase === 'playing') {
            // grace 中は対象外: grace は performance.now() ベースで一時停止不能なうえ、
            // 終了扱いの media に play() すると途中再開/先頭再生の不具合を誘発する
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
            const wasReplay = !!currentReplay;
            await retryGame();
            // リプレイからの F4 は restartReplay 済みなので通常プレイ用の start() は呼ばない
            if (wasReplay) return;
            preview.stop(); // ゲーム音とプレビューが二重に鳴らないよう止める
            ChartGame.start();
            await tick();
            document.getElementById('text-input')?.focus();
        }
    }

    onMount(() => {
        if (data.chart.youtube_video_id) {
            // 譜面データの取得を待たずに YT プレイヤーを先行生成する
            void prepareGameYTPlayer(data.chart.youtube_video_id);
        }

        addKeyHandler();
        document.addEventListener('keydown', handleStartKey);

        // 全画面表示 (inputFocused) の切り替え。
        //   ON : 入力欄にフォーカスが入ったとき
        //   OFF: play-box の外をクリック / play-box 外の要素にフォーカスが入ったとき
        // focusout は使わない (移動先が確定せず、play-box 内のボタンを押しただけで
        // 解除されてしまうため)。
        const onFocusIn = (e: FocusEvent) => {
            const target = e.target as HTMLElement | null;
            if (target?.id === 'text-input') {
                inputFocused = true;
            } else if (target && !target.closest('#play-box')) {
                // サイドメニュー等、play-box の外へフォーカスが移ったら解除
                inputFocused = false;
            }
        };
        const onPointerDown = (e: PointerEvent) => {
            const target = e.target as HTMLElement | null;
            if (!target || !target.closest('#play-box')) {
                inputFocused = false;
            }
        };
        document.addEventListener('focusin', onFocusIn);
        document.addEventListener('pointerdown', onPointerDown);

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

        // 統計: タブ離脱/リロード時に進行中プレイを beacon で送る
        const onPageHide = () => ChartGame.flushPlayStats({ viaBeacon: true });
        window.addEventListener('pagehide', onPageHide);

        return () => {
            // SPA 遷移で離脱する場合は進行中プレイをフラッシュしてから破棄
            ChartGame.flushPlayStats();
            ChartGame.statsContext = null;
            window.removeEventListener('pagehide', onPageHide);
            ChartGame.stop();
            ChartGame.init();
            document.removeEventListener('keydown', handleStartKey);
            document.removeEventListener('focusin', onFocusIn);
            document.removeEventListener('pointerdown', onPointerDown);
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseleave', onMouseLeave);
        };
    });
</script>

<svelte:head>
    <!-- ハイドレーション完了を待たず、HTML パース時点で譜面データの取得を開始させる -->
    <link rel="preload" as="fetch" href={chartDataUrl} />
</svelte:head>

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
                            <button
                                type="button"
                                class="chart-action-btn shortcut-help-btn"
                                onclick={() => overlayRef?.toggleShortcuts()}
                                title="ショートカット一覧">?</button
                            >
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
                        <button class="result-btn retry-btn" onclick={() => retryGame()}>リトライ</button>
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
        <ChartPreviewDock
            chart={previewChart}
            position="top"
            onclose={() => preview.stop()}
        />
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
                                    src="https://i.ytimg.com/vi/{c.youtube_video_id}/mqdefault.jpg"
                                    alt=""
                                    loading="lazy"
                                    decoding="async"
                                    width="320"
                                    height="180"
                                />
                            {:else}
                                <div class="other-chart-thumb other-chart-thumb-placeholder"></div>
                            {/if}
                            <div class="other-chart-text">
                                <div class="other-chart-title">{c.title}</div>
                                <div class="other-chart-artist">{c.artist ?? ''}</div>
                                <div class="other-chart-line">中央値 {c.median_cpm ?? '--'} CPM</div>
                                <div class="other-chart-line">最高 {c.peak_cpm ?? '--'} CPM</div>
                            </div>
                            {#if c.youtube_video_id}
                                <button
                                    type="button"
                                    class="other-preview-btn"
                                    class:playing={preview.isPlaying(c.id)}
                                    onclick={(e) => preview.toggle(e, c)}
                                    aria-label="{c.title} のプレビューを{preview.isPlaying(c.id)
                                        ? '止める'
                                        : '再生'}"
                                    title={preview.isPlaying(c.id)
                                        ? 'プレビューを止める (Esc)'
                                        : 'プレビューを再生'}
                                    >{preview.isPlaying(c.id) ? '■' : '▶'}</button
                                >
                            {/if}
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
    #game {
        display: flex;
        flex-direction: column;
        align-items: center;
        min-height: 100%;
        box-sizing: border-box;
        background-color: var(--bg-game);
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
    /* ローカル譜面 chart/local の #load-chart-btn と同一の宣言に揃えること */
    .chart-action-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        width: fit-content;
        box-sizing: border-box;
        padding: 2px 10px;
        color: #ccc;
        background-color: rgba(255, 255, 255, 0.1);
        border: 1px solid #666;
        border-radius: 5px;
        cursor: pointer;
        font-family: inherit;
        font-size: 0.75rem;
        font-weight: 400;
        line-height: normal;
        text-decoration: none;
        white-space: nowrap;
    }
    .chart-action-btn:hover {
        background-color: rgba(255, 255, 255, 0.2);
        color: white;
    }

    /* リプレイ中の表示: 彩度を持たせず、他のコントロールと同じ無彩色で揃える */
    .replay-indicator {
        color: #ddd;
        font-size: 0.65rem;
        padding: 1px 6px;
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid #555;
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
        width: 150px;
        margin-left: auto;
    }
    #volume-controler input[type="range"] {
        height: 4px;
        min-width: 0; /* range の固有幅で #volume を押し出さないようにする */
        accent-color: #777;
        cursor: pointer;
    }

    /* 3 桁 (100) でも縮まないよう flex-shrink: 0。
       tabular-nums で桁数が変わっても右端がぶれないようにする */
    #volume {
        flex-shrink: 0;
        width: 22px;
        color: #aaa;
        text-align: right;
        background: transparent;
        border: none;
        font-size: 11px;
        font-variant-numeric: tabular-nums;
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

    /* 自分の行: 色ではなく「わずかな背景 + 左の罫線」で示す */
    .ranking-table tr.my-score td {
        background-color: rgba(255, 255, 255, 0.06);
        color: inherit;
    }
    .ranking-table tr.my-score td:first-child {
        box-shadow: inset 2px 0 0 rgba(255, 255, 255, 0.5);
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
    .my-score .user-name {
        color: #fff;
        font-weight: 600;
    }

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
        position: relative;
        display: block;
        overflow: hidden;
        padding: 10px 12px;
        border-radius: 6px;
        text-decoration: none;
        color: inherit;
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.06);
        transition: background-color 0.12s ease, border-color 0.12s ease;
    }
    .other-chart-row:hover {
        background: rgba(255, 255, 255, 0.06);
        border-color: rgba(255, 255, 255, 0.14);
    }
    /* サムネ: テキストの背後に 16:9 で透過表示。右端から左へフェードさせて文字を読みやすく保つ */
    /* 行の右下に置くプレビュー再生ボタン。
       行にポインタ/フォーカスがあるときだけ出し、再生中は常時表示する */
    .other-preview-btn {
        position: absolute;
        right: 8px;
        bottom: 8px;
        z-index: 2;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        padding: 0;
        border: 1px solid rgba(255, 255, 255, 0.5);
        border-radius: 50%;
        background: rgba(0, 0, 0, 0.6);
        color: var(--text-primary);
        font-size: 0.62rem;
        line-height: 1;
        cursor: pointer;
        opacity: 0;
        transition: opacity 0.15s ease, background 0.15s ease;
    }
    .other-chart-row:hover .other-preview-btn,
    .other-preview-btn:focus-visible,
    .other-preview-btn.playing {
        opacity: 1;
    }
    .other-preview-btn:hover {
        background: rgba(0, 0, 0, 0.85);
    }


    .other-chart-thumb {
        position: absolute;
        top: 0;
        right: 0;
        height: 100%;
        aspect-ratio: 16 / 9;
        object-fit: cover;
        opacity: 0.32;
        pointer-events: none;
        z-index: 0;
        -webkit-mask-image: linear-gradient(to left, #000 35%, transparent 95%);
        mask-image: linear-gradient(to left, #000 35%, transparent 95%);
    }
    .other-chart-thumb-placeholder {
        background: linear-gradient(135deg, #2a2a30, #1a1a20);
    }
    /* 文字列は左上から4行 (タイトル / アーティスト / 中央値 / 最高)。
       行間ではなくサイズの階層と小さなグループ間隔で見やすさを出す。 */
    .other-chart-text {
        position: relative;
        z-index: 1;
        display: flex;
        flex-direction: column;
        line-height: 1.3;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85);
    }
    .other-chart-title {
        color: #f2f2f2;
        font-size: 0.92rem;
        font-weight: 700;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .other-chart-artist {
        color: #c8c8c8;
        font-size: 0.72rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-height: 1em; /* artist が空でも4行のレイアウトを保つ */
        /* 名前ブロックと CPM ブロックを視覚的に分ける */
        margin-bottom: 5px;
    }
    .other-chart-line {
        color: #c2c2c2;
        font-size: 0.72rem;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

</style>
