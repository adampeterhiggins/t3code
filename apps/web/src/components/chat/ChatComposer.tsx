import {
  findPastedComposerObjectLinks,
  findTypedComposerObjectLink,
  type ComposerObjectLink,
  parseComposerObjectLink,
} from "@t3tools/source-control-definitions/composerObjectLinks";

import {
  objectLinkChipDestination,
  type ObjectLinkDrafts,
  OBJECT_LINK_TIMEOUT_MS,
  objectLinkChipEdit,
  resolveObjectLinkWithin,
  unreadLinkChip,
} from "./composerObjectLinkChip";

import {
  type ComposerThreadTarget,
  type ComposerFileAttachment,
  type ComposerImageAttachment,
  type DraftId,
  type PersistedComposerImageAttachment,
  composerFileNeedsReattach,
  composerDraftHasUserContent,
  composerTargetKey,
  useComposerDraftStore,
  useComposerThreadDraft,
} from "../../composerDraftStore";

import {
  type ResolvedComposerObjectLink,
  useResolveComposerObjectLink,
} from "./useResolveComposerObjectLink";
import { unreadLinkContextRecord } from "@t3tools/source-control-definitions/integrationContextRecords";
import { Button } from "../ui/button";
import { ComposerAttachMenu, openComposerAttachPicker } from "./ComposerAttachMenu";
import { ComposerModelChipPicker } from "./ComposerModelChipPicker";
import { ComposerModelFilters } from "./ComposerModelFilters";
import {
  ContextMenuItem,
  MessageDraft,
  MessageDraftId,
  ModelContextRecord,
  ThreadTabGroup,
  UnreadLinkContextRecord,
  type KeybindingCommand,
  type AssistantCitation,
  type ChatAttachment as ContractChatAttachment,
  type ChatFileAttachment,
  type EnvironmentId,
  type ModelSelection,
  type ProjectId,
  type PreviewAnnotationPayload,
  type ProviderApprovalDecision,
  type ThreadContextRecord,
  type ProviderInteractionMode,
  type ResolvedKeybindingsConfig,
  type RuntimeMode,
  type RuntimeRequestId,
  type ScopedThreadRef,
  type ServerProvider,
  type ThreadId,
  EnvironmentRequestInvalidError,
  AuthOrchestrationOperateScope,
  ProviderDriverKind,
  ProviderInstanceId,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  type ComposerContextRecord,
  type ThreadPullRequestLink,
} from "@t3tools/contracts";
import { EllipsisIcon, PlayIcon, ShieldIcon } from "lucide-react";

import {
  SAVE_DRAFT_MENU_ITEM,
  findComposerSendMenuAction,
  resolveComposerSendMenu,
} from "@t3tools/client-runtime/state/send-menu";

import { ThreadUsageSummary } from "@t3tools/client-runtime/thread-usage";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

import { agentReferenceTargetOf, attachAgentToChat } from "./agentReferences";

import { attachModelToChat } from "./modelReferences";
import { attachRepository } from "./RepositoryAttachPicker";
import {
  collectComposerContextReferences,
  replaceComposerContextReferences,
  toKindScopedComposerContextId,
} from "@t3tools/shared/composerContextReferences";
import { deriveComposerModelItems } from "./composerModelItems";
import { discordGetThreadInput, useAttachDiscordMessage } from "./DiscordMessagePicker";

import {
  isComposerReferenceItem as isReferenceMenuItem,
  type ComposerReferenceItem as ReferenceMenuItem,
} from "./composerReferenceMenu.logic";
import { messageDraftComposerRecords } from "./messageDraftComposer";
import { messageDraftEnvironment, useThreadMessageDrafts } from "../../state/messageDrafts";

import {
  pastedFilePathsAsComposerFileLinks,
  serializeComposerFileLink,
} from "@t3tools/shared/composerTrigger";
import { providerModelKey } from "~/modelOrdering";
import { readLocalApi } from "../../localApi";
import { recordComposerReferenceRecents } from "./composerReferenceRecents";

import { resolveComposerSnapshot, type ComposerSnapshot } from "./composerPendingSnapshot";

import { slackGetThreadInput, useAttachSlackMessage } from "./SlackMessagePicker";
import {
  type ComposerCitationDestinations,
  type ComposerCitationCommentRequest,
  type ComposerPromptEditorHandle,
  ComposerPromptEditor,
} from "../ComposerPromptEditor";

import { type ComposerSendSurface, ComposerPrimaryActions } from "./ComposerPrimaryActions";

import { useAtomValue } from "@effect/atom-react";
import { useAttachCheckout, useComposerCheckoutItems } from "./useComposerCheckoutItems";

import { useAttachGitHubIssue } from "./GitHubIssuePicker";
import { useAttachGranolaNote } from "./GranolaNotePicker";
import { useAttachLinearIssue } from "./LinearIssuePicker";
import { useAttachNotionPage } from "./NotionPagePicker";
import { useAttachGoogleFile } from "./GoogleFilePicker";

import { useCaptureThreadTabContext } from "./ThreadTabs";
import { useCheckoutContextRecords } from "~/checkoutContextStore";
import { useComposerAgentItems } from "./useComposerAgentItems";

import { useComposerReferenceMenu } from "./useComposerReferenceMenu";
import { useComposerSubmitRequestStore } from "../../composerSubmitRequestStore";
import { useEnvironmentModelPreferences } from "~/hooks/useSettings";
import { useIssueContextRecords, useIssueContextStore } from "~/issueContextStore";

import { useLinkClickHandler } from "~/browser/useOpenLink";
import { useMessageDraftActions } from "./useMessageDraftActions";
import { useRepositoryContextRecords } from "~/repositoryContextStore";

import { useSplitPaneFocus } from "./splitPane";

import { useThreadTabContextRecords } from "~/threadTabContextStore";
import { useComposerTypingGuard } from "./useComposerTypingGuard";
import { insertAttachmentReferencesForDraft } from "./composerAttachmentReferences";
import { DESKTOP_PASTE_AS_TEXT_EVENT } from "../../lib/desktopPasteAsText";
import { runtimeModeConfig, runtimeModeOptions as runtimeModes } from "./runtimeModeConfig";
import { isLocalEnvironmentDisabled } from "../../localEnvironment";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useRightPanelStore } from "~/rightPanelStore";
import { importPastedComposerText, readPastedComposerContext } from "../composerInlineTokenPaste";
import {
  questionAttachmentDraftId,
  trackOpenQuestionAttachmentDraft,
  useQuestionAttachmentPreparation,
} from "../../questionAttachments";

import type { EnvironmentConnectionPresentation } from "@t3tools/client-runtime/connection";
import { settlePromise, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import * as Schema from "effect/Schema";
import { isPasteAsTextShortcut } from "@t3tools/client-runtime/text-paste";

import { folderDropTarget, resolveDroppedFolderPath } from "./folderDrop";
import { splitTransferredFiles } from "./workspaceFileDrop";
import { createModelSelection, normalizeModelSlug } from "@t3tools/shared/model";
import { USAGE_LIMITS_COMMAND } from "@t3tools/shared/usageLimits";
import {
  memo,
  type ReactNode,
  useEffect,
  useEffectEvent,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal, flushSync } from "react-dom";
import {
  clampCollapsedComposerCursor,
  type ComposerTrigger,
  type ComposerSubmissionIntent,
  collapseExpandedComposerCursor,
  composerRequiresModifier,
  composerStateAtPromptEnd,
  detectComposerTrigger,
  expandCollapsedComposerCursor,
  formatAssistantCitationForComposer,
  isPathSuggestionCurrent,
  extendReplacementRangeForTrailingSpace,
  replaceTextRange,
} from "../../composer-logic";
import { DEFAULT_COMPOSER_PLACEHOLDER } from "../../composerPlaceholder";
import {
  deriveComposerSendState,
  getAntigravitySendBlockReason,
  readFileAsDataUrl,
  resolveComposerInteractionMode,
  threadShellHasStarted,
} from "../ChatView.logic";
import {
  dataTransferHasComposerMention,
  makeComposerMentionDragHandlers,
} from "./composerMentionDrag";
import {
  isInsideCollapsedComposerControls,
  isInsideRestingComposerControlScope,
} from "./composerEventScope";

import { ComposerStashBadge } from "./ComposerStashBadge";
import { ComposerStashMenu } from "./ComposerStashMenu";
import { useComposerTriggerState } from "./useComposerTriggerState";
import { useComposerMenuItems } from "./useComposerMenuItems";
import { useComposerFocusState } from "./useComposerFocusState";
import { useComposerMultilinePrompt } from "./useComposerMultilinePrompt";
import {
  ComposerTasksBadge,
  ComposerTasksContent,
  ComposerTasksDrawer,
  type ComposerTaskStep,
  type ComposerTasksProgress,
} from "./ComposerTasksBadge";
import { ComposerActivityRow } from "./ComposerActivityStatus";
import {
  reconcileAttachmentContextReferences,
  useRetainedContextPayloads,
} from "./composerContextUndo";
import type { ThreadSyncPhase } from "../../threadSync";
import { ComposerBanner } from "./ComposerBanner";
import { ComposerSurface } from "./ComposerSurface";
import {
  ComposerBannerStack,
  type ComposerBannerStackContent,
  type ComposerBannerStackItem,
} from "./ComposerBannerStack";
import {
  attachmentsToReleaseOnUploadCapabilityLoss,
  composerOtherFilesForPresentation,
  fileAttachmentCapabilityBlockReason,
  fileAttachmentStagingLimit,
  isPreviewableComposerVideo,
  shouldHandleComposerAttachmentPaste,
} from "./composerAttachmentFiles";
import {
  releaseAttachmentUpload,
  releaseDraftAttachment,
  startAttachmentUpload,
  useAttachmentUploadStore,
} from "../../lib/attachmentUploadQueue";
import { attachmentUploadBlockReason } from "../../lib/attachmentUploadState";
import type { AssistantCitationSourceAnchor } from "~/lib/assistantTextSelection";
import { shortcutLabelForCommand } from "../../keybindings";
import {
  type TerminalContextDraft,
  type TerminalContextSelection,
} from "../../lib/terminalContext";

import {
  shouldUseCompactComposerPrimaryActions,
  shouldUseCompactComposerFooter,
  shouldUseRestingComposerLayout,
} from "../composerFooterLayout";

import {
  ComposerContextActionsContext,
  composerContextRecordsFromDraft,
} from "../composerContextPresentation";
import { useOpenPrLink } from "~/lib/openPullRequestLink";
import {
  collectInlineContextIds,
  type ComposerContextReference,
  ensureInlineContextReferences,
  formatInlineContextReference,
  insertInlineContextReference,
  inlineContextReferenceReplacement,
} from "~/lib/composerContextReferences";
import {
  attachmentContextRecord,
  uploadedAttachmentContextRecord,
  previewAnnotationContextId,
  previewAnnotationContextRecord,
  reviewCommentContextId,
  reviewCommentContextReference,
  reviewCommentContextRecord,
  terminalContextReference,
  terminalContextRecord,
  threadContextRecord,
  threadContextReference,
} from "~/lib/composerContextRecords";
import { rememberCopiedComposerAttachments } from "~/lib/copiedComposerAttachments";
import { useThreadContextDrop, threadContextDropTargetProps } from "./threadContextDrag";
import { readThreadShell } from "~/state/entities";
import { encodeComposerContextFragment } from "@t3tools/shared/composerContextClipboard";

import { threadContextAttachment } from "~/lib/threadContextAttachment";
import {
  type ComposerCommandItem,
  ComposerCommandMenu,
  composerSuggestionOptionId,
} from "./ComposerCommandMenu";
import { ComposerPendingApprovalActions } from "./ComposerPendingApprovalActions";
import {
  ComposerAttachmentFileList,
  ComposerAttachmentMediaRow,
  ComposerFilePreviewDialog,
  ComposerQueuedAttachmentRow,
  ComposerRestingImagePreviews,
} from "./ComposerAttachmentStrip";

import { ComposerFooterPrimaryActions } from "./ComposerFooterControls";
import { ComposerPendingApprovalPanel } from "./ComposerPendingApprovalPanel";
import { ComposerPendingUserInputPanel } from "./ComposerPendingUserInputPanel";
import { ComposerPlanFollowUpBanner } from "./ComposerPlanFollowUpBanner";
import { resolveComposerMenuActiveItemId } from "./composerMenuHighlight";
import { buildPullRequestReferenceContext } from "../pullRequest/pullRequestDetail.logic";
import { getComposerPromptInjectionState, getComposerReasoningStep } from "./composerProviderState";
import { readPromptUltrathink } from "./TraitsPicker";
import {
  providerSupportsManualCompaction,
  resolveContextWindowModelDisplayName,
  shouldReserveContextWindowMeter,
} from "./ContextWindowMeter.logic";
import {
  buildAttachmentVideoPreview,
  buildExpandedImagePreview,
  type ExpandedImagePreview,
} from "./ExpandedImagePreview";
import { cn, isMacPlatform, randomUUID } from "~/lib/utils";
import {
  getComposerPromptLengthValidationMessage,
  getComposerSubmissionValidationMessage,
  submitComposerDraft,
} from "./composerSubmission";
import { ComposerPromptLengthValidation } from "./ComposerPromptLengthValidation";
import { pendingDraftWork } from "./pendingDraftWork";
import { importComposerThreadAttachment } from "./composerThreadImport";
import { isTimelineScrollTarget } from "./timelineScrollTarget";
import {
  createComposerScrollGestureState,
  recordComposerScrollGestureEvent,
  shouldCollapseComposerForScrollKey,
  resetComposerScrollGesture,
  suppressActiveComposerScrollGesture,
} from "./composerScrollGesture";
import { observeResize } from "~/lib/observeResize";

const isEnvironmentRequestInvalidError = Schema.is(EnvironmentRequestInvalidError);

const COMPOSER_SCROLL_COLLAPSE_THRESHOLD_PX = 24;
const COMPOSER_SCROLL_GESTURE_RESET_MS = 120;
import { toastManager } from "../ui/toast";

import { proposedPlanTitle } from "@t3tools/shared/proposedPlanText";
import { hasProviderSetup } from "./ProviderStatusBanner";
import { type AppModelOption, getAppModelOptionsForInstance } from "../../modelSelection";
import type { UnifiedSettings } from "@t3tools/contracts/settings";
import {
  isVideoAttachment,
  type ChatMessage,
  type SessionPhase,
  type Thread,
  type ThreadShell,
} from "../../types";
import { type ComposerPromptHistoryPosition } from "./composerPromptHistory";
import type { PendingUserInputDraftAnswer } from "../../pendingUserInput";
import type {
  LatestProposedPlanState,
  PendingApproval,
  PendingUserInput,
} from "../../session-logic";
import {
  resolveComposerDispatchMode,
  type ComposerDispatchMode,
} from "@t3tools/client-runtime/state/composer-dispatch";
import type { ContextWindowSnapshot } from "../../lib/contextWindow";
import {
  resolveProviderSkillsForCwd,
  resolveProviderSlashCommandsForCwd,
} from "@t3tools/client-runtime/providerSkills";
import { useDelayedStatus } from "../../hooks/useDelayedStatus";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useSoftwareKeyboardOpen } from "../../hooks/useSoftwareKeyboardOpen";
import { useStableCallback } from "../../hooks/useStableCallback";
import { usePanelAnimationSettings } from "../../panelAnimations";
import { readEnvironmentScope } from "../../state/session";
import type { ReviewCommentContext } from "../../reviewCommentContext";
import { useComposerRestingTransition } from "./useComposerRestingTransition";
import { ComposerCommandMenuLayer } from "./ComposerCommandMenuLayer";
import { useRestingComposerControlsLayout } from "./useRestingComposerControlsLayout";
import { useProviderWorkspaceSnapshotRefresh } from "./useProviderWorkspaceSnapshotRefresh";
import { useComposerProviderModel } from "./useComposerProviderModel";
import { useComposerImageGroups } from "./useComposerImageGroups";
import { useComposerStash } from "./useComposerStash";
import { useComposerContextImport } from "./useComposerContextImport";
import { useComposerAttachmentIntake } from "./useComposerAttachmentIntake";
import {
  countPreparingComposerImages,
  usePreparingComposerImages,
} from "./preparingComposerImages";
import { ComposerControlsBar } from "./ComposerControlsBar";
import { composerCommandKeyHandler } from "./composerCommandKey";

function consumePasteAsTextShortcut(deadline: { current: number }): boolean {
  const armed = Date.now() <= deadline.current;
  deadline.current = 0;
  return armed;
}

const runtimeModeOptions = runtimeModes.map((mode) => ({ mode, ...runtimeModeConfig[mode] }));

export interface ChatComposerHandle {
  focusAtEnd: () => void;
  focusAt: (cursor: number) => void;
  restoreAfterTimelineReachedEnd: () => void;
  collapseForTimelineScrollKey: (key: string) => void;
  /** Resolves once the files are in the draft, compressed and ready to send. */
  addDroppedFiles: (files: File[]) => Promise<boolean>;
  addDroppedFolders: (folders: File[]) => void;
  hasPendingAttachments: () => boolean;
  insertTextAtEnd: (
    text: string,
    options?: {
      ensureLeadingBoundary?: boolean;
      clipboardData?: DataTransfer;
      /** The paste-as-text shortcut: file paths and links stay text. */
      pasteAsText?: boolean;
    },
  ) => boolean;
  pasteTextAtEnd: (text: string, options?: { bypassAutoAttachment?: boolean }) => boolean;
  citeAssistantText: (
    citation: AssistantCitation,
    sourceAnchor?: AssistantCitationSourceAnchor,
  ) => boolean;
  openModelPicker: () => void;
  stepReasoningEffort: (direction: 1 | -1) => void;
  toggleModelPicker: () => void;
  openControl: (command: KeybindingCommand) => void;
  isModelPickerOpen: () => boolean;
  isCaretAtStart: () => boolean;
  compactContext: () => void;
  saveMessageDraft: () => Promise<void>;
  openMessageDraft: (draftId: MessageDraftId) => Promise<void>;
  readSnapshot: () => {
    value: string;
    cursor: number;
    expandedCursor: number;
    contextIds: string[];
  };
  resetCursorState: (options?: {
    cursor?: number;
    prompt?: string;
    detectTrigger?: boolean;
  }) => void;
  addTerminalContext: (selection: TerminalContextSelection) => void;
  /** Insert a chip at the caret for a record the caller already holds the payload for. */
  insertContextReference: (reference: ComposerContextReference) => void;
  getSendContext: () => {
    answeringPendingUserInput: boolean;
    prompt: string;
    images: ComposerImageAttachment[];
    files: ComposerFileAttachment[];
    terminalContexts: TerminalContextDraft[];
    previewAnnotations: PreviewAnnotationPayload[];
    reviewComments: ReviewCommentContext[];
    threadContexts: ThreadContextRecord[];
    selectedPromptEffort: string | null;
    selectedModelOptionsForDispatch: unknown;
    selectedModelSelection: ModelSelection;
    multipleModelSelections: ReadonlyArray<ModelSelection> | null;
    providerAvailable: boolean;
    selectedProvider: ProviderDriverKind;
    selectedModel: string;
    selectedProviderModels: ReadonlyArray<ServerProvider["models"][number]>;
    interactionMode: ProviderInteractionMode;
    interactionModeEnabled: boolean;
    shownPendingApprovalIds: ReadonlyArray<RuntimeRequestId>;
  };
  validateProviderInput: (providerInput: string) => boolean;
  setMultipleModelSelections: (selections: ReadonlyArray<ModelSelection>) => void;
}

export interface ChatComposerProps {
  composerDraftTarget: ScopedThreadRef | DraftId;
  environmentId: EnvironmentId;
  canOperateThread: boolean;
  attachmentUploadsCapabilityKnown: boolean;
  supportsAttachmentUploads: boolean;
  supportsQuestionAttachments: boolean;
  maxFileAttachmentBytes: number | null;
  routeKind: "server" | "draft";
  routeThreadRef: ScopedThreadRef;
  draftId: DraftId | null;
  multipleModelSelections: ReadonlyArray<ModelSelection> | null;
  supportsMultipleModels: boolean;
  onMultipleModelSelectionsChange: React.Dispatch<
    React.SetStateAction<ReadonlyArray<ModelSelection> | null>
  >;

  activeThreadId: ThreadId | null;
  activeThreadEnvironmentId: EnvironmentId | undefined;
  activeThread: Thread | undefined;
  activeThreadShell: ThreadShell | null;
  promptHistoryMessages: ReadonlyArray<ChatMessage>;
  /** Tabs sharing this thread's workspace; siblings appear in the @ menu. */
  threadTabGroup: ThreadTabGroup | null;
  isServerThread: boolean;
  isLocalDraftThread: boolean;
  forceExpandedOnMobile: boolean;
  projectSelectionRequired: boolean;
  /** Present on the new-thread splash: opens the "start from PR, branch, or issue" picker. */
  onStartFrom?: () => void;
  phase: SessionPhase;
  canInterrupt: boolean;
  isConnecting: boolean;
  /** Whether the checkout is a git repository is still unknown, so the send mode isn't settled. */
  checkoutKindPending: boolean;
  isSendBusy: boolean;
  canResume: boolean;
  isRevertingCheckpoint?: boolean;
  sendDisabledReason: string | null;
  isPreparingWorktree: boolean;
  /** Empty local draft: the primary action creates the thread or worktree before a message. */
  createWithoutMessage: "worktree" | "thread" | null;
  isCompacting: boolean;
  bannerItems: readonly ComposerBannerStackItem[];
  resumeCompactionTokens: number | null;
  keepFullHistory: boolean;
  onToggleKeepFullHistory: () => void;
  onUsageLimitsCommand?: (() => void) | undefined;
  environmentUnavailable: {
    readonly label: string;
    readonly connection: EnvironmentConnectionPresentation;
  } | null;

  activePendingApproval: PendingApproval | null;
  pendingApprovals: PendingApproval[];
  pendingUserInputs: PendingUserInput[];
  activePendingProgress: {
    questionIndex: number;
    isLastQuestion: boolean;
    canAdvance: boolean;
    customAnswer: string;
    activeQuestion: {
      id: string;
      initialAnswer?: string | undefined;
      multiSelect?: boolean | undefined;
      allowCustomAnswer?: boolean | undefined;
    } | null;
  } | null;
  activePendingResolvedAnswers: Record<string, unknown> | null;
  activePendingIsResponding: boolean;
  activePendingDraftAnswers: Record<string, PendingUserInputDraftAnswer>;
  activePendingQuestionIndex: number;
  respondingRequestIds: RuntimeRequestId[];

  showPlanFollowUpPrompt: boolean;
  activeProposedPlan: LatestProposedPlanState | null;
  activeTasksProgress: ComposerTasksProgress | null;
  activeTaskSteps: readonly ComposerTaskStep[] | null;
  threadSyncPhase: ThreadSyncPhase | null;

  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;

  lockedProvider: ProviderDriverKind | null;
  providerStatuses: ServerProvider[];
  providerCatalogKnown: boolean;
  activeProjectDefaultModelSelection: ModelSelection | null | undefined;
  activeThreadModelSelection: ModelSelection | null | undefined;
  reportedModelSelection?: ModelSelection | null;
  activeProjectId: ProjectId | null;

  activeContextWindow: ContextWindowSnapshot | null;
  threadUsage: ThreadUsageSummary | null;
  compactThreadUnavailable: boolean;
  compactDisabled: boolean;
  compactDisabledReason: string | null;

  resolvedTheme: "light" | "dark";
  settings: UnifiedSettings;
  keybindings: ResolvedKeybindingsConfig;
  terminalOpen: boolean;
  gitCwd: string | null;
  /** Project checkout whose GitHub issues can be attached. Null hides that menu item. */
  githubIssueCwd: string | null;
  pullRequestProjectId: ProjectId | null;
  pullRequestRepository: string | null;
  threadPullRequests?: ReadonlyArray<ThreadPullRequestLink> | undefined;
  restingControlsHost: HTMLDivElement | null;
  restingControlsHaveLeadingContext: boolean;
  onRestingControlsVisibilityChange: (visible: boolean) => void;
  getTimelineScrollableNode: () => HTMLElement | null;
  isTimelineAtLogicalEnd: () => boolean;
  timelineOverflows: boolean;
  onComposerOverlayHeightChange: (height: number) => void;
  onRestingChange: (resting: boolean) => void;

