export interface SuperadminAccount {
  id: string;
  email: string;
  password_hash: string;
  created_at: Date;
  updated_at: Date;
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