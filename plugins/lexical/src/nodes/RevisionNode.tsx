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

import Modal from '../ui/Modal';
import {
  CARD_STYLES,
  convertRevision,
  parseRevisionHtml,
} from '../utils/tnr-formatters';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type RevisionComponentProps = Readonly<{
  className: Readonly<{base: string; focus: string}>;
  format: ElementFormatType | null;
  nodeKey: NodeKey;
  html: string;
}>;

function RevisionComponent({
  className,
  format,
  nodeKey,
  html,
}: RevisionComponentProps) {
  const [editor] = useLexicalComposerContext();
  const isEditable = useLexicalEditable();
  const [isEditing, setIsEditing] = useState(false);
  const [items, setItems] = useState<string[]>([]);

  const openEditor = useCallback(() => {
    setItems(parseRevisionHtml(html));
    setIsEditing(true);
  }, [html]);

  const preview = useMemo(() => {
    if (!isEditing) return '';
    const filtered = items.filter((i) => i.trim());
    return filtered.length > 0 ? convertRevision(filtered.join('\n')) : '';
  }, [isEditing, items]);

  const saveChanges = useCallback(() => {
    if (!preview) return;
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isRevisionNode(node)) {
        node.setHtml(preview);
      }
    });
    setIsEditing(false);
  }, [editor, nodeKey, preview]);

  const cancelEdit = useCallback(() => {
    setIsEditing(false);
  }, []);

  const updateItem = useCallback((index: number, value: string) => {
    setItems((prev) => prev.map((item, i) => (i === index ? value : item)));
  }, []);

  const addItem = useCallback(() => {
    setItems((prev) => [...prev, '']);
  }, []);

  const removeItem = useCallback((index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }, []);

  return (
    <BlockWithAlignableContents className={className} format={format} nodeKey={nodeKey}>
      <div style={{position: 'relative'}}>
        {isEditable && (
          <button
            type="button"
            onClick={openEditor}
            onMouseDown={(e) => e.preventDefault()}
            style={{
              position: 'absolute', top: 4, right: 4, zIndex: 10,
              background: '#c2703a',
              color: '#fff', border: 'none', borderRadius: 4,
              padding: '2px 8px', fontSize: 12, cursor: 'pointer',
              opacity: 0, transition: 'opacity 0.15s',
            }}
            className="html-block-edit-btn"
          >
            Edit Revision
          </button>
        )}
        <div dangerouslySetInnerHTML={{__html: html}} />
        {isEditing && (
          <Modal onClose={cancelEdit} title="Edit Revision Points">
            <div style={{minWidth: 500, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0}}>
              {/* Scrollable items */}
              <div style={{flex: 1, overflowY: 'auto', paddingRight: 4, minHeight: 0}}>
                {items.map((item, index) => (
                  <div key={index} style={{display: 'flex', gap: 4, marginBottom: 4, alignItems: 'center'}}>
                    <span style={{fontSize: 14, flexShrink: 0}}>✅</span>
                    <input
                      type="text" placeholder="Revision point" value={item}
                      onChange={(e) => updateItem(index, e.target.value)}
                      style={{flex: 1, padding: '4px 6px', fontSize: 12, border: '1px solid #ddd', borderRadius: 4}}
                    />
                    <button type="button" onClick={() => removeItem(index)}
                      style={{padding: '2px 6px', fontSize: 14, border: '1px solid #ddd', borderRadius: 4, background: '#fff', cursor: 'pointer', color: '#e11d48'}}>
                      ×
                    </button>
                  </div>
                ))}
              </div>
              {/* Fixed footer */}
              <div style={{flexShrink: 0, paddingTop: 8}}>
                <button type="button" onClick={addItem}
                  style={{padding: '2px 10px', fontSize: 12, border: '1px solid #ddd', borderRadius: 4, background: '#fff', cursor: 'pointer', marginBottom: 8}}>
                  + Add Point
                </button>
                {preview && (
                  <div style={{marginBottom: 8, padding: 8, border: '1px solid #e5e7eb', borderRadius: 4, background: '#fff', maxHeight: 150, overflow: 'auto'}}>
                    <span style={{fontSize: 11, color: '#888', display: 'block', marginBottom: 4}}>Preview:</span>
                    <div dangerouslySetInnerHTML={{__html: preview}} />
                  </div>
                )}
                <div style={{display: 'flex', justifyContent: 'flex-end', gap: 8}}>
                  <button type="button" onClick={cancelEdit} style={{padding: '6px 16px', fontSize: 13, border: '1px solid #ccc', borderRadius: 4, background: '#fff', cursor: 'pointer'}}>Cancel</button>
                  <button type="button" onClick={saveChanges} disabled={!preview} style={{padding: '6px 16px', fontSize: 13, border: 'none', borderRadius: 4, background: '#2563eb', color: '#fff', cursor: 'pointer', opacity: preview ? 1 : 0.5}}>Save</button>
                </div>
              </div>
            </div>
          </Modal>
        )}
      </div>
    </BlockWithAlignableContents>
  );
}

// ---------------------------------------------------------------------------
// Node
// ---------------------------------------------------------------------------

export type SerializedRevisionNode = Spread<{html: string}, SerializedDecoratorBlockNode>;

const DATA_ATTR = 'data-lexical-revision';

export class RevisionNode extends DecoratorBlockNode {
  __html: string;

  static getType(): string {
    return 'revision-block';
  }

  static clone(node: RevisionNode): RevisionNode {
    return new RevisionNode(node.__html, node.__format, node.__key);
  }

  static importJSON(serializedNode: SerializedRevisionNode): RevisionNode {
    return $createRevisionNode(serializedNode.html).updateFromJSON(serializedNode);
  }

  exportJSON(): SerializedRevisionNode {
    return {...super.exportJSON(), html: this.__html};
  }

  static importDOM(): DOMConversionMap | null {
    return {
      div: (domNode: HTMLElement) => {
        if (!domNode.hasAttribute(DATA_ATTR)) return null;
        return {conversion: convertRevisionElement, priority: 2};
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
      <RevisionComponent
        className={cls}
        format={this.__format}
        nodeKey={this.getKey()}
        html={this.__html}
      />
    );
  }
}

function convertRevisionElement(domNode: HTMLElement): DOMConversionOutput | null {
  const html = domNode.innerHTML;
  if (html) return {node: $createRevisionNode(html)};
  return null;
}

export function $createRevisionNode(html: string): RevisionNode {
  return new RevisionNode(html);
}

export function $isRevisionNode(node: LexicalNode | null | undefined): node is RevisionNode {
  return node instanceof RevisionNode;
}
