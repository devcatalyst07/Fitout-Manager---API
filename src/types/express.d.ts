/// <reference types="express" />
import { TokenPayload } from '../utils/tokens';

declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

export {};