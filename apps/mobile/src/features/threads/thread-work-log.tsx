import {
  toolEntryShowsPathBreadcrumbs,
  toolPathTargets,
} from "@t3tools/client-runtime/work-log/tool-paths";
import { ToolPathText } from "./ToolPathText";
import { ToolPreviewCard } from "./ToolPreviewCard";
import { Button } from "../../components/ui/Button";
import { SubagentStatusDot } from "./SubagentStatusDot";
import { ThreadSubagentGroup } from "./thread-subagent-group";
import {
  WorkLogLabel,
  WorkLogBlock,
  WorkLogRows,
  WorkLogIconSlot,
  WorkLogPressable,
} from "./work-log-layout";
import { QuestionAnswerHistory } from "./QuestionAnswerHistory";
import { ThreadCommandOutput, useCommandOutputStreaming } from "./thread-command-output";
import {
  getQuestionAnswerPreview,
  hasQuestionAnswer,
} from "@t3tools/client-runtime/work-log/user-input";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { type AppSymbolName, SymbolView } from "../../components/ui/AppSymbol";
import { MaskedView } from "@expo/ui/community/masked-view";
import type { LegendListRef } from "@legendapp/list/react-native";
import { AnimatedLegendList } from "@legendapp/list/reanimated";
import { StackActions, useIsFocused, useNavigation } from "@react-navigation/native";
import {
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import {
  AccessibilityInfo,
  Animated as NativeAnimated,
  AppState,
  type ColorValue,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  useAnimatedValue,
  View,
} from "react-native";
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from "react-native-svg";
import {
  ORCHESTRATION_V2_WORKSPACE_PREPARATION_FAILURE_CODE,
  type EnvironmentId,
  type RunId,
  type ThreadId,
  type ToolActivityIcon,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { environmentThreadDetails, threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { toolActivityBrandMark, toolActivityFaviconUrl } from "@t3tools/shared/favicon";
import { isJavaScriptReplTool } from "@t3tools/shared/toolActivity";
import { useMarkdownCodeHighlight } from "./markdownCodeHighlightState";

import { AppText as Text } from "../../components/ui/AppText";
import { T3Wordmark } from "../../components/T3Wordmark";
import { BrowserAppIcon } from "./BrowserAppIcon";
import { cn } from "../../lib/cn";
import { THREAD_WORK_ROW_MIN_HEIGHT, type deriveThreadWorkLogSizing } from "../../lib/layout";
import {
  type AgentSpawnSummary,
  formatItemFullDetail,
  type ThreadFeedActivity,
  workEntryRowLabel,
} from "../../lib/threadActivity";
import {
  fileChangePreviewText,
  toolCallLines,
  turnItemOutputImages,
  turnItemOutputText,
} from "@t3tools/client-runtime/work-log/item-detail";
import { resolveToolPreview } from "@t3tools/client-runtime/work-log/tool-preview";
import { useTurnItemDetail } from "../../state/queries";
import {
  resolveThreadWorkGroupInitialScroll,
  shouldFollowThreadWorkGroupAppend,
  type ThreadWorkGroupScrollPosition,
} from "./thread-feed-live-follow";
import {
  resolveWorkEntryToolPresentation,
  toolGroupAction,
  type ToolGroupSummaryKind,
  workEntryViewedImagePath,
} from "@t3tools/client-runtime/work-log/presentation";
import { resolveWorkGroupScrollAnchor } from "@t3tools/client-runtime/work-log/scroll-anchor";
import { notificationChildThreadId } from "@t3tools/client-runtime/state/thread-execution";
import type { MarkdownImageRenderer } from "../../native/SelectableMarkdownText";
import type { FilePreviewSource } from "../../components/FilePreviewModal";
import { FilePreviewGallery } from "../../components/FilePreviewGallery";
import { ThreadMarkdownImage } from "./ThreadMarkdownImage";
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useAssetUrl } from "../../state/assets";
import { PullRequestGlyph } from "../pull-requests/pullRequestGlyphs";

const SHIMMER_WIDTH = 72;
const SHIMMER_SWEEP_MS = 1_350;
const SHIMMER_PAUSE_MS = 1_450;
const SHIMMER_ICON_AND_GAP_WIDTH = 30;
export const THREAD_DISCLOSURE_TRANSITION_MS = 180;
const WORK_LOG_LAYOUT_TRANSITION = LinearTransition.duration(THREAD_DISCLOSURE_TRANSITION_MS);
const WORK_LOG_DETAIL_ENTER_TRANSITION = FadeIn.duration(140);
const WORK_LOG_DETAIL_EXIT_TRANSITION = FadeOut.duration(120);
type WorkContentIcon =
  | AppSymbolName
  | "browser"
  | "computer"
  | "device"
  | "t3-code"
  | "pull-request";

function WorkLogIcon(props: {
  readonly icon: WorkContentIcon;
  readonly color: ColorValue;
  readonly colorClassName?: string;
  readonly highlighted?: boolean;
}) {
  const colorClassName = props.highlighted ? "accent-foreground" : props.colorClassName;
  if (props.icon === "t3-code") {
    return (
      <T3Wordmark height={10} {...(colorClassName ? { colorClassName } : { color: props.color })} />
    );
  }
  if (props.icon === "computer") {
    return (
      <BrowserAppIcon
        size={14}
        {...(colorClassName ? { colorClassName } : { color: props.color })}
      />
    );
  }
  return (
    <SymbolView
      name={
        props.icon === "pull-request"
          ? PullRequestGlyph.pullRequest
          : props.icon === "browser"
            ? { ios: "globe", android: "public" }
            : props.icon === "device"
              ? { ios: "iphone", android: "smartphone" }
              : props.icon
      }
      size={14}
      weight="medium"
      {...(colorClassName ? { tintColorClassName: colorClassName } : { tintColor: props.color })}
      type="monochrome"
    />
  );
}

export function ThreadDisclosureChevron(props: {
  readonly expanded: boolean;
  readonly collapsedDirection: "right" | "down";
  readonly size: number;
  readonly tintColor: ColorValue;
}) {
  const expandedAngle = props.collapsedDirection === "right" ? 90 : 180;
  const rotation = useSharedValue(props.expanded ? expandedAngle : 0);

  useLayoutEffect(() => {
    rotation.value = withTiming(props.expanded ? expandedAngle : 0, {
      duration: THREAD_DISCLOSURE_TRANSITION_MS,
      reduceMotion: ReduceMotion.System,
    });
  }, [expandedAngle, props.expanded, rotation]);

  const rotationStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  return (
    <Animated.View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[{ width: props.size, height: props.size }, rotationStyle]}
    >
      <SymbolView
        name={props.collapsedDirection === "right" ? "chevron.right" : "chevron.down"}
        size={props.size}
        tintColor={props.tintColor}
        type="monochrome"
      />
    </Animated.View>
  );
}

function ShimmerWorkContent(props: {
  readonly textClassName?: string;
  readonly compact?: boolean;
  readonly environmentId?: EnvironmentId;
  readonly highlighted: boolean;
  readonly icon: WorkContentIcon;
  readonly iconSubtleColor: ColorValue;
  readonly label: string;
  readonly onTextLayout?: ComponentProps<typeof Text>["onTextLayout"];
  readonly showIcon: boolean;
  readonly themeAppearance?: "light" | "dark";
  readonly toolIcon?: ToolActivityIcon;
}) {
  return (
    <View className="flex-row items-center gap-1.5">
      {props.showIcon ? (
        <View className="h-6 w-6 shrink-0 items-center justify-center">
          {props.toolIcon && props.environmentId ? (
            <ToolActivityIconView
              environmentId={props.environmentId}
              icon={props.toolIcon}
              fallback={props.icon}
              fallbackColor={props.iconSubtleColor}
              themeAppearance={props.themeAppearance ?? "light"}
            />
          ) : (
            <WorkLogIcon
              icon={props.icon}
              color={props.iconSubtleColor}
              highlighted={props.highlighted}
            />
          )}
        </View>
      ) : null}
      <Text
        className={cn(
          "min-w-0 shrink",
          props.compact ? "text-xs" : "text-sm",
          props.highlighted ? "text-foreground" : "text-foreground-muted",
          props.textClassName,
        )}
        numberOfLines={1}
        onTextLayout={props.onTextLayout}
      >
        {props.label}
      </Text>
    </View>
  );
}

export function ShimmeringWorkContent(props: {
  readonly className?: string;
  readonly textClassName?: string;
  readonly compact?: boolean;
  readonly environmentId?: EnvironmentId;
  readonly icon: WorkContentIcon;
  readonly iconSubtleColor: ColorValue;
  readonly label: string;
  readonly showIcon: boolean;
  readonly themeAppearance?: "light" | "dark";
  readonly toolIcon?: ToolActivityIcon;
}) {
  const [availableWidth, setAvailableWidth] = useState(0);
  const [textWidth, setTextWidth] = useState(0);
  const [appIsActive, setAppIsActive] = useState(AppState.currentState === "active");
  const [reducedMotion, setReducedMotion] = useState(true);
  const screenIsFocused = useIsFocused();
  const progress = useAnimatedValue(0);
  const gradientId = `work-shimmer-${useId().replaceAll(":", "")}`;
  const contentWidth = Math.min(
    availableWidth,
    (props.showIcon ? SHIMMER_ICON_AND_GAP_WIDTH : 0) + Math.ceil(textWidth),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      setAppIsActive(state === "active");
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReducedMotion);
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReducedMotion,
    );
    return () => subscription.remove();
  }, []);

  // Runs on React Native's native driver instead of Reanimated, whose
  // per-frame commits starve React's while commit pausing is disabled
  // (package.json). See docs/internals/performance-regressions.md.
  useEffect(() => {
    progress.setValue(0);
    if (contentWidth <= 0 || reducedMotion || !appIsActive || !screenIsFocused) return;

    const loop = NativeAnimated.loop(
      NativeAnimated.timing(progress, {
        toValue: 1,
        duration: SHIMMER_SWEEP_MS + SHIMMER_PAUSE_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [appIsActive, contentWidth, progress, reducedMotion, screenIsFocused]);

  // One timing covers the sweep and the pause, so the native driver can loop it.
  // The React Compiler memoizes these, so re-renders don't rebuild the native
  // animation nodes.
  const inputRange = [0, SHIMMER_SWEEP_MS / (SHIMMER_SWEEP_MS + SHIMMER_PAUSE_MS), 1];
  const sweepTranslateX = progress.interpolate({
    inputRange,
    outputRange: [-SHIMMER_WIDTH, contentWidth, contentWidth],
  });
  const counterSweepTranslateX = progress.interpolate({
    inputRange,
    outputRange: [SHIMMER_WIDTH, -contentWidth, -contentWidth],
  });

  return (
    <View
      className={cn("min-w-0 flex-1 overflow-hidden", props.className)}
      onLayout={(event) => setAvailableWidth(event.nativeEvent.layout.width)}
    >
      <ShimmerWorkContent
        textClassName={props.textClassName}
        compact={props.compact}
        environmentId={props.environmentId}
        highlighted={false}
        icon={props.icon}
        iconSubtleColor={props.iconSubtleColor}
        label={props.label}
        showIcon={props.showIcon}
        themeAppearance={props.themeAppearance}
        toolIcon={props.toolIcon}
        onTextLayout={(event) => setTextWidth(event.nativeEvent.lines[0]?.width ?? 0)}
      />
      {!reducedMotion && appIsActive && screenIsFocused && contentWidth > 0 ? (
        <NativeAnimated.View
          pointerEvents="none"
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            overflow: "hidden",
            width: SHIMMER_WIDTH,
            transform: [{ translateX: sweepTranslateX }],
          }}
        >
          <MaskedView
            style={StyleSheet.absoluteFill}
            maskElement={
              <Svg width="100%" height="100%">
                <Defs>
                  <LinearGradient id={gradientId} x1="0%" x2="100%" y1="0%" y2="0%">
                    <Stop offset="0" stopColor="white" stopOpacity={0} />
                    <Stop offset="0.15" stopColor="white" stopOpacity={0.12} />
                    <Stop offset="0.35" stopColor="white" stopOpacity={0.55} />
                    <Stop offset="0.5" stopColor="white" stopOpacity={1} />
                    <Stop offset="0.65" stopColor="white" stopOpacity={0.55} />
                    <Stop offset="0.85" stopColor="white" stopOpacity={0.12} />
                    <Stop offset="1" stopColor="white" stopOpacity={0} />
                  </LinearGradient>
                </Defs>
                <Rect width="100%" height="100%" fill={`url(#${gradientId})`} />
              </Svg>
            }
          >
            <NativeAnimated.View
              style={{ width: availableWidth, transform: [{ translateX: counterSweepTranslateX }] }}
            >
              <ShimmerWorkContent
                textClassName={props.textClassName}
                compact={props.compact}
                environmentId={props.environmentId}
                highlighted
                icon={props.icon}
                iconSubtleColor={props.iconSubtleColor}
                label={props.label}
                showIcon={props.showIcon}
                themeAppearance={props.themeAppearance}
                toolIcon={props.toolIcon}
              />
            </NativeAnimated.View>
          </MaskedView>
        </NativeAnimated.View>
      ) : null}
    </View>
  );
}

function workRowSymbolName(icon: ThreadFeedActivity["icon"]): WorkContentIcon {
  switch (icon) {
    case "agent":
      return { ios: "sparkles", android: "auto_awesome" };
    case "alert":
      return { ios: "exclamationmark.triangle", android: "error" };
    case "browser":
      return { ios: "safari", android: "public" };
    case "check":
      return { ios: "checkmark", android: "check" };
    case "command":
      return { ios: "terminal", android: "terminal" };
    case "computer":
      return "computer";
    case "code":
      return "chevron.left.forwardslash.chevron.right";
    case "edit":
      return { ios: "square.and.pencil", android: "edit" };
    case "eye":
      return { ios: "eye", android: "visibility" };
    case "globe":
      return { ios: "globe", android: "public" };
    case "search":
      return "magnifyingglass";
    case "hammer":
      return { ios: "hammer", android: "construction" };
    case "lock":
      return { ios: "lock", android: "lock" };
    case "message":
      return { ios: "bubble.left", android: "chat_bubble" };
    case "warning":
      return { ios: "xmark", android: "close" };
    case "wrench":
      return { ios: "wrench", android: "build" };
    case "zap":
      return { ios: "bolt", android: "bolt" };
  }
}

// Entering fades only for rows created moments ago: rows remount whenever the
// list scrolls them back into view, and old rows must not replay an entrance.
const FRESH_ROW_WINDOW_MS = 3_000;
function isFreshRow(createdAt: string): boolean {
  const timestamp = Date.parse(createdAt);
  return Number.isFinite(timestamp) && Date.now() - timestamp < FRESH_ROW_WINDOW_MS;
}

// The minimum matches min-h-8 below. Exact sizing is disabled when native
// accessibility scaling can make the single-line text taller than that minimum.
const WORK_ROW_HEIGHT = THREAD_WORK_ROW_MIN_HEIGHT;
const WORK_ROW_GAP = 1;
const WORK_LOG_BOTTOM_MARGIN = 3.5;
const WORK_GROUP_MAX_HEIGHT = 256;
const WORK_GROUP_EDGE_FADE_HEIGHT = 12;

export const WORK_GROUP_TOGGLE_HEIGHT = THREAD_WORK_ROW_MIN_HEIGHT;

function workLogRowsHeight(
  activities: ReadonlyArray<ThreadFeedActivity>,
  rowHeight = WORK_ROW_HEIGHT,
): number {
  return activities.length * rowHeight + Math.max(0, activities.length - 1) * WORK_ROW_GAP;
}

export function collapsedWorkLogHeight(
  activities: ReadonlyArray<ThreadFeedActivity>,
  continues = false,
): number {
  const bottomMargin = continues ? 0 : WORK_LOG_BOTTOM_MARGIN;
  if (activities.length === 0) {
    return 0;
  }
  if (activities[0]?.projectedItem.item.type === "subagent") {
    return bottomMargin + WORK_ROW_HEIGHT;
  }
  const height = workLogRowsHeight(activities);
  return (
    bottomMargin +
    (activities[0]?.groupedToolDetail ? Math.min(height, WORK_GROUP_MAX_HEIGHT) : height)
  );
}

interface ThreadWorkLogProps {
  readonly continuesWorkLog?: boolean | undefined;
  readonly activities: ReadonlyArray<ThreadFeedActivity>;
  readonly anchorKey: string;
  readonly environmentId: EnvironmentId;
  /** Directory the thread runs in; read rows show paths relative to it. */
  readonly workspaceRoot: string | null;
  readonly copiedRowId: string | null;
  readonly expandedRows: Readonly<Record<string, boolean>>;
  readonly rowSizing: ReturnType<typeof deriveThreadWorkLogSizing>;
  readonly scrollPositions: Map<string, ThreadWorkGroupScrollPosition>;
  readonly iconSubtleColor: ColorValue;
  readonly edgeFadeColor: string;
  readonly themeAppearance: "light" | "dark";
  readonly onCopyRow: (rowId: string, value: string) => void;
  /** `groupId` is the group a lone call stands in for; it opens and closes with the row. */
  readonly onToggleRow: (rowId: string, anchorKey: string, groupId?: string) => void;
  readonly renderImage: MarkdownImageRenderer;
  readonly renderReasoning: (text: string) => ReactNode;
  readonly onPressPreview: (source: FilePreviewSource) => void;
}

export function ThreadWorkLog(props: ThreadWorkLogProps) {
  const renderRow = (row: ThreadFeedActivity) => (
    <ThreadWorkLogRow
      key={row.id}
      row={row}
      anchorKey={props.anchorKey}
      copied={props.copiedRowId === row.id}
      expanded={props.expandedRows[row.id] ?? false}
      environmentId={props.environmentId}
      workspaceRoot={props.workspaceRoot}
      iconSubtleColor={props.iconSubtleColor}
      onCopyRow={props.onCopyRow}
      onToggleRow={props.onToggleRow}
      renderImage={props.renderImage}
      renderReasoning={props.renderReasoning}
      onPressPreview={props.onPressPreview}
      themeAppearance={props.themeAppearance}
    />
  );

  if (props.activities.length === 0) {
    return null;
  }

  if (props.activities[0]?.projectedItem.item.type === "subagent") {
    return <ThreadSubagentGroup {...props} />;
  }

  if (
    props.activities[0]?.groupedToolDetail &&
    props.activities.every((row) => row.projectedItem.item.type === "reasoning")
  ) {
    return (
      <ScrollView nestedScrollEnabled className="ml-7 max-h-96 py-1">
        {props.activities.map((row) => (
          <View key={row.id}>{props.renderReasoning(row.workEntry.detail ?? "")}</View>
        ))}
      </ScrollView>
    );
  }

  return (
    <WorkLogBlock continues={props.continuesWorkLog}>
      {props.activities[0]?.groupedToolDetail ? (
        <ThreadWorkGroupList
          activities={props.activities}
          edgeFadeColor={props.edgeFadeColor}
          expandedRows={props.expandedRows}
          groupId={props.anchorKey}
          rowSizing={props.rowSizing}
          scrollPositions={props.scrollPositions}
          renderRow={renderRow}
        />
      ) : (
        <WorkLogRows>{props.activities.map(renderRow)}</WorkLogRows>
      )}
    </WorkLogBlock>
  );
}

function ThreadWorkGroupList(props: {
  readonly activities: ReadonlyArray<ThreadFeedActivity>;
  readonly edgeFadeColor: string;
  readonly expandedRows: Readonly<Record<string, boolean>>;
  readonly groupId: string;
  readonly rowSizing: ReturnType<typeof deriveThreadWorkLogSizing>;
  readonly scrollPositions: Map<string, ThreadWorkGroupScrollPosition>;
  readonly renderRow: (row: ThreadFeedActivity) => ReactNode;
}) {
  const estimatedRowsHeight = workLogRowsHeight(
    props.activities,
    props.rowSizing.estimatedRowHeight,
  );
  const [initialPosition] = useState(() => {
    const position = props.scrollPositions.get(props.groupId);
    return props.activities.some((row) => row.id === position?.rowId) ? position : undefined;
  });
  const [initialScrollIndex] = useState(() =>
    resolveThreadWorkGroupInitialScroll(props.activities, initialPosition),
  );
  const [restoringPosition, setRestoringPosition] = useState(initialScrollIndex !== undefined);
  const listRef = useRef<LegendListRef>(null);
  const loadedRef = useRef(false);
  const userScrollingRef = useRef(false);
  const pendingAppendHeightRef = useRef<number | null>(null);
  const previousContent = useRef({
    rows: props.activities,
    height: Math.max(estimatedRowsHeight, initialPosition?.contentHeight ?? 0),
    expandedRows: props.expandedRows,
  });
  const [measuredContent, setMeasuredContent] = useState(() => ({
    height: Math.max(estimatedRowsHeight, initialPosition?.contentHeight ?? 0),
    rowCount: props.activities.length,
  }));
  const contentHeight = Math.max(
    1,
    measuredContent.height +
      Math.max(0, props.activities.length - measuredContent.rowCount) *
        (props.rowSizing.estimatedRowHeight + WORK_ROW_GAP),
  );
  const height = Math.min(contentHeight, WORK_GROUP_MAX_HEIGHT);
  const scrollOffset = useSharedValue(initialPosition?.scrollOffset ?? 0);
  const sharedValues = { scrollOffset };

  const topFadeStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(0, scrollOffset.value) / WORK_GROUP_EDGE_FADE_HEIGHT),
  }));
  const bottomFadeStyle = useAnimatedStyle(() => ({
    opacity: Math.min(
      1,
      Math.max(0, contentHeight - height - scrollOffset.value) / WORK_GROUP_EDGE_FADE_HEIGHT,
    ),
  }));
  const rememberPosition = () => {
    if (!loadedRef.current) return;
    const state = listRef.current?.getState();
    const position = state && resolveWorkGroupScrollAnchor(state);
    if (!state || !position) return;
    props.scrollPositions.set(props.groupId, {
      ...position,
      contentHeight: state.contentLength,
    });
  };
  const finishPendingAppend = () => {
    const targetHeight = pendingAppendHeightRef.current;
    const state = listRef.current?.getState();
    if (
      targetHeight !== null &&
      state &&
      !userScrollingRef.current &&
      Math.abs(state.scrollLength - targetHeight) <= 1
    ) {
      pendingAppendHeightRef.current = null;
      void listRef.current?.scrollToEnd({ animated: false });
    }
  };
  // LegendList notifies from child layout effects. Effect Events see the
  // committed rows before those effects run, unlike a parent layout-effect ref.
  const onContentSizeChange = useEffectEvent((nextHeight: number) => {
    const previous = previousContent.current;
    const detailsChanged = previous.expandedRows !== props.expandedRows;
    const followAppend =
      loadedRef.current &&
      shouldFollowThreadWorkGroupAppend({
        previousRows: previous.rows,
        rows: props.activities,
        previousContentHeight: previous.height,
        contentHeight: nextHeight,
        viewportHeight: Math.min(previous.height, WORK_GROUP_MAX_HEIGHT),
        scrollOffset: scrollOffset.value,
        detailsChanged,
        userScrolling: userScrollingRef.current,
      });
    previousContent.current = {
      rows: props.activities,
      height: nextHeight,
      expandedRows: props.expandedRows,
    };
    setMeasuredContent((current) =>
      current.height === nextHeight && current.rowCount === props.activities.length
        ? current
        : { height: nextHeight, rowCount: props.activities.length },
    );
    if (followAppend) {
      pendingAppendHeightRef.current = Math.min(nextHeight, WORK_GROUP_MAX_HEIGHT);
    } else if (detailsChanged || userScrollingRef.current || previous.rows !== props.activities) {
      pendingAppendHeightRef.current = null;
    } else if (pendingAppendHeightRef.current !== null) {
      pendingAppendHeightRef.current = Math.min(nextHeight, WORK_GROUP_MAX_HEIGHT);
    }
    finishPendingAppend();
    rememberPosition();
  });
  // The native ScrollView reports its content size a frame or more after
  // LegendList has laid the rows out, so a detail toggle rendered the group
  // at its old height while the rows below already moved. Read the size
  // LegendList computes on the JS thread instead; it settles in the same
  // commit as the row measurement that changed it.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const unsubscribe = list.getState().listen("totalSize", () => {
      onContentSizeChange(list.getState().contentLength);
    });
    onContentSizeChange(list.getState().contentLength);
    return unsubscribe;
  }, []);
  const getFixedItemSize = (row: ThreadFeedActivity, index: number) =>
    props.expandedRows[row.id] || props.rowSizing.fixedRowHeight === undefined
      ? undefined
      : props.rowSizing.fixedRowHeight + (index < props.activities.length - 1 ? WORK_ROW_GAP : 0);
  const renderItem = ({ item, index }: { item: ThreadFeedActivity; index: number }) => (
    <View className={index < props.activities.length - 1 ? "pb-px" : undefined}>
      {props.renderRow(item)}
    </View>
  );

  return (
    <View style={{ height, overflow: "hidden" }}>
      <AnimatedLegendList
        ref={listRef}
        data={props.activities}
        keyExtractor={workLogRowKey}
        estimatedItemSize={props.rowSizing.estimatedRowHeight + WORK_ROW_GAP}
        getFixedItemSize={getFixedItemSize}
        initialScrollIndex={initialScrollIndex}
        // Bootstrap overscan is only 50px. An offset inside expanded detail can
        // otherwise leave its own row unmeasured until after scroll restoration.
        alwaysRender={
          restoringPosition && initialPosition ? { keys: [initialPosition.rowId] } : undefined
        }
        recycleItems={false}
        extraData={props.renderRow}
        renderItem={renderItem}
        sharedValues={sharedValues}
        onLayout={finishPendingAppend}
        onLoad={() => {
          loadedRef.current = true;
          setRestoringPosition(false);
          rememberPosition();
        }}
        onScroll={rememberPosition}
        onScrollBeginDrag={() => {
          userScrollingRef.current = true;
          pendingAppendHeightRef.current = null;
        }}
        onScrollEndDrag={() => {
          userScrollingRef.current = false;
        }}
        onMomentumScrollBegin={() => {
          userScrollingRef.current = true;
          pendingAppendHeightRef.current = null;
        }}
        onMomentumScrollEnd={() => {
          userScrollingRef.current = false;
          rememberPosition();
        }}
        maintainVisibleContentPosition
        nestedScrollEnabled
        directionalLockEnabled
        showsVerticalScrollIndicator
        scrollsToTop={false}
        bounces={false}
        keyboardShouldPersistTaps="handled"
        style={{ height }}
      />
      <Animated.View
        pointerEvents="none"
        className="absolute inset-x-0 top-0"
        style={[{ height: WORK_GROUP_EDGE_FADE_HEIGHT }, topFadeStyle]}
      >
        <EdgeFade color={props.edgeFadeColor} direction="down" />
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        className="absolute inset-x-0 bottom-0"
        style={[{ height: WORK_GROUP_EDGE_FADE_HEIGHT }, bottomFadeStyle]}
      >
        <EdgeFade color={props.edgeFadeColor} direction="up" />
      </Animated.View>
    </View>
  );
}

