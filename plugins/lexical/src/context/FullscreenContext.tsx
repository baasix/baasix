import { createContext, useContext } from 'react';

export type FullscreenContextType = {
  isFullscreen: boolean;
  toggleFullscreen: () => void;
};

export const FullscreenContext = createContext<FullscreenContextType>({
  isFullscreen: false,
  toggleFullscreen: () => {},
});

export function useFullscreen() {
  return useContext(FullscreenContext);
}
