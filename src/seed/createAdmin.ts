import bcrypt from 'bcryptjs';
import User from '../models/User';

export const createAdmin = async () => {
  try {
    // Check if admin already exists
    const exists = await User.findOne({ email: 'superadmin@fitoutmanager.com' });
    
    if (exists) {
      console.log('Super Admin already exists');
      return;
    }

    const hashedPassword = await bcrypt.hash('bryankaafitoutmanager', 10);

    await User.create({
      name: 'Bryan Kaa',
      email: 'superadmin@fitoutmanager.com',
      password: hashedPassword,
      role: 'admin',
      totalProjects: 0,
    });

    console.log('Super Admin (Bryan Kaa) created');
  } catch (error) {
    console.error('Error creating admin:', error);
  }
};