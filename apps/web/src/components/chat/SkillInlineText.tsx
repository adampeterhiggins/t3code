import { collectComposerModelMentions } from "@t3tools/client-runtime/composer-model-mentions";
import { ModelMentionChip } from "./ModelMentionChip";
import type { EnvironmentId, ScopedThreadRef, ServerProviderSkill } from "@t3tools/contracts";
import { formatProviderSkillDisplayName, matchInlineSkills } from "@t3tools/shared/inlineSkills";
import { Children, cloneElement, isValidElement, type ReactNode } from "react";

import { useRightPanelStore } from "~/rightPanelStore";
import { openTimelineWorkspaceFile } from "../quickMessage/detachedTimelineActions";
import { isDetachedChatWindow } from "../quickMessage/quickMessageWindow";
import {
  buttonContextChip,
  ContextPreviewHover,
  type ContextChipSpec,
} from "../contextPreviewRegistry";
import { skillPreviewDescription } from "../contextPreviews";
import { SkillChipIcon } from "./SkillChipIcon";

/** What a skill chip in message text reads: the provider's skill, as the timeline holds it. */
export type MessageSkill = Pick<ServerProviderSkill, "name" | "displayName"> &
  Partial<Pick<ServerProviderSkill, "description" | "shortDescription" | "path" | "enabled">>;

const skillIndexes = new WeakMap<ReadonlyArray<MessageSkill>, ReadonlyMap<string, MessageSkill>>();

/** The provider's skill a sent skill record names. Indexed once per skills list. */
export function messageSkillByName(
  skills: ReadonlyArray<MessageSkill>,
  name: string,
): MessageSkill | undefined {
  let index = skillIndexes.get(skills);
  if (index === undefined) {
    index = new Map(skills.map((skill) => [skill.name, skill]));
    skillIndexes.set(skills, index);
  }
  return index.get(name);
}

/**
 * The chip for a skill in a sent message, whether it arrived as a skill record or as `$name`
 * typed into the text: both are the same skill and must read the same.
 */
export function messageSkillChip(input: {
  name: string;
  /** The label the record was sent with; the provider's display name wins when it has one. */
  label?: string | undefined;
  skill: MessageSkill | undefined;
  copyMarkdown: string;
  threadRef: ScopedThreadRef | null;
}): ContextChipSpec<"skill"> {
  const { skill, threadRef } = input;
  const label = skill ? formatProviderSkillDisplayName(skill) : input.label || input.name;
  const path = skill?.path;
  return buttonContextChip({
    kind: "skill",
    icon: <SkillChipIcon />,
    label,
    kindLabel: "Skill",
    copyMarkdown: input.copyMarkdown,
    preview: {
      label,
      description: skill ? skillPreviewDescription(skill) : null,
      onOpenInstructions:
        path && threadRef && !isDetachedChatWindow
          ? () => {
              const instructionsPath = path;
              openTimelineWorkspaceFile(() =>
                useRightPanelStore.getState().openFile(threadRef, instructionsPath),
              );
            }
          : undefined,
    },
  });
}

function SkillInlineText(props: {
  text: string;
  skills: ReadonlyArray<MessageSkill>;
  threadRef: ScopedThreadRef | null;
  environmentId: EnvironmentId | null;
}) {
  const chips: Array<{ start: number; end: number; node: ReactNode }> = [];
  for (const { start, end, skill, rawText } of matchInlineSkills(props.text, props.skills)) {
    chips.push({
      start,
      end,
      node: (
        <ContextPreviewHover
          key={`${start}:${skill.name}`}
          kind="skill"
          {...messageSkillChip({
            name: skill.name,
            skill,
            copyMarkdown: rawText,
            threadRef: props.threadRef,
          })}
        />
      ),
    });
  }
  for (const mention of collectComposerModelMentions(props.text)) {
    chips.push({
      start: mention.start,
      end: mention.end,
      node: (
        <ModelMentionChip
          key={`${mention.start}:model`}
          environmentId={props.environmentId}
          instanceId={mention.instanceId}
          model={mention.model}
          source={mention.source}
        />
      ),
    });
  }
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const chip of chips.toSorted((left, right) => left.start - right.start)) {
    if (chip.start < cursor) continue;
    if (chip.start > cursor) {
      nodes.push(props.text.slice(cursor, chip.start));
    }
    nodes.push(chip.node);
    cursor = chip.end;
  }
  if (cursor < props.text.length) {
    nodes.push(props.text.slice(cursor));
  }
  return <>{nodes}</>;
}

export function renderSkillInlineMarkdownChildren(
  children: ReactNode,
  skills: ReadonlyArray<MessageSkill>,
  threadRef: ScopedThreadRef | null,
  environmentId: EnvironmentId | null = null,
): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child === "string") {
      return (
        <SkillInlineText
          text={child}
          skills={skills}
          threadRef={threadRef}
          environmentId={environmentId}
        />
      );
    }
    if (!isValidElement<{ children?: ReactNode; node?: { tagName?: string } }>(child)) {
      return child;
    }
    // Custom markdown components replace intrinsic types; check their hast tags.
    const markdownTagName = typeof child.type === "string" ? child.type : child.props.node?.tagName;
    if (markdownTagName === "code" || markdownTagName === "a") {
      return child;
    }
    if (!("children" in child.props)) {
      return child;
    }
    return cloneElement(
      child,
      undefined,
      renderSkillInlineMarkdownChildren(child.props.children, skills, threadRef, environmentId),
    );
  });
}
