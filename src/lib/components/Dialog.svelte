<script lang="ts">
  import type { Snippet } from 'svelte';

  type Props = {
    open: boolean;
    title: string;
    primaryLabel: string;
    secondaryLabel?: string;
    primaryDisabled?: boolean;
    onPrimary: () => void | Promise<void>;
    onClose: () => void;
    /** Enter キーで主アクションを発火 (input でも有効) */
    submitOnEnter?: boolean;
    children?: Snippet;
  };

  let {
    open,
    title,
    primaryLabel,
    secondaryLabel = 'キャンセル',
    primaryDisabled = false,
    onPrimary,
    onClose,
    submitOnEnter = true,
    children,
  }: Props = $props();

  function onKey(e: KeyboardEvent) {
    if (!submitOnEnter) return;
    if (e.key !== 'Enter') return;
    if (e.shiftKey || e.ctrlKey || e.metaKey || e.isComposing) return;
    // textarea は改行優先
    const tgt = e.target as HTMLElement | null;
    if (tgt?.tagName === 'TEXTAREA') return;
    if (primaryDisabled) return;
    e.preventDefault();
    void onPrimary();
  }

  function onOverlayClick() {
    if (primaryDisabled) return;
    onClose();
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="dialog-overlay" onclick={onOverlayClick}></div>
  <div
    class="dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="dialog-title"
    onkeydown={onKey}
  >
    <h2 id="dialog-title" class="dialog-title">{title}</h2>
    <div class="dialog-body">
      {#if children}{@render children()}{/if}
    </div>
    <div class="dialog-actions">
      <button class="dialog-btn primary" onclick={onPrimary} disabled={primaryDisabled}>
        {primaryLabel}
      </button>
      <button class="dialog-btn secondary" onclick={onClose} disabled={primaryDisabled}>
        {secondaryLabel}
      </button>
    </div>
  </div>
{/if}

<style>
  /* TT-MOD準拠: 暗黒背景・アウトラインボタン */
  .dialog-overlay {
    position: fixed;
    inset: 0;
    background: rgba(255, 255, 255, 0.05);
    z-index: 998;
  }
  .dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background-color: rgba(0, 0, 0, 0.96);
    border: 2px solid #f5f5f5;
    padding: 18px 22px;
    width: min(460px, calc(100vw - 32px));
    z-index: 999;
    color: #fff;
    display: flex;
    flex-direction: column;
    gap: 16px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.7);
    font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
  }
  .dialog-title {
    margin: 0;
    font-size: 1.05rem;
    color: #fff;
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  .dialog-body {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .dialog-actions {
    display: flex;
    gap: 10px;
    justify-content: flex-start;
  }
  .dialog-btn {
    user-select: none;
    border: 1.5px solid transparent;
    padding: 8px 22px;
    font-size: 0.9rem;
    font-weight: 600;
    line-height: 1.25;
    border-radius: 2px;
    cursor: pointer;
    transition: all 0.15s ease-in-out;
    background: transparent;
    background-image: none;
  }
  .dialog-btn.primary {
    color: #56e576;
    border-color: #56e576;
  }
  .dialog-btn.primary:hover:not(:disabled) {
    color: #fff;
    background-color: rgba(86, 229, 118, 0.7);
    border-color: rgba(86, 229, 118, 0.7);
    text-shadow:
      0.5px 0.5px 0 #333, -0.5px -0.5px 0 #333,
      -0.5px 0.5px 0 #333, 0.5px -0.5px 0 #333;
  }
  .dialog-btn.primary:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .dialog-btn.secondary {
    color: #ffc107;
    border-color: #ffc107;
  }
  .dialog-btn.secondary:hover:not(:disabled) {
    color: #fff;
    background-color: rgba(255, 193, 7, 0.65);
    border-color: rgba(255, 193, 7, 0.78);
    text-shadow:
      0.5px 0.5px 0 #333, -0.5px -0.5px 0 #333,
      -0.5px 0.5px 0 #333, 0.5px -0.5px 0 #333;
  }
  .dialog-btn.secondary:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
