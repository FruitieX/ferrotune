import type { ImgHTMLAttributes } from "react";

type ImageSource = string | { src: string };

interface ImageProps extends Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  "src" | "alt"
> {
  src: ImageSource;
  alt: string;
  fill?: boolean;
  priority?: boolean;
  unoptimized?: boolean;
}

function normalizeSrc(src: ImageSource): string {
  return typeof src === "string" ? src : src.src;
}

export default function Image({
  src,
  alt,
  fill,
  priority,
  unoptimized: _unoptimized,
  style,
  width,
  height,
  loading,
  decoding,
  ...props
}: ImageProps) {
  return (
    <img
      src={normalizeSrc(src)}
      alt={alt}
      width={fill ? undefined : width}
      height={fill ? undefined : height}
      loading={priority ? "eager" : loading}
      decoding={priority ? "sync" : decoding}
      style={
        fill
          ? {
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              color: "transparent",
              ...style,
            }
          : style
      }
      {...props}
    />
  );
}
