import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const router = express.Router();

// POST /auth/login
// Body for candidate/admin: { userType: 'candidate' | 'admin', email, password }
// Body for employee:        { userType: 'employee', company_id, password }
router.post('/login', async (req, res) => {
  const { pool } = req.app.locals; // we'll attach pool to app.locals in index.js
  const { userType, email, company_id, password } = req.body;

  if (!userType || !password) {
    return res.status(400).json({ error: 'userType and password are required' });
  }

  try {
    let result;

    if (userType === 'employee') {
      if (!company_id) {
        return res.status(400).json({ error: 'company_id is required for employee login' });
      }
      result = await pool.query(
        `SELECT * FROM users WHERE company_id = $1 AND role = 'employee'`,
        [company_id]
      );
    } else {
      // candidate or admin — both authenticate via email
      if (!email) {
        return res.status(400).json({ error: 'email is required' });
      }
      result = await pool.query(
        `SELECT * FROM users WHERE email = $1 AND role = $2`,
        [email, userType]
      );
    }

    const user = result.rows[0];

    if (!user) {
      // Deliberately vague — don't reveal whether email/company_id exists
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Build the JWT — same shape regardless of role
    const token = jwt.sign(
      {
        userId: user.id,
        role: user.role,
        name: user.name,
      },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        email: user.email,
        company_id: user.company_id,
      },
    });

  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Something went wrong during login' });
  }
});

// POST /auth/register
// Self-registration for candidates on test day.
// No admin involvement — candidate fills their own details and password.
router.post('/register', async (req, res) => {
  const { pool } = req.app.locals;
  const { name, email, phone, password } = req.body;

  if (!name || !email || !phone || !password) {
    return res.status(400).json({ error: 'name, email, phone and password are all required' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    const existing = await pool.query(
      `SELECT id FROM users WHERE email = $1`, [email]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (name, email, phone, role, password_hash)
       VALUES ($1, $2, $3, 'candidate', $4)
       RETURNING id, name, email, phone, role`,
      [name, email, phone, passwordHash]
    );

    // Immediately issue a JWT so they land on dashboard
    // without needing a separate login step after registering
    const token = jwt.sign(
      { userId: result.rows[0].id, role: 'candidate', name: result.rows[0].name },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.status(201).json({ token, user: result.rows[0] });

  } catch (err) {
    console.error('Register error:', err.message);
    res.status(500).json({ error: 'Registration failed' });
  }
});


// GET /auth/me — returns the logged-in user's basic info from JWT
router.get('/me', requireAuth, async (req, res) => {
  const { pool } = req.app.locals;
  try {
    const result = await pool.query(
      `SELECT id, name, email, company_id, role FROM users WHERE id = $1`,
      [req.user.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

export default router;