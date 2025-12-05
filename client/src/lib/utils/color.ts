/**
 * CSS color parsing and OKLCH conversion utilities.
 * 
 * Supports parsing any valid CSS color format (hex, rgb, hsl, named colors, etc.)
 * and converting to OKLCH color space.
 */

export interface OklchColor {
  l: number; // Lightness: 0-1
  c: number; // Chroma: 0-0.4 (typically)
  h: number; // Hue: 0-360
}

/**
 * Parse any valid CSS color string and convert it to OKLCH.
 * Uses the browser's canvas API to parse colors, so any format the browser supports will work.
 * 
 * Supported formats include:
 * - Hex: #rgb, #rrggbb, #rrggbbaa
 * - RGB: rgb(r, g, b), rgba(r, g, b, a)
 * - HSL: hsl(h, s%, l%), hsla(h, s%, l%, a)
 * - Named colors: red, blue, rebeccapurple, etc.
 * - OKLCH: oklch(l c h) - passed through with parsing
 * 
 * @param colorString - Any valid CSS color string
 * @returns OKLCH color values or null if invalid
 */
export function parseCssColorToOklch(colorString: string): OklchColor | null {
  // First, try to parse OKLCH directly (more accurate than round-tripping through RGB)
  const oklchMatch = colorString.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/i);
  if (oklchMatch) {
    const [, l, c, h] = oklchMatch;
    return {
      l: parseFloat(l),
      c: parseFloat(c),
      h: parseFloat(h),
    };
  }

  // Use canvas to parse any CSS color to RGB
  const rgb = parseCssColorToRgb(colorString);
  if (!rgb) return null;

  // Convert RGB to OKLCH
  return rgbToOklch(rgb.r, rgb.g, rgb.b);
}

/**
 * Parse any CSS color to RGB using the browser's canvas API.
 */
function parseCssColorToRgb(colorString: string): { r: number; g: number; b: number } | null {
  // Create an offscreen canvas to parse the color
  if (typeof document === "undefined") return null;
  
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // Set the color and draw a pixel
  ctx.fillStyle = "#000000"; // Reset to known value
  ctx.fillStyle = colorString;
  
  // If the color didn't change, it was invalid (unless it was actually black)
  if (ctx.fillStyle === "#000000" && colorString.toLowerCase() !== "black" && colorString !== "#000" && colorString !== "#000000") {
    // Double-check by trying a different reset color
    ctx.fillStyle = "#ffffff";
    ctx.fillStyle = colorString;
    if (ctx.fillStyle === "#ffffff") {
      return null; // Definitely invalid
    }
  }

  ctx.fillRect(0, 0, 1, 1);
  const imageData = ctx.getImageData(0, 0, 1, 1).data;

  return {
    r: imageData[0],
    g: imageData[1],
    b: imageData[2],
  };
}

/**
 * Convert sRGB (0-255) to OKLCH.
 * 
 * Pipeline: sRGB → Linear RGB → XYZ (D65) → OKLAB → OKLCH
 */
function rgbToOklch(r: number, g: number, b: number): OklchColor {
  // Normalize to 0-1
  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;

  // sRGB to linear RGB
  const rLin = srgbToLinear(rNorm);
  const gLin = srgbToLinear(gNorm);
  const bLin = srgbToLinear(bNorm);

  // Linear RGB to OKLAB (using the optimized matrix from Björn Ottosson)
  // First, convert to LMS cone responses
  const l_ = 0.4122214708 * rLin + 0.5363325363 * gLin + 0.0514459929 * bLin;
  const m_ = 0.2119034982 * rLin + 0.6806995451 * gLin + 0.1073969566 * bLin;
  const s_ = 0.0883024619 * rLin + 0.2817188376 * gLin + 0.6299787005 * bLin;

  // Apply cube root (approximate cone response)
  const l__ = Math.cbrt(l_);
  const m__ = Math.cbrt(m_);
  const s__ = Math.cbrt(s_);

  // Convert to OKLAB
  const L = 0.2104542553 * l__ + 0.7936177850 * m__ - 0.0040720468 * s__;
  const a = 1.9779984951 * l__ - 2.4285922050 * m__ + 0.4505937099 * s__;
  const okb = 0.0259040371 * l__ + 0.7827717662 * m__ - 0.8086757660 * s__;

  // OKLAB to OKLCH
  const C = Math.sqrt(a * a + okb * okb);
  let H = Math.atan2(okb, a) * (180 / Math.PI);
  if (H < 0) H += 360;

  return {
    l: L,
    c: C,
    h: H,
  };
}

/**
 * Convert sRGB component to linear RGB.
 */
function srgbToLinear(c: number): number {
  if (c <= 0.04045) {
    return c / 12.92;
  }
  return Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Convert linear RGB component to sRGB with gamma correction.
 */
function linearToSrgb(c: number): number {
  if (c <= 0.0031308) {
    return 12.92 * c;
  }
  return 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/**
 * Convert OKLCH to sRGB (0-255).
 * 
 * Pipeline: OKLCH → OKLAB → Linear RGB → sRGB
 */
export function oklchToRgb(l: number, c: number, h: number): { r: number; g: number; b: number } {
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
  const rLinear = +4.0767416621 * lCubed - 3.3077115913 * mCubed + 0.2309699292 * sCubed;
  const gLinear = -1.2684380046 * lCubed + 2.6097574011 * mCubed - 0.3413193965 * sCubed;
  const bLinear = -0.0041960863 * lCubed - 0.7034186147 * mCubed + 1.7076147010 * sCubed;
  
  // Apply sRGB gamma correction and clamp to 0-255
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  
  return {
    r: clamp(linearToSrgb(rLinear)),
    g: clamp(linearToSrgb(gLinear)),
    b: clamp(linearToSrgb(bLinear)),
  };
}

/**
 * Convert OKLCH to CSS rgb() string.
 */
export function oklchToRgbString(l: number, c: number, h: number): string {
  const { r, g, b } = oklchToRgb(l, c, h);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Clamp OKLCH values to the ranges used by our sliders.
 */
export function clampOklchToSliderRanges(color: OklchColor): OklchColor {
  return {
    l: Math.max(0.3, Math.min(0.9, color.l)),
    c: Math.max(0.01, Math.min(0.3, color.c)),
    h: ((color.h % 360) + 360) % 360, // Normalize to 0-360
  };
}

/**
 * Format OKLCH color as a CSS string.
 */
export function formatOklch(color: OklchColor): string {
  return `oklch(${color.l.toFixed(2)} ${color.c.toFixed(2)} ${Math.round(color.h)})`;
}

/**
 * Determine if a given OKLCH lightness value requires a dark foreground for adequate contrast.
 * 
 * Uses WCAG-based heuristics for the perceptually uniform OKLCH color space.
 * In OKLCH, lightness (L) directly correlates with perceived brightness:
 * - L ≤ 0.5: Dark colors that need light (white) foreground
 * - L > 0.7: Light colors that need dark (black) foreground  
 * - 0.5 < L ≤ 0.7: Mid-range - we use light foreground as it generally has better contrast
 * 
 * The threshold of 0.7 provides approximately 4.5:1 contrast ratio with pure black text,
 * meeting WCAG AA requirements for normal text.
 * 
 * @param lightness - OKLCH lightness value (0-1)
 * @returns true if the color needs a dark foreground, false if it needs a light foreground
 */
export function needsDarkForeground(lightness: number): boolean {
  // Colors with lightness > 0.7 are perceived as "light" and need dark foreground
  return lightness > 0.7;
}
