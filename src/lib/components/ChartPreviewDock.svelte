<script lang="ts">
  // 譜面プレビューの浮動プレイヤー。
  // サムネ枠に埋め込むと YouTube のプレイヤーが小さすぎて黒帯だらけになるため、
  // 十分な大きさを確保できる固定表示にしている。
  //
  // 音量を設定値に合わせる必要があるので、生の iframe ではなく
  // IFrame Player API で作る (埋め込み URL に音量パラメータは無い)。
  //
  // ※ YouTube 埋め込みは映像の右側に黒帯が出ることがあるが、
  //    他サイトの埋め込みでも同様に起きる YouTube 側の挙動なので対処しない。
  import { type PreviewChart } from "$lib/chart-preview.svelte";
  import { ensureYouTubeIframeApi } from "$lib/youtube-iframe-api";
  import { volume } from "../../store";

  type Props = {
    /** 再生中の譜面。null なら何も出さない */
    chart: PreviewChart | null;
    /** 画面のどこに浮かせるか。一覧が下にあるページは "top" にして重なりを避ける */
    position?: "bottom" | "top";
    onclose: () => void;
  };
  let { chart, position = "bottom", onclose }: Props = $props();

  let host: HTMLDivElement | undefined = $state();
  let player: YT.Player | null = $state(null);

  /** 対象譜面が変わるたびにプレイヤーを作り直す */
  $effect(() => {
    const c = chart;
    const el = host;
    if (!c?.youtube_video_id || !el) return;

    let disposed = false;
    ensureYouTubeIframeApi()
      .then(() => {
        if (disposed) return;
        player = new (window as any).YT.Player(el, {
          videoId: c.youtube_video_id,
          playerVars: {
            autoplay: 1,
            start: Math.max(0, Math.floor(c.preview_time ?? 0)),
            rel: 0,
            modestbranding: 1,
            playsinline: 1,
            // 小さい枠では操作 UI が映像を覆うので全て切る
            // (停止は自前のボタン / Esc)
            controls: 0,
            disablekb: 1,
            fs: 0,
            iv_load_policy: 3,
            cc_load_policy: 0,
          },
          events: {
            onReady: (ev: YT.PlayerEvent) => {
              // 設定の音量を適用してから再生する
              ev.target.setVolume($volume);
              ev.target.playVideo();
            },
          },
        });
      })
      .catch(() => {});

    return () => {
      disposed = true;
      try {
        player?.destroy();
      } catch {
        /* API 未ロードなど */
      }
      player = null;
    };
  });

  /** 設定の音量が変わったら再生中のプレビューにも反映する */
  $effect(() => {
    const v = $volume;
    try {
      player?.setVolume?.(v);
    } catch {
      /* まだ ready でない */
    }
  });
</script>

{#if chart}
  <div class="preview-dock" class:top={position === "top"}>
    <button
      type="button"
      class="preview-dock-close"
      onclick={onclose}
      aria-label="プレビューを閉じる"
      title="閉じる (Esc)">×</button
    >
    <div class="preview-dock-frame">
      <!-- YT.Player がこの要素を iframe に置き換える -->
      <div bind:this={host}></div>
    </div>
  </div>
{/if}

<style>
  .preview-dock {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 100;
    width: min(294px, calc(100vw - 32px));
    background: var(--bg-card);
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.6);
  }
  .preview-dock.top {
    top: 16px;
    bottom: auto;
  }
  /* 閉じるボタンは映像に重ねる。普段は隠し、ポインタを乗せたときだけ出す */
  .preview-dock-close {
    position: absolute;
    top: 6px;
    right: 6px;
    z-index: 1;
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    background: rgba(0, 0, 0, 0.65);
    color: var(--text-primary);
    border: 1px solid rgba(255, 255, 255, 0.45);
    border-radius: 4px;
    font-size: 0.8rem;
    line-height: 1;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s ease;
  }
  .preview-dock:hover .preview-dock-close,
  .preview-dock-close:focus-visible {
    opacity: 1;
  }
  .preview-dock-close:hover {
    background: rgba(0, 0, 0, 0.85);
  }
  .preview-dock-frame {
    display: block;
    width: 100%;
    aspect-ratio: 16 / 9;
  }
  .preview-dock-frame :global(iframe) {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
  }
</style>
