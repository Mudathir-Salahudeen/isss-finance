export class AppError extends Error {
  constructor(message: string, public status = 400, public fieldErrors?: Record<string, string>) {
    super(message);
  }
}
export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to perform this action.") { super(message, 403); }
}
export class NotFoundError extends AppError {
  constructor(what = "Record") { super(`${what} not found.`, 404); }
}
export class ValidationError extends AppError {
  constructor(message: string, fieldErrors?: Record<string, string>) { super(message, 422, fieldErrors); }
}
export class ConflictError extends AppError {
  constructor(message: string) { super(message, 409); }
}
