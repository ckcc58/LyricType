/*
    ChartGameクラスを返して、start()やend()などのプレイ関連のⅧを入れていきたい
*/

import { volume, imageURL, media } from "../store.ts";
import { tick } from "svelte";
import { Tick } from "./tick.ts";
import { writable, get } from "svelte/store";

export type MatchChunk = {
  status: "text" | "reading";
  len: number;
  committed?: boolean;
};

type MediaSource = {
  type: "audio" | "video" | "youtube";
  label: string;
  url?: string;
  videoId?: string;
};

type Chart = {
  title: string;
  imageURL: string;
  media: { url: string; type: string; videoId?: string };
  availableSources: MediaSource[];
  lyric: {
    time: number;
    endTime: number;
    line: number;
    phrase: string;
    segments: {
      text: string;
      reading: string;
      normalizedText: string;
      normalizedReading: string;
      explicit: boolean;
    }[];
    matchRegExp: RegExp;
    charGroups: { count: number; startTime: number; endTime?: number }[];
  }[];
};

// Helper to merge adjacent chunks with same status/committed state
const mergeChunks = (chunks: MatchChunk[]) => {
  if (chunks.length === 0) return [];
  const merged: MatchChunk[] = [];
  let current = { ...chunks[0] };

  for (let i = 1; i < chunks.length; i++) {
    const next = chunks[i];
    if (
      current.status === next.status &&
      current.committed === next.committed
    ) {
      current.len += next.len;
    } else {
      merged.push(current);
      current = { ...next };
    }
  }
  merged.push(current);
  return merged;
};

class LyricStatus {
  lyric: Chart["lyric"];
  activeLrcs: { line: number; phrases: string[] }[];
  finishedLines: number[];
  unClearLrcs: Chart["lyric"][number][];
  phraseCount: number;
  concurrentGroups: Map<number, number[]>;
  lineTimes: Map<number, { start: number; end: number }>;
  notes: number = 0;
  lastClearedItem: Chart["lyric"][number] | null = null;
  needsUpdate: boolean = false;

  perfectCount: number = 0;
  totalPhrases: number = 0;

  // Typing speed tracking
  totalTypedChars: number = 0;
  activeLyricsTime: number = 0; // 入力可能な歌詞がある間の累計時間
  lastTickTime: number = -1; // 前フレームの再生時間

  // SegmentStatuses is now an array of Chunk Arrays.
  // Index i corresponds to segment i. Value is MatchChunk[] representing matched parts.
  clearedStatus: Map<Chart["lyric"][number], MatchChunk[][]>;
  previewMatches: Map<Chart["lyric"][number], MatchChunk[][]>;

  constructor(lyric: Chart["lyric"]) {
    this.lyric = lyric;
    this.activeLrcs = [];
    this.finishedLines = [];
    this.unClearLrcs = []; // Initially populated by tick
    this.phraseCount = 0;
    this.concurrentGroups = new Map();
    this.lineTimes = new Map();
    this.clearedStatus = new Map();
    this.previewMatches = new Map();
    this.totalPhrases = lyric.filter((p) =>
      p.segments.some((s) => s.normalizedText.length > 0),
    ).length;
  }
}

export class YTMediaProxy {
  private player: YT.Player;
  private _ended = false;

  constructor(player: YT.Player) {
    this.player = player;
    player.addEventListener("onStateChange", (e: any) => {
      this._ended = e.data === 0; // YT.PlayerState.ENDED
    });
  }

  get currentTime() {
    return this.player.getCurrentTime();
  }
  set currentTime(t: number) {
    this.player.seekTo(t, true);
  }
  get duration() {
    return this.player.getDuration();
  }
  get ended() {
    return this._ended;
  }
  get paused() {
    return this.player.getPlayerState() === 2;
  }
  get volume() {
    return this.player.getVolume() / 100;
  }
  set volume(v: number) {
    this.player.setVolume(v * 100);
  }
  play() {
    this.player.playVideo();
  }
  pause() {
    this.player.pauseVideo();
  }
  removeAttribute(_: string) {}
  load() {}
}

export class ChartGame {
  static audio: HTMLMediaElement | YTMediaProxy | null;
  static lrcStatus: LyricStatus;
  static chart: Chart;
  static stopped: boolean = false;
  static seekGuard: boolean = false; // YouTube seekTo(0) 完了まで audioTime を 0 に強制するフラグ

  // Score system (10000点満点、earnedBaseScore / maxBaseScore × 10000)
  static score = writable(0);
  static duration = writable(0);
  static currentTime = writable(0);

  // Clear rate tracking (based on old 10000 max score system)
  static maxBaseScore = writable(0); // Max possible base score (totalNotes * BASE_SCORE)
  static earnedBaseScore = writable(0); // Base score earned (without multipliers)

  // Phrase stats
  static perfectCount = writable(0);
  static readingMatchCount = writable(0);
  static lostCount = writable(0);
  static totalPhrases = writable(0);

  // Typing speed (chars/min, text-equivalent)
  static typingSpeed = writable(0);

  // キー統計 (composite key → count)
  static keyCounts = writable<Record<string, number>>({});

  // リプレイログ (plain arrays)
  static keyEventLog: { t_ms: number; code: string; shift: boolean; ctrl: boolean; alt: boolean; meta: boolean; ime: boolean; repeat: boolean }[] = [];
  static commitEventLog: { t_ms: number; phrase_index: number; chunks: MatchChunk[][]; is_cleared: boolean; is_perfect: boolean }[] = [];
  static phraseResultLog: { t_ms: number; phrase_index: number; chunks: { status: 'text' | 'reading'; len: number }[][]; is_cleared: boolean; is_perfect: boolean; score: number; typing_speed: number }[] = [];

  // リプレイ再生用ステート
  static replayMode = writable(false);
  static replayUsername = writable<string | null>(null);
  static replayFinalScore = writable<number>(0);
  static replayKeyDisplayLog = writable<{ t_ms: number; code: string; ime: boolean; repeat: boolean }[]>([]);
  static disallowInputWhenPaused = false;
  static disallowRewind = false;
  private static replayKeyEvents: { t_ms: number; code: string; shift: boolean; ctrl: boolean; alt: boolean; meta: boolean; ime: boolean; repeat?: boolean }[] = [];
  private static replayCommitEvents: { t_ms: number; phrase_index: number; chunks: MatchChunk[][]; is_cleared: boolean; is_perfect: boolean }[] = [];
  private static replayPhraseResults: { t_ms: number; phrase_index: number; chunks: { status: 'text' | 'reading'; len: number }[][]; is_cleared: boolean; is_perfect: boolean; score?: number; typing_speed?: number }[] = [];
  private static replayKeyEventCursor = 0;
  private static replayCommitEventCursor = 0;
  private static replayPhraseResultCursor = 0;
  private static readonly REPLAY_KEY_DISPLAY_MAX = 30;

  // O(1) フレーズインデックス参照
  static lyricIndexMap = new Map<Chart["lyric"][number], number>();

  // Chart title for result display
  static chartTitle = writable("");

  // 入力可能かどうか（未クリアの歌詞があるか）
  static inputEnabled = writable(false);

  // Game phase: 'idle' | 'waiting' | 'playing' | 'grace' | 'result'
  // 'idle' は stop() 後にオーバーレイを隠すための状態（GameOverlay の hidden 判定で使用）
  static gamePhase = writable<"idle" | "waiting" | "playing" | "grace" | "result">(
    "waiting",
  );
  static graceProgress = writable(0); // 0〜1 猶予期間の進行度
  static readonly GRACE_DURATION = 5; // 猶予秒数
  private static graceStartTime: number = 0;

  // Base score per character
  static readonly BASE_SCORE = 100;

  // Rendered Lyrics Store
  static renderedLyrics = writable<
    {
      line: number;
      items: {
        data: Chart["lyric"][number];
        isCleared: boolean;
        segmentStatuses: MatchChunk[][];
      }[];
      isPreview: boolean;
      isFinished: boolean;
    }[]
  >([]);

