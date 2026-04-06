import mongoose from "mongoose";
import Role from "../models/Role";

/**
 * Add messages permission to existing roles that don't have it.
 * Run this once after deploying the messages feature.
 */
export const addMessagesPermissionToExistingRoles = async () => {
  try {
    console.log("🔧 Adding messages permission to existing roles...");

    const roles = await Role.find({});
    let updatedCount = 0;

    for (const role of roles) {
      const hasMessagesPermission = role.permissions.some(
        (p: any) => p.id === "messages"
      );

      if (!hasMessagesPermission) {
        role.permissions.push({
          id: "messages",
          label: "Messages",
          checked: false,
        });

        await role.save();
        updatedCount++;
        console.log(`   ✓ Updated role: ${role.name}`);
      }
    }

    console.log(`✅ Added messages permission to ${updatedCount} roles`);
  } catch (error) {
    console.error("❌ Error adding messages permission:", error);
  }
};