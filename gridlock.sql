-- Drop and create the database (run this in 'postgres' or another DB with superuser privileges)
DROP DATABASE IF EXISTS gridlock;
CREATE DATABASE gridlock;

-- Switch database: in psql use \c gridlock (remove or comment out `USE gridlock;` because PostgreSQL doesn't support it)

-- Connect to the gridlock database before running the following commands.

CREATE TABLE IF NOT EXISTS users (
    user_id UUID PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sheets (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sheet_cells (
    id UUID PRIMARY KEY,
    sheet_id UUID REFERENCES sheets(id) ON DELETE CASCADE,
    cell_id VARCHAR(50) NOT NULL,
    formula TEXT,
    value TEXT
);

-- Insert valid UUID for id (example uses gen_random_uuid(), requires pgcrypto extension)
-- Alternatively, provide a valid UUID string manually.

-- Enable pgcrypto extension for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

INSERT INTO users (user_id, username, password, email) VALUES
(gen_random_uuid(), 'admin', 'admin_password', 'admin@email.com');

