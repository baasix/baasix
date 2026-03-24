import type {JSX} from 'react';

import {useLexicalComposerContext} from '@lexical/react/LexicalComposerContext';
import {$insertNodeToNearestRoot} from '@lexical/utils';
import {COMMAND_PRIORITY_EDITOR, createCommand, LexicalCommand, LexicalEditor} from 'lexical';
import {useCallback, useEffect, useMemo, useState} from 'react';

import {$createTextCardsNode, TextCardsNode} from '../../nodes/TextCardsNode';
import {convertTextCards} from '../../utils/tnr-formatters';
import {useEditorConfig} from '../../context/EditorConfigContext';
import {useRichPaste} from '../../utils/useRichPaste';

export const INSERT_TEXT_CARDS_COMMAND: LexicalCommand<string> = createCommand(
  'INSERT_TEXT_CARDS_COMMAND',
);

export default function TextCardsPlugin(): JSX.Element | null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (!editor.hasNodes([TextCardsNode])) {
      throw new Error('TextCardsPlugin: TextCardsNode not registered on editor');
    }

    return editor.registerCommand<string>(
      INSERT_TEXT_CARDS_COMMAND,
      (payload) => {
        const node = $createTextCardsNode(payload);
        $insertNodeToNearestRoot(node);
        return true;
      },
      COMMAND_PRIORITY_EDITOR,
    );
  }, [editor]);

  return null;
}

// ---------------------------------------------------------------------------
// Insert Dialog (used by ToolbarPlugin showModal and ComponentPickerPlugin)
// ---------------------------------------------------------------------------

export function InsertTextCardsDialog({
  activeEditor,
  onClose,
}: {
  activeEditor: LexicalEditor;
  onClose: () => void;
}): JSX.Element {
  const [input, setInput] = useState('');
  const [hasPasted, setHasPasted] = useState(false);

  let editorConfig: {baasixClient: any; folder?: string} | null = null;
  try {
    editorConfig = useEditorConfig();
  } catch {
    // EditorConfig not available
  }

  const richPaste = useRichPaste(
    (text) => { setInput((prev) => (prev ? prev + '\n' + text : text)); setHasPasted(true); },
    editorConfig?.baasixClient,
    editorConfig?.folder,
  );

  const handleClear = useCallback(() => {
    setInput('');
    setHasPasted(false);
  }, []);

  const finalHtml = useMemo(() => {
    if (!input.trim()) return '';
    const html = convertTextCards(input);
    return richPaste.replaceImagePlaceholders(html);
  }, [input, richPaste]);

  const handleInsert = useCallback(() => {
    if (!finalHtml) return;
    activeEditor.dispatchCommand(INSERT_TEXT_CARDS_COMMAND, finalHtml);
    onClose();
  }, [activeEditor, finalHtml, onClose]);

  return (
    <div style={{minWidth: 500}}>
      {/* Paste area — shown before paste */}
      {!hasPasted && (
        <div
          ref={richPaste.pasteAreaRef}
          contentEditable
          onPaste={richPaste.handlePaste}
          onMouseDown={(e) => e.stopPropagation()}
          data-placeholder={richPaste.isUploading ? 'Uploading images...' : 'Paste from Word/Docs here for image support'}
          style={{
            width: '100%', minHeight: 160, padding: 12,
            border: '2px dashed #93c5fd', borderRadius: 4,
            fontSize: 13, color: '#6b7280', marginBottom: 8,
            outline: 'none', background: '#f0f7ff',
          }}
          suppressContentEditableWarning
        />
      )}
      {/* Textarea — shown after paste */}
      {hasPasted && (
        <>
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4}}>
            <span style={{fontSize: 11, color: '#6b7280'}}>Edit content</span>
            <button type="button" onClick={handleClear}
              style={{padding: '2px 10px', fontSize: 12, border: '1px solid #fca5a5', borderRadius: 4, background: '#fff', color: '#ef4444', cursor: 'pointer'}}>
              Clear
            </button>
          </div>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            style={{
              width: '100%', minHeight: 150, fontFamily: 'monospace', fontSize: 13,
              padding: 8, border: '1px solid #ddd', borderRadius: 4, resize: 'vertical',
              marginBottom: 8,
            }}
          />
        </>
      )}
      {finalHtml && (
        <div style={{marginBottom: 8, padding: 8, border: '1px solid #e5e7eb', borderRadius: 4, background: '#fafafa', maxHeight: 250, overflow: 'auto'}}>
          <span style={{fontSize: 11, color: '#888', display: 'block', marginBottom: 4}}>Preview:</span>
          <div dangerouslySetInnerHTML={{__html: finalHtml}} />
        </div>
      )}
      <div style={{display: 'flex', justifyContent: 'flex-end', gap: 8}}>
        <button type="button" onClick={onClose}
          style={{padding: '6px 16px', fontSize: 13, border: '1px solid #ccc', borderRadius: 4, background: '#fff', cursor: 'pointer'}}>
          Cancel
        </button>
        <button type="button" onClick={handleInsert} disabled={!finalHtml || richPaste.isUploading}
          style={{padding: '6px 16px', fontSize: 13, border: 'none', borderRadius: 4, background: '#2563eb', color: '#fff', cursor: 'pointer', opacity: finalHtml && !richPaste.isUploading ? 1 : 0.5}}>
          {richPaste.isUploading ? 'Uploading...' : 'Insert'}
        </button>
      </div>
    </div>
  );
}
