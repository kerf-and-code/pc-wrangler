// lib/confirm.ts (push 13, audit L-U1)
//
// askConfirm replaces window.confirm. The browser's grey box looks like a different product, blocks
// the page, cannot style the destructive choice apart from the safe one, and some phones stop showing
// it after it has appeared a few times (then confirm() returns false and the button seems dead).
//
// It returns a promise, so a call site changes from `if (!window.confirm(msg)) return;` to
// `if (!(await askConfirm(msg))) return;`. The dialog itself is components/confirm-host.tsx, mounted
// once in the root layout. If no host is mounted (a page outside the layout, or a test), it falls back
// to window.confirm so nothing is ever silently approved.

export type ConfirmOptions = {
  /** The button that goes ahead. Defaults to the first word of the question ("Delete", "Remove", "End"). */
  confirmLabel?: string;
  /** The button that backs out. Defaults to "Cancel". */
  cancelLabel?: string;
  /** Style the go-ahead button as destructive. Defaults to true for delete, remove, discard and the like. */
  danger?: boolean;
};

export type ConfirmRequest = {
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
  resolve: (ok: boolean) => void;
};

type Host = (req: ConfirmRequest) => void;
let host: Host | null = null;

/** Called by ConfirmHost on mount; returns the unregister function. */
export function registerConfirmHost(h: Host): () => void {
  host = h;
  return () => { if (host === h) host = null; };
}

const DANGER = /^(delete|remove|discard|clear|erase|unlink|revoke|regenerate|replace|unbind|unpublish|reshape|shrink|stop)\b/i;
const VERB = /^(delete|remove|discard|clear|erase|unlink|revoke|regenerate|replace|unbind|unpublish|reshape|shrink|stop|end|reopen|switch|send|make|bind|trace)\b/i;

/** The go-ahead label for a question: its leading verb ("Delete this note?" gives "Delete"), else "Continue". */
export function defaultConfirmLabel(message: string): string {
  const m = VERB.exec(message.trim());
  if (!m) return "Continue";
  const w = m[1].toLowerCase();
  return w.charAt(0).toUpperCase() + w.slice(1);
}

export function isDangerous(message: string): boolean {
  return DANGER.test(message.trim());
}

export function askConfirm(message: string, opts: ConfirmOptions = {}): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (!host) return Promise.resolve(window.confirm(message));
  const h = host;
  return new Promise<boolean>((resolve) => {
    h({
      message,
      confirmLabel: opts.confirmLabel ?? defaultConfirmLabel(message),
      cancelLabel: opts.cancelLabel ?? "Cancel",
      danger: opts.danger ?? isDangerous(message),
      resolve,
    });
  });
}