  // Next lines preview store
  static nextLines = writable<
    {
      line: number;
      text: string;
      startTime: number;
    }[]
  >([]);

  // --- 仮想時刻 (リプレイシーク時の早送り tick で使用) ---
  private static virtualMode = false;
  private static virtualAudioTimeSec = 0;
  private static virtualAudioEnded = false;
  private static virtualReplayTimeMs = 0;

  private static getCurrentTimeSec(): number {
    return this.virtualMode ? this.virtualAudioTimeSec : (this.audio?.currentTime ?? 0);
  }
  private static getAudioEnded(): boolean {
    return this.virtualMode ? this.virtualAudioEnded : (this.audio?.ended ?? false);
  }

  // 現在の論理再生時刻 (秒)。grace 中は audio.duration + grace 経過秒を返す。
  // シーク UI の起点計算で利用する。
  static getCurrentLogicalSec(): number {
    if (!this.audio) return 0;
    if (this.audio.ended && this.graceStartTime > 0) {
      const dur = this.audio.duration || 0;
      const graceSec = Math.max(0, (performance.now() - this.graceStartTime) / 1000);
      return dur + graceSec;
    }
    return this.audio.currentTime;
  }

  // 採点イベント・キーイベントで使う論理時刻 (ms)。
  // 通常プレイ中: audio.currentTime * 1000
  // grace 中: audio.duration * 1000 + grace 開始からの経過時間
  // grace 中は audio.currentTime が duration で凍結するため、grace 中の入力を別 t_ms に分離する。
  private static getReplayTimeMs(): number {
    if (this.virtualMode) return this.virtualReplayTimeMs;
    if (!this.audio) return 0;
    const audioMs = Math.round(this.audio.currentTime * 1000);
    if (this.audio.ended && this.graceStartTime > 0) {
      const graceMs = Math.round(performance.now() - this.graceStartTime);
      const durMs = Math.round((this.audio.duration || 0) * 1000);
      return durMs + Math.max(0, graceMs);
    }
    return audioMs;
  }

  // 空白フレーズ判定（打鍵対象の文字がないフレーズ）
  static isEmptyPhrase(index: number): boolean {
    const item = this.chart?.lyric[index];
    if (!item) return false;
    return item.segments.every((s) => s.normalizedText.length === 0);
  }

  // 非打鍵フレーズ（記号のみ等）が表示上 cleared 扱いになるかを判定する。
  // 同じ行内で隣接する打鍵可能フレーズが完了した瞬間に true になる。
  // 同行に打鍵可能フレーズが存在しない場合は、再生時刻が当該フレーズの endTime を過ぎたら true。
  private static isNonTypablePhraseCleared(
    index: number,
    audioTime: number,
  ): boolean {
    if (!this.chart || !this.lrcStatus) return false;
    const item = this.chart.lyric[index];
    if (!item || audioTime < item.time) return false;

    const status = this.lrcStatus;
    const line = item.line;
    const isTypableCleared = (i: number) => {
      const ph = this.chart!.lyric[i];
      return !status.unClearLrcs.includes(ph) && ph.time <= audioTime;
    };

    for (let i = index - 1; i >= 0; i--) {
      const p = this.chart.lyric[i];
      if (p.line !== line) break;
      if (!this.isEmptyPhrase(i)) return isTypableCleared(i);
    }
    for (let i = index + 1; i < this.chart.lyric.length; i++) {
      const p = this.chart.lyric[i];
      if (p.line !== line) break;
      if (!this.isEmptyPhrase(i)) return isTypableCleared(i);
    }
    return audioTime >= item.endTime;
  }

  static stop() {
    this.stopped = true;

    if (this.audio) {
      this.audio.pause();
      if (this.audio instanceof HTMLAudioElement) {
        this.audio.removeAttribute("src");
        this.audio.load();
      }
      this.audio = null;
    }

    // イベントリスナー解除
    document.removeEventListener('keydown', this.replayKeydownHandler);
    const input = document.getElementById("text-input");
    if (input) {
      input.removeEventListener("input", this.inputHandler as EventListener);
      input.removeEventListener(
        "keydown",
        this.keydownHandler as EventListener,
      );
      input.removeEventListener(
        "compositionend",
        this.compositionHandler as EventListener,
      );
      input.removeEventListener("click", this.clickHandler as EventListener);
    }

    // ObjectURL解放
    if (this.chart?.imageURL) URL.revokeObjectURL(this.chart.imageURL);
    if (this.chart?.media?.url) URL.revokeObjectURL(this.chart.media.url);

    // Store リセット
    imageURL.update(() => "");
    media.update(() => {
      return { url: "", type: "" };
    });

    // リプレイ状態のクリア
    this.replayMode.set(false);
    this.replayUsername.set(null);
    this.replayFinalScore.set(0);
    this.replayKeyEvents = [];
    this.replayCommitEvents = [];
    this.replayPhraseResults = [];

    this.gamePhase.set("idle");
  }

  static init() {
    document.title = "LyricType";
    this.score.set(0);
    this.maxBaseScore.set(0);
    this.earnedBaseScore.set(0);
    this.perfectCount.set(0);
    this.readingMatchCount.set(0);
    this.lostCount.set(0);
    this.totalPhrases.set(0);
    this.typingSpeed.set(0);
    this.keyCounts.set({});
    this.keyEventLog = [];
    this.commitEventLog = [];
    this.phraseResultLog = [];
    this.replayKeyDisplayLog.set([]);
    this.replayKeyEventCursor = 0;
    this.replayCommitEventCursor = 0;
    this.replayPhraseResultCursor = 0;
    this.chartTitle.set("");
    this.inputEnabled.set(false);
    this.graceProgress.set(0);
    this.graceStartTime = 0;
    this.renderedLyrics.set([]);
    this.nextLines.set([]);
  }

  // lyricStatus の lineTimes / concurrentGroups / notes を chart.lyric から再構築する。
  // load() 初回と seekReplay() の状態リセットの両方で呼ばれる。
  private static _rebuildLyricStatusMeta() {
    if (!this.chart || !this.lrcStatus) return;
    const status = this.lrcStatus;
    const lineTimes = status.lineTimes;
    lineTimes.clear();
    status.concurrentGroups.clear();

    this.chart.lyric.forEach((note) => {
      if (!lineTimes.has(note.line)) {
        lineTimes.set(note.line, { start: note.time, end: note.endTime });
      } else {
        const times = lineTimes.get(note.line)!;
        times.end = Math.max(times.end, note.endTime);
        times.start = Math.min(times.start, note.time);
      }
    });

    lineTimes.forEach((timesA, lineA) => {
      const group: number[] = [];
      lineTimes.forEach((timesB, lineB) => {
        if (lineA === lineB) return;
        if (Math.abs(timesB.start - timesA.start) <= 1.0) {
          group.push(lineB);
        }
      });
      if (group.length > 0) {
        status.concurrentGroups.set(lineA, group);
      }
    });

    status.notes = this.chart.lyric.reduce(
      (acc, e) =>
        acc +
        e.segments.reduce((sAcc, seg) => sAcc + seg.normalizedText.length, 0),
      0,
    );
  }

  private static updateNextLinesPreview(status: LyricStatus) {
    if (!this.chart) return;

    const activeLineSet = new Set(status.activeLrcs.map((l) => l.line));
    const finishedSet = new Set(status.finishedLines);
    const nextLineSet = new Set<number>();

    for (let i = status.phraseCount; i < this.chart.lyric.length; i++) {
      const ln = this.chart.lyric[i].line;
      if (!activeLineSet.has(ln) && !finishedSet.has(ln)) {
        nextLineSet.add(ln);
        status.concurrentGroups.get(ln)?.forEach((cl) => {
          if (!activeLineSet.has(cl) && !finishedSet.has(cl))
            nextLineSet.add(cl);
        });
        break;
      }
    }

    const nextLinesData = [...nextLineSet]
      .map((ln) => {
        const phrases = this.chart!.lyric.filter((l) => l.line === ln);
        return {
          line: ln,
          text: phrases
            .map((p) => p.segments.map((s) => s.text).join(""))
            .join(""),
          startTime:
            status.lineTimes.get(ln)?.start ?? phrases[0]?.time ?? 0,
        };
      })
      .sort((a, b) => a.line - b.line);

    this.nextLines.set(nextLinesData);
  }

