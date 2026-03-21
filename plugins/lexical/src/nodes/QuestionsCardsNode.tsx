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
  convertQuestionsCards,
  parseQuestionsCardsHtml,
} from '../utils/tnr-formatters';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type QuestionsCardsComponentProps = Readonly<{
  className: Readonly<{base: string; focus: string}>;
  format: ElementFormatType | null;
  nodeKey: NodeKey;
  html: string;
}>;

const GRID_SECTION_KEYS = [
  'rubric', 'mnemonics', 'examiner', 'diagram', 'revision',
  'clinical', 'structure', 'variations', 'tips',
] as const;

function QuestionsCardsComponent({
  className,
  format,
  nodeKey,
  html,
}: QuestionsCardsComponentProps) {
  const [editor] = useLexicalComposerContext();
  const isEditable = useLexicalEditable();
  type QAEditorPair = {
    question: string;
    answer: string;
    sections: Array<{key: string; content: string}>;
  };

  const [isEditing, setIsEditing] = useState(false);
  const [qaPairs, setQaPairs] = useState<QAEditorPair[]>([]);

  const makeEmptyQA = (): QAEditorPair => ({
    question: '', answer: '',
    sections: GRID_SECTION_KEYS.map((k) => ({key: k, content: ''})),
  });

  const openEditor = useCallback(() => {
    const parsed = parseQuestionsCardsHtml(html);
    const pairs: QAEditorPair[] = parsed.qaPairs.map((qa) => {
      const existing = qa.sections || [];
      const all = GRID_SECTION_KEYS.map((k) => {
        const found = existing.find((s) => s.key === k);
        return found || {key: k, content: ''};
      });
      return {question: qa.question, answer: qa.answer, sections: all};
    });
    setQaPairs(pairs.length > 0 ? pairs : [makeEmptyQA()]);
    setIsEditing(true);
  }, [html]);

  const preview = useMemo(() => {
    if (!isEditing) return '';
    const cStyles = CARD_STYLES.questionsCards;
    const lines: string[] = [];
    qaPairs.forEach((qa, idx) => {
      if (qa.question) lines.push(`${idx + 1}. Question: ${qa.question}`);
      if (qa.answer) lines.push(`Answer: ${qa.answer}`);
      qa.sections.forEach((s) => {
        const sStyle = cStyles[s.key as keyof typeof cStyles];
        if (sStyle && 'title' in sStyle && s.content) {
          lines.push(sStyle.title);
          lines.push(s.content);
        }
      });
    });
    const text = lines.join('\n');
    return text.trim() ? convertQuestionsCards(text) : '';
  }, [isEditing, qaPairs]);

  const saveChanges = useCallback(() => {
    if (!preview) return;
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isQuestionsCardsNode(node)) {
        node.setHtml(preview);
      }
    });
    setIsEditing(false);
  }, [editor, nodeKey, preview]);

  const cancelEdit = useCallback(() => {
    setIsEditing(false);
  }, []);

  const updateQA = useCallback((idx: number, field: 'question' | 'answer', value: string) => {
    setQaPairs((prev) => prev.map((qa, i) => (i === idx ? {...qa, [field]: value} : qa)));
  }, []);

  const addQAPair = useCallback(() => {
    setQaPairs((prev) => [...prev, makeEmptyQA()]);
  }, []);

  const removeQAPair = useCallback((idx: number) => {
    setQaPairs((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const updateSection = useCallback((qIdx: number, sIdx: number, value: string) => {
    setQaPairs((prev) => prev.map((qa, i) => {
      if (i !== qIdx) return qa;
      return {...qa, sections: qa.sections.map((s, j) => (j === sIdx ? {...s, content: value} : s))};
    }));
  }, []);

  const styles = CARD_STYLES.questionsCards;

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
              background: 'rgba(25, 118, 210, 0.8)',
              color: '#fff', border: 'none', borderRadius: 4,
              padding: '2px 8px', fontSize: 12, cursor: 'pointer',
              opacity: 0, transition: 'opacity 0.15s',
            }}
            className="html-block-edit-btn"
          >
            Edit Questions Card
          </button>
        )}
        <div dangerouslySetInnerHTML={{__html: html}} />
        {isEditing && (
          <Modal onClose={cancelEdit} title="Edit Questions Card">
            <div style={{minWidth: 500}}>
              {/* Q&A Pairs */}
              {qaPairs.map((qa, qIdx) => (
                <div key={qIdx} style={{border: '1px solid #e5e7eb', borderRadius: 6, padding: 8, marginBottom: 8, background: '#fff'}}>
                  <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4}}>
                    <span style={{fontSize: 12, fontWeight: 600, color: '#1976d2'}}>Q{qIdx + 1}</span>
                    {qaPairs.length > 1 && (
                      <button type="button" onClick={() => removeQAPair(qIdx)}
                        style={{padding: '2px 6px', fontSize: 14, border: '1px solid #ddd', borderRadius: 4, background: '#fff', cursor: 'pointer', color: '#e11d48'}}>
                        ×
                      </button>
                    )}
                  </div>
                  <div style={{marginBottom: 4}}>
                    <label style={{fontSize: 11, color: '#1976d2', fontWeight: 600, display: 'block', marginBottom: 2}}>Question</label>
                    <textarea
                      placeholder="Enter question text..." value={qa.question}
                      onChange={(e) => updateQA(qIdx, 'question', e.target.value)}
                      style={{width: '100%', padding: '4px 6px', fontSize: 12, border: '1px solid #ddd', borderRadius: 4, minHeight: 40, resize: 'vertical'}}
                    />
                  </div>
                  <div style={{marginBottom: 4}}>
                    <label style={{fontSize: 11, color: '#666', fontWeight: 600, display: 'block', marginBottom: 2}}>Answer</label>
                    <textarea
                      placeholder="Enter answer text..." value={qa.answer}
                      onChange={(e) => updateQA(qIdx, 'answer', e.target.value)}
                      style={{width: '100%', padding: '4px 6px', fontSize: 12, border: '1px solid #ddd', borderRadius: 4, minHeight: 60, resize: 'vertical'}}
                    />
                  </div>
                  {/* Sections for this Q&A */}
                  <details style={{marginTop: 4}}>
                    <summary style={{fontSize: 11, color: '#666', fontWeight: 600, cursor: 'pointer'}}>Card Sections</summary>
                    <div style={{marginTop: 4}}>
                      {qa.sections.map((section, sIdx) => {
                        const sStyle = styles[section.key as keyof typeof styles];
                        const label = sStyle && 'title' in sStyle ? sStyle.title : section.key;
                        return (
                          <div key={sIdx} style={{marginBottom: 4}}>
                            <label style={{fontSize: 11, color: '#666', display: 'block', marginBottom: 2}}>{label}</label>
                            <textarea
                              placeholder={`${label} content...`} value={section.content}
                              onChange={(e) => updateSection(qIdx, sIdx, e.target.value)}
                              style={{width: '100%', padding: '4px 6px', fontSize: 12, border: '1px solid #ddd', borderRadius: 4, minHeight: 40, resize: 'vertical'}}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </details>
                </div>
              ))}
              <button type="button" onClick={addQAPair}
                style={{padding: '2px 10px', fontSize: 12, border: '1px solid #ddd', borderRadius: 4, background: '#fff', cursor: 'pointer', marginBottom: 8}}>
                + Add Question
              </button>
              {preview && (
                <div style={{marginTop: 8, padding: 8, border: '1px solid #e5e7eb', borderRadius: 4, background: '#fff', maxHeight: 200, overflow: 'auto'}}>
                  <span style={{fontSize: 11, color: '#888', display: 'block', marginBottom: 4}}>Preview:</span>
                  <div dangerouslySetInnerHTML={{__html: preview}} />
                </div>
              )}
              <div style={{display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12}}>
                <button type="button" onClick={cancelEdit} style={{padding: '6px 16px', fontSize: 13, border: '1px solid #ccc', borderRadius: 4, background: '#fff', cursor: 'pointer'}}>Cancel</button>
                <button type="button" onClick={saveChanges} disabled={!preview} style={{padding: '6px 16px', fontSize: 13, border: 'none', borderRadius: 4, background: '#2563eb', color: '#fff', cursor: 'pointer', opacity: preview ? 1 : 0.5}}>Save</button>
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

export type SerializedQuestionsCardsNode = Spread<{html: string}, SerializedDecoratorBlockNode>;

const DATA_ATTR = 'data-lexical-questions-cards';

export class QuestionsCardsNode extends DecoratorBlockNode {
  __html: string;

  static getType(): string {
    return 'questions-cards-block';
  }

  static clone(node: QuestionsCardsNode): QuestionsCardsNode {
    return new QuestionsCardsNode(node.__html, node.__format, node.__key);
  }

  static importJSON(serializedNode: SerializedQuestionsCardsNode): QuestionsCardsNode {
    return $createQuestionsCardsNode(serializedNode.html).updateFromJSON(serializedNode);
  }

  exportJSON(): SerializedQuestionsCardsNode {
    return {...super.exportJSON(), html: this.__html};
  }

  static importDOM(): DOMConversionMap | null {
    return {
      div: (domNode: HTMLElement) => {
        if (!domNode.hasAttribute(DATA_ATTR)) return null;
        return {conversion: convertQuestionsCardsElement, priority: 2};
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
      <QuestionsCardsComponent
        className={cls}
        format={this.__format}
        nodeKey={this.getKey()}
        html={this.__html}
      />
    );
  }
}

function convertQuestionsCardsElement(domNode: HTMLElement): DOMConversionOutput | null {
  const html = domNode.innerHTML;
  if (html) return {node: $createQuestionsCardsNode(html)};
  return null;
}

export function $createQuestionsCardsNode(html: string): QuestionsCardsNode {
  return new QuestionsCardsNode(html);
}

export function $isQuestionsCardsNode(node: LexicalNode | null | undefined): node is QuestionsCardsNode {
  return node instanceof QuestionsCardsNode;
}
