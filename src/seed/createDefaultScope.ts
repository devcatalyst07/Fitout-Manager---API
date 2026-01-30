import Scope from '../models/Scope';
import User from '../models/User';

export const createDefaultScope = async () => {
  try {
    // Check if Standard scope already exists
    const existingScope = await Scope.findOne({ name: 'Standard' });
    
    if (existingScope) {
      console.log('Default scope "Standard" already exists');
      return;
    }

    // Find admin user to set as creator
    const adminUser = await User.findOne({ role: 'admin' });
    
    if (!adminUser) {
      console.log('No admin user found. Skipping default scope creation.');
      return;
    }

    // Create Standard scope with Basic workflow (no predefined tasks)
    const defaultScope = await Scope.create({
      name: 'Standard',
      description: 'Default scope for standard fitout projects',
      brandFilter: 'all',
      workflows: [
        {
          name: 'Basic',
          description: 'Basic workflow with no predefined tasks',
          phases: [], // No phases, no predefined tasks
        },
      ],
      isActive: true,
      createdBy: adminUser._id,
    });

    console.log('Default scope "Standard" with "Basic" workflow created successfully');
    console.log(`   - Scope ID: ${defaultScope._id}`);
    console.log(`   - No predefined tasks included`);
  } catch (error) {
    console.error('Error creating default scope:', error);
  }
};