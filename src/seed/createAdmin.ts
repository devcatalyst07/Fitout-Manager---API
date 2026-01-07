import bcrypt from 'bcryptjs';
import { users } from '../config/db';

export const createAdmin = async () => {
  const exists = users.find(
    (u) => u.email === 'superadmin@fitoutmanager.com'
  );

  if (exists) return;

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

  console.log('✅ Super Admin seeded');
};
