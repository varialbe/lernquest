export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export const badRequest = (code: string, msg?: string) => new HttpError(400, code, msg);
export const forbidden = (msg = 'Keine Berechtigung') => new HttpError(403, 'forbidden', msg);
export const notFound = (msg = 'Nicht gefunden') => new HttpError(404, 'not_found', msg);
export const conflict = (code: string, msg?: string) => new HttpError(409, code, msg);
