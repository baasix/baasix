/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import type {LexicalEditor} from 'lexical';
import type {JSX} from 'react';

import {$createCodeNode, $isCodeNode} from '@lexical/code';
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from '@lexical/markdown';
import {useLexicalComposerContext} from '@lexical/react/LexicalComposerContext';
import {mergeRegister} from '@lexical/utils';
import {
  $createTextNode,
  $getRoot,
  $isParagraphNode,
  CLEAR_EDITOR_COMMAND,
  COMMAND_PRIORITY_EDITOR,
  HISTORIC_TAG,
  SELECTION_CHANGE_COMMAND,
} from 'lexical';
import {useCallback, useEffect, useState} from 'react';

import {INITIAL_SETTINGS} from '../../context/SettingsContext';
import useModal from '../../hooks/useModal';
import {useFullscreen} from '../../context/FullscreenContext';
import Button from '../../ui/Button';
import {PLAYGROUND_TRANSFORMERS} from '../MarkdownTransformers';
import {
  SPEECH_TO_TEXT_COMMAND,
  SUPPORT_SPEECH_RECOGNITION,
} from '../SpeechToTextPlugin';

async function sendEditorState(editor: LexicalEditor): Promise<void> {
  const stringifiedEditorState = JSON.stringify(editor.getEditorState());
  try {
    await fetch('http://localhost:1235/setEditorState', {
      body: stringifiedEditorState,
      headers: {
        Accept: 'application/json',
        'Content-type': 'application/json',
      },
      method: 'POST',
    });
  } catch {
    // NO-OP
  }
}

async function validateEditorState(editor: LexicalEditor): Promise<void> {
  const stringifiedEditorState = JSON.stringify(editor.getEditorState());
  let response = null;
  try {
    response = await fetch('http://localhost:1235/validateEditorState', {
      body: stringifiedEditorState,
      headers: {
        Accept: 'application/json',
        'Content-type': 'application/json',
      },
      method: 'POST',
    });
  } catch {
    // NO-OP
  }
  if (response !== null && response.status === 403) {
    throw new Error(
      'Editor state validation failed! Server did not accept changes.',
    );
  }
}

