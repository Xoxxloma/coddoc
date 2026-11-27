export class Fault extends Error { constructor(code) { super(code); this.code = code; } }
const status = { BAD_WEIGHT: 400, HOLD_REASON: 400, BULK_LIMIT: 400, BULK_DUPLICATE: 400,
  STATUS_CONFLICT: 409, NOT_HELD: 409, UNIQUE_TAX_ID: 409, ACTIVE_ASSIGNMENTS: 409,
  FORBIDDEN: 403, CARRIER_DISABLED: 403, RETRY_LIMIT: 429, NOT_FOUND: 404,
  FILE_TOO_LARGE: 413, MIME_TYPE: 415 };
export function errors(error, req, res, next) { res.status(status[error.code] || 500).json({ code: error.code || 'INTERNAL_ERROR' }); }
