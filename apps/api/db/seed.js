import pg from 'pg';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
dotenv.config();

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

async function seedAdmin() {
  try {
    await client.connect();

    const adminEmail = process.env.SEED_ADMIN_EMAIL;
    const adminPassword = process.env.SEED_ADMIN_PASSWORD;
    const adminName = process.env.SEED_ADMIN_NAME || 'Admin';

    if (!adminEmail || !adminPassword) {
      console.error('❌ SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set in .env');
      process.exit(1);
    }

    // Check if this admin already exists — makes the script safe to re-run
    const existing = await client.query(
      `SELECT id FROM users WHERE email = $1`,
      [adminEmail]
    );

    if (existing.rows.length > 0) {
      console.log(`ℹ️  Admin with email "${adminEmail}" already exists. Skipping.`);
      return;
    }

    // Hash the password — never store plain text, even for a seed script
    const passwordHash = await bcrypt.hash(adminPassword, 10);

    await client.query(
      `INSERT INTO users (name, email, role, password_hash)
       VALUES ($1, $2, 'admin', $3)`,
      [adminName, adminEmail, passwordHash]
    );

    console.log('✅ Admin account created successfully!');
    console.log(`   Email: ${adminEmail}`);
    console.log(`   Password: (the one you set in .env — not shown here for safety)`);

  } catch (err) {
    console.error('❌ Seeding failed:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

seedAdmin();
