/*
    ショートカットキーを追加、削除する関数をexport
    色々ショートカットキーを書いていきたい
*/

import { volume } from "../store.ts";
import { settings, updateSetting } from "./settings.ts";
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

function handleKeydown(e: KeyboardEvent){
    switch (e.key) {
        case "ArrowUp":
            if (e.shiftKey) {
                e.preventDefault();
                updateVolume(e.ctrlKey ? 1 : 10);
            }
            break;
        case "ArrowDown":
            if (e.shiftKey) {
                e.preventDefault();
                updateVolume(e.ctrlKey ? -1 : -10);
            }
            break;

    }
}