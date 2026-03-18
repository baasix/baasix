/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import type {ExcalidrawInitialElements} from '../../ui/ExcalidrawModal';
import type {AppState, BinaryFiles} from '@excalidraw/excalidraw/types';
import type {NodeKey} from 'lexical';
import type {JSX} from 'react';

import {useLexicalComposerContext} from '@lexical/react/LexicalComposerContext';
import {useLexicalEditable} from '@lexical/react/useLexicalEditable';
import {useLexicalNodeSelection} from '@lexical/react/useLexicalNodeSelection';
import {mergeRegister} from '@lexical/utils';
import {
  $getNodeByKey,
  CLICK_COMMAND,
  COMMAND_PRIORITY_LOW,
  isDOMNode,
} from 'lexical';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import * as React from 'react';
import {createPortal} from 'react-dom';

import ExcalidrawModal from '../../ui/ExcalidrawModal';
import ImageResizer from '../../ui/ImageResizer';
import {$isExcalidrawNode} from '.';
import ExcalidrawImage from './ExcalidrawImage';

type Dimension = 'inherit' | number;

function parseDimension(val: string): Dimension {
  const trimmed = val.trim();
  if (!trimmed || trimmed === 'inherit' || trimmed === '100%' || trimmed === 'auto') {
    return 'inherit';
  }
  // Strip "px" suffix if present
  const num = parseInt(trimmed.replace(/px$/i, ''), 10);
  return isNaN(num) || num <= 0 ? 'inherit' : num;
}

function dimensionToString(d: Dimension): string {
  return d === 'inherit' ? '' : String(d);
}

