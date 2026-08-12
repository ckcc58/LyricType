// 譜面プレビュー再生の共有ロジック。
// 譜面一覧 (ホーム) と chart/[id] の「その他の譜面」で同じ挙動を使う。
//
// 同時に鳴らすのは 1 つだけ。再生中の譜面を再度押すと止まる。

/** プレビューに必要な最低限の譜面情報 */
export type PreviewChart = {
  id: number;
  title: string;
  youtube_video_id: string | null;
  preview_time: number | null;
};

/** 「今どれを再生しているか」を持つ状態。ページごとに 1 つ作る */
export function createPreviewState() {
  let playingId = $state<number | null>(null);

  return {
    get id(): number | null {
      return playingId;
    },
    /** 指定譜面が再生中か */
    isPlaying(chartId: number): boolean {
      return playingId === chartId;
    },
    stop(): void {
      playingId = null;
    },
    /**
     * 再生/停止を切り替える。
     * 一覧のサムネや行はリンクの中にあるので、遷移を止めるため既定動作を抑止する。
     */
    toggle(e: MouseEvent, chart: PreviewChart): void {
      if (!chart.youtube_video_id) return;
      e.preventDefault();
      e.stopPropagation();
      playingId = playingId === chart.id ? null : chart.id;
    },
    /**
     * Esc で停止する。止めたら true を返すので、
     * 呼び出し側は他の Esc 処理を行うかどうかを判断できる。
     */
    handleEscape(e: KeyboardEvent): boolean {
      if (e.key !== "Escape" || playingId === null) return false;
      e.preventDefault();
      playingId = null;
      return true;
    },
  };
}

export type PreviewState = ReturnType<typeof createPreviewState>;
