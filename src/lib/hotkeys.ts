/*
    ショートカットキーを追加、削除する関数をexport
    色々ショートカットキーを書いていきたい

    ゲーム中のショートカット:
      Ctrl+↑/↓        音量 ±5
      Ctrl+Shift+↑/↓  音量 ±1
      Ctrl+←/→        歌詞表示タイミング ±0.05s
      Ctrl+Shift+←/→  歌詞表示タイミング ±0.01s
*/

import { volume, lyricDelayHint } from "../store.ts";
import {
    settings,
    updateSetting,
    LYRIC_DELAY_MIN,
    LYRIC_DELAY_MAX,
} from "./settings.ts";
import { get } from "svelte/store";

export function addKeyHandler(){
    document.addEventListener("keydown", handleKeydown);
}

export function removeKeyHandler(){
    document.removeEventListener("keydown", handleKeydown);
}

function updateVolume(delta: number) {
    volume.update(current => {
        const v = Math.max(0, Math.min(100, current + delta));
        updateSetting('volume', v);
        return v;
    });
}

// 入力欄への一時表示を消すタイマー
let delayHintTimer: ReturnType<typeof setTimeout> | undefined;

/** 歌詞表示タイミングを delta 秒ずらす (設定の許容範囲でクランプ) */
function updateLyricDelay(delta: number) {
    const next = get(settings).lyricDelay + delta;
    const clamped = Math.min(LYRIC_DELAY_MAX, Math.max(LYRIC_DELAY_MIN, next));
    // 0.05 / 0.01 刻みの加算で誤差が溜まらないよう小数2桁に丸める
    const value = Math.round(clamped * 100) / 100;
    updateSetting('lyricDelay', value);

    // 現在値を入力欄の中央に一時表示する (プレイ中に設定を開かず確認できるように)
    lyricDelayHint.set(value);
    clearTimeout(delayHintTimer);
    delayHintTimer = setTimeout(() => lyricDelayHint.set(null), 1200);
}

function handleKeydown(e: KeyboardEvent){
    // Ctrl 必須。IME 変換中は矢印キーを IME に譲る
    if (!e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return;

    switch (e.key) {
        case "ArrowUp":
            e.preventDefault();
            updateVolume(e.shiftKey ? 1 : 5);
            break;
        case "ArrowDown":
            e.preventDefault();
            updateVolume(e.shiftKey ? -1 : -5);
            break;
        case "ArrowRight":
            e.preventDefault();
            updateLyricDelay(e.shiftKey ? 0.01 : 0.05);
            break;
        case "ArrowLeft":
            e.preventDefault();
            updateLyricDelay(e.shiftKey ? -0.01 : -0.05);
            break;
    }
}
