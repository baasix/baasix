/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import type {JSX} from 'react';

import * as React from 'react';
import {useEffect, useRef} from 'react';

let katexPromise: Promise<typeof import('katex')['default']> | null = null;
let katexLoaded: typeof import('katex')['default'] | null = null;

function getKatex(): Promise<typeof import('katex')['default']> {
  if (!katexPromise) {
    katexPromise = Promise.all([
      import('katex'),
      // @ts-expect-error -- CSS module import handled by bundler
      import('katex/dist/katex.css'),
    ]).then(([mod]) => {
      katexLoaded = mod.default;
      return mod.default;
    });
  }
  return katexPromise;
}

/**
 * Returns the katex module synchronously if it has already been loaded,
 * or null if it hasn't been loaded yet. Used by EquationNode.exportDOM()
 * which must be synchronous.
 */
function getKatexSync(): typeof import('katex')['default'] | null {
  return katexLoaded;
}

export {getKatex, getKatexSync};

export default function KatexRenderer({
  equation,
  inline,
  onDoubleClick,
}: Readonly<{
  equation: string;
  inline: boolean;
  onDoubleClick: () => void;
}>): JSX.Element {
  const katexElementRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    getKatex().then((katex) => {
      if (cancelled) return;
      const katexElement = katexElementRef.current;
      if (katexElement !== null) {
        katex.render(equation, katexElement, {
          displayMode: !inline,
          errorColor: '#cc0000',
          output: 'html',
          strict: 'warn',
          throwOnError: false,
          trust: false,
        });
      }
    });
    return () => { cancelled = true; };
  }, [equation, inline]);

  return (
    // We use an empty image tag either side to ensure Android doesn't try and compose from the
    // inner text from Katex. There didn't seem to be any other way of making this work,
    // without having a physical space.
    <>
      <img
        src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
        width="0"
        height="0"
        alt=""
      />
      <span
        role="button"
        tabIndex={-1}
        onDoubleClick={onDoubleClick}
        ref={katexElementRef}
      />
      <img
        src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
        width="0"
        height="0"
        alt=""
      />
    </>
  );
}
