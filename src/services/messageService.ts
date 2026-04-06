import mongoose from "mongoose";
import User, { IUser } from "../models/User";
import Conversation, { IConversation } from "../models/Conversation";
import Message, { IMessage } from "../models/Message";
import { getSeatLimit } from "../config/subscriptionPlans";
import type { SubscriptionPlan } from "../config/subscriptionPlans";

/**
 * Resolve the admin account that "owns" a given user.
 *  – If the user IS an admin, return that user's _id.
 *  – If the user is managed by an admin, return managedByAdminId.
 */
export const resolveAdminId = async (
  userId: string,
): Promise<string | null> => {
  const user = await User.findById(userId).select("role managedByAdminId").lean();
  if (!user) return null;
  if (user.role === "admin") return user._id.toString();
  return user.managedByAdminId?.toString() ?? null;
};

/**
 * Get eligible messaging members under an admin, respecting seat limits.
 * Returns the admin + managed users capped by the plan limit.
 */
export const getTeamMembers = async (
  adminId: string,
): Promise<Pick<IUser, "_id" | "name" | "email" | "role">[]> => {
  const admin = await User.findById(adminId)
    .select("name email role subscriptionType")
    .lean();
  if (!admin) return [];

  const plan = (admin.subscriptionType as SubscriptionPlan) || "Starter";
  const seatLimit = getSeatLimit(plan); // null = unlimited

  // Managed users sorted oldest-first so seat allocation is deterministic
  const managedUsers = await User.find({
    managedByAdminId: new mongoose.Types.ObjectId(adminId),
    isActive: true,
  })
    .select("name email role")
    .sort({ createdAt: 1 })
    .lean();

  // Admin always occupies seat #1
  const members: Pick<IUser, "_id" | "name" | "email" | "role">[] = [
    { _id: admin._id, name: admin.name, email: admin.email, role: admin.role },
  ];

  const remaining = seatLimit === null ? managedUsers.length : seatLimit - 1;
  for (let i = 0; i < Math.min(remaining, managedUsers.length); i++) {
    members.push(managedUsers[i] as any);
  }

  return members;
};

/**
 * List conversations the user participates in, enriched with last message.
 */
export const getUserConversations = async (userId: string) => {
  const conversations = await Conversation.find({
    participants: new mongoose.Types.ObjectId(userId),
  })
    .populate("participants", "name email role")
    .populate({
      path: "lastMessage",
      select: "text senderId createdAt",
      populate: { path: "senderId", select: "name" },
    })
    .sort({ lastMessageAt: -1 })
    .lean();

  // Attach unread counts per conversation for this user
  const enriched = await Promise.all(
    conversations.map(async (convo) => {
      const unreadCount = await Message.countDocuments({
        conversationId: convo._id,
        readBy: { $ne: new mongoose.Types.ObjectId(userId) },
        senderId: { $ne: new mongoose.Types.ObjectId(userId) },
      });
      return { ...convo, unreadCount };
    }),
  );

  return enriched;
};

/**
 * Get or create a direct conversation between two users.
 */
export const getOrCreateDirectConversation = async (
  userId: string,
  targetUserId: string,
  adminId: string,
): Promise<IConversation> => {
  const participantIds = [
    new mongoose.Types.ObjectId(userId),
    new mongoose.Types.ObjectId(targetUserId),
  ].sort((a, b) => a.toString().localeCompare(b.toString()));

  let conversation = await Conversation.findOne({
    type: "direct",
    adminId: new mongoose.Types.ObjectId(adminId),
    participants: { $all: participantIds, $size: 2 },
  });

  if (!conversation) {
    conversation = await Conversation.create({
      type: "direct",
      participants: participantIds,
      adminId: new mongoose.Types.ObjectId(adminId),
      createdBy: new mongoose.Types.ObjectId(userId),
    });
  }

  return conversation;
};

/**
 * Create a group conversation.
 */
export const createGroupConversation = async (
  name: string,
  participantIds: string[],
  createdBy: string,
  adminId: string,
): Promise<IConversation> => {
  // Ensure creator is always a participant
  const uniqueIds = [
    ...new Set([createdBy, ...participantIds]),
  ].map((id) => new mongoose.Types.ObjectId(id));

  const conversation = await Conversation.create({
    type: "group",
    name,
    participants: uniqueIds,
    adminId: new mongoose.Types.ObjectId(adminId),
    createdBy: new mongoose.Types.ObjectId(createdBy),
  });

  return conversation;
};

/**
 * Get paginated messages for a conversation.
 */
export const getMessages = async (
  conversationId: string,
  page: number = 1,
  limit: number = 50,
) => {
  const skip = (page - 1) * limit;

  const messages = await Message.find({ conversationId })
    .populate("senderId", "name email")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const total = await Message.countDocuments({ conversationId });

  return {
    messages: messages.reverse(), // oldest-first for display
    total,
    page,
    totalPages: Math.ceil(total / limit),
  };
};

/**
 * Send a new message and update the parent conversation.
 */
export const sendMessage = async (
  conversationId: string,
  senderId: string,
  text: string,
  attachments?: IMessage["attachments"],
) => {
  const message = await Message.create({
    conversationId: new mongoose.Types.ObjectId(conversationId),
    senderId: new mongoose.Types.ObjectId(senderId),
    text,
    attachments: attachments ?? [],
    readBy: [new mongoose.Types.ObjectId(senderId)],
  });

  await Conversation.findByIdAndUpdate(conversationId, {
    lastMessage: message._id,
    lastMessageAt: message.createdAt,
  });

  const populated = await Message.findById(message._id)
    .populate("senderId", "name email")
    .lean();

  return populated;
};

/**
 * Mark all messages in a conversation as read for a user.
 */
export const markConversationRead = async (
  conversationId: string,
  userId: string,
) => {
  await Message.updateMany(
    {
      conversationId: new mongoose.Types.ObjectId(conversationId),
      readBy: { $ne: new mongoose.Types.ObjectId(userId) },
    },
    { $addToSet: { readBy: new mongoose.Types.ObjectId(userId) } },
  );
};
