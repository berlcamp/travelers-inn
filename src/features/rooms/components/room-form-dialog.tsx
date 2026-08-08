"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FormInput, FormSelect, FormTextarea } from "@/components/shared/form-fields";
import { roomSchema, type RoomFormValues, type RoomInput } from "@/features/rooms/schemas";
import { saveRoom } from "@/features/rooms/actions";
import type { Room, RoomType } from "@/features/rooms/repository";

function defaults(room?: Room): RoomFormValues {
  return {
    id: room?.id,
    room_type_id: room?.room_type_id ?? "",
    label: room?.label ?? "",
    notes: room?.notes ?? "",
  };
}

export function RoomFormDialog({
  trigger,
  room,
  roomTypes,
}: {
  trigger: React.ReactElement<Record<string, unknown>>;
  room?: Room;
  roomTypes: RoomType[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const form = useForm<RoomFormValues, unknown, RoomInput>({
    resolver: zodResolver(roomSchema),
    defaultValues: defaults(room),
  });

  // Same reason as the room-type dialog: it stays mounted, so `defaultValues`
  // (mount-only) would leave "Add room" pre-filled with the last room saved.
  const seed = useRef(defaults(room));
  useEffect(() => {
    seed.current = defaults(room);
  });
  useEffect(() => {
    if (open) form.reset(seed.current);
  }, [open, form]);

  const typeOptions = roomTypes.map((t) => ({ value: t.id, label: t.name }));

  function onSubmit(values: RoomInput) {
    startTransition(async () => {
      const result = await saveRoom(values);
      if (result.ok) {
        toast.success(room ? "Room updated." : "Room created.");
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{room ? "Edit room" : "Add room"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <FormInput control={form.control} name="label" label="Room label / number" placeholder="101" />
          <FormSelect
            control={form.control}
            name="room_type_id"
            label="Room type"
            options={typeOptions}
            placeholder="Choose a type"
          />
          <FormTextarea
            control={form.control}
            name="notes"
            label="Notes"
            placeholder="Optional (maintenance, quirks…)"
            rows={2}
          />
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
