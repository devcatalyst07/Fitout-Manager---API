import mongoose, { Schema, Document } from 'mongoose';

export interface IScope extends Document {
  name: string;
  description?: string;
  brandFilter: 'all' | 'specific';
  brandId?: mongoose.Types.ObjectId;
  brandName?: string;
  isActive: boolean;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const scopeSchema = new Schema<IScope>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    brandFilter: {
      type: String,
      enum: ['all', 'specific'],
      required: true,
      default: 'all',
      validate: {
        validator: function(value: string) {
          const doc = this as any;
          // If brandFilter is 'specific', must have brandId
          if (value === 'specific' && !doc.brandId) {
            return false;
          }
          return true;
        },
        message: 'Specific brand filter requires brandId'
      }
    },
    brandId: {
      type: Schema.Types.ObjectId,
      ref: 'Brand',
    },
    brandName: {
      type: String,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
scopeSchema.index({ name: 1 });
scopeSchema.index({ brandFilter: 1 });
scopeSchema.index({ brandId: 1 });
scopeSchema.index({ isActive: 1 });

const Scope = mongoose.model<IScope>('Scope', scopeSchema);

export default Scope;