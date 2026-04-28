import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import type { IUserRepository, User, UserRole } from '../repositories/userRepository.js';
import { sendVerificationEmail } from './emailService.js';

export interface SignupInput {
  name: string;
  username: string;
  email: string;
  password: string;
  profilePhoto?: string | null;
  role: UserRole;
}

export interface LoginInput {
  emailOrUsername: string;
  password: string;
}

export interface PublicUser {
  id: string;
  name: string;
  username: string;
  email: string;
  profilePhoto: string | null;
  role: UserRole;
  emailVerified: boolean;
  createdAt: Date;
}

export interface AuthTokenPayload {
  sub: string;
  role: UserRole;
  username: string;
}

const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export class AuthService {
  constructor(private readonly users: IUserRepository) {}

  async signup(input: SignupInput): Promise<{ user: PublicUser; token: string }> {
    if (this.users.findByEmail(input.email)) {
      throw new AppError('Email is already registered', 409);
    }
    if (this.users.findByUsername(input.username)) {
      throw new AppError('Username is already taken', 409);
    }

    const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_ROUNDS);
    const verificationToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS);

    const user = this.users.create({
      name: input.name,
      username: input.username,
      email: input.email,
      passwordHash,
      profilePhoto: input.profilePhoto ?? null,
      role: input.role,
      emailVerificationToken: verificationToken,
      emailVerificationExpiresAt: expiresAt
    });

    try {
      await sendVerificationEmail(user.email, user.name, verificationToken);
    } catch {
      throw new AppError('Failed to send verification email', 502);
    }

    const token = this.signToken(user);
    return { user: toPublicUser(user), token };
  }

  async login(input: LoginInput): Promise<{ user: PublicUser; token: string }> {
    const user =
      this.users.findByEmail(input.emailOrUsername) ??
      this.users.findByUsername(input.emailOrUsername);

    if (!user) {
      throw new AppError('Invalid credentials', 401);
    }

    const ok = await bcrypt.compare(input.password, user.passwordHash);
    if (!ok) {
      throw new AppError('Invalid credentials', 401);
    }

    const token = this.signToken(user);
    return { user: toPublicUser(user), token };
  }

  verifyEmail(token: string): PublicUser {
    const user = this.users.findByVerificationToken(token);
    if (!user) {
      throw new AppError('Invalid or expired verification token', 400);
    }
    if (user.emailVerificationExpiresAt && user.emailVerificationExpiresAt.getTime() < Date.now()) {
      throw new AppError('Verification token has expired', 400);
    }

    const updated = this.users.markEmailVerified(user.id);
    if (!updated) throw new AppError('Failed to verify email', 500);
    return toPublicUser(updated);
  }

  async resendVerification(email: string): Promise<void> {
    const user = this.users.findByEmail(email);
    if (!user || user.emailVerified) return;

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS);
    this.users.updateVerificationToken(user.id, token, expiresAt);

    try {
      await sendVerificationEmail(user.email, user.name, token);
    } catch {
      throw new AppError('Failed to send verification email', 502);
    }
  }

  private signToken(user: User): string {
    const payload: AuthTokenPayload = {
      sub: user.id,
      role: user.role,
      username: user.username
    };
    const options: SignOptions = { expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'] };
    return jwt.sign(payload, env.JWT_SECRET, options);
  }
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    profilePhoto: user.profilePhoto,
    role: user.role,
    emailVerified: user.emailVerified,
    createdAt: user.createdAt
  };
}
