<script lang="ts">
	import { enhance } from '$app/forms';

	let { form } = $props();
	let loading = $state(false);
</script>

<div class="setup-page">
	<div class="setup-card">
		<h1>名前を設定 <small>(ツイッターっぽいやつ)</small></h1>

		<form method="POST" use:enhance={() => {
			loading = true;
			return async ({ update }) => {
				loading = false;
				await update();
			};
		}}>
			<label>
				<span>ハンドル <em>@</em></span>
				<input
					type="text"
					name="handle"
					required
					minlength="1"
					maxlength="20"
					pattern="[a-zA-Z0-9_]+"
						autocomplete="off"
				/>
				<small>英数字とアンダースコア(_)のみ、1〜20文字。他ユーザーとの重複NG</small>
			</label>

			<label>
				<span>表示名</span>
				<input
					type="text"
					name="name"
					required
					minlength="1"
					maxlength="30"
						autocomplete="off"
				/>
				<small>1〜30文字、日本語も使用可能。実際に表示される名前で、重複もOK</small>
			</label>

			{#if form?.error}
				<p class="error">{form.error}</p>
			{/if}

			<button type="submit" disabled={loading}>
				{loading ? '設定中...' : '設定する'}
			</button>
		</form>
	</div>
</div>

<style>
	.setup-page {
		display: flex;
		justify-content: center;
		align-items: center;
		min-height: calc(100vh - 100px);
		padding: 24px;
	}

	.setup-card {
		background: #1e1e1e;
		border: 1px solid #333;
		border-radius: 12px;
		padding: 40px;
		max-width: 500px;
		width: 100%;
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

	label {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-bottom: 16px;
	}

	label span {
		color: #ccc;
		font-size: 0.85rem;
	}

	label span em {
		color: #4a9eff;
		font-style: normal;
	}

	input {
		padding: 10px 12px;
		border-radius: 6px;
		border: 1px solid #444;
		background: #2a2a2a;
		color: #ddd;
		font-size: 1rem;
	}

	small {
		color: #666;
		font-size: 0.8rem;
	}

	.error {
		color: #ff6b6b;
		background: rgba(255, 107, 107, 0.1);
		border-radius: 6px;
		padding: 8px 12px;
		margin-bottom: 16px;
		font-size: 0.85rem;
	}

	button {
		width: 100%;
		padding: 12px;
		border-radius: 8px;
		border: none;
		background: #4a9eff;
		color: white;
		font-size: 1rem;
		cursor: pointer;
		transition: background 0.15s;
	}

	button:hover:not(:disabled) {
		background: #3a8eef;
	}

	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
