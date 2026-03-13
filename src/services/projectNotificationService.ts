import mongoose from "mongoose";
import Notification from "../models/Notification";
import Project from "../models/Projects";
import TeamMember from "../models/TeamMember";
import User from "../models/User";
import { sendNotificationEvent } from "./notificationRealtimeService";

type ProjectSection = "overview" | "tasks" | "budget" | "documents" | "team";

interface ProjectNotificationParams {
  projectId: string;
  actorId: string;
  actorName: string;
  actorEmail?: string;
  title: string;
  message: string;
  taskId?: string;
  section?: ProjectSection;
  extraRecipientUserIds?: string[];
  extraRecipientEmails?: string[];
  metadata?: Record<string, unknown>;
}

interface NotificationRecipient {
  _id: mongoose.Types.ObjectId;
  email: string;
  name: string;
  role: "admin" | "user";
}

const normalizeEmails = (emails: string[] = []) =>
  emails
    .filter(Boolean)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

const buildProjectActionUrl = (
  role: "admin" | "user",
  projectId: string,
  section: ProjectSection = "overview",
) => {
  const basePath = role === "admin" ? "/admin/projects" : "/user/projects";
  return section === "overview"
    ? `${basePath}/${projectId}/overview`
    : `${basePath}/${projectId}/${section}`;
};

const getProjectRecipients = async (
  projectId: string,
  actorId: string,
  actorEmail?: string,
  extraRecipientUserIds: string[] = [],
  extraRecipientEmails: string[] = [],
): Promise<NotificationRecipient[]> => {
  const project =
    await Project.findById(projectId).select("projectName userId");
  if (!project) {
    return [];
  }

  const activeMembers = await TeamMember.find({
    projectId,
    status: "active",
  }).select("userId");

  const recipientUserIds = new Set<string>();
  recipientUserIds.add(project.userId.toString());

  for (const member of activeMembers) {
    if (member.userId) {
      recipientUserIds.add(member.userId.toString());
    }
  }

  for (const userId of extraRecipientUserIds.filter(Boolean)) {
    recipientUserIds.add(userId);
  }

  const recipientsById = new Map<string, NotificationRecipient>();

  if (recipientUserIds.size > 0) {
    const users = await User.find({
      _id: { $in: Array.from(recipientUserIds) },
      isActive: true,
    }).select("name email role");

    for (const user of users) {
      recipientsById.set(user._id.toString(), {
        _id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
      });
    }
  }

  const normalizedExtraEmails = normalizeEmails(extraRecipientEmails);
  if (normalizedExtraEmails.length > 0) {
    const extraUsers = await User.find({
      email: { $in: normalizedExtraEmails },
      isActive: true,
    }).select("name email role");

    for (const user of extraUsers) {
      recipientsById.set(user._id.toString(), {
        _id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
      });
    }
  }

  const normalizedActorEmail = actorEmail?.trim().toLowerCase();

  return Array.from(recipientsById.values()).filter((recipient) => {
    if (recipient._id.toString() === actorId) {
      return false;
    }

    if (
      normalizedActorEmail &&
      recipient.email.toLowerCase() === normalizedActorEmail
    ) {
      return false;
    }

    return true;
  });
};

export const notifyProjectParticipants = async ({
  projectId,
  actorId,
  actorName,
  actorEmail,
  title,
  message,
  taskId,
  section = "overview",
  extraRecipientUserIds = [],
  extraRecipientEmails = [],
  metadata = {},
}: ProjectNotificationParams) => {
  try {
    const recipients = await getProjectRecipients(
      projectId,
      actorId,
      actorEmail,
      extraRecipientUserIds,
      extraRecipientEmails,
    );

    if (recipients.length === 0) {
      return;
    }

    const createdNotifications = await Notification.insertMany(
      recipients.map((recipient) => ({
        type: "project_update",
        recipientId: recipient._id,
        recipientEmail: recipient.email,
        title,
        message,
        actionUrl: buildProjectActionUrl(recipient.role, projectId, section),
        metadata: {
          actorId,
          actorName,
          actorEmail,
          projectId,
          taskId,
          section,
          ...metadata,
        },
      })),
      { ordered: false },
    );

    const notificationsByRecipient = new Map<string, any>();
    for (const notification of createdNotifications) {
      notificationsByRecipient.set(
        notification.recipientId.toString(),
        notification,
      );
    }

    for (const recipient of recipients) {
      const notification = notificationsByRecipient.get(
        recipient._id.toString(),
      );
      if (!notification) {
        continue;
      }

      sendNotificationEvent(recipient._id.toString(), "notification:new", {
        type: "notification:new",
        notification,
      });
    }
  } catch (error) {
    console.error("Project notification error:", error);
  }
};
