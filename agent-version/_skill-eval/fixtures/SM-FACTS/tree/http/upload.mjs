import { Fault } from './errors.mjs';
export function upload(req, res, next) {
  if (req.file.size > 5 * 1024 * 1024) return next(new Fault('FILE_TOO_LARGE'));
  if (!['image/png', 'application/pdf'].includes(req.file.mimetype)) return next(new Fault('MIME_TYPE'));
  next();
}
