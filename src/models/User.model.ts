export type UserRole = 'admin' | 'teacher' | 'student' | 'parent';

export interface User {
  id: string;
  tution_id: string;
  name: string;
  username: string;
  email: string;
  password_hash: string;
  profile_photo: string | null;
  role: UserRole;
  email_verified: boolean;
  created_at: Date;
  updated_at: Date;
}

export type UserResponse = Omit<User, 'password_hash'>;

export interface JwtPayload {
  id: string;
  tution_id: string;
  role: UserRole;
}
