// Longer jobs I start from the chat with /name. The steps go in the context packet, so the
// chat shows only "/summary" and what I typed after it.

export interface Skill {
  name: string
  label: string
  steps: string
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
    label: 'Draw UML diagrams from a description of a system',
    steps: `Model the system I describe (in my message, a note, an exercise PDF or the canvas I
have open) as UML on a canvas, the way it is done in a software design course.
1. Find the source: my message, else the selected boxes or text on the open canvas, else the
   exercise I name. Read it fully (read_pdf_text, read_summary, read_canvas).
2. Decide which diagrams the question asks for (class diagram by default; use case, state or
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
3. Draw it with edit_canvas on the canvas I have open; if none is open, create_canvas in the
   folder of the exercise or of what I have open, named after the system. Put all boxes and
   arrows in one edit_canvas call; leave out x and y so the layout is done for you, or give
   positions when the diagram needs a particular shape. A sequence diagram goes in one text
   box as a mermaid \`sequenceDiagram\` block.
4. Look at the result with screenshot. Fix overlapping boxes, crossing arrows and text cut
   off by a box that is too small (change_box with a bigger width or height), with one more
   edit_canvas call.
5. Reply briefly: the modelling choices that were not obvious (why composition and not
   aggregation, an assumption about a multiplicity), and what the description left open.`
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
