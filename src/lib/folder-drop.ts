// 譜面フォルダのドラッグ&ドロップ共通処理。
// エディタ / ローカルプレイ / ホームで同じ挙動を使うためここに集約する。

/** ディレクトリエントリ配下のファイルを再帰的に集める (サブフォルダも辿る) */
export async function readAllEntries(
  dirEntry: FileSystemDirectoryEntry,
): Promise<File[]> {
  const files: File[] = [];
  function readEntries(
    reader: FileSystemDirectoryReader,
  ): Promise<FileSystemEntry[]> {
    return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
  }
  function fileEntryToFile(entry: FileSystemFileEntry): Promise<File> {
    return new Promise((resolve, reject) => entry.file(resolve, reject));
  }
  async function traverse(entry: FileSystemEntry) {
    if (entry.isFile) {
      files.push(await fileEntryToFile(entry as FileSystemFileEntry));
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      let entries: FileSystemEntry[];
      do {
        entries = await readEntries(reader);
        for (const child of entries) await traverse(child);
      } while (entries.length > 0);
    }
  }
  await traverse(dirEntry);
  return files;
}

export type DroppedFolder = {
  /** フォルダ名 (譜面タイトルの既定値に使う) */
  name: string;
  files: File[];
  /**
   * ドロップ元フォルダの書き込み可能ハンドル (File System Access API)。
   * エディタで「読み込んだフォルダにそのまま保存」するために使う。
   * 非対応ブラウザでは null。
   */
  dirHandle: FileSystemDirectoryHandle | null;
};

/** DataTransferItem から FileSystemDirectoryHandle を取り出す (非対応なら null) */
async function getDirHandle(
  item: DataTransferItem,
): Promise<FileSystemDirectoryHandle | null> {
  if (!("getAsFileSystemHandle" in item)) return null;
  try {
    // @ts-ignore - File System Access API (Chrome/Edge のみ)
    const handle = await item.getAsFileSystemHandle();
    return handle?.kind === "directory"
      ? (handle as FileSystemDirectoryHandle)
      : null;
  } catch {
    return null;
  }
}

/**
 * drop イベントから譜面フォルダを取り出す。
 * フォルダがドロップされていない場合は null を返す。
 */
export async function getDroppedFolder(
  e: DragEvent,
): Promise<DroppedFolder | null> {
  if (!e.dataTransfer?.items) return null;
  for (const item of Array.from(e.dataTransfer.items)) {
    const entry = item.webkitGetAsEntry();
    if (entry?.isDirectory) {
      const dirEntry = entry as FileSystemDirectoryEntry;
      // getAsFileSystemHandle() は item がまだ生きているうちに呼ぶ必要があるため
      // ファイル読み取りより先に取得する
      const dirHandle = await getDirHandle(item);
      return {
        name: dirEntry.name,
        files: await readAllEntries(dirEntry),
        dirHandle,
      };
    }
  }
  return null;
}
