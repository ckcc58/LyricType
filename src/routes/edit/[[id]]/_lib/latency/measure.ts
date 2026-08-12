// レイテンシ測定モジュール (behavior/usecase: state mutation あり)
// クリック音を周期的に鳴らし、ユーザーのタップ時刻との差分から平均レイテンシを算出する。
import { player } from "../../_state/player.svelte";
import { updateSetting } from "$lib/settings";

// モジュール内ローカル (非リアクティブ): AudioContext / 周期タイマー / ビート時刻
let latencyCtx: AudioContext | null = null;
let latencyInterval: number | null = null;
let latencyBeatTimes: number[] = [];

/** 表示開始位置と平均値を再計算 (有効タップは最初の3個を捨てる) */
function updateLatencyStats(): void {
  player.latencyDisplayStart = Math.max(0, player.latencyTaps.length - 5);
  if (player.latencyTaps.length <= 3) {
    player.latencyAvg = null;
  } else {
    const valid = player.latencyTaps.slice(3);
    player.latencyAvg = valid.reduce((a, b) => a + b, 0) / valid.length;
  }
}

/** レイテンシ測定を開始 (クリック音を 500ms 周期で鳴らす) */
export function startLatencyTest(): void {
  player.latencyTaps = [];
  latencyBeatTimes = [];
  updateLatencyStats();

  // 多重起動ガード: 測定ボタン連打で前回のタイマーが残ると二重ビートになる
  if (latencyInterval) {
    clearInterval(latencyInterval);
    latencyInterval = null;
  }
  // AudioContext は使い回す。毎回 new すると Chrome の上限 (約6個) に達し、
  // 以後 new が失敗 or suspended になって音が鳴らなくなる
  if (!latencyCtx || latencyCtx.state === "closed") {
    try {
      latencyCtx = new AudioContext();
    } catch {
      latencyCtx = null;
    }
  }
  if (!latencyCtx) return; // 生成失敗時は開始しない (無音のまま計測させない)
  // ボタンクリック起点で呼ばれるためここでの resume は許可される
  if (latencyCtx.state === "suspended") {
    latencyCtx.resume().catch(() => {});
  }
  player.latencyRunning = true;

  latencyInterval = window.setInterval(() => {
    latencyBeatTimes.push(performance.now());

    // クリック音生成
    const osc = latencyCtx!.createOscillator();
    const gain = latencyCtx!.createGain();
    osc.connect(gain);
    gain.connect(latencyCtx!.destination);
    osc.frequency.value = 1000;
    gain.gain.value = 0.9;
    const now = latencyCtx!.currentTime;
    osc.start(now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    osc.stop(now + 0.08);

    player.latencyBeatOn = true;
    setTimeout(() => (player.latencyBeatOn = false), 100);
  }, 500);
}

/** Esc / Space / n のキー入力ハンドラ */
export function handleLatencyKeydown(e: KeyboardEvent): void {
  if (!player.showLatencyTest) return;
  if (e.code === "Escape") {
    e.preventDefault();
    closeLatencyTest();
    return;
  }
  if (e.code !== "Space" && e.code !== "KeyV" && e.code !== "KeyB" && e.code !== "KeyN") return;
  if (!player.latencyRunning || latencyBeatTimes.length === 0) return;
  e.preventDefault();
  const tapTime = performance.now();
  const lastBeat = latencyBeatTimes[latencyBeatTimes.length - 1];
  const diff = (tapTime - lastBeat) / 1000;
  player.latencyTaps = [...player.latencyTaps, diff];
  updateLatencyStats();
}

/** 測定結果の平均値を timeOffset 設定に反映してダイアログを閉じる */
export function applyLatency(): void {
  if (player.latencyAvg !== null) {
    updateSetting("timeOffset", Math.round(player.latencyAvg * 100) / 100);
  }
  closeLatencyTest();
}

/** timeOffset を 0 に戻す */
export function resetLatencyOffset(): void {
  updateSetting("timeOffset", 0);
}

/** タイマーを止めてダイアログを閉じる。
 *  AudioContext は close せず suspend で温存する (close すると再測定のたびに
 *  new が必要になり、Chrome の生成上限に達して無音になるため使い回す)。 */
export function closeLatencyTest(): void {
  if (latencyInterval) clearInterval(latencyInterval);
  latencyInterval = null;
  if (latencyCtx && latencyCtx.state === "running") {
    latencyCtx.suspend().catch(() => {});
  }
  player.latencyRunning = false;
  player.showLatencyTest = false;
}
