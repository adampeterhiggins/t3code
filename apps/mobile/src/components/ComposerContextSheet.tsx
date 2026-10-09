import { SourceFileSurface } from "../features/files/SourceFileSurface";
import { filePreviewKind } from "@t3tools/shared/filePreview";
import type {
  ComposerContextRecord,
  ElementContextSource,
  EnvironmentId,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { formatAttachmentSize } from "@t3tools/client-runtime/state/attachments";
import { videoMimeType } from "@t3tools/shared/video";
import { useState } from "react";
import {
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { REVIEW_MONO_FONT_FAMILY } from "../features/review/reviewDiffRendering";
import { ReviewCommentCard, useReviewCommentColors } from "../features/review/ReviewCommentCard";
import {
  composerAttachmentInlineUri,
  isFileBackedComposerAttachment,
  type DraftComposerAttachment,
} from "../lib/composerImages";
import { tryOpenExternalUrl } from "../lib/openExternalUrl";
import {
  contextRepositoryOutcomeLabel,
  describeContextRepositoryGitStatus,
} from "@t3tools/client-runtime/context-repositories";
import { FilePreviewModal } from "./FilePreviewModal";
import { VideoPreviewModal } from "./VideoPreviewModal";
import { ComposerContextAttachment } from "./ComposerContextAttachment";
import { AppText as Text } from "./AppText";
import { SymbolView } from "./AppSymbol";
import { ContextSheetSize } from "./ContextSheetSize";
import { useAppearancePreferences } from "../features/settings/appearance/AppearancePreferencesProvider";
import { getMobileTerminalTheme } from "../features/terminal/terminalTheme";

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

/** Touch equivalent of the web context popover; snapshots remain readable offline. */
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
  readonly records?: ReadonlyArray<ComposerContextRecord>;
  readonly attachments?: ReadonlyArray<DraftComposerAttachment>;
}) {
  const reviewColors = useReviewCommentColors();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { themeId, themeAppearance } = useAppearancePreferences();
  const terminalTheme = getMobileTerminalTheme(themeId, themeAppearance);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [bodyHeight, setBodyHeight] = useState(0);
  const measuredHeight = headerHeight + bodyHeight;
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
    <Modal
      animationType="slide"
      presentationStyle={Platform.OS === "android" ? "overFullScreen" : "pageSheet"}
      transparent={Platform.OS === "android"}
      onRequestClose={props.onClose}
    >
      <View
        className={
          Platform.OS === "android" ? "flex-1 justify-end bg-backdrop" : "flex-1 justify-end"
        }
      >
        {Platform.OS === "android" ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss context"
            onPress={props.onClose}
            style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}
          />
        ) : null}
        <View
          className="overflow-hidden rounded-t-3xl bg-sheet-solid"
          style={
            Platform.OS === "android"
              ? {
                  height: Math.min(
                    measuredHeight || windowHeight * 0.5,
                    windowHeight - insets.top - 24,
                  ),
                }
              : { flex: 1 }
          }
        >
          <ContextSheetSize height={measuredHeight} />
          <View
            onLayout={(event) => setHeaderHeight(event.nativeEvent.layout.height)}
            className="flex-row items-center justify-between gap-3 border-b border-border px-4 pb-2 pt-4"
          >
            {terminal ? (
              <SymbolView name="terminal" size={20} tintColor={terminalTheme.palette[2]} />
            ) : null}
            <View className="min-w-0 flex-1">
              <Text className="text-base font-t3-semibold text-foreground" numberOfLines={2}>
                {terminal?.terminalLabel ?? props.label}
              </Text>
              {terminal ? (
                <Text className="text-xs text-foreground-muted">
                  Lines {terminal.lineStart}–{terminal.lineEnd}
                </Text>
              ) : null}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close context"
              onPress={props.onClose}
              className="p-3"
            >
              <Text className="text-foreground">Done</Text>
            </Pressable>
          </View>
          <ScrollView
            style={{ flexShrink: 1 }}
            onContentSizeChange={(_width, height) => setBodyHeight(height)}
            contentContainerStyle={{
              padding: 16,
              gap: 16,
              paddingBottom: Math.max(20, insets.bottom),
            }}
          >
            {!record ? (
              <Text className="text-foreground">
                Context unavailable. The reference was copied without its payload. Copy it again
                from the original message or remove it.
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
                    className="overflow-hidden rounded-xl border border-border"
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
                    <ContextField
                      label="Requested changes"
                      value={record.styleChanges.join("\n")}
                    />
                    {record.elements?.map((element, index) => (
                      <View
                        key={`${element.selector ?? element.tagName}:${index}`}
                        className="gap-3"
                      >
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
                            if (!opened) Alert.alert("Could not open Linear", "Try again later.");
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
                            if (!opened) Alert.alert("Could not open GitHub", "Try again later.");
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
                            if (!opened) Alert.alert("Could not open Notion", "Try again later.");
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
                            if (!opened) Alert.alert("Could not open Slack", "Try again later.");
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
                    {/* Exactly what the agent receives in place of the other chat. */}
                    <ContextField label="Summary" value={record.summary} />
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
                      value={
                        props.skillDescription ?? "No description is available for this skill."
                      }
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
                  void Linking.openURL(pullRequestUrl).catch(() =>
                    Alert.alert("Could not open pull request", "Try again when connected."),
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
            {props.onOpenPullRequest ? (
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
        </View>
      </View>
    </Modal>
  );
}
