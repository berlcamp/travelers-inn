"use client";

import { useState, useTransition } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

// Confirmation for destructive/irreversible actions. onConfirm may be async;
// the dialog stays open with the action disabled until it settles.
//
// Usually it owns its own open state and is opened by its `trigger`. It can
// also be driven from outside (`open` + `onOpenChange`, and no trigger), which
// is what a control that decides WHICH question to ask needs — the booking
// status dropdown picks a transition first and then opens this. Such a caller
// must render it as a SIBLING of the menu, not inside it: a menu item is
// unmounted the moment the menu dismisses, taking the dialog with it.
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel = "Confirm",
  onConfirm,
  open: openProp,
  onOpenChange,
}: {
  // The element itself becomes the trigger (Base UI render pattern). Omitted
  // when the caller opens the dialog itself.
  trigger?: React.ReactElement<Record<string, unknown>>;
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm: () => void | Promise<void>;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const controlled = openProp !== undefined;
  const open = controlled ? openProp : uncontrolledOpen;

  function setOpen(next: boolean) {
    if (!controlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
  }

  function handleConfirm() {
    startTransition(async () => {
      await onConfirm();
      setOpen(false);
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      {trigger ? <AlertDialogTrigger render={trigger} /> : null}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={pending} onClick={handleConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
