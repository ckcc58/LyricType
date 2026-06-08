// 譜面投稿 (behavior: state mutation + fetch)
import { chart } from "../../_state/chart.svelte";
import { submit } from "../../_state/submit.svelte";
import { tt } from "../../_state/timetag.svelte";
import { getLrcForSave } from "../lrc/serialize";

/** tt.lines の time タグ位置を軽量に文字列化 (timetag 変更検知用) */
function ttLinesSignature(): string {
  return tt.lines
    .map((l) =>
      l.chars
        .map(
          (c) => `${c.char}:${(c.times ?? []).map((t) => t ?? "").join(",")}`,
        )
        .join("|"),
    )
    .join("\n");
}

/** フォーム + 譜面のスナップショット文字列。未保存変更検知に使う */
export function buildSubmitSnapshot(): string {
  return JSON.stringify({
    lrcText: tt.lrcText,
    tt: ttLinesSignature(),
    repl: chart.chartReplContent,
    title: submit.title,
    artist: submit.artist,
    description: submit.description,
    yt: submit.ytVideoId,
    source: submit.source,
    tags: submit.tags,
  });
}

/** タグを追加 (重複・上限10件チェック付き)。input は常にクリアする。 */
export function addTag(tag: string): void {
  const t = tag.trim();
  if (t && !submit.tags.includes(t) && submit.tags.length < 10) {
    submit.tags = [...submit.tags, t];
  }
  submit.tagInput = "";
}

/** タグを削除 */
export function removeTag(tag: string): void {
  submit.tags = submit.tags.filter((t) => t !== tag);
}

type TtRegenCallbacks = {
  syncLrcToTimeTagLines: () => void;
  generateTtLrc: () => void;
};

/** 譜面を /api/chart に POST または PUT する */
export async function submitChart(cb: TtRegenCallbacks): Promise<void> {
  submit.isSubmitting = true;
  submit.submitError = "";
  cb.syncLrcToTimeTagLines();
  cb.generateTtLrc();

  const lrcRaw = getLrcForSave();
  if (!lrcRaw.trim()) {
    submit.submitError = "LRCデータがありません";
    submit.isSubmitting = false;
    return;
  }

  try {
    const isUpdate = submit.editingChartId !== null;
    const url = isUpdate ? `/api/chart/${submit.editingChartId}` : "/api/chart";
    const method = isUpdate ? "PUT" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lrc_raw: lrcRaw,
        repl_raw: chart.chartReplContent,
        title: submit.title,
        artist: submit.artist,
        description: submit.description,
        youtube_video_id: submit.ytVideoId || undefined,
        source: submit.source,
        tags: submit.tags,
      }),
    });

    const result = await res.json();
    if (!res.ok) {
      submit.submitError =
        result.error ||
        (isUpdate ? "更新に失敗しました" : "投稿に失敗しました");
    } else {
      submit.submittedChartId = isUpdate ? submit.editingChartId : result.id;
      // 「保存済み」状態を更新 (未保存変更フラグをリセット)
      submit.lastSavedSnapshot = buildSubmitSnapshot();
      // 成功表示を 2 秒間出す
      submit.justSubmitted = true;
      setTimeout(() => {
        submit.justSubmitted = false;
      }, 2000);
    }
  } catch {
    submit.submitError = "通信エラーが発生しました";
  }
  submit.isSubmitting = false;
}
