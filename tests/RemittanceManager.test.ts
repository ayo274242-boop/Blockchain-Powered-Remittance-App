import { describe, it, expect, beforeEach } from "vitest";
import { Cl } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_INVALID_RECIPIENT = 101;
const ERR_INVALID_AMOUNT = 102;
const ERR_INVALID_CURRENCY = 103;
const ERR_INVALID_RATE = 104;
const ERR_KYC_NOT_VERIFIED = 105;
const ERR_INSUFFICIENT_BALANCE = 106;
const ERR_TRANSFER_FAILED = 107;
const ERR_ESCROW_FAILED = 108;
const ERR_INVALID_ESCROW_ID = 109;
const ERR_ESCROW_NOT_PENDING = 110;
const ERR_INVALID_FEE_RATE = 111;
const ERR_AUTHORITY_NOT_SET = 113;
const ERR_INVALID_MIN_AMOUNT = 114;
const ERR_INVALID_MAX_AMOUNT = 115;
const ERR_TRANSFER_ALREADY_EXISTS = 116;
const ERR_TRANSFER_NOT_FOUND = 117;
const ERR_INVALID_STATUS = 118;
const ERR_INVALID_GRACE_PERIOD = 119;
const ERR_INVALID_LOCATION = 120;
const ERR_REFUND_FAILED = 125;

interface Transfer {
  sender: string;
  recipient: string;
  amountFiat: bigint;
  currency: string;
  amountToken: bigint;
  fee: bigint;
  timestamp: number;
  status: string;
  escrowId: number | null;
  locationSender: string;
  locationRecipient: string;
}

type Result<T> = { ok: true; value: T } | { ok: false; value: number };

class RemittanceManagerMock {
  state: {
    nextTransferId: number;
    maxTransfers: number;
    transferFeeRate: number;
    minTransferAmount: number;
    maxTransferAmount: number;
    authorityContract: string | null;
    gracePeriod: number;
    transfers: Map<number, Transfer>;
    transfersBySender: Map<string, number[]>;
    transfersByRecipient: Map<string, number[]>;
  } = {
    nextTransferId: 0,
    maxTransfers: 10000,
    transferFeeRate: 1,
    minTransferAmount: 100,
    maxTransferAmount: 1000000,
    authorityContract: null,
    gracePeriod: 144,
    transfers: new Map(),
    transfersBySender: new Map(),
    transfersByRecipient: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1SENDER";
  userRegistry: Map<string, { kycVerified: boolean }> = new Map();
  balances: Map<string, bigint> = new Map();
  oracleRates: Map<string, bigint> = new Map();
  escrowActions: Map<number, { status: string; amount: bigint; recipient: string }> = new Map();
  nextEscrowId: number = 0;

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      nextTransferId: 0,
      maxTransfers: 10000,
      transferFeeRate: 1,
      minTransferAmount: 100,
      maxTransferAmount: 1000000,
      authorityContract: null,
      gracePeriod: 144,
      transfers: new Map(),
      transfersBySender: new Map(),
      transfersByRecipient: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1SENDER";
    this.userRegistry = new Map();
    this.balances = new Map();
    this.oracleRates = new Map([["USD", 1000000n]]);
    this.escrowActions = new Map();
    this.nextEscrowId = 0;
  }

  mockUserRegistry(user: string, kycVerified: boolean) {
    this.userRegistry.set(user, { kycVerified });
  }

  mockBalance(user: string, balance: bigint) {
    this.balances.set(user, balance);
  }

  mockOracleRate(currency: string, rate: bigint) {
    this.oracleRates.set(currency, rate);
  }

  getUserInfo(user: string): { kycVerified: boolean } | null {
    return this.userRegistry.get(user) || null;
  }

  getBalance(user: string): bigint {
    return this.balances.get(user) || 0n;
  }

  getRate(currency: string): bigint | null {
    return this.oracleRates.get(currency) || null;
  }

