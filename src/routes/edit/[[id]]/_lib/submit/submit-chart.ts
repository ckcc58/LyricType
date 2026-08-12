// 譜面投稿 (behavior: state mutation + fetch)
import { chart } from "../../_state/chart.svelte";
import { submit } from "../../_state/submit.svelte";
import { tt } from "../../_state/timetag.svelte";
import { player } from "../../_state/player.svelte";
import { getLrcForSubmit } from "../lrc/serialize";

/** プレイヤーから実曲長 (秒) を取得。未ロード時は undefined (サーバ側で歌詞末尾から近似) */
function getMediaDurationSec(): number | undefined {
  let d = 0;
  if (player.audioMode === "youtube") {
    d = player.ytPlayer?.getDuration?.() ?? 0;
  }
  if (!(d > 0)) d = player.audioDuration;
  return Number.isFinite(d) && d > 0 ? d : undefined;
}

/**
 * 投稿するプレビュー開始位置 (秒)。
 * 入力が数値でなければ (空欄・不正値) 歌詞の最初のタイムタグ時刻を使う。
 * タイムタグも無ければ undefined を返し、サーバ側の既定に委ねる。
 */
function getPreviewTimeSec(): number | undefined {
  const v = Number(submit.previewTime.trim());
  if (Number.isFinite(v) && v >= 0 && submit.previewTime.trim() !== "") {
    return Math.round(v * 100) / 100;
  }
  const m = chart.lrcContent.match(/\[(\d\d):(\d\d):(\d\d)\]/);
  if (!m) return undefined;
  return Math.round((+m[1] * 60 + +m[2] + +m[3] / 100) * 100) / 100;
}

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
    previewTime: submit.previewTime,
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

  // DB にはヘッダ/フッタを含めない従来形式 (@ytid + 本体) で投稿する
  const lrcRaw = getLrcForSubmit();
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
        duration_seconds: getMediaDurationSec(),
        preview_time: getPreviewTimeSec(),
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
