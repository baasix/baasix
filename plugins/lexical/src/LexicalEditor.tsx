
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
import { $createParagraphNode, $getRoot, $insertNodes, $isTextNode, $setSelection, COMMAND_PRIORITY_LOW, EditorState, FOCUS_COMMAND, TextNode } from "lexical";
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
// HTML pre-processing – preserve styled/complex elements as HtmlBlockNodes
// ---------------------------------------------------------------------------

/**
 * Tags that Lexical natively handles. Top-level elements NOT in this set
 * that carry meaningful inline styles are wrapped as HTML blocks so they
 * aren't stripped during import.
 */
const LEXICAL_NATIVE_TAGS = new Set([
  'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'CODE',
  'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD',
  'A', 'SPAN', 'STRONG', 'EM', 'B', 'I', 'U', 'S',
  'SUB', 'SUP', 'BR', 'HR', 'IMG',
]);

/** Style properties that signal the element carries visual structure Lexical
 *  can't represent. A div with `display:grid` or explicit `background` is
 *  almost certainly a styled card/layout. */
const COMPLEX_STYLE_PATTERNS = [
  /display\s*:\s*(grid|flex)/i,
  /grid-template/i,
  /background\s*:/i,
  /border\s*:/i,
  /border-(left|right|top|bottom)\s*:/i,
  /border-radius\s*:/i,
];

function hasComplexStyles(el: HTMLElement): boolean {
  const style = el.getAttribute('style') || '';
  if (!style) return false;
  return COMPLEX_STYLE_PATTERNS.some((re) => re.test(style));
}

const DATA_ATTR = 'data-lexical-html-block';

// Attributes used by custom DecoratorBlockNodes — divs carrying these should
// pass through to Lexical's importDOM handlers untouched, not be pre-processed.
const LEXICAL_NODE_ATTRS = [
  'data-lexical-notes',
  'data-lexical-terminology',
  'data-lexical-revision',
  'data-lexical-text-cards',
  'data-lexical-questions-cards',
  'data-lexical-html-block',
];

/**
 * Recursively walk children of the given parent. For each element:
 *  - If it's a DIV with complex inline styles (or a non-native tag with
 *    styles), wrap it as an HTML block to preserve the visual structure.
 *  - If it's an unstyled DIV that merely wraps other content (like a
 *    `<div class="prose">` wrapper), recurse into its children instead
 *    so only the individually-styled children become HTML blocks.
 *  - Native tags (p, h1-h6, ul, table, etc.) pass through for Lexical
 *    to handle normally.
 */
function preprocessHtmlForImport(doc: Document): void {
  processChildren(doc.body);
}

function processChildren(parent: Element): void {
  const children = Array.from(parent.children) as HTMLElement[];

  for (const child of children) {
    // Already marked — skip
    if (child.hasAttribute(DATA_ATTR)) continue;
    // Lexical custom node wrappers — pass through untouched so importDOM handles them
    if (LEXICAL_NODE_ATTRS.some((attr) => child.hasAttribute(attr))) continue;

    const tag = child.tagName;

    if (tag === 'DIV') {
      if (hasComplexStyles(child)) {
        // This div itself has visual styling — preserve it entirely
        wrapAsHtmlBlock(child);
      } else if (hasStyledDescendants(child)) {
        // Unstyled wrapper div (e.g. `<div class="prose">`) — unwrap it
        // by promoting its children to the parent level, then process them
        unwrapAndProcess(child);
      }
      // Plain divs without any styled content pass through to Lexical
    }
    // Non-native tags with styles (e.g. <section>, <article>)
    else if (!LEXICAL_NATIVE_TAGS.has(tag) && hasComplexStyles(child)) {
      wrapAsHtmlBlock(child);
    }
  }
}

/** Check if an element has any descendant with complex inline styles */
function hasStyledDescendants(el: HTMLElement): boolean {
  const descendants = el.querySelectorAll('*');
  for (let i = 0; i < descendants.length; i++) {
    if (hasComplexStyles(descendants[i] as HTMLElement)) return true;
  }
  return false;
}