function EdgeFade(props: { readonly color: string; readonly direction: "up" | "down" }) {
  const gradientId = `work-group-fade-${useId().replaceAll(":", "")}`;
  return (
    <Svg width="100%" height="100%">
      <Defs>
        <LinearGradient id={gradientId} x1="0%" x2="0%" y1="0%" y2="100%">
          <Stop
            offset={0}
            stopColor={props.color}
            stopOpacity={props.direction === "down" ? 1 : 0}
          />
          <Stop
            offset={1}
            stopColor={props.color}
            stopOpacity={props.direction === "down" ? 0 : 1}
          />
        </LinearGradient>
      </Defs>
      <Rect width="100%" height="100%" fill={`url(#${gradientId})`} />
    </Svg>
  );
}

function workLogRowKey(row: ThreadFeedActivity): string {
  return row.id;
}

function WorkspacePreparationRetryButton(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly runId: RunId;
}) {
  const retryable = useAtomValue(
    environmentThreadDetails.threadAtom(scopeThreadRef(props.environmentId, props.threadId)),
    (thread) => {
      const run = thread?.projection.runs.find((candidate) => candidate.id === props.runId);
      return run?.status === "failed" && run.workspacePreparation !== undefined;
    },
  );
  const retry = useAtomCommand(threadEnvironment.retryWorkspacePreparation, "retry setup");
  const [busy, setBusy] = useState(false);
  if (!retryable) return null;
  return (
    <View className="ml-7 mt-2">
      <Button
        label="Retry"
        tone="secondary"
        accessibilityLabel="Retry workspace preparation"
        disabled={busy}
        onPress={() => {
          setBusy(true);
          void Haptics.selectionAsync();
          void retry({
            environmentId: props.environmentId,
            input: { threadId: props.threadId, runId: props.runId },
          }).finally(() => setBusy(false));
        }}
        icon="arrow.clockwise"
      />
    </View>
  );
}

