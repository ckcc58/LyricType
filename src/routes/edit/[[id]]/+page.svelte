<script lang="ts">
  import { onMount, tick } from "svelte";
  import WaveformWorker from "$lib/waveform-worker?worker";
  import {
    parseLyric,
    timeTagToTime,
    timeToTimeTag,
  } from "$lib/parseLyric/parse-chart";
  import {
    type TimeTagChar,
    type TimeTagLine,
  } from "$lib/parseLyric/timetag-parser";
  import { getLastTaggedTime } from "$lib/parseLyric/timetag-generator";
  import {
    type TtCursor,
    type TtLastTagged,
    advanceToNextCheck,
    retreatToPrevCheck,
    tagCurrentCheck,
    setEndTime,
    deleteCurrentTag,
    incrementCheck,
    decrementCheck,
    deleteAllChecks,
    adjustTagTime,
  } from "$lib/parseLyric/timetag-operations";
  import { settings, updateSetting } from "$lib/settings";
  import { get } from "svelte/store";
  import { page } from "$app/stores";
  import { afterNavigate, beforeNavigate } from "$app/navigation";
  import { useQueryClient } from "@tanstack/svelte-query";

  // 中央ストア
  import { chart } from "./_state/chart.svelte";
  import { tt, type UndoItem, type UndoOp } from "./_state/timetag.svelte";
  import { player } from "./_state/player.svelte";
  import { submit } from "./_state/submit.svelte";
  import { ui } from "./_state/ui.svelte";

  // Repl 純関数群
  import {
    countPipeCoverage,
    getPlainReading,
    stripPlusSuffix,
  } from "./_lib/repl/coverage";
  import {
    parseMasterEntries,
    mergeAndSortRepl,
    replSortFn,
  } from "./_lib/repl/parse";
  import { extractLrcPlainText, computeMissingKanji } from "./_lib/repl/lrc-text";
  import { optimizeChartRepl } from "./_lib/repl/optimize";
  import { generateChartRepl } from "./_lib/repl/generate";
  // findMatches / replaceAt / replaceAll は ./_components/LrcTab.svelte 内で使用
  import { readFileAsText, encodeToSjis } from "./_lib/io/encoding";
  import { extractYouTubeId } from "./_lib/submit/youtube-url";
  import {
    startLatencyTest,
    handleLatencyKeydown,
    applyLatency,
    closeLatencyTest,
  } from "./_lib/latency/measure";
  import { getLrcForSave } from "./_lib/lrc/serialize";
  import {
    downloadChartRepl,
    downloadTtLrc,
    saveChartFolder,
    copyYtypingJson,
  } from "./_lib/io/save-files";
  import { autoFillFromYouTube } from "./_lib/submit/youtube-meta";
  import {
    addTag,
    removeTag,
    submitChart,
    buildSubmitSnapshot,
  } from "./_lib/submit/submit-chart";
  // 親で使うのは formatTime / ttIsOnEndCheck / ttEndCheckTime / applyTtCursor / generateTtLrc のみ
  // ttIsSpace / ttEndCheckActive / ttLineEndActive は TimeTagTab に閉じている
  import {
    formatTime,
    ttIsOnEndCheck,
    ttEndCheckTime,
    applyTtCursor,
    generateTtLrc,
  } from "./_lib/timetag/utils";
  // buildKaraokeUnits / ttCharProgress / KaraokeUnit は TimeTagTab に閉じている
  import {
    ttRecordOp,
    applyOp,
    ttUndo as ttUndoCore,
    ttRedo as ttRedoCore,
  } from "./_lib/timetag/operations";
  import {
    buildTimeTagLines as buildTimeTagLinesCore,
    syncLrcToTimeTagLines as syncLrcToTimeTagLinesCore,
  } from "./_lib/timetag/build";
  // closeRubyEdit / applyRubyEdit は親 (ruby popup) で使用
  // openRubyEdit は TimeTagTab + handleWindowKeydown (Ctrl+R) の両方から使う
  import {
    openRubyEdit,
    closeRubyEdit,
    applyRubyEdit as applyRubyEditCore,
    extendRubyKey,
  } from "./_lib/timetag/ruby-edit";
  // toolRemoveAllTimeTags / toolAdjustAllTimeTags は ./_components/ToolsTab.svelte に閉じている

  // UI コンポーネント (Stage 4a)
  import SourceDialog from "./_components/SourceDialog.svelte";
  import LatencyTestDialog from "./_components/LatencyTestDialog.svelte";
  import DragOverlay from "./_components/DragOverlay.svelte";
  // Bottom panel タブ (Stage 4d)
  import ReplTab from "./_components/ReplTab.svelte";
  import TimeTagTab from "./_components/TimeTagTab.svelte";
  import LrcTab from "./_components/LrcTab.svelte";
  // Settings panel タブ (Stage 4c)
  import SubmitForm from "./_components/SubmitForm.svelte";
  import ToolsTab from "./_components/ToolsTab.svelte";

  // Types
  type ValidationResult = {
    lineIndex: number;
    lineText: string;
    missingChar: string;
  };

  type EnhancedValidationResult = ValidationResult & { startTime: number };

  // Local DOM refs (component-scoped)
  let audioRef: HTMLMediaElement | undefined = $state();
  let waveformCanvas: HTMLCanvasElement | undefined = $state();

  // ytVideoId は player/LRC から検出された ID を空欄時のみ反映（タイトル系は
  // ユーザが空にしたとき自動で戻されないよう $effect を撤去 — 初期化は別経路で行う）
  $effect(() => {
    const id = player.ytVideoId || chart.lrcYtId || "";
    if (id && !submit.ytVideoId) submit.ytVideoId = id;
  });

  // TT editor scroll container (non-reactive DOM-ish ref)
  let ttEditorAreaEl: HTMLElement | null = null;

  // Waveform 非リアクティブローカル (worker, GL handles, caches, constants)
  let waveformDuration = 0;
  let waveformGl: WebGLRenderingContext | null = null;
  let waveformGlProgram: WebGLProgram | null = null;
  let waveformGlVbo: WebGLBuffer | null = null;
  let waveformGlPhVbo: WebGLBuffer | null = null;
  let waveformGlTagVbo: WebGLBuffer | null = null;
  let waveformGlVertexCount = 0;
  let waveformGlLocs: {
    aPos: number;
    uStartFrac: WebGLUniformLocation | null;
    uEndFrac: WebGLUniformLocation | null;
    uColor: WebGLUniformLocation | null;
  } | null = null;
  let waveformWorker: Worker | null = null;
  let waveformSmoothTime = 0;
  let waveformTimeRef = 0;
  let waveformPerfRef = 0;

  const WAVEFORM_ZOOM_MIN = 0.1;
  const WAVEFORM_ZOOM_MAX = 15;
  const WAVEFORM_ZOOM_STEPS = [0.1, 0.2, 0.5, 1, 2, 3, 5, 8, 12, 15];
  let waveformTagTimesCache: number[] = []; // times[0]（主チェック）
  let waveformTagTimesSecCache: number[] = []; // times[1+]（副チェック）
  let waveformEndTimesCache: number[] = []; // endTime
  let editorStateVersion = 0;

  function revokeObjectUrl(url: string | null) {
    if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
  }

  function cleanupSourceUrls(
    sources: { url?: string }[],
    keepUrl: string | null = null,
  ) {
    for (const source of sources) {
      if (source.url && source.url !== keepUrl) revokeObjectUrl(source.url);
    }
  }

  function resetWaveformState() {
    waveformWorker?.terminate();
    waveformWorker = null;
    waveformDuration = 0;
    waveformGl = null;
    waveformGlProgram = null;
    waveformGlVbo = null;
    waveformGlPhVbo = null;
    waveformGlTagVbo = null;
    waveformGlLocs = null;
    waveformGlVertexCount = 0;
    waveformSmoothTime = 0;
    waveformTimeRef = 0;
    waveformPerfRef = 0;
    waveformTagTimesCache = [];
    waveformTagTimesSecCache = [];
    waveformEndTimesCache = [];
    player.waveformData = null;
    player.waveformDecoding = false;
    player.waveformProgress = 0;
    player.waveformZoom = 3;
  }

  function resetEditorState() {
    editorStateVersion++;
    lastLoadedChartId = null;

    submit.editingChartId = null;
    submit.editingUploaderId = null;
    submit.loadedTitle = "";
    submit.settingsTab = "submit";
    submit.showSubmitDialog = false;
    submit.title = "";
    submit.artist = "";
    submit.description = "";
    submit.ytVideoId = "";
    submit.source = "";
    submit.tags = [];
    submit.tagInput = "";
    submit.isSubmitting = false;
    submit.submitError = "";
    submit.submittedChartId = null;
    submit.justSubmitted = false;
    submit.lastSavedSnapshot = null;
    submit.isAutoFilling = false;
    submit.autoFillError = "";
    submit.suggestedTags = [];
    submit.lastAutoFilledId = "";

    chart.lrcContent = "";
    chart.lrcYtId = "";
    chart.lrcFindText = "";
    chart.lrcReplaceText = "";
    chart.lrcFindCase = false;
    chart.lrcFindIdx = 0;
    chart.chartReplContent = "";
    chart.appliedChartReplContent = "";
    chart.isGeneratingRepl = false;
    chart.isGeneratingReplLite = false;
    chart.validationMsg = "";
    chart.replOptimizeInfo = "";
    chart.showOptDiff = false;
    chart.lastMergedRepl = "";
    chart.lastOptimizedRepl = "";
    chart.ignorePipeSet = new Set<string>();
    chart.isPipeEditing = false;
    chart.peFocus = 0;
    chart.peDecisions = [];

    tt.lines = [];
    tt.cursorLine = 0;
    tt.cursorChar = 0;
    tt.cursorCheck = 0;
    tt.pendingEndCheckKey = null;
    tt.pendingEndCheckLine = 0;
    tt.pendingEndCheckChar = 0;
    tt.editorMode = "timetag";
    tt.autoScroll = false;
    tt.playbackRate = 1.0;
    tt.showShortcuts = false;
    tt.showModeMenu = false;
    tt.undoStack = [];
    tt.redoStack = [];
    tt.lrcText = "";
    tt.displayTime = 0;
    tt.lastReplKey = "";
    tt.lastTaggedLine = -1;
    tt.lastTaggedChar = -1;
    tt.rubyEditLine = -1;
    tt.rubyEditChar = -1;
    tt.rubyEditValue = "";
    tt.rubyEditKey = "";
    tt.rubyEditOrigKey = "";
    tt.toolTimeAdjustValue = 0;

    ui.isProcessing = false;
    ui.isDragOver = false;
    ui.lastFolderHandle = null;
    ui.shiftHeld = false;
    ui.activeTab = "timetag";

    if (audioRef) {
      audioRef.pause();
      audioRef.removeAttribute("src");
      audioRef.load();
    }
    if (player.ytPlayer) {
      player.ytPlayer.destroy();
      player.ytPlayer = null;
    }
    revokeObjectUrl(player.audioSrc);
    revokeObjectUrl(player.videoSrc);
    revokeObjectUrl(player.imageSrc);
    player.audioSrc = null;
    player.videoSrc = null;
    player.imageSrc = null;
    player.audioMode = "file";
    player.audioDuration = 0;
    player.isPlaying = false;
    player.showSourceDialog = false;
    player.dialogSources = [];
    player.pendingSourceCallback?.(null);
    player.pendingSourceCallback = null;
    player.ytPlayerReady = false;
    player.youtubeUrlInput = "";
    player.ytVideoId = "";
    player.showLatencyTest = false;
    player.latencyRunning = false;
    player.latencyTaps = [];
    player.latencyBeatOn = false;
    player.latencyDisplayStart = 0;
    player.latencyAvg = null;
    resetWaveformState();

    if (folderInputRef) folderInputRef.value = "";
  }


  async function decodeWaveform(url: string) {
    player.waveformData = null;
    player.waveformDecoding = true;
    player.waveformProgress = 0;
    waveformWorker?.terminate();
    waveformWorker = null;
    waveformGl = null;
    waveformGlProgram = null;
    waveformGlVbo = null;
    waveformGlPhVbo = null;
    waveformGlTagVbo = null;
    waveformGlLocs = null;
    waveformGlVertexCount = 0;
    waveformSmoothTime = 0;
    waveformTimeRef = 0;
    waveformPerfRef = 0;
    try {
      const buf = await fetch(url).then((r) => r.arrayBuffer());
      if (player.audioSrc !== url || player.audioMode !== "file") return;
      const actx = new AudioContext();
      const audioBuffer = await actx.decodeAudioData(buf);
      actx.close();
      if (player.audioSrc !== url || player.audioMode !== "file") return;
      waveformDuration = audioBuffer.duration;

      const ch0src = audioBuffer.getChannelData(0);
      const ch1src =
        audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : null;
      const ch0 = new Float32Array(ch0src);
      const ch1 = ch1src ? new Float32Array(ch1src) : null;
      const pcmLen = ch0src.length;

      const worker = new WaveformWorker();
      waveformWorker = worker;

      worker.onmessage = (e: MessageEvent) => {
        if (e.data.type === "progress") {
          player.waveformProgress = e.data.progress;
        } else if (e.data.type === "done") {
          player.waveformData = e.data.data as Float32Array;
          player.waveformDecoding = false;
          worker.terminate();
          waveformWorker = null;
        }
      };
      worker.onerror = () => {
        player.waveformDecoding = false;
        worker.terminate();
        waveformWorker = null;
      };

      const transferList: ArrayBuffer[] = [ch0.buffer];
      if (ch1) transferList.push(ch1.buffer);
      worker.postMessage(
        {
          ch0Buffer: ch0.buffer,
          ch1Buffer: ch1?.buffer ?? null,
          pcmLen,
          duration: audioBuffer.duration,
        },
        transferList,
      );
    } catch {
      player.waveformData = null;
      player.waveformDecoding = false;
      waveformWorker?.terminate();
      waveformWorker = null;
    }
  }

  function initWaveformGl(): boolean {
    if (!waveformCanvas) return false;
    const gl = waveformCanvas.getContext("webgl");
    if (!gl) return false;
    const vs = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(
      vs,
      [
        "attribute vec2 aPos;",
        "uniform float uStartFrac;",
        "uniform float uEndFrac;",
        "void main(){",
        "  float x=(aPos.x-uStartFrac)/(uEndFrac-uStartFrac)*2.0-1.0;",
        "  gl_Position=vec4(x,aPos.y,0.0,1.0);",
        "}",
      ].join(""),
    );
    gl.compileShader(vs);
    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(
      fs,
      "precision mediump float;uniform vec4 uColor;void main(){gl_FragColor=uColor;}",
    );
    gl.compileShader(fs);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    waveformGl = gl;
    waveformGlProgram = prog;
    waveformGlVbo = gl.createBuffer();
    waveformGlPhVbo = gl.createBuffer();
    waveformGlTagVbo = gl.createBuffer();
    waveformGlLocs = {
      aPos: gl.getAttribLocation(prog, "aPos"),
      uStartFrac: gl.getUniformLocation(prog, "uStartFrac"),
      uEndFrac: gl.getUniformLocation(prog, "uEndFrac"),
      uColor: gl.getUniformLocation(prog, "uColor"),
    };
    return true;
  }

  function uploadWaveformVertices() {
    if (!waveformGl || !waveformGlVbo || !player.waveformData) return;
    const gl = waveformGl;
    const N = player.waveformData.length;
    if (N < 2) return;
    const verts = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      const x = i / (N - 1);
      const amp = player.waveformData[i] * 0.92;
      verts[i * 4 + 0] = x;
      verts[i * 4 + 1] = amp;
      verts[i * 4 + 2] = x;
      verts[i * 4 + 3] = -amp;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, waveformGlVbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    waveformGlVertexCount = N * 2;
  }

  function drawWaveform() {
    if (
      !waveformCanvas ||
      !player.waveformData ||
      !waveformGl ||
      !waveformGlProgram ||
      !waveformGlLocs ||
      player.audioDuration <= 0
    )
      return;
    const gl = waveformGl;
    const W = waveformCanvas.width;
    const H = waveformCanvas.height;

    gl.viewport(0, 0, W, H);
    gl.clearColor(14 / 255, 14 / 255, 14 / 255, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const t = waveformSmoothTime > 0 ? waveformSmoothTime : tt.displayTime;
    const halfWindow = player.waveformZoom / 2;
    // クランプしない: 曲頭/曲末でも窓幅 player.waveformZoom を保ち、再生ヘッドを常に中央に
    // 範囲外の領域は単に何も描画されない（空 → 背景色）
    const windowStart = t - halfWindow;
    const windowEnd = t + halfWindow;
    const startFrac = windowStart / waveformDuration;
    const endFrac = windowEnd / waveformDuration;

    gl.useProgram(waveformGlProgram);
    gl.uniform1f(waveformGlLocs.uStartFrac, startFrac);
    gl.uniform1f(waveformGlLocs.uEndFrac, endFrac);

    // 波形本体
    gl.uniform4f(
      waveformGlLocs.uColor,
      0x3a / 255,
      0x7a / 255,
      0xbf / 255,
      1.0,
    );
    gl.bindBuffer(gl.ARRAY_BUFFER, waveformGlVbo);
    gl.enableVertexAttribArray(waveformGlLocs.aPos);
    gl.vertexAttribPointer(waveformGlLocs.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, waveformGlVertexCount);

    // タグ線描画ヘルパー（同一VBOを使い回し）
    const tw = (endFrac - startFrac) / W; // 2px幅
    const drawTagBatch = (
      times: number[],
      yHalf: number,
      r: number,
      g: number,
      b2: number,
      a: number,
    ) => {
      if (!waveformGlTagVbo || !waveformGlLocs) return;
      const inWindow = times.filter(
        (ct) => ct >= windowStart && ct <= windowEnd,
      );
      if (inWindow.length === 0) return;
      const tv = new Float32Array(inWindow.length * 12);
      inWindow.forEach((time, i) => {
        const tx = time / waveformDuration;
        const p = i * 12;
        tv[p] = tx - tw;
        tv[p + 1] = yHalf;
        tv[p + 2] = tx - tw;
        tv[p + 3] = -yHalf;
        tv[p + 4] = tx + tw;
        tv[p + 5] = yHalf;
        tv[p + 6] = tx + tw;
        tv[p + 7] = yHalf;
        tv[p + 8] = tx - tw;
        tv[p + 9] = -yHalf;
        tv[p + 10] = tx + tw;
        tv[p + 11] = -yHalf;
      });
      gl.uniform4f(waveformGlLocs.uColor, r, g, b2, a);
      gl.bindBuffer(gl.ARRAY_BUFFER, waveformGlTagVbo);
      gl.bufferData(gl.ARRAY_BUFFER, tv, gl.DYNAMIC_DRAW);
      gl.vertexAttribPointer(waveformGlLocs.aPos, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, inWindow.length * 6);
    };
    // endTime: ティール系
    drawTagBatch(waveformEndTimesCache, 1.0, 0.25, 0.85, 0.72, 0.6);
    // times[0]: 黄色・フル高さ
    drawTagBatch(waveformTagTimesCache, 1.0, 1.0, 0.8, 0.3, 0.65);
    // times[1+]: 黄色・70%高さ
    drawTagBatch(waveformTagTimesSecCache, 0.7, 1.0, 0.8, 0.3, 0.55);

    // 再生位置ライン: シェーダが aPos.x を時刻フラクションとして扱うため、頂点も時刻フラクション空間で構築する
    const playheadFrac = t / waveformDuration;
    const halfPxFrac = (endFrac - startFrac) / W; // 1px 幅 → 全体で 2px
    const phVerts = new Float32Array([
      playheadFrac - halfPxFrac,
      1.0,
      playheadFrac - halfPxFrac,
      -1.0,
      playheadFrac + halfPxFrac,
      1.0,
      playheadFrac + halfPxFrac,
      -1.0,
    ]);
    gl.uniform4f(waveformGlLocs.uColor, 1.0, 1.0, 1.0, 1.0);
    gl.bindBuffer(gl.ARRAY_BUFFER, waveformGlPhVbo);
    gl.bufferData(gl.ARRAY_BUFFER, phVerts, gl.DYNAMIC_DRAW);
    gl.vertexAttribPointer(waveformGlLocs.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function waveformZoomIn() {
    const next = [...WAVEFORM_ZOOM_STEPS]
      .reverse()
      .find((step) => step < player.waveformZoom - 0.001);
    player.waveformZoom = next ?? WAVEFORM_ZOOM_MIN;
  }
  function waveformZoomOut() {
    const next = WAVEFORM_ZOOM_STEPS.find(
      (step) => step > player.waveformZoom + 0.001,
    );
    player.waveformZoom = next ?? WAVEFORM_ZOOM_MAX;
  }

  // 遅延測定は ./_lib/latency/measure に移動済み

  // Derived

  // Diff: merged vs optimized (ReplTab に props で渡す)
  type DiffLine = { text: string; type: "removed" | "added" | "unchanged" };
  let optimizeDiff: DiffLine[] = $derived.by(() => {
    if (!chart.lastMergedRepl && !chart.lastOptimizedRepl) return [];
    const mergedSet = new Set(
      chart.lastMergedRepl
        .trim()
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
    );
    const optSet = new Set(
      chart.lastOptimizedRepl
        .trim()
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
    );
    const diff: DiffLine[] = [];
    for (const line of mergedSet) {
      if (!optSet.has(line)) diff.push({ text: line, type: "removed" });
    }
    for (const line of optSet) {
      if (!mergedSet.has(line)) diff.push({ text: line, type: "added" });
    }
    for (const line of optSet) {
      if (mergedSet.has(line)) diff.push({ text: line, type: "unchanged" });
    }
    return diff;
  });

  // Missing Kanji Report
  let missingKanjiReport = $derived.by(() => {
    if (!chart.lrcContent) return [];

    let parsed = parseLyric(chart.lrcContent, chart.appliedChartReplContent);

    // フォールバック: タイムタグなしLRCの場合、ダミータイムタグを付与して再パース
    if (parsed.length === 0 && chart.lrcContent.trim()) {
      const dummyLrc = chart.lrcContent
        .split("\n")
        .map((line) => {
          const stripped = line.replace(/\[\d\d:\d\d:\d\d\]/g, "").trim();
          return stripped ? `[00:00:00]${stripped}[00:00:00]` : "";
        })
        .filter((l) => l)
        .join("\n");
      parsed = parseLyric(dummyLrc, chart.appliedChartReplContent);
    }

    const kanjiRegex = /[々〆ヵヶ一-鿿]/;

    const uniqueMap = new Map<string, EnhancedValidationResult>();

    parsed.forEach((segment) => {
      segment.segments.forEach((seg) => {
        if (seg.text === seg.reading && kanjiRegex.test(seg.text)) {
          const char = seg.text;
          if (!uniqueMap.has(char)) {
            uniqueMap.set(char, {
              lineIndex: segment.line + 1,
              lineText: segment.phrase,
              missingChar: char,
              startTime: segment.time,
            });
          }
        }
      });
    });
    return Array.from(uniqueMap.values());
  });

  // Needs Pipe Logics ($state は chart.svelte.ts)

  // パイプカバレッジ計算は ./_lib/repl/coverage に移動済み

  // Needs Pipe: パイプ数がキー文字数-1と一致しないエントリを検出
  type NeedsPipeEntry = { kanji: string; reading: string; lineIndex: number };
  let needsPipeReport = $derived.by((): NeedsPipeEntry[] => {
    if (!chart.chartReplContent) return [];

    const kanjiRegex = /[々〆ヵヶ一-鿿]/;
    const result: NeedsPipeEntry[] = [];

    const lines = chart.chartReplContent.trim().split("\n");

    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;

      const parts = trimmed.split(",");
      if (parts.length < 2) return;

      const kanji = parts[0];
      const reading = parts[1].trim();
      if (!reading) return;

      // Ignore check
      if (chart.ignorePipeSet.has(kanji)) return;

      // 2文字以上かチェック
      const chars = [...kanji];
      if (chars.length < 2) return;

      // 漢字を1文字以上含むかチェック
      const hasKanji = chars.some((ch) => kanjiRegex.test(ch));
      if (!hasKanji) return;

      // パイプカバレッジがキー文字数と一致 → OK
      const coverage = countPipeCoverage(reading);
      if (coverage === chars.length) return;
      if (coverage === -1) return; // +* 使用 → チェック不可

      result.push({ kanji, reading, lineIndex: idx + 1 });
    });

    return result;
  });

  // Inline Pipe Editor State ($state は chart.svelte.ts)

  function startPipeEdit() {
    if (needsPipeReport.length === 0) return;
    chart.isPipeEditing = true;
    resetForCurrentItem();
  }

  function resetForCurrentItem() {
    if (needsPipeReport.length === 0) return;
    const item = needsPipeReport[0];
    const plain = getPlainReading(item.reading);
    const readingLen = [...plain].length;
    chart.peDecisions = new Array(Math.max(0, readingLen - 1)).fill(null);
    chart.peFocus = 0;
  }

  function endPipeEdit() {
    chart.isPipeEditing = false;
  }

  function skipCurrentEntry() {
    if (needsPipeReport.length === 0) return;
    const item = needsPipeReport[0];
    const newSet = new Set(chart.ignorePipeSet);
    newSet.add(item.kanji);
    chart.ignorePipeSet = newSet;
    // 次のエントリへリセット（needsPipeReport が derived で更新される）
    // 次の tick で needsPipeReport が更新されるので、少し遅延してリセット
    setTimeout(() => {
      if (needsPipeReport.length > 0) {
        resetForCurrentItem();
      }
    }, 0);
  }

  // 次の未決定位置へフォーカスを進める。全決定済みなら適用。
  function advanceFocus() {
    const nextNull = chart.peDecisions.indexOf(null, chart.peFocus);
    if (nextNull === -1) {
      // 前方にも未決定がないかチェック
      const anyNull = chart.peDecisions.indexOf(null);
      if (anyNull === -1) {
        applyPipeEdit();
      } else {
        chart.peFocus = anyNull;
      }
    } else {
      chart.peFocus = nextNull;
    }
  }

  // 1つ前の決定位置に戻って取り消し
  function goBackFocus() {
    // 現在位置より前で最も近い非null位置を探す
    for (let i = chart.peFocus - 1; i >= 0; i--) {
      if (chart.peDecisions[i] !== null) {
        chart.peDecisions[i] = null;
        chart.peDecisions = [...chart.peDecisions];
        chart.peFocus = i;
        return;
      }
    }
    // 前に決定済みの位置がない場合は何もしない
  }

  // stripPlusSuffix / getPlainReading は ./_lib/repl/coverage に移動済み

  function applyPipeEdit() {
    if (needsPipeReport.length === 0) return;
    const item = needsPipeReport[0];
    const plain = getPlainReading(item.reading);
    const readingChars = [...plain];
    const keyChars = [...item.kanji];
    const K = keyChars.length;

    // "|" の位置を収集
    const pipePositions: number[] = [];
    for (let i = 0; i < chart.peDecisions.length; i++) {
      if (chart.peDecisions[i] === "|") pipePositions.push(i);
    }

    const G = pipePositions.length + 1; // グループ数

    if (G === 1) {
      // パイプなし → 全体読み（そのまま）→ ignorePipeSetに追加
      const newSet = new Set(chart.ignorePipeSet);
      newSet.add(item.kanji);
      chart.ignorePipeSet = newSet;
      setTimeout(() => {
        if (needsPipeReport.length > 0) resetForCurrentItem();
      }, 0);
      return;
    }

    if (G > K) {
      alert(`パイプが多すぎます\nキー: ${K}文字 vs グループ: ${G}個`);
      return;
    }

    // 読みをパイプ位置で分割
    const groups: string[] = [];
    let lastIdx = 0;
    for (const pos of pipePositions) {
      groups.push(readingChars.slice(lastIdx, pos + 1).join(""));
      lastIdx = pos + 1;
    }
    groups.push(readingChars.slice(lastIdx).join(""));

    // + サフィックス自動生成
    let result: string;
    if (G === K) {
      // 各グループ = 1キー文字 → + 不要
      result = groups.join("|");
    } else {
      // G < K: 余り (K - G) 文字を読みの長いグループに優先分配
      const extras = K - G;
      const plusCounts = new Array(G).fill(0);

      // 読み長さでソートしたインデックス（同長なら左優先 = 安定ソート）
      const sortedIndices = groups
        .map((g, i) => i)
        .sort((a, b) => [...groups[b]].length - [...groups[a]].length || a - b);

      for (let e = 0; e < extras; e++) {
        plusCounts[sortedIndices[e % sortedIndices.length]]++;
      }

      result = groups.map((g, i) => g + "+".repeat(plusCounts[i])).join("|");
    }

    // chart.chartReplContent の該当行を更新
    const lines = chart.chartReplContent.split("\n");
    const lineIdx = item.lineIndex - 1;
    if (lines[lineIdx] && lines[lineIdx].includes(item.kanji)) {
      const parts = lines[lineIdx].split(",");
      if (parts.length >= 2) {
        parts[1] = result;
        lines[lineIdx] = parts.join(",");
        chart.chartReplContent = lines.join("\n");
        chart.appliedChartReplContent = chart.chartReplContent;
      }
    }

    // 次のエントリへリセット
    setTimeout(() => {
      if (needsPipeReport.length > 0) {
        resetForCurrentItem();
      }
    }, 0);
  }

  function handleWindowKeydown(e: KeyboardEvent) {
    // テキスト系入力にフォーカスがある時のみショートカットを無効化。
    // range/checkbox/radio などはショートカット有効のままにする。
    const active = document.activeElement;
    if (active?.tagName === "TEXTAREA") return;
    if (active?.tagName === "INPUT") {
      const t = (active as HTMLInputElement).type;
      const textyTypes = [
        "text",
        "search",
        "email",
        "url",
        "tel",
        "password",
        "number",
      ];
      if (textyTypes.includes(t)) return;
    }
    if (player.showLatencyTest) {
      handleLatencyKeydown(e);
      return;
    }
    handleTtKeydown(e);
    // 再生関係ショートカットは全タブ・全フォーカスで有効にする。
    // TimeTag タブ表示中は handleTtKeydown が既に処理済みなので二重実行を避ける。
    const inTimeTag = ui.activeTab === "timetag" && tt.editorMode === "timetag";
    if (
      !inTimeTag &&
      PLAYBACK_CODES.has(e.code) &&
      !e.ctrlKey &&
      !e.altKey &&
      !e.metaKey
    ) {
      e.preventDefault();
      runPlaybackKey(e.code);
    }
    if (!chart.isPipeEditing) return;
    if (needsPipeReport.length === 0) {
      chart.isPipeEditing = false;
      return;
    }

    if (e.code === "Escape") {
      e.preventDefault();
      endPipeEdit();
      return;
    }

    if (e.code === "Space") {
      e.preventDefault();
      if (chart.peFocus < chart.peDecisions.length) {
        const cur = chart.peDecisions[chart.peFocus];
        if (cur === null) {
          chart.peDecisions[chart.peFocus] = "|";
        } else if (cur === "|") {
          chart.peDecisions[chart.peFocus] = "+";
        } else {
          chart.peDecisions[chart.peFocus] = null;
        }
        chart.peDecisions = [...chart.peDecisions];
      }
    } else if (e.code === "ArrowRight" || e.code === "KeyL") {
      e.preventDefault();
      if (chart.peFocus < chart.peDecisions.length - 1) chart.peFocus++;
    } else if (e.code === "ArrowLeft" || e.code === "KeyJ") {
      e.preventDefault();
      if (chart.peFocus > 0) chart.peFocus--;
    } else if (e.code === "Enter") {
      e.preventDefault();
      // 残りの未決定位置を全て "+" にして適用
      for (let i = 0; i < chart.peDecisions.length; i++) {
        if (chart.peDecisions[i] === null) chart.peDecisions[i] = "+";
      }
      chart.peDecisions = [...chart.peDecisions];
      applyPipeEdit();
    } else if (e.code === "Backspace") {
      e.preventDefault();
      if (chart.peFocus < chart.peDecisions.length && chart.peDecisions[chart.peFocus] !== null) {
        chart.peDecisions[chart.peFocus] = null;
        chart.peDecisions = [...chart.peDecisions];
      }
    }
  }
  // Effect to attach window keydown
  // Svelte 5: use <svelte:window> or simple generic action?
  // We'll use svelte:window in template or `onMount`

  // Effects and Logic

  // settings.volume → エディタ音量同期
  $effect(() => {
    const vol = $settings.volume / 100;
    playerSetVolume(vol);
  });

  // 音声ファイル読み込み時に波形デコード
  $effect(() => {
    if (!player.audioSrc || player.audioMode !== "file") {
      waveformWorker?.terminate();
      waveformWorker = null;
      player.waveformData = null;
      player.waveformDecoding = false;
      waveformGl = null;
      waveformGlProgram = null;
      waveformGlVbo = null;
      waveformGlPhVbo = null;
      waveformGlTagVbo = null;
      waveformGlLocs = null;
      waveformGlVertexCount = 0;
      waveformSmoothTime = 0;
      waveformTimeRef = 0;
      waveformPerfRef = 0;
      return;
    }
    decodeWaveform(player.audioSrc);
  });

  // player.waveformData が揃ったら canvas サイズを確定し WebGL を初期化
  $effect(() => {
    if (!player.waveformData || !waveformCanvas) return;
    tick().then(() => {
      waveformCanvas!.width = waveformCanvas!.offsetWidth || 800;
      waveformCanvas!.height = waveformCanvas!.offsetHeight || 64;
      initWaveformGl();
      uploadWaveformVertices();
      drawWaveform();
    });
  });

  // 一時停止中のズーム変更・シーク後に再描画（再生中はRAFループが担当）
  $effect(() => {
    const _t = tt.displayTime;
    const _z = player.waveformZoom;
    if (player.waveformData && waveformCanvas && playerIsPaused()) {
      waveformSmoothTime = tt.displayTime;
      drawWaveform();
    }
  });

  let lastLoadedChartId: number | null = null;
  afterNavigate(() => {
    const editChart = get(page).data?.editChart;
    if (!editChart) {
      resetEditorState();
      return;
    }
    if (editChart.id === lastLoadedChartId) return;
    resetEditorState();
    lastLoadedChartId = editChart.id;
    submit.editingChartId = editChart.id;
    submit.editingUploaderId = editChart.uploader_id;
    // 直前の投稿先 ID をクリア（古い譜面ページへのリンクが残る不具合対策）
    submit.submittedChartId = null;
    const rawLrc = editChart.lrc_raw || "";
    const ytMatch = rawLrc.match(/^@ytid="([^"]+)"/m);
    if (ytMatch) chart.lrcYtId = ytMatch[1];
    const cleanLrc = rawLrc.replace(/^@\w+=.*$/gm, "").trim();
    chart.lrcContent = cleanLrc;
    tt.lrcText = cleanLrc;
    chart.chartReplContent = editChart.repl_raw || "";
    chart.appliedChartReplContent = editChart.repl_raw || "";
    submit.loadedTitle = editChart.title || "";
    submit.title = editChart.title || "";
    submit.artist = editChart.artist || "";
    submit.description = editChart.description || "";
    submit.ytVideoId = editChart.youtube_video_id || "";
    submit.source = editChart.source || "";
    submit.tags = editChart.tags ?? [];
    tick().then(() => {
      buildTimeTagLines();
      autoGenerateRepl();
      // 譜面ロード完了後にスナップショットを記録 (この時点を「保存済み」とする)
      tick().then(() => {
        submit.lastSavedSnapshot = buildSubmitSnapshot();
      });
    });

    if (editChart.youtube_video_id) {
      player.audioMode = "youtube";
      player.youtubeUrlInput = `https://www.youtube.com/watch?v=${editChart.youtube_video_id}`;
      tick().then(() => loadYouTubeVideo(true));
    }
  });

  // === 未保存変更 検知 + 離脱警告 ===
  function hasUnsavedChanges(): boolean {
    if (submit.lastSavedSnapshot === null) return false;
    return buildSubmitSnapshot() !== submit.lastSavedSnapshot;
  }

  beforeNavigate(({ cancel, to }) => {
    // 同じ edit ページ内のクライアントナビゲーションは無視
    if (to?.url.pathname.startsWith("/edit")) return;
    if (hasUnsavedChanges()) {
      const ok = confirm(
        "未保存の変更があります。このページを離れてもよろしいですか?",
      );
      if (!ok) cancel();
    }
  });

  onMount(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges()) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  });

  // master-repl は TanStack Query 経由で取得する（autoGenerateRepl 内で fetchQuery）
  const queryClient = useQueryClient();
  const MASTER_REPL_QUERY = {
    queryKey: ["master-repl"] as const,
    queryFn: async (): Promise<string> => {
      const res = await fetch("/api/master-repl", { cache: "no-cache" });
      return res.ok ? await res.text() : "";
    },
    staleTime: 0,
    gcTime: 1000 * 60 * 30,
  };

  onMount(() => {
    // master-repl を TanStack Query 経由で取得し、既存ロジック互換のため state にも反映
    queryClient
      .fetchQuery(MASTER_REPL_QUERY)
      .then((text) => {
        chart.masterReplContent = text;
        chart.appliedMasterReplContent = text;
        chart.isMasterLoaded = true;
      })
      .catch((err) => {
        console.error(err);
        chart.isMasterLoaded = true;
      });

    // 編集モードの初期ロードは $effect で処理（クライアントナビゲーション対応）

    // rAF loop for current playback time display
    let rafId: number;
    function updateDisplayTime(timestamp: number) {
      const paused = playerIsPaused();
      player.isPlaying = !paused; // TimeTag のチェック赤表示用 (リアクティブ)
      if (!paused) {
        const raw = playerGetTime();
        tt.displayTime = raw;
        if (player.audioMode === "file" && audioRef?.duration) {
          player.audioDuration = audioRef.duration;
        } else if (player.audioMode === "youtube" && player.ytPlayer) {
          const d = player.ytPlayer.getDuration();
          if (d > 0) player.audioDuration = d;
        }
        // audioRef.currentTime はRAFと非同期で更新されるため微妙に跳ぶ。
        // RAFタイムスタンプで線形補間してから波形を描画する。
        const elapsed = ((timestamp - waveformPerfRef) / 1000) * tt.playbackRate;
        const predicted = waveformTimeRef + elapsed;
        if (Math.abs(raw - predicted) > 0.05) {
          waveformTimeRef = raw;
          waveformPerfRef = timestamp;
          waveformSmoothTime = raw;
        } else {
          waveformSmoothTime = predicted;
        }
        if (player.waveformData && waveformCanvas) drawWaveform();
      }
      rafId = requestAnimationFrame(updateDisplayTime);
    }
    rafId = requestAnimationFrame(updateDisplayTime);
    return () => cancelAnimationFrame(rafId);
  });

  // Update applied content only when user clicks "Reflect" or initially loads
  // We need to sync chart.appliedMasterReplContent manually or via effect if we want auto-sync (which we don't, we want button).
  // But initial load needs to set both. Handled in fetch.

  // replSortFn / parseMasterEntries / mergeAndSortRepl は ./_lib/repl/parse に移動済み
  // DecompPart 型は ./_lib/repl/decompose に移動済み

  // tryDecompose は ./_lib/repl/decompose に移動済み

  // optimizeChartRepl は ./_lib/repl/optimize に移動済み (元の定義を削除)

  // extractLrcPlainText / computeMissingKanji は ./_lib/repl/lrc-text に移動済み

  async function generateReplLiteTest() {
    if (!chart.lrcContent.trim() || chart.isGeneratingReplLite) return;
    chart.isGeneratingReplLite = true;
    try {
      // master 取得
      const masterText = await queryClient.fetchQuery(MASTER_REPL_QUERY);

      // master + 既存 chartRepl を merge (master 由来の読みを取り込むため)
      const { merged: masterMerged } = generateChartRepl(
        chart.lrcContent,
        masterText,
        chart.chartReplContent,
        chart.ignorePipeSet,
        true,
        );
      // 未定義漢字は右カラム (missingKanjiReport) と同じ chart repl 基準で判定する。
      // master 基準だと「右カラムに残っているのにボタンが無反応」になるため。
      const missing = computeMissingKanji(
        chart.lrcContent,
        chart.appliedChartReplContent,
      );
      if (missing.size === 0) {
        return;
      }
      const missingChars = [...missing].flatMap((m) =>
        [...m].filter((c) => /[々〆ヵヶ一-鿿]/.test(c)),
      );
      const lrcText = extractLrcPlainText(chart.lrcContent);

      // /api/repl-suggest 呼び出し（kuromoji抽出 + 後処理はサーバー側）
      const res = await fetch('/api/repl-suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lrcText, missingChars }),
      });
      if (!res.ok) {
        console.warn('[liteAdd] レスポンス NG:', res.status);
        return;
      }
      const data = await res.json();
      if (!data.repl) return;

      // master 由来の読み (masterMerged) を取り込んだ上に Gemini 結果を merge する。
      // master に読みがある漢字も chart repl に反映され、右カラムから消える。
      // optimize で LRC に出る漢字だけに絞られるため master 全体が残ることはない。
      const geminiEntries = parseMasterEntries(data.repl);
      const merged = mergeAndSortRepl(masterMerged, geminiEntries);

      // 最適化して反映
      chart.chartReplContent = optimizeChartRepl(
        merged,
        extractLrcPlainText(chart.lrcContent),
        chart.ignorePipeSet,
      );
      chart.appliedChartReplContent = chart.chartReplContent;

    } catch (err) {
      console.error('[liteAdd] エラー:', err);
    } finally {
      chart.isGeneratingReplLite = false;
    }
  }

  // master-repl + Gemini 合わせ技で chart.chartReplContent を自動生成
  async function autoGenerateRepl() {
    if (!chart.lrcContent.trim()) return;
    if (chart.isGeneratingRepl) return;
    chart.isGeneratingRepl = true;
    try {
      await runAutoGenerateRepl();
    } finally {
      chart.isGeneratingRepl = false;
    }
  }

  async function runAutoGenerateRepl() {
    const masterText = await queryClient.fetchQuery(MASTER_REPL_QUERY);

    // Step 1: master + 既存 chartRepl を merge
    const { merged: masterMerged } = generateChartRepl(
      chart.lrcContent,
      masterText,
      chart.chartReplContent,
      chart.ignorePipeSet,
      true,
    );

    // Step 2: マージ済み repl を LRC に適用して未カバー漢字を抽出
    const missingKanji = computeMissingKanji(chart.lrcContent, masterMerged);

    let finalText = masterMerged;
    if (missingKanji.size > 0) {
      // Step 3: missingKanji は連続漢字を1エントリにまとめるので、1文字単位に分解
      const missingKanjiChars = new Set<string>();
      for (const m of missingKanji) {
        for (const ch of m) {
          if (/[々〆ヵヶ一-鿿]/.test(ch)) missingKanjiChars.add(ch);
        }
      }

      // 未カバー漢字を含む単語を Intl.Segmenter で抽出
      const flat = extractLrcPlainText(chart.lrcContent);
      const segmenter = new Intl.Segmenter("ja", { granularity: "word" });
      const unknowns = [
        ...new Set(
          [...segmenter.segment(flat)]
            .map((s) => s.segment)
            .filter((s) =>
              [...s].some((c) => missingKanjiChars.has(c)),
            ),
        ),
      ];

      if (unknowns.length > 0) {
        try {
          const res = await fetch("/api/repl-suggest", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ phrases: unknowns }),
          });
          if (res.ok) {
            const data = await res.json();
            if (data.repl) {
              const geminiEntries = parseMasterEntries(data.repl);
              finalText = mergeAndSortRepl(masterMerged, geminiEntries);
            }
          } else {
            console.warn(
              "[autoGenerateRepl] Gemini レスポンス NG:",
              res.status,
            );
          }
        } catch (err) {
          console.error("[autoGenerateRepl] Gemini エラー:", err);
        }
      }
    }

    chart.chartReplContent = optimizeChartRepl(
      finalText,
      extractLrcPlainText(chart.lrcContent),
      chart.ignorePipeSet,
    );
    chart.appliedChartReplContent = chart.chartReplContent;
  }

  // generateChartRepl は ./_lib/repl/generate に移動済み

  function handleUpdateAndSort() {
    // A. Update Master Repl
    const rawLines = chart.masterReplContent.trim().split("\n");

    // 1. Remove duplicates
    let arr = rawLines
      .map((e) => e.trim())
      .filter((e) => e)
      .filter((e, i, s) => s.indexOf(e) === i);

    // 2. Validate Kana
    let errors: string[] = [];
    let pipeErrors: string[] = [];
    arr.forEach((line) => {
      const parts = line.split(",");
      if (parts.length < 2) return;

      const kanji = parts[0];
      const kana = parts[1].trim();

      // パイプ付きの場合: +構文を考慮したカバレッジ検証 + 各パートがひらがな/カタカナであること
      if (kana.includes("|")) {
        const kanjiChars = [...kanji];
        const cov = countPipeCoverage(kana);
        if (cov !== -1 && cov !== kanjiChars.length) {
          pipeErrors.push(
            `${kanji} (${kanjiChars.length}文字に${cov}文字分のパート)`,
          );
        } else {
          // +サフィックスを除去してからかな検証
          const kanaParts = kana.split("|");
          const hasInvalidPart = kanaParts.some((p) => {
            const cleaned = stripPlusSuffix(p);
            return !cleaned || !/^[\u3040-\u309Fァ-ヶー]+$/.test(cleaned);
          });
          if (hasInvalidPart) {
            pipeErrors.push(`${kanji} (不正なパート内容)`);
          }
        }
      } else {
        // 従来: ひらがな+ーのみ
        if (!/^[\u3040-\u309Fー]+$/.test(kana)) {
          errors.push(line);
        }
      }
    });

    let msgs: string[] = [];
    if (errors.length > 0) {
      msgs.push(`読みエラー: ${errors.slice(0, 3).join(", ")}`);
    }
    if (pipeErrors.length > 0) {
      msgs.push(`パイプ数不一致: ${pipeErrors.slice(0, 3).join(", ")}`);
    }

    if (msgs.length > 0) {
      chart.validationMsg = msgs.join(" / ");
    } else {
      chart.validationMsg = "Master OK";
    }

    // 3. Sort Master
    arr.sort(replSortFn);
    const newMasterContent = arr.join("\n");
    chart.masterReplContent = newMasterContent;
    chart.appliedMasterReplContent = newMasterContent;

    // B. Update Chart Repl（masterマージなし、最適化のみ）
    const { merged, optimized } = generateChartRepl(
      chart.lrcContent,
      newMasterContent,
      chart.chartReplContent,
      chart.ignorePipeSet,
      false,
      );
    chart.lastMergedRepl = merged;
    chart.lastOptimizedRepl = optimized;
    chart.chartReplContent = optimized;
    chart.appliedChartReplContent = optimized;
  }

  function switchToReplTab() {
    ui.activeTab = "repl";
    syncLrcToTimeTagLines();
    if (!chart.lrcContent) return;

    // Get all phrases from current LRC（タイムタグの有無に関わらず全行を対象）
    const allPhrases = extractLrcPlainText(chart.lrcContent);

    // Filter out entries whose kanji no longer appears in the LRC
    const filteredChartRepl = chart.chartReplContent
      .trim()
      .split("\n")
      .filter((line) => {
        const key = line.split(",")[0];
        return key && allPhrases.includes(key);
      })
      .join("\n");

    const { merged, optimized } = generateChartRepl(
      chart.lrcContent,
      chart.appliedMasterReplContent,
      filteredChartRepl,
      chart.ignorePipeSet,
      false,
      );
    chart.lastMergedRepl = merged;
    chart.lastOptimizedRepl = optimized;
    chart.chartReplContent = optimized;
    chart.appliedChartReplContent = optimized;
  }

  // LRC find/replace は ./_components/LrcTab.svelte に閉じている

  function mergeFromMaster() {
    if (!chart.lrcContent.trim()) return;
    const { merged, optimized } = generateChartRepl(
      chart.lrcContent,
      chart.appliedMasterReplContent,
      chart.chartReplContent,
      chart.ignorePipeSet,
      true,
      );
    chart.lastMergedRepl = merged;
    chart.lastOptimizedRepl = optimized;
    chart.chartReplContent = optimized;
    chart.appliedChartReplContent = optimized;
  }

  function updateChartReplOnly() {
    try {
      const { merged, optimized } = generateChartRepl(
        chart.lrcContent,
        chart.appliedMasterReplContent,
        chart.chartReplContent,
        chart.ignorePipeSet,
        false,
        );
      chart.lastMergedRepl = merged;
      chart.lastOptimizedRepl = optimized;
      chart.chartReplContent = optimized;
      chart.appliedChartReplContent = optimized;
    } catch (err: unknown) {
      console.error("Error in updateChartReplOnly:", err);
      if (err instanceof Error) {
        alert("Error updating chart repl: " + err.message);
      }
    }
  }

  // readFileAsText は ./_lib/io/encoding に移動済み

  // selectEditorSource は ./_components/SourceDialog.svelte に移動済み

  async function loadFromFiles(files: File[], title: string) {
    const loadVersion = ++editorStateVersion;
    const isCurrentLoad = () => loadVersion === editorStateVersion;
    const sources: {
      type: string;
      label: string;
      url?: string;
      videoId?: string;
    }[] = [];
    let selectedSource: {
      type: string;
      label: string;
      url?: string;
      videoId?: string;
    } | null = null;

    ui.isProcessing = true;
    try {
      const lrcFile = files.find((f) => f.name.endsWith(".lrc"));
      const audioFile = files.find((f) => f.type.startsWith("audio/"));
      const videoFile = files.find((f) => f.type.startsWith("video/"));
      const imageFile = files.find((f) => f.type.startsWith("image/"));
      const replTxtFile = files.find((f) => f.name.endsWith(".repl.txt"));

      // LRC から @ytid 抽出
      const lrcRaw = lrcFile ? await readFileAsText(lrcFile) : "";
      if (!isCurrentLoad()) return;
      const ytidMatch = lrcRaw.match(/@ytid=["']?([A-Za-z0-9_-]{11})["']?/);
      const lrcYtVideoId = ytidMatch ? ytidMatch[1] : undefined;

      // 利用可能ソース構築
      if (audioFile)
        sources.push({
          type: "audio",
          label: "音声+画像",
          url: URL.createObjectURL(audioFile),
        });
      if (videoFile)
        sources.push({
          type: "video",
          label: "動画",
          url: URL.createObjectURL(videoFile),
        });
      if (lrcYtVideoId)
        sources.push({
          type: "youtube",
          label: "YouTube",
          videoId: lrcYtVideoId,
        });

      // メディアソース選択
      if (sources.length >= 2) {
        selectedSource = await new Promise((resolve) => {
          player.dialogSources = sources;
          player.pendingSourceCallback = resolve;
          player.showSourceDialog = true;
        });
      } else if (sources.length === 1) {
        selectedSource = sources[0];
      }
      if (!isCurrentLoad()) {
        cleanupSourceUrls(sources);
        return;
      }
      cleanupSourceUrls(sources, selectedSource?.url ?? null);

      // 前のURLをクリーンアップ
      revokeObjectUrl(player.audioSrc);
      player.audioSrc = null;
      revokeObjectUrl(player.videoSrc);
      player.videoSrc = null;
      // YouTube → 非YouTubeの切り替え時にリセット
      if (player.ytPlayer) {
        player.ytPlayer.destroy();
        player.ytPlayer = null;
      }
      player.audioMode = "file";
      revokeObjectUrl(player.imageSrc);
      player.imageSrc = null;

      if (imageFile) {
        player.imageSrc = URL.createObjectURL(imageFile);
      }

      // 選択に応じてメディアセット
      if (selectedSource?.type === "youtube" && selectedSource.videoId) {
        player.youtubeUrlInput = `https://youtube.com/watch?v=${selectedSource.videoId}`;
        // YouTube読み込みは LRC セット後に行う
      } else if (selectedSource?.type === "video" && selectedSource.url) {
        player.videoSrc = selectedSource.url;
      } else if (selectedSource?.type === "audio" && selectedSource.url) {
        player.audioSrc = selectedSource.url;
      }

      // フォルダに .lrc が無い場合は、既存の lrc / repl / タイムタグ を消さずに維持し、
      // メディア (音声/動画/画像/YouTube) だけ差し替える。
      // .repl.txt のみ存在する場合は repl だけ差し替える。
      if (lrcFile) {
        submit.loadedTitle = title;

        // @タグを抽出して内部保存（エクスポート時に復元）
        const ytIdMatch = lrcRaw.match(/^@ytid="([^"]+)"/m);
        chart.lrcYtId = ytIdMatch ? ytIdMatch[1] : "";

        // 投稿フィールドをリセットして今回のデータでオートフィル
        player.ytVideoId = chart.lrcYtId || ""; // $effect が古い player.ytVideoId で submit.ytVideoId を上書きしないようクリア
        submit.title = title || "";
        submit.artist = "";
        submit.description = "";
        submit.source = "";
        submit.tags = [];
        submit.ytVideoId = chart.lrcYtId || "";
        submit.submittedChartId = null;
        submit.autoFillError = "";
        submit.lastAutoFilledId = "";
        submit.suggestedTags = [];

        // @タグ行を除去してからLRCテキストを取得
        const lrcClean = lrcRaw.replace(/^@\w+=.*$/gm, "").trim();

        // 最初のタイムタグ〜最後のタイムタグの範囲だけ抽出
        const text =
          lrcClean.match(/\[\d\d:\d\d:\d\d\][\s\S]*\[\d\d:\d\d:\d\d\]/)?.[0] ||
          lrcClean;
        chart.lrcContent = text;

        let existingRepl = "";
        if (replTxtFile) {
          existingRepl = await readFileAsText(replTxtFile);
          if (!isCurrentLoad()) return;
        }

        const origLen = existingRepl.trim().length;
        const { merged, optimized } = generateChartRepl(
          text,
          chart.appliedMasterReplContent,
          existingRepl,
          chart.ignorePipeSet,
          !existingRepl.trim(), // masterは初回生成時のみ使用
          );
        chart.lastMergedRepl = merged;
        chart.lastOptimizedRepl = optimized;
        chart.chartReplContent = optimized;
        chart.appliedChartReplContent = optimized;
        if (origLen > 0) {
          const optLen = optimized.trim().length;
          const diff = origLen - optLen;
          chart.replOptimizeInfo = `既存repl: ${origLen}文字 → 最適化後: ${optLen}文字 (${diff >= 0 ? "-" : "+"}${Math.abs(diff)})`;
        } else {
          chart.replOptimizeInfo = "";
        }

        // タイムタグエディタに反映（古い tt.lines/tt.lrcText が残ると sourceLrc が旧譜面になるためリセット）
        tt.lines = [];
        tt.lrcText = "";
        await tick();
        if (!isCurrentLoad()) return;
        buildTimeTagLines();
      } else if (replTxtFile) {
        // .lrc は無いが .repl.txt はある: repl だけ既存 lrc に対して差し替える
        const existingRepl = await readFileAsText(replTxtFile);
        if (!isCurrentLoad()) return;
        const { merged, optimized } = generateChartRepl(
          chart.lrcContent,
          chart.appliedMasterReplContent,
          existingRepl,
          chart.ignorePipeSet,
          !existingRepl.trim(),
        );
        chart.lastMergedRepl = merged;
        chart.lastOptimizedRepl = optimized;
        chart.chartReplContent = optimized;
        chart.appliedChartReplContent = optimized;
        await tick();
        if (!isCurrentLoad()) return;
        if (chart.lrcContent) buildTimeTagLines();
      }
      // lrcFile も replTxtFile も無い場合は lrc/repl/tt を一切触らない（メディアのみ差し替え済み）

      // YouTube ソースが選択された場合、LRCセット後に読み込み
      if (selectedSource?.type === "youtube" && selectedSource.videoId) {
        loadYouTubeVideo(true);
      }
    } catch (err: unknown) {
      console.error("Error loading files:", err);
      cleanupSourceUrls(sources, selectedSource?.url ?? null);
      if (isCurrentLoad() && err instanceof Error) {
        alert("読み込みエラー: " + err.message);
      }
    } finally {
      if (isCurrentLoad()) ui.isProcessing = false;
    }
  }

  async function handleFolderSelect(
    e: Event & { currentTarget: HTMLInputElement },
  ) {
    if (!e.currentTarget.files || e.currentTarget.files.length === 0) return;
    if (!chart.isMasterLoaded) {
      alert("Master repl is still loading, please wait.");
      return;
    }
    const files = Array.from(e.currentTarget.files);
    const title =
      files[0]?.webkitRelativePath.split("/")[0] || files[0]?.name || "";
    await loadFromFiles(files, title);
  }

  async function openFolder() {
    if (!chart.isMasterLoaded) {
      alert("Master repl is still loading, please wait.");
      return;
    }
    // 既存譜面 (edit/[id]) でデータがロード済みの場合は上書き確認
    if (
      submit.editingChartId !== null &&
      (chart.lrcContent.trim() || chart.chartReplContent.trim())
    ) {
      const ok = confirm(
        "既存データを譜面フォルダで上書きしますか？\nLRC・Repl の現在の内容が置き換えられます。",
      );
      if (!ok) return;
    }
    // showDirectoryPicker が使えるならそちらを使う（FileSystemDirectoryHandle が取れる）
    if (window.showDirectoryPicker) {
      try {
        const dirHandle: FileSystemDirectoryHandle =
          await window.showDirectoryPicker();
        ui.lastFolderHandle = dirHandle;
        const files: File[] = [];
        // @ts-ignore - async iterator on FileSystemDirectoryHandle
        for await (const [, entry] of dirHandle) {
          if (entry.kind === "file") {
            files.push(await entry.getFile());
          } else if (entry.kind === "directory") {
            // 1階層だけサブディレクトリも探索
            // @ts-ignore
            for await (const [, sub] of entry) {
              if (sub.kind === "file") files.push(await sub.getFile());
            }
          }
        }
        await loadFromFiles(files, dirHandle.name);
        return;
      } catch (e: unknown) {
        if (e instanceof Error && e.name === "AbortError") return;
      }
    }
    // フォールバック: 隠しinputをクリック
    folderInputRef?.click();
  }

  // フォルダ選択用 隠しinput (DOM ref)
  let folderInputRef: HTMLInputElement | undefined = $state();

  // --- ドラッグ&ドロップ ---
  async function readAllEntries(
    dirEntry: FileSystemDirectoryEntry,
  ): Promise<File[]> {
    const files: File[] = [];
    function readEntries(
      reader: FileSystemDirectoryReader,
    ): Promise<FileSystemEntry[]> {
      return new Promise((resolve, reject) =>
        reader.readEntries(resolve, reject),
      );
    }
    function fileEntryToFile(entry: FileSystemFileEntry): Promise<File> {
      return new Promise((resolve, reject) => entry.file(resolve, reject));
    }
    async function traverse(entry: FileSystemEntry) {
      if (entry.isFile) {
        files.push(await fileEntryToFile(entry as FileSystemFileEntry));
      } else if (entry.isDirectory) {
        const reader = (entry as FileSystemDirectoryEntry).createReader();
        let entries: FileSystemEntry[];
        do {
          entries = await readEntries(reader);
          for (const child of entries) await traverse(child);
        } while (entries.length > 0);
      }
    }
    await traverse(dirEntry);
    return files;
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    ui.isDragOver = true;
  }

  function handleDragLeave(e: DragEvent) {
    if (
      e.currentTarget === e.target ||
      !(e.currentTarget as Element)?.contains(e.relatedTarget as Node)
    ) {
      ui.isDragOver = false;
    }
  }

  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    ui.isDragOver = false;
    if (!e.dataTransfer?.items) return;
    if (!chart.isMasterLoaded) {
      alert("Master repl is still loading, please wait.");
      return;
    }
    let dirEntry: FileSystemDirectoryEntry | null = null;
    for (const item of Array.from(e.dataTransfer.items)) {
      const entry = item.webkitGetAsEntry();
      if (entry?.isDirectory) {
        dirEntry = entry as FileSystemDirectoryEntry;
        // FileSystemDirectoryHandle を保存（Save As で startIn に使う）
        if ("getAsFileSystemHandle" in item) {
          try {
            // @ts-ignore - File System Access API
            const handle = await item.getAsFileSystemHandle();
            if (handle?.kind === "directory") {
              ui.lastFolderHandle = handle as FileSystemDirectoryHandle;
            }
          } catch {
            /* unsupported browser */
          }
        }
        break;
      }
    }
    if (!dirEntry) {
      alert("フォルダをドロップしてください");
      return;
    }
    const files = await readAllEntries(dirEntry);
    await loadFromFiles(files, dirEntry.name);
  }

  // === Player Abstraction ===
  function playerPlay() {
    if (player.audioMode === "file") audioRef?.play();
    else player.ytPlayer?.playVideo();
  }
  function playerPause() {
    if (player.audioMode === "file") audioRef?.pause();
    else player.ytPlayer?.pauseVideo();
    tt.pendingEndCheckKey = null;
  }
  function playerStop() {
    if (player.audioMode === "file") {
      if (audioRef) {
        audioRef.pause();
        audioRef.currentTime = 0;
      }
    } else {
      player.ytPlayer?.stopVideo();
    }
    tt.pendingEndCheckKey = null;
  }
  function playerSeek(time: number) {
    const t = Math.max(0, time);
    if (player.audioMode === "file") {
      if (audioRef) audioRef.currentTime = t;
    } else {
      player.ytPlayer?.seekTo(t, true);
    }
    // 停止中 (特に ended 後) は rAF が displayTime を更新しないため、
    // シーク位置をここで即同期する。これが無いとバー/プログレスが末尾で固まる。
    tt.displayTime = t;
    waveformSmoothTime = t;
    waveformTimeRef = t;
    waveformPerfRef = performance.now();
    if (player.waveformData && waveformCanvas) drawWaveform();
  }
  function playerGetTime(): number {
    if (player.audioMode === "file") return audioRef?.currentTime ?? 0;
    if (!player.ytPlayer) return 0;
    try {
      return player.ytPlayer.getCurrentTime() ?? 0;
    } catch {
      return 0;
    }
  }
  function playerIsPaused(): boolean {
    if (player.audioMode === "file") return !audioRef || audioRef.paused;
    if (!player.ytPlayer) return true;
    try {
      return player.ytPlayer.getPlayerState() !== 1; /* 1 = YT.PlayerState.PLAYING */
    } catch {
      return true;
    }
  }
  function playerSetRate(rate: number) {
    if (player.audioMode === "file") {
      if (audioRef) audioRef.playbackRate = rate;
    } else {
      player.ytPlayer?.setPlaybackRate(rate);
    }
  }
  function playerGetVolume(): number {
    if (player.audioMode === "file") return audioRef?.volume ?? 1;
    try {
      return (player.ytPlayer?.getVolume() ?? 100) / 100;
    } catch {
      return 1;
    }
  }
  function playerSetVolume(v: number) {
    const clamped = Math.max(0, Math.min(1, v));
    if (player.audioMode === "file") {
      if (audioRef) audioRef.volume = clamped;
    } else {
      player.ytPlayer?.setVolume(clamped * 100);
    }
  }

  // === YouTube ===
  // extractYouTubeId は ./_lib/submit/youtube-url に移動済み

  function createYtPlayer(videoId: string) {
    if (player.ytPlayer) {
      player.ytPlayer.destroy();
      player.ytPlayer = null;
    }
    player.ytPlayer = new YT.Player("yt-player", {
      videoId,
      playerVars: { rel: 0, modestbranding: 1 },
      events: {
        onReady: () => {
          player.ytPlayerReady = true;
          // ロード前に変更された倍速 / 音量を反映
          try {
            player.ytPlayer?.setPlaybackRate(tt.playbackRate);
            player.ytPlayer?.setVolume(($settings.volume / 100) * 100);
          } catch {}
        },
      },
    });
  }
  async function loadYouTubeFromSubmitId() {
    if (!submit.ytVideoId || !/^[A-Za-z0-9_-]{11}$/.test(submit.ytVideoId)) {
      alert("有効なYouTube Video IDを入力してください");
      return;
    }
    // 前回のオートフィル結果をリセット
    submit.title = "";
    submit.artist = "";
    submit.source = "";
    submit.tags = [];
    submit.suggestedTags = [];
    submit.lastAutoFilledId = "";
    submit.autoFillError = "";
    player.youtubeUrlInput = `https://www.youtube.com/watch?v=${submit.ytVideoId}`;
    await loadYouTubeVideo(true);
    autoFillFromYouTube();
  }

  async function loadYouTubeVideo(keepLrc = false) {
    const videoId = extractYouTubeId(player.youtubeUrlInput);
    if (!videoId) {
      alert("有効なYouTube URLを入力してください");
      return;
    }
    player.ytVideoId = videoId;
    submit.ytVideoId = videoId;
    if (!keepLrc) chart.lrcContent = "";
    // Stop and clear any local media
    if (audioRef) {
      audioRef.pause();
    }
    if (player.audioSrc) {
      URL.revokeObjectURL(player.audioSrc);
      player.audioSrc = null;
    }
    if (player.videoSrc) {
      URL.revokeObjectURL(player.videoSrc);
      player.videoSrc = null;
    }
    // Destroy existing player before switching
    if (player.ytPlayer) {
      player.ytPlayer.destroy();
      player.ytPlayer = null;
    }
    player.audioMode = "youtube";
    await tick(); // Ensure #yt-player div is mounted in DOM before creating player
    if (player.ytPlayerReady || ((window as any).YT && (window as any).YT.Player)) {
      // 既に API がロード済み（同一セッション内の他ページ経由など）→ 即座に作成
      player.ytPlayerReady = true;
      createYtPlayer(videoId);
    } else {
      (window as any).onYouTubeIframeAPIReady = () => {
        player.ytPlayerReady = true;
        createYtPlayer(videoId);
      };
      if (!document.getElementById("yt-api-script")) {
        const script = document.createElement("script");
        script.id = "yt-api-script";
        script.src = "https://www.youtube.com/iframe_api";
        document.head.appendChild(script);
      }
    }
  }

  function playAudioAt(time: number) {
    playerSeek(time);
    playerPlay();
  }

  // encodeToSjis は ./_lib/io/encoding に移動済み

  // downloadChartRepl は ./_lib/io/save-files に移動済み

  // チェック付け・読み解決ロジックは timetag-parser.ts に移動済み

  // Auto-scroll to cursor line (only on sequential tagging, not on click)
  $effect(() => {
    const _line = tt.cursorLine; // track dependency
    if (!tt.autoScroll) return;
    tt.autoScroll = false;
    tick().then(() => {
      const el = document.querySelector(".ttLineCurrent");
      if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  });

  function scrollCursorToCenter() {
    tick().then(() => {
      const container = ttEditorAreaEl;
      const el = container?.querySelector(".ttLineCurrent") as HTMLElement | null;
      if (!container || !el) return;
      const cRect = container.getBoundingClientRect();
      const eRect = el.getBoundingClientRect();
      const elTop = eRect.top - cRect.top;
      const elBottom = eRect.bottom - cRect.top;
      const margin = cRect.height * 0.25;
      if (elTop < margin) {
        container.scrollTo({ top: container.scrollTop - (margin - elTop), behavior: "smooth" });
      } else if (elBottom > cRect.height - margin) {
        container.scrollTo({ top: container.scrollTop + (elBottom - (cRect.height - margin)), behavior: "smooth" });
      }
    });
  }

  // buildTimeTagLines / syncLrcToTimeTagLines は ./_lib/timetag/build から import (wrapper で注入)
  function buildTimeTagLines() {
    buildTimeTagLinesCore(rebuildWaveformTagCache);
  }
  function syncLrcToTimeTagLines() {
    syncLrcToTimeTagLinesCore(rebuildWaveformTagCache);
  }
  // openRubyEdit / closeRubyEdit は ./_lib/timetag/ruby-edit から import 済み

  function autoFocus(node: HTMLElement) {
    node.focus();
  }

  // handleTtAreaCopy は ./_components/TimeTagTab.svelte に閉じている

  // applyRubyEdit は ./_lib/timetag/ruby-edit から import (wrapper で注入)
  function applyRubyEdit() {
    applyRubyEditCore(buildTimeTagLines);
  }

  // ttRecordOp / applyOp は ./_lib/timetag/operations から import 済み
  // ttUndo / ttRedo は wrapper として local 定義 (rebuildWaveformTagCache 注入)
  function ttUndo() {
    ttUndoCore(rebuildWaveformTagCache);
  }
  function ttRedo() {
    ttRedoCore(rebuildWaveformTagCache);
  }

  function ttIsPlaying(): boolean {
    return !playerIsPaused();
  }

  function ttCurrentTime(): number {
    return playerGetTime();
  }

  // buildKaraokeUnits / ttCharProgress は ./_lib/timetag/karaoke から import 済み
  // formatTime / ttIsSpace / ttEndCheckActive / applyTtCursor / ttLineEndActive
  //   / ttIsOnEndCheck / ttEndCheckTime は ./_lib/timetag/utils から import 済み

  function deleteCurrentEndCheckTime(): boolean {
    if (!ttIsOnEndCheck()) return false;
    const ci = tt.cursorChar - 1;
    const ch = tt.lines[tt.cursorLine]?.chars[ci];
    if (!ch || ch.endTime === null) return false;

    const prevEndTime = ch.endTime;
    ttRecordOp({
      type: "setEndTime",
      li: tt.cursorLine,
      ci,
      prev: prevEndTime,
      next: null,
    });
    ch.endTime = null;
    tt.lines = [...tt.lines];
    generateTtLrc();
    rebuildWaveformTagCache();
    return true;
  }

  /** pending中のエンドチェックを即時確定 */
  function flushPendingEndCheck() {
    if (tt.pendingEndCheckKey === null) return;
    const lineChars = tt.lines[tt.pendingEndCheckLine]?.chars;
    if (lineChars) {
      let found = false;
      for (let i = tt.pendingEndCheckChar; i < lineChars.length; i++) {
        if (i > tt.pendingEndCheckChar && lineChars[i].checkCount > 0) break;
        if (lineChars[i].isEndCheck) {
          lineChars[i].endTime = ttCurrentTime() - $settings.timeOffset;
          found = true;
        }
      }
      if (found) {
        tt.lines = [...tt.lines];
        generateTtLrc();
      }
    }
    tt.pendingEndCheckKey = null;
  }

  /** キーアップでエンドチェックのタグを設定 */
  function handleTtKeyup(e: KeyboardEvent) {
    if (e.code === "ShiftLeft" || e.code === "ShiftRight") ui.shiftHeld = false;
    if (ui.activeTab !== "timetag" || tt.editorMode !== "timetag") return;
    if (!ttIsPlaying() || tt.pendingEndCheckKey === null) return;
    if (e.code !== tt.pendingEndCheckKey) return;

    const lineChars = tt.lines[tt.pendingEndCheckLine]?.chars;
    if (!lineChars) {
      tt.pendingEndCheckKey = null;
      return;
    }

    let found = false;
    const endT = ttCurrentTime() - $settings.timeOffset;
    for (let i = tt.pendingEndCheckChar; i < lineChars.length; i++) {
      if (i > tt.pendingEndCheckChar && lineChars[i].checkCount > 0) break;
      if (lineChars[i].isEndCheck) {
        lineChars[i].endTime = endT;
        found = true;
      }
    }

    if (found) {
      tt.lines = [...tt.lines];
      generateTtLrc();
      waveformEndTimesCache.push(endT);
    }
    tt.pendingEndCheckKey = null;
  }

  // generateTtLrc は ./_lib/timetag/utils から import 済み

  function updateWaveformCacheTime(ki: number, prev: number | null, next: number | null) {
    const cache = ki === 0 ? waveformTagTimesCache : waveformTagTimesSecCache;
    if (prev !== null) {
      const idx = cache.indexOf(prev);
      if (idx >= 0) cache.splice(idx, 1);
    }
    if (next !== null) cache.push(next);
  }

  function rebuildWaveformTagCache() {
    const primary: number[] = [];
    const secondary: number[] = [];
    const ends: number[] = [];
    for (const line of tt.lines) {
      for (const ch of line.chars) {
        for (let i = 0; i < ch.times.length; i++) {
          if (ch.times[i] !== null) {
            if (i === 0) primary.push(ch.times[i]!);
            else secondary.push(ch.times[i]!);
          }
        }
        if (ch.endTime !== null) ends.push(ch.endTime);
      }
    }
    waveformTagTimesCache = primary;
    waveformTagTimesSecCache = secondary;
    waveformEndTimesCache = ends;
    if (player.waveformData && waveformCanvas && waveformGl && playerIsPaused()) {
      waveformSmoothTime = tt.displayTime;
      drawWaveform();
    }
  }

  // ツールタブの実装は ./_components/ToolsTab.svelte (rebuildWaveformTagCache/drawWaveform/clearWaveformCaches を inline で渡す)

  // getLrcForSave は ./_lib/lrc/serialize に移動済み

  // 再生関係のショートカット (タブ・フォーカス位置に依存しない汎用処理)。
  // a:再生 d:再生一時停止 s:停止 z:2秒戻し x:2秒進め q:速度- w:速度+
  const PLAYBACK_CODES = new Set(["KeyA", "KeyD", "KeyS", "KeyZ", "KeyX", "KeyQ", "KeyW"]);
  function runPlaybackKey(code: string) {
    switch (code) {
      case "KeyA":
        playerPlay();
        break;
      case "KeyD":
        if (playerIsPaused()) playerPlay();
        else playerPause();
        break;
      case "KeyS":
        playerStop();
        break;
      case "KeyZ":
        playerSeek(playerGetTime() - 2);
        break;
      case "KeyX":
        playerSeek(playerGetTime() + 2);
        break;
      case "KeyQ":
        tt.playbackRate = Math.max(0.1, tt.playbackRate - 0.1);
        playerSetRate(tt.playbackRate);
        break;
      case "KeyW":
        tt.playbackRate = Math.min(2.0, tt.playbackRate + 0.1);
        playerSetRate(tt.playbackRate);
        break;
    }
  }
  // 下部コントロールバー (range) フォーカス時にも再生系を効かせる。
  function handleSliderKeydown(e: KeyboardEvent) {
    if (e.ctrlKey || e.altKey || e.metaKey) return; // Ctrl+Z 等は range/ブラウザに委ねる
    if (!PLAYBACK_CODES.has(e.code)) return;
    e.preventDefault();
    e.stopPropagation(); // window 側との二重処理を防ぐ
    // TimeTag タブ表示中は従来の高度な挙動 (a=フォーカス文字から再生 等) を維持
    if (ui.activeTab === "timetag" && tt.editorMode === "timetag") {
      handleTtKeydown(e);
    } else {
      runPlaybackKey(e.code);
    }
  }

  function handleTtKeydown(e: KeyboardEvent) {
    if (ui.activeTab !== "timetag" || tt.editorMode !== "timetag") return;

    if (e.code === "ShiftLeft" || e.code === "ShiftRight") ui.shiftHeld = true;

    const playing = ttIsPlaying();
    const isTagKey = e.code === "Space" || e.code === "KeyV" || e.code === "KeyB" || e.code === "KeyN";

    // Common shortcuts (work even when tt.lines is empty)
    switch (e.code) {
      case "KeyA":
        e.preventDefault();
        if (e.shiftKey) {
          playAudioAt(0);
        } else {
          let t: number | null = null;
          if (tt.lines.length > 0) {
            if (ttIsOnEndCheck()) {
              t = ttEndCheckTime();
            } else {
              const ch = tt.lines[tt.cursorLine]?.chars[tt.cursorChar];
              t = ch?.times[tt.cursorCheck] ?? ch?.times[0] ?? null;
            }
          }
          if (Number.isFinite(t as number)) {
            playAudioAt(t!);
          } else {
            // カーソル位置より前の最も近いタイムタグから再生
            let prevT: number | null = null;
            outer: for (let li = tt.cursorLine; li >= 0; li--) {
              const line = tt.lines[li];
              if (!line) continue;
              const startCi =
                li === tt.cursorLine ? tt.cursorChar - 1 : line.chars.length - 1;
              for (let ci = startCi; ci >= 0; ci--) {
                const times = line.chars[ci]?.times;
                if (
                  times &&
                  times.length > 0 &&
                  Number.isFinite(times[times.length - 1])
                ) {
                  prevT = times[times.length - 1];
                  break outer;
                }
              }
            }
            if (Number.isFinite(prevT as number)) {
              playAudioAt(prevT!);
            } else {
              playerPlay();
            }
          }
        }
        return;
      case "KeyS":
        e.preventDefault();
        playerStop();
        return;
      case "KeyD":
        e.preventDefault();
        if (playerIsPaused()) playerPlay();
        else playerPause();
        return;
      case "KeyZ":
        if (e.ctrlKey) {
          e.preventDefault();
          ttUndo();
          return;
        }
        e.preventDefault();
        playerSeek(playerGetTime() - 2);
        return;
      case "KeyY":
        if (e.ctrlKey) {
          e.preventDefault();
          ttRedo();
          return;
        }
        return;
      case "KeyX":
        e.preventDefault();
        playerSeek(playerGetTime() + 2);
        return;
      case "KeyQ":
        e.preventDefault();
        tt.playbackRate = Math.max(0.1, tt.playbackRate - 0.1);
        playerSetRate(tt.playbackRate);
        return;
      case "KeyW":
        e.preventDefault();
        tt.playbackRate = Math.min(2.0, tt.playbackRate + 0.1);
        playerSetRate(tt.playbackRate);
        return;
      case "KeyR": {
        e.preventDefault();
        const rubyCh = tt.lines[tt.cursorLine]?.chars[tt.cursorChar]?.char;
        if (!rubyCh || /^\s$/.test(rubyCh)) return;
        openRubyEdit(tt.cursorLine, tt.cursorChar);
        return;
      }
      case "Digit1":
        e.preventDefault();
        {
          const v = Math.max(0, playerGetVolume() - 0.05);
          playerSetVolume(v);
          updateSetting("volume", Math.round(v * 100));
        }
        return;
      case "Digit2":
        e.preventDefault();
        {
          const v = Math.min(1, playerGetVolume() + 0.05);
          playerSetVolume(v);
          updateSetting("volume", Math.round(v * 100));
        }
        return;
    }

    // Shift+I/K/ArrowUp/Down: waveform zoom（ttLines有無に関係なく動作）
    if (e.shiftKey && (e.code === "KeyI" || e.code === "ArrowUp")) {
      e.preventDefault();
      waveformZoomIn();
      return;
    }
    if (
      e.shiftKey &&
      (e.code === "KeyK" || e.code === "ArrowDown")
    ) {
      e.preventDefault();
      waveformZoomOut();
      return;
    }

    if (tt.lines.length === 0) return;

    // Alt+Arrow/IJKL: adjust tag ±0.01s
    if (
      e.altKey &&
      (e.code === "ArrowUp" ||
        e.code === "ArrowDown" ||
        e.code === "KeyI" ||
        e.code === "KeyK")
    ) {
      e.preventDefault();
      const cursor: TtCursor = {
        line: tt.cursorLine,
        char: tt.cursorChar,
        check: tt.cursorCheck,
      };
      const delta = e.code === "ArrowUp" || e.code === "KeyI" ? 0.01 : -0.01;
      const ki = cursor.check;
      const ch0 = tt.lines[cursor.line]?.chars[cursor.char];
      const prevT = ch0?.times[ki] ?? null;
      if (adjustTagTime(tt.lines, cursor, delta)) {
        const newT = ch0?.times[ki] ?? null;
        ttRecordOp({ type: 'setTime', li: cursor.line, ci: cursor.char, ki, prev: prevT, next: newT });
        tt.lines = [...tt.lines];
        generateTtLrc();
        updateWaveformCacheTime(ki, prevT, newT);
      }
      return;
    }

    // Arrow keys / IJKL: navigation
    if (e.code === "ArrowLeft" || e.code === "KeyJ") {
      e.preventDefault();
      if (tt.cursorChar > 0) tt.cursorChar--;
      else if (tt.cursorLine > 0) {
        tt.cursorLine--;
        tt.cursorChar = tt.lines[tt.cursorLine].chars.length - 1;
      }
      tt.cursorCheck = 0;
      return;
    }
    if (e.code === "ArrowRight" || e.code === "KeyL") {
      e.preventDefault();
      if (tt.cursorChar < tt.lines[tt.cursorLine].chars.length) tt.cursorChar++;
      else if (tt.cursorLine < tt.lines.length - 1) {
        tt.cursorLine++;
        tt.cursorChar = 0;
      }
      tt.cursorCheck = 0;
      return;
    }
    if ((e.code === "ArrowUp" || e.code === "KeyI") && !e.altKey) {
      e.preventDefault();
      if (tt.cursorLine > 0) {
        tt.cursorLine--;
        tt.cursorChar = Math.min(
          tt.cursorChar,
          tt.lines[tt.cursorLine].chars.length,
        );
      }
      tt.cursorCheck = 0;
      scrollCursorToCenter();
      return;
    }
    if ((e.code === "ArrowDown" || e.code === "KeyK") && !e.altKey) {
      e.preventDefault();
      if (tt.cursorLine < tt.lines.length - 1) {
        tt.cursorLine++;
        tt.cursorChar = Math.min(
          tt.cursorChar,
          tt.lines[tt.cursorLine].chars.length,
        );
      }
      tt.cursorCheck = 0;
      scrollCursorToCenter();
      return;
    }

    const cursor: TtCursor = {
      line: tt.cursorLine,
      char: tt.cursorChar,
      check: tt.cursorCheck,
    };

    if (!e.shiftKey && e.code === "Backspace" && ttIsOnEndCheck()) {
      e.preventDefault();
      deleteCurrentEndCheckTime();
      return;
    }

    if (playing) {
      // === Tagging mode ===
      if (e.shiftKey && isTagKey) {
        e.preventDefault();
        const ch0 = tt.lines[cursor.line]?.chars[cursor.char];
        if (ch0) {
          const prevCount = ch0.checkCount; const prevTimes = [...ch0.times];
          if (incrementCheck(tt.lines, cursor)) {
            ttRecordOp({ type: 'setCheck', li: cursor.line, ci: cursor.char,
              prevCount, prevTimes, nextCount: ch0.checkCount, nextTimes: [...ch0.times],
              prevEndTime: ch0.endTime, nextEndTime: ch0.endTime });
            tt.lines = [...tt.lines];
          }
        }
        return;
      }
      if (
        isTagKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.metaKey
      ) {
        e.preventDefault();
        if (e.repeat) return;
        if (ttIsOnEndCheck()) {
          const prevChar = tt.lines[tt.cursorLine]?.chars[tt.cursorChar - 1];
          if (prevChar?.isEndCheck) {
            const prevE = prevChar.endTime;
            const newE = ttCurrentTime() - $settings.timeOffset;
            ttRecordOp({ type: 'setEndTime', li: tt.cursorLine, ci: tt.cursorChar - 1, prev: prevE, next: newE });
            prevChar.endTime = newE;
            tt.lines = [...tt.lines];
            generateTtLrc();
          }
          return;
        }
        flushPendingEndCheck();
        const stampTime = ttCurrentTime() - $settings.timeOffset;
        const ki = cursor.check;
        const ch0 = tt.lines[cursor.line]?.chars[cursor.char];
        const prevT = ch0?.times[ki] ?? null;
        const result = tagCurrentCheck(tt.lines, cursor, stampTime, 0);
        if (result) {
          ttRecordOp({ type: 'setTime', li: cursor.line, ci: cursor.char, ki, prev: prevT, next: ch0?.times[ki] ?? null });
          applyTtCursor(result.cursor);
          tt.lastTaggedLine = result.lastTagged.line;
          tt.lastTaggedChar = result.lastTagged.char;
          tt.pendingEndCheckKey = e.code;
          tt.pendingEndCheckLine = result.lastTagged.line;
          tt.pendingEndCheckChar = result.lastTagged.char;
          tt.lines = [...tt.lines];
          generateTtLrc();
          // 旧タイムを除去して新タイムを追加（O(N) だが N は小さい）
          updateWaveformCacheTime(ki, prevT, stampTime);
        }
        return;
      }
      if (e.code === "Enter") {
        e.preventDefault();
        if (tt.lastTaggedLine >= 0 && tt.lastTaggedChar >= 0) {
          const lastTagged: TtLastTagged = {
            line: tt.lastTaggedLine,
            char: tt.lastTaggedChar,
          };
          const endT = ttCurrentTime() - $settings.timeOffset;
          const endResult = setEndTime(tt.lines, lastTagged, endT);
          if (endResult) {
            ttRecordOp({ type: 'setEndTime', li: endResult.li, ci: endResult.ci, prev: endResult.prevEndTime, next: endT });
            tt.lines = [...tt.lines];
            generateTtLrc();
            waveformEndTimesCache.push(endT);
          }
        }
        return;
      }
      if (e.shiftKey && e.code === "Backspace") {
        e.preventDefault();
        const ch0 = tt.lines[cursor.line]?.chars[cursor.char];
        if (ch0) {
          const prevCount = ch0.checkCount; const prevTimes = [...ch0.times]; const prevE = ch0.endTime;
          if (decrementCheck(tt.lines, cursor)) {
            ttRecordOp({ type: 'setCheck', li: cursor.line, ci: cursor.char,
              prevCount, prevTimes, nextCount: ch0.checkCount, nextTimes: [...ch0.times],
              prevEndTime: prevE, nextEndTime: ch0.endTime });
            tt.lines = [...tt.lines];
            generateTtLrc();
            rebuildWaveformTagCache();
          }
        }
        return;
      }
      if (e.code === "Backspace") {
        e.preventDefault();
        const prevCursor = retreatToPrevCheck(tt.lines, cursor);
        const ch0 = tt.lines[prevCursor.line]?.chars[prevCursor.char];
        ttRecordOp({ type: 'setTime', li: prevCursor.line, ci: prevCursor.char, ki: prevCursor.check,
          prev: ch0?.times[prevCursor.check] ?? null, next: null });
        const newCursor = deleteCurrentTag(tt.lines, cursor);
        applyTtCursor(newCursor);
        tt.lines = [...tt.lines];
        generateTtLrc();
        rebuildWaveformTagCache();
        return;
      }
      if (e.code === "Delete") {
        e.preventDefault();
        const ch0 = tt.lines[cursor.line]?.chars[cursor.char];
        if (ch0) {
          const prevT = ch0.times[cursor.check] ?? null;
          ttRecordOp({ type: 'setTime', li: cursor.line, ci: cursor.char, ki: cursor.check, prev: prevT, next: null });
          ch0.times[cursor.check] = null;
          tt.lines = [...tt.lines];
          generateTtLrc();
          rebuildWaveformTagCache();
        }
        return;
      }
    } else {
      // === Check mode ===
      if (isTagKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        const ch0 = tt.lines[cursor.line]?.chars[cursor.char];
        if (ch0) {
          const prevCount = ch0.checkCount; const prevTimes = [...ch0.times];
          if (incrementCheck(tt.lines, cursor)) {
            ttRecordOp({ type: 'setCheck', li: cursor.line, ci: cursor.char,
              prevCount, prevTimes, nextCount: ch0.checkCount, nextTimes: [...ch0.times],
              prevEndTime: ch0.endTime, nextEndTime: ch0.endTime });
            tt.lines = [...tt.lines];
          }
        }
        return;
      }
      if (e.code === "Backspace") {
        e.preventDefault();
        const ch0 = tt.lines[cursor.line]?.chars[cursor.char];
        if (ch0) {
          const prevCount = ch0.checkCount; const prevTimes = [...ch0.times]; const prevE = ch0.endTime;
          if (decrementCheck(tt.lines, cursor)) {
            ttRecordOp({ type: 'setCheck', li: cursor.line, ci: cursor.char,
              prevCount, prevTimes, nextCount: ch0.checkCount, nextTimes: [...ch0.times],
              prevEndTime: prevE, nextEndTime: ch0.endTime });
            tt.lines = [...tt.lines];
          }
        }
        return;
      }
      if (e.code === "Delete") {
        e.preventDefault();
        const ch0 = tt.lines[cursor.line]?.chars[cursor.char];
        if (ch0) {
          const prevCount = ch0.checkCount; const prevTimes = [...ch0.times]; const prevE = ch0.endTime;
          if (deleteAllChecks(tt.lines, cursor)) {
            ttRecordOp({ type: 'setCheck', li: cursor.line, ci: cursor.char,
              prevCount, prevTimes, nextCount: 0, nextTimes: [],
              prevEndTime: prevE, nextEndTime: null });
            tt.lines = [...tt.lines];
          }
        }
        return;
      }
    }
  }


  // saveChartFolder / downloadTtLrc は ./_lib/io/save-files に移動済み
  // autoFillFromYouTube は ./_lib/submit/youtube-meta に移動済み
  // addTag / removeTag / submitChart は ./_lib/submit/submit-chart に移動済み

  // TT 再生成コールバック (save-files / submit-chart に渡す)
  const ttRegenCb = {
    syncLrcToTimeTagLines: () => syncLrcToTimeTagLines(),
    generateTtLrc: () => generateTtLrc(),
  };

  // ttTotalChecks / ttTaggedCount は ./_components/TimeTagTab.svelte に閉じている
</script>

<svelte:window onkeydown={handleWindowKeydown} onkeyup={handleTtKeyup} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="container"
  class:dragOver={ui.isDragOver}
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
  ondrop={handleDrop}
>
  <!-- hidden audio element for file mode (audio-only) -->
  {#if !player.videoSrc}
    <audio
      bind:this={audioRef}
      src={player.audioSrc ?? undefined}
      style="display:none"
      onpause={() => {}}
      onloadedmetadata={() => {
        if (audioRef) {
          audioRef.playbackRate = tt.playbackRate;
          audioRef.volume = $settings.volume / 100;
          player.audioDuration = audioRef.duration || 0;
        }
      }}
    ></audio>
  {/if}

  <!-- TOP PANEL (1/3) -->
  <div class="topPanel">
    <!-- Left: video area -->
    <div class="videoArea">
      {#if player.audioMode === "youtube"}
        <div id="yt-player" class="ytPlayer"></div>
      {:else if player.videoSrc}
        <video
          bind:this={audioRef}
          src={player.videoSrc}
          class="videoPlayer"
          onloadedmetadata={() => {
            if (audioRef) {
              audioRef.playbackRate = tt.playbackRate;
              audioRef.volume = $settings.volume / 100;
              player.audioDuration = audioRef.duration || 0;
            }
          }}
        ></video>
      {:else if player.imageSrc}
        <img class="coverImage" src={player.imageSrc} alt="Cover" />
      {:else}
        <button
          class="videoPlaceholder videoPlaceholderBtn"
          onclick={openFolder}
        >
          <svg
            class="icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><path
              d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"
            /></svg
          >
          <span>譜面フォルダを開く</span>
        </button>
      {/if}
    </div>

    <!-- Right: settings panel -->
    <div class="settingsPanel">
      <div class="settingsTabs">
        <button
          class="settingsTabBtn"
          class:active={submit.settingsTab === "submit"}
          onclick={() => (submit.settingsTab = "submit")}>投稿</button
        >
        <button
          class="settingsTabBtn"
          class:active={submit.settingsTab === "tools"}
          onclick={() => (submit.settingsTab = "tools")}>ツール</button
        >
      </div>

      <div class="settingsPanelContent">
        {#if submit.settingsTab === "submit"}
          <SubmitForm
            {loadYouTubeFromSubmitId}
            {ttRegenCb}
          />
        {:else if submit.settingsTab === "tools"}
          <ToolsTab
            {rebuildWaveformTagCache}
            drawWaveform={() => {
              if (player.waveformData && waveformCanvas && waveformGl) drawWaveform();
            }}
            clearWaveformCaches={() => {
              waveformTagTimesCache = [];
              waveformTagTimesSecCache = [];
              waveformEndTimesCache = [];
            }}
          />
        {/if}
      </div>
      <!-- /settingsPanelContent -->
    </div>
  </div>

  <!-- BOTTOM PANEL (2/3) -->
  <div class="bottomPanel">
    <div class="tabBar">
      <button
        class="tabBtn"
        class:active={ui.activeTab === "timetag"}
        onclick={() => {
          const fromLrc = ui.activeTab === "lrc";
          ui.activeTab = "timetag";
          if (!chart.lrcContent) return;
          if (fromLrc) {
            syncLrcToTimeTagLines();
          } else {
            const currentKey = chart.lrcContent + "\0" + chart.appliedChartReplContent;
            if (tt.lines.length === 0 || tt.lastReplKey !== currentKey) {
              buildTimeTagLines();
            }
          }
        }}>Time Tag Editor</button
      >
      <button
        class="tabBtn"
        class:active={ui.activeTab === "lrc"}
        onclick={() => {
          ui.activeTab = "lrc";
          if (tt.lines.length > 0) generateTtLrc();
        }}>Lyric Editor</button
      >
      <button
        class="tabBtn"
        class:active={ui.activeTab === "repl"}
        onclick={switchToReplTab}>Repl Editor</button
      >
      <div class="ioGroup">
        <button
          class="ioBtn"
          onclick={openFolder}
          title="ニコ生タイピング譜面を開く"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
          </svg>
          <span>フォルダを開く</span>
        </button>
        <input
          bind:this={folderInputRef}
          type="file"
          onchange={handleFolderSelect}
          class="hiddenInput"
          webkitdirectory
        />
        <button
          class="ioBtn"
          onclick={(e) =>
            e.ctrlKey || e.metaKey
              ? copyYtypingJson(ttRegenCb)
              : saveChartFolder(ttRegenCb)}
          title=".lrc + .repl.txt をフォルダへ保存"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          <span>歌詞データを保存</span>
        </button>
      </div>
    </div>

    {#if tt.rubyEditLine >= 0}
      <div
        class="ttRubyEditOverlay"
        onclick={closeRubyEdit}
        role="presentation"
      >
        <div
          class="ttRubyEditPopup"
          onclick={(e) => e.stopPropagation()}
          role="dialog"
        >
          <div class="ttRubyEditRow">
            <input
              class="ttRubyEditKeyInput"
              bind:value={tt.rubyEditKey}
              onkeydown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applyRubyEdit();
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  closeRubyEdit();
                }
                if (e.ctrlKey && e.key === "ArrowLeft") {
                  e.preventDefault();
                  extendRubyKey("left");
                }
                if (e.ctrlKey && e.key === "ArrowRight") {
                  e.preventDefault();
                  extendRubyKey("right");
                }
                e.stopPropagation();
              }}
            />
            <span class="ttRubyEditArrow">,</span>
            <input
              class="ttRubyEditInput"
              bind:value={tt.rubyEditValue}
              onkeydown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applyRubyEdit();
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  closeRubyEdit();
                }
                if (e.ctrlKey && e.key === "ArrowLeft") {
                  e.preventDefault();
                  extendRubyKey("left");
                }
                if (e.ctrlKey && e.key === "ArrowRight") {
                  e.preventDefault();
                  extendRubyKey("right");
                }
                e.stopPropagation();
              }}
              use:autoFocus
            />
          </div>
          <div class="ttRubyEditHint">
            Enter: 確定 / Esc: キャンセル / Ctrl+←→: 範囲を拡張
          </div>
        </div>
      </div>
    {/if}

    {#if ui.activeTab === "repl"}
      <ReplTab
        {optimizeDiff}
        {missingKanjiReport}
        {needsPipeReport}
        isLoggedIn={$page.data.isLoggedIn === true}
        {updateChartReplOnly}
        {mergeFromMaster}
        {generateReplLiteTest}
        {playAudioAt}
        {startPipeEdit}
        {endPipeEdit}
      />
    {:else if ui.activeTab === "timetag"}
      <TimeTagTab
        downloadLrc={() => downloadTtLrc(ttRegenCb)}
        {playerSeek}
        bind:editorAreaEl={ttEditorAreaEl}
      />
    {:else if ui.activeTab === "lrc"}
      <LrcTab downloadLrc={() => downloadTtLrc(ttRegenCb)} />
    {/if}

    <!-- Shortcuts Popup -->
    {#if tt.showShortcuts}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="ttOverlay" onclick={() => (tt.showShortcuts = false)}>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="ttShortcutPanel" onclick={(e) => e.stopPropagation()}>
          <h3>ショートカットキー</h3>
          <div class="ttShortcutGrid">
            <div class="ttShortcutSection">
              <h4>全般</h4>
              <div><kbd>A</kbd> フォーカス文字から再生</div>
              <div><kbd>S</kbd> 停止</div>
              <div><kbd>D</kbd> 一時停止/再生</div>
              <div><kbd>Z</kbd>/<kbd>X</kbd> 再生位置±2秒</div>
              <div><kbd>Q</kbd>/<kbd>W</kbd> 再生速度±10%</div>
              <div><kbd>1</kbd>/<kbd>2</kbd> 音量±5</div>
              <div><kbd>Ctrl+Z</kbd>/<kbd>Ctrl+Y</kbd> Undo/Redo</div>
              <div><kbd>Alt+↑</kbd>/<kbd>Alt+↓</kbd> タグ±0.01秒</div>
              <div><kbd>R</kbd> 簡易ルビ編集</div>
            </div>
            <div class="ttShortcutSection">
              <h4>停止中</h4>
              <div><kbd>Space</kbd>/<kbd>V</kbd>/<kbd>B</kbd>/<kbd>N</kbd> チェック数+1</div>
              <div><kbd>Backspace</kbd> チェック数-1</div>
              <div><kbd>Delete</kbd> チェック全削除</div>
            </div>
            <div class="ttShortcutSection">
              <h4>再生中</h4>
              <div><kbd>Space</kbd>/<kbd>V</kbd>/<kbd>B</kbd>/<kbd>N</kbd> タイムタグをセット</div>
              <div><kbd>長押し→キーアップ</kbd> endTimeをセット</div>
                            <div><kbd>Enter</kbd> 直前にタグ付けした文字にendTimeをセット</div>
              <div><kbd>Shift＋Space</kbd> チェック付け</div>
              <div><kbd>Backspace</kbd> タグ消去（戻る）</div>
              <div><kbd>Delete</kbd> タグ消去</div>
            </div>
            <div class="ttShortcutSection">
              <h4>カーソル</h4>
              <div><kbd>←→</kbd>/<kbd>J</kbd><kbd>L</kbd> 文字移動</div>
              <div><kbd>↑↓</kbd>/<kbd>I</kbd><kbd>K</kbd> 行移動</div>
            </div>
          </div>
          <button class="ttBtn" onclick={() => (tt.showShortcuts = false)}
            >閉じる</button
          >
        </div>
      </div>
    {/if}
  </div>
  <!-- /bottomPanel -->

  <!-- Bottom fixed stack -->
  <div class="bottomFixed">
    {#if ui.activeTab === "timetag" && player.audioMode === "file" && (player.waveformDecoding || player.waveformData)}
      <div class="waveformFooter">
        {#if player.waveformDecoding}
          <div class="waveformProgress">
            <div class="waveformProgressBar">
              <div
                class="waveformProgressFill"
                style="width: {(player.waveformProgress * 100).toFixed(1)}%"
              ></div>
            </div>
            <span class="waveformProgressLabel"
              >波形解析中… {(player.waveformProgress * 100).toFixed(0)}%</span
            >
          </div>
        {:else if player.waveformData}
          <div class="waveformCanvasWrap">
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <canvas
              bind:this={waveformCanvas}
              class="waveformCanvasLarge"
              onclick={(e) => {
                const rect = (
                  e.currentTarget as HTMLCanvasElement
                ).getBoundingClientRect();
                const ratio = (e.clientX - rect.left) / rect.width;
                // 描画と同じ「クランプしない窓」で位置→時刻を計算
                const windowStart = tt.displayTime - player.waveformZoom / 2;
                const windowEnd = tt.displayTime + player.waveformZoom / 2;
                const target = windowStart + ratio * (windowEnd - windowStart);
                playerSeek(Math.max(0, Math.min(player.audioDuration, target)));
              }}
            ></canvas>
            <div class="waveformCenterLine"></div>
          </div>
          <div class="waveformZoomBtns">
            <button
              class="waveformZoomBtn"
              onclick={waveformZoomIn}
              disabled={player.waveformZoom <= WAVEFORM_ZOOM_MIN}
              title="拡大 (Shift+I)">拡大</button
            >
            <span class="waveformZoomLabel">{player.waveformZoom.toFixed(1)}s</span>
            <button
              class="waveformZoomBtn"
              onclick={waveformZoomOut}
              disabled={player.waveformZoom >= WAVEFORM_ZOOM_MAX}
              title="縮小 (Shift+K)">縮小</button
            >
          </div>
        {/if}
      </div>
    {/if}

    <!-- Footer controls bar -->
    <div class="footerBar">
      <div class="footerSlider">
        <input
          type="range"
          class="sliderInput"
          min="0"
          max={player.audioDuration || 100}
          step="0.01"
          value={tt.displayTime}
          disabled={!player.audioDuration || player.audioDuration <= 0}
          style="--pct: {(
            (tt.displayTime / (player.audioDuration || 100)) *
            100
          ).toFixed(1)}%; --fill: #0076ff"
          oninput={(e) => playerSeek(parseFloat(e.currentTarget.value))}
          onkeydown={handleSliderKeydown}
        />
        <span class="sliderValue">{formatTime(tt.displayTime)}</span>
      </div>
      <div class="footerSlider">
        <input
          type="range"
          class="sliderInput"
          min="0.1"
          max="2.0"
          step="0.1"
          value={tt.playbackRate}
          style="--pct: {(((tt.playbackRate - 0.1) / 1.9) * 100).toFixed(
            1,
          )}%; --fill: #0076ff"
          oninput={(e) => {
            tt.playbackRate = parseFloat(e.currentTarget.value);
            playerSetRate(tt.playbackRate);
          }}
          onkeydown={handleSliderKeydown}
        />
        <span class="sliderValue">{tt.playbackRate.toFixed(1)}x</span>
      </div>
      <div class="footerSlider">
        <input
          type="range"
          class="sliderInput"
          min="0"
          max="100"
          step="1"
          value={$settings.volume}
          style="--pct: {$settings.volume}%; --fill: #0076ff"
          oninput={(e) =>
            updateSetting(
              "volume",
              +(e.currentTarget as HTMLInputElement).value,
            )}
          onkeydown={handleSliderKeydown}
        />
        <span class="sliderValue">{$settings.volume}</span>
      </div>
    </div>
  </div>

  <DragOverlay />
