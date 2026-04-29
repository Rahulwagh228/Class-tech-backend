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

// =============================================================================
// Role-specific profile rows. Both share user_id as PK + FK to users.
// =============================================================================
export interface Student {
  user_id: string;
  tution_id: string;
  enrollment_number: string;
  date_of_birth: string | null;
  gender: string | null;
  grade_level: string | null;
  section: string | null;
  blood_group: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  emergency_contact: string | null;
  address: string | null;
  admission_date: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface Teacher {
  user_id: string;
  tution_id: string;
  employee_id: string;
  date_of_birth: string | null;
  gender: string | null;
  qualification: string | null;
  specialization: string | null;
  experience_years: number | null;
  joining_date: string | null;
  bio: string | null;
  phone: string | null;
  address: string | null;
  created_at: Date;
  updated_at: Date;
}

// Input shapes for register: only the fields the client provides.
export type StudentInput = Partial<Omit<Student, 'user_id' | 'tution_id' | 'created_at' | 'updated_at'>> &
  Pick<Student, 'enrollment_number'>;

export type TeacherInput = Partial<Omit<Teacher, 'user_id' | 'tution_id' | 'created_at' | 'updated_at'>> &
  Pick<Teacher, 'employee_id'>;
