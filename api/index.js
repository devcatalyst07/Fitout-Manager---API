"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const database_1 = require("../src/config/database");
const createAdmin_1 = require("../src/seed/createAdmin");
const app_1 = __importDefault(require("../src/app"));
let isConnected = false;
const handler = async (req, res) => {
    try {
        // Enable CORS for all origins
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        // Handle preflight
        if (req.method === 'OPTIONS') {
            res.status(200).end();
            return;
        }
        // Connect to DB only once
        if (!isConnected) {
            console.log('Connecting to MongoDB...');
            await (0, database_1.connectDB)();
            console.log('MongoDB connected');
            console.log('Creating admin...');
            await (0, createAdmin_1.createAdmin)();
            console.log('Admin created/verified');
            isConnected = true;
        }
        // Pass to Express app
        return (0, app_1.default)(req, res);
    }
    catch (error) {
        console.error('Vercel handler error:', error);
        res.status(500).json({
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};
exports.default = handler;
