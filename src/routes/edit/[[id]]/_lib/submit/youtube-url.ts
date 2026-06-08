// YouTube URL から videoId を抽出する純関数

/**
 * YouTube の各種 URL 形式から 11文字の videoId を抽出する。
 * 該当しない場合は null を返す。
 *
 * 対応形式:
 * - https://www.youtube.com/watch?v=XXXXXXXXXXX
 * - https://youtu.be/XXXXXXXXXXX
 * - https://www.youtube.com/embed/XXXXXXXXXXX
 */
export function extractYouTubeId(url: string): string | null {
  const m = url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/,
  );
  return m ? m[1] : null;
}
