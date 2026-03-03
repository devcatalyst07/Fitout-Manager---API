import express, { Request, Response } from "express";
import CalendarEvent from "../models/CalendarEvent";
import { authMiddleware } from "../middleware/auth";
import { requireProjectAccess } from "../middleware/permissions";
import Project from "../models/Projects";
import TeamMember from "../models/TeamMember";

const router = express.Router();

const hasProjectAccess = async (user: any, projectId: string): Promise<boolean> => {
  if (user.role === "admin") {
    const owned = await Project.findOne({ _id: projectId, userId: user.id }).select("_id");
    return !!owned;
  }

  const membership = await TeamMember.findOne({
    userId: user.id,
    projectId,
    status: "active",
  }).select("_id");
  return !!membership;
};
// ito yung bago kagabi ko na push
// Get all events for a project
router.get(
  "/projects/:projectId/events",
  authMiddleware,
  requireProjectAccess,
  async (req: express.Request, res: express.Response) => {
    try {
      const { projectId } = req.params;
      const events = await CalendarEvent.find({ projectId })
        .populate("linkedTaskId", "title status priority")
        .sort({ startDate: 1 });

      res.json(events);
    } catch (error) {
      console.error("Error fetching events:", error);
      res.status(500).json({ message: "Server error" });
    }
  },
);

// Get single event
router.get(
  "/events/:eventId",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      const event = await CalendarEvent.findById(req.params.eventId).populate(
        "linkedTaskId",
        "title status priority",
      );

      if (!event) {
        return res.status(404).json({ message: "Event not found" });
      }

      const access = await hasProjectAccess(req.user, String((event as any).projectId));
      if (!access) {
        return res.status(403).json({ message: "Not authorized to access this event" });
      }

      res.json(event);
    } catch (error) {
      console.error("Error fetching event:", error);
      res.status(500).json({ message: "Server error" });
    }
  },
);

// Create new event
router.post(
  "/projects/:projectId/events",
  authMiddleware,
  requireProjectAccess,
  async (req: express.Request, res: express.Response) => {
    try {
      const { projectId } = req.params;
      const {
        title,
        description,
        startDate,
        endDate,
        type,
        linkedTaskId,
        attendees,
        location,
        color,
      } = req.body;

      const newEvent = new CalendarEvent({
        projectId,
        title,
        description,
        startDate,
        endDate,
        type,
        linkedTaskId: linkedTaskId || undefined,
        attendees,
        location,
        color,
        createdBy: (req as any).user.id,
      });

      await newEvent.save();

      const populatedEvent = await CalendarEvent.findById(
        newEvent._id,
      ).populate("linkedTaskId", "title status priority");

      res.status(201).json(populatedEvent);
    } catch (error) {
      console.error("Error creating event:", error);
      res.status(500).json({ message: "Server error" });
    }
  },
);

// Update event
router.put(
  "/events/:eventId",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      const { eventId } = req.params;
      const updates = req.body;

      const existingEvent = await CalendarEvent.findById(eventId);
      if (!existingEvent) {
        return res.status(404).json({ message: "Event not found" });
      }

      const access = await hasProjectAccess(req.user, String((existingEvent as any).projectId));
      if (!access) {
        return res.status(403).json({ message: "Not authorized to update this event" });
      }

      const event = await CalendarEvent.findByIdAndUpdate(
        eventId,
        { $set: updates },
        { new: true },
      ).populate("linkedTaskId", "title status priority");

      if (!event) {
        return res.status(404).json({ message: "Event not found" });
      }

      res.json(event);
    } catch (error) {
      console.error("Error updating event:", error);
      res.status(500).json({ message: "Server error" });
    }
  },
);

// Delete event
router.delete(
  "/events/:eventId",
  authMiddleware,
  async (req: express.Request, res: express.Response) => {
    try {
      const existingEvent = await CalendarEvent.findById(req.params.eventId);
      if (!existingEvent) {
        return res.status(404).json({ message: "Event not found" });
      }

      const access = await hasProjectAccess(req.user, String((existingEvent as any).projectId));
      if (!access) {
        return res.status(403).json({ message: "Not authorized to delete this event" });
      }

      const event = await CalendarEvent.findByIdAndDelete(req.params.eventId);

      if (!event) {
        return res.status(404).json({ message: "Event not found" });
      }

      res.json({ message: "Event deleted successfully" });
    } catch (error) {
      console.error("Error deleting event:", error);
      res.status(500).json({ message: "Server error" });
    }
  },
);

export default router;