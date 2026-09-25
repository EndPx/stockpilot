"use client";

import { useEffect, useId, useRef, type RefObject } from "react";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  variant?: "default" | "danger";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  variant = "default",
  busy = false,
  onConfirm,
  onCancel,
  returnFocusRef,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;

    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    if (!dialog.open) dialog.showModal();
    if (!cancelRef.current?.disabled) cancelRef.current?.focus();
    else dialog.focus();

    return () => {
      if (dialog.open) dialog.close();
      const focusTarget = returnFocusRef?.current ?? previousFocusRef.current;
      if (focusTarget?.isConnected) focusTarget.focus();
    };
  }, [open, returnFocusRef]);

  useEffect(() => {
    if (open && busy) dialogRef.current?.focus();
  }, [open, busy]);

  return (
    <dialog
      ref={dialogRef}
      className={`confirm-dialog${variant === "danger" ? " confirm-dialog-danger" : ""}`}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-busy={busy}
      tabIndex={-1}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab" || busy) return;
        if (event.shiftKey && document.activeElement === cancelRef.current) {
          event.preventDefault();
          confirmRef.current?.focus();
        } else if (!event.shiftKey && document.activeElement === confirmRef.current) {
          event.preventDefault();
          cancelRef.current?.focus();
        }
      }}
    >
      <div className="confirm-dialog-body">
        <div>
          <p className="confirm-dialog-kicker">Review change</p>
          <h2 id={titleId} className="confirm-dialog-title">{title}</h2>
          <p id={descriptionId} className="confirm-dialog-description">{description}</p>
        </div>
        <div className="confirm-dialog-actions">
          <button ref={cancelRef} type="button" className="secondary-button" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button ref={confirmRef} type="button" className="button confirm-dialog-confirm" disabled={busy} onClick={onConfirm}>
            {busy ? `${confirmLabel}…` : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
