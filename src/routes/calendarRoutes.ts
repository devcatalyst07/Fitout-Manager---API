import express, { Request, Response } from "express";
import CalendarEvent from "../models/CalendarEvent";
import { authMiddleware } from "../middleware/auth";

const router = express.Router();
// ito yung bago kagabi ko na push
// Get all events for a project
router.get(
  "/projects/:projectId/events",
  authMiddleware,
  async (req: Request, res: Response) => {
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
  async (req: Request, res: Response) => {
    try {
      const event = await CalendarEvent.findById(req.params.eventId).populate(
        "linkedTaskId",
        "title status priority",
      );

      if (!event) {
        return res.status(404).json({ message: "Event not found" });
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
  async (req: Request, res: Response) => {
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
  async (req: Request, res: Response) => {
    try {
      const { eventId } = req.params;
      const updates = req.body;

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
  async (req: Request, res: Response) => {
    try {
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