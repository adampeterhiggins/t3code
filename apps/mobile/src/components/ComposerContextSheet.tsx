import { useMemo } from "react";
import * as Dialog from "./ui/Dialog";
import { useOpenPullRequest } from "../native/useOpenPullRequest";
import { SourceFileSurface } from "../features/files/SourceFileSurface";
import { filePreviewKind } from "@t3tools/shared/filePreview";
import type {
  ComposerContextRecord,
  ElementContextSource,
  EnvironmentId,
  ProjectId,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { formatAttachmentSize } from "@t3tools/client-runtime/state/attachments";
import { videoMimeType } from "@t3tools/shared/video";
import { Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { REVIEW_MONO_FONT_FAMILY } from "../features/review/reviewDiffRendering";
import { ReviewCommentCard, useReviewCommentColors } from "../features/review/ReviewCommentCard";
import {
  composerAttachmentInlineUri,
  isFileBackedComposerAttachment,
  type DraftComposerAttachment,
} from "../lib/composerImages";
import { contextImageGallery } from "../lib/contextImageGallery";
import { tryOpenExternalUrl } from "../lib/openExternalUrl";
import {
  contextRepositoryOutcomeLabel,
  describeContextRepositoryGitStatus,
} from "@t3tools/client-runtime/context-repositories";
import {
  parseThreadTabSummary,
  threadTabSummaryTools,
  type ThreadTabSummaryRole,
} from "@t3tools/client-runtime/thread-tab-summary";
import { FilePreviewModal } from "./FilePreviewModal";
import { VideoPreviewModal } from "./VideoPreviewModal";
import { granolaNoteDetail } from "./GranolaNotePickerSheet";
import { ComposerContextAttachment } from "./ComposerContextAttachment";
import { AppText as Text } from "./ui/AppText";
import { Sheet } from "./ui/Sheet";
import { useAppearancePreferences } from "../features/settings/appearance/AppearancePreferencesProvider";
import { getMobileTerminalTheme } from "../features/terminal/terminalTheme";

const THREAD_TAB_SUMMARY_ROLE_LABELS = {
  user: "User",
  assistant: "Agent",
  reasoning: "Thinking",
  tools: "Tools",
  error: "Error",
} as const satisfies Record<ThreadTabSummaryRole, string>;

function ThreadTabSummaryFields(props: { summary: string }) {
  const chats = (() => parseThreadTabSummary(props.summary))();
  if (chats === null) return <ContextField label="Summary" value={props.summary} />;
  return chats.map((chat, chatIndex) => {
    const fileCount = chat.files.length + chat.moreFiles;
    const facts = [
      chats.length > 1 ? chat.title : null,
      chat.latestTurn ? `Latest turn ${chat.latestTurn}` : null,
      fileCount > 0 ? `${fileCount} ${fileCount === 1 ? "file" : "files"} changed` : null,
    ].filter((fact) => fact !== null);
    return (
      <View key={chatIndex} className="gap-3">
        {facts.length > 0 ? (
          <Text className="text-sm text-foreground-muted">{facts.join(" · ")}</Text>
        ) : null}
        <ContextField
          label="Files changed"
          code
          value={
            chat.files.length > 0
              ? [
                  ...chat.files,
                  ...(chat.moreFiles > 0 ? [`…and ${chat.moreFiles} more`] : []),
                ].join("\n")
              : null
          }
        />
        <ContextField label="Latest plan" value={chat.plan} />
        {chat.blocks.length === 0 ? (
          <Text className="text-sm text-foreground-muted">No messages yet.</Text>
        ) : null}
        {chat.blocks.map((block, index) =>
          block.kind === "omitted" ? (
            <Text key={index} className="text-center text-sm text-foreground-muted">
              {block.turns} earlier {block.turns === 1 ? "turn" : "turns"} not included
            </Text>
          ) : (
            <View
              key={index}
              className={
                block.role === "user" && index > 0 ? "gap-1 border-t border-border pt-3" : "gap-1"
              }
            >
              <Text className="text-xs text-foreground-muted">
                {THREAD_TAB_SUMMARY_ROLE_LABELS[block.role]}
              </Text>
              {block.role === "tools" ? (
                threadTabSummaryTools(block.text).map((tool, toolIndex) => (
                  <Text
                    key={toolIndex}
                    selectable
                    numberOfLines={2}
                    className={
                      tool.failed
                        ? "text-sm text-danger-foreground"
                        : "text-sm text-foreground-muted"
                    }
                    style={{ fontFamily: REVIEW_MONO_FONT_FAMILY }}
                  >
                    {tool.failed ? `${tool.label} (failed)` : tool.label}
                  </Text>
                ))
              ) : (
                <Text
                  selectable
                  className={
                    block.role === "error"
                      ? "text-base text-danger-foreground"
                      : block.role === "reasoning"
                        ? "text-base italic text-foreground-muted"
                        : "text-base text-foreground"
                  }
                >
                  {block.text}
                </Text>
              )}
            </View>
          ),
        )}
      </View>
    );
  });
}

function ContextField(props: { label: string; value: string | null | undefined; code?: boolean }) {
  if (!props.value) return null;
  return (
    <View className="gap-1">
      <Text className="text-xs text-foreground-muted">{props.label}</Text>
      {props.code && (props.label === "HTML" || props.label === "Styles") ? (
        <View
          className="overflow-hidden rounded-xl border border-border"
          style={{ height: Math.min(260, Math.max(100, props.value.split("\n").length * 22 + 36)) }}
        >
          <SourceFileSurface
            embedded
            contents={props.value}
            path={props.label === "HTML" ? "element.html" : "styles.css"}
          />
        </View>
      ) : (
        <Text
          selectable
          className={props.code ? "text-sm text-foreground" : "text-base text-foreground"}
          style={props.code ? { fontFamily: REVIEW_MONO_FONT_FAMILY } : undefined}
        >
          {props.value}
        </Text>
      )}
    </View>
  );
}

function ContextSource(props: { source: ElementContextSource | null }) {
  const source = props.source;
  if (!source) return null;
  const location = source.fileName
    ? `${source.fileName}${source.lineNumber !== null ? `:${source.lineNumber}${source.columnNumber !== null ? `:${source.columnNumber}` : ""}` : ""}`
    : null;
  return (
    <ContextField
      label="Source"
      value={[source.functionName, location].filter(Boolean).join("\n")}
      code
    />
  );
}

export function ComposerContextSheet(props: {
  readonly label: string;
  readonly record: ComposerContextRecord | undefined;
  readonly onClose: () => void;
  readonly onRemove?: () => void;
  readonly onOpenAttachment?: () => void;
  readonly onOpenPullRequest?: () => void;
  readonly skillDescription?: string;
  readonly onOpenSkill?: () => void;
  readonly onOpenThread?: (thread: ScopedThreadRef) => void;
  readonly environmentId?: EnvironmentId;
  readonly projectId?: ProjectId;
  readonly records?: ReadonlyArray<ComposerContextRecord>;
  readonly attachments?: ReadonlyArray<DraftComposerAttachment>;
}) {
  const openPullRequest = useOpenPullRequest({
    context:
      props.environmentId && props.projectId
        ? { environmentId: props.environmentId, projectId: props.projectId }
        : undefined,
  });
  const reviewColors = useReviewCommentColors();
  const insets = useSafeAreaInsets();
  const { themeId, themeAppearance } = useAppearancePreferences();
  const terminalTheme = getMobileTerminalTheme(themeId, themeAppearance);
  const record = props.record;
  const localAttachment =
    record && "attachmentId" in record
      ? props.attachments?.find((entry) => entry.id === record.attachmentId)
      : undefined;
  const localFile =
    localAttachment && isFileBackedComposerAttachment(localAttachment)
      ? localAttachment
      : undefined;
  if (record && !("payload" in record) && (record.kind === "image" || record.kind === "file")) {
    const mimeType = videoMimeType(record) ?? record.mimeType;
    const previewKind = filePreviewKind(record);
    const resource = {
      _tag: "attachment" as const,
      attachmentId: record.attachmentId,
      fileName: record.name,
      mimeType,
    };
    const remoteSource = props.environmentId
      ? { environmentId: props.environmentId, resource }
      : null;
    if (videoMimeType(record)) {
      if (localFile?.type === "file") {
        return (
          <VideoPreviewModal
            source={{ type: "local", attachment: localFile }}
            onRequestClose={props.onClose}
          />
        );
      }
      if (remoteSource && !localFile) {
        return (
          <VideoPreviewModal
            source={{
              type: "media",
              name: record.name,
              mimeType,
              ...remoteSource,
              actionsSource: { name: record.name, mimeType, ...remoteSource },
            }}
            onRequestClose={props.onClose}
          />
        );
      }
    } else if (record.kind === "image" || previewKind === "image" || previewKind === "pdf") {
      const inlineUri = composerAttachmentInlineUri(localAttachment);
      const source = localFile
        ? { attachment: localFile }
        : inlineUri
          ? { uri: inlineUri }
          : remoteSource;
      if (source) {
        return (
          <FilePreviewModal
            source={{
              kind: record.kind === "image" || previewKind === "image" ? "image" : "pdf",
              name: record.name,
              ...source,
              gallery: contextImageGallery(
                props.records ?? [],
                props.attachments ?? [],
                props.environmentId,
              ),
              actionsSource: { name: record.name, mimeType, ...source },
            }}
            onRequestClose={props.onClose}
          />
        );
      }
    }
  }
  const attachmentRecord =
    record && "attachmentId" in record
      ? record
      : record?.kind === "preview-annotation" && "screenshotContextId" in record
        ? props.records?.find(
            (entry) => entry.contextId === record.screenshotContextId && "attachmentId" in entry,
          )
        : undefined;
  const pullRequestUrl =
    record?.kind === "review-comment" && "pullRequest" in record
      ? record.pullRequest?.url
      : undefined;
  const terminal = record?.kind === "terminal" && !("payload" in record) ? record : null;
  return (
    <Sheet title={terminal?.terminalLabel ?? props.label} onClose={props.onClose}>
      <ScrollView
        nestedScrollEnabled
        className="flex-1"
        contentInsetAdjustmentBehavior={Platform.OS === "ios" ? "automatic" : "never"}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 12,
          gap: 16,
          paddingBottom: Math.max(20, insets.bottom),
        }}
      >
        {terminal ? (
          <Text className="text-sm text-foreground-muted">
            Lines {terminal.lineStart}–{terminal.lineEnd}
          </Text>
        ) : null}
        {!record ? (
          <Text className="text-foreground">
            Context unavailable. The reference was copied without its payload. Copy it again from
            the original message or remove it.
          </Text>
        ) : "payload" in record ? (
          <Text className="text-foreground">
            This context type is not supported by this version of the app. Its payload will be
            preserved when sent.
          </Text>
        ) : (
          <>
            {record.kind === "terminal" ? (
              <View
                className="overflow-hidden rounded-xl"
                style={{ backgroundColor: terminalTheme.background }}
              >
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator
                  contentContainerStyle={{ padding: 12 }}
                >
                  <Text
                    selectable
                    className="text-sm text-foreground"
                    style={{
                      fontFamily: REVIEW_MONO_FONT_FAMILY,
                      fontSize: 13,
                      lineHeight: 20,
                      color: terminalTheme.foreground,
                    }}
                  >
                    {record.text}
                  </Text>
                </ScrollView>
              </View>
            ) : null}
            {record.kind === "review-comment" ? (
              <>
                {record.pullRequest ? (
                  <ContextField
                    label={`#${record.pullRequest.number} · ${record.pullRequest.isDraft ? "draft" : record.pullRequest.state}`}
                    value={`${record.pullRequest.title}\n${record.pullRequest.headBranch} → ${record.pullRequest.baseBranch}`}
                  />
                ) : null}
                {!record.sectionId.startsWith("pull-request:") ? (
                  <>
                    <ReviewCommentCard
                      comment={{ ...record, id: record.contextId }}
                      colors={reviewColors}
                    />
                  </>
                ) : null}
              </>
            ) : null}
            {record.kind === "preview-annotation" ? (
              <>
                <ContextField label="Page" value={record.pageTitle ?? record.pageUrl} />
                <ContextField label="URL" value={record.pageUrl} />
                <ContextField label="Comment" value={record.comment} />
                <ContextField label="Selection" value={record.targetSummary} />
                <ContextField label="Requested changes" value={record.styleChanges.join("\n")} />
                {record.elements?.map((element, index) => (
                  <View key={`${element.selector ?? element.tagName}:${index}`} className="gap-3">
                    <ContextField
                      label="Element"
                      value={element.componentName ?? element.tagName}
                    />
                    <ContextField label="Selector" value={element.selector} code />
                    <ContextSource source={element.source} />
                    <ContextField label="HTML" value={element.htmlPreview} code />
                    <ContextField label="Styles" value={element.styles} code />
                  </View>
                ))}
              </>
            ) : null}
            {record.kind === "element" ? (
              <>
                <ContextField label="Page" value={record.pageUrl} />
                <ContextField label="Element" value={record.componentName ?? record.tagName} />
                <ContextField label="Selector" value={record.selector} code />
                <ContextSource source={record.source} />
                <ContextField label="HTML" value={record.htmlPreview} code />
                <ContextField label="Styles" value={record.styles} code />
              </>
            ) : null}
            {record.kind === "linear-issue" ? (
              <View className="gap-3">
                <View className="gap-1">
                  <Text selectable className="text-lg font-t3-semibold text-foreground">
                    {record.title}
                  </Text>
                  <Text className="text-sm text-foreground-muted">
                    {record.identifier} · {record.stateName}
                  </Text>
                </View>
                {/^https?:\/\//i.test(record.url) ? (
                  <Pressable
                    accessibilityRole="link"
                    onPress={() => {
                      void tryOpenExternalUrl(record.url, "linear").then((opened) => {
                        if (!opened) Dialog.alert("Could not open Linear", "Try again later.");
                      });
                    }}
                    className="rounded-xl bg-subtle p-4"
                  >
                    <Text className="text-foreground">Open in Linear</Text>
                  </Pressable>
                ) : null}
                {/* Plain text like the other captured context here: exactly what the agent received. */}
                <Text selectable className="text-sm text-foreground">
                  {record.markdown}
                </Text>
              </View>
            ) : null}
            {record.kind === "github-issue" ? (
              <View className="gap-3">
                <View className="gap-1">
                  <Text selectable className="text-lg font-t3-semibold text-foreground">
                    {record.title}
                  </Text>
                  <Text className="text-sm text-foreground-muted">
                    {record.repository}#{record.number} ·{" "}
                    {record.state === "open" ? "Open" : "Closed"}
                  </Text>
                </View>
                {/^https?:\/\//i.test(record.url) ? (
                  <Pressable
                    accessibilityRole="link"
                    onPress={() => {
                      void tryOpenExternalUrl(record.url, "github-issue").then((opened) => {
                        if (!opened) Dialog.alert("Could not open GitHub", "Try again later.");
                      });
                    }}
                    className="rounded-xl bg-subtle p-4"
                  >
                    <Text className="text-foreground">Open on GitHub</Text>
                  </Pressable>
                ) : null}
                {/* Plain text like the other captured context here: exactly what the agent received. */}
                <Text selectable className="text-sm text-foreground">
                  {record.markdown}
                </Text>
              </View>
            ) : null}
            {record.kind === "notion-page" ? (
              <View className="gap-3">
                <View className="gap-1">
                  <Text selectable className="text-lg font-t3-semibold text-foreground">
                    {record.title}
                  </Text>
                </View>
                {/^https?:\/\//i.test(record.url) ? (
                  <Pressable
                    accessibilityRole="link"
                    onPress={() => {
                      void tryOpenExternalUrl(record.url, "markdown-link").then((opened) => {
                        if (!opened) Dialog.alert("Could not open Notion", "Try again later.");
                      });
                    }}
                    className="rounded-xl bg-subtle p-4"
                  >
                    <Text className="text-foreground">Open in Notion</Text>
                  </Pressable>
                ) : null}
                {/* Plain text like the other captured context here: exactly what the agent received. */}
                <Text selectable className="text-sm text-foreground">
                  {record.markdown}
                </Text>
              </View>
            ) : null}
            {record.kind === "granola-note" ? (
              <View className="gap-3">
                <View className="gap-1">
                  <Text selectable className="text-lg font-t3-semibold text-foreground">
                    {record.title}
                  </Text>
                  {record.meetingAt || record.participants ? (
                    <Text className="text-sm text-foreground-muted">
                      {granolaNoteDetail(record)}
                    </Text>
                  ) : null}
                </View>
                {/^https?:\/\//i.test(record.url) ? (
                  <Pressable
                    accessibilityRole="link"
                    onPress={() => {
                      void tryOpenExternalUrl(record.url, "markdown-link").then((opened) => {
                        if (!opened) Dialog.alert("Could not open Granola", "Try again later.");
                      });
                    }}
                    className="rounded-xl bg-subtle p-4"
                  >
                    <Text className="text-foreground">Open in Granola</Text>
                  </Pressable>
                ) : null}
                {/* Plain text like the other captured context here: exactly what the agent received. */}
                <Text selectable className="text-sm text-foreground">
                  {record.markdown}
                </Text>
              </View>
            ) : null}
            {record.kind === "prompt-link" ? (
              <View className="gap-3">
                <View className="gap-1">
                  <Text selectable className="text-lg font-t3-semibold text-foreground">
                    T3 Code prompt link
                  </Text>
                  {record.target ? (
                    <Text className="text-sm text-foreground-muted">{record.target}</Text>
                  ) : null}
                </View>
                {/* Plain text like the other captured context here: exactly what the agent received. */}
                {record.prompt !== null ? (
                  <Text selectable className="text-sm text-foreground">
                    {record.prompt}
                  </Text>
                ) : null}
              </View>
            ) : null}
            {record.kind === "slack-thread" ? (
              <View className="gap-3">
                <View className="gap-1">
                  <Text selectable className="text-lg font-t3-semibold text-foreground">
                    {record.title}
                  </Text>
                  <Text className="text-sm text-foreground-muted">
                    {record.channelLabel} · {record.authorName}
                    {record.replyCount > 0
                      ? ` · ${record.replyCount} ${record.replyCount === 1 ? "reply" : "replies"}`
                      : ""}
                  </Text>
                </View>
                {/^https?:\/\//i.test(record.url) ? (
                  <Pressable
                    accessibilityRole="link"
                    onPress={() => {
                      void tryOpenExternalUrl(record.url, "slack").then((opened) => {
                        if (!opened) Dialog.alert("Could not open Slack", "Try again later.");
                      });
                    }}
                    className="rounded-xl bg-subtle p-4"
                  >
                    <Text className="text-foreground">Open in Slack</Text>
                  </Pressable>
                ) : null}
                {/* Plain text like the other captured context here: exactly what the agent received. */}
                <Text selectable className="text-sm text-foreground">
                  {record.markdown}
                </Text>
              </View>
            ) : null}
            {record.kind === "thread-tab" ? (
              <View className="gap-3">
                <ContextField label="Chat" value={record.title} />
                {/* What the agent receives in place of the other chat, laid out by turn. */}
                <ThreadTabSummaryFields summary={record.summary} />
              </View>
            ) : null}
            {record.kind === "repository" ? (
              <View className="gap-3">
                <ContextField label="Repository" value={record.nameWithOwner} />
                <ContextField label="Remote" value={record.remoteUrl} />
                <ContextField
                  label="Clone"
                  value={
                    record.outcome
                      ? contextRepositoryOutcomeLabel(record.outcome)
                      : `Cloned into the workspace's context folder as ${record.directoryName} when sent, unless it is already there.`
                  }
                />
                <ContextField label="Detail" value={record.outcome?.detail} />
                <ContextField
                  label="Git"
                  value={
                    record.outcome?.git
                      ? describeContextRepositoryGitStatus(record.outcome.git)
                      : null
                  }
                />
              </View>
            ) : null}
            {record.kind === "image" ? (
              <ContextField
                label="File"
                value={`${record.mimeType} · ${formatAttachmentSize(record.sizeBytes)}`}
              />
            ) : null}
            {record.kind === "mention" ? (
              <ContextField label="Path" value={record.path} code />
            ) : null}
            {record.kind === "thread" ? (
              <View className="gap-3">
                <ContextField label="Thread" value={record.title} />
                {props.onOpenThread ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() =>
                      props.onOpenThread?.({
                        environmentId: record.environmentId,
                        threadId: record.threadId,
                      })
                    }
                    className="rounded-xl bg-subtle p-4"
                  >
                    <Text className="text-foreground">Open thread</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
            {record.kind === "subagent" ? (
              <View className="gap-3">
                <ContextField label="Agent" value={`@${record.handle}`} code />
                <ContextField label="Title" value={record.title} />
                <ContextField label="Status when referenced" value={record.status} />
                {/* Exactly what the agent receives about the referenced agent. */}
                <ContextField label="Task" value={record.prompt} />
                <ContextField label="Result" value={record.result} />
                {props.onOpenThread && record.childThreadId !== null ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() =>
                      record.childThreadId !== null &&
                      props.onOpenThread?.({
                        environmentId: record.environmentId,
                        threadId: record.childThreadId,
                      })
                    }
                    className="rounded-xl bg-subtle p-4"
                  >
                    <Text className="text-foreground">Open agent</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
            {record.kind === "skill" ? (
              <View className="gap-3">
                <ContextField label="Skill" value={record.name} />
                <ContextField
                  label="Description"
                  value={props.skillDescription ?? "No description is available for this skill."}
                />
                {props.onOpenSkill ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={props.onOpenSkill}
                    className="rounded-xl bg-subtle p-4"
                  >
                    <Text className="text-foreground">View instructions</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </>
        )}
        {attachmentRecord && "attachmentId" in attachmentRecord ? (
          <ComposerContextAttachment
            key={JSON.stringify([
              props.environmentId,
              attachmentRecord.attachmentId,
              props.attachments?.find((entry) => entry.id === attachmentRecord.attachmentId)
                ?.fileUri,
            ])}
            record={attachmentRecord}
            environmentId={props.environmentId}
            attachment={props.attachments?.find(
              (entry) => entry.id === attachmentRecord.attachmentId,
            )}
          />
        ) : null}
        {pullRequestUrl && /^https?:\/\//i.test(pullRequestUrl) ? (
          <Pressable
            accessibilityRole="link"
            onPress={() => {
              props.onClose();
              void openPullRequest(pullRequestUrl).catch(() =>
                Dialog.alert("Could not open pull request", "Try again when connected."),
              );
            }}
            className="rounded-xl bg-subtle p-4"
          >
            <Text className="text-foreground">Open pull request</Text>
          </Pressable>
        ) : null}
        {props.onOpenAttachment ? (
          <Pressable
            accessibilityRole="button"
            onPress={props.onOpenAttachment}
            className="rounded-xl bg-subtle p-4"
          >
            <Text className="text-foreground">Open attachment</Text>
          </Pressable>
        ) : null}
        {props.onOpenPullRequest && !pullRequestUrl ? (
          <Pressable
            accessibilityRole="button"
            onPress={props.onOpenPullRequest}
            className="rounded-xl bg-subtle p-4"
          >
            <Text className="text-foreground">Open pull request</Text>
          </Pressable>
        ) : null}
        {props.onRemove ? (
          <Pressable
            accessibilityRole="button"
            onPress={props.onRemove}
            className="rounded-xl bg-subtle p-4"
          >
            <Text className="text-foreground">Remove from draft</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </Sheet>
  );
}
