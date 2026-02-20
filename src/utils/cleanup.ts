import User from "../models/User";

/**
 * Delete unverified users older than 24 hours
 * This prevents the database from filling up with abandoned registrations
 */
export const cleanupUnverifiedUsers = async (): Promise<void> => {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const result = await User.deleteMany({
      emailVerified: false,
      createdAt: { $lt: twentyFourHoursAgo },
    });

    if (result.deletedCount > 0) {
      console.log(
        `🧹 Cleanup: Deleted ${result.deletedCount} unverified user(s) older than 24 hours`,
      );
    }
  } catch (error) {
    console.error("Error cleaning up unverified users:", error);
  }
};

/**
 * Start periodic cleanup task
 * Runs every 6 hours
 */
export const startCleanupScheduler = (): NodeJS.Timeout => {
  // Run cleanup immediately on startup
  cleanupUnverifiedUsers();

  // Then run every 6 hours (6 * 60 * 60 * 1000 ms)
  const interval = setInterval(
    () => {
      cleanupUnverifiedUsers();
    },
    6 * 60 * 60 * 1000,
  );

  console.log("🔄 Cleanup scheduler started (runs every 6 hours)");

  return interval;
};
