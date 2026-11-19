import { msg, T, useGT, useMessages, Var } from "gt-react-native";

import { Button } from "./ui/Button";
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
import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import { changeRequestTermKind } from "../lib/changeRequestTerm";
import { videoMimeType } from "@t3tools/shared/video";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { REVIEW_MONO_FONT_FAMILY } from "../features/review/reviewDiffRendering";
import { ReviewCommentCard, useReviewCommentColors } from "../features/review/ReviewCommentCard";
import {
  composerAttachmentInlineUri,
  isFileBackedComposerAttachment,
  type DraftComposerAttachment,
} from "../lib/composerImages";
import { contextImageGallery } from "../lib/contextImageGallery";
import { composerObjectLinkNoun } from "@t3tools/source-control-definitions/composerObjectLinks";
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
import { FilePreviewModal } from "./ui/FilePreviewModal";
import { VideoPreviewModal } from "./ui/VideoPreviewModal";
import { granolaNoteDetail } from "./GranolaNotePickerSheet";
import { ComposerContextAttachment } from "./ComposerContextAttachment";
import { AppText as Text } from "./ui/AppText";
import { Sheet } from "./ui/Sheet";
import { useAppearancePreferences } from "../features/settings/appearance/AppearancePreferencesProvider";
import { getMobileTerminalTheme } from "../features/terminal/terminalTheme";

const LINEAR_OBJECT_TYPE_LABELS = {
  project: msg("Project", { $context: "Linear object type" }),
  document: msg("Document", { $context: "Linear object type" }),
  initiative: msg("Initiative", { $context: "Linear object type" }),
} as const;

const GITHUB_REF_TYPE_LABELS = {
  release: msg("Release", { $context: "GitHub ref type" }),
  tag: msg("Tag", { $context: "GitHub ref type" }),
  branch: msg("Branch", { $context: "GitHub ref type" }),
  commit: msg("Commit", { $context: "GitHub ref type" }),
  file: msg("File", { $context: "GitHub ref type" }),
  "workflow-run": msg("Workflow run"),
  "workflow-job": msg("Workflow job"),
} as const;

const THREAD_TAB_SUMMARY_ROLE_LABELS = {
  user: msg("User", { $context: "message author role" }),
  assistant: msg("Agent", { $context: "message author role" }),
  reasoning: msg("Thinking", { $context: "message author role" }),
  tools: msg("Tools", { $context: "message author role" }),
  error: msg("Error", { $context: "message author role" }),
} as const satisfies Record<ThreadTabSummaryRole, string>;

