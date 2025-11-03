import { describe, it, expect, beforeEach } from "vitest";
import { stringAsciiCV, uintCV } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_INVALID_AMOUNT = 101;
const ERR_INVALID_CURRENCY = 102;
const ERR_ESCROW_ALREADY_EXISTS = 103;
const ERR_ESCROW_NOT_FOUND = 104;
const ERR_INVALID_STATUS = 105;
const ERR_INVALID_TIMESTAMP = 106;
const ERR_AUTHORITY_NOT_VERIFIED = 107;
const ERR_INVALID_FEE = 108;
const ERR_MAX_ESCROWS_EXCEEDED = 109;
const ERR_INVALID_RECIPIENT = 110;
const ERR_DISPUTE_ACTIVE = 111;
const ERR_RESOLUTION_REQUIRED = 112;
const ERR_INVALID_DISPUTE_RESOLUTION = 113;
const ERR_TIMEOUT_EXPIRED = 114;

interface Escrow {
  sender: string;
  recipient: string;
  amount: number;
  currency: string;
  status: string;
  timestamp: number;
  fee: number;
  disputeStatus: string;
  resolver: string | null;
}

interface DisputeResolution {
  resolution: string;
  resolvedBy: string;
  resolutionTimestamp: number;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class TransferEscrowMock {
  state: {
    nextEscrowId: number;
    maxEscrows: number;
    creationFee: number;
    disputeTimeout: number;
    authorityContract: string | null;
    escrows: Map<number, Escrow>;
    escrowsBySenderRecipient: Map<string, number>;
    disputeResolutions: Map<number, DisputeResolution>;
  } = {
    nextEscrowId: 0,
    maxEscrows: 5000,
    creationFee: 500,
    disputeTimeout: 144,
    authorityContract: null,
    escrows: new Map(),
    escrowsBySenderRecipient: new Map(),
    disputeResolutions: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1TEST";
  authorities: Set<string> = new Set(["ST1TEST"]);
  stxTransfers: Array<{ amount: number; from: string; to: string | null }> = [];

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      nextEscrowId: 0,
      maxEscrows: 5000,
      creationFee: 500,
      disputeTimeout: 144,
      authorityContract: null,
      escrows: new Map(),
      escrowsBySenderRecipient: new Map(),
      disputeResolutions: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1TEST";
    this.authorities = new Set(["ST1TEST"]);
    this.stxTransfers = [];
  }

  isVerifiedAuthority(principal: string): Result<boolean> {
    return { ok: true, value: this.authorities.has(principal) };
  }

  setAuthorityContract(contractPrincipal: string): Result<boolean> {
    if (contractPrincipal === "SP000000000000000000002Q6VF78") {
      return { ok: false, value: false };
    }
    if (this.state.authorityContract !== null) {
      return { ok: false, value: false };
    }
    this.state.authorityContract = contractPrincipal;
    return { ok: true, value: true };
  }

  setCreationFee(newFee: number): Result<boolean> {
    if (!this.state.authorityContract) return { ok: false, value: false };
    if (newFee < 0) return { ok: false, value: false };
    this.state.creationFee = newFee;
    return { ok: true, value: true };
  }

  setMaxEscrows(newMax: number): Result<boolean> {
    if (!this.state.authorityContract) return { ok: false, value: false };
    if (newMax <= 0) return { ok: false, value: false };
    this.state.maxEscrows = newMax;
    return { ok: true, value: true };
  }

  setDisputeTimeout(newTimeout: number): Result<boolean> {
    if (!this.state.authorityContract) return { ok: false, value: false };
    if (newTimeout <= 0) return { ok: false, value: false };
    this.state.disputeTimeout = newTimeout;
    return { ok: true, value: true };
  }

  createEscrow(
    recipient: string,
    amount: number,
    currency: string,
    fee: number
  ): Result<number> {
    if (this.state.nextEscrowId >= this.state.maxEscrows) return { ok: false, value: ERR_MAX_ESCROWS_EXCEEDED };
    if (amount <= 0) return { ok: false, value: ERR_INVALID_AMOUNT };
    if (!["USD", "EUR", "STX"].includes(currency)) return { ok: false, value: ERR_INVALID_CURRENCY };
    if (fee < 0) return { ok: false, value: ERR_INVALID_FEE };
    if (recipient === this.caller) return { ok: false, value: ERR_INVALID_RECIPIENT };
    const key = `${this.caller}-${recipient}`;
    if (this.state.escrowsBySenderRecipient.has(key)) return { ok: false, value: ERR_ESCROW_ALREADY_EXISTS };
    if (!this.state.authorityContract) return { ok: false, value: ERR_AUTHORITY_NOT_VERIFIED };

    this.stxTransfers.push({ amount: this.state.creationFee, from: this.caller, to: this.state.authorityContract });

    const id = this.state.nextEscrowId;
    const escrow: Escrow = {
      sender: this.caller,
      recipient,
      amount,
      currency,
      status: "pending",
      timestamp: this.blockHeight,
      fee,
      disputeStatus: "none",
      resolver: null,
    };
    this.state.escrows.set(id, escrow);
    this.state.escrowsBySenderRecipient.set(key, id);
    this.state.nextEscrowId++;
    return { ok: true, value: id };
  }

  getEscrow(id: number): Escrow | null {
    return this.state.escrows.get(id) || null;
  }

  getDisputeResolution(id: number): DisputeResolution | null {
    return this.state.disputeResolutions.get(id) || null;
  }

  releaseEscrow(escrowId: number): Result<boolean> {
    const escrow = this.state.escrows.get(escrowId);
    if (!escrow) return { ok: false, value: false };
    if (!["pending", "released", "cancelled", "disputed"].includes(escrow.status)) return { ok: false, value: false };
    if (escrow.status !== "pending") return { ok: false, value: false };
    if (this.caller !== escrow.sender && this.caller !== escrow.recipient) return { ok: false, value: false };
    if (escrow.disputeStatus !== "none") return { ok: false, value: false };
    escrow.status = "released";
    return { ok: true, value: true };
  }

  cancelEscrow(escrowId: number): Result<boolean> {
    const escrow = this.state.escrows.get(escrowId);
    if (!escrow) return { ok: false, value: false };
    if (!["pending", "released", "cancelled", "disputed"].includes(escrow.status)) return { ok: false, value: false };
    if (escrow.status !== "pending") return { ok: false, value: false };
    if (this.caller !== escrow.sender) return { ok: false, value: false };
    if (escrow.disputeStatus !== "none") return { ok: false, value: false };
    escrow.status = "cancelled";
    return { ok: true, value: true };
  }

  disputeEscrow(escrowId: number): Result<boolean> {
    const escrow = this.state.escrows.get(escrowId);
    if (!escrow) return { ok: false, value: false };
    const age = this.blockHeight - escrow.timestamp;
    if (escrow.status !== "pending" || age > this.state.disputeTimeout) return { ok: false, value: false };
    if (this.caller !== escrow.sender && this.caller !== escrow.recipient) return { ok: false, value: false };
    escrow.disputeStatus = "active";
    escrow.resolver = this.caller;
    return { ok: true, value: true };
  }

  resolveDispute(escrowId: number, resolution: string): Result<boolean> {
    const escrow = this.state.escrows.get(escrowId);
    if (!escrow) return { ok: false, value: false };
    if (escrow.disputeStatus !== "active") return { ok: false, value: false };
    if (!escrow.resolver || this.caller !== escrow.resolver) return { ok: false, value: false };
    if (this.state.disputeResolutions.has(escrowId)) return { ok: false, value: false };
    if (resolution === "release") {
      escrow.status = "released";
    } else if (resolution === "cancel") {
      escrow.status = "cancelled";
    } else {
      return { ok: false, value: false };
    }
    escrow.disputeStatus = "resolved";
    this.state.disputeResolutions.set(escrowId, {
      resolution,
      resolvedBy: this.caller,
      resolutionTimestamp: this.blockHeight,
    });
    return { ok: true, value: true };
  }

  checkEscrowExistence(sender: string, recipient: string): Result<boolean> {
    const key = `${sender}-${recipient}`;
    return { ok: true, value: this.state.escrowsBySenderRecipient.has(key) };
  }

  timeoutEscrow(escrowId: number): Result<boolean> {
    const escrow = this.state.escrows.get(escrowId);
    if (!escrow) return { ok: false, value: false };
    const age = this.blockHeight - escrow.timestamp;
    if (age <= this.state.disputeTimeout) return { ok: false, value: false };
    escrow.status = "cancelled";
    return { ok: true, value: true };
  }

  getEscrowCount(): Result<number> {
    return { ok: true, value: this.state.nextEscrowId };
  }
}

describe("TransferEscrow", () => {
  let contract: TransferEscrowMock;

  beforeEach(() => {
    contract = new TransferEscrowMock();
    contract.reset();
  });

  it("creates an escrow successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.createEscrow("ST2RECIP", 1000, "USD", 100);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0);

    const escrow = contract.getEscrow(0);
    expect(escrow?.sender).toBe("ST1TEST");
    expect(escrow?.recipient).toBe("ST2RECIP");
    expect(escrow?.amount).toBe(1000);
    expect(escrow?.currency).toBe("USD");
    expect(escrow?.status).toBe("pending");
    expect(escrow?.fee).toBe(100);
    expect(escrow?.disputeStatus).toBe("none");
    expect(contract.stxTransfers).toEqual([{ amount: 500, from: "ST1TEST", to: "ST2TEST" }]);
  });

  it("rejects duplicate escrow for same sender-recipient", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createEscrow("ST2RECIP", 1000, "USD", 100);
    const result = contract.createEscrow("ST2RECIP", 2000, "EUR", 200);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_ESCROW_ALREADY_EXISTS);
  });

  it("rejects escrow creation without authority contract", () => {
    const result = contract.createEscrow("ST2RECIP", 1000, "USD", 100);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_AUTHORITY_NOT_VERIFIED);
  });

  it("rejects invalid amount", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.createEscrow("ST2RECIP", 0, "USD", 100);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_AMOUNT);
  });

  it("rejects invalid currency", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.createEscrow("ST2RECIP", 1000, "BTC", 100);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_CURRENCY);
  });

  it("rejects self as recipient", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.createEscrow("ST1TEST", 1000, "USD", 100);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_RECIPIENT);
  });

  it("releases escrow successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createEscrow("ST2RECIP", 1000, "USD", 100);
    const result = contract.releaseEscrow(0);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const escrow = contract.getEscrow(0);
    expect(escrow?.status).toBe("released");
  });

  it("rejects release for non-participant", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createEscrow("ST2RECIP", 1000, "USD", 100);
    contract.caller = "ST3FAKE";
    const result = contract.releaseEscrow(0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects release for non-pending status", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createEscrow("ST2RECIP", 1000, "USD", 100);
    contract.releaseEscrow(0);
    const result = contract.releaseEscrow(0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("cancels escrow successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createEscrow("ST2RECIP", 1000, "USD", 100);
    const result = contract.cancelEscrow(0);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const escrow = contract.getEscrow(0);
    expect(escrow?.status).toBe("cancelled");
  });

  it("rejects cancel by non-sender", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createEscrow("ST2RECIP", 1000, "USD", 100);
    contract.caller = "ST2RECIP";
    const result = contract.cancelEscrow(0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("disputes escrow successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createEscrow("ST2RECIP", 1000, "USD", 100);
    const result = contract.disputeEscrow(0);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const escrow = contract.getEscrow(0);
    expect(escrow?.disputeStatus).toBe("active");
    expect(escrow?.resolver).toBe("ST1TEST");
  });

  it("rejects dispute after timeout", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createEscrow("ST2RECIP", 1000, "USD", 100);
    contract.blockHeight = 200;
    const result = contract.disputeEscrow(0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("resolves dispute to release successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createEscrow("ST2RECIP", 1000, "USD", 100);
    contract.disputeEscrow(0);
    const result = contract.resolveDispute(0, "release");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const escrow = contract.getEscrow(0);
    expect(escrow?.status).toBe("released");
    expect(escrow?.disputeStatus).toBe("resolved");
    const res = contract.getDisputeResolution(0);
    expect(res?.resolution).toBe("release");
  });

  it("rejects invalid resolution", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createEscrow("ST2RECIP", 1000, "USD", 100);
    contract.disputeEscrow(0);
    const result = contract.resolveDispute(0, "invalid");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects resolve by non-resolver", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createEscrow("ST2RECIP", 1000, "USD", 100);
    contract.disputeEscrow(0);
    contract.caller = "ST3FAKE";
    const result = contract.resolveDispute(0, "release");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("times out escrow successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createEscrow("ST2RECIP", 1000, "USD", 100);
    contract.blockHeight = 200;
    const result = contract.timeoutEscrow(0);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const escrow = contract.getEscrow(0);
    expect(escrow?.status).toBe("cancelled");
  });

  it("rejects timeout before expiration", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createEscrow("ST2RECIP", 1000, "USD", 100);
    contract.blockHeight = 100;
    const result = contract.timeoutEscrow(0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("sets creation fee successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.setCreationFee(1000);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.creationFee).toBe(1000);
  });

  it("rejects creation fee change without authority", () => {
    const result = contract.setCreationFee(1000);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("returns correct escrow count", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createEscrow("ST2RECIP", 1000, "USD", 100);
    contract.createEscrow("ST3RECIP", 2000, "EUR", 200);
    const result = contract.getEscrowCount();
    expect(result.ok).toBe(true);
    expect(result.value).toBe(2);
  });

  it("checks escrow existence correctly", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createEscrow("ST2RECIP", 1000, "USD", 100);
    let result = contract.checkEscrowExistence("ST1TEST", "ST2RECIP");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    result = contract.checkEscrowExistence("ST1TEST", "ST3RECIP");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(false);
  });

  it("parses escrow parameters with Clarity types", () => {
    const currency = stringAsciiCV("USD");
    const amount = uintCV(1000);
    expect(currency.value).toBe("USD");
    expect(amount.value).toEqual(BigInt(1000));
  });

  it("rejects max escrows exceeded", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.state.maxEscrows = 1;
    contract.createEscrow("ST2RECIP", 1000, "USD", 100);
    const result = contract.createEscrow("ST3RECIP", 2000, "EUR", 200);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_MAX_ESCROWS_EXCEEDED);
  });

  it("sets authority contract successfully", () => {
    const result = contract.setAuthorityContract("ST2TEST");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.authorityContract).toBe("ST2TEST");
  });

  it("rejects invalid authority contract", () => {
    const result = contract.setAuthorityContract("SP000000000000000000002Q6VF78");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects release during dispute", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createEscrow("ST2RECIP", 1000, "USD", 100);
    contract.disputeEscrow(0);
    const result = contract.releaseEscrow(0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects cancel during dispute", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createEscrow("ST2RECIP", 1000, "USD", 100);
    contract.disputeEscrow(0);
    const result = contract.cancelEscrow(0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });
});