function ReplCodeText({
  code,
  theme,
}: {
  readonly code: string;
  readonly theme: "light" | "dark";
}) {
  const lines = useMarkdownCodeHighlight({ code, language: "typescript", theme, enabled: true });
  let offset = 0;
  const highlighted = lines?.flatMap((line, lineIndex) => {
    const separator = lineIndex > 0 ? "\n" : "";
    offset += separator.length;
    return [
      separator,
      ...line.map((token) => {
        const start = offset;
        offset += token.content.length;
        return (
          <Text key={start} style={token.color ? { color: token.color } : undefined}>
            {token.content}
          </Text>
        );
      }),
    ];
  });
  return (
    <Text selectable className="font-mono text-2xs leading-normal text-foreground">
      {highlighted ?? code}
    </Text>
  );
}

const ThreadWorkLogRow = function ThreadWorkLogRow(
  props: Omit<
    ThreadWorkLogProps,
    | "continuesWorkLog"
    | "activities"
    | "copiedRowId"
    | "edgeFadeColor"
    | "expandedRows"
    | "rowSizing"
    | "scrollPositions"
  > & {
    readonly row: ThreadFeedActivity;
    readonly copied: boolean;
    readonly expanded: boolean;
  },
) {
  const { row, expanded } = props;
  const navigation = useNavigation();
  // Command rows stream their output, including the final output, from the server.
  const streamsOutput =
    useCommandOutputStreaming(props.environmentId) &&
    row.projectedItem.item.type === "command_execution";
  const fetchedDetail = useTurnItemDetail(
    expanded && row.fetchesDetail && !streamsOutput
      ? { environmentId: props.environmentId, row: row.projectedItem }
      : null,
  );
  const failureItem = row.projectedItem.item;
  if (failureItem.type === "error" && failureItem.status === "failed") {
    const warning = failureItem.failure.class === "usage_limit";
    const timestamp = new Date(row.createdAt);
    const resetAt = failureItem.failure.resetAt;
    const resetTime = resetAt
      ? new Date(resetAt).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : null;
    const label = warning
      ? `Usage limit reached.${resetTime ? ` Retry after ${resetTime}.` : ""}`
      : row.summary;
    return (
      <WorkLogPressable
        accessibilityLabel={warning ? label : `${row.summary}: ${failureItem.failure.message}`}
        accessibilityHint="Long press to copy."
        onLongPress={() => props.onCopyRow(row.id, row.getCopyText())}
      >
        <View className="flex-1 py-1">
          <View className="flex-row items-center gap-1.5">
            <WorkLogIconSlot>
              <WorkLogIcon
                icon="exclamationmark.circle"
                color={props.iconSubtleColor}
                colorClassName={warning ? "accent-warning-foreground" : "accent-danger-foreground"}
              />
            </WorkLogIconSlot>
            <Text
              className={
                warning
                  ? "min-w-0 flex-1 font-t3-medium text-sm text-warning-foreground"
                  : "min-w-0 flex-1 font-t3-medium text-sm text-adaptive-rose-600-400"
              }
            >
              {label}
            </Text>
            {props.copied ? (
              <Text className="pr-1 font-t3-medium text-3xs text-adaptive-emerald-600-400">
                Copied
              </Text>
            ) : null}
            <Text
              accessibilityLabel={timestamp.toLocaleString()}
              className="shrink-0 text-xs text-foreground-subtle"
            >
              {timestamp.toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </Text>
          </View>
          {!warning ? (
            <Text selectable className="ml-7 text-sm text-foreground">
              {failureItem.failure.message}
            </Text>
          ) : null}
          {failureItem.failure.code === ORCHESTRATION_V2_WORKSPACE_PREPARATION_FAILURE_CODE &&
          failureItem.runId !== null ? (
            <WorkspacePreparationRetryButton
              environmentId={props.environmentId}
              threadId={failureItem.threadId}
              runId={failureItem.runId}
            />
          ) : null}
        </View>
      </WorkLogPressable>
    );
  }
  const notifiedSubagentThreadId =
    row.projectedItem.item.type === "notification"
      ? notificationChildThreadId(row.projectedItem.item.source)
      : undefined;
  const canExpand = row.canExpand && notifiedSubagentThreadId === undefined;
  const reasoning = row.projectedItem.item.type === "reasoning" ? row.projectedItem.item : null;
  const fetchedItem = fetchedDetail.data?.item ?? null;
  const isRead = toolGroupAction(row.workEntry) === "read";
  const showsPaths = toolEntryShowsPathBreadcrumbs(row.workEntry);
  const shownItem = fetchedItem ?? row.projectedItem.item;
  const call =
    expanded && !isRead && shownItem.type === "command_execution"
      ? toolCallLines({ command: shownItem.input })
      : expanded && !isRead && shownItem.type === "dynamic_tool"
        ? toolCallLines({ args: shownItem.input })
        : expanded && shownItem.type === "file_search"
          ? toolCallLines({ args: { pattern: shownItem.pattern } })
          : expanded && shownItem.type === "web_search"
            ? toolCallLines({ args: { query: shownItem.patterns?.join(", ") } })
            : null;
  const exitCode =
    call && shownItem.type === "command_execution" && shownItem.exitCode !== undefined
      ? shownItem.exitCode
      : null;
  // Fork: an edit shows its bounded diff and line counts once the stored item arrives.
  const editPreview =
    expanded && shownItem.type === "file_change" ? fileChangePreviewText(shownItem) : null;
  const fullDetail =
    expanded && !reasoning && !call
      ? (editPreview ??
        (fetchedItem && !isRead
          ? formatItemFullDetail(row.projectedItem, fetchedItem)
          : row.getFullDetail()))
      : null;
  const outputImages = expanded && fetchedItem ? turnItemOutputImages(fetchedItem) : [];
  // Thread, PR, browser and other common tools show what they did instead of their JSON.
  const toolPreview = expanded && fetchedItem ? resolveToolPreview(fetchedItem) : null;
  const viewedImagePath = workEntryViewedImagePath(row.workEntry);
  const fetchedOutput =
    !expanded || streamsOutput
      ? null
      : shownItem.type === "file_change"
        ? fetchedItem
          ? null
          : fetchedDetail.error
            ? `Couldn't load the diff: ${fetchedDetail.error}`
            : row.fetchesDetail && !fetchedDetail.data
              ? "Loading diff…"
              : null
        : shownItem.type === "file_search" || shownItem.type === "web_search"
          ? turnItemOutputText(shownItem)
          : fetchedItem
            ? (turnItemOutputText(fetchedItem) ??
              (outputImages.length > 0 || viewedImagePath ? null : "No output."))
            : fetchedDetail.error
              ? `Couldn't load output: ${fetchedDetail.error}`
              : row.fetchesDetail
                ? fetchedDetail.data
                  ? "Output is no longer available."
                  : "Loading output…"
                : null;
  // A browser snapshot card already shows its screenshot.
  const shownOutputImages =
    toolPreview?.kind === "browser" && toolPreview.snapshot?.screenshotPath ? [] : outputImages;
  const exitLine =
    exitCode === null ? null : (
      <Text
        className={cn(
          "mt-1.5 font-mono text-2xs leading-normal",
          exitCode === 0 ? "text-foreground-muted" : "text-danger-foreground",
        )}
      >
        exit {exitCode}
      </Text>
    );
  const toolPresentation = resolveWorkEntryToolPresentation(row.workEntry);
  const previewText =
    row.groupStandIn?.label ?? workEntryRowLabel(row.workEntry, false, props.workspaceRoot);
  const answerPreview = row.workEntry.questionAnswer
    ? getQuestionAnswerPreview(row.workEntry.questionAnswer)
    : null;
  const accessiblePreview = [previewText, answerPreview].filter(Boolean).join(": ");
  const displayText =
    row.groupStandIn?.label ?? workEntryRowLabel(row.workEntry, expanded, props.workspaceRoot);
  const isSystemNotice = row.projectedItem.item.type === "system_notice";
  const isUsageLimit =
    row.projectedItem.item.type === "error" &&
    row.projectedItem.item.failure.class === "usage_limit" &&
    row.projectedItem.item.status !== "completed";
  const iconIsDestructive =
    !isSystemNotice && !isUsageLimit && (row.icon === "alert" || row.icon === "warning");
  const failed = row.status === "failure";
  const toolIcon = row.workEntry.toolIcon ?? row.workEntry.toolSource?.icon;
  const icon = reasoning ? "brain" : (toolPresentation?.icon ?? workRowSymbolName(row.icon));

  return (
    <Animated.View
      layout={WORK_LOG_LAYOUT_TRANSITION}
      className="overflow-hidden"
      {...(isFreshRow(row.createdAt) ? { entering: FadeIn.duration(200) } : {})}
    >
      <WorkLogPressable
        accessibilityRole={
          notifiedSubagentThreadId !== undefined ? "link" : canExpand ? "button" : undefined
        }
        accessibilityLabel={failed ? `${accessiblePreview}, tool call failed` : accessiblePreview}
        accessibilityHint={
          notifiedSubagentThreadId !== undefined
            ? "Opens this agent's thread. Long press to copy."
            : canExpand
              ? `Double tap to ${expanded ? "hide" : "show"} full details. Long press to copy.`
              : "Long press to copy."
        }
        accessibilityState={canExpand ? { expanded } : undefined}
        onPress={() => {
          if (notifiedSubagentThreadId !== undefined) {
            // Push, not navigate: navigate reuses this Thread route, so back
            // would skip the parent thread and land on Home (matches #15068).
            navigation.dispatch(
              StackActions.push("Thread", {
                environmentId: String(props.environmentId),
                threadId: String(notifiedSubagentThreadId),
              }),
            );
            return;
          }
          if (canExpand) {
            void Haptics.selectionAsync();
            props.onToggleRow(row.id, props.anchorKey, row.groupStandIn?.groupId);
          }
        }}
        onLongPress={() => props.onCopyRow(row.id, row.getCopyText())}
      >
        {row.live && !expanded && !showsPaths ? (
          <ShimmeringWorkContent
            environmentId={props.environmentId}
            icon={icon}
            iconSubtleColor={props.iconSubtleColor}
            label={displayText}
            showIcon
            themeAppearance={props.themeAppearance}
            toolIcon={toolIcon}
          />
        ) : (
          <>
            <WorkLogIconSlot>
              {toolIcon ? (
                <ToolActivityIconView
                  environmentId={props.environmentId}
                  icon={toolIcon}
                  fallback={icon}
                  fallbackColor={props.iconSubtleColor}
                  themeAppearance={props.themeAppearance}
                />
              ) : (
                <WorkLogIcon
                  icon={icon}
                  color={props.iconSubtleColor}
                  colorClassName={
                    isUsageLimit
                      ? "accent-warning-foreground"
                      : iconIsDestructive
                        ? "accent-adaptive-rose-600-400"
                        : failed
                          ? "accent-danger-foreground/40"
                          : undefined
                  }
                />
              )}
            </WorkLogIconSlot>
            <WorkLogLabel
              tone={isUsageLimit ? "warning" : iconIsDestructive ? "danger" : "default"}
              wrap={showsPaths}
            >
              {isSystemNotice ? (
                row.summary
              ) : showsPaths ? (
                <ToolPathText
                  targets={toolPathTargets(row.workEntry)}
                  text={displayText}
                  environmentId={props.environmentId}
                  workspaceRoot={props.workspaceRoot}
                />
              ) : (
                displayText
              )}
              {answerPreview ? (
                <Text
                  className={
                    !expanded &&
                    row.workEntry.questionAnswer &&
                    hasQuestionAnswer(row.workEntry.questionAnswer)
                      ? "text-foreground"
                      : "text-foreground-subtle"
                  }
                >{`  ${answerPreview}`}</Text>
              ) : null}
            </WorkLogLabel>
          </>
        )}

        <View className="shrink-0 flex-row items-center gap-px">
          {props.copied ? (
            <Text className="pr-1 font-t3-medium text-3xs text-adaptive-emerald-600-400">
              Copied
            </Text>
          ) : null}
          {failed && toolIcon !== undefined ? (
            <View
              className="h-4 w-4 items-center justify-center"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <SymbolView
                name="xmark"
                size={11}
                tintColorClassName="accent-danger-foreground/40"
                type="monochrome"
              />
            </View>
          ) : null}
          <View className="h-4 w-4 items-center justify-center">
            {canExpand ? (
              <ThreadDisclosureChevron
                expanded={expanded}
                collapsedDirection="down"
                size={11}
                tintColor={props.iconSubtleColor}
              />
            ) : null}
          </View>
        </View>
      </WorkLogPressable>

      {expanded &&
      (reasoning ||
        fullDetail ||
        call ||
        fetchedOutput ||
        viewedImagePath ||
        outputImages.length > 0 ||
        row.workEntry.questionAnswer) ? (
        <Animated.View
          entering={WORK_LOG_DETAIL_ENTER_TRANSITION}
          exiting={WORK_LOG_DETAIL_EXIT_TRANSITION}
          layout={WORK_LOG_LAYOUT_TRANSITION}
          className={reasoning ? "ml-7 py-1" : "pb-1 pt-0.5"}
        >
          {row.workEntry.questionAnswer ? (
            <QuestionAnswerHistory
              environmentId={props.environmentId}
              answer={row.workEntry.questionAnswer}
            />
          ) : null}
          {viewedImagePath ? (
            <View className="pb-1.5">
              {props.renderImage({ href: viewedImagePath, alt: null, title: null })}
            </View>
          ) : null}
          <FilePreviewGallery
            value={shownOutputImages.map((resource) => ({
              kind: "image",
              environmentId: props.environmentId,
              resource,
            }))}
          >
            {shownOutputImages.map((resource) => (
              <View key={resource.index} className="pb-1.5">
                <ThreadMarkdownImage
                  environmentId={props.environmentId}
                  resource={resource}
                  alt={null}
                  onPressPreview={props.onPressPreview}
                />
              </View>
            ))}
          </FilePreviewGallery>
          <ScrollView
            nestedScrollEnabled
            directionalLockEnabled
            showsVerticalScrollIndicator
            className="max-h-60"
            contentContainerStyle={{ paddingRight: 8 }}
          >
            {toolPreview ? (
              <ToolPreviewCard
                preview={toolPreview}
                renderSnapshotImage={(path) =>
                  props.renderImage({ href: path, alt: "Captured page screenshot", title: null })
                }
                onOpenThread={(threadId) =>
                  navigation.dispatch(
                    StackActions.push("Thread", {
                      environmentId: String(props.environmentId),
                      threadId,
                    }),
                  )
                }
              />
            ) : reasoning ? (
              props.renderReasoning(reasoning.text)
            ) : call ? (
              [
                call.command,
                ...(call.args ?? []).map(([key, value]) =>
                  key === "code" &&
                  shownItem.type === "dynamic_tool" &&
                  isJavaScriptReplTool(shownItem.toolName) ? (
                    <View key={key}>
                      <Text className="font-mono text-2xs leading-normal text-foreground-muted">
                        {key}
                      </Text>
                      <ReplCodeText code={value} theme={props.themeAppearance} />
                    </View>
                  ) : (
                    `${key} ${value}`
                  ),
                ),
                call.argsText,
              ]
                .filter((line) => Boolean(line))
                .map((line, index) =>
                  typeof line === "string" ? (
                    <Text
                      key={`${index}:${line}`}
                      selectable
                      className="font-mono text-2xs leading-normal text-foreground"
                    >
                      {line}
                    </Text>
                  ) : (
                    line
                  ),
                )
            ) : fullDetail ? (
              <Text selectable className="font-mono text-2xs leading-normal text-foreground-muted">
                {isRead ? (
                  <ToolPathText
                    targets={toolPathTargets(row.workEntry)}
                    text={fullDetail}
                    environmentId={props.environmentId}
                    workspaceRoot={props.workspaceRoot}
                  />
                ) : (
                  fullDetail
                )}
              </Text>
            ) : null}
            {fetchedOutput && !toolPreview ? (
              <Text
                selectable
                className={cn(
                  "font-mono text-2xs leading-normal text-foreground-muted",
                  (!call || call.command || call.args || call.argsText) && "mt-1.5",
                )}
              >
                {fetchedOutput}
              </Text>
            ) : null}
            {streamsOutput ? null : exitLine}
          </ScrollView>
          {streamsOutput ? (
            <>
              <ThreadCommandOutput
                environmentId={props.environmentId}
                threadId={row.projectedItem.sourceThreadId}
                itemId={row.projectedItem.sourceItemId}
                themeAppearance={props.themeAppearance}
              />
              {exitLine}
            </>
          ) : null}
        </Animated.View>
      ) : null}
    </Animated.View>
  );
};

export function ThreadWorkGroupToggle(props: {
  readonly environmentId: EnvironmentId;
  readonly rowSizing: ReturnType<typeof deriveThreadWorkLogSizing>;
  readonly expanded: boolean;
  readonly hiddenCount: number;
  readonly iconSubtleColor: import("react-native").ColorValue;
  readonly summary: string;
  readonly summaryKind: ToolGroupSummaryKind;
  readonly summaryToolIcon?: "browser" | "device" | "t3-code" | "pull-request" | "brain";
  readonly themeAppearance: "light" | "dark";
  readonly toolSurface?: import("@t3tools/contracts").ToolActivitySurface;
  readonly toolIcon?: ToolActivityIcon;
  readonly hasFailure: boolean;
  readonly shimmer: boolean;
  readonly thought?: string | undefined;
  readonly onToggle: () => void;
}) {
  const statusLabel = props.hasFailure ? `${props.summary}, tool call failed` : props.summary;
  const accessibilityLabel = props.thought ? `${props.thought} ${statusLabel}` : statusLabel;
  const icon =
    props.summaryToolIcon ??
    (props.toolSurface
      ? workRowSymbolName(props.toolSurface)
      : toolGroupSummarySymbolName(props.summaryKind));

  return (
    <WorkLogBlock layout="group-header">
      {props.thought ? (
        <Pressable
          accessible={false}
          onPress={props.onToggle}
          className="flex-row items-start gap-1.5 rounded-md px-0.5 active:bg-subtle"
        >
          <WorkLogIconSlot>
            <WorkLogIcon icon="brain" color={props.iconSubtleColor} />
          </WorkLogIconSlot>
          <Text
            key={props.rowSizing.textSizeKey}
            selectable={false}
            numberOfLines={4}
            ellipsizeMode="tail"
            className="min-w-0 flex-1 py-0.5 text-sm text-foreground-muted"
          >
            {props.thought}
          </Text>
        </Pressable>
      ) : null}
      <WorkLogPressable
        accessibilityRole="button"
        accessibilityState={{ expanded: props.expanded }}
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={`Double tap to ${props.expanded ? "hide" : "show"} ${props.hiddenCount} tool ${props.hiddenCount === 1 ? "call" : "calls"}.`}
        onPress={() => {
          void Haptics.selectionAsync();
          props.onToggle();
        }}
        rowSizing={props.rowSizing}
      >
        {props.shimmer ? (
          <ShimmeringWorkContent
            key={props.rowSizing.textSizeKey}
            environmentId={props.environmentId}
            icon={icon}
            iconSubtleColor={props.iconSubtleColor}
            label={props.summary}
            showIcon
            themeAppearance={props.themeAppearance}
            toolIcon={props.toolIcon}
          />
        ) : (
          <>
            <WorkLogIconSlot>
              <ToolActivityIconView
                environmentId={props.environmentId}
                icon={props.toolIcon}
                fallback={icon}
                fallbackColor={props.iconSubtleColor}
                themeAppearance={props.themeAppearance}
              />
            </WorkLogIconSlot>
            <WorkLogLabel key={props.rowSizing.textSizeKey}>{props.summary}</WorkLogLabel>
          </>
        )}
        <ThreadDisclosureChevron
          expanded={props.expanded}
          collapsedDirection="down"
          size={11}
          tintColor={props.iconSubtleColor}
        />
      </WorkLogPressable>
    </WorkLogBlock>
  );
}

export const ThreadAgentSpawnCard = function ThreadAgentSpawnCard(props: {
  readonly summary: AgentSpawnSummary;
  readonly expanded: boolean;
  readonly iconSubtleColor: ColorValue;
  readonly rowSizing: ReturnType<typeof deriveThreadWorkLogSizing>;
  readonly onToggle: () => void;
  readonly onCopy: () => void;
}) {
  const { summary, expanded } = props;
  const working = summary.tone === "working";
  const memberCount = summary.members.length;
  const canExpand = memberCount > 0;
  return (
    <Animated.View layout={WORK_LOG_LAYOUT_TRANSITION} className="-mx-1 mb-1 px-1">
      <Pressable
        accessibilityRole={canExpand ? "button" : undefined}
        accessibilityState={canExpand ? { expanded } : undefined}
        accessibilityLabel={`${summary.title}, ${summary.status}`}
        accessibilityHint={
          canExpand
            ? `Double tap to ${expanded ? "hide" : "show"} ${memberCount} ${memberCount === 1 ? "subagent" : "subagents"}. Long press to copy.`
            : "Long press to copy."
        }
        hitSlop={4}
        onPress={() => {
          if (!canExpand) return;
          void Haptics.selectionAsync();
          props.onToggle();
        }}
        onLongPress={props.onCopy}
        className="rounded-xl border border-border-subtle bg-card px-2.5 py-2 active:bg-subtle"
      >
        <View className="flex-row items-center gap-2">
          <View className="h-6 w-6 shrink-0 items-center justify-center">
            <SymbolView
              name={{ ios: "sparkles", android: "auto_awesome" }}
              size={14}
              weight="medium"
              tintColor={props.iconSubtleColor}
              type="monochrome"
            />
          </View>
          <View className="min-w-0 flex-1 gap-0.5">
            <Text
              key={props.rowSizing.textSizeKey}
              className="font-t3-medium text-sm text-foreground"
              numberOfLines={1}
            >
              {summary.title}
            </Text>
            <View className="flex-row items-center gap-1.5">
              <SubagentStatusDot tone={summary.tone} />
              {working ? (
                <ShimmeringWorkContent
                  key={props.rowSizing.textSizeKey}
                  compact
                  icon="brain"
                  iconSubtleColor={props.iconSubtleColor}
                  label={summary.status}
                  showIcon={false}
                />
              ) : (
                <Text className="min-w-0 flex-1 text-xs text-foreground-muted" numberOfLines={1}>
                  {summary.status}
                </Text>
              )}
            </View>
          </View>
          {canExpand ? (
            <ThreadDisclosureChevron
              expanded={expanded}
              collapsedDirection="down"
              size={11}
              tintColor={props.iconSubtleColor}
            />
          ) : null}
        </View>
        {expanded && canExpand ? (
          <Animated.View
            entering={WORK_LOG_DETAIL_ENTER_TRANSITION}
            exiting={WORK_LOG_DETAIL_EXIT_TRANSITION}
            layout={WORK_LOG_LAYOUT_TRANSITION}
            className="ml-8 mt-1.5 gap-1.5 border-l border-border pl-3"
          >
            {summary.members.map((member) => (
              <View key={member.title} className="gap-px">
                <View className="flex-row items-center gap-1.5">
                  <SubagentStatusDot tone={member.tone} />
                  <Text className="min-w-0 flex-1 text-xs text-foreground" numberOfLines={1}>
                    {member.title}
                  </Text>
                  <Text className="shrink-0 text-2xs text-foreground-muted">{member.status}</Text>
                </View>
                {member.detail ? (
                  <Text
                    selectable
                    className="pl-3 font-mono text-2xs leading-normal text-foreground-muted"
                    numberOfLines={expanded ? 6 : 1}
                  >
                    {member.detail}
                  </Text>
                ) : null}
              </View>
            ))}
          </Animated.View>
        ) : null}
      </Pressable>
    </Animated.View>
  );
};

export function ThreadThinkingRow(props: {
  readonly rowSizing: ReturnType<typeof deriveThreadWorkLogSizing>;
  readonly iconSubtleColor: ColorValue;
}) {
  return (
    <View
      accessible
      accessibilityLabel="Thinking"
      className="-mx-1 min-h-8 flex-row items-center px-1.5 py-0"
      style={{ minHeight: props.rowSizing.estimatedRowHeight }}
    >
      <ShimmeringWorkContent
        key={props.rowSizing.textSizeKey}
        icon="brain"
        iconSubtleColor={props.iconSubtleColor}
        label="Thinking"
        showIcon
      />
    </View>
  );
}

function ToolActivityIconView(props: {
  readonly environmentId: EnvironmentId;
  readonly icon?: ToolActivityIcon;
  readonly fallback: WorkContentIcon;
  readonly fallbackColor: ColorValue;
  readonly themeAppearance: "light" | "dark";
}) {
  if (!props.icon) {
    return <WorkLogIcon icon={props.fallback} color={props.fallbackColor} />;
  }
  const brandMark = toolActivityBrandMark(props.icon);
  if (brandMark) {
    const BrandMark = brandMark === "linear" ? LinearMark : GranolaMark;
    return <BrandMark color={props.fallbackColor} />;
  }
  if (props.icon._tag === "website") {
    const source = toolActivityFaviconUrl(props.icon, props.themeAppearance, 32);
    return source ? (
      <ToolActivityImage
        key={source}
        source={source}
        fallback={props.fallback}
        color={props.fallbackColor}
        themeAppearance={props.themeAppearance}
      />
    ) : (
      <WorkLogIcon icon={props.fallback} color={props.fallbackColor} />
    );
  }
  if (props.icon._tag === "themed-logo") {
    const source =
      props.themeAppearance === "dark"
        ? (props.icon.logoUrlDark ?? props.icon.logoUrl)
        : props.icon.logoUrl;
    return (
      <ToolActivityImage
        key={source}
        source={source}
        fallback={props.fallback}
        color={props.fallbackColor}
        themeAppearance={props.themeAppearance}
      />
    );
  }
  return (
    <NativeAppToolActivityIcon
      environmentId={props.environmentId}
      app={props.icon.app}
      fallback={props.fallback}
      color={props.fallbackColor}
      themeAppearance={props.themeAppearance}
    />
  );
}

function NativeAppToolActivityIcon(props: {
  readonly environmentId: EnvironmentId;
  readonly app: Extract<ToolActivityIcon, { readonly _tag: "native-app" }>["app"];
  readonly fallback: WorkContentIcon;
  readonly color: ColorValue;
  readonly themeAppearance: "light" | "dark";
}) {
  const source = useAssetUrl(props.environmentId, {
    _tag: "native-app-icon",
    app: props.app,
  });
  return source ? (
    <ToolActivityImage
      key={source}
      source={source}
      fallback={props.fallback}
      color={props.color}
      themeAppearance={props.themeAppearance}
    />
  ) : (
    <WorkLogIcon icon={props.fallback} color={props.color} />
  );
}

/** Linear's mark (Simple Icons, CC0), tinted like the other monochrome work-log icons. */
function LinearMark(props: { readonly color: ColorValue }) {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24">
      <Path
        fill={props.color}
        d="M2.886 4.18A11.982 11.982 0 0 1 11.99 0C18.624 0 24 5.376 24 12.009c0 3.64-1.62 6.903-4.18 9.105L2.887 4.18ZM1.817 5.626l16.556 16.556c-.524.33-1.075.62-1.65.866L.951 7.277c.247-.575.537-1.126.866-1.65ZM.322 9.163l14.515 14.515c-.71.172-1.443.282-2.195.322L0 11.358a12 12 0 0 1 .322-2.195Zm-.17 4.862 9.823 9.824a12.02 12.02 0 0 1-9.824-9.824Z"
      />
    </Svg>
  );
}

