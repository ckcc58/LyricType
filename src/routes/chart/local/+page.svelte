<script lang="ts">
    import { onMount, tick } from "svelte";
    import { parseChart, type ParsedChart, type MediaSource } from "$lib/parseLyric/parse-chart.ts";
    import { ChartGame } from "$lib/chart-game.ts";
    import GameOverlay from "$lib/components/GameOverlay.svelte";
    import { addKeyHandler } from "$lib/hotkeys.ts";
    import { volume, imageURL, media, pendingChartFolder } from "../../../store.ts";
    import { updateSetting } from "$lib/settings";
    import { getDroppedFolder } from "$lib/folder-drop";
    import { goto } from "$app/navigation";
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

    // 読み込み済み譜面フォルダ (エディタへ引き渡すために保持する)
    let loadedFolder = $state<{
        name: string;
        files: File[];
        dirHandle: FileSystemDirectoryHandle | null;
    } | null>(null);

    /** 譜面ファイル群を読み込んでゲームを開始する (フォルダ選択・ドロップ共通)
     *  @param folderName フォルダ名。省略時は webkitRelativePath から求める
     *  @param dirHandle 読み込み元フォルダのハンドル。エディタの保存先に引き継ぐ */
    async function loadChartFiles(
        files: FileList | File[],
        folderName?: string,
        dirHandle: FileSystemDirectoryHandle | null = null,
    ) {
        if (!files || files.length === 0) return;

        const arr = Array.from(files);
        loadedFolder = {
            // ドロップ時は呼び出し側がフォルダ名を渡す。フォルダ選択時は
            // webkitRelativePath の先頭要素がフォルダ名になる。
            name:
                folderName ||
                arr[0]?.webkitRelativePath?.split("/")[0] ||
                arr[0]?.name ||
                "",
            files: arr,
            dirHandle,
        };

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
                sourceFocusIdx = 0;
                showSourceDialog = true;
            } else {
                await startWithSource(parsedChart, sources[0]);
            }
        }
    }

    async function chartFileUpload(event: Event) {
        const input = event.target as HTMLInputElement;
        await loadChartFiles(input.files ?? []);
        // 同じフォルダを再選択できるようにリセット
        input.value = "";
    }

    /** 「開く」ボタン。showDirectoryPicker があればそちらを使う。
     *  こちらは FileSystemDirectoryHandle が取れるので、エディタへ渡せば
     *  そのフォルダにそのまま保存できる (<input webkitdirectory> では取れない)。 */
    async function openChartFolder() {
        if (window.showDirectoryPicker) {
            try {
                const dirHandle = await window.showDirectoryPicker();
                const files: File[] = [];
                // @ts-ignore - FileSystemDirectoryHandle の async iterator
                for await (const [, entry] of dirHandle) {
                    if (entry.kind === "file") {
                        files.push(await entry.getFile());
                    } else if (entry.kind === "directory") {
                        // 1階層だけサブディレクトリも探索 (エディタ側と同じ挙動)
                        // @ts-ignore
                        for await (const [, sub] of entry) {
                            if (sub.kind === "file") files.push(await sub.getFile());
                        }
                    }
                }
                await loadChartFiles(files, dirHandle.name, dirHandle);
                return;
            } catch (e: unknown) {
                if (e instanceof Error && e.name === "AbortError") return;
            }
        }
        // フォールバック: 隠しinput (ハンドルは取れない)
        document.getElementById("file-upload")?.click();
    }

    // エディタへ渡すために store をセットした直後は、この画面では消費しない
    // (セットした瞬間に下の $effect が反応して null に戻してしまうため)
    let leavingToEditor = false;

    // ホーム画面からドロップで渡された譜面フォルダを受け取って開始する
    $effect(() => {
        const pending = $pendingChartFolder;
        if (!pending || leavingToEditor) return;
        pendingChartFolder.set(null); // 一度だけ消費する
        loadChartFiles(pending.files, pending.name, pending.dirHandle ?? null);
    });

    // --- 譜面フォルダのドラッグ&ドロップ ---
    let isDragOver = $state(false);

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
        await loadChartFiles(folder.files, folder.name, folder.dirHandle);
    }

    /** 読み込み済みの譜面フォルダをエディタへ渡して遷移する */
    function openInEditor() {
        if (!loadedFolder) return;
        leavingToEditor = true; // この画面での再読み込みを抑止する
        pendingChartFolder.set(loadedFolder);
        goto("/edit");
    }

    async function selectSource(source: MediaSource) {
        showSourceDialog = false;
        if (!pendingChart) return;
        await startWithSource(pendingChart, source);
        pendingChart = null;
    }

    // --- メディアソース選択ダイアログのキーボード操作 ---
    let sourceFocusIdx = $state(0);
    let sourceBtnEls: (HTMLButtonElement | undefined)[] = $state([]);

    $effect(() => {
        if (showSourceDialog) sourceBtnEls[sourceFocusIdx]?.focus();
    });

    function moveSourceFocus(delta: number) {
        const n = dialogSources.length;
        if (n === 0) return;
        sourceFocusIdx = (sourceFocusIdx + delta + n) % n; // 端で回り込む
        sourceBtnEls[sourceFocusIdx]?.focus();
    }

    function handleSourceKeydown(e: KeyboardEvent) {
        switch (e.code) {
            case "ArrowDown":
            case "KeyK":
                e.preventDefault();
                moveSourceFocus(1);
                return;
            case "ArrowUp":
            case "KeyI":
                e.preventDefault();
                moveSourceFocus(-1);
                return;
            case "Tab":
                e.preventDefault();
                moveSourceFocus(e.shiftKey ? -1 : 1);
                return;
            case "Enter":
            case "Space":
                // ボタンにフォーカスがあれば既定のクリック動作に任せる
                if (document.activeElement?.tagName === "BUTTON") return;
                e.preventDefault();
                if (dialogSources[sourceFocusIdx]) selectSource(dialogSources[sourceFocusIdx]);
                return;
            case "Digit1":
            case "Digit2":
            case "Digit3": {
                e.preventDefault();
                const src = dialogSources[Number(e.code.slice(5)) - 1];
                if (src) selectSource(src);
                return;
            }
        }
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
    }

    onMount(() => {
        // 統計: このページは常にローカル練習(source=local, chart_id=null)として記録する
        ChartGame.statsContext = { chartId: null, source: 'local' };

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

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    id="game"
    class:input-focused={inputFocused}
    class:hover-top={hoverTop}
    class:hover-left={hoverLeft}
    class:dragOver={isDragOver}
    ondragover={handleDragOver}
    ondragleave={handleDragLeave}
    ondrop={handleDrop}
>
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

                <GameOverlay
                    bind:this={overlayRef}
                    showScrollHint={false}
                    showVisualizer={$media.type === "audio" || $media.type === "video"}
                >
                    {#snippet controlBar()}
                        <div id="control">
                            <button
                                id="load-chart-btn"
                                onclick={openChartFolder}
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                                    <path d="M12.687,13.278c-.057-.057-.12-.106-.187-.146v9.867h-1V13.133c-.066,.04-.129,.088-.187,.146l-3.203,3.202-.707-.707,3.203-3.202c.769-.768,2.019-.77,2.787,0l3.203,3.202-.707,.707-3.203-3.202Zm11.313-7.778V23H15v-1h8V8H1v14H9v1H0V3.5C0,2.121,1.122,1,2.5,1h5.618l4,2h9.382c1.378,0,2.5,1.121,2.5,2.5Zm-1,1.5v-1.5c0-.827-.673-1.5-1.5-1.5H11.882L7.882,2H2.5c-.827,0-1.5,.673-1.5,1.5v3.5H23Z"/>
                                </svg>
                                開く
                            </button>
                            {#if loadedFolder}
                                <button
                                    type="button"
                                    class="local-action-btn"
                                    onclick={openInEditor}
                                    title="この譜面をエディタで開く">Edit</button
                                >
                            {/if}
                            <button
                                type="button"
                                class="shortcut-help-btn"
                                onclick={() => overlayRef?.toggleShortcuts()}
                                title="ショートカット一覧">?</button
                            >
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
                        <button class="result-btn retry-btn" onclick={() => retryGame()}>リトライ</button>
                        <button class="result-btn select-btn" onclick={openChartFolder}>譜面を選ぶ</button>
                    {/snippet}
                </GameOverlay>
            {:else}
                <div
                    id="empty-frame"
                    role="button"
                    tabindex="0"
                    onclick={() => {
                        if (!$imageURL) openChartFolder();
                    }}
                    onkeydown={(event) => {
                        if (
                            !$imageURL &&
                            (event.key === "Enter" || event.key === " ")
                        )
                            openChartFolder();
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
                    <div class="empty-frame-text">
                        <div class="empty-frame-main">ドロップ or クリックして譜面フォルダを選択</div>
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

<svelte:window onkeydown={showSourceDialog ? handleSourceKeydown : undefined} />

{#if showSourceDialog}
<div class="source-dialog-overlay" role="dialog">
    <div class="source-dialog">
        <div class="source-dialog-title">メディアソースを選択</div>
        {#each dialogSources as source, i}
            <button
                class="source-dialog-btn"
                class:focused={i === sourceFocusIdx}
                bind:this={sourceBtnEls[i]}
                onclick={() => selectSource(source)}
                onfocus={() => (sourceFocusIdx = i)}
            >
                <span class="source-num">{i + 1}</span>
                <span class="source-type-tag">{source.type === "audio" ? "音声" : source.type === "video" ? "動画" : "YouTube"}</span>
                {source.label}
            </button>
        {/each}
        <div class="source-dialog-hint">↑↓ で選択 / Enter で決定 / 数字キーで直接選択</div>
    </div>
</div>
{/if}

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
    :global(body:has(#game.input-focused) .sidebar) {
        margin-left: -48px;
        opacity: 0;
    }
    :global(body:has(#game.input-focused.hover-left) .sidebar) {
        margin-left: 0;
        opacity: 1;
    }

    /* コントロールバーの小ボタン (開く / Edit / ?)。
       公開譜面 chart/[id] の .chart-action-btn と同一の宣言に揃えること */
    #load-chart-btn,
    .local-action-btn,
    .shortcut-help-btn {
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
    #load-chart-btn:hover,
    .local-action-btn:hover,
    .shortcut-help-btn:hover {
        background-color: rgba(255, 255, 255, 0.2);
        color: white;
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
        background-color: #000;
    }



    .empty-frame-text {
        padding: 0 10px;
        text-align: center;
    }
    .empty-frame-main {
        /* アイコンと同じトーンに合わせ、暗い背景から浮きすぎないようにする。
           わずかな影で文字の輪郭を締める */
        color: #aaa;
        font-size: 0.95rem;
        letter-spacing: 0.02em;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
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
        gap: 10px;
        /* アイコン (fill: currentColor) と文字を同じ色系で揃える */
        color: #aaa;
        transition: color 0.15s ease;
    }
    #empty-frame:hover {
        color: #ccc;
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
        /* 文字色を継いだうえで、アイコンだけ少し暗く落とす
           (文字より主張させない。ホバー時の色変化には追従する) */
        fill: currentColor;
        opacity: 0.4;
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
    /* キーボードで選択中の項目 */
    .source-dialog-btn.focused {
        background: #4a4a4a;
        border-color: #4a9eff;
        outline: none;
    }
    .source-num {
        display: inline-block;
        min-width: 16px;
        margin-right: 6px;
        color: #aaa;
        font-size: 12px;
        text-align: right;
    }
    .source-dialog-hint {
        margin-top: 4px;
        color: #aaa;
        font-size: 11px;
        text-align: center;
    }
    /* 譜面フォルダのドラッグ中 */
    #game.dragOver::after {
        content: "譜面フォルダをドロップして再生";
        position: fixed;
        inset: 0;
        z-index: 900;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.6);
        border: 3px dashed #4a9eff;
        color: #eee;
        font-size: 1.2rem;
        pointer-events: none;
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
