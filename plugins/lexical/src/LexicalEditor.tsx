
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $generateHtmlFromNodes, $generateNodesFromDOM } from "@lexical/html";
import { $createParagraphNode, $getRoot, $insertNodes, $setSelection, COMMAND_PRIORITY_LOW, EditorState, FOCUS_COMMAND } from "lexical";
import type { LexicalEditor as LexicalEditorType } from "lexical";
import type { Baasix } from '@baasix/sdk';

import Editor from "./Editor";
import PlaygroundNodes from "./nodes/PlaygroundNodes";

import PlaygroundEditorTheme from "./themes/PlaygroundEditorTheme";
import { SharedHistoryContext } from "./context/SharedHistoryContext";
import { SettingsContext } from "./context/SettingsContext";
import { ToolbarContext } from "./context/ToolbarContext";
import { CollaborationContext } from "@lexical/react/LexicalCollaborationContext";
import { EditorConfigProvider } from "./context/EditorConfigContext";
import { FullscreenContext } from './context/FullscreenContext';

// ---------------------------------------------------------------------------
// HtmlPlugin – bridges external HTML value ↔ Lexical editor state
// ---------------------------------------------------------------------------

function HtmlPlugin({
  value,
  onChange,
  debounceMs = 300,
}: {
  value: string;
  onChange: (html: string) => void;
  debounceMs?: number;
}) {
  const [editor] = useLexicalComposerContext();

  // The last value we pushed into the editor OR received from onChange.
  // Used to detect whether an incoming `value` prop is genuinely new content
  // or just the echo of our own onChange call.
  // Initialised to a sentinel so the first useEffect run always loads content.
  const lastSyncedValue = useRef<string | null>(null);
  // Track whether the user has actually interacted with the editor.
  // Prevents the mount/parse cycle from firing onChange with regenerated HTML.
  const hasUserEdited = useRef(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // When the editor is initialised with $setSelection(null) (to avoid stealing
  // focus on mount), Lexical has no internal selection. Without an internal
  // selection, a click into the contentEditable focuses it but Lexical never
  // reconciles a native DOM selection — so the caret never appears and typing
  // doesn't work.  We listen to FOCUS_COMMAND and, if there is no selection,
  // create one pointing to the first child.  This only fires when the user
  // actually clicks/tabs into the editor, not on mount.
  useEffect(() => {
    return editor.registerCommand(
      FOCUS_COMMAND,
      () => {
        // If Lexical has no internal selection (e.g. after $setSelection(null)
        // on mount), create one now so the caret appears and typing works.
        if (editor.getEditorState()._selection === null) {
          editor.update(() => {
            const root = $getRoot();
            const firstChild = root.getFirstChild();
            if (firstChild) {
              firstChild.selectStart();
            }
          }, { discrete: true });
        }
        return false; // Don't prevent default handling
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor]);

  // Sync value changes from the outside world → Lexical editor state.
  useEffect(() => {
    // Skip if this value is what we last sent via onChange (echo).
    if (value === lastSyncedValue.current) {
      return;
    }

    lastSyncedValue.current = value;
    // New external content (e.g. switching items) — reset the dirty flag.
    hasUserEdited.current = false;

    editor.update(
      () => {
        const root = $getRoot();

        // If value is empty / blank, reset to a single empty paragraph.
        // Using root.clear() alone leaves the contentEditable with zero
        // DOM children, which prevents the browser from placing a valid
        // selection and therefore blocks native beforeinput events —
        // making the editor unresponsive to keyboard input.
        if (!value || value === "<p></p>" || value === "<p><br></p>") {
          root.clear();
          root.append($createParagraphNode());
          // Leave selection null — Lexical will set it when the user
          // clicks into the editor. Setting it here would steal DOM
          // focus from other form fields on mount.
          $setSelection(null);
          return;
        }

        // Null out the selection before clearing the tree to prevent
        // stale selection offsets causing IndexSizeError during reconciliation.
        $setSelection(null);

        const parser = new DOMParser();
        const dom = parser.parseFromString(value, "text/html");
        const nodes = $generateNodesFromDOM(editor, dom);

        root.clear();
        $insertNodes(nodes);
      },
      // Prevent scroll-to-top when loading content inside a Sheet
      { tag: "historic" }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, value]);

  // Lexical state changed → generate HTML and call onChange (debounced).
  const handleChange = useCallback(
    (_editorState: EditorState, _editor: LexicalEditorType, tags: Set<string>) => {
      // Our external sync uses the "historic" tag. Don't treat it as a user edit.
      if (!tags.has('historic')) {
        hasUserEdited.current = true;
      }
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }

      debounceTimer.current = setTimeout(() => {
        editor.update(() => {
          const html = $generateHtmlFromNodes(editor);

          // Avoid triggering onChange when the HTML hasn't actually changed.
          if (html === lastSyncedValue.current) {
            return;
          }

          // Don't fire onChange until the user has actually interacted with
          // the editor. This prevents the mount/parse cycle from overwriting
          // the form value with regenerated HTML that may differ from the original.
          if (!hasUserEdited.current) {
            return;
          }

          lastSyncedValue.current = html;
          onChange(html);
        });
      }, debounceMs);
    },
    [editor, onChange, debounceMs],
  );

  // Cleanup timer on unmount.
  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, []);

  return <OnChangePlugin onChange={handleChange} ignoreSelectionChange />;
}

// ---------------------------------------------------------------------------
// ReadOnlyController – syncs the readOnly prop to editor editable state
// ---------------------------------------------------------------------------

function ReadOnlyController({ readOnly }: { readOnly?: boolean }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    editor.setEditable(!readOnly);
  }, [editor, readOnly]);
  return null;
}

