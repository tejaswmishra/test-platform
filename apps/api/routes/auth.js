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

export default router;