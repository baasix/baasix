/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import type {
  DOMConversionMap,
  DOMConversionOutput,
  DOMExportOutput,
  EditorConfig,
  LexicalEditor,
  LexicalNode,
  NodeKey,
  SerializedLexicalNode,
  Spread,
} from 'lexical';
import type {JSX} from 'react';

import {DecoratorNode} from 'lexical';
import * as React from 'react';

type Dimension = number | 'inherit';

const ExcalidrawComponent = React.lazy(() => import('./ExcalidrawComponent'));

export type SerializedExcalidrawNode = Spread<
  {
    data: string;
    width?: Dimension;
    height?: Dimension;
  },
  SerializedLexicalNode
>;

function $convertExcalidrawElement(
  domNode: HTMLElement,
): DOMConversionOutput | null {
  const excalidrawData = domNode.getAttribute('data-lexical-excalidraw-json');
  // Read from inline style (not getComputedStyle) because during
  // $generateNodesFromDOM the element is detached and computed styles are empty.
  const widthStr = domNode.style.width;
  const heightStr = domNode.style.height;
  const width =
    !widthStr || widthStr === '100%' || widthStr === 'auto' || widthStr === 'inherit'
      ? 'inherit'
      : parseInt(widthStr, 10);
  const height =
    !heightStr || heightStr === 'auto' || heightStr === 'inherit'
      ? 'inherit'
      : parseInt(heightStr, 10);

  if (excalidrawData) {
    const node = $createExcalidrawNode(
      excalidrawData,
      isNaN(width as number) ? 'inherit' : width,
      isNaN(height as number) ? 'inherit' : height,
    );
    return {
      node,
    };
  }
  return null;
}

export class ExcalidrawNode extends DecoratorNode<JSX.Element> {
  __data: string;
  __width: Dimension;
  __height: Dimension;

  static getType(): string {
    return 'excalidraw';
  }

  static clone(node: ExcalidrawNode): ExcalidrawNode {
    return new ExcalidrawNode(
      node.__data,
      node.__width,
      node.__height,
      node.__key,
    );
  }

  static importJSON(serializedNode: SerializedExcalidrawNode): ExcalidrawNode {
    return new ExcalidrawNode(
      serializedNode.data,
      serializedNode.width ?? 'inherit',
      serializedNode.height ?? 'inherit',
    ).updateFromJSON(serializedNode);
  }

  exportJSON(): SerializedExcalidrawNode {
    return {
      ...super.exportJSON(),
      data: this.__data,
      height: this.__height === 'inherit' ? undefined : this.__height,
      width: this.__width === 'inherit' ? undefined : this.__width,
    };
  }

  constructor(
    data = '[]',
    width: Dimension = 'inherit',
    height: Dimension = 'inherit',
    key?: NodeKey,
  ) {
    super(key);
    this.__data = data;
    this.__width = width;
    this.__height = height;
  }

  // View
  createDOM(config: EditorConfig): HTMLElement {
    const span = document.createElement('span');
    const theme = config.theme;
    const className = theme.image;
    span.className = `${className ?? ''} editor-excalidraw`.trim();
    return span;
  }

  updateDOM(): false {
    return false;
  }

  static importDOM(): DOMConversionMap<HTMLSpanElement> | null {
    return {
      span: (domNode: HTMLSpanElement) => {
        if (!domNode.hasAttribute('data-lexical-excalidraw-json')) {
          return null;
        }
        return {
          conversion: $convertExcalidrawElement,
          priority: 1,
        };
      },
    };
  }

  exportDOM(editor: LexicalEditor): DOMExportOutput {
    const element = document.createElement('span');

    element.style.display = 'block';

    const content = editor.getElementByKey(this.getKey());
    if (content !== null) {
      const svg = content.querySelector('svg');
      if (svg !== null) {
        element.innerHTML = svg.outerHTML;
      }
    }

    element.style.width =
      this.__width === 'inherit' ? '100%' : `${this.__width}px`;
    element.style.height =
      this.__height === 'inherit' ? 'auto' : `${this.__height}px`;

    element.setAttribute('data-lexical-excalidraw-json', this.__data);
    return {element};
  }

  setData(data: string): void {
    const self = this.getWritable();
    self.__data = data;
  }

  getWidth(): Dimension {
    return this.getLatest().__width;
  }

  setWidth(width: Dimension): void {
    const self = this.getWritable();
    self.__width = width;
  }

  getHeight(): Dimension {
    return this.getLatest().__height;
  }

  setHeight(height: Dimension): void {
    const self = this.getWritable();
    self.__height = height;
  }

  decorate(editor: LexicalEditor, config: EditorConfig): JSX.Element {
    return (
      <ExcalidrawComponent
        nodeKey={this.getKey()}
        data={this.__data}
        width={this.__width}
        height={this.__height}
      />
    );
  }
}

export function $createExcalidrawNode(
  data: string = '[]',
  width: Dimension = 'inherit',
  height: Dimension = 'inherit',
): ExcalidrawNode {
  return new ExcalidrawNode(data, width, height);
}

export function $isExcalidrawNode(
  node: LexicalNode | null | undefined,
): node is ExcalidrawNode {
  return node instanceof ExcalidrawNode;
}
