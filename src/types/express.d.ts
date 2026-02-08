import { TokenPayload } from '../utils/tokens';

declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload; // Keep optional for Express compatibility
    }
  }
}

export {};