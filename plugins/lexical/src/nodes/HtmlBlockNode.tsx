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
import {useCallback, useRef, useState} from 'react';

type HtmlBlockComponentProps = Readonly<{
  className: Readonly<{
    base: string;
    focus: string;
  }>;
  format: ElementFormatType | null;
  nodeKey: NodeKey;
  html: string;
}>;

function HtmlBlockComponent({
  className,
  format,
  nodeKey,
  html,
}: HtmlBlockComponentProps) {
  const [editor] = useLexicalComposerContext();
  const isEditable = useLexicalEditable();
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const openEditor = useCallback(() => {
    setEditValue(html);
    setIsEditing(true);
    // Focus textarea after render
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, [html]);

  const saveHtml = useCallback(() => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isHtmlBlockNode(node)) {
        node.setHtml(editValue);
      }
    });
    setIsEditing(false);
  }, [editor, nodeKey, editValue]);

  const cancelEdit = useCallback(() => {
    setIsEditing(false);
  }, []);

  return (
    <BlockWithAlignableContents
      className={className}
      format={format}
      nodeKey={nodeKey}>
      <div style={{position: 'relative'}}>
        {isEditable && !isEditing && (
          <button
            type="button"
            onClick={openEditor}
            onMouseDown={(e) => e.preventDefault()}
            style={{
              position: 'absolute',
              top: 4,
              right: 4,
              zIndex: 10,
              background: 'rgba(0,0,0,0.6)',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              padding: '2px 8px',
              fontSize: 12,
              cursor: 'pointer',
              opacity: 0,
              transition: 'opacity 0.15s',
            }}
            className="html-block-edit-btn"
          >
            Edit HTML
          </button>
        )}
        {isEditing ? (
          <div style={{border: '1px solid #ccc', borderRadius: 4, padding: 8, background: '#f9f9f9'}}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6}}>
              <span style={{fontSize: 12, fontWeight: 600, color: '#333'}}>Edit HTML Source</span>
              <div style={{display: 'flex', gap: 4}}>
                <button
                  type="button"
                  onClick={cancelEdit}
                  style={{
                    padding: '2px 10px',
                    fontSize: 12,
                    border: '1px solid #ccc',
                    borderRadius: 4,
                    background: '#fff',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveHtml}
                  style={{
                    padding: '2px 10px',
                    fontSize: 12,
                    border: 'none',
                    borderRadius: 4,
                    background: '#2563eb',
                    color: '#fff',
                    cursor: 'pointer',
                  }}
                >
                  Save
                </button>
              </div>
            </div>
            <textarea
              ref={textareaRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              style={{
                width: '100%',
                minHeight: 150,
                fontFamily: 'monospace',
                fontSize: 12,
                padding: 8,
                border: '1px solid #ddd',
                borderRadius: 4,
                resize: 'vertical',
              }}
            />
            <div
              style={{marginTop: 8, padding: 8, border: '1px solid #e5e7eb', borderRadius: 4, background: '#fff'}}
            >
              <span style={{fontSize: 11, color: '#888', display: 'block', marginBottom: 4}}>Preview:</span>
              <div dangerouslySetInnerHTML={{__html: editValue}} />
            </div>
          </div>
        ) : (
          <div dangerouslySetInnerHTML={{__html: html}} />
        )}
      </div>
    </BlockWithAlignableContents>
  );
}

export type SerializedHtmlBlockNode = Spread<
  {
    html: string;
  },
  SerializedDecoratorBlockNode
>;

const DATA_ATTR = 'data-lexical-html-block';

export class HtmlBlockNode extends DecoratorBlockNode {
  __html: string;

  static getType(): string {
    return 'html-block';
  }

  static clone(node: HtmlBlockNode): HtmlBlockNode {
    return new HtmlBlockNode(node.__html, node.__format, node.__key);
  }

  static importJSON(serializedNode: SerializedHtmlBlockNode): HtmlBlockNode {
    return $createHtmlBlockNode(serializedNode.html).updateFromJSON(
      serializedNode,
    );
  }

  exportJSON(): SerializedHtmlBlockNode {
    return {
      ...super.exportJSON(),
      html: this.__html,
    };
  }

  static importDOM(): DOMConversionMap | null {
    return {
      div: (domNode: HTMLElement) => {
        if (!domNode.hasAttribute(DATA_ATTR)) {
          return null;
        }
        return {
          conversion: convertHtmlBlockElement,
          priority: 2,
        };
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
    const className = {
      base: embedBlockTheme.base || '',
      focus: embedBlockTheme.focus || '',
    };
    return (
      <HtmlBlockComponent
        className={className}
        format={this.__format}
        nodeKey={this.getKey()}
        html={this.__html}
      />
    );
  }
}

function convertHtmlBlockElement(
  domNode: HTMLElement,
): DOMConversionOutput | null {
  const html = domNode.innerHTML;
  if (html) {
    return {node: $createHtmlBlockNode(html)};
  }
  return null;
}

export function $createHtmlBlockNode(html: string): HtmlBlockNode {
  return new HtmlBlockNode(html);
}

export function $isHtmlBlockNode(
  node: LexicalNode | null | undefined,
): node is HtmlBlockNode {
  return node instanceof HtmlBlockNode;
}