  promptRef: React.RefObject<string>;
  composerImagesRef: React.RefObject<ComposerImageAttachment[]>;
  composerFilesRef: React.RefObject<ComposerFileAttachment[]>;
  composerTerminalContextsRef: React.RefObject<TerminalContextDraft[]>;
  composerRef: React.RefObject<ChatComposerHandle | null>;
  onPageScrollKeyDown: (key: "PageUp" | "PageDown") => void;
  onPageScrollKeyUp: (key: string) => void;
  onPageScrollRelease: () => void;

  queuedRunsControl?: ReactNode;
  editingQueuedAttachments: ReadonlyArray<{
    readonly attachment: ContractChatAttachment;
    readonly url: string | null;
  }> | null;
  onRemoveEditingQueuedAttachment: (attachmentId: string) => void;

  onCompactContext: () => void;
  onSend: (
    e?: { preventDefault: () => void },
    dispatchMode?: ComposerDispatchMode,
    submissionIntent?: ComposerSubmissionIntent,
  ) => void;
  onSendCitation: (citationText: string, dispatchMode: ComposerDispatchMode) => Promise<boolean>;
  /** Sends or saves a citation in another thread; absent where the composer has no thread yet. */
  onSendCitationElsewhere: ComposerCitationDestinations["onSubmit"] | null;
  onResume: () => void;
  onInterrupt: () => void;
  onImplementPlanInNewThread: () => void;
  onRespondToApproval: (
    requestId: RuntimeRequestId,
    decision: ProviderApprovalDecision,
  ) => Promise<unknown>;
  onSelectActivePendingUserInputOption: (questionId: string, optionValue: string) => void;
  onAdvanceActivePendingUserInput: () => void;
  onDismissActivePendingUserInput: (requestId: RuntimeRequestId) => void;
  onPreviousActivePendingUserInputQuestion: () => void;
  onChangeActivePendingUserInputCustomAnswer: (
    questionId: string,
    value: string,
    nextCursor: number,
    expandedCursor: number,
    cursorAdjacentToMention: boolean,
  ) => void;

  onProviderModelSelect: (
    instanceId: ProviderInstanceId,
    model: string,
    options?: { focusComposer?: boolean },
  ) => void;
  onOpenProviderSetup: (instanceId: ProviderInstanceId) => void;
  getModelDisabledReason: (instanceId: ProviderInstanceId, model: string) => string | null;
  /** Set once the thread has started: the pickers can then fork into a new tab. */
  onForkModel?: (instanceId: ProviderInstanceId, model: string) => void;
  modelRequiresFork?: (instanceId: ProviderInstanceId, model: string) => boolean;
  toggleInteractionMode: () => void;
  handleRuntimeModeChange: (mode: RuntimeMode) => void;
  handleInteractionModeChange: (mode: ProviderInteractionMode) => void;

  focusComposer: () => void;
  scheduleComposerFocus: () => void;
  setThreadError: (threadId: ThreadId | null, error: string | null) => void;
  onExpandImage: (preview: ExpandedImagePreview) => void;
  onFileOpen: (attachment: ChatFileAttachment) => void;
  /** Null on a new thread, whose draft is already kept locally. */
  onSaveMessageDraft: (() => Promise<boolean>) | null;
  onCancelQueuedEdit: () => void;
}

type ComposerPathTab = "files" | "chats" | "agents" | "models";
/** Fork: the `@` menu's tabs. Agents shows only when the thread has agents. */
const PATH_MENU_TABS: ReadonlyArray<{ id: ComposerPathTab; label: string }> = [
  { id: "files", label: "Files" },
  { id: "chats", label: "Chats" },
  { id: "agents", label: "Agents" },
  { id: "models", label: "Models" },
];

const NO_PROVIDER_SKILLS: ServerProvider["skills"] = [];
const NO_PROVIDER_SLASH_COMMANDS: ServerProvider["slashCommands"] = [];

