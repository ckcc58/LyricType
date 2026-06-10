// メディア再生 (Audio/Video/YouTube) + 波形 + レイテンシ測定の中央ストア

export type DialogSource = {
  type: string;
  label: string;
  url?: string;
  videoId?: string;
};

class PlayerState {
  // メディアソース
  audioSrc = $state<string | null>(null);
  videoSrc = $state<string | null>(null);
  imageSrc = $state<string | null>(null);
  audioMode: "file" | "youtube" = $state("file");
  audioDuration = $state(0);
  // 再生中フラグ (raf ループで更新)。TimeTag のチェック赤表示などリアクティブ参照用。
  isPlaying = $state(false);

  // ソース選択ダイアログ
  showSourceDialog = $state(false);
  dialogSources: DialogSource[] = $state([]);
  // 非リアクティブ: 関数オブジェクトをそのまま保持
  pendingSourceCallback: ((source: DialogSource | null) => void) | null = null;

  // YouTube
  // 非リアクティブ: YT.Playerのメソッドを Svelte5 プロキシ経由で破壊しないため、
  // プレーンなフィールドにする。リアクティブな状態は ytPlayerReady で管理する。
  ytPlayer: YT.Player | null = null;
  ytPlayerReady = $state(false);
  youtubeUrlInput = $state("");
  ytVideoId = $state("");

  // 波形
  waveformData: Float32Array | null = $state(null);
  waveformDecoding = $state(false);
  waveformProgress = $state(0);
  waveformZoom = $state(3);

  // レイテンシ測定
  showLatencyTest = $state(false);
  latencyRunning = $state(false);
  latencyTaps: number[] = $state([]);
  latencyBeatOn = $state(false);
  latencyDisplayStart = $state(0);
  latencyAvg: number | null = $state(null);
}

export const player = new PlayerState();
