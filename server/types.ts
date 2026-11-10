export interface User {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  role: "admin" | "auditor" | "operator";
  active: number;
  mfa_secret: string | null;
  mfa_pending: string | null;
  mfa_enabled: number;
  mfa_last_step: number;
  must_change_password: number;
  created_at: number;
}
export interface Auth {
  user: User;
  sessionId: string;
  csrf: string;
  expiresAt: number;
}
declare global {
  namespace Express {
    interface Request {
      auth?: Auth;
    }
  }
}
