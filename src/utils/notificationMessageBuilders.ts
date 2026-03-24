const formatDate = (value?: Date | string | null) => {
  if (!value) {
    return "None";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toISOString().split("T")[0];
};

const formatCurrency = (value?: number | null) => {
  if (typeof value !== "number") {
    return "0";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
};

const formatList = (items: string[]) => {
  if (items.length === 0) {
    return "details";
  }

  if (items.length === 1) {
    return items[0];
  }

  if (items.length === 2) {
    return `${items[0]} and ${items[1]}`;
  }

  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
};

export const buildProjectUpdateMessage = (
  actorName: string,
  previousProject: any,
  nextProject: any,
) => {
  const changes: string[] = [];

  const track = (label: string, previousValue: unknown, nextValue: unknown) => {
    if (previousValue !== nextValue) {
      changes.push(
        `${label} (${String(previousValue ?? "None")} → ${String(nextValue ?? "None")})`,
      );
    }
  };

  track("name", previousProject.projectName, nextProject.projectName);
  track("code", previousProject.projectCode, nextProject.projectCode);
  track("brand", previousProject.brand, nextProject.brand);
  track("region", previousProject.region, nextProject.region);
  track("status", previousProject.status, nextProject.status);
  track(
    "budget",
    formatCurrency(previousProject.budget),
    formatCurrency(nextProject.budget),
  );
  track(
    "spent",
    formatCurrency(previousProject.spent),
    formatCurrency(nextProject.spent),
  );
  track(
    "start date",
    formatDate(previousProject.startDate),
    formatDate(nextProject.startDate),
  );
  track(
    "end date",
    formatDate(previousProject.endDate),
    formatDate(nextProject.endDate),
  );
  track("EAC policy", previousProject.eacPolicyType, nextProject.eacPolicyType);
  track("EAC factor", previousProject.eacFactor, nextProject.eacFactor);
  track(
    "manual forecast",
    formatCurrency(previousProject.manualForecast),
    formatCurrency(nextProject.manualForecast),
  );

  if ((previousProject.description || "") !== (nextProject.description || "")) {
    changes.push("description");
  }

  if (changes.length === 0) {
    return `${actorName} updated project details.`;
  }

  return `${actorName} updated ${formatList(changes)}.`;
};

export const buildTaskUpdateMessage = (
  actorName: string,
  previousTask: any,
  nextTask: any,
  options?: {
    oldPhaseName?: string | null;
    newPhaseName?: string | null;
  },
) => {
  const changes: string[] = [];

  const previousAssignees = (previousTask.assignees || [])
    .map((assignee: any) => assignee.name || assignee.email)
    .sort()
    .join(", ");
  const nextAssignees = (nextTask.assignees || [])
    .map((assignee: any) => assignee.name || assignee.email)
    .sort()
    .join(", ");

  const track = (label: string, previousValue: unknown, nextValue: unknown) => {
    if (previousValue !== nextValue) {
      changes.push(
        `${label} (${String(previousValue ?? "None")} → ${String(nextValue ?? "None")})`,
      );
    }
  };

  track("title", previousTask.title, nextTask.title);
  track("status", previousTask.status, nextTask.status);
  track("priority", previousTask.priority, nextTask.priority);
  track(
    "progress",
    `${previousTask.progress ?? 0}%`,
    `${nextTask.progress ?? 0}%`,
  );
  track(
    "start date",
    formatDate(previousTask.startDate),
    formatDate(nextTask.startDate),
  );
  track(
    "due date",
    formatDate(previousTask.dueDate),
    formatDate(nextTask.dueDate),
  );
  track("estimate", previousTask.estimateHours, nextTask.estimateHours);
  track(
    "phase",
    options?.oldPhaseName || "Unassigned",
    options?.newPhaseName || "Unassigned",
  );
  track("assignees", previousAssignees || "None", nextAssignees || "None");

  if ((previousTask.description || "") !== (nextTask.description || "")) {
    changes.push("description");
  }

  if (changes.length === 0) {
    return `${actorName} updated task "${nextTask.title}".`;
  }

  return `${actorName} updated task "${nextTask.title}": ${formatList(changes)}.`;
};

export const buildBudgetUpdateMessage = (
  actorName: string,
  previousItem: any,
  nextItem: any,
) => {
  const changes: string[] = [];

  const track = (label: string, previousValue: unknown, nextValue: unknown) => {
    if (previousValue !== nextValue) {
      changes.push(
        `${label} (${String(previousValue ?? "None")} → ${String(nextValue ?? "None")})`,
      );
    }
  };

  track("description", previousItem.description, nextItem.description);
  track("vendor", previousItem.vendor, nextItem.vendor);
  track("category", previousItem.category, nextItem.category);
  track("quantity", previousItem.quantity, nextItem.quantity);
  track(
    "unit cost",
    formatCurrency(previousItem.unitCost),
    formatCurrency(nextItem.unitCost),
  );
  track("status", previousItem.committedStatus, nextItem.committedStatus);

  if (changes.length === 0) {
    return `${actorName} updated a budget item.`;
  }

  return `${actorName} updated a budget item: ${formatList(changes)}.`;
};

export const buildTeamUpdateMessage = (
  actorName: string,
  memberName: string,
  previousMember: any,
  nextMember: any,
) => {
  const changes: string[] = [];

  if (previousMember.roleName !== nextMember.roleName) {
    changes.push(
      `role (${previousMember.roleName || "None"} → ${nextMember.roleName || "None"})`,
    );
  }

  if (previousMember.status !== nextMember.status) {
    changes.push(
      `status (${previousMember.status || "None"} → ${nextMember.status || "None"})`,
    );
  }

  if (changes.length === 0) {
    return `${actorName} updated ${memberName}'s team access.`;
  }

  return `${actorName} updated ${memberName}'s team access: ${formatList(changes)}.`;
};
