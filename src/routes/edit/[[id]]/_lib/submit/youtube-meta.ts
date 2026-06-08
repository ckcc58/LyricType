// YouTube メタデータ取得 + 投稿フォーム自動入力 (behavior: state mutation あり)
import { submit } from "../../_state/submit.svelte";

/**
 * `submit.ytVideoId` から YouTube メタデータを取得し、投稿フォームを自動入力する。
 * - title/artist/source/tags を埋める
 * - 既に同じ videoId で取得済みなら何もしない (二重リクエスト防止)
 */
export async function autoFillFromYouTube(): Promise<void> {
  const videoId = submit.ytVideoId.trim();
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return;
  if (videoId === submit.lastAutoFilledId) return;
  submit.isAutoFilling = true;
  submit.autoFillError = "";
  try {
    const res = await fetch(`/api/youtube-meta/${videoId}`);
    const result = await res.json();
    if (!res.ok) {
      submit.autoFillError = result.error || "取得に失敗しました";
      return;
    }
    submit.lastAutoFilledId = videoId;
    if (result.title && !submit.title) submit.title = result.title;
    if (result.artist) submit.artist = result.artist;
    submit.source = result.source ?? submit.source;

    // タグ自動セット
    // 優先タグ (公式動画・カバー・MAD)
    const priorityTags: string[] = [];
    if (result.isOfficialVideo) priorityTags.push("公式動画");
    if (result.isCover && !result.isMAD) priorityTags.push("カバー");
    if (result.isMAD) priorityTags.push("MAD");

    // 言語タグ (特別枠: 通常枠の上限に関係なく追加)
    const langTag: string | null =
      result.songLanguage === "en"
        ? "英語"
        : result.songLanguage === "en-ja"
          ? "英語&日本語"
          : null;

    // title/artist/source に含まれる語句を後回しにしてソート
    const knownStrings = [result.title, result.artist, result.source]
      .filter(Boolean)
      .map((s: string) => s.toLowerCase());
    const isRedundant = (tag: string): boolean => {
      const t = tag.toLowerCase();
      return knownStrings.some((s: string) => s.includes(t) || t.includes(s));
    };
    const sorted = [...(result.suggestedTags ?? [])].sort(
      (a: string, b: string) =>
        (isRedundant(a) ? 1 : 0) - (isRedundant(b) ? 1 : 0),
    );

    // 通常枠: 優先タグ + otherTags で最大3件
    const autoTags: string[] = [...priorityTags];
    for (const t of sorted) {
      if (autoTags.length >= 3) break;
      if (!autoTags.includes(t)) autoTags.push(t);
    }

    // 言語タグを特別枠として追加
    if (langTag && !autoTags.includes(langTag)) autoTags.push(langTag);

    submit.tags = autoTags;
    submit.suggestedTags = sorted.filter((t: string) => !autoTags.includes(t));
  } catch {
    submit.autoFillError = "通信エラーが発生しました";
  } finally {
    submit.isAutoFilling = false;
  }
}
