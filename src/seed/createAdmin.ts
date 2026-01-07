import bcrypt from 'bcryptjs';
import { users } from '../config/db';

// Global variable to persist admin creation per serverless runtime
declare global {
  var adminCreated: boolean | undefined;
}

export const createAdmin = async () => {
  if (!global.adminCreated) {
    // Only create admin if not already created in this runtime
    const hashedPassword = await bcrypt.hash(
      'bryankaafitoutmanager',
      10
    );

    users.push({
      id: '1',
      name: 'Bryan Kaa',
      email: 'superadmin@fitoutmanager.com',
      password: hashedPassword,
      role: 'admin',
    });

    global.adminCreated = true;
    console.log('Super Admin seeded');
  }
};
