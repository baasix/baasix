import type {JSX} from 'react';

import {useLexicalComposerContext} from '@lexical/react/LexicalComposerContext';
import {$insertNodeToNearestRoot} from '@lexical/utils';
import {COMMAND_PRIORITY_EDITOR, createCommand, LexicalCommand, LexicalEditor} from 'lexical';
import {useCallback, useEffect, useMemo, useState} from 'react';

import {$createQuestionsCardsNode, QuestionsCardsNode} from '../../nodes/QuestionsCardsNode';
import {convertQuestionsCards} from '../../utils/tnr-formatters';

export const INSERT_QUESTIONS_CARDS_COMMAND: LexicalCommand<string> = createCommand(
  'INSERT_QUESTIONS_CARDS_COMMAND',
);

export default function QuestionsCardsPlugin(): JSX.Element | null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (!editor.hasNodes([QuestionsCardsNode])) {
      throw new Error('QuestionsCardsPlugin: QuestionsCardsNode not registered on editor');
    }

    return editor.registerCommand<string>(
      INSERT_QUESTIONS_CARDS_COMMAND,
      (payload) => {
        const node = $createQuestionsCardsNode(payload);
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

export function InsertQuestionsCardsDialog({
  activeEditor,
  onClose,
}: {
  activeEditor: LexicalEditor;
  onClose: () => void;
}): JSX.Element {
  const [input, setInput] = useState('');

  const preview = useMemo(() => {
    if (!input.trim()) return '';
    return convertQuestionsCards(input);
  }, [input]);

  const handleInsert = useCallback(() => {
    if (!preview) return;
    activeEditor.dispatchCommand(INSERT_QUESTIONS_CARDS_COMMAND, preview);
    onClose();
  }, [activeEditor, preview, onClose]);

  return (
    <div style={{minWidth: 500}}>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={`Paste question content here...\nExample:\nQ1. Describe the pathogenesis of tuberculosis.\n\nAnswer:\nTuberculosis is caused by Mycobacterium tuberculosis...\n\nMARKING RUBRIC\nDefinition: 2 marks, Pathogenesis: 5 marks...\n\nMNEMONICS\nRemember TB pathogenesis with "IGRA"...\n\nEXAMINER'S PERSPECTIVE\nExaminers look for systematic approach...\n\nCLINICAL CORRELATION\nTB commonly presents with...\n\nHIGH-YIELD EXAM TIP\nAlways mention Ghon complex...`}
        style={{
          width: '100%', minHeight: 180, fontFamily: 'monospace', fontSize: 13,
          padding: 8, border: '1px solid #ddd', borderRadius: 4, resize: 'vertical',
          marginBottom: 8,
        }}
      />
      {preview && (
        <div style={{marginBottom: 8, padding: 8, border: '1px solid #e5e7eb', borderRadius: 4, background: '#fafafa', maxHeight: 250, overflow: 'auto'}}>
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
