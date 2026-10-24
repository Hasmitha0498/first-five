export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, fields?: Record<string, string>) =>
  new AppError(400, "invalid_request", message, fields);
export const unauthenticated = (message = "Please log in to continue.") => new AppError(401, "unauthenticated", message);
export const forbidden = (message = "You don't have access to this.") => new AppError(403, "forbidden", message);
export const notFound = (what = "That item") => new AppError(404, "not_found", `${what} wasn't found.`);
export const conflict = (code: string, message: string) => new AppError(409, code, message);
export const gone = (code: string, message: string) => new AppError(410, code, message);
export const unprocessable = (code: string, message: string) => new AppError(422, code, message);
export const providerNotConfigured = (message: string) => new AppError(503, "provider_not_configured", message);
