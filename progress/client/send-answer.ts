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

// The user's own words, which do go out as typed. The reference in front keeps
// them from reading as a slash command.
export function ownAnswerMessage(question: Pick<Question, "id">, words: string): string | null {
  return /^Q\d{1,6}$/.test(question.id) && words.trim() ? `${question.id}: ${words.trim()}` : null;
}

// The message last sent per question. It outlives the popover and the dialog, which
// close on send while the question stays open until the agent records it.
const sent = new Map<string, string>();

function sentKey(workspaceId: string, question: Question): string {
  return `${workspaceId}:${question.askedAt}:${question.id}`;
}

export function sentMessage(workspaceId: string, question: Question): string | undefined {
  return sent.get(sentKey(workspaceId, question));
}

// Sends an answer to the agent that asked, and says whether it went out. Whether the agent can take it is
// checked on the press: Paseo would bring an archived agent back, and would
// drop a permission request the agent is waiting on.
export function useSendAnswer(workspaceId: string) {
  const { messages: m } = useProgressLanguage();
  const toast = useToast();
  const paseo = usePaseo();
  return async function send(question: Question, message: string): Promise<boolean> {
    const key = sentKey(workspaceId, question);
    if (!question.agentId || sent.get(key) === message) return false;
    const before = sent.get(key);
    // Set first, so a second press can't send twice.
    sent.set(key, message);
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
        return false;
      }
      if (agent.pendingPermissions?.length) {
        undo();
        toast.error(m.sendNeedsPermission(question.id));
        return false;
      }
      // Joins a running turn instead of interrupting it, where the provider can.
      await agent.send(message, { activeTurnBehavior: "steer" });
      toast.show(m.sentAnswer(question.id), { variant: "success" });
      return true;
    } catch {
      undo();
      toast.error(m.sendFailure(question.id));
      return false;
    }
  };
}
