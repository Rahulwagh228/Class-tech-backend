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