/** Granola's mark (thesvg, MIT), tinted like the other monochrome work-log icons. */
function GranolaMark(props: { readonly color: ColorValue }) {
  return (
    <Svg width={14} height={14} viewBox="0 0 32 32">
      <Path
        fill={props.color}
        d="M15.83 31.91C19.13 31.91 22.59 31.18 23.98 30.17C24.87 29.53 25.31 29.6 26.1 28.84C26.32 28.62 26.42 28.55 26.48 28.49C29.5 26.01 31.24 22.81 31.24 18.65C31.24 11.89 26.45 7.29 19.6 7.29C13.57 7.29 8.97 11.13 8.97 16.05C8.97 20.52 12.46 23.73 17.44 23.73C17.73 23.73 17.85 23.57 18.17 23.57C19.38 23.57 20.36 23.22 21 22.55C21.31 22.2 21.92 21.5 21.98 21.47C22.27 21.22 22.33 20.84 22.39 20.68C22.45 20.52 22.58 20.43 22.65 20.2C22.71 19.95 22.62 19.63 22.62 19.35C22.62 18.84 22.84 18.34 22.84 17.86C22.84 16.53 21.25 15.19 19.82 15.19C19.66 15.19 19.66 15.07 19.57 15.07C19.47 15.07 19.38 15.16 19.28 15.16C19.19 15.16 19.06 15 18.93 15C18.81 15 18.74 15.13 18.55 15.13C18.14 15.13 18.11 15.19 17.79 15.19C17.7 15.19 17.54 15.22 17.47 15.26C17.35 15.32 17.35 15.41 17.22 15.41C17.05 15.41 16.96 15.45 16.96 15.51C16.96 15.86 17 15.8 16.84 15.8C16.67 15.8 16.56 15.81 16.52 15.83C16.39 15.89 16.49 16.05 16.36 16.14C16.23 16.21 16.2 16.3 16.17 16.49C16.14 16.68 15.95 16.75 15.95 16.94C15.95 17.03 15.98 17.1 15.98 17.16C15.98 17.35 15.6 17.29 15.6 17.48C15.6 17.6 15.7 17.7 15.7 17.82C15.7 17.92 15.64 17.98 15.64 18.08C15.64 18.18 15.7 18.24 15.7 18.3C15.7 18.46 15.48 18.49 15.48 18.62C15.48 18.75 15.61 18.84 15.61 18.94C15.61 19 15.51 19.03 15.51 19.12C15.51 19.22 15.48 19.06 15.67 19.35C15.79 19.54 15.79 19.63 15.67 19.79C15.54 19.95 15.29 20.05 14.97 20.05C13.64 20.05 13.48 18.68 12.75 18.46C12.53 18.4 12.49 18.36 12.49 18.27C12.49 18.18 12.49 18.21 12.62 18.08C12.75 17.95 12.78 17.86 12.78 17.76C12.78 17.67 12.78 17.63 12.72 17.57C12.46 17.16 12.34 16.65 12.34 16.08C12.34 13.16 15.89 10.72 19.26 10.72C20.27 10.72 20.11 10.97 20.72 10.97C20.88 10.97 20.81 10.97 21.03 10.94C21.61 10.85 22.65 11.07 23.48 11.48C25.76 12.62 27.25 15.32 27.25 18.46C27.25 23.83 22.49 27.73 16.15 27.73C12.69 27.73 10.31 26.65 7.96 24.02C7.7 23.73 8.09 24.08 7.67 23.35C7.17 22.46 7.23 23.03 7.23 23.03C7.07 22.84 6.78 22.3 6.62 22.11C6.43 21.89 6.18 21.92 6.09 21.79C5.96 21.64 6.15 21.35 6.09 21.19C6.02 20.94 5.48 20.56 5.42 20.37C5.36 20.18 5.13 18.97 5.13 18.75C5.13 18.49 5.32 18.46 5.32 18.3C5.32 18.08 5.04 18.02 4.88 17.7C4.72 17.38 4.62 16.65 4.62 15.86C4.62 15.44 4.62 15.29 4.75 14.33C4.78 14.02 5.26 14.02 5.26 13.67C5.26 13.54 5.2 13.38 5.2 13.29C5.2 13.16 5.2 13.13 5.23 13.03C6.56 7.45 12.53 3.29 19.16 3.29C21.44 3.29 23.19 3.71 25.88 4.85C26.77 5.23 28.07 4.56 28.07 3.87C28.14 3.65 28.01 3.58 27.98 3.45C27.95 3.33 27.82 3.17 27.69 3.14C27.63 3.1 27.59 3.01 27.53 2.91C27.43 2.76 27.34 2.69 27.09 2.63C26.96 2.6 26.9 2.57 26.83 2.5C26.73 2.37 26.67 2.31 26.55 2.25C26.42 2.18 26.32 2.25 26.26 2.21C26.2 2.18 26.16 2.12 26.1 2.09C26.07 2.06 26 2.06 25.91 2.06C22.71 .34 20.62 .09 17.83 .09C11.8 .09 6.4 2.69 3.07 7.23C2.79 7.61 2.94 8.24 2.53 8.62C1.74 9.35 .76 13.35 .76 15.89C.76 18.01 1.26 20.84 1.93 22.39C3.23 25.44 2.66 24.17 2.85 24.46C3.23 25.06 3.55 25.12 3.71 25.31C3.71 25.31 3.8 25.5 3.8 25.69C3.8 25.82 3.8 25.85 3.83 25.91C3.93 26.1 4.37 26.42 4.5 26.55C4.79 26.83 5.01 27.44 5.48 27.91C6.21 28.64 7.26 29.21 10.59 30.77C11.76 31.31 11.1 31.02 11.22 31.05C11.51 31.15 11.89 31.15 12.11 31.31C12.24 31.41 12.08 31.37 12.43 31.37C12.49 31.37 12.49 31.4 12.56 31.43C12.62 31.47 12.69 31.56 12.78 31.56C12.84 31.56 12.88 31.5 12.97 31.53C13.06 31.56 13.29 31.72 13.48 31.82C13.64 31.91 13.67 31.91 13.73 31.85C13.92 31.72 14.05 31.88 14.24 31.88C14.3 31.88 14.4 31.85 14.59 31.85C14.84 31.85 14.84 31.91 15.83 31.91"
      />
    </Svg>
  );
}

