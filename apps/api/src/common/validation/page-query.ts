import { AppException, ErrorCodes } from "../errors/app-exception";
import { MAX_PAGE_SIZE, paginate } from "./patterns";

/** One page of a list, with how many rows the whole list has. */
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export type PageWindow = ReturnType<typeof paginate>;

/** `?page=` / `?pageSize=` as a list route receives them. */
export interface PageQuery {
  page?: string | number;
  pageSize?: string | number;
}

/**
 * The page a caller asked for with `?page=` / `?pageSize=` (either one; page
 * 1 and 20 rows by default, at most 100), or null when they sent neither: the
 * list then answers as it always did (the shape older clients read). A
 * malformed value is a 400.
 */
export function pageWindow(query: PageQuery): PageWindow | null {
  if (query.page === undefined && query.pageSize === undefined) return null;
  const read = (value: string | number | undefined, field: string, max: number) => {
    if (value === undefined) return undefined;
    const number = Number(value);
    if (typeof value === "string" && value.trim() === "") throw invalid(field, max);
    if (!Number.isInteger(number) || number < 1 || number > max) throw invalid(field, max);
    return number;
  };
  return paginate(read(query.page, "page", Number.MAX_SAFE_INTEGER), read(query.pageSize, "pageSize", MAX_PAGE_SIZE));
}

function invalid(field: string, max: number) {
  const limit = max === Number.MAX_SAFE_INTEGER ? "a whole number from 1" : `a whole number from 1 to ${max}`;
  return new AppException(400, ErrorCodes.VALIDATION_FAILED, `${field} must be ${limit}.`, { field });
}

/**
 * A list as one page with its total when a page was asked for (see
 * `pageWindow`), whole otherwise. `rows` reads the rows of a range (none
 * given: the whole list, or the list's own cap); `count` the whole list's size.
 */
export async function listOrPage<T>(
  window: PageWindow | null,
  rows: (range: { skip?: number; take?: number }) => Promise<T[]>,
  count: () => Promise<number>,
): Promise<T[] | Page<T>> {
  if (!window) return rows({});
  const [items, total] = await Promise.all([rows({ skip: window.skip, take: window.take }), count()]);
  return { items, total, page: window.page, pageSize: window.pageSize };
}

/** The same list (or page) with its rows turned into what the route answers. */
export async function mapRows<T, U>(list: T[] | Page<T>, map: (rows: T[]) => Promise<U[]> | U[]): Promise<U[] | Page<U>> {
  if (Array.isArray(list)) return map(list);
  return { ...list, items: await map(list.items) };
}
