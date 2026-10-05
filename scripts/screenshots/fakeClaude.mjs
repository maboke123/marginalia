// Stands in for Claude in the README screenshots, with the same contract as e2e/fakeClaude.mjs.
const ANSWER = [
  'Because it has the highest information gain on the full set of 14 days: ',
  '$IG(S, \\text{Outlook}) = 0.246$, against $0.151$ for Humidity, $0.048$ for Wind ',
  'and $0.029$ for Temperature.\n\n',
  'It also makes the **Overcast** branch pure (4 yes, 0 no), so that branch is a leaf ',
  'right away and $H(S_{\\text{Overcast}}) = 0$. Sunny (2 yes, 3 no) and Rain (3 yes, 2 no) ',
  'are still mixed, which is why they get a second test.'
]

export async function* agent(input) {
  const sessionId = input.sessionId ?? 'screenshots'
  input.onSession(sessionId)
  for (const chunk of ANSWER) {
    await new Promise((resolve) => setTimeout(resolve, 30))
    yield { type: 'text', text: chunk }
  }
  yield { type: 'done' }
}

export async function history() {
  return []
}

export async function complete() {
  return ''
}
