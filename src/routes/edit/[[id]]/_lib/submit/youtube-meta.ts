// YouTube メタデータ取得 + 投稿フォーム自動入力 (behavior: state mutation あり)
import { submit } from "../../_state/submit.svelte";
import { LANGUAGE_TAGS, syncLanguageTag } from "./language-tag";

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

    // title/artist/source に含まれる語句を後回しにしてソート
    const knownStrings = [result.title, result.artist, result.source]
      .filter(Boolean)
      .map((s: string) => s.toLowerCase());
    const isRedundant = (tag: string): boolean => {
      const t = tag.toLowerCase();
      return knownStrings.some((s: string) => s.includes(t) || t.includes(s));
    };
    // 言語タグはコード側の管轄なので、AI が挙げてきても候補から外す
    const sorted = [...(result.suggestedTags ?? [])]
      .filter((t: string) => !LANGUAGE_TAGS.includes(t))
      .sort(
        (a: string, b: string) =>
          (isRedundant(a) ? 1 : 0) - (isRedundant(b) ? 1 : 0),
      );

    // 通常枠: 優先タグ + otherTags で最大3件
    const autoTags: string[] = [...priorityTags];
    for (const t of sorted) {
      if (autoTags.length >= 3) break;
      if (!autoTags.includes(t)) autoTags.push(t);
    }

    // 言語タグ (特別枠: 通常枠の上限に関係なく追加)。
    // 動画情報からの推定ではなく歌詞から判定した現在値を引き継ぐ
    // (タグ列を丸ごと入れ替えるので、ここで入れ直さないと消えてしまう)
    submit.tags = syncLanguageTag(autoTags, submit.lastLanguageTag);
    submit.suggestedTags = sorted.filter((t: string) => !autoTags.includes(t));
  } catch {
    submit.autoFillError = "通信エラーが発生しました";
  } finally {
    submit.isAutoFilling = false;
  }
}
