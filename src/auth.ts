import { SvelteKitAuth } from '@auth/sveltekit';
import Google from '@auth/sveltekit/providers/google';
import { AUTH_SECRET, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET } from '$env/static/private';
import type { DefaultSession } from '@auth/core/types';

declare module '@auth/core/types' {
	interface Session {
		user: { id: string } & DefaultSession['user'];
	}
}

export const { handle, signIn, signOut } = SvelteKitAuth({
	providers: [
		Google({
			clientId: AUTH_GOOGLE_ID,
			clientSecret: AUTH_GOOGLE_SECRET,
			profile(profile) {
				return {
					id: profile.sub
				};
			}
		})
	],
	secret: AUTH_SECRET,
	trustHost: true,
	callbacks: {
		jwt({ token, account }) {
			if (account?.provider === 'google') {
				token.sub = account.providerAccountId;
			}
			delete token.email;
			delete token.name;
			delete token.picture;
			return token;
		},
		session({ session, token }) {
			if (token.sub) session.user.id = token.sub;
			delete (session.user as Partial<typeof session.user>).email;
			delete (session.user as Partial<typeof session.user>).name;
			delete session.user.image;
			return session;
		}
	}
});
