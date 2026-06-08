<script lang="ts">
    import { onMount, tick } from "svelte";
    import { parseChart, type ParsedChart, type MediaSource } from "$lib/parseLyric/parse-chart.ts";
    import { ChartGame } from "$lib/chart-game.ts";
    import GameOverlay from "$lib/components/GameOverlay.svelte";
    import { addKeyHandler } from "$lib/hotkeys.ts";
    import { volume, imageURL, media } from "../../../store.ts";
    import { updateSetting } from "$lib/settings";
    import { get } from "svelte/store";

    // ゲーム内スライダー操作時に volume + settings 両方更新
    function onGameVolumeChange(e: Event) {
        const v = +(e.currentTarget as HTMLInputElement).value;
        volume.set(v);
        updateSetting('volume', v);
    }

    // Store references
    const { gamePhase } = ChartGame;

    // inputフォーカス状態（UI隠蔽用）
    let inputFocused = $state(false);
    let hoverTop = $state(false);
    let hoverLeft = $state(false);

    let overlayRef: GameOverlay;

    async function retryGame() {
        await ChartGame.retry();
        overlayRef?.resetTab();
    }

    async function handleStartKey(e: KeyboardEvent) {
        const phase = get(gamePhase);
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

    let showSourceDialog = $state(false);
    let dialogSources = $state<MediaSource[]>([]);
    let pendingChart = $state<ParsedChart | null>(null);

    // YTプレイヤーのonReadyコールバック用バージョン管理（古い譜面のonReadyを無効化する）
    let ytLoadId = 0;

    async function chartFileUpload(event: Event) {
        const input = event.target as HTMLInputElement;
        const files = input.files;

        if (!files || files.length === 0) return;

        // 前のゲーム状態をリセット（YTプレイヤーはstop()のaudio.pause()後に破棄する）
        ChartGame.stop();
        if ((window as any).__ytPlayerGame) {
            (window as any).__ytPlayerGame.destroy();
            (window as any).__ytPlayerGame = null;
        }
        ytLoadId++; // 古いonReadyコールバックを無効化
        ChartGame.init();
        await tick();

        const parsedChart = await parseChart(files);

        if (parsedChart) {
            const sources = parsedChart.availableSources;

            if (sources.length >= 2) {
                pendingChart = parsedChart;
                dialogSources = sources;
                showSourceDialog = true;
            } else {
                await startWithSource(parsedChart, sources[0]);
            }
        }

        // 同じフォルダを再選択できるようにリセット
        input.value = "";
    }

    async function selectSource(source: MediaSource) {
        showSourceDialog = false;
        if (!pendingChart) return;
        await startWithSource(pendingChart, source);
        pendingChart = null;
    }

    async function startWithSource(chart: ParsedChart, source: MediaSource) {
        chart.media = {
            url: source.url || "",
            type: source.type,
            ...(source.videoId ? { videoId: source.videoId } : {}),
        };

        if (source.type === "youtube" && source.videoId) {
            await loadYTAndPlay(chart, source.videoId);
        } else {
            // 前のYTプレイヤーを破棄
            if ((window as any).__ytPlayerGame) {
                (window as any).__ytPlayerGame.destroy();
                (window as any).__ytPlayerGame = null;
            }
            ChartGame.init();
            ChartGame.load(chart);
        }
    }

    async function loadYTAndPlay(chart: ParsedChart, videoId: string) {
        const loadId = ytLoadId; // このロードのバージョンを確定
        media.set(chart.media);
        imageURL.set(chart.imageURL);
        await tick();

        const existing = document.getElementById("yt-api-script");
        if (existing && (window as any).YT?.Player) {
            createGameYTPlayer(videoId, chart, loadId);
        } else if (!existing) {
            (window as any).onYouTubeIframeAPIReady = () => {
                createGameYTPlayer(videoId, chart, loadId);
            };
            const script = document.createElement("script");
            script.id = "yt-api-script";
            script.src = "https://www.youtube.com/iframe_api";
            document.head.appendChild(script);
        } else {
            // スクリプト読み込み中 — readyを待つ
            (window as any).onYouTubeIframeAPIReady = () => {
                createGameYTPlayer(videoId, chart, loadId);
            };
        }
    }

    function createGameYTPlayer(videoId: string, chart: ParsedChart, loadId: number) {
        const container = document.getElementById("yt-player-game");
        if (!container) return;
        // 既存プレイヤーを破棄
        if ((window as any).__ytPlayerGame) {
            (window as any).__ytPlayerGame.destroy();
            (window as any).__ytPlayerGame = null;
        }
        (window as any).__ytPlayerGame = new YT.Player("yt-player-game", {
            videoId,
            playerVars: { rel: 0, modestbranding: 1, controls: 0, cc_load_policy: 0, iv_load_policy: 3 },
            events: {
                onReady: () => {
                    if (loadId !== ytLoadId) return; // 古いonReadyは無視
                    ChartGame.init();
                    ChartGame.load(chart);
                },
            },
        });
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
            <!-- YTプレイヤーコンテナは常にDOMに存在させる（YT APIがdivをiframeに差し替えるため {#if} で破棄するとSvelteの参照がずれる） -->
            <div id="yt-player-game" style="width:100%;height:100%;" style:display={$media.type === "youtube" ? "block" : "none"}></div>
            {#if $media.url || $media.type === "youtube"}
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
                            <button
                                id="load-chart-btn"
                                onclick={() => document.getElementById("file-upload")?.click()}
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                                    <path d="M12.687,13.278c-.057-.057-.12-.106-.187-.146v9.867h-1V13.133c-.066,.04-.129,.088-.187,.146l-3.203,3.202-.707-.707,3.203-3.202c.769-.768,2.019-.77,2.787,0l3.203,3.202-.707,.707-3.203-3.202Zm11.313-7.778V23H15v-1h8V8H1v14H9v1H0V3.5C0,2.121,1.122,1,2.5,1h5.618l4,2h9.382c1.378,0,2.5,1.121,2.5,2.5Zm-1,1.5v-1.5c0-.827-.673-1.5-1.5-1.5H11.882L7.882,2H2.5c-.827,0-1.5,.673-1.5,1.5v3.5H23Z"/>
                                </svg>
                                開く
                            </button>
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
                        </div>
                    {/snippet}
                    {#snippet resultActions()}
                        <button class="result-btn retry-btn" onclick={() => retryGame()}>Retry</button>
                        <button class="result-btn select-btn" onclick={() => document.getElementById('file-upload')?.click()}>Select Chart</button>
                    {/snippet}
                </GameOverlay>
            {:else}
                <div
                    id="empty-frame"
                    role="button"
                    tabindex="0"
                    onclick={() => {
                        if (!$imageURL)
                            document.getElementById("file-upload")?.click();
                    }}
                    onkeydown={(event) => {
                        if (
                            !$imageURL &&
                            (event.key === "Enter" || event.key === " ")
                        )
                            document.getElementById("file-upload")?.click();
                    }}
                >
                    <svg
                        id="upload-icon"
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        ><path
                            d="M12.687,13.278c-.057-.057-.12-.106-.187-.146v9.867h-1V13.133c-.066,.04-.129,.088-.187,.146l-3.203,3.202-.707-.707,3.203-3.202c.769-.768,2.019-.77,2.787,0l3.203,3.202-.707,.707-3.203-3.202Zm11.313-7.778V23H15v-1h8V8H1v14H9v1H0V3.5C0,2.121,1.122,1,2.5,1h5.618l4,2h9.382c1.378,0,2.5,1.121,2.5,2.5Zm-1,1.5v-1.5c0-.827-.673-1.5-1.5-1.5H11.882L7.882,2H2.5c-.827,0-1.5,.673-1.5,1.5v3.5H23Z"
                        /></svg
                    >
                    <div style="padding: 0 10px 0 10px">
                        Click here to load your chart folder
                    </div>
                </div>
            {/if}
        </div>
    </div>

    <input
        type="file"
        id="file-upload"
        onchange={chartFileUpload}
        style="display: none;"
        webkitdirectory
    />
</div>

{#if showSourceDialog}
<div class="source-dialog-overlay" role="dialog">
    <div class="source-dialog">
        <div class="source-dialog-title">メディアソースを選択</div>
        {#each dialogSources as source}
            <button class="source-dialog-btn" onclick={() => selectSource(source)}>
                <span class="source-type-tag">{source.type === "audio" ? "音声" : source.type === "video" ? "動画" : "YouTube"}</span>
                {source.label}
            </button>
        {/each}
    </div>
</div>
{/if}

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
    :global(body:has(#game.input-focused) .sidebar) {
        margin-left: -48px;
        opacity: 0;
    }
    :global(body:has(#game.input-focused.hover-left) .sidebar) {
        margin-left: 0;
        opacity: 1;
    }

    #load-chart-btn {
        display: flex;
        align-items: center;
        width: fit-content;
        gap: 4px;
        padding: 2px 10px;
        color: #ccc;
        background-color: rgba(255, 255, 255, 0.1);
        border: 1px solid #666;
        border-radius: 5px;
        cursor: pointer;
        font-size: 0.75rem;
        white-space: nowrap;
    }

    #load-chart-btn:hover {
        background-color: rgba(255, 255, 255, 0.2);
        color: white;
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
        background-color: #000;
    }



    #empty-frame {
        display: flex;
        width: 100%;
        height: 100%;
        position: relative;
        background-color: #222;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        font-family: Segoe UI, "Yu Gothic", "YuGothic", sans-serif !important;
    }

    #frame img,
    #frame video {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    #upload-icon {
        width: 30%;
        height: 30%;
        max-width: 200px;
        max-height: 200px;
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

    .source-dialog-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.6);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
    }
    .source-dialog {
        background: #2a2a2a;
        border-radius: 12px;
        padding: 24px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        min-width: 240px;
    }
    .source-dialog-title {
        color: #eee;
        font-size: 16px;
        font-weight: bold;
        text-align: center;
        margin-bottom: 4px;
    }
    .source-dialog-btn {
        background: #3a3a3a;
        color: #eee;
        border: 1px solid #555;
        border-radius: 8px;
        padding: 12px 16px;
        font-size: 15px;
        cursor: pointer;
        text-align: left;
    }
    .source-dialog-btn:hover {
        background: #4a4a4a;
        border-color: #888;
    }
    .source-type-tag {
        display: inline-block;
        min-width: 48px;
        padding: 1px 6px;
        margin-right: 8px;
        font-size: 11px;
        color: #aaa;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 3px;
        text-align: center;
    }
</style>
