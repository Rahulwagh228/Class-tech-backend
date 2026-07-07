import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import type { PoolClient } from 'pg';
import pool from '../../config/connectpsql.js';
import { env } from '../../config/env.js';
import type {
  SuperadminCreateTutionAdminResponse,
  SuperadminCreateTutionResponse,
  SuperadminCreatedTution,
  SuperadminCreatedTutionRow,
  SuperadminProfile,
  TutionPlan
} from '../../models/Superadmin.model.js';
import type { UserResponse } from '../../models/User.model.js';

const SLUG_REGEX = /^[a-z0-9-]{3,60}$/;
const USERNAME_REGEX = /^[a-zA-Z0-9_.-]{3,30}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_PLANS: TutionPlan[] = ['trial', 'paid_p1', 'paid_p2', 'paid_p3'];

interface SuperadminRequest extends Request {
  superadmin?: {
    id: string;
    role: 'superadmin';
  };
}

interface CreateTutionBody {
  name?: unknown;
  slug?: unknown;
  plan?: unknown;
  timezone?: unknown;
  logo_url?: unknown;
}

interface CreateAdminBody {
  name?: unknown;
  username?: unknown;
  email?: unknown;
  password?: unknown;
  profile_photo?: unknown;
}

interface SuperadminRow {
  id: string;
  email: string;
  name: string | null;
  username: string | null;
  created_at: Date;
  updated_at: Date;
}

