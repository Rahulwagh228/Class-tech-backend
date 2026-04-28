import { randomUUID } from 'node:crypto';

export type UserRole = 'admin' | 'student' | 'parent';

export interface User {
  id: string;
  name: string;
  username: string;
  email: string;
  passwordHash: string;
  profilePhoto: string | null;
  role: UserRole;
  emailVerified: boolean;
  emailVerificationToken: string | null;
  emailVerificationExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserInput {
  name: string;
  username: string;
  email: string;
  passwordHash: string;
  profilePhoto?: string | null;
  role: UserRole;
  emailVerificationToken: string;
  emailVerificationExpiresAt: Date;
}

export interface IUserRepository {
  create(input: CreateUserInput): User;
  findById(id: string): User | undefined;
  findByEmail(email: string): User | undefined;
  findByUsername(username: string): User | undefined;
  findByVerificationToken(token: string): User | undefined;
  markEmailVerified(id: string): User | undefined;
  updateVerificationToken(id: string, token: string, expiresAt: Date): User | undefined;
}

export class InMemoryUserRepository implements IUserRepository {
  private readonly users = new Map<string, User>();

  create(input: CreateUserInput): User {
    const now = new Date();
    const user: User = {
      id: randomUUID(),
      name: input.name,
      username: input.username,
      email: input.email.toLowerCase(),
      passwordHash: input.passwordHash,
      profilePhoto: input.profilePhoto ?? null,
      role: input.role,
      emailVerified: false,
      emailVerificationToken: input.emailVerificationToken,
      emailVerificationExpiresAt: input.emailVerificationExpiresAt,
      createdAt: now,
      updatedAt: now
    };
    this.users.set(user.id, user);
    return user;
  }

  findById(id: string): User | undefined {
    return this.users.get(id);
  }

  findByEmail(email: string): User | undefined {
    const target = email.toLowerCase();
    for (const user of this.users.values()) {
      if (user.email === target) return user;
    }
    return undefined;
  }

  findByUsername(username: string): User | undefined {
    for (const user of this.users.values()) {
      if (user.username === username) return user;
    }
    return undefined;
  }

  findByVerificationToken(token: string): User | undefined {
    for (const user of this.users.values()) {
      if (user.emailVerificationToken === token) return user;
    }
    return undefined;
  }

  markEmailVerified(id: string): User | undefined {
    const user = this.users.get(id);
    if (!user) return undefined;
    user.emailVerified = true;
    user.emailVerificationToken = null;
    user.emailVerificationExpiresAt = null;
    user.updatedAt = new Date();
    return user;
  }

  updateVerificationToken(id: string, token: string, expiresAt: Date): User | undefined {
    const user = this.users.get(id);
    if (!user) return undefined;
    user.emailVerificationToken = token;
    user.emailVerificationExpiresAt = expiresAt;
    user.updatedAt = new Date();
    return user;
  }
}

export const userRepository: IUserRepository = new InMemoryUserRepository();