</div>

<SourceDialog />
<LatencyTestDialog />

<style>
  .container {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #0d0d0d;
    color: #eee;
    font-family: "Hiragino Sans", sans-serif;
    overflow: hidden;
    padding: 6px;
    gap: 6px;
    box-sizing: border-box;
  }

  /* === Top Panel === */
  .topPanel {
    flex: none;
    display: flex;
    background: transparent;
    gap: 6px;
    /* タブ切替時に高さが揺れないよう固定 (内側の settingsPanelContent でスクロール) */
    height: 40vh;
    min-height: 160px;
  }
  .videoArea {
    flex: 2 0 0;
    aspect-ratio: 16 / 9;
    background: #000;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    min-width: 0;
    border: 1px solid #2a2a2a;
  }
  .ytPlayer {
    width: 100%;
    height: 100%;
  }
  /* YT IFrame API replaces the div with an iframe that has no class — target by id */
  .videoArea :global(#yt-player) {
    width: 100%;
    height: 100%;
  }
  .videoPlayer {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .coverImage {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  /* 親 (videoArea) と TimeTagTab (空状態) の両方から参照されるため :global */
  :global {
    .videoPlaceholder {
      color: #666;
      font-size: 64px;
      user-select: none;
    }
    .videoPlaceholderBtn {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      box-sizing: border-box;
      width: 220px;
      height: 132px;
      background: none;
      border: 2px dashed #444;
      border-radius: 12px;
      padding: 0;
      cursor: pointer;
      transition:
        border-color 0.2s,
        color 0.2s;
      font-family: inherit;
      font-size: 16px;
      line-height: 1;
    }
    .videoPlaceholderBtn .icon {
      display: block;
      width: 48px;
      height: 48px;
      min-width: 48px;
      min-height: 48px;
    }
    .videoPlaceholderBtn span {
      font-size: 16px;
      line-height: 1;
      white-space: nowrap;
    }
    .videoPlaceholderBtn:hover {
      border-color: #888;
      color: #aaa;
    }
  /* settings panel + bottom panel まで :global 継続 (子コンポーネントから参照) */
  .settingsPanel {
    flex: 1 0 0;
    width: auto;
    background: #1e1e1e;
    border: 1px solid #2a2a2a;
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    container-type: inline-size;
    container-name: settingspanel;
  }
  .settingsPanelContent {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: #444 transparent;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px 10px 8px;
  }
  /* SubmitForm 関連 (.ytIdRow/.settingsRow/.loadYtBtn) は ./_components/SubmitForm.svelte に移動済み */
  /* .settingsLabel/.titleInput は dead CSS のため削除 */
  .sliderRow {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .sliderLabel {
    font-size: 11px;
    min-width: 24px;
    flex-shrink: 0;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .sliderInput {
    flex: 1;
    min-width: 0;
    -webkit-appearance: none;
    appearance: none;
    height: 3px;
    border-radius: 2px;
    background: linear-gradient(
      to right,
      var(--fill, #4a9eff) 0%,
      var(--fill, #4a9eff) var(--pct, 0%),
      #2e2e2e var(--pct, 0%),
      #2e2e2e 100%
    );
    outline: none;
    cursor: pointer;
    border: none;
  }
  .sliderInput::-webkit-slider-runnable-track {
    height: 3px;
    border-radius: 2px;
  }
  .sliderInput::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 12px;
    height: 12px;
    margin-top: -4.5px;
    border-radius: 50%;
    background: #ccc;
    cursor: pointer;
    transition:
      background 0.15s,
      transform 0.1s;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
  }
  .sliderInput:hover::-webkit-slider-thumb {
    background: #fff;
    transform: scale(1.2);
  }
  .sliderInput::-moz-range-track {
    height: 3px;
    border-radius: 2px;
    background: #2e2e2e;
    border: none;
  }
  .sliderInput::-moz-range-progress {
    height: 3px;
    border-radius: 2px;
    background: var(--fill, #4a9eff);
  }
  .sliderInput::-moz-range-thumb {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #ccc;
    cursor: pointer;
    border: none;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
  }
  /* disabled 時 (メディア未ロード時) は禁止マーク */
  .sliderInput:disabled {
    cursor: not-allowed !important;
    opacity: 0.4;
  }
  .sliderInput:disabled::-webkit-slider-thumb {
    cursor: not-allowed !important;
  }
  .sliderInput:disabled::-moz-range-thumb {
    cursor: not-allowed !important;
  }
  /* 親要素にも禁止カーソルを設定 (disabled な input は pointer-events で
     カーソルを子から取りに行かない場合があるため、親で確実に表示する) */
  .footerSlider:has(.sliderInput:disabled) {
    cursor: not-allowed;
  }
  .sliderValue {
    font-size: 11px;
    font-family: monospace;
    min-width: 19px;
    text-align: right;
    flex-shrink: 0;
  }

  /* === Bottom Panel === */
  .bottomPanel {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-radius: 8px;
    border: 1px solid #2a2a2a;
  }

  .bottomFixed {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .waveformFooter {
    height: 72px;
    background: #0e0e0e;
    border: 1px solid #282828;
    border-bottom: none;
    border-radius: 8px 8px 0 0;
    display: flex;
    align-items: stretch;
    overflow: hidden;
  }

  .waveformCanvasWrap {
    flex: 1;
    position: relative;
    overflow: hidden;
  }

  .waveformCanvasLarge {
    display: block;
    width: 100%;
    height: 100%;
    cursor: crosshair;
  }

  .waveformCenterLine {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 50%;
    width: 2px;
    background: rgba(255, 255, 255, 0.2);
    pointer-events: none;
  }

  .waveformZoomBtns {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 4px;
    justify-content: center;
    align-items: center;
  }

  .waveformZoomBtn {
    background: #1e1e1e;
    border: 1px solid #333;
    border-radius: 4px;
    color: #aaa;
    font-size: 11px;
    padding: 2px 6px;
    cursor: pointer;
    line-height: 1.4;
  }
  .waveformZoomBtn:hover:not(:disabled) {
    background: #2a2a2a;
    color: #ddd;
  }
  .waveformZoomBtn:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .waveformZoomLabel {
    font-size: 10px;
    line-height: 1;
  }

  .waveformProgress {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 12px;
  }

  .waveformProgressBar {
    width: 100%;
    height: 4px;
    background: #222;
    border-radius: 2px;
    overflow: hidden;
  }

  .waveformProgressFill {
    height: 100%;
    background: #3a7abf;
    transition: width 0.1s linear;
  }

  .waveformProgressLabel {
    font-size: 11px;
    color: #666;
  }

  .footerBar {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 0;
    padding: 7px 14px;
    background: #141414;
    border: 1px solid #282828;
    border-radius: 0 0 8px 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
  }

  .bottomFixed:not(:has(.waveformFooter)) .footerBar {
    border-radius: 8px;
  }

  .footerSlider {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    padding: 0 14px;
    position: relative;
  }
  .footerSlider:nth-child(1) {
    flex: 2;
  }
  .footerSlider:nth-child(2) {
    flex: 0.5;
  }
  .footerSlider:nth-child(3) {
    flex: 0.5;
  }
  .footerSlider + .footerSlider {
    border-left: 1px solid #fff;
  }
  .footerSlider:first-child {
    padding-left: 0;
  }
  .footerSlider:last-child {
    padding-right: 0;
  }

  /* .hiddenInput / .folderButton は ./_components/SubmitForm.svelte に移動済み */
  /* .icon は多数のコンポーネントで使うため :global で残す (下で定義) */
  :global(.icon) {
    width: 16px;
    height: 16px;
    vertical-align: middle;
    flex-shrink: 0;
  }

  /* === Bottom panel related styles (continue :global) === */
  .status {
    color: #aaa;
    font-size: 14px;
  }

  /* ReplTab 関連 CSS (.mainGrid/.column/.editor/.previewContainer/.floatBtn 系/.diff* 系/.missing* 系/.pe* 系/.badge* 系/.section* 系/.openFolderPrompt/.successMsg 等) は ./_components/ReplTab.svelte に移動済み */

  /* === Tab Bar === */
  .tabBar {
    display: flex;
    gap: 2px;
    align-items: stretch;
    min-height: 38px;
    background: #141414;
    border-bottom: 1px solid #2a2a2a;
    padding: 0 6px;
    /* 狭幅でもタブ/ボタンを折り返さず、溢れる場合は横スクロール */
    overflow-x: auto;
  }
  .tabBtn {
    background: transparent;
    color: #888;
    border: none;
    border-bottom: 2px solid transparent;
    padding: 9px 18px;
    cursor: pointer;
    font: inherit;
    font-size: 13px;
    font-weight: 500;
    letter-spacing: 0.02em;
    /* ウィンドウを狭めてもテキストを 1 行に保つ */
    white-space: nowrap;
    flex-shrink: 0;
    transition:
      color 0.15s ease,
      border-color 0.15s ease,
      background 0.15s ease;
    position: relative;
  }
  .tabBtn:hover {
    color: #ddd;
    background: rgba(255, 255, 255, 0.03);
  }
  .tabBtn.active {
    color: #fff;
    border-bottom-color: #4a9eff;
    background: linear-gradient(
      to top,
      rgba(74, 158, 255, 0.07) 0%,
      transparent 100%
    );
  }
  /* .shortcutHelpBtn は ./_components/TimeTagTab.svelte に移動済み */
  /* フォルダを開く / 歌詞データを保存 ボタン (tabBar 右端) */
  .ioGroup {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 0 4px 8px;
    border-left: 1px solid #2a2a2a;
    flex-shrink: 0;
  }
  /* 旧 SubmitForm の .folderButton と同じデザイン (accent ベタ塗り) */
  .ioBtn {
    background: #0070f3;
    color: white;
    border: none;
    border-radius: 4px;
    height: 28px;
    padding: 0 12px;
    font: inherit;
    font-size: 12px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    transition: background 0.12s ease;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .ioBtn svg {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
  }
  .ioBtn:hover {
    background: #0051a2;
  }
  .hiddenInput {
    display: none;
  }
  /* 設定パネルタブ */
  .settingsTabs {
    display: flex;
    gap: 0;
    border-bottom: 1px solid #333;
    flex-shrink: 0;
  }
  .settingsTabBtn {
    flex: 1;
    padding: 4px 0;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: #888;
    font-size: 0.75rem;
    cursor: pointer;
    transition:
      color 0.15s,
      border-color 0.15s;
  }
  .settingsTabBtn:hover {
    color: #ccc;
  }
  .settingsTabBtn.active {
    color: #ddd;
    border-bottom-color: #4a9eff;
  }

  /* ツールパネル系 (.toolsPanel/.toolItem/.toolName/.toolBtn 等) は ./_components/ToolsTab.svelte に移動済み */
  .settingsSectionLabel {
    color: #888;
    font-size: 12px;
    padding: 8px 0 2px 0;
    border-top: 1px solid #333;
    margin-top: 4px;
  }
  /* 投稿フォーム関連 (.submitField/.submitHint/.submitPanelBtn/.submitLabel/.autoFillStatus/
     .submitRow/.tagInputArea/.tagInlineInput/.tagBadge/.tagRemove/.presetTags/.tagSuggestBadge)
     は ./_components/SubmitForm.svelte に移動済み */

  /* === Time Tag Editor の主要 class は ./_components/TimeTagTab.svelte に移動済み ===
     .ttContainer / .ttEmptyContainer / .ttToolbar / .ttControls / .ttInfo / .ttInfoSep
     .ttEditorArea / .ttLine* / .ttChar* / .ttRuby* / .ttCheck* / .ttEndCheck* など */

  /* :global: 子コンポーネントから共通で参照される .ttBtn (汎用ボタン) */
  :global(.ttBtn) {
    background: #333;
    color: #ddd;
    border: 1px solid #555;
    border-radius: 4px;
    padding: 4px 10px;
    cursor: pointer;
    font: inherit;
    font-size: 13px;
  }
  :global(.ttBtn:hover) {
    background: #444;
  }
  :global(.ttBtn.active) {
    background: #1a6b2a;
    border-color: #2a8b4a;
    color: #fff;
  }
  .ttSpeed {
    color: #8cf;
    font-size: 13px;
    margin-left: 8px;
  }
  /* .ttInfo / .ttInfoSep は TimeTagTab に移動済み */
  .waveformCanvas {
    flex: 1;
    min-width: 0;
    height: 32px;
    cursor: pointer;
    border-radius: 3px;
    display: block;
  }
  .ttModeBtn {
    min-width: 140px;
    text-align: left;
  }

  /* Dropdown */
  .ttDropdown {
    position: relative;
  }
  .ttDropdownMenu {
    position: absolute;
    top: 100%;
    left: 0;
    background: #2a2a2a;
    border: 1px solid #555;
    border-radius: 4px;
    z-index: 100;
    min-width: 180px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  }
  .ttDropdownMenu button {
    display: block;
    width: 100%;
    background: none;
    color: #ddd;
    border: none;
    padding: 8px 16px;
    text-align: left;
    cursor: pointer;
    font: inherit;
    font-size: 13px;
  }
  .ttDropdownMenu button:hover {
    background: #444;
  }

  /* TT Editor Area / Char / Ruby / Check 系は ./_components/TimeTagTab.svelte に移動済み */

  /* LRC Editor */
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
  }
  .lrcFindOpt.active {
    background: #2a3a4a;
    border-color: #4a7aaa;
    color: #8af;
  }
  .lrcFindCount {
    font-size: 12px;
    color: #666;
    min-width: 24px;
    text-align: center;
  }
  .lrcFindBtn {
    background: #222;
    border: 1px solid #333;
    color: #ccc;
    cursor: pointer;
    padding: 3px 8px;
    font-size: 12px;
  }
  .lrcFindBtn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
  .lrcFindBtn:not(:disabled):hover {
    background: #333;
  }

  /* Text Editor Mode */
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

  /* Bottom bar */
  .ttBottomBar {
    display: flex;
    justify-content: flex-end;
    padding: 8px 16px;
    background: #1a1a1a;
    border-top: 1px solid #333;
    flex-shrink: 0;
  }
  /* 子コンポーネント (LrcTab / ReplTab / TimeTagTab) から参照するため :global */
  :global(.ttExportBtn) {
    background: #2a7a2a !important;
    color: white !important;
    padding: 6px 8px !important;
    min-width: 128px !important;
    width: auto !important;
    text-align: center;
    box-sizing: border-box !important;
  }
  :global(.ttExportBtn:hover) {
    background: #1e5e1e !important;
  }

  /* Overlay / Shortcuts */
  .ttOverlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 500;
  }
  .ttShortcutPanel {
    background: #222;
    border: 1px solid #555;
    border-radius: 8px;
    padding: 24px;
    max-width: 600px;
    width: 90%;
  }
  .ttShortcutPanel h3 {
    margin: 0 0 16px;
    font-size: 16px;
  }
  .ttShortcutGrid {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 16px;
    margin-bottom: 16px;
  }
  .ttShortcutSection h4 {
    margin: 0 0 8px;
    font-size: 13px;
    color: #8cf;
  }
  .ttShortcutSection div {
    font-size: 12px;
    color: #bbb;
    padding: 2px 0;
  }
  kbd {
    background: #333;
    border: 1px solid #555;
    border-radius: 3px;
    padding: 1px 5px;
    font-family: monospace;
    font-size: 11px;
    color: #fff;
  }
  /* .source-dialog* は ./_components/SourceDialog.svelte に移動済み */
  /* .latency* は ./_components/LatencyTestDialog.svelte に移動済み */
  /* === Ruby Edit Popup === */
  .ttRubyEditOverlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }
  .ttRubyEditPopup {
    background: #2a2a2a;
    border: 1px solid #555;
    border-radius: 8px;
    padding: 16px 20px;
    min-width: 250px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
  }
  .ttRubyEditTitle {
    font-size: 24px;
    font-weight: bold;
    text-align: center;
    margin-bottom: 12px;
    color: #fff;
  }
  .ttRubyEditRow {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 4px;
  }
  .ttRubyEditKeyInput,
  .ttRubyEditInput {
    padding: 8px;
    font-size: 16px;
    background: #1a1a1a;
    color: #fff;
    border: 1px solid #666;
    border-radius: 4px;
    outline: none;
    box-sizing: border-box;
  }
  .ttRubyEditKeyInput {
    flex: 2 1 0;
    min-width: 0;
    text-align: center;
  }
  .ttRubyEditInput {
    flex: 3 1 0;
    min-width: 0;
  }
  .ttRubyEditKeyInput:focus,
  .ttRubyEditInput:focus {
    border-color: #0070f3;
  }
  .ttRubyEditArrow {
    color: #888;
    font-size: 18px;
  }
  .ttRubyEditHint {
    font-size: 11px;
    color: #888;
    text-align: center;
    margin-top: 8px;
  }
  } /* end :global */
</style>
