/*
    ChartGameクラスを返して、start()やend()などのプレイ関連のⅧを入れていきたい
*/

import { volume, imageURL, media } from "../store.ts";
import { tick } from "svelte";
import { Tick } from "./tick.ts";
import { stripUntypeable, stripUntypeableChart, stripUntypeableInput, stripUntypeableInputWithMap } from "./parseLyric/char-class.ts";
import { settings } from "./settings.ts";
import { writable, get } from "svelte/store";

/**
 * 打鍵の一致度。「読み入力 x0.5」「文字種違い x0.5」の掛け算で決まる。
 *
 *   text    : 元テキストどおり (全角/半角の違いのみ許容)      → 100%
 *   reading : どちらか片方。                                 →  50%
 *             ・漢字を読みどおりに打った (朝 → あさ)
 *             ・元テキストの文字種違い   (You → you)
 *   loose   : 両方。読みを違う文字種で打った                  →  25%
 *             (朝[あさ] → アサ / 宿敵[ライバル] → らいばる)
 */
/**
 * 打鍵の一致度。「読み入力 x0.5」「文字種違い x0.5」の独立した 2 軸の積で決まる。
 * 2 軸なので状態は 4 つ。len の単位が軸「読み入力」に従う点に注意
 * (読み入力なら読み文字数、そうでなければ元テキスト文字数)。
 *
 *   text          : 元テキストどおり                     → 100% (text 単位)
 *   text-loose    : 元テキストの文字種違い ("You"→"you") →  50% (text 単位)
 *   reading       : 読みどおり ("朝"→"あさ")             →  50% (読み単位)
 *   reading-loose : 読み かつ 文字種違い ("朝"→"アサ")   →  25% (読み単位)
 */
export type MatchStatus = "text" | "text-loose" | "reading" | "reading-loose";

export type MatchChunk = {
  status: MatchStatus;
  len: number;
  committed?: boolean;
};

/** 2 軸から status を決める */
export function matchStatusOf(
  viaReading: boolean,
  charTypeDiff: boolean,
): MatchStatus {
  if (viaReading) return charTypeDiff ? "reading-loose" : "reading";
  return charTypeDiff ? "text-loose" : "text";
}

/** len が「読み文字数」基準か (false なら元テキスト文字数基準) */
export const MATCH_READING_UNIT: Record<MatchStatus, boolean> = {
  text: false,
  "text-loose": false,
  reading: true,
  "reading-loose": true,
};

