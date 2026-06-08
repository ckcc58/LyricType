// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Session } from '@auth/sveltekit';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			supabase: SupabaseClient;
			auth(): Promise<Session | null>;
			user: { id: string; email?: string | null; name?: string | null; image?: string | null } | null;
			profile: {
				id: number;
				handle: string;
				name: string;
				role: 'user' | 'admin';
			} | null;
		}
		// interface PageData {}
		// interface PageState {}
		interface Platform {}
		interface Env {
			AUTH_GOOGLE_ID: string;
			AUTH_GOOGLE_SECRET: string;
			AUTH_SECRET: string;
			GOOGLE_API_KEY: string;
			SUPABASE_SERVICE_ROLE_KEY: string;
			UPSTASH_REDIS_REST_URL: string;
			UPSTASH_REDIS_REST_TOKEN: string;
			YOUTUBE_API_KEY: string;
		}
	}

	interface FileSystemWritableFileStream extends WritableStream {
		write(data: BufferSource | Blob | string): Promise<void>;
		close(): Promise<void>;
	}

	interface FileSystemFileHandle {
		kind: 'file';
		name: string;
		getFile(): Promise<File>;
		createWritable(): Promise<FileSystemWritableFileStream>;
	}

	interface FileSystemDirectoryHandle {
		kind: 'directory';
		name: string;
		getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>;
		[Symbol.asyncIterator](): AsyncIterableIterator<[string, FileSystemFileHandle | FileSystemDirectoryHandle]>;
	}

	interface Window {
		showDirectoryPicker?: (options?: {
			mode?: 'read' | 'readwrite';
			startIn?: FileSystemDirectoryHandle;
		}) => Promise<FileSystemDirectoryHandle>;
		showSaveFilePicker?: (options?: {
			suggestedName?: string;
			types?: Array<{
				description?: string;
				accept: Record<string, string[]>;
			}>;
			startIn?: FileSystemDirectoryHandle;
		}) => Promise<FileSystemFileHandle>;
	}
}

export {};
