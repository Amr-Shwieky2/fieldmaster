import { v7 as uuidv7 } from "uuid";

/** Every primary key in FieldMaster is a UUIDv7, generated in application code. */
export function generateId(): string {
  return uuidv7();
}