/** status ごとのスコア倍率 = (読み入力 ? 0.5 : 1) x (文字種違い ? 0.5 : 1) */
export const MATCH_SCORE_RATE: Record<MatchStatus, number> = {
  text: 1,
  "text-loose": 0.5,
  reading: 0.5,
  "reading-loose": 0.25,
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
    // 終端より手前へのシークでは ended を即解除する。
    // YT は onStateChange が来るまで ended が残るため、シーク直後の tick が
    // 「まだ終了中」と誤認して偽の grace 開始 → 後で即リザルト等の原因になる。
    if (t < this.player.getDuration()) this._ended = false;
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
  // リプレイシーク直後、メディア側の seek 完了まで audioTime を目標時刻に固定する。
  // YouTube の seekTo は非同期で、完了前の古い currentTime を読むと再構築済みの
  // 状態がさらに先 (シーク前の時刻) まで進んでしまい巻き戻し不能になる。
  private static replaySeekGuard: number | null = null;
  // 終端付近〜grace 域へのシークで「曲は終了扱い」にする論理フラグ (通常プレイ・リプレイ共通)。
  // YouTube は終端ちょうど/以深への seekTo で先頭に巻き戻ることがあり、また ended が
  // イベント駆動のためシークでは立たない。そのため grace 域シークではメディアを
  // 触らず (その場で停止したまま)、終了状態はこのフラグで表現する。
  private static forceEnded = false;
  // 終端付近への物理シークを避ける安全マージン (秒)。YT の getDuration 誤差対策
  private static readonly END_SEEK_EPS = 0.5;

  // Score system (10000点満点、earnedBaseScore / maxBaseScore × 10000)
  static score = writable(0);
  static duration = writable(0);
  static currentTime = writable(0);

  // Clear rate tracking (based on old 10000 max score system)
  static maxBaseScore = writable(0); // Max possible base score (totalNotes * BASE_SCORE)
  static earnedBaseScore = writable(0); // Base score earned (without multipliers)
  // 取り返せなくなった base score の累計。
  // フレーズが確定 (クリア or ロスト) した時点で「満点との差」を積む。
  // 現在の理論上限 = 10000 - forfeitedBaseScore / maxBaseScore * 10000
  static forfeitedBaseScore = writable(0);

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
  static phraseResultLog: { t_ms: number; phrase_index: number; chunks: { status: MatchStatus; len: number }[][]; is_cleared: boolean; is_perfect: boolean; score: number; typing_speed: number }[] = [];

  // リプレイ再生用ステート
  static replayMode = writable(false);
  static replayUsername = writable<string | null>(null);
  static replayFinalScore = writable<number>(0);
  static replayKeyDisplayLog = writable<{ t_ms: number; code: string; ime: boolean; repeat: boolean; shift: boolean; ctrl: boolean }[]>([]);
  // フレーズ確定後〜次のフレーズ打ち始めまで、確定済み入力を薄く表示するためのフラグ
  static replayKeyDisplayDimmed = writable(false);
  private static replayKeyDisplayPendingClear = false;
  static disallowInputWhenPaused = false;
  static disallowRewind = false;
  private static replayKeyEvents: { t_ms: number; code: string; shift: boolean; ctrl: boolean; alt: boolean; meta: boolean; ime: boolean; repeat?: boolean }[] = [];
  private static replayCommitEvents: { t_ms: number; phrase_index: number; chunks: MatchChunk[][]; is_cleared: boolean; is_perfect: boolean }[] = [];
  private static replayPhraseResults: { t_ms: number; phrase_index: number; chunks: { status: MatchStatus; len: number }[][]; is_cleared: boolean; is_perfect: boolean; score?: number; typing_speed?: number }[] = [];
  private static replayKeyEventCursor = 0;
  private static replayCommitEventCursor = 0;
  private static replayPhraseResultCursor = 0;
  private static readonly REPLAY_KEY_DISPLAY_MAX = 30;

  // O(1) フレーズインデックス参照
  static lyricIndexMap = new Map<Chart["lyric"][number], number>();

  // --- 統計計装 ---
  // ページが start() 前にセットする。null の間は記録しない（リプレイ等）。
  static statsContext: { chartId: number | null; source: "chart" | "local" } | null = null;
  // 現在のプレイが進行中か（プレイ終了時フラッシュの二重実行を防ぐ）
  private static playActive = false;
  // 現在のプレイで lost したフレーズ index（chart.lyric の添字）
  static lostPhraseIndices: number[] = [];

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
    if (this.virtualMode) return this.virtualAudioEnded;
    return (this.audio?.ended ?? false) || this.forceEnded;
  }

  // 現在の論理再生時刻 (秒)。grace 中は audio.duration + grace 経過秒を返す。
  // シーク UI の起点計算で利用する。
  static getCurrentLogicalSec(): number {
    if (!this.audio) return 0;
    if ((this.audio.ended || this.forceEnded) && this.graceStartTime > 0) {
      const dur = this.audio.duration || 0;
      const graceSec = Math.max(0, (performance.now() - this.graceStartTime) / 1000);
      return dur + graceSec;
    }
    return this.audio.currentTime;
  }

  /**
   * 実時刻に足す補正 (秒)。歌詞表示タイミング設定 lyricDelay の符号反転。
   * 正の lyricDelay で時刻を巻き戻す = 歌詞が遅く出る。
   * リプレイ再生中は記録時の時刻軸をそのまま再現するため補正しない。
   */
  private static timeOffsetSec(): number {
    if (get(this.replayMode)) return 0;
    return -get(settings).lyricDelay;
  }

  // 採点イベント・キーイベントで使う論理時刻 (ms)。
  // 通常プレイ中: audio.currentTime * 1000
  // grace 中: audio.duration * 1000 + grace 開始からの経過時間
  // grace 中は audio.currentTime が duration で凍結するため、grace 中の入力を別 t_ms に分離する。
  //
  // 記録される時刻は「譜面の時間軸」に正規化する (実時刻 + timeOffsetSec)。
  // プレイヤー個人の歌詞表示補正を差し引いて保存することで、リプレイ再生側
  // (補正なし) でも歌詞の出現と打鍵の位置関係が録画時と一致する。
  private static getReplayTimeMs(): number {
    if (this.virtualMode) return this.virtualReplayTimeMs;
    if (!this.audio) return 0;
    const offsetMs = Math.round(this.timeOffsetSec() * 1000);
    // シーク完了待ちの間は目標時刻で固定 (詳細は replaySeekGuard 定義コメント)
    if (this.replaySeekGuard !== null) return Math.round(this.replaySeekGuard * 1000);
    const audioMs = Math.round(this.audio.currentTime * 1000);
    if ((this.audio.ended || this.forceEnded) && this.graceStartTime > 0) {
      const graceMs = Math.round(performance.now() - this.graceStartTime);
      const durMs = Math.round((this.audio.duration || 0) * 1000);
      return durMs + Math.max(0, graceMs) + offsetMs;
    }
    return audioMs + offsetMs;
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
    // keydown は document に登録しているのでここで外す
    document.removeEventListener("keydown", this.keydownHandler as EventListener);
    const input = document.getElementById("text-input");
    if (input) {
      input.removeEventListener("input", this.inputHandler as EventListener);
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
    this.forfeitedBaseScore.set(0);
    this.perfectCount.set(0);
    this.readingMatchCount.set(0);
    this.lostCount.set(0);
    this.totalPhrases.set(0);
    this.typingSpeed.set(0);
    this.keyCounts.set({});
    this.lostPhraseIndices = [];
    this.keyEventLog = [];
    this.commitEventLog = [];
    this.phraseResultLog = [];
    this.replayKeyDisplayLog.set([]);
    this.replayKeyDisplayDimmed.set(false);
    this.replayKeyDisplayPendingClear = false;
    this.replayKeyEventCursor = 0;
    this.replayCommitEventCursor = 0;
    this.replayPhraseResultCursor = 0;
    this.chartTitle.set("");
    this.inputEnabled.set(false);
    this.graceProgress.set(0);
    this.graceStartTime = 0;
    this.replaySeekGuard = null;
    this.forceEnded = false;
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

    // 統計: ここから1プレイ開始。load()→init() で keyCounts / lostPhraseIndices は
    // 既にリセット済みなので、進行中フラグを立てるだけ。
    this.playActive = true;

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
    // keydown は document に登録する。入力欄にフォーカスが無くても
    // ゲーム操作 (Shift+Enter / Shift+←→) を効かせるため。
    // 入力欄で押されたキーもバブリングでここに届くので二重処理にはならない。
    document.addEventListener("keydown", this.keydownHandler as EventListener);
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
    // forceEnded 中はメディアを曲中で停止したまま grace が進むため、
    // paused でも入力を許可する (grace の打鍵を塞がない)
    if (this.disallowInputWhenPaused && this.audio?.paused && !this.forceEnded) {
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

    // スペースは特別扱いしない (日本語・英語で処理を統一)。
    // 英単語の区切りなら打鍵対象の文字として一致し、それ以外の位置に入った
    // スペースは他の誤字と同じく単に一致しない = 誤打として入力欄に残る。
    // かつてスペースで即時採点していた動作は廃止 (確定は Enter と自動確定)。

    const shouldImmediateScore = this.checkInput(value);
    const imeBlocked =
      /[0-9０-９a-zA-Zａ-ｚＡ-Ｚ]/.test(value) &&
      e.isComposing &&
      !this.inputEndsWithJapaneseTypable(value);
    if (imeBlocked) return;

    if (shouldImmediateScore) {
      // 入力全体を消費できた → 従来どおり全部確定して入力欄を空にする
      this.handleInput(value, input);
      input.value = "";
      input.blur();
      setTimeout(() => input.focus());
      return;
    }

    // 全体は確定できないが完全クリアしたフレーズがあるなら、それだけ確定して
    // 入力欄からその分を取り除く。タイプミスは残るので打ち直せる。
    // ("Nwo I don't" → "I " が消えて "Nwo don't" が残る)
    //
    // e.isComposing で弾かないこと。日本語入力は変換中ずっと isComposing=true
    // なので、それを条件にすると日本語では一度も走らなくなる。
    // 英数字混在時の抑止は上の imeBlocked が担当している。
    const inputStr = stripUntypeableInput(value);
    if (!inputStr || this.hasLongerPrefixCandidate(inputStr)) return;
    // 部分的な取り除きは「プレイヤーが明示的にスペースで区切ったとき」だけ行う。
    // 区切りが無い入力 (日本語を続けて打っている最中など) で入力欄を書き換えると
    // 打っている途中に文字が消える形になり、IME とも噛み合わない。
    // 英語はフレーズ側が区切りスペースを含むので、確定できる時点で必ず空白がある。
    if (!inputStr.includes(" ")) return;
    const before = input.value;
    this.handleInput(value, input, { clearedOnly: true });
    if (e.isComposing && input.value !== before) {
      // 変換中に value を書き換えると IME のバッファとずれるのでリセットする
      // (全体確定パスと同じ対処)
      input.blur();
      setTimeout(() => input.focus());
    }
  };

  private static inputEndsWithJapaneseTypable(value: string): boolean {
    const typed = stripUntypeable(value);
    const last = Array.from(typed).at(-1) ?? "";
    // char-class の共有集合とは別物（意図的）。IME 確定待ち判定用に英数を除外し、
    // 「日本語の打鍵文字（かな/漢字/々〆/～〜）で終わるか」だけを見る。
    return /[ぁ-んァ-ヶー々〆一-鿿～〜]/.test(last);
  }

  private static toComparableInput(value: string): string {
    return value
      .replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) =>
        String.fromCharCode(c.charCodeAt(0) - 0xfee0),
      )
      .replace(/[ァ-ヶ]/g, (c) =>
        String.fromCharCode(c.charCodeAt(0) - 0x60),
      )
      .toLowerCase();
  }

  private static phraseMatchCandidates(item: Chart["lyric"][number]): string[] {
    let candidates = [""];
    for (const seg of item.segments) {
      const options = Array.from(
        new Set([seg.normalizedText, seg.normalizedReading].filter(Boolean)),
      ).map((s) => this.toComparableInput(s));

      const next: string[] = [];
      for (const base of candidates) {
        for (const option of options) {
          next.push(base + option);
        }
      }
      candidates = next.slice(0, 64);
    }
    return candidates;
  }

  private static hasLongerPrefixCandidate(inputStr: string): boolean {
    if (!this.lrcStatus) return false;
    const input = this.toComparableInput(inputStr);
    if (!input) return false;

    return this.lrcStatus.unClearLrcs.some((item) =>
      this.phraseMatchCandidates(item).some(
        (candidate) =>
          candidate.length > input.length && candidate.startsWith(input),
      ),
    );
  }

  // Logic for granular matching
  // offset: existing matched length in THIS segment (for partial text consumption)
  /**
   * 表示どおりの読み (打鍵対象文字のみ抜き出し、文字種はそのまま)。
   *
   * normalizedReading は buildSegment がカタカナ→ひらがな・大文字→小文字に
   * 潰しているため、「読みどおりに打ったか」の判定には使えない
   * (「宿敵,ライバル」で normalizedReading が "らいばる" になり、
   *  表示どおりの "ライバル" が文字種違い扱いになってしまう)。
   * 毎打鍵・全フレーズ分呼ばれるので結果をキャッシュする。
   */
  private static displayReadingCache = new WeakMap<object, string>();
  private static getDisplayReading(
    seg: Chart["lyric"][number]["segments"][number],
  ): string {
    const cached = this.displayReadingCache.get(seg);
    if (cached !== undefined) return cached;
    // buildSegment と同じ波ダッシュ正規化だけ揃える (長音として打てるように)
    const value = stripUntypeableChart(seg.reading).replace(/[～〜]/g, "ー");
    this.displayReadingCache.set(seg, value);
    return value;
  }

  static matchSegment(
    seg: Chart["lyric"][number]["segments"][number],
    input: string,
    offset: number = 0,
  ): { chunks: MatchChunk[]; remainingInput: string; matchedAll: boolean } {
    const strictText = seg.normalizedText;
    const looseReading = seg.normalizedReading;
    // 50% 判定 (読みどおり) は表示どおりの読み、25% 判定 (文字種違い) は
    // 正規化済みの読みで行う
    const shownReading = this.getDisplayReading(seg);
    let currentInput = input;
    const chunks: MatchChunk[] = [];

    const toHalf = (s: string) =>
      s.replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) =>
        String.fromCharCode(c.charCodeAt(0) - 0xfee0),
      );

    /** 文字種の違い (大文字小文字・カタカナ/ひらがな) を潰す */
    const simplify = (s: string) =>
      toHalf(s)
        .toLowerCase()
        .replace(/[\u30a1-\u30f6]/g, (c) =>
          String.fromCharCode(c.charCodeAt(0) - 0x60),
        );

    if (
      strictText.length !== looseReading.length ||
      /[一-鿿]/.test(strictText)
    ) {
      if (offset > 0) {
        return { chunks, remainingInput: currentInput, matchedAll: true };
      }

      const normInput = toHalf(currentInput);

      // 候補: 元テキスト (viaReading=false) と 表示どおりの読み (true)。
      // 各候補について「全角半角だけ合わせれば一致」なら文字種違いなし、
      // 「文字種も潰せば一致」なら文字種違いあり、と判定する。
      // len は viaReading の軸に合わせた単位で積む
      // (読みなら looseReading.length、元テキストなら strictText.length)。
      const candidates: {
        consume: string;
        len: number;
        viaReading: boolean;
      }[] = [
        { consume: strictText, len: strictText.length, viaReading: false },
        { consume: shownReading, len: looseReading.length, viaReading: true },
      ];

      let best: { status: MatchStatus; len: number; consume: number } | null =
        null;
      for (const cand of candidates) {
        if (cand.consume === "") continue;
        const head = normInput.slice(0, cand.consume.length);
        const norm = toHalf(cand.consume);
        let charTypeDiff: boolean | null = null;
        if (head === norm) charTypeDiff = false;
        else if (simplify(head) === simplify(norm)) charTypeDiff = true;
        if (charTypeDiff === null) continue;

        const status = matchStatusOf(cand.viaReading, charTypeDiff);
        if (
          !best ||
          MATCH_SCORE_RATE[status] > MATCH_SCORE_RATE[best.status]
        ) {
          best = { status, len: cand.len, consume: cand.consume.length };
        }
      }

      if (!best) {
        return { chunks, remainingInput: currentInput, matchedAll: false };
      }
      chunks.push({ status: best.status, len: best.len });
      return {
        chunks,
        remainingInput: currentInput.slice(best.consume),
        matchedAll: true,
      };
    }

    let segIdx = offset;
    let matchedLen = offset;

    if (segIdx >= strictText.length) {
      return { chunks, remainingInput: currentInput, matchedAll: true };
    }

    while (segIdx < strictText.length && currentInput.length > 0) {
      const tChar = strictText[segIdx];
      const dChar = shownReading[segIdx];
      const iChar = currentInput[0];

      // atomic パスと同じ 2 軸判定を 1 文字単位で行う。
      // 元テキスト側を先に評価し、倍率が高い方を採る
      // (text === reading の行では両候補が同じなので text 側が勝つ)。
      let matchStatus: MatchStatus | null = null;
      for (const cand of [
        { ch: tChar, viaReading: false },
        { ch: dChar, viaReading: true },
      ]) {
        if (cand.ch === undefined) continue;
        let charTypeDiff: boolean | null = null;
        if (iChar === cand.ch || toHalf(iChar) === toHalf(cand.ch)) {
          charTypeDiff = false;
        } else if (simplify(iChar) === simplify(cand.ch)) {
          charTypeDiff = true;
        }
        if (charTypeDiff === null) continue;
        const status = matchStatusOf(cand.viaReading, charTypeDiff);
        if (
          matchStatus === null ||
          MATCH_SCORE_RATE[status] > MATCH_SCORE_RATE[matchStatus]
        ) {
          matchStatus = status;
        }
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
  // 優先度（プレビュー・採点で共通の単一ポリシー）:
  //   1. マッチ文字数が多い   （タイプ中の意図した行を選ぶ）
  //   2. 同数なら完全一致を優先（ちょうど完成した行を確定側で拾う）
  //   3. さらに同じなら text 一致(厳密一致)の文字数が多い方
  //      （"Just" と "just" が並ぶとき、"just" 入力では大小が合う後者を選ぶ）
  //   4. それでも同じなら先に見つけた方 = 譜面順で前のフレーズ（安定・決定的）
  //
  // ⚠ 1 と 2 の判定では区切りスペースを数えない。
  //   英単語の区切りスペースは前フレーズの末尾に付くため、"that, this and that"
  //   のように同じ語が行末にもあると、末尾側だけスペースが無く先に完成扱いになり
  //   "that" と打つと後ろのフレーズが選ばれてしまう。スペースを除いて比べれば
  //   どちらも 4/4 で並び、譜面順で前のフレーズが選ばれる。
  //   実際の消費長 (matchedLen) と採点の完了判定 (isFullyCleared) は
  //   スペースを含めたままなので、スペースの打鍵は依然として必要。
  static findBestMatch(
    lrcItems: Chart["lyric"][number][],
    input: string,
    clearedStatus: Map<Chart["lyric"][number], MatchChunk[][]>,
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
      /** 優先度比較用: 区切りスペースを除いたマッチ長 */
      rankLen: number;
      /** 優先度比較用: 区切りスペースを除けば完成しているか */
      rankFull: boolean;
      textLen: number;
    };

    /** 残りが区切りスペースだけなら完成とみなす */
    const restIsSpaceOnly = (s: string, from: number) =>
      /^ *$/.test(s.slice(from));
    let best: MatchCandidate | null = null;

    for (let i = 0; i < lrcItems.length; i++) {
      const lrcItem = lrcItems[i];
      let tempInput = input;
      const itemChunks: MatchChunk[][] = [];
      let totalMatchedLen = 0;
      let rankMatchedLen = 0;
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
          // 優先度比較では区切りスペースを数えない
          const matchedText = seg.normalizedText.slice(offset, offset + consumed);
          rankMatchedLen += consumed - (matchedText.match(/ /g)?.length ?? 0);
          partialFound = true;
        } else {
          itemChunks.push([]);
        }

        if (!matchedAll) {
          break;
        }
      }

      if (partialFound) {
        const segTotalLen = (idx: number) =>
          (existingProgress[idx] || []).reduce((a, c) => a + c.len, 0) +
          (itemChunks[idx] || []).reduce((a, c) => a + c.len, 0);

        const isFullyMatched = lrcItem.segments.every((seg, idx) => {
          const totalLen = segTotalLen(idx);
          return (
            totalLen === seg.normalizedText.length ||
            totalLen === seg.normalizedReading.length
          );
        });

        // 優先度比較用: 残りが区切りスペースだけなら完成扱い
        const rankFull = lrcItem.segments.every((seg, idx) => {
          const totalLen = segTotalLen(idx);
          return (
            restIsSpaceOnly(seg.normalizedText, totalLen) ||
            restIsSpaceOnly(seg.normalizedReading, totalLen)
          );
        });

        // 厳密一致 (status="text") の文字数。大小違い等は "reading" になる
        const textLen = itemChunks.reduce(
          (acc, chunks) =>
            acc +
            chunks.reduce((a, c) => a + (c.status === "text" ? c.len : 0), 0),
          0,
        );

        const candidate: MatchCandidate = {
          index: i,
          matchedLen: totalMatchedLen,
          segments: itemChunks,
          isFullyMatched,
          rankLen: rankMatchedLen,
          rankFull,
          textLen,
        };

        const isBetter = (prev: MatchCandidate): boolean => {
          if (rankMatchedLen !== prev.rankLen)
            return rankMatchedLen > prev.rankLen;
          if (rankFull !== prev.rankFull) return rankFull;
          if (textLen !== prev.textLen) return textLen > prev.textLen;
          return false;
        };

        if (!best || isBetter(best)) best = candidate;
      }
    }

    if (!best || best.matchedLen === 0) return null;
    return best;
  }

  // 入力を未クリア歌詞へ割り当てるシミュレーション（副作用なし）。
  // checkInput（プレビュー）と handleInput（採点）はどちらもこの結果を使う。
  // 進捗は実状態のクローン上で消費するため、複数フレーズ消費の挙動も両者で完全一致する。
  private static resolveInput(inputStr: string): {
    steps: {
      item: Chart["lyric"][number];
      addedSegments: MatchChunk[][]; // 既存進捗に対して今回追加されたチャンク（プレビュー用）
      mergedSegments: MatchChunk[][]; // 既存 + 追加をマージした累積状態（採点・確定用）
      isFullyCleared: boolean;
      isPerfect: boolean; // merged が全て text か（perfect 判定）
      addedAllText: boolean; // 追加分が full かつ全て text か（自動確定判定用）
      /** このステップが消費した正規化入力上の範囲 [start, end)。部分確定時の入力削除に使う */
      consumed: [number, number];
    }[];
    hasAnyMatch: boolean;
    leftover: string;
    /**
     * 入力のうち「完全クリアしたフレーズが消費した分」以外をつないだ文字列。
     * タイプミスで読み飛ばした部分・未完成フレーズに使った部分・leftover が
     * 順序どおり残る。入力欄をここまで削るのに使う。
     */
    keptText: string;
    /** keptText に対応する inputStr 上の区間 [start, end)。元の入力を復元するのに使う */
    keptRanges: [number, number][];
  } {
    const status = this.lrcStatus;
    if (!status)
      return {
        steps: [],
        hasAnyMatch: false,
        leftover: inputStr,
        keptText: inputStr,
        keptRanges: inputStr ? [[0, inputStr.length]] : [],
      };

    // 実状態を書き換えないよう進捗をクローン
    const workingUnClear = [...status.unClearLrcs];
    const workingCleared = new Map(
      [...status.clearedStatus].map(([k, v]) => [
        k,
        v.map((seg) => seg.map((ch) => ({ ...ch }))),
      ]),
    );

    const steps: {
      item: Chart["lyric"][number];
      addedSegments: MatchChunk[][];
      mergedSegments: MatchChunk[][];
      isFullyCleared: boolean;
      isPerfect: boolean;
      addedAllText: boolean;
      consumed: [number, number];
    }[] = [];
    // 入力を「単語 + 続く空白」のトークンに割る。
    // マッチはトークンを跨がないので、タイプミスの文字が別フレーズに吸われない。
    // ("Nwo I don't" の "w" が phrase "want" に食われてしまうのを防ぐ)
    // "like - that" の "- " も独立フレーズなので、トークンとフレーズは 1 対 1 になる。
    const tokens = inputStr.match(/[^ ]+ *| +/g) ?? [];

    let hasAnyMatch = false;
    // 完全クリアに使われなかった入力 (タイプミス・未完成フレーズ分) を順に積む
    let keptText = "";
    const keptRanges: [number, number][] = [];
    let tokenStart = 0;
    /** inputStr の [start, start+len) を「入力欄に残す」範囲として積む */
    const pushKept = (start: number, len: number) => {
      if (len <= 0) return;
      const last = keptRanges[keptRanges.length - 1];
      if (last && last[1] === start) last[1] = start + len;
      else keptRanges.push([start, start + len]);
      keptText += inputStr.slice(start, start + len);
    };
    // 同じフレーズの未完成ステップを重複記録しないための集合
    const partialRecorded = new Set<Chart["lyric"][number]>();
    const loopLimit = 100;

    for (const token of tokens) {
      let cur = token;
      for (let attempts = 0; attempts < loopLimit && cur.length > 0; attempts++) {
        const bestMatch = this.findBestMatch(
          workingUnClear,
          cur,
          workingCleared,
        );
        if (!bestMatch) {
          // 区切りとして正しく打たれたスペースは捨てる (誤打にしない)
          if (cur.startsWith(" ")) {
            cur = cur.replace(/^ +/, "");
            continue;
          }
          break;
        }

        hasAnyMatch = true;
        const item = workingUnClear[bestMatch.index];
        const added = bestMatch.segments;
        const existingProgress = workingCleared.get(item) || [];
        const segCount = item.segments.length;

        const merged: MatchChunk[][] = new Array(segCount)
          .fill(null)
          .map((_, idx) =>
            mergeChunks([
              ...(existingProgress[idx] || []),
              ...(added[idx] || []),
            ]),
          );

        const isFullyCleared = item.segments.every((seg, idx) => {
          const len = merged[idx].reduce((a, c) => a + c.len, 0);
          return (
            len === seg.normalizedText.length ||
            len === seg.normalizedReading.length
          );
        });
        const isPerfect = merged.every((chunks) =>
          chunks.every((c) => c.status === "text"),
        );
        const addedAllText =
          bestMatch.isFullyMatched &&
          added.every((chunks) => chunks.every((c) => c.status === "text"));

        // このステップが消費した正規化入力上の範囲
        const curStart = tokenStart + token.length - cur.length;
        const consumed: [number, number] = [
          curStart,
          curStart + bestMatch.matchedLen,
        ];

        // 打ち切れたフレーズは、厳密一致でなくても消費して先へ進む。
        // ここで止めると、漢字を読みで打ったとき (status="reading") に
        // 後続フレーズが一切マッチせずプレビューも出なくなる。
        //
        // 即時確定するのは「厳密一致」のときだけ。大小違いや読み一致は
        // 入力欄に残して打ち直す機会を残す (Enter を押せば減点込みで確定できる)。
        if (isFullyCleared) {
          steps.push({
            item,
            addedSegments: added,
            mergedSegments: merged,
            isFullyCleared,
            isPerfect,
            addedAllText,
            consumed,
          });
          // クローンを更新（次イテレーションが最新進捗を見る）
          workingCleared.set(item, merged);
          const i = workingUnClear.indexOf(item);
          if (i !== -1) workingUnClear.splice(i, 1);
          if (!addedAllText) {
            // 即時確定しないので、使った分は入力欄に残す
            pushKept(curStart, bestMatch.matchedLen);
          }
          cur = cur.slice(bestMatch.matchedLen);
          continue;
        }

        // 未完成 or 厳密一致でない: Enter での確定用にステップは残すが、
        // クローンには反映しない。反映すると次のトークンが続きを打ててしまい、
        // 単語の途中で打たれたスペース ("yo u") が無かったことになってしまう。
        if (!partialRecorded.has(item)) {
          partialRecorded.add(item);
          steps.push({
            item,
            addedSegments: added,
            mergedSegments: merged,
            isFullyCleared,
            isPerfect,
            addedAllText,
            consumed,
          });
        }
        break; // このトークンの残りは入力欄に残す
      }
      // cur は常に token の末尾側の部分文字列なので、開始位置は差分で求まる
      pushKept(tokenStart + token.length - cur.length, cur.length);
      tokenStart += token.length;
    }

    return {
      steps,
      hasAnyMatch,
      // 未消費テキスト = 入力欄に残す文字列
      leftover: keptText,
      keptText,
      keptRanges,
    };
  }

  static checkInput(inputVal: string): boolean {
    const inputStr = stripUntypeableInput(inputVal);

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

    // 採点（handleInput）と同じ resolveInput で解決し、確定せずプレビューだけ表示する。
    // これにより「プレビューで光る行 = 確定したら採点される行」が定義上一致する。
    const { steps, hasAnyMatch, leftover } = this.resolveInput(inputStr);
    let allMatchesAreTextPerfect = true;
    for (const step of steps) {
      status.previewMatches.set(step.item, step.addedSegments);
      if (!step.addedAllText) allMatchesAreTextPerfect = false;
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

    return (
      hasAnyMatch &&
      allMatchesAreTextPerfect &&
      leftover.length === 0 &&
      !this.hasLongerPrefixCandidate(inputStr)
    );
  }

  // 累積 chunks から segment ごとの baseScore を計算（合計）
  // reading 一致は text 文字数換算で 0.5 倍する → 必ず text 一致の半分以下になる
  /** そのフレーズを完璧に打った場合の base score (全文字 text 一致) */
  private static computePotentialBaseScore(
    item: Chart["lyric"][number],
  ): number {
    return (
      item.segments.reduce((sum, seg) => sum + seg.normalizedText.length, 0) *
      this.BASE_SCORE
    );
  }

  /**
   * 確定済みの範囲を「満点 (全て text 一致) で取った場合」の base score。
   * computeBaseScoreFromChunks との差が、その範囲で取りこぼした点数になる。
   */
  private static computeCoveredPotentialBaseScore(
    item: Chart["lyric"][number],
    chunksPerSeg: { status: MatchStatus; len: number }[][],
  ): number {
    let sum = 0;
    for (let i = 0; i < chunksPerSeg.length; i++) {
      const segChunks = chunksPerSeg[i];
      const seg = item.segments[i];
      if (!seg) continue;
      for (const c of segChunks) {
        // 読み単位の len を text 換算する (倍率は掛けない = 満点で取った場合の値)
        const ratio =
          MATCH_READING_UNIT[c.status] && seg.normalizedReading.length > 0
            ? seg.normalizedText.length / seg.normalizedReading.length
            : 1;
        sum += c.len * ratio * this.BASE_SCORE;
      }
    }
    return sum;
  }

  /**
   * 送信のたびに、確定した範囲の「満点との差」を forfeited に積む。
   * フレーズを打ち切る前でも、読み打ちで確定した分は即座に上限へ反映される。
   */
  private static addForfeitedDelta(
    item: Chart["lyric"][number],
    prevChunks: { status: MatchStatus; len: number }[][],
    nextChunks: { status: MatchStatus; len: number }[][],
  ): void {
    const coveredDelta =
      this.computeCoveredPotentialBaseScore(item, nextChunks) -
      this.computeCoveredPotentialBaseScore(item, prevChunks);
    const earnedDelta =
      this.computeBaseScoreFromChunks(item, nextChunks) -
      this.computeBaseScoreFromChunks(item, prevChunks);
    const deficit = coveredDelta - earnedDelta;
    if (deficit > 0) this.forfeitedBaseScore.update((n) => n + deficit);
  }

  /**
   * ロスト確定時に、一度も打たれなかった残りの分を forfeited に積む。
   * 打鍵済みの範囲の差は addForfeitedDelta が既に積んでいるため二重計上しない。
   */
  private static addForfeitedRemainder(
    item: Chart["lyric"][number],
    coveredChunks: { status: MatchStatus; len: number }[][],
  ): void {
    const remainder =
      this.computePotentialBaseScore(item) -
      this.computeCoveredPotentialBaseScore(item, coveredChunks);
    if (remainder > 0) this.forfeitedBaseScore.update((n) => n + remainder);
  }

  private static computeBaseScoreFromChunks(
    item: Chart["lyric"][number],
    chunksPerSeg: { status: MatchStatus; len: number }[][]
  ): number {
    let sum = 0;
    for (let i = 0; i < chunksPerSeg.length; i++) {
      const segChunks = chunksPerSeg[i];
      const seg = item.segments[i];
      if (!seg) continue;
      for (const c of segChunks) {
        // 読み単位の len だけ text 換算 (text.len / reading.len) してから
        // 一致度の倍率を掛ける
        const ratio =
          MATCH_READING_UNIT[c.status] && seg.normalizedReading.length > 0
            ? seg.normalizedText.length / seg.normalizedReading.length
            : 1;
        sum += c.len * ratio * this.BASE_SCORE * MATCH_SCORE_RATE[c.status];
      }
    }
    return sum;
  }

  // 累積 chunks から typing-speed 用の文字数を計算
  private static computeTypedCharsFromChunks(
    item: Chart["lyric"][number],
    chunksPerSeg: { status: MatchStatus; len: number }[][],
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

    // 送信のたびに、確定した範囲の取りこぼしを上限へ反映する
    // (フレーズを打ち切る前の部分送信でも即座に効く)
    this.addForfeitedDelta(item, prev, cumulativeChunks);

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
    cumulativeChunks: { status: MatchStatus; len: number }[][],
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

    // 確定分の取りこぼし (リプレイでも限界スコアを再現する)
    this.addForfeitedDelta(item, prev, cumulativeChunks);

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

  /**
   * 入力欄の文字列から「確定に使われた文字」を取り除いた文字列を作る。
   *
   * 打鍵可能文字は keep(正規化インデックス) で残すか決め、打鍵対象外の記号は
   * 「直後の打鍵可能文字と同じ扱い」にする ("!Nwo" の ! を落とさないため。
   * 範囲を slice するだけだと範囲先頭より前の記号が拾えない)。
   * 連続した空白は 1 つに畳む。日本語のようにフレーズが区切りスペースを
   * 含まない場合、確定後にプレイヤーが打つ区切りが毎回積み上がるため。
   */
  private static rebuildInputValue(
    inputVal: string,
    rawIndex: number[],
    keep: (normIdx: number) => boolean,
  ): string {
    let kept = "";
    let mi = 0; // rawIndex 上の位置 = 次の打鍵可能文字
    let pending = ""; // 判定待ちの記号
    for (let i = 0; i < inputVal.length; i++) {
      if (mi < rawIndex.length && rawIndex[mi] === i) {
        if (keep(mi)) {
          kept += pending + inputVal[i];
        }
        pending = "";
        mi++;
      } else {
        pending += inputVal[i];
      }
    }
    // 末尾の記号は直前の判定に従う (最後の打鍵可能文字が残ったなら残す)
    if (pending && rawIndex.length > 0 && keep(rawIndex.length - 1)) {
      kept += pending;
    }
    // 先頭に残った空白は意味を持たない (フレーズ境界のスペースとして
    // どのみち読み飛ばされる) ので取り除く
    return kept.replace(/\s{2,}/g, (m) => m[0]).replace(/^\s+/, "");
  }

  /**
   * ロスト直前のフレーズ群に対し、入力中のマッチ分 (部分一致・大小違い含む) を
   * 確定して採点し、その分を入力欄から取り除く。
   * 5 行を超えて歌詞が流れたときに、打ちかけの進捗を無駄にしないための救済。
   *
   * リプレイでは呼ばない: ここで積む commitEventLog / phraseResultLog が
   * 記録に残り、リプレイはその記録イベントを適用するので二重にならない。
   */
  private static commitPendingForLostPhrases(
    lostItems: Chart["lyric"][number][],
  ): void {
    const status = this.lrcStatus;
    if (!status) return;
    const inputEl = document.getElementById(
      "text-input",
    ) as HTMLInputElement | null;
    if (!inputEl || !inputEl.value) return;

    const inputVal = inputEl.value;
    const { text: inputStr, map: rawIndex } =
      stripUntypeableInputWithMap(inputVal);
    if (!inputStr) return;

    const { steps } = this.resolveInput(inputStr);
    const lostSet = new Set(lostItems);
    const targets = steps.filter((st) => lostSet.has(st.item));
    if (targets.length === 0) return;

    // 消費された正規化インデックスの集合 (入力欄から取り除く分)
    const removed = new Set<number>();
    for (const st of targets) {
      const t_ms = this.getReplayTimeMs();
      const phraseIndex = this.lyricIndexMap.get(st.item) ?? -1;
      this.commitEventLog.push({
        t_ms,
        phrase_index: phraseIndex,
        chunks: st.mergedSegments.map((segs) =>
          segs.map((ch) => ({ ...ch, committed: true })),
        ),
        is_cleared: st.isFullyCleared,
        is_perfect: st.isFullyCleared && st.isPerfect,
      });
      this.applyScoreEvent(
        st.item,
        st.mergedSegments,
        st.isFullyCleared,
        st.isPerfect,
      );
      this.phraseResultLog.push({
        t_ms,
        phrase_index: phraseIndex,
        chunks: st.mergedSegments.map((segs) =>
          segs.map((ch) => ({ status: ch.status, len: ch.len })),
        ),
        is_cleared: st.isFullyCleared,
        is_perfect: st.isFullyCleared && st.isPerfect,
        score: get(this.score),
        typing_speed: get(this.typingSpeed),
      });
      for (let i = st.consumed[0]; i < st.consumed[1]; i++) removed.add(i);
    }

    inputEl.value = this.rebuildInputValue(
      inputVal,
      rawIndex,
      (i) => !removed.has(i),
    );
    // 残った入力のプレビューを張り直す (value 代入では input イベントが出ない)
    this.checkInput(inputEl.value);
  }

  /**
   * @param opts.clearedOnly 完全クリアしたフレーズだけを確定し、
   *   入力欄はそのフレーズが使った分だけ削る (タイプミスは残す)。
   *   省略時は未完成フレーズの進捗も確定して入力欄を空にする (Enter 用)。
   */
  static handleInput(
    inputVal: string,
    inputEl?: HTMLInputElement,
    opts?: { clearedOnly?: boolean },
  ) {
    // 内部処理は正規化後の文字列で行い、入力欄へ書き戻すときは map で
    // 元の文字 (記号・全角・曲線アポストロフィ) を復元する
    const { text: inputStr, map: rawIndex } =
      stripUntypeableInputWithMap(inputVal);

    if (!this.lrcStatus) return;
    const status = this.lrcStatus;

    // プレビュー（checkInput）と同じ resolveInput で解決し、その結果を確定・採点する。
    const { steps, keptRanges } = inputStr
      ? this.resolveInput(inputStr)
      : { steps: [], keptRanges: [] as [number, number][] };
    // 即時確定は resolveInput が「消費した」ステップと同じ条件で選ぶ。
    // ここがずれると、確定していないフレーズの文字まで入力欄から消えてしまう。
    const targets = opts?.clearedOnly
      ? steps.filter((s) => s.isFullyCleared && s.addedAllText)
      : steps;

    // clearedOnly は毎キーストローク呼ばれる。確定するフレーズが無いときに
    // previewMatches を消すと、直前に checkInput が張ったプレビューが
    // 毎回消えて歌詞が白いままになるので、何もせず帰る。
    if (opts?.clearedOnly && targets.length === 0) return;

    status.previewMatches.clear();

    if (!inputStr) return;

    let anyMatch = false;

    for (const step of targets) {
      const t_ms = this.getReplayTimeMs();
      const phraseIndex = this.lyricIndexMap.get(step.item) ?? -1;
      const chunksForLog = step.mergedSegments.map((segs) =>
        segs.map((ch) => ({ ...ch, committed: true })),
      );
      this.commitEventLog.push({
        t_ms,
        phrase_index: phraseIndex,
        chunks: chunksForLog,
        is_cleared: step.isFullyCleared,
        is_perfect: step.isFullyCleared && step.isPerfect,
      });

      this.applyScoreEvent(
        step.item,
        step.mergedSegments,
        step.isFullyCleared,
        step.isPerfect,
      );

      // applyScoreEvent でスコアが更新された後にスナップショットを取得
      this.phraseResultLog.push({
        t_ms,
        phrase_index: phraseIndex,
        chunks: step.mergedSegments.map((segs) =>
          segs.map((ch) => ({ status: ch.status, len: ch.len })),
        ),
        is_cleared: step.isFullyCleared,
        is_perfect: step.isFullyCleared && step.isPerfect,
        score: get(this.score),
        typing_speed: get(this.typingSpeed),
      });

      anyMatch = true;
    }

    if (anyMatch && inputEl) {
      if (opts?.clearedOnly) {
        // 確定した分だけ削り、タイプミスは元の文字のまま残す
        const keptNormIdx = new Set<number>();
        for (const [a, b] of keptRanges) {
          for (let i = a; i < b; i++) keptNormIdx.add(i);
        }
        const kept = this.rebuildInputValue(inputVal, rawIndex, (i) =>
          keptNormIdx.has(i),
        );
        inputEl.value = kept;
        // value の代入では input イベントが出ないため、残った入力の
        // プレビューをここで張り直す
        this.checkInput(kept);
        return;
      }
      inputEl.value = "";
    }
    status.needsUpdate = true;
  }

  static showResult() {
    const status = this.lrcStatus;
    if (!status) return;
    if (status.unClearLrcs.length > 0 && !get(this.replayMode)) {
      // リザルトへ入る前に、入力中のマッチ分 (部分一致・大小違い含む) を採点する。
      // grace 満了や Shift+Enter の強制終了で、打ちかけの進捗が捨てられないように。
      // スクロールアウト時のロスト救済と同じ処理 (完全クリアに至ったフレーズは
      // unClearLrcs から外れるので、下のロスト集計に入らない)。
      this.commitPendingForLostPhrases([...status.unClearLrcs]);
    }
    if (status.unClearLrcs.length > 0) {
      this.lostCount.update((n) => n + status.unClearLrcs.length);
      // 統計: 未クリアのまま完走したフレーズを lost として記録
      for (const item of status.unClearLrcs) {
        const idx = this.lyricIndexMap.get(item);
        if (idx !== undefined) this.lostPhraseIndices.push(idx);
        // ロスト確定: まだ打たれていない残りの分を上限から差し引く
        this.addForfeitedRemainder(item, status.clearedStatus.get(item) ?? []);
      }
    }

    this.stopped = true;
    this.gamePhase.set("result");

    // 統計: 完走プレイをフラッシュ（カウンタ加算 + play_logs 記録）
    this.flushPlayStats({ finish: true });
  }

  // 1プレイ分の統計を /api/stats/play へ送る。プレイ終了の各契機
  // （retry / showResult / beforeunload）から呼ぶ。playActive ガードで
  // 同一プレイの二重送信を防ぐ。リプレイ再生中・statsContext 未設定なら記録しない。
  static flushPlayStats(
    opts: { retry?: boolean; finish?: boolean; viaBeacon?: boolean } = {},
  ) {
    if (!this.playActive) return;
    const ctx = this.statsContext;
    // 記録対象外（リプレイ再生中 / statsContext 未設定）なら、再処理しないよう
    // 閉じてから抜ける。判定を playActive=false より先に行うことで、設定順序が
    // 変わってもプレイが静かに破棄されにくくする。
    if (get(this.replayMode) || !ctx) {
      this.playActive = false;
      return;
    }
    this.playActive = false;

    // keyCounts はプレイ単位（load()→init() でリセット済）。
    // Click / CompositionEnd の疑似キーは打鍵数・キー別から除外する。
    const kc = get(this.keyCounts);
    const keyCounts: Record<string, number> = {};
    let keystrokes = 0;
    for (const [k, n] of Object.entries(kc)) {
      if (k === "Click" || k === "CompositionEnd") continue;
      keyCounts[k] = n;
      keystrokes += n;
    }

    let playMs = 0;
    try {
      playMs = Math.max(0, Math.round(this.getCurrentTimeSec() * 1000));
    } catch {
      playMs = 0;
    }

    const payload = {
      chart_id: ctx.chartId,
      source: ctx.source,
      retry: opts.retry ? 1 : 0,
      finish: opts.finish ? 1 : 0,
      keystrokes,
      play_ms: playMs,
      key_counts: keyCounts,
      lost_phrases: opts.finish ? [...this.lostPhraseIndices] : [],
      score: opts.finish ? Math.round(get(this.score)) : null,
    };

    if (
      opts.viaBeacon &&
      typeof navigator !== "undefined" &&
      typeof navigator.sendBeacon === "function"
    ) {
      navigator.sendBeacon(
        "/api/stats/play",
        new Blob([JSON.stringify(payload)], { type: "application/json" }),
      );
    } else {
      fetch("/api/stats/play", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {});
    }
  }

  static serializeReplayForSubmit() {
    // 0=text 1=reading 2=reading-loose 3=text-loose。
    // 既存リプレイは 0/1 しか持たないので後方互換
    const enc = (s: MatchStatus): 0 | 1 | 2 | 3 =>
      s === 'text' ? 0 : s === 'reading' ? 1 : s === 'reading-loose' ? 2 : 3;
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
        const base: [0 | 1 | 2 | 3, number] = [enc(ch.status), ch.len];
        return ch.committed === true ? ([...base, 1] as [0 | 1, number, 1]) : base;
      }));
      return [ev.t_ms, ev.phrase_index, trimTrailing(segs), ev.is_cleared ? 1 : 0, ev.is_perfect ? 1 : 0];
    });

    // phrase_result: [t, i, ch, c, p, sc, sp]
    const phrase_results = this.phraseResultLog.map(ev => {
      const segs = ev.chunks.map(seg => seg.map(ch => [enc(ch.status), ch.len] as [0 | 1 | 2 | 3, number]));
      return [ev.t_ms, ev.phrase_index, trimTrailing(segs), ev.is_cleared ? 1 : 0, ev.is_perfect ? 1 : 0, ev.score, ev.typing_speed];
    });

    return { key_events, commit_events, phrase_results };
  }

  static startReplay(replayData: {
    key_events: ([string, number] | [string, number, number])[];
    commit_events: [number, number, ([0|1, number] | [0|1, number, 1])[][], 0|1, 0|1][];
    phrase_results: [number, number, [number, number][][], 0|1, 0|1, number, number][];
    name: string;
    final_score: number;
  }) {
    // 未知の値は reading 相当に寄せる (将来値が増えても再生は壊さない)
    const dec = (n: number): MatchStatus =>
      n === 0
        ? 'text'
        : n === 2
          ? 'reading-loose'
          : n === 3
            ? 'text-loose'
            : 'reading';
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
    this.replayKeyDisplayDimmed.set(false);
    this.replayKeyDisplayPendingClear = false;
  }

  // リプレイ中に任意時刻 (秒) へシークする。
  // 仮想 tick で 0→T を早送りして状態を再構築し、実オーディオを T にセットして再生再開する。
  static async seekReplay(targetSec: number) {
    if (!this.chart || !this.audio) return;
    if (!get(this.replayMode)) return;
    if (this.virtualMode) return; // 連続シーク防止

    const duration = this.audio.duration || 0;
    // ended 時は HTMLAudio だと paused=true になるため、「再生が終端到達で止まった」
    // 状態も再生中として扱う (シークバック後に再開しないと固まって見える)。
    // grace 域への強制シーク中 (forceEnded) も同様に再生中扱い。
    const wasPlaying = !this.audio.paused || this.audio.ended || this.forceEnded;
    this.audio.pause();

    // --- 状態リセット (chart / replay 系は保持) ---
    this.lrcStatus = new LyricStatus(this.chart.lyric);
    this._rebuildLyricStatusMeta();

    this.score.set(0);
    this.earnedBaseScore.set(0);
    this.forfeitedBaseScore.set(0);
    this.perfectCount.set(0);
    this.readingMatchCount.set(0);
    this.lostCount.set(0);
    this.typingSpeed.set(0);
    this.replayKeyDisplayLog.set([]);
    this.replayKeyDisplayDimmed.set(false);
    this.replayKeyDisplayPendingClear = false;
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
    // 終端 ±END_SEEK_EPS への物理シークは行わない。YouTube は終端ちょうど/以深への
    // seekTo で先頭に巻き戻ることがあるため、終端付近〜grace 域は「メディアはその場で
    // 停止したまま、論理状態 (forceEnded + graceStartTime) だけ進める」方式にする。
    if (targetSec < duration - this.END_SEEK_EPS) {
      // 曲中への通常シーク
      this.forceEnded = false;
      this.audio.currentTime = targetSec;
      this.replaySeekGuard = targetSec;
      this.graceStartTime = 0;
      this.gamePhase.set('playing');
      if (wasPlaying) {
        try { await this.audio.play(); } catch {}
      }
    } else {
      // 終端付近または grace 域へのシーク: 曲は終了扱いにして grace タイマーだけ合わせる
      // (残り2秒で +5s なら grace の 3 秒経過地点 = 残り2秒、の統一タイムライン)
      this.forceEnded = true;
      this.replaySeekGuard = null; // メディアを動かさないので収束待ちは不要
      const graceMs = Math.max(0, (targetSec - duration) * 1000);
      // performance.now() が小さい (ページ読込直後の) タイミングでは減算が 0 以下になり、
      // 「graceStartTime > 0」の未開始判定と衝突して grace 時刻計算が無効化されるため 1 で下限を取る
      this.graceStartTime = Math.max(1, performance.now() - graceMs);
      this.gamePhase.set('grace');
      // play() しない: ended 状態の media に play() すると先頭から再生されるため。
      // grace の進行は tick が performance.now() ベースで行う。
    }
  }

  /** リプレイを画面遷移なしで最初から再生し直す (通常プレイの F4 リトライ相当) */
  static async restartReplay() {
    if (!this.chart || !this.audio) return;
    if (!get(this.replayMode)) return;
    // リザルト画面からの再スタートでは tick ループが止まっているため再開が必要
    const needTick = this.stopped;
    this.stopped = false;
    await this.seekReplay(0);
    try { await this.audio.play(); } catch {}
    if (needTick) this.tick();
  }

  static async retry() {
    if (!this.chart) return;
    // 統計: リトライで破棄されるプレイをフラッシュ（retry として加算）
    this.flushPlayStats({ retry: true });
    this.stopped = true;
    // リプレイ再生からの retry に備えてリプレイ状態を解除する。
    // これを怠ると replayMode が残り、次の start() で入力ハンドラが
    // 登録されず「メディアだけ再生されて操作不能」になる。
    document.removeEventListener('keydown', this.replayKeydownHandler);
    if (get(this.replayMode)) {
      this.replayMode.set(false);
      this.replayUsername.set(null);
      this.replayFinalScore.set(0);
      this.replayKeyEvents = [];
      this.replayCommitEvents = [];
      this.replayPhraseResults = [];
    }
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
    // keydown は document に登録しているのでここで外す
    document.removeEventListener("keydown", this.keydownHandler as EventListener);
    const input = document.getElementById("text-input");
    if (input) {
      input.removeEventListener("input", this.inputHandler as EventListener);
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
      if (this.audio.ended || this.forceEnded || allCleared) {
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
      // grace 中の連続シークでも位置が進む/戻るよう、論理時刻 (duration + grace 経過) を起点にする。
      // audio.currentTime 起点だと grace 中は常に duration が起点になり、
      // シークのたびに grace がリセットされて進捗が巻き戻るバグになる。
      const cTime = this.getCurrentLogicalSec();
      const delta = e.code === 'ArrowRight' ? 5 : -5;
      const dur = this.audio.duration || 0;
      const target = Math.max(0, Math.min(cTime + delta, dur + this.GRACE_DURATION));
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
      // document で受けるためフォーカス位置に依存せず入力欄を引く
      // (入力欄が無い/空なら handleInput 側で何も起きない)
      const input = document.getElementById(
        "text-input",
      ) as HTMLInputElement | null;
      if (input) this.handleInput(input.value, input);
    }

    switch (e.code) {
      case "Enter":
        if (!e.isComposing && e.shiftKey) {
          e.preventDefault();
          // 猶予期間中 or 全フレーズクリア済み → リザルト表示
          const allCleared =
            status.phraseCount >= this.chart.lyric.length &&
            status.unClearLrcs.length === 0;
          if (this.audio.ended || this.forceEnded || allCleared) {
            this.showResult();
            return;
          }
          const nextTime = this.chart.lyric[status.phraseCount]?.time;
          const cTime = this.audio.currentTime;
          if (nextTime && nextTime - cTime >= 0.5) {
            // 終端の危険地帯 (YT の巻き戻り) には物理シークしない
            const dur = this.audio.duration || 0;
            this.audio.currentTime = Math.min(
              nextTime - 0.5,
              Math.max(0, dur - this.END_SEEK_EPS),
            );
          }
        }
        break;
      case "ArrowRight":
        if (e.shiftKey && !e.ctrlKey && !e.isComposing) {
          e.preventDefault();
          this.seekBy(5);
        }
        break;
      case "ArrowLeft":
        if (e.shiftKey && !e.ctrlKey && !e.isComposing && !this.disallowRewind) {
          e.preventDefault();
          this.seekBy(-5);
        }
        break;
    }
  };

  /**
   * 通常プレイの相対シーク (Shift+←→)。タイムラインは [0 〜 曲長+grace] の統一軸。
   * 終端 ±END_SEEK_EPS 〜 grace 域へは物理シークせず (YouTube は終端以深への seekTo で
   * 先頭に巻き戻るため)、メディアはその場で停止し forceEnded + graceStartTime の
   * 論理状態だけを合わせる。残り2秒で +5s なら grace の3秒経過地点になる。
   */
  private static seekBy(deltaSec: number) {
    if (!this.audio) return;
    const dur = this.audio.duration || 0;
    const cur = this.getCurrentLogicalSec();
    const target = Math.max(0, Math.min(cur + deltaSec, dur + this.GRACE_DURATION));
    const wasEndedOrForced = this.audio.ended || this.forceEnded;

    if (target < dur - this.END_SEEK_EPS) {
      // 曲中への通常シーク (grace からの復帰も含む)
      this.forceEnded = false;
      this.graceStartTime = 0;
      this.graceProgress.set(0);
      this.gamePhase.set("playing");
      this.audio.currentTime = target;
      // grace/終了状態から曲中へ戻った場合のみ再生を再開する
      // (曲中で一時停止して開始したシークは停止状態を維持)
      if (wasEndedOrForced) {
        try { this.audio.play(); } catch { /* 自動再生制限などは無視 */ }
      }
    } else {
      // 終端付近〜grace 域へのシーク: メディアは触らず終了扱いにする
      this.audio.pause();
      this.forceEnded = true;
      const graceMs = Math.max(0, (target - dur) * 1000);
      // performance.now() が小さい時間帯の負値対策で 1 を下限にする
      this.graceStartTime = Math.max(1, performance.now() - graceMs);
      this.gamePhase.set("grace");
    }
  }

  static tick() {
    Tick.on(() => this.tickStep());
  }

  private static tickStep(): boolean {
      if (this.stopped) return false;
      if (!this.audio) return false;

      let audioTime = this.getCurrentTimeSec();
      // 歌詞表示タイミング補正 (設定)。正の値で歌詞が遅く出るよう、時刻を巻き戻す。
      // 表示・入力可能期間・記録時刻すべてに同じ値を掛けることで、
      // 見えているものと打鍵対象、そしてリプレイの再現が一致する。
      const offsetTime = this.timeOffsetSec();

      // YouTube の seekTo(0) は非同期。seek 完了まで audioTime を 0 に強制する。
      // audioTime が 0.5s を下回ったら seek 完了とみなしてフラグを解除する。
      if (!this.virtualMode && this.seekGuard) {
        if (audioTime < 0.5) {
          this.seekGuard = false;
        } else {
          audioTime = 0;
        }
      }

      // リプレイシーク完了待ち: メディアが目標時刻へ到達するまで audioTime を固定する
      if (!this.virtualMode && this.replaySeekGuard !== null) {
        if (Math.abs(audioTime - this.replaySeekGuard) < 0.5) {
          this.replaySeekGuard = null;
        } else {
          audioTime = this.replaySeekGuard;
        }
      }

      // grace 域への強制シーク中: メディアは曲中で停止したままなので、
      // 表示時刻と行ライフサイクル計算には終端時刻を使う
      if (!this.virtualMode && this.forceEnded) {
        audioTime = this.audio.duration || audioTime;
      }

      // 歌詞を遅らせている場合、曲の終わり際に置かれたフレーズは
      // 「曲終了時点の実時刻 - 遅延」までしか到達せず出現しないまま終わってしまう。
      // grace 中は遅延分を上限に時刻を進め、末尾のフレーズも必ず出せるようにする。
      // (遅延 0 の既定では加算されず従来どおり終端で凍結する)
      const lyricDelaySec = -offsetTime;
      if (
        !this.virtualMode &&
        lyricDelaySec > 0 &&
        this.graceStartTime > 0 &&
        this.getAudioEnded()
      ) {
        const graceSec = Math.max(
          0,
          (performance.now() - this.graceStartTime) / 1000,
        );
        audioTime += Math.min(graceSec, lyricDelaySec);
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

        // キーイベントとコミットイベントは実時刻順にマージして処理する。
        // 別々のループで「コミット全部 → キー全部」と処理すると、同じ tick に入った
        // 「フレーズを打ち切った最後のキー(t=1000)」より「確定(t=1005)」が先に処理され、
        // 最後のキーが表示される前に薄表示化 + 次フレーズの打ち始めと誤認されてしまう。
        // 同時刻はキーを先に処理する (確定はそのキーの結果なので)。
        let keyAdvanced = false;
        while (true) {
          const nextKey =
            this.replayKeyEventCursor < this.replayKeyEvents.length
              ? this.replayKeyEvents[this.replayKeyEventCursor]
              : null;
          const nextCommit =
            this.replayCommitEventCursor < this.replayCommitEvents.length
              ? this.replayCommitEvents[this.replayCommitEventCursor]
              : null;
          const keyDue = nextKey !== null && nextKey.t_ms <= t_ms;
          const commitDue = nextCommit !== null && nextCommit.t_ms <= t_ms;
          if (!keyDue && !commitDue) break;

          if (keyDue && (!commitDue || nextKey!.t_ms <= nextCommit!.t_ms)) {
            const ev = nextKey!;
            // フレーズ確定後の最初のキーで薄表示中の履歴を破棄して溜め直す。
            // ただし採点待ちフレーズが無い間の入力 (Shift+Enter スキップ等) は
            // 「次のフレーズのための入力」とみなさず、破棄しない。
            const startsNextPhrase =
              this.replayKeyDisplayPendingClear && status.unClearLrcs.length > 0;
            this.replayKeyDisplayLog.update(log => {
              const base = startsNextPhrase ? [] : log;
              const next = [...base, { t_ms: ev.t_ms, code: ev.code, ime: ev.ime, repeat: ev.repeat ?? false, shift: ev.shift ?? false, ctrl: ev.ctrl ?? false }];
              return next.length > this.REPLAY_KEY_DISPLAY_MAX
                ? next.slice(-this.REPLAY_KEY_DISPLAY_MAX)
                : next;
            });
            if (startsNextPhrase) {
              this.replayKeyDisplayPendingClear = false;
              this.replayKeyDisplayDimmed.set(false);
            }
            this.replayKeyEventCursor++;
            keyAdvanced = true;
          } else {
            const commitEv = nextCommit!;
            this.applyCommitEvent(commitEv);
            this.replayCommitEventCursor++;
            // 歌詞フレーズをクリアしたら、確定済み入力を薄表示に切り替え、
            // 次のフレーズの打ち始めで履歴を消して新しく溜め直す
            if (commitEv.is_cleared) {
              this.replayKeyDisplayPendingClear = true;
              this.replayKeyDisplayDimmed.set(true);
              hasChange = true;
            }
          }
        }
        if (keyAdvanced) hasChange = true;

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

        let skippedPhrases = status.unClearLrcs.filter(
          (u) => u.line === removedLine,
        );
        if (skippedPhrases.length > 0 && !get(this.replayMode)) {
          // ロスト前に、入力中のマッチ分 (部分一致・大小違い含む) を採点して
          // 入力欄から取り除く。完全クリアに至ったフレーズはロスト扱いにしない
          this.commitPendingForLostPhrases(skippedPhrases);
          skippedPhrases = skippedPhrases.filter((u) =>
            status.unClearLrcs.includes(u),
          );
        }
        if (skippedPhrases.length > 0) {
          this.lostCount.update((n) => n + skippedPhrases.length);
          // 統計: 画面外へスクロールして未クリアのまま消えたフレーズを lost として記録
          for (const item of skippedPhrases) {
            const idx = this.lyricIndexMap.get(item);
            if (idx !== undefined) this.lostPhraseIndices.push(idx);
            // ロスト確定: まだ打たれていない残りの分を上限から差し引く
            this.addForfeitedRemainder(item, status.clearedStatus.get(item) ?? []);
          }
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
