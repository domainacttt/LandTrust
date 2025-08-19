import { describe, it, expect, beforeEach } from "vitest";

interface LandTokenState {
  admin: string;
  complianceOfficer: string;
  paused: boolean;
  transferRestrictionEnabled: boolean;
  totalSupply: bigint;
  balances: Map<string, bigint>;
  lockedBalances: Map<string, { amount: bigint; unlockHeight: bigint }>;
  parcelMetadata: Map<number, { legalId: string; registered: boolean; jurisdiction: string }>;
  approvedTransferees: Map<string, boolean>;
  MAX_SUPPLY: bigint;
}

const mockContract: LandTokenState = {
  admin: "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
  complianceOfficer: "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
  paused: false,
  transferRestrictionEnabled: true,
  totalSupply: 0n,
  balances: new Map<string, bigint>(),
  lockedBalances: new Map<string, { amount: bigint; unlockHeight: bigint }>(),
  parcelMetadata: new Map<number, { legalId: string; registered: boolean; jurisdiction: string }>(),
  approvedTransferees: new Map<string, boolean>(),
  MAX_SUPPLY: 10000000000000000n,
};

const isAdmin = (caller: string): boolean => caller === mockContract.admin;
const isComplianceOfficer = (caller: string): boolean => caller === mockContract.complianceOfficer;
const isPaused = (): boolean => mockContract.paused;
const checkValidParcel = (parcelId: number): boolean => {
  const metadata = mockContract.parcelMetadata.get(parcelId) || { legalId: "", registered: false, jurisdiction: "" };
  return metadata.registered;
};

const mockContractFunctions = {
  setPaused(caller: string, pause: boolean): { value?: boolean; error?: number } {
    if (!isAdmin(caller)) return { error: 100 };
    mockContract.paused = pause;
    return { value: pause };
  },
  setComplianceOfficer(caller: string, newOfficer: string): { value?: boolean; error?: number } {
    if (!isAdmin(caller)) return { error: 100 };
    if (newOfficer === "SP000000000000000000002Q6VF78") return { error: 105 };
    mockContract.complianceOfficer = newOfficer;
    return { value: true };
  },
  registerParcel(caller: string, parcelId: number, legalId: string, jurisdiction: string): { value?: boolean; error?: number } {
    if (!isAdmin(caller)) return { error: 100 };
    if (mockContract.parcelMetadata.has(parcelId)) return { error: 106 };
    mockContract.parcelMetadata.set(parcelId, { legalId, registered: true, jurisdiction });
    return { value: true };
  },
  approveTransferee(caller: string, transferee: string): { value?: boolean; error?: number } {
    if (!isComplianceOfficer(caller)) return { error: 100 };
    mockContract.approvedTransferees.set(transferee, true);
    return { value: true };
  },
  mint(caller: string, recipient: string, parcelId: number, amount: bigint): { value?: boolean; error?: number } {
    if (!isAdmin(caller)) return { error: 100 };
    if (recipient === "SP000000000000000000002Q6VF78") return { error: 105 };
    if (!checkValidParcel(parcelId)) return { error: 106 };
    if (mockContract.totalSupply + amount > mockContract.MAX_SUPPLY) return { error: 103 };
    const key = `${recipient}:${parcelId}`;
    mockContract.balances.set(key, (mockContract.balances.get(key) || 0n) + amount);
    mockContract.totalSupply += amount;
    return { value: true };
  },
  transfer(caller: string, recipient: string, parcelId: number, amount: bigint): { value?: boolean; error?: number } {
    if (isPaused()) return { error: 104 };
    if (recipient === "SP000000000000000000002Q6VF78") return { error: 105 };
    if (!checkValidParcel(parcelId)) return { error: 106 };
    if (mockContract.transferRestrictionEnabled && !mockContract.approvedTransferees.get(recipient)) return { error: 107 };
    const senderKey = `${caller}:${parcelId}`;
    const recipientKey = `${recipient}:${parcelId}`;
    const senderBalance = mockContract.balances.get(senderKey) || 0n;
    if (senderBalance < amount) return { error: 101 };
    if (mockContract.lockedBalances.has(senderKey)) return { error: 102 };
    mockContract.balances.set(senderKey, senderBalance - amount);
    mockContract.balances.set(recipientKey, (mockContract.balances.get(recipientKey) || 0n) + amount);
    return { value: true };
  },
  lockTokens(caller: string, parcelId: number, amount: bigint, unlockHeight: bigint): { value?: boolean; error?: number } {
    if (isPaused()) return { error: 104 };
    if (!checkValidParcel(parcelId)) return { error: 106 };
    const key = `${caller}:${parcelId}`;
    const balance = mockContract.balances.get(key) || 0n;
    if (balance < amount) return { error: 101 };
    if (mockContract.lockedBalances.has(key)) return { error: 108 };
    mockContract.balances.set(key, balance - amount);
    mockContract.lockedBalances.set(key, { amount, unlockHeight });
    return { value: true };
  },
  unlockTokens(caller: string, parcelId: number, currentBlockHeight: bigint): { value?: boolean; error?: number } {
    if (isPaused()) return { error: 104 };
    if (!checkValidParcel(parcelId)) return { error: 106 };
    const key = `${caller}:${parcelId}`;
    const locked = mockContract.lockedBalances.get(key) || { amount: 0n, unlockHeight: 0n };
    if (locked.amount === 0n) return { error: 102 };
    if (currentBlockHeight < locked.unlockHeight) return { error: 102 };
    mockContract.balances.set(key, (mockContract.balances.get(key) || 0n) + locked.amount);
    mockContract.lockedBalances.delete(key);
    return { value: true };
  },
  getBalance(account: string, parcelId: number): bigint {
    return mockContract.balances.get(`${account}:${parcelId}`) || 0n;
  },
};

