"use client";

import { useEffect } from "react";
import { useAtomValue } from "jotai";
import { 
  accentColorAtom, 
  customAccentHueAtom,
  ACCENT_PRESETS,
} from "@/lib/store/ui";

// Generate an SVG favicon with the specified color
const generateFaviconSvg = (color: string): string => {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect x="0" y="0" width="512" height="512" rx="96" fill="${color}"/>
  <g transform="translate(96, 96) scale(13.33)" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none">
    <path d="M9 18V5"/>
    <path d="M21 16V3"/>
    <path d="M9 5l12-2"/>
    <circle cx="6" cy="18" r="3"/>
    <circle cx="18" cy="16" r="3"/>
  </g>
</svg>`;
};

// Helper function for HSL to RGB conversion
const hue2rgb = (p: number, q: number, t: number): number => {
  let tt = t;
  if (tt < 0) tt += 1;
  if (tt > 1) tt -= 1;
  if (tt < 1/6) return p + (q - p) * 6 * tt;
  if (tt < 1/2) return q;
  if (tt < 2/3) return p + (q - p) * (2/3 - tt) * 6;
  return p;
};

// Convert a number to 2-digit hex
const toHex = (x: number): string => {
  const hex = Math.round(x * 255).toString(16);
  return hex.length === 1 ? '0' + hex : hex;
};

// Convert OKLCH hue to a hex color (simplified conversion)
// Uses a fixed lightness and chroma for the favicon
const hueToHex = (hue: number): string => {
  // OKLCH hue maps roughly to HSL hue
  const hslHue = hue;
  const saturation = 75; // Vibrant but not oversaturated
  const lightness = 45; // Medium lightness for good visibility
  
  // Convert HSL to RGB
  const h = hslHue / 360;
  const s = saturation / 100;
  const l = lightness / 100;
  
  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

export function DynamicFavicon() {
  const accentColor = useAtomValue(accentColorAtom);
  const customHue = useAtomValue(customAccentHueAtom);
  
  useEffect(() => {
    // Determine the hue based on accent color
    let hue: number;
    
    if (accentColor === "custom") {
      hue = customHue;
    } else {
      const preset = ACCENT_PRESETS.find(p => p.name === accentColor);
      hue = preset?.hue ?? 45; // Default to rust hue
    }
    
    // Convert hue to hex color
    const hexColor = hueToHex(hue);
    
    // Generate SVG
    const svg = generateFaviconSvg(hexColor);
    
    // Convert to data URL
    const svgBlob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(svgBlob);
    
    // Update favicon
    let link = document.querySelector("link[rel='icon']") as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = url;
    
    // Also update apple-touch-icon if present
    const appleLink = document.querySelector("link[rel='apple-touch-icon']") as HTMLLinkElement | null;
    if (appleLink) {
      appleLink.href = url;
    }
    
    // Cleanup old URL on next update
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [accentColor, customHue]);
  
  return null;
}
