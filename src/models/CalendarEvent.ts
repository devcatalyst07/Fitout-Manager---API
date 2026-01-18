import mongoose, { Schema, Document } from "mongoose";

export interface ICalendarEvent extends Document {
  projectId: mongoose.Types.ObjectId;
  title: string;
  description?: string;
  startDate: Date;
  endDate: Date;
  type: "meeting" | "task" | "holiday" | "custom";
  linkedTaskId?: mongoose.Types.ObjectId;
  attendees?: string[];
  location?: string;
  color?: string;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const calendarEventSchema = new Schema<ICalendarEvent>(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: "Project",
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    description: {
      type: String,
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
    },
    type: {
      type: String,
      enum: ["meeting", "task", "holiday", "custom"],
      default: "custom",
    },
    linkedTaskId: {
      type: Schema.Types.ObjectId,
      ref: "Task",
    },
    attendees: [
      {
        type: String, // Email addresses
      },
    ],
    location: {
      type: String,
    },
    color: {
      type: String,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true },
);

export default mongoose.model<ICalendarEvent>(
  "CalendarEvent",
  calendarEventSchema,
);