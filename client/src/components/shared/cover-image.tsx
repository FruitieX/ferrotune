"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";
import { Music, User, Disc } from "lucide-react";

interface CoverImageProps {
  src?: string | null;
  alt: string;
  type?: "album" | "artist" | "song" | "playlist";
  size?: "sm" | "md" | "lg" | "xl" | "full";
  className?: string;
  priority?: boolean;
}

const sizeClasses = {
  sm: "w-10 h-10",
  md: "w-14 h-14",
  lg: "w-24 h-24",
  xl: "w-48 h-48",
  full: "w-full aspect-square",
};

const iconSizes = {
  sm: "w-4 h-4",
  md: "w-6 h-6",
  lg: "w-10 h-10",
  xl: "w-16 h-16",
  full: "w-1/3 h-1/3",
};

export function CoverImage({
  src,
  alt,
  type = "album",
  size = "md",
  className,
  priority = false,
}: CoverImageProps) {
  const Icon = type === "artist" ? User : type === "song" ? Music : Disc;
  const isRound = type === "artist";

  return (
    <div
      className={cn(
        "relative bg-muted overflow-hidden shrink-0",
        isRound ? "rounded-full" : "rounded-md",
        sizeClasses[size],
        className
      )}
    >
      {src ? (
        <Image
          src={src}
          alt={alt}
          fill
          className="object-cover"
          sizes={
            size === "full"
              ? "(max-width: 640px) 100vw, 50vw"
              : size === "xl"
                ? "192px"
                : size === "lg"
                  ? "96px"
                  : "56px"
          }
          priority={priority}
          unoptimized
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-muted">
          <Icon className={cn("text-muted-foreground", iconSizes[size])} />
        </div>
      )}
    </div>
  );
}

// Gradient placeholder for large images
interface CoverGradientProps {
  seed?: string;
  className?: string;
}

export function CoverGradient({ seed = "", className }: CoverGradientProps) {
  // Generate gradient colors from seed string
  const hash = seed.split("").reduce((acc, char) => {
    return char.charCodeAt(0) + ((acc << 5) - acc);
  }, 0);

  const hue1 = Math.abs(hash % 360);
  const hue2 = (hue1 + 40) % 360;

  return (
    <div
      className={cn(
        "w-full aspect-square rounded-md",
        className
      )}
      style={{
        background: `linear-gradient(135deg, hsl(${hue1}, 70%, 30%) 0%, hsl(${hue2}, 60%, 20%) 100%)`,
      }}
    />
  );
}
