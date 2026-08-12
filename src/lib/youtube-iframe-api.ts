// YouTube IFrame Player API のローダー。
// ゲーム・エディタ・プレビューが同じスクリプトを共有する。
// onYouTubeIframeAPIReady はグローバルに 1 つしか持てないため、
// 既存のコールバックを引き継いでから resolve する。

let apiPromise: Promise<void> | null = null;

export function ensureYouTubeIframeApi(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("ssr"));
  if ((window as any).YT?.Player) return Promise.resolve();
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(
      "yt-api-script",
    ) as HTMLScriptElement | null;
    const previousReady = (window as any).onYouTubeIframeAPIReady;
    (window as any).onYouTubeIframeAPIReady = () => {
      previousReady?.();
      resolve();
    };

    if (existing) {
      existing.addEventListener(
        "error",
        () => reject(new Error("failed to load YouTube iframe API")),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.id = "yt-api-script";
    script.src = "https://www.youtube.com/iframe_api";
    script.onerror = () =>
      reject(new Error("failed to load YouTube iframe API"));
    document.head.appendChild(script);
  });

  return apiPromise;
}
