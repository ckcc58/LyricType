// ファイル保存・ダウンロード (behavior: state 読み取り + ブラウザ I/O)
//
// File System Access API が使える場合はピッカーで保存先を選ばせ、
// 未対応ブラウザでは <a download> によるダウンロードにフォールバックする。
import { chart } from "../../_state/chart.svelte";
import { tt } from "../../_state/timetag.svelte";
import { submit } from "../../_state/submit.svelte";
import { ui } from "../../_state/ui.svelte";
import { encodeToSjis } from "./encoding";
import { getLrcForSave } from "../lrc/serialize";
import { parseLyric } from "$lib/parseLyric/parse-chart";

/** ファイル名として安全な形に整形 */
function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_");
}

/** Blob を <a download> でダウンロードさせる */
function triggerDownload(data: BlobPart, mimeType: string, filename: string): void {
  const blob = new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** chart.chartReplContent を Shift-JIS の .repl.txt として保存 */
export async function downloadChartRepl(): Promise<void> {
  if (!chart.chartReplContent.trim()) return;
  const sjisData = await encodeToSjis(chart.chartReplContent);
  const safeName = sanitizeFilename(submit.loadedTitle || "repl");

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: `${safeName}.repl.txt`,
        types: [
          {
            description: "Repl Text",
            accept: { "text/plain": [".repl.txt", ".txt"] },
          },
        ],
        ...(ui.lastFolderHandle ? { startIn: ui.lastFolderHandle } : {}),
      });
      const writable = await handle.createWritable();
      await writable.write(sjisData);
      await writable.close();
      return;
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") return;
    }
  }

  triggerDownload(sjisData, "application/octet-stream", `${safeName}.repl.txt`);
}

type TtRegenCallbacks = {
  syncLrcToTimeTagLines: () => void;
  generateTtLrc: () => void;
};

/** TT エディタの内容を LRC として保存 */
export async function downloadTtLrc(cb: TtRegenCallbacks): Promise<void> {
  cb.syncLrcToTimeTagLines();
  cb.generateTtLrc();
  if (!tt.lrcText.trim()) return;
  const safeName = sanitizeFilename(submit.loadedTitle || "timetag");
  const lrcData = new TextEncoder().encode(getLrcForSave());

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: `${safeName}.lrc`,
        types: [
          { description: "LRC File", accept: { "text/plain": [".lrc"] } },
        ],
        ...(ui.lastFolderHandle ? { startIn: ui.lastFolderHandle } : {}),
      });
      const writable = await handle.createWritable();
      await writable.write(lrcData);
      await writable.close();
      return;
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") return;
    }
  }

  triggerDownload(getLrcForSave(), "text/plain", `${safeName}.lrc`);
}

/** 現在の譜面を ytyping インポート互換の JSON 文字列にする。
   word(読み) は repl.txt を適用した parseLyric の normalizedReading から生成。 */
function buildYtypingJson(): string {
  const parsed = parseLyric(chart.lrcContent, chart.appliedChartReplContent);

  // line 番号でグループ化し、行単位の time / lyrics / word を組み立てる
  const lineMap = new Map<
    number,
    { time: number; lyrics: string; word: string }
  >();
  for (const p of parsed) {
    const lyrics = p.segments.map((s) => s.text).join("");
    const word = p.segments.map((s) => s.normalizedReading).join("");
    const ex = lineMap.get(p.line);
    if (!ex) {
      lineMap.set(p.line, { time: p.time, lyrics, word });
    } else {
      ex.lyrics += lyrics;
      ex.word += word;
      ex.time = Math.min(ex.time, p.time);
    }
  }

  const lines = [...lineMap.values()].sort((a, b) => a.time - b.time);
  const rows: { time: string; lyrics: string; word: string }[] = [
    { time: "0", lyrics: "", word: "" },
  ];
  for (const l of lines) {
    const t = l.time === 0 ? "0.001" : String(l.time);
    rows.push({ time: t, lyrics: l.lyrics, word: l.word });
  }
  const endTime = parsed.length > 0 ? parsed[parsed.length - 1].endTime : 0;
  rows.push({ time: String(endTime), lyrics: "end", word: "" });

  return JSON.stringify(rows, null, 2);
}

