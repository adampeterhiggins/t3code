import type { ScopedThreadRef, ServerProviderSkill } from "@t3tools/contracts";
import { formatProviderSkillDisplayName, matchInlineSkills } from "@t3tools/shared/inlineSkills";
import { Children, cloneElement, isValidElement, type ReactNode } from "react";

import { useRightPanelStore } from "~/rightPanelStore";
import {
  buttonContextChip,
  ContextPreviewHover,
  type ContextChipSpec,
} from "../contextPreviewRegistry";
import { skillPreviewDescription } from "../contextPreviews";
import { SkillChipIcon } from "./SkillChipIcon";

/** What a skill chip in message text reads: the provider's skill, as the timeline holds it. */
export type MessageSkill = Pick<ServerProviderSkill, "name" | "displayName"> &
  Partial<Pick<ServerProviderSkill, "description" | "shortDescription" | "path">>;

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
        path && threadRef
          ? () => useRightPanelStore.getState().openFile(threadRef, path)
          : undefined,
    },
  });
}

function SkillInlineText(props: {
  text: string;
  skills: ReadonlyArray<MessageSkill>;
  threadRef: ScopedThreadRef | null;
}) {
  const nodes: ReactNode[] = [];
  let cursor = 0;

  for (const { start, end, skill, rawText } of matchInlineSkills(props.text, props.skills)) {
    if (start > cursor) {
      nodes.push(props.text.slice(cursor, start));
    }
    nodes.push(
      <ContextPreviewHover
        key={`${start}:${skill.name}`}
        kind="skill"
        {...messageSkillChip({
          name: skill.name,
          skill,
          copyMarkdown: rawText,
          threadRef: props.threadRef,
        })}
      />,
    );
    cursor = end;
  }

  if (cursor === 0) {
    return <>{props.text}</>;
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
): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child === "string") {
      return <SkillInlineText text={child} skills={skills} threadRef={threadRef} />;
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
      renderSkillInlineMarkdownChildren(child.props.children, skills, threadRef),
    );
  });
}
