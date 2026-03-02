"use client";

import Image from "next/image";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

interface CoverArtModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  src: string;
  alt: string;
}

export function CoverArtModal({
  open,
  onOpenChange,
  src,
  alt,
}: CoverArtModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-2">
        <VisuallyHidden>
          <DialogTitle>{alt}</DialogTitle>
        </VisuallyHidden>
        <div className="relative w-full aspect-square">
          <Image
            src={src}
            alt={alt}
            className="w-full h-full object-contain rounded"
            fill
            unoptimized
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
