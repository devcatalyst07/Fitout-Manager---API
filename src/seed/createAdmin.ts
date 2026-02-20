import User from '../models/User';
import bcrypt from 'bcryptjs';

export const createAdmin = async () => {
  try {
    // Check if admin exists
    const adminExists = await User.findOne({ role: 'admin' });

    if (!adminExists) {
      // Create admin user
      const hashedPassword = await bcrypt.hash('bryankaafitoutmanager', 12);

      await User.create({
        name: 'Super Admin',
        email: 'superadmin@fitoutmanager.com',
        password: hashedPassword,
        role: 'admin',
        subscriptionType: 'Enterprise',
        totalProjects: 0,
        isActive: true,
        tokenVersion: 0,
        emailVerified: true,
        emailVerificationCode: undefined,
        emailVerificationExpires: undefined,
      });

      console.log('Admin user created');
      console.log('Email: superadmin@fitoutmanager.com');
      console.log('Password: bryankaafitoutmanager');
    } else {
      if (!adminExists.emailVerified) {
        adminExists.emailVerified = true;
        adminExists.emailVerificationCode = undefined;
        adminExists.emailVerificationExpires = undefined;
        await adminExists.save();
        console.log('Admin user verified');
      } else {
        console.log('Admin user already exists');
      }
    }
  } catch (error) {
    console.error('Failed to create admin:', error);
  }
};