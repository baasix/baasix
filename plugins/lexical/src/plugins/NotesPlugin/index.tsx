import type {JSX} from 'react';

import {useLexicalComposerContext} from '@lexical/react/LexicalComposerContext';
import {$insertNodeToNearestRoot} from '@lexical/utils';
import {COMMAND_PRIORITY_EDITOR, createCommand, LexicalCommand, LexicalEditor} from 'lexical';
import {useCallback, useEffect, useMemo, useState} from 'react';

import {$createNotesNode, NotesNode} from '../../nodes/NotesNode';
import {convertNotes} from '../../utils/tnr-formatters';

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

  const preview = useMemo(() => {
    if (!input.trim()) return '';
    return convertNotes(input);
  }, [input]);

  const handleInsert = useCallback(() => {
    if (!preview) return;
    activeEditor.dispatchCommand(INSERT_NOTES_COMMAND, preview);
    onClose();
  }, [activeEditor, preview, onClose]);

  return (
    <div style={{minWidth: 500}}>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={'Paste notes here...\nExample:\nSuperficial Fascia\nThe superficial fascia is a layer of loose...\n\nFunctions\n- Passageway for vessels\n- Insulation'}
        style={{
          width: '100%', minHeight: 120, fontFamily: 'monospace', fontSize: 13,
          padding: 8, border: '1px solid #ddd', borderRadius: 4, resize: 'vertical',
          marginBottom: 8,
        }}
      />
      {preview && (
        <div style={{marginBottom: 8, padding: 8, border: '1px solid #e5e7eb', borderRadius: 4, background: '#fafafa', maxHeight: 200, overflow: 'auto'}}>
          <span style={{fontSize: 11, color: '#888', display: 'block', marginBottom: 4}}>Preview:</span>
          <div dangerouslySetInnerHTML={{__html: preview}} />
        </div>
      )}
      <div style={{display: 'flex', justifyContent: 'flex-end', gap: 8}}>
        <button type="button" onClick={onClose}
          style={{padding: '6px 16px', fontSize: 13, border: '1px solid #ccc', borderRadius: 4, background: '#fff', cursor: 'pointer'}}>
          Cancel
        </button>
        <button type="button" onClick={handleInsert} disabled={!preview}
          style={{padding: '6px 16px', fontSize: 13, border: 'none', borderRadius: 4, background: '#2563eb', color: '#fff', cursor: 'pointer', opacity: preview ? 1 : 0.5}}>
          Insert
        </button>
      </div>
    </div>
  );
}
