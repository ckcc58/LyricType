import { handle as authHandle } from './auth';
import { sequence } from '@sveltejs/kit/hooks';
import type { Handle } from '@sveltejs/kit';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import {
	readProfileCookie,
	writeProfileCookie,
	clearProfileCookie,
	PROFILE_COOKIE
} from '$lib/server/profile-cookie';

const profileHandle: Handle = async ({ event, resolve }) => {
	const session = await event.locals.auth();
	const supabase = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

	event.locals.supabase = supabase;

	if (session?.user?.id) {
		const authId = session.user.id;

		// 署名付き Cookie にキャッシュ済みなら DB 照会をスキップ（TTL 5分）
		const cached = readProfileCookie(event.cookies, authId);
		let profile: App.Locals['profile'];
		if (cached) {
			profile = cached.profile;
		} else {
			const { data } = await supabase
				.from('users')
				.select('id, handle, name, role')
				.eq('auth_id', authId)
				.single();
			profile = data ?? null;
			writeProfileCookie(event.cookies, authId, profile);
		}

		event.locals.user = session.user;
		event.locals.profile = profile;

		// ログイン済みだがプロフィール未設定の場合、プロフィール必須ページはセットアップへ
		const path = event.url.pathname;
		const requiresProfile = path.startsWith('/user');
		if (!profile && requiresProfile) {
			return Response.redirect(new URL('/auth/setup', event.url.origin), 303);
		}
	} else {
		event.locals.user = null;
		event.locals.profile = null;
		// Set-Cookie を無駄に付けて CDN キャッシュを阻害しないよう、残っている時だけ消す
		if (event.cookies.get(PROFILE_COOKIE)) {
			clearProfileCookie(event.cookies);
		}
	}

	return resolve(event);
};

export const handle = sequence(authHandle, profileHandle);
