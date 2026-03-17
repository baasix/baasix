import type {
  EditorConfig,
  ElementFormatType,
  LexicalEditor,
  LexicalNode,
  NodeKey,
  Spread,
  DOMConversionMap,
  DOMConversionOutput,
  DOMExportOutput,
} from 'lexical';
import {$getNodeByKey} from 'lexical';
import type {JSX} from 'react';

import {BlockWithAlignableContents} from '@lexical/react/LexicalBlockWithAlignableContents';
import {
  DecoratorBlockNode,
  SerializedDecoratorBlockNode,
} from '@lexical/react/LexicalDecoratorBlockNode';
import {useLexicalComposerContext} from '@lexical/react/LexicalComposerContext';
import {useLexicalEditable} from '@lexical/react/useLexicalEditable';
import * as React from 'react';
import {useCallback, useMemo, useState} from 'react';

import {
  CARD_STYLES,
  convertNotes,
  parseNotesHtml,
} from '../utils/tnr-formatters';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type NotesComponentProps = Readonly<{
  className: Readonly<{base: string; focus: string}>;
  format: ElementFormatType | null;
  nodeKey: NodeKey;
  html: string;
}>;

function NotesComponent({
  className,
  format,
  nodeKey,
  html,
}: NotesComponentProps) {
  const [editor] = useLexicalComposerContext();
  const isEditable = useLexicalEditable();
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState('');

  const openEditor = useCallback(() => {
    setEditText(parseNotesHtml(html));
    setIsEditing(true);
  }, [html]);

  const preview = useMemo(() => {
    if (!isEditing) return '';
    return editText.trim() ? convertNotes(editText) : '';
  }, [isEditing, editText]);

  const saveChanges = useCallback(() => {
    if (!preview) return;
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isNotesNode(node)) {
        node.setHtml(preview);
      }
    });
    setIsEditing(false);
  }, [editor, nodeKey, preview]);

  const cancelEdit = useCallback(() => {
    setIsEditing(false);
  }, []);

  return (
    <BlockWithAlignableContents className={className} format={format} nodeKey={nodeKey}>
      <div style={{position: 'relative'}}>
        {isEditable && !isEditing && (
          <button
            type="button"
            onClick={openEditor}
            onMouseDown={(e) => e.preventDefault()}
            style={{
              position: 'absolute', top: 4, right: 4, zIndex: 10,
              background: CARD_STYLES.notes.headingColor,
              color: '#fff', border: 'none', borderRadius: 4,
              padding: '2px 8px', fontSize: 12, cursor: 'pointer',
              opacity: 0, transition: 'opacity 0.15s',
            }}
            className="html-block-edit-btn"
          >
            Edit Notes
          </button>
        )}
        {isEditing ? (
          <div style={{border: '1px solid #ccc', borderRadius: 4, padding: 8, background: '#f9f9f9'}}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8}}>
              <span style={{fontSize: 13, fontWeight: 600, color: CARD_STYLES.notes.headingColor}}>
                Edit Notes
              </span>
              <div style={{display: 'flex', gap: 4}}>
                <button type="button" onClick={cancelEdit}
                  style={{padding: '2px 10px', fontSize: 12, border: '1px solid #ccc', borderRadius: 4, background: '#fff', cursor: 'pointer'}}>
                  Cancel
                </button>
                <button type="button" onClick={saveChanges} disabled={!preview}
                  style={{padding: '2px 10px', fontSize: 12, border: 'none', borderRadius: 4, background: '#2563eb', color: '#fff', cursor: 'pointer', opacity: preview ? 1 : 0.5}}>
                  Save
                </button>
              </div>
            </div>
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              style={{
                width: '100%', minHeight: 150, fontFamily: 'monospace', fontSize: 12,
                padding: 8, border: '1px solid #ddd', borderRadius: 4, resize: 'vertical',
              }}
            />
            {preview && (
              <div style={{marginTop: 8, padding: 8, border: '1px solid #e5e7eb', borderRadius: 4, background: '#fff'}}>
                <span style={{fontSize: 11, color: '#888', display: 'block', marginBottom: 4}}>Preview:</span>
                <div dangerouslySetInnerHTML={{__html: preview}} />
              </div>
            )}
          </div>
        ) : (
          <div dangerouslySetInnerHTML={{__html: html}} />
        )}
      </div>
    </BlockWithAlignableContents>
  );
}

// ---------------------------------------------------------------------------
// Node
// ---------------------------------------------------------------------------

export type SerializedNotesNode = Spread<{html: string}, SerializedDecoratorBlockNode>;

const DATA_ATTR = 'data-lexical-notes';

export class NotesNode extends DecoratorBlockNode {
  __html: string;

  static getType(): string {
    return 'notes-block';
  }

  static clone(node: NotesNode): NotesNode {
    return new NotesNode(node.__html, node.__format, node.__key);
  }

  static importJSON(serializedNode: SerializedNotesNode): NotesNode {
    return $createNotesNode(serializedNode.html).updateFromJSON(serializedNode);
  }

  exportJSON(): SerializedNotesNode {
    return {...super.exportJSON(), html: this.__html};
  }

  static importDOM(): DOMConversionMap | null {
    return {
      div: (domNode: HTMLElement) => {
        if (!domNode.hasAttribute(DATA_ATTR)) return null;
        return {conversion: convertNotesElement, priority: 2};
      },
    };
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement('div');
    element.setAttribute(DATA_ATTR, 'true');
    element.innerHTML = this.__html;
    return {element};
  }

  constructor(html: string, format?: ElementFormatType, key?: NodeKey) {
    super(format, key);
    this.__html = html;
  }

  updateDOM(): false {
    return false;
  }

  getHtml(): string {
    return this.__html;
  }

  setHtml(html: string): void {
    const writable = this.getWritable();
    writable.__html = html;
  }

  getTextContent(): string {
    const parser = new DOMParser();
    const doc = parser.parseFromString(this.__html, 'text/html');
    return doc.body.textContent || '';
  }

  decorate(_editor: LexicalEditor, config: EditorConfig): JSX.Element {
    const embedBlockTheme = config.theme.embedBlock || {};
    const cls = {base: embedBlockTheme.base || '', focus: embedBlockTheme.focus || ''};
    return (
      <NotesComponent
        className={cls}
        format={this.__format}
        nodeKey={this.getKey()}
        html={this.__html}
      />
    );
  }
}

function convertNotesElement(domNode: HTMLElement): DOMConversionOutput | null {
  const html = domNode.innerHTML;
  if (html) return {node: $createNotesNode(html)};
  return null;
}

export function $createNotesNode(html: string): NotesNode {
  return new NotesNode(html);
}

export function $isNotesNode(node: LexicalNode | null | undefined): node is NotesNode {
  return node instanceof NotesNode;
}
