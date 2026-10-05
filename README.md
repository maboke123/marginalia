<img src="build/icon.png" alt="Marginalia logo" width="96">

# Marginalia

A Windows desktop app for lecture notes. Import the slide PDF, write on it, and keep a Markdown summary with LaTeX next to it. Everything is stored as plain files in a folder you choose.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/lecture-dark.png">
  <img src="docs/screenshots/lecture-light.png" alt="Lecture mode: annotated slides on the left, the Markdown summary with rendered formulas and a table on the right">
</picture>

I built it for my own courses at KU Leuven, to replace a mix of OneNote (for scribbling on slides), Obsidian (for summaries) and a separate chat window for asking Claude about the slides.

Claude is built in two ways:

- **A chat panel** for questions. It already has the context: the slide you are on, your annotations and the notes around your cursor, so you can just ask "what does this formula mean?".
- **`/claude` inside your notes.** While taking notes, type `/claude` and a request in your summary or in a text box on a slide. Claude edits or adds to the text right there, and you keep writing.

## Features

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/slides-dark.png">
  <img src="docs/screenshots/slides-light.png" alt="A slide with pen circles, a note with a formula on the slide and text in the margin, next to the course sidebar">
</picture>

**Organise**
- Open any folder as a vault. Top-level folders are courses, subfolders are lectures, nested as deep as you like.
- Create, rename, move and delete from the sidebar. Deletes go to the Recycle Bin.
- Natural sort order (B2 before B10). An optional `_order.json` in a folder sets your own order.

**Slides**
- Import PDFs by drag and drop or Ctrl+Shift+I. The original is copied, never moved.
- Pen, highlighter, eraser and text boxes, on the slide or in a margin next to it.
- Highlight selected slide text with H.
- Paste or drop images onto a slide. Text boxes and images snap to slide text and edges.
- Add blank pages below any slide for extra working space.
- Export a PDF with all annotations burned in.

**Summary**
- Markdown editor with live preview: headings, tables, images and KaTeX math render in place and turn back into source where your cursor is.
- Slash menu for headings, lists, tables, math blocks, text colour and slide links.
- Ctrl+Shift+L inserts a link to the current slide, Ctrl+Shift+S pastes a snapshot of part of it.
- Files stay standard Markdown, so they open the same in Obsidian or VS Code.

**Lecture mode**
- Ctrl+Shift+M puts the slides on the left and their summary on the right, and hides the sidebar.

**Search**
- Ctrl+P to jump to any file, Ctrl+Shift+F to search the text of every note and slide.

## Claude in the app

Claude is built into the places you already work, and it always knows where you are. With every message it gets the open file, the slide on screen (its text and an image of it), your annotations on that slide, any text you selected and the part of your summary around your cursor. You don't have to copy anything over or explain which slide you mean.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/claude-dark.png">
  <img src="docs/screenshots/claude-light.png" alt="The Claude panel under the slides, answering why Outlook is the root of the tree on slide 3">
</picture>

**Ask questions in the chat panel (Ctrl+L)**
- "Explain the formula on this slide" or "Why is entropy maximal here?" works without any setup.
- Type `@` to add other notes or PDFs from your vault as context.
- One conversation per lecture, kept when you close the app.

**Let it edit your notes**
- Ask "add a short version of this under Information gain" and it writes into your summary, under that heading.
- It can put a text box in the margin next to a slide or highlight a phrase on it.
- With "ask before editing" on (the default), you see each change first and accept or reject it. Every edit is one undo step.

**Write in place with `/claude`**
- Type `/claude <request>` at the end of a line in a summary or in a text box on a slide, and press Enter.
- The answer replaces the request right there, using the slide and the text around it. For example `/claude derive this step` under a formula, or `/claude fix the LaTeX in this paragraph`.
- You can keep typing while it works, run several at once, and cancel with Esc.

**Terminal tab**
- Runs Claude Code inside your vault folder, for bigger jobs like reorganising a course or writing a summary from several lectures.

Claude can only read files inside your vault, and the chat panel cannot run commands.

## How your files look on disk

```
Machine Learning/                       course
  B2 Decision trees/                    lecture
    slides.pdf
    slides.pdf.annotations.json         your annotations (JSON)
    slides.md                           your summary
    assets/                             pasted images and snapshots
.marginalia/                            app settings for this vault
```

Annotations live in a JSON file next to each PDF. The PDF itself is never changed. Renaming or moving a PDF in the app takes its annotations and summary along.

Writes are atomic (temp file, then rename), so a crash or power cut does not leave half-written files.

## Install

Download `marginalia-<version>-setup.exe` from the releases page and run it. The installer is not signed, so Windows SmartScreen will warn you: choose "More info" and then "Run anyway".

Windows 11 only.

### Setting up Claude

Claude uses the Claude Agent SDK and needs one of these:

- A Claude Code login on the same machine (a Pro or Max plan). Run `claude` once in the terminal tab and log in.
- An Anthropic API key, entered in Settings. This is billed per use.

Everything except Claude works offline.

## Build from source

Requires Node.js 22 or later and npm.

```sh
git clone https://github.com/maboke123/marginalia.git
cd marginalia
npm install
npm run dev          # run with hot reload
npm run build:win    # build the installer into dist/
```

If Electron starts as plain Node (for example inside the VS Code terminal), unset `ELECTRON_RUN_AS_NODE` first.

### Tests

```sh
npm test             # unit tests (Vitest)
npm run test:e2e     # end-to-end tests that drive the built app (Playwright)
npm run typecheck
npm run lint
npm run screenshots  # rebuild the README screenshots from a demo vault
```

End-to-end tests run against temporary vaults and a scripted fake of Claude, so they never touch your own notes or use your Claude plan.

## Built with

Electron, React, TypeScript, pdf.js, pdf-lib, CodeMirror 6, KaTeX, perfect-freehand, xterm.js and the Claude Agent SDK.

## Hotkeys

| Action | Default |
| --- | --- |
| Lecture mode | Ctrl+Shift+M |
| Claude panel | Ctrl+L |
| Import PDF | Ctrl+Shift+I |
| Insert link to current slide | Ctrl+Shift+L |
| Slide snapshot | Ctrl+Shift+S |
| Quick switcher | Ctrl+P |
| Search everything | Ctrl+Shift+F |
| Settings | Ctrl+, |
| Select, pen, highlighter, eraser, text box | V, P, H, E, T |

All of them can be changed in Settings.