/* oxlint-disable react/no-array-index-key -- Captured summaries are immutable text snapshots without entry IDs. */
function ThreadTabSummaryFields(props: { summary: string }) {
  const gt = useGT();
  const m = useMessages();
  const chats = (() => parseThreadTabSummary(props.summary))();
  if (chats === null) return <ContextField label={gt("Summary")} value={props.summary} />;
  return chats.map((chat, chatIndex) => {
    const fileCount = chat.files.length + chat.moreFiles;
    const facts = [
      chats.length > 1 ? chat.title : null,
      chat.latestTurn ? gt("Latest turn {turn}", { turn: chat.latestTurn }) : null,
      fileCount > 0
        ? gt("{count, plural, one {{count} file changed} other {{count} files changed}}", {
            count: fileCount,
          })
        : null,
    ].filter((fact) => fact !== null);
    return (
      <View key={chatIndex} className="gap-3">
        {facts.length > 0 ? (
          <Text className="text-sm text-foreground-muted">{facts.join(" · ")}</Text>
        ) : null}
        <ContextField
          label={gt("Files changed")}
          code
          value={
            chat.files.length > 0
              ? [
                  ...chat.files,
                  ...(chat.moreFiles > 0
                    ? [gt("…and {count} more", { count: chat.moreFiles })]
                    : []),
                ].join("\n")
              : null
          }
        />
        <ContextField label={gt("Latest plan")} value={chat.plan} />
        {chat.blocks.length === 0 ? (
          <Text className="text-sm text-foreground-muted">{gt("No messages yet.")}</Text>
        ) : null}
        {chat.blocks.map((block, index) =>
          block.kind === "omitted" ? (
            <Text key={index} className="text-center text-sm text-foreground-muted">
              {gt(
                "{count, plural, one {{count} earlier turn not included} other {{count} earlier turns not included}}",
                { count: block.turns },
              )}
            </Text>
          ) : (
            <View
              key={index}
              className={
                block.role === "user" && index > 0 ? "gap-1 border-t border-border pt-3" : "gap-1"
              }
            >
              <Text className="text-xs text-foreground-muted">
                {m(THREAD_TAB_SUMMARY_ROLE_LABELS[block.role])}
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
                    {tool.failed ? gt("{label} (failed)", { label: tool.label }) : tool.label}
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

/* oxlint-enable react/no-array-index-key */

function ContextField(props: {
  label: string;
  value: string | null | undefined;
  code?: boolean;
  language?: "html" | "css";
}) {
  if (!props.value) return null;
  return (
    <View className="gap-1">
      <Text className="text-xs text-foreground-muted">{props.label}</Text>
      {props.code && props.language ? (
        <View
          className="overflow-hidden rounded-xl border border-border"
          style={{ height: Math.min(260, Math.max(100, props.value.split("\n").length * 22 + 36)) }}
        >
          <SourceFileSurface
            embedded
            contents={props.value}
            path={props.language === "html" ? "element.html" : "styles.css"}
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
  const gt = useGT();
  const source = props.source;
  if (!source) return null;
  const location = source.fileName
    ? `${source.fileName}${source.lineNumber !== null ? `:${source.lineNumber}${source.columnNumber !== null ? `:${source.columnNumber}` : ""}` : ""}`
    : null;
  return (
    <ContextField
      label={gt("Source", { $context: "where an element is defined in source code" })}
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
  const gt = useGT();
  const m = useMessages();
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
    const previewKind = filePreviewKind(record, { richDocuments: false });
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
  const term = changeRequestTermKind(
    (
      (pullRequestUrl ? sourceControlClients.findByChangeRequestUrl(pullRequestUrl) : undefined) ??
      sourceControlClients.get(undefined)
    ).changeRequest,
  );
  const terminal = record?.kind === "terminal" && !("payload" in record) ? record : null;
  return (
    <Sheet title={terminal?.terminalLabel ?? props.label} onClose={props.onClose}>
      <ScrollView
        nestedScrollEnabled
        className="flex-1"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 12,
          gap: 16,
          paddingBottom: Math.max(20, insets.bottom),
        }}
      >
        {terminal ? (
          <Text className="text-sm text-foreground-muted">
            <T>
              Lines <Var>{terminal.lineStart}</Var>–<Var>{terminal.lineEnd}</Var>
            </T>
          </Text>
        ) : null}
        {!record ? (
          <Text className="text-foreground">
            <T>
              Context unavailable. The reference was copied without its payload. Copy it again from
              the original message or remove it.
            </T>
          </Text>
        ) : "payload" in record ? (
          <Text className="text-foreground">
            <T>
              This context type is not supported by this version of the app. Its payload will be
              preserved when sent.
            </T>
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
                    label={`#${record.pullRequest.number} · ${
                      record.pullRequest.isDraft
                        ? gt("draft", { $context: "pull request state" })
                        : record.pullRequest.state === "open"
                          ? gt("open", { $context: "pull request state" })
                          : record.pullRequest.state === "closed"
                            ? gt("closed", { $context: "pull request state" })
                            : gt("merged", { $context: "pull request state" })
                    }`}
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
                <ContextField
                  label={gt("Page", { $context: "web page" })}
                  value={record.pageTitle ?? record.pageUrl}
                />
                <ContextField label={gt("URL")} value={record.pageUrl} />
                <ContextField label={gt("Comment", { $context: "noun" })} value={record.comment} />
                <ContextField
                  label={gt("Selection", { $context: "selected part of a web page" })}
                  value={record.targetSummary}
                />
                <ContextField
                  label={gt("Requested changes")}
                  value={record.styleChanges.join("\n")}
                />
                {record.elements?.map(
                  (element, index) => (
                    /* oxlint-disable react/no-array-index-key -- Captured DOM elements are a fixed snapshot without persistent element IDs. */ <View
                      key={`${element.selector ?? element.tagName}:${index}`}
                      className="gap-3"
                    >
                      <ContextField
                        label={gt("Element", { $context: "HTML element on a web page" })}
                        value={element.componentName ?? element.tagName}
                      />
                      <ContextField
                        label={gt("Selector", { $context: "CSS selector" })}
                        value={element.selector}
                        code
                      />
                      <ContextSource source={element.source} />
                      <ContextField
                        label={gt("HTML")}
                        value={element.htmlPreview}
                        code
                        language="html"
                      />
                      <ContextField
                        label={gt("Styles", { $context: "CSS styles" })}
                        value={element.styles}
                        code
                        language="css"
                      />
                    </View>
                  ) /* oxlint-enable react/no-array-index-key */,
                )}
              </>
            ) : null}
            {record.kind === "element" ? (
              <>
                <ContextField label={gt("Page", { $context: "web page" })} value={record.pageUrl} />
                <ContextField
                  label={gt("Element", { $context: "HTML element on a web page" })}
                  value={record.componentName ?? record.tagName}
                />
                <ContextField
                  label={gt("Selector", { $context: "CSS selector" })}
                  value={record.selector}
                  code
                />
                <ContextSource source={record.source} />
                <ContextField label={gt("HTML")} value={record.htmlPreview} code language="html" />
                <ContextField
                  label={gt("Styles", { $context: "CSS styles" })}
                  value={record.styles}
                  code
                  language="css"
                />
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
                        if (!opened)
                          Dialog.alert(
                            gt("Could not open {product}", { product: "Linear" }),
                            gt("Try again later."),
                          );
                      });
                    }}
                    className="rounded-xl bg-subtle p-4"
                  >
                    <Text className="text-foreground">
                      {gt("Open in {product}", { product: "Linear" })}
                    </Text>
                  </Pressable>
                ) : null}
                {/* Plain text like the other captured context here: exactly what the agent received. */}
                <Text selectable className="text-sm text-foreground">
                  {record.markdown}
                </Text>
              </View>
            ) : null}
            {record.kind === "linear-object" ? (
              <View className="gap-3">
                <View className="gap-1">
                  <Text selectable className="text-lg font-t3-semibold text-foreground">
                    {record.title}
                  </Text>
                  <Text className="text-sm text-foreground-muted">
                    {m(LINEAR_OBJECT_TYPE_LABELS[record.objectType])}
                    {record.status === null ? "" : ` · ${record.status}`}
                  </Text>
                </View>
                {/^https?:\/\//i.test(record.url) ? (
                  <Pressable
                    accessibilityRole="link"
                    onPress={() => {
                      void tryOpenExternalUrl(record.url, "linear").then((opened) => {
                        if (!opened)
                          Dialog.alert(
                            gt("Could not open {product}", { product: "Linear" }),
                            gt("Try again later."),
                          );
                      });
                    }}
                    className="rounded-xl bg-subtle p-4"
                  >
                    <Text className="text-foreground">
                      {gt("Open in {product}", { product: "Linear" })}
                    </Text>
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
                    {record.state === "open"
                      ? gt("Open", { $context: "issue state" })
                      : gt("Closed", { $context: "issue state" })}
                  </Text>
                </View>
                {/^https?:\/\//i.test(record.url) ? (
                  <Pressable
                    accessibilityRole="link"
                    onPress={() => {
                      void tryOpenExternalUrl(record.url, "github-issue").then((opened) => {
                        if (!opened)
                          Dialog.alert(
                            gt("Could not open {product}", { product: "GitHub" }),
                            gt("Try again later."),
                          );
                      });
                    }}
                    className="rounded-xl bg-subtle p-4"
                  >
                    <Text className="text-foreground">
                      {gt("Open on {product}", { product: "GitHub" })}
                    </Text>
                  </Pressable>
                ) : null}
                {/* Plain text like the other captured context here: exactly what the agent received. */}
                <Text selectable className="text-sm text-foreground">
                  {record.markdown}
                </Text>
              </View>
            ) : null}
            {record.kind === "github-ref" ? (
              <View className="gap-3">
                <View className="gap-1">
                  <Text selectable className="text-lg font-t3-semibold text-foreground">
                    {record.title}
                  </Text>
                  <Text className="text-sm text-foreground-muted">
                    {record.refType === "workflow-run" || record.refType === "workflow-job"
                      ? record.repository
                      : `${record.repository}@${record.refType === "commit" || /^[0-9a-f]{40}$/i.test(record.ref) ? record.ref.slice(0, 7) : record.ref}`}{" "}
                    · {m(GITHUB_REF_TYPE_LABELS[record.refType])}
                  </Text>
                </View>
                {/^https?:\/\//i.test(record.url) ? (
                  <Pressable
                    accessibilityRole="link"
                    onPress={() => {
                      void tryOpenExternalUrl(record.url, "markdown-link").then((opened) => {
                        if (!opened)
                          Dialog.alert(
                            gt("Could not open {product}", { product: "GitHub" }),
                            gt("Try again later."),
                          );
                      });
                    }}
                    className="rounded-xl bg-subtle p-4"
                  >
                    <Text className="text-foreground">
                      {gt("Open on {product}", { product: "GitHub" })}
                    </Text>
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
                        if (!opened)
                          Dialog.alert(
                            gt("Could not open {product}", { product: "Notion" }),
                            gt("Try again later."),
                          );
                      });
                    }}
                    className="rounded-xl bg-subtle p-4"
                  >
                    <Text className="text-foreground">
                      {gt("Open in {product}", { product: "Notion" })}
                    </Text>
                  </Pressable>
                ) : null}
                {/* Plain text like the other captured context here: exactly what the agent received. */}
                <Text selectable className="text-sm text-foreground">
                  {record.markdown}
                </Text>
              </View>
            ) : null}
            {record.kind === "google-file" ? (
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
                        if (!opened)
                          Dialog.alert(
                            gt("Could not open {product}", { product: "Google" }),
                            gt("Try again later."),
                          );
                      });
                    }}
                    className="rounded-xl bg-subtle p-4"
                  >
                    <Text className="text-foreground">
                      {gt("Open in {product}", { product: "Google" })}
                    </Text>
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
                        if (!opened)
                          Dialog.alert(
                            gt("Could not open {product}", { product: "Granola" }),
                            gt("Try again later."),
                          );
                      });
                    }}
                    className="rounded-xl bg-subtle p-4"
                  >
                    <Text className="text-foreground">
                      {gt("Open in {product}", { product: "Granola" })}
                    </Text>
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
                    {gt("{product} prompt link", { product: "T3 Code" })}
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
            {record.kind === "unread-link" ? (
              <View className="gap-3">
                <View className="gap-1">
                  <Text selectable className="text-lg font-t3-semibold text-foreground">
                    {record.reason === "timed-out"
                      ? gt("Loading this {noun} timed out", {
                          noun: composerObjectLinkNoun(record.linkKind),
                        })
                      : gt("Could not read this {noun}", {
                          noun: composerObjectLinkNoun(record.linkKind),
                        })}
                  </Text>
                  <Text className="text-sm text-foreground-muted">
                    <T>The agent receives the link, not its contents.</T>
                  </Text>
                </View>
                {/^https?:\/\//i.test(record.url) ? (
                  <Pressable
                    accessibilityRole="link"
                    onPress={() => {
                      void tryOpenExternalUrl(record.url, "markdown-link").then((opened) => {
                        if (!opened)
                          Dialog.alert(gt("Could not open the link"), gt("Try again later."));
                      });
                    }}
                    className="rounded-xl bg-subtle p-4"
                  >
                    <Text className="text-foreground">{gt("Open link")}</Text>
                  </Pressable>
                ) : null}
                <Text selectable className="text-sm text-foreground">
                  {record.url}
                </Text>
              </View>
            ) : null}
            {record.kind === "slack-thread" ? (
              <View className="gap-3">
                <View className="gap-1">
                  <Text selectable className="text-lg font-t3-semibold text-foreground">
                    {record.title}
                  </Text>
                  <Text className="text-sm text-foreground-muted">
                    {record.scope === "channel"
                      ? record.channelLabel
                      : `${record.channelLabel} · ${record.authorName}`}
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
                        if (!opened)
                          Dialog.alert(
                            gt("Could not open {product}", { product: "Slack" }),
                            gt("Try again later."),
                          );
                      });
                    }}
                    className="rounded-xl bg-subtle p-4"
                  >
                    <Text className="text-foreground">
                      {gt("Open in {product}", { product: "Slack" })}
                    </Text>
                  </Pressable>
                ) : null}
                {/* Plain text like the other captured context here: exactly what the agent received. */}
                <Text selectable className="text-sm text-foreground">
                  {record.markdown}
                </Text>
              </View>
            ) : null}
            {record.kind === "slack-resource" ? (
              <View className="gap-3">
                <Text selectable className="text-lg font-t3-semibold text-foreground">
                  {record.title}
                </Text>
                {/^https?:\/\//i.test(record.url) ? (
                  <Pressable
                    accessibilityRole="link"
                    onPress={() => {
                      void tryOpenExternalUrl(record.url, "slack").then((opened) => {
                        if (!opened)
                          Dialog.alert(
                            gt("Could not open {product}", { product: "Slack" }),
                            gt("Try again later."),
                          );
                      });
                    }}
                    className="rounded-xl bg-subtle p-4"
                  >
                    <Text className="text-foreground">
                      {gt("Open in {product}", { product: "Slack" })}
                    </Text>
                  </Pressable>
                ) : null}
                {/* Plain text like the other captured context here: exactly what the agent received. */}
                <Text selectable className="text-sm text-foreground">
                  {record.markdown}
                </Text>
              </View>
            ) : null}
            {record.kind === "discord-thread" ? (
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
                      void tryOpenExternalUrl(record.url, "discord").then((opened) => {
                        if (!opened)
                          Dialog.alert(
                            gt("Could not open {product}", { product: "Discord" }),
                            gt("Try again later."),
                          );
                      });
                    }}
                    className="rounded-xl bg-subtle p-4"
                  >
                    <Text className="text-foreground">
                      {gt("Open in {product}", { product: "Discord" })}
                    </Text>
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
                <ContextField label={gt("Chat", { $context: "noun" })} value={record.title} />
                {/* What the agent receives in place of the other chat, laid out by turn. */}
                <ThreadTabSummaryFields summary={record.summary} />
              </View>
            ) : null}
            {record.kind === "repository" ? (
              <View className="gap-3">
                <ContextField
                  label={gt("Repository", { $context: "noun" })}
                  value={record.nameWithOwner}
                />
                <ContextField
                  label={gt("Remote", { $context: "git remote URL" })}
                  value={record.remoteUrl}
                />
                <ContextField
                  label={gt("Clone", { $context: "noun, cloning a repository" })}
                  value={
                    record.outcome
                      ? contextRepositoryOutcomeLabel(record.outcome, m)
                      : gt(
                          "Cloned into the workspace's context folder as {directory} when sent, unless it is already there.",
                          { directory: record.directoryName },
                        )
                  }
                />
                <ContextField label={gt("Detail")} value={record.outcome?.detail} />
                <ContextField
                  // oxlint-disable-next-line t3code/no-untranslated-copy -- product name
                  label="Git"
                  value={
                    record.outcome?.git
                      ? describeContextRepositoryGitStatus(record.outcome.git, m)
                      : null
                  }
                />
              </View>
            ) : null}
            {record.kind === "image" ? (
              <ContextField
                label={gt("File", { $context: "noun" })}
                value={`${record.mimeType} · ${formatAttachmentSize(record.sizeBytes)}`}
              />
            ) : null}
            {record.kind === "mention" ? (
              <ContextField
                label={gt("Path", { $context: "file path" })}
                value={record.path}
                code
              />
            ) : null}
            {record.kind === "thread" ? (
              <View className="gap-3">
                <ContextField label={gt("Thread", { $context: "noun" })} value={record.title} />
                {props.onOpenThread ? (
                  <Button
                    label={gt("Open thread")}
                    tone="secondary"
                    onPress={() =>
                      props.onOpenThread?.({
                        environmentId: record.environmentId,
                        threadId: record.threadId,
                      })
                    }
                    fullWidth
                  />
                ) : null}
              </View>
            ) : null}
            {record.kind === "subagent" ? (
              <View className="gap-3">
                <ContextField
                  label={gt("Agent", { $context: "noun" })}
                  value={`@${record.handle}`}
                  code
                />
                <ContextField label={gt("Title", { $context: "noun" })} value={record.title} />
                <ContextField label={gt("Status when referenced")} value={record.status} />
                {/* Exactly what the agent receives about the referenced agent. */}
                <ContextField label={gt("Task", { $context: "noun" })} value={record.prompt} />
                <ContextField label={gt("Result", { $context: "noun" })} value={record.result} />
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
                    <Text className="text-foreground">{gt("Open agent")}</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
            {record.kind === "model" ? (
              <View className="gap-3">
                <ContextField
                  label={gt("Model", { $context: "AI model" })}
                  value={`${record.modelName} (${record.model})`}
                />
                <ContextField
                  label={gt("Provider", { $context: "AI provider" })}
                  value={`${record.instanceName} · ${record.providerInstanceId}`}
                />
                <ContextField
                  label={gt("Traits", { $context: "model options" })}
                  value={
                    record.options.length > 0
                      ? record.options
                          .map((option) => `${option.label}: ${option.valueLabel}`)
                          .join("\n")
                      : gt("None set; uses the model's defaults.")
                  }
                />
                <ContextField
                  label={gt("Written", { $context: "time a note was written" })}
                  value={new Date(record.writtenAt).toLocaleString()}
                />
              </View>
            ) : null}
            {record.kind === "environment" ? (
              <ContextField label={gt("Machine", { $context: "computer" })} value={record.label} />
            ) : null}
            {record.kind === "skill" ? (
              <View className="gap-3">
                <ContextField
                  label={gt("Skill", { $context: "agent skill" })}
                  value={record.name}
                />
                <ContextField
                  label={gt("Description")}
                  value={
                    props.skillDescription ?? gt("No description is available for this skill.")
                  }
                />
                {props.onOpenSkill ? (
                  <Button
                    label={gt("View instructions")}
                    tone="secondary"
                    onPress={props.onOpenSkill}
                    fullWidth
                  />
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
                Dialog.alert(
                  gt(
                    "Could not open {term, select, mr {merge request} cr {change request} other {pull request}}",
                    { term },
                  ),
                  gt("Try again when connected."),
                ),
              );
            }}
            className="rounded-xl bg-subtle p-4"
          >
            <Text className="text-foreground">
              {gt(
                "Open {term, select, mr {merge request} cr {change request} other {pull request}}",
                { term },
              )}
            </Text>
          </Pressable>
        ) : null}
        {props.onOpenAttachment ? (
          <Button
            label={gt("Open attachment")}
            tone="secondary"
            onPress={props.onOpenAttachment}
            fullWidth
          />
        ) : null}
        {props.onOpenPullRequest && !pullRequestUrl ? (
          <Button
            label={gt(
              "Open {term, select, mr {merge request} cr {change request} other {pull request}}",
              { term },
            )}
            tone="secondary"
            onPress={props.onOpenPullRequest}
            fullWidth
          />
        ) : null}
        {props.onRemove ? (
          <Button
            label={gt("Remove from draft")}
            tone="secondary"
            onPress={props.onRemove}
            fullWidth
          />
        ) : null}
      </ScrollView>
    </Sheet>
  );
}