function ExcalidrawResizeDialog({
  width,
  height,
  onSave,
  onClose,
}: {
  width: Dimension;
  height: Dimension;
  onSave: (w: Dimension, h: Dimension) => void;
  onClose: () => void;
}): JSX.Element {
  const [widthVal, setWidthVal] = useState(dimensionToString(width));
  const [heightVal, setHeightVal] = useState(dimensionToString(height));

  const handleSave = () => {
    onSave(parseDimension(widthVal), parseDimension(heightVal));
  };

  return (
    <div className="excalidraw-resize-overlay">
      <div className="excalidraw-resize-dialog">
        <div className="excalidraw-resize-dialog__title">Resize Diagram</div>
        <div className="excalidraw-resize-dialog__fields">
          <label className="excalidraw-resize-dialog__label">
            Width
            <input
              className="excalidraw-resize-dialog__input"
              type="text"
              value={widthVal}
              onChange={(e) => setWidthVal(e.target.value)}
              placeholder="auto (full width)"
            />
          </label>
          <label className="excalidraw-resize-dialog__label">
            Height
            <input
              className="excalidraw-resize-dialog__input"
              type="text"
              value={heightVal}
              onChange={(e) => setHeightVal(e.target.value)}
              placeholder="auto"
            />
          </label>
        </div>
        <div className="excalidraw-resize-dialog__hint">
          Enter a number in pixels (e.g. 400) or leave empty for auto.
        </div>
        <div className="excalidraw-resize-dialog__actions">
          <button type="button" className="excalidraw-resize-dialog__btn excalidraw-resize-dialog__btn--cancel" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="excalidraw-resize-dialog__btn excalidraw-resize-dialog__btn--save" onClick={handleSave}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ExcalidrawComponent({
  nodeKey,
  data,
  width,
  height,
}: {
  data: string;
  nodeKey: NodeKey;
  width: 'inherit' | number;
  height: 'inherit' | number;
}): JSX.Element {
  const [editor] = useLexicalComposerContext();
  const isEditable = useLexicalEditable();
  const [isModalOpen, setModalOpen] = useState<boolean>(
    data === '[]' && editor.isEditable(),
  );
  const [isResizeDialogOpen, setResizeDialogOpen] = useState(false);
  const imageContainerRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const captionButtonRef = useRef<HTMLButtonElement | null>(null);
  const [isSelected, setSelected, clearSelection] =
    useLexicalNodeSelection(nodeKey);
  const [isResizing, setIsResizing] = useState<boolean>(false);

  useEffect(() => {
    if (!isEditable) {
      if (isSelected) {
        clearSelection();
      }
      return;
    }
    return mergeRegister(
      editor.registerCommand(
        CLICK_COMMAND,
        (event: MouseEvent) => {
          const buttonElem = buttonRef.current;
          const eventTarget = event.target;

          if (isResizing) {
            return true;
          }

          if (
            buttonElem !== null &&
            isDOMNode(eventTarget) &&
            buttonElem.contains(eventTarget)
          ) {
            if (!event.shiftKey) {
              clearSelection();
            }
            setSelected(!isSelected);
            if (event.detail > 1) {
              setModalOpen(true);
            }
            return true;
          }

          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
    );
  }, [clearSelection, editor, isSelected, isResizing, setSelected, isEditable]);

  const deleteNode = useCallback(() => {
    setModalOpen(false);
    return editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (node) {
        node.remove();
      }
    });
  }, [editor, nodeKey]);

  const setData = (
    els: ExcalidrawInitialElements,
    aps: Partial<AppState>,
    fls: BinaryFiles,
  ) => {
    return editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isExcalidrawNode(node)) {
        if ((els && els.length > 0) || Object.keys(fls).length > 0) {
          node.setData(
            JSON.stringify({
              appState: aps,
              elements: els,
              files: fls,
            }),
          );
        } else {
          node.remove();
        }
      }
    });
  };

  const onResizeStart = () => {
    setIsResizing(true);
  };

  const onResizeEnd = (
    nextWidth: 'inherit' | number,
    nextHeight: 'inherit' | number,
  ) => {
    // Delay hiding the resize bars for click case
    setTimeout(() => {
      setIsResizing(false);
    }, 200);

    editor.update(() => {
      const node = $getNodeByKey(nodeKey);

      if ($isExcalidrawNode(node)) {
        node.setWidth(nextWidth);
        node.setHeight(nextHeight);
      }
    });
  };

  const openModal = useCallback(() => {
    setModalOpen(true);
  }, []);

  const handleResizeSave = useCallback(
    (newWidth: Dimension, newHeight: Dimension) => {
      editor.update(() => {
        const node = $getNodeByKey(nodeKey);
        if ($isExcalidrawNode(node)) {
          node.setWidth(newWidth);
          node.setHeight(newHeight);
        }
      });
      setResizeDialogOpen(false);
    },
    [editor, nodeKey],
  );

  const {
    elements = [],
    files = {},
    appState = {},
  } = useMemo(() => JSON.parse(data), [data]);

  const closeModal = useCallback(() => {
    setModalOpen(false);
    if (elements.length === 0) {
      editor.update(() => {
        const node = $getNodeByKey(nodeKey);
        if (node) {
          node.remove();
        }
      });
    }
  }, [editor, nodeKey, elements.length]);

  return (
    <>
      {isEditable && isModalOpen && (
        <ExcalidrawModal
          initialElements={elements}
          initialFiles={files}
          initialAppState={appState}
          isShown={isModalOpen}
          onDelete={deleteNode}
          onClose={closeModal}
          onSave={(els, aps, fls) => {
            setData(els, aps, fls);
            setModalOpen(false);
          }}
          closeOnClickOutside={false}
        />
      )}
      {elements.length > 0 && (
        <button type="button"
          ref={buttonRef}
          className={`excalidraw-button ${isSelected ? 'selected' : ''}`}
          style={{width: width === 'inherit' ? '100%' : `${width}px`}}>
          <ExcalidrawImage
            imageContainerRef={imageContainerRef}
            className="image"
            elements={elements}
            files={files}
            appState={appState}
            width={width}
            height={height}
          />
          {isSelected && isEditable && (
            <>
              <div
                className="image-edit-button"
                role="button"
                tabIndex={0}
                onMouseDown={(event) => event.preventDefault()}
                onClick={openModal}
              />
              <div
                className="image-resize-button"
                role="button"
                tabIndex={0}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setResizeDialogOpen(true)}
              />
            </>
          )}
          {(isSelected || isResizing) && isEditable && (
            <ImageResizer
              buttonRef={captionButtonRef}
              showCaption={true}
              setShowCaption={() => null}
              imageRef={imageContainerRef}
              editor={editor}
              onResizeStart={onResizeStart}
              onResizeEnd={onResizeEnd}
              captionsEnabled={true}
            />
          )}
        </button>
      )}
      {isResizeDialogOpen && isEditable &&
        createPortal(
          <ExcalidrawResizeDialog
            width={width}
            height={height}
            onSave={handleResizeSave}
            onClose={() => setResizeDialogOpen(false)}
          />,
          document.body,
        )}
    </>
  );
}