// ---------------------------------------------------------------------------
// LexicalEditor – public API
// ---------------------------------------------------------------------------

export interface LexicalEditorProps {
  baasixClient: Baasix;
  value: string;
  onChange: (html: string) => void;
  folder?: string;
  height?: number | string;
  debounceMs?: number;
  placeholder?: string;
  readOnly?: boolean;
  maxLength?: number;
}

export default function LexicalEditor({
  baasixClient,
  value,
  onChange,
  folder,
  height = 500,
  debounceMs = 300,
  placeholder,
  readOnly,
  maxLength,
}: LexicalEditorProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  const initialConfig = {
    namespace: "LexicalEditor",
    nodes: [...PlaygroundNodes],
    theme: PlaygroundEditorTheme,
    onError: (error: Error) => {
      console.error("[LexicalEditor]", error);
    },
  };

  const style: React.CSSProperties = isFullscreen
    ? {
        position: "fixed" as const,
        inset: 0,
        zIndex: 9999,
        height: "100vh",
        overflow: "auto",
        background: "#fff",
      }
    : {
        height: typeof height === "number" ? `${height}px` : height,
        position: "relative" as const,
        overflow: "auto",
      };

  // Escape key exits fullscreen
  useEffect(() => {
    if (!isFullscreen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsFullscreen(false);
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [isFullscreen]);

  const toggleFullscreen = useCallback(
    () => setIsFullscreen((f) => !f),
    [],
  );

  const fullscreenValue = useMemo(
    () => ({ isFullscreen, toggleFullscreen }),
    [isFullscreen, toggleFullscreen],
  );

  const collabContextValue = useMemo(
    () => ({
      color: "#000",
      isCollabActive: false,
      name: "User",
      yjsDocMap: new Map(),
    }),
    []
  );

  return (
    <FullscreenContext.Provider value={fullscreenValue}>
      <EditorConfigProvider baasixClient={baasixClient} folder={folder}>
        <SettingsContext>
          <SharedHistoryContext>
            <LexicalComposer initialConfig={initialConfig}>
              <CollaborationContext.Provider value={collabContextValue}>
                <ToolbarContext>
                  <div className="editor-shell" style={style}>
                    <Editor placeholder={placeholder} maxLength={maxLength} />
                    <HtmlPlugin
                      value={value}
                      onChange={onChange}
                      debounceMs={debounceMs}
                    />
                    <ReadOnlyController readOnly={readOnly} />
                  </div>
                </ToolbarContext>
              </CollaborationContext.Provider>
            </LexicalComposer>
          </SharedHistoryContext>
        </SettingsContext>
      </EditorConfigProvider>
    </FullscreenContext.Provider>
  );
}
