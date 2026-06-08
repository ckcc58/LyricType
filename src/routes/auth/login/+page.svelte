<script lang="ts">
	let { data } = $props();
</script>

<div class="login-page">
	<div class="login-card">
		<h1>ログイン</h1>
		<p class="subtitle">ログインすると譜面投稿・ランキング登録が出来ます</p>

		<div class="providers">
			<form method="POST" action="?/google">
				<input type="hidden" name="providerId" value="google" />
				<input type="hidden" name="redirectTo" value="/auth/post-login" />
				<button type="submit" class="provider-btn google">
					<svg viewBox="0 0 24 24" width="20" height="20">
						<path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
						<path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
						<path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
						<path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
					</svg>
					Google でログイン
				</button>
			</form>
		</div>
	</div>
</div>

<style>
	.login-page {
		display: flex;
		justify-content: center;
		align-items: center;
		min-height: calc(100vh - 100px);
		padding: 24px;
	}

	.login-card {
		background: #1e1e1e;
		border: 1px solid #333;
		border-radius: 12px;
		padding: 40px;
		max-width: 400px;
		width: 100%;
		text-align: center;
	}

	h1 {
		color: #ddd;
		margin: 0 0 8px;
		font-size: 1.5rem;
	}

	.subtitle {
		color: #888;
		margin: 0 0 32px;
		font-size: 0.9rem;
	}

	.providers {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.privacy-note {
		margin: 0;
		color: #999;
		font-size: 0.78rem;
		line-height: 1.5;
		text-align: left;
	}

	.providers form {
		display: contents;
	}

	.provider-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 10px;
		padding: 12px 20px;
		border-radius: 8px;
		border: 1px solid #444;
		background: #2a2a2a;
		color: #ddd;
		font-size: 0.95rem;
		cursor: pointer;
		transition: background 0.15s;
		width: 100%;
	}

	.provider-btn:hover {
		background: #333;
	}
</style>
