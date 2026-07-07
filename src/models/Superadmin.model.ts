export interface SuperadminAccount {
  id: string;
  email: string;
  password_hash: string;
  created_at: Date;
  updated_at: Date;
}

export type TutionPlan = 'trial' | 'paid_p1' | 'paid_p2' | 'paid_p3';

export interface SuperadminProfile {
  id: string;
  email: string;
  name: string | null;
  username: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface SuperadminCreatedTutionRow {
  id: string;
  name: string;
  slug: string;
  plan: TutionPlan;
  timezone: string;
  logo_url: string | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface SuperadminCreatedTution {
  id: string;
  name: string;
  slug: string;
  plan: TutionPlan;
  timezone: string;
  logo_url: string | null;
  created_by: SuperadminProfile | null;
  created_at: Date;
  updated_at: Date;
}

export interface SuperadminCreateTutionResponse {
  msg: string;
  tution: SuperadminCreatedTution;
}

export interface SuperadminCreateTutionAdminResponse {
  msg: string;
  tution: Pick<SuperadminCreatedTution, 'id' | 'name' | 'slug' | 'plan'>;
  admin: import('./User.model.js').UserResponse;
}

export interface SuperadminLoginResponse {
  token: string;
  superadmin: Omit<SuperadminAccount, 'password_hash'> & {
    role: 'superadmin';
  };
}

export interface SuperadminJwtPayload {
  id: string;
  role: 'superadmin';
}

export interface SuperadminDashboardRecentTution {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  created_at: Date;
  updated_at: Date;
}

export interface SuperadminDashboardResponse {
  metrics: {
    total_tutions: number;
    active_admins: number;
    platform_users: number;
    total_earned: {
      value: number;
      currency: 'INR';
      is_static: true;
      note: string;
    };
  };
  recently_added_tutions: SuperadminDashboardRecentTution[];
  generated_at: string;
}