<script lang="ts">
  // 音声スペクトラム表示 (LED グリッド風)。ローカル譜面の mp3 / mp4 でのみ使う。
  import { onMount } from "svelte";
  import { ChartGame } from "$lib/chart-game.ts";
  import { attachAnalyser } from "$lib/audio-visualizer.ts";

  const CELL_H = 13; // ブロック高さの目安 (px)。段数はここから領域高さで決める
  const ROWS_MIN = 8;
  const ROWS_MAX = 24;
  const CELL_W = 7; // ブロック幅 (px)
  const GAP = 1; // ブロック間の隙間 (px)
  // 以下の追従係数はすべて「60Hz の 1 フレームあたり」の値。
  // 実際には経過時間で正規化するので、リフレッシュレートが違っても同じ速さになる。
  const FRAME_MS = 1000 / 60; // 基準フレーム時間
  const DT_MAX = 4; // タブ復帰などで一気に飛ばないための上限 (フレーム数)

  const PEAK_FALL = 0.008; // ピークマーカーの落下速度 (線形)
  const LEVEL_GAMMA = 1.1; // 大きいほど中間が沈み、動きが大胆になる
  const HIGH_TILT = 1.2; // 高域の持ち上げ。右側が寝たままにならないようにする
  const PEAK_MIX = 0.5; // 帯域内の最大値と平均値の混ぜ具合 (1 で最大値のみ)

  // 表示レベルの時間方向の追従。上がるのは速く、下がるのはゆっくり
  const RISE = 0.4;
  const FALL = 0.08;

  // 自動ゲイン。曲や音量によらず表示域を使い切りつつ、天井に張り付かせない。
  // 固定の dB 窓だと曲ごとに飽和したり寝たりするのでこちらで正規化する。
  const AGC_ATTACK = 0.3; // 基準値が上がるときの追従 (速い)
  const AGC_RELEASE = 0.01; // 下がるときの追従 (遅い = ポンピング防止)
  const AGC_MIN = 0.12; // 無音時に微小ノイズを増幅しないための下限
  const AGC_MARGIN = 1.15; // 最大列でも少し余白を残す

  // 歌詞の可読性を落とさないよう、背景として十分に落とした不透明度にする
  const LIT_ALPHA = 0.19; // 点灯セル
  const PEAK_ALPHA = 0.1; // ピーク保持マーカー
  // 消灯セルは描かない (音が無い所に四角い格子の跡が見えてしまうため)

  let canvasEl: HTMLCanvasElement | undefined = $state();

  onMount(() => {
    // onMount 時点で bind:this は解決済み
    const canvas = canvasEl as HTMLCanvasElement;
    const g = canvas.getContext("2d");
    if (!g) return;

    // 色は DESIGN.md のトークンから取る (生 hex を書かない)
    const base =
      getComputedStyle(canvas).getPropertyValue("--text-primary").trim() ||
      "#eee";
    const rgb = hexToRgb(base);

    let analyser: AnalyserNode | null = null;
    let attachedTo: HTMLMediaElement | null = null;
    let data = new Uint8Array(0);
    let peaks: number[] = [];
    let levels: number[] = []; // 平滑化後の表示レベル
    let raws: number[] = []; // 正規化前の帯域エネルギー
    let agc = 0.5; // 自動ゲインの基準値
    let rafId = 0;
    let lastT = 0; // 前フレームの時刻 (経過時間の正規化用)
    let cssW = 0;
    let cssH = 0;

    // 関数宣言だと巻き上げで g の null 絞り込みが効かないため、すべて const で持つ
    /** ChartGame.audio は retry のたびに差し替わるので、毎フレーム同一性を見る */
    const ensureAnalyser = () => {
      const a = ChartGame.audio;
      if (!(a instanceof HTMLMediaElement) || a === attachedTo) return;
      analyser = attachAnalyser(a);
      attachedTo = a;
      if (analyser) data = new Uint8Array(analyser.frequencyBinCount);
    };

    const resize = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === cssW && h === cssH) return;
      cssW = w;
      cssH = h;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    /** 60Hz 基準の追従係数 k を、dt フレーム分の係数に換算する */
    const followK = (k: number, dt: number) => 1 - Math.pow(1 - k, dt);

    const draw = (now: number) => {
      rafId = requestAnimationFrame(draw);
      // 経過時間を 60Hz のフレーム数に換算する。144Hz でも 60Hz と同じ速さにする
      const dt = lastT > 0 ? Math.min(DT_MAX, (now - lastT) / FRAME_MS) : 1;
      lastT = now;
      ensureAnalyser();
      resize();
      if (cssW <= 0 || cssH <= 0) return;

      const cols = Math.max(1, Math.floor((cssW + GAP) / (CELL_W + GAP)));
      // 段数は領域の高さから決める (背景として使うので高さが可変)
      const ROWS = Math.min(
        ROWS_MAX,
        Math.max(ROWS_MIN, Math.round(cssH / (CELL_H + GAP))),
      );
      const cellH = (cssH - GAP * (ROWS - 1)) / ROWS;
      // 端が余らないよう、実際の間隔は列数から割り戻す
      const stepX = (cssW + GAP) / cols;
      const cellW = stepX - GAP;

      if (peaks.length !== cols) {
        peaks = new Array(cols).fill(0);
        levels = new Array(cols).fill(0);
        raws = new Array(cols).fill(0);
      }

      if (analyser) analyser.getByteFrequencyData(data);
      else data.fill(0);

      g.clearRect(0, 0, cssW, cssH);

      // 高域はほぼ無音なので使う帯域を絞り、対数で列に割り当てる
      const usable = Math.max(2, Math.floor(data.length * 0.62));

      // 1 巡目: 各列の帯域エネルギーを求める
      let frameMax = 0;
      for (let c = 0; c < cols; c++) {
        if (!analyser) {
          raws[c] = 0;
          continue;
        }
        const lo = Math.floor(Math.pow(usable, c / cols));
        const hi = Math.max(lo + 1, Math.floor(Math.pow(usable, (c + 1) / cols)));
        let peak = 0;
        let sum = 0;
        let n = 0;
        for (let i = lo; i < hi && i < data.length; i++) {
          const v = data[i];
          if (v > peak) peak = v;
          sum += v;
          n++;
        }
        // 最大値だけだと単発の強い bin で天井に張り付くので平均を混ぜる
        const avg = n > 0 ? sum / n : 0;
        // 低域が強く高域が弱いので、右へ行くほど持ち上げて見た目を均す
        const tilt = 1 + (c / Math.max(1, cols - 1)) * HIGH_TILT;
        raws[c] = ((peak * PEAK_MIX + avg * (1 - PEAK_MIX)) / 255) * tilt;
        if (raws[c] > frameMax) frameMax = raws[c];
      }

      // 自動ゲインを更新して、その時の最大列がちょうど天井付近になるようにする
      agc +=
        (frameMax - agc) *
        followK(frameMax > agc ? AGC_ATTACK : AGC_RELEASE, dt);
      const scale = 1 / (Math.max(AGC_MIN, agc) * AGC_MARGIN);

      const kRise = followK(RISE, dt);
      const kFall = followK(FALL, dt);
      const peakDrop = PEAK_FALL * dt; // 線形の落下なので dt を掛けるだけ

      // 2 巡目: 正規化 → 時間方向の平滑化 → 描画
      for (let c = 0; c < cols; c++) {
        const target = Math.pow(clamp(raws[c] * scale), LEVEL_GAMMA);
        levels[c] += (target - levels[c]) * (target > levels[c] ? kRise : kFall);
        const level = levels[c];

        peaks[c] = Math.max(level, peaks[c] - peakDrop);

        const lit = Math.round(level * ROWS);
        const peakRow = Math.min(ROWS - 1, Math.round(peaks[c] * ROWS) - 1);
        const x = c * stepX;

        for (let r = 0; r < ROWS; r++) {
          // r=0 が最下段
          const y = cssH - (r + 1) * cellH - r * GAP;
          if (r < lit) {
            // 白の単色。上へ行くほど濃くして高さを分かりやすくする
            const t = r / (ROWS - 1);
            g.fillStyle = rgba(rgb, LIT_ALPHA * (0.55 + 0.45 * t));
          } else if (r === peakRow) {
            g.fillStyle = rgba(rgb, PEAK_ALPHA); // ピーク保持マーカー
          } else {
            continue; // 消灯セルは描かない
          }
          g.fillRect(x, y, cellW, cellH);
        }
      }
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  });

  function clamp(v: number): number {
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  function hexToRgb(hex: string): [number, number, number] {
    const h = hex.replace("#", "");
    const full =
      h.length === 3
        ? h
            .split("")
            .map((c) => c + c)
            .join("")
        : h;
    const n = parseInt(full, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgba([r, g, b]: [number, number, number], alpha: number): string {
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
</script>

<canvas bind:this={canvasEl} class="visualizer" aria-hidden="true"></canvas>

<style>
  /* #play-box (position: relative) の全域の背面に敷く。
     canvas は置換要素なので inset だけでは伸びず固有サイズ (300x150) のまま
     左上に置かれてしまう。width / height を明示すること。 */
  .visualizer {
    position: absolute;
    /* play-box の縁との間に少し余白を空ける */
    top: 8px;
    left: 8px;
    width: calc(100% - 16px);
    height: calc(100% - 16px);
    box-sizing: border-box;
    border-radius: 8px;
    display: block;
    z-index: 0;
    /* 表示専用。クリックは入力欄へ通す */
    pointer-events: none;
  }
</style>