  static async load(parsedChart: Chart) {
    this.chart = parsedChart;
    this.lrcStatus = new LyricStatus(this.chart.lyric);

    this.lyricIndexMap.clear();
    this.chart.lyric.forEach((item, idx) => {
      this.lyricIndexMap.set(item, idx);
    });

    this._rebuildLyricStatusMeta();
    const status = this.lrcStatus;

    this.init();
    this.updateNextLinesPreview(status);

    // Set max base score for clear rate calculation
    this.maxBaseScore.set(status.notes * this.BASE_SCORE);
    this.totalPhrases.set(status.totalPhrases);

    document.title = this.chart.title + " - LyricType";
    this.chartTitle.set(this.chart.title);
    imageURL.update(() => this.chart.imageURL);
    media.update(() => this.chart.media);

    await tick();

    this.seekGuard = true;
    this.stopped = false;
    this.gamePhase.set("waiting");
  }

  static async start() {
    if (!this.chart?.media?.url && this.chart?.media?.type !== "youtube")
      return;

    // 既に playing 状態なら二重起動を防ぐ (tick ループが多重生成されないように)
    if (get(this.gamePhase) === "playing") return;

    this.gamePhase.set("playing");
    await tick();

    const input = document.getElementById("text-input");
    input?.focus();

    if (this.chart.media.type === "youtube") {
      const player = (window as any).__ytPlayerGame as YT.Player;
      if (player) {
        this.audio = new YTMediaProxy(player);
      } else {
        return;
      }
    } else if (this.chart.media.type === "video") {
      const vid = document.querySelector(
        "#frame video",
      ) as HTMLVideoElement | null;
      if (vid) {
        this.audio = vid;
      } else {
        this.audio = new Audio(this.chart.media.url);
      }
    } else {
      this.audio = new Audio(this.chart.media.url);
    }
    volume.subscribe((v) => {
      if (this.audio) this.audio.volume = v / 100;
    });
    this.audio.play();

    this.tick();

    // リプレイ再生中はキー入力ハンドラを登録しない
    if (get(this.replayMode)) {
      document.addEventListener('keydown', this.replayKeydownHandler);
      return;
    }

    input?.addEventListener("input", this.inputHandler as EventListener);
    input?.addEventListener("keydown", this.keydownHandler as EventListener);
    input?.addEventListener(
      "compositionend",
      this.compositionHandler as EventListener,
    );
    input?.addEventListener("click", this.clickHandler as EventListener);
  }

  static compositionHandler = (e: CompositionEvent) => {
    if (!this.lrcStatus) return;

    const t_ms = this.getReplayTimeMs();
    this.keyCounts.update(m => ({ ...m, CompositionEnd: (m.CompositionEnd ?? 0) + 1 }));
    this.keyEventLog.push({ t_ms, code: 'CompositionEnd', shift: false, ctrl: false, alt: false, meta: false, ime: false, repeat: false });

    const input = e.target as HTMLInputElement;
    const value = input.value;
    const shouldImmediateScore = this.checkInput(value);
    if (shouldImmediateScore) {
      this.handleInput(value, input);
      input.value = "";
      input.blur();
      setTimeout(() => input.focus());
    }
  };

  static clickHandler = () => {
    if (!this.lrcStatus) return;
    const t_ms = this.getReplayTimeMs();
    this.keyCounts.update(m => ({ ...m, Click: (m.Click ?? 0) + 1 }));
    this.keyEventLog.push({ t_ms, code: 'Click', shift: false, ctrl: false, alt: false, meta: false, ime: false, repeat: false });
  };

  static inputHandler = (e: InputEvent) => {
    const input = e.target as HTMLInputElement;
    if (this.disallowInputWhenPaused && this.audio?.paused) {
      input.value = "";
      return;
    }
    if (this.lrcStatus && this.lrcStatus.unClearLrcs.length === 0) {
      const nextLinesList = get(this.nextLines);
      const audioTime = this.audio?.currentTime ?? 0;
      const nextStart = nextLinesList[0]?.startTime ?? Infinity;
      if (nextStart - audioTime > 0.1) {
        input.value = "";
        return;
      }
    }
    const value = input.value;

    // スペースが入力されたら即時採点
    if (value.includes(" ") || value.includes("　")) {
      const cleaned = value.replace(/[\s　]/g, "");
      if (cleaned) {
        this.handleInput(cleaned, input);
      }
      input.value = "";
      // IME変換の残穢をクリア
      input.blur();
      setTimeout(() => input.focus());
      return;
    }

    const shouldImmediateScore = this.checkInput(value);
    if (
      shouldImmediateScore &&
      !(
        /[0-9０-９a-zA-Zａ-ｚＡ-Ｚ]/.test(value) &&
        e.isComposing &&
        !this.inputEndsWithJapaneseTypable(value)
      )
    ) {
      this.handleInput(value, input);
      input.value = "";
      input.blur();
      setTimeout(() => input.focus());
    }
  };

  private static inputEndsWithJapaneseTypable(value: string): boolean {
    const typed = value.replace(/[^0-9０-９a-zA-Zａ-ｚＡ-Ｚぁ-んァ-ヶー々〆一-鿿～〜]/g, "");
    const last = Array.from(typed).at(-1) ?? "";
    return /[ぁ-んァ-ヶー々〆一-鿿～〜]/.test(last);
  }

