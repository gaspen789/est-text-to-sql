/**
 * Split assistant output into optional "thinking" (reasoning / tool narration)
 * and the user-facing body. Supports:
 * - `<thinking>...</thinking>` blocks (recommended; see system prompt)
 * - Provider reasoning streamed separately (wrapped server-side)
 * - Heuristic: prose before **Vastus:** or **Answer:** when no tags match
 */
export function splitAssistantMessage(
  content: string,
  options?: { partialThinking?: boolean }
): { thinking: string | null; body: string } {
  const thinkingBlocks: string[] = [];

  let work = content.replace(/\r\n/g, '\n');

  work = work.replace(/<thinking>([\s\S]*?)<\/thinking>/gi, (_, inner) => {
    thinkingBlocks.push(String(inner).trim());
    return '\n';
  });
  work = work.replace(/\n{3,}/g, '\n\n').trim();

  if (options?.partialThinking) {
    const open = work.indexOf('<thinking>');
    if (open !== -1) {
      thinkingBlocks.push(work.slice(open + '<thinking>'.length).trim());
      work = work.slice(0, open).trim();
    }
  }

  const vastusIdx = work.search(/\*\*Vastus:\*\*/i);
  const answerIdx = work.search(/\*\*Answer:\*\*/i);
  let splitIdx = -1;
  if (vastusIdx >= 0 && answerIdx >= 0) splitIdx = Math.min(vastusIdx, answerIdx);
  else if (vastusIdx >= 0) splitIdx = vastusIdx;
  else if (answerIdx >= 0) splitIdx = answerIdx;

  if (splitIdx > 0) {
    const early = work.slice(0, splitIdx).trim();
    if (early) thinkingBlocks.push(early);
    work = work.slice(splitIdx).trimStart();
  }

  const thinking = thinkingBlocks.filter(Boolean).join('\n\n').trim() || null;
  return { thinking, body: work.trim() };
}
