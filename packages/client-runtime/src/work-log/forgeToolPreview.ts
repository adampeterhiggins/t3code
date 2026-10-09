import type { PreviewRecord, ThreadActionToolPreview, ToolPreview } from "./toolPreview.ts";
import {
  documentPreview,
  humanKey,
  inferredPreview,
  isRecord,
  link,
  properties,
  records,
  scalarText,
  str,
  type Record_,
} from "./previewBuilders.ts";

/** Forge wraps most results as `{ result }`; the card reads what is inside. */
function unwrap(result: unknown): unknown {
  return isRecord(result) && Object.keys(result).length === 1 && "result" in result
    ? result.result
    : result;
}

function status(
  headline: string,
  fields: { readonly status?: string | null; readonly details?: ReadonlyArray<string | null> },
): ThreadActionToolPreview {
  return {
    kind: "thread-action",
    headline,
    status: fields.status ?? null,
    details: (fields.details ?? []).filter((detail): detail is string => Boolean(detail)),
    threadId: null,
  };
}

function rows(pairs: ReadonlyArray<readonly [string, unknown]>): Array<readonly [string, string]> {
  return pairs.flatMap(([key, value]) => {
    const text = scalarText(value);
    return text ? [[key, text] as const] : [];
  });
}

/** `add_matrix_question` → "Added a matrix question". */
function actionLabel(tool: string): string {
  const [verb = "", ...rest] = tool.split("_");
  const past: Record<string, string> = {
    add: "Added",
    update: "Updated",
    remove: "Removed",
    delete: "Deleted",
    duplicate: "Duplicated",
    clear: "Cleared",
    reorder: "Reordered",
    create: "Created",
    copy: "Copied",
    clone: "Cloned",
    import: "Imported",
    translate: "Translated",
    set: "Set",
    get: "Got",
  };
  const object = rest.join(" ");
  const article = /^[aeiou]/.test(object) ? "an" : "a";
  return past[verb]
    ? `${past[verb]} ${rest.length === 1 ? "the" : article} ${object}`
    : humanKey(tool);
}

function entryRecord(entry: Record_, index: number): PreviewRecord {
  const number = typeof entry.number === "number" ? `Q${entry.number + 1}` : null;
  const options = Array.isArray(entry.response_options) ? entry.response_options.length : 0;
  const rowsCount = Array.isArray(entry.matrix_rows) ? entry.matrix_rows.length : 0;
  return {
    key: str(entry.id) ?? String(index),
    title:
      str(entry.title) ?? str(entry.text) ?? str(entry.question_text) ?? str(entry.name) ?? "Entry",
    subtitle:
      (str(entry.entry_type) ?? str(entry.question_type_code) ?? str(entry.response_type))
        ?.replace(/EntryType$/, "")
        .replaceAll("_", " ") ?? null,
    meta: [
      number,
      options > 0 ? `${options} option${options === 1 ? "" : "s"}` : null,
      rowsCount > 0 ? `${rowsCount} row${rowsCount === 1 ? "" : "s"}` : null,
    ].filter((meta): meta is string => meta !== null),
    url: null,
    body: null,
    threadId: null,
  };
}

function questionnairePreview(tool: string, input: Record_, data: Record_): ToolPreview | null {
  const questionnaire = isRecord(data.questionnaire) ? data.questionnaire : data;
  const entries = Array.isArray(questionnaire.entries)
    ? questionnaire.entries.filter(isRecord)
    : null;
  if (!entries) return null;
  const changed = isRecord(input.entry) ? (str(input.entry.text) ?? str(input.entry.title)) : null;
  return records(entries.map(entryRecord), {
    summary: tool.startsWith("get_") ? null : actionLabel(tool),
    notes: [
      changed ? `“${changed}”` : null,
      `${entries.length} entr${entries.length === 1 ? "y" : "ies"} in the questionnaire`,
    ],
  });
}

