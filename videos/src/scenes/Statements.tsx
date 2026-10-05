import { AbsoluteFill } from 'remotion'
import { FadeUp } from '../components/FadeUp'
import { Logo } from '../components/Logo'

const APPS = ['Slides in OneNote.', 'Summary in Obsidian.', 'Claude in another window.']

export function Hook() {
  return (
    <AbsoluteFill className="justify-center gap-4 bg-inverse px-40">
      {APPS.map((line, index) => (
        <FadeUp key={line} delay={6 + index * 14}>
          <h1 className="text-[112px] leading-[1.1] text-inverse-heading">{line}</h1>
        </FadeUp>
      ))}
      <FadeUp delay={6 + APPS.length * 14 + 6}>
        <p className="mt-10 text-[48px] text-inverse-muted">Three apps for every lecture.</p>
      </FadeUp>
    </AbsoluteFill>
  )
}

export function Intro() {
  return (
    <AbsoluteFill className="justify-center gap-10 bg-background px-40">
      <Logo size={168} delay={4} />
      <FadeUp delay={18}>
        <h1 className="text-[140px] leading-none">Marginalia</h1>
      </FadeUp>
      <FadeUp delay={28}>
        <p className="text-[48px] text-muted-foreground">
          Slides, summary and Claude in one window.
        </p>
      </FadeUp>
    </AbsoluteFill>
  )
}

const FILES = [
  { depth: 0, name: 'Machine Learning/' },
  { depth: 1, name: 'B2 Decision trees/' },
  { depth: 2, name: 'Decision trees.pdf' },
  { depth: 2, name: 'Decision trees.pdf.annotations.json' },
  { depth: 2, name: 'Decision trees.md' },
  { depth: 2, name: 'assets/' }
]

export function Files() {
  return (
    <AbsoluteFill className="bg-surface">
      <div className="absolute left-40 top-[140px] flex w-[620px] flex-col gap-8">
        <FadeUp>
          <h2 className="text-[96px] leading-[1.02]">Plain files in a folder you choose.</h2>
        </FadeUp>
        <FadeUp delay={10}>
          <p className="text-[40px] leading-[1.3] text-muted-foreground">
            Notes are standard Markdown, so they open in Obsidian too.
          </p>
        </FadeUp>
      </div>
      <div className="absolute left-[900px] top-[220px] flex flex-col gap-5 font-mono text-[38px]">
        {FILES.map((file, index) => (
          <FadeUp key={file.name} delay={20 + index * 8}>
            <div
              className={file.name.endsWith('/') ? 'text-muted-foreground' : 'text-foreground'}
              style={{ paddingLeft: file.depth * 56 }}
            >
              {file.name}
            </div>
          </FadeUp>
        ))}
      </div>
    </AbsoluteFill>
  )
}

export function Outro() {
  return (
    <AbsoluteFill className="justify-center gap-10 bg-background px-40">
      <Logo size={168} delay={4} />
      <FadeUp delay={18}>
        <h1 className="text-[140px] leading-none">Marginalia</h1>
      </FadeUp>
      <FadeUp delay={28}>
        <p className="text-[48px] text-muted-foreground">Built for my courses at KU Leuven.</p>
      </FadeUp>
    </AbsoluteFill>
  )
}
