/**
 * Stub for @excalidraw/excalidraw — the package is ~5MB and optional.
 * Excalidraw drawing feature will show a placeholder if this stub is active.
 * To enable Excalidraw, install the real package: npm install @excalidraw/excalidraw
 */

// Re-export a dummy Excalidraw component
export const Excalidraw = () => null;
export const exportToSvg = async () => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  return svg;
};
export default { Excalidraw, exportToSvg };
