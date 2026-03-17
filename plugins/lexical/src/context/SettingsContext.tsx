/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import type {JSX} from 'react';

import * as React from 'react';
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

export type SettingName =
  | 'isCollab'
  | 'useCollabV2'
  | 'isRichText'
  | 'emptyEditor'
  | 'isCharLimit'
  | 'isCharLimitUtf8'
  | 'isAutocomplete'
  | 'isMaxLength'
  | 'showTreeView'
  | 'showTableOfContents'
  | 'shouldUseLexicalContextMenu'
  | 'shouldPreserveNewLinesInMarkdown'
  | 'tableCellMerge'
  | 'tableCellBackgroundColor'
  | 'tableScrollShadow'
  | 'tableFitNestedTables'
  | 'tableHorizontalScroll'
  | 'hasLinkAttributes'
  | 'hasNestedTables'
  | 'hasFitNestedTables'
  | 'isCodeHighlighted'
  | 'isCodeShiki'
  | 'selectionAlwaysOnDisplay'
  | 'listStrictIndent'
  | 'shouldAllowHighlightingWithBrackets'
  | 'shouldDisableFocusOnClickChecklist';

export const DEFAULT_SETTINGS: Record<SettingName, boolean> = {
  isCollab: false,
  useCollabV2: false,
  isRichText: true,
  emptyEditor: false,
  isCharLimit: false,
  isCharLimitUtf8: false,
  isAutocomplete: false,
  isMaxLength: false,
  showTreeView: false,
  showTableOfContents: false,
  shouldUseLexicalContextMenu: false,
  shouldPreserveNewLinesInMarkdown: false,
  tableCellMerge: true,
  tableCellBackgroundColor: true,
  tableScrollShadow: true,
  tableFitNestedTables: true,
  tableHorizontalScroll: true,
  hasLinkAttributes: false,
  hasNestedTables: true,
  hasFitNestedTables: true,
  isCodeHighlighted: true,
  isCodeShiki: false,
  selectionAlwaysOnDisplay: false,
  listStrictIndent: false,
  shouldAllowHighlightingWithBrackets: false,
  shouldDisableFocusOnClickChecklist: false,
};

export const INITIAL_SETTINGS: Record<SettingName, boolean> = {
  ...DEFAULT_SETTINGS,
};

type SettingsContextShape = {
  setOption: (name: SettingName, value: boolean) => void;
  settings: Record<SettingName, boolean>;
};

const Context: React.Context<SettingsContextShape> = createContext({
  setOption: (_name: SettingName, _value: boolean) => {
    return;
  },
  settings: INITIAL_SETTINGS,
});

export const SettingsContext = ({
  children,
}: {
  children: ReactNode;
}): JSX.Element => {
  const [settings, setSettings] = useState(INITIAL_SETTINGS);

  const setOption = useCallback((setting: SettingName, value: boolean) => {
    setSettings((options: Record<SettingName, boolean>) => ({
      ...options,
      [setting]: value,
    }));
  }, []);

  const contextValue = useMemo(() => {
    return {setOption, settings};
  }, [setOption, settings]);

  return <Context.Provider value={contextValue}>{children}</Context.Provider>;
};

export const useSettings = (): SettingsContextShape => {
  return useContext(Context);
};
