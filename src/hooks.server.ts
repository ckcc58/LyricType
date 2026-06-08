import { handle as authHandle } from './auth';
import { sequence } from '@sveltejs/kit/hooks';
import type { Handle } from '@sveltejs/kit';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';

const profileHandle: Handle = async ({ event, resolve }) => {
	const session = await event.locals.auth();
	const supabase = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

	event.locals.supabase = supabase;

	if (session?.user?.id) {
		const { data: profile } = await supabase
			.from('users')
			.select('id, handle, name, role')
			.eq('auth_id', session.user.id)
			.single();

		event.locals.user = session.user;
		event.locals.profile = profile ?? null;

		// ログイン済みだがプロフィール未設定の場合、プロフィール必須ページはセットアップへ
		const path = event.url.pathname;
		const requiresProfile = path.startsWith('/user');
		if (!profile && requiresProfile) {
			return Response.redirect(new URL('/auth/setup', event.url.origin), 303);
		}
	} else {
		event.locals.user = null;
		event.locals.profile = null;
	}

	return resolve(event);
};

export const handle = sequence(authHandle, profileHandle);