describe("LandToken Contract", () => {
  beforeEach(() => {
    mockContract.admin = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
    mockContract.complianceOfficer = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
    mockContract.paused = false;
    mockContract.transferRestrictionEnabled = true;
    mockContract.totalSupply = 0n;
    mockContract.balances = new Map();
    mockContract.lockedBalances = new Map();
    mockContract.parcelMetadata = new Map();
    mockContract.approvedTransferees = new Map();
  });

  it("should allow admin to register a parcel", () => {
    const result = mockContractFunctions.registerParcel(mockContract.admin, 1, "PARCEL123", "US");
    expect(result).toEqual({ value: true });
    expect(mockContract.parcelMetadata.get(1)).toEqual({ legalId: "PARCEL123", registered: true, jurisdiction: "US" });
  });

  it("should prevent non-admin from registering a parcel", () => {
    const result = mockContractFunctions.registerParcel("ST2CY5...", 1, "PARCEL123", "US");
    expect(result).toEqual({ error: 100 });
  });

  it("should allow admin to mint tokens for a valid parcel", () => {
    mockContractFunctions.registerParcel(mockContract.admin, 1, "PARCEL123", "US");
    const result = mockContractFunctions.mint(mockContract.admin, "ST2CY5...", 1, 1000n);
    expect(result).toEqual({ value: true });
    expect(mockContractFunctions.getBalance("ST2CY5...", 1)).toBe(1000n);
    expect(mockContract.totalSupply).toBe(1000n);
  });

  it("should prevent minting for invalid parcel", () => {
    const result = mockContractFunctions.mint(mockContract.admin, "ST2CY5...", 1, 1000n);
    expect(result).toEqual({ error: 106 });
  });

  it("should prevent minting over max supply", () => {
    mockContractFunctions.registerParcel(mockContract.admin, 1, "PARCEL123", "US");
    const result = mockContractFunctions.mint(mockContract.admin, "ST2CY5...", 1, 20000000000000000n);
    expect(result).toEqual({ error: 103 });
  });

  it("should allow approved transferee to receive tokens", () => {
    mockContractFunctions.registerParcel(mockContract.admin, 1, "PARCEL123", "US");
    mockContractFunctions.mint(mockContract.admin, "ST2CY5...", 1, 500n);
    mockContractFunctions.approveTransferee(mockContract.complianceOfficer, "ST3NB...");
    const result = mockContractFunctions.transfer("ST2CY5...", "ST3NB...", 1, 200n);
    expect(result).toEqual({ value: true });
    expect(mockContractFunctions.getBalance("ST2CY5...", 1)).toBe(300n);
    expect(mockContractFunctions.getBalance("ST3NB...", 1)).toBe(200n);
  });

  it("should prevent unapproved transferee when restrictions are enabled", () => {
    mockContractFunctions.registerParcel(mockContract.admin, 1, "PARCEL123", "US");
    mockContractFunctions.mint(mockContract.admin, "ST2CY5...", 1, 500n);
    const result = mockContractFunctions.transfer("ST2CY5...", "ST3NB...", 1, 200n);
    expect(result).toEqual({ error: 107 });
  });
  
  it("should allow locking tokens", () => {
    mockContractFunctions.registerParcel(mockContract.admin, 1, "PARCEL123", "US");
    mockContractFunctions.mint(mockContract.admin, "ST2CY5...", 1, 500n);
    const result = mockContractFunctions.lockTokens("ST2CY5...", 1, 200n, 100n);
    expect(result).toEqual({ value: true });
    expect(mockContractFunctions.getBalance("ST2CY5...", 1)).toBe(300n);
    expect(mockContract.lockedBalances.get("ST2CY5...:1")).toEqual({ amount: 200n, unlockHeight: 100n });
  });

  it("should allow unlocking tokens after unlock height", () => {
    mockContractFunctions.registerParcel(mockContract.admin, 1, "PARCEL123", "US");
    mockContractFunctions.mint(mockContract.admin, "ST2CY5...", 1, 500n);
    mockContractFunctions.lockTokens("ST2CY5...", 1, 200n, 100n);
    const result = mockContractFunctions.unlockTokens("ST2CY5...", 1, 101n);
    expect(result).toEqual({ value: true });
    expect(mockContractFunctions.getBalance("ST2CY5...", 1)).toBe(500n);
    expect(mockContract.lockedBalances.has("ST2CY5...:1")).toBe(false);
  });

  it("should prevent unlocking tokens before unlock height", () => {
    mockContractFunctions.registerParcel(mockContract.admin, 1, "PARCEL123", "US");
    mockContractFunctions.mint(mockContract.admin, "ST2CY5...", 1, 500n);
    mockContractFunctions.lockTokens("ST2CY5...", 1, 200n, 100n);
    const result = mockContractFunctions.unlockTokens("ST2CY5...", 1, 99n);
    expect(result).toEqual({ error: 102 });
  });

  it("should prevent transfers when paused", () => {
    mockContractFunctions.registerParcel(mockContract.admin, 1, "PARCEL123", "US");
    mockContractFunctions.mint(mockContract.admin, "ST2CY5...", 1, 500n);
    mockContractFunctions.setPaused(mockContract.admin, true);
    const result = mockContractFunctions.transfer("ST2CY5...", "ST3NB...", 1, 200n);
    expect(result).toEqual({ error: 104 });
  });
});