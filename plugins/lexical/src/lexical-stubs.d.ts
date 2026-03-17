/**
 * Type stubs for lexical packages not included in v0.41.0 core install.
 */

declare module '@lexical/code-shiki' {
  import type {LexicalEditor} from 'lexical';

  export function registerCodeHighlighting(
    editor: LexicalEditor,
  ): () => void;

  export function getCodeLanguageOptions(): [string, string][];
  export function getCodeThemeOptions(): [string, string][];
  export function normalizeCodeLanguage(lang: string): string;
}

declare module '@lexical/file' {
  import type {LexicalEditor, EditorState} from 'lexical';

  export interface SerializedDocument {
    source: string;
    [key: string]: unknown;
  }

  export function exportFile(
    editor: LexicalEditor,
    config?: {fileName?: string; source?: string},
  ): void;

  export function importFile(editor: LexicalEditor): void;

  export function editorStateFromSerializedDocument(
    editor: LexicalEditor,
    doc: SerializedDocument,
  ): EditorState;

  export function serializedDocumentFromEditorState(
    editorState: EditorState,
    config?: {source?: string},
  ): SerializedDocument;
}

declare module '@atlaskit/drag-and-drop-indicator/box' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function DropIndicator(props: any): JSX.Element | null;
  export default DropIndicator;
}

declare module '@atlaskit/pragmatic-drag-and-drop/element/adapter' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type ElementDragPayload = any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function draggable(args: any): () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function dropTargetForElements(args: any): () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function monitorForElements(args: any): () => void;
}
