import type {JSX} from 'react';

import {useLexicalComposerContext} from '@lexical/react/LexicalComposerContext';
import {$insertNodeToNearestRoot} from '@lexical/utils';
import {COMMAND_PRIORITY_EDITOR, createCommand, LexicalCommand, LexicalEditor, $insertNodes} from 'lexical';
import {$generateNodesFromDOM} from '@lexical/html';
import {useCallback, useEffect, useRef, useState} from 'react';

import {$createNotesNode, NotesNode} from '../../nodes/NotesNode';
import {useEditorConfig} from '../../context/EditorConfigContext';
import {uploadImageToBaasix} from '../../utils/baasixUpload';

export const INSERT_NOTES_COMMAND: LexicalCommand<string> = createCommand(
  'INSERT_NOTES_COMMAND',
);

export default function NotesPlugin(): JSX.Element | null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (!editor.hasNodes([NotesNode])) {
      throw new Error('NotesPlugin: NotesNode not registered on editor');
    }

    return editor.registerCommand<string>(
      INSERT_NOTES_COMMAND,
      (payload) => {
        const node = $createNotesNode(payload);
        $insertNodeToNearestRoot(node);
        return true;
      },
      COMMAND_PRIORITY_EDITOR,
    );
  }, [editor]);

  return null;
}

// ---------------------------------------------------------------------------
// Upload base64 images in HTML and return updated HTML with hosted URLs
// ---------------------------------------------------------------------------
async function processImagesInHtml(
  htmlStr: string,
  baasixClient?: any,
  folder?: string,
): Promise<string> {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlStr, 'text/html');

  if (baasixClient) {
    const imgs = doc.querySelectorAll('img');
    for (let i = 0; i < imgs.length; i++) {
      const img = imgs[i];
      const src = img.getAttribute('src') || '';
      if (src.startsWith('data:')) {
        try {
          const resp = await fetch(src);
          const blob = await resp.blob();
          const ext = blob.type.split('/')[1] || 'png';
          const file = new File([blob], `note-image-${i}.${ext}`, {type: blob.type});
          const uploadedUrl = await uploadImageToBaasix(baasixClient, file, folder);
          img.setAttribute('src', uploadedUrl);
          img.setAttribute('style', 'max-width: 100%; height: auto;');
        } catch {
          // Keep data URL as fallback
        }
      }
    }
  }

  return doc.body.innerHTML;
}

// Heading color matching notes style
const HEADING_COLOR = '#6b5b95';

// ---------------------------------------------------------------------------
// Insert Dialog (used by ToolbarPlugin showModal and ComponentPickerPlugin)
// ---------------------------------------------------------------------------

