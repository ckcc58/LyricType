import { writable, get } from "svelte/store";
import { settings } from "$lib/settings";

export let volume = writable<number>(get(settings).volume);

/** 歌詞表示タイミングを変更した直後に入力欄へ一時表示する値 (秒)。null で非表示 */
export let lyricDelayHint = writable<number | null>(null);

/**
 * ホーム画面にドロップされた譜面フォルダの受け渡し用。
 * 遷移先 (エディタ / ローカルプレイ) が読み取ったら null に戻す。
 * File オブジェクトは URL で渡せないためストア経由にしている。
 *
 * dirHandle は File System Access API のフォルダハンドル。
 * エディタでの保存先 (読み込んだフォルダへの上書き) に使うので一緒に引き回す。
 * ハンドルは構造化複製できても URL には載せられないため、これもストア経由になる。
 */
export let pendingChartFolder = writable<{
  name: string;
  files: File[];
  dirHandle?: FileSystemDirectoryHandle | null;
} | null>(null);

export let imageURL = writable<string>("");
export let media = writable<{ url: string; type: string; videoId?: string }>({ url: "", type: "" });