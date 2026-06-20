import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';
import { AUTH_SECRET } from '$env/static/private';

export type Profile = NonNullable<App.Locals['profile']>;

// プロフィールの HMAC 署名付き Cookie キャッシュ。
// hooks.server.ts が毎リクエスト users テーブルを引くのを避けるため、
// 取得結果を短期 Cookie に保存して TTL 内は DB アクセスをスキップする。
// role が認可(admin 判定)に使われるため、改ざん検知できるよう署名する。
// プロフィール作成・更新時は clearProfileCookie() で即時バストする。

export const PROFILE_COOKIE = 'lt_profile';
const TTL_SECONDS = 300;

type CookiePayload = {
	// 他アカウントの Cookie をリプレイできないよう auth_id を含めて検証する
	aid: string;
	exp: number;
	// プロフィール未作成ユーザーも DB 再照会せず済むよう null を区別して保持する
	p: Profile | null;
};

function sign(data: string): string {
	return createHmac('sha256', AUTH_SECRET).update(data).digest('base64url');
}

export function readProfileCookie(
	cookies: Cookies,
	authId: string
): { profile: Profile | null } | undefined {
	const raw = cookies.get(PROFILE_COOKIE);
	if (!raw) return undefined;

	const dot = raw.lastIndexOf('.');
	if (dot < 0) return undefined;
	const data = raw.slice(0, dot);
	const sig = raw.slice(dot + 1);

	const expected = sign(data);
	const a = Buffer.from(sig);
	const b = Buffer.from(expected);
	if (a.length !== b.length || !timingSafeEqual(a, b)) return undefined;

	let payload: CookiePayload;
	try {
		payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf-8'));
	} catch {
		return undefined;
	}

	if (payload.aid !== authId) return undefined;
	if (typeof payload.exp !== 'number' || payload.exp < Date.now() / 1000) return undefined;

	return { profile: payload.p ?? null };
}

export function writeProfileCookie(cookies: Cookies, authId: string, profile: Profile | null) {
	const payload: CookiePayload = {
		aid: authId,
		exp: Math.floor(Date.now() / 1000) + TTL_SECONDS,
		p: profile
	};
	const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
	cookies.set(PROFILE_COOKIE, `${data}.${sign(data)}`, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: true,
		maxAge: TTL_SECONDS
	});
}

export function clearProfileCookie(cookies: Cookies) {
	cookies.delete(PROFILE_COOKIE, { path: '/' });
}
