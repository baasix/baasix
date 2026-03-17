# @baasix/lexical

A feature-rich Lexical-based rich text editor component for Baasix applications. Forked from the [Lexical Playground](https://github.com/facebook/lexical) (v0.41.0) and adapted for seamless integration with the Baasix SDK.

## Features

- **Rich Text Editing** — Full WYSIWYG editor with a comprehensive toolbar
- **Markdown Shortcuts** — Type markdown syntax and it auto-converts
- **Tables** — Insert and edit tables with cell resizing, hover actions, and scroll shadows
- **Images** — Drag-and-drop image uploads via Baasix file storage
- **Embeds** — YouTube, Twitter/X, and Figma embeds
- **Code Blocks** — Syntax-highlighted code blocks with Prism.js and Shiki support
- **Equations** — KaTeX-powered math equations (inline and block)
- **Excalidraw** — Embedded whiteboard/drawing canvas
- **Collapsible Sections** — Toggle sections for long content
- **Mentions** — @mention support for users/entities
- **Comments & Threads** — Inline commenting system
- **Polls** — Embeddable poll components
- **Sticky Notes** — Floating sticky notes
- **Emoji Picker** — Built-in emoji picker and shortcodes
- **Drag & Drop** — Draggable blocks for reordering content
- **Fullscreen Mode** — Toggle fullscreen editing with Escape to exit
- **Keyboard Shortcuts** — Extensive keyboard shortcut support
- **Read-Only Mode** — Controlled read-only state
- **HTML Bidirectional Sync** — External HTML value ↔ Lexical editor state with debounced onChange
- **Versioning** — Built-in version/revision tracking plugin
- **Terminology** — Custom terminology highlighting
- **Page Breaks** — Insert page break markers
- **Layouts** — Multi-column layout support

## Installation

```bash
npm install @baasix/lexical
```

### Peer Dependencies

```bash
npm install react react-dom @baasix/sdk
```

## Quick Start

```tsx
import { LexicalEditor } from '@baasix/lexical';
import '@baasix/lexical/style.css';

function MyForm() {
  const [content, setContent] = useState('<p>Hello world</p>');

  return (
    <LexicalEditor
      baasixClient={baasixClient}
      value={content}
      onChange={setContent}
      height={500}
      placeholder="Start writing..."
    />
  );
}
```

## Props

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `baasixClient` | `Baasix` | Yes | — | Baasix SDK client instance (used for file uploads, etc.) |
| `value` | `string` | Yes | — | HTML string to render in the editor |
| `onChange` | `(html: string) => void` | Yes | — | Callback fired when editor content changes |
| `folder` | `string` | No | — | Baasix file storage folder for uploaded assets |
| `height` | `number \| string` | No | `500` | Editor height (px or CSS value) |
| `debounceMs` | `number` | No | `300` | Debounce delay (ms) for the `onChange` callback |
| `placeholder` | `string` | No | — | Placeholder text shown in an empty editor |
| `readOnly` | `boolean` | No | `false` | When `true`, the editor is non-editable |
| `maxLength` | `number` | No | — | Maximum character limit |

## Usage Examples

### Basic Rich Text Field

```tsx
import { LexicalEditor } from '@baasix/lexical';
import '@baasix/lexical/style.css';
import { useBaasix } from '@baasix/sdk';

function ArticleEditor() {
  const { client } = useBaasix();
  const [body, setBody] = useState('');

  return (
    <LexicalEditor
      baasixClient={client}
      value={body}
      onChange={setBody}
      folder="articles"
      height={600}
      placeholder="Write your article..."
    />
  );
}
```

### Read-Only Viewer

```tsx
<LexicalEditor
  baasixClient={client}
  value={savedHtml}
  onChange={() => {}}
  readOnly
  height="auto"
/>
```

### With Character Limit

```tsx
<LexicalEditor
  baasixClient={client}
  value={comment}
  onChange={setComment}
  maxLength={500}
  height={200}
  placeholder="Add a comment (max 500 characters)..."
/>
```

### Custom Debounce

```tsx
<LexicalEditor
  baasixClient={client}
  value={content}
  onChange={handleSave}
  debounceMs={1000}  // 1 second debounce for expensive save operations
/>
```

## Styling

The editor ships its own CSS. Import it once at the top of your app or component:

```tsx
import '@baasix/lexical/style.css';
```

The editor uses the `.editor-shell` class as its root container. You can override styles as needed.

## Architecture

The editor is wrapped in several React context providers:

- **`FullscreenContext`** — Manages fullscreen toggle state
- **`EditorConfigProvider`** — Provides the Baasix client and folder config to all plugins
- **`SettingsContext`** — Editor feature toggles (rich text, autocomplete, etc.)
- **`SharedHistoryContext`** — Shared undo/redo history
- **`LexicalComposer`** — Core Lexical editor initialization
- **`CollaborationContext`** — Collaboration awareness (Yjs ready)
- **`ToolbarContext`** — Toolbar state management

### Custom Nodes

The editor includes many custom Lexical nodes beyond the defaults:

| Node | Description |
|------|-------------|
| `ImageNode` | Images with resize and caption |
| `EquationNode` | KaTeX math equations |
| `ExcalidrawNode` | Excalidraw whiteboard drawings |
| `FigmaNode` | Figma embed |
| `TweetNode` | Twitter/X embed |
| `YouTubeNode` | YouTube embed |
| `PollNode` | Interactive polls |
| `StickyNode` | Floating sticky notes |
| `MentionNode` | @mention references |
| `EmojiNode` | Custom emoji rendering |
| `DateTimeNode` | Date/time picker |
| `PageBreakNode` | Page break markers |
| `LayoutContainerNode` | Multi-column layouts |
| `CollapsibleContainerNode` | Toggle/collapsible sections |
| `AutocompleteNode` | Typeahead autocomplete |
| `KeywordNode` | Keyword highlighting |
| `SpecialTextNode` | Special text formatting |
| `TerminologyNode` | Terminology highlighting |
| `NotesNode` | Inline notes |
| `RevisionNode` | Revision tracking |
| `HtmlBlockNode` | Raw HTML blocks |

### Plugins

Over 40 editor plugins are included:

- **Toolbar** — Rich formatting toolbar with font size, color, alignment, and more
- **Drag & Drop** — Draggable block reordering via `@atlaskit/pragmatic-drag-and-drop`
- **Code Actions** — Copy, format (Prettier), and wrap code blocks
- **Floating Link Editor** — Inline link editing popover
- **Floating Text Format** — Selection-based floating toolbar
- **Component Picker** — Slash-command menu for inserting components
- **Context Menu** — Right-click context menu actions
- **Auto Embed** — Automatic URL-to-embed conversion
- **Markdown Shortcuts** — Markdown-to-rich-text transformers
- **Comments** — Inline comment threads
- **Versions** — Content version history
- **And many more…**

## Plugin Directory Structure

```
src/
├── index.tsx                # Entry point, CSS imports, exports
├── LexicalEditor.tsx        # Public API component & HtmlPlugin
├── Editor.tsx               # Main editor composition with all plugins
├── FORK_SOURCE.md           # Fork provenance info
├── declarations.d.ts        # Module declarations
├── context/                 # React context providers
│   ├── EditorConfigContext.tsx
│   ├── FullscreenContext.tsx
│   ├── SettingsContext.tsx
│   ├── SharedHistoryContext.tsx
│   ├── ToolbarContext.tsx
│   └── FlashMessageContext.tsx
├── hooks/                   # Custom React hooks
│   ├── useFlashMessage.tsx
│   ├── useModal.tsx
│   └── useReport.ts
├── nodes/                   # Custom Lexical nodes
│   ├── PlaygroundNodes.ts   # Node registration
│   ├── ImageNode.tsx
│   ├── EquationNode.tsx
│   ├── ExcalidrawNode/
│   └── ... (20+ nodes)
├── plugins/                 # Editor plugins
│   ├── ToolbarPlugin/
│   ├── DraggableBlockPlugin/
│   ├── ImagesPlugin/
│   ├── CommentPlugin/
│   ├── VersionsPlugin/
│   └── ... (40+ plugins)
├── themes/                  # Editor CSS themes
│   ├── PlaygroundEditorTheme.ts
│   ├── CommentEditorTheme.ts
│   └── StickyEditorTheme.ts
├── ui/                      # Reusable UI components
│   ├── Button.tsx
│   ├── ColorPicker.tsx
│   ├── Modal.tsx
│   ├── Dialog.tsx
│   └── ... (15+ components)
├── utils/                   # Utility functions
├── images/                  # Static image assets
└── styles/                  # Additional CSS
```

## Key Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `lexical` | 0.41.0 | Core editor framework |
| `@lexical/react` | 0.41.0 | React bindings for Lexical |
| `@lexical/rich-text` | 0.41.0 | Rich text support |
| `@lexical/table` | 0.41.0 | Table support |
| `@lexical/code` | 0.41.0 | Code block support |
| `@lexical/list` | 0.41.0 | List support |
| `@lexical/link` | 0.41.0 | Link support |
| `@lexical/markdown` | 0.41.0 | Markdown transformers |
| `@excalidraw/excalidraw` | 0.18.0 | Whiteboard drawings |
| `katex` | 0.16.x | Math equation rendering |
| `prismjs` | 1.30.x | Syntax highlighting |
| `yjs` | 13.6.x | Real-time collaboration (CRDT) |
| `@baasix/sdk` | * | Baasix SDK (peer dependency) |

## Fork Information

This package is forked from [facebook/lexical](https://github.com/facebook/lexical) `packages/lexical-playground/src` at tag **v0.41.0** (forked on 2026-03-16). The following files from the original playground were removed: `App.tsx`, `index.tsx`, `index.css`, `appSettings.ts`, `Settings.tsx`, `setupEnv.ts`, `buildHTMLConfig.tsx`, `collaboration.ts`, and the `server/` directory.

The editor has been adapted to work as a standalone component that integrates with the Baasix SDK for file uploads and asset management.

## License

MIT
