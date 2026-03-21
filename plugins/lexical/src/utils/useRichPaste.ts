import {useCallback, useRef, useState} from 'react';
import type {Baasix} from '@baasix/sdk';
import {uploadImageToBaasix} from './baasixUpload';

export interface RichPasteState {
  images: Array<{placeholder: string; src: string}>;
  isUploading: boolean;
  pasteAreaRef: React.RefObject<HTMLDivElement>;
  handlePaste: (e: React.ClipboardEvent<HTMLDivElement>) => void;
  replaceImagePlaceholders: (html: string) => string;
}

export function useRichPaste(
  onText: (text: string) => void,
  baasixClient?: Baasix | null,
  folder?: string,
): RichPasteState {
  const [images, setImages] = useState<Array<{placeholder: string; src: string}>>([]);
  const [isUploading, setIsUploading] = useState(false);
  const pasteAreaRef = useRef<HTMLDivElement>(null);

  // Extract only images from HTML, upload them, and return placeholders
  const extractImages = useCallback(
    async (htmlStr: string): Promise<Array<{placeholder: string; src: string}>> => {
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlStr, 'text/html');
      const imgs = doc.querySelectorAll('img');
      const newImages: Array<{placeholder: string; src: string}> = [];

      for (let i = 0; i < imgs.length; i++) {
        const img = imgs[i];
        const src = img.getAttribute('src') || '';
        const placeholder = `__IMG_${Date.now()}_${i}__`;

        if (src.startsWith('data:') && baasixClient) {
          try {
            const resp = await fetch(src);
            const blob = await resp.blob();
            const ext = blob.type.split('/')[1] || 'png';
            const file = new File([blob], `pasted-image-${i}.${ext}`, {type: blob.type});
            const uploadedUrl = await uploadImageToBaasix(baasixClient, file, folder);
            newImages.push({placeholder, src: uploadedUrl});
          } catch {
            newImages.push({placeholder, src});
          }
        } else if (src) {
          newImages.push({placeholder, src});
        }
      }

      return newImages;
    },
    [baasixClient, folder],
  );

  // Walk the HTML DOM in document order to determine where images fall
  // relative to text paragraphs, then insert placeholders into the plain text.
  const insertPlaceholders = useCallback(
    (plainText: string, htmlStr: string, imgPlaceholders: Array<{placeholder: string}>): string => {
      if (imgPlaceholders.length === 0) return plainText;

      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlStr, 'text/html');

      // Walk the DOM in order, building a sequence of {type: 'text'|'img', ...}
      type Segment = {type: 'text'; text: string} | {type: 'img'; idx: number};
      const segments: Segment[] = [];
      let imgIdx = 0;
      const blockTags = new Set(['P', 'DIV', 'LI', 'TR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'TABLE']);

      const walkNode = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          const t = (node.textContent || '').trim();
          if (t) segments.push({type: 'text', text: t});
          return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const el = node as Element;
        if (el.tagName === 'IMG') {
          segments.push({type: 'img', idx: imgIdx++});
          return;
        }
        for (const child of Array.from(el.childNodes)) walkNode(child);
      };
      walkNode(doc.body);

      // Count how many text segments appear before each image
      const textCountBeforeImg: number[] = [];
      let textCount = 0;
      for (const seg of segments) {
        if (seg.type === 'text') {
          textCount++;
        } else {
          textCountBeforeImg.push(textCount);
        }
      }

      // Map text segment count to plain text line index.
      // The plain text has the same paragraphs in order — each non-empty line
      // roughly corresponds to one text segment from the DOM.
      const lines = plainText.split('\n');
      const nonEmptyLineIndices: number[] = [];
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim()) nonEmptyLineIndices.push(i);
      }

      // Insert placeholders in reverse order to preserve indices
      for (let i = textCountBeforeImg.length - 1; i >= 0; i--) {
        const placeholder = imgPlaceholders[i]?.placeholder;
        if (!placeholder) continue;
        const tc = textCountBeforeImg[i];
        // Insert after the tc-th non-empty line (0-indexed: tc-1)
        const lineIdx = tc > 0 && tc <= nonEmptyLineIndices.length
          ? nonEmptyLineIndices[tc - 1]
          : (nonEmptyLineIndices.length > 0 ? nonEmptyLineIndices[nonEmptyLineIndices.length - 1] : lines.length - 1);
        lines.splice(lineIdx + 1, 0, placeholder);
        // Rebuild nonEmptyLineIndices after splice (shift indices after insertion)
        for (let j = 0; j < nonEmptyLineIndices.length; j++) {
          if (nonEmptyLineIndices[j] > lineIdx) nonEmptyLineIndices[j]++;
        }
      }

      return lines.join('\n');
    },
    [],
  );

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent<HTMLDivElement>) => {
      e.preventDefault();
      const clipboardData = e.clipboardData;
      const htmlData = clipboardData.getData('text/html');
      const textData = clipboardData.getData('text/plain');

      if (htmlData && htmlData.includes('<img')) {
        setIsUploading(true);
        try {
          const processedImages = await extractImages(htmlData);
          // Use plain text (same as textarea paste) + insert image placeholders
          let text = textData || '';
          text = insertPlaceholders(text, htmlData, processedImages);
          onText(text);
          setImages((prev) => [...prev, ...processedImages]);
        } finally {
          setIsUploading(false);
        }
      } else {
        onText(textData || '');
      }

      if (pasteAreaRef.current) {
        pasteAreaRef.current.textContent = '';
      }
    },
    [extractImages, insertPlaceholders, onText],
  );

  const replaceImagePlaceholders = useCallback(
    (html: string): string => {
      let result = html;
      images.forEach(({placeholder, src}) => {
        result = result.replace(
          new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
          `<img src="${src}" style="max-width: 100%; border-radius: 8px; margin: 8px 0;" />`,
        );
      });
      return result;
    },
    [images],
  );

  return {images, isUploading, pasteAreaRef, handlePaste, replaceImagePlaceholders};
}
