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
  convertTextCards,
  parseTextCardsHtml,
} from '../utils/tnr-formatters';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type TextCardsComponentProps = Readonly<{
  className: Readonly<{base: string; focus: string}>;
  format: ElementFormatType | null;
  nodeKey: NodeKey;
  html: string;
}>;

const SECTION_KEYS = [
  'criticalThinking',
  'clinicalApplication',
  'example',
  'rationalization',
  'criticalInsight',
] as const;

function TextCardsComponent({
  className,
  format,
  nodeKey,
  html,
}: TextCardsComponentProps) {
  const [editor] = useLexicalComposerContext();
  const isEditable = useLexicalEditable();
  const [isEditing, setIsEditing] = useState(false);
  const [concepts, setConcepts] = useState<
    Array<{conceptTitle: string; sections: Array<{key: string; content: string}>}>
  >([]);

  const openEditor = useCallback(() => {
    const parsed = parseTextCardsHtml(html);
    if (parsed.length === 0) {
      parsed.push({
        conceptTitle: '',
        sections: SECTION_KEYS.map((k) => ({key: k, content: ''})),
      });
    } else {
      // Ensure all section keys exist
      parsed.forEach((c) => {
        SECTION_KEYS.forEach((k) => {
          if (!c.sections.find((s) => s.key === k)) {
            c.sections.push({key: k, content: ''});
          }
        });
      });
    }
    setConcepts(parsed);
    setIsEditing(true);
  }, [html]);

  const preview = useMemo(() => {
    if (!isEditing) return '';
    // Convert structured data back to plain text for the converter
    const lines: string[] = [];
    concepts.forEach((concept, i) => {
      lines.push(`CONCEPT ${i + 1}: ${concept.conceptTitle}`);
      concept.sections.forEach((s) => {
        const styles = CARD_STYLES.textCards;
        const sectionStyle = styles[s.key as keyof typeof styles];
        if (sectionStyle && 'title' in sectionStyle && s.content) {
          lines.push(sectionStyle.title);
          lines.push(s.content);
        }
      });
    });
    const text = lines.join('\n');
    return text.trim() ? convertTextCards(text) : '';
  }, [isEditing, concepts]);

  const saveChanges = useCallback(() => {
    if (!preview) return;
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isTextCardsNode(node)) {
        node.setHtml(preview);
      }
    });
    setIsEditing(false);
  }, [editor, nodeKey, preview]);

  const cancelEdit = useCallback(() => {
    setIsEditing(false);
  }, []);

  const updateConceptTitle = useCallback((idx: number, value: string) => {
    setConcepts((prev) =>
      prev.map((c, i) => (i === idx ? {...c, conceptTitle: value} : c)),
    );
  }, []);

  const updateSection = useCallback((cIdx: number, sIdx: number, value: string) => {
    setConcepts((prev) =>
      prev.map((c, ci) =>
        ci === cIdx
          ? {
              ...c,
              sections: c.sections.map((s, si) =>
                si === sIdx ? {...s, content: value} : s,
              ),
            }
          : c,
      ),
    );
  }, []);

  const addConcept = useCallback(() => {
    setConcepts((prev) => [
      ...prev,
      {
        conceptTitle: '',
        sections: SECTION_KEYS.map((k) => ({key: k, content: ''})),
      },
    ]);
  }, []);

  const removeConcept = useCallback((idx: number) => {
    setConcepts((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const styles = CARD_STYLES.textCards;

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
              background: 'rgba(76, 175, 80, 0.8)',
              color: '#fff', border: 'none', borderRadius: 4,
              padding: '2px 8px', fontSize: 12, cursor: 'pointer',
              opacity: 0, transition: 'opacity 0.15s',
            }}
            className="html-block-edit-btn"
          >
            Edit Text Cards
          </button>
        )}
        <div dangerouslySetInnerHTML={{__html: html}} />
        {isEditing && (
          <Modal onClose={cancelEdit} title="Edit Text Cards">
            <div style={{minWidth: 500, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0}}>
              {/* Scrollable concepts list */}
              <div style={{flex: 1, overflowY: 'auto', paddingRight: 4, minHeight: 0}}>
                {concepts.map((concept, cIdx) => (
                  <div key={cIdx} style={{border: '1px solid #e5e7eb', borderRadius: 6, padding: 8, marginBottom: 8, background: '#fff'}}>
                    <div style={{display: 'flex', gap: 4, marginBottom: 6, alignItems: 'center'}}>
                      <span style={{fontSize: 12, fontWeight: 600, color: '#4caf50', minWidth: 80}}>Concept {cIdx + 1}:</span>
                      <input
                        type="text" placeholder="Concept title" value={concept.conceptTitle}
                        onChange={(e) => updateConceptTitle(cIdx, e.target.value)}
                        style={{flex: 1, padding: '4px 6px', fontSize: 12, border: '1px solid #ddd', borderRadius: 4}}
                      />
                      {concepts.length > 1 && (
                        <button type="button" onClick={() => removeConcept(cIdx)}
                          style={{padding: '2px 6px', fontSize: 14, border: '1px solid #ddd', borderRadius: 4, background: '#fff', cursor: 'pointer', color: '#e11d48'}}>
                          ×
                        </button>
                      )}
                    </div>
                    {concept.sections.map((section, sIdx) => {
                      const sStyle = styles[section.key as keyof typeof styles];
                      const label = sStyle && 'title' in sStyle ? sStyle.title : section.key;
                      return (
                        <div key={sIdx} style={{marginBottom: 4}}>
                          <label style={{fontSize: 11, color: '#666', display: 'block', marginBottom: 2}}>{label}</label>
                          <textarea
                            placeholder={`${label} content...`} value={section.content}
                            onChange={(e) => updateSection(cIdx, sIdx, e.target.value)}
                            style={{width: '100%', padding: '4px 6px', fontSize: 12, border: '1px solid #ddd', borderRadius: 4, minHeight: 40, resize: 'vertical'}}
                          />
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
              {/* Fixed footer */}
              <div style={{flexShrink: 0, paddingTop: 8}}>
                <button type="button" onClick={addConcept}
                  style={{padding: '2px 10px', fontSize: 12, border: '1px solid #ddd', borderRadius: 4, background: '#fff', cursor: 'pointer', marginBottom: 8}}>
                  + Add Concept
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

export type SerializedTextCardsNode = Spread<{html: string}, SerializedDecoratorBlockNode>;

const DATA_ATTR = 'data-lexical-text-cards';

export class TextCardsNode extends DecoratorBlockNode {
  __html: string;

  static getType(): string {
    return 'text-cards-block';
  }

  static clone(node: TextCardsNode): TextCardsNode {
    return new TextCardsNode(node.__html, node.__format, node.__key);
  }

  static importJSON(serializedNode: SerializedTextCardsNode): TextCardsNode {
    return $createTextCardsNode(serializedNode.html).updateFromJSON(serializedNode);
  }

  exportJSON(): SerializedTextCardsNode {
    return {...super.exportJSON(), html: this.__html};
  }

  static importDOM(): DOMConversionMap | null {
    return {
      div: (domNode: HTMLElement) => {
        if (!domNode.hasAttribute(DATA_ATTR)) return null;
        return {conversion: convertTextCardsElement, priority: 2};
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
      <TextCardsComponent
        className={cls}
        format={this.__format}
        nodeKey={this.getKey()}
        html={this.__html}
      />
    );
  }
}

function convertTextCardsElement(domNode: HTMLElement): DOMConversionOutput | null {
  const html = domNode.innerHTML;
  if (html) return {node: $createTextCardsNode(html)};
  return null;
}

export function $createTextCardsNode(html: string): TextCardsNode {
  return new TextCardsNode(html);
}

export function $isTextCardsNode(node: LexicalNode | null | undefined): node is TextCardsNode {
  return node instanceof TextCardsNode;
}