export default function ActionsPlugin({
  shouldPreserveNewLinesInMarkdown,
}: {
  shouldPreserveNewLinesInMarkdown: boolean;
}): JSX.Element {
  const [editor] = useLexicalComposerContext();
  const [isEditable, setIsEditable] = useState(() => editor.isEditable());
  const [isSpeechToText, setIsSpeechToText] = useState(false);
  const [isEditorEmpty, setIsEditorEmpty] = useState(true);
  const [isConverting, setIsConverting] = useState(false);
  const [isMarkdown, setIsMarkdown] = useState(false);
  const [modal, showModal] = useModal();
  const {isFullscreen, toggleFullscreen} = useFullscreen();

  useEffect(() => {
    return mergeRegister(
      editor.registerEditableListener((editable) => {
        setIsEditable(editable);
      }),
    );
  }, [editor]);

  useEffect(() => {
    return editor.registerUpdateListener(
      ({dirtyElements, tags}) => {
        if (
          !isEditable &&
          dirtyElements.size > 0 &&
          !tags.has(HISTORIC_TAG)
        ) {
          validateEditorState(editor);
        }
        editor.getEditorState().read(() => {
          const root = $getRoot();
          const children = root.getChildren();
          const firstChild = children[0];

          // Track whether editor is in markdown (source) mode
          setIsMarkdown(
            children.length === 1 &&
            $isCodeNode(firstChild) &&
            firstChild.getLanguage() === 'markdown',
          );

          if (children.length > 1) {
            setIsEditorEmpty(false);
          } else {
            if ($isParagraphNode(firstChild)) {
              const paragraphChildren = firstChild.getChildren();
              setIsEditorEmpty(paragraphChildren.length === 0);
            } else {
              setIsEditorEmpty(false);
            }
          }
        });
      },
    );
  }, [editor, isEditable]);

  const handleMarkdownToggle = useCallback(() => {
    if (isConverting) return;

    // Check if editor is currently in markdown (code block) mode
    const currentlyMarkdown = editor.getEditorState().read(() => {
      const root = $getRoot();
      const firstChild = root.getFirstChild();
      return $isCodeNode(firstChild) && firstChild.getLanguage() === 'markdown';
    });

    if (currentlyMarkdown) {
      // ── Markdown → Rich text ──
      setIsConverting(true);

      // Double rAF guarantees the browser has painted the spinner
      // before the synchronous conversion blocks the main thread.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          try {
            // Read the markdown text from the code block first
            const markdownText = editor.getEditorState().read(() => {
              const root = $getRoot();
              const firstChild = root.getFirstChild();
              return $isCodeNode(firstChild) ? firstChild.getTextContent() : '';
            });

            editor.update(
              () => {
                const root = $getRoot();
                root.clear();
                $convertFromMarkdownString(
                  markdownText,
                  PLAYGROUND_TRANSFORMERS,
                  undefined, // operate on $getRoot()
                  shouldPreserveNewLinesInMarkdown,
                );
                // Ensure a valid selection exists on the newly-created content
                $getRoot().selectEnd();
              },
              { tag: 'historic' },
            );
            // Force the ToolbarPlugin to re-read the new editor state
            editor.dispatchCommand(SELECTION_CHANGE_COMMAND, undefined);
          } finally {
            setIsConverting(false);
          }
        });
      });
    } else {
      // ── Rich text → Markdown ──
      setIsConverting(true);

      // Double rAF guarantees the browser has painted the spinner
      // before the synchronous serialization blocks the main thread.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          try {
            // Heavy work: serialize the entire editor tree to markdown
            const markdown = editor.getEditorState().read(() =>
              $convertToMarkdownString(
                PLAYGROUND_TRANSFORMERS,
                undefined,
                shouldPreserveNewLinesInMarkdown,
              ),
            );

            // Lightweight: swap the tree for a single code block
            editor.update(
              () => {
                const root = $getRoot();
                const codeNode = $createCodeNode('markdown');
                codeNode.append($createTextNode(markdown));
                root.clear().append(codeNode);
                codeNode.select();
              },
              { tag: 'historic' },
            );
            // Force the ToolbarPlugin to re-read the new editor state
            editor.dispatchCommand(SELECTION_CHANGE_COMMAND, undefined);
          } finally {
            setIsConverting(false);
          }
        });
      });
    }
  }, [editor, shouldPreserveNewLinesInMarkdown, isConverting]);

  return (
    <div className="actions">
      <button type="button"
        className={`action-button ${isFullscreen ? 'active' : ''}`}
        onClick={toggleFullscreen}
        title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
        <i className={isFullscreen ? 'fullscreen-exit' : 'fullscreen'} />
      </button>
      {SUPPORT_SPEECH_RECOGNITION && (
        <button type="button"
          onClick={() => {
            editor.dispatchCommand(SPEECH_TO_TEXT_COMMAND, !isSpeechToText);
            setIsSpeechToText(!isSpeechToText);
          }}
          className={
            'action-button action-button-mic ' +
            (isSpeechToText ? 'active' : '')
          }
          title="Speech To Text"
          aria-label={`${
            isSpeechToText ? 'Enable' : 'Disable'
          } speech to text`}>
          <i className="mic" />
        </button>
      )}
      <button type="button"
        className="action-button clear"
        disabled={isEditorEmpty}
        onClick={() => {
          showModal('Clear editor', (onClose) => (
            <ShowClearDialog editor={editor} onClose={onClose} />
          ));
        }}
        title="Clear"
        aria-label="Clear editor contents">
        <i className="clear" />
      </button>
      <button type="button"
        className={`action-button ${!isEditable ? 'unlock' : 'lock'}`}
        onClick={() => {
          if (isEditable) {
            sendEditorState(editor);
          }
          editor.setEditable(!editor.isEditable());
        }}
        title="Read-Only Mode"
        aria-label={`${!isEditable ? 'Unlock' : 'Lock'} read-only mode`}>
        <i className={!isEditable ? 'unlock' : 'lock'} />
      </button>
      <button type="button"
        className={`action-button ${isMarkdown ? 'active' : ''}`}
        onClick={handleMarkdownToggle}
        title={isMarkdown ? 'Convert to Rich Text' : 'Convert to Markdown'}
        aria-label={isMarkdown ? 'Convert to rich text' : 'Convert to markdown'}>
        {isConverting ? (
          <span className="action-button-spinner" />
        ) : (
          <i className="markdown" />
        )}
      </button>
      {modal}
    </div>
  );
}

function ShowClearDialog({
  editor,
  onClose,
}: {
  editor: LexicalEditor;
  onClose: () => void;
}): JSX.Element {
  return (
    <>
      Are you sure you want to clear the editor?
      <div className="Modal__content">
        <Button
          onClick={() => {
            editor.dispatchCommand(CLEAR_EDITOR_COMMAND, undefined);
            editor.focus();
            onClose();
          }}>
          Clear
        </Button>{' '}
        <Button
          onClick={() => {
            editor.focus();
            onClose();
          }}>
          Cancel
        </Button>
      </div>
    </>
  );
}
