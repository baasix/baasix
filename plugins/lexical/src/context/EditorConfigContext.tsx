import React, { createContext, useContext } from 'react';
import type { Baasix } from '@baasix/sdk';

export interface EditorConfig {
  baasixClient: Baasix;
  folder?: string;
}

const EditorConfigContext = createContext<EditorConfig | null>(null);

export function EditorConfigProvider({
  baasixClient,
  folder,
  children,
}: {
  baasixClient: Baasix;
  folder?: string;
  children: React.ReactNode;
}) {
  return (
    <EditorConfigContext.Provider value={{ baasixClient, folder }}>
      {children}
    </EditorConfigContext.Provider>
  );
}

export function useEditorConfig(): EditorConfig {
  const ctx = useContext(EditorConfigContext);
  if (!ctx) {
    throw new Error('useEditorConfig must be used within EditorConfigProvider');
  }
  return ctx;
}
