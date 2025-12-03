"use client";

import { ReactNode } from "react";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { CoverImage } from "./cover-image";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface DetailHeaderProps {
  /** Back button behavior */
  showBackButton?: boolean;
  
  /** Image/icon display */
  coverUrl?: string | null;
  coverAlt?: string;
  icon?: LucideIcon;
  iconClassName?: string;
  /** Whether to use circular shape (for artists) */
  circular?: boolean;
  /** Cover size - defaults to 48 (w-48 = 192px) */
  coverSize?: "sm" | "md" | "lg";
  
  /** Gradient color for background */
  gradientColor?: string;
  /** Whether to use blurred cover as background */
  useBlurredBackground?: boolean;
  
  /** Text content */
  label?: string;
  title: string;
  subtitle?: ReactNode;
  
  /** Optional metadata items */
  metadata?: ReactNode;
  
  /** Additional content in header (e.g., action buttons) */
  headerActions?: ReactNode;
  
  children?: ReactNode;
}

const coverSizes = {
  sm: "w-32 h-32",
  md: "w-48 h-48",
  lg: "w-56 h-56",
};

export function DetailHeader({
  showBackButton = false,
  coverUrl,
  coverAlt = "Cover",
  icon: Icon,
  iconClassName,
  circular = false,
  coverSize = "md",
  gradientColor = "rgba(100,100,100,0.2)",
  useBlurredBackground = false,
  label,
  title,
  subtitle,
  metadata,
  headerActions,
  children,
}: DetailHeaderProps) {
  const router = useRouter();
  
  return (
    <div className="relative">
      {/* Background */}
      <div 
        className="absolute inset-0 h-[300px]"
        style={{
          background: useBlurredBackground && coverUrl 
            ? undefined 
            : `linear-gradient(180deg, ${gradientColor} 0%, rgba(10,10,10,1) 100%)`
        }}
      >
        {useBlurredBackground && coverUrl && (
          <>
            {/* Blurred background image */}
            <div 
              className="absolute inset-0 bg-cover bg-center blur-3xl scale-110 opacity-30"
              style={{ backgroundImage: `url(${coverUrl})` }}
            />
            {/* Gradient overlay */}
            <div 
              className="absolute inset-0"
              style={{ background: "linear-gradient(180deg, transparent 0%, rgba(10,10,10,1) 100%)" }}
            />
          </>
        )}
      </div>

      <div className="relative z-10 px-4 lg:px-6 pt-8 pb-6">
        {/* Back button */}
        {showBackButton && (
          <Button
            variant="ghost"
            size="icon"
            className="mb-4"
            onClick={() => router.back()}
            aria-label="Go back"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
        )}

        <div className="flex items-center gap-6">
          {/* Cover image or icon */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className={cn(
              coverSizes[coverSize],
              circular ? "rounded-full" : "rounded-lg",
              "shadow-xl shrink-0 overflow-hidden"
            )}
          >
            {coverUrl ? (
              <CoverImage
                src={coverUrl}
                alt={coverAlt}
                size="full"
                className={cn("w-full h-full object-cover", circular && "rounded-full")}
              />
            ) : Icon ? (
              <div className={cn(
                "w-full h-full flex items-center justify-center",
                iconClassName || "bg-linear-to-br from-primary/80 to-primary"
              )}>
                <Icon className="w-20 h-20 text-white" />
              </div>
            ) : (
              <div className="w-full h-full bg-muted flex items-center justify-center">
                <span className="text-4xl text-muted-foreground">{title[0]}</span>
              </div>
            )}
          </motion.div>

          {/* Text content */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="flex-1 min-w-0"
          >
            {label && (
              <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                {label}
              </span>
            )}
            <h1 className="text-4xl lg:text-5xl font-bold mt-2 truncate">{title}</h1>
            {subtitle && (
              <div className="mt-4 text-muted-foreground">
                {subtitle}
              </div>
            )}
            {metadata && (
              <div className="mt-2 text-sm text-muted-foreground">
                {metadata}
              </div>
            )}
            {headerActions && (
              <div className="mt-4 flex items-center gap-2">
                {headerActions}
              </div>
            )}
          </motion.div>
        </div>
        
        {children}
      </div>
    </div>
  );
}
