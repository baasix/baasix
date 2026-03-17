/**
 * Type stubs for @excalidraw/excalidraw (not installed).
 * These allow the Excalidraw-related lexical plugins to compile
 * without the optional @excalidraw/excalidraw dependency.
 */

declare module '@excalidraw/excalidraw' {
  import type {ComponentType} from 'react';

  export const Excalidraw: ComponentType<Record<string, unknown>>;
  export function exportToSvg(opts: Record<string, unknown>): Promise<SVGElement>;
}

declare module '@excalidraw/excalidraw/types' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type AppState = Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type BinaryFiles = Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type ExcalidrawImperativeAPI = Record<string, any>;
  export type ExcalidrawInitialDataState = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    elements?: ReadonlyArray<any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    appState?: Record<string, any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    files?: Record<string, any>;
  };
}

declare module '@excalidraw/excalidraw/element/types' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type ExcalidrawElement = Record<string, any>;
  export type NonDeleted<T> = T;
}