  // Logic for granular matching
  // offset: existing matched length in THIS segment (for partial text consumption)
  static matchSegment(
    seg: Chart["lyric"][number]["segments"][number],
    input: string,
    offset: number = 0,
  ): { chunks: MatchChunk[]; remainingInput: string; matchedAll: boolean } {
    const strictText = seg.normalizedText;
    const looseReading = seg.normalizedReading;
    let currentInput = input;
    const chunks: MatchChunk[] = [];

    const toHalf = (s: string) =>
      s.replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) =>
        String.fromCharCode(c.charCodeAt(0) - 0xfee0),
      );

    if (
      strictText.length !== looseReading.length ||
      /[一-鿿]/.test(strictText)
    ) {
      if (offset > 0) {
        return { chunks, remainingInput: currentInput, matchedAll: true };
      }

      const normInput = toHalf(currentInput);
      const normStrict = toHalf(strictText);
      const normLoose = toHalf(looseReading);

      if (normInput.startsWith(normStrict)) {
        chunks.push({ status: "text", len: strictText.length });
        return {
          chunks,
          remainingInput: currentInput.slice(strictText.length),
          matchedAll: true,
        };
      } else if (normInput.startsWith(normLoose)) {
        chunks.push({ status: "reading", len: looseReading.length });
        return {
          chunks,
          remainingInput: currentInput.slice(looseReading.length),
          matchedAll: true,
        };
      } else {
        return { chunks, remainingInput: currentInput, matchedAll: false };
      }
    }

    let segIdx = offset;
    let matchedLen = offset;

    if (segIdx >= strictText.length) {
      return { chunks, remainingInput: currentInput, matchedAll: true };
    }

    const simplifyChar = (c: string) => {
      let s = toHalf(c).toLowerCase();
      if (s >= "\u30a1" && s <= "\u30f6") {
        s = String.fromCharCode(s.charCodeAt(0) - 0x60);
      }
      return s;
    };

    while (segIdx < strictText.length && currentInput.length > 0) {
      const tChar = strictText[segIdx];
      const rChar = looseReading[segIdx];
      const iChar = currentInput[0];

      let matchStatus: "text" | "reading" | null = null;

      if (iChar === tChar) {
        matchStatus = "text";
      } else if (toHalf(iChar) === toHalf(tChar)) {
        matchStatus = "text";
      } else if (iChar === rChar) {
        matchStatus = "reading";
      } else if (simplifyChar(iChar) === simplifyChar(tChar)) {
        matchStatus = "reading";
      }

      if (matchStatus) {
        chunks.push({ status: matchStatus, len: 1 });
        currentInput = currentInput.slice(1);
        segIdx++;
        matchedLen++;
      } else {
        break;
      }
    }

    const mergedChunks: MatchChunk[] = [];
    if (chunks.length > 0) {
      let current = { ...chunks[0] };
      for (let i = 1; i < chunks.length; i++) {
        if (chunks[i].status === current.status) {
          current.len += chunks[i].len;
        } else {
          mergedChunks.push(current);
          current = { ...chunks[i] };
        }
      }
      mergedChunks.push(current);
    }

    return {
      chunks: mergedChunks,
      remainingInput: currentInput,
      matchedAll: matchedLen === strictText.length,
    };
  }

  // 共通マッチング検索: 未クリア歌詞リストから入力に最もマッチするアイテムを見つける
  // 優先度: 完全一致 > マッチ文字数
  static findBestMatch(
    lrcItems: Chart["lyric"][number][],
    input: string,
    clearedStatus: Map<Chart["lyric"][number], MatchChunk[][]>,
    preferFullMatch: boolean,
  ): {
    index: number;
    matchedLen: number;
    segments: MatchChunk[][];
    isFullyMatched: boolean;
  } | null {
    type MatchCandidate = {
      index: number;
      matchedLen: number;
      segments: MatchChunk[][];
      isFullyMatched: boolean;
    };
    let best: MatchCandidate | null = null;

    for (let i = 0; i < lrcItems.length; i++) {
      const lrcItem = lrcItems[i];
      let tempInput = input;
      const itemChunks: MatchChunk[][] = [];
      let totalMatchedLen = 0;
      let partialFound = false;

      const existingProgress = clearedStatus.get(lrcItem) || [];

      for (let sIdx = 0; sIdx < lrcItem.segments.length; sIdx++) {
        const seg = lrcItem.segments[sIdx];
        const existingChunks = existingProgress[sIdx] || [];
        const offset = existingChunks.reduce((acc, c) => acc + c.len, 0);

        const { chunks, remainingInput, matchedAll } = this.matchSegment(
          seg,
          tempInput,
          offset,
        );

        if (chunks.length > 0) {
          itemChunks.push(chunks);
          const consumed = chunks.reduce((acc, c) => acc + c.len, 0);
          tempInput = remainingInput;
          totalMatchedLen += consumed;
          partialFound = true;
        } else {
          itemChunks.push([]);
        }

        if (!matchedAll) {
          break;
        }
      }

      if (partialFound) {
        const isFullyMatched = lrcItem.segments.every((seg, idx) => {
          const existingLen = (existingProgress[idx] || []).reduce(
            (a, c) => a + c.len,
            0,
          );
          const newLen = (itemChunks[idx] || []).reduce((a, c) => a + c.len, 0);
          const totalLen = existingLen + newLen;
          return (
            totalLen === seg.normalizedText.length ||
            totalLen === seg.normalizedReading.length
          );
        });

        const candidate: MatchCandidate = {
          index: i,
          matchedLen: totalMatchedLen,
          segments: itemChunks,
          isFullyMatched,
        };

        const isBetter = (prev: MatchCandidate): boolean => {
          if (preferFullMatch) {
            if (isFullyMatched && !prev.isFullyMatched) return true;
            if (!isFullyMatched && prev.isFullyMatched) return false;
          }
          return totalMatchedLen > prev.matchedLen;
        };

        if (!best || isBetter(best)) best = candidate;
      }
    }

    if (!best || best.matchedLen === 0) return null;
    return best;
  }

  static checkInput(inputVal: string): boolean {
    const unTypeReg = /[^0-9０-９a-zA-Zａ-ｚＡ-Ｚぁ-んァ-ヶー々〆一-鿿～〜]/g;
    const inputStr = inputVal.replace(unTypeReg, "");

    if (!this.lrcStatus) return false;
    const status = this.lrcStatus;

    const prevPreviewItems = new Set(status.previewMatches.keys());
    status.previewMatches.clear();

    if (!inputStr) {
      status.needsUpdate = true;
      if (this.audio && prevPreviewItems.size > 0) {
        const t_ms = this.getReplayTimeMs();
        for (const item of prevPreviewItems) {
          const cleared = status.clearedStatus.get(item) || [];
          const segCount = item.segments.length;
          const chunks: MatchChunk[][] = Array.from({ length: segCount }, (_, i) =>
            (cleared[i] || []).map(ch => ({ ...ch, committed: true }))
          );
          this.commitEventLog.push({
            t_ms, phrase_index: this.lyricIndexMap.get(item) ?? -1,
            chunks, is_cleared: false, is_perfect: false,
          });
        }
      }
      return false;
    }

    let currentInput = inputStr;
    const loopLimit = 100;
    let tempUnClearLrcs = [...status.unClearLrcs];
    let allMatchesAreTextPerfect = true;
    let hasAnyMatch = false;

    for (
      let attempts = 0;
      attempts < loopLimit && currentInput.length > 0;
      attempts++
    ) {
      const bestMatch = this.findBestMatch(
        tempUnClearLrcs,
        currentInput,
        status.clearedStatus,
        false,
      );

      if (bestMatch) {
        hasAnyMatch = true;
        const item = tempUnClearLrcs[bestMatch.index];
        status.previewMatches.set(item, bestMatch.segments);

        if (bestMatch.isFullyMatched) {
          tempUnClearLrcs.splice(bestMatch.index, 1);
        }

        const allText =
          bestMatch.isFullyMatched &&
          bestMatch.segments.every((chunks) =>
            chunks.every((c) => c.status === "text"),
          );
        if (!allText) allMatchesAreTextPerfect = false;

        currentInput = currentInput.slice(bestMatch.matchedLen);
      } else {
        break;
      }
    }

    status.needsUpdate = true;

    if (this.audio) {
      const t_ms = this.getReplayTimeMs();
      // previewMatches に入ったフレーズ: merged state を記録
      status.previewMatches.forEach((previewChunks, item) => {
        const cleared = status.clearedStatus.get(item) || [];
        const segCount = item.segments.length;
        const chunks: MatchChunk[][] = Array.from({ length: segCount }, (_, i) =>
          mergeChunks([
            ...(cleared[i] || []).map(ch => ({ ...ch, committed: true })),
            ...(previewChunks[i] || []).map(ch => ({ ...ch, committed: false })),
          ])
        );
        this.commitEventLog.push({
          t_ms, phrase_index: this.lyricIndexMap.get(item) ?? -1,
          chunks, is_cleared: false, is_perfect: false,
        });
      });
      // previewMatches から消えたフレーズ: BS で巻き戻し
      for (const item of prevPreviewItems) {
        if (!status.previewMatches.has(item)) {
          const cleared = status.clearedStatus.get(item) || [];
          const segCount = item.segments.length;
          const chunks: MatchChunk[][] = Array.from({ length: segCount }, (_, i) =>
            (cleared[i] || []).map(ch => ({ ...ch, committed: true }))
          );
          this.commitEventLog.push({
            t_ms, phrase_index: this.lyricIndexMap.get(item) ?? -1,
            chunks, is_cleared: false, is_perfect: false,
          });
        }
      }
    }

    return hasAnyMatch && allMatchesAreTextPerfect && currentInput.length === 0;
  }

  // 累積 chunks から segment ごとの baseScore を計算（合計）
  // reading 一致は text 文字数換算で 0.5 倍する → 必ず text 一致の半分以下になる
  private static computeBaseScoreFromChunks(
    item: Chart["lyric"][number],
    chunksPerSeg: { status: 'text' | 'reading'; len: number }[][]
  ): number {
    let sum = 0;
    for (let i = 0; i < chunksPerSeg.length; i++) {
      const segChunks = chunksPerSeg[i];
      const seg = item.segments[i];
      if (!seg) continue;
      for (const c of segChunks) {
        if (c.status === 'text') {
          sum += c.len * this.BASE_SCORE;
        } else if (c.status === 'reading') {
          // c.len は reading 文字数なので、text 換算 (text.len / reading.len) してから 0.5 倍
          const ratio = seg.normalizedReading.length > 0
            ? seg.normalizedText.length / seg.normalizedReading.length
            : 1;
          sum += c.len * ratio * this.BASE_SCORE * 0.5;
        }
      }
    }
    return sum;
  }

  // 累積 chunks から typing-speed 用の文字数を計算
  private static computeTypedCharsFromChunks(
    item: Chart["lyric"][number],
    chunksPerSeg: { status: 'text' | 'reading'; len: number }[][],
  ): number {
    let chars = 0;
    for (let segIdx = 0; segIdx < chunksPerSeg.length; segIdx++) {
      const segChunks = chunksPerSeg[segIdx];
      if (!segChunks || segChunks.length === 0) continue;
      const seg = item.segments[segIdx];
      if (!seg) continue;
      const is1to1 =
        seg.normalizedText.length === seg.normalizedReading.length &&
        !/[一-鿿]/.test(seg.text);
      if (is1to1) {
        chars += segChunks.reduce((a, c) => a + c.len, 0);
      } else {
        // 漢字を含むセグメント: 打鍵感に合わせ「読み文字数」でカウント
        chars += seg.normalizedReading.length;
      }
    }
    return chars;
  }

  // 採点結果を状態とストアに反映する（通常プレイ・リプレイ共用）
  // cumulativeChunks は採点後のフレーズ全体の状態（差分ではない）
  private static applyScoreEvent(
    item: Chart["lyric"][number],
    cumulativeChunks: MatchChunk[][],
    isCleared: boolean,
    isPerfect: boolean,
  ) {
    const status = this.lrcStatus;
    if (!status) return;

    const prev = status.clearedStatus.get(item) || [];
    const prevBaseScore = this.computeBaseScoreFromChunks(item, prev);
    const prevTypedChars = this.computeTypedCharsFromChunks(item, prev);

    const newBaseScore = this.computeBaseScoreFromChunks(item, cumulativeChunks);
    const newTypedChars = this.computeTypedCharsFromChunks(item, cumulativeChunks);

    const baseScoreDelta = newBaseScore - prevBaseScore;
    const typedCharsDelta = newTypedChars - prevTypedChars;

    status.clearedStatus.set(item, cumulativeChunks.map(segs => segs.map(ch => ({ ...ch }))));
    status.lastClearedItem = item;

    if (isCleared) {
      const idx = status.unClearLrcs.indexOf(item);
      if (idx !== -1) status.unClearLrcs.splice(idx, 1);
      if (isPerfect) {
        status.perfectCount++;
        this.perfectCount.set(status.perfectCount);
      } else {
        this.readingMatchCount.update((n) => n + 1);
      }
    }

    if (typedCharsDelta > 0) status.totalTypedChars += typedCharsDelta;
    if (baseScoreDelta !== 0) this.earnedBaseScore.update((n) => n + baseScoreDelta);

    const earned = get(this.earnedBaseScore);
    const max = get(this.maxBaseScore);
    this.score.set(max > 0 ? (earned / max) * 10000 : 0);
    status.needsUpdate = true;
  }

  // リプレイ用: phrase_results のスナップショットを直接適用する。
  // デルタ計算ではなく、保存された score / typing_speed をそのまま代入することで再現精度が高まり、
  // 将来のシーク機能でも決定的に同じ表示が得られる。
  private static applyReplayPhraseResult(
    item: Chart["lyric"][number],
    cumulativeChunks: { status: 'text' | 'reading'; len: number }[][],
    isCleared: boolean,
    isPerfect: boolean,
    snapshotScore: number | undefined,
    _snapshotSpeed: number | undefined,
  ) {
    const status = this.lrcStatus;
    if (!status) return;

    const prev = status.clearedStatus.get(item) || [];
    const prevTypedChars = this.computeTypedCharsFromChunks(item, prev);
    const newTypedChars = this.computeTypedCharsFromChunks(item, cumulativeChunks);
    const typedCharsDelta = newTypedChars - prevTypedChars;
    if (typedCharsDelta > 0) status.totalTypedChars += typedCharsDelta;

    status.clearedStatus.set(item, cumulativeChunks.map(segs => segs.map(ch => ({ status: ch.status, len: ch.len }))));
    status.lastClearedItem = item;

    if (isCleared) {
      const idx = status.unClearLrcs.indexOf(item);
      if (idx !== -1) status.unClearLrcs.splice(idx, 1);
      if (isPerfect) {
        status.perfectCount++;
        this.perfectCount.set(status.perfectCount);
      } else {
        this.readingMatchCount.update((n) => n + 1);
      }
    }

    if (snapshotScore !== undefined) this.score.set(snapshotScore);

    status.needsUpdate = true;
  }

  // commit_events の chunks（committed フラグあり）を表示状態に反映する（リプレイ専用）
  // clearedStatus は applyScoreEvent（phrase_results）が管理するため、ここでは previewMatches のみ更新する。
  // commit_events と phrase_results が同じ t_ms で記録されているため、ここで clearedStatus を上書きすると
  // 直後の applyScoreEvent で prev/new のデルタが 0 になりスコアが加算されない。
  private static applyCommitEvent(event: { phrase_index: number; chunks: MatchChunk[][]; is_cleared: boolean }) {
    const status = this.lrcStatus;
    if (!status || !this.chart) return;
    const item = this.chart.lyric[event.phrase_index];
    if (!item) return;

    const segCount = item.segments.length;
    const previewSegs: MatchChunk[][] = new Array(segCount).fill(null).map(() => [] as MatchChunk[]);

    for (let i = 0; i < segCount; i++) {
      const seg = event.chunks[i] || [];
      for (const ch of seg) {
        if (ch.committed === false) previewSegs[i].push({ status: ch.status, len: ch.len });
      }
    }

    const hasPreview = previewSegs.some(s => s.length > 0);
    if (hasPreview) {
      status.previewMatches.set(item, previewSegs);
    } else {
      status.previewMatches.delete(item);
    }
    status.needsUpdate = true;
  }

  static handleInput(inputVal: string, inputEl?: HTMLInputElement) {
    const unTypeReg = /[^0-9０-９a-zA-Zａ-ｚＡ-Ｚぁ-んァ-ヶー々〆一-鿿～〜]/g;
    const inputStr = inputVal.replace(unTypeReg, "");

    if (!this.lrcStatus) return;
    const status = this.lrcStatus;

    status.previewMatches.clear();

    if (!inputStr) return;

    let currentInput = inputStr;
    let anyMatch = false;
    const loopLimit = 100;

    for (
      let attempts = 0;
      attempts < loopLimit && currentInput.length > 0;
      attempts++
    ) {
      const bestMatch = this.findBestMatch(
        status.unClearLrcs,
        currentInput,
        status.clearedStatus,
        true,
      );

      if (bestMatch) {
        const item = status.unClearLrcs[bestMatch.index];
        const newChunks = bestMatch.segments;

        const existingProgress = status.clearedStatus.get(item) || [];
        const segCount = item.segments.length;
        const mergedForStatus: MatchChunk[][] = new Array(segCount)
          .fill(null)
          .map((_, idx) => {
            const old = existingProgress[idx] || [];
            const added = newChunks[idx] || [];
            return mergeChunks([...old, ...added]);
          });

        const isFullyCleared = item.segments.every((seg, idx) => {
          const chunks = mergedForStatus[idx];
          const len = chunks.reduce((a, c) => a + c.len, 0);
          return (
            len === seg.normalizedText.length ||
            len === seg.normalizedReading.length
          );
        });

        const isPerfect = mergedForStatus.every((chunks) =>
          chunks.every((c) => c.status === "text"),
        );

        const t_ms = this.getReplayTimeMs();
        const phraseIndex = this.lyricIndexMap.get(item) ?? -1;
        const chunksForLog = mergedForStatus.map(segs => segs.map(ch => ({ ...ch, committed: true })));
        this.commitEventLog.push({
          t_ms,
          phrase_index: phraseIndex,
          chunks: chunksForLog,
          is_cleared: isFullyCleared,
          is_perfect: isFullyCleared && isPerfect,
        });

        this.applyScoreEvent(item, mergedForStatus, isFullyCleared, isPerfect);

        // applyScoreEvent でスコアが更新された後にスナップショットを取得
        this.phraseResultLog.push({
          t_ms,
          phrase_index: phraseIndex,
          chunks: mergedForStatus.map(segs => segs.map(ch => ({ status: ch.status, len: ch.len }))),
          is_cleared: isFullyCleared,
          is_perfect: isFullyCleared && isPerfect,
          score: get(this.score),
          typing_speed: get(this.typingSpeed),
        });

        currentInput = currentInput.slice(bestMatch.matchedLen);
        anyMatch = true;
      } else {
        break;
      }
    }

    if (anyMatch && inputEl) {
      inputEl.value = "";
    }
    status.needsUpdate = true;
  }

  static showResult() {
    const status = this.lrcStatus;
    if (!status) return;
    if (status.unClearLrcs.length > 0) {
      this.lostCount.update((n) => n + status.unClearLrcs.length);
    }

    this.stopped = true;
    this.gamePhase.set("result");
  }

  static serializeReplayForSubmit() {
    const enc = (s: 'text' | 'reading'): 0 | 1 => s === 'text' ? 0 : 1;
    const trimTrailing = <T>(arr: T[][]): T[][] => {
      let last = arr.length - 1;
      while (last >= 0 && arr[last].length === 0) last--;
      return arr.slice(0, last + 1);
    };

    // key_event: [code, t_ms] | [code, t_ms, flags]
    // flags bitmask: bit0=shift, bit1=ctrl, bit2=alt, bit3=meta, bit4=ime, bit5=repeat
    const key_events = this.keyEventLog.map(ev => {
      const flags =
        (ev.shift  ? 1  : 0) |
        (ev.ctrl   ? 2  : 0) |
        (ev.alt    ? 4  : 0) |
        (ev.meta   ? 8  : 0) |
        (ev.ime    ? 16 : 0) |
        (ev.repeat ? 32 : 0);
      return flags ? [ev.code, ev.t_ms, flags] : [ev.code, ev.t_ms];
    });

    // commit_event: [t, i, ch, c, p]
    const commit_events = this.commitEventLog.map(ev => {
      const segs = ev.chunks.map(seg => seg.map(ch => {
        const base: [0 | 1, number] = [enc(ch.status), ch.len];
        return ch.committed === true ? ([...base, 1] as [0 | 1, number, 1]) : base;
      }));
      return [ev.t_ms, ev.phrase_index, trimTrailing(segs), ev.is_cleared ? 1 : 0, ev.is_perfect ? 1 : 0];
    });

    // phrase_result: [t, i, ch, c, p, sc, sp]
    const phrase_results = this.phraseResultLog.map(ev => {
      const segs = ev.chunks.map(seg => seg.map(ch => [enc(ch.status), ch.len] as [0 | 1, number]));
      return [ev.t_ms, ev.phrase_index, trimTrailing(segs), ev.is_cleared ? 1 : 0, ev.is_perfect ? 1 : 0, ev.score, ev.typing_speed];
    });

    return { key_events, commit_events, phrase_results };
  }

  static startReplay(replayData: {
    key_events: ([string, number] | [string, number, number])[];
    commit_events: [number, number, ([0|1, number] | [0|1, number, 1])[][], 0|1, 0|1][];
    phrase_results: [number, number, [0|1, number][][], 0|1, 0|1, number, number][];
    name: string;
    final_score: number;
  }) {
    const dec = (n: 0 | 1): 'text' | 'reading' => n === 0 ? 'text' : 'reading';
    const padSegs = (decoded: unknown[][], phraseIdx: number): void => {
      const segCount = this.chart?.lyric[phraseIdx]?.segments.length ?? decoded.length;
      while (decoded.length < segCount) decoded.push([]);
    };

    this.replayKeyEvents = replayData.key_events.map(e => {
      const flags = e[2] ?? 0;
      return {
        t_ms: e[1], code: e[0],
        shift:  !!(flags & 1),
        ctrl:   !!(flags & 2),
        alt:    !!(flags & 4),
        meta:   !!(flags & 8),
        ime:    !!(flags & 16),
        repeat: !!(flags & 32),
      };
    });
    this.replayCommitEvents = replayData.commit_events.map(e => {
      const chunks = e[2].map(seg => seg.map(arr => ({
        status: dec(arr[0]), len: arr[1], committed: arr[2] === 1,
      })));
      padSegs(chunks, e[1]);
      return { t_ms: e[0], phrase_index: e[1], chunks, is_cleared: !!e[3], is_perfect: !!e[4] };
    });
    this.replayPhraseResults = replayData.phrase_results.map(e => {
      const chunks = e[2].map(seg => seg.map(arr => ({ status: dec(arr[0]), len: arr[1] })));
      padSegs(chunks, e[1]);
      return { t_ms: e[0], phrase_index: e[1], chunks, is_cleared: !!e[3], is_perfect: !!e[4], score: e[5], typing_speed: e[6] };
    });

    this.replayMode.set(true);
    this.replayUsername.set(replayData.name);
    this.replayFinalScore.set(replayData.final_score);
    this.replayKeyEventCursor = 0;
    this.replayCommitEventCursor = 0;
    this.replayPhraseResultCursor = 0;
    this.replayKeyDisplayLog.set([]);
  }

  // リプレイ中に任意時刻 (秒) へシークする。
  // 仮想 tick で 0→T を早送りして状態を再構築し、実オーディオを T にセットして再生再開する。
  static async seekReplay(targetSec: number) {
    if (!this.chart || !this.audio) return;
    if (!get(this.replayMode)) return;
    if (this.virtualMode) return; // 連続シーク防止

    const duration = this.audio.duration || 0;
    const wasPlaying = !this.audio.paused;
    this.audio.pause();

    // --- 状態リセット (chart / replay 系は保持) ---
    this.lrcStatus = new LyricStatus(this.chart.lyric);
    this._rebuildLyricStatusMeta();

    this.score.set(0);
    this.earnedBaseScore.set(0);
    this.perfectCount.set(0);
    this.readingMatchCount.set(0);
    this.lostCount.set(0);
    this.typingSpeed.set(0);
    this.replayKeyDisplayLog.set([]);
    this.replayKeyEventCursor = 0;
    this.replayCommitEventCursor = 0;
    this.replayPhraseResultCursor = 0;
    this.graceProgress.set(0);
    this.graceStartTime = 0;
    this.renderedLyrics.set([]);
    this.nextLines.set([]);
    this.maxBaseScore.set(this.lrcStatus.notes * this.BASE_SCORE);
    this.totalPhrases.set(this.lrcStatus.totalPhrases);

    // --- 仮想 tick で 0 → targetSec まで早送り ---
    this.virtualMode = true;
    const STEP_MS = 100;
    const targetMs = Math.max(0, Math.round(targetSec * 1000));
    const durMs = Math.round(duration * 1000);

    if (targetMs > 0) {
      let t = STEP_MS;
      while (true) {
        const tClamped = Math.min(t, targetMs);
        if (tClamped <= durMs) {
          this.virtualAudioTimeSec = tClamped / 1000;
          this.virtualAudioEnded = false;
        } else {
          this.virtualAudioTimeSec = duration;
          this.virtualAudioEnded = true;
        }
        this.virtualReplayTimeMs = tClamped;
        this.tickStep();
        if (tClamped >= targetMs) break;
        t += STEP_MS;
      }
    }
    this.virtualMode = false;

    // --- 実オーディオに反映 ---
    if (targetSec <= duration) {
      this.audio.currentTime = targetSec;
      this.graceStartTime = 0;
      this.gamePhase.set('playing');
    } else {
      this.audio.currentTime = duration;
      const graceMs = (targetSec - duration) * 1000;
      this.graceStartTime = performance.now() - graceMs;
      this.gamePhase.set('grace');
    }

    if (wasPlaying) {
      try { await this.audio.play(); } catch {}
    }
  }

  static async retry() {
    if (!this.chart) return;
    this.stopped = true;
    // URLを解放せずにオーディオとリスナーをクリーンアップ
    if (this.audio) {
      this.audio.pause();
      if (this.audio instanceof HTMLAudioElement) {
        this.audio.removeAttribute("src");
        this.audio.load();
      } else {
        this.audio.currentTime = 0;
      }
    }
    const input = document.getElementById("text-input");
    if (input) {
      input.removeEventListener("input", this.inputHandler as EventListener);
      input.removeEventListener(
        "keydown",
        this.keydownHandler as EventListener,
      );
      input.removeEventListener(
        "compositionend",
        this.compositionHandler as EventListener,
      );
      input.removeEventListener("click", this.clickHandler as EventListener);
    }
    await this.load(this.chart);
  }

  static replayKeydownHandler = (e: KeyboardEvent) => {
    if (!this.chart || !this.audio || !this.lrcStatus) return;
    const phase = get(this.gamePhase);
    if (phase !== 'playing' && phase !== 'grace') return;
    const status = this.lrcStatus;

    if (e.code === 'Enter' && e.shiftKey && !e.isComposing) {
      e.preventDefault();
      const allCleared = status.phraseCount >= this.chart.lyric.length && status.unClearLrcs.length === 0;
      if (this.audio.ended || allCleared) {
        this.showResult();
        return;
      }
      const nextTime = this.chart.lyric[status.phraseCount]?.time;
      const cTime = this.getCurrentTimeSec();
      if (nextTime !== undefined && nextTime - cTime >= 0.5) {
        this.seekReplay(nextTime - 0.5);
      }
    } else if ((e.code === 'ArrowRight' || e.code === 'ArrowLeft') && e.shiftKey && !e.ctrlKey && !e.isComposing) {
      e.preventDefault();
      const cTime = this.getCurrentTimeSec();
      const delta = e.code === 'ArrowRight' ? 5 : -5;
      const target = Math.max(0, Math.min(cTime + delta, this.audio.duration || 0));
      this.seekReplay(target);
    }
  };

  static keydownHandler = (e: KeyboardEvent) => {
    if (!this.audio || !this.lrcStatus || !this.chart) return;
    const status = this.lrcStatus;

    // --- キー入力ログ ---
    const t_ms = this.getReplayTimeMs();
    const key = `${e.code}${e.shiftKey ? '+Shift' : ''}${e.ctrlKey ? '+Ctrl' : ''}${e.altKey ? '+Alt' : ''}${e.metaKey ? '+Meta' : ''}${e.isComposing ? '+IME' : ''}`;
    this.keyCounts.update(m => ({ ...m, [key]: (m[key] ?? 0) + 1 }));
    this.keyEventLog.push({ t_ms, code: e.code, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey, ime: e.isComposing, repeat: e.repeat });

    // --- 既存のゲームロジック ---
    if (e.key === "Enter") {
      const input = e.target as HTMLInputElement;
      this.handleInput(input.value, input);
    }

    switch (e.code) {
      case "Enter":
        if (!e.isComposing && e.shiftKey) {
          e.preventDefault();
          // 猶予期間中 or 全フレーズクリア済み → リザルト表示
          const allCleared =
            status.phraseCount >= this.chart.lyric.length &&
            status.unClearLrcs.length === 0;
          if (this.audio.ended || allCleared) {
            this.showResult();
            return;
          }
          const nextTime = this.chart.lyric[status.phraseCount]?.time;
          const cTime = this.audio.currentTime;
          if (nextTime && nextTime - cTime >= 0.5) {
            this.audio.currentTime = nextTime - 0.5;
          }
        }
        break;
      case "ArrowRight":
        if (e.shiftKey && !e.ctrlKey && !e.isComposing) {
          e.preventDefault();
          this.audio.currentTime += 5;
        }
        break;
      case "ArrowLeft":
        if (e.shiftKey && !e.ctrlKey && !e.isComposing && !this.disallowRewind) {
          e.preventDefault();
          this.audio.currentTime -= 5;
        }
        break;
    }
  };

  static tick() {
    Tick.on(() => this.tickStep());
  }

  private static tickStep(): boolean {
      if (this.stopped) return false;
      if (!this.audio) return false;

      let audioTime = this.getCurrentTimeSec();
      const offsetTime = 0;

      // YouTube の seekTo(0) は非同期。seek 完了まで audioTime を 0 に強制する。
      // audioTime が 0.5s を下回ったら seek 完了とみなしてフラグを解除する。
      if (!this.virtualMode && this.seekGuard) {
        if (audioTime < 0.5) {
          this.seekGuard = false;
        } else {
          audioTime = 0;
        }
      }

      this.currentTime.set(audioTime + offsetTime);
      this.duration.set(this.audio.duration || 0);

      audioTime = audioTime + offsetTime;

      const status = this.lrcStatus;
      let hasChange = false;
      if (status.needsUpdate) {
        hasChange = true;
        status.needsUpdate = false;
      }

      // --- Update Active Lrcs (Line Lifecycle) ---
      for (let k = status.activeLrcs.length - 1; k >= 0; k--) {
        const activeLine = status.activeLrcs[k].line;
        let hasFuture = false;
        for (let m = status.phraseCount; m < this.chart.lyric.length; m++) {
          if (this.chart.lyric[m].line === activeLine) {
            hasFuture = true;
            break;
          }
        }
        if (!hasFuture) {
          let lastPhraseEndTime = 0;
          for (let m = this.chart.lyric.length - 1; m >= 0; m--) {
            if (this.chart.lyric[m].line === activeLine) {
              lastPhraseEndTime = this.chart.lyric[m].endTime;
              break;
            }
          }
          if (audioTime >= lastPhraseEndTime) {
            const nextGlobalPhrase = this.chart.lyric[status.phraseCount];
            if (nextGlobalPhrase) {
              const gap = nextGlobalPhrase.time - lastPhraseEndTime;
              if (gap < 1.0 && gap >= 0)
                lastPhraseEndTime = nextGlobalPhrase.time;
            }
            if (audioTime >= lastPhraseEndTime) {
              status.activeLrcs.splice(k, 1);
              if (!status.finishedLines.includes(activeLine)) {
                status.finishedLines.push(activeLine);
              }
              hasChange = true;
              // Allow late typing while visible (in finishedLines)
            }
          }
        }
      }

      // --- Add New Lrcs to Queue ---
      const lrcQueue: Chart["lyric"][number][] = [];
      while (status.phraseCount < this.chart.lyric.length) {
        const item = this.chart.lyric[status.phraseCount];
        if (audioTime >= item.time) {
          lrcQueue.push(item);
          status.phraseCount++;
        } else {
          break;
        }
      }

      if (lrcQueue.length > 0) {
        const linesToShow = new Set<number>();
        lrcQueue.forEach((q) => {
          linesToShow.add(q.line);
          const concurrent = status.concurrentGroups.get(q.line);
          concurrent?.forEach((cl) => {
            const times = status.lineTimes.get(cl);
            if (times && audioTime < times.end) linesToShow.add(cl);
          });

          // Add only unique, non-empty items to unClearLrcs
          if (
            !status.unClearLrcs.includes(q) &&
            !this.isEmptyPhrase(this.chart.lyric.indexOf(q))
          ) {
            status.unClearLrcs.push(q);
          }
        });

        linesToShow.forEach((line) => {
          if (!status.activeLrcs.some((l) => l.line === line)) {
            status.activeLrcs.push({ line, phrases: [] });
            const fIdx = status.finishedLines.indexOf(line);
            if (fIdx !== -1) status.finishedLines.splice(fIdx, 1);
          }
        });
        hasChange = true;
      }

      // --- Replay event playback ---
      // 注: lrcQueue 追加の後に実行することで、フレーズが unClearLrcs に
      // 入っている状態で applyScoreEvent の splice が正しく動作する
      if (get(this.replayMode)) {
        // 記録時と同じ論理時刻を使う（grace 中は audio.duration を超えて進む）
        const t_ms = this.getReplayTimeMs();

        while (
          this.replayCommitEventCursor < this.replayCommitEvents.length &&
          this.replayCommitEvents[this.replayCommitEventCursor].t_ms <= t_ms
        ) {
          this.applyCommitEvent(this.replayCommitEvents[this.replayCommitEventCursor]);
          this.replayCommitEventCursor++;
        }

        while (
          this.replayPhraseResultCursor < this.replayPhraseResults.length &&
          this.replayPhraseResults[this.replayPhraseResultCursor].t_ms <= t_ms
        ) {
          const ev = this.replayPhraseResults[this.replayPhraseResultCursor];
          const item = this.chart!.lyric[ev.phrase_index];
          if (item) {
            this.applyReplayPhraseResult(
              item,
              ev.chunks,
              ev.is_cleared,
              ev.is_perfect,
              ev.score,
              ev.typing_speed,
            );
          }
          this.replayPhraseResultCursor++;
        }

        let keyAdvanced = false;
        while (
          this.replayKeyEventCursor < this.replayKeyEvents.length &&
          this.replayKeyEvents[this.replayKeyEventCursor].t_ms <= t_ms
        ) {
          const ev = this.replayKeyEvents[this.replayKeyEventCursor];
          this.replayKeyDisplayLog.update(log => {
            const next = [...log, { t_ms: ev.t_ms, code: ev.code, ime: ev.ime, repeat: ev.repeat ?? false }];
            return next.length > this.REPLAY_KEY_DISPLAY_MAX
              ? next.slice(-this.REPLAY_KEY_DISPLAY_MAX)
              : next;
          });
          this.replayKeyEventCursor++;
          keyAdvanced = true;
        }
        if (keyAdvanced) hasChange = true;
      }

      // --- Limit total display lines to 5 ---
      // When 6th line appears, remove the line with the earliest start time
      const MAX_DISPLAY_LINES = 5;
      while (
        status.activeLrcs.length + status.finishedLines.length >
        MAX_DISPLAY_LINES
      ) {
        let removedLine: number | undefined;
        let minStart = Infinity;
        let removedFromFinished = false;

        for (const line of status.finishedLines) {
          const start = status.lineTimes.get(line)?.start ?? 0;
          if (start < minStart) {
            minStart = start;
            removedLine = line;
            removedFromFinished = true;
          }
        }
        for (const lrc of status.activeLrcs) {
          const start = status.lineTimes.get(lrc.line)?.start ?? 0;
          if (start < minStart) {
            minStart = start;
            removedLine = lrc.line;
            removedFromFinished = false;
          }
        }

        if (removedLine === undefined) break;

        if (removedFromFinished) {
          status.finishedLines.splice(
            status.finishedLines.indexOf(removedLine),
            1,
          );
        } else {
          const idx = status.activeLrcs.findIndex(
            (l) => l.line === removedLine,
          );
          if (idx !== -1) status.activeLrcs.splice(idx, 1);
        }

        const skippedPhrases = status.unClearLrcs.filter(
          (u) => u.line === removedLine,
        );
        if (skippedPhrases.length > 0) {
          this.lostCount.update((n) => n + skippedPhrases.length);
        }
        status.unClearLrcs = status.unClearLrcs.filter(
          (u) => u.line !== removedLine,
        );
        hasChange = true;
      }

      // --- Update input enabled state ---
      this.inputEnabled.set(status.unClearLrcs.length > 0);

      // --- Update Typing Speed (total chars / active lyrics time, per minute) ---
      // 歌詞が表示されている間だけ経過時間をカウント
      if (status.lastTickTime >= 0 && status.unClearLrcs.length > 0) {
        const delta = audioTime - status.lastTickTime;
        if (delta > 0 && delta < 1) {
          // 1秒以上のジャンプは無視（シーク対策）
          status.activeLyricsTime += delta;
        }
      }
      status.lastTickTime = audioTime;

      if (status.activeLyricsTime > 0 && status.totalTypedChars > 0) {
        this.typingSpeed.set(
          (status.totalTypedChars / status.activeLyricsTime) * 60,
        );
      } else {
        this.typingSpeed.set(0);
      }

      // --- Update Render State ---
      if (hasChange) {
        const allLines = [
          ...status.activeLrcs.map((l) => ({
            line: l.line,
            isFinished: false,
          })),
          ...status.finishedLines.map((l) => ({ line: l, isFinished: true })),
        ];

        const newRenderedCoords = allLines
          .map((item) => {
            const lineItems = this.chart.lyric.filter(
              (l) => l.line === item.line,
            );
            // Determine if line is "preview" (not yet started time-wise)
            // But here we use 'activeLrcs' which means they started or are concurrent.

            const isPreview = !lineItems.some((item) => item.time <= audioTime);

            return {
              line: item.line,
              items: lineItems.map((lItem) => {
                // Check if item is cleared or not
                // Actually unClearLrcs contains items NOT fully cleared.
                // 非打鍵フレーズは隣接する打鍵可能フレーズの完了に追従して cleared 扱いにする。
                const lItemIndex = this.chart.lyric.indexOf(lItem);
                const isCleared = this.isEmptyPhrase(lItemIndex)
                  ? this.isNonTypablePhraseCleared(lItemIndex, audioTime)
                  : !status.unClearLrcs.includes(lItem) &&
                    lItem.time <= audioTime;

                const cleared = status.clearedStatus.get(lItem) || [];
                const preview = status.previewMatches.get(lItem) || []; // We don't use preview much in commit-mode
                const segCount = lItem.segments.length;

                const mergedStatuses: MatchChunk[][] = new Array(segCount)
                  .fill(null)
                  .map((_, idx) => {
                    const c = (cleared[idx] || []).map((ch) => ({
                      ...ch,
                      committed: true,
                    }));
                    const p = (preview[idx] || []).map((ch) => ({
                      ...ch,
                      committed: false,
                    }));
                    return mergeChunks([...c, ...p]);
                  });

                return {
                  data: lItem,
                  isCleared,
                  segmentStatuses: mergedStatuses,
                };
              }),
              isPreview: !item.isFinished && isPreview,
              isFinished: item.isFinished,
            };
          })
          // LRC に書かれた行番号順にソート（タイムタグの微差で順序が揺れないようにするため）
          .sort((a, b) => a.line - b.line);

        this.renderedLyrics.set(newRenderedCoords);

        this.updateNextLinesPreview(status);
      }

      // --- 曲終了 → 猶予期間 → リザルト ---
      // 仮想 tick (リプレイシーク) 中は performance.now() ベースの grace 処理を回さない。
      // grace 状態は seekReplay 側で最終的にセットする。
      if (this.getAudioEnded() && !this.virtualMode) {
        if (this.graceStartTime === 0) {
          // 猶予期間開始
          this.graceStartTime = performance.now();
          this.gamePhase.set("grace");
        }
        const elapsed = (performance.now() - this.graceStartTime) / 1000;
        const progress = Math.min(elapsed / this.GRACE_DURATION, 1);
        this.graceProgress.set(progress);

        if (progress >= 1) {
          this.showResult();
          return false;
        }
      }

      return true;
  }
}