function projectPreview(data: Record_): ToolPreview | null {
  const project = isRecord(data.project) ? data.project : null;
  if (!project) {
    const error = str(data.error);
    return error ? documentPreview(error) : null;
  }
  const surveys = Array.isArray(project.surveys) ? project.surveys.filter(isRecord) : [];
  const fieldwork = isRecord(data.fieldwork) ? data.fieldwork : null;
  const account = isRecord(data.account) ? data.account : null;
  return properties(
    rows([
      ["Type", project.project_type],
      ["Status", project.status],
      [
        "Survey",
        surveys[0] ? `${str(surveys[0].name) ?? ""} (${str(surveys[0].state) ?? ""})` : null,
      ],
      ["Account", account?.name],
      ["Creator", project.creator],
      ["Created", project.created_date],
      ["Samples", fieldwork?.samples_needed],
      ["Country", fieldwork?.locale_country],
      ["Panel", fieldwork?.panel_supplier_code],
      [
        "Fieldwork",
        fieldwork
          ? `${str(fieldwork.start_date)?.slice(0, 10) ?? ""} → ${str(fieldwork.end_date)?.slice(0, 10) ?? ""}`
          : null,
      ],
    ]),
    { title: str(project.name) ?? str(surveys[0]?.name) ?? "Project" },
  );
}

