import { signOut } from '../../../auth';
import type { RequestHandler } from './$types';
import { clearProfileCookie } from '$lib/server/profile-cookie';

export const POST: RequestHandler = async (event) => {
	clearProfileCookie(event.cookies);
	await signOut(event);
	return new Response(null, { status: 303, headers: { Location: '/' } });
};
