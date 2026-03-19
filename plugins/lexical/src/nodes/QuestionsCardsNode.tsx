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
  const [isEditing, setIsEditing] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [sections, setSections] = useState<Array<{key: string; content: string}>>([]);

  const openEditor = useCallback(() => {
    const parsed = parseQuestionsCardsHtml(html);
    setQuestion(parsed.question);
    setAnswer(parsed.answer);
    // Ensure all section keys exist
    const existing = parsed.sections;
    const all = GRID_SECTION_KEYS.map((k) => {
      const found = existing.find((s) => s.key === k);
      return found || {key: k, content: ''};
    });
    setSections(all);
    setIsEditing(true);
  }, [html]);

  const preview = useMemo(() => {
    if (!isEditing) return '';
    const styles = CARD_STYLES.questionsCards;
    const lines: string[] = [];
    if (question) {
      lines.push(`Q1. ${question}`);
    }
    if (answer) {
      lines.push('Answer:');
      lines.push(answer);
    }
    sections.forEach((s) => {
      const sStyle = styles[s.key as keyof typeof styles];
      if (sStyle && 'title' in sStyle && s.content) {
        lines.push(sStyle.title);
        lines.push(s.content);
      }
    });
    const text = lines.join('\n');
    return text.trim() ? convertQuestionsCards(text) : '';
  }, [isEditing, question, answer, sections]);

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

  const updateSection = useCallback((idx: number, value: string) => {
    setSections((prev) =>
      prev.map((s, i) => (i === idx ? {...s, content: value} : s)),
    );
  }, []);

  const styles = CARD_STYLES.questionsCards;

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
        {isEditing ? (
          <div style={{border: '1px solid #ccc', borderRadius: 4, padding: 8, background: '#f9f9f9'}}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8}}>
              <span style={{fontSize: 13, fontWeight: 600, color: 'rgba(25, 118, 210, 0.8)'}}>
                Edit Questions Card
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
            {/* Question */}
            <div style={{marginBottom: 6}}>
              <label style={{fontSize: 11, color: '#1976d2', fontWeight: 600, display: 'block', marginBottom: 2}}>Question</label>
              <textarea
                placeholder="Enter question text..." value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onMouseDown={(e) => e.stopPropagation()}
                style={{width: '100%', padding: '4px 6px', fontSize: 12, border: '1px solid #ddd', borderRadius: 4, minHeight: 40, resize: 'vertical'}}
              />
            </div>
            {/* Answer */}
            <div style={{marginBottom: 6}}>
              <label style={{fontSize: 11, color: '#666', fontWeight: 600, display: 'block', marginBottom: 2}}>Answer</label>
              <textarea
                placeholder="Enter answer text..." value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                onMouseDown={(e) => e.stopPropagation()}
                style={{width: '100%', padding: '4px 6px', fontSize: 12, border: '1px solid #ddd', borderRadius: 4, minHeight: 60, resize: 'vertical'}}
              />
            </div>
            {/* Grid sections */}
            <div style={{border: '1px solid #e5e7eb', borderRadius: 6, padding: 8, background: '#fff'}}>
              <span style={{fontSize: 11, color: '#666', fontWeight: 600, display: 'block', marginBottom: 4}}>Card Sections</span>
              {sections.map((section, idx) => {
                const sStyle = styles[section.key as keyof typeof styles];
                const label = sStyle && 'title' in sStyle ? sStyle.title : section.key;
                return (
                  <div key={idx} style={{marginBottom: 4}}>
                    <label style={{fontSize: 11, color: '#666', display: 'block', marginBottom: 2}}>{label}</label>
                    <textarea
                      placeholder={`${label} content...`} value={section.content}
                      onChange={(e) => updateSection(idx, e.target.value)}
                      onMouseDown={(e) => e.stopPropagation()}
                      style={{width: '100%', padding: '4px 6px', fontSize: 12, border: '1px solid #ddd', borderRadius: 4, minHeight: 40, resize: 'vertical'}}
                    />
                  </div>
                );
              })}
            </div>
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