  createEscrow(recipient: string, amount: bigint, currency: string): Result<number> {
    const id = this.nextEscrowId++;
    this.escrowActions.set(id, { status: "pending", amount, recipient });
    return { ok: true, value: id };
  }

  releaseEscrow(id: number): Result<boolean> {
    const escrow = this.escrowActions.get(id);
    if (!escrow || escrow.status !== "pending") return { ok: false, value: ERR_TRANSFER_FAILED };
    escrow.status = "released";
    return { ok: true, value: true };
  }

  cancelEscrow(id: number): Result<boolean> {
    const escrow = this.escrowActions.get(id);
    if (!escrow || escrow.status !== "pending") return { ok: false, value: ERR_REFUND_FAILED };
    escrow.status = "cancelled";
    return { ok: true, value: true };
  }

  transferToken(amount: bigint, from: string, to: string): Result<boolean> {
    const fromBal = this.getBalance(from);
    if (fromBal < amount) return { ok: false, value: ERR_INSUFFICIENT_BALANCE };
    this.balances.set(from, fromBal - amount);
    const toBal = this.getBalance(to);
    this.balances.set(to, toBal + amount);
    return { ok: true, value: true };
  }

  setAuthorityContract(contractPrincipal: string): Result<boolean> {
    if (this.caller !== contractPrincipal) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (this.state.authorityContract !== null) return { ok: false, value: ERR_AUTHORITY_NOT_SET };
    this.state.authorityContract = contractPrincipal;
    return { ok: true, value: true };
  }

  setTransferFeeRate(newRate: number): Result<boolean> {
    if (!this.state.authorityContract) return { ok: false, value: ERR_AUTHORITY_NOT_SET };
    if (newRate > 5) return { ok: false, value: ERR_INVALID_FEE_RATE };
    this.state.transferFeeRate = newRate;
    return { ok: true, value: true };
  }

  setMinTransferAmount(newMin: number): Result<boolean> {
    if (!this.state.authorityContract) return { ok: false, value: ERR_AUTHORITY_NOT_SET };
    if (newMin <= 0) return { ok: false, value: ERR_INVALID_MIN_AMOUNT };
    this.state.minTransferAmount = newMin;
    return { ok: true, value: true };
  }

  setMaxTransferAmount(newMax: number): Result<boolean> {
    if (!this.state.authorityContract) return { ok: false, value: ERR_AUTHORITY_NOT_SET };
    if (newMax <= this.state.minTransferAmount) return { ok: false, value: ERR_INVALID_MAX_AMOUNT };
    this.state.maxTransferAmount = newMax;
    return { ok: true, value: true };
  }

  setGracePeriod(newPeriod: number): Result<boolean> {
    if (!this.state.authorityContract) return { ok: false, value: ERR_AUTHORITY_NOT_SET };
    if (newPeriod > 144) return { ok: false, value: ERR_INVALID_GRACE_PERIOD };
    this.state.gracePeriod = newPeriod;
    return { ok: true, value: true };
  }

