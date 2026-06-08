import { signOut } from '../../../auth';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	await signOut(event);
	return new Response(null, { status: 303, headers: { Location: '/' } });
};