function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isValidUrl(value: string): boolean {
  if (!value) return true;

  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

async function getAuthenticatedSuperadmin(client: PoolClient, superadminId: string): Promise<SuperadminProfile> {
  const result = await client.query<SuperadminRow>(
    `SELECT id, email, name, username, created_at, updated_at
       FROM superadmins
      WHERE id = $1`,
    [superadminId]
  );

  const superadmin = result.rows[0];
  if (!superadmin) {
    throw new Error('Authenticated superadmin not found');
  }

  return superadmin;
}

export const createTution = async (req: SuperadminRequest, res: Response): Promise<void> => {
  let client: PoolClient | null = null;

  try {
    if (!req.superadmin) {
      res.status(401).json({ msg: 'Authentication required' });
      return;
    }

    const body = (req.body ?? {}) as CreateTutionBody;
    const name = readString(body.name);
    const slug = readString(body.slug).toLowerCase();
    const plan = readString(body.plan) as TutionPlan;
    const timezone = readString(body.timezone) || 'UTC';
    const logo_url = readString(body.logo_url);

    if (!name) {
      res.status(400).json({ msg: 'name is required' });
      return;
    }
    if (!slug) {
      res.status(400).json({ msg: 'slug is required' });
      return;
    }
    if (!SLUG_REGEX.test(slug)) {
      res.status(400).json({ msg: 'slug must be 3-60 chars of lowercase letters, numbers, and hyphens' });
      return;
    }
    if (!ALLOWED_PLANS.includes(plan)) {
      res.status(400).json({ msg: `plan must be one of: ${ALLOWED_PLANS.join(', ')}` });
      return;
    }
    if (!isValidUrl(logo_url)) {
      res.status(400).json({ msg: 'logo_url must be a valid URL' });
      return;
    }

    client = await pool.connect();
    await client.query('BEGIN');

    const existingTution = await client.query<{ id: string }>(
      `SELECT id FROM Tutions WHERE slug = $1 LIMIT 1`,
      [slug]
    );
    if (existingTution.rows[0]) {
      await client.query('ROLLBACK');
      res.status(409).json({ msg: 'slug already exists' });
      return;
    }

    const creator = await getAuthenticatedSuperadmin(client, req.superadmin.id);

    const insertResult = await client.query<SuperadminCreatedTutionRow>(
      `INSERT INTO Tutions (name, slug, plan, timezone, logo_url, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, slug, plan, timezone, logo_url, created_by, created_at, updated_at`,
      [name, slug, plan, timezone, logo_url || null, creator.id]
    );

    const createdTution = insertResult.rows[0];
    if (!createdTution) {
      throw new Error('Tution insert returned no rows');
    }

    await client.query('COMMIT');

    const response: SuperadminCreateTutionResponse = {
      msg: 'Tution created successfully',
      tution: {
        ...createdTution,
        created_by: creator
      }
    };

    res.status(201).json(response);
  } catch (err) {
    if (client) {
      await client.query('ROLLBACK').catch(() => undefined);
    }
    console.error('createTution error:', err);
    res.status(500).json({ msg: 'Server error' });
  } finally {
    client?.release();
  }
};

export const addTutionAdmin = async (req: SuperadminRequest, res: Response): Promise<void> => {
  let client: PoolClient | null = null;

  try {
    if (!req.superadmin) {
      res.status(401).json({ msg: 'Authentication required' });
      return;
    }

    const tutionId = readString(req.params?.tutionId);
    const body = (req.body ?? {}) as CreateAdminBody;
    const name = readString(body.name);
    const username = readString(body.username);
    const email = normalizeEmail(body.email);
    const password = typeof body.password === 'string' ? body.password : '';
    const profile_photo = readString(body.profile_photo) || null;

    if (!tutionId) {
      res.status(400).json({ msg: 'tutionId is required' });
      return;
    }
    if (!name) {
      res.status(400).json({ msg: 'name is required' });
      return;
    }
    if (!username) {
      res.status(400).json({ msg: 'username is required' });
      return;
    }
    if (!USERNAME_REGEX.test(username)) {
      res.status(400).json({ msg: 'username must be 3-30 chars, letters/digits/._- only' });
      return;
    }
    if (!email || !EMAIL_REGEX.test(email)) {
      res.status(400).json({ msg: 'a valid email is required' });
      return;
    }
    if (!password || password.length < 8) {
      res.status(400).json({ msg: 'password must be at least 8 characters' });
      return;
    }

    client = await pool.connect();
    await client.query('BEGIN');

    const tutionResult = await client.query<{ id: string; name: string; slug: string; plan: TutionPlan }>(
      `SELECT id, name, slug, plan
         FROM Tutions
        WHERE id = $1`,
      [tutionId]
    );
    const tution = tutionResult.rows[0];
    if (!tution) {
      await client.query('ROLLBACK');
      res.status(404).json({ msg: 'Tution not found' });
      return;
    }

    const conflictResult = await client.query<{ email: string; username: string }>(
      `SELECT email, username
         FROM users
        WHERE email = $1
           OR (tution_id = $2 AND username = $3)
        LIMIT 1`,
      [email, tutionId, username]
    );
    const conflict = conflictResult.rows[0];
    if (conflict) {
      await client.query('ROLLBACK');
      res.status(409).json({
        msg: conflict.email === email ? 'Email already exists' : 'Username already exists in this tution'
      });
      return;
    }

    const password_hash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);

    const userResult = await client.query<UserResponse>(
      `INSERT INTO users
         (tution_id, name, username, email, password_hash, profile_photo, role,
          email_verified, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'admin', FALSE, NOW(), NOW())
       RETURNING id, tution_id, name, username, email, profile_photo, role,
                 email_verified, created_at, updated_at`,
      [tutionId, name, username, email, password_hash, profile_photo]
    );

    const admin = userResult.rows[0];
    if (!admin) {
      throw new Error('Admin insert returned no rows');
    }

    await client.query('COMMIT');

    const response: SuperadminCreateTutionAdminResponse = {
      msg: 'Admin added successfully',
      tution: {
        id: tution.id,
        name: tution.name,
        slug: tution.slug,
        plan: tution.plan
      },
      admin
    };

    res.status(201).json(response);
  } catch (err) {
    if (client) {
      await client.query('ROLLBACK').catch(() => undefined);
    }
    console.error('addTutionAdmin error:', err);
    res.status(500).json({ msg: 'Server error' });
  } finally {
    client?.release();
  }
};