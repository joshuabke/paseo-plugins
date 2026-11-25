import { type PluginWorkspacePanelProps, useAgent } from "@getpaseo/plugin/client";
import { TextInput } from "@getpaseo/plugin/client/ui";
import React, { useState } from "react";
import { type NativeSyntheticEvent, Platform, Text, type TextInputKeyPressEventData, View } from "react-native";
import type { Question } from "../shared/dashboard";
import { applyEdit, type Edit, enterEdit, indentEdit, typedBreak } from "../shared/list-edit";
import { AnswerButton, type ButtonFill } from "./answer-button";
import { useProgressLanguage } from "./language";
import { ownAnswerMessage, sentMessage, useSendAnswer } from "./send-answer";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];

interface OwnAnswerProps {
  colors: Colors;
  button: ButtonFill;
  question: Question;
  workspaceId: string;
  onCopy(answer: string): void;
  onSent(): void;
}

// Half-written answers outlive the popover and the dialog, which Paseo unmounts on close.
const drafts = new Map<string, string>();

// A text field under the choices, for an answer none of them fits.
export function OwnAnswer(props: OwnAnswerProps) {
  return props.question.agentId ? <OwnAnswerFor {...props} agentId={props.question.agentId} /> : <OwnAnswerField {...props} />;
}

// Send when the agent that asked can be reached from this workspace; see SendOrCopy.
function OwnAnswerFor({ agentId, ...props }: OwnAnswerProps & { agentId: string }) {
  const { question, workspaceId, onSent } = props;
  const send = useSendAnswer(workspaceId);
  const here = useAgent(agentId, (agent) => agent.workspaceId === workspaceId);
  if (!here) return <OwnAnswerField {...props} />;
  return (
    <OwnAnswerField
      {...props}
      onSend={(words, clear) => {
        const message = ownAnswerMessage(question, words);
        if (!message) return;
        // Kept until it's out, so a failed send loses nothing.
        void send(question, message).then((out) => {
          if (out) clear();
        });
        onSent();
      }}
    />
  );
}

function OwnAnswerField({
  colors,
  button,
  question,
  workspaceId,
  onCopy,
  onSend,
}: Omit<OwnAnswerProps, "onSent"> & { onSend?(words: string, clear: () => void): void }) {
  const { messages: m } = useProgressLanguage();
  const draftKey = `${workspaceId}:${question.askedAt}:${question.id}`;
  const [words, setWords] = useState(() => drafts.get(draftKey) ?? "");
  // Set only to move the cursor after an edit on a phone; the keyboard owns it otherwise.
  const [cursor, setCursor] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  const keep = (next: string) => {
    if (next) drafts.set(draftKey, next);
    else drafts.delete(draftKey);
    setWords(next);
  };
  const written = Boolean(words.trim());
  const submit = () => {
    if (!written) return;
    if (!onSend) return onCopy(words.trim());
    onSend(words, () => {
      // Not when the user has typed on since.
      if (drafts.get(draftKey) === words) keep("");
    });
  };
  const sent = sentMessage(workspaceId, question);
  const ownPrefix = `${question.id}: `;
  return (
    <View style={{ gap: 6 }}>
      <TextInput
        multiline
        value={words}
        onChangeText={(next) => {
          const at = Platform.OS === "web" ? null : typedBreak(words, next);
          const edit = at === null ? null : enterEdit(words, at, at);
          if (!edit) return keep(next);
          keep(applyEdit(words, edit));
          setCursor(edit.cursor);
        }}
        onKeyPress={(event) => {
          if (Platform.OS === "web") onDesktopKey(event as unknown as DesktopKeyEvent, submit);
        }}
        selection={cursor === null ? undefined : { start: cursor, end: cursor }}
        onSelectionChange={() => {
          if (cursor !== null) setCursor(null);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        accessibilityLabel={m.ownAnswer(question.id)}
        placeholder={m.ownAnswerHint}
        placeholderTextColor={colors.foregroundMuted}
        style={[
          {
            color: colors.foreground,
            fontSize: 13,
            lineHeight: 19,
            minHeight: 37,
            maxHeight: 200,
            paddingHorizontal: 10,
            paddingVertical: 8,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: focused ? colors.accent : colors.border,
            backgroundColor: button.rest,
            textAlignVertical: "top",
          },
          growing,
        ]}
      />
      {written ? (
        <View style={{ flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 6 }}>
          {onSend ? (
            <AnswerButton colors={colors} button={button} icon="Send" label={m.send} accessibilityLabel={m.sendOwnAnswer(question.id)} onPress={submit} />
          ) : null}
          <AnswerButton
            colors={colors}
            button={button}
            icon="Copy"
            label={onSend ? undefined : m.copy}
            accessibilityLabel={m.copyOwnAnswer(question.id)}
            onPress={() => onCopy(words.trim())}
          />
        </View>
      ) : sent?.startsWith(ownPrefix) ? (
        <Text numberOfLines={3} style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>
          {m.youSent}
          {m.colon}
          {sent.slice(ownPrefix.length)}
        </Text>
      ) : null}
    </View>
  );
}

// Phones grow a multiline field by themselves. The desktop app's browser does
// with this style, which React Native has no type for.
const growing = Platform.OS === "web" ? ({ fieldSizing: "content", resize: "none", outlineStyle: "none" } as object) : null;

interface TextArea {
  value: string;
  selectionStart: number;
  selectionEnd: number;
  setSelectionRange(start: number, end: number): void;
  ownerDocument: { execCommand(command: "insertText" | "delete", ui: boolean, text?: string): boolean };
}

type DesktopKeyEvent = NativeSyntheticEvent<
  TextInputKeyPressEventData & { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; isComposing?: boolean }
>;

function onDesktopKey(event: DesktopKeyEvent, submit: () => void): void {
  const { key, shiftKey, metaKey, ctrlKey, altKey, isComposing } = event.nativeEvent;
  // Enter picks a word while an input method is open.
  if (isComposing || altKey) return;
  if (key === "Enter" && (metaKey || ctrlKey)) {
    event.preventDefault();
    return submit();
  }
  if (metaKey || ctrlKey) return;
  const area = event.target as unknown as TextArea;
  const edit =
    key === "Enter" && !shiftKey
      ? enterEdit(area.value, area.selectionStart, area.selectionEnd)
      : key === "Tab"
        ? indentEdit(area.value, area.selectionStart, area.selectionEnd, Boolean(shiftKey))
        : null;
  if (!edit) return;
  event.preventDefault();
  applyInPlace(area, edit);
}

// As if the user had typed it, so undo takes it back and the field reports the change.
function applyInPlace(area: TextArea, edit: Edit): void {
  area.setSelectionRange(edit.from, edit.to);
  if (edit.insert) area.ownerDocument.execCommand("insertText", false, edit.insert);
  else if (edit.from !== edit.to) area.ownerDocument.execCommand("delete", false);
  area.setSelectionRange(edit.cursor, edit.cursorEnd ?? edit.cursor);
}
