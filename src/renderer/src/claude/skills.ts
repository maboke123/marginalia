// Longer jobs I start from the chat with /name. The steps go in the context packet, so the
// chat shows only "/summary" and what I typed after it.

export interface Skill {
  name: string
  label: string
  steps: string
  /**
   * The skill learns each course from its slides and transcripts, and from my feedback; its
   * playbook for the course goes along in the context.
   */
  learns?: true
  /** Words after the name that change what it does, offered in the picker. */
  modes?: { name: string; label: string }[]
}

export const SKILLS: Skill[] = [
  {
    name: 'summary',
    label: 'Write a summary of this lecture from the slides, transcript, notes and annotations',
    steps: `Write a complete summary of this lecture as a new note.
1. The lecture is the slides I have open, or the PDF I name. Read all slide text with
   read_pdf_text; use read_pdf_page for slides that are mostly a figure, table or formula.
2. Read everything I added: list_annotations for the whole PDF (my text boxes and highlights;
   for pen strokes look at the slide image), the notes linked to the PDF (read_pdf_text lists
   them) and the transcript of this lesson if there is one. From the transcript take what the
   lecturer stressed, examples and exam hints that are not on the slides.
3. Write Markdown: a ## heading per main topic in the order of the lecture, then definitions,
   formulas in LaTeX, the intuition behind them, worked examples and what was stressed. Mark
   what I annotated or the lecturer called important. Link slides relative to the note, like
   [slide 12](<slides.pdf#page=12>). Write in the language of my notes, else of the slides.
4. Check with Glob whether a summary note for this PDF already exists. If it does, ask me
   whether to extend it (insert_into_summary) or write a new one, and stop.
5. Save it with create_note in the folder of the PDF, linked to the PDF, named
   "<PDF name> summary".
6. Reply in two or three lines: where it is, which sources you used and which were missing.`
  },
  {
    name: 'cleanup',
    label: 'Clean up my annotations on these slides and flag mistakes',
    steps: `Clean up my annotations on the slides I have open (or the PDF I name), at the end
of a lecture.
1. list_annotations for the whole PDF, and read_pdf_text for the slide text. Use
   read_pdf_page where the layout or a figure matters.
2. For each of my text boxes: fix typos and spelling, broken Markdown and LaTeX (formulas as
   $...$), and turn rushed notes into clear, short sentences. Merge boxes on the same page
   that say the same thing.
3. Never lose information: every fact, example, question, remark and bit of extra context I
   wrote stays, reworded at most. Keep my language and the abbreviations that are clear.
4. If I wrote something that is wrong (it contradicts the slide, the transcript or the
   subject), do not quietly change it. Keep my text and add a line under it:
   **Check:** what seems wrong, and the likely correction. Only a clear slip (a wrong sign,
   swapped indices) you fix directly, and you name it in your reply.
5. Layout: look at each page with annotations (screenshot) to see overlaps, boxes that cover
   slide text or run off the page, and move them to free space, usually the margin. Text that
   does not fit on the page goes on a blank page (add_blank_page). Look again after changing
   a page.
6. Leave highlights, pen strokes and images alone. Delete nothing except boxes you merged.
7. Make each change with its own edit_annotation call, so I can accept or reject each one.
8. End with a short list per page of what you changed, and every Check you added.`
  },
  {
    name: 'uml',
    label: 'Draw UML diagrams from a description or user story, the way this course does it',
    learns: true,
    modes: [
      {
        name: 'learn',
        label: "Learn this course's way of modelling from its slides and transcripts"
      },
      { name: 'review', label: 'Check a diagram the way the lecturer would' }
    ],
    steps: `You model the way the lecturer of this course does. The context has your playbook
for this course: what you learned from its slides and transcripts, and my rules from my
feedback. It comes before general UML habits; my rules come before the lecturer's.

If my message is "/uml learn", learn instead of drawing:
L1. The context lists the files of the course not learned yet, in course order. Take the
    first lessons among them (a lesson is one folder), at most 3 per run.
L2. Slides: read_pdf_text, then read_pdf_page for the slides where the point is in a drawing
    (most UML slides): the notation is in the picture, not the text. Transcripts: Read them
    and take what the lecturer stresses, why a convention is used, mistakes they warn about,
    exam and project hints, and how they get from a description or user story to a model.
L3. Merge what you learned into the playbook, with these sections: ## How the lecturer
    models (the steps they follow), ## Notation, ## Mistakes to avoid, ## Project and exam,
    ## My rules, ## Learned (one line per lesson: folder and topic). One bullet per
    convention, with its source: [slide 12](<vault path#page=12>) or (Transcript name 12:34).
    Merge what repeats, keep it under about 250 lines, keep My rules exactly.
L4. Save with update_playbook after each lesson, with the files you read (also those with
    nothing about modelling) in learned, so they are not offered again.
L5. Reply with what you learned in a few bullets and how many files are left ("/uml learn"
    again goes on). Draw nothing.

If my message is "/uml review", or I ask whether a diagram is right: check the diagram on the
open canvas (read_canvas and screenshot) the way the lecturer would grade it. List what is
wrong or missing, each with the convention from the playbook (and its source) and the fix,
most important first; then what is good. Change nothing unless I ask.

Otherwise, model the system I describe (in my message, a user story, a note, an exercise PDF
or the canvas I have open) as UML on a canvas:
1. Find the source: my message, else the selected boxes or text on the open canvas, else the
   exercise I name. Read it fully (read_pdf_text, read_summary, read_canvas).
2. Follow the playbook: the lecturer's steps (for a user story, say, first a domain model),
   notation and the mistakes to avoid. Where it says nothing, use standard UML. When the
   playbook is empty, say once that "/uml learn" lets you follow this course's conventions.
3. Decide which diagrams the question asks for (class diagram by default; use case, state or
   activity when asked). For a class diagram:
   - classes from the nouns that have their own data or behaviour; attributes with types; the
     operations the description needs; visibility (- private, + public, # protected);
   - relations: inheritance only for a real "is a"; composition when the part cannot exist
     without the whole, aggregation when it can; association with a name and both
     multiplicities (1, 0..1, 0..*, 1..*); dependency for "uses";
   - interfaces («interface») and enumerations («enumeration») where the text implies them.
   For a use case diagram: actors outside a system boundary group, use cases as ellipses,
   associations, and include/extend as dependency arrows labelled «include» / «extend». For
   state diagrams: initial and final states, states as rounded boxes, transitions labelled
   "event [guard] / action". For activity diagrams: start, actions, decisions with labelled
   outgoing arrows, end.
4. Draw it with edit_canvas on the canvas I have open; if none is open, create_canvas in the
   folder of the exercise or of what I have open, named after the system. Put all boxes and
   arrows in one edit_canvas call; leave out x and y so the layout is done for you, or give
   positions when the diagram needs a particular shape. A sequence diagram goes in one text
   box as a mermaid \`sequenceDiagram\` block.
5. Look at the result with screenshot. Fix overlapping boxes, crossing arrows and text cut
   off by a box that is too small (change_box with a bigger width or height), with one more
   edit_canvas call.
6. Reply briefly: the modelling choices that were not obvious (why composition and not
   aggregation, an assumption about a multiplicity), each with the convention you followed,
   and what the description left open.

Whenever I correct what you made or tell you to do or not do something (now or in a later
message), add it to My rules with update_playbook: one short line, replacing a line it
contradicts. If it goes against the lecturer's convention, say so once, then follow me.`
  },
  {
    name: 'exercise',
    label: 'Write the takeaways of this exercise session as a note',
    steps: `We went through an exercise session (in this chat, and in my notes and
annotations). Write a study note from it, for the exam and for redoing the exercises later.
1. Use this conversation (my questions, your answers and corrections), the exercise PDF I have
   open or name (read_pdf_text), my annotations on it (list_annotations) and the notes
   linked to it.
2. Structure:
   - A ## heading per exercise: the question in one line, the approach, the key steps and
     formulas, and the final answer. Where I went wrong: what I did, and the correction.
   - ## Key takeaways: the ideas and tricks that carry over to other exercises.
   - ## For the exam: what is likely asked, traps, and what to pay attention to.
   - ## Redo checklist: which exercises to redo, and a hint to try first without looking.
3. Answers to the questions I asked in this chat go under the exercise they belong to.
4. Write in the language of this conversation. Link exercises to their page, like
   [exercise 3](<session.pdf#page=5>).
5. Save it with create_note in the folder of the PDF, linked to the PDF, named
   "<PDF name> takeaways". Reply with where it is and a three line recap.`
  }
]

/** The skill a message starts with ("/summary focus on part 2"), if any. */
export function skillOf(message: string): Skill | null {
  const name = /^\/([a-z-]+)(?:\s|$)/i.exec(message.trim())?.[1]?.toLowerCase()
  return SKILLS.find((s) => s.name === name) ?? null
}
