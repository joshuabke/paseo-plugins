import { usePaseo } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/ui";
import type { Question } from "../shared/dashboard";
import { useProgressLanguage } from "./language";

// The message Send delivers, like "Q2 B", or null when the question isn't one
// to send for. It goes out in the user's name, so it never carries words an
// agent wrote: Copy's "(title)" is left out, and an id or letter that isn't
// plain is refused.
export function answerMessage(question: Pick<Question, "id">, letter: string): string | null {
  return /^Q\d{1,6}$/.test(question.id) && /^[A-Z]$/.test(letter) ? `${question.id} ${letter}` : null;
}

// The choice sent per question. It outlives the popover and the dialog, which
// close on send while the question stays open until the agent records it.
const sent = new Map<string, string>();

function sentKey(workspaceId: string, question: Question): string {
  return `${workspaceId}:${question.askedAt}:${question.id}`;
}

export function sentChoice(workspaceId: string, question: Question): string | undefined {
  return sent.get(sentKey(workspaceId, question));
}

// Sends a choice to the agent that asked. Whether the agent can take it is
// checked on the press: Paseo would bring an archived agent back, and would
// drop a permission request the agent is waiting on.
export function useSendAnswer(workspaceId: string) {
  const { messages: m } = useProgressLanguage();
  const toast = useToast();
  const paseo = usePaseo();
  return async function send(question: Question, letter: string): Promise<void> {
    const message = answerMessage(question, letter);
    const key = sentKey(workspaceId, question);
    if (!message || !question.agentId || sent.get(key) === letter) return;
    const before = sent.get(key);
    // Set first, so a second press can't send twice.
    sent.set(key, letter);
    const undo = () => {
      if (before === undefined) sent.delete(key);
      else sent.set(key, before);
    };
    try {
      const agent = paseo.agents.ref(question.agentId);
      const found = await agent.refresh();
      if (!found || agent.archivedAt || agent.workspaceId !== workspaceId) {
        undo();
        toast.error(m.sendAgentGone(question.id));
        return;
      }
      if (agent.pendingPermissions?.length) {
        undo();
        toast.error(m.sendNeedsPermission(question.id));
        return;
      }
      // Joins a running turn instead of interrupting it, where the provider can.
      await agent.send(message, { activeTurnBehavior: "steer" });
      toast.show(m.sentChoice(question.id, letter), { variant: "success" });
    } catch {
      undo();
      toast.error(m.sendFailure(question.id));
    }
  };
}
