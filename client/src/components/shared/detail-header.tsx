"use client";

import { ReactNode, useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { useNavigateBack } from "@/lib/hooks/use-navigate-back";
import { Button } from "@/components/ui/button";
import { CoverImage, stringToHue } from "./cover-image";
import { CoverArtModal } from "./cover-art-modal";
import { Skeleton } from "@/components/ui/skeleton";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface DetailHeaderProps {
  /** Back button behavior */
  showBackButton?: boolean;

  /** Image/icon display */
  coverUrl?: string | null;
  coverAlt?: string;
  /** Color seed for placeholder generation */
  colorSeed?: string;
  icon?: LucideIcon;
  iconClassName?: string;
  /** Cover type for placeholder - artist, album, playlist, smartPlaylist */
  coverType?:
    | "album"
    | "artist"
    | "song"
    | "playlist"
    | "smartPlaylist"
    | "genre";
  /** Whether to use circular shape (for artists) */
  circular?: boolean;
  /** Cover size - defaults to 48 (w-48 = 192px) */
  coverSize?: "sm" | "md" | "lg";
  /** Full-size cover URL for modal preview on click */
  fullSizeCoverUrl?: string | null;

  /** Gradient color for background (used when no cover or not using blurred background) */
  gradientColor?: string;
  /** Whether to use blurred cover as background */
  useBlurredBackground?: boolean;
  /** Background height when using blurred background - defaults to 400px */
  backgroundHeight?: number;

  /** Text content */
  label?: string;
  title: string;
  subtitle?: ReactNode;

  /** Optional metadata items */
  metadata?: ReactNode;

  /** Additional content in header (e.g., action buttons) */
  headerActions?: ReactNode;

  /** Whether the content is loading */
  isLoading?: boolean;

  children?: ReactNode;
}

const _coverSizes = {
  sm: "w-32 h-32",
  md: "w-48 h-48 md:w-56 md:h-56",
  lg: "w-56 h-56",
};

const responsiveCoverSizes = {
  sm: "w-32 h-32",
  md: "w-48 h-48 md:w-56 md:h-56",
  lg: "w-48 h-48 md:w-56 md:h-56",
};

export function DetailHeader({
  showBackButton = false,
  coverUrl,
  coverAlt = "Cover",
  colorSeed,
  icon: Icon,
  iconClassName,
  coverType = "album",
  circular = false,
  coverSize = "md",
  fullSizeCoverUrl,
  gradientColor = "rgba(100,100,100,0.2)",
  useBlurredBackground = false,
  backgroundHeight = 400,
  label,
  title,
  subtitle,
  metadata,
  headerActions,
  isLoading = false,
  children,
}: DetailHeaderProps) {
  const navigateBack = useNavigateBack();
  const [coverModalOpen, setCoverModalOpen] = useState(false);
  const shouldBlur = useBlurredBackground && coverUrl;

  // Generate gradient color from colorSeed if provided, otherwise use gradientColor
  const backgroundGradient = colorSeed
    ? `hsl(${stringToHue(colorSeed)}, 70%, 25%)`
    : gradientColor;

  return (
    <div className="relative">
      {/* Gradient background - always shown */}
      <div
        className="absolute inset-0"
        style={{
          height: `${backgroundHeight}px`,
          background: `linear-gradient(180deg, ${backgroundGradient} 0%, var(--background) 100%)`,
        }}
      />

      {/* Blurred cover overlay - only when cover exists and blur is enabled */}
      {shouldBlur && (
        <div
          className="absolute inset-0 overflow-hidden"
          style={{ height: `${backgroundHeight}px` }}
        >
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `url(${coverUrl})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          >
            {/* Blur and gradient overlay */}
            <div className="absolute inset-0 backdrop-blur-3xl bg-background/60" />
            <div
              className="absolute inset-0"
              style={{
                background: `linear-gradient(180deg, transparent 0%, var(--background) 100%)`,
              }}
            />
          </div>
        </div>
      )}

      {/* Back button */}
      {showBackButton && (
        <div className="relative z-10 p-4 lg:p-6">
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 rounded-full bg-background/50 hover:bg-background/80"
            onClick={() => navigateBack()}
            aria-label="Go back"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
        </div>
      )}

      {/* Main content */}
      <div
        className={cn(
          "relative z-10 flex flex-col md:flex-row gap-6 px-4 lg:px-6 pb-6",
          !showBackButton && "pt-8",
        )}
      >
        {/* Cover image or icon */}
        <motion.div
          initial={coverUrl || isLoading ? { opacity: 0, scale: 0.9 } : false}
          animate={{ opacity: 1, scale: 1 }}
          className={cn(
            responsiveCoverSizes[coverSize],
            circular ? "rounded-full drop-shadow-2xl" : "rounded-lg album-glow",
            "mx-auto md:mx-0 shrink-0",
          )}
        >
          {isLoading ? (
            <Skeleton
              className={cn(
                "w-full h-full",
                circular ? "rounded-full" : "rounded-lg",
              )}
            />
          ) : coverUrl ? (
            <button
              type="button"
              className={cn(
                "w-full h-full block",
                fullSizeCoverUrl && "cursor-zoom-in",
              )}
              onClick={() => fullSizeCoverUrl && setCoverModalOpen(true)}
              disabled={!fullSizeCoverUrl}
            >
              <CoverImage
                src={coverUrl}
                alt={coverAlt}
                colorSeed={colorSeed}
                type={coverType}
                size="full"
                priority
                className={circular ? "rounded-full" : "rounded-lg"}
                showTypeOverlay={coverType === "smartPlaylist"}
              />
            </button>
          ) : Icon ? (
            <div
              className={cn(
                "w-full h-full flex items-center justify-center",
                circular ? "rounded-full" : "rounded-lg",
                iconClassName || "bg-linear-to-br from-primary/80 to-primary",
              )}
            >
              <Icon className="w-20 h-20 text-white" />
            </div>
          ) : (
            <CoverImage
              src={undefined}
              alt={coverAlt}
              colorSeed={colorSeed || title}
              type={coverType}
              size="full"
              priority
              className={circular ? "rounded-full" : "rounded-lg"}
              showTypeOverlay={coverType === "smartPlaylist"}
            />
          )}
        </motion.div>

        {/* Text content */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="flex flex-col justify-end text-center md:text-left"
        >
          {label && (
            <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              {label}
            </span>
          )}
          {isLoading ? (
            <>
              <Skeleton className="h-10 w-64 mt-2" />
              <Skeleton className="h-4 w-56 mt-4 mb-8" />
            </>
          ) : (
            <>
              <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold mt-2 text-foreground">
                {title}
              </h1>
              {subtitle && (
                <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 mt-4 text-sm text-muted-foreground">
                  {subtitle}
                </div>
              )}
              {metadata && (
                <div className="mt-2 text-sm text-muted-foreground">
                  {metadata}
                </div>
              )}
            </>
          )}
          {headerActions && (
            <div className="mt-4 flex items-center justify-center md:justify-start gap-2">
              {headerActions}
            </div>
          )}
        </motion.div>
      </div>

      {children}

      {fullSizeCoverUrl && (
        <CoverArtModal
          open={coverModalOpen}
          onOpenChange={setCoverModalOpen}
          src={fullSizeCoverUrl}
          alt={coverAlt}
        />
      )}
    </div>
  );
}
