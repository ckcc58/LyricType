// 公開譜面のサムネイル（YouTube）まわりの共通ヘルパー。
// 譜面一覧・統計など複数箇所で同じURL/フォールバックを使い回すための単一の入口。

// サムネは自ドメインのキャッシュプロキシ(/api/thumbnail/[videoId])経由で配信する。
// プロキシが長期キャッシュヘッダを付けるため、ブラウザ/CDN がキャッシュし、
// ページをまたいで同じURL＝同じキャッシュを再利用できる。
export function chartThumbnailUrl(videoId: string | null | undefined): string | null {
	if (!videoId) return null;
	return `/api/thumbnail/${videoId}`;
}

// YouTubeサムネが無い譜面向けの、id から決定論的に選ぶグラデーション背景。
const GRADIENTS: [string, string][] = [
	['#3b3270', '#1f3b6b'],
	['#5a2a6e', '#7c2a4d'],
	['#7a2440', '#5a1530'],
	['#1a3b5c', '#2a5a7a'],
	['#4a2a6e', '#2a3b7a'],
	['#6e2a55', '#3a1a4a'],
	['#2a4a6e', '#5a3a7a'],
	['#5c2a3a', '#3a1a2a']
];

export function chartGradient(id: number): string {
	const [c1, c2] = GRADIENTS[Math.abs(id) % GRADIENTS.length];
	return `linear-gradient(135deg, ${c1} 0%, ${c2} 100%)`;
}
