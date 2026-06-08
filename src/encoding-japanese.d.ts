declare module "encoding-japanese" {
    export function detect(buf: Uint8Array): string;
    export function convert(data: Uint8Array, to: string, from: string): Uint8Array;
    export function codeToString(data: Uint8Array): string;
}
