import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

const schema = `
  CREATE EXTENSION IF NOT EXISTS "pgcrypto";

  CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE,
    phone VARCHAR(15),
    company_id VARCHAR(50) UNIQUE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('candidate','employee','admin')),
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS tests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(200) NOT NULL,
    description TEXT,
    duration_minutes INT NOT NULL,
    pass_percentage INT DEFAULT 60,
    shuffle_questions BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT false,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    test_id UUID REFERENCES tests(id) ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    option_a TEXT NOT NULL,
    option_b TEXT NOT NULL,
    option_c TEXT NOT NULL,
    option_d TEXT NOT NULL,
    correct_option CHAR(1) CHECK (correct_option IN ('a','b','c','d')),
    marks INT DEFAULT 1,
    order_index INT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS test_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    test_id UUID REFERENCES tests(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    attempt_status VARCHAR(20) DEFAULT 'pending',
    UNIQUE(test_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    test_id UUID REFERENCES tests(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ,
    submitted_at TIMESTAMPTZ,
    score INT,
    submit_status VARCHAR(20) DEFAULT 'pending',
    submit_reason VARCHAR(30),
    is_voided BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id UUID REFERENCES attempts(id) ON DELETE CASCADE,
    question_id UUID REFERENCES questions(id) ON DELETE CASCADE,
    selected_option CHAR(1) CHECK (selected_option IN ('a','b','c','d')),
    answered_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(attempt_id, question_id)
  );

  CREATE TABLE IF NOT EXISTS attempt_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id UUID REFERENCES attempts(id) ON DELETE CASCADE,
    event_type VARCHAR(30),
    occurred_at TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB
  );

  CREATE INDEX IF NOT EXISTS idx_questions_test_id ON questions(test_id);
  CREATE INDEX IF NOT EXISTS idx_attempts_user_id ON attempts(user_id);
  CREATE INDEX IF NOT EXISTS idx_attempts_test_id ON attempts(test_id);
  CREATE INDEX IF NOT EXISTS idx_responses_attempt_id ON responses(attempt_id);
`;

async function runMigration() {
  try {
    await client.connect();
    console.log('Connected to Neon database...');
    await client.query(schema);
    console.log('✅ All tables created successfully!');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration();


// ALTER TABLE attempts ADD COLUMN IF NOT EXISTS question_order JSONB;
// ALTER TABLE responses ALTER COLUMN selected_option DROP NOT NULL;
// ALTER TABLE responses ADD COLUMN IF NOT EXISTS marked_for_review BOOLEAN DEFAULT false;
// ALTER TABLE attempts ADD COLUMN IF NOT EXISTS option_order JSONB;