export const ChatComposer = memo(function ChatComposer(props: ChatComposerProps) {
  const {
    composerDraftTarget,
    environmentId,
    canOperateThread,
    attachmentUploadsCapabilityKnown,
    supportsAttachmentUploads,
    supportsQuestionAttachments,
    maxFileAttachmentBytes,
    routeKind,
    routeThreadRef,
    draftId,
    multipleModelSelections,
    supportsMultipleModels,
    onMultipleModelSelectionsChange: setMultipleModelSelections,
    activeThreadId,
    activeThreadEnvironmentId: _activeThreadEnvironmentId,
    activeThread,
    promptHistoryMessages,
    threadTabGroup,
    isServerThread,
    isLocalDraftThread: _isLocalDraftThread,
    forceExpandedOnMobile,
    projectSelectionRequired,
    onStartFrom,
    phase,
    canInterrupt,
    isConnecting,
    checkoutKindPending,
    isSendBusy,
    canResume,
    isRevertingCheckpoint = false,
    sendDisabledReason: externalSendDisabledReason,
    isPreparingWorktree,
    createWithoutMessage,
    threadUsage,
    isCompacting,
    environmentUnavailable,
    activePendingApproval: incomingPendingApproval,
    pendingApprovals,
    pendingUserInputs: incomingPendingUserInputs,
    activePendingProgress: incomingPendingProgress,
    activePendingResolvedAnswers,
    activePendingIsResponding: incomingPendingIsResponding,
    activePendingDraftAnswers,
    activePendingQuestionIndex,
    respondingRequestIds,
    showPlanFollowUpPrompt,
    activeProposedPlan,
    runtimeMode,
    interactionMode: requestedInteractionMode,
    lockedProvider,
    providerStatuses,
    providerCatalogKnown,
    activeProjectDefaultModelSelection,
    activeThreadModelSelection,
    reportedModelSelection,
    activeProjectId,
    activeContextWindow,
    compactThreadUnavailable,
    compactDisabled,
    compactDisabledReason,
    resolvedTheme,
    settings,
    keybindings,
    terminalOpen,
    gitCwd,
    githubIssueCwd,
    pullRequestProjectId,
    pullRequestRepository,
    threadPullRequests,
    restingControlsHost,
    restingControlsHaveLeadingContext,
    onRestingControlsVisibilityChange,
    getTimelineScrollableNode,
    isTimelineAtLogicalEnd,
    timelineOverflows,
    onComposerOverlayHeightChange,
    onRestingChange,
    promptRef,
    composerRef,
    composerImagesRef,
    composerFilesRef,
    composerTerminalContextsRef,
    onPageScrollKeyDown,
    onPageScrollKeyUp,
    onPageScrollRelease,
    onCompactContext,
    onSend,
    onSendCitation,
    onSendCitationElsewhere,
    onResume,
    onInterrupt,
    onImplementPlanInNewThread,
    onRespondToApproval,
    onSelectActivePendingUserInputOption,
    onAdvanceActivePendingUserInput,
    onDismissActivePendingUserInput,
    onPreviousActivePendingUserInputQuestion,
    onChangeActivePendingUserInputCustomAnswer,
    onProviderModelSelect,
    onOpenProviderSetup,
    getModelDisabledReason,
    onForkModel,
    modelRequiresFork,
    toggleInteractionMode,
    handleRuntimeModeChange,
    handleInteractionModeChange,
    focusComposer,
    scheduleComposerFocus,
    setThreadError,
    onExpandImage,
    onFileOpen,
    editingQueuedAttachments,
    onRemoveEditingQueuedAttachment,
    onSaveMessageDraft,
    onCancelQueuedEdit,
  } = props;
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const attachCheckouts = useComposerCheckoutItems(environmentId, { enabled: true, query: "" });
  const composerDraftTargetKey = composerTargetKey(composerDraftTarget);
  const {
    heldRequestIds,
    onDraftChange: onTypingGuardDraftChange,
    onFocus: onTypingGuardFocus,
    onBlur: onTypingGuardBlur,
    onSend: onTypingGuardSend,
  } = useComposerTypingGuard(composerDraftTargetKey, [
    ...pendingApprovals.map((request) => request.requestId),
    ...incomingPendingUserInputs.map((request) => request.requestId),
  ]);
  const activePendingApproval =
    incomingPendingApproval && !heldRequestIds.has(incomingPendingApproval.requestId)
      ? incomingPendingApproval
      : null;
  const holdingUserInput = incomingPendingUserInputs[0]
    ? heldRequestIds.has(incomingPendingUserInputs[0].requestId)
    : false;
  const pendingUserInputs = holdingUserInput ? [] : incomingPendingUserInputs;
  const activePendingProgress = holdingUserInput ? null : incomingPendingProgress;
  const activePendingIsResponding = !holdingUserInput && incomingPendingIsResponding;
  const isLiteralPendingAnswer = activePendingProgress?.activeQuestion?.initialAnswer !== undefined;
  const shownSyncPhase = useDelayedStatus(composerDraftTargetKey, props.threadSyncPhase);
  const activeTasksProgress = shownSyncPhase === null ? props.activeTasksProgress : null;
  const activeTaskSteps = shownSyncPhase === null ? props.activeTaskSteps : null;
  const isEditingQueuedMessage = editingQueuedAttachments !== null;
  const composerDraft = useComposerThreadDraft(composerDraftTarget);
  const composerDraftTargetKeyRef = useRef("");
  useLayoutEffect(() => {
    composerDraftTargetKeyRef.current = composerDraftTargetKey;
  });
  const questionAttachmentTarget =
    pendingUserInputs[0] && activePendingProgress?.activeQuestion
      ? questionAttachmentDraftId(
          environmentId,
          activeThreadId!,
          pendingUserInputs[0].requestId,
          activePendingProgress.activeQuestion.id,
        )
      : null;
  const attachmentDraftTarget = questionAttachmentTarget ?? composerDraftTarget;
  const attachmentDraft = useComposerThreadDraft(attachmentDraftTarget);
  const questionTakesSnapShots =
    supportsQuestionAttachments &&
    activePendingProgress?.activeQuestion?.allowCustomAnswer !== false &&
    !activePendingIsResponding;
  const questionRequest = pendingUserInputs[0];
  // Publish eligibility before async captures can observe a question the UI has already closed.
  useLayoutEffect(() => {
    if (!questionAttachmentTarget || !questionRequest || !questionTakesSnapShots) return;
    return trackOpenQuestionAttachmentDraft(routeThreadRef, {
      draftId: questionAttachmentTarget,
      requestKeys: questionRequest.questions.map((question) =>
        questionAttachmentDraftId(
          environmentId,
          activeThreadId!,
          questionRequest.requestId,
          question.id,
        ),
      ),
    });
  }, [
    activeThreadId,
    environmentId,
    questionAttachmentTarget,
    questionRequest,
    questionTakesSnapShots,
    routeThreadRef,
  ]);
  const attachmentTargetKey = composerTargetKey(attachmentDraftTarget);
  // Reject async imports after a draft switch.
  const attachmentTargetKeyRef = useRef(attachmentTargetKey);
  useLayoutEffect(() => {
    attachmentTargetKeyRef.current = attachmentTargetKey;
  });
  const questionPreparations = useQuestionAttachmentPreparation((state) => state.counts);
  const prompt = composerDraft.prompt;
  const composerImages = attachmentDraft.images;
  const composerFiles = attachmentDraft.files;
  const inlineFileIdSet = (() => {
    if (questionAttachmentTarget) return new Set<string>();
    const contextIds = new Set(collectInlineContextIds(prompt));
    return new Set(
      composerFiles
        .filter((file) => contextIds.has(toKindScopedComposerContextId("file", file.id)))
        .map((file) => file.id),
    );
  })();
  const composerVideos = composerFiles.filter((file) =>
    isPreviewableComposerVideo(file, environmentId),
  );
  const composerOtherFiles = composerOtherFilesForPresentation(
    composerFiles,
    environmentId,
    inlineFileIdSet,
  );
  const composerTerminalContexts = composerDraft.terminalContexts;
  const composerPreviewAnnotations = composerDraft.previewAnnotations;
  const composerReviewComments = composerDraft.reviewComments;
  const composerThreadContexts = attachmentDraft.threadContexts;
  const {
    pendingSnapShotAnimations,
    pendingSnapShotIds,
    pendingSnapShotIdSet,
    uncommittedSnapShotIds,
    standaloneComposerImages,
  } = useComposerImageGroups(attachmentDraftTarget, composerImages, composerPreviewAnnotations);
  const preparingComposerImages = usePreparingComposerImages(attachmentTargetKey);
  const nonPersistedComposerImageIds = attachmentDraft.nonPersistedImageIds;
  const uploadsByImageId = useAttachmentUploadStore((state) => state.uploadsByImageId);
  const openPrLink = useOpenPrLink(routeThreadRef);
  const openLink = useLinkClickHandler(routeThreadRef);
  const resolveComposerObjectLink = useResolveComposerObjectLink({
    threadRef: routeThreadRef,
    draftTarget: composerDraftTarget,
  });
  // Filled in once prompt replacement exists; unread chips retry and revert through it.
  const unreadLinkActionsRef = useRef<{
    retry: (record: UnreadLinkContextRecord) => void;
    keepAsText: (record: UnreadLinkContextRecord) => void;
  } | null>(null);
  const [previewFileId, setPreviewFileId] = useState<string | null>(null);
  const previewFile = composerFiles.find((file) => file.id === previewFileId);
  const composerContextActions = {
    environmentId,
    cwd: gitCwd ?? undefined,
    expandImage: (imageId: string) => {
      const preview = buildExpandedImagePreview(composerImages, imageId);
      if (preview) onExpandImage(preview);
    },
    openFile: setPreviewFileId,
    openMention: (path: string) => useRightPanelStore.getState().openFile(routeThreadRef, path),
    expandVideo: (fileId: string) => {
      const file = composerFiles.find((candidate) => candidate.id === fileId);
      if (!file || !isVideoAttachment(file)) return;
      const localPreview = buildExpandedImagePreview([file], file.id);
      if (localPreview) {
        onExpandImage(localPreview);
        return;
      }
      if (file.uploadedAttachmentId === undefined || file.uploadEnvironmentId !== environmentId) {
        return;
      }
      const persistedPreview = buildAttachmentVideoPreview(environmentId, {
        type: "file",
        id: file.uploadedAttachmentId,
        name: file.name,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
      });
      if (persistedPreview) onExpandImage(persistedPreview);
    },
    openPullRequest: (event: React.MouseEvent<HTMLElement>, url: string) => {
      openPrLink(event, url);
    },
    openLink,
    retryUnreadLink: (record: UnreadLinkContextRecord) =>
      unreadLinkActionsRef.current?.retry(record),
    keepUnreadLinkAsText: (record: UnreadLinkContextRecord) =>
      unreadLinkActionsRef.current?.keepAsText(record),
    updateModelChip: (record: ModelContextRecord) =>
      useIssueContextStore.getState().upsert(routeThreadRef.threadId, record),
  };
  const composerThreadTabContexts = useThreadTabContextRecords(routeThreadRef.threadId);
  const composerIssueContexts = useIssueContextRecords(routeThreadRef.threadId);
  const composerRepositoryContexts = useRepositoryContextRecords(routeThreadRef.threadId);
  const composerCheckoutContexts = useCheckoutContextRecords(routeThreadRef.threadId);
  const composerContextRecords = composerContextRecordsFromDraft({
    terminalContexts: composerTerminalContexts,
    reviewComments: composerReviewComments,
    previewAnnotations: composerPreviewAnnotations,
    threadTabs: composerThreadTabContexts,
    issues: composerIssueContexts,
    repositories: composerRepositoryContexts,
    checkouts: composerCheckoutContexts,
    threadContexts: composerThreadContexts,
    images: composerImages,
    files: composerFiles,
    uploadsByImageId,
  });
  const needsReattachFileCount = composerFiles.filter(composerFileNeedsReattach).length;
  const fileStagingLimit = fileAttachmentStagingLimit({
    attachmentUploadsCapabilityKnown,
    supportsAttachmentUploads,
    maxFileAttachmentBytes,
  });
  const fileCapabilityBlockReason = fileAttachmentCapabilityBlockReason({
    files: composerFiles,
    attachmentUploadsCapabilityKnown,
    supportsAttachmentUploads,
    maxFileAttachmentBytes,
  });
  const attachmentUploadPendingReason = supportsAttachmentUploads
    ? attachmentUploadBlockReason({
        imageIds: [...composerImages, ...composerFiles].map((attachment) => attachment.id),
        uploadsByImageId,
        environmentId,
      })
    : null;
  const attachmentBlockReason =
    (questionAttachmentTarget &&
    !supportsQuestionAttachments &&
    (composerImages.length > 0 || composerFiles.length > 0)
      ? "Update this server to send files with question answers"
      : null) ??
    fileCapabilityBlockReason ??
    (supportsAttachmentUploads
      ? needsReattachFileCount > 0
        ? needsReattachFileCount === 1
          ? "Attach the interrupted file again or remove it"
          : "Attach the interrupted files again or remove them"
        : attachmentUploadPendingReason
      : null);
  const setComposerDraftPrompt = useComposerDraftStore((store) => store.setPrompt);
  const addComposerDraftImages = useComposerDraftStore((store) => store.addImages);
  const removeComposerDraftImage = useComposerDraftStore((store) => store.removeImage);
  const addComposerDraftFiles = useComposerDraftStore((store) => store.addFiles);
  const removeComposerDraftFile = useComposerDraftStore((store) => store.removeFile);
  const setComposerDraftFileUpload = useComposerDraftStore((store) => store.setFileUpload);
  const insertComposerDraftTerminalContext = useComposerDraftStore(
    (store) => store.insertTerminalContext,
  );
  const setComposerDraftTerminalContexts = useComposerDraftStore(
    (store) => store.setTerminalContexts,
  );
  const removeComposerDraftPreviewAnnotation = useComposerDraftStore(
    (store) => store.removePreviewAnnotation,
  );
  const removeComposerDraftReviewComment = useComposerDraftStore(
    (store) => store.removeReviewComment,
  );
  const clearComposerDraftPersistedAttachments = useComposerDraftStore(
    (store) => store.clearPersistedAttachments,
  );
  const syncComposerDraftPersistedAttachments = useComposerDraftStore(
    (store) => store.syncPersistedAttachments,
  );
  const getComposerDraft = useComposerDraftStore((store) => store.getComposerDraft);

  useEffect(() => {
    if (!attachmentUploadsCapabilityKnown) {
      return;
    }
    if (!supportsAttachmentUploads) {
      // Reconnect or version skew can hide upload support; retain hydrated uploads.
      for (const attachment of attachmentsToReleaseOnUploadCapabilityLoss([
        ...composerImages,
        ...composerFiles,
      ])) {
        releaseAttachmentUpload(attachment.id);
      }
      return;
    }
    if (!canOperateThread) return;
    const invalidFiles =
      maxFileAttachmentBytes === null
        ? composerFiles
        : composerFiles.filter((file) => file.sizeBytes > maxFileAttachmentBytes);
    for (const attachment of attachmentsToReleaseOnUploadCapabilityLoss(invalidFiles)) {
      releaseAttachmentUpload(attachment.id);
    }
    const uploadableFiles =
      maxFileAttachmentBytes === null
        ? []
        : composerFiles.filter((file) => file.sizeBytes <= maxFileAttachmentBytes);
    const uploadableAttachments = [...composerImages, ...uploadableFiles];
    for (const attachment of uploadableAttachments) {
      if (attachment.type === "file" && composerFileNeedsReattach(attachment)) {
        continue;
      }
      startAttachmentUpload({
        environmentId,
        image: attachment,
        draftTarget: attachmentDraftTarget,
      });
    }
  }, [
    attachmentUploadsCapabilityKnown,
    attachmentDraftTarget,
    canOperateThread,
    composerFiles,
    composerImages,
    environmentId,
    maxFileAttachmentBytes,
    supportsAttachmentUploads,
  ]);

  useEffect(() => {
    for (const file of composerFiles) {
      if (
        !attachmentUploadsCapabilityKnown ||
        !supportsAttachmentUploads ||
        maxFileAttachmentBytes === null ||
        file.sizeBytes > maxFileAttachmentBytes
      ) {
        continue;
      }
      const upload = uploadsByImageId[file.id];
      if (upload?.status === "ready" && upload.environmentId === environmentId) {
        setComposerDraftFileUpload(
          attachmentDraftTarget,
          file.id,
          environmentId,
          upload.attachmentId,
        );
      }
    }
  }, [
    attachmentUploadsCapabilityKnown,
    attachmentDraftTarget,
    composerFiles,
    environmentId,
    maxFileAttachmentBytes,
    setComposerDraftFileUpload,
    supportsAttachmentUploads,
    uploadsByImageId,
  ]);

  const {
    providerInstanceEntries,
    selectedProviderEntry,
    lockedContinuationGroupKey,
    unavailableProviderInstanceId,
    selectedInstanceId,
    selectedProvider,
    selectedProviderModels,
    composerModelOptions,
    selectedModel,
    composerProviderState,
  } = useComposerProviderModel({
    providerStatuses,
    settings,
    activeProjectId,
    threadRef: composerDraftTarget,
    threadModelSelection: activeThreadModelSelection,
    projectModelSelection: activeProjectDefaultModelSelection,
    promptInjectionState: getComposerPromptInjectionState(prompt),
    candidateInstanceIds: [
      composerDraft.activeProvider ?? null,
      activeThread?.runtime?.providerInstanceId,
      activeThreadModelSelection?.instanceId,
      activeProjectDefaultModelSelection?.instanceId,
    ],
    lockedProvider,
    lockedInstanceId:
      activeThread?.runtime?.providerInstanceId ?? activeThreadModelSelection?.instanceId,
  });
  const noProviderAvailable =
    selectedProviderEntry === undefined && multipleModelSelections === null;
  const providerCatalogPending = noProviderAvailable && !providerCatalogKnown;
  const showProviderUnavailable = noProviderAvailable && !providerCatalogPending;
  const providerSetupInstanceId = noProviderAvailable
    ? (unavailableProviderInstanceId ??
      (lockedProvider === null
        ? providerInstanceEntries.find((entry) => hasProviderSetup(entry.snapshot))?.instanceId
        : undefined))
    : undefined;
  const resolvedCompactDisabledReason =
    compactDisabledReason ?? (noProviderAvailable ? "Compacting is unavailable right now" : null);
  const supportedRuntimeModes = selectedProviderEntry?.snapshot.supportedRuntimeModes;
  const compatibleRuntimeModeOptions =
    supportedRuntimeModes && supportedRuntimeModes.length > 0
      ? runtimeModeOptions.filter((option) => supportedRuntimeModes.includes(option.mode))
      : runtimeModeOptions;
  const compatibleRuntimeMode = compatibleRuntimeModeOptions.some(
    (option) => option.mode === runtimeMode,
  )
    ? runtimeMode
    : (compatibleRuntimeModeOptions[0]?.mode ?? runtimeMode);

  const providerSendBlockReason = getAntigravitySendBlockReason(
    selectedProviderEntry?.snapshot,
    selectedModel,
  );
  const sendDisabledReason =
    externalSendDisabledReason ??
    (multipleModelSelections?.length === 0 ? "Select at least one model." : null) ??
    (activePendingProgress
      ? attachmentBlockReason
      : (attachmentBlockReason ??
        (multipleModelSelections === null ? providerSendBlockReason : null)));
  const isSendDisabled = sendDisabledReason !== null;
  const selectedProviderStatus = selectedProviderEntry?.snapshot ?? null;
  const compactCommandAvailable = providerSupportsManualCompaction(selectedProviderEntry);
  const selectedProviderSkills = selectedProviderStatus
    ? resolveProviderSkillsForCwd(selectedProviderStatus, gitCwd)
    : NO_PROVIDER_SKILLS;
  const selectedProviderSlashCommands = selectedProviderStatus
    ? resolveProviderSlashCommandsForCwd(selectedProviderStatus, gitCwd)
    : NO_PROVIDER_SLASH_COMMANDS;
  const refreshWorkspaceSnapshotOnTyping = useProviderWorkspaceSnapshotRefresh({
    environmentId,
    gitCwd,
    selectedProviderEntry,
    selectedProviderStatus: selectedProviderStatus,
  });

  const selectedPromptEffort = composerProviderState.promptEffort;
  const selectedModelOptionsForDispatch = composerProviderState.modelOptionsForDispatch;
  const { enabled: planModeUiEnabled, interactionMode } = resolveComposerInteractionMode({
    planModeEnabled: settings.planModeEnabled,
    provider: selectedProviderStatus,
    interactionMode: requestedInteractionMode,
  });
  const selectedModelSelection: ModelSelection = createModelSelection(
    selectedInstanceId,
    selectedModel,
    selectedModelOptionsForDispatch,
  );
  const selectedModelForPicker = selectedModel;
  const modelOptionsByInstance = new Map<ProviderInstanceId, ReadonlyArray<AppModelOption>>();
  for (const entry of providerInstanceEntries) {
    modelOptionsByInstance.set(
      entry.instanceId,
      getAppModelOptionsForInstance(
        settings,
        entry,
        entry.instanceId === selectedInstanceId ? selectedModelForPicker : null,
      ),
    );
  }

  const selectedModelForPickerWithCustomFallback = (() => {
    const currentOptions = modelOptionsByInstance.get(selectedInstanceId) ?? [];
    return currentOptions.some((option) => option.slug === selectedModelForPicker)
      ? selectedModelForPicker
      : (normalizeModelSlug(selectedModelForPicker, selectedProvider) ?? selectedModelForPicker);
  })();

  const activeThreadModelDisplayName = resolveContextWindowModelDisplayName(
    activeThreadModelSelection,
    modelOptionsByInstance,
  );
  const reserveContextWindowMeter = shouldReserveContextWindowMeter({
    meterEnabled: settings.contextWindowMeterEnabled,
    detailLoading: props.threadSyncPhase === "loading",
    threadStarted: threadShellHasStarted(props.activeThreadShell),
    providerReportsContextWindow: selectedProviderStatus
      ? selectedProviderStatus.reportsContextWindow === true
      : null,
  });

  const [composerCursor, setComposerCursor] = useState(() => {
    const value = isLiteralPendingAnswer ? (activePendingProgress?.customAnswer ?? prompt) : prompt;
    return collapseExpandedComposerCursor(value, value.length, isLiteralPendingAnswer);
  });
  const {
    trigger: composerTrigger,
    setTrigger: setComposerTrigger,
    resolveTrigger: resolveComposerTrigger,
    dismissTrigger: dismissComposerTrigger,
    resetTrigger: resetComposerTrigger,
  } = useComposerTriggerState(() =>
    isLiteralPendingAnswer ? null : detectComposerTrigger(prompt, prompt.length),
  );
  const [composerHighlightedItemId, setComposerHighlightedItemId] = useState<string | null>(null);
  const composerSuggestionId = useId();
  const composerSuggestionListId = `${composerSuggestionId}-${encodeURIComponent(draftId ?? activeThreadId ?? "new")}-suggestions`;
  const promptHistoryPositionRef = useRef<{
    targetKey: string;
    position: ComposerPromptHistoryPosition;
  } | null>(null);
  const [composerHighlightedSearchKey, setComposerHighlightedSearchKey] = useState<string | null>(
    null,
  );
  const [isDragOverComposer, setIsDragOverComposer] = useState(false);
  const [isComposerFooterCompact, setIsComposerFooterCompact] = useState(false);
  const [isComposerPrimaryActionsCompact, setIsComposerPrimaryActionsCompact] = useState(false);
  const [isComposerModelPickerOpen, setIsComposerModelPickerOpen] = useState(false);
  const isMobileViewport = useMediaQuery("max-sm");
  const isSoftwareKeyboardOpen = useSoftwareKeyboardOpen();
  const {
    isComposerFocused,
    setIsComposerFocused,
    isComposerScrollCollapsed,
    setIsComposerScrollCollapsed,
    restoreAfterTimelineReachedEnd,
  } = useComposerFocusState();
  const [composerSubmissionError, setComposerSubmissionError] = useState<string | null>(null);
  const [providerInputSubmissionError, setProviderInputSubmissionError] = useState<string | null>(
    null,
  );
  const [composerMenuAnchor, setComposerMenuAnchor] = useState<HTMLDivElement | null>(null);
  const [hasWrappedPrompt, observeWrappedPrompt] = useComposerMultilinePrompt();
  const hasMultilinePrompt = prompt.includes("\n") || hasWrappedPrompt;
  const [isTasksDrawerOpen, setIsTasksDrawerOpen] = useState(false);
  // A pending question stays expanded: its card moves into the banner dock,
  // so collapsing would leave the surface empty and squashed beneath it.
  const isComposerCollapsedMobile =
    isMobileViewport &&
    !forceExpandedOnMobile &&
    !isComposerFocused &&
    !hasMultilinePrompt &&
    pendingUserInputs.length === 0;

  const composerEditorRef = useRef<ComposerPromptEditorHandle>(null);
  const pasteAsTextShortcutUntilRef = useRef(0);
  const composerFormRef = useRef<HTMLFormElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const composerSurfaceRef = useRef<HTMLDivElement>(null);
  const providerInputRejectedRef = useRef(false);
  const composerSelectLockRef = useRef(false);
  const composerMenuOpenRef = useRef(false);
  const composerMenuItemsRef = useRef<ComposerCommandItem[]>([]);
  const activeComposerMenuItemRef = useRef<ComposerCommandItem | null>(null);
  const composerBlurFrameRef = useRef<number | null>(null);
  const mobileComposerExpandFrameRef = useRef<number | null>(null);
  const mobileComposerExpandReleaseFrameRef = useRef<number | null>(null);
  const mobileComposerExpandInFlightRef = useRef(false);
  const composerScrollCollapseTimeoutRef = useRef<number | null>(null);
  const composerScrollCollapseEligibleRef = useRef(false);
  const windowRefocusInFlightRef = useRef(false);
  const composerScrollGestureRef = useRef(createComposerScrollGestureState());
  const pendingThreadImportsRef = useRef<Map<string, number>>(new Map());
  const unfocusedSplitPane = useSplitPaneFocus() === "unfocused";
  const isRevertingCheckpointRef = useRef(isRevertingCheckpoint);
  useLayoutEffect(() => {
    isRevertingCheckpointRef.current = isRevertingCheckpoint;
  });

  useEffect(() => {
    const armPasteAsTextShortcut = () => {
      // Electron's menu action can precede paste; browsers deliver keydown first.
      pasteAsTextShortcutUntilRef.current = Date.now() + 1_000;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.target instanceof Node &&
        composerFormRef.current?.contains(event.target) &&
        isPasteAsTextShortcut(event, isMacPlatform(navigator.platform))
      ) {
        armPasteAsTextShortcut();
      }
    };
    const onBlur = () => {
      pasteAsTextShortcutUntilRef.current = 0;
    };
    const onDesktopPasteAsText = () => {
      const activeElement = document.activeElement;
      const blocksPasteToFocus =
        activeElement instanceof Element &&
        activeElement.closest(
          'input, textarea, select, button, a[href], summary, [contenteditable="true"], [contenteditable="plaintext-only"], [role="textbox"], [role="button"], [role="menuitem"], [role="option"]',
        ) !== null;
      if (
        (activeElement instanceof Node && composerFormRef.current?.contains(activeElement)) ||
        !blocksPasteToFocus
      ) {
        armPasteAsTextShortcut();
      }
    };
    window.addEventListener(DESKTOP_PASTE_AS_TEXT_EVENT, onDesktopPasteAsText);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener(DESKTOP_PASTE_AS_TEXT_EVENT, onDesktopPasteAsText);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  const composerSendState = deriveComposerSendState({
    prompt,
    imageCount: composerImages.length + composerFiles.length,
    terminalContexts: composerTerminalContexts,
    elementContextCount: composerPreviewAnnotations.length + composerReviewComments.length,
  });
  const composerTriggerKind = composerTrigger?.kind ?? null;
  const compactSlashCommandAvailable =
    composerTrigger?.kind === "slash-command" &&
    prompt.slice(0, composerTrigger.rangeStart).trim() === "" &&
    !compactThreadUnavailable &&
    prompt.slice(composerTrigger.rangeEnd).trim() === "" &&
    composerImages.length + composerFiles.length === 0 &&
    composerDraft.persistedAttachments.length === 0 &&
    composerTerminalContexts.length === 0 &&
    composerPreviewAnnotations.length === 0 &&
    composerReviewComments.length === 0;
  const referenceRemoteUrls = (() => {
    if (composerTrigger?.kind !== "pull-request") return [];
    const referencedIds = new Set(
      collectComposerContextReferences(prompt)
        .filter((reference) => reference.kind === "repository")
        .map((reference) => reference.contextId),
    );
    return [
      ...promptHistoryMessages.flatMap((message) =>
        (message.context?.records ?? []).flatMap((record) =>
          record.kind === "repository" && "remoteUrl" in record ? [record.remoteUrl] : [],
        ),
      ),
      ...composerRepositoryContexts
        .filter((record) => referencedIds.has(record.contextId))
        .map((record) => record.remoteUrl),
    ];
  })();
  const referenceMenu = useComposerReferenceMenu({
    environmentId,
    trigger: composerTrigger,
    projectId: pullRequestProjectId,
    repository: pullRequestRepository,
    remoteUrls: referenceRemoteUrls,
    threadPullRequests: threadPullRequests ?? [],
    githubIssueCwd,
  });
  // Items picked with cmd/ctrl+click, across tabs, held until this `#` token closes.
  const [referenceSelection, setReferenceSelection] = useState<{
    rangeStart: number;
    items: ReadonlyArray<ReferenceMenuItem>;
  } | null>(null);
  const selectedReferenceItems =
    composerTrigger?.kind === "pull-request" &&
    referenceSelection?.rangeStart === composerTrigger.rangeStart
      ? referenceSelection.items
      : [];
  const selectedReferenceItemsRef = useRef(selectedReferenceItems);
  useLayoutEffect(() => {
    selectedReferenceItemsRef.current = selectedReferenceItems;
  });
  const selectedReferenceItemIds = new Set(selectedReferenceItems.map((item) => item.id));
  const attachCheckout = useAttachCheckout(selectedProvider);
  const attachLinearIssue = useAttachLinearIssue();
  const attachNotionPage = useAttachNotionPage();
  const attachGoogleFile = useAttachGoogleFile();
  const attachGranolaNote = useAttachGranolaNote();
  const attachSlackMessage = useAttachSlackMessage();
  const attachDiscordMessage = useAttachDiscordMessage();
  const attachGitHubIssue = useAttachGitHubIssue();
  const captureThreadTabContext = useCaptureThreadTabContext(environmentId, activeThreadId);
  const {
    items: composerMenuItemsFromTrigger,
    isLoading: isTriggerMenuLoading,
    emptyState: triggerMenuEmptyState,
  } = useComposerMenuItems({
    // Fork: `#` is served by the reference menu, which also searches pull requests.
    composerTrigger: referenceMenu.open ? null : composerTrigger,
    environmentId,
    gitCwd,
    activeThreadId,
    pullRequestProjectId,
    pullRequestRepository,
    threadPullRequests,
    planModeUiEnabled,
    compactSlashCommandAvailable,
    selectedProvider,
    selectedProviderSkills,
    selectedProviderSlashCommands,
    showSkillsInSlashMenu: settings.showSkillsInSlashMenu,
  });
  const composerMenuEmptyState = referenceMenu.open
    ? referenceMenu.emptyState
    : triggerMenuEmptyState;
  const isPathTrigger = composerTrigger?.kind === "path";
  const pathTriggerQuery = isPathTrigger ? composerTrigger.query : "";
  // Fork: the `@` menu splits files from chats. Files lists workspace paths only; Chats lists
  // this thread's other chat tabs, then other threads by recency.
  const fileMenuItems = isPathTrigger
    ? composerMenuItemsFromTrigger.filter((item) => item.type === "path")
    : [];
  const chatMenuItems = ((): ComposerCommandItem[] => {
    if (!isPathTrigger) return [];
    const tabQuery = pathTriggerQuery.trim().toLowerCase();
    const tabs = threadTabGroup?.tabs ?? [];
    const tabThreadIds = new Set(tabs.map((tab) => tab.threadId));
    return [
      ...tabs
        .filter(
          (tab) => tab.threadId !== activeThreadId && tab.title.toLowerCase().includes(tabQuery),
        )
        .map((tab) => ({
          id: `thread-tab:${tab.threadId}`,
          type: "thread-tab" as const,
          threadId: tab.threadId,
          label: tab.title,
          description: "Chat tab",
        })),
      ...composerMenuItemsFromTrigger.filter(
        (item) => item.type === "thread" && !tabThreadIds.has(item.thread.threadId),
      ),
    ];
  })();
  // A draft has no agents, and its thread does not exist on the server yet.
  const agentMenu = useComposerAgentItems(
    routeThreadRef,
    isPathTrigger && isServerThread,
    pathTriggerQuery,
    gitCwd,
  );
  const { favorites: favoriteModels } = useEnvironmentModelPreferences(environmentId);
  const [modelFilterChoice, setModelFilterChoice] = useState<{
    rangeStart: number;
    instanceId: ProviderInstanceId | null;
  } | null>(null);
  const modelInstanceFilter =
    isPathTrigger && modelFilterChoice?.rangeStart === composerTrigger.rangeStart
      ? modelFilterChoice.instanceId
      : null;
  const modelMenu = deriveComposerModelItems({
    enabled: isPathTrigger,
    query: pathTriggerQuery,
    entries: providerInstanceEntries,
    modelOptionsByInstance,
    favoriteKeys: new Set(
      favoriteModels.map((favorite) => providerModelKey(favorite.provider, favorite.model)),
    ),
    instanceFilter: modelInstanceFilter,
  });
  // A tab picked by hand holds until this `@` token closes; otherwise the query picks it:
  // Agents for a handle, Models for a model name, Chats when only chats match, else Files.
  const [pathTabChoice, setPathTabChoice] = useState<{
    rangeStart: number;
    tab: ComposerPathTab;
  } | null>(null);
  const [isModelChipPickerOpen, setIsModelChipPickerOpen] = useState(false);
  const [attachMenuAnchor, setAttachMenuAnchor] = useState<HTMLSpanElement | null>(null);
  const pathTab: ComposerPathTab =
    isPathTrigger &&
    pathTabChoice?.rangeStart === composerTrigger.rangeStart &&
    (pathTabChoice.tab !== "agents" || agentMenu.available)
      ? pathTabChoice.tab
      : agentMenu.prefersAgents
        ? "agents"
        : modelMenu.prefersModels
          ? "models"
          : pathTriggerQuery.trim().length > 0 &&
              chatMenuItems.length > 0 &&
              !isTriggerMenuLoading &&
              fileMenuItems.length === 0
            ? "chats"
            : "files";
  const isComposerMenuLoading = referenceMenu.open
    ? referenceMenu.isLoading
    : isTriggerMenuLoading && (!isPathTrigger || pathTab === "files");
  const composerMenuItems = referenceMenu.open
    ? [...referenceMenu.items]
    : !isPathTrigger
      ? composerMenuItemsFromTrigger
      : pathTab === "models"
        ? [...modelMenu.items]
        : pathTab === "agents"
          ? [...agentMenu.items]
          : pathTab === "chats"
            ? chatMenuItems
            : fileMenuItems;

  const composerMenuOpen = Boolean(composerTrigger);
  const composerMenuSearchKey = composerTrigger
    ? `${composerSuggestionListId}:${composerTrigger.kind}:${composerTrigger.query.trim().toLowerCase()}`
    : null;
  const activeComposerMenuItemId = resolveComposerMenuActiveItemId({
    items: composerMenuItems,
    highlightedItemId: composerHighlightedItemId,
    currentSearchKey: composerMenuSearchKey,
    highlightedSearchKey: composerHighlightedSearchKey,
  });
  const activeComposerMenuItem =
    composerMenuItems.find((item) => item.id === activeComposerMenuItemId) ?? null;

  useLayoutEffect(() => {
    composerMenuOpenRef.current = composerMenuOpen;
    composerMenuItemsRef.current = composerMenuItems;
    activeComposerMenuItemRef.current = activeComposerMenuItem;
  });

  const nonPersistedComposerImageIdSet = new Set(nonPersistedComposerImageIds);

  const isComposerApprovalState = activePendingApproval !== null;
  // A send declines the approvals shown here to redirect the agent, so it steers the waiting
  // turn instead of queueing behind it. Approvals the typing guard holds stay unseen and pending.
  const followUpBehavior = pendingApprovals.some(
    (approval) => !heldRequestIds.has(approval.requestId),
  )
    ? "steer"
    : settings.followUpBehavior;
  const composerSuggestionsVisible = composerMenuOpen;
  const composerSuggestionListVisible = composerSuggestionsVisible && composerMenuItems.length > 0;
  const activePendingUserInput = pendingUserInputs[0] ?? null;
  const isChoiceOnlyPendingQuestion =
    activePendingProgress?.activeQuestion?.allowCustomAnswer === false;
  const showComposerTopDrawer =
    isComposerApprovalState ||
    pendingUserInputs.length > 0 ||
    (!isComposerCollapsedMobile && showPlanFollowUpPrompt && activeProposedPlan !== null);
  const showCollapsedMobilePromptRow = isComposerCollapsedMobile;
  const showComposerAttachAction =
    fileStagingLimit !== null &&
    (!activePendingProgress ||
      (supportsQuestionAttachments &&
        activePendingProgress.activeQuestion?.allowCustomAnswer !== false));
  const composerFooterHasWideActions = showPlanFollowUpPrompt || activePendingProgress !== null;

  const editPromptFromTraits = (edit: (prompt: string) => string) => {
    const currentPrompt = getComposerDraft(composerDraftTarget)?.prompt ?? "";
    const nextPrompt = edit(currentPrompt);
    if (nextPrompt === currentPrompt) return;
    if (nextPrompt === promptRef.current) {
      scheduleComposerFocus();
      return;
    }
    promptRef.current = nextPrompt;
    setComposerDraftPrompt(composerDraftTarget, nextPrompt);
    const nextCursor = collapseExpandedComposerCursor(nextPrompt, nextPrompt.length);
    setComposerCursor(nextCursor);
    setComposerTrigger(detectComposerTrigger(nextPrompt, nextPrompt.length));
    scheduleComposerFocus();
  };
  const editPromptFromTraitsStable = useStableCallback(editPromptFromTraits);
  const promptUltrathink = readPromptUltrathink(prompt);

  const [inlineRestingControlsHost, setInlineRestingControlsHost] = useState<HTMLDivElement | null>(
    null,
  );
  const {
    controlsRef: restingComposerControlsRef,
    attachControls: attachRestingComposerControls,
    hiddenBlockCount: restingControlsHiddenBlockCount,
    iconOnlyBlockCount: restingControlsIconOnlyBlockCount,
    controlsVisible: restingControlsVisible,
  } = useRestingComposerControlsLayout(restingControlsHost ?? inlineRestingControlsHost);
  const {
    attachControls: attachExpandedComposerControls,
    hiddenBlockCount: expandedControlsHiddenBlockCount,
    iconOnlyBlockCount: expandedControlsIconOnlyBlockCount,
  } = useRestingComposerControlsLayout(null, true);
  const pendingPrimaryAction = activePendingProgress
    ? {
        questionIndex: activePendingProgress.questionIndex,
        isLastQuestion: activePendingProgress.isLastQuestion,
        canAdvance:
          activePendingProgress.canAdvance &&
          !attachmentBlockReason &&
          !(questionPreparations[attachmentTargetKey] ?? 0),
        isResponding: activePendingIsResponding,
        isComplete: Boolean(activePendingResolvedAnswers),
      }
    : null;
  const showResumeAction =
    canResume && !composerDraftHasUserContent(composerDraft) && !isEditingQueuedMessage;
  const collapsedComposerPrimaryActionDisabled =
    phase === "running" ||
    isSendBusy ||
    isSendDisabled ||
    isConnecting ||
    noProviderAvailable ||
    projectSelectionRequired ||
    environmentUnavailable !== null ||
    (!composerSendState.hasSendableContent && !showResumeAction);
  const collapsedComposerPrimaryActionLabel = showResumeAction
    ? "Resume thread"
    : props.resumeCompactionTokens !== null && !props.keepFullHistory
      ? "Open composer to compact and send"
      : "Send message";
  const showMobilePendingAnswerActions =
    isMobileViewport && !isComposerCollapsedMobile && pendingPrimaryAction !== null;

  const setPrompt = (nextPrompt: string) => {
    setComposerDraftPrompt(composerDraftTarget, nextPrompt);
  };

  const addComposerImage = (image: ComposerImageAttachment) =>
    addComposerDraftImages(attachmentDraftTarget, [image]);

  const addComposerImagesToDraft = (images: ComposerImageAttachment[]) =>
    addComposerDraftImages(attachmentDraftTarget, images);

  const addComposerFilesToDraft = (files: ComposerFileAttachment[]) =>
    addComposerDraftFiles(attachmentDraftTarget, files, {
      appendReference: questionAttachmentTarget === null,
    });

  const removeComposerImageFromDraft = (imageId: string) => {
    if (questionAttachmentTarget && activePendingIsResponding) return;
    releaseAttachmentUpload(imageId);
    removeComposerDraftImage(attachmentDraftTarget, imageId);
  };

  const removeComposerFileFromDraft = (fileId: string) => {
    if (questionAttachmentTarget && activePendingIsResponding) return;
    // Hydrated uploads use persisted attachment ids, not queue keys.
    const file = composerFilesRef.current.find((candidate) => candidate.id === fileId);
    if (file) {
      releaseDraftAttachment(file);
    } else {
      releaseAttachmentUpload(fileId);
    }
    removeComposerDraftFile(attachmentDraftTarget, fileId);
  };

  const addComposerDraftReviewComment = useComposerDraftStore((store) => store.addReviewComment);
  const addComposerDraftPreviewAnnotation = useComposerDraftStore(
    (store) => store.addPreviewAnnotation,
  );
  const addComposerDraftThreadContexts = useComposerDraftStore((store) => store.addThreadContexts);
  const setComposerDraftThreadContexts = useComposerDraftStore((store) => store.setThreadContexts);
  const buildContextClipboardFragment = (contextIds: ReadonlyArray<string>): string | null => {
    const wanted = new Set(contextIds);
    const copiedFiles = new Map<string, File>();
    for (const annotation of composerPreviewAnnotations) {
      if (
        wanted.has(previewAnnotationContextId(annotation.id)) &&
        composerImages.some((image) => image.id === annotation.id)
      ) {
        wanted.add(toKindScopedComposerContextId("image", annotation.id));
      }
    }
    const records: ComposerContextRecord[] = [
      ...composerTerminalContexts
        .filter((c) => wanted.has(terminalContextReference(c).contextId))
        .map(terminalContextRecord),
      ...composerThreadContexts.filter((record) => wanted.has(record.contextId)),
      ...composerReviewComments
        .filter((c) => wanted.has(reviewCommentContextId(c.id)))
        .map(reviewCommentContextRecord),
      ...composerPreviewAnnotations
        .filter((a) => wanted.has(previewAnnotationContextId(a.id)))
        .map((annotation) =>
          previewAnnotationContextRecord(annotation, {
            screenshotContextId: composerImages.some((image) => image.id === annotation.id)
              ? annotation.id
              : undefined,
          }),
        ),
      ...[...composerImages, ...composerFiles]
        .filter((attachment) =>
          wanted.has(toKindScopedComposerContextId(attachment.type, attachment.id)),
        )
        .flatMap((attachment) => {
          const record =
            uploadedAttachmentContextRecord(attachment, uploadsByImageId[attachment.id]) ??
            (attachment.file
              ? attachmentContextRecord({ attachment, attachmentId: attachment.id })
              : null);
          if (!record) return [];
          if (attachment.file) copiedFiles.set(record.attachmentId, attachment.file);
          return [record];
        }),
    ];
    if (records.length === 0) return null;
    const fragment = encodeComposerContextFragment({
      version: 1,
      source: { environmentId, ...(activeThread ? { threadId: activeThread.id } : {}) },
      records,
    });
    if (fragment) rememberCopiedComposerAttachments(environmentId, copiedFiles);
    return fragment;
  };
  const buildContextClipboardFragmentStable = useStableCallback(buildContextClipboardFragment);
  const {
    loadThreadTranscript,
    countReservedAttachments,
    countReservedAttachmentsStable,
    importContextRecords,
    importContextFragment,
    importContextFragmentStable,
  } = useComposerContextImport({
    routeThreadRef,
    environmentId,
    activeThread,
    activeThreadId,
    composerDraftTarget,
    attachmentDraftTarget,
    attachmentTargetKey,
    attachmentTargetKeyRef,
    questionAttachmentTarget,
    pendingUserInputs,
    composerContextRecords,
    composerImages,
    composerFilesRef,
    pendingThreadImportsRef,
    addComposerFilesToDraft,
  });

  useEffect(() => {
    if (isLiteralPendingAnswer) return;
    promptRef.current = prompt;
  }, [isLiteralPendingAnswer, prompt, promptRef]);
  const [cursorClampedFor, setCursorClampedFor] = useState({ prompt, isLiteralPendingAnswer });
  if (
    cursorClampedFor.prompt !== prompt ||
    cursorClampedFor.isLiteralPendingAnswer !== isLiteralPendingAnswer
  ) {
    setCursorClampedFor({ prompt, isLiteralPendingAnswer });
    if (!isLiteralPendingAnswer) {
      setComposerCursor((existing) => clampCollapsedComposerCursor(prompt, existing));
    }
  }

  if (composerSubmissionError !== null) {
    const nextError = getComposerPromptLengthValidationMessage(prompt);
    if (nextError !== composerSubmissionError) {
      setComposerSubmissionError(nextError);
    }
  }

  const providerInputInputs = [
    composerPreviewAnnotations,
    composerReviewComments,
    composerTerminalContexts,
    prompt,
    selectedModel,
    selectedPromptEffort,
    selectedProvider,
  ] as const;
  const [providerInputValidatedFor, setProviderInputValidatedFor] = useState(providerInputInputs);
  if (providerInputInputs.some((value, index) => value !== providerInputValidatedFor[index])) {
    setProviderInputValidatedFor(providerInputInputs);
    setProviderInputSubmissionError(null);
  }

  useEffect(() => {
    composerImagesRef.current = composerImages;
  }, [composerImages, composerImagesRef]);

  useEffect(() => {
    composerFilesRef.current = composerFiles;
  }, [composerFiles, composerFilesRef]);

  useEffect(() => {
    composerTerminalContextsRef.current = composerTerminalContexts;
  }, [composerTerminalContexts, composerTerminalContextsRef]);

  const resolvedHighlightedItemId = composerMenuOpen ? activeComposerMenuItemId : null;
  const resolvedHighlightedSearchKey = composerMenuOpen ? composerMenuSearchKey : null;
  if (composerHighlightedItemId !== resolvedHighlightedItemId) {
    setComposerHighlightedItemId(resolvedHighlightedItemId);
  }
  if (composerHighlightedSearchKey !== resolvedHighlightedSearchKey) {
    setComposerHighlightedSearchKey(resolvedHighlightedSearchKey);
  }

  const lastSyncedPendingInputRef = useRef<{
    requestId: string | null;
    questionId: string | null;
  } | null>(null);

  useEffect(() => {
    const nextCustomAnswer = activePendingProgress?.customAnswer;
    if (typeof nextCustomAnswer !== "string") {
      if (lastSyncedPendingInputRef.current !== null) {
        promptRef.current = prompt;
        const { cursor, trigger } = composerStateAtPromptEnd(prompt);
        setComposerCursor(cursor);
        resetComposerTrigger(trigger);
      }
      lastSyncedPendingInputRef.current = null;
      return;
    }

    const nextRequestId = activePendingUserInput?.requestId ?? null;
    const nextQuestionId = activePendingProgress?.activeQuestion?.id ?? null;
    const questionChanged =
      lastSyncedPendingInputRef.current?.requestId !== nextRequestId ||
      lastSyncedPendingInputRef.current?.questionId !== nextQuestionId;
    const textChangedExternally = promptRef.current !== nextCustomAnswer;

    lastSyncedPendingInputRef.current = {
      requestId: nextRequestId,
      questionId: nextQuestionId,
    };

    if (!questionChanged && !textChangedExternally) {
      return;
    }

    promptRef.current = nextCustomAnswer;
    const { cursor, trigger } = composerStateAtPromptEnd(nextCustomAnswer, isLiteralPendingAnswer);
    setComposerCursor(cursor);
    resetComposerTrigger(trigger);
    setComposerHighlightedItemId(null);
  }, [
    activePendingProgress?.customAnswer,
    activePendingProgress?.activeQuestion?.id,
    isLiteralPendingAnswer,
    activePendingUserInput?.requestId,
    prompt,
    promptRef,
    resetComposerTrigger,
  ]);

  const composerSessionKey = `${draftId ?? ""}:${activeThreadId ?? ""}:${isLiteralPendingAnswer}`;
  const [shownComposerSessionKey, setShownComposerSessionKey] = useState(composerSessionKey);
  if (shownComposerSessionKey !== composerSessionKey) {
    setShownComposerSessionKey(composerSessionKey);
    setComposerHighlightedItemId(null);
    setComposerHighlightedSearchKey(null);
    setComposerSubmissionError(null);
    setProviderInputSubmissionError(null);
    const pendingAnswer = activePendingProgress?.customAnswer;
    const { cursor, trigger } = composerStateAtPromptEnd(
      typeof pendingAnswer === "string" ? pendingAnswer : prompt,
      isLiteralPendingAnswer,
    );
    setComposerCursor(cursor);
    resetComposerTrigger(trigger);
    setIsDragOverComposer(false);
    setIsComposerScrollCollapsed(false);
  }

  useLayoutEffect(() => {
    const composerForm = composerFormRef.current;
    if (!composerForm) return;
    const measureComposerFormWidth = () => composerForm.clientWidth;
    const measureFooterCompactness = () => {
      const composerFormWidth = measureComposerFormWidth();
      const footerCompact = shouldUseCompactComposerFooter(composerFormWidth, {
        hasWideActions: composerFooterHasWideActions,
      });
      const primaryActionsCompact =
        footerCompact &&
        shouldUseCompactComposerPrimaryActions(composerFormWidth, {
          hasWideActions: composerFooterHasWideActions,
        });
      return {
        primaryActionsCompact,
        footerCompact,
      };
    };

    const initialCompactness = measureFooterCompactness();
    setIsComposerPrimaryActionsCompact(initialCompactness.primaryActionsCompact);
    setIsComposerFooterCompact(initialCompactness.footerCompact);
    return observeResize(composerForm, () => {
      const nextCompactness = measureFooterCompactness();
      setIsComposerPrimaryActionsCompact((previous) =>
        previous === nextCompactness.primaryActionsCompact
          ? previous
          : nextCompactness.primaryActionsCompact,
      );
      setIsComposerFooterCompact((previous) =>
        previous === nextCompactness.footerCompact ? previous : nextCompactness.footerCompact,
      );
    });
  }, [composerFooterHasWideActions]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (composerImages.length === 0) {
        clearComposerDraftPersistedAttachments(attachmentDraftTarget);
        return;
      }
      const getPersistedAttachmentsForThread = () =>
        getComposerDraft(attachmentDraftTarget)?.persistedAttachments ?? [];
      try {
        const currentPersistedAttachments = getPersistedAttachmentsForThread();
        const existingPersistedById = new Map(
          currentPersistedAttachments.map((attachment) => [attachment.id, attachment]),
        );
        const stagedAttachmentById = new Map<string, PersistedComposerImageAttachment>();
        await Promise.all(
          composerImages.map(async (image) => {
            try {
              const dataUrl = await readFileAsDataUrl(image.file);
              stagedAttachmentById.set(image.id, {
                id: image.id,
                name: image.name,
                mimeType: image.mimeType,
                sizeBytes: image.sizeBytes,
                dataUrl,
                ...(image.source ? { source: image.source } : {}),
              });
            } catch {
              const existingPersisted = existingPersistedById.get(image.id);
              if (existingPersisted) {
                stagedAttachmentById.set(image.id, existingPersisted);
              }
            }
          }),
        );
        const serialized = Array.from(stagedAttachmentById.values());
        if (cancelled) return;
        syncComposerDraftPersistedAttachments(attachmentDraftTarget, serialized);
      } catch {
        const currentImageIds = new Set(composerImages.map((image) => image.id));
        const fallbackPersistedAttachments = getPersistedAttachmentsForThread();
        const fallbackPersistedIds: Array<string> = [];
        for (const attachment of fallbackPersistedAttachments) {
          if (currentImageIds.has(attachment.id)) {
            fallbackPersistedIds.push(attachment.id);
          }
        }
        const fallbackPersistedIdSet = new Set(fallbackPersistedIds);
        const fallbackAttachments = fallbackPersistedAttachments.filter((attachment) =>
          fallbackPersistedIdSet.has(attachment.id),
        );
        if (cancelled) return;
        syncComposerDraftPersistedAttachments(attachmentDraftTarget, fallbackAttachments);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    attachmentDraftTarget,
    clearComposerDraftPersistedAttachments,
    composerImages,
    getComposerDraft,
    syncComposerDraftPersistedAttachments,
  ]);

  const expandComposerForEditorChange = () => {
    suppressActiveComposerScrollGesture(
      composerScrollGestureRef.current,
      window.performance.now(),
      COMPOSER_SCROLL_GESTURE_RESET_MS,
    );
    setIsComposerScrollCollapsed(false);
  };
  const expandComposerForEditorChangeStable = useStableCallback(expandComposerForEditorChange);

  const retainedContextPayloads = useRetainedContextPayloads(composerDraftTargetKey);

  const convertTypedObjectLinkRef = useRef<typeof convertTypedObjectLink | null>(null);
  const convertPastedObjectLinksRef = useRef<typeof convertPastedObjectLinks | null>(null);
  const onPromptChange = (
    nextPrompt: string,
    nextCursor: number,
    expandedCursor: number,
    cursorAdjacentToMention: boolean,
    contextIds: string[],
  ) => {
    expandComposerForEditorChange();
    refreshWorkspaceSnapshotOnTyping();
    if (activePendingProgress?.activeQuestion && pendingUserInputs.length > 0) {
      if (activePendingProgress.activeQuestion.allowCustomAnswer === false) return;
      setComposerCursor(nextCursor);
      setComposerTrigger(
        cursorAdjacentToMention ? null : detectComposerTrigger(nextPrompt, expandedCursor),
      );
      onChangeActivePendingUserInputCustomAnswer(
        activePendingProgress.activeQuestion.id,
        nextPrompt,
        nextCursor,
        expandedCursor,
        cursorAdjacentToMention,
      );
      return;
    }
    onTypingGuardDraftChange();
    const previousPrompt = promptRef.current;
    promptRef.current = nextPrompt;
    setPrompt(nextPrompt);
    if (promptHistoryPositionRef.current?.position.recalled !== nextPrompt) {
      promptHistoryPositionRef.current = null;
    }
    const referenced = new Set(contextIds);
    const retained = retainedContextPayloads;

    const liveTerminalIds = new Set<string>(
      composerTerminalContexts.map((context) => terminalContextReference(context).contextId),
    );
    const restoredTerminals = [...referenced].flatMap((contextId) => {
      if (liveTerminalIds.has(contextId)) return [];
      const context = retained.terminals.get(contextId);
      return context ? [context] : [];
    });
    const nextTerminals = [
      ...composerTerminalContexts.filter((context) =>
        referenced.has(terminalContextReference(context).contextId),
      ),
      ...restoredTerminals,
    ];
    for (const context of composerTerminalContexts) {
      const contextId = terminalContextReference(context).contextId;
      if (!referenced.has(contextId)) retained.terminals.set(contextId, context);
    }
    if (nextTerminals.length !== composerTerminalContexts.length || restoredTerminals.length > 0) {
      setComposerDraftTerminalContexts(composerDraftTarget, nextTerminals);
    }

    const liveThreadIds = new Set<string>(composerThreadContexts.map((record) => record.contextId));
    const restoredThreads = [...referenced].flatMap((contextId) => {
      if (liveThreadIds.has(contextId)) return [];
      const record = retained.threads.get(contextId);
      return record ? [record] : [];
    });
    const nextThreads = [
      ...composerThreadContexts.filter((record) => referenced.has(record.contextId)),
      ...restoredThreads,
    ];
    for (const record of composerThreadContexts) {
      if (!referenced.has(record.contextId)) retained.threads.set(record.contextId, record);
    }
    if (nextThreads.length !== composerThreadContexts.length || restoredThreads.length > 0) {
      setComposerDraftThreadContexts(composerDraftTarget, nextThreads);
    }

    for (const comment of composerReviewComments) {
      const contextId = reviewCommentContextId(comment.id);
      if (!referenced.has(contextId)) {
        retained.reviewComments.set(contextId, comment);
        removeComposerDraftReviewComment(composerDraftTarget, comment.id);
      }
    }
    const liveReviewIds = new Set<string>(
      composerReviewComments.map((comment) => reviewCommentContextId(comment.id)),
    );
    for (const contextId of referenced) {
      if (liveReviewIds.has(contextId)) continue;
      const comment = retained.reviewComments.get(contextId);
      if (comment) {
        addComposerDraftReviewComment(composerDraftTarget, comment, { appendReference: false });
      }
    }

    const attachmentChanges = reconcileAttachmentContextReferences({
      referencedContextIds: referenced,
      files: composerFiles,
      images: composerImages,
      previewAnnotations: composerPreviewAnnotations,
      retained: retainedContextPayloads,
    });
    for (const annotationId of attachmentChanges.annotationIdsToRemove) {
      removeComposerDraftPreviewAnnotation(composerDraftTarget, annotationId);
    }
    for (const restored of attachmentChanges.annotationsToRestore) {
      if (restored.image) addComposerDraftImages(attachmentDraftTarget, [restored.image]);
      addComposerDraftPreviewAnnotation(composerDraftTarget, restored.annotation, {
        appendReference: false,
      });
    }
    for (const fileId of attachmentChanges.filesToRemove) {
      removeComposerDraftFile(attachmentDraftTarget, fileId);
    }
    if (attachmentChanges.filesToRestore.length > 0) {
      addComposerDraftFiles(attachmentDraftTarget, attachmentChanges.filesToRestore);
    }
    setComposerCursor(nextCursor);
    setComposerTrigger(
      cursorAdjacentToMention ? null : detectComposerTrigger(nextPrompt, expandedCursor),
    );
    convertTypedObjectLinkRef.current?.(previousPrompt, nextPrompt, expandedCursor);
  };
  const onPromptChangeStable = useStableCallback(onPromptChange);
  const pendingComposerSnapshotRef = useRef<ComposerSnapshot | null>(null);
  const applyPromptReplacement = (
    rangeStart: number,
    rangeEnd: number,
    replacement: string,
    options?: {
      expectedText?: string;
      expandedCursorAfterReplace?: number;
      focusEditorAfterReplace?: boolean;
      citationComment?: {
        start: number;
        sourceAnchor?: AssistantCitationSourceAnchor | undefined;
        insertedSpaces: ComposerCitationCommentRequest["insertedSpaces"];
      };
    },
  ): boolean => {
    if (
      activePendingUserInput &&
      activePendingProgress?.activeQuestion?.allowCustomAnswer === false
    ) {
      return false;
    }
    const currentText = promptRef.current;
    const safeStart = Math.max(0, Math.min(currentText.length, rangeStart));
    const safeEnd = Math.max(safeStart, Math.min(currentText.length, rangeEnd));
    if (
      options?.expectedText !== undefined &&
      currentText.slice(safeStart, safeEnd) !== options.expectedText
    ) {
      return false;
    }
    const next = replaceTextRange(promptRef.current, rangeStart, rangeEnd, replacement);
    const nextCursor = collapseExpandedComposerCursor(
      next.text,
      options?.expandedCursorAfterReplace ?? next.cursor,
      isLiteralPendingAnswer,
    );
    const nextExpandedCursor = expandCollapsedComposerCursor(
      next.text,
      nextCursor,
      isLiteralPendingAnswer,
    );
    if (options?.citationComment) {
      composerEditorRef.current?.requestCitationComment({
        previousValue: currentText,
        value: next.text,
        citationStart: options.citationComment.start,
        sourceAnchor: options.citationComment.sourceAnchor,
        insertedSpaces: options.citationComment.insertedSpaces,
      });
    }
    pendingComposerSnapshotRef.current = {
      value: next.text,
      cursor: nextCursor,
      expandedCursor: nextExpandedCursor,
      contextIds: isLiteralPendingAnswer ? [] : collectInlineContextIds(next.text),
    };
    promptRef.current = next.text;
    const activePendingQuestion = activePendingProgress?.activeQuestion;
    if (activePendingQuestion && activePendingUserInput) {
      onChangeActivePendingUserInputCustomAnswer(
        activePendingQuestion.id,
        next.text,
        nextCursor,
        nextExpandedCursor,
        isLiteralPendingAnswer,
      );
    } else {
      setPrompt(next.text);
      onTypingGuardDraftChange();
    }
    setComposerCursor(nextCursor);
    setComposerTrigger(
      isLiteralPendingAnswer ? null : detectComposerTrigger(next.text, nextExpandedCursor),
    );
    if (options?.focusEditorAfterReplace !== false) {
      window.requestAnimationFrame(() => {
        if (promptRef.current !== next.text) return;
        composerEditorRef.current?.focusAt(nextCursor);
      });
    }
    return true;
  };
  const applyPromptReplacementStable = useStableCallback(applyPromptReplacement);
  useLayoutEffect(() => {
    const chipToText = (record: Pick<UnreadLinkContextRecord, "contextId" | "url">) => {
      const occurrence = collectComposerContextReferences(promptRef.current).find(
        (candidate) => candidate.contextId === record.contextId,
      );
      if (occurrence === undefined) return null;
      const applied = applyPromptReplacement(occurrence.start, occurrence.end, record.url, {
        expandedCursorAfterReplace: occurrence.start + record.url.length,
      });
      return applied ? occurrence.start : null;
    };
    unreadLinkActionsRef.current = {
      retry: (record) => {
        const link = parseComposerObjectLink(record.url);
        if (link === null) return;
        const index = chipToText(record) ?? 0;
        const retry = () => unreadLinkActionsRef.current?.retry(record);
        void resolveObjectLinkWithin(
          resolveComposerObjectLink(link, { retry }),
          OBJECT_LINK_TIMEOUT_MS,
        ).then((result) => {
          if (result === "skipped") return;
          const resolved =
            typeof result === "string"
              ? unreadLinkChip(routeThreadRef.threadId, link, result)
              : result;
          const edit = objectLinkChipEdit(promptRef.current, link.url, index, resolved.reference);
          if (edit === null) return;
          if (
            applyPromptReplacement(edit.start, edit.end, edit.text, {
              expandedCursorAfterReplace: edit.start + edit.text.length,
            })
          ) {
            resolved.commit();
          }
        });
      },
      keepAsText: (record) => {
        chipToText(record);
      },
    };
  });

  const readComposerSnapshot = (): {
    value: string;
    cursor: number;
    expandedCursor: number;
    contextIds: string[];
  } => {
    const editorSnapshot = composerEditorRef.current?.readSnapshot();
    const pendingSnapshot = pendingComposerSnapshotRef.current;
    if (
      editorSnapshot?.value === promptRef.current ||
      pendingSnapshot?.value !== promptRef.current
    ) {
      pendingComposerSnapshotRef.current = null;
    }
    const snapshot = resolveComposerSnapshot(
      promptRef.current,
      editorSnapshot,
      pendingComposerSnapshotRef.current,
    );
    if (snapshot) return snapshot;
    return {
      value: promptRef.current,
      cursor: composerCursor,
      expandedCursor: expandCollapsedComposerCursor(
        promptRef.current,
        composerCursor,
        isLiteralPendingAnswer,
      ),
      contextIds: isLiteralPendingAnswer ? [] : collectInlineContextIds(promptRef.current),
    };
  };
  const readComposerSnapshotStable = useStableCallback(readComposerSnapshot);

  const resolveActiveComposerTrigger = (): {
    snapshot: { value: string; cursor: number; expandedCursor: number };
    trigger: ComposerTrigger | null;
  } => {
    const snapshot = readComposerSnapshot();
    return {
      snapshot,
      trigger: isLiteralPendingAnswer
        ? null
        : resolveComposerTrigger(detectComposerTrigger(snapshot.value, snapshot.expandedCursor)),
    };
  };

  /**
   * Replaces the `#` token with the items' chips. Pull requests are captured inline; the rest
   * land at the caret once fetched.
   */
  const attachReferenceItems = useStableCallback(
    (
      prompt: string,
      trigger: ComposerTrigger,
      items: ReadonlyArray<ReferenceMenuItem>,
      options?: { readonly link?: boolean },
    ) => {
      if (items.some((item) => item.type === "checkout" && !item.selectable)) return;
      const pullRequestComments = items.flatMap((item) =>
        item.type === "pull-request" ? [buildPullRequestReferenceContext(item.pullRequest)] : [],
      );
      const replacement = pullRequestComments
        .map(
          (comment) => `${formatInlineContextReference(reviewCommentContextReference(comment))} `,
        )
        .join("");
      const replacementRangeEnd =
        replacement.length > 0
          ? extendReplacementRangeForTrailingSpace(prompt, trigger.rangeEnd, replacement)
          : trigger.rangeEnd;
      const applied = applyPromptReplacement(trigger.rangeStart, replacementRangeEnd, replacement, {
        expectedText: prompt.slice(trigger.rangeStart, replacementRangeEnd),
      });
      if (!applied) return;
      setComposerHighlightedItemId(null);
      setReferenceSelection(null);
      recordComposerReferenceRecents(environmentId, pullRequestProjectId, items);
      for (const comment of pullRequestComments) {
        addComposerDraftReviewComment(composerDraftTarget, comment, { appendReference: false });
      }
      for (const item of items) {
        if (item.type === "linear-issue") void attachLinearIssue(routeThreadRef, item.issueId);
        if (item.type === "github-issue") void attachGitHubIssue(routeThreadRef, item.url);
        if (item.type === "notion-page") void attachNotionPage(routeThreadRef, item.pageId);
        if (item.type === "google-file") void attachGoogleFile(routeThreadRef, item.fileId);
        if (item.type === "granola-note") void attachGranolaNote(routeThreadRef, item.noteId);
        if (item.type === "slack-message") {
          void attachSlackMessage(routeThreadRef, slackGetThreadInput(item.message, "thread"));
        }
        if (item.type === "discord-message") {
          void attachDiscordMessage(routeThreadRef, discordGetThreadInput(item.message, "thread"));
        }
        if (item.type === "repository") {
          attachRepository(routeThreadRef, {
            nameWithOwner: item.nameWithOwner,
            remoteUrl: item.remoteUrl,
          });
        }
        if (item.type === "checkout") {
          attachCheckout(routeThreadRef, item, { link: options?.link === true });
        }
      }
    },
  );
  const commitReferenceSelection = useStableCallback(() => {
    const items = selectedReferenceItemsRef.current;
    if (items.length === 0) return false;
    const { snapshot, trigger } = resolveActiveComposerTrigger();
    if (trigger?.kind !== "pull-request") return false;
    attachReferenceItems(snapshot.value, trigger, items);
    return true;
  });

  const { onUsageLimitsCommand } = props;
  const onSelectComposerItem = (
    item: ComposerCommandItem,
    options?: { toggle?: boolean; link?: boolean },
  ) => {
    if (composerSelectLockRef.current) return;
    composerSelectLockRef.current = true;
    window.requestAnimationFrame(() => {
      composerSelectLockRef.current = false;
    });
    const { snapshot, trigger } = resolveActiveComposerTrigger();
    if (!trigger) return;
    if (item.type === "path") {
      if (!isPathSuggestionCurrent(item.searchTarget, trigger, environmentId, gitCwd)) return;
      const replacement = `${serializeComposerFileLink(item.path)} `;
      const replacementRangeEnd = extendReplacementRangeForTrailingSpace(
        snapshot.value,
        trigger.rangeEnd,
        replacement,
      );
      const applied = applyPromptReplacement(trigger.rangeStart, replacementRangeEnd, replacement, {
        expectedText: snapshot.value.slice(trigger.rangeStart, replacementRangeEnd),
      });
      if (applied) {
        setComposerHighlightedItemId(null);
      }
      return;
    }
    if (item.type === "thread-tab") {
      if (!captureThreadTabContext) return;
      const applied = applyPromptReplacement(trigger.rangeStart, trigger.rangeEnd, "", {
        expectedText: snapshot.value.slice(trigger.rangeStart, trigger.rangeEnd),
      });
      if (!applied) return;
      setComposerHighlightedItemId(null);
      // The summary is fetched after the query text leaves, so the chip lands at the caret
      // wherever it is by then.
      captureThreadTabContext.capture(item.threadId, item.label).then(
        (reference) => {
          const current = readComposerSnapshot();
          const edit = inlineContextReferenceReplacement(
            current.value,
            { start: current.expandedCursor, end: current.expandedCursor },
            [reference],
          );
          applyPromptReplacement(edit.start, edit.end, edit.text);
        },
        (cause: unknown) => {
          toastManager.add({
            type: "error",
            title: "Could not include that chat",
            description: cause instanceof Error ? cause.message : undefined,
          });
        },
      );
      return;
    }
    if (item.type === "slash-command") {
      if (item.command === "model") {
        const applied = applyPromptReplacement(trigger.rangeStart, trigger.rangeEnd, "", {
          expectedText: snapshot.value.slice(trigger.rangeStart, trigger.rangeEnd),
          focusEditorAfterReplace: false,
        });
        if (applied) {
          setComposerHighlightedItemId(null);
          setIsComposerModelPickerOpen(true);
        }
        return;
      }
      if (!planModeUiEnabled) return;
      void handleInteractionModeChange(item.command === "plan" ? "plan" : "default");
      const applied = applyPromptReplacement(trigger.rangeStart, trigger.rangeEnd, "", {
        expectedText: snapshot.value.slice(trigger.rangeStart, trigger.rangeEnd),
      });
      if (applied) {
        setComposerHighlightedItemId(null);
      }
      return;
    }
    if (item.type === "provider-slash-command") {
      if (item.command.name === USAGE_LIMITS_COMMAND.name && onUsageLimitsCommand) {
        const applied = applyPromptReplacement(trigger.rangeStart, trigger.rangeEnd, "", {
          expectedText: snapshot.value.slice(trigger.rangeStart, trigger.rangeEnd),
          focusEditorAfterReplace: false,
        });
        if (applied) {
          setComposerHighlightedItemId(null);
          onUsageLimitsCommand();
        }
        return;
      }
      const replacement = `/${item.command.name} `;
      const replacementRangeEnd = extendReplacementRangeForTrailingSpace(
        snapshot.value,
        trigger.rangeEnd,
        replacement,
      );
      const applied = applyPromptReplacement(trigger.rangeStart, replacementRangeEnd, replacement, {
        expectedText: snapshot.value.slice(trigger.rangeStart, replacementRangeEnd),
      });
      if (applied) {
        setComposerHighlightedItemId(null);
      }
      return;
    }
    if (item.type === "skill") {
      const replacement = `$${item.skill.name} `;
      const replacementRangeEnd = extendReplacementRangeForTrailingSpace(
        snapshot.value,
        trigger.rangeEnd,
        replacement,
      );
      const applied = applyPromptReplacement(trigger.rangeStart, replacementRangeEnd, replacement, {
        expectedText: snapshot.value.slice(trigger.rangeStart, replacementRangeEnd),
      });
      if (applied) {
        setComposerHighlightedItemId(null);
      }
      return;
    }
    if (isReferenceMenuItem(item)) {
      if (trigger.kind !== "pull-request") return;
      const selected = selectedReferenceItemsRef.current;
      if (options?.toggle || selected.length > 0) {
        setReferenceSelection({
          rangeStart: trigger.rangeStart,
          items: selected.some((candidate) => candidate.id === item.id)
            ? selected.filter((candidate) => candidate.id !== item.id)
            : [...selected, item],
        });
        return;
      }
      if (
        item.type === "pull-request" &&
        !composerMenuItemsRef.current.some((candidate) => candidate.id === item.id)
      ) {
        return;
      }
      attachReferenceItems(snapshot.value, trigger, [item], { link: options?.link === true });
      return;
    }
    if (item.type === "subagent") {
      if (trigger.kind !== "path") return;
      // The query text leaves first; the chip lands at the caret once its record resolves.
      const applied = applyPromptReplacement(trigger.rangeStart, trigger.rangeEnd, "", {
        expectedText: snapshot.value.slice(trigger.rangeStart, trigger.rangeEnd),
      });
      if (!applied) return;
      setComposerHighlightedItemId(null);
      void attachAgentToChat(
        item.parentRef,
        agentReferenceTargetOf(item.parentRef.environmentId, item.entry),
      );
      return;
    }
    if (item.type === "model") {
      if (trigger.kind !== "path") return;
      const applied = applyPromptReplacement(trigger.rangeStart, trigger.rangeEnd, "", {
        expectedText: snapshot.value.slice(trigger.rangeStart, trigger.rangeEnd),
      });
      if (!applied) return;
      setComposerHighlightedItemId(null);
      attachModelToChat(routeThreadRef, {
        entry: item.entry,
        slug: item.option.slug,
        name: item.option.name,
      });
      return;
    }
    if (item.type === "thread") {
      if (trigger.kind !== "path") return;
      const shell = readThreadShell(item.thread);
      if (!shell) return;
      const record = threadContextRecord(item.thread, shell.title);
      const replacement = `${formatInlineContextReference(threadContextReference(record))} `;
      const replacementRangeEnd = extendReplacementRangeForTrailingSpace(
        snapshot.value,
        trigger.rangeEnd,
        replacement,
      );
      const applied = applyPromptReplacement(trigger.rangeStart, replacementRangeEnd, replacement, {
        expectedText: snapshot.value.slice(trigger.rangeStart, replacementRangeEnd),
      });
      if (applied) {
        addComposerDraftThreadContexts(attachmentDraftTarget, [record], {
          appendReference: false,
        });
        setComposerHighlightedItemId(null);
      }
      return;
    }
  };
  const onSelectComposerItemStable = useStableCallback(onSelectComposerItem);

  const onComposerMenuItemHighlighted = (itemId: string | null) => {
    setComposerHighlightedItemId(itemId);
    setComposerHighlightedSearchKey(composerMenuSearchKey);
  };
  const onComposerMenuItemHighlightedStable = useStableCallback(onComposerMenuItemHighlighted);

  const nudgeComposerMenuHighlight = (key: "ArrowDown" | "ArrowUp") => {
    if (composerMenuItems.length === 0) return;
    const highlightedIndex = composerMenuItems.findIndex(
      (item) => item.id === composerHighlightedItemId,
    );
    const normalizedIndex = highlightedIndex >= 0 ? highlightedIndex : key === "ArrowDown" ? -1 : 0;
    const offset = key === "ArrowDown" ? 1 : -1;
    const nextIndex =
      (normalizedIndex + offset + composerMenuItems.length) % composerMenuItems.length;
    const nextItem = composerMenuItems[nextIndex];
    setComposerHighlightedItemId(nextItem?.id ?? null);
  };

  const blurMobileComposerAfterSend = () => {
    if (!isSoftwareKeyboardOpen) return;
    if (composerBlurFrameRef.current !== null) {
      window.cancelAnimationFrame(composerBlurFrameRef.current);
      composerBlurFrameRef.current = null;
    }
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) {
      activeElement.blur();
    }
    setIsComposerFocused(false);
  };

  const shouldBlurMobileComposerOnSubmit = () => {
    if (!isSoftwareKeyboardOpen) return false;
    if (
      isSendBusy ||
      isSendDisabled ||
      isConnecting ||
      noProviderAvailable ||
      environmentUnavailable !== null ||
      phase === "running"
    ) {
      return false;
    }
    if (activePendingProgress) {
      return activePendingProgress.isLastQuestion && Boolean(activePendingResolvedAnswers);
    }
    return showPlanFollowUpPrompt || composerSendState.hasSendableContent;
  };

  const submitComposer = (
    event?: { preventDefault: () => void },
    dispatchMode?: ComposerDispatchMode,
    submissionIntent?: ComposerSubmissionIntent,
  ) => {
    if (
      noProviderAvailable ||
      isSendDisabled ||
      !readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)
    ) {
      event?.preventDefault();
      return;
    }
    // A send while a pasted image is still compressing would strand that image:
    // the turn snapshot wouldn't include it, and it would surface in the *next*
    // draft instead.
    if (activeThreadId && countPreparingComposerImages(attachmentTargetKey) > 0) {
      event?.preventDefault();
      toastManager.add({
        type: "info",
        title: "Still compressing a pasted image.",
        description: "Send again once its thumbnail appears.",
      });
      return;
    }
    if (pendingDraftWork.has(attachmentTargetKey)) {
      event?.preventDefault();
      toastManager.add({
        type: "info",
        title: "Still bringing attached context into this message.",
        description: "Send again once its chip resolves.",
      });
      return;
    }
    const submission = submitComposerDraft({
      prompt: promptRef.current,
      submissionTarget: activePendingProgress ? "pending-user-input" : "provider-turn",
      event,
      onSend: (sendEvent) => {
        providerInputRejectedRef.current = false;
        onSend(
          sendEvent,
          dispatchMode ??
            resolveComposerDispatchMode({
              running: phase === "running",
              alternateModifier: false,
              activeTurnDefault: followUpBehavior,
              canSteer: !isCompacting,
            }),
          submissionIntent,
        );
        return !providerInputRejectedRef.current;
      },
    });
    setComposerSubmissionError(submission.validationMessage);
    if (!submission.didDispatch) return;
    onTypingGuardSend();
    if (shouldBlurMobileComposerOnSubmit()) {
      blurMobileComposerAfterSend();
    }
  };
  const submitComposerStable = useStableCallback(submitComposer);
  const messageDraftActions = useMessageDraftActions();
  const canWriteMessageDrafts = useAtomValue(
    messageDraftEnvironment.save.permissionAtom(environmentId),
  );
  const canSaveMessageDraft = onSaveMessageDraft !== null && canWriteMessageDrafts;
  const threadMessageDrafts = useThreadMessageDrafts(
    onSaveMessageDraft === null ? null : routeThreadRef,
  );
  const saveMessageDraft = async (): Promise<boolean> => {
    if (
      onSaveMessageDraft === null ||
      !canWriteMessageDrafts ||
      isComposerApprovalState ||
      activePendingProgress !== null ||
      isRevertingCheckpointRef.current
    ) {
      return false;
    }
    if (countPreparingComposerImages(attachmentTargetKey) > 0) {
      toastManager.add({
        type: "info",
        title: "Still compressing a pasted image.",
        description: "Save again once its thumbnail appears.",
      });
      return false;
    }
    if (pendingDraftWork.has(attachmentTargetKey)) {
      toastManager.add({
        type: "info",
        title: "Still bringing attached context into this message.",
        description: "Save again once its chip resolves.",
      });
      return false;
    }
    return onSaveMessageDraft();
  };
  const saveMessageDraftStable = useStableCallback(saveMessageDraft);
  const saveCitationAsDraftStable = useStableCallback(() => {
    void saveMessageDraft();
  });
  const loadMessageDraft = (draft: MessageDraft) => {
    const rewrittenContextIds = importContextRecords(
      messageDraftComposerRecords(draft),
      environmentId,
      composerDraftTarget,
    );
    const restoredPrompt = replaceComposerContextReferences(draft.text, (reference) => {
      const contextId = rewrittenContextIds.get(reference.contextId);
      return contextId
        ? formatInlineContextReference({
            ...reference,
            contextId,
            kind: reference.kind === "element" ? "preview-annotation" : reference.kind,
          })
        : reference.source;
    });
    promptRef.current = restoredPrompt;
    setComposerDraftPrompt(composerDraftTarget, restoredPrompt);
    setComposerCursor(collapseExpandedComposerCursor(restoredPrompt, restoredPrompt.length));
    setComposerTrigger(null);
    window.requestAnimationFrame(() => {
      composerEditorRef.current?.focusAtEnd();
    });
  };
  const loadMessageDraftStable = useStableCallback(loadMessageDraft);
  const openMessageDraft = async (draftId: MessageDraftId) => {
    if (isEditingQueuedMessage) {
      toastManager.add({
        type: "info",
        title: "Finish editing the queued message first",
        description: "Update it, move it to drafts, or cancel the edit, then open the draft.",
      });
      return;
    }
    if (isComposerApprovalState || activePendingProgress !== null) return;
    const targetKey = composerDraftTargetKey;
    const draft = await messageDraftActions.take(environmentId, draftId);
    if (draft === null) return;
    const putBack = () =>
      messageDraftActions.save(environmentId, {
        threadId: draft.threadId,
        text: draft.text,
        attachments: draft.attachments,
        context: draft.context,
      });
    if (composerDraftTargetKeyRef.current !== targetKey) {
      await putBack();
      return;
    }
    const holdsContent =
      promptRef.current.trim().length > 0 ||
      composerDraftHasUserContent(getComposerDraft(composerDraftTarget));
    if (holdsContent) {
      if (!(await saveMessageDraftStable()) || promptRef.current.trim().length > 0) {
        await putBack();
        return;
      }
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
    }
    loadMessageDraftStable(draft);
  };
  const openMessageDraftStable = useStableCallback(openMessageDraft);
  const openSendContextMenu = async (
    event: React.MouseEvent<HTMLElement>,
    surface: ComposerSendSurface,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const api = readLocalApi();
    if (!api || isComposerApprovalState || activePendingProgress !== null) return;
    const running = phase === "running";
    const sendDisabled =
      !canOperateThread ||
      isSendBusy ||
      isSendDisabled ||
      isConnecting ||
      noProviderAvailable ||
      projectSelectionRequired ||
      environmentUnavailable !== null;
    const defaultDispatchMode = resolveComposerDispatchMode({
      running,
      alternateModifier: false,
      activeTurnDefault: followUpBehavior,
      canSteer: !isCompacting,
    });
    const position = { x: event.clientX, y: event.clientY };
    if (surface !== "send") {
      const items: ContextMenuItem[] =
        surface === "plan-refine"
          ? [
              { id: "send", label: "Refine", icon: "arrow-up", disabled: sendDisabled },
              ...(canSaveMessageDraft ? [{ ...SAVE_DRAFT_MENU_ITEM, separatorBefore: true }] : []),
            ]
          : [
              { id: "send", label: "Implement", icon: "arrow-up", disabled: sendDisabled },
              {
                id: "implement-in-new-thread",
                label: "Implement in a new thread",
                icon: "message-square-plus",
                disabled: sendDisabled,
              },
            ];
      const selected = await api.contextMenu.show(items, position);
      if (selected === "send") submitComposer(undefined, defaultDispatchMode);
      else if (selected === "implement-in-new-thread") onImplementPlanInNewThread();
      else if (selected === SAVE_DRAFT_MENU_ITEM.id) void saveMessageDraft();
      return;
    }
    const items = resolveComposerSendMenu({
      hasContent: composerSendState.hasSendableContent,
      running,
      canSteer: !isCompacting,
      activeTurnDefault: followUpBehavior,
      canSendInNewThread: routeKind !== "draft",
      canSaveDraft: canSaveMessageDraft,
      isEditingQueuedMessage,
      sendDisabled,
      drafts: canSaveMessageDraft ? threadMessageDrafts : [],
    });
    if (items.length === 0) return;
    const action = findComposerSendMenuAction(items, await api.contextMenu.show(items, position));
    switch (action?.type) {
      case "send":
      case "update-queued":
        submitComposer(undefined, defaultDispatchMode);
        return;
      case "queue":
      case "steer":
        submitComposer(undefined, action.type);
        return;
      case "send-in-new-thread":
        submitComposer(undefined, defaultDispatchMode, "background");
        return;
      case "save-draft":
      case "move-to-drafts":
        void saveMessageDraft();
        return;
      case "open-draft":
        void openMessageDraft(MessageDraftId.make(action.draftId));
        return;
      case "cancel-edit":
        onCancelQueuedEdit();
        return;
      case undefined:
        return;
    }
  };
  const openSendContextMenuStable = useStableCallback(openSendContextMenu);
  // A surface beside the composer asked to send what it just wrote here. Wait out a connect,
  // attachments it just handed over that are still uploading, and the git status of a draft that
  // just opened (until it lands, a non-git folder reads as a repo and asks for a base branch),
  // then send as Enter would; anything else that stops it leaves the draft in place to send by hand.
  const submitRequested = useComposerSubmitRequestStore((state) =>
    state.pending.has(composerDraftTargetKey),
  );
  const attachmentsUploading = attachmentUploadPendingReason !== null;
  useEffect(() => {
    if (
      !submitRequested ||
      isConnecting ||
      isSendBusy ||
      attachmentsUploading ||
      checkoutKindPending
    ) {
      return;
    }
    const intent = useComposerSubmitRequestStore.getState().take(composerDraftTargetKey);
    if (intent === "save-draft") void saveMessageDraftStable();
    else if (intent === "send") submitComposerStable();
  }, [
    attachmentsUploading,
    checkoutKindPending,
    composerDraftTargetKey,
    isConnecting,
    isSendBusy,
    saveMessageDraftStable,
    submitComposerStable,
    submitRequested,
  ]);
  const handleSubmitMessage = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    submitComposer(
      event,
      resolveComposerDispatchMode({
        running: phase === "running",
        alternateModifier: event.metaKey || event.ctrlKey,
        activeTurnDefault: followUpBehavior,
        canSteer: !isCompacting,
      }),
    );
  };
  const handleSubmitMessageStable = useStableCallback(handleSubmitMessage);
  const citationSendDispatchMode = resolveComposerDispatchMode({
    running: phase === "running",
    alternateModifier: false,
    activeTurnDefault: followUpBehavior,
    canSteer: !isCompacting,
  });
  const submitCitationAndSend = async (citationText: string): Promise<boolean> => {
    if (
      noProviderAvailable ||
      !readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)
    ) {
      return false;
    }
    return onSendCitation(citationText, citationSendDispatchMode);
  };
  const submitCitationAndSendStable = useStableCallback(submitCitationAndSend);
  // A question took the editor while a citation comment was
  // unsaved. Keep the comment in the prompt that comes back afterward.
  const saveCitationDraftToPrompt = (replacedValue: string, savedValue: string) => {
    if (replacedValue !== prompt) return;
    if (promptRef.current === replacedValue) promptRef.current = savedValue;
    setPrompt(savedValue);
  };
  const saveCitationDraftToPromptStable = useStableCallback(saveCitationDraftToPrompt);
  const compactThreadContext = () => {
    if (
      !readEnvironmentScope(environmentId, AuthOrchestrationOperateScope) ||
      compactDisabled ||
      noProviderAvailable ||
      activePendingApproval !== null ||
      pendingUserInputs.length > 0 ||
      phase === "running" ||
      isSendBusy ||
      isConnecting ||
      !activeThreadId
    ) {
      return;
    }
    onCompactContext();
  };
  const compactThreadContextStable = useStableCallback(compactThreadContext);
  const expandMobileComposer = () => {
    if (composerBlurFrameRef.current !== null) {
      window.cancelAnimationFrame(composerBlurFrameRef.current);
      composerBlurFrameRef.current = null;
    }
    if (mobileComposerExpandFrameRef.current !== null) {
      window.cancelAnimationFrame(mobileComposerExpandFrameRef.current);
    }
    if (mobileComposerExpandReleaseFrameRef.current !== null) {
      window.cancelAnimationFrame(mobileComposerExpandReleaseFrameRef.current);
    }
    mobileComposerExpandInFlightRef.current = true;
    setIsComposerFocused(true);
    mobileComposerExpandFrameRef.current = window.requestAnimationFrame(() => {
      mobileComposerExpandFrameRef.current = null;
      composerEditorRef.current?.focusAtEnd();
      mobileComposerExpandReleaseFrameRef.current = window.requestAnimationFrame(() => {
        mobileComposerExpandReleaseFrameRef.current = null;
        mobileComposerExpandInFlightRef.current = false;
      });
    });
  };
  const expandMobileComposerStable = useStableCallback(expandMobileComposer);

  // Links already converted or tried, per draft. Typing never retries them, so undoing a chip or
  // deleting one stays as text. Pasting is explicit and does.
  const handledObjectLinksRef = useRef(new Map<string, Set<string>>());
  // Links whose objects are loading, and the draft each was written in, for placeholder chips.
  const [loadingObjectLinks, setLoadingObjectLinks] = useState<
    ReadonlyArray<{ readonly url: string; readonly workKey: string }>
  >([]);
  const handledObjectLinks = () => {
    const key = composerDraftTargetKeyRef.current;
    let handled = handledObjectLinksRef.current.get(key);
    if (handled === undefined) {
      handled = new Set();
      handledObjectLinksRef.current.set(key, handled);
    }
    return handled;
  };
  // Runs when the object loads, so it reads the composer as it is then, not as it was at paste.
  const applyResolvedObjectLink = (
    started: ObjectLinkDrafts & { draftTarget: ComposerThreadTarget },
    url: string,
    index: number,
    resolved: ResolvedComposerObjectLink,
  ) => {
    const destination = objectLinkChipDestination(
      started,
      composerEditorRef.current === null
        ? null
        : { draftKey: composerDraftTargetKeyRef.current, workKey: attachmentTargetKeyRef.current },
    );
    if (destination === "drop") return;
    if (destination === "stored-draft") {
      const prompt =
        useComposerDraftStore.getState().getComposerDraft(started.draftTarget)?.prompt ?? "";
      const edit = objectLinkChipEdit(prompt, url, index, resolved.reference);
      if (edit === null) return;
      setComposerDraftPrompt(
        started.draftTarget,
        `${prompt.slice(0, edit.start)}${edit.text}${prompt.slice(edit.end)}`,
      );
      resolved.commit();
      return;
    }
    const edit = objectLinkChipEdit(promptRef.current, url, index, resolved.reference);
    if (edit === null) return;
    // Keep the caret where the user left it, shifted past the chip if it was after the link.
    const cursor = readComposerSnapshot().expandedCursor;
    const cursorAfter =
      cursor <= edit.start
        ? cursor
        : cursor >= edit.end
          ? cursor + edit.text.length - (edit.end - edit.start)
          : edit.start + edit.text.length;
    const activeElement = document.activeElement;
    const applied = applyPromptReplacement(edit.start, edit.end, edit.text, {
      expandedCursorAfterReplace: cursorAfter,
      focusEditorAfterReplace:
        activeElement instanceof Node && composerFormRef.current?.contains(activeElement) === true,
    });
    if (applied) resolved.commit();
  };
  const applyResolvedObjectLinkStable = useStableCallback(applyResolvedObjectLink);
  /** Turns a broken chip back into its link; where the link now starts, or null if there is none. */
  const unreadLinkChipToText = (record: Pick<UnreadLinkContextRecord, "contextId" | "url">) => {
    const occurrence = collectComposerContextReferences(promptRef.current).find(
      (candidate) => candidate.contextId === record.contextId,
    );
    if (occurrence === undefined) return null;
    const applied = applyPromptReplacement(occurrence.start, occurrence.end, record.url, {
      expandedCursorAfterReplace: occurrence.start + record.url.length,
    });
    return applied ? occurrence.start : null;
  };
  /** Swaps links to issues, pull requests, and repositories for the chips their attach pickers make. */
  const convertObjectLinks = (
    links: ReadonlyArray<{
      link: ComposerObjectLink;
      index: number;
    }>,
  ) => {
    const started = {
      draftTarget: composerDraftTarget,
      draftKey: composerDraftTargetKeyRef.current,
      workKey: attachmentTargetKeyRef.current,
    };
    const threadId = routeThreadRef.threadId;
    const handled = handledObjectLinks();
    for (const { link, index } of links) {
      handled.add(link.url);
      const loading = { url: link.url, workKey: started.workKey };
      setLoadingObjectLinks((current) => [...current, loading]);
      const retry = () => {
        if (composerDraftTargetKeyRef.current !== started.draftKey) return;
        unreadLinkActionsRef.current?.retry(unreadLinkContextRecord(link, "unreadable"));
      };
      pendingDraftWork.begin(started.workKey);
      void resolveObjectLinkWithin(
        resolveComposerObjectLink(link, { retry }),
        OBJECT_LINK_TIMEOUT_MS,
      )
        .then((result) => {
          if (result === "skipped") return;
          // A link that was tried and failed becomes a broken chip, so it reads differently
          // from a link nobody tried. The agent still receives the link.
          const resolved =
            typeof result === "string" ? unreadLinkChip(threadId, link, result) : result;
          applyResolvedObjectLinkStable(started, link.url, index, resolved);
        })
        .finally(() => {
          pendingDraftWork.end(started.workKey);
          setLoadingObjectLinks((current) => current.filter((entry) => entry !== loading));
        });
    }
  };
  useLayoutEffect(() => {
    unreadLinkActionsRef.current = {
      // Starts from the link its broken chip holds, or the link itself if it is still text.
      retry: (record) => {
        const link = parseComposerObjectLink(record.url);
        if (link === null) return;
        convertObjectLinks([{ link, index: unreadLinkChipToText(record) ?? 0 }]);
      },
      keepAsText: (record) => {
        handledObjectLinks().add(record.url);
        unreadLinkChipToText(record);
      },
    };
  });
  /** `pasteStart` is where the paste lands, so offsets into the pasted text are offsets from it. */
  const convertPastedObjectLinks = (
    pastedText: string,
    keepAsText: boolean,
    pasteStart: number,
  ) => {
    const links = findPastedComposerObjectLinks(promptRef.current, pastedText, pasteStart);
    if (links.length === 0) return;
    if (keepAsText) {
      for (const { link } of links) handledObjectLinks().add(link.url);
      return;
    }
    convertObjectLinks(links);
  };
  // Read by `onPromptChange`, which is declared before the replacement helpers this needs.
  const convertTypedObjectLink = (
    previousPrompt: string,
    nextPrompt: string,
    expandedCursor: number,
  ) => {
    // One typed character, so pastes, chip insertions, and caret moves never count.
    if (nextPrompt.length !== previousPrompt.length + 1) return;
    const typed = findTypedComposerObjectLink(nextPrompt, expandedCursor);
    if (typed === null || handledObjectLinks().has(typed.link.url)) return;
    convertObjectLinks([typed]);
  };
  useLayoutEffect(() => {
    convertTypedObjectLinkRef.current = convertTypedObjectLink;
  });
  // Read by `insertComposerText`, so a paste redirected from a blurred composer converts too.
  useLayoutEffect(() => {
    convertPastedObjectLinksRef.current = convertPastedObjectLinks;
  });

  const onComposerCommandKey = (key: string, event: KeyboardEvent, isTaskItem?: boolean) =>
    composerCommandKeyHandler({
      setReferenceSelection,
      commitReferenceSelection,
      keybindings,
      sendShortcut: settings.sendShortcut,
      routeKind,
      phase,
      isCompacting,
      followUpBehavior,
      isSoftwareKeyboardOpen,
      planModeUiEnabled,
      isLiteralPendingAnswer,
      pendingUserInputs,
      promptHistoryMessages,
      promptHistoryPositionRef,
      composerDraftTarget,
      promptRef,
      composerImagesRef,
      composerFilesRef,
      composerTerminalContextsRef,
      composerPreviewAnnotations,
      composerReviewComments,
      composerEditorRef,
      composerMenuOpenRef,
      composerMenuItemsRef,
      activeComposerMenuItemRef,
      setComposerDraftPrompt,
      setComposerCursor,
      setComposerTrigger,
      setComposerHighlightedItemId,
      dismissComposerTrigger,
      toggleInteractionMode,
      nudgeComposerMenuHighlight,
      onSelectComposerItem,
      resolveActiveComposerTrigger,
      readComposerSnapshot,
      applyPromptReplacement,
      submitComposer,
    })(key, event, isTaskItem);

  const {
    stashQueue,
    isStashMenuOpen,
    setIsStashMenuOpen,
    stashPulseKey,
    restoreStashEntryStable,
    deleteStashEntryStable,
    toggleStashMenuStable,
  } = useComposerStash({
    unfocusedSplitPane,
    canSaveMessageDraft,
    saveMessageDraftStable,
    environmentId,
    composerDraftTarget,
    promptRef,
    readAttachmentDraft: () => ({
      images: composerImagesRef.current,
      files: composerFilesRef.current,
    }),
    readTerminalContexts: () => composerTerminalContextsRef.current,
    routeThreadRef,
    projectSelectionRequired,
    pendingUserInputs,
    activePendingProgress,
    prompt,
    composerMenuOpen,
    isComposerCollapsedMobile,
    composerPreviewAnnotations,
    composerReviewComments,
    composerThreadContexts,
    composerSnapshotRecords: [
      ...composerThreadTabContexts,
      ...composerIssueContexts,
      ...composerRepositoryContexts,
      ...composerCheckoutContexts,
    ],
    attachmentTargetKey,
    isComposerDraftTargetOpen: (key) => composerDraftTargetKeyRef.current === key,
    composerEditorRef,
    isRevertingCheckpoint: () => isRevertingCheckpointRef.current,
    pendingThreadImportsRef,
    setComposerCursor,
    setComposerTrigger,
    importContextRecords,
    expandMobileComposer: expandMobileComposerStable,
  });
  const toggleTasksDrawer = () => {
    setIsTasksDrawerOpen((open) => !open);
  };
  const toggleTasksDrawerStable = useStableCallback(toggleTasksDrawer);
  const hasBannerItems = props.bannerItems.length > 0;
  const hasBlockingComposerTopDrawer =
    activePendingApproval !== null || pendingUserInputs.length > 0;
  const showInlineTasksBadge =
    activeTasksProgress !== null &&
    activeTaskSteps !== null &&
    !isTasksDrawerOpen &&
    !hasBlockingComposerTopDrawer &&
    (hasBannerItems || showComposerTopDrawer || isComposerCollapsedMobile);
  const inlineTasksBadge = showInlineTasksBadge ? (
    <ComposerTasksBadge
      expanded={false}
      onToggle={toggleTasksDrawerStable}
      placement="inline"
      progress={activeTasksProgress}
      steps={activeTaskSteps}
    />
  ) : null;
  const hasImageAttachmentAttention = standaloneComposerImages.some((image) => {
    const upload = uploadsByImageId[image.id];
    const failedInCurrentEnvironment =
      supportsAttachmentUploads &&
      upload?.status === "failed" &&
      upload.environmentId === environmentId;
    return nonPersistedComposerImageIdSet.has(image.id) && !failedInCurrentEnvironment;
  });
  const composerHasExpandedChrome =
    showComposerTopDrawer ||
    isTasksDrawerOpen ||
    composerMenuOpen ||
    isStashMenuOpen ||
    isDragOverComposer ||
    isPreparingWorktree ||
    showProviderUnavailable ||
    projectSelectionRequired ||
    environmentUnavailable !== null ||
    composerSubmissionError !== null ||
    providerInputSubmissionError !== null ||
    hasImageAttachmentAttention ||
    preparingComposerImages.length > 0;
  const startFromShortcutLabel = onStartFrom
    ? shortcutLabelForCommand(keybindings, "chat.startFrom", {
        context: { terminalFocus: false, terminalOpen, modelPickerOpen: false },
      })
    : null;
  const isComposerResting = shouldUseRestingComposerLayout({
    isExistingThread: routeKind === "server" && activeThreadId !== null,
    isMobileViewport,
    isScrollCollapsed: isComposerScrollCollapsed,
    hasExpandedChrome: composerHasExpandedChrome,
    hasMultilinePrompt,
    timelineOverflows,
  });
  const expandedComposerImages = isComposerResting
    ? standaloneComposerImages.filter((image) => pendingSnapShotIdSet.has(image.id))
    : standaloneComposerImages;
  const composerControlsCollapsed = isComposerResting || isComposerCollapsedMobile;
  const showInlineRestingControls = composerControlsCollapsed && restingControlsHost === null;
  const composerControlsVisibleInStrip =
    composerControlsCollapsed && restingControlsHost !== null && restingControlsVisible;
  const composerControlsHidden = composerControlsCollapsed && !restingControlsVisible;
  if (composerControlsHidden && isComposerModelPickerOpen) {
    setIsComposerModelPickerOpen(false);
  }
  useLayoutEffect(() => {
    onRestingControlsVisibilityChange(composerControlsVisibleInStrip);
  }, [composerControlsVisibleInStrip, onRestingControlsVisibilityChange]);
  useLayoutEffect(() => {
    onRestingChange(isComposerResting);
  }, [isComposerResting, onRestingChange]);
  const [restingActionsElement, setRestingActionsElement] = useState<HTMLDivElement | null>(null);
  const [restingActionsWidth, setRestingActionsWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!isComposerResting || !restingActionsElement) return;
    const measure = () => setRestingActionsWidth(restingActionsElement.offsetWidth);
    measure();
    return observeResize(restingActionsElement, measure);
  }, [isComposerResting, restingActionsElement]);
  const showMoreRestingImages = () => {
    if (isComposerCollapsedMobile) {
      expandMobileComposer();
      return;
    }
    setIsComposerScrollCollapsed(false);
    setIsComposerFocused(true);
    scheduleComposerFocus();
  };
  const collapsedComposerImagePreviews =
    standaloneComposerImages.length > 0 ? (
      <ComposerRestingImagePreviews
        images={standaloneComposerImages}
        allImages={composerImages}
        resolvedTheme={resolvedTheme}
        onExpandImage={onExpandImage}
        onShowMore={showMoreRestingImages}
      />
    ) : null;
  const { active: panelAnimationsActive, durationMs: panelAnimationDurationMs } =
    usePanelAnimationSettings();
  const composerMainSurfaceRef = useComposerRestingTransition(
    composerControlsCollapsed,
    isComposerResting,
    restingComposerControlsRef,
    onComposerOverlayHeightChange,
    panelAnimationsActive,
    panelAnimationDurationMs,
  );
  const canTrackComposerScrollGesture =
    routeKind === "server" && activeThreadId !== null && !isMobileViewport;
  const canScrollCollapseComposer =
    canTrackComposerScrollGesture &&
    settings.composerCollapseOnScroll &&
    !hasMultilinePrompt &&
    !composerHasExpandedChrome &&
    !showInlineTasksBadge;
  const composerScrollCollapseEligible = canScrollCollapseComposer && !isComposerResting;
  useLayoutEffect(() => {
    composerScrollCollapseEligibleRef.current = composerScrollCollapseEligible;
  });

  useEffect(() => {
    if (!canScrollCollapseComposer) {
      setIsComposerScrollCollapsed(false);
    }
  }, [canScrollCollapseComposer, setIsComposerScrollCollapsed]);

  // Window activation re-fires focus; ignore that frame to keep the composer collapsed.
  // oxlint-disable-next-line t3code/react-effect-budget -- Track window refocus while the collapsed editor owns browser focus.
  useEffect(() => {
    if (!isComposerScrollCollapsed) return;
    let frame: number | null = null;
    const onWindowFocus = () => {
      windowRefocusInFlightRef.current = true;
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = null;
        windowRefocusInFlightRef.current = false;
      });
    };
    window.addEventListener("focus", onWindowFocus);
    return () => {
      window.removeEventListener("focus", onWindowFocus);
      if (frame !== null) window.cancelAnimationFrame(frame);
      windowRefocusInFlightRef.current = false;
    };
  }, [isComposerScrollCollapsed]);

  // oxlint-disable-next-line t3code/react-effect-budget -- Track wheel and touch gestures on the timeline DOM.
  useEffect(() => {
    if (!canTrackComposerScrollGesture) return;

    const finishScrollGesture = () => {
      if (composerScrollCollapseTimeoutRef.current !== null) {
        window.clearTimeout(composerScrollCollapseTimeoutRef.current);
      }
      composerScrollCollapseTimeoutRef.current = null;
      resetComposerScrollGesture(composerScrollGestureRef.current);
    };
    const handleTimelineWheel = (event: WheelEvent) => {
      if (event.ctrlKey || !(event.target instanceof Element)) {
        return;
      }

      const scrollNode = getTimelineScrollableNode();
      if (!scrollNode) return;
      const targetsTimeline = isTimelineScrollTarget(event.target, scrollNode, event.deltaY);
      if (
        !scrollNode.contains(event.target) &&
        !composerScrollGestureRef.current.collapseSuppressed
      )
        return;

      if (composerScrollCollapseTimeoutRef.current !== null) {
        window.clearTimeout(composerScrollCollapseTimeoutRef.current);
      }
      composerScrollCollapseTimeoutRef.current = window.setTimeout(
        finishScrollGesture,
        COMPOSER_SCROLL_GESTURE_RESET_MS,
      );

      const canScrollInGestureDirection =
        targetsTimeline &&
        (event.deltaY < 0
          ? scrollNode.scrollTop > 0
          : scrollNode.scrollTop < scrollNode.scrollHeight - scrollNode.clientHeight);
      const deltaPx =
        Math.abs(event.deltaY) *
        (event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? scrollNode.clientHeight
            : 1);
      const shouldCollapse = recordComposerScrollGestureEvent(composerScrollGestureRef.current, {
        now: window.performance.now(),
        deltaPx,
        collapseThresholdPx: COMPOSER_SCROLL_COLLAPSE_THRESHOLD_PX,
        collapseEligible: targetsTimeline && composerScrollCollapseEligibleRef.current,
        canScrollInGestureDirection,
        scrollsTowardLogicalEnd: event.deltaY > 0 && isTimelineAtLogicalEnd(),
      });
      if (!shouldCollapse) {
        return;
      }

      setIsComposerScrollCollapsed(true);
    };

    document.addEventListener("wheel", handleTimelineWheel, { capture: true, passive: true });
    return () => {
      document.removeEventListener("wheel", handleTimelineWheel, true);
      finishScrollGesture();
    };
  }, [
    canTrackComposerScrollGesture,
    getTimelineScrollableNode,
    isTimelineAtLogicalEnd,
    setIsComposerScrollCollapsed,
  ]);

  const restingHiddenBlockCount = composerControlsCollapsed
    ? restingControlsHiddenBlockCount
    : expandedControlsHiddenBlockCount;
  const iconOnlyBlockCount = composerControlsCollapsed
    ? restingControlsIconOnlyBlockCount
    : expandedControlsIconOnlyBlockCount;
  const composerControls = (
    <ComposerControlsBar
      onForkModel={onForkModel}
      modelRequiresFork={modelRequiresFork}
      environmentId={environmentId}
      routeKind={routeKind}
      routeThreadRef={routeThreadRef}
      draftId={draftId}
      selectedProvider={selectedProvider}
      selectedInstanceId={selectedInstanceId}
      selectedModel={selectedModel}
      selectedProviderModels={selectedProviderModels}
      composerModelOptions={composerModelOptions}
      reportedModelSelection={reportedModelSelection}
      promptUltrathink={promptUltrathink}
      onPromptEdit={editPromptFromTraitsStable}
      planModeEnabled={settings.planModeEnabled}
      planModeUiEnabled={planModeUiEnabled}
      interactionMode={interactionMode}
      compatibleRuntimeMode={compatibleRuntimeMode}
      compatibleRuntimeModeOptions={compatibleRuntimeModeOptions}
      toggleInteractionMode={toggleInteractionMode}
      handleRuntimeModeChange={handleRuntimeModeChange}
      composerControlsCollapsed={composerControlsCollapsed}
      composerControlsHidden={composerControlsHidden}
      restingHiddenBlockCount={restingHiddenBlockCount}
      iconOnlyBlockCount={iconOnlyBlockCount}
      showInlineRestingControls={showInlineRestingControls}
      showLeadingSeparator={
        composerControlsCollapsed &&
        restingControlsHost !== null &&
        restingControlsHaveLeadingContext
      }
      showProviderUnavailable={showProviderUnavailable}
      providerSetupInstanceId={providerSetupInstanceId}
      onOpenProviderSetup={onOpenProviderSetup}
      providerCatalogPending={providerCatalogPending}
      isSendBusy={isSendBusy}
      multipleModelsEnabled={routeKind === "draft" && supportsMultipleModels}
      multipleModelSelections={multipleModelSelections}
      onMultipleModelSelectionsChange={setMultipleModelSelections}
      selectedModelSelection={selectedModelSelection}
      onProviderModelSelect={onProviderModelSelect}
      activeThreadModelSelection={activeThreadModelSelection}
      selectedModelForPickerWithCustomFallback={selectedModelForPickerWithCustomFallback}
      lockedProvider={lockedProvider}
      lockedContinuationGroupKey={lockedContinuationGroupKey}
      providerInstanceEntries={providerInstanceEntries}
      keybindings={keybindings}
      modelOptionsByInstance={modelOptionsByInstance}
      terminalOpen={terminalOpen}
      modelPickerOpen={isComposerModelPickerOpen}
      onModelPickerOpenChange={setIsComposerModelPickerOpen}
      modelPickerIconClassName={composerProviderState.modelPickerIconClassName}
      getModelDisabledReason={getModelDisabledReason}
    />
  );
  const showTasksTab =
    !hasBannerItems &&
    !showComposerTopDrawer &&
    !isTasksDrawerOpen &&
    !isComposerCollapsedMobile &&
    activeTasksProgress !== null &&
    activeTaskSteps !== null &&
    activeTasksProgress.totalSteps > 0;
  const activityStackContent = hasBannerItems ? (
    shownSyncPhase ? (
      <ComposerActivityRow phase={shownSyncPhase} />
    ) : !hasBlockingComposerTopDrawer && activeTasksProgress && activeTaskSteps ? (
      <ComposerTasksContent
        expanded={isTasksDrawerOpen}
        onToggle={toggleTasksDrawerStable}
        progress={activeTasksProgress}
        steps={activeTaskSteps}
      />
    ) : null
  ) : null;
  const activityStackItem: ComposerBannerStackContent | null = activityStackContent
    ? {
        id: "composer-activity",
        variant: "default",
        priority: "activity",
        content: activityStackContent,
      }
    : null;
  const bannerStackItems = activityStackItem
    ? [activityStackItem, ...props.bannerItems]
    : props.bannerItems;
  const [tasksDrawerThreadId, setTasksDrawerThreadId] = useState(activeThreadId);
  if (
    isTasksDrawerOpen &&
    (activeTasksProgress === null ||
      activeTaskSteps === null ||
      hasBlockingComposerTopDrawer ||
      tasksDrawerThreadId !== activeThreadId)
  ) {
    setIsTasksDrawerOpen(false);
  }
  if (tasksDrawerThreadId !== activeThreadId) setTasksDrawerThreadId(activeThreadId);

  const insertComposerText = (
    text: string,
    position: "cursor" | "end",
    options?: {
      ensureLeadingBoundary?: boolean;
      /** Opens the inserted citation's comment editor, beside its source when it has one. */
      citationComment?: { sourceAnchor?: AssistantCitationSourceAnchor | undefined };
      clipboardData?: DataTransfer;
      pasteAsText?: boolean;
    },
  ): boolean => {
    if (
      text.length === 0 ||
      isConnecting ||
      activePendingIsResponding ||
      (pendingUserInputs.length > 0 && !activePendingProgress?.activeQuestion) ||
      projectSelectionRequired ||
      (options?.citationComment && !composerEditorRef.current)
    ) {
      return false;
    }
    const clipboardText = options?.clipboardData?.getData("text/plain");
    // Paste-as-text keeps file paths as text, the same as a focused paste.
    if (
      options?.clipboardData &&
      !(options.pasteAsText && pastedFilePathsAsComposerFileLinks(clipboardText ?? "") !== null)
    ) {
      text = importPastedComposerText(options.clipboardData, importContextFragment);
    }
    const prompt = promptRef.current;
    const cursor = position === "cursor" ? readComposerSnapshot().expandedCursor : prompt.length;
    const needsLeadingSpace =
      (options?.ensureLeadingBoundary ?? false) &&
      cursor > 0 &&
      !/\s/.test(prompt[cursor - 1] ?? "");
    const rangeEnd = extendReplacementRangeForTrailingSpace(prompt, cursor, text);
    return applyPromptReplacement(
      cursor,
      rangeEnd,
      needsLeadingSpace ? ` ${text}` : text,
      options?.citationComment
        ? {
            citationComment: {
              start: cursor + (needsLeadingSpace ? 1 : 0),
              sourceAnchor: options.citationComment.sourceAnchor,
              insertedSpaces: { before: needsLeadingSpace, after: rangeEnd === cursor },
            },
            focusEditorAfterReplace: false,
          }
        : undefined,
    );
  };
  const insertComposerTextStable = useStableCallback(insertComposerText);

  const insertAttachmentReferences = (
    references: ReadonlyArray<ComposerContextReference>,
    selection?: { start: number; end: number },
  ): boolean => {
    if (references.length === 0) return false;
    // Question answers carry attachments beside the answer, never as chips. Falling back to
    // the thread prompt here would hide the file behind a reference the question never shows.
    if (questionAttachmentTarget) return false;
    return insertAttachmentReferencesForDraft({
      target: composerDraftTarget,
      liveAttachmentTargetKey: attachmentTargetKeyRef.current,
      references,
      insertReferences: () => {
        if (selection) {
          const edit = inlineContextReferenceReplacement(promptRef.current, selection, references);
          return applyPromptReplacementStable(edit.start, edit.end, edit.text);
        }
        const text = references.map(formatInlineContextReference).join(" ");
        const inserted = insertComposerTextStable(`${text} `, "cursor", {
          ensureLeadingBoundary: true,
        });
        if (!inserted) {
          setPrompt(ensureInlineContextReferences(promptRef.current, references));
        }
        return true;
      },
    });
  };

  const { addComposerAttachments, removeComposerImage, foldPastedText } =
    useComposerAttachmentIntake({
      activeThreadId,
      activePendingProgress,
      activePendingIsResponding,
      pendingUserInputs,
      supportsQuestionAttachments,
      isLiteralPendingAnswer,
      isConnecting,
      projectSelectionRequired,
      questionAttachmentTarget,
      attachmentTargetKey,
      fileStagingLimit,
      promptRef,
      composerImagesRef,
      composerFilesRef,
      composerEditorRef,
      isRevertingCheckpointRef,
      setThreadError,
      countReservedAttachments,
      addComposerImage,
      addComposerImagesToDraft,
      addComposerFilesToDraft,
      removeComposerImageFromDraft,
      insertAttachmentReferences,
    });

  const onComposerCommandKeyStable = useStableCallback(onComposerCommandKey);
  const isPathQueryActiveStable = useStableCallback(
    () => resolveActiveComposerTrigger().trigger?.kind === "path",
  );

  const insertComposerTextAtEnd: ChatComposerHandle["insertTextAtEnd"] = (text, options) => {
    const inserted = insertComposerText(text, "end", options);
    if (inserted && isComposerCollapsedMobile) {
      // Reveal the mobile editor before its focus frame.
      expandMobileComposer();
    }
    return inserted;
  };
  const insertComposerTextAtEndStable = useStableCallback(insertComposerTextAtEnd);

  const addComposerFolders = (folders: File[]) => {
    const target = folderDropTarget({
      localEnvironmentDisabled: isLocalEnvironmentDisabled(),
      environmentId,
      primaryEnvironmentId,
    });
    if (target === "remote") {
      toastManager.add({
        type: "error",
        title: "Folders can only be referenced in the local desktop environment",
      });
      return;
    }
    for (const folder of folders) {
      const path = resolveDroppedFolderPath(folder, window.desktopBridge?.getPathForFile);
      if (path === null) {
        toastManager.add({
          type: "error",
          title: `Couldn't get the path of "${folder.name}"`,
          description: "Type the folder path with @ instead.",
        });
        continue;
      }
      const inserted = insertComposerTextAtEndStable(`${serializeComposerFileLink(path)} `, {
        ensureLeadingBoundary: true,
      });
      if (!inserted) {
        toastManager.add({
          type: "error",
          title: "Unable to add folder",
          description: "The composer is busy; try again once it is ready.",
        });
        break;
      }
    }
    focusComposer();
  };
  const addComposerFoldersStable = useStableCallback(addComposerFolders);

  const onComposerPaste = (event: React.ClipboardEvent<HTMLElement>) => {
    const { files, folders } = splitTransferredFiles(event.clipboardData);
    const plainText = event.clipboardData.getData("text/plain");
    const bypassAutoAttachment = consumePasteAsTextShortcut(pasteAsTextShortcutUntilRef);
    if (
      folders.length > 0 ||
      (activeThreadId &&
        files.length > 0 &&
        shouldHandleComposerAttachmentPaste({ files, plainText }))
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (folders.length > 0) addComposerFoldersStable(folders);
      if (files.length > 0) {
        void addComposerAttachments(files, { skipImageInlineChip: bypassAutoAttachment });
      }
      return;
    }

    if ((readPastedComposerContext(event.clipboardData)?.records.length ?? 0) > 0) return;
    if (!foldPastedText(plainText, bypassAutoAttachment)) {
      // Paste-as-text keeps file paths as text; the editor would turn them into chips.
      if (bypassAutoAttachment && pastedFilePathsAsComposerFileLinks(plainText) !== null) {
        event.preventDefault();
        event.stopPropagation();
        insertComposerText(plainText, "cursor");
        return;
      }
      // This capture handler runs before the editor inserts the paste, and a link that resolves
      // without a fetch (a repository) would look for itself in the prompt too early. Wait a task.
      const pasteStart = readComposerSnapshot().expandedCursor;
      setTimeout(
        () => convertPastedObjectLinksRef.current?.(plainText, bypassAutoAttachment, pasteStart),
        0,
      );
      return;
    }

    event.preventDefault();
    event.stopPropagation();
  };
  // The editor is memoized; fresh closures here re-render it on every parent
  // render, which during a stream is every delta.
  const onComposerPasteStable = useStableCallback(onComposerPaste);
  const insertContextReferencesAtCaret = (
    references: ReadonlyArray<ComposerContextReference>,
  ): boolean =>
    insertComposerText(`${references.map(formatInlineContextReference).join(" ")} `, "cursor", {
      ensureLeadingBoundary: true,
    });
  const insertContextReferencesAtCaretStable = useStableCallback(insertContextReferencesAtCaret);
  const setContextInsertionHandler = useComposerDraftStore(
    (store) => store.setContextInsertionHandler,
  );
  // oxlint-disable-next-line t3code/react-effect-budget -- Register context insertion with the shared composer draft store.
  useEffect(() => {
    return setContextInsertionHandler(composerDraftTarget, insertContextReferencesAtCaretStable);
  }, [composerDraftTarget, insertContextReferencesAtCaretStable, setContextInsertionHandler]);

  // Capture drops before the editor; mention handlers own native propagation and moves.
  const composerMentionDragHandlers = makeComposerMentionDragHandlers({
    insertMentionAtEnd: (text) =>
      insertComposerTextAtEndStable(text, { ensureLeadingBoundary: true }),
    insertPullRequestAtEnd: (pullRequest) => {
      const comment = buildPullRequestReferenceContext(pullRequest);
      const inserted = insertComposerTextAtEndStable(
        `${formatInlineContextReference(reviewCommentContextReference(comment))} `,
        { ensureLeadingBoundary: true },
      );
      if (inserted) {
        addComposerDraftReviewComment(composerDraftTarget, comment, { appendReference: false });
      }
      return inserted;
    },
    setDragActive: setIsDragOverComposer,
    onInsertRejected: () => {
      toastManager.add({
        type: "error",
        title: "Unable to add to chat",
        description: "The composer is busy; try again once it is ready.",
      });
    },
  });

  const attachDroppedThreadFile = useEffectEvent((file: File) => addComposerAttachments([file]));
  const importDroppedThread = useEffectEvent(
    async (ref: ScopedThreadRef, isActive: () => boolean) => {
      const targetKey = attachmentTargetKey;
      pendingDraftWork.begin(targetKey);
      const loadingToast = toastManager.add({
        type: "loading",
        title: "Loading thread context…",
        timeout: 0,
        data: { threadRef: routeThreadRef, hideCopyButton: true },
      });
      const importResult = await settlePromise(() =>
        importComposerThreadAttachment({
          targetKey,
          pendingImports: pendingThreadImportsRef.current,
          countReservedAttachments: countReservedAttachmentsStable,
          load: async () => {
            const result = await loadThreadTranscript({
              environmentId: ref.environmentId,
              input: { threadId: ref.threadId },
            });
            if (result._tag !== "Success") {
              throw squashAtomCommandFailure(result);
            }
            return threadContextAttachment(ref.environmentId, result.value);
          },
          isActive,
          attach: attachDroppedThreadFile,
          onLimitReached: () => {
            if (activeThreadId) {
              setThreadError(
                activeThreadId,
                `You can attach up to ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} files per message.`,
              );
            }
          },
        }),
      );
      if (importResult._tag === "Failure" && isActive()) {
        const error = squashAtomCommandFailure(importResult);
        toastManager.add({
          type: "error",
          title: "Unable to read the dropped thread",
          description:
            isEnvironmentRequestInvalidError(error) &&
            error.reason === "thread_transcript_too_large"
              ? "This thread exceeds the attachment size limit. Try a shorter thread."
              : "Check that its environment is connected and up to date, then try again.",
        });
      }
      toastManager.close(loadingToast);
      pendingDraftWork.end(targetKey);
    },
  );

  useThreadContextDrop(composerFormRef, environmentId, attachmentTargetKey, (refs, isActive) => {
    const records = refs.flatMap((ref) => {
      if (ref.environmentId !== environmentId) {
        void importDroppedThread(
          ref,
          () => isActive() && attachmentTargetKeyRef.current === attachmentTargetKey,
        );
        return [];
      }
      const shell = readThreadShell(ref);
      return shell ? [threadContextRecord(ref, shell.title)] : [];
    });
    if (records.length === 0) return;
    if (questionAttachmentTarget !== null) {
      const canAnswer =
        canOperateThread &&
        !isConnecting &&
        !activePendingIsResponding &&
        activePendingProgress?.activeQuestion?.allowCustomAnswer !== false;
      const text = `${records
        .map((record) => formatInlineContextReference(threadContextReference(record)))
        .join(" ")} `;
      const snapshot = readComposerSnapshotStable();
      const cursor = snapshot.expandedCursor;
      const leadingSpace = cursor > 0 && !/\s/.test(snapshot.value[cursor - 1] ?? "");
      const inserted =
        canAnswer &&
        applyPromptReplacementStable(
          cursor,
          extendReplacementRangeForTrailingSpace(snapshot.value, cursor, text),
          leadingSpace ? ` ${text}` : text,
        );
      if (!inserted) {
        toastManager.add({
          type: "error",
          title: "Unable to add thread",
          description: "The composer is busy; try again once it is ready.",
        });
        return;
      }
      addComposerDraftThreadContexts(questionAttachmentTarget, records, {
        appendReference: false,
      });
      if (isComposerCollapsedMobile) expandMobileComposerStable();
    } else {
      addComposerDraftThreadContexts(composerDraftTarget, records);
    }
  });

  const onComposerMentionDragLeaveCapture = (event: React.DragEvent<HTMLFormElement>) => {
    if (!dataTransferHasComposerMention(event.dataTransfer.types)) return;
    event.stopPropagation();
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setIsDragOverComposer(false);
  };

  // Escape can cancel without dragleave; clear highlights on bubbling dragend.
  // oxlint-disable-next-line t3code/react-effect-budget -- Clear drag highlighting when the browser ends a native drag.
  useEffect(() => {
    if (!isDragOverComposer) return;
    const onWindowDragEnd = () => {
      setIsDragOverComposer(false);
    };
    window.addEventListener("dragend", onWindowDragEnd);
    return () => window.removeEventListener("dragend", onWindowDragEnd);
  }, [isDragOverComposer]);
  const handleInterruptPrimaryAction = () => {
    void onInterrupt();
  };
  const handleInterruptPrimaryActionStable = useStableCallback(handleInterruptPrimaryAction);
  const handleImplementPlanInNewThreadPrimaryAction = () => {
    void onImplementPlanInNewThread();
  };
  const handleImplementPlanInNewThreadPrimaryActionStable = useStableCallback(
    handleImplementPlanInNewThreadPrimaryAction,
  );
  const scheduleComposerCollapseCheck = () => {
    if (!isMobileViewport || mobileComposerExpandInFlightRef.current) {
      return;
    }
    if (composerBlurFrameRef.current !== null) {
      window.cancelAnimationFrame(composerBlurFrameRef.current);
    }
    composerBlurFrameRef.current = window.requestAnimationFrame(() => {
      composerBlurFrameRef.current = null;
      if (mobileComposerExpandInFlightRef.current) {
        return;
      }
      const composerSurface = composerSurfaceRef.current;
      const composerForm = composerFormRef.current;
      const activeElement = document.activeElement;
      if (isInsideRestingComposerControlScope(activeElement)) {
        return;
      }
      if (
        activeElement instanceof Node &&
        ((composerSurface && composerSurface.contains(activeElement)) ||
          (composerForm && composerForm.contains(activeElement)))
      ) {
        return;
      }
      setIsComposerFocused(false);
    });
  };
  const scheduleComposerCollapseCheckStable = useStableCallback(scheduleComposerCollapseCheck);

  // Question dismissal unmounts focused controls without firing blur.
  const activePendingUserInputRequestId = activePendingUserInput?.requestId ?? null;
  // oxlint-disable-next-line t3code/react-effect-budget -- Measure the composer after an external question closes.
  useEffect(() => {
    if (activePendingUserInputRequestId !== null) return;
    scheduleComposerCollapseCheckStable();
  }, [activePendingUserInputRequestId, scheduleComposerCollapseCheckStable]);

  // oxlint-disable-next-line t3code/react-effect-budget -- Cancel pending browser animation callbacks when the composer unmounts.
  useEffect(() => {
    return () => {
      if (composerBlurFrameRef.current !== null) {
        window.cancelAnimationFrame(composerBlurFrameRef.current);
      }
      if (mobileComposerExpandFrameRef.current !== null) {
        window.cancelAnimationFrame(mobileComposerExpandFrameRef.current);
      }
      if (mobileComposerExpandReleaseFrameRef.current !== null) {
        window.cancelAnimationFrame(mobileComposerExpandReleaseFrameRef.current);
      }
    };
  }, []);

  const openModelPicker = () => {
    if (composerControlsHidden) {
      if (composerBlurFrameRef.current !== null) {
        window.cancelAnimationFrame(composerBlurFrameRef.current);
        composerBlurFrameRef.current = null;
      }
      setIsComposerScrollCollapsed(false);
      setIsComposerFocused(true);
    }
    setIsComposerModelPickerOpen(true);
  };
  const openModelPickerStable = useStableCallback(openModelPicker);

  useImperativeHandle(
    composerRef,
    () => ({
      focusAtEnd: () => {
        composerEditorRef.current?.focusAtEnd();
      },
      focusAt: (cursor: number) => {
        composerEditorRef.current?.focusAt(cursor);
      },
      restoreAfterTimelineReachedEnd,
      collapseForTimelineScrollKey: (key) => {
        const scrollNode = getTimelineScrollableNode();
        if (
          composerScrollCollapseEligibleRef.current &&
          scrollNode &&
          shouldCollapseComposerForScrollKey({
            key,
            scrollTop: scrollNode.scrollTop,
            scrollHeight: scrollNode.scrollHeight,
            clientHeight: scrollNode.clientHeight,
            isAtLogicalEnd: isTimelineAtLogicalEnd(),
          })
        ) {
          setIsComposerScrollCollapsed(true);
        }
      },
      addDroppedFiles: (files: File[]) =>
        addComposerAttachments(files).then((inserted) => {
          if (!inserted) focusComposer();
          return inserted;
        }),
      addDroppedFolders: addComposerFoldersStable,
      hasPendingAttachments: () =>
        countPreparingComposerImages(attachmentTargetKey) > 0 ||
        pendingDraftWork.has(attachmentTargetKey),
      insertTextAtEnd: insertComposerTextAtEndStable,
      pasteTextAtEnd: (text: string, options) => {
        const shortcutArmed = consumePasteAsTextShortcut(pasteAsTextShortcutUntilRef);
        const bypassAutoAttachment = options?.bypassAutoAttachment === true || shortcutArmed;
        const promptLength = promptRef.current.length;
        if (
          !foldPastedText(text, bypassAutoAttachment, {
            start: promptLength,
            end: promptLength,
          })
        ) {
          return false;
        }
        focusComposer();
        return true;
      },
      citeAssistantText: (citation, sourceAnchor) =>
        insertComposerTextStable(
          formatAssistantCitationForComposer(citation, citation.comment),
          "cursor",
          { ensureLeadingBoundary: true, citationComment: { sourceAnchor } },
        ),
      openModelPicker: openModelPickerStable,
      stepReasoningEffort: (direction) => {
        if (noProviderAvailable || pendingUserInputs.length > 0 || isEditingQueuedMessage) {
          return;
        }
        const change = getComposerReasoningStep({
          provider: selectedProvider,
          instanceId: selectedInstanceId,
          model: selectedModel,
          models: selectedProviderModels,
          modelOptions: composerModelOptions?.[selectedInstanceId],
          reportedModelSelection,
          prompt: promptRef.current,
          cursor: readComposerSnapshotStable().expandedCursor,
          planModeEnabled: settings.planModeEnabled,
          direction,
        });
        if (!change) return;
        if (change.modelOptions) {
          useComposerDraftStore
            .getState()
            .setProviderModelOptions(composerDraftTarget, selectedProvider, change.modelOptions, {
              instanceId: selectedInstanceId,
              model: selectedModel,
              persistSticky: true,
            });
        }
        if (change.prompt !== promptRef.current) {
          applyPromptReplacementStable(0, promptRef.current.length, change.prompt, {
            expandedCursorAfterReplace: change.cursor,
          });
        }
      },
      toggleModelPicker: () => {
        if (isComposerModelPickerOpen) {
          setIsComposerModelPickerOpen(false);
        } else {
          openModelPickerStable();
        }
      },
      openControl: (command) => {
        if (composerBlurFrameRef.current !== null) {
          window.cancelAnimationFrame(composerBlurFrameRef.current);
          composerBlurFrameRef.current = null;
        }
        flushSync(() => {
          setIsComposerScrollCollapsed(false);
          setIsComposerFocused(true);
        });
        const shell = composerFormRef.current?.closest('[data-slot="composer-shell"]');
        const trigger = Array.from(
          shell?.querySelectorAll<HTMLButtonElement>(
            `button[data-composer-shortcut~="${command}"]:not(:disabled)`,
          ) ?? [],
        ).find(
          (element) =>
            !element.closest("[inert]") && element.checkVisibility({ visibilityProperty: true }),
        );
        if (!trigger) return;
        trigger.focus({ preventScroll: true });
        trigger.click();
      },
      compactContext: compactThreadContextStable,
      saveMessageDraft: async () => {
        await saveMessageDraftStable();
      },
      openMessageDraft: openMessageDraftStable,
      isModelPickerOpen: () => isComposerModelPickerOpen,
      isCaretAtStart: () => {
        const range = composerEditorRef.current?.readSelectionRange();
        return range !== undefined && range.start === 0 && range.end === 0;
      },
      readSnapshot: () => {
        return readComposerSnapshotStable();
      },
      resetCursorState: (options?: {
        cursor?: number;
        prompt?: string;
        detectTrigger?: boolean;
      }) => {
        const promptForState = options?.prompt ?? promptRef.current;
        const cursor = clampCollapsedComposerCursor(
          promptForState,
          options?.cursor ?? 0,
          isLiteralPendingAnswer,
        );
        setComposerHighlightedItemId(null);
        setComposerCursor(cursor);
        resetComposerTrigger(
          options?.detectTrigger && !isLiteralPendingAnswer
            ? detectComposerTrigger(
                promptForState,
                expandCollapsedComposerCursor(promptForState, cursor),
              )
            : null,
        );
      },
      addTerminalContext: (selection: TerminalContextSelection) => {
        if (!activeThread || isChoiceOnlyPendingQuestion || isLiteralPendingAnswer) return;
        const snapshot = readComposerSnapshotStable();
        const context = {
          id: randomUUID(),
          threadId: activeThread.id,
          createdAt: new Date().toISOString(),
          ...selection,
        };
        const insertion = insertInlineContextReference(
          snapshot.value,
          snapshot.expandedCursor,
          terminalContextReference(context),
        );
        const nextCollapsedCursor = collapseExpandedComposerCursor(
          insertion.prompt,
          insertion.cursor,
        );
        const inserted = insertComposerDraftTerminalContext(
          composerDraftTarget,
          insertion.prompt,
          context,
          composerTerminalContexts.length,
        );
        if (!inserted) return;
        promptRef.current = insertion.prompt;
        setComposerCursor(nextCollapsedCursor);
        setComposerTrigger(detectComposerTrigger(insertion.prompt, insertion.cursor));
        window.requestAnimationFrame(() => {
          composerEditorRef.current?.focusAt(nextCollapsedCursor);
        });
      },
      insertContextReference: (reference: ComposerContextReference) => {
        const snapshot = readComposerSnapshot();
        const insertion = insertInlineContextReference(
          snapshot.value,
          snapshot.expandedCursor,
          reference,
        );
        const nextCollapsedCursor = collapseExpandedComposerCursor(
          insertion.prompt,
          insertion.cursor,
        );
        promptRef.current = insertion.prompt;
        setPrompt(insertion.prompt);
        setComposerCursor(nextCollapsedCursor);
        setComposerTrigger(null);
        window.requestAnimationFrame(() => {
          composerEditorRef.current?.focusAt(nextCollapsedCursor);
        });
      },
      getSendContext: () => ({
        answeringPendingUserInput: activePendingProgress !== null,
        shownPendingApprovalIds: pendingApprovals
          .map((approval) => approval.requestId)
          .filter((requestId) => !heldRequestIds.has(requestId)),
        prompt: promptRef.current,
        images: composerImagesRef.current,
        files: composerFilesRef.current,
        terminalContexts: composerTerminalContextsRef.current,
        previewAnnotations: composerPreviewAnnotations,
        reviewComments: composerReviewComments,
        threadContexts: composerThreadContexts,
        selectedPromptEffort,
        selectedModelOptionsForDispatch,
        selectedModelSelection,
        multipleModelSelections:
          routeKind === "draft" && multipleModelSelections !== null
            ? multipleModelSelections.map((selection) =>
                selection.instanceId === selectedModelSelection.instanceId &&
                selection.model === selectedModelSelection.model
                  ? selectedModelSelection
                  : selection,
              )
            : null,
        providerAvailable:
          multipleModelSelections !== null ||
          (!noProviderAvailable && providerSendBlockReason === null),
        selectedProvider,
        selectedModel,
        selectedProviderModels,
        interactionMode,
        interactionModeEnabled: planModeUiEnabled,
      }),
      setMultipleModelSelections,
      validateProviderInput: (providerInput: string) => {
        const validationMessage = getComposerSubmissionValidationMessage({
          prompt: promptRef.current,
          providerInput,
          submissionTarget: "provider-turn",
        });
        providerInputRejectedRef.current = validationMessage !== null;
        setProviderInputSubmissionError(validationMessage);
        return validationMessage === null;
      },
    }),
    [
      activeThread,
      addComposerAttachments,
      addComposerFoldersStable,
      foldPastedText,
      composerDraftTarget,
      composerModelOptions,
      isEditingQueuedMessage,
      composerCursor,
      activePendingProgress,
      pendingApprovals,
      heldRequestIds,
      composerTerminalContexts,
      insertComposerDraftTerminalContext,
      insertComposerTextStable,
      insertComposerTextAtEndStable,
      promptRef,
      composerImagesRef,
      composerFilesRef,
      composerTerminalContextsRef,
      composerPreviewAnnotations,
      composerReviewComments,
      focusComposer,
      environmentId,
      primaryEnvironmentId,
      isConnecting,
      isChoiceOnlyPendingQuestion,
      isLiteralPendingAnswer,
      pendingUserInputs.length,
      projectSelectionRequired,
      applyPromptReplacementStable,
      isComposerModelPickerOpen,
      openModelPickerStable,
      readComposerSnapshotStable,
      resetComposerTrigger,
      setComposerTrigger,
      selectedModel,
      selectedInstanceId,
      reportedModelSelection,
      settings.planModeEnabled,
      selectedModelOptionsForDispatch,
      selectedModelSelection,
      multipleModelSelections,
      setMultipleModelSelections,
      routeKind,
      noProviderAvailable,
      providerSendBlockReason,
      selectedPromptEffort,
      selectedProvider,
      selectedProviderModels,
      interactionMode,
      planModeUiEnabled,
      compactThreadContextStable,
      saveMessageDraftStable,
      openMessageDraftStable,
      restoreAfterTimelineReachedEnd,
      getTimelineScrollableNode,
      isTimelineAtLogicalEnd,
      setIsComposerScrollCollapsed,
    ],
  );

  // Built outside the form's JSX so typing, which rebuilds that JSX, leaves them cached.
  const composerAttachmentMediaRow =
    !isComposerCollapsedMobile &&
    (uncommittedSnapShotIds.length > 0 ||
      composerVideos.length > 0 ||
      expandedComposerImages.length > 0 ||
      preparingComposerImages.length > 0) ? (
      <ComposerAttachmentMediaRow
        images={composerImages}
        expandedImages={expandedComposerImages}
        preparingImages={preparingComposerImages}
        videos={composerVideos}
        pendingSnapShotAnimations={pendingSnapShotAnimations}
        pendingSnapShotIds={pendingSnapShotIds}
        uncommittedSnapShotIds={uncommittedSnapShotIds}
        nonPersistedImageIds={nonPersistedComposerImageIds}
        snapShotAnimations={settings.snapShotAnimations}
        supportsAttachmentUploads={supportsAttachmentUploads}
        maxFileAttachmentBytes={maxFileAttachmentBytes}
        environmentId={environmentId}
        attachmentDraftTarget={attachmentDraftTarget}
        canOperateThread={canOperateThread}
        onExpandImage={onExpandImage}
        onFileOpen={onFileOpen}
        onRemoveImage={removeComposerImage}
        onRemoveFile={removeComposerFileFromDraft}
      />
    ) : null;
  const composerAttachmentFileList =
    !isComposerCollapsedMobile && composerOtherFiles.length > 0 ? (
      <ComposerAttachmentFileList
        files={composerOtherFiles}
        resolvedTheme={resolvedTheme}
        supportsAttachmentUploads={supportsAttachmentUploads}
        maxFileAttachmentBytes={maxFileAttachmentBytes}
        fileStagingLimit={fileStagingLimit}
        environmentId={environmentId}
        attachmentDraftTarget={attachmentDraftTarget}
        canOperateThread={canOperateThread}
        onPreviewFile={setPreviewFileId}
        onRemoveFile={removeComposerFileFromDraft}
      />
    ) : null;
  const composerAttachButton = showComposerAttachAction ? (
    <>
      <input
        ref={attachmentInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          // Inserting a chip refocuses the editor after the draft renders;
          // focusing synchronously here would report the editor's stale text
          // over the prompt that was just written.
          void addComposerAttachments(files).then((inserted) => {
            if (!inserted) focusComposer();
          });
        }}
      />
      <span ref={setAttachMenuAnchor} className="inline-flex">
        <ComposerAttachMenu
          environmentId={environmentId}
          pullRequestsAvailable={pullRequestProjectId !== null}
          githubIssuesAvailable={githubIssueCwd !== null}
          checkoutsAvailable={attachCheckouts.hasLocalCandidates}
          onAttachFiles={() => attachmentInputRef.current?.click()}
          onPick={(picker) => openComposerAttachPicker(picker, routeThreadRef)}
          onPickModel={() => setIsModelChipPickerOpen(true)}
        />
      </span>
      <ComposerModelChipPicker
        open={isModelChipPickerOpen}
        onOpenChange={setIsModelChipPickerOpen}
        anchor={attachMenuAnchor}
        environmentId={environmentId}
        activeInstanceId={selectedInstanceId}
        model={selectedModelForPickerWithCustomFallback}
        instanceEntries={providerInstanceEntries}
        modelOptionsByInstance={modelOptionsByInstance}
        keybindings={keybindings}
        terminalOpen={terminalOpen}
        onPick={(instanceId, model) => {
          const entry = providerInstanceEntries.find(
            (candidate) => candidate.instanceId === instanceId,
          );
          if (!entry) return;
          const option = modelOptionsByInstance
            .get(instanceId)
            ?.find((candidate) => candidate.slug === model);
          attachModelToChat(routeThreadRef, {
            entry,
            slug: model,
            name: option?.name ?? model,
          });
        }}
      />
    </>
  ) : null;
  return (
    <form
      ref={composerFormRef}
      onSubmit={submitComposerStable}
      onPointerDownCapture={(event) => {
        const target = event.target;
        if (isInsideRestingComposerControlScope(target)) return;
        if (isInsideCollapsedComposerControls(target)) return;
        if (!(target instanceof Element)) return;
        const isInteractive = Boolean(
          target.closest('button, a, input, select, [role="button"], [role="menuitem"]'),
        );
        if (isInteractive) return;

        setIsComposerScrollCollapsed(false);
        if (isComposerResting && !target.closest('[data-testid="composer-editor"]')) {
          event.preventDefault();
          setIsComposerFocused(true);
          scheduleComposerFocus();
        }
      }}
      onFocusCapture={(event) => {
        const activeElement = event.target;
        if (
          activeElement instanceof Element &&
          activeElement.closest('[data-testid="composer-editor"]')
        ) {
          onTypingGuardFocus();
        }
        if (composerControlsCollapsed && isInsideRestingComposerControlScope(activeElement)) {
          return;
        }
        if (isInsideCollapsedComposerControls(activeElement)) {
          return;
        }
        if (!windowRefocusInFlightRef.current) {
          setIsComposerScrollCollapsed(false);
        }
        if (composerBlurFrameRef.current !== null) {
          window.cancelAnimationFrame(composerBlurFrameRef.current);
          composerBlurFrameRef.current = null;
        }
        setIsComposerFocused(true);
      }}
      onBlurCapture={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest('[data-testid="composer-editor"]')
        ) {
          onTypingGuardBlur();
        }
        scheduleComposerCollapseCheck();
      }}
      onDragEnterCapture={(event) => {
        if (isInsideRestingComposerControlScope(event.target)) return;
        composerMentionDragHandlers.onDragEnter(event);
      }}
      onDragOverCapture={(event) => {
        if (isInsideRestingComposerControlScope(event.target)) return;
        composerMentionDragHandlers.onDragOver(event);
      }}
      onDragLeaveCapture={(event) => {
        if (isInsideRestingComposerControlScope(event.target)) return;
        onComposerMentionDragLeaveCapture(event);
      }}
      onDropCapture={(event) => {
        if (isInsideRestingComposerControlScope(event.target)) return;
        composerMentionDragHandlers.onDrop(event);
      }}
      className="mx-auto w-full min-w-0 max-w-(--chat-content-max-width)"
      data-chat-composer-form="true"
      {...threadContextDropTargetProps()}
    >
      {composerControlsCollapsed && restingControlsHost
        ? createPortal(
            <div
              ref={attachRestingComposerControls}
              data-chat-composer-resting-controls="true"
              aria-hidden={restingControlsVisible ? undefined : true}
              inert={restingControlsVisible ? undefined : true}
              className={cn(
                "relative flex w-max min-w-0 max-w-full items-center gap-1 font-normal text-muted-foreground/70 [&_button]:text-xs!",
                !restingControlsVisible && "invisible",
              )}
            >
              {composerControls}
            </div>,
            restingControlsHost,
          )
        : null}
      <ComposerBanner.Dock>
        <ComposerBanner.Column>
          <ComposerBannerStack
            key={activeThreadId}
            className="relative z-0"
            items={bannerStackItems}
            attachedAbove={props.queuedRunsControl}
          />
          {!activityStackItem && (shownSyncPhase || inlineTasksBadge) ? (
            <ComposerBanner.Attachment>
              <ComposerBanner.Root data-chat-composer-activity-strip="true">
                {shownSyncPhase ? <ComposerActivityRow phase={shownSyncPhase} /> : inlineTasksBadge}
              </ComposerBanner.Root>
            </ComposerBanner.Attachment>
          ) : null}
          {showComposerTopDrawer && (!isTasksDrawerOpen || hasBlockingComposerTopDrawer) ? (
            <ComposerBanner.Attachment>
              <ComposerBanner.Root
                data-chat-composer-top-drawer="true"
                variant={activePendingApproval ? "warning" : "info"}
                density={activePendingApproval ? "spacious" : "default"}
              >
                {activePendingApproval ? (
                  <ComposerBanner.Row
                    layout="approval"
                    data-chat-composer-collapsed-controls="true"
                  >
                    <ComposerBanner.Icon>
                      <ShieldIcon />
                    </ComposerBanner.Icon>
                    <ComposerBanner.Content>
                      <ComposerPendingApprovalPanel
                        approval={activePendingApproval}
                        pendingCount={pendingApprovals.length}
                      />
                    </ComposerBanner.Content>
                    <ComposerBanner.Actions>
                      <ComposerPendingApprovalActions
                        requestId={activePendingApproval.requestId}
                        disabled={!canOperateThread}
                        isResponding={respondingRequestIds.includes(
                          activePendingApproval.requestId,
                        )}
                        options={activePendingApproval.options}
                        canRespond={activePendingApproval.responseCapability === "live"}
                        onRespondToApproval={onRespondToApproval}
                      />
                    </ComposerBanner.Actions>
                  </ComposerBanner.Row>
                ) : pendingUserInputs.length > 0 ? (
                  <ComposerPendingUserInputPanel
                    pendingUserInputs={pendingUserInputs}
                    cwd={gitCwd ?? undefined}
                    threadRef={routeThreadRef}
                    disabled={!canOperateThread}
                    respondingRequestIds={
                      activePendingIsResponding && activePendingUserInput
                        ? [...respondingRequestIds, activePendingUserInput.requestId]
                        : respondingRequestIds
                    }
                    answers={activePendingDraftAnswers}
                    questionIndex={activePendingQuestionIndex}
                    onToggleOption={onSelectActivePendingUserInputOption}
                    onAdvance={onAdvanceActivePendingUserInput}
                    onDismiss={onDismissActivePendingUserInput}
                  />
                ) : !isComposerCollapsedMobile && showPlanFollowUpPrompt && activeProposedPlan ? (
                  <ComposerPlanFollowUpBanner
                    key={activeProposedPlan.id}
                    planTitle={proposedPlanTitle(activeProposedPlan.planMarkdown) ?? null}
                  />
                ) : null}
              </ComposerBanner.Root>
            </ComposerBanner.Attachment>
          ) : null}
          {!activityStackItem &&
          isTasksDrawerOpen &&
          !hasBlockingComposerTopDrawer &&
          activeTasksProgress &&
          activeTaskSteps ? (
            <ComposerTasksDrawer
              onCollapse={toggleTasksDrawerStable}
              progress={activeTasksProgress}
              steps={activeTaskSteps}
            />
          ) : null}
          {showTasksTab ? (
            <ComposerBanner.Attachment>
              <ComposerTasksBadge
                expanded={false}
                onToggle={toggleTasksDrawerStable}
                progress={activeTasksProgress}
                steps={activeTaskSteps}
              />
            </ComposerBanner.Attachment>
          ) : null}
        </ComposerBanner.Column>
        <ComposerStashBadge
          count={stashQueue.length}
          menuOpen={isStashMenuOpen}
          pulseKey={stashPulseKey}
          onToggleMenu={toggleStashMenuStable}
        />
      </ComposerBanner.Dock>
      <div className="relative">
        <ComposerSurface.Main
          ref={composerMainSurfaceRef}
          data-inline-resting-controls={restingControlsHost === null ? "true" : undefined}
          data-model-only-strip={
            restingControlsHost?.closest("[data-composer-model-strip]") ? "true" : undefined
          }
          className={composerProviderState.composerFrameClassName}
        >
          <div
            ref={composerSurfaceRef}
            data-chat-composer-surface="true"
            data-chat-composer-mobile-collapsed={isComposerCollapsedMobile ? "true" : "false"}
            className={cn(
              "rounded-2xl transition-[background-color] duration-200",
              "in-data-[thread-context-over]:bg-accent/45 in-data-[thread-context-over]:ring-1 in-data-[thread-context-over]:ring-inset in-data-[thread-context-over]:ring-primary/70",
              isDragOverComposer ? "bg-accent/45 ring-1 ring-inset ring-primary/70" : null,
              projectSelectionRequired ? "opacity-75" : null,
              composerProviderState.composerSurfaceClassName,
            )}
          >
            {showCollapsedMobilePromptRow ? (
              <div className="flex items-center justify-between gap-2 px-3 py-2">
                <button
                  type="button"
                  data-chat-composer-transition-prompt="true"
                  className={cn(
                    "min-w-0 flex-1 truncate bg-transparent p-0 text-left text-sm focus:outline-none",
                    prompt.trim() ? "text-foreground" : "text-placeholder",
                  )}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={expandMobileComposerStable}
                  aria-label="Expand composer"
                >
                  {prompt.trim() ||
                    (showProviderUnavailable ? "Enable a provider in Settings" : "Ask anything...")}
                </button>
                {collapsedComposerImagePreviews}
                {/* Disabled buttons take no pointer events, so the wrapper hears the right-click. */}
                <span
                  className="flex shrink-0"
                  onContextMenu={(event) => void openSendContextMenuStable(event, "send")}
                >
                  <button
                    type="button"
                    data-chat-composer-transition-actions="true"
                    className="flex size-8 shrink-0 items-center justify-center rounded-full bg-message-action text-message-action-foreground hover:bg-message-action-hover disabled:opacity-64"
                    disabled={collapsedComposerPrimaryActionDisabled}
                    aria-label={collapsedComposerPrimaryActionLabel}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (showResumeAction) onResume();
                      else if (props.resumeCompactionTokens !== null && !props.keepFullHistory)
                        expandMobileComposer();
                      else submitComposer();
                    }}
                  >
                    {showResumeAction ? (
                      <PlayIcon className="size-4 fill-current" aria-hidden="true" />
                    ) : (
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 16 16"
                        fill="none"
                        aria-hidden="true"
                      >
                        <path
                          d="M8 3L8 13M8 3L4 7M8 3L12 7"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </button>
                </span>
              </div>
            ) : null}

            <div
              ref={(node) => {
                setComposerMenuAnchor(node);
                const stopObserving = observeWrappedPrompt(node);
                return () => {
                  setComposerMenuAnchor(null);
                  stopObserving?.();
                };
              }}
              data-chat-composer-body="true"
              className={cn(
                "relative px-3 pb-2 sm:px-4",
                "pt-3.5 sm:pt-4",
                isComposerCollapsedMobile && "hidden",
                isComposerResting && "py-2 sm:py-2",
              )}
            >
              {onStartFrom && !isComposerResting ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="absolute end-2 top-2 z-10 sm:end-2.5 sm:top-2.5"
                        aria-label="Start from a pull request, branch, issue, or automation"
                        onClick={onStartFrom}
                      />
                    }
                  >
                    <EllipsisIcon />
                  </TooltipTrigger>
                  <TooltipPopup>
                    Start from a PR, branch, issue, or automation
                    {startFromShortcutLabel ? ` (${startFromShortcutLabel})` : null}
                  </TooltipPopup>
                </Tooltip>
              ) : null}
              {isStashMenuOpen && !composerMenuOpen && (
                <ComposerCommandMenuLayer anchor={composerMenuAnchor}>
                  <ComposerStashMenu
                    composerFormRef={composerFormRef}
                    entries={stashQueue}
                    stashShortcutLabel={shortcutLabelForCommand(keybindings, "composer.stash", {
                      context: {
                        terminalFocus: false,
                        terminalOpen,
                        modelPickerOpen: false,
                      },
                    })}
                    onRestore={restoreStashEntryStable}
                    onDelete={deleteStashEntryStable}
                    onClose={() => setIsStashMenuOpen(false)}
                  />
                </ComposerCommandMenuLayer>
              )}

              <div role="status" aria-atomic="true" className="sr-only">
                {composerSuggestionsVisible && composerMenuItems.length === 0
                  ? isComposerMenuLoading
                    ? composerTriggerKind === "pull-request"
                      ? (referenceMenu.loadingText ?? "Finding pull request...")
                      : "Searching workspace files..."
                    : composerMenuEmptyState
                  : ""}
              </div>
              {composerSuggestionsVisible && (
                <ComposerCommandMenuLayer anchor={composerMenuAnchor}>
                  <ComposerCommandMenu
                    listId={composerSuggestionListId}
                    items={composerMenuItems}
                    resolvedTheme={resolvedTheme}
                    isLoading={isComposerMenuLoading}
                    triggerKind={composerTriggerKind}
                    emptyStateText={
                      isPathTrigger && pathTab === "agents"
                        ? pathTriggerQuery
                          ? `No agent matches ${pathTriggerQuery}.`
                          : "This thread has no agents."
                        : isPathTrigger && pathTab === "models"
                          ? pathTriggerQuery
                            ? `No model matches ${pathTriggerQuery}.`
                            : "No models available."
                          : isPathTrigger && pathTab === "chats"
                            ? pathTriggerQuery
                              ? `No chat matches ${pathTriggerQuery}.`
                              : "No other chats yet."
                            : composerMenuEmptyState
                    }
                    activeItemId={activeComposerMenuItem?.id ?? null}
                    onHighlightedItemChange={onComposerMenuItemHighlightedStable}
                    onSelect={onSelectComposerItemStable}
                    environmentId={environmentId}
                    {...(referenceMenu.open
                      ? {
                          ...(referenceMenu.tabs
                            ? {
                                tabs: {
                                  options: referenceMenu.tabs,
                                  activeId: referenceMenu.tab,
                                  onSelect: referenceMenu.chooseTab,
                                },
                              }
                            : {}),
                          ...(referenceMenu.loadingText
                            ? { loadingText: referenceMenu.loadingText }
                            : {}),
                          ...(referenceMenu.hint ? { hint: referenceMenu.hint } : {}),
                          selection: {
                            itemIds: selectedReferenceItemIds,
                            onCommit: commitReferenceSelection,
                          },
                        }
                      : {})}
                    {...(isPathTrigger
                      ? {
                          tabs: {
                            options: agentMenu.available
                              ? PATH_MENU_TABS
                              : PATH_MENU_TABS.filter((tab) => tab.id !== "agents"),
                            activeId: pathTab,
                            onSelect: (id: string) => {
                              const tab = PATH_MENU_TABS.find((option) => option.id === id);
                              if (!tab) return;
                              setPathTabChoice({
                                rangeStart: composerTrigger.rangeStart,
                                tab: tab.id,
                              });
                            },
                          },
                          ...(pathTab === "models"
                            ? {
                                filters: (
                                  <ComposerModelFilters
                                    instances={modelMenu.instances}
                                    selected={modelInstanceFilter}
                                    onSelect={(instanceId) =>
                                      setModelFilterChoice({
                                        rangeStart: composerTrigger.rangeStart,
                                        instanceId,
                                      })
                                    }
                                  />
                                ),
                              }
                            : {}),
                        }
                      : {})}
                  />
                </ComposerCommandMenuLayer>
              )}

              {!isComposerCollapsedMobile &&
                pendingUserInputs.length === 0 &&
                editingQueuedAttachments !== null &&
                editingQueuedAttachments.length > 0 && (
                  <ComposerQueuedAttachmentRow
                    attachments={editingQueuedAttachments}
                    onRemove={onRemoveEditingQueuedAttachment}
                  />
                )}

              {composerAttachmentMediaRow}

              {composerAttachmentFileList}

              <div
                className={cn("relative", isComposerResting && "flex min-w-0 items-center gap-1")}
                style={
                  isComposerResting && restingActionsWidth !== null
                    ? { paddingRight: `calc(${restingActionsWidth}px + 1rem)` }
                    : undefined
                }
              >
                {previewFile ? (
                  <ComposerFilePreviewDialog
                    file={previewFile}
                    onRemove={removeComposerFileFromDraft}
                    onPreviewFileIdChange={setPreviewFileId}
                  />
                ) : null}
                <ComposerContextActionsContext value={composerContextActions}>
                  <ComposerPromptEditor
                    draftKey={composerDraftTargetKey}
                    // Switching threads lands focus here, so the label names the thread.
                    ariaLabel={activeThread ? `Message ${activeThread.title}` : "Message"}
                    suggestionListId={composerSuggestionListId}
                    activeSuggestionId={
                      composerSuggestionListVisible && activeComposerMenuItem
                        ? composerSuggestionOptionId(
                            composerSuggestionListId,
                            activeComposerMenuItem.id,
                          )
                        : undefined
                    }
                    editorRef={composerEditorRef}
                    richTextEnabled={settings.composerRichTextEnabled}
                    literalText={isLiteralPendingAnswer}
                    isPathQueryActive={isPathQueryActiveStable}
                    value={activePendingProgress ? activePendingProgress.customAnswer : prompt}
                    cursor={composerCursor}
                    contextRecords={composerContextRecords}
                    loadingLinkUrls={loadingObjectLinks
                      .filter((entry) => entry.workKey === attachmentTargetKey)
                      .map((entry) => entry.url)}
                    buildContextClipboardFragment={buildContextClipboardFragmentStable}
                    importContextFragment={importContextFragmentStable}
                    skills={selectedProviderSkills}
                    containerClassName={cn(
                      isComposerResting && "min-w-0 flex-1",
                      onStartFrom && !isComposerResting && "pe-7",
                    )}
                    className={cn(
                      showMobilePendingAnswerActions && "max-sm:pb-12",
                      isComposerResting &&
                        "my-0 max-h-8 min-h-8 redesign:min-h-8 overflow-hidden py-0 whitespace-pre! leading-8",
                    )}
                    placeholderClassName={cn(
                      isComposerResting &&
                        "flex items-center overflow-hidden whitespace-nowrap leading-8",
                    )}
                    onChange={onPromptChangeStable}
                    onVisibleSelectionChange={expandComposerForEditorChangeStable}
                    onCommandKeyDown={onComposerCommandKeyStable}
                    onPageScrollKeyDown={onPageScrollKeyDown}
                    onPageScrollKeyUp={onPageScrollKeyUp}
                    onPageScrollRelease={onPageScrollRelease}
                    onCitationSubmitAndSend={submitCitationAndSendStable}
                    onCitationSubmitAndSaveDraft={
                      canSaveMessageDraft ? saveCitationAsDraftStable : undefined
                    }
                    citationSendQueues={citationSendDispatchMode === "queue"}
                    citationDestinations={
                      onSendCitationElsewhere && activeThreadId && activeProjectId
                        ? {
                            environmentId,
                            threadId: activeThreadId,
                            projectId: activeProjectId,
                            modelSelection: selectedModelSelection,
                            followUpBehavior: settings.followUpBehavior,
                            onSubmit: onSendCitationElsewhere,
                          }
                        : undefined
                    }
                    onCitationDraftSave={saveCitationDraftToPromptStable}
                    onPaste={onComposerPasteStable}
                    placeholder={
                      isComposerApprovalState
                        ? activePendingApproval?.supportsFeedback
                          ? "Send feedback to decline this request"
                          : "Send a message to decline and redirect the agent"
                        : activePendingProgress
                          ? isChoiceOnlyPendingQuestion
                            ? "Choose an option above"
                            : "Type your own answer, or leave this blank to use the selected option"
                          : showPlanFollowUpPrompt && activeProposedPlan
                            ? "Add feedback to refine the plan, or leave this blank to implement it"
                            : projectSelectionRequired
                              ? "Choose a project above to start a thread"
                              : showProviderUnavailable
                                ? "Enable a provider in Settings to send a message"
                                : DEFAULT_COMPOSER_PLACEHOLDER
                    }
                    disabled={
                      isConnecting ||
                      projectSelectionRequired ||
                      isChoiceOnlyPendingQuestion ||
                      activePendingIsResponding
                    }
                  />
                </ComposerContextActionsContext>
                {isComposerResting ? collapsedComposerImagePreviews : null}
                {showMobilePendingAnswerActions ? (
                  <div
                    data-chat-composer-mobile-pending-actions="true"
                    className="absolute bottom-0 right-0 flex items-center justify-end gap-1"
                  >
                    <ComposerPrimaryActions
                      compact
                      canOperateThread={canOperateThread}
                      pendingAction={pendingPrimaryAction}
                      isRunning={false}
                      canInterrupt={false}
                      showPlanFollowUpPrompt={false}
                      promptHasText={false}
                      isSendBusy={isSendBusy}
                      sendDisabledReason={sendDisabledReason}
                      isConnecting={isConnecting}
                      isEnvironmentUnavailable={
                        environmentUnavailable !== null ||
                        noProviderAvailable ||
                        projectSelectionRequired
                      }
                      isPreparingWorktree={false}
                      hasSendableContent={false}
                      preserveComposerFocusOnPointerDown
                      onPreviousPendingQuestion={onPreviousActivePendingUserInputQuestion}
                      onInterrupt={handleInterruptPrimaryActionStable}
                      onImplementPlanInNewThread={handleImplementPlanInNewThreadPrimaryActionStable}
                    />
                  </div>
                ) : null}
              </div>
            </div>

            <ComposerPromptLengthValidation
              message={providerInputSubmissionError ?? composerSubmissionError}
            />

            {isComposerCollapsedMobile ? null : (
              <div
                data-chat-composer-footer="true"
                data-chat-composer-footer-compact={isComposerFooterCompact ? "true" : "false"}
                className={cn(
                  "flex min-w-0 flex-nowrap items-center justify-between gap-2 overflow-visible px-3 pb-3 sm:px-4 sm:pb-4",
                  pendingUserInputs.length > 0 && "pt-2",
                  isComposerFooterCompact ? "gap-1.5" : "gap-2 sm:gap-0",
                  showMobilePendingAnswerActions && "hidden sm:flex",
                  isComposerResting &&
                    "absolute right-px z-10 h-12 w-auto gap-0 py-0 sm:gap-0 sm:py-0",
                  isComposerResting &&
                    (showInlineRestingControls ? "bottom-[calc(2rem+1px)]" : "bottom-px"),
                )}
              >
                <div
                  ref={attachExpandedComposerControls}
                  data-chat-composer-controls="left"
                  data-chat-composer-footer-controls="true"
                  className={cn(
                    "relative -m-1 -ms-3.5 flex min-w-0 flex-1 items-center gap-0 overflow-x-auto p-1 ps-3.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
                    isComposerResting && "hidden",
                  )}
                >
                  {composerControlsCollapsed ? null : composerControls}
                </div>

                <div
                  ref={setRestingActionsElement}
                  data-chat-composer-actions="right"
                  data-chat-composer-transition-actions="true"
                  data-chat-composer-primary-actions-compact={
                    isComposerPrimaryActionsCompact ? "true" : "false"
                  }
                  className="flex shrink-0 flex-nowrap items-center justify-end gap-2"
                >
                  {composerAttachButton}
                  <ComposerFooterPrimaryActions
                    compact={isComposerResting || isComposerPrimaryActionsCompact}
                    canOperateThread={canOperateThread}
                    activeContextWindow={
                      settings.contextWindowMeterEnabled ? activeContextWindow : null
                    }
                    threadUsage={threadUsage}
                    reserveContextWindowMeter={reserveContextWindowMeter}
                    activeThreadModelDisplayName={activeThreadModelDisplayName}
                    pendingAction={pendingPrimaryAction}
                    isRunning={phase === "running"}
                    canInterrupt={canInterrupt}
                    followUpBehavior={followUpBehavior}
                    canSteer={!isCompacting}
                    alternateShortcutLabel={shortcutLabelForCommand(
                      keybindings,
                      "composer.sendAlternate",
                      {
                        context: {
                          composerFocus: true,
                          draftThreadRoute: routeKind === "draft",
                          turnRunning: true,
                          composerRequiresModifier: composerRequiresModifier(
                            settings.sendShortcut,
                            prompt,
                          ),
                        },
                      },
                    )}
                    showPlanFollowUpPrompt={
                      pendingUserInputs.length === 0 && showPlanFollowUpPrompt
                    }
                    promptHasText={prompt.trim().length > 0}
                    isSendBusy={isSendBusy}
                    sendDisabledReason={sendDisabledReason}
                    isConnecting={isConnecting}
                    isEnvironmentUnavailable={
                      environmentUnavailable !== null ||
                      noProviderAvailable ||
                      projectSelectionRequired
                    }
                    isPreparingWorktree={isPreparingWorktree}
                    createWithoutMessage={
                      multipleModelSelections === null ? createWithoutMessage : null
                    }
                    hasSendableContent={composerSendState.hasSendableContent}
                    canResume={showResumeAction}
                    preserveComposerFocusOnPointerDown={isMobileViewport || isComposerResting}
                    isEditingQueuedMessage={isEditingQueuedMessage}
                    onSubmitMessage={handleSubmitMessageStable}
                    onResume={onResume}
                    onPreviousPendingQuestion={onPreviousActivePendingUserInputQuestion}
                    onInterrupt={handleInterruptPrimaryActionStable}
                    onImplementPlanInNewThread={handleImplementPlanInNewThreadPrimaryActionStable}
                    compactBeforeSendTokens={props.resumeCompactionTokens}
                    keepFullHistory={props.keepFullHistory}
                    onToggleKeepFullHistory={props.onToggleKeepFullHistory}
                    onSendContextMenu={openSendContextMenuStable}
                    compactDisabled={
                      compactDisabled || noProviderAvailable || isSendBusy || isConnecting
                    }
                    compactDisabledReason={resolvedCompactDisabledReason}
                    {...(compactCommandAvailable
                      ? { onCompactContext: compactThreadContextStable }
                      : {})}
                  />
                </div>
              </div>
            )}
            {showInlineRestingControls ? (
              <div className="h-8">
                <div
                  ref={setInlineRestingControlsHost}
                  className="absolute bottom-2 inset-x-4 min-w-0"
                >
                  <div
                    ref={restingComposerControlsRef}
                    data-chat-composer-resting-controls="true"
                    aria-hidden={restingControlsVisible ? undefined : true}
                    inert={restingControlsVisible ? undefined : true}
                    className={cn(
                      "relative flex w-max min-w-0 max-w-full items-center gap-1 text-muted-foreground/70 [&_button]:text-xs!",
                      !restingControlsVisible && "invisible",
                    )}
                  >
                    {composerControls}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </ComposerSurface.Main>
      </div>
    </form>
  );
});