  initiateTransfer(
    recipient: string,
    amountFiat: bigint,
    currency: string,
    locationSender: string,
    locationRecipient: string
  ): Result<number> {
    if (this.state.nextTransferId >= this.state.maxTransfers) return { ok: false, value: ERR_TRANSFER_ALREADY_EXISTS };
    if (recipient === this.caller) return { ok: false, value: ERR_INVALID_RECIPIENT };
    if (Number(amountFiat) < this.state.minTransferAmount || Number(amountFiat) > this.state.maxTransferAmount) return { ok: false, value: ERR_INVALID_AMOUNT };
    if (!["USD", "EUR", "GBP"].includes(currency)) return { ok: false, value: ERR_INVALID_CURRENCY };
    const senderInfo = this.getUserInfo(this.caller);
    if (!senderInfo || !senderInfo.kycVerified) return { ok: false, value: ERR_KYC_NOT_VERIFIED };
    const recipientInfo = this.getUserInfo(recipient);
    if (!recipientInfo || !recipientInfo.kycVerified) return { ok: false, value: ERR_KYC_NOT_VERIFIED };
    const rate = this.getRate(currency);
    if (!rate || rate === 0n) return { ok: false, value: ERR_INVALID_RATE };
    const amountToken = (amountFiat * 1000000n) / rate;
    const fee = (amountFiat * BigInt(this.state.transferFeeRate)) / 100n;
    const totalToken = amountToken + fee;
    if (this.getBalance(this.caller) < totalToken) return { ok: false, value: ERR_INSUFFICIENT_BALANCE };
    if (!locationSender || locationSender.length > 100) return { ok: false, value: ERR_INVALID_LOCATION };
    if (!locationRecipient || locationRecipient.length > 100) return { ok: false, value: ERR_INVALID_LOCATION };
    const escrowResult = this.createEscrow(recipient, amountToken, currency);
    if (!escrowResult.ok) return { ok: false, value: ERR_ESCROW_FAILED };
    const escrowId = escrowResult.value;
    const transferResult = this.transferToken(totalToken, this.caller, "contract");
    if (!transferResult.ok) return { ok: false, value: ERR_TRANSFER_FAILED };
    const id = this.state.nextTransferId;
    const transfer: Transfer = {
      sender: this.caller,
      recipient,
      amountFiat,
      currency,
      amountToken,
      fee,
      timestamp: this.blockHeight,
      status: "pending",
      escrowId,
      locationSender,
      locationRecipient,
    };
    this.state.transfers.set(id, transfer);
    const senderTransfers = this.state.transfersBySender.get(this.caller) || [];
    this.state.transfersBySender.set(this.caller, [...senderTransfers, id]);
    const recipientTransfers = this.state.transfersByRecipient.get(recipient) || [];
    this.state.transfersByRecipient.set(recipient, [...recipientTransfers, id]);
    this.state.nextTransferId++;
    return { ok: true, value: id };
  }

  completeTransfer(transferId: number): Result<boolean> {
    const transfer = this.state.transfers.get(transferId);
    if (!transfer) return { ok: false, value: ERR_TRANSFER_NOT_FOUND };
    if (transfer.sender !== this.caller) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (transfer.status !== "pending") return { ok: false, value: ERR_ESCROW_NOT_PENDING };
    if (transfer.escrowId === null) return { ok: false, value: ERR_INVALID_ESCROW_ID };
    const escrowResult = this.releaseEscrow(transfer.escrowId);
    if (!escrowResult.ok) return { ok: false, value: ERR_TRANSFER_FAILED };
    transfer.status = "completed";
    this.state.transfers.set(transferId, transfer);
    return { ok: true, value: true };
  }

  cancelTransfer(transferId: number): Result<boolean> {
    const transfer = this.state.transfers.get(transferId);
    if (!transfer) return { ok: false, value: ERR_TRANSFER_NOT_FOUND };
    if (transfer.sender !== this.caller) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (transfer.status !== "pending") return { ok: false, value: ERR_ESCROW_NOT_PENDING };
    if (this.blockHeight - transfer.timestamp >= this.state.gracePeriod) return { ok: false, value: ERR_INVALID_GRACE_PERIOD };
    if (transfer.escrowId === null) return { ok: false, value: ERR_INVALID_ESCROW_ID };
    const escrowResult = this.cancelEscrow(transfer.escrowId);
    if (!escrowResult.ok) return { ok: false, value: ERR_REFUND_FAILED };
    const totalRefund = transfer.amountToken + transfer.fee;
    const refundResult = this.transferToken(totalRefund, "contract", transfer.sender);
    if (!refundResult.ok) return { ok: false, value: ERR_REFUND_FAILED };
    transfer.status = "cancelled";
    this.state.transfers.set(transferId, transfer);
    return { ok: true, value: true };
  }

  getTransferStatus(id: number): Result<string> {
    const transfer = this.state.transfers.get(id);
    if (!transfer) return { ok: false, value: ERR_TRANSFER_NOT_FOUND };
    return { ok: true, value: transfer.status };
  }

