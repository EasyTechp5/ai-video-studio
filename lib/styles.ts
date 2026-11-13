import type { VIDEO_STYLES } from "@/types/schemas";

export interface StylePreset {
  label: string;
  /** Appended to every image / video prompt so the whole project shares one look. */
  promptSuffix: string;
  /** Guidance given to Claude when writing visuals. */
  directive: string;
}

export const STYLE_PRESETS: Record<(typeof VIDEO_STYLES)[number], StylePreset> = {
  "3d_cartoon": {
    label: "3D cartoon",
    promptSuffix:
      "stylized 3D animated feature-film look, soft global illumination, expressive characters, vibrant colors, clean composition",
    directive: "Friendly, expressive 3D-animated look with rounded shapes and warm lighting.",
  },
  photorealistic: {
    label: "Photorealistic",
    promptSuffix: "photorealistic, natural lighting, 35mm photography, high detail, realistic skin and materials",
    directive: "Documentary-grade realism; natural light and real-world environments.",
  },
  anime: {
    label: "Anime-inspired",
    promptSuffix: "anime-inspired illustration, cel shading, detailed painted backgrounds, dynamic framing",
    directive: "Anime-inspired visuals with cel shading and painterly backgrounds.",
  },
  documentary: {
    label: "Documentary",
    promptSuffix: "documentary photography, candid framing, natural color grade, shallow depth of field",
    directive: "Observational, candid compositions with archival and B-roll feel.",
  },
  motion_graphics: {
    label: "Motion graphics",
    promptSuffix:
      "clean vector motion-graphics frame, flat shapes, bold typography-free infographic composition, modern color palette",
    directive: "Flat, geometric, infographic-style frames with bold shapes (no embedded text).",
  },
  storybook: {
    label: "Storybook illustration",
    promptSuffix: "hand-painted children's storybook illustration, watercolor texture, warm and whimsical",
    directive: "Watercolor storybook illustrations with a whimsical, gentle mood.",
  },
  cinematic: {
    label: "Cinematic",
    promptSuffix: "cinematic film still, anamorphic lens, dramatic lighting, rich color grade, shallow depth of field",
    directive: "Dramatic cinematic framing, strong lighting contrast and film grade.",
  },
};

export function styleFor(key: string): StylePreset {
  return STYLE_PRESETS[key as keyof typeof STYLE_PRESETS] ?? STYLE_PRESETS.cinematic;
}
