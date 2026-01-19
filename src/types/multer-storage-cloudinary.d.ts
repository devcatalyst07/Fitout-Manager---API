declare module 'multer-storage-cloudinary' {
  import { StorageEngine } from 'multer';

  export interface CloudinaryStorageOptions {
    cloudinary: any;
    params?: any;
  }

  export class CloudinaryStorage implements StorageEngine {
    constructor(opts: CloudinaryStorageOptions);
    _handleFile(req: any, file: any, cb: any): void;
    _removeFile(req: any, file: any, cb: any): void;
  }
}
