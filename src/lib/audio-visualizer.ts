// HTMLMediaElement を Web Audio に繋いで AnalyserNode を返す。
//
// ローカル譜面の mp3 / mp4 は blob URL (same-origin) なので解析できる。
// YouTube は iframe 越しで音声を取れないため対象外 (呼び出し側で除外する)。
//
// 注意点:
//  - createMediaElementSource() は 1 要素につき 1 回しか呼べない (2 回目は InvalidStateError)
//  - 一度 Web Audio に通した要素は destination へ繋ぎ直さないと無音になる
//  - AudioContext はユーザー操作後でないと running にならない

type Attached = {
  source: MediaElementAudioSourceNode;
  analyser: AnalyserNode;
};

// 解析パラメータ。
// 既定の maxDecibels(-30) は音楽だと常時振り切るので、上限を引き上げて
// バーが天井に張り付かないようにする。
const FFT_SIZE = 1024; // 512 bin。応答性と分解能のバランス
const SMOOTHING = 0.7; // 高いほど滑らか / 低いほど機敏
// 描画側で自動ゲインを掛けるので、ここでは 255 に張り付かせないことだけを狙う
const MIN_DB = -75;
const MAX_DB = -5;

function tune(analyser: AnalyserNode): void {
  analyser.fftSize = FFT_SIZE;
  analyser.smoothingTimeConstant = SMOOTHING;
  analyser.minDecibels = MIN_DB;
  analyser.maxDecibels = MAX_DB;
}

let ctx: AudioContext | null = null;

// 要素ごとの source/analyser。同じ要素で 2 回 createMediaElementSource しないため
const cache = new WeakMap<HTMLMediaElement, Attached>();

// 現在グラフに繋いでいる要素。別要素に張り替えるとき、古いノードを切り離して
// AudioContext のグラフにノードが溜まり続けるのを防ぐ (retry のたびに new Audio される)
let active: { el: HTMLMediaElement; nodes: Attached } | null = null;

/** suspended のままだと音が出なくなるので、次のユーザー操作で resume する */
function resumeOnNextGesture(context: AudioContext): void {
  const onGesture = () => {
    void context.resume();
    document.removeEventListener("pointerdown", onGesture);
    document.removeEventListener("keydown", onGesture);
  };
  document.addEventListener("pointerdown", onGesture);
  document.addEventListener("keydown", onGesture);
}

function connect(el: HTMLMediaElement, nodes: Attached, context: AudioContext) {
  if (active && active.el !== el) {
    active.nodes.source.disconnect();
    active.nodes.analyser.disconnect();
  }
  // 同じノード間の重複接続は仕様上無視されるので、再接続しても安全
  nodes.source.connect(nodes.analyser);
  nodes.analyser.connect(context.destination);
  active = { el, nodes };
}

/**
 * メディア要素を解析用に接続して AnalyserNode を返す。
 * 非対応ブラウザ・接続失敗時は null (音声そのものには影響しない)。
 */
export function attachAnalyser(el: HTMLMediaElement): AnalyserNode | null {
  if (typeof window === "undefined") return null;
  const AC =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;

  try {
    ctx ??= new AC();
    const context = ctx;

    const cached = cache.get(el);
    if (cached) {
      connect(el, cached, context);
    } else {
      const source = context.createMediaElementSource(el);
      const analyser = context.createAnalyser();
      const nodes = { source, analyser };
      cache.set(el, nodes);
      connect(el, nodes, context);
    }

    void context.resume();
    if (context.state !== "running") resumeOnNextGesture(context);

    const analyser = cache.get(el)!.analyser;
    tune(analyser); // 定数を変えたときに既存ノードへも反映されるよう毎回適用する
    return analyser;
  } catch {
    // cross-origin など。ビジュアライザを諦めるだけで再生は継続する
    return null;
  }
}
