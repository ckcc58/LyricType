// テキストエンコーディング変換 (encoding-japanese ラッパ)
import Encoding from "encoding-japanese";

/**
 * File をエンコーディング自動検出 + Unicode変換でテキストとして読み込む。
 * 改行コードは LF に統一する。
 */
export async function readFileAsText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const det = Encoding.detect(new Uint8Array(buf));
  // @ts-ignore - encoding-japanese types are loose
  const text = Encoding.codeToString(
    Encoding.convert(new Uint8Array(buf), "UNICODE", det),
  );
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/** Unicode 文字列を Shift-JIS バイト列にエンコード */
export async function encodeToSjis(text: string): Promise<Uint8Array> {
  const codeArray: number[] = [];
  for (let i = 0; i < text.length; i++) {
    codeArray.push(text.charCodeAt(i));
  }
  // @ts-ignore - encoding-japanese accepts number[]
  return new Uint8Array(Encoding.convert(codeArray, "SJIS", "UNICODE"));
}
