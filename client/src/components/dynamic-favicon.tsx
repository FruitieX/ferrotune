"use client";

import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { 
  accentColorAtom, 
  customAccentHueAtom,
  customAccentLightnessAtom,
  customAccentChromaAtom,
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

// Convert a number to 2-digit hex
const toHex = (x: number): string => {
  const clamped = Math.max(0, Math.min(255, Math.round(x * 255)));
  const hex = clamped.toString(16);
  return hex.length === 1 ? '0' + hex : hex;
};

// Convert OKLCH to sRGB hex
// This properly converts OKLCH color space to sRGB for accurate color matching
const oklchToHex = (l: number, c: number, h: number): string => {
  // Convert OKLCH to OKLab (polar to cartesian)
  const hRad = (h * Math.PI) / 180;
  const a = c * Math.cos(hRad);
  const b = c * Math.sin(hRad);
  
  // Convert OKLab to linear sRGB
  // Using the standard OKLab to linear RGB matrix
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.2914855480 * b;
  
  const lCubed = l_ * l_ * l_;
  const mCubed = m_ * m_ * m_;
  const sCubed = s_ * s_ * s_;
  
  // Linear sRGB
  let rLinear = +4.0767416621 * lCubed - 3.3077115913 * mCubed + 0.2309699292 * sCubed;
  let gLinear = -1.2684380046 * lCubed + 2.6097574011 * mCubed - 0.3413193965 * sCubed;
  let bLinear = -0.0041960863 * lCubed - 0.7034186147 * mCubed + 1.7076147010 * sCubed;
  
  // Apply sRGB gamma correction
  const gammaCorrect = (c: number): number => {
    if (c <= 0.0031308) {
      return 12.92 * c;
    }
    return 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  };
  
  const r = gammaCorrect(rLinear);
  const g = gammaCorrect(gLinear);
  const blue = gammaCorrect(bLinear);
  
  return `#${toHex(r)}${toHex(g)}${toHex(blue)}`;
};

export function DynamicFavicon() {
  // Track if we've mounted and waited for atoms to hydrate from localStorage
  const [isReady, setIsReady] = useState(false);
  const accentColor = useAtomValue(accentColorAtom);
  const customHue = useAtomValue(customAccentHueAtom);
  const customLightness = useAtomValue(customAccentLightnessAtom);
  const customChroma = useAtomValue(customAccentChromaAtom);
  
  // Wait for mount plus a microtask to ensure atomWithStorage has hydrated from localStorage
  useEffect(() => {
    // Use requestAnimationFrame to wait for the next frame after React has committed
    // This ensures Jotai's atomWithStorage has read from localStorage
    const frameId = requestAnimationFrame(() => {
      setIsReady(true);
    });
    return () => cancelAnimationFrame(frameId);
  }, []);
  
  useEffect(() => {
    // Don't update favicon until ready to ensure we use localStorage values
    if (!isReady) return;
    
    // Determine OKLCH values based on accent color
    let lightness: number;
    let chroma: number;
    let hue: number;
    
    if (accentColor === "custom") {
      lightness = customLightness;
      chroma = customChroma;
      hue = customHue;
    } else {
      // Match the exact OKLCH values from globals.css for each preset
      const preset = ACCENT_PRESETS.find(p => p.name === accentColor);
      hue = preset?.hue ?? 45;
      
      // Get lightness and chroma from globals.css preset values
      switch (accentColor) {
        case "rust":
          lightness = 0.65;
          chroma = 0.16;
          break;
        case "gold":
          lightness = 0.75;
          chroma = 0.15;
          break;
        case "lime":
          lightness = 0.75;
          chroma = 0.18;
          break;
        case "emerald":
          lightness = 0.65;
          chroma = 0.18;
          break;
        case "teal":
          lightness = 0.7;
          chroma = 0.15;
          break;
        case "ocean":
          lightness = 0.6;
          chroma = 0.16;
          break;
        case "indigo":
          lightness = 0.6;
          chroma = 0.18;
          break;
        case "violet":
          lightness = 0.65;
          chroma = 0.2;
          break;
        case "rose":
          lightness = 0.65;
          chroma = 0.2;
          break;
        case "crimson":
          lightness = 0.6;
          chroma = 0.22;
          break;
        default:
          lightness = 0.65;
          chroma = 0.16;
      }
    }
    
    // Convert OKLCH to hex using proper color space conversion
    const hexColor = oklchToHex(lightness, chroma, hue);
    
    // Generate SVG
    const svg = generateFaviconSvg(hexColor);
    
    // Convert to data URL (more reliable than blob URL for favicons)
    const svgBase64 = btoa(svg);
    const dataUrl = `data:image/svg+xml;base64,${svgBase64}`;
    
    // Update all icon link elements (Next.js may create multiple)
    const iconLinks = document.querySelectorAll("link[rel='icon'], link[rel='shortcut icon']");
    iconLinks.forEach((link) => {
      (link as HTMLLinkElement).href = dataUrl;
    });
    
    // If no icon link exists, create one
    if (iconLinks.length === 0) {
      const link = document.createElement("link");
      link.rel = "icon";
      link.type = "image/svg+xml";
      link.href = dataUrl;
      document.head.appendChild(link);
    }
    
    // Also update apple-touch-icon if present
    const appleLinks = document.querySelectorAll("link[rel='apple-touch-icon']");
    appleLinks.forEach((link) => {
      (link as HTMLLinkElement).href = dataUrl;
    });
  }, [isReady, accentColor, customHue, customLightness, customChroma]);
  
  return null;
}
