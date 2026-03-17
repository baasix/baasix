/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from '@excalidraw/excalidraw/types';
import type {JSX} from 'react';

import './ExcalidrawModal.css';

import {isDOMNode} from 'lexical';
import * as React from 'react';
import {ReactPortal, lazy, Suspense, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';

import Button from './Button';
import Modal from './Modal';

const ExcalidrawComponent = lazy(() =>
  import('@excalidraw/excalidraw').then((mod) => ({default: mod.Excalidraw})),
);

export type ExcalidrawInitialElements = ExcalidrawInitialDataState['elements'];

type Props = {
  closeOnClickOutside?: boolean;
  /**
   * The initial set of elements to draw into the scene
   */
  initialElements: ExcalidrawInitialElements;
  /**
   * The initial set of elements to draw into the scene
   */
  initialAppState: AppState;
  /**
   * The initial set of elements to draw into the scene
   */
  initialFiles: BinaryFiles;
  /**
   * Controls the visibility of the modal
   */
  isShown?: boolean;
  /**
   * Callback when closing and discarding the new changes
   */
  onClose: () => void;
  /**
   * Completely remove Excalidraw component
   */
  onDelete: () => void;
  /**
   * Callback when the save button is clicked
   */
  onSave: (
    elements: ExcalidrawInitialElements,
    appState: Partial<AppState>,
    files: BinaryFiles,
  ) => void;
};

/**
 * @explorer-desc
 * A component which renders a modal with Excalidraw (a painting app)
 * which can be used to export an editable image
 */
export default function ExcalidrawModal({
  closeOnClickOutside = false,
  onSave,
  initialElements,
  initialAppState,
  initialFiles,
  isShown = false,
  onDelete,
  onClose,
}: Props): ReactPortal | null {
  const excaliDrawModelRef = useRef<HTMLDivElement | null>(null);
  const [excalidrawAPI, setExcalidrawAPI] =
    useState<ExcalidrawImperativeAPI | null>(null);
  const [discardModalOpen, setDiscardModalOpen] = useState(false);
  const [elements, setElements] =
    useState<ExcalidrawInitialElements>(initialElements);
  const [files, setFiles] = useState<BinaryFiles>(initialFiles);

  useEffect(() => {
    excaliDrawModelRef.current?.focus();
  }, []);

  // Excalidraw registers a document-level wheel handler that calls preventDefault(),
  // which blocks scrolling inside its own modal dialogs (Help, etc.).
  // Watch for the modal container and stop wheel propagation so scroll works.
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      e.stopPropagation();
    };

    const observer = new MutationObserver(() => {
      const container = document.querySelector('.excalidraw-modal-container');
      if (container && !container.hasAttribute('data-wheel-fixed')) {
        container.setAttribute('data-wheel-fixed', 'true');
        container.addEventListener('wheel', onWheel, {passive: false});
      }
    });

    observer.observe(document.body, {childList: true});

    return () => {
      observer.disconnect();
      const container = document.querySelector('.excalidraw-modal-container');
      if (container) {
        container.removeEventListener('wheel', onWheel);
      }
    };
  }, []);

  useEffect(() => {
    let modalOverlayElement: HTMLElement | null = null;

    const clickOutsideHandler = (event: MouseEvent) => {
      const target = event.target;
      if (
        excaliDrawModelRef.current !== null &&
        isDOMNode(target) &&
        !excaliDrawModelRef.current.contains(target) &&
        closeOnClickOutside
      ) {
        onDelete();
      }
    };

    if (excaliDrawModelRef.current !== null) {
      modalOverlayElement = excaliDrawModelRef.current?.parentElement;
      modalOverlayElement?.addEventListener('click', clickOutsideHandler);
    }

    return () => {
      modalOverlayElement?.removeEventListener('click', clickOutsideHandler);
    };
  }, [closeOnClickOutside, onDelete]);

  useLayoutEffect(() => {
    const currentModalRef = excaliDrawModelRef.current;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onDelete();
      }
    };

    currentModalRef?.addEventListener('keydown', onKeyDown);

    return () => {
      currentModalRef?.removeEventListener('keydown', onKeyDown);
    };
  }, [elements, files, onDelete]);

  const save = () => {
    if (elements?.some((el: Record<string, unknown>) => !el.isDeleted)) {
      const appState = excalidrawAPI?.getAppState();
      // We only need a subset of the state
      const partialState: Partial<AppState> = {
        exportBackground: appState?.exportBackground,
        exportScale: appState?.exportScale,
        exportWithDarkMode: appState?.theme === 'dark',
        isBindingEnabled: appState?.isBindingEnabled,
        isLoading: appState?.isLoading,
        name: appState?.name,
        theme: appState?.theme,
        viewBackgroundColor: appState?.viewBackgroundColor,
        viewModeEnabled: appState?.viewModeEnabled,
        zenModeEnabled: appState?.zenModeEnabled,
        zoom: appState?.zoom,
      };
      onSave(elements, partialState, files);
    } else {
      // delete node if the scene is clear
      onDelete();
    }
  };

  const discard = () => {
    setDiscardModalOpen(true);
  };

  function ShowDiscardDialog(): JSX.Element {
    return (
      <Modal
        title="Discard"
        onClose={() => {
          setDiscardModalOpen(false);
        }}
        closeOnClickOutside={false}>
        Are you sure you want to discard the changes?
        <div className="ExcalidrawModal__discardModal">
          <Button
            onClick={() => {
              setDiscardModalOpen(false);
              onClose();
            }}>
            Discard
          </Button>{' '}
          <Button
            onClick={() => {
              setDiscardModalOpen(false);
            }}>
            Cancel
          </Button>
        </div>
      </Modal>
    );
  }

  if (isShown === false) {
    return null;
  }

  const onChange = (
    els: ExcalidrawInitialElements,
    _: AppState,
    fls: BinaryFiles,
  ) => {
    setElements(els);
    setFiles(fls);
  };

  return createPortal(
    <div className="ExcalidrawModal__overlay" role="dialog">
      <div
        className="ExcalidrawModal__modal"
        ref={excaliDrawModelRef}
        tabIndex={-1}>
        <div className="ExcalidrawModal__row">
          {discardModalOpen && <ShowDiscardDialog />}
          <Suspense fallback={<div style={{padding: 20}}>Loading Excalidraw...</div>}>
            <ExcalidrawComponent
              onChange={onChange}
              excalidrawAPI={setExcalidrawAPI}
              initialData={{
                appState: initialAppState || {isLoading: false},
                elements: initialElements,
                files: initialFiles,
              }}
            />
          </Suspense>
          <div className="ExcalidrawModal__actions">
            <button type="button" className="action-button" onClick={discard}>
              Discard
            </button>
            <button type="button" className="action-button" onClick={save}>
              Save
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
