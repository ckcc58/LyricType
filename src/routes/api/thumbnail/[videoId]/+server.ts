import type { RequestHandler } from './$types';

// YouTube動画ID（11文字）の形式チェック
const YT_ID = /^[A-Za-z0-9_-]{11}$/;

// 公開譜面のサムネイルを自ドメインでキャッシュ配信するプロキシ。
// i.ytimg.com から取得し、長期キャッシュヘッダを付けて返す。これにより
// ブラウザ/CDN がキャッシュし、譜面一覧・統計など複数ページで再利用される。
export const GET: RequestHandler = async ({ params, fetch }) => {
	const id = params.videoId;
	if (!YT_ID.test(id)) {
		return new Response('invalid video id', { status: 400 });
	}

	const upstream = `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

	try {
		const res = await fetch(upstream);
		if (!res.ok || !res.body) {
			// 取得失敗時は元URLへリダイレクト（プロキシが届かない環境でも表示は維持）
			return new Response(null, { status: 302, headers: { location: upstream } });
		}
		return new Response(res.body, {
			status: 200,
			headers: {
				'content-type': res.headers.get('content-type') ?? 'image/jpeg',
				// ブラウザ7日・CDN30日キャッシュ。サムネはほぼ不変なので十分長く持つ。
				'cache-control': 'public, max-age=604800, s-maxage=2592000, stale-while-revalidate=86400'
			}
		});
	} catch {
		return new Response(null, { status: 302, headers: { location: upstream } });
	}
};
