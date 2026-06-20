import adapter from '@sveltejs/adapter-auto';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		// adapter-auto は Vercel 上ではインストール済みの @sveltejs/adapter-vercel@5 を使う。
		// ローカル(Windows)では adapter-vercel の出力が symlink 権限の問題で失敗するため、
		// 明示指定ではなく adapter-auto のまま運用する(ローカルビルドでは adapter は no-op)。
		// 重い依存(kuromoji / AI SDK)を持つルートは各 +server.ts 側の
		// `export const config = { split: true }` で個別 Function に分離している。
		adapter: adapter()
	}
};

export default config;
