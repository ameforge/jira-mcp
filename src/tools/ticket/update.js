import {z} from "zod";
import {defineTool} from "../../define-tool.js";
import {EPIC_LINK_FIELD, START_DATE_FIELD} from "../../ticket-fields.js";
import {withIssueTypes} from "../../valid-names.js";
import {formSession} from "../../web-form.js";
import {planTypeChange, runTypeWizard} from "./change-type.js";
import {moveSubtaskParent} from "./move-subtask.js";

// Jira's REST API silently ignores certain field writes (issue-type/Sub-task
// conversions in particular) instead of rejecting the request, so callers
// that depend on the write actually landing need to re-read and compare.
const verifyFieldApplied = async (
  jira,
  ticket_id,
  {expected, field, hint, label, noneText = "", readActual},
) => {
  const check = await jira("GET", `/issue/${ticket_id}?fields=${field}`);
  const actual = readActual(check.fields);
  if (actual !== expected) {
    throw new Error(
      `${ticket_id} was updated, but Jira did not apply the ${label} change ` +
        `(still "${actual || noneText}"). ${hint}`,
    );
  }
};

export const registerUpdateTicket = (
  server,
  jiraRequest,
  forms = formSession,
) => {
  defineTool(
    server,
    "update_ticket",
    {
      description:
        "Update fields of a Jira ticket. Changing issue_type to or from a " +
        "sub-task type, or parent_key of an existing sub-task, goes through " +
        "Jira's Move/Convert wizards; converting to a sub-task needs parent_key. " +
        "It stops instead of deleting field values the new type cannot hold, " +
        "unless allow_field_loss is true.",
      inputSchema: z.object({
        allow_field_loss: z
          .boolean()
          .optional()
          .describe(
            "With issue_type: let the type change delete field values the new type cannot hold. Without it, the change stops instead.",
          ),
        assignee: z
          .string()
          .optional()
          .describe("Username to assign, or empty string to unassign"),
        description: z.string().optional().describe("Replace full description"),
        due_date: z
          .string()
          .optional()
          .describe("Due date YYYY-MM-DD, or empty string to clear"),
        epic_key: z
          .string()
          .optional()
          .describe(
            "Epic ticket key to set as this issue's Epic Link (shows under " +
              'the Epic\'s "Issues in Epic" panel, not Linked Issues)',
          ),
        implementation_notes: z
          .string()
          .optional()
          .describe("Append implementation notes to description"),
        issue_type: z
          .string()
          .optional()
          .describe(
            'Issue type name exactly as defined in the project, e.g. Story, Task, Bug, Sub-task, or a custom type like "QA Sub-Task"',
          ),
        labels: z.array(z.string()).optional().describe("Labels to set"),
        original_estimate: z
          .string()
          .optional()
          .describe('Time estimate e.g. "2h", "1d 4h"'),
        parent_key: z
          .string()
          .optional()
          .describe(
            "Parent ticket key for any sub-task type (Sub-task or a custom one)",
          ),
        priority: z
          .string()
          .optional()
          .describe('Priority name, e.g. "High", "Medium", "Low"'),
        start_date: z
          .string()
          .optional()
          .describe("Start date YYYY-MM-DD, or empty string to clear"),
        summary: z.string().optional().describe("Replace ticket summary/title"),
        ticket_id: z.string().describe("Jira issue key, e.g. PROJ-234"),
      }),
    },
    async (
      {
        ticket_id,
        allow_field_loss,
        summary,
        description,
        implementation_notes,
        issue_type,
        parent_key,
        epic_key,
        labels,
        due_date,
        start_date,
        original_estimate,
        assignee,
        priority,
      },
      jira,
    ) => {
      const fields = {};

      if (summary !== undefined) fields.summary = summary;
      if (description !== undefined) fields.description = description;
      if (assignee !== undefined) {
        fields.assignee = assignee ? {name: assignee} : null;
      }

      if (implementation_notes !== undefined) {
        // Append to a description passed in the same call, not the stored one.
        const existing =
          description ??
          ((await jira("GET", `/issue/${ticket_id}?fields=description`)).fields
            .description ||
            "");
        fields.description =
          existing +
          "\n\n--- Implementation Notes ---\n" +
          implementation_notes;
      }

      if (issue_type !== undefined) fields.issuetype = {name: issue_type};
      if (priority !== undefined) fields.priority = {name: priority};
      if (parent_key !== undefined) fields.parent = {key: parent_key};
      if (epic_key !== undefined) fields[EPIC_LINK_FIELD] = epic_key;
      if (labels !== undefined) fields.labels = labels;
      // Jira cannot parse "" as a date; null is how it clears one.
      if (due_date !== undefined) fields.duedate = due_date || null;
      if (start_date !== undefined)
        fields[START_DATE_FIELD] = start_date || null;

      const body = {fields};

      if (original_estimate !== undefined) {
        body.update = {
          timetracking: [{edit: {originalEstimate: original_estimate}}],
        };
      }

      if (Object.keys(fields).length === 0 && !body.update) {
        throw new Error("No fields provided to update");
      }

      // REST rejects a type change to a sub-task type and ignores one from it,
      // so those go through Jira's wizard, which also sets the new parent.
      const typePlan =
        issue_type !== undefined &&
        (await planTypeChange(jira, ticket_id, issue_type, parent_key));
      if (typePlan) {
        delete fields.issuetype;
        delete fields.parent;
      }

      // The wizards run before the REST write: they stop with "nothing was
      // changed", which only holds while no other field has been saved yet.
      // The type wizard goes first: converting to a sub-task sets the parent.
      // What the wizards already changed, for an error after them.
      const changed = [];
      if (typePlan) {
        await runTypeWizard(forms, typePlan, allow_field_loss);
        changed.push(`issue type to "${issue_type}"`);
      }
      if (parent_key !== undefined) {
        const {id, fields: current} = await jira(
          "GET",
          `/issue/${ticket_id}?fields=parent`,
        );
        // A sub-task keeps its old parent after the PUT; Jira only re-parents
        // it through the Move form.
        if (current.parent && current.parent.key !== parent_key) {
          await moveSubtaskParent(forms, id, parent_key);
          changed.push(`parent to ${parent_key}`);
        }
      }

      if (Object.keys(fields).length > 0 || body.update) {
        // An issue key is "<project>-<n>", so the project comes from the key.
        await withIssueTypes(
          () => jira("PUT", `/issue/${ticket_id}`, body),
          jira,
          ticket_id.replace(/-\d+$/, ""),
        ).catch((err) => {
          if (!changed.length) throw err;
          throw new Error(
            `${ticket_id}: changed ${changed.join(" and ")}, but the other fields were not saved: ${err.message}`,
          );
        });
      }

      if (issue_type !== undefined) {
        await verifyFieldApplied(jira, ticket_id, {
          expected: issue_type,
          field: "issuetype",
          hint: 'For a change between two standard types, use the Jira UI "Move" action.',
          label: "issue type",
          readActual: (f) => f.issuetype.name,
        });
      }

      if (parent_key !== undefined) {
        await verifyFieldApplied(jira, ticket_id, {
          expected: parent_key,
          field: "parent",
          hint: 'Only sub-tasks have a parent; to make it one, pass issue_type with a sub-task type (e.g. "Sub-task") together with parent_key.',
          label: "parent",
          noneText: "no parent",
          readActual: (f) => f.parent?.key,
        });
      }

      if (epic_key !== undefined) {
        await verifyFieldApplied(jira, ticket_id, {
          expected: epic_key,
          field: EPIC_LINK_FIELD,
          hint: "Epic Link can only be set on standard issue types (Story/Task/Bug), not on Sub-tasks or Epics themselves.",
          label: "Epic Link",
          noneText: "no epic",
          readActual: (f) => f[EPIC_LINK_FIELD],
        });
      }

      return `${ticket_id} updated successfully`;
    },
    jiraRequest,
  );
};