/** Focaldata's Forge tools: questionnaires, projects, accounts, respondents, orders and quotas. */
export function forgeToolPreview(
  tool: string,
  input: Record_,
  result: unknown,
): ToolPreview | null {
  const inner = unwrap(result);
  if (typeof inner === "string") {
    return status(inner.replace(/^Success: /, ""), {
      status: inner.startsWith("Success") ? "completed" : null,
    });
  }
  const data = isRecord(inner) ? inner : null;
  if (Array.isArray(inner)) {
    if (tool === "list_accounts" || inner.some((item) => isRecord(item) && "account_id" in item)) {
      return records(
        inner.filter(isRecord).map((account, index) => ({
          key: str(account.account_id) ?? String(index),
          title: str(account.name) ?? "Account",
          subtitle: str(account.status),
          meta:
            typeof account.markup === "number" && account.markup > 0
              ? [`markup ${account.markup}`]
              : [],
          url: null,
          body: null,
          threadId: null,
        })),
      );
    }
    return inferredPreview(inner);
  }
  if (!data) return null;
  const questionnaire = questionnairePreview(tool, input, data);
  if (questionnaire) return questionnaire;
  switch (tool) {
    case "ping":
      return status(data.pong === true ? "Forge is reachable" : "Forge did not answer", {
        status: data.pong === true ? "completed" : "failed",
        details: [str(data.environment), str(data.service)],
      });
    case "fetch_respondent_ids": {
      const ids = Array.isArray(data.respondent_ids)
        ? data.respondent_ids.filter((id) => typeof id === "string")
        : [];
      return records(
        ids.map((id) => ({
          key: id,
          title: id,
          subtitle: null,
          meta: [],
          url: null,
          body: null,
          threadId: null,
        })),
        {
          summary: `${ids.length} respondent${ids.length === 1 ? "" : "s"}${str(input.status) ? ` with status ${str(input.status)}` : ""}`,
        },
      );
    }
    case "reconcile_respondents": {
      const failed = Array.isArray(data.failed_respondent_identifiers)
        ? data.failed_respondent_identifiers.length
        : 0;
      const unresolved = Array.isArray(data.unresolved_supplier_respondent_ids)
        ? data.unresolved_supplier_respondent_ids.length
        : 0;
      return status(`Reconciled as ${str(input.status) ?? "requested"}`, {
        status: failed > 0 ? "failed" : "completed",
        details: [`${failed} failed`, `${unresolved} unresolved at the panel`],
      });
    }
    case "run_data_quality_checks": {
      const results = Array.isArray(data.respondent_data_quality_check_results)
        ? data.respondent_data_quality_check_results.filter(isRecord)
        : [];
      return records(
        results.map((check, index) => ({
          key: str(check.focaldata_public_respondent_id) ?? String(index),
          title:
            str(check.supplier_respondent_id) ??
            str(check.focaldata_public_respondent_id) ??
            "Respondent",
          subtitle: str(check.check_result),
          meta: Array.isArray(check.failed_check_types)
            ? check.failed_check_types.filter((type): type is string => typeof type === "string")
            : [],
          url: null,
          body: null,
          threadId: null,
        })),
        { summary: "Data quality checks" },
      );
    }
    case "retrieve_order_statistics": {
      const order = isRecord(data.survey_order) ? data.survey_order : data;
      const orders = Array.isArray(order.panel_supplier_orders)
        ? order.panel_supplier_orders.filter(isRecord)
        : [];
      return records(
        orders.map((item, index) => ({
          key: str(item.order_id) ?? String(index),
          title: str(item.order_description) ?? `Order ${String(item.order_number ?? index)}`,
          subtitle: str(item.status),
          meta: [
            typeof item.cpi === "number" ? `CPI ${item.cpi}` : null,
            isRecord(item.order_receipt) ? str(item.order_receipt.panel_supplier_code) : null,
            str(item.created_date)?.slice(0, 10) ?? null,
          ].filter((meta): meta is string => meta !== null),
          url: null,
          body: null,
          threadId: null,
        })),
        { summary: `Survey order ${str(order.status) ?? ""}`.trim() },
      );
    }
    case "place_order":
      return properties(
        rows([
          ["Order number", data.order_number],
          ["Panel order", data.panel_supplier_order_id],
          ["Order id", data.order_id],
        ]),
        { title: "Order placed", notes: [str(data.error)] },
      );
    case "update_order_status":
      return status(
        `Order #${String(input.order_number ?? data.order_number ?? "")} set to ${str(input.status) ?? "updated"}`,
        {
          status: data.updated === true ? "completed" : "failed",
        },
      );
    case "get_quota_targets": {
      const targets = Array.isArray(data.targets) ? data.targets.filter(isRecord) : [];
      return records(
        targets.map((target, index) => ({
          key: str(target.quota_target_id) ?? String(index),
          title: str(target.label) ?? "Quota",
          subtitle: target.enabled === false ? "disabled" : null,
          meta: [
            str(target.group_label),
            `current ${scalarText(target.current_value) ?? "—"}`,
          ].filter((meta): meta is string => meta !== null),
          url: null,
          body: null,
          threadId: null,
        })),
        { summary: "Quota targets" },
      );
    }
    case "trigger_weights_calculation":
    case "get_weights_calculation_status":
      return status(str(data.message) ?? "Weights calculation", {
        status: str(data.status),
        details: [
          typeof data.weights_calculated === "number"
            ? `${data.weights_calculated} respondents weighted`
            : null,
          str(data.error),
        ],
      });
    case "check_fieldwork_state":
      return status(`Fieldwork ${str(data.state) ?? "state"}`, { status: str(data.state) });
    case "get_account_details":
      return properties(
        rows([
          ["Status", data.status],
          ["Markup", data.markup],
          ["Account id", data.account_id],
        ]),
        {
          title: str(data.name) ?? "Account",
          notes: [str(data.error)],
        },
      );
    default:
      break;
  }
  if (tool.endsWith("download_url")) {
    const url = Object.entries(data).find(
      ([key, value]) => key.endsWith("url") && typeof value === "string",
    )?.[1];
    return properties(
      rows([
        ["Survey", data.survey_id ?? input.survey_id],
        ["Format", input.output_format],
      ]),
      {
        title: humanKey(tool.replace(/^get_/, "").replace(/_url$/, "")),
        link: link("Download", typeof url === "string" ? url : null),
      },
    );
  }
  if (isRecord(data.project) || /project/.test(tool)) {
    const project = projectPreview(data);
    if (project) return project;
  }
  return inferredPreview(data, humanKey(tool));
}
