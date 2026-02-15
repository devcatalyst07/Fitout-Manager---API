import mongoose from 'mongoose';

/**
 * Global MongoDB connection cache for serverless environments
 * This prevents creating new connections on every serverless function invocation
 */
interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

declare global {
  var mongoose: MongooseCache | undefined;
}

// Use global cache to persist connection across serverless invocations
let cached: MongooseCache = global.mongoose || { conn: null, promise: null };

if (!global.mongoose) {
  global.mongoose = cached;
}

/**
 * Connect to MongoDB with optimized settings for serverless
 */
export const connectDB = async (): Promise<typeof mongoose> => {
  // Return cached connection if it exists
  if (cached.conn) {
    console.log('Using cached database connection');
    return cached.conn;
  }

  // Return pending connection promise if one is in progress
  if (cached.promise) {
    console.log('Waiting for pending database connection');
    cached.conn = await cached.promise;
    return cached.conn;
  }

  const MONGODB_URI = process.env.MONGODB_URI;

  if (!MONGODB_URI) {
    throw new Error(
      'Please define the MONGODB_URI environment variable inside .env'
    );
  }

  // Optimized connection options for serverless
  const connectionOptions = {
    bufferCommands: false, // Disable mongoose buffering
    maxPoolSize: parseInt(process.env.DB_MAX_POOL_SIZE || '10'),
    minPoolSize: parseInt(process.env.DB_MIN_POOL_SIZE || '2'),
    maxIdleTimeMS: 60000, // Close connections after 60s of inactivity
    serverSelectionTimeoutMS: 10000, // Timeout after 10s if no server available
    socketTimeoutMS: 45000, // Close sockets after 45s of inactivity
    family: 4, // Use IPv4, skip trying IPv6
  };

  console.log('🔌 Connecting to MongoDB...');
  console.log('   Environment:', process.env.NODE_ENV || 'development');
  console.log('   Pool Size:', `${connectionOptions.minPoolSize}-${connectionOptions.maxPoolSize}`);

  try {
    // Create new connection promise
    cached.promise = mongoose.connect(MONGODB_URI, connectionOptions);

    // Wait for connection
    cached.conn = await cached.promise;

    console.log('MongoDB connected successfully');
    console.log('   Database:', cached.conn.connection.name);
    console.log('   Host:', cached.conn.connection.host);

    // Handle connection events
    cached.conn.connection.on('connected', () => {
      console.log('MongoDB connection established');
    });

    cached.conn.connection.on('error', (err) => {
      console.error('MongoDB connection error:', err);
      cached.conn = null;
      cached.promise = null;
    });

    cached.conn.connection.on('disconnected', () => {
      console.log('MongoDB disconnected');
      cached.conn = null;
      cached.promise = null;
    });

    return cached.conn;
  } catch (error) {
    console.error('MongoDB connection failed:', error);
    cached.promise = null;
    throw error;
  }
};

/**
 * Disconnect from MongoDB (mainly for testing)
 */
export const disconnectDB = async (): Promise<void> => {
  if (!cached.conn) {
    return;
  }

  try {
    await cached.conn.disconnect();
    cached.conn = null;
    cached.promise = null;
    console.log('MongoDB disconnected');
  } catch (error) {
    console.error('Error disconnecting from MongoDB:', error);
    throw error;
  }
};

/**
 * Check if database is connected
 */
export const isConnected = (): boolean => {
  return cached.conn?.connection?.readyState === 1;
};

/**
 * Get connection status
 */
export const getConnectionStatus = (): string => {
  const states = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
  };

  const state = cached.conn?.connection?.readyState ?? 0;
  return states[state as keyof typeof states] || 'unknown';
};

export default { connectDB, disconnectDB, isConnected, getConnectionStatus };