/** ytyping 互換 JSON をクリップボードへコピーする */
export async function copyYtypingJson(cb: TtRegenCallbacks): Promise<void> {
  cb.syncLrcToTimeTagLines();
  cb.generateTtLrc();
  const json = buildYtypingJson();
  await navigator.clipboard.writeText(json);
}

/** フォルダへの書き込み権限を確保する。許可済みならプロンプトは出ない。
 *  requestPermission はユーザー操作直後 (クリックハンドラ内) でのみ通る点に注意。 */
async function ensureWritePermission(
  handle: FileSystemDirectoryHandle,
): Promise<boolean> {
  const h = handle as unknown as {
    queryPermission?: (o: { mode: string }) => Promise<PermissionState>;
    requestPermission?: (o: { mode: string }) => Promise<PermissionState>;
  };
  // 権限 API 非対応なら、実際の書き込みで失敗するかどうかに任せる
  if (!h.queryPermission || !h.requestPermission) return true;
  if ((await h.queryPermission({ mode: "readwrite" })) === "granted")
    return true;
  return (await h.requestPermission({ mode: "readwrite" })) === "granted";
}

/** dirHandle 直下へ .lrc / .repl.txt を書き出す。
 *  ニコ生タイピングの譜面フォルダは「フォルダ名.lrc」「フォルダ名.repl.txt」の
 *  構成が前提なので、ファイル名はフォルダ名から作る。 */
async function writeChartFolder(
  dirHandle: FileSystemDirectoryHandle,
  fallbackName: string,
): Promise<void> {
  const baseName = sanitizeFilename(dirHandle.name) || fallbackName;

  if (tt.lrcText.trim()) {
    const lrcHandle = await dirHandle.getFileHandle(`${baseName}.lrc`, {
      create: true,
    });
    const lrcWritable = await lrcHandle.createWritable();
    await lrcWritable.write(new TextEncoder().encode(getLrcForSave()));
    await lrcWritable.close();
  }

  if (chart.chartReplContent.trim()) {
    const replHandle = await dirHandle.getFileHandle(`${baseName}.repl.txt`, {
      create: true,
    });
    const replWritable = await replHandle.createWritable();
    await replWritable.write(await encodeToSjis(chart.chartReplContent));
    await replWritable.close();
  }
}

/** lrc + repl.txt を譜面フォルダ単位で一括保存
 *  @param chooseFolder true なら読み込み元があっても必ずピッカーを出す */
export async function saveChartFolder(
  cb: TtRegenCallbacks,
  chooseFolder = false,
): Promise<void> {
  cb.syncLrcToTimeTagLines();
  cb.generateTtLrc();
  const safeName = sanitizeFilename(submit.loadedTitle || "chart");

  // 読み込んだ譜面フォルダのハンドルがあれば、ピッカーを出さずそこへ上書きする
  if (!chooseFolder && ui.lastFolderHandle) {
    try {
      if (await ensureWritePermission(ui.lastFolderHandle)) {
        await writeChartFolder(ui.lastFolderHandle, safeName);
        return;
      }
    } catch {
      // 権限拒否・フォルダ移動/削除など → 下のピッカーへフォールバック
    }
  }

  if (window.showDirectoryPicker) {
    try {
      const dirHandle: FileSystemDirectoryHandle =
        await window.showDirectoryPicker({
          mode: "readwrite",
          ...(ui.lastFolderHandle ? { startIn: ui.lastFolderHandle } : {}),
        });
      // 選んだフォルダを以降の保存先にする
      ui.lastFolderHandle = dirHandle;
      await writeChartFolder(dirHandle, safeName);
      return;
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") return;
    }
  }

  // フォールバック: 個別ダウンロード
  if (tt.lrcText.trim()) {
    triggerDownload(getLrcForSave(), "text/plain", `${safeName}.lrc`);
  }
  if (chart.chartReplContent.trim()) {
    triggerDownload(
      await encodeToSjis(chart.chartReplContent),
      "application/octet-stream",
      `${safeName}.repl.txt`,
    );
  }
}