function ToolActivityImage(props: {
  readonly source: string;
  readonly fallback: WorkContentIcon;
  readonly color: ColorValue;
  readonly themeAppearance: "light" | "dark";
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <View className="h-4 w-4 items-center justify-center overflow-hidden rounded-[3px] bg-screen">
      {!loaded || failed ? <WorkLogIcon icon={props.fallback} color={props.color} /> : null}
      {!failed ? (
        <View
          style={[
            StyleSheet.absoluteFill,
            props.themeAppearance === "light" ? { filter: [{ brightness: 0.6 }] } : undefined,
          ]}
        >
          <Image
            source={props.source}
            cachePolicy="memory-disk"
            contentFit="contain"
            style={[StyleSheet.absoluteFill, { opacity: loaded ? 0.7 : 0 }]}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
          />
        </View>
      ) : null}
    </View>
  );
}

function toolGroupSummarySymbolName(kind: ToolGroupSummaryKind): AppSymbolName {
  switch (kind) {
    case "pull-request":
    case "link-pr":
    case "unlink-pr":
    case "list-prs":
    case "watch-pr":
    case "unwatch-pr":
      return PullRequestGlyph.pullRequest;
    case "read":
      return { ios: "eye", android: "visibility" };
    case "edit":
      return { ios: "square.and.pencil", android: "edit" };
    case "thread-create":
      return { ios: "bubble.left", android: "chat" };
    case "command":
      return { ios: "terminal", android: "terminal" };
    case "device":
      return { ios: "iphone", android: "smartphone" };
    case "browser":
    case "search":
      return { ios: "globe", android: "public" };
    case "code-search":
      return "magnifyingglass";
    case "other":
      return { ios: "wrench", android: "build" };
    case "reasoning":
      return { ios: "brain", android: "psychology" };
    case "agent-tool":
      return { ios: "sparkles", android: "auto_awesome" };
    case "tone-tool":
      return { ios: "bolt", android: "bolt" };
    case "dynamic-tool":
    case "update":
    case "mixed":
      return { ios: "hammer", android: "construction" };
  }
}
