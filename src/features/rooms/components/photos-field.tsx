"use client";

import { useRef, useState } from "react";
import { useFieldArray, type Control } from "react-hook-form";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, ImagePlus, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { uploadRoomTypePhoto } from "@/features/rooms/actions";
import type { RoomTypeFormValues } from "@/features/rooms/schemas";

// Gallery editor. Order in the array is the display order — the first photo is
// the cover and is mirrored onto room_types.image_url when the form is saved.
// Reorder uses buttons rather than drag-and-drop: keyboard-accessible, and far
// less code to get right.
export function PhotosField({ control }: { control: Control<RoomTypeFormValues> }) {
  const photos = useFieldArray({ control, name: "photos" });
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow re-picking the same file
    if (files.length === 0) return;

    setUploading(true);
    for (const file of files) {
      const data = new FormData();
      data.set("file", file);
      const result = await uploadRoomTypePhoto(data);
      if (result.ok) {
        photos.append({ url: result.data.url, storage_path: result.data.storage_path });
      } else {
        // Surfaced per-file rather than aborting the loop, so one bad file in
        // a multi-select doesn't silently drop the rest.
        toast.error(`${file.name}: ${result.error}`);
      }
    }
    setUploading(false);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Photos</span>
        <span className="text-muted-foreground text-xs">
          The first photo is the cover · JPEG, PNG, or WebP up to 5 MB
        </span>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={onPick}
      />

      <div className="grid grid-cols-3 gap-2">
        {photos.fields.map((field, i) => (
          <div
            key={field.id}
            className="border-border group relative aspect-4/3 overflow-hidden rounded-lg border"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={(field as unknown as { url: string }).url}
              alt={`Room photo ${i + 1}`}
              className="size-full object-cover"
            />
            {i === 0 ? (
              <span className="bg-primary text-primary-foreground absolute left-1.5 top-1.5 rounded px-1.5 py-0.5 text-[0.65rem] font-medium">
                Cover
              </span>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              size="icon-sm"
              className="absolute right-1.5 top-1.5"
              aria-label={`Remove photo ${i + 1}`}
              onClick={() => photos.remove(i)}
            >
              <X className="size-3.5" />
            </Button>
            <div className="absolute inset-x-1.5 bottom-1.5 flex justify-between">
              <Button
                type="button"
                variant="secondary"
                size="icon-sm"
                disabled={i === 0}
                aria-label={`Move photo ${i + 1} earlier`}
                onClick={() => photos.move(i, i - 1)}
              >
                <ChevronLeft className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="icon-sm"
                disabled={i === photos.fields.length - 1}
                aria-label={`Move photo ${i + 1} later`}
                onClick={() => photos.move(i, i + 1)}
              >
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          </div>
        ))}

        <Button
          type="button"
          variant="outline"
          className="text-muted-foreground aspect-4/3 h-auto flex-col gap-1.5 border-dashed"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? (
            <>
              <Loader2 className="size-5 animate-spin" />
              <span className="text-xs">Uploading…</span>
            </>
          ) : (
            <>
              <ImagePlus className="size-5" />
              <span className="text-xs">Add photos</span>
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
