import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pg from 'pg';
dotenv.config();

import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import testRoutes from './routes/tests.js';
import attemptRoutes from './routes/attempts.js';

const app = express();

// ── DB pool — sized deliberately for ~500 concurrent candidates ──────
// max: 20 means at most 20 simultaneous DB connections are ever open.
// Requests beyond that queue briefly (milliseconds) rather than
// overwhelming Postgres. This is the single most important lever
// for handling load on modest hardware.
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});
app.locals.pool = pool;

// ── Global middleware ──────────────────────────────────────────────
app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));
app.use(express.json());

// ── Health check routes ───────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'test-platform API is running', time: new Date().toISOString() });
});

app.get('/db-check', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ db_connected: true, server_time: result.rows[0].now });
  } catch (err) {
    res.status(500).json({ db_connected: false, error: err.message });
  }
});

// ── Feature routes ─────────────────────────────────────────────────
app.use('/auth', authRoutes);
app.use('/admin', adminRoutes);
app.use('/tests', testRoutes);
app.use('/attempts', attemptRoutes);

// ── Global error handler — must be LAST ───────────────────────────
app.use((err, req, res, next) => {
  console.error(`[${new Date().toISOString()}]`, err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});

export { pool };