export function InsertNotesDialog({
  activeEditor,
  onClose,
}: {
  activeEditor: LexicalEditor;
  onClose: () => void;
}): JSX.Element {
  const [pastedHtml, setPastedHtml] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [hasPasted, setHasPasted] = useState(false);
  const pasteAreaRef = useRef<HTMLDivElement>(null);

  let editorConfig: {baasixClient: any; folder?: string} | null = null;
  try {
    editorConfig = useEditorConfig();
  } catch {
    // EditorConfig not available
  }

  const handlePaste = useCallback(async (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const htmlData = e.clipboardData.getData('text/html');
    const textData = e.clipboardData.getData('text/plain');

    const rawHtml = htmlData || (textData ? `<p>${textData.replace(/\n\n+/g, '</p><p>').replace(/\n/g, '<br>')}</p>` : '');
    if (!rawHtml) return;

    setIsUploading(true);
    try {
      const processed = await processImagesInHtml(rawHtml, editorConfig?.baasixClient, editorConfig?.folder);
      setPastedHtml(processed);
      setHasPasted(true);
    } finally {
      setIsUploading(false);
    }
  }, [editorConfig]);

  const handleClear = useCallback(() => {
    setPastedHtml('');
    setHasPasted(false);
    if (pasteAreaRef.current) {
      pasteAreaRef.current.innerHTML = '';
    }
  }, []);

  const handleInsert = useCallback(() => {
    if (!pastedHtml) return;

    // Pre-process HTML in the DOM: detect headings, apply color, inject <hr><p>
    const parser = new DOMParser();
    const dom = parser.parseFromString(pastedHtml, 'text/html');

    // Returns true if an element is a heading tag (h1-h6)
    const isHeadingTag = (el: Element) =>
      /^H[1-6]$/.test(el.tagName);

    // Returns true if a <p> contains only bold text (Word/Docs heading pattern)
    const isBoldOnlyParagraph = (el: Element): boolean => {
      if (el.tagName !== 'P') return false;
      const text = el.textContent?.trim() || '';
      if (!text || text.length > 150) return false;
      // All child nodes must be bold elements or bold-styled spans
      const children = Array.from(el.childNodes);
      return children.every((child) => {
        if (child.nodeType === Node.TEXT_NODE) return !(child.textContent?.trim());
        if (child.nodeType !== Node.ELEMENT_NODE) return true;
        const el2 = child as HTMLElement;
        const tag = el2.tagName;
        if (tag === 'STRONG' || tag === 'B') return true;
        if (tag === 'SPAN') {
          const fw = el2.style.fontWeight;
          return fw === 'bold' || fw === '700';
        }
        return false;
      });
    };

    // Wrap all text content of an element in a colored span
    const colorizeContent = (el: Element) => {
      const inner = el.innerHTML;
      el.innerHTML = `<span style="color: ${HEADING_COLOR};">${inner}</span>`;
    };

    // Walk top-level body children and inject color + hr + empty p after headings
    const topChildren = Array.from(dom.body.children);
    for (const el of topChildren) {
      if (isHeadingTag(el) || isBoldOnlyParagraph(el)) {
        // Wrap content in colored span so Lexical's span importer picks up the color
        colorizeContent(el);
        // Insert <hr> after
        const hr = dom.createElement('hr');
        el.insertAdjacentElement('afterend', hr);
        // Insert empty <p> after the hr
        const emptyP = dom.createElement('p');
        hr.insertAdjacentElement('afterend', emptyP);
      }
    }

    activeEditor.update(() => {
      const nodes = $generateNodesFromDOM(activeEditor, dom);
      $insertNodes(nodes);
    });
    onClose();
  }, [activeEditor, pastedHtml, onClose]);

  return (
    <div style={{minWidth: 500}}>
      {/* Paste area — shown before paste */}
      {!hasPasted && (
        <div
          ref={pasteAreaRef}
          contentEditable
          onPaste={handlePaste}
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            width: '100%', minHeight: 160, padding: 12,
            border: '2px dashed #93c5fd', borderRadius: 4,
            fontSize: 13, color: '#6b7280', marginBottom: 8,
            outline: 'none', background: '#f0f7ff',
          }}
          data-placeholder={isUploading ? 'Processing content...' : 'Paste from Word/Docs here (preserves formatting)'}
          suppressContentEditableWarning
        />
      )}
      {/* Preview — shown after paste, no textarea */}
      {hasPasted && (
        <>
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6}}>
            <span style={{fontSize: 11, color: '#6b7280'}}>Preview</span>
            <button type="button" onClick={handleClear}
              style={{padding: '2px 10px', fontSize: 12, border: '1px solid #fca5a5', borderRadius: 4, background: '#fff', color: '#ef4444', cursor: 'pointer'}}>
              Clear
            </button>
          </div>
          <div
            style={{padding: 12, border: '1px solid #e5e7eb', borderRadius: 4, background: '#fafafa', maxHeight: 300, overflow: 'auto', marginBottom: 8}}
            dangerouslySetInnerHTML={{__html: pastedHtml}}
          />
        </>
      )}
      <div style={{display: 'flex', justifyContent: 'flex-end', gap: 8}}>
        <button type="button" onClick={onClose}
          style={{padding: '6px 16px', fontSize: 13, border: '1px solid #ccc', borderRadius: 4, background: '#fff', cursor: 'pointer'}}>
          Cancel
        </button>
        <button type="button" onClick={handleInsert} disabled={!pastedHtml || isUploading}
          style={{padding: '6px 16px', fontSize: 13, border: 'none', borderRadius: 4, background: '#2563eb', color: '#fff', cursor: 'pointer', opacity: pastedHtml && !isUploading ? 1 : 0.5}}>
          {isUploading ? 'Processing...' : 'Insert'}
        </button>
      </div>
    </div>
  );
}
