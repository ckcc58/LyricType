import { writable, get } from "svelte/store";
import { settings } from "$lib/settings";

export let volume = writable<number>(get(settings).volume);

export let imageURL = writable<string>("");
export let media = writable<{ url: string; type: string; videoId?: string }>({ url: "", type: "" });