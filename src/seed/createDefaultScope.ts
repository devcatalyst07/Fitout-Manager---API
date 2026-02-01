import Scope from '../models/Scope';
import Workflow from '../models/Workflow';
import User from '../models/User';

export const createDefaultScope = async () => {
  try {
    console.log('🔧 Checking for default scope...');

    // Check if Standard scope already exists
    const existingScope = await Scope.findOne({ name: 'Standard' });
    
    if (existingScope) {
      console.log('Default scope "Standard" already exists');
      
      // Check if it has the Basic workflow
      const existingWorkflow = await Workflow.findOne({
        scopeId: existingScope._id,
        name: 'Basic',
      });
      
      if (existingWorkflow) {
        console.log('Default workflow "Basic" already exists');
        return;
      }
    }

    // Find admin user to set as creator
    const adminUser = await User.findOne({ role: 'admin' });
    
    if (!adminUser) {
      console.log('No admin user found. Skipping default scope creation.');
      return;
    }

    let scope = existingScope;

    // Create Standard scope if it doesn't exist
    if (!scope) {
      scope = await Scope.create({
        name: 'Standard',
        description: 'Default scope for standard fitout projects',
        brandFilter: 'all',
        isActive: true,
        createdBy: adminUser._id,
      });
      console.log('Default scope "Standard" created successfully');
    }

    // Create Basic workflow (no predefined phases or tasks)
    const basicWorkflow = await Workflow.create({
      name: 'Basic',
      description: 'Basic workflow with no predefined tasks',
      scopeId: scope._id,
      isActive: true,
      createdBy: adminUser._id,
    });

    console.log('Default workflow "Basic" created successfully');
    console.log(`   - Scope ID: ${scope._id}`);
    console.log(`   - Workflow ID: ${basicWorkflow._id}`);
    console.log(`   - No predefined phases or tasks included`);
  } catch (error) {
    console.error('Error creating default scope:', error);
  }
};