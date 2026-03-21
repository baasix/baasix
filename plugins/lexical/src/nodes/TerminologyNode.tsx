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
  convertTerminology,
  parseTerminologyHtml,
} from '../utils/tnr-formatters';
import Modal from '../ui/Modal';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type TerminologyComponentProps = Readonly<{
  className: Readonly<{base: string; focus: string}>;
  format: ElementFormatType | null;
  nodeKey: NodeKey;
  html: string;
}>;

function TerminologyComponent({
  className,
  format,
  nodeKey,
  html,
}: TerminologyComponentProps) {
  const [editor] = useLexicalComposerContext();
  const isEditable = useLexicalEditable();
  const [isEditing, setIsEditing] = useState(false);
  const [items, setItems] = useState<Array<{term: string; definition: string}>>([]);

  const openEditor = useCallback(() => {
    setItems(parseTerminologyHtml(html));
    setIsEditing(true);
  }, [html]);

  const preview = useMemo(() => {
    if (!isEditing) return '';
    const text = items
      .filter((i) => i.term || i.definition)
      .map((i) => (i.term ? `${i.term}: ${i.definition}` : i.definition))
      .join('\n');
    return text ? convertTerminology(text) : '';
  }, [isEditing, items]);

  const saveChanges = useCallback(() => {
    if (!preview) return;
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isTerminologyNode(node)) {
        node.setHtml(preview);
      }
    });
    setIsEditing(false);
  }, [editor, nodeKey, preview]);

  const cancelEdit = useCallback(() => {
    setIsEditing(false);
  }, []);

  const updateItem = useCallback((index: number, field: 'term' | 'definition', value: string) => {
    setItems((prev) => prev.map((item, i) => (i === index ? {...item, [field]: value} : item)));
  }, []);

  const addItem = useCallback(() => {
    setItems((prev) => [...prev, {term: '', definition: ''}]);
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
              background: CARD_STYLES.terminology.keyColor,
              color: '#fff', border: 'none', borderRadius: 4,
              padding: '2px 8px', fontSize: 12, cursor: 'pointer',
              opacity: 0, transition: 'opacity 0.15s',
            }}
            className="html-block-edit-btn"
          >
            Edit Terminology
          </button>
        )}
        <div dangerouslySetInnerHTML={{__html: html}} />
      </div>
      {isEditing && (
        <Modal onClose={cancelEdit} title="Edit Terminology">
          <div style={{minWidth: 500}}>
            {items.map((item, index) => (
              <div key={index} style={{display: 'flex', gap: 4, marginBottom: 4, alignItems: 'center'}}>
                <input
                  type="text" placeholder="Term" value={item.term}
                  onChange={(e) => updateItem(index, 'term', e.target.value)}
                  style={{width: '30%', padding: '4px 6px', fontSize: 12, border: '1px solid #ddd', borderRadius: 4}}
                />
                <input
                  type="text" placeholder="Definition" value={item.definition}
                  onChange={(e) => updateItem(index, 'definition', e.target.value)}
                  style={{flex: 1, padding: '4px 6px', fontSize: 12, border: '1px solid #ddd', borderRadius: 4}}
                />
                <button type="button" onClick={() => removeItem(index)}
                  style={{padding: '2px 6px', fontSize: 14, border: '1px solid #ddd', borderRadius: 4, background: '#fff', cursor: 'pointer', color: '#e11d48'}}>
                  ×
                </button>
              </div>
            ))}
            <button type="button" onClick={addItem}
              style={{padding: '2px 10px', fontSize: 12, border: '1px solid #ddd', borderRadius: 4, background: '#fff', cursor: 'pointer', marginTop: 4, marginBottom: 8}}>
              + Add Term
            </button>
            {preview && (
              <div style={{marginBottom: 8, padding: 8, border: '1px solid #e5e7eb', borderRadius: 4, background: '#fff', maxHeight: 200, overflow: 'auto'}}>
                <span style={{fontSize: 11, color: '#888', display: 'block', marginBottom: 4}}>Preview:</span>
                <div dangerouslySetInnerHTML={{__html: preview}} />
              </div>
            )}
            <div style={{display: 'flex', justifyContent: 'flex-end', gap: 8}}>
              <button type="button" onClick={cancelEdit}
                style={{padding: '6px 16px', fontSize: 13, border: '1px solid #ccc', borderRadius: 4, background: '#fff', cursor: 'pointer'}}>
                Cancel
              </button>
              <button type="button" onClick={saveChanges} disabled={!preview}
                style={{padding: '6px 16px', fontSize: 13, border: 'none', borderRadius: 4, background: '#2563eb', color: '#fff', cursor: 'pointer', opacity: preview ? 1 : 0.5}}>
                Save
              </button>
            </div>
          </div>
        </Modal>
      )}
    </BlockWithAlignableContents>
  );
}

// ---------------------------------------------------------------------------
// Node
// ---------------------------------------------------------------------------

export type SerializedTerminologyNode = Spread<{html: string}, SerializedDecoratorBlockNode>;

const DATA_ATTR = 'data-lexical-terminology';

export class TerminologyNode extends DecoratorBlockNode {
  __html: string;

  static getType(): string {
    return 'terminology-block';
  }

  static clone(node: TerminologyNode): TerminologyNode {
    return new TerminologyNode(node.__html, node.__format, node.__key);
  }

  static importJSON(serializedNode: SerializedTerminologyNode): TerminologyNode {
    return $createTerminologyNode(serializedNode.html).updateFromJSON(serializedNode);
  }

  exportJSON(): SerializedTerminologyNode {
    return {...super.exportJSON(), html: this.__html};
  }

  static importDOM(): DOMConversionMap | null {
    return {
      div: (domNode: HTMLElement) => {
        if (!domNode.hasAttribute(DATA_ATTR)) return null;
        return {conversion: convertTerminologyElement, priority: 2};
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
      <TerminologyComponent
        className={cls}
        format={this.__format}
        nodeKey={this.getKey()}
        html={this.__html}
      />
    );
  }
}

function convertTerminologyElement(domNode: HTMLElement): DOMConversionOutput | null {
  const html = domNode.innerHTML;
  if (html) return {node: $createTerminologyNode(html)};
  return null;
}

export function $createTerminologyNode(html: string): TerminologyNode {
  return new TerminologyNode(html);
}

export function $isTerminologyNode(node: LexicalNode | null | undefined): node is TerminologyNode {
  return node instanceof TerminologyNode;
}
