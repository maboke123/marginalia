import { WidgetType } from '@codemirror/view'
import katex from 'katex'
import { renderMarkdown } from '../lib/markdown'

export class MathWidget extends WidgetType {
  constructor(
    readonly tex: string,
    readonly display: boolean,
    /** Shown under a math block that is being edited, instead of in its place. */
    readonly preview = false
  ) {
    super()
  }

  eq(other: MathWidget): boolean {
    return (
      other.tex === this.tex && other.display === this.display && other.preview === this.preview
    )
  }

  toDOM(): HTMLElement {
    const el = document.createElement(this.display ? 'div' : 'span')
    el.className = this.display
      ? `cm-math-block${this.preview ? ' cm-math-preview' : ''}`
      : 'cm-math-inline'
    el.innerHTML = katex.renderToString(this.tex || '\\,', {
      displayMode: this.display,
      throwOnError: false
    })
    return el
  }

  // Let clicks through so CodeMirror moves the cursor in, which shows the source.
  ignoreEvent(): boolean {
    return false
  }
}

export class ImageWidget extends WidgetType {
  constructor(
    readonly src: string | null,
    readonly alt: string
  ) {
    super()
  }

  eq(other: ImageWidget): boolean {
    return other.src === this.src && other.alt === this.alt
  }

  toDOM(): HTMLElement {
    if (!this.src) {
      const missing = document.createElement('span')
      missing.className = 'cm-image-missing'
      missing.textContent = this.alt || 'Image outside the vault'
      return missing
    }
    const img = document.createElement('img')
    img.className = 'cm-image'
    img.src = this.src
    img.alt = this.alt
    return img
  }

  ignoreEvent(): boolean {
    return false
  }
}

export class TableWidget extends WidgetType {
  constructor(readonly markdown: string) {
    super()
  }

  eq(other: TableWidget): boolean {
    return other.markdown === this.markdown
  }

  toDOM(): HTMLElement {
    const el = document.createElement('div')
    el.className = 'cm-table-preview'
    el.innerHTML = renderMarkdown(this.markdown)
    return el
  }

  ignoreEvent(): boolean {
    return false
  }
}

export class BulletWidget extends WidgetType {
  eq(): boolean {
    return true
  }

  toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = 'cm-bullet'
    el.textContent = '•'
    return el
  }
}

export class RuleWidget extends WidgetType {
  eq(): boolean {
    return true
  }

  toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = 'cm-rule'
    return el
  }
}
