import { EventOrigin, LocationValidationStatus } from "@fieldmaster/shared-types";
import { LocationValidationService } from "../location-validation.service";

describe("LocationValidationService", () => {
  const service = new LocationValidationService();

  it("does not reject an online event within the deviation limit", () => {
    const result = service.validateTime({ deviceTimestamp: new Date(), mockLocationSuspected: false, origin: EventOrigin.ONLINE });
    expect(result.rejectOnlineDeviation).toBe(false);
  });

  it("rejects an online event whose device clock deviates beyond the limit (spec section 19.1)", () => {
    const deviceTimestamp = new Date(Date.now() - 200_000); // 200s skew > 120s limit
    const result = service.validateTime({ deviceTimestamp, mockLocationSuspected: false, origin: EventOrigin.ONLINE });
    expect(result.rejectOnlineDeviation).toBe(true);
    expect(result.deviationSeconds).toBeGreaterThan(120);
  });

  it("never rejects an offline event purely for clock deviation, but flags it instead", () => {
    const deviceTimestamp = new Date(Date.now() - 200_000);
    const timeValidation = service.validateTime({ deviceTimestamp, mockLocationSuspected: false, origin: EventOrigin.OFFLINE });
    expect(timeValidation.rejectOnlineDeviation).toBe(false);

    const status = service.determineStatus({ deviceTimestamp, mockLocationSuspected: false, origin: EventOrigin.OFFLINE }, timeValidation);
    expect(status).toBe(LocationValidationStatus.FLAGGED);
  });

  it("blocks any event with suspected mock location, online or offline (spec section 19.2)", () => {
    const deviceTimestamp = new Date();
    const timeValidation = service.validateTime({ deviceTimestamp, mockLocationSuspected: true, origin: EventOrigin.ONLINE });
    const status = service.determineStatus({ deviceTimestamp, mockLocationSuspected: true, origin: EventOrigin.ONLINE }, timeValidation);
    expect(status).toBe(LocationValidationStatus.BLOCKED);
  });

  it("passes a clean online event with no deviation and no mock-location suspicion", () => {
    const deviceTimestamp = new Date();
    const timeValidation = service.validateTime({ deviceTimestamp, mockLocationSuspected: false, origin: EventOrigin.ONLINE });
    const status = service.determineStatus({ deviceTimestamp, mockLocationSuspected: false, origin: EventOrigin.ONLINE }, timeValidation);
    expect(status).toBe(LocationValidationStatus.PASSED);
  });
});
