import express from 'express';
import cors from 'cors';
import authRoutes from './routes/authRoutes';
import adminRoutes from './routes/adminRoutes';

const app = express();

app.use(cors({
  origin: '*',
  credentials: true,
}));

app.use(express.json());

// Test route
app.get('/', (req, res) => {
  res.json({ message: 'Fitout Manager API is running' });
});

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);

export default app;