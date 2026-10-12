/**
 * Shapes of query parameters. Validating them up front turns a malformed
 * value into a 400 instead of a database error (a `@db.Uuid` column rejects
 * anything that is not a UUID with a 500).
 */

/** Any UUID version (ids are UUIDv7). */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A business date, YYYY-MM-DD in Asia/Jerusalem. */
export const BUSINESS_DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** A business month, YYYY-MM in Asia/Jerusalem. */
export const YEAR_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** `?page=` / `?pageSize=` defaults and limit shared by the paginated lists. */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export function paginate(page: number | undefined, pageSize: number | undefined) {
  const currentPage = page ?? 1;
  const size = pageSize ?? DEFAULT_PAGE_SIZE;
  return { page: currentPage, pageSize: size, skip: (currentPage - 1) * size, take: size };
}
