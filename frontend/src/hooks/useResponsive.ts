import { useWindowDimensions } from "react-native";

/**
 * Responsive breakpoints (mobile-first).
 *  - compact : < 360 px   (small phones: iPhone SE, entry Android)
 *  - phone   : 360–599 px
 *  - tablet  : 600–1023 px (iPad portrait, foldables open)
 *  - desktop : ≥ 1024 px (web)
 * On tablet/desktop the app is rendered in a centred column (FRAME_WIDTH) so touch targets,
 * line lengths (45–75 chars) and bottom sheets keep a phone-like ergonomy.
 */
export const FRAME_WIDTH = 560;

export function useResponsive() {
  const { width, height } = useWindowDimensions();
  const isCompact = width < 360;
  const isTablet = width >= 600;
  const isDesktop = width >= 1024;
  const isLandscape = width > height;
  const isShort = height < 640; // landscape phones / small devices
  return {
    width, height, isCompact, isTablet, isDesktop, isLandscape, isShort,
    framed: isTablet,
    contentWidth: Math.min(width, isTablet ? FRAME_WIDTH : width),
    /** Horizontal padding: tighter on compact phones. */
    gutter: isCompact ? 16 : 24,
    /** Scale factor for hero typography on compact screens. */
    fontScale: isCompact ? 0.85 : 1,
  };
}