/** Replace an unstyled wrapper div with its children, then process them */
function unwrapAndProcess(wrapper: HTMLElement): void {
  const parent = wrapper.parentElement;
  if (!parent) return;
  const children = Array.from(wrapper.childNodes);
  for (const child of children) {
    parent.insertBefore(child, wrapper);
  }
  parent.removeChild(wrapper);
  // Now process the newly-promoted children
  processChildren(parent);
}

/** Wrap an element with the data-lexical-html-block attribute so the
 *  HtmlBlockNode importDOM handler picks it up. */
function wrapAsHtmlBlock(el: HTMLElement): void {
  const wrapper = el.ownerDocument.createElement('div');
  wrapper.setAttribute(DATA_ATTR, 'true');
  // Move the original element's outerHTML inside the wrapper
  wrapper.innerHTML = el.outerHTML;
  el.replaceWith(wrapper);
}

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
  // doesn't work.  We listen to FOCUS_COMMAND and defer the check to a
  // microtask so the browser's native click-based selection resolves first.
  // This avoids hijacking clicks on table cells or other nested elements.
  useEffect(() => {
    return editor.registerCommand(
      FOCUS_COMMAND,
      () => {
        if (editor.getEditorState()._selection === null) {
          // Defer to let the browser resolve the native selection from the
          // click before we intervene. If Lexical still has no selection
          // after the click chain, fall back to the first child.
          Promise.resolve().then(() => {
            if (editor.getEditorState()._selection === null) {
              editor.update(() => {
                const root = $getRoot();
                const firstChild = root.getFirstChild();
                if (firstChild) {
                  firstChild.selectStart();
                }
              });
            }
          });
        }
        return false;
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
        // Tag styled/complex elements as HTML blocks before Lexical parses
        // them, so they're preserved verbatim instead of being flattened.
        preprocessHtmlForImport(dom);
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
    html: {
      // Custom TextNode export: preserve inline style (e.g. color) in the HTML output.
      // Lexical's default TextNode.exportDOM() does not write __style to the element,
      // so colored text is lost when saving. This override wraps styled text in a
      // <span style="..."> so the color survives save/reload cycles.
      export: new Map<any, (editor: LexicalEditorType, node: any) => { element: HTMLElement | null }> ([
        [TextNode, (editor: LexicalEditorType, node: TextNode) => {
          const { element } = node.exportDOM(editor);
          const style = node.getStyle();
          if (element && style) {
            // exportDOM may wrap in <b>/<i> etc — apply node style to outermost element.
            // Only add properties from __style that aren't already set by exportDOM.
            const el = element as HTMLElement;
            style.split(';').forEach((decl) => {
              const [prop, val] = decl.split(':').map((s) => s.trim());
              if (prop && val) el.style.setProperty(prop, val);
            });
          }
          return { element: element as HTMLElement };
        }],
      ]),
      // Custom import: read inline color style from span/b/strong/i/u back into TextNode.setStyle().
      // Lexical's default converters only read bold/italic/underline formats, not color.
      import: (['span', 'b', 'strong', 'i', 'u', 's'] as const).reduce((acc, tag) => {
        acc[tag] = (domNode: HTMLElement) => {
          const style = domNode.style?.cssText;
          if (!style) return null;
          return {
            conversion: (node: HTMLElement) => ({
              forChild: (lexicalNode: any) => {
                if ($isTextNode(lexicalNode)) {
                  // Filter out layout/rendering props that Lexical manages itself
                  const filtered = node.style.cssText
                    .split(';')
                    .map((d) => d.trim())
                    .filter((d) => d && !/^white-space\s*:/i.test(d))
                    .join('; ');
                  if (filtered) {
                    const existing = lexicalNode.getStyle() || '';
                    lexicalNode.setStyle(existing ? existing + '; ' + filtered : filtered);
                  }
                }
                return lexicalNode;
              },
              node: null,
            }),
            priority: 2 as const,
          };
        };
        return acc;
      }, {} as Record<string, (domNode: HTMLElement) => any>),
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
