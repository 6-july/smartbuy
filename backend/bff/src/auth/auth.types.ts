export interface AuthUser {
  id: string;
  openId: string;
  status: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      requestId?: string;
    }
  }
}