  updateTransferLocation(id: number, newLocationSender: string, newLocationRecipient: string): Result<boolean> {
    const transfer = this.state.transfers.get(id);
    if (!transfer) return { ok: false, value: ERR_TRANSFER_NOT_FOUND };
    if (transfer.sender !== this.caller) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (transfer.status !== "pending") return { ok: false, value: ERR_INVALID_STATUS };
    if (!newLocationSender || newLocationSender.length > 100) return { ok: false, value: ERR_INVALID_LOCATION };
    if (!newLocationRecipient || newLocationRecipient.length > 100) return { ok: false, value: ERR_INVALID_LOCATION };
    transfer.locationSender = newLocationSender;
    transfer.locationRecipient = newLocationRecipient;
    this.state.transfers.set(id, transfer);
    return { ok: true, value: true };
  }
}

describe("RemittanceManager", () => {
  let contract: RemittanceManagerMock;

  beforeEach(() => {
    contract = new RemittanceManagerMock();
    contract.reset();
  });

  it("sets authority contract successfully", () => {
    contract.caller = "STAUTH";
    const result = contract.setAuthorityContract("STAUTH");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(true);
    }
    expect(contract.state.authorityContract).toBe("STAUTH");
  });

  it("rejects authority set by unauthorized", () => {
    contract.caller = "ST1SENDER";
    const result = contract.setAuthorityContract("STAUTH");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.value).toBe(ERR_NOT_AUTHORIZED);
    }
  });

  it("sets transfer fee rate successfully", () => {
    contract.caller = "STAUTH";
    contract.setAuthorityContract("STAUTH");
    const result = contract.setTransferFeeRate(2);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(true);
    }
    expect(contract.state.transferFeeRate).toBe(2);
  });

  it("rejects invalid fee rate", () => {
    contract.caller = "STAUTH";
    contract.setAuthorityContract("STAUTH");
    const result = contract.setTransferFeeRate(6);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.value).toBe(ERR_INVALID_FEE_RATE);
    }
  });

  it("initiates transfer successfully", () => {
    contract.mockUserRegistry("ST1SENDER", true);
    contract.mockUserRegistry("ST2RECIPIENT", true);
    contract.mockBalance("ST1SENDER", 1010n);
    const result = contract.initiateTransfer("ST2RECIPIENT", 1000n, "USD", "LocationA", "LocationB");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(0);
    }
    const transfer = contract.state.transfers.get(0);
    expect(transfer?.amountFiat).toBe(1000n);
    expect(transfer?.status).toBe("pending");
    expect(contract.getBalance("ST1SENDER")).toBe(0n);
    expect(contract.getBalance("contract")).toBe(1010n);
  });

  it("rejects transfer with invalid amount", () => {
    const result = contract.initiateTransfer("ST2RECIPIENT", 50n, "USD", "LocationA", "LocationB");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.value).toBe(ERR_INVALID_AMOUNT);
    }
  });

  it("rejects transfer without KYC", () => {
    contract.mockUserRegistry("ST1SENDER", false);
    const result = contract.initiateTransfer("ST2RECIPIENT", 1000n, "USD", "LocationA", "LocationB");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.value).toBe(ERR_KYC_NOT_VERIFIED);
    }
  });

  it("completes transfer successfully", () => {
    contract.mockUserRegistry("ST1SENDER", true);
    contract.mockUserRegistry("ST2RECIPIENT", true);
    contract.mockBalance("ST1SENDER", 1010n);
    contract.initiateTransfer("ST2RECIPIENT", 1000n, "USD", "LocationA", "LocationB");
    const result = contract.completeTransfer(0);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(true);
    }
    const status = contract.getTransferStatus(0);
    expect(status.ok).toBe(true);
    if (status.ok) {
      expect(status.value).toBe("completed");
    }
  });

  it("rejects complete by non-sender", () => {
    contract.mockUserRegistry("ST1SENDER", true);
    contract.mockUserRegistry("ST2RECIPIENT", true);
    contract.mockBalance("ST1SENDER", 1010n);
    contract.initiateTransfer("ST2RECIPIENT", 1000n, "USD", "LocationA", "LocationB");
    contract.caller = "ST3FAKE";
    const result = contract.completeTransfer(0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.value).toBe(ERR_NOT_AUTHORIZED);
    }
  });

  it("cancels transfer successfully", () => {
    contract.mockUserRegistry("ST1SENDER", true);
    contract.mockUserRegistry("ST2RECIPIENT", true);
    contract.mockBalance("ST1SENDER", 1010n);
    contract.initiateTransfer("ST2RECIPIENT", 1000n, "USD", "LocationA", "LocationB");
    const result = contract.cancelTransfer(0);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(true);
    }
    const status = contract.getTransferStatus(0);
    expect(status.ok).toBe(true);
    if (status.ok) {
      expect(status.value).toBe("cancelled");
    }
    expect(contract.getBalance("ST1SENDER")).toBe(1010n);
    expect(contract.getBalance("contract")).toBe(0n);
  });

  it("rejects cancel after grace period", () => {
    contract.mockUserRegistry("ST1SENDER", true);
    contract.mockUserRegistry("ST2RECIPIENT", true);
    contract.mockBalance("ST1SENDER", 1010n);
    contract.initiateTransfer("ST2RECIPIENT", 1000n, "USD", "LocationA", "LocationB");
    contract.blockHeight = 200;
    const result = contract.cancelTransfer(0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.value).toBe(ERR_INVALID_GRACE_PERIOD);
    }
  });

  it("updates transfer location successfully", () => {
    contract.mockUserRegistry("ST1SENDER", true);
    contract.mockUserRegistry("ST2RECIPIENT", true);
    contract.mockBalance("ST1SENDER", 1010n);
    contract.initiateTransfer("ST2RECIPIENT", 1000n, "USD", "LocationA", "LocationB");
    const result = contract.updateTransferLocation(0, "NewLocationA", "NewLocationB");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(true);
    }
    const transfer = contract.state.transfers.get(0);
    expect(transfer?.locationSender).toBe("NewLocationA");
    expect(transfer?.locationRecipient).toBe("NewLocationB");
  });

  it("rejects location update for non-pending", () => {
    contract.mockUserRegistry("ST1SENDER", true);
    contract.mockUserRegistry("ST2RECIPIENT", true);
    contract.mockBalance("ST1SENDER", 1010n);
    contract.initiateTransfer("ST2RECIPIENT", 1000n, "USD", "LocationA", "LocationB");
    contract.completeTransfer(0);
    const result = contract.updateTransferLocation(0, "NewLocationA", "NewLocationB");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.value).toBe(ERR_INVALID_STATUS);
    }
  });

  it("gets transfer status correctly", () => {
    contract.mockUserRegistry("ST1SENDER", true);
    contract.mockUserRegistry("ST2RECIPIENT", true);
    contract.mockBalance("ST1SENDER", 1010n);
    contract.initiateTransfer("ST2RECIPIENT", 1000n, "USD", "LocationA", "LocationB");
    const result = contract.getTransferStatus(0);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("pending");
    }
  });

  it("rejects invalid currency in transfer", () => {
    contract.mockUserRegistry("ST1SENDER", true);
    contract.mockUserRegistry("ST2RECIPIENT", true);
    contract.mockBalance("ST1SENDER", 1010n);
    const result = contract.initiateTransfer("ST2RECIPIENT", 1000n, "INVALID", "LocationA", "LocationB");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.value).toBe(ERR_INVALID_CURRENCY);
    }
  });

  it("handles Clarity types for parameters", () => {
    const principal = Cl.principal("SP111MNWTSXGTD0ESMV59WX4KHQA93RTV9F82EK0K");
    expect(principal).toBeDefined();
    const amount = Cl.uint(1000n);
    expect(amount.value).toEqual(BigInt(1000));
  });
});