import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

/**
 * The database client. In a test run, or with PRISMA_QUERY_COUNTER=true, it
 * also counts the SQL statements it sends (`queryCount`), so a test can
 * assert that a page costs the same number of queries for 5 workers as for
 * 500 (no query per row: the "N+1" problem). The counter is off otherwise.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private queries = 0;

  constructor() {
    const counting = process.env.NODE_ENV === "test" || process.env.PRISMA_QUERY_COUNTER === "true";
    super(counting ? { log: [{ emit: "event", level: "query" }] } : undefined);
    if (counting) (this as unknown as { $on(event: "query", callback: () => void): void }).$on("query", () => (this.queries += 1));
  }

  /** SQL statements sent so far (0 unless counting is on). */
  get queryCount(): number {
    return this.queries;
  }

  /** How many SQL statements `work` sends (everything running at the same time counts too: use it one request at a time). */
  async countQueries<T>(work: () => Promise<T>): Promise<{ result: T; queries: number }> {
    const before = this.queries;
    const result = await work();
    return { result, queries: this.queries - before };
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
