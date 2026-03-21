import type {JSX} from 'react';

import {useLexicalComposerContext} from '@lexical/react/LexicalComposerContext';
import {$insertNodeToNearestRoot} from '@lexical/utils';
import {COMMAND_PRIORITY_EDITOR, createCommand, LexicalCommand, LexicalEditor} from 'lexical';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';

import {$createNotesNode, NotesNode} from '../../nodes/NotesNode';
import {convertNotes, processNode} from '../../utils/tnr-formatters';
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
// Convert clipboard HTML (from Word/Docs) into styled notes HTML
// ---------------------------------------------------------------------------
function convertRichHtmlToNotes(
  htmlStr: string,
  baasixClient?: any,
  folder?: string,
): Promise<string> {
  return new Promise(async (resolve) => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlStr, 'text/html');

    // Upload base64 images to Baasix
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
          } catch {
            // Keep data URL as fallback
          }
        }
      }
    }

    // Use processNode to convert DOM to styled notes HTML
    let html = `<div style="font-family: sans-serif; line-height: 1.6; color: inherit;">`;
    const children = Array.from(doc.body.childNodes);
    for (const child of children) {
      html += processNode(child);
    }
    html += '</div>';

    // Compact whitespace between tags
    resolve(html.replace(/>\s+</g, '><'));
  });
}

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
  const [input, setInput] = useState('');
  const [richHtml, setRichHtml] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const pasteAreaRef = useRef<HTMLDivElement>(null);

  let editorConfig: {baasixClient: any; folder?: string} | null = null;
  try {
    editorConfig = useEditorConfig();
  } catch {
    // EditorConfig not available
  }

  // Handle rich paste from Word/Docs
  const handleRichPaste = useCallback(async (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const clipboardData = e.clipboardData;
    const htmlData = clipboardData.getData('text/html');
    const textData = clipboardData.getData('text/plain');

    if (htmlData) {
      setIsUploading(true);
      try {
        const processed = await convertRichHtmlToNotes(
          htmlData,
          editorConfig?.baasixClient,
          editorConfig?.folder,
        );
        setRichHtml(processed);
        setInput(''); // Clear plain text when using rich paste
      } finally {
        setIsUploading(false);
      }
    } else if (textData) {
      setInput((prev) => (prev ? prev + '\n' + textData : textData));
    }

    if (pasteAreaRef.current) {
      pasteAreaRef.current.innerHTML = '<span style="color: #9ca3af; pointer-events: none; user-select: none;">Paste from Word/Docs here (preserves formatting)</span>';
    }
  }, [editorConfig]);

  // Preview: richHtml takes priority over plain text
  const finalHtml = useMemo(() => {
    if (richHtml) return richHtml;
    if (!input.trim()) return '';
    return convertNotes(input);
  }, [input, richHtml]);

  const handleInsert = useCallback(() => {
    if (!finalHtml) return;
    activeEditor.dispatchCommand(INSERT_NOTES_COMMAND, finalHtml);
    onClose();
  }, [activeEditor, finalHtml, onClose]);

  return (
    <div style={{minWidth: 500}}>
      <textarea
        value={input}
        onChange={(e) => { setInput(e.target.value); setRichHtml(''); }}
        placeholder={'Paste or type notes here (plain text)...\nExample:\nSuperficial Fascia\nThe superficial fascia is a layer of loose...\n\nFunctions\n- Passageway for vessels\n- Insulation'}
        style={{
          width: '100%', minHeight: 120, fontFamily: 'monospace', fontSize: 13,
          padding: 8, border: '1px solid #ddd', borderRadius: 4, resize: 'vertical',
          marginBottom: 8,
        }}
      />
      {/* Rich paste area for Word content with formatting + images */}
      <div
        ref={pasteAreaRef}
        contentEditable
        onPaste={handleRichPaste}
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: '100%', minHeight: 40, padding: 8,
          border: '2px dashed #93c5fd', borderRadius: 4,
          fontSize: 12, color: '#6b7280', marginBottom: 8,
          outline: 'none', background: '#f0f7ff',
        }}
        suppressContentEditableWarning
      >
        <span style={{color: '#9ca3af', pointerEvents: 'none', userSelect: 'none'}}>
          {isUploading ? 'Processing content...' : 'Paste from Word/Docs here (preserves formatting)'}
        </span>
      </div>
      {richHtml && (
        <div style={{marginBottom: 8, fontSize: 11, color: '#16a34a'}}>
          Rich content captured (formatting preserved)
        </div>
      )}
      {finalHtml && (
        <div style={{marginBottom: 8, padding: 8, border: '1px solid #e5e7eb', borderRadius: 4, background: '#fafafa', maxHeight: 200, overflow: 'auto'}}>
          <span style={{fontSize: 11, color: '#888', display: 'block', marginBottom: 4}}>Preview:</span>
          <div dangerouslySetInnerHTML={{__html: finalHtml}} />
        </div>
      )}
      <div style={{display: 'flex', justifyContent: 'flex-end', gap: 8}}>
        <button type="button" onClick={onClose}
          style={{padding: '6px 16px', fontSize: 13, border: '1px solid #ccc', borderRadius: 4, background: '#fff', cursor: 'pointer'}}>
          Cancel
        </button>
        <button type="button" onClick={handleInsert} disabled={!finalHtml || isUploading}
          style={{padding: '6px 16px', fontSize: 13, border: 'none', borderRadius: 4, background: '#2563eb', color: '#fff', cursor: 'pointer', opacity: finalHtml && !isUploading ? 1 : 0.5}}>
          {isUploading ? 'Processing...' : 'Insert'}
        </button>
      </div>
    </div>
  );
}
